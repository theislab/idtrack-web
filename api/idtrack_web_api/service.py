"""What the endpoints do, apart from HTTP: bound the request, call idtrack through the adapter, return its data.

The api checks only what HTTP itself must bound (lengths, control characters, the request's time); which releases,
databases and identifiers a graph accepts, and what an empty string or a spelling of a missing value is, is idtrack's to
decide (:py:mod:`idtrack_web_api.adapter`), and its refusals
are answered with their own codes. Every function here that searches runs on the worker's search thread
(:py:class:`idtrack_web_api.limits.SearchSlot`). Results are idtrack's ``to_dict()``, unchanged, with the api's reading
of their evidence beside (``cautions``: :py:func:`with_cautions`).
"""

from __future__ import annotations

import time
import unicodedata
from dataclasses import replace
from typing import TYPE_CHECKING, Any

from idtrack_web_api.adapter import (
    SEARCH_BUDGET_ERROR_TYPE,
    ConversionArguments,
    InputRefusedError,
    SearchBudgetError,
    batch_groups,
    item_error_code,
)
from idtrack_web_api.cautions import Facts, cautions_of
from idtrack_web_api.errors import ApiError, listed
from idtrack_web_api.schemas import DATABASE_MAX_LENGTH

if TYPE_CHECKING:
    from collections.abc import Callable

    from idtrack_web_api.adapter import Graph
    from idtrack_web_api.config import Settings
    from idtrack_web_api.graphs import LoadedGraph


def _control_characters(text: str) -> list[int]:
    """Return the positions of control, surrogate, private-use and unassigned characters."""
    return [i for i, ch in enumerate(text) if unicodedata.category(ch) in {"Cc", "Cs", "Co", "Cn"}]


def check_text(value: str, name: str, settings: Settings, location: list[str | int] | None = None) -> str | None:
    """Return what is wrong with an identifier or name for HTTP, or ``None`` when it may be passed to idtrack.

    Only the server's bounds: its length, and characters a table or a log cannot hold inside the identifier. White space
    at either end (spaces, tabs, line breaks: what a list cut from a table often keeps) is no part of an identifier:
    idtrack reads the identifier without it (``str.strip``) and records nothing for it, and the result's ``query_id``
    keeps the string as it was sent; so only the characters between the ends are checked. An empty string is idtrack's
    to answer (a refusal, ``missing_value``; in a batch, that item's error; for a name, no match), as it answers it.

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
        return f"`{where}` has {len(value)} characters; at most {settings.identifier_max_length} are accepted"
    inner = value.strip()
    lead = len(value) - len(value.lstrip())
    bad = [lead + i for i in _control_characters(inner)]
    if bad:
        shown = ", ".join(str(i) for i in bad[:10]) + (f" and {len(bad) - 10} more" if len(bad) > 10 else "")
        one = len(bad) == 1
        what = "a control or unassigned character" if one else "control or unassigned characters"
        return f"`{where}` holds {what} inside it, at {'character' if one else 'characters'} {shown} (counted from 0)"
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
        msg = "invalid_identifier"
        raise ApiError(msg, problem + ".", argument=name)
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
        msg = "invalid_argument"
        raise ApiError(
            msg,
            f"`{name}` must be a database name of 1 to {DATABASE_MAX_LENGTH} characters.",
            argument=name,
        )


def conversion_arguments(
    from_release: int | None,
    to_release: int | None,
    final_database: str | None,
    from_database: str | None,
    *,
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
    return ConversionArguments(
        from_release=from_release,
        to_release=to_release,
        final_database=final_database,
        from_database=from_database,
        explain=explain,
        allow_bridges=allow_bridges,
    )


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


def waited_out(settings: Settings, waited: float) -> ApiError:
    """Return the refusal of a search that waited longer for a worker than a search may (it is not searched).

    Args:
        settings: The bounds (``queue_seconds``).
        waited: The seconds it waited.

    Returns:
        ApiError: ``server_busy``: the server's load, not the request, is the cause.
    """
    return ApiError(
        "server_busy",
        f"The search waited {waited:.1f} s for a worker, more than the {settings.queue_seconds:g} s a search may wait "
        "(`queue_seconds`), and was not searched: the server is busy; retry in a few seconds.",
        headers={"Retry-After": "5"},
    )


def out_of_time(settings: Settings, converted: int, total: int) -> ApiError:
    """Return the refusal of a batch whose time budget ran out after *converted* of its *total* identifiers.

    Every search is made with its path (the cautions read it), so asking without ``explain`` makes a batch's answer
    smaller but its searches no shorter: the one change that helps is fewer identifiers per request, named as the
    refusal's ``argument``.

    Args:
        settings: The server's settings (its request budget).
        converted: The distinct identifiers converted in time.
        total: The batch's distinct identifiers.

    Returns:
        ApiError: The ``request_budget_exceeded`` refusal, with ``Retry-After`` and ``argument`` ``identifiers``.
    """
    return ApiError(
        "request_budget_exceeded",
        f"{converted} of the {total} distinct identifiers were converted within the request's time budget "
        f"({settings.request_seconds:g} s of search, counted from when its search began); send fewer identifiers per "
        "request.",
        argument="identifiers",
        headers={"Retry-After": "5"},
        progress={"answered": converted, "of": total, "items": "identifiers"},
    )


def _searched(arguments: ConversionArguments) -> ConversionArguments:
    """Return the arguments a search is made with: always with its path, which the cautions read."""
    return replace(arguments, explain=True)


def caution_facts(graph: Graph, asked: str | None, budget_seconds: float) -> Facts:
    """Return what the rules of the cautions read beside a result, from idtrack's own calls on the graph.

    The organism's name authority at a release is the first of its symbol databases (IDTrack's order) that a
    conversion to the release can end in; a gene's symbols there are the best targets of IDTrack's conversion of the
    gene read at that release, to it, without bridges (each gene alone); the genes to which a database gives a name at
    a release are IDTrack's ``genes_named`` in any letter case, its matches of that database that are no synonym and
    hold at the release (looked up first, so that symbols are converted only for a name some gene carries), each with
    the first release from which a version of the same stable id holds it there without a break (the graph's
    releases, one after another, back from that release).

    Args:
        graph: The graph (the adapter's).
        asked: The database the conversion asked for (``None``: Ensembl genes).
        budget_seconds: The search budget of each gene's conversion (a conversion over it gives the gene no symbol).

    Returns:
        Facts: The facts.
    """
    symbol_databases = tuple(graph.databases().get("symbol_databases", ()))
    finals: dict[int, list[str]] = {}

    def authority_at(release: int) -> str | None:
        if release not in finals:
            try:
                finals[release] = graph.final_databases(release)
            except InputRefusedError:
                finals[release] = []
        return next((d for d in symbol_databases if d in finals[release]), None)

    releases = list(graph.releases())

    def holders(name: str, database: str, release: int) -> dict[str, int]:
        try:
            matches = graph.genes_named(name, fold_case=True)
        except InputRefusedError:
            return {}
        typed = name.lower()
        held: dict[str, set[int]] = {}
        at: dict[str, str] = {}
        for m in matches:
            if m["database"] != database or m["synonym"] or m["name"].lower() != typed:
                continue
            stable = m["gene"].rsplit(".", 1)[0]
            held.setdefault(stable, set()).update(int(r) for r in m.get("releases", ()))
            if release in m.get("releases", ()):
                at[stable] = m["gene"]
        found: dict[str, int] = {}
        for stable, gene in at.items():
            first = release
            for earlier in reversed([r for r in releases if r < release]):
                if earlier not in held[stable]:
                    break
                first = earlier
            found[gene] = first
        return found

    def symbols_of(genes: list[str], release: int, database: str) -> dict[str, list[str]]:
        arguments = ConversionArguments(
            from_release=release,
            to_release=release,
            final_database=database,
            from_database=None,
            explain=False,
            allow_bridges=False,
        )
        found: dict[str, list[str]] = {}
        for gene in genes:
            try:
                result = graph.convert(gene, arguments, budget_seconds)
            except (InputRefusedError, SearchBudgetError):
                found[gene] = []
                continue
            best = [c["target"] for c in result.get("candidates", []) if c.get("best")]
            found[gene] = [] if result.get("no_target") else list(dict.fromkeys(best))
        return found

    return Facts(symbol_databases, authority_at, holders, symbols_of, asked)


def with_cautions(result: dict[str, Any], facts: Facts, *, explain: bool) -> dict[str, Any]:
    """Add a result's cautions (:py:mod:`idtrack_web_api.cautions`), then drop its path where it was not asked for.

    A result searched with its path and stripped of it is IDTrack's result without the path, field for field (the
    path, and each candidate's indices into it, ``path`` and ``final_path``, empty): ``tests/test_endpoints.py`` holds
    the API to it.

    Args:
        result: IDTrack's ``to_dict()`` of a search made with its path.
        facts: What the rules read beside the result (:py:func:`caution_facts`).
        explain: Whether the request asked for the path.

    Returns:
        dict[str, Any]: The result, with ``cautions``.
    """
    result["cautions"] = [] if result.get("status") == "error" else cautions_of(result, facts)
    if not explain:
        result["path"] = None
        for candidate in result.get("candidates", []):
            candidate["path"] = []
            candidate["final_path"] = []
    return result


def convert_one(
    graph: LoadedGraph, identifier: str, arguments: ConversionArguments, settings: Settings, deadline: float
) -> dict[str, Any]:
    """Convert one identifier: idtrack's ``API.convert(...).to_dict()``, with its cautions.

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
    budget = min(settings.search_seconds, max(0.0, _remaining(deadline)))
    try:
        result = graph.graph.convert(identifier, _searched(arguments), budget)
    except InputRefusedError as problem:
        raise answered(problem) from None
    except SearchBudgetError as error:
        if budget < settings.search_seconds and not error.states_exhausted:
            msg = "request_budget_exceeded"
            raise ApiError(
                msg,
                f"The request's time budget ({settings.request_seconds:g} s of search) ran out during this search, "
                "after the searches before it in the same request; ask for fewer at once.",
                headers={"Retry-After": "5"},
            ) from None
        msg = "search_budget_exceeded"
        raise ApiError(
            msg,
            f"{error.message} The server's budget of one search is {settings.search_states} states and "
            f"{settings.search_seconds} s; ask with `allow_bridges=false`, or with the release the identifier is read "
            "at.",
        ) from None
    facts = caution_facts(graph.graph, arguments.final_database, settings.search_seconds)
    return with_cautions(result, facts, explain=arguments.explain)


def convert_batch(
    graph: LoadedGraph,
    identifiers: list[str],
    arguments: ConversionArguments,
    settings: Settings,
    deadline: float,
    *,
    read_copies: bool = True,
    abandoned: Callable[[], bool] = lambda: False,
) -> list[dict[str, Any]]:
    """Convert a batch: what idtrack's ``API.convert_many(identifiers, ...)`` returns, each ``to_dict()``, in order.

    The distinct identifiers are converted in the groups that idtrack answers together
    (:py:func:`idtrack_web_api.adapter.batch_groups`: an item and the items that extend it by a numbered suffix, which
    idtrack may answer as its copies; every other item alone), one ``convert_many`` call per group, so that every
    item gets the answer of one call over the whole batch and the request's time budget is checked between groups;
    an error of one identifier is that item's ``error``, as idtrack records it, with the api's ``code`` of its kind
    added (:py:func:`idtrack_web_api.adapter.item_error_code`). Without *read_copies* every distinct item is a group
    of its own, so that each is answered as ``convert`` answers it alone.

    Args:
        graph: The graph.
        identifiers: The identifiers (each checked by :py:func:`check_text`).
        arguments: The arguments.
        settings: The budgets.
        deadline: The request's deadline.
        read_copies: Read an item that extends another by a numbered suffix as its copy (idtrack's reading).
        abandoned: Whether the client has gone (checked between groups: the rest is not searched).

    Returns:
        list[dict[str, Any]]: One result per identifier.

    Raises:
        ApiError: For an input idtrack refuses, or a request out of time (``request_budget_exceeded``; also when an
            identifier ran out of time only because the request had less time left than a search's budget).
    """
    groups = batch_groups(identifiers) if read_copies else [[item] for item in dict.fromkeys(identifiers)]
    facts = caution_facts(graph.graph, arguments.final_database, settings.search_seconds)
    total = sum(len(group) for group in groups)
    done: dict[str, dict[str, Any]] = {}
    for group in groups:
        if abandoned():
            msg = "request_timeout"
            raise ApiError(msg, "The client closed its connection during the batch; the rest was not searched.")
        remaining = _remaining(deadline)
        if remaining <= 0:
            raise out_of_time(settings, len(done), total)
        budget = min(settings.search_seconds, remaining)
        try:
            results = graph.graph.convert_many(group, _searched(arguments), budget)
        except InputRefusedError as problem:
            raise answered(problem) from None
        for result in results:
            error = result.get("error")
            if error is not None:
                if error.get("type") == SEARCH_BUDGET_ERROR_TYPE and budget < settings.search_seconds:
                    raise out_of_time(settings, len(done), total)
                error["code"] = item_error_code(str(error.get("type")))
            with_cautions(result, facts, explain=arguments.explain)
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


def check_release(graph: LoadedGraph, release: int | None, name: str) -> None:
    """Refuse a release the graph does not cover (as idtrack refuses one: ``unknown_release``, the releases allowed).

    Args:
        graph: The graph.
        release: The release (``None``: nothing to check).
        name: The argument's name.

    Raises:
        ApiError: ``unknown_release``.
    """
    releases = graph.graph.releases()
    if release is not None and release not in releases:
        msg = "unknown_release"
        raise ApiError(
            msg,
            f"`{name}`={release} is not a release of this graph, which covers the Ensembl releases {releases[0]} to "
            f"{releases[-1]}.",
            argument=name,
            allowed=list(releases),
        )


def genes_named(graph: LoadedGraph, name: str, *, fold_case: bool, release: int | None = None) -> list[dict[str, Any]]:
    """Return idtrack's ``API.genes_named(name, fold_case)``, each ``to_dict()``, those that hold at *release* only.

    idtrack's call answers for every release, each match listing its ``releases``; with *release*, the api keeps the
    matches whose ``releases`` hold it, unchanged and in idtrack's order (the meaning of the name at that release).

    Args:
        graph: The graph.
        name: The name (checked by :py:func:`require_text`).
        fold_case: Match without letter case.
        release: Only the matches that hold at this release (``None``: every match).

    Returns:
        list[dict[str, Any]]: The matches.

    Raises:
        ApiError: For an input idtrack refuses, or a release the graph does not cover.
    """
    check_release(graph, release, "release")
    try:
        matches = graph.graph.genes_named(name, fold_case=fold_case)
    except InputRefusedError as problem:
        raise answered(problem) from None
    return matches if release is None else [m for m in matches if release in m.get("releases", ())]


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
        versions = graph.graph.gene_versions(gene.strip()) if problem.code == "unknown_identifier" else ()
        if versions:
            msg = "invalid_argument"
            raise ApiError(
                msg,
                f"{gene.strip()!r} is an Ensembl id without its version; `gene` takes a gene id with version, and this "
                f"graph holds {listed(versions, 5)} (every one in `allowed`; `GET .../convert` reads an id without "
                "version at a release).",
                argument="gene",
                allowed=list(versions),
            ) from None
        raise answered(problem) from None


def source_inference(graph: LoadedGraph, identifiers: list[str], mode: str) -> dict[str, Any]:
    """Return idtrack's ``API.source_inference(identifiers, mode).to_dict()``.

    Args:
        graph: The graph.
        identifiers: The identifiers (each checked by :py:func:`check_text`).
        mode: What an origin is.

    Returns:
        dict[str, Any]: The inference.

    Raises:
        ApiError: For an input idtrack refuses (``unknown_identifier`` when none of the identifiers is in the graph).
    """
    try:
        return graph.graph.source_inference(identifiers, mode)
    except InputRefusedError as problem:
        raise answered(problem) from None


#: The parts of an origin of each mode of ``API.source_inference``, in the order idtrack writes them (its text of
#: ``SourceInference``: an origin is ``[database, assembly, release]``, ``release``, ``assembly`` or
#: ``[assembly, release]`` by the mode).
ORIGIN_PARTS: dict[str, tuple[str, ...]] = {
    "assembly_release": ("assembly", "release"),
    "release": ("release",),
    "assembly": ("assembly",),
    "complete": ("database", "assembly", "release"),
}


def named_origin(origin: Any, mode: str) -> dict[str, Any]:
    """Return an origin of idtrack's source inference with its parts named (``null`` for the parts the mode lacks).

    Args:
        origin: An origin as idtrack writes it for the mode (a list, or one value).
        mode: The mode.

    Returns:
        dict[str, Any]: ``database``, ``assembly`` and ``release``.
    """
    parts = ORIGIN_PARTS[mode]
    values = list(origin) if isinstance(origin, (list, tuple)) else [origin]
    named = dict(zip(parts, values, strict=True))
    return {part: named.get(part) for part in ("database", "assembly", "release")}


def convert_each_database(
    graph: LoadedGraph, identifier: str, arguments: ConversionArguments, settings: Settings, deadline: float
) -> tuple[int, list[dict[str, Any]]]:
    """Convert one identifier into every database a conversion to the target release can end in.

    One idtrack ``API.convert`` per database of ``API.final_databases(to_release)``, in that order, each exactly as
    :py:func:`convert_one` with that ``final_database`` (the request's time budget checked before each).

    Args:
        graph: The graph.
        identifier: The identifier (checked by :py:func:`require_text`).
        arguments: The arguments (``final_database`` is set per database; ``explain`` is not taken).
        settings: The budgets.
        deadline: The request's deadline.

    Returns:
        tuple[int, list[dict[str, Any]]]: The target release, and ``{"database", "result"}`` per database.

    Raises:
        ApiError: As :py:func:`convert_one`; ``request_budget_exceeded`` when the databases do not all fit in the
            request's time budget.
    """
    to_release = graph.graph.identity().snapshot_release if arguments.to_release is None else arguments.to_release
    databases = final_databases(graph, to_release)
    found: list[dict[str, Any]] = []
    for database in databases:
        if _remaining(deadline) <= 0:
            msg = "request_budget_exceeded"
            raise ApiError(
                msg,
                f"{len(found)} of the {len(databases)} databases were answered within the request's time budget "
                f"({settings.request_seconds:g} s); ask `GET .../convert` for the databases you need.",
                headers={"Retry-After": "5"},
                progress={"answered": len(found), "of": len(databases), "items": "databases"},
            )
        each = ConversionArguments(
            from_release=arguments.from_release,
            to_release=to_release,
            final_database=database,
            from_database=arguments.from_database,
            explain=False,
            allow_bridges=arguments.allow_bridges,
        )
        found.append({"database": database, "result": convert_one(graph, identifier, each, settings, deadline)})
    return to_release, found
