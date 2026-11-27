"""The api's rules for programs: answers written within their bound and charged, refusals in plain words with what to
change, near misses led to the right request, the client's standing in its allowances, every answer tied to its graph,
the tables a client reads (databases, TSV columns), and the endpoints that answer a list's source and every database."""

from __future__ import annotations

import json
import logging
import random
import re
from typing import TYPE_CHECKING, Any

import pytest

from idtrack_web_api import tsv, writing
from idtrack_web_api.contract import ENDPOINT_ERRORS
from idtrack_web_api.errors import CODES
from idtrack_web_api.frontend import Frontend
from tests.conftest import without_cautions
from tests.test_endpoints import sample_identifiers

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from fastapi.testclient import TestClient
    from idtrack.api import API

P = "/api/v1"
CONVERT = f"{P}/organisms/pig/convert"
BATCH = f"{P}/organisms/pig/convert/batch"
GENE = "ENSSSCG00000040076.1"
#: Python's spellings that a message for people never holds.
PYTHON = re.compile(r"\[['\d]|'\]|NoneType|\bdict\b|sys\.|\.\.$|\.;")


def error_of(response: Any) -> dict[str, Any]:
    error: dict[str, Any] = response.json()["error"]
    assert CODES[error["code"]][0] == response.status_code
    assert not PYTHON.search(error["message"]), error["message"]
    return error


# ------------------------------------------------------------------------------------------------------------------
# Answers written within their bound


def test_the_bounded_writer_writes_json_exactly(cut_idtrack: API) -> None:
    """The writer's bytes are ``json.dumps``'s exactly, on real answers and on values of every JSON kind."""

    def exact(data: Any) -> bytes:
        return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()

    identifiers = sample_identifiers(cut_idtrack, 40)
    answers = [r.to_dict() for r in cut_idtrack.convert_many(identifiers, explain=True)]
    rng = random.Random(3)
    odd: list[Any] = [{}, [], "", 0, -0.0, 1e300, 5e-324, 0.1, True, None, 'é\u2028"\\', {"a": [1, [2, {"b": []}]]}]
    for data in [{"count": 3, "results": answers}, *answers, *odd, [rng.random() for _ in range(50)], (1, "x")]:
        assert writing.json_bytes(data, 1 << 30) == exact(data)
    big = {"count": len(answers), "results": answers}
    size = len(exact(big))
    with pytest.raises(writing.TooLargeError) as stopped:
        writing.json_bytes(big, size // 3)
    # It stops soon after the bound: the part that passed it is one result at most.
    assert size // 3 < stopped.value.written < size // 3 + max(len(exact(a)) for a in answers) + 64


def test_a_large_answer_is_refused_with_advice_for_its_request(make_client: Callable[..., TestClient]) -> None:
    client = make_client(rate_per_minute=0, response_max_bytes=65_536)
    many = [f"ENSSSCG{n:011d}" for n in range(1, 400)] + [GENE] * 3
    with_paths = client.post(BATCH, json={"identifiers": [GENE, "INS", *many], "explain": True})
    error = error_of(with_paths)
    assert error["code"] == "response_too_large"
    assert "ask without `explain` (the paths are most of the answer) or send fewer identifiers" in error["message"]
    assert error["argument"] == "explain"
    without = error_of(client.post(BATCH, json={"identifiers": [GENE, "INS", *many] * 3}))
    if without["code"] == "response_too_large":
        assert without["argument"] == "identifiers"
    alone = client.get(CONVERT, params={"identifier": GENE, "explain": "true"})
    if alone.status_code == 422:  # one answer over the bound: only `explain` narrows it
        assert "fewer identifiers" not in error_of(alone)["message"]


def test_writing_is_part_of_the_charged_search(client: TestClient) -> None:
    response = client.post(BATCH, json={"identifiers": [GENE, "INS"]})
    timing = dict(part.split(";dur=") for part in response.headers["server-timing"].split(", ") if ";dur=" in part)
    assert {"app", "queue", "search", "write"} <= set(timing)


# ------------------------------------------------------------------------------------------------------------------
# Refusals in plain words


def test_refusals_hold_no_programming_spelling(client: TestClient) -> None:
    answers = [
        client.get(CONVERT, params={"identifier": GENE, "final_database": "Foo"}),
        client.get(CONVERT, params={"identifier": GENE, "foo": "1", "bar": "2"}),
        client.get(f"{CONVERT}?identifier={GENE}&identifier=X"),
        client.get(f"{P}/organisms/cow"),
        client.post(BATCH, json={"identifiers": ["TP53", "A\u0001B", "C\u0002D"]}),
        client.post(BATCH, content=b"null", headers={"content-type": "application/json"}),
        client.post(
            BATCH,
            content=b'{"identifiers": ["X"], "to_release": ' + b"9" * 5000 + b"}",
            headers={"content-type": "application/json"},
        ),
        client.post(
            BATCH, content=b'{"identifiers": ["X"], "x": 1, "x": 2}', headers={"content-type": "application/json"}
        ),
    ]
    for response in answers:
        error = error_of(response)
        assert error["message"].endswith(".") and not error["message"].endswith(".."), error["message"]
    unknown = answers[0].json()["error"]
    assert unknown["code"] == "unknown_database" and "`allowed`" in unknown["message"] and unknown["allowed"]
    assert answers[1].json()["error"]["argument"] == "bar"  # the first unknown parameter, by name
    assert "a JSON object, not `null`" in answers[5].json()["error"]["message"]
    assert "more than 4300 digits" in answers[6].json()["error"]["message"]


def test_a_body_may_begin_with_a_byte_order_mark(client: TestClient) -> None:
    body = "﻿" + json.dumps({"identifiers": [GENE]})
    response = client.post(BATCH, content=body.encode(), headers={"content-type": "application/json"})
    assert response.status_code == 200, response.text


def test_a_query_that_is_not_utf8_is_refused_as_a_body_is(client: TestClient) -> None:
    for raw in ("%FF%FE", "%ED%A0%80"):
        error = error_of(client.get(f"{CONVERT}?identifier={raw}"))
        assert (error["code"], error["argument"]) == ("invalid_identifier", "identifier")
    assert error_of(client.get(f"{CONVERT}?identifier={GENE}&to_release=%FF"))["code"] == "invalid_request"


def test_white_space_at_the_ends_is_no_part_of_an_identifier(client: TestClient, cut_idtrack: API) -> None:
    """A tab or line break at an end is read as idtrack reads it (stripped); inside an identifier it is refused."""
    items = [f"{GENE}\t", f"\t{GENE}\r\n", f" {GENE} "]
    answer = client.post(BATCH, json={"identifiers": items}).json()
    assert [r["query_id"] for r in answer["results"]] == items
    assert without_cautions(answer["results"]) == [cut_idtrack.convert(i).to_dict() for i in items]
    table = client.post(f"{BATCH}?format=tsv", json={"identifiers": items}).text
    rows = [line.split("\t") for line in table.splitlines()]
    assert all(len(row) == len(tsv.COLUMNS) for row in rows)
    assert rows[1][tsv.COLUMNS.index("query_id")] == f"{GENE}\\t"
    single = client.get(CONVERT, params={"identifier": f"{GENE}\t"})
    assert single.status_code == 200 and single.json()["query_id"] == f"{GENE}\t"
    inside = error_of(client.post(BATCH, json={"identifiers": ["TP\t53"]}))
    assert inside["code"] == "invalid_identifier" and "inside it, at character 2" in inside["message"]


# ------------------------------------------------------------------------------------------------------------------
# Near misses led to the right request


def test_a_trailing_slash_is_redirected(client: TestClient) -> None:
    response = client.get(f"{P}/organisms/pig/convert/?identifier={GENE}", follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == f"{P}/organisms/pig/convert?identifier={GENE}"
    assert client.get(f"{P}/").status_code == 200  # followed
    assert client.post(f"{BATCH}/", json={"identifiers": [GENE]}).status_code == 200  # 308 keeps method and body


def test_a_trailing_slash_keeps_the_paths_encoding(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    """The redirect's address is the path as sent, its percent-encoding kept: a line break, a NUL or an encoded `?`
    stays encoded (never a header that cannot be written, never a query made from a path); nothing raises."""
    with caplog.at_level(logging.WARNING, logger="idtrack_web_api"):
        for sent, location in (
            ("/api/x%0a/", "/api/x%0a"),
            (f"{P}/a%00b/", f"{P}/a%00b"),
            (f"{P}/x%0d%0aX-Evil:%201/", f"{P}/x%0d%0aX-Evil:%201"),
            (f"{P}/organisms%3Fa=b/", f"{P}/organisms%3Fa=b"),
        ):
            response = client.get(sent, follow_redirects=False)
            assert response.status_code == 308, sent
            assert response.headers["location"] == location
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING], caplog.text


def test_no_validation_message_speaks_the_validators_words(client: TestClient) -> None:
    """Every refusal of a request's shape is in the api's own words: no validator's prefix or type names."""
    answers = [
        client.get(CONVERT, params={"identifier": GENE, "to_release": "115.0"}),
        client.get(CONVERT, params={"identifier": GENE, "explain": "yes"}),
        client.post(BATCH, json={"identifiers": []}),
        client.post(BATCH, json={"identifiers": [GENE], "to_release": "115"}),
        client.post(BATCH, json={"identifiers": [GENE], "explain": "yes"}),
        client.post(f"{BATCH}?format=csv", json={"identifiers": [GENE]}),
        client.post(f"{P}/organisms/pig/source-inference", json={"identifiers": [GENE], "mode": "genes"}),
        client.post(BATCH, json={"identifiers": [GENE, 7]}),
    ]
    for response in answers:
        message = error_of(response)["message"]
        for words in ("Value error", "after validation", "Input should", "valid integer", "Field required"):
            assert words not in message, message
    assert "`to_release` in the body must be a whole number" in error_of(answers[3])["message"]
    assert "`identifiers` in the body must hold at least 1 item, not 0" in error_of(answers[2])["message"]
    assert '`format` in the query must be `json` or `tsv`, not "csv"' in error_of(answers[5])["message"]
    assert (
        "item 1 (from 0) of `identifiers` in the body must be a string, not a number" in error_of(answers[7])["message"]
    )


def test_a_compressed_body_is_refused_by_its_encoding(client: TestClient) -> None:
    import gzip
    import json as json_module

    body = gzip.compress(json_module.dumps({"identifiers": [GENE]}).encode())
    response = client.post(
        BATCH, content=body, headers={"content-type": "application/json", "content-encoding": "gzip"}
    )
    error = error_of(response)
    assert response.status_code == 415 and error["code"] == "unsupported_media_type"
    assert "Content-Encoding: gzip" in error["message"] and "uncompressed" in error["message"]


def test_a_saved_table_names_what_made_it(client: TestClient) -> None:
    response = client.post(f"{BATCH}?format=tsv&provenance=true", json={"identifiers": [GENE], "to_release": 100})
    first, header = response.text.splitlines()[:2]
    assert first.startswith("# idtrack-web ") and "organism sus_scrofa" in first and "to_release 100" in first
    assert f"request {response.headers['x-request-id']}" in first
    assert response.headers["idtrack-graph-digest"] in first
    assert header.startswith("input_index\t")
    assert response.headers["content-disposition"].startswith('attachment; filename="idtrack_sus_scrofa_100_')
    assert not client.post(f"{BATCH}?format=tsv", json={"identifiers": [GENE]}).text.startswith("#")
    refused = error_of(client.post(f"{BATCH}?provenance=true", json={"identifiers": [GENE]}))
    assert (refused["code"], refused["argument"]) == ("invalid_argument", "provenance")


def test_no_endpoint_points_to_the_index(client: TestClient) -> None:
    for path in ("/api", "/api/v2", f"{P}/nothing", f"{P}/organisms/pig/convertt"):
        error = error_of(client.get(path))
        assert error["code"] == "not_found" and f"`GET {P}`" in error["message"], path


def test_names_of_an_id_without_version_lists_its_versions(client: TestClient, cut_idtrack: API) -> None:
    base = GENE.split(".", maxsplit=1)[0]
    error = error_of(client.get(f"{P}/organisms/pig/names-of", params={"gene": base}))
    assert (error["code"], error["argument"]) == ("invalid_argument", "gene")
    assert error["allowed"] == list(cut_idtrack.graph.versions_of(base))
    assert error_of(client.get(f"{P}/organisms/pig/names-of", params={"gene": "ENSSSCG99999999999"}))["code"] == (
        "unknown_identifier"
    )


def test_genes_named_at_one_release(client: TestClient, cut_idtrack: API) -> None:
    names = [
        m.name
        for g in sample_identifiers(cut_idtrack, 40)
        if g.startswith("ENSSSCG") and "." in g
        for m in cut_idtrack.names_of(g)
    ]
    name = next(n for n in names if len({r for m in cut_idtrack.genes_named(n) for r in m.releases}) > 1)
    every = cut_idtrack.genes_named(name)
    releases = sorted({r for m in every for r in m.releases})
    for release in (releases[0], releases[-1], 115):
        data = client.get(f"{P}/organisms/pig/genes-named", params={"name": name, "release": release}).json()
        assert data["matches"] == [m.to_dict() for m in every if release in m.releases]
    error = error_of(client.get(f"{P}/organisms/pig/genes-named", params={"name": name, "release": 3}))
    assert (error["code"], error["argument"]) == ("unknown_release", "release") and error["allowed"]


# ------------------------------------------------------------------------------------------------------------------
# The client's standing, and every answer tied to its graph


def test_allowances_are_stated_in_headers_and_refusals(make_client: Callable[..., TestClient]) -> None:
    client = make_client(rate_per_minute=60, rate_burst=2, rate_concurrent_searches=2)
    first = client.get(CONVERT, params={"identifier": GENE})
    assert '"searches";q=2;w=2' in first.headers["ratelimit-policy"]
    assert first.headers["ratelimit"].startswith('"searches";r=1;')
    client.get(CONVERT, params={"identifier": "INS"})
    refused = client.get(CONVERT, params={"identifier": "PDX1"})
    error = error_of(refused)
    assert (error["code"], error["allowance"]) == ("rate_limited", "searches")
    assert error["retry_after"] == int(refused.headers["retry-after"]) >= 1
    off = make_client(rate_per_minute=0).get(CONVERT, params={"identifier": GENE})
    assert "ratelimit-policy" not in off.headers and "ratelimit" not in off.headers


def test_a_client_has_few_searches_in_progress() -> None:
    import os

    from idtrack_web_api.limits import NO_PLACE, RateLimiter

    limiter = RateLimiter(60, 30, concurrent_searches=2)
    first, second = limiter.enter_search("a"), limiter.enter_search("a")
    assert first is not None and second is not None and first != second
    assert limiter.enter_search("a") is None  # a third at once is refused, and nothing is taken
    other = limiter.enter_search("b")
    assert other is not None
    limiter.leave_search(first)
    assert limiter.in_progress("a") == 1
    again = limiter.enter_search("a")
    assert again is not None
    # A place given back twice frees nothing the second time, though its row now holds another search.
    limiter.leave_search(first)
    assert limiter.in_progress("a") == 2
    # A worker that ends without giving its places back (killed in a search): the master gives them back, and its
    # clients may search at once (no count is left to expire).
    assert limiter.release_holder(os.getpid()) == 3
    assert limiter.in_progress("a") == limiter.in_progress("b") == 0
    assert limiter.enter_search("a") is not None
    assert RateLimiter(0, 30, concurrent_searches=2).enter_search("a") == NO_PLACE  # allowances off


def test_a_place_follows_its_search_to_the_worker_that_takes_it() -> None:
    import os

    from idtrack_web_api.limits import RateLimiter

    limiter = RateLimiter(60, 30, concurrent_searches=2)
    place = limiter.enter_search("a")
    assert place is not None
    child = os.fork()
    if child == 0:  # the worker that takes the search from the queue holds its place, then is killed
        limiter.hold(place)
        os._exit(0)
    os.waitpid(child, 0)
    assert limiter.release_holder(os.getpid()) == 0  # the place is no longer this process's
    assert limiter.release_holder(child) == 1
    assert limiter.in_progress("a") == 0


def test_a_clients_request_id_is_kept(client: TestClient) -> None:
    mine = client.get(CONVERT, params={"identifier": GENE}, headers={"X-Request-ID": "run-7.item:3"})
    assert mine.headers["x-request-id"] == "run-7.item:3"
    odd = client.get(f"{CONVERT}?to_release=1", headers={"X-Request-ID": "has space"})
    assert re.fullmatch(r"[0-9a-f]{32}", odd.headers["x-request-id"])
    assert odd.json()["error"]["request_id"] == odd.headers["x-request-id"]


def test_answers_of_a_graph_name_it(client: TestClient, cut_registry: Any) -> None:
    digest = cut_registry.graphs["sus_scrofa"].description["content_digest"]
    version = client.get(f"{P}/version").json()
    for response in (
        client.get(CONVERT, params={"identifier": GENE}),
        client.post(BATCH, json={"identifiers": [GENE]}),
        client.post(f"{BATCH}?format=tsv", json={"identifiers": [GENE]}),
        client.get(f"{P}/organisms/pig/databases"),
    ):
        assert response.headers["idtrack-graph-digest"] == digest
        assert response.headers["idtrack-version"] == version["idtrack_version"]
    exposed = client.get(CONVERT, params={"identifier": GENE}).headers["access-control-expose-headers"]
    assert "Idtrack-Graph-Digest" in exposed and "RateLimit" in exposed
    assert client.get(CONVERT, params={"identifier": GENE}).headers["timing-allow-origin"] == "*"


def test_a_version_field_holds_a_version() -> None:
    from idtrack_web_api.app import _package_version

    assert _package_version("0.1.2") == {"package_version": "0.1.2", "package_version_note": None}
    text = "none: built from a source folder, not an installed idtrack"
    assert _package_version(text) == {"package_version": None, "package_version_note": text}


# ------------------------------------------------------------------------------------------------------------------
# Tables a client reads


def test_every_database_says_what_it_holds(client: TestClient, cut_idtrack: API) -> None:
    rows = {r["name"]: r for r in client.get(f"{P}/organisms/pig/databases").json()["databases"]}
    graph = cut_idtrack.graph
    assert rows["ensembl_gene"]["kind"] == "ensembl" and rows["ensembl_gene"]["versioned"] is True
    assert rows["base_ensembl_gene"]["versioned"] is False
    for name, row in rows.items():
        if row["kind"] == "ensembl":
            continue
        assert row["kind"] == ("label" if name in graph.label_databases else "accession")
        assert row["authority"] == (name in graph.authority_databases)
        if row["labels"] is not None:
            assert graph.label_names[name] == row["labels"]
        assert all(graph.label_names[a] == name for a in row["labels_of"])


def test_the_table_has_its_documented_columns(client: TestClient, openapi: dict[str, Any]) -> None:
    response = client.post(f"{BATCH}?format=tsv", json={"identifiers": [GENE, "NOT_A_GENE", "NA"]})
    header = response.text.splitlines()[0].split("\t")
    content = openapi["paths"][BATCH.replace("pig", "{organism}")]["post"]["responses"]["200"]["content"]
    documented = content["text/tab-separated-values"]
    assert header == list(tsv.COLUMNS) == [c["name"] for c in documented["x-columns"]]
    assert all(f"`{c}`" in documented["schema"]["description"] for c in tsv.COLUMNS)
    last = response.text.splitlines()[-1].split("\t")
    assert last[tsv.COLUMNS.index("error_code")] == "missing_value"
    assert response.headers["content-disposition"].startswith('attachment; filename="idtrack_sus_scrofa_115_')


# ------------------------------------------------------------------------------------------------------------------
# A list's source, and every database


def test_source_inference_is_idtracks(client: TestClient, cut_idtrack: API, check_response: Callable[..., Any]) -> None:
    identifiers = sample_identifiers(cut_idtrack, 30)
    path = f"{P}/organisms/{{organism}}/source-inference"
    for mode in ("assembly_release", "release", "assembly", "complete"):
        data = check_response(
            client.post(f"{P}/organisms/pig/source-inference", json={"identifiers": identifiers, "mode": mode}),
            path,
            "post",
        )
        assert data["inference"] == json.loads(json.dumps(cut_idtrack.source_inference(identifiers, mode).to_dict()))
    none = client.post(f"{P}/organisms/pig/source-inference", json={"identifiers": ["NOT_A_GENE"]})
    assert error_of(none)["code"] == "unknown_identifier"


def test_each_database_is_convert_with_it(
    client: TestClient, cut_idtrack: API, check_response: Callable[..., Any]
) -> None:
    data = check_response(
        client.get(f"{P}/organisms/pig/convert/each-database", params={"identifier": "INS", "to_release": 100}),
        f"{P}/organisms/{{organism}}/convert/each-database",
    )
    assert [c["database"] for c in data["conversions"]] == cut_idtrack.final_databases(100)
    for conversion in data["conversions"]:
        alone = cut_idtrack.convert("INS", to_release=100, final_database=conversion["database"]).to_dict()
        assert without_cautions(conversion["result"]) == json.loads(json.dumps(alone))


def test_the_listed_codes_of_each_endpoint_are_met(make_client: Callable[..., TestClient]) -> None:
    """Every new or narrowed code is reached at its endpoint (the conftest's check keeps every other one listed)."""
    client = make_client(rate_per_minute=0)
    assert error_of(client.post(f"{P}/organisms/pig/source-inference", json={"identifiers": []}))["code"] == (
        "invalid_request"
    )
    for endpoint in ("convert_each_database", "source_inference"):
        assert endpoint in ENDPOINT_ERRORS
    # `missing_value` and `search_budget_exceeded` are a batch item's, never the batch's refusal.
    assert "missing_value" not in ENDPOINT_ERRORS["convert_batch"]
    item = client.post(BATCH, json={"identifiers": ["NA"]}).json()["results"][0]
    assert item["error"]["code"] == "missing_value"


# ------------------------------------------------------------------------------------------------------------------
# Texts for programs


def test_texts_for_programs_are_compressed_and_revalidated(client: TestClient) -> None:
    for path in ("/llms.txt", "/llms-full.txt"):
        plain = client.get(path, headers={"Accept-Encoding": "identity"})
        packed = client.get(path, headers={"Accept-Encoding": "gzip"})
        assert packed.headers["content-encoding"] == "gzip" and packed.headers["cache-control"] == "no-cache"
        assert packed.text == plain.text  # the client decodes it
        again = client.get(path, headers={"If-None-Match": plain.headers["etag"]})
        assert again.status_code == 304
    text = client.get("/llms-full.txt").text
    assert "final_database=HGNC%20Symbol" in text and "final_database=HGNC Symbol" not in text
    assert 'BASE = "http://testserver/api/v1"' in text
    assert "latest release at which it exists" in text  # the rule of the starting release
    short = client.get("/llms.txt").text
    assert "identifier=TP53&final_database=HGNC%20Symbol" in short
    odd = client.get("/llms.txt", headers={"Host": "evil.example/x"}).text
    assert "evil.example" not in odd


# ------------------------------------------------------------------------------------------------------------------
# The page's files


def test_the_page_sends_only_its_own_files(tmp_path: Path) -> None:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<html><script>var a = 1;</script></html>")
    (root / ".env").write_text("SECRET=1")
    (root / "assets" / "app.js.map").write_text("{}" * 400)
    (tmp_path / "outside.txt").write_text("OUTSIDE")
    (root / "assets" / "link.txt").symlink_to(tmp_path / "outside.txt")
    files = Frontend(root)
    assert files.file(".env") is None and files.file("assets/../.env") is None
    assert files.file("assets/link.txt") is None
    # What the server holds in memory: nothing from outside the build.
    assert all(b"OUTSIDE" not in data for data in files._kept.values())  # noqa: SLF001 - the test reads the cache
    assert files.file(".well-known") is None  # a folder, not a file
    before = files.policy()
    (root / "index.html").write_text("<html><script>var a = 2;</script></html>")
    after = files.policy()
    assert before != after and b"'sha256-" in after


def test_a_source_map_is_json(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<html><script>1</script></html>")
    (root / "assets" / "a.js.map").write_text('{"version":3}')
    client = make_client(rate_per_minute=0, static_dir=root)
    response = client.get("/assets/a.js.map", headers={"Accept-Encoding": "identity"})
    assert response.headers["content-type"].startswith("application/json")
    page = client.get("/")
    assert "require-trusted-types-for 'script'" in page.headers["content-security-policy"]


def test_a_search_that_waited_out_its_budget_is_not_run(make_client: Callable[..., TestClient]) -> None:
    """Every searching endpoint refuses, unsearched, a request that waited longer for a worker than a search may."""
    client = make_client(rate_per_minute=0, queue_seconds=1e-9)
    for response in (
        client.get(f"{P}/organisms/pig/genes-named", params={"name": "INS"}),
        client.get(f"{P}/organisms/pig/names-of", params={"gene": GENE}),
        client.post(f"{P}/organisms/pig/source-inference", json={"identifiers": [GENE]}),
        client.get(CONVERT, params={"identifier": GENE}),
    ):
        error = error_of(response)
        assert error["code"] == "server_busy" and error["retry_after"] == 5


def test_the_page_of_an_organism_not_held_is_404(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html><script>1</script></html>")
    client = make_client(rate_per_minute=0, static_dir=tmp_path)
    for path in ("/organisms/sus_scrofa", "/organisms/pig", "/organisms/Sus%20scrofa", "/organisms/pig/"):
        assert client.get(path).status_code == 200, path
    for path in ("/organisms/cow", "/organisms/%3Cb%3E"):
        response = client.get(path)
        assert response.status_code == 404 and response.text.startswith("<html>"), path  # the page, which says so


def test_the_fan_of_ensembls_mapping_is_counted_from_the_edges(client: TestClient, cut_idtrack: API) -> None:
    """`one_to_many` and `many_to_one` of a transition: the gene versions with two or more distinct later (earlier)
    ends among the history edges across it, the retirement marker left out, recounted here edge by edge."""
    graph = cut_idtrack.graph
    later: dict[tuple[int, int], dict[str, set[str]]] = {}
    earlier: dict[tuple[int, int], dict[str, set[str]]] = {}
    for node in graph.nodes:
        if not graph.is_backbone(node) or graph.version(node) in {"Void", "Retired"}:
            continue
        for edge in graph.history_edges(node):
            if graph.version(edge.node) == "Retired" or edge.new_release == float("inf"):
                continue
            pair = (int(edge.old_release), int(edge.new_release))
            later.setdefault(pair, {}).setdefault(node, set()).add(edge.node)
            earlier.setdefault(pair, {}).setdefault(edge.node, set()).add(node)
    data = client.get(f"{P}/organisms/pig/history").json()
    fanned = 0
    for transition in data["transitions"]:
        pair = (transition["from_release"], transition["to_release"])
        assert transition["one_to_many"] == sum(1 for e in later.get(pair, {}).values() if len(e) > 1)
        assert transition["many_to_one"] == sum(1 for e in earlier.get(pair, {}).values() if len(e) > 1)
        fanned += transition["one_to_many"] + transition["many_to_one"]
    assert fanned > 0, "the cut graph holds a fan of Ensembl's mapping"
