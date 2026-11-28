"""The http layer's rules: every request's cost bounded before work, malformed input a 4xx, methods and paths answered
as RFC 9110 asks, CORS, the security headers, conditional and repeated requests, the clients' keys, one log line per
request, and the documents for programs (the index, ``/llms.txt``, ``/llms-full.txt``, README's tables)."""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import anyio
import pytest

from idtrack_web_api import docs
from idtrack_web_api.errors import CODES
from idtrack_web_api.guard import API_POLICY, URI_MAX_BYTES, Guard
from idtrack_web_api.limits import NETWORK_SHARE, UNREADABLE_CLIENT, RateLimiter, client_key, network_key
from idtrack_web_api.monitor import LoadMonitor
from idtrack_web_api.openapi import openapi_document

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastapi.testclient import TestClient

P = "/api/v1"
CONVERT = f"{P}/organisms/pig/convert"
BATCH = f"{P}/organisms/pig/convert/batch"
GENE = "ENSSSCG00000040076.1"


def app_ms(response: Any) -> float:
    found = re.search(r"app;dur=([0-9.]+)", response.headers["server-timing"])
    assert found is not None
    return float(found.group(1))


def code_of(response: Any) -> str:
    error = response.json()["error"]
    assert CODES[error["code"]][0] == response.status_code
    return str(error["code"])


# ------------------------------------------------------------------------------------------------------------------
# Cost bounded before work


def test_repeated_parameters_cost_linear_time(client: TestClient) -> None:
    """A query of thousands of repeated parameters is refused in milliseconds (it was quadratic)."""
    query = "&".join(["name"] * 3000)
    response = client.get(f"{P}/organisms/pig/genes-named?{query}")
    assert code_of(response) == "unknown_parameter"
    assert app_ms(response) < 100
    assert len(response.content) < 2000
    response = client.get(f"{P}/organisms/pig/genes-named?" + "&".join(f"k{i}" for i in range(2000)))
    assert code_of(response) == "unknown_parameter"
    assert "and 1980 more" in response.json()["error"]["message"]
    assert len(response.content) < 4000


def test_an_overlong_address_is_414(client: TestClient) -> None:
    response = client.get(f"{CONVERT}?identifier={'A' * (URI_MAX_BYTES + 10)}")
    assert response.status_code == 414
    assert code_of(response) == "uri_too_long"


@pytest.mark.parametrize(
    ("body", "content_type", "status", "words"),
    [
        ('{"identifiers":["CAFÉ"]}'.encode("latin-1"), "application/json; charset=latin-1", 415, "UTF-8"),
        ('{"identifiers":["CAF\xc9"]}'.encode("latin-1"), "application/json", 400, "not UTF-8"),
        (b"[" * 50_000, "application/json", 400, "nested"),
        (b'{"identifiers":["A"],"from_release":' + b"9" * 100_000 + b"}", "application/json", 400, "body"),
        (b'{"identifiers":["A"],"identifiers":["B"]}', "application/json", 400, "more than once"),
        (b'{"identifiers":["A"],"to_release":NaN}', "application/json", 400, "NaN"),
        (b'["A"]', "application/json", 400, "object"),
        (b'{"identifiers": ["A"]', "application/json", 400, "not JSON"),
    ],
)
def test_malformed_bodies_are_4xx(
    client: TestClient, body: bytes, content_type: str, status: int, words: str, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="idtrack_web_api"):
        response = client.post(BATCH, content=body, headers={"content-type": content_type})
    assert response.status_code == status, response.text
    assert words in response.json()["error"]["message"]
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_many_unknown_body_keys_are_refused_cheaply(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # The work is counted, not timed (a time depends on what else the machine runs): every key of the body is read once
    # by the parser's hook, the refusal is made once, and it lists 20 keys and counts the rest.
    from idtrack_web_api import app as app_module

    read: list[int] = []
    made: list[int] = []
    hook, refusal = app_module._no_duplicates, app_module.invalid_request_error  # noqa: SLF001 - its hook, counted

    def counted_hook(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        read.append(len(pairs))
        return hook(pairs)

    def counted_refusal(problems: list[dict[str, Any]], *rest: Any) -> Any:
        made.append(len(problems))
        return refusal(problems, *rest)

    monkeypatch.setattr(app_module, "_no_duplicates", counted_hook)
    monkeypatch.setattr(app_module, "invalid_request_error", counted_refusal)
    for keys in (20_000, 60_000):
        read.clear()
        made.clear()
        body = {"identifiers": ["A"], **{f"k{i}": 1 for i in range(keys)}}
        response = client.post(BATCH, json=body)
        assert code_of(response) == "invalid_request"
        error = response.json()["error"]
        assert len(error["details"]) == 20
        assert f"and {keys - 20} more" in error["message"]
        assert len(response.content) < 6000
        assert read == [keys + 1]  # one object, each of its keys once
        assert made == [keys]  # one refusal, of every unknown key


def test_one_release_rule_in_query_and_body(client: TestClient) -> None:
    for value in (0, 999):
        query = client.get(CONVERT, params={"identifier": GENE, "to_release": str(value)})
        body = client.post(BATCH, json={"identifiers": [GENE], "to_release": value})
        assert code_of(query) == code_of(body) == "unknown_release"
        assert query.json()["error"]["allowed"] == body.json()["error"]["allowed"]
    for query_value, body_value in (("1000000000", 1_000_000_000), ("-1", -1)):
        query = client.get(CONVERT, params={"identifier": GENE, "to_release": query_value})
        body = client.post(BATCH, json={"identifiers": [GENE], "to_release": body_value})
        assert code_of(query) == code_of(body) == "invalid_request"
        assert query.json()["error"]["argument"] == body.json()["error"]["argument"] == "to_release"


def test_a_bad_file_path_is_404(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html></html>")
    client = make_client(rate_per_minute=0, static_dir=tmp_path)
    for path in ("/assets/%00", "/index.html%00.js"):
        assert client.get(path).status_code == 404


# ------------------------------------------------------------------------------------------------------------------
# Methods and paths


def test_methods_are_answered_with_allow(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html></html>")
    client = make_client(rate_per_minute=0, static_dir=tmp_path)
    for method, path, allowed in (
        ("DELETE", f"{P}/health", ["GET", "HEAD"]),
        ("GET", BATCH, ["POST"]),
        ("POST", CONVERT, ["GET", "HEAD"]),
    ):
        response = client.request(method, path)
        assert response.status_code == 405, (method, path)
        assert code_of(response) == "method_not_allowed"
        assert response.json()["error"]["allowed"] == allowed
        assert response.headers["allow"] == ", ".join(allowed)
    for path in ("/api/health", "/api/v2/health", f"{P}/nothing", "/api"):
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.headers["content-type"] == "application/json"
    assert client.post(f"{P}/nothing", json={}).status_code == 404


def test_head_is_get_without_a_body(client: TestClient) -> None:
    got = client.get(f"{P}/vocabulary", headers={"accept-encoding": "identity"})
    head = client.head(f"{P}/vocabulary", headers={"accept-encoding": "identity"})
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["content-length"] == str(len(got.content))
    assert head.headers["etag"] == got.headers["etag"]
    assert client.head(f"{P}/health").status_code == 200


def test_cors_lets_any_page_call_the_keyless_api(client: TestClient) -> None:
    response = client.get(f"{P}/health", headers={"origin": "https://notebook.example"})
    assert response.headers["access-control-allow-origin"] == "*"
    assert "Retry-After" in response.headers["access-control-expose-headers"]
    preflight = client.options(
        BATCH,
        headers={
            "origin": "https://notebook.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
        },
    )
    assert preflight.status_code == 204
    assert preflight.headers["access-control-allow-origin"] == "*"
    assert "POST" in preflight.headers["access-control-allow-methods"]
    assert "Content-Type" in preflight.headers["access-control-allow-headers"]
    assert "access-control-allow-credentials" not in preflight.headers
    refused = client.get(f"{P}/organisms/cow", headers={"origin": "https://notebook.example"})
    assert refused.status_code == 404 and refused.headers["access-control-allow-origin"] == "*"


def test_cors_can_be_narrowed(make_client: Callable[..., TestClient]) -> None:
    client = make_client(rate_per_minute=0, cors_origins=("https://a.example",))
    good = client.get(f"{P}/health", headers={"origin": "https://a.example"})
    other = client.get(f"{P}/health", headers={"origin": "https://b.example"})
    assert good.headers["access-control-allow-origin"] == "https://a.example"
    assert "access-control-allow-origin" not in other.headers
    assert "Origin" in other.headers["vary"]


def test_security_headers_on_every_answer(client: TestClient) -> None:
    for response in (client.get(f"{P}/health"), client.get(f"{P}/organisms/cow"), client.post(BATCH, json={})):
        assert response.headers["content-security-policy"] == API_POLICY.decode()
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["cross-origin-opener-policy"] == "same-origin"
        assert response.headers["cross-origin-resource-policy"] == "cross-origin"
        assert "geolocation=()" in response.headers["permissions-policy"]
    assert client.get(f"{P}/organisms/cow").headers["cache-control"] == "no-store"


def test_no_interactive_reference_loads_third_party_code(client: TestClient) -> None:
    """The reference for people is the page /developers, the one for programs the document and /llms-full.txt."""
    for path in (f"{P}/docs", f"{P}/redoc", "/docs", "/redoc"):
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 404
        assert "cdn" not in response.text and "fastapi.tiangolo" not in response.text


# ------------------------------------------------------------------------------------------------------------------
# Repeated and conditional requests


def test_answers_are_tagged_kept_and_revalidated(client: TestClient) -> None:
    params = {"identifier": GENE, "to_release": "70"}
    first = client.get(CONVERT, params=params, headers={"accept-encoding": "identity"})
    assert first.status_code == 200
    assert first.headers["cache-control"] == "public, max-age=600"
    tag = first.headers["etag"]
    assert "search;dur=" in first.headers["server-timing"]
    second = client.get(CONVERT, params=params, headers={"accept-encoding": "identity"})
    assert second.content == first.content
    assert second.headers["etag"] == tag
    assert 'cache;desc="hit"' in second.headers["server-timing"]
    assert "search;dur=" not in second.headers["server-timing"]
    for sent in (tag, f"W/{tag}", tag[:-1] + '-gzip"', f'"other", {tag}', "*"):
        response = client.get(CONVERT, params=params, headers={"if-none-match": sent})
        assert response.status_code == 304, sent
        assert response.content == b""
        assert response.headers["etag"] == tag
    assert client.get(CONVERT, params=params, headers={"if-none-match": '"other"'}).status_code == 200
    # The order of the query does not change the answer, nor its tag.
    swapped = client.get(f"{CONVERT}?to_release=70&identifier={GENE}", headers={"accept-encoding": "identity"})
    assert swapped.headers["etag"] == tag
    # The live answers are never tagged.
    assert "etag" not in client.get(f"{P}/status").headers
    assert "etag" not in client.get(f"{P}/health").headers


def test_a_new_start_tags_anew(make_client: Callable[..., TestClient]) -> None:
    tags = {make_client(rate_per_minute=0).get(f"{P}/vocabulary").headers["etag"] for _ in range(2)}
    assert len(tags) == 2


def test_client_keys() -> None:
    assert client_key("203.0.113.9") == "203.0.113.9"
    assert client_key("2001:db8::1") == client_key("2001:db8::2") == client_key("2001:DB8:0:0:ffff::9")
    assert client_key("2001:db8::1") != client_key("2001:db8:0:1::1")
    assert client_key("::ffff:203.0.113.9") == "203.0.113.9"
    assert client_key("[2001:db8::1]") == client_key("2001:db8::1")
    assert client_key("198.51.100.2986") == client_key("not an address") == client_key(None) == UNREADABLE_CLIENT


def test_one_ipv6_host_shares_one_allowance() -> None:
    limiter = RateLimiter(60, 2)
    for address in ("2001:db8::1", "2001:db8::2"):
        limiter.take(client_key(address), now=1.0)
    assert limiter.take(client_key("2001:db8::3"), now=1.0) is not None
    assert limiter.take(client_key("2001:db8:1::1"), now=1.0) is None


def test_the_hosts_of_one_ipv6_network_share_an_allowance_beside_their_own() -> None:
    """Each /64 has its own allowance; the /64s of one /48 share one :py:data:`NETWORK_SHARE` times as large, so that
    one holder of a /48 cannot take a fresh allowance per /64; another /48, and IPv4, are untouched."""
    limiter = RateLimiter(60, 2)
    taken = 0
    for host in range(NETWORK_SHARE * 2 + 1):
        if limiter.take(client_key(f"2001:db8:7:{host:x}::1"), now=1.0) is None:
            taken += 1
    assert taken == NETWORK_SHARE * 2
    refused = limiter.take(client_key("2001:db8:7:ffff::1"), now=1.0)
    assert refused is not None and refused.network == "2001:db8:7::/48"
    assert limiter.take(client_key("2001:db8:8::1"), now=1.0) is None
    assert limiter.take(client_key("203.0.113.9"), now=1.0) is None
    assert network_key(client_key("203.0.113.9")) is None


def test_one_request_one_log_line(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="idtrack_web_api.access"):
        client.get(f"{P}/x%0a2026-11-27T03:09:00%20INFO%20forged%1b%5b31m")
    [record] = [r for r in caplog.records if r.name == "idtrack_web_api.access"]
    line = record.getMessage()
    assert "\n" not in line and "\x1b" not in line
    assert "%0a" in line or "\\n" in line
    # The client's address is the proxy's to keep (for a bounded time), never the api's log line's.
    assert line.startswith("GET /api/v1/x") and "testclient" not in line


def test_a_slow_body_is_408(cut_settings: Any) -> None:
    from dataclasses import replace

    settings = replace(cut_settings, body_seconds=0.2)
    sent: list[dict[str, Any]] = []

    async def app(_scope: Any, _receive: Any, _send: Any) -> None:  # never reached
        raise AssertionError

    guard = Guard(app, settings, RateLimiter(0, 1), LoadMonitor(1))

    async def receive() -> dict[str, Any]:
        await anyio.sleep(1.0)
        return {"type": "http.request", "body": b"{", "more_body": True}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": BATCH, "raw_path": BATCH.encode(), "query_string": b"",
             "headers": [(b"content-type", b"application/json")], "client": ("127.0.0.1", 1)}  # fmt: skip
    start = time.monotonic()
    anyio.run(guard, scope, receive, send)  # type: ignore[arg-type]
    assert time.monotonic() - start < 0.9
    assert sent[0]["status"] == 408
    assert json.loads(sent[1]["body"])["error"]["code"] == "request_timeout"


# ------------------------------------------------------------------------------------------------------------------
# Batches


def test_batch_item_errors_carry_codes_and_copies_are_explicit(client: TestClient) -> None:
    data = client.post(BATCH, json={"identifiers": ["HSPB1", "NA", "HSPB1-1"]}).json()
    assert data["results"][1]["error"]["code"] == "missing_value"
    assert data["results"][2]["match"].startswith("copy:")
    alone = client.post(BATCH, json={"identifiers": ["HSPB1", "NA", "HSPB1-1"], "read_copies": False}).json()
    single = client.get(CONVERT, params={"identifier": "HSPB1-1"}).json()
    assert alone["results"][2] == single
    assert alone["results"][0] == data["results"][0]


def test_whole_batch_refusal_says_so(client: TestClient) -> None:
    response = client.post(BATCH, json={"identifiers": ["TP53", "A\u0001B"]})
    assert code_of(response) == "invalid_identifier"
    message = response.json()["error"]["message"]
    assert message.startswith("1 identifier cannot be passed on, so the request is refused")
    assert ".;" not in message and not message.endswith("..")


# ------------------------------------------------------------------------------------------------------------------
# Documents for programs


def test_the_index_names_every_endpoint(client: TestClient) -> None:
    data = client.get(P).json()
    document = client.get(f"{P}/openapi.json").json()
    operations = {o["operationId"] for ops in document["paths"].values() for o in ops.values()}
    assert {e["operation_id"] for e in data["endpoints"]} == operations
    assert data["openapi"] == f"{P}/openapi.json" and data["llms_full_txt"] == "/llms-full.txt"


def test_llms_txt_follows_the_convention(client: TestClient) -> None:
    text = client.get("/llms.txt").text
    lines = text.splitlines()
    assert lines[0] == "# IDTrack web API"
    assert lines[2].startswith("> ")
    sections = re.split(r"^## ", text, flags=re.MULTILINE)[1:]
    assert [s.splitlines()[0] for s in sections] == ["Docs", "Optional"]
    for section in sections:
        items = [line for line in section.splitlines()[1:] if line.strip()]
        assert items and all(re.match(r"^- \[[^\]]+\]\((https?://[^)]+)\)", line) for line in items), section
    assert "http://testserver/llms-full.txt" in text


def test_llms_full_txt_holds_every_rule(client: TestClient) -> None:
    text = client.get("/llms-full.txt").text
    document = client.get(f"{P}/openapi.json").json()
    for path, operations in document["paths"].items():
        for method in operations:
            # Every path whole, as a request writes it; the index named outside its code.
            assert f"- `{method.upper()} {path}`" + (" (the index)" if path == "/api/v1" else ":") in text, path
            for parameter in operations[method].get("parameters", []):
                assert f"`{parameter['name']}`" in text
    for code, (status, _) in CODES.items():
        assert f"| `{code}` | {status} |" in text
    for words in (
        "no_target",
        "read_copies",
        "HGNC:11998",
        "201746_at",
        "Retry-After",
        "If-None-Match",
        "places_apart",
        "answers_requested_database",
        "sus_scrofa",  # the organisms this server holds
    ):
        assert words in text, words
    # Every limitation linked, each to its section of the document the site cites.
    from idtrack_web_api import limitations

    for anchor, title in limitations.SECTIONS.items():
        assert f"[{title}]({limitations.DOCUMENT}#{anchor})" in text, anchor
    assert "readthedocs.io/en/stable/limitations" not in text


def test_readme_tables_are_current() -> None:
    readme = Path(__file__).resolve().parents[2] / "README.md"
    assert docs.update_readme(readme, openapi_document()) == readme.read_text(encoding="utf-8"), (
        "README.md's tables are not current: run `idtrack-web docs` in api/"
    )


def test_showcase_and_history(client: TestClient) -> None:
    showcase = client.get(f"{P}/organisms/pig/showcase").json()
    assert showcase["organism"] == "sus_scrofa"
    # The cut graph is not the graph the cases were checked on: no case is claimed.
    assert showcase["checked_on"] != showcase["content_digest"]
    assert showcase["cases"] == []
    history = client.get(f"{P}/organisms/pig/history").json()
    releases = [r["release"] for r in history["releases"]]
    assert releases == list(range(56, 116))
    assert all(r["versions_active"] >= r["genes_active"] >= 0 for r in history["releases"])
    assert sum(r["genes_active"] for r in history["releases"]) > 0
    assert all(t["from_release"] < t["to_release"] for t in history["transitions"])
    assert all(
        t["scored"] <= t["version_changes"] + t["id_changes"] + t["same_version"] + t["retired"]
        for t in history["transitions"]
    )


def test_a_search_whose_client_went_away_is_not_run(make_client: Callable[..., TestClient]) -> None:
    """A request that waits for the search thread while its client closes the connection is dropped, unsearched."""
    client = make_client(rate_per_minute=0)
    app = client.app
    fastapi_app = app.app  # type: ignore[attr-defined]  # Guard -> FastAPI
    slot = fastapi_app.state.slot
    sent: list[dict[str, Any]] = []
    states: list[dict[str, Any]] = []

    async def run() -> None:
        async def receive() -> dict[str, Any]:
            return {"type": "http.disconnect"}

        async def send(message: dict[str, Any]) -> None:
            sent.append(message)

        scope: dict[str, Any] = {"type": "http", "method": "GET", "path": CONVERT, "raw_path": CONVERT.encode(),
                 "query_string": f"identifier={GENE}&to_release=71".encode(), "headers": [],
                 "client": ("127.0.0.1", 1), "server": ("testserver", 80), "scheme": "http", "root_path": "",
                 "http_version": "1.1", "state": {}}  # fmt: skip
        states.append(scope["state"])
        slot.reset()
        limiter = slot.limiter
        await limiter.acquire()  # the search thread is busy: the request waits
        async with anyio.create_task_group() as group:
            group.start_soon(app, scope, receive, send)  # type: ignore[arg-type]
            await anyio.sleep(0.3)  # meanwhile its client has gone
            limiter.release()

    anyio.run(run)
    assert sent[0]["status"] == 408
    assert "search" not in states[0].get("timing", {})


def test_a_batch_whose_client_went_away_stops(cut_registry: Any, cut_settings: Any) -> None:
    from idtrack_web_api import service
    from idtrack_web_api.adapter import ConversionArguments
    from idtrack_web_api.errors import ApiError

    graph = cut_registry.graphs["sus_scrofa"]
    arguments = ConversionArguments(
        from_release=None, to_release=None, final_database=None, from_database=None, explain=False, allow_bridges=True
    )
    with pytest.raises(ApiError) as caught:
        service.convert_batch(graph, [GENE], arguments, cut_settings, time.monotonic() + 10, abandoned=lambda: True)
    assert caught.value.code == "request_timeout"


def test_nesting_is_bounded_before_the_body_is_parsed() -> None:
    from idtrack_web_api.app import BODY_DEPTH_MAX, _nesting_exceeds

    deep = "[" * BODY_DEPTH_MAX + "]" * BODY_DEPTH_MAX
    assert not _nesting_exceeds(deep, BODY_DEPTH_MAX)
    assert _nesting_exceeds("[" + deep + "]", BODY_DEPTH_MAX)
    assert _nesting_exceeds("[" * 50_000, BODY_DEPTH_MAX)  # never closed: refused all the same
    # Brackets inside strings are text, not nesting (escaped quotes included).
    assert not _nesting_exceeds(json.dumps({"identifiers": ["[" * 1000, '"]{' * 500]}), BODY_DEPTH_MAX)
