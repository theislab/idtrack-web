"""Every endpoint against its schema, and every answer equal to what idtrack itself returns for the same call."""

from __future__ import annotations

import csv
import dataclasses
import io
import json
import math
from typing import TYPE_CHECKING, Any

import pytest
from idtrack import results
from idtrack.ids import public_name

from idtrack_web_api import tsv
from idtrack_web_api.adapter import FORMAT_VERSION

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastapi.testclient import TestClient
    from idtrack.api import API

    from idtrack_web_api.graphs import Registry

P = "/api/v1"


def sample_identifiers(api: API, count: int) -> list[str]:
    """Return a spread of the graph's identifiers (every kind: genes with and without version, transcripts, external
    ids, synonyms), every k-th of the sorted names, as idtrack's results name them (``idtrack.ids.public_name``:
    a synonym without the graph's prefix), without the graph's own markers of birth and retirement."""
    names = sorted({public_name(n) for n in api.graph.nodes if not n.endswith((".Void", ".Retired"))})
    step = max(1, len(names) // count)
    return names[::step][:count]


def floats_of(data: Any) -> list[float]:
    """Return every float inside a JSON value."""
    if isinstance(data, float):
        return [data]
    if isinstance(data, dict):
        return [f for v in data.values() for f in floats_of(v)]
    if isinstance(data, list):
        return [f for v in data for f in floats_of(v)]
    return []


def same_json(web: bytes, reference: Any) -> None:
    """The bytes the api sent read back to exactly idtrack's data, and every float with the same bits."""
    data = json.loads(web)
    assert data == reference
    assert [f.hex() for f in floats_of(data)] == [f.hex() for f in floats_of(reference)]
    assert all(math.isfinite(f) for f in floats_of(data))


def test_health(client: TestClient, check_response: Callable[..., Any]) -> None:
    response = client.get(f"{P}/health")
    assert response.status_code == 200
    assert check_response(response, f"{P}/health") == {"status": "ok", "organisms": ["sus_scrofa"]}


def test_version(client: TestClient, check_response: Callable[..., Any], cut_registry: Registry) -> None:
    import idtrack

    response = client.get(f"{P}/version")
    data = check_response(response, f"{P}/version")
    assert data["idtrack_version"] == idtrack.__version__
    [graph] = data["graphs"]
    loaded = cut_registry.graphs["sus_scrofa"]
    assert graph["file"] == loaded.entry.file.model_dump(mode="json")
    assert graph["content_digest"] == loaded.graph.identity().content_digest
    assert data["manifest"]["key"] == f"idtrack/{FORMAT_VERSION}/manifest.json"
    assert data["graph_format_version"] == FORMAT_VERSION == graph["format_version"]


def test_vocabulary_is_idtracks_own_tables(client: TestClient, check_response: Callable[..., Any]) -> None:
    from idtrack import results

    from idtrack_web_api.errors import CODES, RETRYABLE, TITLES
    from idtrack_web_api.schemas import attribute_docs, plain_text
    from idtrack_web_api.vocabulary import STATUS_MEANINGS

    data = check_response(client.get(f"{P}/vocabulary"), f"{P}/vocabulary")
    # idtrack's STATUSES carries no texts: the meanings are the api's, and say so.
    assert data["statuses"] == [
        {"code": k, "meaning": STATUS_MEANINGS[k], "source": "idtrack-web"} for k in results.STATUSES
    ]
    tables = {
        "reasons": results.REASONS,
        "step_reasons": results.STEP_REASONS,
        "match_steps": results.MATCH_STEPS,
        "match_prefixes": results.MATCH_PREFIXES,
        "reading_reasons": results.READING_REASONS,
        "place_relations": results.PLACE_RELATIONS,
    }
    for key, table in tables.items():
        assert data[key] == [{"code": k, "meaning": plain_text(v), "source": "idtrack"} for k, v in table.items()]
    assert data["bridge_rules"] == [
        {"code": k, "meaning": plain_text(v), "source": "idtrack", "taken": k in results.BRIDGE_RULES_TAKEN}
        for k, v in results.BRIDGE_RULES.items()
    ]
    candidate = attribute_docs(results.Candidate)
    assert data["candidate_fields"] == [{"code": k, "meaning": v, "source": "idtrack"} for k, v in candidate.items()]
    assert [t["code"] for t in data["criteria"]] == list(results.CRITERIA)
    for term in data["criteria"]:
        # Every criterion is the Candidate field of its name; its meaning is that field's text in idtrack.
        assert term["code"] in {f.name for f in dataclasses.fields(results.Candidate)}
        assert term["meaning"] == candidate[term["code"]]
        assert term["meaning"]
        assert term["source"] == "idtrack"
        assert term["fields"]
    assert data["errors"] == [
        {"code": k, "status": s, "title": TITLES[k], "meaning": m, "retryable": k in RETRYABLE, "source": "idtrack-web"}
        for k, (s, m) in CODES.items()
    ]
    # The api's own tables: the kinds of database, the allowances a 429 names, the modes of source inference.
    assert [t["code"] for t in data["database_kinds"]] == ["ensembl", "accession", "label"]
    assert [t["code"] for t in data["allowances"]] == ["searches", "reads", "search_seconds", "concurrent_searches"]
    from idtrack.engine import SOURCE_MODES

    assert [t["code"] for t in data["source_modes"]] == list(SOURCE_MODES)
    assert all(
        t["source"] == "idtrack-web" for key in ("database_kinds", "allowances", "source_modes") for t in data[key]
    )


def test_limits_are_the_settings(make_client: Callable[..., TestClient], check_response: Callable[..., Any]) -> None:
    client = make_client(rate_per_minute=0, batch_max=7, identifier_max_length=99, request_seconds=12.5)
    data = check_response(client.get(f"{P}/limits"), f"{P}/limits")
    assert data["batch_max"] == 7
    assert data["identifier_max_length"] == 99
    assert data["request_seconds"] == 12.5
    assert data["rate_per_minute"] == 0
    assert set(data) == {
        "batch_max",
        "identifier_max_length",
        "body_max_bytes",
        "response_max_bytes",
        "request_seconds",
        "queue_seconds",
        "search_seconds",
        "search_states",
        "rate_per_minute",
        "rate_burst",
        "read_share",
        "rate_search_seconds",
        "rate_search_burst_seconds",
        "queue_max",
        "head_seconds",
        "body_seconds",
        "answer_cache_bytes",
        "allowances_enforced",
        "allowance_fields",
        "rate_concurrent_searches",
        "send_seconds",
        "send_min_bytes_per_second",
        "sending_max_bytes",
    }
    assert data["allowances_enforced"] is False  # rate_per_minute 0 turns every allowance off
    # The allowances are named by the api (the page marks them as not applied here), each a field of this answer; the
    # bounds of the server as a whole (the send's deadlines, the queue, the sizes) are not among them.
    assert data["allowance_fields"] == [
        "rate_per_minute",
        "rate_burst",
        "read_share",
        "rate_search_seconds",
        "rate_search_burst_seconds",
        "rate_concurrent_searches",
    ]
    assert set(data["allowance_fields"]) <= set(data)
    too_many = client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": ["A"] * 8})
    assert too_many.status_code == 413
    assert "at most 7" in too_many.json()["error"]["message"]


def test_organisms(client: TestClient, check_response: Callable[..., Any], cut_idtrack: API) -> None:
    data = check_response(client.get(f"{P}/organisms"), f"{P}/organisms")
    assert data == {
        "organisms": [cut_idtrack.describe().to_dict()],
        "names": [{"organism": "sus_scrofa", "aliases": ["pig"]}],
    }
    for name in ("sus_scrofa", "pig", "Sus scrofa"):
        response = client.get(f"{P}/organisms/{name}")
        assert check_response(response, f"{P}/organisms/{{organism}}") == cut_idtrack.describe().to_dict()


def test_final_databases(client: TestClient, check_response: Callable[..., Any], cut_idtrack: API) -> None:
    path = f"{P}/organisms/{{organism}}/final-databases"
    for release in (None, 56, 66, 67, 89, 90, 115):
        query = "" if release is None else f"?to_release={release}"
        data = check_response(client.get(f"{P}/organisms/pig/final-databases{query}"), path)
        assert data == {
            "organism": "sus_scrofa",
            "to_release": 115 if release is None else release,
            "final_databases": cut_idtrack.final_databases(release),
        }


def test_databases_matrix_is_idtracks_own_calls(
    client: TestClient, check_response: Callable[..., Any], cut_idtrack: API
) -> None:
    path = f"{P}/organisms/{{organism}}/databases"
    data = check_response(client.get(f"{P}/organisms/pig/databases"), path)
    releases = cut_idtrack.describe().releases
    assert data["organism"] == "sus_scrofa"
    assert data["releases"] == list(releases)
    for release in releases:
        row = sorted(d["name"] for d in data["databases"] if release in d["releases"])
        assert row == sorted(cut_idtrack.final_databases(release)), release
    names = [d["name"] for d in data["databases"]]
    assert names == sorted({d for r in releases for d in cut_idtrack.final_databases(r)})
    forms = cut_idtrack.database_forms()
    assert all(d["form"] == forms.get(d["name"]) for d in data["databases"])
    assert {d["name"] for d in data["databases"] if d["form"] is None} == {"ensembl_gene", "base_ensembl_gene"}
    assert data["by_assembly"] == cut_idtrack.databases_by_assembly()
    # The same answer by any name of the organism; an unknown organism is refused.
    assert client.get(f"{P}/organisms/sus_scrofa/databases").json() == data
    response = client.get(f"{P}/organisms/cow/databases")
    assert response.status_code == 404
    assert check_response(response, path)["error"]["code"] == "unknown_organism"


@pytest.mark.parametrize("explain", [False, True])
def test_convert_equals_idtrack(
    client: TestClient, check_response: Callable[..., Any], cut_idtrack: API, *, explain: bool
) -> None:
    path = f"{P}/organisms/{{organism}}/convert"
    identifiers = sample_identifiers(cut_idtrack, 120)
    statuses = set()
    for identifier in identifiers:
        response = client.get(
            f"{P}/organisms/sus_scrofa/convert", params={"identifier": identifier, "explain": str(explain).lower()}
        )
        check_response(response, path)
        reference = cut_idtrack.convert(identifier, explain=explain).to_dict()
        same_json(response.content, reference)
        statuses.add(reference["status"])
    # The sample reaches more than one kind of outcome.
    assert {"converted", "not_found"} <= statuses or len(statuses) >= 2


@pytest.mark.parametrize(
    ("arguments", "params"),
    [
        ({"to_release": 80}, {"to_release": "80"}),
        ({"from_release": 70, "to_release": 115}, {"from_release": "70", "to_release": "115"}),
        ({"final_database": "HGNC Symbol"}, {"final_database": "HGNC Symbol"}),
        ({"final_database": "hgnc symbol"}, {"final_database": "hgnc symbol"}),
        (
            {"final_database": "RefSeq_peptide", "to_release": 100},
            {"final_database": "RefSeq_peptide", "to_release": "100"},
        ),
        (
            {"final_database": "base_ensembl_gene", "to_release": 60},
            {"final_database": "base_ensembl_gene", "to_release": "60"},
        ),
        ({"allow_bridges": False}, {"allow_bridges": "false"}),
        ({"from_database": "EntrezGene"}, {"from_database": "EntrezGene"}),
    ],
)
def test_convert_arguments_equal_idtrack(
    client: TestClient,
    check_response: Callable[..., Any],
    cut_idtrack: API,
    arguments: dict[str, Any],
    params: dict[str, str],
) -> None:
    for identifier in sample_identifiers(cut_idtrack, 40):
        response = client.get(
            f"{P}/organisms/sus_scrofa/convert", params={"identifier": identifier, "explain": "true", **params}
        )
        check_response(response, f"{P}/organisms/{{organism}}/convert")
        same_json(response.content, cut_idtrack.convert(identifier, explain=True, **arguments).to_dict())


def test_convert_keeps_the_identifier_as_given(client: TestClient, cut_idtrack: API) -> None:
    identifier = "  " + sample_identifiers(cut_idtrack, 10)[3] + " "
    response = client.get(f"{P}/organisms/pig/convert", params={"identifier": identifier})
    assert response.status_code == 200
    same_json(response.content, cut_idtrack.convert(identifier).to_dict())
    assert response.json()["query_id"] == identifier


def test_batch_equals_idtrack(client: TestClient, check_response: Callable[..., Any], cut_idtrack: API) -> None:
    identifiers = sample_identifiers(cut_idtrack, 150)
    identifiers += identifiers[:7]  # repeated identifiers keep their places
    identifiers += ["NOT_AN_IDENTIFIER_OF_THIS_GRAPH", " " + identifiers[0]]
    choices: list[dict[str, Any]] = [{}, {"to_release": 90, "final_database": "EntrezGene", "explain": True}]
    for arguments in choices:
        response = client.post(
            f"{P}/organisms/sus_scrofa/convert/batch", json={"identifiers": identifiers, **arguments}
        )
        data = check_response(response, f"{P}/organisms/{{organism}}/convert/batch", "post")
        reference = [r.to_dict() for r in cut_idtrack.convert_many(identifiers, **arguments)]
        assert data["count"] == len(identifiers)
        same_json(json.dumps(data["results"]).encode(), reference)
        read = {
            "from_release": None,
            "to_release": None,
            "final_database": None,
            "from_database": None,
            "explain": False,
            "allow_bridges": True,
            "read_copies": True,
        } | arguments
        same_json(
            response.content,
            {"organism": "sus_scrofa", "arguments": read, "count": len(identifiers), "results": reference},
        )


def test_batch_with_copies_equals_idtrack(
    client: TestClient, check_response: Callable[..., Any], cut_idtrack: API
) -> None:
    """Items that extend another item by a numbered suffix are answered as idtrack's one call over the batch answers
    them (as copies where idtrack judges them so), wherever they stand in the batch."""
    nodes = set(cut_idtrack.graph.nodes)
    genes = [
        g
        for g in sample_identifiers(cut_idtrack, 400)
        if g in nodes and cut_idtrack.graph.node_type(g) == "ensembl_gene"
    ]
    names = sorted({m.name for gene in genes for m in cut_idtrack.names_of(gene)})[:20]
    assert names
    identifiers = [f"{n}-1" for n in names[:10]] + names + [f"{n}.2" for n in names[5:15]] + [f"{names[0]}-1-1"]
    identifiers += ["ENSSSCG00000040076", "ENSSSCG00000040076.1", " " + names[3] + "_3"]
    reference = [r.to_dict() for r in cut_idtrack.convert_many(identifiers)]
    assert any((r["match"] or "").startswith("copy:") for r in reference)  # the batch holds copies
    response = client.post(f"{P}/organisms/sus_scrofa/convert/batch", json={"identifiers": identifiers})
    data = check_response(response, f"{P}/organisms/{{organism}}/convert/batch", "post")
    same_json(json.dumps(data["results"]).encode(), reference)


def test_batch_tsv(client: TestClient, check_response: Callable[..., Any], cut_idtrack: API) -> None:
    identifiers = sample_identifiers(cut_idtrack, 80)
    response = client.post(
        f"{P}/organisms/sus_scrofa/convert/batch?format=tsv",
        json={"identifiers": identifiers, "final_database": "HGNC Symbol"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/tab-separated-values; charset=utf-8"
    # The file is named after what made it: the organism, the target release and the graph's digest.
    digest = str(cut_idtrack.describe().content_digest)
    assert response.headers["content-disposition"] == f'attachment; filename="idtrack_sus_scrofa_115_{digest[:12]}.tsv"'
    check_response(response, f"{P}/organisms/{{organism}}/convert/batch", "post")
    rows = list(csv.reader(io.StringIO(response.text), delimiter="\t", quoting=csv.QUOTE_NONE))
    assert tuple(rows[0]) == tsv.COLUMNS
    reference = [r.to_dict() for r in cut_idtrack.convert_many(identifiers, final_database="HGNC Symbol")]
    expected_rows = sum(max(1, len(r["candidates"])) for r in reference)
    assert len(rows) - 1 == expected_rows
    # Every field of a result and of a candidate is a column (but the path and the candidates' indices into it).
    fields = {f.name for f in dataclasses.fields(results.ConversionResult)} - {"candidates", "path", "error"}
    assert fields <= set(tsv.RESULT_COLUMNS)
    assert {f.name for f in dataclasses.fields(results.Candidate)} - {"path", "final_path"} <= set(
        tsv.CANDIDATE_COLUMNS
    )
    position = {name: i for i, name in enumerate(tsv.COLUMNS)}
    row = 1
    for index, result in enumerate(reference):
        for rank, candidate in enumerate(result["candidates"] or [None], start=1):
            cells = rows[row]
            assert cells[position["input_index"]] == str(index)
            assert cells[position["query_id"]] == result["query_id"]
            assert cells[position["status"]] == result["status"]
            if candidate is not None:
                assert cells[position["rank"]] == str(rank)
                assert cells[position["target"]] == candidate["target"]
                # The score reads back as exactly the same float.
                assert float(cells[position["score"]]) == candidate["score"]
                assert cells[position["best"]] == ("true" if candidate["best"] else "false")
            row += 1


def test_names(client: TestClient, check_response: Callable[..., Any], cut_idtrack: API) -> None:
    nodes = set(cut_idtrack.graph.nodes)
    genes = [
        n
        for n in sample_identifiers(cut_idtrack, 400)
        if n in nodes and cut_idtrack.graph.node_type(n) == "ensembl_gene"
    ][:15]
    assert genes
    seen_names = []
    for gene in genes:
        for release in (None, 115, 80):
            params = {"gene": gene} | ({} if release is None else {"release": str(release)})
            data = check_response(
                client.get(f"{P}/organisms/pig/names-of", params=params), f"{P}/organisms/{{organism}}/names-of"
            )
            assert data == {
                "organism": "sus_scrofa",
                "arguments": {"gene": gene, "release": release},
                "matches": [m.to_dict() for m in cut_idtrack.names_of(gene, release)],
            }
            seen_names += [m["name"] for m in data["matches"]]
    assert seen_names
    for name in sorted(set(seen_names))[:30]:
        for fold_case in (False, True):
            response = client.get(
                f"{P}/organisms/pig/genes-named", params={"name": name.lower(), "fold_case": str(fold_case).lower()}
            )
            data = check_response(response, f"{P}/organisms/{{organism}}/genes-named")
            assert data == {
                "organism": "sus_scrofa",
                "arguments": {"name": name.lower(), "fold_case": fold_case, "release": None},
                "matches": [m.to_dict() for m in cut_idtrack.genes_named(name.lower(), fold_case)],
            }


def test_the_documentation_address_follows_the_setting(make_client: Callable[..., TestClient]) -> None:
    default = make_client(rate_per_minute=0)
    assert default.get(f"{P}/version").json()["docs_url"] == "https://idtrack.readthedocs.io/en/stable/"
    moved = make_client(rate_per_minute=0, docs_url="https://docs.example.org/")
    assert moved.get(f"{P}/version").json()["docs_url"] == "https://docs.example.org/"
    # The texts for programs link the documentation where this server says it is, never the default's address.
    assert "https://docs.example.org/" in moved.get("/llms.txt").text
    for path in ("/llms.txt", "/llms-full.txt"):
        assert "idtrack.readthedocs.io" not in moved.get(path).text
