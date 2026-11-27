"""The server's load, measured for the whole server: every worker and the master (``GET /api/v1/status``).

Gunicorn's master forks the workers, and a request reaches one of them, so no single process sees the server's load.
Each worker therefore keeps its own facts in a table of shared memory made before the fork (as the rate limit does,
:py:class:`idtrack_web_api.limits.RateLimiter`): its pid, when it began serving, the requests it answered and holds,
its searches running and waiting, its errors, a ring of its recent request durations, its requests per second, and
its CPU and memory as its own sampler measured them. Any worker reads the whole table to answer ``/status``.

- **CPU**: a process's share of one core over the last sampling interval: the CPU time it used (user and system, all
  its threads) divided by the wall time between two samples; ``1.0`` is one core kept busy. A worker measures itself
  (``os.times``, every :py:data:`SAMPLE_SECONDS`, on a thread of its own, so a request never waits for it); the master
  is measured from ``/proc/<pid>/stat`` by whichever worker samples first. The server's total is the sum of the shares
  over the cores available to it: the CPU affinity set, or less when a cgroup v2 ``cpu.max`` quota (of the process's
  cgroup or an ancestor) allows less.
- **Memory**: per process from ``/proc/<pid>/smaps_rollup``, every :py:data:`MEMORY_SAMPLE_SECONDS` (the kernel
  walks the process's page tables to write it: about 23 ms for a process that maps the five graphs, so it is read
  less often than the CPU, which costs microseconds): RSS (resident pages; a page the forked workers share with
  the master, such as the graphs', is counted once in each process that maps it), PSS (each resident page divided by
  the number of processes sharing it, so the sum over the server's processes is its real footprint) and USS (the pages
  of the process alone: what it would free on exit). The limit is the smallest cgroup v2 ``memory.max`` of the
  process's cgroup and its ancestors, with that cgroup's ``memory.current``; without one, the machine's total and
  available memory (``/proc/meminfo``).
- **Requests waiting**, in three counts that never hold the same request twice (``idtrack_web_api.server``):
  connections in the kernel's listen queue that no worker has taken yet (the queue's length the kernel reports for the
  listening socket, Linux's ``TCP_INFO``), searches a busy worker handed on to the queue the workers share (its count in
  shared memory), both read when ``/status`` is answered, and searches a worker holds that wait for its own search
  thread.
- **Answers not yet taken**: the bytes of answers each worker holds for clients that have not read them yet.

What cannot be measured (``/proc`` missing, off Linux) is ``null`` and named in ``unavailable``; no value is made up.
Nothing that identifies the machine (host name, paths, users, environment, command lines, process ids: the table keeps
pids to tell its rows apart, and the answer numbers the workers by their row) is read into the answer.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import logging
import math
import multiprocessing
import os
import socket
import struct
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

#: Seconds between two samples of a worker's CPU (and of the master's).
SAMPLE_SECONDS = 1.0
#: Seconds between two samples of a process's memory.
MEMORY_SAMPLE_SECONDS = 5.0
#: Seconds an answer of ``/status`` is reused by the worker that made it.
CACHE_SECONDS = 1.0
#: Request durations each worker keeps (its most recent).
RING = 1000
#: The latency percentiles are over the server's most recent requests, at most this many...
LATENCY_REQUESTS = 1000
#: ...that ended within this many seconds before the sample.
LATENCY_WINDOW_SECONDS = 300.0
#: Requests per second are counted in this many one-second buckets (at least 60 and a few).
_BUCKETS = 64

# The fields of a process's row of the table (floats; an integer count is exact up to 2**53; NaN: not measured).
_PID, _START_TICKS, _STARTED_WALL = 0, 1, 2
_REQUESTS, _IN_FLIGHT, _ERRORS_4XX, _ERRORS_5XX = 3, 4, 5, 6
_SEARCH_HELD, _SEARCH_RUNNING = 7, 8
_CPU_SECONDS, _CPU_SHARE, _CPU_AT = 9, 10, 11
_RSS, _PSS, _USS, _MEMORY_AT = 12, 13, 14, 15
_RING_WRITTEN, _STATUS_REQUESTS, _SENDING = 16, 17, 18
_HEADER = 20
_RING_END = _HEADER
_RING_SECONDS = _RING_END + RING
_BUCKET_SECOND = _RING_SECONDS + RING
_BUCKET_COUNT = _BUCKET_SECOND + _BUCKETS
_ROW = _BUCKET_COUNT + _BUCKETS
_NAN = math.nan

# The server's own fields: when the table was made, the totals of workers whose rows were reused, the workers that
# ended (and when the last did, and the requests they held then), the requests to /status, and the process that holds
# the table's lock.
_MADE_WALL, _MADE_MONO, _RETIRED_REQUESTS, _RETIRED_4XX, _RETIRED_5XX = 0, 1, 2, 3, 4
_EXITS, _LAST_EXIT_WALL, _LOST, _RETIRED_STATUS, _LOCK_HOLDER = 5, 6, 7, 8, 9
# The mean time of the recent searches (each weighted by :py:data:`SEARCH_WEIGHT`), and the searches measured.
_SEARCH_MEAN, _SEARCHES_MEASURED = 12, 13
_SERVER = 14
#: The weight of the latest search in the mean of recent searches' time (an exponential moving mean: the last ten or so
#: searches carry most of it), which estimates how long a search waits in the queue (:py:mod:`idtrack_web_api.server`).
SEARCH_WEIGHT = 0.2


def _known(value: float) -> float | None:
    return None if math.isnan(value) else value


def _whole(value: float) -> int | None:
    return None if math.isnan(value) else int(value)


def _iso(wall: float) -> str:
    return dt.datetime.fromtimestamp(wall, dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class ProcessMemory:
    """A process's memory, in bytes (PSS and USS ``None`` where only RSS could be read).

    Attributes:
        rss: Resident set size.
        pss: Proportional set size.
        uss: Unique set size.
    """

    rss: int
    pss: int | None
    uss: int | None


@dataclass(frozen=True)
class CpuLimit:
    """The cores available to the server.

    Attributes:
        affinity_cores: The CPUs the process may run on (its affinity set; off Linux, the machine's CPU count).
        quota_cores: A cgroup v2 ``cpu.max`` quota in cores (quota over period), the smallest of the process's cgroup
            and its ancestors; ``None`` when none is set or cgroups cannot be read.
        cores: The cores available: the smaller of the two.
        source: Which one sets ``cores``: ``cgroup`` (the quota), ``affinity`` or ``cpu_count``.
    """

    affinity_cores: int
    quota_cores: float | None
    cores: float
    source: str


@dataclass(frozen=True)
class MemoryLimit:
    """The memory the server runs under, in bytes.

    Attributes:
        limit: The limit.
        used: What is used of it (the cgroup's ``memory.current``; the machine's total less available memory).
        source: ``cgroup`` (a cgroup v2 ``memory.max``) or ``meminfo`` (the machine's memory).
    """

    limit: int
    used: int
    source: str


class SystemReader:
    """Reads what the kernel reports about processes, cgroups and memory (Linux's ``/proc`` and ``/sys/fs/cgroup``).

    Every reader returns ``None`` when its file is missing or cannot be read, so the server reports ``null`` instead
    of a guess. The two roots are arguments so that tests can point them at fixture folders (or at missing ones).
    """

    def __init__(self, proc: Path = Path("/proc"), cgroup: Path = Path("/sys/fs/cgroup")) -> None:
        """Set the roots.

        Args:
            proc: The root of the process file system.
            cgroup: The root of the cgroup v2 hierarchy.
        """
        self.proc = proc
        self.cgroup = cgroup
        try:
            self.ticks = float(os.sysconf("SC_CLK_TCK"))
        except (AttributeError, ValueError, OSError):  # pragma: no cover - every POSIX system has it
            self.ticks = 100.0
        try:
            self.page = int(os.sysconf("SC_PAGE_SIZE"))
        except (AttributeError, ValueError, OSError):  # pragma: no cover
            self.page = 4096

    def _text(self, path: Path) -> str | None:
        try:
            return path.read_text(encoding="ascii", errors="replace")
        except OSError:
            return None

    def _stat(self, pid: int) -> list[str] | None:
        """Return the fields of ``/proc/<pid>/stat`` after the command (field 3, the state, first)."""
        text = self._text(self.proc / str(pid) / "stat")
        if text is None or ")" not in text:
            return None
        return text.rsplit(")", 1)[1].split()

    def cpu_seconds(self, pid: int) -> float | None:
        """Return the CPU time a process has used (user and system, all threads), in seconds.

        Args:
            pid: The process.

        Returns:
            float | None: The seconds; ``None`` if it cannot be read.
        """
        fields = self._stat(pid)
        if fields is None or len(fields) < 13:
            return None
        try:
            return (int(fields[11]) + int(fields[12])) / self.ticks  # utime and stime: fields 14 and 15
        except ValueError:
            return None

    def start_ticks(self, pid: int) -> int | None:
        """Return when a process started, in clock ticks after boot (tells a reused pid from its first process).

        Args:
            pid: The process.

        Returns:
            int | None: The ticks; ``None`` if they cannot be read.
        """
        fields = self._stat(pid)
        if fields is None or len(fields) < 20:
            return None
        try:
            return int(fields[19])  # starttime: field 22
        except ValueError:
            return None

    def alive(self, pid: int, start_ticks: int | None) -> bool:
        """Return whether a process is alive and is the process that was recorded (not a later one with its pid).

        Args:
            pid: The process.
            start_ticks: Its start as recorded (``None``: not recorded).

        Returns:
            bool: ``True`` if it runs.
        """
        fields = self._stat(pid)
        if fields is not None:
            if fields[0] in {"Z", "X", "x"}:
                return False
            return start_ticks is None or self.start_ticks(pid) == start_ticks
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:  # a process of another user: not one of the server's
            return False
        return True

    def memory(self, pid: int) -> ProcessMemory | None:
        """Return a process's RSS, PSS and USS (``smaps_rollup``), or its RSS alone (``statm``).

        Args:
            pid: The process.

        Returns:
            ProcessMemory | None: The memory; ``None`` if neither file can be read.
        """
        text = self._text(self.proc / str(pid) / "smaps_rollup")
        if text is not None:
            kib: dict[str, int] = {}
            for line in text.splitlines():
                name, _, rest = line.partition(":")
                parts = rest.split()
                if len(parts) == 2 and parts[1] == "kB" and parts[0].isdigit():
                    kib[name.strip()] = int(parts[0])
            if "Rss" in kib and "Pss" in kib:
                private = kib.get("Private_Clean", 0) + kib.get("Private_Dirty", 0) + kib.get("Private_Hugetlb", 0)
                return ProcessMemory(rss=kib["Rss"] * 1024, pss=kib["Pss"] * 1024, uss=private * 1024)
        statm = self._text(self.proc / str(pid) / "statm")
        if statm is not None:
            parts = statm.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return ProcessMemory(rss=int(parts[1]) * self.page, pss=None, uss=None)
        return None

    def cgroups(self) -> list[Path]:
        """Return the folders of this process's cgroup v2 and of its ancestors, the process's own first.

        Returns:
            list[Path]: The folders; empty when the process's cgroup cannot be read or is not a cgroup v2.
        """
        text = self._text(self.proc / "self" / "cgroup")
        if text is None:
            return []
        for line in text.splitlines():
            if line.startswith("0::"):
                relative = line[3:].strip().strip("/")
                parts = [p for p in relative.split("/") if p and p not in {".", ".."}]
                return [self.cgroup.joinpath(*parts[:i]) for i in range(len(parts), -1, -1)]
        return []

    def cpu_limit(self) -> CpuLimit:
        """Return the cores available: the affinity set, and the smallest cgroup v2 quota if one is set.

        Returns:
            CpuLimit: The cores and where the number comes from.
        """
        try:
            affinity, source = len(os.sched_getaffinity(0)), "affinity"
        except AttributeError:  # not on Linux
            affinity, source = os.cpu_count() or 1, "cpu_count"
        quota: float | None = None
        for folder in self.cgroups():
            text = self._text(folder / "cpu.max")
            if text is None:
                continue
            parts = text.split()
            if len(parts) == 2 and parts[0] != "max":
                try:
                    cores = int(parts[0]) / int(parts[1])
                except (ValueError, ZeroDivisionError):
                    continue
                quota = cores if quota is None else min(quota, cores)
        if quota is not None and quota < affinity:
            return CpuLimit(affinity_cores=affinity, quota_cores=quota, cores=quota, source="cgroup")
        return CpuLimit(affinity_cores=affinity, quota_cores=quota, cores=float(affinity), source=source)

    def memory_limit(self) -> MemoryLimit | None:
        """Return the smallest cgroup v2 memory limit with its use, else the machine's memory.

        Returns:
            MemoryLimit | None: The limit; ``None`` when neither can be read.
        """
        found: MemoryLimit | None = None
        for folder in self.cgroups():
            limit = (self._text(folder / "memory.max") or "").strip()
            current = (self._text(folder / "memory.current") or "").strip()
            if limit.isdigit() and current.isdigit() and (found is None or int(limit) < found.limit):
                found = MemoryLimit(limit=int(limit), used=int(current), source="cgroup")
        if found is not None:
            return found
        text = self._text(self.proc / "meminfo")
        if text is None:
            return None
        kib: dict[str, int] = {}
        for line in text.splitlines():
            name, _, rest = line.partition(":")
            parts = rest.split()
            if parts and parts[0].isdigit():
                kib[name.strip()] = int(parts[0])
        if "MemTotal" not in kib or "MemAvailable" not in kib:
            return None
        total = kib["MemTotal"] * 1024
        return MemoryLimit(limit=total, used=total - kib["MemAvailable"] * 1024, source="meminfo")


def _percentile(ordered: list[float], fraction: float) -> float:
    """Return the nearest-rank percentile of ascending values (the smallest with at least *fraction* at or below)."""
    rank = max(1, math.ceil(fraction * len(ordered)))
    return ordered[rank - 1]


class LoadMonitor:
    """The table of every worker's facts, shared by the processes forked after it is made, and what reads it."""

    def __init__(
        self,
        workers: int,
        reader: SystemReader | None = None,
        sample_seconds: float = SAMPLE_SECONDS,
        memory_sample_seconds: float = MEMORY_SAMPLE_SECONDS,
    ) -> None:
        """Make the shared table (before the workers are forked).

        Args:
            workers: The workers configured.
            reader: What reads ``/proc`` and the cgroups (``None``: the system's).
            sample_seconds: Seconds between two samples of CPU.
            memory_sample_seconds: Seconds between two samples of memory (at least *sample_seconds*).
        """
        self.workers = workers
        self.reader = reader or SystemReader()
        self.sample_seconds = sample_seconds
        self.memory_sample_seconds = max(sample_seconds, memory_sample_seconds)
        # A replaced worker leaves its row until a new one takes it; twice the workers leaves room for replacements.
        self.slots = max(2 * workers, workers + 2)
        context = multiprocessing.get_context("fork")
        # Row 0: the master; rows 1 to slots: the workers.
        self._table: Any = context.RawArray("d", (self.slots + 1) * _ROW)
        self._server: Any = context.RawArray("d", _SERVER)
        self._lock: Any = context.Lock()
        self.master_pid = os.getpid()
        for row in range(self.slots + 1):
            self._clear(row)
        self._server[_MADE_WALL] = time.time()
        self._server[_MADE_MONO] = time.monotonic()
        start = self.reader.start_ticks(self.master_pid)
        self._set(0, _PID, float(self.master_pid))
        self._set(0, _START_TICKS, _NAN if start is None else float(start))
        self._set(0, _STARTED_WALL, self._server[_MADE_WALL])
        # This process's row, and its sampler (both set in each worker after the fork).
        self._pid = 0
        self._row = 0
        self._previous_cpu: tuple[float, float] | None = None
        self._stop: threading.Event | None = None
        self._thread: threading.Thread | None = None
        # The listening sockets the workers take connections from, and the queue of searches they share (set in each
        # worker; none in one process alone).
        self.listening: list[socket.socket] = []
        self.handoff: Any = None

    # ---------------------------------------------------------------------------------------------------------------
    # The table

    def _get(self, row: int, field: int) -> float:
        return float(self._table[row * _ROW + field])

    def _set(self, row: int, field: int, value: float) -> None:
        self._table[row * _ROW + field] = value

    def _add(self, row: int, field: int, value: float) -> None:
        self._table[row * _ROW + field] += value

    def _clear(self, row: int) -> None:
        base = row * _ROW
        for field in range(_ROW):
            self._table[base + field] = 0.0
        for field in (_START_TICKS, _CPU_SECONDS, _CPU_SHARE, _CPU_AT, _RSS, _PSS, _USS, _MEMORY_AT):
            self._table[base + field] = _NAN

    @contextlib.contextmanager
    def _locked(self, wait: float) -> Any:
        """Hold the table's lock, taking it back from a process that died holding it; yield whether it is held.

        The holder's pid is written beside the lock. When the lock is not free within *wait* seconds and its holder is
        no longer alive (a worker killed while it held the lock), the lock is released on the dead holder's behalf and
        taken; when the holder is alive, the caller goes on without it (``False``).
        """
        held = self._lock.acquire(timeout=wait)
        if not held:
            holder = int(self._server[_LOCK_HOLDER])
            if holder > 0 and holder != os.getpid() and not self.reader.alive(holder, None):
                log.warning("The load table's lock was held by process %d, which ended; taking it back.", holder)
                self._server[_LOCK_HOLDER] = 0.0
                with contextlib.suppress(ValueError):
                    self._lock.release()
                held = self._lock.acquire(timeout=wait)
        if held:
            self._server[_LOCK_HOLDER] = float(os.getpid())
        try:
            yield held
        finally:
            if held:
                self._server[_LOCK_HOLDER] = 0.0
                self._lock.release()

    def _is_alive(self, row: int) -> bool:
        pid = int(self._get(row, _PID))
        return pid > 0 and self.reader.alive(pid, _whole(self._get(row, _START_TICKS)))

    def _mine(self) -> int:
        """Return this process's row, taking one on first use in a process (after the fork); 0: none free."""
        pid = os.getpid()
        if self._pid != pid:
            self._pid = pid
            self._row = self._attach(pid)
            self._previous_cpu = None
        return self._row

    def _attach(self, pid: int) -> int:
        with self._locked(1.0):
            free = None
            for row in range(1, self.slots + 1):
                found = int(self._get(row, _PID))
                if found == pid and self._is_alive(row):
                    return row  # taken by this process before
                if found == pid or (free is None and (found == 0 or not self._is_alive(row))):
                    free = row  # free, or left by a process that ended (or by an earlier process with this pid)
            if free is None:
                log.warning("The load table has no free row for worker %d; its load is not reported.", pid)
                return 0
            self._retire(free, ended=True)
            start = self.reader.start_ticks(pid)
            self._set(free, _START_TICKS, _NAN if start is None else float(start))
            self._set(free, _STARTED_WALL, time.time())
            self._set(free, _PID, float(pid))
            return free

    def _retire(self, row: int, *, ended: bool = False) -> None:
        """Keep a row's totals in the server's, then clear it (called with the lock held).

        Args:
            row: The row.
            ended: Its process ended without giving the row back: the requests it held were lost.
        """
        if self._get(row, _PID) > 0:
            self._server[_RETIRED_REQUESTS] += self._get(row, _REQUESTS)
            self._server[_RETIRED_4XX] += self._get(row, _ERRORS_4XX)
            self._server[_RETIRED_5XX] += self._get(row, _ERRORS_5XX)
            self._server[_RETIRED_STATUS] += self._get(row, _STATUS_REQUESTS)
            if ended:
                self._server[_LOST] += max(0.0, self._get(row, _IN_FLIGHT))
        self._clear(row)

    def worker_exited(self, pid: int) -> None:
        """Record that a worker ended (called in the master, by gunicorn's ``child_exit``): count it, keep its totals.

        A worker that stopped on its own gave its row back first (:py:meth:`detach`); one that was killed (by the
        master's timeout, the kernel's out-of-memory killer, a signal) left its row, and the requests it held are
        counted as lost.

        Args:
            pid: The worker's process id.
        """
        with self._locked(1.0):
            self._server[_EXITS] += 1.0
            self._server[_LAST_EXIT_WALL] = time.time()
            for row in range(1, self.slots + 1):
                if int(self._get(row, _PID)) == pid:
                    self._retire(row, ended=True)

    def detach(self) -> None:
        """Give this worker's row back as it stops (its totals stay in the server's)."""
        if self._pid == os.getpid() and self._row:
            with self._locked(1.0):
                self._retire(self._row)
            self._row = 0
            self._pid = 0

    # ---------------------------------------------------------------------------------------------------------------
    # What a worker records

    def request_started(self) -> None:
        """Count a request this worker now holds."""
        row = self._mine()
        if row:
            self._add(row, _IN_FLIGHT, 1.0)

    def status_request(self) -> None:
        """Count a request to ``/status`` (kept apart, so that watching the load does not change what it reports)."""
        row = self._mine()
        if row:
            self._add(row, _STATUS_REQUESTS, 1.0)

    def request_ended(self, seconds: float, status: int) -> None:
        """Record a request this worker answered.

        Args:
            seconds: Its duration, from arrival to the last byte sent.
            status: Its HTTP status (0: no answer was sent).
        """
        row = self._mine()
        if not row:
            return
        now = time.monotonic()
        self._add(row, _IN_FLIGHT, -1.0)
        self._add(row, _REQUESTS, 1.0)
        if 400 <= status < 500:
            self._add(row, _ERRORS_4XX, 1.0)
        elif status >= 500:
            self._add(row, _ERRORS_5XX, 1.0)
        written = int(self._get(row, _RING_WRITTEN))
        place = written % RING
        self._set(row, _RING_END + place, now)
        self._set(row, _RING_SECONDS + place, seconds)
        self._set(row, _RING_WRITTEN, float(written + 1))
        second = math.floor(now)
        bucket = second % _BUCKETS
        if self._get(row, _BUCKET_SECOND + bucket) != second:
            self._set(row, _BUCKET_SECOND + bucket, float(second))
            self._set(row, _BUCKET_COUNT + bucket, 0.0)
        self._add(row, _BUCKET_COUNT + bucket, 1.0)

    def search_held(self, change: int) -> None:
        """Count a request that starts (``+1``) or stops (``-1``) waiting for or running a search.

        Args:
            change: ``+1`` or ``-1``.
        """
        row = self._mine()
        if row:
            self._add(row, _SEARCH_HELD, float(change))

    def sending(self, change: int) -> None:
        """Count bytes of answers this worker holds for clients that have not taken them (``+n`` held, ``-n`` done).

        Args:
            change: The bytes.
        """
        row = self._mine()
        if row:
            self._add(row, _SENDING, float(change))

    def search_ended(self, seconds: float) -> None:
        """Record the time a search took (with writing its answer), in the mean of the recent searches' time.

        Args:
            seconds: Its time.
        """
        measured = self._server[_SEARCHES_MEASURED]
        mean = self._server[_SEARCH_MEAN]
        self._server[_SEARCH_MEAN] = seconds if measured == 0 else mean + SEARCH_WEIGHT * (seconds - mean)
        self._server[_SEARCHES_MEASURED] = measured + 1.0

    def mean_search_seconds(self) -> float:
        """Return the mean time of the recent searches, every worker's (0 before any search).

        Returns:
            float: Seconds.
        """
        return max(0.0, float(self._server[_SEARCH_MEAN]))

    def search_running(self, *, running: bool) -> None:
        """Mark this worker's search thread as running a search or idle.

        Args:
            running: Whether a search runs.
        """
        row = self._mine()
        if row:
            self._set(row, _SEARCH_RUNNING, 1.0 if running else 0.0)

    # ---------------------------------------------------------------------------------------------------------------
    # Sampling

    def _memory_due(self, row: int, now: float) -> bool:
        then = self._get(row, _MEMORY_AT)
        return math.isnan(then) or now - then >= self.memory_sample_seconds - self.sample_seconds / 2

    def sample(self) -> None:
        """Measure this worker's CPU (its memory when due), and the master's if no worker did in half an interval."""
        row = self._mine()
        if not row:
            return
        now = time.monotonic()
        times = os.times()
        cpu = times.user + times.system
        if self._previous_cpu is not None and now > self._previous_cpu[1]:
            share = max(0.0, (cpu - self._previous_cpu[0]) / (now - self._previous_cpu[1]))
            self._set(row, _CPU_SHARE, share)
        self._previous_cpu = (cpu, now)
        self._set(row, _CPU_SECONDS, cpu)
        self._set(row, _CPU_AT, now)
        if self._memory_due(row, now):
            self._sample_memory(row, self._pid)
        if self.master_pid != self._pid:
            self._sample_master()

    def _sample_memory(self, row: int, pid: int) -> None:
        self._write_memory(row, self.reader.memory(pid))

    def _write_memory(self, row: int, memory: ProcessMemory | None) -> None:
        self._set(row, _RSS, _NAN if memory is None else float(memory.rss))
        self._set(row, _PSS, _NAN if memory is None or memory.pss is None else float(memory.pss))
        self._set(row, _USS, _NAN if memory is None or memory.uss is None else float(memory.uss))
        self._set(row, _MEMORY_AT, time.monotonic())

    def _sample_master(self) -> None:
        """Sample the master's CPU (and memory when due) if no worker did in half an interval.

        The kernel's files are read without the lock (reading ``smaps_rollup`` takes milliseconds); the lock is held
        only to claim the sample and to write it, so that a worker killed meanwhile cannot leave the lock held.
        """
        with self._locked(0.0) as held:
            if not held:
                return  # another worker samples it now
            claimed = time.monotonic()
            then = self._get(0, _CPU_AT)
            if not math.isnan(then) and claimed - then < self.sample_seconds / 2:
                return
            memory_due = self._memory_due(0, claimed)
            self._set(0, _CPU_AT, claimed)  # claimed: no other worker samples it within half an interval
        cpu = self.reader.cpu_seconds(self.master_pid)
        now = time.monotonic()
        memory = self.reader.memory(self.master_pid) if memory_due else None
        with self._locked(0.5) as held:
            if not held:
                return
            previous = self._get(0, _CPU_SECONDS)
            if cpu is not None and not math.isnan(previous) and not math.isnan(then) and now > then:
                self._set(0, _CPU_SHARE, max(0.0, (cpu - previous) / (now - then)))
            elif cpu is None:
                self._set(0, _CPU_SHARE, _NAN)
            self._set(0, _CPU_SECONDS, _NAN if cpu is None else cpu)
            self._set(0, _CPU_AT, now)
            if memory_due:
                self._write_memory(0, memory)

    def start_sampler(self) -> None:
        """Start this worker's sampler: a thread that samples now and every interval, apart from the requests."""
        self._mine()
        if self._thread is not None and self._thread.is_alive():
            return
        stop = threading.Event()

        def run() -> None:
            while True:
                try:
                    self.sample()
                except Exception:  # a failed sample must not end the sampler
                    log.exception("Sampling the load failed.")
                if stop.wait(self.sample_seconds):
                    return

        self._stop = stop
        self._thread = threading.Thread(target=run, name="idtrack-web-load", daemon=True)
        self._thread.start()

    def stop_sampler(self) -> None:
        """Stop this worker's sampler and wait for it."""
        if self._stop is not None:
            self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._stop = None
        self._thread = None

    # ---------------------------------------------------------------------------------------------------------------
    # Reading

    def _process(self, row: int, now: float) -> dict[str, Any]:
        cpu_at, memory_at = self._get(row, _CPU_AT), self._get(row, _MEMORY_AT)
        return {
            "started_at": _iso(self._get(row, _STARTED_WALL)),
            "cpu_share": _known(self._get(row, _CPU_SHARE)),
            "cpu_seconds": _known(self._get(row, _CPU_SECONDS)),
            "rss_bytes": _whole(self._get(row, _RSS)),
            "pss_bytes": _whole(self._get(row, _PSS)),
            "uss_bytes": _whole(self._get(row, _USS)),
            "cpu_sample_age_seconds": None if math.isnan(cpu_at) else max(0.0, now - cpu_at),
            "memory_sample_age_seconds": None if math.isnan(memory_at) else max(0.0, now - memory_at),
        }

    def _last_minute(self, row: int, second: int) -> int:
        base = row * _ROW
        seconds = self._table[base + _BUCKET_SECOND : base + _BUCKET_SECOND + _BUCKETS]
        counts = self._table[base + _BUCKET_COUNT : base + _BUCKET_COUNT + _BUCKETS]
        return int(sum(c for s, c in zip(seconds, counts, strict=True) if second - 60 < s <= second))

    def _worker(self, row: int, now: float) -> dict[str, Any]:
        held = int(self._get(row, _SEARCH_HELD))
        running = int(self._get(row, _SEARCH_RUNNING))
        return {
            "worker": row,
            **self._process(row, now),
            "requests": int(self._get(row, _REQUESTS)),
            "in_flight": int(self._get(row, _IN_FLIGHT)),
            "searches_running": running,
            "searches_waiting": max(0, held - running),
            "sending_bytes": max(0, int(self._get(row, _SENDING))),
            "last_60_seconds": self._last_minute(row, math.floor(now)),
            "errors_4xx": int(self._get(row, _ERRORS_4XX)),
            "errors_5xx": int(self._get(row, _ERRORS_5XX)),
        }

    def _durations(self, rows: list[int], now: float) -> list[tuple[float, float]]:
        found: list[tuple[float, float]] = []
        for row in rows:
            base = row * _ROW
            filled = min(int(self._get(row, _RING_WRITTEN)), RING)
            ends = self._table[base + _RING_END : base + _RING_END + filled]
            seconds = self._table[base + _RING_SECONDS : base + _RING_SECONDS + filled]
            found += [(e, d) for e, d in zip(ends, seconds, strict=True) if now - e <= LATENCY_WINDOW_SECONDS]
        found.sort(reverse=True)
        return found[:LATENCY_REQUESTS]

    def snapshot(self) -> dict[str, Any]:
        """Return the server's load as ``/status`` answers it (without the graphs, which the app adds).

        Returns:
            dict[str, Any]: As :py:class:`idtrack_web_api.schemas.StatusResponse` describes it.
        """
        self._mine()
        now = time.monotonic()
        wall = time.time()
        forked = self.master_pid != os.getpid()
        recorded = [row for row in range(1, self.slots + 1) if self._get(row, _PID) > 0]
        alive = [row for row in recorded if self._is_alive(row)]
        workers = [self._worker(row, now) for row in alive]
        master = self._process(0, now) if forked else None
        processes = ([master] if master is not None else []) + workers

        unavailable: list[str] = []

        def total(field: str, name: str) -> float | None:
            values = [p[field] for p in processes]
            missing = [p for p in processes if p[field] is None]
            if missing or not values:
                unavailable.append(name)
                return None
            return float(sum(values))

        cores_used = total("cpu_share", "cpu.cores_used")
        rss = total("rss_bytes", "memory.rss_bytes")
        pss = total("pss_bytes", "memory.pss_bytes")
        uss = total("uss_bytes", "memory.uss_bytes")
        cpu = self.reader.cpu_limit()
        if cpu.quota_cores is None and not self.reader.cgroups():
            unavailable.append("cpu.quota_cores")
        limit = self.reader.memory_limit()
        if limit is None:
            unavailable += ["memory.limit_bytes", "memory.limit_used_bytes"]
        durations = sorted(seconds for _, seconds in self._durations(recorded, now))
        waiting = connections_waiting(self.listening)
        queued = None if self.handoff is None else int(self.handoff.waiting)
        if waiting is None:
            unavailable.append("requests.connections_waiting")
        if queued is None:
            unavailable.append("requests.searches_queued")
        second = math.floor(now)
        server = self._server
        body: dict[str, Any] = {
            "sampled_at": _iso(wall),
            "started_at": _iso(server[_MADE_WALL]),
            "uptime_seconds": max(0.0, now - server[_MADE_MONO]),
            "sample_interval_seconds": self.sample_seconds,
            "memory_sample_interval_seconds": self.memory_sample_seconds,
            "cache_seconds": CACHE_SECONDS,
            "workers_configured": self.workers,
            "workers_alive": len(alive),
            "workers_exited": int(server[_EXITS]),
            "last_worker_exit_at": _iso(server[_LAST_EXIT_WALL]) if server[_EXITS] > 0 else None,
            "master": master,
            "workers": workers,
            "cpu": {
                "cores_used": cores_used,
                "share_of_available": None if cores_used is None else cores_used / cpu.cores,
                "cores_available": cpu.cores,
                "affinity_cores": cpu.affinity_cores,
                "quota_cores": cpu.quota_cores,
                "source": cpu.source,
            },
            "memory": {
                "rss_bytes": None if rss is None else int(rss),
                "pss_bytes": None if pss is None else int(pss),
                "uss_bytes": None if uss is None else int(uss),
                "limit_bytes": None if limit is None else limit.limit,
                "limit_used_bytes": None if limit is None else limit.used,
                "source": None if limit is None else limit.source,
            },
            "requests": {
                "total": int(server[_RETIRED_REQUESTS] + sum(self._get(row, _REQUESTS) for row in recorded)),
                "in_flight": sum(w["in_flight"] for w in workers),
                "searches_running": sum(w["searches_running"] for w in workers),
                "searches_waiting": sum(w["searches_waiting"] for w in workers),
                "connections_waiting": waiting,
                "searches_queued": queued,
                "sending_bytes": sum(w["sending_bytes"] for w in workers),
                "last_60_seconds": sum(self._last_minute(row, second) for row in recorded),
                "errors_4xx": int(server[_RETIRED_4XX] + sum(self._get(row, _ERRORS_4XX) for row in recorded)),
                "errors_5xx": int(server[_RETIRED_5XX] + sum(self._get(row, _ERRORS_5XX) for row in recorded)),
                "lost": int(server[_LOST]),
                "status_requests": int(
                    server[_RETIRED_STATUS] + sum(self._get(row, _STATUS_REQUESTS) for row in recorded)
                ),
                "latency": {
                    "count": len(durations),
                    "most_recent": LATENCY_REQUESTS,
                    "window_seconds": LATENCY_WINDOW_SECONDS,
                    "p50_ms": _percentile(durations, 0.50) * 1000 if durations else None,
                    "p95_ms": _percentile(durations, 0.95) * 1000 if durations else None,
                    "p99_ms": _percentile(durations, 0.99) * 1000 if durations else None,
                    "max_ms": durations[-1] * 1000 if durations else None,
                },
            },
        }
        body["unavailable"] = sorted(set(unavailable) | self._missing(processes))
        return body

    @staticmethod
    def _missing(processes: list[dict[str, Any]]) -> set[str]:
        missing = set()
        for process in processes:
            role = "workers" if "requests" in process else "master"
            for field in ("cpu_share", "cpu_seconds", "rss_bytes", "pss_bytes", "uss_bytes"):
                if process[field] is None:
                    missing.add(f"{role}.{field}")
        return missing


def connections_waiting(sockets: list[socket.socket]) -> int | None:
    """Return the connections waiting in the listen queues of *sockets*, as the kernel counts them.

    For a listening TCP socket, Linux reports the length of its queue of connections not yet taken in the field
    ``tcpi_unacked`` of ``TCP_INFO`` (bytes 24 to 28 of ``struct tcp_info``).

    Args:
        sockets: Listening sockets.

    Returns:
        int | None: The number; ``None`` without sockets or where the kernel does not tell it.
    """
    if not sockets or not hasattr(socket, "TCP_INFO"):
        return None
    total = 0
    for sock in sockets:
        try:
            info = sock.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 32)
        except OSError:
            return None
        if len(info) < 28:
            return None
        total += struct.unpack_from("I", info, 24)[0]
    return total


__all__ = [
    "CACHE_SECONDS",
    "LATENCY_REQUESTS",
    "LATENCY_WINDOW_SECONDS",
    "MEMORY_SAMPLE_SECONDS",
    "RING",
    "SAMPLE_SECONDS",
    "CpuLimit",
    "LoadMonitor",
    "MemoryLimit",
    "ProcessMemory",
    "SystemReader",
    "connections_waiting",
]
