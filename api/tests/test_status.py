"""The server's load (``/status``), the readers of ``/proc`` and the cgroups, and ``Server-Timing`` on every answer.

The whole server (the master and two forked workers) is in ``test_concurrency.py``; here the application runs in one
process, and the readers run on fixture folders laid out as Linux lays them out.
"""

from __future__ import annotations

import getpass
import json
import os
import re
import socket
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

from idtrack_web_api.monitor import CACHE_SECONDS, LoadMonitor, SystemReader, connections_waiting

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastapi.testclient import TestClient

    from idtrack_web_api.config import Settings

P = "/api/v1"
STATUS = f"{P}/status"
GENE = "ENSSSCG00000040076.1"
#: One entry of ``Server-Timing``: a name and a duration in milliseconds.
TIMING = re.compile(r"^(?P<name>[a-z]+);dur=(?P<ms>\d+(\.\d+)?)$")
#: The entry that tells an answer sent from memory (``hit``) or a ``304`` (``revalidated``).
CACHE_ENTRY = re.compile(r'^cache;desc="(hit|revalidated)"$')


def server_timing(value: str) -> dict[str, float]:
    """Parse a ``Server-Timing`` value into ``{name: milliseconds}`` (fails on any other shape)."""
    found = {}
    for part in value.split(", "):
        if CACHE_ENTRY.match(part):
            continue
        match = TIMING.match(part)
        assert match is not None, value
        found[match["name"]] = float(match["ms"])
    return found


def fresh_status(client: TestClient) -> dict[str, Any]:
    """Return ``/status`` made after every request sent so far (past the cache of the last answer)."""
    time.sleep(CACHE_SECONDS + 0.05)
    response = client.get(STATUS)
    assert response.status_code == 200
    data: dict[str, Any] = response.json()
    return data


# ------------------------------------------------------------------------------------------------------------------
# /status in one process


def test_status_counts_this_process(make_client: Callable[..., TestClient], check_response: Callable[..., Any]) -> None:
    monitor = LoadMonitor(workers=1, sample_seconds=0.2)
    client = make_client(monitor=monitor, rate_per_minute=0)
    for identifier in (GENE, "INS", "NOT_A_GENE"):
        assert client.get(f"{P}/organisms/pig/convert", params={"identifier": identifier}).status_code == 200
    assert client.get(f"{P}/organisms/pig/convert", params={"identifier": "X", "to_release": 1}).status_code == 400
    assert client.get(f"{P}/nothing").status_code == 404
    time.sleep(0.5)  # two samples of the worker
    data = check_response(client.get(STATUS), STATUS)
    assert data["master"] is None  # one process: no master forked it
    [worker] = data["workers"]
    assert worker["worker"] == 1
    assert "pid" not in worker and "pid" not in json.dumps(data)
    assert worker["requests"] == 5
    assert (worker["errors_4xx"], worker["errors_5xx"]) == (2, 0)
    assert worker["in_flight"] == worker["searches_running"] == worker["searches_waiting"] == 0
    assert worker["last_60_seconds"] == 5
    requests = data["requests"]
    assert (requests["total"], requests["errors_4xx"], requests["last_60_seconds"]) == (5, 2, 5)
    latency = requests["latency"]
    assert latency["count"] == 5
    assert 0 < latency["p50_ms"] <= latency["p95_ms"] <= latency["p99_ms"] <= latency["max_ms"]
    # Linux: everything is measured but the listen queue, which only the server (forked workers) has.
    assert data["unavailable"] == ["requests.connections_waiting", "requests.searches_queued"]
    assert requests["connections_waiting"] is None
    assert worker["cpu_share"] is not None and worker["cpu_share"] >= 0
    assert worker["rss_bytes"] >= worker["pss_bytes"] >= worker["uss_bytes"] > 0
    assert data["memory"]["pss_bytes"] == worker["pss_bytes"]
    assert data["cpu"]["cores_available"] <= data["cpu"]["affinity_cores"] == len(os.sched_getaffinity(0))
    assert data["memory"]["source"] in {"cgroup", "meminfo"}
    assert data["graphs"] == [{"organism": "sus_scrofa", "file_bytes": data["graphs_file_bytes"]}]
    assert data["workers_alive"] == 1


def test_status_is_cached_and_does_not_count_itself(client: TestClient) -> None:
    first = client.get(STATUS)
    second = client.get(STATUS)
    assert first.content == second.content  # within the cache's second: the same answer
    assert first.headers["cache-control"] == "no-store"
    before = fresh_status(client)
    for _ in range(5):
        client.get(STATUS)
    after = fresh_status(client)
    assert after["sampled_at"] != before["sampled_at"]
    assert after["requests"]["total"] == before["requests"]["total"]  # polling is not load
    assert after["requests"]["status_requests"] >= before["requests"]["status_requests"] + 6  # but it is counted


def test_status_answers_in_milliseconds(client: TestClient) -> None:
    fresh_status(client)
    time.sleep(CACHE_SECONDS + 0.05)
    start = time.perf_counter()
    response = client.get(STATUS)  # made anew (past the cache)
    assert response.status_code == 200
    assert server_timing(response.headers["server-timing"])["app"] < 50
    assert time.perf_counter() - start < 1


def test_status_draws_on_the_reads(make_client: Callable[..., TestClient]) -> None:
    """Polling the load draws on the reads' allowance (ten times the searches'), never on the searches'."""
    client = make_client(rate_per_minute=6, rate_burst=2)
    assert all(client.get(STATUS).status_code == 200 for _ in range(20))
    assert client.get(STATUS).status_code == 429
    statuses = [
        client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "to_release": str(r)}).status_code
        for r in (80, 81, 82)  # distinct: no answer kept in memory
    ]
    assert statuses == [200, 200, 429]
    assert client.get(f"{P}/health").status_code == 200


def test_status_takes_no_parameters(client: TestClient) -> None:
    response = client.get(f"{STATUS}?verbose=1")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unknown_parameter"


def test_status_tells_nothing_of_the_machine(client: TestClient, cut_settings: Settings) -> None:
    client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE})
    text = json.dumps(fresh_status(client))
    forbidden = [socket.gethostname(), socket.getfqdn(), getpass.getuser(), str(Path.cwd()), str(Path.home())]
    forbidden += [str(cut_settings.directory), "/proc", "/sys", "cgroup/"]
    for value in forbidden:
        assert value not in text, value
    assert not re.search(r"/[a-z]+/", text), "no path"


def test_status_degrades_without_proc(
    make_client: Callable[..., TestClient], check_response: Callable[..., Any], tmp_path: Path
) -> None:
    """Off Linux (no ``/proc``, no cgroups) what cannot be measured is null and named; nothing is made up."""
    missing = tmp_path / "missing"
    monitor = LoadMonitor(workers=1, reader=SystemReader(proc=missing / "proc", cgroup=missing / "cgroup"))
    client = make_client(monitor=monitor, rate_per_minute=0)
    client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE})
    time.sleep(1.2)
    data = check_response(client.get(STATUS), STATUS)
    [worker] = data["workers"]
    assert worker["rss_bytes"] is worker["pss_bytes"] is worker["uss_bytes"] is None
    assert data["memory"] == {
        "rss_bytes": None,
        "pss_bytes": None,
        "uss_bytes": None,
        "limit_bytes": None,
        "limit_used_bytes": None,
        "source": None,
    }
    assert {
        "workers.rss_bytes",
        "workers.pss_bytes",
        "workers.uss_bytes",
        "memory.rss_bytes",
        "memory.pss_bytes",
        "memory.uss_bytes",
        "memory.limit_bytes",
        "memory.limit_used_bytes",
        "cpu.quota_cores",
        "requests.connections_waiting",
        "requests.searches_queued",
    } == set(data["unavailable"])
    # A worker measures its own CPU without /proc (os.times); the requests are counted as ever.
    assert worker["cpu_seconds"] > 0 and worker["cpu_share"] is not None
    assert data["requests"]["total"] == 1


def test_connections_waiting_is_the_kernels_listen_queue() -> None:
    """The connections a listening socket holds, not yet taken, as the kernel counts them; ``None`` without one."""
    assert connections_waiting([]) is None
    with socket.socket() as listening:
        listening.bind(("127.0.0.1", 0))
        listening.listen(16)
        assert connections_waiting([listening]) == 0
        clients = [socket.create_connection(listening.getsockname()) for _ in range(3)]
        try:
            deadline = time.monotonic() + 5
            while connections_waiting([listening]) != 3 and time.monotonic() < deadline:
                time.sleep(0.01)
            assert connections_waiting([listening]) == 3
            taken, _ = listening.accept()
            taken.close()
            assert connections_waiting([listening]) == 2
        finally:
            for client in clients:
                client.close()


# ------------------------------------------------------------------------------------------------------------------
# The readers, on folders laid out as Linux lays them out


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="ascii")


SMAPS_ROLLUP = """562477460000-7ffe14e67000 ---p 00000000 00:00 0                          [rollup]
Rss:              300000 kB
Pss:              120000 kB
Pss_Anon:          20000 kB
Shared_Clean:     250000 kB
Shared_Dirty:          0 kB
Private_Clean:      1000 kB
Private_Dirty:     49000 kB
Private_Hugetlb:       0 kB
Swap:                  0 kB
"""


@pytest.fixture
def system(tmp_path: Path) -> SystemReader:
    """A ``/proc`` and a cgroup v2 tree: process 4242 (a command with a space and a parenthesis), two limits."""
    proc, cgroup = tmp_path / "proc", tmp_path / "cgroup"
    write(proc / "self" / "cgroup", "0::/machine.slice/job_1/task_0\n")
    # pid (comm) state ppid ... utime(14) stime(15) ... starttime(22)
    fields = ["S", "1", *["0"] * 9, "250", "150", *["0"] * 6, "987654", "0"]
    write(proc / "4242" / "stat", "4242 (idtrack web) x) " + " ".join(fields) + "\n")
    write(proc / "4242" / "smaps_rollup", SMAPS_ROLLUP)
    write(proc / "4343" / "stat", "4343 (gone) " + " ".join(["Z", *fields[1:]]) + "\n")
    write(proc / "4444" / "statm", "1000 200 50 1 0 100 0\n")
    write(proc / "meminfo", "MemTotal:       16000000 kB\nMemFree:  1000 kB\nMemAvailable:   12000000 kB\n")
    write(cgroup / "machine.slice" / "job_1" / "task_0" / "cpu.max", "max 100000\n")
    write(cgroup / "machine.slice" / "job_1" / "task_0" / "memory.max", "max\n")
    write(cgroup / "machine.slice" / "job_1" / "task_0" / "memory.current", "500\n")
    write(cgroup / "machine.slice" / "job_1" / "cpu.max", "150000 100000\n")
    write(cgroup / "machine.slice" / "job_1" / "memory.max", "8589934592\n")
    write(cgroup / "machine.slice" / "job_1" / "memory.current", "3221225472\n")
    write(cgroup / "machine.slice" / "memory.max", "17179869184\n")
    write(cgroup / "machine.slice" / "memory.current", "9000000000\n")
    return SystemReader(proc=proc, cgroup=cgroup)


def test_process_readers(system: SystemReader) -> None:
    assert system.cpu_seconds(4242) == (250 + 150) / system.ticks
    assert system.start_ticks(4242) == 987654
    memory = system.memory(4242)
    assert memory is not None
    assert (memory.rss, memory.pss, memory.uss) == (300000 * 1024, 120000 * 1024, 50000 * 1024)
    only_rss = system.memory(4444)  # no smaps_rollup: RSS from statm, PSS and USS unknown
    assert only_rss is not None
    assert (only_rss.rss, only_rss.pss, only_rss.uss) == (200 * system.page, None, None)
    assert system.memory(9999) is None
    assert system.cpu_seconds(9999) is None


def test_alive_tells_dead_and_reused_pids(system: SystemReader) -> None:
    assert system.alive(4242, 987654)
    assert not system.alive(4242, 111)  # the pid now names another process
    assert not system.alive(4343, None)  # a zombie
    reader = SystemReader(proc=Path("/nonexistent/proc"), cgroup=Path("/nonexistent/cgroup"))
    assert reader.alive(os.getpid(), None)  # without /proc: a signal 0 asks the kernel


def test_cgroup_limits_take_the_tightest_ancestor(system: SystemReader) -> None:
    cpu = system.cpu_limit()
    assert cpu.quota_cores == 1.5
    affinity = len(os.sched_getaffinity(0))
    if affinity > 1.5:
        assert (cpu.cores, cpu.source) == (1.5, "cgroup")
    memory = system.memory_limit()
    assert memory is not None
    assert (memory.limit, memory.used, memory.source) == (8589934592, 3221225472, "cgroup")


def test_without_cgroup_limits_the_machine_counts(system: SystemReader) -> None:
    write(system.proc / "self" / "cgroup", "12:memory:/job\n11:cpu,cpuacct:/job\n")  # cgroup v1: not read
    assert system.cgroups() == []
    cpu = system.cpu_limit()
    assert (cpu.quota_cores, cpu.source, cpu.cores) == (None, "affinity", float(cpu.affinity_cores))
    memory = system.memory_limit()
    assert memory is not None
    assert (memory.limit, memory.used, memory.source) == (16000000 * 1024, 4000000 * 1024, "meminfo")


def test_a_container_root_cgroup_is_read(tmp_path: Path) -> None:
    """In a container the process's cgroup is ``/``, the namespace's root, whose files hold the container's limits."""
    proc, cgroup = tmp_path / "proc", tmp_path / "cgroup"
    write(proc / "self" / "cgroup", "0::/\n")
    write(cgroup / "cpu.max", "200000 100000\n")
    write(cgroup / "memory.max", "4294967296\n")
    write(cgroup / "memory.current", "1073741824\n")
    reader = SystemReader(proc=proc, cgroup=cgroup)
    assert reader.cpu_limit().quota_cores == 2.0
    limit = reader.memory_limit()
    assert limit is not None and (limit.limit, limit.used, limit.source) == (4294967296, 1073741824, "cgroup")


def test_a_row_of_a_dead_worker_is_not_reported_and_its_counts_stay() -> None:
    """A worker that ends leaves its row; a new worker takes it, and the server's totals keep the old counts."""
    monitor = LoadMonitor(workers=1)
    monitor.request_started()
    monitor.request_ended(0.01, 200)
    monitor.request_started()
    monitor.request_ended(0.02, 503)
    assert monitor.snapshot()["requests"]["total"] == 2
    monitor.detach()  # as a worker that stops
    data = monitor.snapshot()  # this process takes a row again: a new worker
    assert [w["requests"] for w in data["workers"]] == [0]
    assert (data["requests"]["total"], data["requests"]["errors_5xx"]) == (2, 1)
    # The latency ring of the old row went with it; the totals did not.
    assert data["requests"]["latency"]["count"] == 0


# ------------------------------------------------------------------------------------------------------------------
# Server-Timing


def test_server_timing_on_every_answer(make_client: Callable[..., TestClient]) -> None:
    client = make_client(rate_per_minute=60, rate_burst=8)
    answers = {
        "health": client.get(f"{P}/health"),
        "status": client.get(STATUS),
        "organisms": client.get(f"{P}/organisms"),
        "not_found": client.get(f"{P}/nothing"),
        "refused": client.get(f"{P}/organisms/pig/convert", params={"identifier": "X", "to_release": 1}),
        "convert": client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "explain": "true"}),
        "batch": client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": [GENE, "INS"]}),
        "names": client.get(f"{P}/organisms/pig/genes-named", params={"name": "INS"}),
    }
    while (limited := client.get(f"{P}/organisms")).status_code != 429:
        pass
    answers["rate_limited"] = limited
    for name, response in answers.items():
        timing = server_timing(response.headers["server-timing"])
        assert "app" in timing, name
        # idtrack refuses an unknown release on the search thread: that request searched too.
        searched = name in {"convert", "batch", "names", "refused"}
        # An answer written on the search thread adds its writing (`write`); a refusal there has none to write.
        expected = {"app", "queue", "search"} | ({"write"} if name in {"convert", "batch", "names"} else set())
        assert set(timing) == (expected if searched else {"app"}), name
        if searched:
            assert timing["search"] > 0
            assert timing["queue"] + timing["search"] + timing.get("write", 0.0) <= timing["app"] + 0.01


def test_server_timing_is_exposed_to_other_origins(make_client: Callable[..., TestClient]) -> None:
    client = make_client(rate_per_minute=0, cors_origins=("http://localhost:5173",))
    response = client.get(f"{P}/health", headers={"Origin": "http://localhost:5173"})
    exposed = {h.strip().lower() for h in response.headers["access-control-expose-headers"].split(",")}
    assert "server-timing" in exposed
