"""Every validation and error path: the status, the stable code, a message that names the problem, the schema."""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from typing import TYPE_CHECKING, Any

import pytest

from idtrack_web_api import service
from idtrack_web_api.errors import CODES, RETRY
from idtrack_web_api.graphs import LoadedGraph, Registry, load_graph
from tests.conftest import without_cautions

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastapi.testclient import TestClient
    from idtrack.api import API

P = "/api/v1"
CONVERT = f"{P}/organisms/{{organism}}/convert"
BATCH = f"{P}/organisms/{{organism}}/convert/batch"
INFERENCE = f"{P}/organisms/{{organism}}/source-inference"
CONVERT_URL = f"{P}/organisms/pig/convert"
GENE = "ENSSSCG00000040076.1"


def error_of(response: Any, check_response: Callable[..., Any], path: str, method: str = "get") -> dict[str, Any]:
    data = check_response(response, path, method)
    error: dict[str, Any] = data["error"]
    assert CODES[error["code"]][0] == response.status_code
    assert error["message"]
    assert "Traceback" not in error["message"]
    return error


@pytest.mark.parametrize(
    ("query", "status", "code", "argument"),
    [
        ({"identifier": GENE, "to_release": "999"}, 400, "unknown_release", "to_release"),
        ({"identifier": GENE, "from_release": "55"}, 400, "unknown_release", "from_release"),
        ({"identifier": GENE, "to_release": "0"}, 400, "unknown_release", "to_release"),
        ({"identifier": GENE, "to_release": "80.5"}, 400, "invalid_request", "to_release"),
        ({"identifier": GENE, "to_release": "eighty"}, 400, "invalid_request", "to_release"),
        ({"identifier": GENE, "to_release": "115.0"}, 400, "invalid_request", "to_release"),
        ({"identifier": GENE, "to_release": " 115"}, 400, "invalid_request", "to_release"),
        ({"identifier": GENE, "to_release": "+115"}, 400, "invalid_request", "to_release"),
        ({"identifier": GENE, "to_release": "1" * 12}, 400, "invalid_request", "to_release"),
        ({"identifier": GENE, "explain": "maybe"}, 400, "invalid_request", "explain"),
        ({"identifier": GENE, "explain": "yes"}, 400, "invalid_request", "explain"),
        ({"identifier": GENE, "explain": "1"}, 400, "invalid_request", "explain"),
        ({"identifier": GENE, "final_database": "NOT A DATABASE"}, 400, "unknown_database", "final_database"),
        (
            {"identifier": GENE, "final_database": "VGNC Symbol", "to_release": "60"},
            400,
            "unknown_database",
            "final_database",
        ),
        ({"identifier": GENE, "final_database": ""}, 400, "invalid_argument", "final_database"),
        ({"identifier": GENE, "final_database": "x" * 201}, 400, "invalid_argument", "final_database"),
        ({"identifier": GENE, "from_database": "ensembl_gene"}, 400, "unknown_database", "from_database"),
        ({}, 400, "invalid_request", "identifier"),
        ({"identifier": ""}, 400, "missing_value", "identifier"),
        ({"identifier": "   "}, 400, "missing_value", "identifier"),
        ({"identifier": "A" * 257}, 400, "invalid_identifier", "identifier"),
        ({"identifier": "TP53\x00"}, 400, "invalid_identifier", "identifier"),
        ({"identifier": "TP\u000753"}, 400, "invalid_identifier", "identifier"),
        ({"identifier": GENE, "to_releas": "80"}, 400, "unknown_parameter", "to_releas"),
    ],
)
def test_convert_input_errors(
    client: TestClient,
    check_response: Callable[..., Any],
    query: dict[str, str],
    status: int,
    code: str,
    argument: str | None,
) -> None:
    response = client.get(f"{P}/organisms/pig/convert", params=query)
    assert response.status_code == status, response.text
    error = error_of(response, check_response, CONVERT)
    assert error["code"] == code
    assert error["argument"] == argument


def test_unknown_release_lists_the_releases(client: TestClient, check_response: Callable[..., Any]) -> None:
    error = error_of(
        client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "to_release": 116}),
        check_response,
        CONVERT,
    )
    assert error["allowed"] == list(range(56, 116))
    assert "56 to 115" in error["message"]


def test_repeated_parameter(client: TestClient, check_response: Callable[..., Any]) -> None:
    response = client.get(f"{P}/organisms/pig/convert?identifier=A&identifier=B")
    assert error_of(response, check_response, CONVERT)["code"] == "unknown_parameter"


def test_unknown_organism(client: TestClient, check_response: Callable[..., Any]) -> None:
    for path, template in (
        (f"{P}/organisms/cow", f"{P}/organisms/{{organism}}"),
        (f"{P}/organisms/homo_sapiens/convert?identifier=TP53", CONVERT),
        (f"{P}/organisms/human/names-of?gene={GENE}", f"{P}/organisms/{{organism}}/names-of"),
    ):
        response = client.get(path)
        assert response.status_code == 404
        error = error_of(response, check_response, template)
        assert error["code"] == "unknown_organism"
        assert error["allowed"] == ["sus_scrofa"]


def test_not_found_and_method(client: TestClient) -> None:
    for path in (f"{P}/nothing", f"{P}/organisms/pig/convert/other", "/", "/index.html"):
        response = client.get(path)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
    response = client.post(f"{P}/organisms/pig/convert", json={})
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"
    response = client.get(f"{P}/organisms/pig/convert/batch")
    assert response.status_code == 405


def test_names_errors(client: TestClient, check_response: Callable[..., Any]) -> None:
    names_of = f"{P}/organisms/{{organism}}/names-of"
    response = client.get(f"{P}/organisms/pig/names-of", params={"gene": "NOT.1"})
    assert error_of(response, check_response, names_of)["code"] == "unknown_identifier"
    response = client.get(f"{P}/organisms/pig/names-of", params={"gene": GENE, "release": 20})
    assert error_of(response, check_response, names_of)["code"] == "unknown_release"
    # An empty name (or one of white space alone) is refused as an empty identifier is: there is nothing to look up.
    for empty in ("", "  "):
        response = client.get(f"{P}/organisms/pig/genes-named", params={"name": empty})
        error = error_of(response, check_response, f"{P}/organisms/{{organism}}/genes-named")
        assert (error["code"], error["argument"]) == ("missing_value", "name")
    response = client.get(f"{P}/organisms/pig/genes-named", params={"name": "INS", "fold_case": "2"})
    assert error_of(response, check_response, f"{P}/organisms/{{organism}}/genes-named")["code"] == "invalid_request"
    response = client.get(f"{P}/organisms/pig/final-databases", params={"to_release": 40})
    assert (
        error_of(response, check_response, f"{P}/organisms/{{organism}}/final-databases")["code"] == "unknown_release"
    )
    response = client.get(f"{P}/health?verbose=1")
    assert error_of(response, check_response, f"{P}/health")["code"] == "unknown_parameter"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({}, "invalid_request"),
        ({"identifiers": []}, "invalid_request"),
        ({"identifiers": "TP53"}, "invalid_request"),
        ({"identifiers": ["TP53", 5]}, "invalid_request"),
        ({"identifiers": ["TP53"], "to_release": "115"}, "invalid_request"),
        ({"identifiers": ["TP53"], "to_release": 115.0}, "invalid_request"),
        ({"identifiers": ["TP53"], "to_release": True}, "invalid_request"),
        ({"identifiers": ["TP53"], "explain": "yes"}, "invalid_request"),
        ({"identifiers": ["TP53"], "strategy": "all"}, "invalid_request"),
        ({"identifiers": ["TP53"], "to_release": 200}, "unknown_release"),
        ({"identifiers": ["TP53"], "final_database": "nope"}, "unknown_database"),
        ({"identifiers": ["TP53", "", "INS", "A\tB"]}, "invalid_identifier"),
    ],
)
def test_batch_input_errors(
    client: TestClient, check_response: Callable[..., Any], body: dict[str, Any], code: str
) -> None:
    response = client.post(f"{P}/organisms/pig/convert/batch", json=body)
    error = error_of(response, check_response, BATCH, "post")
    assert error["code"] == code, response.text


def test_batch_invalid_identifiers_say_where(client: TestClient, check_response: Callable[..., Any]) -> None:
    response = client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": ["TP53", "A\x00", "INS", "A\tB"]})
    error = error_of(response, check_response, BATCH, "post")
    assert [d["location"] for d in error["details"]] == [["body", "identifiers", 1], ["body", "identifiers", 3]]


def test_batch_empty_and_missing_items_are_idtracks_to_answer(
    client: TestClient, check_response: Callable[..., Any], cut_idtrack: API
) -> None:
    """An empty item or a spelling of a missing value is that item's error, as idtrack answers it; the batch goes on."""
    identifiers = ["HSPB1", "", "NA", "  ", "nan"]
    response = client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": identifiers})
    data = check_response(response, BATCH, "post")
    reference = [r.to_dict() for r in cut_idtrack.convert_many(identifiers)]
    for item in reference:  # the api adds the stable code of an item's error
        if item["error"] is not None:
            item["error"]["code"] = "missing_value"
    assert without_cautions(data["results"]) == reference
    assert [r["status"] for r in data["results"]] == ["converted", "error", "error", "error", "error"]
    assert data["results"][1]["error"]["code"] == "missing_value"


def test_batch_body_errors(make_client: Callable[..., TestClient], check_response: Callable[..., Any]) -> None:
    client = make_client(rate_per_minute=0, batch_max=3, body_max_bytes=2048)
    url = f"{P}/organisms/pig/convert/batch"
    response = client.post(url, content=b'{"identifiers": ["A"]}', headers={"content-type": "text/plain"})
    assert error_of(response, check_response, BATCH, "post")["code"] == "unsupported_media_type"
    response = client.post(url, content=b'{"identifiers": ["A"]', headers={"content-type": "application/json"})
    assert error_of(response, check_response, BATCH, "post")["code"] == "invalid_request"
    response = client.post(url, json={"identifiers": ["A", "B", "C", "D"]})
    assert response.status_code == 413
    assert error_of(response, check_response, BATCH, "post")["code"] == "too_many_identifiers"
    response = client.post(url, json={"identifiers": ["A" * 200] * 3, "final_database": "x" * 2000})
    assert response.status_code == 413
    assert error_of(response, check_response, BATCH, "post")["code"] == "payload_too_large"

    def chunks() -> Any:  # no Content-Length: the bound holds on what arrives
        yield b'{"identifiers": ['
        for _ in range(200):
            yield b'"ABCDEFGHIJ",'
        yield b'"A"]}'

    response = client.post(url, content=chunks(), headers={"content-type": "application/json"})
    assert response.status_code == 413
    response = client.post(url + "?format=xml", json={"identifiers": ["A"]})
    assert error_of(response, check_response, BATCH, "post")["code"] == "invalid_request"


def test_search_budget_exceeded(
    cut_registry: Registry,
    make_client: Callable[..., TestClient],
    check_response: Callable[..., Any],
) -> None:
    graphs = {
        o: load_graph(g.path, g.lineages, g.entry, budget_states=1, budget_seconds=10.0)
        for o, g in cut_registry.graphs.items()
    }
    client = make_client(registry=Registry(graphs=graphs, manifest_file=cut_registry.manifest_file), rate_per_minute=0)
    response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "to_release": 56})
    assert response.status_code == 422, response.text
    error = error_of(response, check_response, CONVERT)
    assert error["code"] == "search_budget_exceeded"
    # In a batch, an identifier over its budget is that item's error; the batch goes on.
    response = client.post(
        f"{P}/organisms/pig/convert/batch", json={"identifiers": [GENE, "NOT_IN_GRAPH"], "to_release": 56}
    )
    data = check_response(response, BATCH, "post")
    assert data["results"][0]["status"] == "error"
    assert data["results"][0]["error"]["type"] == "SearchBudgetExceededError"
    assert data["results"][1]["status"] == "not_found"


def test_request_budget(
    make_client: Callable[..., TestClient], check_response: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    client = make_client(rate_per_minute=0)
    calls = {"n": 0}

    def remaining(_deadline: float) -> float:
        calls["n"] += 1
        return 5.0 if calls["n"] <= 2 else -1.0

    monkeypatch.setattr(service, "_remaining", remaining)
    response = client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": ["A", "B", "C"]})
    assert response.status_code == 503
    error = error_of(response, check_response, BATCH, "post")
    assert error["code"] == "request_budget_exceeded"
    assert "2 of the 3" in error["message"]
    # Searching with or without the paths takes the same time (every search reads them): only fewer identifiers help.
    assert error["argument"] == "identifiers" and "explain" not in error["message"]
    assert response.headers["retry-after"] == "5"
    # How far it went, as fields a program reads (identifiers of a batch).
    assert error["progress"] == {"answered": 2, "of": 3, "items": "identifiers"}
    # The budget runs from when the search begins: the time a request waited for a worker is not part of it, and a
    # request that waited longer than a search may (`queue_seconds`) is the server's load, not the request's size.
    waiting = make_client(rate_per_minute=0, queue_seconds=1e-9)
    response = waiting.get(f"{P}/organisms/pig/convert", params={"identifier": GENE})
    assert response.status_code == 503
    error = error_of(response, check_response, CONVERT)
    assert error["code"] == "server_busy"
    assert "was not searched" in error["message"] and "fewer" not in error["message"]
    assert response.headers["retry-after"] == "5"


def test_queue_full(make_client: Callable[..., TestClient], check_response: Callable[..., Any]) -> None:
    client = make_client(rate_per_minute=0, queue_max=2)
    slot = client.app.app.state.slot  # type: ignore[attr-defined]  # Guard -> FastAPI
    slot.waiting = 2
    try:
        response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE})
    finally:
        slot.waiting = 0
    assert response.status_code == 503
    assert error_of(response, check_response, CONVERT)["code"] == "server_busy"
    assert response.headers["retry-after"] == "2"


def test_a_refusal_for_the_servers_capacity_costs_no_search_of_the_allowance(
    make_client: Callable[..., TestClient], check_response: Callable[..., Any]
) -> None:
    """A search refused because the worker holds too many answers not yet taken (the server's own capacity) gives its
    client's search back: after the refusals, the client still has its whole burst."""
    client = make_client(rate_per_minute=6, rate_burst=3, rate_search_seconds=0.0)
    guard = client.app.guard  # type: ignore[attr-defined]  # the outer layer: it holds the answers not yet taken
    held = guard.sending
    guard.sending = guard.settings.sending_max_bytes + 1
    try:
        for i in range(5):
            response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "to_release": str(70 + i)})
            assert response.status_code == 503
            assert error_of(response, check_response, CONVERT)["code"] == "server_busy"
    finally:
        guard.sending = held
    for i in range(3):
        params = {"identifier": GENE, "to_release": str(60 + i)}  # distinct: never an answer kept in memory
        assert client.get(f"{P}/organisms/pig/convert", params=params).status_code == 200, i
    response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "to_release": "80"})
    assert response.status_code == 429


def test_response_too_large(make_client: Callable[..., TestClient], check_response: Callable[..., Any]) -> None:
    client = make_client(rate_per_minute=0, response_max_bytes=600)
    response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "explain": "true"})
    assert response.status_code == 422
    assert error_of(response, check_response, CONVERT)["code"] == "response_too_large"
    response = client.post(f"{P}/organisms/pig/convert/batch?format=tsv", json={"identifiers": [GENE] * 20})
    assert error_of(response, check_response, BATCH, "post")["code"] == "response_too_large"


def test_rate_limit(make_client: Callable[..., TestClient], check_response: Callable[..., Any]) -> None:
    """Searches draw on one allowance, reads on one ten times as large; the health check on none."""
    client = make_client(rate_per_minute=6, rate_burst=3, rate_search_seconds=0.0)
    for i in range(3):
        params = {"identifier": f"{GENE}", "to_release": str(60 + i)}  # distinct: never an answer kept in memory
        assert client.get(f"{P}/organisms/pig/convert", params=params).status_code == 200
    response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "to_release": "70"})
    assert response.status_code == 429
    error = error_of(response, check_response, CONVERT)
    assert error["code"] == "rate_limited"
    assert "searching requests" in error["message"]
    assert 1 <= int(response.headers["retry-after"]) <= 10
    # The page's reads still go through: their allowance is ten times as large (30 here).
    codes = [client.get(f"{P}/vocabulary").status_code for _ in range(30)]
    assert codes == [200] * 30
    assert client.get(f"{P}/vocabulary").status_code == 429
    # The health check is never limited.
    assert client.get(f"{P}/health").status_code == 200


def test_search_time_is_charged(make_client: Callable[..., TestClient], check_response: Callable[..., Any]) -> None:
    """A client whose searches used more than its search seconds waits until its balance is back to zero."""
    # An allowance of search time far below any search's cost (a microsecond a minute, a microsecond of burst): the
    # first search, however fast the machine, leaves the balance below zero for the next.
    client = make_client(
        rate_per_minute=1000, rate_burst=1000, rate_search_seconds=0.000001, rate_search_burst_seconds=0.000001
    )
    first = client.post(f"{P}/organisms/pig/convert/batch", json={"identifiers": [GENE, "HSPB1"], "explain": True})
    assert first.status_code == 200
    response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE, "to_release": "80"})
    assert response.status_code == 429, response.text
    error = error_of(response, check_response, CONVERT)
    assert error["code"] == "rate_limited"
    assert "balance of search time is used up" in error["message"]
    assert int(response.headers["retry-after"]) >= 1


def test_internal_error_is_a_500_with_an_id(
    client: TestClient,
    check_response: Callable[..., Any],
    monkeypatch: pytest.MonkeyPatch,
    cut_registry: Registry,
    caplog: pytest.LogCaptureFixture,
) -> None:
    graph: LoadedGraph = cut_registry.graphs["sus_scrofa"]

    def broken(*_args: Any, **_kwargs: Any) -> Any:
        msg = "secret internal detail"
        raise RuntimeError(msg)

    monkeypatch.setattr(graph.graph.api, "convert", broken)
    with caplog.at_level(logging.ERROR, logger="idtrack_web_api"):
        response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE})
    assert response.status_code == 500
    error = error_of(response, check_response, CONVERT)
    assert error["code"] == "internal_error"
    assert error["request_id"] in error["message"]
    assert "secret internal detail" not in response.text
    assert any("secret internal detail" in r.exc_text for r in caplog.records if r.exc_text)


def test_a_result_that_is_not_strict_json_is_never_sent(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, cut_registry: Registry, cut_idtrack: Any
) -> None:
    """idtrack refuses NaN and infinity in a result (``to_dict()``); the api answers 500 rather than send them."""
    graph: LoadedGraph = cut_registry.graphs["sus_scrofa"]
    result = cut_idtrack.convert(GENE)
    assert result.candidates
    nan = replace(result, candidates=(replace(result.candidates[0], score=float("nan")),))
    monkeypatch.setattr(graph.graph.api, "convert", lambda *_a, **_k: nan)
    response = client.get(f"{P}/organisms/pig/convert", params={"identifier": GENE})
    assert response.status_code == 500
    assert "NaN" not in response.text


def test_every_code_is_in_the_readme() -> None:
    from pathlib import Path

    readme = (Path(__file__).resolve().parents[2] / "README.md").read_text(encoding="utf-8")
    for code, (status, _) in CODES.items():
        assert f"| `{code}` | {status} |" in readme, code


def test_a_value_outside_a_set_is_quoted_and_the_set_listed(
    client: TestClient, check_response: Callable[..., Any]
) -> None:
    """A body's value of the right type outside its set is named as sent (not by its type) and the set's values are
    in `allowed`; a key the body does not take lists the keys it takes; a query's whole number is written in digits
    in every message, whichever parameter it is."""
    url = f"{P}/organisms/pig/source-inference"
    for sent in ("nope", 5):
        error = error_of(client.post(url, json={"identifiers": ["A"], "mode": sent}), check_response, INFERENCE, "post")
        assert f"not {json.dumps(sent)}" in error["message"] and "not a string" not in error["message"]
        assert error["argument"] == "mode" and error["allowed"] == [
            "assembly_release",
            "release",
            "assembly",
            "complete",
        ]
    error = error_of(client.post(url, json={"identifiers": ["A"], "modes": "x"}), check_response, INFERENCE, "post")
    assert error["argument"] == "modes" and error["allowed"] == ["identifiers", "mode"]
    error = error_of(client.post(url, json={"identifiers": "A"}), check_response, INFERENCE, "post")
    assert error["allowed"] is None and "not a string" in error["message"]
    for path, params in ((f"{P}/organisms/pig/lineages", {}), (CONVERT_URL, {"identifier": GENE})):
        name = "limit" if params == {} else "to_release"
        error = client.get(path, params={name: "abc", **params}).json()["error"]
        assert "written in digits only" in error["message"] and 'not "abc"' in error["message"], error


def test_a_search_refused_for_what_it_holds_is_counted_as_a_read(make_client: Callable[..., TestClient]) -> None:
    """The allowance of searches counts the requests that were searched: a batch refused for its size or its shape
    gives its token back (and takes one of the reads), so a client's mistakes do not use up its searches."""
    client = make_client(rate_per_minute=6, rate_burst=3, rate_search_seconds=0.0, batch_max=10)
    url = f"{P}/organisms/pig/convert/batch"
    assert client.post(url, json={"identifiers": [GENE]}).status_code == 200
    for body in ({"identifiers": ["A"] * 11}, {"identifiers": "A"}, {"identifiers": ["A"], "nope": 1}):
        response = client.post(url, json=body)
        assert response.status_code in {400, 413}, response.text
        assert '"searches";r=2' in response.headers["ratelimit"], response.headers["ratelimit"]
    assert client.post(url, json={"identifiers": [GENE, "B"]}).status_code == 200
    assert client.post(url, json={"identifiers": [GENE, "C"]}).status_code == 200
    response = client.post(url, json={"identifiers": [GENE, "D"]})
    assert response.status_code == 429


def test_the_retry_of_each_code_is_one_table(client: TestClient) -> None:
    """The vocabulary says per code whether to retry, whether the refusal carries `Retry-After` and what to do; the
    texts for programs write the same words."""
    errors = {e["code"]: e for e in client.get(f"{P}/vocabulary").json()["errors"]}
    assert {c for c, e in errors.items() if e["retryable"]} == set(RETRY)
    assert {c for c, e in errors.items() if e["retry_after"]} == {
        "rate_limited",
        "server_busy",
        "request_budget_exceeded",
    }
    assert "smaller pieces" in errors["request_budget_exceeded"]["retry"]
    assert errors["invalid_request"]["retry"].startswith("Change the request")
    full = client.get("/llms-full.txt").text
    assert all(e["retry"] in full for e in errors.values())
