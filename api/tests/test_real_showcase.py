"""The real graphs of ``IDTRACK_WEB_TEST_GRAPHS`` (the five organisms; one missing is skipped): every showcase journey
is answered, every case shows its kind, the examples of the OpenAPI document are still the answers, and the history
counts hold together.

The rules of a case's kind are those of the home page's (``web/src/lib/home/caseKinds.ts``), read from the answer's
own fields, never from the identifier.
"""

from __future__ import annotations

import itertools
import json
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from idtrack_web_api import showcase
from idtrack_web_api.app import asgi_app
from idtrack_web_api.contract import _examples
from idtrack_web_api.publish import DirectoryTarget, publish
from tests.conftest import real_graph_of, real_graphs_folder, registry_of, settings_of

if TYPE_CHECKING:
    from collections.abc import Iterator

    from idtrack_web_api.graphs import Registry

pytestmark = pytest.mark.real
P = "/api/v1"


def best_steps(result: dict[str, Any]) -> list[dict[str, Any]]:
    """The steps of the first best candidate, in order (its path, then its final path)."""
    best = next((c for c in result["candidates"] if c["best"]), None)
    steps = (result.get("path") or {}).get("steps") or []
    if best is None:
        return []
    return [steps[i] for i in [*best["path"], *best["final_path"]] if i < len(steps)]


def is_handoff(step: dict[str, Any]) -> bool:
    """A history step between two assemblies."""
    return (
        step["kind"] in {"history", "self_loop"}
        and step["old_assembly"] is not None
        and step["assembly"] is not None
        and step["old_assembly"] != step["assembly"]
    )


def holds_kind(kind: str, result: dict[str, Any], assemblies: set[int]) -> bool:  # noqa: PLR0911 - one per kind
    """Whether an answer shows the kind (caseKinds.ts, and ``lineage``: steps on every assembly of the graph)."""
    steps = best_steps(result)
    reasons = {s["reason"] for s in steps}
    if kind in {"new_version", "replaced", "merge", "final"}:
        return kind in reasons and any(c["best"] for c in result["candidates"])
    if kind == "renamed":
        asked = result["final_database"]
        targets = {c["target"] for c in result["candidates"] if c["best"]}
        return (
            "final" in reasons
            and asked in result["from_databases"]
            and bool(targets)
            and result["query_id"] not in targets
        )
    if kind == "retired":
        return result["status"] == "no_conversion" and "no_path_to_target" in result["reasons"]
    if kind == "refused":
        return any(s["reason"] == "mitochondrial_genome" for s in (result.get("path") or {}).get("refused") or [])
    if kind == "split":
        return bool(reasons & {"split", "split_and_merge"})
    if kind == "handoff":
        return any(is_handoff(s) for s in steps)
    if kind == "bridge":
        return {"bridge_near", "bridge_far"} <= reasons
    if kind == "other_release":
        return any(r["reason"] == "other_release" for r in result["other_readings"])
    if kind == "tie":
        return bool(result["status"] == "tie" and result["tie"])
    if kind == "lineage":
        return {a for s in steps for a in (s["assembly"], s["old_assembly"]) if a is not None} == assemblies
    msg = f"unknown kind {kind}"
    raise AssertionError(msg)


#: The store each organism's client serves, by organism (its files, such as the lineages file, are read by tests).
STORES: dict[str, Path] = {}


def client_of(organism: str, tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    graph = real_graph_of(real_graphs_folder(), organism)
    if isinstance(graph, str):
        pytest.skip(graph)
    root = tmp_path_factory.mktemp(f"real_{organism}")
    publish([graph], DirectoryTarget(root, link=True))
    STORES[organism] = root
    settings = replace(settings_of(root), rate_per_minute=0)
    registry: Registry = registry_of(settings)
    with TestClient(asgi_app(settings, registry)) as client:
        yield client


@pytest.fixture(scope="module")
def human(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    yield from client_of("homo_sapiens", tmp_path_factory)


@pytest.fixture(scope="module")
def pig(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    yield from client_of("sus_scrofa", tmp_path_factory)


@pytest.fixture(scope="module", params=["mus_musculus", "macaca_mulatta", "macaca_fascicularis"])
def other(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[str, TestClient]]:
    for client in client_of(request.param, tmp_path_factory):
        yield request.param, client


def check_showcase(client: TestClient, organism: str) -> None:
    data = client.get(f"{P}/organisms/{organism}/showcase").json()
    chosen = showcase.data_of(organism)
    assert chosen is not None
    if data["content_digest"] != chosen["checked_on"]:
        pytest.skip(f"the {organism} graph is not the one the cases were checked on")
    assemblies = {a["assembly"] for a in client.get(f"{P}/organisms/{organism}").json()["assemblies"]}
    assert len(data["journeys"]) == len(chosen["journeys"])
    assert all(j["result"] is not None for j in data["journeys"])
    # Every journey has a best answer with its path, the figure's row.
    assert all(any(c["best"] for c in j["result"]["candidates"]) and j["result"]["path"] for j in data["journeys"])
    assert [c["kind"] for c in data["cases"]] == [c["kind"] for c in chosen["cases"]]
    for case in data["cases"]:
        assert case["result"] is not None, case["query"]
        assert holds_kind(case["kind"], case["result"], assemblies), case["query"]
        # Exactly as /convert answers it with explain=true.
        query = {k: str(v) for k, v in case["query"].items() if v is not None and k != "explain"}
        single = client.get(f"{P}/organisms/{organism}/convert", params={**query, "explain": "true"}).json()
        assert single == case["result"]


def test_human_showcase(human: TestClient) -> None:
    check_showcase(human, "homo_sapiens")


def test_pig_showcase(pig: TestClient) -> None:
    check_showcase(pig, "sus_scrofa")


def test_other_showcases(other: tuple[str, TestClient]) -> None:
    organism, client = other
    check_showcase(client, organism)


def test_every_kind_known() -> None:
    """Every case of the data names a kind of ``showcase.KINDS``; every organism's data has journeys."""
    for organism in ("homo_sapiens", "mus_musculus", "sus_scrofa", "macaca_mulatta", "macaca_fascicularis"):
        chosen = showcase.data_of(organism)
        assert chosen is not None and chosen["journeys"], organism
        assert {c["kind"] for c in chosen["cases"]} <= set(showcase.KINDS), organism


def agrees(found: Any, recorded: Any, *, trimmed: bool) -> bool:
    """Whether an answer is the recorded one: equal, or (a recorded answer trimmed to its first items) its prefix."""
    if isinstance(recorded, dict):
        return (
            isinstance(found, dict)
            and found.keys() == recorded.keys()
            and all(agrees(found[k], v, trimmed=trimmed) for k, v in recorded.items())
        )
    if isinstance(recorded, list):
        if not isinstance(found, list) or len(found) < len(recorded) or (not trimmed and len(found) != len(recorded)):
            return False
        return all(agrees(f, r, trimmed=trimmed) for f, r in zip(found, recorded, strict=False))
    return bool(found == recorded)


#: What a recorded answer holds of the recording server itself (five graphs, its start, its load), not of the human
#: graph: compared where the human graph's part of it is, or not at all (the live load).
_SERVER_WIDE = {"health", "status", "version", "list_organisms", "index"}


def test_examples_are_the_answers(human: TestClient) -> None:
    """Every example of the document is what the API answers now for the request recorded beside it (a change of
    IDTrack, of the showcase or of the graph fails here): each answer of the human graph whole, or its first items
    where the recording trimmed it and says so; of the answers about the server, the human graph's part."""
    from idtrack_web_api.contract import index

    operations = _examples()["operations"]
    document = human.get(f"{P}/openapi.json").json()
    paths = {op["operationId"]: (m, p) for p, ops in document["paths"].items() for m, op in ops.items()}
    assert set(operations) == set(paths), set(paths) ^ set(operations)
    for op, sample in operations.items():
        method, template = paths[op]
        given = dict(sample["parameters"])
        url = template.replace("{organism}", str(given.pop("organism", "homo_sapiens")))
        response = human.post(url, json=sample["body"]) if method == "post" else human.get(url, params=given)
        found = response.json()
        recorded = sample["responses"]["application/json"]
        trimmed = "trimmed" in sample["recorded"]
        if op == "history":
            found.pop("compute_seconds")
            recorded = {k: v for k, v in recorded.items() if k != "compute_seconds"}
        if op in _SERVER_WIDE:
            if op == "index":
                assert recorded == index(document, page=True), op
            elif op == "list_organisms":
                [mine] = [o for o in recorded["organisms"] if o["organism"] == "homo_sapiens"]
                assert agrees(found["organisms"][0], mine, trimmed=False), op
            elif op == "version":
                [mine] = [g for g in recorded["graphs"] if g["organism"] == "homo_sapiens"]
                assert found["graphs"] == [mine], op
                assert {k: found[k] for k in ("api_version", "idtrack_version", "graph_format_version")} == {
                    k: recorded[k] for k in ("api_version", "idtrack_version", "graph_format_version")
                }, op
            continue
        assert agrees(found, recorded, trimmed=trimmed), op


def test_history_holds_together(human: TestClient) -> None:
    data = human.get(f"{P}/organisms/homo_sapiens/history").json()
    releases = {r["release"]: r for r in data["releases"]}
    assert min(releases) == 48 and max(releases) == 115
    # A gene id begins once: the ids created over the releases are at least the ids active at the first release.
    assert sum(r["created"] for r in data["releases"]) >= releases[48]["genes_active"]
    assert all(r["versions_active"] >= r["genes_active"] > 0 for r in data["releases"])
    assert sum(t["retired"] for t in data["transitions"]) > 0


def test_history_is_read_from_the_graph(human: TestClient) -> None:
    """One count recomputed by hand from idtrack's public graph interface: the versions active at the last release."""
    from idtrack.api import API

    graph = real_graph_of(real_graphs_folder(), "homo_sapiens")
    assert isinstance(graph, Path)
    g = API.load(str(graph)).graph
    last = g.snapshot_release
    count = sum(
        1
        for node in g.nodes
        if g.is_backbone(node) and g.version(node) not in {"Void", "Retired"} and g.is_active(node, last)
    )
    data = human.get(f"{P}/organisms/homo_sapiens/history").json()
    assert data["releases"][-1]["versions_active"] == count


@pytest.mark.parametrize("organism", ["homo_sapiens", "sus_scrofa"])
def test_lineages_agree_with_the_history(organism: str, human: TestClient, pig: TestClient) -> None:
    """Every gene id of the published lineages file, counted active at each release from its runs, gives `/history`'s
    `genes_active` at every release of the graph (the human graph holds ids active again after a gap, whose runs end at
    the gap), and `/lineages` gives that file's families."""
    client = human if organism == "homo_sapiens" else pig
    [path] = sorted(STORES[organism].glob(f"idtrack/*/{organism}/*.lineages.json"))
    content = json.loads(path.read_bytes())
    history = client.get(f"{P}/organisms/{organism}/history").json()
    for row in history["releases"]:
        release = row["release"]
        active = sum(1 for runs in content["active"] if any(a <= release <= b for a, b in runs))
        assert active == row["genes_active"], (organism, release)
    releases = content["releases"]
    for runs in content["active"]:
        # Runs are of consecutive releases of the graph, apart from each other by at least one release without one.
        for (_, last), (first, _) in itertools.pairwise(runs):
            assert releases.index(first) > releases.index(last) + 1, runs
    gaps = sum(1 for runs in content["active"] if len(runs) > 1)
    if organism == "homo_sapiens":
        assert gaps > 0, "the human graph holds ids active again after a gap"
    given = client.get(f"{P}/organisms/{organism}/lineages", params={"limit": 50_000}).json()
    file_runs = dict(zip(content["ids"], content["active"], strict=True))
    assert all(file_runs[i] == runs for i, runs in zip(given["ids"], given["active"], strict=True))
