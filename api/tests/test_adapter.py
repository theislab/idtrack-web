"""The adapter, the one module that calls idtrack: each call is idtrack's own; each refusal keeps idtrack's words."""

from __future__ import annotations

import inspect
from typing import TYPE_CHECKING, Any

import pytest
from idtrack import errors as idtrack_errors
from idtrack.api import API

from idtrack_web_api import adapter
from idtrack_web_api.errors import CODES
from tests.conftest import CUT_GRAPH
from tests.test_endpoints import sample_identifiers

if TYPE_CHECKING:
    from pathlib import Path

GENE = "ENSSSCG00000040076.1"


@pytest.fixture(scope="module")
def graph() -> adapter.Graph:
    return adapter.Graph.load(str(CUT_GRAPH))


def arguments(**changes: Any) -> adapter.ConversionArguments:
    values: dict[str, Any] = {
        "from_release": None, "to_release": None, "final_database": None, "from_database": None,
        "explain": False, "allow_bridges": True,
    }  # fmt: skip
    return adapter.ConversionArguments(**(values | changes))


def test_the_keywords_are_idtracks() -> None:
    accepted = set(inspect.signature(API.convert).parameters) & set(inspect.signature(API.convert_many).parameters)
    assert set(arguments().keywords()) | {"budget_seconds"} <= accepted


def test_calls_are_idtracks(graph: adapter.Graph, cut_idtrack: API) -> None:
    assert graph.describe() == cut_idtrack.describe().to_dict()
    assert graph.releases() == tuple(cut_idtrack.releases())
    identity = graph.identity()
    description = cut_idtrack.describe()
    assert (identity.organism, identity.snapshot_release, identity.content_digest, identity.format_version) == (
        description.organism, description.snapshot_release, description.content_digest, adapter.FORMAT_VERSION,
    )  # fmt: skip
    for release in (None, 56, 90, 115):
        assert graph.final_databases(release) == cut_idtrack.final_databases(release)
    identifiers = sample_identifiers(cut_idtrack, 40)
    for identifier in identifiers:
        for kind in ({}, {"explain": True, "to_release": 80}, {"final_database": "EntrezGene"}):
            expected = cut_idtrack.convert(identifier, **kind).to_dict()
            assert graph.convert(identifier, arguments(**kind), 10.0) == expected
    assert graph.convert_many(identifiers, arguments(), 10.0) == [
        r.to_dict() for r in cut_idtrack.convert_many(identifiers)
    ]
    assert graph.genes_named("ins", fold_case=True) == [
        m.to_dict() for m in cut_idtrack.genes_named("ins", fold_case=True)
    ]
    assert graph.names_of(GENE, None) == [m.to_dict() for m in cut_idtrack.names_of(GENE)]


def test_refusals_keep_idtracks_words(graph: adapter.Graph, cut_idtrack: API) -> None:
    with pytest.raises(adapter.InputRefusedError) as caught:
        graph.convert(GENE, arguments(to_release=999), 10.0)
    with pytest.raises(idtrack_errors.UnknownReleaseError) as direct:
        cut_idtrack.convert(GENE, to_release=999)
    assert (caught.value.code, caught.value.message, caught.value.argument, caught.value.allowed) == (
        "unknown_release", direct.value.message, direct.value.argument, direct.value.allowed,
    )  # fmt: skip
    with pytest.raises(adapter.InputRefusedError, match="final_database") as caught:
        graph.convert_many([GENE], arguments(final_database="nope"), 10.0)
    assert caught.value.code == "unknown_database"
    with pytest.raises(adapter.InputRefusedError) as caught:
        graph.names_of("NOT_A_GENE.1", None)
    assert caught.value.code == "unknown_identifier"
    with pytest.raises(adapter.InputRefusedError) as caught:
        graph.final_databases(20)
    assert caught.value.code == "unknown_release"


def test_search_over_budget() -> None:
    tight = adapter.Graph.load(str(CUT_GRAPH), budget_states=1)
    with pytest.raises(adapter.SearchBudgetError) as caught:
        tight.convert(GENE, arguments(to_release=56), 10.0)
    assert caught.value.states_exhausted
    [item] = tight.convert_many([GENE], arguments(to_release=56), 10.0)
    assert item["error"]["type"] == adapter.SEARCH_BUDGET_ERROR_TYPE


def test_every_input_error_of_idtrack_has_a_code_of_the_api() -> None:
    classes = [
        c for c in vars(idtrack_errors).values() if isinstance(c, type) and issubclass(c, idtrack_errors.InputError)
    ]
    assert len(classes) >= 10
    special: dict[type, Any] = {
        idtrack_errors.InactiveAtReleaseError: lambda: idtrack_errors.InactiveAtReleaseError("G.1", 80, [[56, 70]]),
        idtrack_errors.UnknownVersionError: lambda: idtrack_errors.UnknownVersionError("G.9", ("G.1", "G.2")),
    }
    codes = set()
    for cls in classes:
        error = special[cls]() if cls in special else cls("message", argument="x", allowed=["a", 1])
        problem = adapter.input_problem(error)
        assert problem is not None
        assert 400 <= CODES[problem.code][0] < 500
        # A refusal the api's own checks make unreachable through its endpoints falls back to its root's code; every
        # other class has a code of its own.
        unreachable = {
            idtrack_errors.InputError,
            idtrack_errors.ArgumentTypeError,
            idtrack_errors.UnknownAssemblyError,
            idtrack_errors.InactiveAtReleaseError,
            idtrack_errors.UnknownVersionError,
        }
        assert (problem.code == "invalid_input") == (cls in unreachable), cls
        codes.add(problem.code)
    assert codes == set(adapter.input_codes())
    assert adapter.input_problem(idtrack_errors.IntegrityError("x")) is None
    assert adapter.input_problem(ValueError("x")) is None


def test_item_error_codes() -> None:
    assert adapter.item_error_code("MissingValueError") == "missing_value"
    assert adapter.item_error_code("UnknownVersionError") == "invalid_input"
    assert adapter.item_error_code(adapter.SEARCH_BUDGET_ERROR_TYPE) == "search_budget_exceeded"
    assert adapter.item_error_code("ZeroDivisionError") == "internal_error"
    assert adapter.item_error_code("IntegrityError") == "internal_error"


def test_load_and_names(tmp_path: Path) -> None:
    junk = tmp_path / "junk.npz"
    junk.write_bytes(b"not a graph")
    with pytest.raises(adapter.GraphLoadError):
        adapter.Graph.load(str(junk))
    with pytest.raises(adapter.GraphLoadError):
        adapter.Graph.load(str(tmp_path / "missing.npz"))
    assert adapter.organism_of("pig") == adapter.organism_of("Sus scrofa") == "sus_scrofa"
    assert adapter.organism_of("cow") is None
    assert adapter.idtrack_version()
    assert set(adapter.RESULT_CLASSES) >= {"ConversionResult", "GraphDescription", "NameMatch"}
