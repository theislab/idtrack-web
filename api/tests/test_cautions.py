"""The cautions: the api's reading of a result's evidence, by stated rules over idtrack's own fields."""

from __future__ import annotations

import csv
import io
from typing import TYPE_CHECKING, Any

from idtrack_web_api import tsv
from idtrack_web_api.cautions import CAUTIONS, PATH_CODES, cautions_of
from idtrack_web_api.config import DOCS_URL
from tests.test_endpoints import sample_identifiers

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastapi.testclient import TestClient
    from idtrack.api import API

P = "/api/v1"


def test_cautions_are_read_with_the_path_whatever_explain_asks(
    client: TestClient, cut_idtrack: API, check_response: Callable[..., Any]
) -> None:
    """Every answer's cautions are those of its result with the path, asked with or without `explain`."""
    identifiers = sample_identifiers(cut_idtrack, 120)
    seen: set[str] = set()
    for arguments in ({}, {"final_database": "HGNC Symbol"}, {"to_release": 80}):
        explained = [r.to_dict() for r in cut_idtrack.convert_many(identifiers, explain=True, **arguments)]
        expected = [cautions_of(r, DOCS_URL) for r in explained]
        for explain in (False, True):
            response = client.post(
                f"{P}/organisms/pig/convert/batch", json={"identifiers": identifiers, "explain": explain, **arguments}
            )
            results = check_response(response, f"{P}/organisms/{{organism}}/convert/batch", "post")["results"]
            assert [r["cautions"] for r in results] == expected
            seen |= {c["code"] for r in results for c in r["cautions"]}
    # The sample meets cautions that read the path and cautions that read the fields alone.
    assert seen & PATH_CODES and seen - PATH_CODES, seen


def result(**fields: Any) -> dict[str, Any]:
    """A result of idtrack's form with the fields given (the rest empty)."""
    base: dict[str, Any] = {
        "query_id": "X",
        "graph_id": "X",
        "match": "exact",
        "status": "converted",
        "from_release": 115,
        "from_release_inferred": True,
        "from_release_given": None,
        "from_databases": [],
        "to_release": 115,
        "final_database": "ensembl_gene",
        "candidates": [],
        "reasons": [],
        "no_target": False,
        "alternative_locus_genes": [],
        "other_readings": [],
        "decided_by": None,
        "path": None,
    }
    return base | fields


def candidate(**fields: Any) -> dict[str, Any]:
    base = {"gene": "G1", "target": "G1", "best": True, "bridges": 0, "unscored_steps": 0, "final_confidence": 0}
    return base | {"path": [], "final_path": []} | fields


def codes(found: list[dict[str, Any]]) -> list[str]:
    return [c["code"] for c in found]


def test_each_rule_reads_what_its_meaning_says() -> None:
    # A bridge on the best answer, with the gene it went through.
    path = {
        "nodes": [],
        "bridges": [],
        "steps": [{"kind": "bridge_near", "source": "G0", "target": "NM_1"}, {"kind": "bridge_far", "target": "G1"}],
    }
    found = cautions_of(result(candidates=[candidate(bridges=1, path=[0, 1])], path=path), DOCS_URL)
    assert codes(found) == ["bridge"] and "`NM_1`" in found[0]["text"]
    assert found[0]["limitation"] == f"{DOCS_URL}limitations.html#answers-that-only-a-bridge-reaches"
    # A bare number held only at an earlier release than the target: a caution; read at the target: a note.
    old = result(query_id="1898", graph_id="1898", from_release=52, from_databases=["HGNC"], candidates=[candidate()])
    assert codes(cautions_of(old, DOCS_URL)) == ["bare_number"]
    now = old | {"from_release": 115, "from_release_inferred": False}
    assert [(c["code"], c["tone"]) for c in cautions_of(now, DOCS_URL)] == [("number_read", "note")]
    # Every best gene outside the reference sequence at the target release, with the regions.
    nodes = [
        {
            "id": "G1",
            "label": "G1",
            "active": [[100, None]],
            "non_reference": [[100, 115]],
            "places": [{"region": "HSCHR6_MHC_COX", "reference": False, "releases": [[100, 115]]}],
        }
    ]
    outside = result(candidates=[candidate()], path={"nodes": nodes, "steps": [], "bridges": []})
    found = cautions_of(outside, DOCS_URL)
    assert codes(found) == ["outside_reference"] and "HSCHR6_MHC_COX" in found[0]["text"]
    # A synonym read without letter case: both marks, the synonym's with idtrack's section of that class.
    loose = cautions_of(result(match="synonym:case", candidates=[candidate()]), DOCS_URL)
    assert codes(loose) == ["match_synonym", "match_case"]
    assert str(loose[0]["limitation"]).endswith("#symbols-typed-in-small-letters-where-symbols-are-written-in-capitals")
    # Another meaning at other releases, its releases written as runs.
    reading = {
        "reason": "other_release",
        "releases": [52, 53, 54, 60],
        "graph_id": "X",
        "genes": ["G9"],
        "match": "exact",
    }
    found = cautions_of(result(candidates=[candidate()], other_readings=[reading]), DOCS_URL)
    assert codes(found) == ["other_release"] and "52-54, 60" in found[0]["text"]
    # Cautions come before notes, whatever the order of the rules.
    mixed = cautions_of(result(match="unicode:synonym:exact", candidates=[candidate()]), DOCS_URL)
    assert [c["tone"] for c in mixed] == ["caution", "note"]
    # A result without answer has no caution of its answer.
    assert cautions_of(result(status="not_found", candidates=[], graph_id=None, match=None), DOCS_URL) == []


def test_the_vocabulary_states_every_caution(client: TestClient, openapi: dict[str, Any]) -> None:
    terms = client.get(f"{P}/vocabulary").json()["cautions"]
    assert [t["code"] for t in terms] == list(CAUTIONS)
    assert all(t["meaning"] and t["tone"] in {"caution", "note"} for t in terms)
    assert {t["code"] for t in terms if t["reads_path"]} == PATH_CODES
    for term in terms:
        assert term["limitation"] is None or term["limitation"].startswith(f"{DOCS_URL}limitations.html#")
    enum = openapi["components"]["schemas"]["Caution"]["properties"]["code"]["enum"]
    assert enum == list(CAUTIONS)


def test_the_documentation_address_follows_the_setting(make_client: Callable[..., TestClient]) -> None:
    moved = make_client(rate_per_minute=0, docs_url="https://docs.example.org/")
    terms = moved.get(f"{P}/vocabulary").json()["cautions"]
    assert all(t["limitation"] is None or t["limitation"].startswith("https://docs.example.org/") for t in terms)


def test_the_table_names_each_results_cautions(client: TestClient, cut_idtrack: API) -> None:
    identifiers = sample_identifiers(cut_idtrack, 80)
    data = client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": identifiers}).json()["results"]
    text = client.post(f"{P}/organisms/pig/convert/batch?format=tsv", json={"identifiers": identifiers}).text
    rows = list(csv.reader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE))
    column = rows[0].index("cautions")
    first_rows: dict[int, str] = {}
    for row in rows[1:]:
        first_rows.setdefault(int(row[tsv.COLUMNS.index("input_index")]), row[column])
    assert [first_rows[i] for i in range(len(identifiers))] == [";".join(codes(r["cautions"])) for r in data]
    assert any(first_rows.values())
