"""The one place where the web api calls idtrack.

Every name of idtrack the api uses is here: loading a graph, describing it, converting, looking up names, its errors,
its result classes (whose fields are the response schemas), its version. A renamed argument or class of idtrack is a
change of this module alone (and of its tests, ``tests/test_adapter.py``). The rest of the api speaks only to this
module and sees idtrack's results only as their ``to_dict()``, passed through unchanged.

The web api applies none of idtrack's rules itself: which releases, databases and identifiers a graph accepts is
decided by idtrack, whose input errors are translated here into :py:class:`InputRefusedError` (a stable code, idtrack's
message, the argument and the accepted values), and a search over its budget into :py:class:`SearchBudgetError`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from importlib import metadata
from typing import Any

import idtrack
from idtrack import errors as _errors
from idtrack import ids as _ids
from idtrack import results as _results
from idtrack.api import API
from idtrack.graph import GRAPH_FORMAT_VERSION
from idtrack.organisms import resolve_organism
from idtrack.settings import SearchSettings

#: The graph file format this idtrack reads.
FORMAT_VERSION: int = GRAPH_FORMAT_VERSION

#: idtrack's result classes whose ``to_dict()`` the api returns, by the name the api's schemas give them.
RESULT_CLASSES: dict[str, type] = {
    "ConversionResult": _results.ConversionResult,
    "Candidate": _results.Candidate,
    "OtherReading": _results.OtherReading,
    "ErrorInfo": _results.ErrorInfo,
    "ExplainedPath": _results.ExplainedPath,
    "PathNode": _results.PathNode,
    "GenePlace": _results.GenePlace,
    "PathStep": _results.PathStep,
    "BridgeCheck": _results.BridgeCheck,
    "GraphDescription": _results.GraphDescription,
    "AssemblyDescription": _results.AssemblyDescription,
    "NameMatch": _results.NameMatch,
}

# idtrack's input errors, the most specific first: the first class of an error's method resolution order found here
# names its code.
_INPUT_CODES: dict[type[BaseException], str] = {
    _errors.UnknownOrganismError: "unknown_organism",
    _errors.UnknownReleaseError: "unknown_release",
    _errors.UnknownDatabaseError: "unknown_database",
    _errors.UnknownAssemblyError: "unknown_assembly",
    _errors.UnknownIdentifierError: "unknown_identifier",
    _errors.InactiveAtReleaseError: "inactive_at_release",
    _errors.UnknownVersionError: "unknown_version",
    _errors.MissingValueError: "missing_value",
    _errors.ArgumentTypeError: "argument_type",
    _errors.InvalidArgumentError: "invalid_argument",
    _errors.InputError: "invalid_input",
}

#: idtrack's own tables of the codes its results carry: the outcomes (``ConversionResult.status``), why a result has no
#: target (``ConversionResult.reasons``), why a step of a path was taken (``PathStep.reason``), the criteria that rank
#: the candidates in the order in which they decide (``ConversionResult.decided_by``, each a field of ``Candidate``),
#: how an identifier matched (``ConversionResult.match``: a step after its prefixes), why another reading is reported
#: (``OtherReading.reason``), where two genes lie relative to each other (``BridgeCheck.places``, ``PathStep.places``)
#: and the rules that take or refuse a bridge (``BridgeCheck.through``). Statuses and criteria are tuples of codes in
#: idtrack; the others map codes to texts.
STATUSES: tuple[str, ...] = tuple(_results.STATUSES)
REASONS: dict[str, str] = dict(_results.REASONS)
STEP_REASONS: dict[str, str] = dict(_results.STEP_REASONS)
CRITERIA: tuple[str, ...] = tuple(_results.CRITERIA)
MATCH_STEPS: dict[str, str] = dict(_results.MATCH_STEPS)
MATCH_PREFIXES: dict[str, str] = dict(_results.MATCH_PREFIXES)
READING_REASONS: dict[str, str] = dict(_results.READING_REASONS)
PLACE_RELATIONS: dict[str, str] = dict(_results.PLACE_RELATIONS)
BRIDGE_RULES: dict[str, str] = dict(_results.BRIDGE_RULES)
BRIDGE_RULES_TAKEN: frozenset[str] = frozenset(_results.BRIDGE_RULES_TAKEN)

#: The pattern of a batch item that may be another item made unique by a single-cell tool (``<item>-1``, ``.1``,
#: ``_1``): idtrack's own (``idtrack.ids.NUMBERED_SUFFIX``), by which ``API.convert_many`` answers such an item as a
#: copy of the item it extends (``match`` ``copy:...``). The api converts the items tied by it in one call.
NUMBERED_SUFFIX: re.Pattern[str] = _ids.NUMBERED_SUFFIX

#: The ``type`` idtrack writes in a batch item's ``error`` when that identifier's search ran over its budget.
SEARCH_BUDGET_ERROR_TYPE: str = _errors.SearchBudgetExceededError.__name__


class InputRefusedError(Exception):
    """idtrack refused an input: the caller's to change.

    Attributes:
        code: The api's code of the kind of input.
        message: idtrack's message.
        argument: The argument, where idtrack names one.
        allowed: The accepted values, where idtrack lists them.
    """

    def __init__(self, code: str, message: str, argument: str | None, allowed: tuple[Any, ...] | None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.argument = argument
        self.allowed = allowed


class SearchBudgetError(Exception):
    """One identifier's search needed more than its budget.

    Attributes:
        message: idtrack's message.
        states_exhausted: The budget of states was reached (otherwise the budget of seconds).
    """

    def __init__(self, message: str, states_exhausted: bool) -> None:
        super().__init__(message)
        self.message = message
        self.states_exhausted = states_exhausted


class GraphLoadError(Exception):
    """A file could not be loaded as a graph this idtrack reads (idtrack's message)."""


def input_problem(error: BaseException) -> InputRefusedError | None:
    """Return the translation of one of idtrack's input errors, or ``None`` for any other error.

    Args:
        error: An exception.

    Returns:
        InputRefusedError | None: The problem.
    """
    for cls in type(error).__mro__:
        code = _INPUT_CODES.get(cls)
        if code is not None and isinstance(error, _errors.InputError):
            return InputRefusedError(code, error.message, error.argument, error.allowed)
    return None


def input_codes() -> tuple[str, ...]:
    """Return every code an input problem can have.

    Returns:
        tuple[str, ...]: The codes.
    """
    return tuple(dict.fromkeys(_INPUT_CODES.values()))


def batch_groups(identifiers: list[str]) -> list[list[str]]:
    """Return the distinct identifiers of a batch in the groups that ``API.convert_many`` answers together.

    ``API.convert_many`` answers an item as itself, except an item that extends another item of the batch by a
    numbered suffix (:py:data:`NUMBERED_SUFFIX`), which it may answer as that item's copy (idtrack's rule for names
    that a single-cell tool made unique: an item that is another item of the batch with ``-1``, ``.1`` or ``_1``
    appended, and is itself no exact name at the release it is read at, is answered as that item: ``INS-1`` beside
    ``INS``). Items tied so, directly or through a chain (``INS``, ``INS-1``, ``INS-1-1``), are one group; every
    other item is a group of its own. Converting each group by one ``convert_many`` call gives every item the answer
    that one call over the whole batch gives it (``tests/test_endpoints.py`` compares the two), and lets the api check
    the request's time between groups.

    Args:
        identifiers: The batch, as given.

    Returns:
        list[list[str]]: The groups, each in the order of first appearance, ordered by their first item.
    """
    distinct = list(dict.fromkeys(identifiers))
    given = set(distinct)
    root = {identifier: identifier for identifier in distinct}

    def find(identifier: str) -> str:
        while root[identifier] != identifier:
            root[identifier] = root[root[identifier]]
            identifier = root[identifier]
        return identifier

    for identifier in distinct:
        found = NUMBERED_SUFFIX.match(identifier.strip())
        if found is not None and found.group(1) in given:
            root[find(identifier)] = find(found.group(1))
    groups: dict[str, list[str]] = {}
    for identifier in distinct:  # a group is placed where its first item stands
        groups.setdefault(find(identifier), []).append(identifier)
    first = {identifier: position for position, identifier in enumerate(distinct)}
    return sorted(groups.values(), key=lambda group: first[group[0]])


def _translated(function: Any, *args: Any, **kwargs: Any) -> Any:
    """Call idtrack, translating its input errors and an exceeded search budget."""
    try:
        return function(*args, **kwargs)
    except _errors.SearchBudgetExceededError as error:
        raise SearchBudgetError(str(error), error.states >= error.budget_states) from None
    except _errors.InputError as error:
        problem = input_problem(error)
        if problem is None:  # every InputError is in _INPUT_CODES (its root is)
            raise
        raise problem from None


def organism_of(name: str) -> str | None:
    """Return the organism a name means (``pig``, ``Sus scrofa``, ``sus_scrofa``), without the network.

    Args:
        name: The name.

    Returns:
        str | None: The organism's production name; ``None`` if idtrack knows no such organism.
    """
    try:
        return resolve_organism(name)
    except _errors.UnknownOrganismError:
        return None


def idtrack_version() -> str:
    """Return the version of the idtrack that answers.

    Returns:
        str: The version.
    """
    return str(idtrack.__version__)


def idtrack_commit() -> str | None:
    """Return the commit of the installed idtrack where its installation records one (PEP 610), else ``None``.

    Returns:
        str | None: The commit.
    """
    try:
        text = metadata.distribution("idtrack").read_text("direct_url.json")
    except metadata.PackageNotFoundError:
        return None
    if not text:
        return None
    commit = (json.loads(text).get("vcs_info") or {}).get("commit_id")
    return commit if isinstance(commit, str) else None


@dataclass(frozen=True)
class Identity:
    """What a loaded graph is (from its description).

    Attributes:
        organism: The organism.
        snapshot_release: The last release of the graph.
        content_digest: The digest of its content (``None`` for a graph made in memory).
        format_version: Its file's format version.
        package_version: The idtrack version that built it.
        package_commit: The idtrack commit that built it, where known.
        build_date: When it was built.
    """

    organism: str
    snapshot_release: int
    content_digest: str | None
    format_version: int | None
    package_version: str | None
    package_commit: str | None
    build_date: str | None


class Graph:
    """One loaded graph, and the idtrack calls the api makes on it. Every answer is idtrack's ``to_dict()``."""

    def __init__(self, api: API) -> None:
        """Hold idtrack's API over a graph.

        Args:
            api: The API.
        """
        self.api = api
        self._description = api.describe()

    @classmethod
    def load(cls, path: str, budget_states: int | None = None, budget_seconds: float | None = None) -> Graph:
        """Load a graph file (no network, no build).

        Args:
            path: The file.
            budget_states: The search budget of one identifier in states (``None``: idtrack's default).
            budget_seconds: The search budget of one identifier in seconds (``None``: idtrack's default).

        Returns:
            Graph: The graph.

        Raises:
            GraphLoadError: If idtrack cannot load it.
        """
        budget: dict[str, Any] = {}
        if budget_states is not None:
            budget["budget_states"] = budget_states
        if budget_seconds is not None:
            budget["budget_seconds"] = budget_seconds
        try:
            return cls(API.load(path, search=SearchSettings(**budget)))
        except _errors.IdtrackError as error:
            raise GraphLoadError(str(error)) from None

    def identity(self) -> Identity:
        """Return what the graph is.

        Returns:
            Identity: Organism, snapshot, digest, format and build record.
        """
        d = self._description
        return Identity(
            organism=d.organism,
            snapshot_release=d.snapshot_release,
            content_digest=d.content_digest,
            format_version=d.format_version,
            package_version=d.package_version,
            package_commit=d.package_commit,
            build_date=d.build_date,
        )

    def describe(self) -> dict[str, Any]:
        """Return ``API.describe().to_dict()``.

        Returns:
            dict[str, Any]: The description.
        """
        return self._description.to_dict()

    def releases(self) -> tuple[int, ...]:
        """Return the releases the graph covers, ascending.

        Returns:
            tuple[int, ...]: The releases.
        """
        return tuple(self._description.releases)

    def final_databases(self, to_release: int | None) -> list[str]:
        """Return ``API.final_databases(to_release)``.

        Args:
            to_release: The target release (``None``: the snapshot release).

        Returns:
            list[str]: The databases.
        """
        return list(_translated(self.api.final_databases, to_release))

    def convert(self, identifier: str, arguments: ConversionArguments, budget_seconds: float) -> dict[str, Any]:
        """Return ``API.convert(identifier, ...).to_dict()``.

        Args:
            identifier: The identifier.
            arguments: The conversion's arguments.
            budget_seconds: This search's budget in seconds.

        Returns:
            dict[str, Any]: The result.
        """
        result = _translated(self.api.convert, identifier, **arguments.keywords(), budget_seconds=budget_seconds)
        return dict(result.to_dict())

    def convert_many(
        self, identifiers: list[str], arguments: ConversionArguments, budget_seconds: float
    ) -> list[dict[str, Any]]:
        """Return ``[r.to_dict() for r in API.convert_many(identifiers, ...)]``.

        Args:
            identifiers: The identifiers.
            arguments: The conversion's arguments.
            budget_seconds: Each search's budget in seconds.

        Returns:
            list[dict[str, Any]]: The results, in input order.
        """
        found = _translated(self.api.convert_many, identifiers, **arguments.keywords(), budget_seconds=budget_seconds)
        return [dict(r.to_dict()) for r in found]

    def genes_named(self, name: str, fold_case: bool) -> list[dict[str, Any]]:
        """Return ``[m.to_dict() for m in API.genes_named(name, fold_case)]``.

        Args:
            name: The name.
            fold_case: Match without letter case.

        Returns:
            list[dict[str, Any]]: The matches.
        """
        return [dict(m.to_dict()) for m in _translated(self.api.genes_named, name, fold_case=fold_case)]

    def names_of(self, gene: str, release: int | None) -> list[dict[str, Any]]:
        """Return ``[m.to_dict() for m in API.names_of(gene, release)]``.

        Args:
            gene: An Ensembl gene id with version.
            release: Only names that hold at this release; ``None``: all.

        Returns:
            list[dict[str, Any]]: The names.
        """
        return [dict(m.to_dict()) for m in _translated(self.api.names_of, gene, release)]


@dataclass(frozen=True)
class ConversionArguments:
    """The arguments of a conversion, as the api's requests name them.

    Attributes:
        from_release: The release the identifier is read at (``None``: inferred).
        to_release: The target release (``None``: the snapshot release).
        final_database: The database of the targets (``None``: Ensembl genes).
        from_database: The database the identifier is meant in (``None``: any).
        explain: Add the paths.
        allow_bridges: Allow bridges through external ids.
    """

    from_release: int | None
    to_release: int | None
    final_database: str | None
    from_database: str | None
    explain: bool
    allow_bridges: bool

    def keywords(self) -> dict[str, Any]:
        """Return idtrack's keyword arguments of ``API.convert`` and ``API.convert_many`` after the identifier.

        Returns:
            dict[str, Any]: The keywords, by idtrack's names.
        """
        return {
            "from_release": self.from_release,
            "to_release": self.to_release,
            "final_database": self.final_database,
            "from_database": self.from_database,
            "explain": self.explain,
            "allow_bridges": self.allow_bridges,
        }


__all__ = [
    "BRIDGE_RULES",
    "BRIDGE_RULES_TAKEN",
    "CRITERIA",
    "FORMAT_VERSION",
    "MATCH_PREFIXES",
    "MATCH_STEPS",
    "NUMBERED_SUFFIX",
    "PLACE_RELATIONS",
    "READING_REASONS",
    "REASONS",
    "RESULT_CLASSES",
    "SEARCH_BUDGET_ERROR_TYPE",
    "STATUSES",
    "STEP_REASONS",
    "ConversionArguments",
    "Graph",
    "GraphLoadError",
    "Identity",
    "InputRefusedError",
    "SearchBudgetError",
    "batch_groups",
    "idtrack_commit",
    "idtrack_version",
    "input_codes",
    "input_problem",
    "organism_of",
]
