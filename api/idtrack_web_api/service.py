"""What the endpoints do, apart from HTTP: bound the request, call idtrack through the adapter, return its data.

The api checks only what HTTP itself must bound (lengths, control characters, the request's time); which releases,
databases and identifiers a graph accepts, and what an empty string or a spelling of a missing value is, is idtrack's to
decide (:py:mod:`idtrack_web_api.adapter`), and its refusals
are answered with their own codes. Every function here that searches runs on the worker's search thread
(:py:class:`idtrack_web_api.limits.SearchSlot`). Results are idtrack's ``to_dict()``, unchanged.
"""

from __future__ import annotations

import time
import unicodedata
from typing import Any

from idtrack_web_api.adapter import (
    SEARCH_BUDGET_ERROR_TYPE,
    ConversionArguments,
    InputRefusedError,
    SearchBudgetError,
    batch_groups,
)
from idtrack_web_api.config import Settings
from idtrack_web_api.errors import ApiError
from idtrack_web_api.graphs import LoadedGraph

#: The longest database name the api passes on (the longest of Ensembl's is under 50 characters).
DATABASE_MAX_LENGTH = 200


def _control_characters(text: str) -> list[int]:
    """Return the positions of control, surrogate, private-use and unassigned characters."""
    return [i for i, ch in enumerate(text) if unicodedata.category(ch) in {"Cc", "Cs", "Co", "Cn"}]


def check_text(value: str, name: str, settings: Settings, location: list[str | int] | None = None) -> str | None:
    """Return what is wrong with an identifier or name for HTTP, or ``None`` when it may be passed to idtrack.

    Only the server's bounds: its length and characters a table or a log cannot hold. An empty string is idtrack's to
    answer (a refusal, ``missing_value``; in a batch, that item's error; for a name, no match), as it answers it.

    Args:
        value: The text.
        name: The argument's name.
        settings: The bounds.
        location: Where the value is (for a batch item).

    Returns:
        str | None: The problem in words.
    """
    where = name if location is None else ".".join(str(p) for p in location)
    if len(value) > settings.identifier_max_length:
        return f"`{where}` has {len(value)} characters; at most {settings.identifier_max_length} are accepted."
    bad = _control_characters(value)
    if bad:
        return f"`{where}` holds control or unassigned characters at positions {bad[:10]}."
    return None


def require_text(value: str, name: str, settings: Settings) -> str:
    """Return *value* if :py:func:`check_text` finds nothing wrong, else raise.

    Args:
        value: The text.
        name: The argument's name.
        settings: The bounds.

    Returns:
        str: The value, unchanged.

    Raises:
        ApiError: ``invalid_identifier``.
    """
    problem = check_text(value, name, settings)
    if problem is not None:
        raise ApiError("invalid_identifier", problem, argument=name)
    return value


def check_database_text(value: str | None, name: str) -> None:
    """Refuse a database name that is empty or longer than any database name.

    Args:
        value: The name.
        name: The argument's name.

    Raises:
        ApiError: ``invalid_argument``.
    """
    if value is not None and (not value.strip() or len(value) > DATABASE_MAX_LENGTH):
        raise ApiError(
            "invalid_argument",
            f"`{name}` must be a database name of 1 to {DATABASE_MAX_LENGTH} characters.",
            argument=name,
        )


def conversion_arguments(
    from_release: int | None,
    to_release: int | None,
    final_database: str | None,
    from_database: str | None,
    explain: bool,
    allow_bridges: bool,
) -> ConversionArguments:
    """Return a conversion's arguments after the api's own bounds.

    Args:
        from_release: See the endpoint.
        to_release: See the endpoint.
        final_database: See the endpoint.
        from_database: See the endpoint.
        explain: See the endpoint.
        allow_bridges: See the endpoint.

    Returns:
        ConversionArguments: The arguments.
    """
    check_database_text(final_database, "final_database")
    check_database_text(from_database, "from_database")
    return ConversionArguments(from_release, to_release, final_database, from_database, explain, allow_bridges)


def answered(problem: InputRefusedError) -> ApiError:
    """Return the api error of idtrack's refusal of an input.

    Args:
        problem: The refusal.

    Returns:
        ApiError: The error, with idtrack's message, argument and accepted values.
    """
    return ApiError(problem.code, problem.message, argument=problem.argument, allowed=problem.allowed)


def _remaining(deadline: float) -> float:
    return deadline - time.monotonic()


def _busy(settings: Settings) -> ApiError:
    return ApiError(
        "server_busy",
        f"The request waited its whole time budget ({settings.request_seconds} s) for the server; retry later.",
        headers={"Retry-After": "5"},
    )


def _out_of_time(settings: Settings, converted: int, total: int) -> ApiError:
    return ApiError(
        "request_budget_exceeded",
        f"{converted} of the {total} distinct identifiers were converted within the request's time budget "
        f"({settings.request_seconds} s); send fewer identifiers per request (or ask without `explain`).",
    )


def convert_one(
    graph: LoadedGraph, identifier: str, arguments: ConversionArguments, settings: Settings, deadline: float
) -> dict[str, Any]:
    """Convert one identifier: idtrack's ``API.convert(...).to_dict()``.

    Args:
        graph: The graph.
        identifier: The identifier (checked by :py:func:`require_text`).
        arguments: The arguments.
        settings: The budgets.
        deadline: The request's deadline (``time.monotonic()``).

    Returns:
        dict[str, Any]: The result.

    Raises:
        ApiError: For an input idtrack refuses, a search over its budget, or a request out of time.
    """
    remaining = _remaining(deadline)
    if remaining <= 0:
        raise _busy(settings)
    budget = min(settings.search_seconds, remaining)
    try:
        return graph.graph.convert(identifier, arguments, budget)
    except InputRefusedError as problem:
        raise answered(problem) from None
    except SearchBudgetError as error:
        if budget < settings.search_seconds and not error.states_exhausted:
            raise ApiError(
                "request_budget_exceeded",
                f"The request ran out of its time budget ({settings.request_seconds} s, most of it spent waiting for "
                "the server) during the search; retry later.",
            ) from None
        raise ApiError(
            "search_budget_exceeded",
            f"{error.message} The server's budget of one search is {settings.search_states} states and "
            f"{settings.search_seconds} s; ask with `allow_bridges=false`, or with the release the identifier is read "
            "at.",
        ) from None


def convert_batch(
    graph: LoadedGraph, identifiers: list[str], arguments: ConversionArguments, settings: Settings, deadline: float
) -> list[dict[str, Any]]:
    """Convert a batch: what idtrack's ``API.convert_many(identifiers, ...)`` returns, each ``to_dict()``, in order.

    The distinct identifiers are converted in the groups that idtrack answers together
    (:py:func:`idtrack_web_api.adapter.batch_groups`: an item and the items that extend it by a numbered suffix, which
    idtrack may answer as its copies; every other item alone), one ``convert_many`` call per group, so that every
    item gets the answer of one call over the whole batch and the request's time budget is checked between groups;
    an error of one identifier is that item's ``error``, as idtrack records it.

    Args:
        graph: The graph.
        identifiers: The identifiers (each checked by :py:func:`check_text`).
        arguments: The arguments.
        settings: The budgets.
        deadline: The request's deadline.

    Returns:
        list[dict[str, Any]]: One result per identifier.

    Raises:
        ApiError: For an input idtrack refuses, or a request out of time (``request_budget_exceeded``; also when an
            identifier ran out of time only because the request had less time left than a search's budget).
    """
    groups = batch_groups(identifiers)
    total = sum(len(group) for group in groups)
    done: dict[str, dict[str, Any]] = {}
    for group in groups:
        remaining = _remaining(deadline)
        if remaining <= 0:
            raise _out_of_time(settings, len(done), total) if done else _busy(settings)
        budget = min(settings.search_seconds, remaining)
        try:
            results = graph.graph.convert_many(group, arguments, budget)
        except InputRefusedError as problem:
            raise answered(problem) from None
        for result in results:
            error = result.get("error") or {}
            if error.get("type") == SEARCH_BUDGET_ERROR_TYPE and budget < settings.search_seconds:
                raise _out_of_time(settings, len(done), total)
        done.update(zip(group, results, strict=True))
    return [done[identifier] for identifier in identifiers]


def final_databases(graph: LoadedGraph, to_release: int | None) -> list[str]:
    """Return idtrack's ``API.final_databases(to_release)``.

    Args:
        graph: The graph.
        to_release: The target release (``None``: the snapshot release).

    Returns:
        list[str]: The databases.

    Raises:
        ApiError: For a release idtrack refuses.
    """
    try:
        return graph.graph.final_databases(to_release)
    except InputRefusedError as problem:
        raise answered(problem) from None


def genes_named(graph: LoadedGraph, name: str, fold_case: bool) -> list[dict[str, Any]]:
    """Return idtrack's ``API.genes_named(name, fold_case)``, each ``to_dict()``.

    Args:
        graph: The graph.
        name: The name (checked by :py:func:`require_text`).
        fold_case: Match without letter case.

    Returns:
        list[dict[str, Any]]: The matches.

    Raises:
        ApiError: For an input idtrack refuses.
    """
    try:
        return graph.graph.genes_named(name, fold_case)
    except InputRefusedError as problem:
        raise answered(problem) from None


def names_of(graph: LoadedGraph, gene: str, release: int | None) -> list[dict[str, Any]]:
    """Return idtrack's ``API.names_of(gene, release)``, each ``to_dict()``.

    Args:
        graph: The graph.
        gene: An Ensembl gene id with version (checked by :py:func:`require_text`).
        release: Only names that hold at this release.

    Returns:
        list[dict[str, Any]]: The names.

    Raises:
        ApiError: For an input idtrack refuses (an unknown gene or release).
    """
    try:
        return graph.graph.names_of(gene, release)
    except InputRefusedError as problem:
        raise answered(problem) from None
