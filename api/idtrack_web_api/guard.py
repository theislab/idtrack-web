"""The outermost layer of every request: what holds for every answer, before and after the endpoints.

In the order a request meets it:

1. **Its id and its clock**: a request id (``X-Request-ID`` of the answer: the client's own where it sent a
   well-formed one, :py:data:`REQUEST_ID`, else one made here) and the time a worker took its connection.
2. **HEAD** is answered as GET without the body (every GET endpoint and file takes HEAD).
3. **The size of its address**: a path and query longer than :py:data:`URI_MAX_BYTES` is ``414 uri_too_long``, before
   anything reads them. A path of the API that ends in ``/`` is redirected (``308``) to the path without it.
4. **A full queue**: a search that no worker could take nor queue (``idtrack_web_api.server``) is ``503 server_busy``.
5. **CORS**: an ``OPTIONS`` request to the API is answered at once (``204`` with ``Allow``, and the preflight headers
   for the allowed origins).
6. **Conditional and repeated requests**: a GET of the API other than ``/health`` and ``/status`` has an ``ETag`` made
   of the server's identity (its start, versions and graphs: an answer is a function of the graphs and the arguments)
   and the request's path and query; ``If-None-Match`` naming it is answered ``304`` at once, and an answer this worker
   sent before is sent again from memory (:py:class:`AnswerCache`), without a search.
7. **The client's allowances** (:py:mod:`idtrack_web_api.limits`): a search takes a token of the client's searches
   (given back, and a token of its reads taken instead, where the request is refused for what it holds before any
   search: a ``4xx`` other than ``408``, ``422`` and ``429``),
   needs a balance of search time and a place among the client's searches in progress; any other request of the API
   (and an answer from memory) a token of its reads; ``/health`` none. Each answer of the API says the client's
   standing in ``RateLimit-Policy`` and ``RateLimit`` (the IETF draft's fields) where the allowances are enforced.
8. **The body**: read up to ``body_max_bytes`` (``413`` beyond) within ``body_seconds`` (``408 request_timeout``
   after), then replayed to the endpoint.
9. **The answer**: every answer gets ``X-Request-ID``, ``Server-Timing``, the security headers (a strict
   Content-Security-Policy on the API's answers, the page's own on every file of the page, a ``304`` included), and
   an answer of the API the CORS headers; an answer of the API of 1 KiB or more is compressed with gzip for a
   client that accepts it (its bytes, decoded, are the endpoint's exactly; its ``ETag`` then ends in ``-gzip``; a
   large one is compressed beside the event loop and its time charged as the search's). **It is sent in pieces of
   :py:data:`SEND_CHUNK` bytes, each written only once the client has taken enough of the last**, so that a worker
   holds at most one piece of it in the connection's buffer; a client that takes nothing for ``send_seconds``, or
   takes the answer more slowly than :py:data:`SEND_MIN_RATE` after the first ``send_seconds``, has its connection
   closed, and a worker holds at most ``sending_max_bytes`` of answers not yet taken (a larger answer is refused,
   ``503 server_busy``).
10. **After**: the request is counted in the load monitor (``/status`` in a count of its own), its search time
    charged to the client, and one line logged (method, path, status, seconds, request id; not the client's address),
    with every value from the client escaped (one request, one line).

No exception leaves it: an error after the answer started is logged and the connection closed; one before is
answered as ``500 internal_error`` with the request's id (the traceback goes to the log only).
"""

from __future__ import annotations

import contextvars
import gzip
import hashlib
import logging
import re
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import anyio

from idtrack_web_api.errors import ApiError, error_json
from idtrack_web_api.limits import NETWORK_SHARE, READ_SHARE, Admission, RateLimiter, Wait, client_key

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from starlette.types import ASGIApp, Message, Receive, Scope, Send

    from idtrack_web_api.config import Settings
    from idtrack_web_api.monitor import LoadMonitor

log = logging.getLogger("idtrack_web_api")
access_log = logging.getLogger("idtrack_web_api.access")

API_PREFIX = "/api/v1"
STATUS_PATH = f"{API_PREFIX}/status"
HEALTH_PATH = f"{API_PREFIX}/health"
#: The longest path and query (bytes, as sent) the server reads; longer is ``414``. An identifier of 256 characters,
#: each of four UTF-8 bytes percent-encoded, is 3 KiB.
URI_MAX_BYTES = 16_384
#: The answers of the API compressed for a client that accepts gzip: these types, of at least this many bytes.
COMPRESS_MIN_BYTES = 1024
#: Answers at least this large are compressed on a thread beside the event loop (and the time charged as the search's).
COMPRESS_ASIDE_BYTES = 262_144
_COMPRESSED_TYPES = (b"application/json", b"text/tab-separated-values", b"text/plain", b"text/markdown")
#: How long a browser may reuse an answer of the API before it revalidates it (``ETag``, ``304``).
CACHE_CONTROL = b"public, max-age=600"
#: An answer is written in pieces of this many bytes, each once the connection's buffer has room for it.
SEND_CHUNK = 65_536
#: A body refused for its size is read and dropped up to this many times the bound, so that its client reads the
#: refusal instead of a reset connection.
DRAIN_FACTOR = 4
#: The slowest a client may take an answer, in bytes per second, once ``send_seconds`` have passed since its start.
SEND_MIN_RATE = 65_536
#: The requests that search, by path: they need a worker's search thread. Every other request of the API is a read.
SEARCH_PATH = re.compile(
    r"^/api/v1/organisms/[^/]+/(convert|convert/batch|convert/each-database|genes-named|names-of|source-inference)$"
)
_SEARCH_METHODS = frozenset({"GET", "HEAD", "POST"})
#: The statuses of a searching request refused for what it holds, before any search (a malformed or unknown
#: argument, a body too large, an organism not held): such a request gives its search token back and counts as a read.
#: Not among them: ``408`` (the client was too slow), ``422`` (a search ran out of its budget), ``429``.
_SHAPE_REFUSALS = frozenset({400, 404, 405, 413, 414, 415})
#: GETs of the API that are never conditional nor kept: the live answers.
_LIVE = frozenset({HEALTH_PATH, STATUS_PATH})
#: A request id the client may give (``X-Request-ID``): it is then the request's id, in the answer and the log.
REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")

#: The connection a request came on, as the process model gives it (``idtrack_web_api.server``): when a worker took
#: it, a refusal decided before the request was read, the end of its search, and closing it at once. ``None`` where
#: the application runs without that server (tests in one process).
CONNECTION: contextvars.ContextVar[Any] = contextvars.ContextVar("idtrack_web_connection", default=None)

#: The policy of every answer but the page: nothing may be loaded, framed or run from it.
API_POLICY = b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
_PERMISSIONS = (
    b"accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
)
_COMMON_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"permissions-policy", _PERMISSIONS),
]
_EXPOSED = (
    b"X-Request-ID, Server-Timing, Retry-After, ETag, Content-Disposition, RateLimit, RateLimit-Policy, "
    b"Idtrack-Version, Idtrack-Graph-Digest"
)


def is_search(method: str, path: str) -> bool:
    """Return whether a request searches (needs a worker's search thread): by its method and decoded path.

    Args:
        method: The request's method.
        path: Its path, percent-decoded, without the query.

    Returns:
        bool: Whether it is a search.
    """
    return method in _SEARCH_METHODS and SEARCH_PATH.match(path) is not None


#: Where Google's tag loads its scripts from and the hosts it sends to, allowed only where the site counts visits
#: (``analytics``). The scripts are allowed by the tag's own folder (``/gtag/js?id=...`` and the scripts it loads beside
#: itself there), not the whole host: the host also serves Tag Manager containers (``/gtm.js``), which the site never
#: loads.
ANALYTICS_SCRIPTS = "https://www.googletagmanager.com/gtag/"
ANALYTICS_CONNECT = "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com"


def page_policy(script_hashes: Iterable[str], *, analytics: bool = False) -> bytes:
    """Return the Content-Security-Policy of the page: its own files only, and its inline scripts by their hashes.

    Scripts are typed (Trusted Types): the page has one policy of its own, ``idtrack-worker``, which passes the address
    of its own worker alone (the home's layout of lineages, run off the page's thread). Where the site counts visits
    (``IDTRACK_WEB_ANALYTICS_ID``), Google's tag is allowed its hosts, and two policies more: ``idtrack-analytics``
    (which passes the tag's address alone) and the tag's own (``goog#html``).

    Args:
        script_hashes: The base64 SHA-256 of each inline script of ``index.html``.
        analytics: Whether the site counts visits with Google Analytics.

    Returns:
        bytes: The header's value.
    """
    scripts = " ".join(["'self'", *(f"'sha256-{h}'" for h in sorted(set(script_hashes)))])
    if analytics:
        return (
            f"default-src 'none'; script-src {scripts} {ANALYTICS_SCRIPTS}; style-src 'self'; "
            f"img-src 'self' data: {ANALYTICS_CONNECT}; font-src 'self'; connect-src 'self' {ANALYTICS_CONNECT}; "
            "manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; "
            "require-trusted-types-for 'script'; trusted-types idtrack-worker idtrack-analytics goog#html"
        ).encode()
    return (
        f"default-src 'none'; script-src {scripts}; style-src 'self'; img-src 'self' data:; font-src 'self'; "
        "connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; "
        "object-src 'none'; require-trusted-types-for 'script'; trusted-types idtrack-worker"
    ).encode()


def printable(text: str) -> str:
    r"""Return text with every control or non-ASCII character escaped (``\\n``, ``\\x1b``, ``\\u00e9``): one log line.

    Args:
        text: A value from the client.

    Returns:
        str: The escaped text.
    """
    return text.encode("unicode_escape").decode("ascii").replace('"', '\\"')


def _matches(wanted: str, etag: str) -> bool:
    """Return whether an ``If-None-Match`` value names *etag* (weak comparison, either encoding, or ``*``)."""
    base = etag.strip('"')
    for item in wanted.split(","):
        tag = item.strip()
        if tag == "*" or tag.removeprefix("W/").strip('"').removesuffix("-gzip") == base:
            return True
    return False


@dataclass(frozen=True)
class Kept:
    """An answer kept to be sent again: its status, its headers of content, its body and, once made, its gzip."""

    status: int
    headers: tuple[tuple[bytes, bytes], ...]
    body: bytes
    gzipped: bytes | None = None


class AnswerCache:
    """The answers this worker sent recently, by ``ETag``, up to a total size (least recently used dropped first)."""

    def __init__(self, max_bytes: int) -> None:
        """Set the bound.

        Args:
            max_bytes: The most bytes kept in all; an answer larger than an eighth of it is never kept.
        """
        self.max_bytes = max_bytes
        self.entry_max = max_bytes // 8
        self.size = 0
        self._entries: OrderedDict[str, Kept] = OrderedDict()

    @staticmethod
    def _bytes(kept: Kept) -> int:
        return len(kept.body) + len(kept.gzipped or b"")

    def get(self, etag: str, *, count: bool = True) -> Kept | None:
        """Return the answer kept under *etag*, if any.

        Args:
            etag: The tag.
            count: Count it as used, as when it is sent (the least recently used is dropped first).

        Returns:
            Kept | None: The answer.
        """
        found = self._entries.get(etag)
        if found is not None and count:
            self._entries.move_to_end(etag)
        return found

    def put(self, etag: str, kept: Kept) -> None:
        """Keep an answer (if it fits), or its compressed bytes beside an answer kept already.

        Args:
            etag: The tag.
            kept: The answer.
        """
        before = self._entries.get(etag)
        if self._bytes(kept) > self.entry_max or (before is not None and before.gzipped is not None):
            return
        self._entries[etag] = kept
        self.size += self._bytes(kept) - (0 if before is None else self._bytes(before))
        while self.size > self.max_bytes and self._entries:
            _, dropped = self._entries.popitem(last=False)
            self.size -= self._bytes(dropped)


class NotTakenError(Exception):
    """The client did not take an answer within the send's deadlines."""

    def __init__(self, sent: int, size: int) -> None:
        super().__init__(f"{sent} of {size} bytes taken")
        self.sent = sent
        self.size = size


def _server_timing(state: dict[str, Any]) -> bytes:
    """Return the ``Server-Timing`` value: the server's time on the request so far, and its search's, in ms."""
    parts = [f"app;dur={(time.monotonic() - state['arrived']) * 1000:.3f}"]
    timing: dict[str, float] = state.get("timing") or {}
    parts += [f"{name};dur={timing[name] * 1000:.3f}" for name in ("queue", "search", "write") if name in timing]
    if state.get("cache"):
        parts.append(f'cache;desc="{state["cache"]}"')
    return ", ".join(parts).encode()


def _accepts_gzip(scope: Scope) -> bool:
    from idtrack_web_api.frontend import accepts_gzip

    for name, value in scope.get("headers", []):
        if name == b"accept-encoding":
            return accepts_gzip(value.decode("latin-1"))
    return False


def _header(scope: Scope, wanted: bytes) -> str | None:
    for name, value in scope.get("headers", []):
        if name == wanted:
            return str(value.decode("latin-1"))
    return None


def _request_id(scope: Scope) -> str:
    given = _header(scope, b"x-request-id")
    if given is not None and REQUEST_ID.match(given):
        return given
    return uuid.uuid4().hex


class Guard:
    """The outer layer of the application (see the module's text for what it does, in order)."""

    def __init__(
        self,
        app: ASGIApp,
        settings: Settings,
        limiter: RateLimiter,
        monitor: LoadMonitor,
        identity: str = "",
        page: bytes | Callable[[], bytes] | None = None,
        methods: Any = None,
    ) -> None:
        """Wrap an application.

        Args:
            app: The application.
            settings: The server's settings.
            limiter: The clients' allowances (shared by the workers).
            monitor: The load monitor (shared by the workers).
            identity: What the server answers from (start, versions, graphs): part of every ``ETag``.
            page: The Content-Security-Policy of the page, or a function that returns the current one (``None``: no
                page served); an answer that sets its own policy (the page itself, by its inline scripts) keeps it.
            methods: A function of a path that returns the methods the API takes at it (for ``OPTIONS``).
        """
        self.app = app
        self.settings = settings
        self.limiter = limiter
        self.monitor = monitor
        self.identity = identity
        policy = page or API_POLICY
        self.page: Callable[[], bytes] = policy if callable(policy) else (lambda: policy)
        self.methods = methods
        self.cache = AnswerCache(settings.answer_cache_bytes)
        #: The bytes of answers this worker holds for clients that have not taken them yet.
        self.sending = 0
        origins = settings.cors_origins
        self.any_origin = origins == ("*",)
        self.origins = frozenset(o for o in origins if o != "*")

    # ---------------------------------------------------------------------------------------------------------------

    def _cors(self, scope: Scope) -> list[tuple[bytes, bytes]]:
        if self.any_origin:
            return [
                (b"access-control-allow-origin", b"*"),
                (b"access-control-expose-headers", _EXPOSED),
                (b"timing-allow-origin", b"*"),
            ]
        origin = _header(scope, b"origin")
        headers = [(b"vary", b"Origin")]
        if origin is not None and origin in self.origins:
            headers += [
                (b"access-control-allow-origin", origin.encode("latin-1")),
                (b"access-control-expose-headers", _EXPOSED),
                (b"timing-allow-origin", origin.encode("latin-1")),
            ]
        return headers

    def etag(self, scope: Scope) -> str:
        """Return the ``ETag`` of a GET of the API: the server's identity, the path and the query, digested.

        Args:
            scope: The request.

        Returns:
            str: The tag, quoted.
        """
        query = scope.get("query_string", b"")
        items = sorted(part for part in query.split(b"&") if part)
        text = b"\n".join([self.identity.encode(), scope.get("raw_path") or scope["path"].encode(), *items])
        return f'"{hashlib.blake2b(text, digest_size=16).hexdigest()}"'

    def rate_headers(self, client: str, kind: str) -> list[tuple[bytes, bytes]]:
        """Return ``RateLimit-Policy`` and ``RateLimit`` for a client (none where the allowances are off).

        Each allowance is a policy named as ``allowance`` of a ``429`` names it, with ``q`` its quota (the most a
        client holds at once) and ``w`` the seconds in which an empty allowance fills again; ``RateLimit`` gives the
        policy this request drew on: ``r`` what is left (whole units), ``t`` the seconds until it is full again.

        Args:
            client: The client's key.
            kind: ``search`` or ``read``.

        Returns:
            list[tuple[bytes, bytes]]: The headers.
        """
        limiter = self.limiter
        if not limiter.enabled:
            return []
        burst, rate = limiter.burst, limiter.rate
        policies = [f'"searches";q={int(burst)};w={round(burst / rate)}']
        policies.append(f'"reads";q={int(burst * READ_SHARE)};w={round(burst / rate)}')
        if limiter.work_enabled:
            policies.append(
                f'"search_seconds";q={int(limiter.work_burst)};w={round(limiter.work_burst / limiter.work_rate)}'
            )
        current = []
        name = "searches" if kind == "search" else "reads"
        left = limiter.remaining(client, "search" if kind == "search" else "read")
        if left is not None:
            current.append(f'"{name}";r={max(0, left[0])};t={round(left[1])}')
        if kind == "search":
            balance = limiter.search_balance(client)
            if balance is not None:
                current.append(f'"search_seconds";r={max(0, int(balance[0]))};t={round(balance[1])}')
        headers = [(b"ratelimit-policy", ", ".join(policies).encode())]
        if current:
            headers.append((b"ratelimit", ", ".join(current).encode()))
        return headers

    # ---------------------------------------------------------------------------------------------------------------

    def _held(self, change: int) -> None:
        """Count bytes of answers this worker holds for clients that have not taken them."""
        if change:
            self.sending += change
            self.monitor.sending(change)

    async def _deliver(self, send: Send, body: bytes, *, more_body: bool, clock: dict[str, Any]) -> None:
        """Send a body (or a part of one) in pieces, each within the send's deadlines (see the module's text).

        Raises:
            NotTakenError: When a deadline passed (the caller closes the connection).
        """
        size = len(body)
        offset = 0
        view = memoryview(body)
        while True:
            piece = bytes(view[offset : offset + SEND_CHUNK])
            last = offset + SEND_CHUNK >= size
            now = time.monotonic()
            stalled = now + self.settings.send_seconds
            slowest = clock["started"] + self.settings.send_seconds + clock["sent"] / SEND_MIN_RATE
            try:
                with anyio.fail_after(max(0.0, min(stalled, slowest) - now)):
                    await send({"type": "http.response.body", "body": piece, "more_body": more_body or not last})
            except TimeoutError:
                raise NotTakenError(clock["sent"], clock["size"]) from None
            clock["sent"] += len(piece)
            offset += SEND_CHUNK
            if last:
                return

    async def __call__(self, scope: Scope, receive: Receive, sending: Send) -> None:  # noqa: PLR0911, PLR0912, PLR0915
        """Serve one request (see the module's text)."""
        if scope["type"] != "http":
            await self.app(scope, receive, sending)
            return
        connection = CONNECTION.get()
        request_id = _request_id(scope)
        state: dict[str, Any] = scope.setdefault("state", {})
        state["request_id"] = request_id
        state["arrived"] = time.monotonic() if connection is None else connection.taken_at
        if connection is not None and connection.waited:
            state["handed_off"] = connection.waited
        head = scope.get("method") == "HEAD"
        if head:
            scope = {**scope, "method": "GET"}
        path: str = scope["path"]
        api = path == "/api" or path.startswith("/api/")
        searching = api and is_search(scope["method"], path)
        host = (scope.get("client") or ("unknown", 0))[0]
        client = client_key(host)
        status = {"code": 0}
        etag: str | None = None
        accepts_gzip = api and _accepts_gzip(scope)
        captured: dict[str, Any] = {}
        buffered: dict[str, Any] = {"start": None, "body": []}
        limits: list[tuple[bytes, bytes]] = []
        clock: dict[str, Any] = {"started": 0.0, "sent": 0, "size": 0}
        own: Admission | None = None  # a search admitted here (not when its connection was routed)
        sent = {"start": False}

        async def send(message: Message) -> None:
            if message["type"] == "http.response.start":
                sent["start"] = True
            await sending(message)

        def charge_work() -> None:
            """Charge the client the search time worked and not yet charged.

            Called before its answer leaves, so that its next request already meets the balance, and again at the end
            for what came after.
            """
            timing = state.get("timing") or {}
            worked = timing.get("search", 0.0) + timing.get("write", 0.0)
            owed = worked - float(state.get("charged", 0.0))
            if owed > 0:
                self.limiter.charge_search(client, owed)
                state["charged"] = worked

        def headers_of(message: Message, body: bytes | None) -> list[tuple[bytes, bytes]]:
            headers = [h for h in message.get("headers", []) if h[0] != b"content-length"]
            kind = next((v for k, v in headers if k == b"content-type"), b"")
            own_policy = any(k == b"content-security-policy" for k, _ in headers)
            headers += [
                (b"x-request-id", request_id.encode()),
                (b"server-timing", _server_timing(state)),
                *_COMMON_HEADERS,
            ]
            if not own_policy:
                # The page's policy on every file of the page, a 304 too (a browser keeps the policy of the answer
                # that revalidated its copy); the API's strict one on every answer of the API.
                policy = self.page() if not api or kind.startswith(b"text/html") else API_POLICY
                headers.append((b"content-security-policy", policy))
            if api:
                headers += self._cors(scope)
                headers.append(
                    (b"cross-origin-resource-policy", b"cross-origin" if self.any_origin else b"same-origin")
                )
                headers += limits
            else:
                headers.append((b"cross-origin-resource-policy", b"same-origin"))
            if body is not None:
                headers.append((b"content-length", str(len(body)).encode()))
            return headers

        def give_back() -> bool:
            """Give the client its search's token back (refused for the server's capacity, or before any search)."""
            if searching and (own is not None or (connection is not None and connection.admitted is not None)):
                self.limiter.give_back(client, "search")
                return True
            return False

        def settle(answered: int) -> None:
            """Give a search's token back where it searched nothing.

            Refused for the server's capacity, or for what the request holds (then charged as a read: the allowance of
            searches counts the requests that were searched).
            """
            if not searching:
                return
            if state.pop("capacity", False):  # the app refused it for the server's capacity
                give_back()
            elif answered in _SHAPE_REFUSALS and not state.get("refused_shape"):
                state["refused_shape"] = True
                if give_back():
                    self.limiter.take(client, "read")
                    if limits:
                        limits[:] = self.rate_headers(client, "search")

        async def compressed(body: bytes) -> bytes:
            """Compress an answer: a large one beside the event loop, its time part of a search's writing."""
            if len(body) < COMPRESS_ASIDE_BYTES:
                return _gzip(body)
            began = time.monotonic()
            packed = await anyio.to_thread.run_sync(_gzip, body)
            if searching:
                timing = state.setdefault("timing", {})
                timing["write"] = timing.get("write", 0.0) + time.monotonic() - began
            return packed

        async def finish(start: Message, body: bytes, gzipped: bytes | None = None) -> None:
            """Send a buffered answer of the API: its tag, compressed where accepted, its length, in pieces.

            An answer kept to be sent again keeps its compressed bytes too (made once). Compressing a large answer of a
            search is part of writing it (``write`` of ``Server-Timing``, charged as its search time); any other answer
            is compressed within ``app``.
            """
            headers = list(start.get("headers", []))
            kind = next((v for k, v in headers if k == b"content-type"), b"")
            kept: Kept | None = None
            if start["status"] == 200 and etag is not None and not state.get("answer_kept"):
                kept = Kept(200, tuple(h for h in headers if h[0] in _KEPT_HEADERS), body, gzipped)
            coded = False
            if (
                accepts_gzip
                and len(body) >= COMPRESS_MIN_BYTES
                and kind.startswith(_COMPRESSED_TYPES)
                and not any(k == b"content-encoding" for k, _ in headers)
            ):
                body = gzipped if gzipped is not None else await compressed(body)
                if kept is not None and kept.gzipped is None:
                    kept = Kept(kept.status, kept.headers, kept.body, body)
                headers += [(b"content-encoding", b"gzip")]
                coded = True
            if kept is not None:
                captured["kept"] = kept
            settle(start["status"])
            if start["status"] < 400 and body and self.sending + len(body) > self.settings.sending_max_bytes:
                give_back()
                await refuse(
                    ApiError(
                        "server_busy",
                        f"This worker already holds {self.sending} bytes of answers that their clients have not "
                        f"taken; this answer ({len(body)} bytes) would pass its bound of "
                        f"{self.settings.sending_max_bytes}. Retry in a few seconds.",
                        headers={"Retry-After": "5"},
                    )
                )
                return
            status["code"] = start["status"]
            if kind.startswith(_COMPRESSED_TYPES):
                headers.append((b"vary", b"Accept-Encoding"))
            if status["code"] == 200 and etag is not None:
                tag = etag[:-1] + '-gzip"' if coded else etag
                headers += [(b"etag", tag.encode()), (b"cache-control", CACHE_CONTROL)]
            elif status["code"] >= 400 and not any(k == b"cache-control" for k, _ in headers):
                headers.append((b"cache-control", b"no-store"))
            charge_work()
            await send(
                {
                    "type": "http.response.start",
                    "status": status["code"],
                    "headers": headers_of({"headers": headers}, body),
                }
            )
            content = b"" if head else body
            clock.update(started=time.monotonic(), size=len(content))
            self._held(len(content))
            try:
                await self._deliver(send, content, more_body=False, clock=clock)
            finally:
                self._held(-len(content))

        async def send_marked(message: Message) -> None:
            if api:
                if message["type"] == "http.response.start":
                    buffered["start"] = message
                    return
                if message["type"] == "http.response.body":
                    buffered["body"].append(message.get("body", b""))
                    if not message.get("more_body", False):
                        # An endpoint that keeps its answers compressed already gives them (``gzipped`` of the state).
                        await finish(buffered["start"], b"".join(buffered["body"]), state.get("gzipped"))
                    return
                await send(message)
                return
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                length = next((v for k, v in message.get("headers", []) if k == b"content-length"), None)
                headers = headers_of(message, None)
                if length is not None:
                    headers.append((b"content-length", length))
                clock.update(started=time.monotonic(), size=int(length) if length is not None else 0)
                await send({**message, "headers": headers})
                return
            if message["type"] == "http.response.body":
                content = b"" if head else message.get("body", b"")
                self._held(len(content))
                try:
                    await self._deliver(send, content, more_body=message.get("more_body", False), clock=clock)
                finally:
                    self._held(-len(content))
                return
            await send(message)

        async def refuse(error: ApiError) -> None:
            await finish(
                {
                    "type": "http.response.start",
                    "status": error.status,
                    "headers": [(b"content-type", b"application/json"), *_encoded(error.headers)],
                },
                error_json(error, request_id),
            )

        counted = path != STATUS_PATH
        if counted:
            self.monitor.request_started()
        else:
            self.monitor.status_request()
        try:
            target = len(scope.get("raw_path") or b"") + len(scope.get("query_string", b""))
            if target > URI_MAX_BYTES:
                api = True  # answered as the API answers
                await refuse(
                    ApiError(
                        "uri_too_long",
                        f"The request's path and query have {target} bytes; this server reads at most {URI_MAX_BYTES}.",
                    )
                )
                return
            if api and len(path) > 1 and path.endswith("/"):
                if await self._limited(client, refuse):
                    return
                await self._redirect(scope, send, request_id, state)
                status["code"] = 308
                return
            if connection is not None and connection.refusal is not None:  # decided when the connection was routed
                limits[:] = self.rate_headers(client, "search") if api else []
                await refuse(connection.refusal)
                return
            if api and scope["method"] == "OPTIONS":
                await self._options(scope, send, request_id, state)
                status["code"] = 204
                return
            if api and scope["method"] == "GET" and path.startswith(API_PREFIX) and path not in _LIVE:
                etag = self.etag(scope)
                wanted = _header(scope, b"if-none-match")
                if searching and connection is not None and connection.admitted is not None:
                    # Answered from memory or as 304 if it can be: a read, not the search it was admitted as.
                    memory = wanted is not None and _matches(wanted, etag)
                    if memory or self.cache.get(etag, count=False) is not None:
                        self.limiter.give_back(client, "search")
                        connection.release_admission()
                if wanted is not None and _matches(wanted, etag):
                    state["cache"] = "revalidated"
                    if await self._limited(client, refuse):
                        return
                    limits[:] = self.rate_headers(client, "read")
                    status["code"] = 304
                    headers = [
                        (b"etag", etag.encode()),
                        (b"cache-control", CACHE_CONTROL),
                        (b"vary", b"Accept-Encoding"),
                    ]
                    await send(
                        {
                            "type": "http.response.start",
                            "status": 304,
                            "headers": headers_of({"headers": headers}, None),
                        }
                    )
                    await send({"type": "http.response.body", "body": b""})
                    return
                kept = self.cache.get(etag)
                if kept is not None:
                    state["cache"] = "hit"
                    if await self._limited(client, refuse):
                        return
                    limits[:] = self.rate_headers(client, "read")
                    await finish(
                        {"type": "http.response.start", "status": 200, "headers": list(kept.headers)},
                        kept.body,
                        kept.gzipped,
                    )
                    if captured.get("kept") is not kept and captured.get("kept") is not None:
                        self.cache.put(etag, captured["kept"])  # its compressed bytes, made for this client
                    return
            if api and path != HEALTH_PATH:
                kind = "search" if searching else "read"
                if searching and connection is not None and connection.admitted is not None:
                    pass  # admitted by its client's allowances when its connection was routed
                elif searching:
                    decided = self.admit_search(client)
                    if isinstance(decided, ApiError):
                        await refuse(decided)
                        return
                    own = decided
                elif await self._limited(client, refuse):
                    return
                if searching and self.sending > self.settings.sending_max_bytes:
                    self.limiter.give_back(client, "search")  # admitted above or when routed; refused for capacity
                    await refuse(
                        ApiError(
                            "server_busy",
                            f"This worker holds {self.sending} bytes of answers that their clients have not taken, "
                            f"more than its bound of {self.settings.sending_max_bytes}; retry in a few seconds.",
                            headers={"Retry-After": "5"},
                        )
                    )
                    return
                limits[:] = self.rate_headers(client, kind)
            replayed = await self._bounded_body(scope, receive, refuse)
            if replayed is None:
                return
            if searching and connection is not None:
                connection.request_arrived()  # its search counts in this worker from now on
            await self.app(scope, replayed, send_marked)
            kept = captured.get("kept")
            if kept is not None and etag is not None:
                self.cache.put(etag, kept)
        except NotTakenError as error:
            log.warning(
                "Request %s: its client took %d of the %d bytes of its answer within the send's deadlines; its "
                "connection was closed.",
                request_id, error.sent, error.size,
            )  # fmt: skip
            if connection is not None:
                connection.abort()
        except Exception:
            log.exception("Internal error in request %s (%s %s)", request_id, scope.get("method"), printable(path))
            await self._fault(refuse, request_id, started=sent["start"], connection=connection)
            if not sent["start"]:
                status["code"] = 500
        finally:
            seconds = time.monotonic() - state["arrived"]
            if counted:
                self.monitor.request_ended(seconds, status["code"])
            if own is not None:
                self.limiter.leave_search(own.place)
            if connection is not None:
                connection.release_admission()
            charge_work()
            if connection is not None:
                connection.release_search()
            raw = scope.get("raw_path") or path.encode("utf-8", "surrogateescape")
            given = _header(scope, b"x-request-id")
            # The client's address is not written: the proxy in front keeps it in its own log, for a bounded time
            # (deploy/Caddyfile), and the request id ties a line of one log to the other.
            access_log.info(
                "%s %s %d %.3fs %s%s", "HEAD" if head else scope.get("method"),
                printable(raw.decode("latin-1")), status["code"], seconds, request_id,
                "" if given is None or given == request_id else f" (client's id refused: {printable(given[:80])})",
            )  # fmt: skip

    async def _fault(
        self, refuse: Callable[[ApiError], Any], request_id: str, *, started: bool, connection: Any
    ) -> None:
        """Answer a fault: ``500 internal_error`` if no answer has started, else close the connection (nothing raises).

        Args:
            refuse: What sends a refusal.
            request_id: The request's id.
            started: Whether the answer's head was sent.
            connection: The connection (``None`` without the process model).
        """
        if not started:
            try:
                await refuse(
                    ApiError(
                        "internal_error",
                        f"The server failed to answer this request; quote the request id {request_id} when reporting "
                        "it.",
                    )
                )
            except Exception:  # noqa: BLE001 - the connection is closed instead; the fault is logged already
                log.warning("Request %s: its refusal could not be sent either; its connection is closed.", request_id)
            else:
                return
        if connection is not None:
            connection.abort()

    def admit_search(self, client: str) -> ApiError | Admission:
        """Admit a searching request by its client's allowances.

        Its allowances: a token of its searches, a balance of search time, and a place among its searches in progress
        (taken here, and given back when the request ends). The process model calls it when it routes a connection,
        before the search waits for a worker (``idtrack_web_api.server``); without it, the outer layer calls it.

        Args:
            client: The client's key.

        Returns:
            ApiError | Admission: The refusal (``429 rate_limited``, naming the allowance), or the admission (its place
            to give back when the request ends).
        """
        taken = self.limiter.take(client, "search")
        if taken is not None:
            again = RateLimiter.retry_after(taken.seconds)
            return ApiError(
                "rate_limited",
                f"{_whose(taken, 'searching requests')} is used up (it holds "
                f"{self.settings.rate_burst * _share(taken)} at most and fills again at "
                f"{self.settings.rate_per_minute * _share(taken)} per minute); retry in {again} s.",
                headers={"Retry-After": again},
                allowance="searches",
            )
        wait = self.limiter.search_wait(client)
        if wait is not None:
            again = RateLimiter.retry_after(wait)
            return ApiError(
                "rate_limited",
                "This client's balance of search time is used up (it holds "
                f"{self.settings.rate_search_burst_seconds:g} s at most and fills again at "
                f"{self.settings.rate_search_seconds:g} s per minute); retry in {again} s.",
                headers={"Retry-After": again},
                allowance="search_seconds",
            )
        place = self.limiter.enter_search(client)
        if place is None:
            self.limiter.give_back(client, "search")
            # A search in progress ends, on average, within the recent searches' mean time.
            again = RateLimiter.retry_after(self.monitor.mean_search_seconds())
            return ApiError(
                "rate_limited",
                f"This client already has {self.limiter.concurrent} searching requests in progress, as many as it may "
                f"(`rate_concurrent_searches`); send the next when one has been answered (searches take about "
                f"{again} s now).",
                headers={"Retry-After": again},
                allowance="concurrent_searches",
            )
        return Admission(client, place)

    async def _limited(self, client: str, refuse: Any) -> bool:
        """Take the client's token of a read; answer 429 and return whether it was refused."""
        taken = self.limiter.take(client, "read")
        if taken is not None:
            again = RateLimiter.retry_after(taken.seconds)
            await refuse(
                ApiError(
                    "rate_limited",
                    f"{_whose(taken, 'requests that read')} is used up (it holds "
                    f"{self.settings.rate_burst * READ_SHARE * _share(taken)} at most and fills again at "
                    f"{self.settings.rate_per_minute * READ_SHARE * _share(taken)} per minute); retry in {again} s.",
                    headers={"Retry-After": again},
                    allowance="reads",
                )
            )
            return True
        return False

    def _final_headers(self, request_id: str, state: dict[str, Any]) -> list[tuple[bytes, bytes]]:
        return [
            (b"x-request-id", request_id.encode()),
            (b"server-timing", _server_timing(state)),
            *_COMMON_HEADERS,
            (b"content-security-policy", API_POLICY),
            (b"content-length", b"0"),
        ]

    async def _redirect(self, scope: Scope, send: Send, request_id: str, state: dict[str, Any]) -> None:
        """Answer a path of the API that ends in ``/``: ``308`` to the same path without it (method and body kept).

        The address is the path as the client wrote it (its percent-encoding kept: an encoded ``?`` or line break stays
        encoded), without its final slashes.
        """
        query = scope.get("query_string", b"")
        raw = scope.get("raw_path") or scope["path"].encode("utf-8")
        to = raw.rstrip(b"/") or b"/"
        location = scope.get("root_path", "").encode("utf-8") + to + (b"?" + query if query else b"")
        headers = [(b"location", location), (b"cache-control", b"no-store"), *self._cors(scope)]
        headers += self._final_headers(request_id, state)
        await send({"type": "http.response.start", "status": 308, "headers": headers})
        await send({"type": "http.response.body", "body": b""})

    async def _options(self, scope: Scope, send: Send, request_id: str, state: dict[str, Any]) -> None:
        """Answer ``OPTIONS``: the methods the path takes, and the CORS preflight for an allowed origin."""
        methods = list(self.methods(scope["path"])) if self.methods is not None else []
        allow = ", ".join([*methods, "OPTIONS"]).encode()
        headers = [(b"allow", allow), *self._cors(scope)]
        if _header(scope, b"access-control-request-method") is not None and (
            self.any_origin or _header(scope, b"origin") in self.origins
        ):
            headers += [
                (b"access-control-allow-methods", allow),
                (b"access-control-allow-headers", b"Content-Type, Accept, If-None-Match, X-Request-ID"),
                (b"access-control-max-age", b"86400"),
            ]
        headers += self._final_headers(request_id, state)
        await send({"type": "http.response.start", "status": 204, "headers": headers})
        await send({"type": "http.response.body", "body": b""})

    async def _drain(self, receive: Receive, declared: int, limit: int) -> None:
        """Read and drop a refused body, when it is at most four times the bound, within the body's deadline.

        A connection closed with request bytes unread is reset by the kernel, and the client may then lose the answer
        that says why its body was refused; a body over four times the bound is not read (its client may see a reset).
        """
        if declared > DRAIN_FACTOR * limit:
            return
        with anyio.move_on_after(self.settings.body_seconds):
            while True:
                message = await receive()
                if message["type"] == "http.disconnect" or not message.get("more_body", False):
                    return

    async def _bounded_body(self, scope: Scope, receive: Receive, refuse: Any) -> Receive | None:
        """Read a request body up to its bound and deadline and replay it; answer 413 or 408 and return ``None``."""
        if scope.get("method") not in {"POST", "PUT", "PATCH"}:
            return receive
        limit = self.settings.body_max_bytes
        too_large = ApiError(
            "payload_too_large", f"The request body is larger than {limit} bytes; send fewer identifiers per request."
        )
        declared = _header(scope, b"content-length")
        if declared is not None and declared.strip().isdigit() and int(declared) > limit:
            await self._drain(receive, int(declared), limit)
            await refuse(too_large)
            return None
        chunks: list[bytes] = []
        size = 0
        more = True
        try:
            with anyio.fail_after(self.settings.body_seconds):
                while more:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return None
                    chunk = message.get("body", b"")
                    size += len(chunk)
                    if size > limit:
                        if message.get("more_body", False):
                            await self._drain(receive, size + 1, limit)
                        await refuse(too_large)
                        return None
                    chunks.append(chunk)
                    more = message.get("more_body", False)
        except TimeoutError:
            await refuse(
                ApiError(
                    "request_timeout",
                    f"The request's body did not arrive within {self.settings.body_seconds:g} s ({size} bytes came).",
                )
            )
            return None
        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        return replay


def _whose(taken: Wait, what: str) -> str:
    """Whose allowance a refusal names: the client's own, or its IPv6 network's that its clients share."""
    if taken.network is None:
        return f"This client's allowance of {what}"
    return f"The allowance of {what} that the clients of the IPv6 network {taken.network} share"


def _share(taken: Wait) -> int:
    return 1 if taken.network is None else NETWORK_SHARE


def _gzip(body: bytes) -> bytes:
    return gzip.compress(body, compresslevel=5, mtime=0)


_KEPT_HEADERS = frozenset({b"content-type", b"content-disposition", b"idtrack-version", b"idtrack-graph-digest"})


def _encoded(headers: dict[str, str]) -> list[tuple[bytes, bytes]]:
    return [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]


__all__ = [
    "API_POLICY",
    "API_PREFIX",
    "CACHE_CONTROL",
    "CONNECTION",
    "HEALTH_PATH",
    "SEARCH_PATH",
    "SEND_CHUNK",
    "SEND_MIN_RATE",
    "STATUS_PATH",
    "URI_MAX_BYTES",
    "AnswerCache",
    "Guard",
    "NotTakenError",
    "is_search",
    "page_policy",
    "printable",
]
