"""Bounds on what one client and one worker take: a rate limit per client, and one search at a time per worker.

The rate limit is a token bucket per client (its address, as the trusted reverse proxy reports it) kept in shared
memory that is made before the workers are forked, so the limit holds for the server as a whole, not per worker.
Clients are hashed (with a key drawn at start) into a fixed table of buckets; two clients that share a bucket share
its tokens, which with the default 65,536 buckets is rare and errs on the side of limiting.

Searches are CPU-bound and hold the interpreter lock (threads add no throughput), so each worker runs one at a time
on a thread beside its event loop (which keeps answering health checks and refusals meanwhile), with a bounded queue.
"""

from __future__ import annotations

import hashlib
import math
import multiprocessing
import os
import time
from typing import Any

import anyio


class RateLimiter:
    """A token bucket per client, shared by every process forked after it is made."""

    def __init__(self, per_minute: int, burst: int, slots: int = 65_536) -> None:
        """Make the shared table.

        Args:
            per_minute: Tokens added per minute (0: no limit).
            burst: The most tokens a bucket holds (requests at once).
            slots: The number of buckets.
        """
        self.rate = per_minute / 60.0
        self.burst = float(burst)
        self.slots = slots
        self.enabled = per_minute > 0
        context = multiprocessing.get_context("fork")
        # Per bucket: tokens, and the time they were counted (0: never used).
        self._table: Any = context.RawArray("d", 2 * slots) if self.enabled else None
        self._lock: Any = context.Lock() if self.enabled else None
        self._key = os.urandom(16)

    def _slot(self, client: str) -> int:
        digest = hashlib.blake2b(client.encode("utf-8", "surrogatepass"), key=self._key, digest_size=8).digest()
        return int.from_bytes(digest, "little") % self.slots

    def take(self, client: str, now: float | None = None) -> float | None:
        """Take one token of a client's bucket.

        Args:
            client: The client's key (its address).
            now: The time (``time.monotonic()``; for tests).

        Returns:
            float | None: ``None`` when the request may go on; otherwise the seconds until a token is available.
        """
        if not self.enabled:
            return None
        at = time.monotonic() if now is None else now
        i = 2 * self._slot(client)
        with self._lock:
            tokens, then = self._table[i], self._table[i + 1]
            tokens = self.burst if then == 0.0 else min(self.burst, tokens + (at - then) * self.rate)
            if tokens >= 1.0:
                self._table[i], self._table[i + 1] = tokens - 1.0, at
                return None
            self._table[i], self._table[i + 1] = tokens, at
            return (1.0 - tokens) / self.rate

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
