"""The api's errors: each has an HTTP status, a stable code and a message that says what to change.

idtrack's refusals of an input arrive through the adapter (:py:func:`idtrack_web_api.adapter.input_problem`) with a code
of their own (a 4xx); a search over its budget is ``422 search_budget_exceeded``; anything else is
``500 internal_error`` with the request's id to quote, and its traceback goes to the server's log only.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

#: Every code the api answers with, its status and when (README.md lists the same table).
CODES: dict[str, tuple[int, str]] = {
    "invalid_request": (400, "The request does not have the shape the endpoint takes (`details` lists each problem)."),
    "unknown_parameter": (400, "A query parameter the endpoint does not take, or one given twice."),
    "invalid_identifier": (
        400,
        "An identifier or name is longer than this server accepts, or holds control, surrogate, private-use or "
        "unassigned characters.",
    ),
    "unknown_release": (400, "A release the graph does not cover."),
    "unknown_database": (400, "A database the graph does not hold at that release."),
    "unknown_identifier": (
        400,
        "An identifier the call needs to exist in the graph does not (e.g. the gene of names-of).",
    ),
    "unknown_assembly": (400, "An assembly the graph does not hold."),
    "inactive_at_release": (400, "An Ensembl id at a release where it is not active."),
    "unknown_version": (400, "An Ensembl id with a version the graph does not hold."),
    "missing_value": (400, "An identifier is empty or a spelling of a missing value (idtrack's refusal)."),
    "argument_type": (400, "An argument of the wrong type."),
    "invalid_argument": (400, "An argument whose value is not accepted."),
    "invalid_input": (400, "Another input idtrack does not accept."),
    "unknown_organism": (404, "An organism this server does not hold."),
    "not_found": (404, "No such endpoint or file."),
    "method_not_allowed": (405, "The endpoint does not take this method."),
    "request_budget_exceeded": (408, "The request needed more time than its budget; send fewer identifiers."),
    "payload_too_large": (413, "The request body is larger than the server accepts."),
    "too_many_identifiers": (413, "A batch with more identifiers than the server accepts."),
    "unsupported_media_type": (415, "A request body that is not `application/json`."),
    "search_budget_exceeded": (422, "One identifier's search needed more than its budget (states or seconds)."),
    "response_too_large": (422, "The answer is larger than the server sends; ask without `explain` or for fewer ids."),
    "rate_limited": (429, "Too many requests from this client; wait for `Retry-After` seconds."),
    "internal_error": (500, "A fault of the server; quote the request id when reporting it."),
    "server_busy": (503, "The server has more waiting work than it accepts; retry after `Retry-After` seconds."),
}


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
    ) -> None:
        super().__init__(message)
        if code not in CODES:
            raise ValueError(f"Unknown error code {code!r}")
        self.code = code
        self.status = CODES[code][0]
        self.message = message
        self.argument = argument
        self.allowed = None if allowed is None else [_scalar(v) for v in allowed]
        self.details = details
        self.headers = headers or {}

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
            }
        }


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
