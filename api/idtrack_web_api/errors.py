"""The API's errors: each has an HTTP status, a stable code and a message that says what to change.

IDTrack's refusals of an input arrive through the adapter (:py:func:`idtrack_web_api.adapter.input_problem`) with a code
of their own (a 4xx); a search over its budget is ``422 search_budget_exceeded``; anything else is
``500 internal_error`` with the request's id to quote, and its traceback goes to the server's log only. Every code is
answered by some endpoint: a refusal of IDTrack's that the API's own checks make unreachable (a wrong type, a version
or assembly where the API takes none) is not listed, and would be answered as ``invalid_input``.

How a client retries each code is one table (:py:data:`RETRY`), from which ``/vocabulary``, ``/llms-full.txt``,
README.md and the API page write it.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Sequence

#: Every code the API answers with: its HTTP status and when it is answered. README.md, ``/llms-full.txt`` and the
#: OpenAPI document are written from this table (``idtrack-web docs``), and ``/vocabulary`` serves it.
CODES: dict[str, tuple[int, str]] = {
    "invalid_request": (
        400,
        (
            "The request does not have the shape the endpoint takes: a missing or malformed parameter, a body that is "
            "not UTF-8 JSON of the documented shape (`details` lists each problem, `argument` names the parameter when "
            "one is at fault)."
        ),
    ),
    "unknown_parameter": (400, "A query parameter the endpoint does not take, or one given more than once."),
    "invalid_identifier": (
        400,
        (
            "An identifier or name is longer than this server accepts, or holds control, surrogate, private-use or "
            "unassigned characters (in a batch: the whole batch is refused, and `details` gives every such item's "
            "index)."
        ),
    ),
    "unknown_release": (400, "A release the graph does not cover (`allowed` lists the graph's releases)."),
    "unknown_database": (400, "A database the graph does not hold at that release (`allowed` lists those it holds)."),
    "unknown_identifier": (
        400,
        "An identifier the call needs to exist in the graph does not (the gene of names-of).",
    ),
    "missing_value": (
        400,
        "An identifier is empty or a spelling of a missing value (IDTrack's refusal), or a name to look up is empty.",
    ),
    "invalid_argument": (400, "An argument whose value is not accepted (an empty or over-long database name)."),
    "invalid_input": (400, "Another input IDTrack refuses (IDTrack's message says which)."),
    "unknown_organism": (404, "An organism this server does not hold (`allowed` lists those it holds)."),
    "not_found": (404, "No such endpoint or file."),
    "method_not_allowed": (
        405,
        "The endpoint does not take this method (the `Allow` header and `allowed` list the methods it takes).",
    ),
    "request_timeout": (
        408,
        (
            "The request's head or body did not arrive within the time the server waits for it, or its client closed "
            "the connection before its search (which is then not run); send it again."
        ),
    ),
    "payload_too_large": (413, "The request body is larger than the server accepts."),
    "too_many_identifiers": (413, "A batch with more identifiers than the server accepts (`batch_max` of /limits)."),
    "uri_too_long": (414, "The request's path and query are longer than the server accepts."),
    "unsupported_media_type": (
        415,
        "A request body that is not `application/json` in UTF-8, or that is sent compressed (`Content-Encoding`).",
    ),
    "search_budget_exceeded": (
        422,
        "One identifier's search needed more than its budget (states or seconds); the same request fails again.",
    ),
    "response_too_large": (
        422,
        "The answer is larger than the server sends (`response_max_bytes` of /limits); it is refused, never cut.",
    ),
    "rate_limited": (
        429,
        (
            "This client sent more requests, or used more search time, than its allowance; wait the `Retry-After` "
            "header's seconds."
        ),
    ),
    "internal_error": (500, "A fault of the server; quote the request id when reporting it."),
    "server_busy": (
        503,
        (
            "The server has more waiting work than it accepts: its queue of searches is full, the search would wait "
            "(or waited) longer for a worker than `queue_seconds` of /limits, or the server is stopping; the request "
            "was not searched. Retry after the `Retry-After` header's seconds, unchanged."
        ),
    ),
    "request_budget_exceeded": (
        503,
        (
            "The request's search needed more time than its budget (`request_seconds` of /limits, counted from when "
            "its search began); `progress` says how far it went (identifiers of a batch, databases of each-database). "
            "The time a search takes depends on the server's load too, so the same request can succeed later; one "
            "refused again needs fewer identifiers or databases per request."
        ),
    ),
}

#: Each code's title for people: a few plain words for the heading of a refusal shown on a page (no code, no header
#: name); ``meaning`` says the rest. The keys are those of :py:data:`CODES` (a test compares them).
TITLES: dict[str, str] = {
    "invalid_request": "The request is not in the form the endpoint takes.",
    "unknown_parameter": "The request names a parameter the endpoint does not take, or names one twice.",
    "invalid_identifier": "An identifier is too long, or holds characters an identifier cannot hold.",
    "unknown_release": "A release this graph does not cover.",
    "unknown_database": "A database this graph does not hold at that release.",
    "unknown_identifier": "An identifier this graph does not hold.",
    "missing_value": "An identifier is empty, or stands for a missing value.",
    "invalid_argument": "A value this endpoint does not accept.",
    "invalid_input": "An input IDTrack does not accept.",
    "unknown_organism": "An organism this server does not hold.",
    "not_found": "Nothing is at this address.",
    "method_not_allowed": "This address does not take this kind of request.",
    "request_timeout": "The request did not arrive in time.",
    "payload_too_large": "The request is larger than the server accepts.",
    "too_many_identifiers": "More identifiers than one batch may hold.",
    "uri_too_long": "The address is longer than the server accepts.",
    "unsupported_media_type": "The request's body is not JSON.",
    "search_budget_exceeded": "One identifier's search needed more than its budget.",
    "response_too_large": "The answer is larger than the server sends.",
    "rate_limited": "Too many requests from this address for now.",
    "internal_error": "A fault of the server.",
    "server_busy": "The server is busy.",
    "request_budget_exceeded": "The search needed more time than one request may take.",
}

#: The allowances a ``429 rate_limited`` names (``allowance`` of the error): which of a client's allowances it used up.
ALLOWANCES: dict[str, str] = {
    "searches": "Searching requests (`rate_per_minute` per minute, `rate_burst` at once).",
    "reads": "Every other request of the API (`read_share` times the searches' allowance).",
    "search_seconds": "Seconds of search (`rate_search_seconds` per minute, a balance of `rate_search_burst_seconds`).",
    "concurrent_searches": "Searching requests in progress at once (`rate_concurrent_searches`).",
}

#: How a client retries each code that the same request may succeed after: whether the refusal carries
#: ``Retry-After`` (and ``retry_after``), and what to do, in words. Every other code answers the same request the same
#: way until it is changed.
RETRY: dict[str, tuple[bool, str]] = {
    "request_timeout": (False, "Send it again, whole and at once (it carries no `Retry-After`)."),
    "rate_limited": (True, "Wait the `Retry-After` seconds, then send it again unchanged."),
    "internal_error": (False, "Send it again after a few seconds, waiting longer each time it repeats."),
    "server_busy": (True, "Wait the `Retry-After` seconds, then send it again unchanged."),
    "request_budget_exceeded": (
        True,
        (
            "Wait the `Retry-After` seconds and send it again; refused again, send it in smaller pieces (`progress` "
            "says how far it went: halve a batch, or ask the databases you need with `GET .../convert`)."
        ),
    ),
}
#: The codes after which the same request may succeed when sent again (:py:data:`RETRY`).
RETRYABLE: frozenset[str] = frozenset(RETRY)
#: How to go on after any other code.
NOT_RETRYABLE = "Change the request: the same request is answered the same way."


def retry_words(code: str) -> str:
    """Return how a client goes on after a code: :py:data:`RETRY`'s words, or that the request must change.

    Args:
        code: A key of :py:data:`CODES`.

    Returns:
        str: The words.
    """
    return RETRY[code][1] if code in RETRY else NOT_RETRYABLE


class ApiError(Exception):
    """An error answered to the client.

    Attributes:
        code: A key of :py:data:`CODES`.
        status: Its HTTP status.
        message: What went wrong and what to change.
        argument: The argument concerned, if any.
        allowed: The accepted values, if they can be listed.
        details: For ``invalid_request``: the problems, as ``{"location": [...], "message": ...}``.
        headers: Extra response headers (``Retry-After``).
        allowance: For ``rate_limited``: the allowance used up (a key of :py:data:`ALLOWANCES`).
        progress: For ``request_budget_exceeded``: how far the search went (``answered`` of ``of`` ``items``).
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        argument: str | None = None,
        allowed: Sequence[Any] | None = None,
        details: list[dict[str, Any]] | None = None,
        headers: dict[str, str] | None = None,
        allowance: str | None = None,
        progress: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        if code not in CODES:
            msg = f"Unknown error code {code!r}"
            raise ValueError(msg)
        self.code = code
        self.status = CODES[code][0]
        self.message = message
        self.argument = argument
        self.allowed = None if allowed is None else [_scalar(v) for v in allowed]
        self.details = details
        self.headers = headers or {}
        if allowance is not None and allowance not in ALLOWANCES:
            msg = f"Unknown allowance {allowance!r}"
            raise ValueError(msg)
        self.allowance = allowance
        self.progress = progress

    def body(self, request_id: str) -> dict[str, Any]:
        """Return the response body.

        Args:
            request_id: The request's id.

        Returns:
            dict[str, Any]: ``{"error": {...}}`` as :py:class:`idtrack_web_api.schemas.ErrorResponse` describes it.
        """
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "argument": self.argument,
                "allowed": self.allowed,
                "details": self.details,
                "request_id": request_id,
                "retry_after": int(self.headers["Retry-After"]) if "Retry-After" in self.headers else None,
                "allowance": self.allowance,
                "progress": self.progress,
            }
        }


def listed(values: Sequence[Any], most: int = 20) -> str:
    """Return values as words for a message: each in backticks, joined by commas, at most *most* (then a count).

    Args:
        values: The values.
        most: The most values written out.

    Returns:
        str: ```a`, `b` and `c``` (``and 3 more`` beyond *most*).
    """
    shown = [f"`{v}`" for v in list(values)[:most]]
    more = len(values) - len(shown)
    if more:
        shown.append(f"{more} more")
    if len(shown) <= 1:
        return "".join(shown)
    return ", ".join(shown[:-1]) + " and " + shown[-1]


def sentences(parts: Sequence[str]) -> str:
    """Return messages joined into one: each without its final full stop, joined by semicolons, with one at the end.

    Args:
        parts: Messages, each a sentence.

    Returns:
        str: One sentence.
    """
    return "; ".join(p.rstrip().rstrip(".") for p in parts) + "."


def _scalar(value: Any) -> str | int:
    """Return an allowed value as a JSON string or integer."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return str(value)
    return int(value) if isinstance(value, int) else value


def error_json(error: ApiError, request_id: str) -> bytes:
    """Return the JSON bytes of an error response.

    Args:
        error: The error.
        request_id: The request's id.

    Returns:
        bytes: The body.
    """
    return json.dumps(error.body(request_id), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
