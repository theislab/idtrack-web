"""Concurrent requests: in one process (the event loop and the search thread), and against the real server with
forked workers (gunicorn, the graphs loaded once in the master), with the rate limit shared by the workers."""

from __future__ import annotations

import asyncio
import json
import os
import random
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx2
import pytest
from idtrack.api import API

from idtrack_web_api.app import asgi_app
from idtrack_web_api.config import Settings
from idtrack_web_api.graphs import Registry
from tests.test_endpoints import sample_identifiers

P = "/api/v1"


def test_concurrent_requests_in_one_process(cut_settings: Settings, cut_registry: Registry, cut_idtrack: API) -> None:
    from dataclasses import replace

    # Every request is held (queue_max above 180): they all wait for the one search thread and answer.
    app = asgi_app(replace(cut_settings, rate_per_minute=0, queue_max=200), cut_registry)
    identifiers = sample_identifiers(cut_idtrack, 60)
    expected = {i: cut_idtrack.convert(i, explain=True).to_dict() for i in identifiers}

    async def run() -> list[tuple[str, Any]]:
        transport = httpx2.ASGITransport(app=app)
        async with httpx2.AsyncClient(transport=transport, base_url="http://test") as client:
            order = identifiers * 3
            random.Random(0).shuffle(order)

            async def one(identifier: str) -> tuple[str, Any]:
                response = await client.get(
                    f"{P}/organisms/pig/convert", params={"identifier": identifier, "explain": "true"}
                )
                assert response.status_code == 200, response.text
                return identifier, response.json()

            return await asyncio.gather(*(one(i) for i in order))

    answers = asyncio.run(run())
    assert len(answers) == 180
    for identifier, data in answers:
        assert data == expected[identifier]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def get(url: str, timeout: float = 30) -> tuple[int, dict[str, str], bytes]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - a local test server
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        with error:
            return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()


@contextmanager
def running_server(store: Path, rate_per_minute: int, rate_burst: int) -> Iterator[str]:
    """``idtrack-web serve`` with two workers over a store, as a deployment runs it; yields its base URL."""
    port = free_port()
    environment = {
        **{k: v for k, v in os.environ.items() if not k.startswith("IDTRACK_WEB_")},
        "IDTRACK_WEB_SOURCE": "directory",
        "IDTRACK_WEB_DIRECTORY": str(store),
        "IDTRACK_WEB_HOST": "127.0.0.1",
        "IDTRACK_WEB_PORT": str(port),
        "IDTRACK_WEB_WORKERS": "2",
        "IDTRACK_WEB_RATE_PER_MINUTE": str(rate_per_minute),
        "IDTRACK_WEB_RATE_BURST": str(rate_burst),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    log = open(store.parent / f"server_{port}.log", "w+")  # noqa: SIM115 - closed below
    process = subprocess.Popen(
        [sys.executable, "-m", "idtrack_web_api.cli", "serve"], env=environment, stdout=log, stderr=subprocess.STDOUT
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 120
        while True:
            try:
                if get(f"{base}{P}/health", timeout=2)[0] == 200:
                    break
            except OSError:
                pass
            if process.poll() is not None or time.monotonic() > deadline:
                log.seek(0)
                raise RuntimeError(f"the server did not start:\n{log.read()}")
            time.sleep(0.5)
        yield base
    finally:
        process.terminate()
        process.wait(timeout=60)
        log.seek(0)
        text = log.read()
        log.close()
    assert "Traceback" not in text, text
    assert text.count("Booting worker") == 2, text


@pytest.fixture(scope="module")
def server(cut_store: Path) -> Iterator[str]:
    """The server without a rate limit."""
    with running_server(cut_store, 0, 1) as base:
        yield base


def test_forked_workers_answer_concurrently(server: str, cut_idtrack: API) -> None:
    identifiers = sample_identifiers(cut_idtrack, 80)
    expected = {i: cut_idtrack.convert(i, explain=True).to_dict() for i in identifiers}

    def one(identifier: str) -> tuple[str, int, Any]:
        query = urllib.parse.urlencode({"identifier": identifier, "explain": "true"})
        status, _, body = get(f"{server}{P}/organisms/pig/convert?{query}")
        return identifier, status, json.loads(body)

    order = identifiers * 2
    random.Random(1).shuffle(order)
    with ThreadPoolExecutor(16) as pool:
        answers = list(pool.map(one, order))
    assert all(status == 200 for _, status, _ in answers)
    for identifier, _, data in answers:
        assert data == expected[identifier]
    status, headers, _ = get(f"{server}{P}/version")
    assert status == 200 and headers["x-request-id"]


def test_rate_limit_is_shared_by_the_workers(cut_store: Path) -> None:
    """A burst of 50 at one request per second holds for the server, not per worker (two workers would pass 100)."""
    with running_server(cut_store, 60, 50) as base:

        def one(_: int) -> int:
            return get(f"{base}{P}/organisms")[0]

        start = time.monotonic()
        with ThreadPoolExecutor(32) as pool:
            statuses = list(pool.map(one, range(200)))
        elapsed = time.monotonic() - start
    passed = statuses.count(200)
    assert statuses.count(429) + passed == 200
    # The health checks of the start do not count; 50 at once, then one per second while the requests ran.
    assert 50 <= passed <= 50 + int(elapsed) + 1, (passed, elapsed)
