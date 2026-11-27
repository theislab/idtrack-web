"""Concurrent requests: in one process (the event loop and the search thread), and against the real server with
forked workers (gunicorn, the graphs loaded once in the master), with the rate limit shared by the workers and the
load (``/status``) reported for every worker and the master."""

from __future__ import annotations

import asyncio
import contextlib
import http.client
import json
import os
import random
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx2
import pytest

from idtrack_web_api.app import asgi_app
from tests.conftest import without_cautions
from tests.test_endpoints import sample_identifiers

if TYPE_CHECKING:
    from collections.abc import Iterator

    from idtrack.api import API

    from idtrack_web_api.config import Settings
    from idtrack_web_api.graphs import Registry

P = "/api/v1"
GENE = "ENSSSCG00000040076.1"


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
        assert without_cautions(data) == expected[identifier]


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
    with serving(store, rate_per_minute, rate_burst) as (base, _):
        yield base


# ``idtrack-web serve`` with one change: a search for ``SLOW<seconds>`` first computes for that long (holding the
# interpreter as a search does), so a test can hold a worker's search slot for a known time.
SLOW_SERVE = """
import sys, time
from idtrack_web_api import cli, service
convert_one = service.convert_one
def convert_slowly(graph, identifier, *arguments):
    if identifier.startswith("SLOW"):
        end = time.monotonic() + float(identifier[4:])
        while time.monotonic() < end:
            pass
    return convert_one(graph, identifier, *arguments)
service.convert_one = convert_slowly
sys.exit(cli.main(["serve"]))
"""


@contextmanager
def serving(
    store: Path,
    rate_per_minute: int,
    rate_burst: int,
    boots: int = 2,
    workers: int = 2,
    *,
    slow: bool = False,
    extra: dict[str, str] | None = None,
) -> Iterator[tuple[str, int]]:
    """``idtrack-web serve`` with *workers* workers over a store; yields its base URL and the master's pid (the
    command's own process). *boots*: the workers it starts in all (more than *workers* when a test kills one);
    *slow*: searches for ``SLOW<seconds>`` take that long (:py:data:`SLOW_SERVE`)."""
    port = free_port()
    environment = {
        **{k: v for k, v in os.environ.items() if not k.startswith("IDTRACK_WEB_")},
        "IDTRACK_WEB_SOURCE": "directory",
        "IDTRACK_WEB_DIRECTORY": str(store),
        "IDTRACK_WEB_HOST": "127.0.0.1",
        "IDTRACK_WEB_PORT": str(port),
        "IDTRACK_WEB_WORKERS": str(workers),
        "IDTRACK_WEB_RATE_PER_MINUTE": str(rate_per_minute),
        "IDTRACK_WEB_RATE_BURST": str(rate_burst),
        "PYTHONDONTWRITEBYTECODE": "1",
        **(extra or {}),
    }
    log = (store.parent / f"server_{port}.log").open("w+")
    command = ["-c", SLOW_SERVE] if slow else ["-m", "idtrack_web_api.cli", "serve"]
    process = subprocess.Popen([sys.executable, *command], env=environment, stdout=log, stderr=subprocess.STDOUT)
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
                msg = f"the server did not start:\n{log.read()}"
                raise RuntimeError(msg)
            time.sleep(0.5)
        yield base, process.pid
    finally:
        process.terminate()
        process.wait(timeout=60)
        log.seek(0)
        text = log.read()
        log.close()
    assert "Traceback" not in text, text
    assert text.count("Booting worker") == boots, text


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
        assert without_cautions(data) == expected[identifier]
    status, headers, _ = get(f"{server}{P}/version")
    assert status == 200 and headers["x-request-id"]


def test_rate_limit_is_shared_by_the_workers(cut_store: Path) -> None:
    """A burst of 50 searches at one per second holds for the server, not per worker (two workers would pass 100).

    (Searches in progress at once are not limited here: their allowance has a test of its own.)"""
    with serving(cut_store, 60, 50, extra={"IDTRACK_WEB_RATE_CONCURRENT_SEARCHES": "0"}) as (base, _):

        def one(i: int) -> int:  # distinct searches: none is an answer kept in memory
            return get(f"{base}{P}/organisms/pig/convert?identifier=NOT_A_GENE_{i}")[0]

        start = time.monotonic()
        with ThreadPoolExecutor(32) as pool:
            statuses = list(pool.map(one, range(200)))
        elapsed = time.monotonic() - start
    passed = statuses.count(200)
    assert statuses.count(429) + passed == 200
    # The health checks of the start do not count; 50 at once, then one per second while the requests ran.
    assert 50 <= passed <= 50 + int(elapsed) + 1, (passed, elapsed)


def status_of(base: str) -> dict[str, Any]:
    """Return ``/status`` past the cache of the last answer."""
    time.sleep(1.1)
    status, _, body = get(f"{base}{P}/status")
    assert status == 200, body
    data: dict[str, Any] = json.loads(body)
    return data


def parent_of(pid: int) -> int:
    return int(Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[1])


def children_of(master: int) -> list[int]:
    """The live processes the master forked (its workers), by pid."""
    found = []
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            try:
                stat = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            except OSError:
                continue
            if int(stat[1]) == master and stat[0] not in {"Z", "X"}:
                found.append(int(entry.name))
    return sorted(found)


def test_status_covers_every_worker_and_the_master(cut_store: Path, cut_idtrack: API) -> None:
    """``/status`` from any worker reports both workers and the master, and a killed worker's replacement."""
    identifiers = sample_identifiers(cut_idtrack, 60)
    with serving(cut_store, 0, 1, boots=3) as (base, master):

        def one(identifier: str) -> int:
            query = urllib.parse.urlencode({"identifier": identifier, "explain": "true"})
            return get(f"{base}{P}/organisms/pig/convert?{query}")[0]

        sent = 0
        data: dict[str, Any] = {}
        for _ in range(10):  # until each worker has answered some
            with ThreadPoolExecutor(16) as pool:
                assert set(pool.map(one, identifiers * 2)) == {200}
            sent += 2 * len(identifiers)
            data = status_of(base)
            if (
                len(data["workers"]) == 2
                and all(w["requests"] > 0 for w in data["workers"])
                and not data["unavailable"]
            ):
                break
        assert data["unavailable"] == []
        assert data["requests"]["connections_waiting"] == 0  # read from the listen queue; nothing waits now
        assert (data["workers_configured"], data["workers_alive"]) == (2, 2)
        assert data["master"] is not None and "pid" not in data["master"]
        assert sorted(w["worker"] for w in data["workers"]) == [1, 2]
        pids = children_of(master)
        assert len(pids) == 2
        assert all(w["requests"] > 0 for w in data["workers"]), data["workers"]
        requests = data["requests"]
        assert requests["total"] == sum(w["requests"] for w in data["workers"]) >= sent
        assert requests["latency"]["count"] == min(1000, requests["total"])
        processes = [data["master"], *data["workers"]]
        memory = data["memory"]
        assert memory["pss_bytes"] == sum(p["pss_bytes"] for p in processes)
        assert memory["rss_bytes"] == sum(p["rss_bytes"] for p in processes)
        assert memory["uss_bytes"] <= memory["pss_bytes"] < memory["rss_bytes"]  # the workers share the master's pages
        assert data["cpu"]["cores_used"] == pytest.approx(sum(p["cpu_share"] for p in processes))
        assert all(p["cpu_sample_age_seconds"] < 3 for p in processes)
        assert all(p["memory_sample_age_seconds"] < 3 + data["memory_sample_interval_seconds"] for p in processes)

        # A worker killed: the master starts another; the dead one is not reported, and its counts stay.
        killed = pids[0]
        os.kill(killed, signal.SIGKILL)
        deadline = time.monotonic() + 60
        while True:
            after = status_of(base)
            alive = children_of(master)
            if after["workers_alive"] == 2 and killed not in alive and after["workers_exited"] == 1:
                break
            assert time.monotonic() < deadline, after
        assert pids[1] in alive
        assert after["requests"]["total"] >= requests["total"]
        assert after["last_worker_exit_at"] is not None
        assert after["requests"]["lost"] == 0  # it held no request when it was killed


def timing_of(headers: dict[str, str]) -> dict[str, float]:
    """Return the parts of ``Server-Timing``, in seconds."""
    parts = [part.split(";dur=") for part in headers.get("server-timing", "").split(", ") if ";dur=" in part]
    return {name: float(value) / 1000 for name, value in parts}


def test_waiting_work_goes_to_a_free_worker(cut_store: Path, cut_idtrack: API) -> None:
    """While one worker is in a long search, the other answers every other request: none waits behind the search,
    neither from clients that open a connection per request nor from one that keeps its connection."""
    identifiers = sample_identifiers(cut_idtrack, 20)
    search_seconds = 6.0

    def short(identifier: str) -> tuple[int, float, dict[str, float]]:
        query = urllib.parse.urlencode({"identifier": identifier, "explain": "true"})
        start = time.monotonic()
        status, headers, _ = get(f"{base}{P}/organisms/pig/convert?{query}")
        return status, time.monotonic() - start, timing_of(headers)

    def kept_alive() -> list[tuple[int, float, dict[str, float]]]:
        connection = http.client.HTTPConnection(base.removeprefix("http://"), timeout=30)
        answers = []
        for identifier in identifiers:
            start = time.monotonic()
            connection.request(
                "GET", f"{P}/organisms/pig/convert?" + urllib.parse.urlencode({"identifier": identifier})
            )
            response = connection.getresponse()
            response.read()
            headers = {k.lower(): v for k, v in response.getheaders()}
            answers.append((response.status, time.monotonic() - start, timing_of(headers)))
        connection.close()
        return answers

    with serving(cut_store, 0, 1, slow=True) as (base, _), ThreadPoolExecutor(10) as pool:
        long_search = pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW{search_seconds}", 60)
        time.sleep(0.5)  # the search runs in one worker
        start = time.monotonic()
        kept = pool.submit(kept_alive)
        answers = list(pool.map(short, identifiers * 4))
        during = status_of(base)
        answers += kept.result()
        elapsed = time.monotonic() - start
        overlapped = not long_search.done()
        assert long_search.result()[0] == 200
    assert len(answers) == 100
    assert {status for status, _, _ in answers} == {200}
    # Waiting for a worker's search slot (Server-Timing's queue) only behind another short search, never the long one.
    # (an answer sent again from memory waited for no search: no `queue` part)
    queued = sorted(t.get("queue", 0.0) for _, _, t in answers)
    assert queued[-1] < 1.0, queued[-5:]
    assert max(seconds for _, seconds, _ in answers) < 2.0
    assert overlapped and elapsed < search_seconds - 1.0, "the requests did not overlap the long search"
    # Mid-way, the worker in the long search held that one request only; nothing waited for a search slot.
    workers = during["workers"]
    assert max(w["searches_running"] for w in workers) == 1
    assert all(w["searches_waiting"] == 0 for w in workers), workers
    assert all(w["in_flight"] <= 1 for w in workers), workers


def test_health_is_answered_while_every_worker_searches(cut_store: Path) -> None:
    """With both workers in a long search, a health check waits for no search: a busy worker answers it at once."""
    search_seconds = 6.0
    with serving(cut_store, 0, 1, slow=True) as (base, _), ThreadPoolExecutor(2) as pool:
        searches = []
        for _ in range(2):
            searches.append(pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW{search_seconds}", 60))
            time.sleep(0.5)
        start = time.monotonic()
        status, _, body = get(f"{base}{P}/health", timeout=10)
        waited = time.monotonic() - start
        assert not any(search.done() for search in searches), "the health check did not overlap both searches"
        assert all(search.result()[0] == 200 for search in searches)
    assert status == 200, body
    assert waited < 0.5, waited


def test_idle_and_half_sent_connections_hold_no_worker(cut_store: Path) -> None:
    """Connections that send nothing, or half a head, make no worker busy, and are closed after the head's deadline."""
    with serving(cut_store, 0, 1, extra={"IDTRACK_WEB_HEAD_SECONDS": "1"}) as (base, _):
        host, port = base.removeprefix("http://").split(":")
        idle = []
        try:
            for i in range(4):
                sock = socket.create_connection((host, int(port)))
                if i % 2:
                    sock.sendall(b"GET /api/v1/health HTTP/1.1\r\nHost: x\r\n")
                idle.append(sock)
            time.sleep(0.3)
            for _ in range(4):
                start = time.monotonic()
                assert get(f"{base}{P}/health")[0] == 200
                assert time.monotonic() - start < 0.3
            time.sleep(1.5)
            for sock in idle:
                sock.settimeout(1.0)
                assert sock.recv(1) == b""  # closed by the server
        finally:
            for sock in idle:
                sock.close()


def test_reads_never_wait_behind_queued_searches(cut_store: Path) -> None:
    """With both workers in a long search and more searches queued, `/health` and `/status` are answered at once, and
    `/status` counts the searches waiting for a worker."""
    with serving(cut_store, 0, 1, slow=True) as (base, _), ThreadPoolExecutor(16) as pool:
        long = [pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW6", 60) for _ in range(2)]
        time.sleep(0.5)
        queued = [
            pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW0.5{'0' * i}", 60) for i in range(8)
        ]
        time.sleep(0.5)
        waits = []
        for _ in range(6):
            start = time.monotonic()
            assert get(f"{base}{P}/health", timeout=10)[0] == 200
            waits.append(time.monotonic() - start)
        status = status_of(base)
        assert not any(f.done() for f in long), "the reads did not overlap the long searches"
        assert all(f.result()[0] == 200 for f in [*long, *queued])
    assert max(waits) < 0.5, waits
    assert status["requests"]["searches_queued"] >= 6, status["requests"]
    # The three counts of waiting requests are disjoint: the queued searches are not counted again as connections in
    # the kernel's queue, nor as searches waiting for a worker's own thread.
    assert status["requests"]["connections_waiting"] == 0, status["requests"]
    assert status["requests"]["searches_waiting"] == 0, status["requests"]
    # The server's own samples of the recent past: taken while nobody asked (a value its processes had not measured
    # yet is null, never made up).
    samples = status["history"]["samples"]
    assert samples, status["history"]
    assert all(s["pss_bytes"] is None or s["pss_bytes"] > 0 for s in samples), samples


def test_a_search_waits_only_for_the_first_free_worker(cut_store: Path) -> None:
    """A short search sent while one worker is in a long search and the other in a shorter one is answered when the
    shorter ends, never behind the long one (whichever worker took its connection)."""
    with serving(cut_store, 0, 1, slow=True) as (base, _), ThreadPoolExecutor(4) as pool:
        for trial in range(3):
            long = pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW5.{'0' * trial}", 60)
            time.sleep(0.2)
            medium = pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW1.5{'0' * trial}", 60)
            time.sleep(0.2)
            start = time.monotonic()
            status, headers, _ = get(f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release={100 + trial}")
            took = time.monotonic() - start
            assert status == 200
            assert took < 2.5, (took, headers.get("server-timing"))
            assert (medium.result()[0], long.result()[0]) == (200, 200), (medium.result()[2], long.result()[2])


def test_an_answer_not_taken_is_dropped(cut_store: Path, cut_idtrack: API) -> None:
    """Clients that never read a large answer hold it only until the send's deadline: then their connections are
    closed and the worker holds nothing (``sending_bytes``)."""
    identifiers = sample_identifiers(cut_idtrack, 120) * 8  # repeated items are answered again: a large answer
    body = json.dumps({"identifiers": identifiers, "explain": True}).encode()
    extra = {"IDTRACK_WEB_SEND_SECONDS": "2"}
    with serving(cut_store, 0, 1, extra=extra) as (base, _):
        host, port = base.removeprefix("http://").split(":")
        request = urllib.request.Request(  # noqa: S310 - the local test server
            f"{base}{P}/organisms/pig/convert/batch",
            data=body,
            headers={"Content-Type": "application/json", "Accept-Encoding": "identity"},
        )
        with urllib.request.urlopen(request, timeout=60) as answer:  # noqa: S310 - the local test server
            full = len(answer.read())
        assert full > 2_000_000, full  # far more than the sockets' buffers
        sockets = []
        for _ in range(6):
            sock = socket.socket()
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 2048)
            sock.connect((host, int(port)))
            head = (
                f"POST {P}/organisms/pig/convert/batch HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                f"Accept-Encoding: identity\r\nContent-Length: {len(body)}\r\n\r\n"
            )
            sock.sendall(head.encode() + body)
            sockets.append(sock)
        # The answers are made one after another (one worker): watch until some are held untaken, however slow the
        # machine, then until the deadline of 2 s without a byte taken has let go of every one.
        held, waited = 0, time.monotonic()
        while held == 0 and time.monotonic() - waited < 60:
            held = max(held, status_of(base)["requests"]["sending_bytes"])
            time.sleep(0.2)
        after = status_of(base)
        while after["requests"]["sending_bytes"] and time.monotonic() - waited < 120:
            time.sleep(0.5)
            after = status_of(base)
        for sock in sockets:
            sock.settimeout(5)
            got = 0
            try:
                while chunk := sock.recv(65536):
                    got += len(chunk)
            except (ConnectionResetError, TimeoutError):
                pass
            sock.close()
            assert got < full, "a client that took nothing in time got the whole answer"
        assert get(f"{base}{P}/health")[0] == 200
    assert held > 0, "the answers were not held while untaken"
    assert after["requests"]["sending_bytes"] == 0, after["requests"]


def test_a_request_the_parser_refuses_is_answered_in_json(cut_store: Path) -> None:
    with serving(cut_store, 0, 1) as (base, _):
        host, port = base.removeprefix("http://").split(":")
        for request, status, code in (
            (b"POST /api/v1/organisms/pig/convert/batch HTTP/1.1\r\nHost: x\r\nContent-Length: abc\r\n\r\n", 400,
             "invalid_request"),
            (b"GET /api/v1/health?" + b"a" * 70_000 + b" HTTP/1.1\r\nHost: x\r\n\r\n", 414, "uri_too_long"),
        ):  # fmt: skip
            with socket.create_connection((host, int(port))) as sock:
                sock.sendall(request)
                sock.settimeout(10)
                answer = b""
                try:
                    while chunk := sock.recv(65536):
                        answer += chunk
                except (ConnectionResetError, TimeoutError):
                    pass
            head, _, data = answer.partition(b"\r\n\r\n")
            assert head.startswith(f"HTTP/1.1 {status} ".encode()), head
            assert b"content-type: application/json" in head.lower()
            assert b"server:" not in head.lower()
            assert json.loads(data)["error"]["code"] == code


def test_a_client_may_have_two_searches_in_progress(cut_store: Path) -> None:
    extra = {"IDTRACK_WEB_RATE_CONCURRENT_SEARCHES": "2"}
    with serving(cut_store, 600, 100, slow=True, extra=extra) as (base, _), ThreadPoolExecutor(3) as pool:
        running = [
            pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW2.{'0' * i}", 60) for i in range(2)
        ]
        time.sleep(0.5)
        status, headers, body = get(f"{base}{P}/organisms/pig/convert?identifier={GENE}")
        assert [f.result()[0] for f in running] == [200, 200], [f.result()[2] for f in running]
        after = get(f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release=100")[0]
    error = json.loads(body)["error"]
    assert (status, error["code"], error["allowance"]) == (429, "rate_limited", "concurrent_searches")
    assert headers["retry-after"] == "1" and error["retry_after"] == 1
    assert after == 200


def test_a_search_that_waited_for_a_worker_is_still_answered(cut_store: Path) -> None:
    """The head's deadline runs from when a worker took the connection, not across the wait for a worker free of
    searches: a search queued longer than it is answered."""
    extra = {"IDTRACK_WEB_HEAD_SECONDS": "1"}
    with serving(cut_store, 0, 1, slow=True, extra=extra) as (base, _), ThreadPoolExecutor(3) as pool:
        long = [pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW3.{'0' * i}", 60) for i in range(2)]
        time.sleep(0.3)
        start = time.monotonic()
        status, headers, _ = get(f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release=90", timeout=30)
        waited = time.monotonic() - start
        assert [f.result()[0] for f in long] == [200, 200]
    assert status == 200, headers
    assert waited > 2.0, "the search did not wait for a worker"
    assert float(headers["server-timing"].split("queue;dur=")[1].split(",")[0]) > 2000


def raw_request(base: str, request: bytes, timeout: float = 30) -> tuple[int, dict[str, str], bytes]:
    """Send bytes as a request on a connection of its own; return the status, the headers and the body answered."""
    host, port = base.removeprefix("http://").split(":")
    with socket.create_connection((host, int(port))) as sock:
        sock.sendall(request)
        sock.settimeout(timeout)
        answer = b""
        with contextlib.suppress(ConnectionResetError, TimeoutError):
            while chunk := sock.recv(65536):
                answer += chunk
    head, _, body = answer.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in lines[1:])}
    return int(lines[0].split()[1]), headers, body


def test_a_slow_body_holds_no_search(cut_store: Path) -> None:
    """A search counts in its worker only once its whole request has arrived: bodies sent a byte a second, as many as
    the workers, delay no one else's search (without a proxy that buffers bodies in front)."""
    with serving(cut_store, 0, 1) as (base, _):
        host, port = base.removeprefix("http://").split(":")
        slow = []
        for _ in range(2):
            sock = socket.create_connection((host, int(port)))
            sock.sendall(
                b"POST /api/v1/organisms/pig/convert/batch HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                b"Content-Length: 100000\r\n\r\n{"
            )
            slow.append(sock)
        try:
            for _ in range(3):
                time.sleep(1.0)
                for sock in slow:
                    sock.sendall(b" ")
                start = time.monotonic()
                status, _, _ = get(f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release=90", timeout=30)
                assert status == 200
                assert time.monotonic() - start < 1.0, "a search waited behind bodies still on their way"
        finally:
            for sock in slow:
                sock.close()


def test_queued_searches_are_answered_when_the_server_stops(cut_store: Path) -> None:
    """A graceful stop (SIGTERM) answers the searches still in the queue `503 server_busy` with `Retry-After`, and
    finishes the searches running."""
    with serving(cut_store, 0, 1, slow=True) as (base, master), ThreadPoolExecutor(6) as pool:
        running = [
            pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW3.{'0' * i}", 60) for i in range(2)
        ]
        time.sleep(0.5)
        queued = [
            pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release={r}", 60) for r in (80, 90)
        ]
        time.sleep(0.5)
        assert status_of(base)["requests"]["searches_queued"] == 2
        stopped = time.monotonic()
        os.kill(master, signal.SIGTERM)
        answers = [f.result() for f in queued]
        assert time.monotonic() - stopped < 3.0, "the queued searches were not answered at once"
        assert [f.result()[0] for f in running] == [200, 200]
    for status, headers, body in answers:
        error = json.loads(body)["error"]
        assert (status, error["code"]) == (503, "server_busy"), body
        assert headers["retry-after"] == "5" and "stopping" in error["message"]


def test_a_worker_killed_in_a_search_locks_no_client_out(cut_store: Path) -> None:
    """The places a killed worker held among its clients' searches in progress are given back by the master: the
    client searches again at once."""
    extra = {"IDTRACK_WEB_RATE_CONCURRENT_SEARCHES": "2"}
    with serving(cut_store, 600, 100, boots=4, slow=True, extra=extra) as (base, master), ThreadPoolExecutor(2) as pool:
        running = [
            pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW5.{'0' * i}", 60) for i in range(2)
        ]
        time.sleep(1.0)
        for pid in children_of(master):
            os.kill(pid, signal.SIGKILL)
        del running  # their connections die with the workers
        deadline = time.monotonic() + 60
        while len(children_of(master)) != 2 or status_of(base)["workers_alive"] != 2:
            assert time.monotonic() < deadline
        status, _, body = get(f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release=90")
        assert status == 200, body


def test_a_search_that_would_wait_too_long_is_refused(cut_store: Path) -> None:
    """A search whose wait for a worker, estimated from the queue and the recent searches' time, would pass
    `queue_seconds` is refused at once (its token given back); one that waited `queue_seconds` anyway is refused
    unsearched: both `503 server_busy`, never `request_budget_exceeded` with advice to send less."""
    extra = {"IDTRACK_WEB_QUEUE_SECONDS": "1.8", "IDTRACK_WEB_RATE_CONCURRENT_SEARCHES": "0"}
    with serving(cut_store, 1, 30, slow=True, extra=extra) as (base, _), ThreadPoolExecutor(8) as pool:
        assert get(f"{base}{P}/organisms/pig/convert?identifier=SLOW1")[0] == 200  # the recent mean: about 1 s
        running = [
            pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier=SLOW4.{'0' * i}", 60) for i in range(2)
        ]
        time.sleep(0.5)
        queued = []
        for release in (80, 90):  # estimated waits of about 1 and 1.5 s: queued
            queued.append(pool.submit(get, f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release={release}"))
            time.sleep(0.2)
        status, headers, body = get(f"{base}{P}/organisms/pig/convert?identifier={GENE}&to_release=110")
        start = time.monotonic()
        assert [f.result()[0] for f in running] == [200, 200]
        waited = [f.result() for f in queued]
    error = json.loads(body)["error"]
    assert (status, error["code"]) == (503, "server_busy") and "would wait" in error["message"], body
    assert int(headers["retry-after"]) >= 1
    # Five searching requests were admitted before it (rate 1 a minute: nothing refills); its own token came back.
    assert '"searches";r=25' in headers["ratelimit"], headers["ratelimit"]
    assert time.monotonic() - start < 60
    for status, _, body in waited:
        error = json.loads(body)["error"]
        assert (status, error["code"]) == (503, "server_busy") and "was not searched" in error["message"], body
