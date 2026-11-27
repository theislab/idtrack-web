"""The real pig graph (``IDTRACK_WEB_TEST_GRAPHS``): a sample of real calls, each answer equal to idtrack's own."""

from __future__ import annotations

import json
from dataclasses import replace
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from idtrack_web_api.app import asgi_app
from tests.conftest import settings_of
from tests.test_endpoints import floats_of, same_json, sample_identifiers

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

    from idtrack.api import API

    from idtrack_web_api.graphs import Registry

pytestmark = pytest.mark.real
P = "/api/v1"
CONVERT = f"{P}/organisms/{{organism}}/convert"


@pytest.fixture(scope="module")
def pig(real_pig: tuple[Registry, API, Path]) -> Iterator[tuple[TestClient, API]]:
    registry, api, root = real_pig
    with TestClient(asgi_app(replace(settings_of(root), rate_per_minute=0), registry)) as client:
        yield client, api


ARGUMENTS: list[dict[str, Any]] = [
    {},
    {"explain": True},
    {"to_release": 89, "explain": True},
    {"to_release": 66, "final_database": "base_ensembl_gene"},
    {"from_release": 80, "to_release": 115, "explain": True},
    {"final_database": "HGNC Symbol", "explain": True},
    {"final_database": "EntrezGene", "to_release": 100},
    {"final_database": "RefSeq_peptide", "allow_bridges": False},
]


def params_of(arguments: dict[str, Any]) -> dict[str, str]:
    return {k: (str(v).lower() if isinstance(v, bool) else str(v)) for k, v in arguments.items()}


@pytest.mark.parametrize("arguments", ARGUMENTS, ids=[json.dumps(a) for a in ARGUMENTS])
def test_real_conversions_equal_idtrack(
    pig: tuple[TestClient, API], check_response: Callable[..., Any], arguments: dict[str, Any]
) -> None:
    client, api = pig
    floats: list[float] = []
    statuses: set[str] = set()
    for identifier in sample_identifiers(api, 150):
        response = client.get(f"{P}/organisms/pig/convert", params={"identifier": identifier, **params_of(arguments)})
        check_response(response, CONVERT)
        reference = api.convert(identifier, **arguments).to_dict()
        same_json(response.content, reference)
        floats += floats_of(reference)
        statuses.add(reference["status"])
    assert floats, "the sample holds scores"
    assert len(statuses) >= 2, statuses


def test_real_scores_that_are_not_round(pig: tuple[TestClient, API]) -> None:
    """Scores below 1 (Ensembl's mapping scores multiplied along a path) reach the client with every bit."""
    client, api = pig
    seen = []
    nodes = set(api.graph.nodes)
    for identifier in sample_identifiers(api, 3000):
        if identifier not in nodes or api.graph.node_type(identifier) != "ensembl_gene":
            continue
        reference = api.convert(identifier, to_release=115).to_dict()
        scores = [c["score"] for c in reference["candidates"] if c["score"] not in (0.0, 1.0)]
        if scores:
            response = client.get(f"{P}/organisms/pig/convert", params={"identifier": identifier, "to_release": "115"})
            same_json(response.content, reference)
            seen += scores
        if len(seen) >= 25:
            break
    assert len(seen) >= 25, seen


def test_real_path_example(pig: tuple[TestClient, API], check_response: Callable[..., Any]) -> None:
    """A gene id gone at the Sscrofa10.2 to 11.1 handoff, answered through a bridge, with every bridge considered."""
    client, api = pig
    response = client.get(
        f"{P}/organisms/sus_scrofa/convert", params={"identifier": "ENSSSCG00000024116.1", "explain": "true"}
    )
    data = check_response(response, CONVERT)
    same_json(response.content, api.convert("ENSSSCG00000024116.1", explain=True).to_dict())
    assert data["from_release"] == 89
    kinds = {step["kind"] for step in data["path"]["steps"]}
    assert {"bridge_near", "bridge_far"} <= kinds
    assert any(bridge["taken"] for bridge in data["path"]["bridges"])


def test_real_batch_equals_idtrack(pig: tuple[TestClient, API], check_response: Callable[..., Any]) -> None:
    client, api = pig
    identifiers = sample_identifiers(api, 400)
    for arguments in ({"explain": True}, {"final_database": "HGNC Symbol", "to_release": 100}):
        response = client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": identifiers, **arguments})
        check_response(response, f"{P}/organisms/{{organism}}/convert/batch", "post")
        reference = [r.to_dict() for r in api.convert_many(identifiers, **arguments)]
        same_json(response.content, {"count": len(identifiers), "results": reference})


def test_real_description_and_names(pig: tuple[TestClient, API], check_response: Callable[..., Any]) -> None:
    client, api = pig
    data = check_response(client.get(f"{P}/organisms/pig"), f"{P}/organisms/{{organism}}")
    assert data == api.describe().to_dict()
    assert [a["name"] for a in data["assemblies"]] == ["Sscrofa11.1", "Sscrofa10.2", "Sscrofa9"]
    for name in ("INS", "TP53", "GCG", "PDX1"):
        response = client.get(f"{P}/organisms/pig/genes-named", params={"name": name})
        data = check_response(response, f"{P}/organisms/{{organism}}/genes-named")
        assert data == {"matches": [m.to_dict() for m in api.genes_named(name)]}
        for gene in sorted({m["gene"] for m in data["matches"]})[:3]:
            response = client.get(f"{P}/organisms/pig/names-of", params={"gene": gene})
            names = check_response(response, f"{P}/organisms/{{organism}}/names-of")
            assert names == {"matches": [m.to_dict() for m in api.names_of(gene)]}
