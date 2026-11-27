"""Answers written within their bound: JSON (and a batch's table) that stops being written once it passes the bound.

An answer larger than ``response_max_bytes`` is refused, never cut. Writing it whole and measuring it after would cost
the whole answer's time and memory first (a batch with paths can be over 100 MB), so the writer measures as it goes:
it writes the objects and lists of the first :py:data:`DEPTH` levels part by part (each part with Python's JSON writer,
written in C), adds up their bytes, and stops at the first part that passes the bound. The bytes are those of
``json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":"))`` exactly (``tests/test_writing.py``).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

#: The levels of objects and lists written part by part: a batch, its results, a result's lists (candidates, paths).
DEPTH = 3

_dumps: Callable[[Any], str] = json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode


class TooLargeError(Exception):
    """An answer passed its bound while it was written.

    Attributes:
        written: The bytes written when it stopped (more than the bound).
        limit: The bound.
    """

    def __init__(self, written: int, limit: int) -> None:
        super().__init__(f"more than {limit} bytes")
        self.written = written
        self.limit = limit


class _Out:
    def __init__(self, limit: int) -> None:
        self.parts: list[bytes] = []
        self.size = 0
        self.limit = limit

    def put(self, text: str) -> None:
        data = text.encode("utf-8")
        self.size += len(data)
        if self.size > self.limit:
            raise TooLargeError(self.size, self.limit)
        self.parts.append(data)


def _write(value: Any, out: _Out, depth: int) -> None:
    if depth < DEPTH and isinstance(value, dict) and value:
        out.put("{")
        first = True
        for key, item in value.items():
            if not isinstance(key, str):
                msg = f"keys must be strings, not {type(key).__name__}"
                raise TypeError(msg)
            out.put(("" if first else ",") + _dumps(key) + ":")
            _write(item, out, depth + 1)
            first = False
        out.put("}")
    elif depth < DEPTH and isinstance(value, (list, tuple)) and value:
        out.put("[")
        for i, item in enumerate(value):
            if i:
                out.put(",")
            _write(item, out, depth + 1)
        out.put("]")
    else:
        out.put(_dumps(value))


def json_bytes(data: Any, limit: int) -> bytes:
    """Return the JSON of *data* (UTF-8, compact, no NaN or infinity), refused once it passes *limit* bytes.

    Args:
        data: The answer.
        limit: The most bytes it may have.

    Returns:
        bytes: The JSON.

    Raises:
        TooLargeError: When it has more than *limit* bytes.
    """
    out = _Out(limit)
    _write(data, out, 0)
    return b"".join(out.parts)


def lines_bytes(lines: Iterable[str], limit: int) -> bytes:
    """Return lines of text (each with its line break) as UTF-8, refused once they pass *limit* bytes.

    Args:
        lines: The lines.
        limit: The most bytes.

    Returns:
        bytes: The text.

    Raises:
        TooLargeError: When it has more than *limit* bytes.
    """
    out = _Out(limit)
    for line in lines:
        out.put(line)
    return b"".join(out.parts)


__all__ = ["DEPTH", "TooLargeError", "json_bytes", "lines_bytes"]
