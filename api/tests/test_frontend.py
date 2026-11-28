"""The built frontend as the server sends it: gzip where accepted, caching headers, revalidation, the page's status
and security policy; and the api's answers compressed where accepted, their decoded bytes the endpoint's exactly."""

from __future__ import annotations

import gzip
import json
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from idtrack_web_api.frontend import (
    BUILD_DOCS_URL,
    IMMUTABLE,
    PAGE_ROUTES,
    PRELOAD_ID,
    REVALIDATE,
    accepts_gzip,
    frame_of,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from fastapi.testclient import TestClient

INDEX = (
    "<!doctype html><html><head><script type=module src=/assets/index-3f9a1c.js></script></head><body>"
    + ("<p>idtrack</p>" * 60)
    + "</body></html>"
)
SCRIPT = "export const words = [" + ",".join(f'"word {i}"' for i in range(2000)) + "];\n"
FONT = bytes(range(256)) * 40  # compressed already, as WOFF2 is


#: The block of the answers the server writes into the page, just before ``</head>``.
PRELOAD = re.compile(rf'<script type="application/json" id="{PRELOAD_ID}">(.*?)</script>(?=</head>)', re.DOTALL)


def without_preload(page: str) -> str:
    """Return the page as sent without the block of answers the server wrote into it (which must be there)."""
    found = PRELOAD.search(page)
    assert found is not None, "the page holds no block of answers"
    return page[: found.start()] + page[found.end() :]


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    """A build laid out as Vite lays it out: the page, hashed files under ``assets/``, unhashed files beside."""
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX, encoding="utf-8")
    (root / "assets" / "index-3f9a1c.js").write_text(SCRIPT, encoding="utf-8")
    (root / "assets" / "inter-latin-7c2e.woff2").write_bytes(FONT)
    (root / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    return root


@pytest.fixture
def web(make_client: Callable[..., TestClient], dist: Path) -> TestClient:
    return make_client(rate_per_minute=0, static_dir=dist)


def raw_get(client: TestClient, path: str, encoding: str | None, **headers: str) -> tuple[int, dict[str, str], bytes]:
    """GET with an exact ``Accept-Encoding``; return the status, headers and the body as sent (not decoded)."""
    sent = dict(headers)
    sent["Accept-Encoding"] = encoding if encoding is not None else "identity"
    with client.stream("GET", path, headers=sent) as response:
        body = b"".join(response.iter_raw())
        return response.status_code, dict(response.headers), body


@pytest.mark.usefixtures("dist")
def test_hashed_text_files_go_compressed_and_immutable(web: TestClient) -> None:
    status, headers, body = raw_get(web, "/assets/index-3f9a1c.js", "gzip, deflate, br")
    assert status == 200
    assert headers["content-encoding"] == "gzip"
    assert gzip.decompress(body) == SCRIPT.encode()
    assert len(body) < len(SCRIPT) / 3
    assert headers["cache-control"] == IMMUTABLE
    assert headers["vary"] == "Accept-Encoding"
    assert headers["content-type"].startswith(("text/javascript", "application/javascript"))
    # Without gzip in Accept-Encoding: the same bytes, as they are on disk.
    for encoding in ("identity", "br", "gzip;q=0, *", "deflate"):
        status, headers, body = raw_get(web, "/assets/index-3f9a1c.js", encoding)
        assert status == 200 and "content-encoding" not in headers, encoding
        assert body == SCRIPT.encode()
        assert headers["vary"] == "Accept-Encoding"


def test_compressed_files_and_small_files_go_as_they_are(web: TestClient) -> None:
    status, headers, body = raw_get(web, "/assets/inter-latin-7c2e.woff2", "gzip")
    assert (status, body) == (200, FONT)
    assert "content-encoding" not in headers and "vary" not in headers
    assert headers["cache-control"] == IMMUTABLE
    status, headers, body = raw_get(web, "/favicon.svg", "gzip")  # too small to gain
    assert status == 200 and "content-encoding" not in headers
    assert headers["cache-control"] == REVALIDATE  # not hashed: revalidated


def test_the_page_is_revalidated_at_every_path(web: TestClient) -> None:
    for path in ("/", "/batch", "/organisms/sus_scrofa"):
        status, headers, body = raw_get(web, path, "gzip")
        assert status == 200, path
        assert headers["content-encoding"] == "gzip"
        assert without_preload(gzip.decompress(body).decode()) == INDEX
        assert headers["cache-control"] == REVALIDATE
        assert headers["content-type"].startswith("text/html")


def test_etags_and_not_modified(web: TestClient) -> None:
    _, zipped, _ = raw_get(web, "/", "gzip")
    _, plain, _ = raw_get(web, "/", None)
    assert zipped["etag"] != plain["etag"]  # two representations, two tags
    status, headers, body = raw_get(web, "/", "gzip", **{"If-None-Match": zipped["etag"]})
    assert (status, body) == (304, b"")
    assert headers["etag"] == zipped["etag"] and headers["cache-control"] == REVALIDATE
    assert raw_get(web, "/", None, **{"If-None-Match": zipped["etag"]})[0] == 200  # the other form is not that one


def test_a_file_changed_after_the_start_is_sent_from_disk(web: TestClient, dist: Path) -> None:
    index = dist / "index.html"
    before = raw_get(web, "/", "gzip")[1]["etag"]
    changed = INDEX.replace("idtrack", "idtrack, rebuilt")
    index.write_text(changed, encoding="utf-8")
    os.utime(index, ns=(index.stat().st_atime_ns, index.stat().st_mtime_ns + 1_000_000_000))
    status, headers, body = raw_get(web, "/", "gzip")
    assert status == 200 and without_preload(gzip.decompress(body).decode()) == changed
    assert headers["etag"] != before


def test_outside_the_build_and_missing_files(web: TestClient) -> None:
    assert web.get("/assets/missing-0000.js").status_code == 404
    # A path that leaves the build names no file of it: an address of the page, answered by the page.
    escaped = web.get("/..%2F..%2Fetc%2Fpasswd")
    assert without_preload(escaped.text) == INDEX
    assert escaped.status_code == 404  # the page, but no route of it
    assert web.get("/assets/%00").status_code == 404
    assert web.get("/index.html%00.js").status_code == 404
    assert web.get("/..%2F..%2Fetc%2Fhosts.txt").status_code == 404
    assert web.get("/api/v1/nothing").json()["error"]["code"] == "not_found"


def test_api_answers_go_compressed_where_accepted(web: TestClient) -> None:
    """gzip is lossless: an answer of the api decoded is the same bytes as the answer sent as it is."""
    for path in ("/api/v1/organisms", "/api/v1/vocabulary", "/api/v1/openapi.json"):
        status, headers, body = raw_get(web, path, "gzip")
        plain_status, plain_headers, plain = raw_get(web, path, None)
        assert status == plain_status == 200
        assert headers["content-encoding"] == "gzip", path
        assert "content-encoding" not in plain_headers
        assert gzip.decompress(body) == plain
        assert headers["vary"] == plain_headers["vary"] == "Accept-Encoding"
        assert headers["etag"] == plain_headers["etag"][:-1] + '-gzip"'
    status, headers, body = raw_get(web, "/api/v1/health", "gzip")  # under 1 KiB: as it is
    assert "content-encoding" not in headers and body.startswith(b"{")
    with web.stream(
        "POST",
        "/api/v1/organisms/pig/convert/batch?format=tsv",
        json={"identifiers": ["ENSSSCG00000040076.1", "INS"] * 10},
        headers={"Accept-Encoding": "gzip"},
    ) as response:
        assert response.status_code == 200 and response.headers["content-encoding"] == "gzip"
        assert gzip.decompress(b"".join(response.iter_raw())).startswith(b"input_index\t")


def test_the_page_has_its_security_policy(web: TestClient) -> None:
    page = web.get("/batch")
    assert page.status_code == 200
    policy = page.headers["content-security-policy"]
    assert "script-src 'self'" in policy and "frame-ancestors 'none'" in policy and "'unsafe-inline'" not in policy
    assert page.headers["cross-origin-opener-policy"] == "same-origin"
    assert "camera=()" in page.headers["permissions-policy"]
    assert page.headers["x-content-type-options"] == "nosniff"
    assert web.get("/no/such/page").status_code == 404
    assert web.get("/organisms/pig").status_code == 200
    # A revalidation keeps the page's policy: a browser applies the 304's headers to the copy it keeps.
    again = web.get("/batch", headers={"if-none-match": page.headers["etag"]})
    assert again.status_code == 304
    assert again.headers["content-security-policy"] == policy


def test_inline_scripts_are_hashed_into_the_policy(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    import base64
    import hashlib

    root = tmp_path / "dist"
    root.mkdir()
    script = "\n      var theme = 'light';\n    "
    (root / "index.html").write_text(f"<html><head><script>{script}</script></head><body></body></html>")
    client = make_client(rate_per_minute=0, static_dir=root)
    digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    assert f"'sha256-{digest}'" in client.get("/").headers["content-security-policy"]


@pytest.mark.parametrize(
    ("header", "gzip_taken"),
    [
        ("gzip", True),
        ("gzip, deflate, br, zstd", True),
        ("GZIP;q=0.5", True),
        ("br;q=1.0, gzip;q=0.8", True),
        ("*", True),
        ("gzip;q=0", False),
        ("gzip;q=0, *", False),
        ("*;q=0", False),
        ("identity", False),
        ("br", False),
        ("", False),
        (None, False),
        ("gzip;q=x", False),
    ],
)
def test_accept_encoding(header: str | None, *, gzip_taken: bool) -> None:
    assert accepts_gzip(header) is gzip_taken


def test_a_hashed_file_of_the_build_at_the_start_is_kept(make_client: Callable[..., TestClient], dist: Path) -> None:
    """A new build put in place under a running server: a page opened before still loads its old lazy parts."""
    client = make_client(rate_per_minute=0, static_dir=dist)
    (dist / "assets" / "index-3f9a1c.js").unlink()
    response = client.get("/assets/index-3f9a1c.js")
    assert response.status_code == 200
    assert response.text == SCRIPT
    assert response.headers["cache-control"] == IMMUTABLE


@pytest.mark.parametrize(
    ("path", "status"),
    [("/", 200), ("/batch", 200), ("/batch/", 200), ("/organisms/", 200), ("/organisms/pig", 200),
     ("/organisms/pig/", 200), ("/method", 200), ("/organisms/pig/extra", 404), ("/nothing", 404),
     ("/legal", 200), ("/legal/de", 200), ("/legal/de/", 200), ("/privacy", 200), ("/privacy/de", 200),
     ("/licences", 200), ("/accessibility", 200), ("/accessibility/de", 200), ("/legal/fr", 404),
     ("/licences/de", 404), ("/organisms/homo_sapiens", 404)],
)  # fmt: skip
def test_the_page_routes(web: TestClient, path: str, status: int) -> None:
    assert web.get(path).status_code == status


def test_the_page_holds_the_answers_it_needs_first(web: TestClient) -> None:
    """The page carries the answers every view asks first, each its text exactly as the api sends it."""
    found = PRELOAD.search(web.get("/").text)
    assert found is not None and "<" not in found.group(1)  # nothing in it can end the block
    answers = json.loads(found.group(1))
    assert sorted(answers) == ["/api/v1/limits", "/api/v1/organisms", "/api/v1/version", "/api/v1/vocabulary"]
    for path, text in answers.items():
        assert text == web.get(path, headers={"Accept-Encoding": "identity"}).text, path


FRAMES = {
    name: {
        "html": f"<header>masthead</header><main><h1>{name}</h1></main>",
        "head": f'<link rel="modulepreload" href="/assets/{name}.js">',
    }
    for name in (
        "home", "convert", "answer", "batch", "names", "organisms", "organism", "developers", "method", "none",
        "legal", "legal-de", "privacy", "privacy-de", "licences", "accessibility", "accessibility-de",
    )
}  # fmt: skip


@pytest.mark.parametrize(
    ("path", "frame", "status"),
    [("/", "home", 200), ("/?organism=pig&id=TP53", "home", 200), ("/convert", "convert", 200),
     ("/convert?organism=pig&id=TP53", "answer", 200), ("/batch", "batch", 200),
     ("/batch/", "batch", 200), ("/names", "names", 200), ("/organisms", "organisms", 200),
     ("/organisms/pig", "organism", 200), ("/developers", "developers", 200), ("/method", "method", 200),
     ("/nothing", "none", 404), ("/organisms/pig/extra", "none", 404), ("/legal", "legal", 200),
     ("/legal/de", "legal-de", 200), ("/privacy/", "privacy", 200), ("/privacy/de", "privacy-de", 200),
     ("/licences", "licences", 200), ("/accessibility", "accessibility", 200),
     ("/accessibility/de", "accessibility-de", 200)],
)  # fmt: skip
def test_each_page_is_sent_with_its_frame(
    make_client: Callable[..., TestClient], dist: Path, path: str, frame: str, status: int
) -> None:
    """The build's frame of the address is written into the page's root, and its links into its head (before the
    block of answers), so the page's head is drawn and its code fetched before the entry has run."""
    index = INDEX.replace("<html>", '<html lang="en">').replace("<body>", '<body><div id="root"></div>')
    (dist / "index.html").write_text(index, encoding="utf-8")
    (dist / "frames.json").write_text(json.dumps({"frames": FRAMES}), encoding="utf-8")
    web = make_client(rate_per_minute=0, static_dir=dist)
    response = web.get(path)
    assert response.status_code == status
    page = without_preload(response.text)
    assert f'<div id="root"><header>masthead</header><main><h1>{frame}</h1></main></div>' in page
    assert f'<link rel="modulepreload" href="/assets/{frame}.js"></head>' in page
    # A page in German says so to the browser before any script has run.
    assert page.startswith(f'<!doctype html><html lang="{"de" if frame.endswith("-de") else "en"}">')
    # One frame per page, each its own tag.
    others = {web.get(p).headers["etag"] for p in ("/", "/batch", "/method")}
    assert len(others) == 3


def test_a_build_without_frames_is_sent_without_them(make_client: Callable[..., TestClient], dist: Path) -> None:
    (dist / "index.html").write_text(INDEX.replace("<body>", '<body><div id="root"></div>'), encoding="utf-8")
    web = make_client(rate_per_minute=0, static_dir=dist)
    assert '<div id="root"></div>' in web.get("/batch").text


def test_a_brotli_form_the_build_made_is_sent_where_br_is_taken(
    make_client: Callable[..., TestClient], dist: Path
) -> None:
    """The build's `<file>.br` is sent in the file's place to a client that takes br (before gzip), with its own tag;
    it is never sent by its own name; a client without br gets gzip or the file."""
    packed = b"brotli bytes of the script"
    (dist / "assets" / "index-3f9a1c.js.br").write_bytes(packed)
    web = make_client(rate_per_minute=0, static_dir=dist)
    status, headers, body = raw_get(web, "/assets/index-3f9a1c.js", "gzip, deflate, br")
    assert (status, body, headers["content-encoding"]) == (200, packed, "br")
    assert headers["etag"].endswith('-br"') and headers["vary"] == "Accept-Encoding"
    status, headers, body = raw_get(web, "/assets/index-3f9a1c.js", "gzip")
    assert headers["content-encoding"] == "gzip" and gzip.decompress(body) == SCRIPT.encode()
    status, headers, body = raw_get(web, "/assets/index-3f9a1c.js", "br;q=0, gzip")
    assert headers["content-encoding"] == "gzip"
    assert web.get("/assets/index-3f9a1c.js.br").status_code == 404


PAGE_WITH_HEAD = (
    '<!doctype html><html><head><meta charset="UTF-8" />\n    <meta\n      name="description"\n      content="The '
    'page\'s own."\n    />\n    <title>idtrack</title></head><body><div id="root"></div>'
    + "<p>x</p>" * 80
    + "</body></html>"
)
META = (
    '<title>{title}</title><meta name="description" content="{title}, described.">'
    '<link rel="canonical" href="%ORIGIN%%PATH%"><meta property="og:url" content="%ORIGIN%%PATH%">'
)


@pytest.mark.parametrize(
    ("path", "title", "canonical"),
    [("/legal", "Legal notice", "/legal"), ("/legal/de/", "Impressum", "/legal/de"),
     ("/organisms/pig", "A graph", "/organisms/sus_scrofa"),
     ("/organisms/SUS_SCROFA/", "A graph", "/organisms/sus_scrofa")],
)  # fmt: skip
def test_a_frame_brings_its_title_description_and_canonical_address(
    make_client: Callable[..., TestClient], dist: Path, path: str, title: str, canonical: str
) -> None:
    """A frame's title and description take the page's place; the site's address (``public_url``) and the page's
    canonical path (a graph's by its production name, whatever name the address used) are written into its tags."""
    (dist / "index.html").write_text(PAGE_WITH_HEAD, encoding="utf-8")
    frames = {name: {"html": "<main></main>", "head": "", "meta": META.format(title=title)} for name in FRAMES}
    (dist / "frames.json").write_text(json.dumps({"frames": frames}), encoding="utf-8")
    web = make_client(rate_per_minute=0, static_dir=dist, public_url="https://idtrack.example")
    page = web.get(path).text
    # A graph's page has its own title, from the graph the server holds; any other page its frame's.
    title = "Sus scrofa · IDTrack" if path.lower().startswith("/organisms/") else title
    assert page.count("<title>") == 1 and f"<title>{title}</title>" in page
    assert page.count('name="description"') == 1 and "The page's own." not in page
    assert f'<link rel="canonical" href="https://idtrack.example{canonical}">' in page
    assert f'<meta property="og:url" content="https://idtrack.example{canonical}">' in page


def test_robots_and_the_sitemap(make_client: Callable[..., TestClient], dist: Path) -> None:
    """``/robots.txt`` allows every page and names the sitemap; ``/sitemap.xml`` lists the build's pages and each
    graph's page, by the site's address; both are cached for an hour and revalidated by their tags."""
    pages = ["/", "/batch", "/legal", "/legal/de"]
    (dist / "frames.json").write_text(json.dumps({"frames": {}, "pages": pages}), encoding="utf-8")
    web = make_client(rate_per_minute=0, static_dir=dist, public_url="https://idtrack.example")
    robots = web.get("/robots.txt")
    assert robots.headers["content-type"] == "text/plain; charset=utf-8"
    assert "User-agent: *\nAllow: /\n" in robots.text
    assert robots.text.endswith("Sitemap: https://idtrack.example/sitemap.xml\n")
    sitemap = web.get("/sitemap.xml")
    assert sitemap.headers["content-type"] == "application/xml"
    assert sitemap.headers["cache-control"] == "public, max-age=3600"
    locs = re.findall(r"<loc>(.*?)</loc>", sitemap.text)
    assert locs == [*(f"https://idtrack.example{p}" for p in pages), "https://idtrack.example/organisms/sus_scrofa"]
    assert sitemap.text.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    again = web.get("/sitemap.xml", headers={"If-None-Match": sitemap.headers["etag"]})
    assert again.status_code == 304


def test_the_files_beside_the_page_go_with_their_types(make_client: Callable[..., TestClient], dist: Path) -> None:
    """security.txt (under ``.well-known``, the one hidden folder served), the web manifest and the icons."""
    (dist / ".well-known").mkdir()
    (dist / ".well-known" / "security.txt").write_text("Contact: https://example.org\n", encoding="utf-8")
    (dist / "site.webmanifest").write_text('{"name": "IDTrack"}', encoding="utf-8")
    (dist / "apple-touch-icon.png").write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(64))
    web = make_client(rate_per_minute=0, static_dir=dist)
    assert web.get("/.well-known/security.txt").headers["content-type"] == "text/plain; charset=utf-8"
    assert web.get("/site.webmanifest").headers["content-type"] == "application/manifest+json"
    assert web.get("/apple-touch-icon.png").headers["content-type"] == "image/png"
    assert web.get("/.hidden/security.txt").status_code == 404


def test_the_routes_are_the_pages_routes() -> None:
    """The server's routes of the page are the page's own (``web/src/lib/routes.ts``), each with the frame of its
    page's name: a page added there and not here (or the reverse) fails here."""
    routes = (Path(__file__).parents[2] / "web/src/lib/routes.ts").read_text(encoding="utf-8")
    table = routes[routes.index("const PAGES") : routes.index("};", routes.index("const PAGES"))]
    pages = dict(re.findall(r'"(/[^"]*)": \{ page: "([a-z-]+)"', table))
    assert pages, "the page's table of routes is read"
    for path, name in pages.items():
        assert PAGE_ROUTES.match(path) and PAGE_ROUTES.match(path.rstrip("/") + "/"), path
        assert frame_of(path, has_identifier=False) == name, path
    assert frame_of("/organisms/sus_scrofa", has_identifier=False) == "organism"
    for path in ("/legal/fr", "/licences/de", "/nothing", "/organisms/a/b"):
        assert not PAGE_ROUTES.match(path), path


def test_a_wrong_address_asked_by_a_browser_is_the_page_that_says_so(web: TestClient) -> None:
    """The page's template is no address, and an address that names no file is the 404 page wherever a browser asks
    for HTML, a dot in it or not; a program (no `text/html` in `Accept`) gets the JSON error."""
    browser = {"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
    for path in ("/index.html", "/ENSG00000141510.20", "/privacy.html", "/organisms/homo_sapiens.x", "/wp-login.php"):
        response = web.get(path, headers=browser)
        assert (response.status_code, response.headers["content-type"]) == (404, "text/html; charset=utf-8"), path
    for path in ("/ENSG00000141510.20", "/index.html"):
        response = web.get(path, headers={"Accept": "*/*"})
        assert response.status_code == 404 and response.json()["error"]["code"] == "not_found", path
    assert web.get("/assets/nothing.js", headers=browser).status_code == 404
    assert web.get("/", headers=browser).status_code == 200


def test_the_frame_holds_what_only_the_server_knows(make_client: Callable[..., TestClient], dist: Path) -> None:
    """The documentation's address the server is set to, in place of the build's; a graph's own title and
    description on its page; German on the German pages (not on a 404 page whose address ends so)."""
    (dist / "index.html").write_text(
        '<!doctype html><html lang="en"><head><title>IDTrack</title></head><body><div id="root"></div>'
        + "<p>x</p>" * 80
        + "</body></html>",
        encoding="utf-8",
    )
    meta = (
        '<title>Explore · IDTrack</title><meta name="description" content="One graph.">'
        '<meta property="og:title" content="Explore · IDTrack"><meta property="og:description" content="One graph.">'
    )
    markup = f'<header><a href="{BUILD_DOCS_URL}">Docs</a></header><main></main>'
    frames = {name: {"html": markup, "head": "", "meta": meta} for name in FRAMES}
    (dist / "frames.json").write_text(json.dumps({"frames": frames}), encoding="utf-8")
    web = make_client(rate_per_minute=0, static_dir=dist, docs_url="https://docs.example.org/")
    page = web.get("/legal").text
    assert '<a href="https://docs.example.org/">Docs</a>' in page and BUILD_DOCS_URL not in page
    assert '<html lang="en"' in page
    organism = web.get("/organisms/pig").text
    assert "<title>Sus scrofa · IDTrack</title>" in organism
    assert '<meta property="og:title" content="Sus scrofa · IDTrack">' in organism
    assert "Explore · IDTrack" not in organism and "One graph." not in organism
    assert re.search(
        r'name="description" content="The Sus scrofa graph of IDTrack: Ensembl releases \d+ to 115', organism
    )
    for path in ("/legal/de", "/privacy/de/"):
        assert '<html lang="de"' in web.get(path).text, path
    missing = web.get("/nothing/de")
    assert missing.status_code == 404 and '<html lang="en"' in missing.text
