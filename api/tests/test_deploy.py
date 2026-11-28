"""The deployment's Caddy files: what they keep of a visit and for how long, and what a visitor sees while the api
cannot answer (the site's privacy page states the first; SETUP.md, section 10, both)."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

import pytest

from idtrack_web_api.errors import CODES

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"
CADDYFILES = [
    DEPLOY / "Caddyfile",
    DEPLOY / "vm" / "Caddyfile.behind-proxy",
    DEPLOY / "vm" / "Caddyfile.institute-cert",
]
#: The bound of every log Caddy writes about a request: a file a day, six earlier days kept (a line lives at most seven
#: days).
ROLL = "\t\t\troll_at 00:00\n\t\t\troll_size 100MiB\n\t\t\troll_keep 6\n\t\t\troll_keep_for 144h\n"


def block(text: str, opening: str) -> str:
    """Return the block that begins with the line ``opening`` (tabs included), up to its closing brace."""
    start = text.index(opening)
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    msg = f"{opening!r} is not closed"
    raise AssertionError(msg)


@pytest.mark.parametrize("path", CADDYFILES, ids=lambda p: p.name)
def test_every_log_of_a_request_is_kept_seven_days_at_most(path: Path) -> None:
    """The access log and the errors of requests (each names the client) go to files rolled each midnight, six
    earlier days kept; Caddy's own messages exclude the errors of requests (the container's log is bounded by size
    only)."""
    text = path.read_text(encoding="utf-8")
    access = block(text, "\tlog {\n")
    errors = block(text, "\tlog errors {\n")
    default = block(text, "\tlog default {\n")
    assert "/access.log {\n" + ROLL in access
    assert "/errors.log {\n" + ROLL in errors and "include http.log.error" in errors
    assert "exclude http.log.error" in default and "output file" not in default
    assert text.count("output file") == 2


def test_the_caddy_files_share_their_logs_and_their_maintenance() -> None:
    """The three ways to a certificate differ in their certificate and their proxy, never in what they keep or show."""
    parts = [
        (
            block(t, "\tlog default {\n"),
            block(t, "\tlog errors {\n"),
            block(t, "\tlog {\n"),
            block(t, "\thandle_errors"),
        )
        for t in (p.read_text(encoding="utf-8") for p in CADDYFILES)
    ]
    assert parts[0] == parts[1] == parts[2]


def test_the_maintenance_page_is_allowed_its_style_and_nothing_else() -> None:
    """The page Caddy answers while the api cannot is static: no script, no request of its own; its one style is
    allowed by its hash, which the Caddy files name."""
    page = (DEPLOY / "maintenance.html").read_text(encoding="utf-8")
    assert "<script" not in page.lower() and " src=" not in page and "<link" not in page
    styles = re.findall(r"<style>(.*?)</style>", page, re.DOTALL)
    assert len(styles) == 1
    digest = base64.b64encode(hashlib.sha256(styles[0].encode()).digest()).decode()
    errors = block((DEPLOY / "Caddyfile").read_text(encoding="utf-8"), "\thandle_errors")
    assert f"style-src 'sha256-{digest}';" in errors
    assert "default-src 'none'" in errors and "rewrite * /maintenance.html" in errors and "status 503" in errors
    compose = (DEPLOY / "compose.yaml").read_text(encoding="utf-8")
    assert "./maintenance.html:/etc/caddy/maintenance.html:ro" in compose


def test_a_program_is_answered_in_the_api_s_own_error() -> None:
    """While the api cannot answer, a program asking it gets the api's error shape: ``503 server_busy`` with the wait,
    every field of an error present."""
    errors = block((DEPLOY / "Caddyfile").read_text(encoding="utf-8"), "\thandle_errors")
    found = re.search(r"respond `(.*?)` (\d{3})", errors)
    assert found is not None
    body = json.loads(found.group(1))["error"]
    assert set(body) == {"code", "message", "argument", "allowed", "details", "request_id", "retry_after", "allowance"}
    assert body["code"] == "server_busy" and CODES["server_busy"][0] == int(found.group(2)) == 503
    assert body["retry_after"] == 60 and "Retry-After 60" in errors
