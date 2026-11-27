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

import ast
import json
import math
import re
import time
from dataclasses import dataclass
from importlib import metadata
from typing import Any

import idtrack
from idtrack import errors as _errors
from idtrack import ids as _ids
from idtrack import results as _results
from idtrack.api import API
from idtrack.engine import SOURCE_MODES as _SOURCE_MODES
from idtrack.graph import GRAPH_FORMAT_VERSION
from idtrack.organisms import ALIASES, SYMBOL_DATABASES, resolve_organism
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
    "SourceInference": _results.SourceInference,
}

#: idtrack's two Ensembl gene namespaces a conversion can end in, and whether each writes the id's version.
ENSEMBL_NAMESPACES: dict[str, bool] = {"ensembl_gene": True, "base_ensembl_gene": False}

#: The granularities of an origin that idtrack's ``API.source_inference`` takes (``idtrack.engine.SOURCE_MODES``).
SOURCE_MODES: tuple[str, ...] = tuple(_SOURCE_MODES)

# idtrack's input errors, the most specific first: the first class of an error's method resolution order found here
# names its code. idtrack's refusals that the api's own checks make unreachable through its endpoints (an argument of
# the wrong type, which the api's typed parameters refuse first; an inactive release, an unknown version or assembly,
# which ``API.convert`` answers as results or falls back from, and which no endpoint takes as an argument) have no code
# of their own: should one arrive, its root class answers it (``invalid_input``, with idtrack's message).
_INPUT_CODES: dict[type[BaseException], str] = {
    _errors.UnknownOrganismError: "unknown_organism",
    _errors.UnknownReleaseError: "unknown_release",
    _errors.UnknownDatabaseError: "unknown_database",
    _errors.UnknownIdentifierError: "unknown_identifier",
    _errors.MissingValueError: "missing_value",
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

    def __init__(self, message: str, *, states_exhausted: bool) -> None:
        super().__init__(message)
        self.message = message
        self.states_exhausted = states_exhausted


class GraphLoadError(Exception):
    """A file could not be loaded as a graph this idtrack reads (idtrack's message)."""


#: A list written as Python writes one (``['a', 'b']``, ``[56, 57]``) inside a message.
_LISTED = re.compile(r"\[(?:'(?:[^'\\]|\\.)*'|\d+)(?:, (?:'(?:[^'\\]|\\.)*'|\d+))*\]")


def readable(message: str, allowed: tuple[Any, ...] | None) -> str:
    """Return idtrack's message with the list of accepted values it writes (Python's spelling) as a reference to them.

    idtrack's refusals write the accepted values into their message as Python writes a list; the api sends the same
    values as ``allowed``, a JSON array. A list in the message that holds exactly the values of ``allowed`` is written
    as ``the N values of `allowed```, so that the message is plain words; every other word is idtrack's.

    Args:
        message: idtrack's message.
        allowed: The accepted values idtrack gives.

    Returns:
        str: The message.
    """
    if not allowed:
        return message

    def replaced(found: re.Match[str]) -> str:
        try:
            values = ast.literal_eval(found.group(0))
        except (ValueError, SyntaxError):
            return found.group(0)
        if [str(v) for v in values] != [str(v) for v in allowed]:
            return found.group(0)
        return f"the {len(values)} values of `allowed`"

    return _LISTED.sub(replaced, message)


def input_problem(error: BaseException) -> InputRefusedError | None:
    """Return the translation of one of idtrack's input errors, or ``None`` for any other error.

    Args:
        error: An exception.

    Returns:
        InputRefusedError | None: The problem (idtrack's message, its list of accepted values written as a reference
        to ``allowed``: :py:func:`readable`).
    """
    for cls in type(error).__mro__:
        code = _INPUT_CODES.get(cls)
        if code is not None and isinstance(error, _errors.InputError):
            return InputRefusedError(code, readable(error.message, error.allowed), error.argument, error.allowed)
    return None


def item_error_code(error_type: str) -> str:
    """Return the api's code of the error that stopped one item of a batch, by the class idtrack names in it.

    ``API.convert_many`` records an item's error by its class's name (``ErrorInfo.type``): an input error of idtrack
    answers with its code, as the same input sent alone to ``/convert`` would (:py:func:`input_problem`); a search over
    its budget is ``search_budget_exceeded``; any other error ``internal_error``.

    Args:
        error_type: The class name idtrack recorded.

    Returns:
        str: The code.
    """
    cls = getattr(_errors, error_type, None)
    if not isinstance(cls, type):
        return "internal_error"
    if issubclass(cls, _errors.SearchBudgetExceededError):
        return "search_budget_exceeded"
    for base in cls.__mro__:
        code = _INPUT_CODES.get(base)
        if code is not None:
            return code
    return "internal_error"


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
        raise SearchBudgetError(str(error), states_exhausted=error.states >= error.budget_states) from None
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


def organism_aliases(organism: str) -> tuple[str, ...]:
    """Return the short names idtrack declares for an organism (``idtrack.organisms.ALIASES``).

    Args:
        organism: The organism's production name.

    Returns:
        tuple[str, ...]: The short names (lower case).
    """
    return tuple(ALIASES.get(organism, ()))


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
        self._databases = self._release_databases()

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

    def warm(self) -> dict[str, float]:
        """Compute every graph-wide table idtrack computes lazily on the path of a conversion, and return the seconds.

        idtrack computes some tables of the whole graph the first time a conversion needs them (the releases of each
        assembly, the hyper-connected nodes, the facts by which it counts genes, the last measured at 12 s and
        0.8 GB for the human graph). Computed in the master before the fork, through ``TheGraph``'s public
        accessors, they are computed once and shared by every worker, instead of once per worker within some
        visitor's request.

        Returns:
            dict[str, float]: Seconds per table.
        """
        graph = self.api.graph
        steps: dict[str, Any] = {
            "assembly_releases": lambda: graph.assembly_releases,
            "serving_assembly": lambda: graph.serving_assembly,
            "hyperconnective_nodes": lambda: graph.hyperconnective_nodes,
            "count_genes": lambda: graph.count_genes(()),
        }
        seconds: dict[str, float] = {}
        for name, step in steps.items():
            start = time.monotonic()
            step()
            seconds[name] = time.monotonic() - start
        return seconds

    def history_counts(self) -> dict[str, Any]:  # noqa: PLR0912 - one pass over the backbone
        """Count Ensembl's stable id history of genes as the graph holds it, from ``TheGraph``'s public interface.

        Every node of the history backbone (``TheGraph.is_backbone``) is read: a gene version's active releases
        (``TheGraph.active_releases``), and every history edge that leaves it (``TheGraph.history_edges``), told by
        plain facts only: from the creation marker ``<id>.Void`` (an id created; its edge's two releases are the
        release it begins), to the retirement marker ``<id>.Retired``, to the node itself (the id and version kept,
        with a score; the edge of an id alive at the last release, whose later release is infinite, is left out), to
        another version of the same stable id, or to a version of another id. Per pair of releases it also counts
        the fan of Ensembl's mapping, from the same edges: the gene versions with edges to two or more distinct gene
        versions across the pair (``one_to_many``; the version itself among them where it is kept), and the gene
        versions reached by edges from two or more distinct gene versions (``many_to_one``). These are counts of the
        edges' ends, not idtrack's reading of a step of a path (``PathStep.reason``).

        Returns:
            dict[str, Any]: ``releases`` (each with ``release``, ``genes_active``, ``versions_active``, ``created``)
            and ``transitions`` (each with ``from_release``, ``to_release``, the counts by kind, ``scored``,
            ``one_to_many`` and ``many_to_one``).
        """
        graph = self.api.graph
        releases = [int(r) for r in graph.releases]
        masks: dict[str, int] = {}
        versions = dict.fromkeys(releases, 0)
        created = dict.fromkeys(releases, 0)
        kinds = ("version_changes", "id_changes", "same_version", "retired", "scored")
        transitions: dict[tuple[int, int], dict[str, int]] = {}
        # Per pair of releases: each earlier gene version's later ends, and each later version's earlier ends.
        later: dict[tuple[int, int], dict[str, set[str]]] = {}
        earlier: dict[tuple[int, int], dict[str, set[str]]] = {}
        for node in graph.nodes:
            if not graph.is_backbone(node):
                continue
            version = graph.version(node)
            marker = version in {"Void", "Retired"}
            if not marker:
                active = graph.active_releases(node)
                base = graph.base_id(node)
                masks[base] = masks.get(base, 0) | active.mask
                for release in active:
                    versions[int(release)] = versions.get(int(release), 0) + 1
            for edge in graph.history_edges(node):
                if version == "Void":
                    created[int(edge.new_release)] = created.get(int(edge.new_release), 0) + 1
                    continue
                if edge.node == node:
                    if isinstance(edge.new_release, float) and math.isinf(edge.new_release):
                        continue
                    kind = "same_version"
                elif graph.version(edge.node) == "Retired":
                    kind = "retired"
                elif graph.base_id(edge.node) == graph.base_id(node):
                    kind = "version_changes"
                else:
                    kind = "id_changes"
                pair = (int(edge.old_release), int(edge.new_release))
                counts = transitions.setdefault(pair, dict.fromkeys(kinds, 0))
                counts[kind] += 1
                if kind != "retired":
                    later.setdefault(pair, {}).setdefault(node, set()).add(edge.node)
                    earlier.setdefault(pair, {}).setdefault(edge.node, set()).add(node)
                if not math.isnan(edge.weight):
                    counts["scored"] += 1
        genes = list(masks.values())
        return {
            "releases": [
                {
                    "release": release,
                    "genes_active": sum(1 for mask in genes if mask >> release & 1),
                    "versions_active": versions.get(release, 0),
                    "created": created.get(release, 0),
                }
                for release in releases
            ],
            "transitions": [
                {
                    "from_release": a,
                    "to_release": b,
                    **counts,
                    "one_to_many": sum(1 for ends in later.get((a, b), {}).values() if len(ends) > 1),
                    "many_to_one": sum(1 for ends in earlier.get((a, b), {}).values() if len(ends) > 1),
                }
                for (a, b), counts in sorted(transitions.items())
            ],
        }

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

    def _release_databases(self) -> dict[str, Any]:
        """Return what a conversion to each release can end in, from idtrack's own calls (made once, at load)."""
        releases = [int(r) for r in self._description.releases]
        at: dict[str, list[int]] = {}
        for release in releases:
            for database in self.api.final_databases(release):
                at.setdefault(str(database), []).append(release)
        forms = self.api.database_forms()
        graph = self.api.graph
        label_names = {str(k): str(v) for k, v in graph.label_names.items()}
        labels = frozenset(str(d) for d in graph.label_databases)
        authorities = frozenset(str(d) for d in graph.authority_databases)
        former: dict[str, list[str]] = {}
        for old, new in graph.renamed_databases.items():
            if not str(old).startswith("synonym_id::"):
                former.setdefault(str(new), []).append(str(old))

        def row(name: str) -> dict[str, Any]:
            if name in ENSEMBL_NAMESPACES:
                kind, versioned = "ensembl", ENSEMBL_NAMESPACES[name]
            else:
                kind, versioned = ("label" if name in labels else "accession"), None
            return {
                "name": name,
                "form": forms.get(name),
                "releases": at[name],
                "kind": kind,
                "versioned": versioned,
                "authority": name in authorities,
                "labels": label_names.get(name) if kind == "accession" else None,
                "labels_of": sorted(k for k, v in label_names.items() if v == name) if kind == "label" else [],
                "former_names": sorted(former.get(name, [])),
            }

        return {
            "releases": releases,
            "databases": [row(name) for name in sorted(at)],
            "by_assembly": self.api.databases_by_assembly(),
            "symbol_databases": list(SYMBOL_DATABASES.get(str(self._description.organism), ())),
        }

    def databases(self) -> dict[str, Any]:
        """Return, for every release, the databases a conversion to it can end in, and each assembly's databases.

        From idtrack's ``API.final_databases(release)`` at each release of the graph, ``API.database_forms()`` and
        ``API.databases_by_assembly()``, computed when the graph is loaded.

        Returns:
            dict[str, Any]: ``releases`` (ascending), ``databases`` (each ``name``, ``form`` and the ``releases``
            whose final databases include it, sorted by name), ``by_assembly`` and ``symbol_databases`` (idtrack's
            ``organisms.SYMBOL_DATABASES`` of the organism, in idtrack's order).
        """
        return self._databases

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

    def gene_versions(self, stable_id: str) -> tuple[str, ...]:
        """Return the versions the graph holds of an Ensembl stable id without version (``TheGraph.versions_of``).

        Args:
            stable_id: A stable id without version.

        Returns:
            tuple[str, ...]: ``<id>.<version>`` of each, by ascending version; empty when there is none.
        """
        return tuple(str(v) for v in self.api.graph.versions_of(stable_id))

    def source_inference(self, identifiers: list[str], mode: str) -> dict[str, Any]:
        """Return ``API.source_inference(identifiers, mode).to_dict()``.

        Args:
            identifiers: The identifiers.
            mode: The granularity of an origin (:py:data:`SOURCE_MODES`).

        Returns:
            dict[str, Any]: The inference.
        """
        return dict(_translated(self.api.source_inference, identifiers, mode).to_dict())

    def genes_named(self, name: str, *, fold_case: bool) -> list[dict[str, Any]]:
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


@dataclass(frozen=True, kw_only=True)
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
    "ENSEMBL_NAMESPACES",
    "FORMAT_VERSION",
    "MATCH_PREFIXES",
    "MATCH_STEPS",
    "NUMBERED_SUFFIX",
    "PLACE_RELATIONS",
    "READING_REASONS",
    "REASONS",
    "RESULT_CLASSES",
    "SEARCH_BUDGET_ERROR_TYPE",
    "SOURCE_MODES",
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
    "item_error_code",
    "organism_aliases",
    "organism_of",
]
