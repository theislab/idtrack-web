r"""A batch's results as a tab-separated table: one row per candidate (one row for a result without candidates).

The table holds every field of a result and of its candidates except the explained path and the candidates' indices
into it (``path``, ``final_path``: a graph, not a row; ask for JSON for it), the api's code of an item's error
(``error_code``), and the codes of the result's cautions (``cautions``; their texts: JSON). The first line names the
columns (:py:data:`COLUMNS`; :py:data:`COLUMN_TEXTS` says what each holds).
Values are written as JSON writes them, so nothing is rounded: numbers as Python's ``repr`` (the shortest text that
reads back as the same float), ``true``/``false``, an empty cell for ``null``, and lists joined by ``;`` (no identifier
holds a ``;``, a tab or a line break inside it: the api refuses control characters in input, and :py:func:`rows`
refuses any value that would break the table). ``other_readings``, a list of objects, is written as its compact JSON
(empty when the list is). The two texts that may hold any character, ``query_id`` (the identifier as sent, which may
begin or end with white space such as a tab: idtrack reads it without) and ``error_message``, are written with each
backslash, tab, line feed and carriage return as a backslash followed by ``\\``, ``t``, ``n`` or ``r``.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

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
    "cautions",
    "error_code",
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

#: What each column holds: the field of the result (or of the candidate) it is, and how it is written.
COLUMN_TEXTS: dict[str, str] = {
    "input_index": "The item's place in the batch, from 0 (the result's place in `results`).",
    "query_id": "`query_id`: the identifier as sent (escaped: a backslash before `\\`, `t`, `n`, `r`).",
    "candidate_count": "The number of the result's candidates (its rows; 0 on the one row of a result without any).",
    "other_readings": "`other_readings` as compact JSON (empty for none).",
    "cautions": (
        "The codes of `cautions` (the api's reading of the result's evidence; `cautions` of `GET /api/v1/vocabulary`), "
        "joined by `;` (empty for none)."
    ),
    "error_code": "The api's code of the item's error (`error.code`; `errors` of `GET /api/v1/vocabulary`).",
    "error_type": "`error.type`: the class of idtrack's error.",
    "error_message": "`error.message` (escaped as `query_id`).",
    "error_input_error": "`error.input_error`.",
    "rank": "The candidate's place in `candidates`, from 1 (empty on the row of a result without candidates).",
}


#: The result columns that carry an item's error (empty unless its status is ``error``).
ERROR_COLUMNS: tuple[str, ...] = ("error_code", "error_type", "error_message", "error_input_error")


def column_group(name: str) -> str:
    """Return which part of a result a column is of: ``result``, ``error`` (of the result) or ``candidate``.

    Args:
        name: A column of :py:data:`COLUMNS`.

    Returns:
        str: The group.
    """
    if name in ERROR_COLUMNS:
        return "error"
    return "result" if name in RESULT_COLUMNS else "candidate"


def column_text(name: str) -> str:
    """Return what a column holds: its text in :py:data:`COLUMN_TEXTS`, else the field of the result or candidate.

    Args:
        name: A column of :py:data:`COLUMNS`.

    Returns:
        str: The text.
    """
    return COLUMN_TEXTS.get(name, f"`{name}` of the {'candidate' if name in CANDIDATE_COLUMNS else 'result'}.")


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
            msg = f"A value holds a tab or a line break: {value!r}"
            raise TableError(msg)
        return value
    if isinstance(value, list):
        items = [cell(v) for v in value]
        if any(";" in item for item in items):
            msg = f"A list item holds ';': {value!r}"
            raise TableError(msg)
        return ";".join(items)
    msg = f"A value of type {type(value).__name__} has no cell: {value!r}"
    raise TableError(msg)


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
            "query_id": _escaped(result.get("query_id")),
            "candidate_count": len(result["candidates"]),
            "other_readings": _json(result["other_readings"]),
            "cautions": [c["code"] for c in result.get("cautions", [])],
            "error_code": error.get("code"),
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


def lines(results: Sequence[dict[str, Any]]) -> Iterable[str]:
    """Yield the lines of a batch's results as tab-separated text (the header first), each ending in a newline.

    Args:
        results: The results.

    Yields:
        str: A line.
    """
    for row in rows(results):
        yield "\t".join(row) + "\n"


def write(results: Sequence[dict[str, Any]]) -> str:
    """Return a batch's results as tab-separated text (a header line, then one line per row, each ending in a newline).

    Args:
        results: The results.

    Returns:
        str: The table.
    """
    return "".join(lines(results))
