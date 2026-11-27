"""Bounds on what one client and one worker take: allowances per client, and one search at a time per worker.

**Per client** (its address, as the trusted reverse proxy reports it; an IPv6 address by its ``/64`` network, the
block one host normally holds, so that a host cannot take a fresh allowance by changing the last 64 bits): three
token buckets, kept in shared memory that is made before the workers are forked, so that each holds for the server as
a whole, not per worker:

- **searches**: every request that searches (a conversion, a batch, a name) takes one token; ``rate_per_minute``
  tokens come back per minute, and a bucket holds at most ``rate_burst``;
- **reads**: every other request of the api (the tables and documents answered from memory, and any answer served
  from the answer cache) takes one token of a bucket ten times as large and as fast (:py:data:`READ_SHARE`), so that a
  page's own reads never use up its searches, while a flood of them is still bounded;
- **search time**: the seconds a client's searches took (the search, and the writing and compressing of its answer)
  are charged when the answer is written, and a client whose balance is below zero waits until it is back to zero;
  ``search_seconds_per_minute`` seconds come back per minute, and a balance holds at most ``search_seconds_burst``. A
  request then bounds the *work* a client makes the server do, not only the number of its requests: a batch of 1,000
  identifiers counts as the seconds it took;
- **searches at once**: a client has at most ``concurrent_searches`` searching requests in progress at a time (from
  their admission until their answer is sent), so that a burst cannot occupy every worker before any of its time is
  charged, nor hold more than that many answers that its client is slow to take.

``rate_per_minute`` of 0 turns every per-client allowance off. Clients are hashed (with a key drawn at start) into a
fixed table of buckets; two clients that share a bucket share its tokens, which with the default 65,536 buckets is rare
and errs on the side of limiting.

**Per worker**: searches are CPU-bound and hold the interpreter lock (threads add no throughput), so each worker runs
one at a time on a thread beside its event loop (which keeps answering health checks and refusals meanwhile), with a
bounded queue.
"""

from __future__ import annotations

import hashlib
import ipaddress
import math
import multiprocessing
import os
import time
from typing import Any, Literal

import anyio

#: The reads' bucket is this many times as large, and refills this many times as fast, as the searches' bucket.
READ_SHARE = 10
#: The key of every client whose address cannot be read as an IP address (one shared allowance).
UNREADABLE_CLIENT = "unreadable"

Kind = Literal["search", "read"]

#: A client's count of searches in progress is forgotten when it has not changed for this long (it then counts as none):
#: a worker that was killed cannot end the searches it held, and every search ends well within this time.
CONCURRENT_EXPIRY_SECONDS = 900.0

# Per bucket of the table: the searches' tokens and when they were counted, the reads' tokens and when, the balance of
# search seconds and when, the searches in progress and when that count changed (a time of 0: never used).
_FIELDS = 8
_SEARCH, _READ, _WORK, _RUNNING = 0, 2, 4, 6


def client_key(host: str | None) -> str:
    """Return the key a client's allowance is kept under: its IPv4 address, or its IPv6 address's ``/64`` network.

    Args:
        host: The client's address as the server received it (from the socket, or from ``X-Forwarded-For`` of a
            trusted proxy).

    Returns:
        str: The key; :py:data:`UNREADABLE_CLIENT` for a value that is no IP address.
    """
    text = (host or "").strip().strip("[]")
    try:
        address = ipaddress.ip_address(text.split("%", 1)[0])
    except ValueError:
        return UNREADABLE_CLIENT
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.IPv6Network((address, 64), strict=False))
    return str(address)


class RateLimiter:
    """The allowances of every client, shared by every process forked after it is made."""

    def __init__(
        self,
        per_minute: int,
        burst: int,
        search_seconds_per_minute: float = 0.0,
        search_seconds_burst: float = 0.0,
        slots: int = 65_536,
        concurrent_searches: int = 0,
    ) -> None:
        """Make the shared table.

        Args:
            per_minute: Searching requests per minute (0: no allowance of any kind is enforced).
            burst: The most searching requests a bucket holds (requests at once).
            search_seconds_per_minute: Seconds of search a client gets back per minute (0: search time not limited).
            search_seconds_burst: The most seconds of search a client's balance holds.
            slots: The number of buckets.
            concurrent_searches: The most searching requests a client may have in progress (0: not limited).
        """
        self.rate = per_minute / 60.0
        self.burst = float(burst)
        self.work_rate = search_seconds_per_minute / 60.0
        self.work_burst = float(search_seconds_burst)
        self.slots = slots
        self.enabled = per_minute > 0
        self.work_enabled = self.enabled and search_seconds_per_minute > 0 and search_seconds_burst > 0
        self.concurrent = concurrent_searches if self.enabled else 0
        context = multiprocessing.get_context("fork")
        self._table: Any = context.RawArray("d", _FIELDS * slots) if self.enabled else None
        self._lock: Any = context.Lock() if self.enabled else None
        self._key = os.urandom(16)

    def _slot(self, client: str) -> int:
        digest = hashlib.blake2b(client.encode("utf-8", "surrogatepass"), key=self._key, digest_size=8).digest()
        return _FIELDS * (int.from_bytes(digest, "little") % self.slots)

    def _bucket(self, kind: Kind) -> tuple[int, float, float]:
        if kind == "search":
            return _SEARCH, self.rate, self.burst
        return _READ, self.rate * READ_SHARE, self.burst * READ_SHARE

    def take(self, client: str, kind: Kind = "search", now: float | None = None) -> float | None:
        """Take one token of a client's bucket of searches or of reads.

        Args:
            client: The client's key (:py:func:`client_key`).
            kind: ``search`` or ``read``.
            now: The time (``time.monotonic()``; for tests).

        Returns:
            float | None: ``None`` when the request may go on; otherwise the seconds until a token is available.
        """
        if not self.enabled:
            return None
        at = time.monotonic() if now is None else now
        field, rate, burst = self._bucket(kind)
        i = self._slot(client) + field
        with self._lock:
            tokens, then = self._table[i], self._table[i + 1]
            tokens = burst if then == 0.0 else min(burst, tokens + (at - then) * rate)
            if tokens >= 1.0:
                self._table[i], self._table[i + 1] = tokens - 1.0, at
                return None
            self._table[i], self._table[i + 1] = tokens, at
            return (1.0 - tokens) / rate

    def give_back(self, client: str, kind: Kind = "search", now: float | None = None) -> None:
        """Give a token back to a client's bucket (a searching request that turned out to need no search).

        Args:
            client: The client's key.
            kind: ``search`` or ``read``.
            now: The time (for tests).
        """
        if not self.enabled:
            return
        at = time.monotonic() if now is None else now
        field, rate, burst = self._bucket(kind)
        i = self._slot(client) + field
        with self._lock:
            tokens, then = self._table[i], self._table[i + 1]
            tokens = burst if then == 0.0 else min(burst, tokens + (at - then) * rate)
            self._table[i], self._table[i + 1] = min(burst, tokens + 1.0), at

    def remaining(self, client: str, kind: Kind = "search", now: float | None = None) -> tuple[int, float] | None:
        """Return the whole tokens left in a client's bucket and the seconds until it is full again (no token taken).

        Args:
            client: The client's key.
            kind: ``search`` or ``read``.
            now: The time (for tests).

        Returns:
            tuple[int, float] | None: ``(tokens, seconds)``; ``None`` when allowances are off.
        """
        if not self.enabled:
            return None
        at = time.monotonic() if now is None else now
        field, rate, burst = self._bucket(kind)
        i = self._slot(client) + field
        with self._lock:
            tokens, then = self._table[i], self._table[i + 1]
        tokens = burst if then == 0.0 else min(burst, tokens + (at - then) * rate)
        return int(tokens), (burst - tokens) / rate

    def search_wait(self, client: str, now: float | None = None) -> float | None:
        """Return the seconds until a client's balance of search time is back to zero, or ``None`` if it is not below.

        Args:
            client: The client's key.
            now: The time (for tests).

        Returns:
            float | None: The wait; ``None`` when the client may search.
        """
        if not self.work_enabled:
            return None
        at = time.monotonic() if now is None else now
        i = self._slot(client) + _WORK
        with self._lock:
            balance, then = self._table[i], self._table[i + 1]
        balance = self.work_burst if then == 0.0 else min(self.work_burst, balance + (at - then) * self.work_rate)
        return None if balance >= 0.0 else -balance / self.work_rate

    def charge_search(self, client: str, seconds: float, now: float | None = None) -> None:
        """Charge the seconds a client's search took to its balance of search time.

        Args:
            client: The client's key.
            seconds: The search's own time.
            now: The time (for tests).
        """
        if not self.work_enabled or seconds <= 0:
            return
        at = time.monotonic() if now is None else now
        i = self._slot(client) + _WORK
        with self._lock:
            balance, then = self._table[i], self._table[i + 1]
            balance = self.work_burst if then == 0.0 else min(self.work_burst, balance + (at - then) * self.work_rate)
            self._table[i], self._table[i + 1] = balance - seconds, at

    def search_balance(self, client: str, now: float | None = None) -> tuple[float, float] | None:
        """Return a client's balance of search seconds and the seconds until it is full again.

        Args:
            client: The client's key.
            now: The time (for tests).

        Returns:
            tuple[float, float] | None: ``(balance, seconds)``; ``None`` when search time is not limited.
        """
        if not self.work_enabled:
            return None
        at = time.monotonic() if now is None else now
        i = self._slot(client) + _WORK
        with self._lock:
            balance, then = self._table[i], self._table[i + 1]
        balance = self.work_burst if then == 0.0 else min(self.work_burst, balance + (at - then) * self.work_rate)
        return balance, (self.work_burst - balance) / self.work_rate

    def enter_search(self, client: str, now: float | None = None) -> bool:
        """Count a searching request of a client as in progress, if it may have one more.

        Args:
            client: The client's key.
            now: The time (for tests).

        Returns:
            bool: ``False`` when the client already has ``concurrent_searches`` in progress (nothing is counted).
        """
        if not self.concurrent:
            return True
        at = time.monotonic() if now is None else now
        i = self._slot(client) + _RUNNING
        with self._lock:
            running, then = self._table[i], self._table[i + 1]
            if then == 0.0 or at - then > CONCURRENT_EXPIRY_SECONDS:
                running = 0.0
            if running >= self.concurrent:
                return False
            self._table[i], self._table[i + 1] = running + 1.0, at
        return True

    def leave_search(self, client: str, now: float | None = None) -> None:
        """End a searching request counted by :py:meth:`enter_search`.

        Args:
            client: The client's key.
            now: The time (for tests).
        """
        if not self.concurrent:
            return
        at = time.monotonic() if now is None else now
        i = self._slot(client) + _RUNNING
        with self._lock:
            self._table[i], self._table[i + 1] = max(0.0, self._table[i] - 1.0), at

    @staticmethod
    def retry_after(seconds: float) -> str:
        """Return a ``Retry-After`` value (whole seconds, at least 1).

        Args:
            seconds: The wait.

        Returns:
            str: The header value.
        """
        return str(max(1, math.ceil(seconds)))


class SearchSlot:
    """One search at a time in this worker, with a bounded number of requests waiting for it."""

    def __init__(self, queue_max: int) -> None:
        """Set the bound.

        Args:
            queue_max: The most requests that may wait for the slot.
        """
        self.queue_max = queue_max
        self.waiting = 0
        self._limiter: anyio.CapacityLimiter | None = None

    def reset(self) -> None:
        """Forget the limiter, so that the next use makes one in the running event loop (a worker's, after the fork)."""
        self._limiter = None
        self.waiting = 0

    @property
    def limiter(self) -> anyio.CapacityLimiter:
        """The limiter of the running event loop's worker (made on first use, after the fork)."""
        if self._limiter is None:
            self._limiter = anyio.CapacityLimiter(1)
        return self._limiter
