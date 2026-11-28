"""The process model: one master that holds the loaded graphs, forking worker processes that serve them.

Gunicorn with uvicorn's worker: ``preload_app`` makes the master hold the application (and with it every graph,
loaded once) before it forks the workers, so no worker loads a graph and every worker starts with them. Each worker
runs one search at a time (:py:class:`idtrack_web_api.limits.SearchSlot`): searches are CPU-bound, and threads add
no throughput (idtrack's measurements), so the server scales with workers.

**Every worker takes every connection; a search goes to a worker that holds none.** The workers share one listening
socket, and each takes connections from it at all times. A worker reads the request line of each connection it takes
without consuming it (``MSG_PEEK``) and routes it by its method and path (:py:func:`idtrack_web_api.guard.is_search`):

- a request that does not search (a health check, ``/status``, a table answered from memory, a file of the page, a
  refusal) is answered by the worker that took it, at once, beside any search the worker runs: such answers never
  wait behind a search;
- a search is kept by the worker that took it when that worker holds no other search; otherwise the worker hands the
  connection on, unread, through a queue shared by the workers (:py:class:`HandOff`: a socket pair made before the
  fork, the connection passed as a file descriptor), from which the first worker that holds no search takes it, in
  the order the searches arrived. A worker holds a search from the moment its whole request has arrived (its head,
  and the body of a ``POST``: a body still on its way holds no search, so a client that sends it slowly delays its own
  request only) until the search's answer is written (not until a slow client has read it). A search is answered
  ``503 server_busy`` with ``Retry-After`` rather than queued when the queue holds as many searches as it may
  (``queue_max`` times the workers), or when its wait, estimated from the searches waiting before it and the recent
  searches' mean time (``search_seconds`` before any search was measured), would pass ``queue_seconds``; a search
  that waited ``queue_seconds`` for a worker anyway is answered so without being searched
  (:py:mod:`idtrack_web_api.app`).

So a search waits only for the first worker that is free of searches, never behind another search in a worker that
took it (but for one whose body completed in that worker while it waited), and a health check waits for nothing but
the interpreter lock. When the server stops (``SIGTERM``), every search still in the queue is answered
``503 server_busy`` with ``Retry-After`` (by a worker as it stops, and by the master as it exits), never dropped.

A taken connection must send its request's line within ``head_seconds`` (5 s by default), and its whole head within
that time of its connection being made, or it is closed: a connection that sends nothing (a browser's speculative
preconnect, a stalled client) holds no worker.
Every answer closes its connection (``Connection: close``), so each request is routed afresh and no client is bound to
one worker. An answer that its client stops taking is bounded too (:py:mod:`idtrack_web_api.guard`, the send's
deadlines): this module gives the outer layer the connection to close (:py:data:`idtrack_web_api.guard.CONNECTION`).
"""

from __future__ import annotations

import array
import asyncio
import contextlib
import logging
import math
import multiprocessing
import socket
import struct
import sys
import time
import uuid
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

from gunicorn.app.base import BaseApplication
from gunicorn.arbiter import Arbiter
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from uvicorn.protocols.http.h11_impl import H11Protocol
from uvicorn.server import Server
from uvicorn_worker import UvicornWorker

from idtrack_web_api.errors import ApiError, error_json
from idtrack_web_api.guard import API_POLICY, CONNECTION, URI_MAX_BYTES, is_search
from idtrack_web_api.limits import NO_PLACE, Admission, client_key

if TYPE_CHECKING:
    from collections.abc import Callable

    from starlette.types import ASGIApp, Message, Receive, Scope, Send
    from uvicorn.config import Config

    from idtrack_web_api.config import Settings

log = logging.getLogger("idtrack_web_api")

#: The longest request head (request line and headers) the worker reads: a head up to this is answered, a longer
#: query with ``414 uri_too_long`` (the api's bound is :py:data:`idtrack_web_api.guard.URI_MAX_BYTES`); a head longer
#: still is refused by the HTTP parser itself, with the api's ``414 uri_too_long`` in JSON as well.
HEAD_MAX_BYTES = 65_536
#: The bytes of a request a worker peeks at to route it: a search's method and path fit in far fewer (a search path is
#: under 200 characters); a request whose path is not complete within them is no search and is answered where it is.
PEEK_BYTES = 1024
#: Connections a worker takes from the listening socket at one wake-up.
TAKE_AT_ONCE = 16

#: What a hand-off carries beside the connection: when it was taken, and its place among its client's searches.
_PAYLOAD = struct.Struct("dqq")
#: The longest client key a hand-off carries (an IPv6 network is under 50 characters).
_KEY_BYTES = 128
#: The most bytes of a request read and dropped before a refusal is written to its connection (so that closing it does
#: not reset the connection before its client reads the refusal).
_DROP_MAX_BYTES = 2_097_152
#: The seconds a client is told to wait (``Retry-After``) when the server stops with its search in the queue.
RESTART_RETRY_SECONDS = 5


class HandOff:
    """The queue of searches a worker took while it held another: shared by the workers, taken in arrival order.

    A pair of connected Unix sockets of datagrams in order (``SOCK_SEQPACKET``), made before the fork so that every
    process holds both ends: a worker sends a connection's file descriptor (``SCM_RIGHTS``) and the time it was taken
    into one end, and the kernel gives each message to exactly one worker that reads the other end. The count of
    waiting searches is kept in shared memory, and bounded.
    """

    def __init__(self, capacity: int) -> None:
        """Make the queue (in the master, before the fork).

        Args:
            capacity: The most searches that may wait in it.
        """
        self.capacity = capacity
        self.receiving, self.sending = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        for end in (self.receiving, self.sending):
            end.settimeout(0.0)
        context = multiprocessing.get_context("fork")
        self._waiting: Any = context.RawValue("i", 0)
        self._lock: Any = context.Lock()

    @property
    def waiting(self) -> int:
        """The searches waiting in the queue."""
        return max(0, int(self._waiting.value))

    def put(self, connection: socket.socket, taken_at: float, admitted: Admission | None = None) -> bool:
        """Put a connection in the queue (the caller then closes its own descriptor of it).

        Args:
            connection: The connection, its request unread.
            taken_at: When a worker took it (``time.monotonic()``: one clock for every process of the machine).
            admitted: The admission of the search by its client's allowances (its place among the client's searches
                in progress goes with the connection).

        Returns:
            bool: ``False`` when the queue is full (or the kernel refused): the caller answers the request itself.
        """
        with self._lock:
            if self._waiting.value >= self.capacity:
                return False
            self._waiting.value += 1
        try:
            fds = array.array("i", [connection.fileno()])
            row, generation = NO_PLACE if admitted is None else admitted.place
            client = "" if admitted is None else admitted.client
            payload = _PAYLOAD.pack(taken_at, row, generation) + client.encode("utf-8")[:_KEY_BYTES]
            self.sending.sendmsg([payload], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, fds.tobytes())])
        except OSError as error:
            log.warning("Cannot hand a search on: %s.", error)
            with self._lock:
                self._waiting.value -= 1
            return False
        return True

    def take(self) -> tuple[socket.socket, float, Admission | None] | None:
        """Take the search that has waited longest, if any.

        Returns:
            tuple[socket.socket, float, Admission | None] | None: The connection, when it was first taken, and its
            admission by its client's allowances.
        """
        try:
            data, ancillary, _, _ = self.receiving.recvmsg(
                _PAYLOAD.size + _KEY_BYTES, socket.CMSG_SPACE(array.array("i").itemsize)
            )
        except (BlockingIOError, InterruptedError):
            return None
        with self._lock:
            self._waiting.value = max(0, self._waiting.value - 1)
        fds = array.array("i")
        for level, kind, payload in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                fds.frombytes(payload[: len(payload) - len(payload) % fds.itemsize])
        if not fds:
            return None
        for extra in fds[1:]:
            socket.socket(fileno=extra).close()
        taken_at, row, generation = (
            _PAYLOAD.unpack(data[: _PAYLOAD.size]) if len(data) >= _PAYLOAD.size else (time.monotonic(), *NO_PLACE)
        )
        client = data[_PAYLOAD.size :].decode("utf-8", "replace")
        admitted = Admission(client, (int(row), int(generation))) if client else None
        return socket.socket(fileno=fds[0]), taken_at, admitted

    def drain(self, answer: Callable[[socket.socket, Admission | None], None]) -> int:
        """Take every search still in the queue and answer each (the server is stopping).

        Args:
            answer: What answers one connection (and gives its admission back).

        Returns:
            int: The searches answered.
        """
        answered = 0
        while (taken := self.take()) is not None:
            conn, _, admitted = taken
            answer(conn, admitted)
            answered += 1
        return answered


def request_whole(data: bytes) -> bool:
    """Return whether the first bytes of a request hold all of it: its head and, for a body, all its bytes.

    Args:
        data: The request's bytes that have arrived (peeked).

    Returns:
        bool: ``False`` while the head is incomplete, for a body whose length is not given (chunked), and for one not
        all arrived.
    """
    end = data.find(b"\r\n\r\n")
    if end < 0:
        return False
    length: bytes | None = None
    for line in data[:end].split(b"\r\n")[1:]:
        name, _, value = line.partition(b":")
        key = name.strip().lower()
        if key == b"transfer-encoding":
            return False
        if key == b"content-length":
            length = value.strip()
    if length is None:
        return True
    return length.isdigit() and len(data) - (end + 4) >= int(length)


_REASONS = {400: b"Bad Request", 414: b"URI Too Long", 503: b"Service Unavailable"}


def raw_answer(error: ApiError, request_id: str) -> bytes:
    """Return the bytes of a refusal written straight to a connection (no application in between): the api's JSON.

    Args:
        error: The refusal.
        request_id: Its request's id.

    Returns:
        bytes: The status line, the headers (the api's policy, no caching, ``Retry-After`` where the error has one) and
        the body.
    """
    body = error_json(error, request_id)
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
        (b"connection", b"close"),
        (b"cache-control", b"no-store"),
        (b"x-request-id", request_id.encode()),
        (b"x-content-type-options", b"nosniff"),
        (b"content-security-policy", API_POLICY),
        *((k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in error.headers.items()),
    ]
    head = b"".join(name + b": " + value + b"\r\n" for name, value in headers)
    status = str(error.status).encode()
    return b"HTTP/1.1 " + status + b" " + _REASONS.get(error.status, b"Error") + b"\r\n" + head + b"\r\n" + body


def refuse_unread(conn: socket.socket, error: ApiError) -> None:
    """Answer a connection no worker will serve with a refusal written to its socket, then close it.

    What has arrived of the request is read and dropped first (at most :py:data:`_DROP_MAX_BYTES`), so that closing the
    connection does not reset it before its client has read the refusal.

    Args:
        conn: The connection, its request unread.
        error: The refusal.
    """
    request_id = uuid.uuid4().hex
    try:
        conn.settimeout(0.0)
        dropped = 0
        with contextlib.suppress(BlockingIOError, InterruptedError):
            while dropped < _DROP_MAX_BYTES and (chunk := conn.recv(65_536)):
                dropped += len(chunk)
        conn.settimeout(1.0)
        conn.sendall(raw_answer(error, request_id))
        conn.shutdown(socket.SHUT_WR)
    except OSError:
        pass
    finally:
        conn.close()
    log.info("A search no worker will serve: answered %d %s (request %s).", error.status, error.code, request_id)


def restarting() -> ApiError:
    """Return the refusal of a search the server cannot serve because it is stopping."""
    return ApiError(
        "server_busy",
        f"The server is stopping (to restart) before this search could begin; retry in {RESTART_RETRY_SECONDS} s.",
        headers={"Retry-After": str(RESTART_RETRY_SECONDS)},
    )


def route_of(peeked: bytes) -> tuple[str, str] | None:
    """Return the method and the path (percent-decoded, without the query) of a request's first bytes.

    Args:
        peeked: The first bytes of the request, as far as they have arrived.

    Returns:
        tuple[str, str] | None: ``None`` while the method and the path are not yet complete.
    """
    method, space, rest = peeked.partition(b" ")
    if not space:
        return None
    for end, byte in enumerate(rest):
        if byte in b" ?\r\n":
            # As the HTTP parser reads it (uvicorn: ASCII, then percent-decoded with replacement characters).
            return method.decode("latin-1"), unquote(rest[:end].decode("latin-1"))
    return None


class _Connection(asyncio.Protocol):
    """Uvicorn's protocol of one connection, wrapped: its head's deadline, its search, and its closing.

    The outer layer reaches it through :py:data:`idtrack_web_api.guard.CONNECTION`: when it was first taken and how
    long it waited for a worker free of searches, a refusal decided before its request was read (its client's
    allowances, a full queue), the admission of its search by its client's allowances (given back once, when the
    request ends or the connection closes), the moment its whole request has arrived (from then on its search counts
    in its worker), the end of its search, and closing it at once (an answer its client stopped taking).
    """

    def __init__(
        self,
        protocol: asyncio.Protocol,
        head_seconds: float,
        taken_at: float,
        refusal: ApiError | None = None,
        search: tuple[Callable[[], None], Callable[[], None]] | None = None,
        waited: float = 0.0,
        admitted: Admission | None = None,
        leave: Callable[[Admission], None] | None = None,
    ) -> None:
        self.protocol = protocol
        self.head_seconds = head_seconds
        self.taken_at = taken_at
        self.waited = waited
        self.refusal = refusal
        self.admitted = admitted
        self._leave = leave
        self._search_began: Callable[[], None] | None = None if search is None else search[0]
        self._search_ended: Callable[[], None] | None = None if search is None else search[1]
        self._counted = False
        self.transport: asyncio.Transport | None = None
        self.timer: asyncio.TimerHandle | None = None

    def request_arrived(self) -> None:
        """Count this connection's search in its worker: its whole request has arrived (once)."""
        began, self._search_began = self._search_began, None
        if began is not None:
            began()
            self._counted = True

    def release_search(self) -> None:
        """Count the search of this connection as ended in its worker (once; also when the connection closes)."""
        self._search_began = None  # a request that ends before all of it arrived never counts
        ended, self._search_ended = self._search_ended, None
        if ended is not None and self._counted:
            ended()

    def release_admission(self) -> None:
        """Give back the place of this connection's search among its client's searches in progress (once)."""
        admitted, self.admitted = self.admitted, None
        if admitted is not None and self._leave is not None:
            self._leave(admitted)

    def abort(self) -> None:
        """Close the connection at once, dropping what its client has not taken."""
        if self.transport is not None:
            self.transport.abort()

    def _head_arrived(self) -> bool:
        return getattr(self.protocol, "cycle", None) is not None

    def _expire(self) -> None:
        self.timer = None
        if not self._head_arrived() and self.transport is not None:
            log.debug("A connection sent no request head within %.1f s; closed.", self.head_seconds)
            self.transport.close()

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]
        # From when a worker took it, or, for a search that waited in the queue (its request line already there),
        # from now: the wait for a worker is not the client's delay.
        since = self.taken_at + self.waited
        remaining = since + self.head_seconds - time.monotonic()
        self.timer = asyncio.get_running_loop().call_later(max(0.0, remaining), self._expire)
        self.protocol.connection_made(transport)

    def data_received(self, data: bytes) -> None:
        token = CONNECTION.set(self)  # the request's task, made in this call, keeps it in its context
        try:
            self.protocol.data_received(data)
        finally:
            CONNECTION.reset(token)

    def eof_received(self) -> bool | None:
        return self.protocol.eof_received()

    def pause_writing(self) -> None:
        self.protocol.pause_writing()

    def resume_writing(self) -> None:
        self.protocol.resume_writing()

    def connection_lost(self, exc: Exception | None) -> None:
        try:
            self.protocol.connection_lost(exc)
        finally:
            if self.timer is not None:
                self.timer.cancel()
                self.timer = None
            self.release_search()
            self.release_admission()


class _Taker:
    """Takes this worker's connections: every one from the listening sockets, searches from the hand-off queue."""

    def __init__(
        self,
        sockets: list[socket.socket],
        protocol_factory: Callable[[], asyncio.Protocol],
        config: Config,
        handoff: HandOff | None,
        head_seconds: float = 5.0,
        gate: Any = None,
    ) -> None:
        self.sockets = sockets
        self.protocol_factory = protocol_factory
        self.config = config
        self.handoff = handoff
        self.head_seconds = head_seconds
        #: The outer layer, which admits a search by its client's allowances (``admit_search``, ``leave_search``).
        self.gate = gate
        self.proxies = ProxyHeadersMiddleware(_nothing, config.forwarded_allow_ips or "127.0.0.1")
        self.loop = asyncio.get_running_loop()
        self.stopped = True
        self.searches = 0
        self.taking_handoff = False
        self.paused_until = 0.0
        self.pause_timer: asyncio.TimerHandle | None = None
        self.tasks: set[asyncio.Task[None]] = set()

    # -- what it listens to --------------------------------------------------------------------------------------

    def start(self) -> None:
        for sock in self.sockets:
            sock.settimeout(0.0)
        self.stopped = False
        self._listen(on=True)
        self._update_handoff()

    def stop(self) -> None:
        self.stopped = True
        self._listen(on=False)
        self._update_handoff()
        if self.pause_timer is not None:
            self.pause_timer.cancel()
        if self.handoff is not None:
            answered = self.handoff.drain(self.refuse_stopping)
            if answered:
                log.info("Stopping: %d searches still in the queue answered 503 server_busy.", answered)

    def refuse_stopping(self, conn: socket.socket, admitted: Admission | None) -> None:
        """Answer a search that the stopping server will not serve: 503, its token and place given back."""
        if admitted is not None and self.gate is not None:
            self.gate.limiter.give_back(admitted.client, "search")
            self.gate.limiter.leave_search(admitted.place)
        refuse_unread(conn, restarting())

    def _listen(self, *, on: bool) -> None:
        for sock in self.sockets:
            if on:
                self.loop.add_reader(sock.fileno(), self._accept, sock)
            else:
                self.loop.remove_reader(sock.fileno())

    def _update_handoff(self) -> None:
        """Read the hand-off queue while this worker holds no search (and is running)."""
        if self.handoff is None:
            return
        wanted = self.searches == 0 and not self.stopped
        if wanted == self.taking_handoff:
            return
        self.taking_handoff = wanted
        if wanted:
            self.loop.add_reader(self.handoff.receiving.fileno(), self._take_handoff)
        else:
            self.loop.remove_reader(self.handoff.receiving.fileno())

    # -- taking --------------------------------------------------------------------------------------------------

    def _accept(self, sock: socket.socket) -> None:
        for _ in range(TAKE_AT_ONCE):
            try:
                conn, _ = sock.accept()
            except (BlockingIOError, InterruptedError):
                return
            except ConnectionAbortedError:
                continue  # closed by its client while it waited
            except OSError as error:
                # Out of file descriptors or memory: wait a second (the socket stays readable, so listening would spin).
                log.warning("Cannot take a connection: %s; waiting a second.", error)
                self._listen(on=False)
                self.pause_timer = self.loop.call_later(1.0, self._resume)
                return
            conn.settimeout(0.0)
            self._spawn(self._route(conn, time.monotonic()))

    def _resume(self) -> None:
        self.pause_timer = None
        if not self.stopped:
            self._listen(on=True)

    def _take_handoff(self) -> None:
        if self.handoff is None or self.searches > 0 or self.stopped:
            return
        taken = self.handoff.take()
        if taken is not None:
            conn, taken_at, admitted = taken
            conn.settimeout(0.0)
            if admitted is not None and self.gate is not None:
                self.gate.limiter.hold(admitted.place)  # this worker holds its place now
            try:
                whole = request_whole(conn.recv(HEAD_MAX_BYTES, socket.MSG_PEEK))
            except OSError:
                whole = False
            waited = max(0.0, time.monotonic() - taken_at)
            self._serve(conn, taken_at, search=True, waited=waited, admitted=admitted, whole=whole)

    def _spawn(self, coroutine: Any) -> None:
        task = self.loop.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def _peek(
        self, conn: socket.socket, deadline: float, enough: Callable[[bytes], bool], most: int
    ) -> bytes | None:
        """Return the request's first bytes, unconsumed, once *enough* holds of them (``None``: closed)."""
        delay = 0.002
        while True:
            try:
                data: bytes | None = conn.recv(most, socket.MSG_PEEK)
            except (BlockingIOError, InterruptedError):
                data = None
            except OSError:
                return None
            if data == b"":
                return None
            if data is not None and (enough(data) or len(data) >= most):
                return data
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return data or b""
            if data is None:  # nothing yet: wait until something arrives
                arrived = self.loop.create_future()
                self.loop.add_reader(conn.fileno(), _settle, arrived)
                try:
                    await asyncio.wait_for(arrived, remaining)
                except TimeoutError:
                    pass
                finally:
                    self.loop.remove_reader(conn.fileno())
            else:  # part of the line: it stays readable until read, so wait a moment instead
                await asyncio.sleep(min(delay, remaining))
                delay = min(2 * delay, 0.05)

    async def _client(self, conn: socket.socket, head: bytes) -> str:
        """Return the key of a request's client, as the outer layer will read it (the proxy's ``X-Forwarded-For``)."""
        try:
            peer = conn.getpeername()
        except OSError:
            peer = ("unknown", 0)
        headers = []
        for line in head.split(b"\r\n")[1:]:
            if not line:
                break
            name, _, value = line.partition(b":")
            headers.append((name.strip().lower(), value.strip()))
        scope: dict[str, Any] = {"type": "http", "client": (str(peer[0]), int(peer[1])), "headers": headers}
        await self.proxies(scope, _nothing_receive, _nothing_send)  # type: ignore[arg-type]
        return client_key(scope["client"][0])

    async def _route(self, conn: socket.socket, taken_at: float) -> None:  # noqa: PLR0911 - one exit per way
        if self.config.ssl is not None:  # encrypted: nothing to read before the handshake; served where taken
            self._serve(conn, taken_at)
            return
        deadline = taken_at + self.head_seconds
        peeked = await self._peek(conn, deadline, lambda data: route_of(data) is not None, PEEK_BYTES)
        if peeked is None:
            conn.close()
            return
        found = route_of(peeked)
        if found is None or not is_search(*found):
            if self.stopped:
                conn.close()
            else:
                self._serve(conn, taken_at)
            return
        if self.stopped:
            refuse_unread(conn, restarting())
            return
        # The head, and as much of the body as has arrived (a search counts in its worker once all of it is there).
        head = await self._peek(conn, deadline, lambda data: b"\r\n\r\n" in data, HEAD_MAX_BYTES)
        if head is None or self.stopped:
            conn.close()
            return
        whole = request_whole(head)
        admitted: Admission | None = None
        if self.gate is not None:
            # A search is admitted by its client's allowances before it waits for a worker: a burst from one client
            # is refused at once, not queued ahead of everyone else's searches.
            client = await self._client(conn, head)
            decided = self.gate.admit_search(client)
            if isinstance(decided, ApiError):
                self._serve(conn, taken_at, refusal=decided)
                return
            admitted = decided
        if self.searches == 0:
            self._serve(conn, taken_at, search=True, admitted=admitted, whole=whole)
            return
        busy = self._busy()
        if busy is None and self.handoff is not None and self.handoff.put(conn, taken_at, admitted):
            conn.close()  # the queue holds the connection now
            return
        if admitted is not None and self.gate is not None:
            self.gate.limiter.give_back(admitted.client, "search")  # refused for the server's capacity
        self._serve(
            conn,
            taken_at,
            refusal=busy
            or ApiError(
                "server_busy",
                "Every worker is in a search and as many searches as the server queues already wait for one; retry "
                "in a few seconds.",
                headers={"Retry-After": "2"},
            ),
            admitted=admitted,
        )

    def _busy(self) -> ApiError | None:
        """Return the refusal of a search that would wait longer for a worker than a search may, by an estimate.

        Every worker holds a search; the estimate is the searches queued before it shared among the workers, plus the
        one each worker runs, each taking the recent searches' mean time; before any search has been measured (a
        server just started), each is taken to last ``search_seconds``, the longest one identifier's search may take,
        so that a burst that meets a server with no measure yet is refused at once rather than after waiting
        ``queue_seconds`` (``None``: within ``queue_seconds``).
        """
        if self.gate is None or self.handoff is None:
            return None
        settings = self.gate.settings
        mean = self.gate.monitor.mean_search_seconds() or settings.search_seconds
        estimate = mean * (self.handoff.waiting / max(1, settings.workers) + 1.0)
        if estimate <= settings.queue_seconds:
            return None
        wait = max(1, math.ceil(estimate - settings.queue_seconds))
        return ApiError(
            "server_busy",
            f"Every worker is in a search and {self.handoff.waiting} searches wait for one: this one would wait about "
            f"{estimate:.1f} s, more than the {settings.queue_seconds:g} s a search may wait for a worker "
            f"(`queue_seconds`); retry in {wait} s.",
            headers={"Retry-After": str(wait)},
        )

    def _serve(
        self,
        conn: socket.socket,
        taken_at: float,
        *,
        search: bool = False,
        refusal: ApiError | None = None,
        waited: float = 0.0,
        admitted: Admission | None = None,
        whole: bool = True,
    ) -> None:
        counting: tuple[Callable[[], None], Callable[[], None]] | None = None
        if search:
            counting = (self._search_began, self._search_ended)
        leave = None if self.gate is None else self._leave
        protocol = _Connection(
            self.protocol_factory(), self.head_seconds, taken_at, refusal, counting, waited, admitted, leave
        )
        if search and whole:
            protocol.request_arrived()
        self._spawn(self._connect(conn, protocol))

    def _leave(self, admitted: Admission) -> None:
        if self.gate is not None:
            self.gate.limiter.leave_search(admitted.place)

    def _search_began(self) -> None:
        self.searches += 1
        self._update_handoff()

    def _search_ended(self) -> None:
        self.searches -= 1
        self._update_handoff()
        if self.searches == 0:
            self._take_handoff()

    async def _connect(self, conn: socket.socket, protocol: _Connection) -> None:
        try:
            await self.loop.connect_accepted_socket(lambda: protocol, conn, ssl=self.config.ssl)
        except Exception:
            log.exception("Cannot serve a connection.")
            conn.close()
            protocol.release_search()
            protocol.release_admission()


def _settle(future: asyncio.Future[None]) -> None:
    if not future.done():
        future.set_result(None)


async def _nothing(scope: Any, receive: Any, send: Any) -> None:
    """An application that does nothing (what the proxy rule wraps to read a client's address)."""


async def _nothing_receive() -> Any:  # pragma: no cover - never called
    return {"type": "http.disconnect"}


async def _nothing_send(_message: Any) -> None:  # pragma: no cover - never called
    return None


class _BalancedServer(Server):
    """Uvicorn's server, with the connections taken by a :py:class:`_Taker` instead of asyncio's listener."""

    def __init__(self, config: Config, handoff: HandOff | None, head_seconds: float = 5.0, gate: Any = None) -> None:
        super().__init__(config)
        self.handoff = handoff
        self.head_seconds = head_seconds
        self.gate = gate
        self.taker: _Taker | None = None

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets=[])
        if not self.started:
            return
        config = self.config

        def protocol() -> asyncio.Protocol:
            made: asyncio.Protocol = config.http_protocol_class(  # type: ignore[call-arg]
                config=config, server_state=self.server_state, app_state=self.lifespan.state
            )
            return made

        self.taker = _Taker(list(sockets or []), protocol, config, self.handoff, self.head_seconds, self.gate)
        self.taker.start()

    async def shutdown(self, sockets: list[socket.socket] | None = None) -> None:
        if self.taker is not None:
            self.taker.stop()
        await super().shutdown(sockets=sockets)


class _Protocol(H11Protocol):
    """Uvicorn's HTTP/1.1 protocol, answering a request its parser refuses in the api's own words (JSON)."""

    def send_400_response(self, msg: str) -> None:
        request_id = uuid.uuid4().hex
        unread = len(self.conn.trailing_data[0])
        if unread >= HEAD_MAX_BYTES:
            error = ApiError(
                "uri_too_long",
                f"The request's head (its line and headers) is longer than the {HEAD_MAX_BYTES} bytes this server "
                f"reads (its path and query: at most {URI_MAX_BYTES}).",
            )
        else:
            error = ApiError(
                "invalid_request", "The request is not valid HTTP/1.1 (its line or a header cannot be read)."
            )
        self.transport.write(raw_answer(error, request_id))
        log.info("A request its parser refused (%s): answered %d %s.", msg, error.status, error.code)
        self.transport.close()


class Worker(UvicornWorker):  # type: ignore[misc]  # uvicorn-worker has no type hints
    """Uvicorn's gunicorn worker, serving through :py:class:`_BalancedServer`."""

    CONFIG_KWARGS: dict[str, Any] = {  # noqa: RUF012 - uvicorn-worker's own class attribute
        "loop": "auto",
        "http": _Protocol,
        "h11_max_incomplete_event_size": HEAD_MAX_BYTES,
        "server_header": False,
    }

    async def _serve(self) -> None:
        self.config.app = _Closing(self.wsgi)
        monitor = getattr(self.wsgi, "monitor", None)  # the load monitor reads the queues (``/status``)
        if monitor is not None:
            monitor.listening = list(self.sockets)
            monitor.handoff = _handoff
        settings = getattr(self.wsgi, "settings", None)
        head = float(getattr(settings, "head_seconds", 5.0))
        gate = self.wsgi if hasattr(self.wsgi, "admit_search") else None
        server = _BalancedServer(self.config, _handoff, head, gate)
        self._install_sigquit_handler()
        await server.serve(sockets=self.sockets)
        if not server.started:
            sys.exit(Arbiter.WORKER_BOOT_ERROR)


class _Closing:
    """The application as the worker serves it: every answer closes its connection."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_closing(message: Message) -> None:
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []), (b"connection", b"close")]}
            await send(message)

        await self.app(scope, receive, send_closing)


# The hand-off queue, made by :py:func:`run` in the master before it forks the workers.
_handoff: HandOff | None = None


class _Gunicorn(BaseApplication):  # type: ignore[misc]  # gunicorn has no type hints
    def __init__(self, application: ASGIApp, options: dict[str, Any]) -> None:
        self.options = options
        self.application = application
        super().__init__()

    def load_config(self) -> None:
        for key, value in self.options.items():
            self.cfg.set(key, value)

    def load(self) -> ASGIApp:
        return self.application


def gunicorn_options(settings: Settings, monitor: Any = None, limiter: Any = None) -> dict[str, Any]:
    """Return the options of the process model.

    Args:
        settings: The server's settings.
        monitor: The load monitor, told in the master when a worker ends (``child_exit``).
        limiter: The clients' allowances: a worker that ends gives back the places it held among its clients'
            searches in progress (``child_exit``), and the searches still queued when the master exits get theirs back
            as they are refused (``on_exit``).

    Returns:
        dict[str, Any]: Gunicorn's settings.
    """

    def child_exit(_server: Any, worker: Any) -> None:
        if monitor is not None:
            monitor.worker_exited(int(worker.pid))
        if limiter is not None:
            freed = limiter.release_holder(int(worker.pid))
            if freed:
                log.warning(
                    "Worker %d ended holding %d searches in progress; their places are given back.", worker.pid, freed
                )

    def on_exit(_server: Any) -> None:
        def refuse(conn: socket.socket, admitted: Admission | None) -> None:
            if admitted is not None and limiter is not None:
                limiter.give_back(admitted.client, "search")
                limiter.leave_search(admitted.place)
            refuse_unread(conn, restarting())

        if _handoff is not None:
            answered = _handoff.drain(refuse)
            if answered:
                log.info("Exiting: %d searches still in the queue answered 503 server_busy.", answered)

    return {
        "child_exit": child_exit,
        "on_exit": on_exit,
        "bind": f"{settings.host}:{settings.port}",
        "workers": settings.workers,
        "worker_class": "idtrack_web_api.server.Worker",
        "preload_app": True,
        # A worker that does not answer the master for this long is replaced; a search runs beside the event loop,
        # so the loop answers during a search, and this bound is only reached by a worker that is truly stuck.
        "timeout": int(settings.queue_seconds + settings.request_seconds) + 60,
        # A stopping worker finishes the searches it holds (each within its budget) and the answers it sends.
        "graceful_timeout": int(settings.request_seconds) + 10,
        "forwarded_allow_ips": ",".join(settings.forwarded_allow_ips),
        "accesslog": None,
        "errorlog": "-",
        "loglevel": settings.log_level.lower(),
        "proc_name": "idtrack-web",
        # No runtime control socket: the server is managed by its supervisor (compose, systemd), and the socket would
        # need a writable home folder.
        "control_socket_disable": True,
    }


def run(application: ASGIApp, settings: Settings) -> int:
    """Serve until stopped.

    Args:
        application: The application (graphs loaded).
        settings: The server's settings.

    Returns:
        int: The exit status.
    """
    global _handoff  # noqa: PLW0603 - shared by the workers: made before the fork
    _handoff = HandOff(settings.queue_max * settings.workers)
    options = gunicorn_options(settings, getattr(application, "monitor", None), getattr(application, "limiter", None))
    _Gunicorn(application, options).run()
    return 0


__all__ = [
    "HEAD_MAX_BYTES",
    "PEEK_BYTES",
    "RESTART_RETRY_SECONDS",
    "HandOff",
    "Worker",
    "gunicorn_options",
    "raw_answer",
    "refuse_unread",
    "request_whole",
    "route_of",
    "run",
]
