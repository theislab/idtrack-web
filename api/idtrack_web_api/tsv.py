r"""A batch's results as a tab-separated table: one row per candidate (one row for a result without candidates).

The table holds every field of a result and of its candidates except the explained path and the candidates' indices
into it (``path``, ``final_path``: a graph, not a row; ask for JSON for it). Values are written as JSON writes them,
so nothing is rounded: numbers as Python's ``repr`` (the shortest text that reads back as the same float),
``true``/``false``, an empty cell for ``null``, and lists joined by ``;`` (no identifier holds a ``;``, a tab or a line
break: the api refuses control characters in input, and :py:func:`write` refuses any value that would break the
table). ``other_readings``, a list of objects, is written as its compact JSON (empty when the list is). The one free
text, ``error_message``, is written with each backslash, tab, line feed and carriage return as a backslash followed by
``\\``, ``t``, ``n`` or ``r``.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from typing import Any

#: The columns of each result, repeated on each of its rows.
RESULT_COLUMNS: tuple[str, ...] = (
    "input_index",
    "query_id",
    "status",
    "reason",
    "reasons",
    "graph_id",
    "match",
    "known_versions",
    "from_release",
    "from_release_inferred",
    "from_release_given",
    "from_release_fallback",
    "from_databases",
    "to_release",
    "final_database",
    "candidate_count",
    "tie",
    "decided_by",
    "alternative_locus_genes",
    "no_target",
    "no_target_genes",
    "other_readings",
    "error_type",
    "error_message",
    "error_input_error",
)

#: The columns of each candidate (empty on the row of a result without candidates).
CANDIDATE_COLUMNS: tuple[str, ...] = (
    "rank",
    "best",
    "gene",
    "target",
    "entry_gene",
    "entry_databases",
    "authority",
    "display_name",
    "display_rank",
    "entry_support",
    "own_version",
    "final_confidence",
    "bridges",
    "bridge_gap",
    "score",
    "unscored_steps",
    "same_as_query",
    "external_steps",
    "history_steps",
    "annotation",
)

COLUMNS: tuple[str, ...] = RESULT_COLUMNS + CANDIDATE_COLUMNS


class TableError(ValueError):
    """A value that a tab-separated cell cannot hold exactly."""


def _escaped(text: str | None) -> str | None:
    """Return a free text with backslash, tab, line feed and carriage return as backslash sequences."""
    if text is None:
        return None
    return text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def _json(value: list[Any]) -> str | None:
    """Return a list of objects as its compact JSON (``None``, an empty cell, for an empty list)."""
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) if value else None


def cell(value: Any) -> str:
    """Return a value as the text of a cell.

    Args:
        value: A JSON value of a result (no object).

    Returns:
        str: The text.

    Raises:
        TableError: For a value with a tab, a line break or a ``;`` inside a list, or an object.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        if any(ch in value for ch in "\t\r\n"):
            raise TableError(f"A value holds a tab or a line break: {value!r}")
        return value
    if isinstance(value, list):
        items = [cell(v) for v in value]
        if any(";" in item for item in items):
            raise TableError(f"A list item holds ';': {value!r}")
        return ";".join(items)
    raise TableError(f"A value of type {type(value).__name__} has no cell: {value!r}")


def rows(results: Sequence[dict[str, Any]]) -> Iterable[list[str]]:
    """Yield the rows of a batch's results (``to_dict()`` of each), the header first.

    Args:
        results: The results, in input order.

    Yields:
        list[str]: The cells of a row.
    """
    yield list(COLUMNS)
    for index, result in enumerate(results):
        error = result.get("error") or {}
        head = {
            **{k: result[k] for k in RESULT_COLUMNS if k in result},
            "input_index": index,
            "candidate_count": len(result["candidates"]),
            "other_readings": _json(result["other_readings"]),
            "error_type": error.get("type"),
            "error_message": _escaped(error.get("message")),
            "error_input_error": error.get("input_error"),
        }
        start = [cell(head[k]) for k in RESULT_COLUMNS]
        if not result["candidates"]:
            yield start + [""] * len(CANDIDATE_COLUMNS)
            continue
        for rank, candidate in enumerate(result["candidates"], start=1):
            values = {**candidate, "rank": rank}
            yield start + [cell(values[k]) for k in CANDIDATE_COLUMNS]


def write(results: Sequence[dict[str, Any]]) -> str:
    """Return a batch's results as tab-separated text (a header line, then one line per row, each ending in a newline).

    Args:
        results: The results.

    Returns:
        str: The table.
    """
    return "".join("\t".join(row) + "\n" for row in rows(results))
