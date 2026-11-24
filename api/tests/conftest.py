"""Fixtures: published stores of the test graphs, the app over them, and the OpenAPI schemas to check answers against.

Two graphs: the small cut pig graph of ``tests/data`` (always), and the real graphs of ``IDTRACK_WEB_TEST_GRAPHS``
(a folder with ``<organism>/<graph file>.npz``; the tests marked ``real`` are skipped without it).
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from fastapi.testclient import TestClient
from idtrack.api import API
from referencing import Registry as SchemaRegistry
from referencing.jsonschema import DRAFT202012
from starlette.types import ASGIApp

from idtrack_web_api.app import asgi_app
from idtrack_web_api.config import Settings
from idtrack_web_api.data import default_manifest_key, prepare, store_of
from idtrack_web_api.graphs import Registry, load_registry
from idtrack_web_api.publish import DirectoryTarget, publish

TESTS = Path(__file__).resolve().parent
API_ROOT = TESTS.parent
CUT_GRAPH = TESTS / "data" / "graph_sus_scrofa_cut.npz"
OPENAPI = API_ROOT / "openapi.json"


def settings_of(root: Path, **changes: Any) -> Settings:
    """Return settings of a folder store with the defaults, and *changes*."""
    return replace(Settings(source="directory", directory=root), **changes)


def registry_of(settings: Settings) -> Registry:
    """Verify and load the graphs of a store."""
    data = prepare(store_of(settings), settings.manifest_key or default_manifest_key(), settings.organisms)
    return load_registry(data, settings.search_states, settings.search_seconds)


@pytest.fixture(scope="session")
def cut_store(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A folder store holding the cut pig graph (a copy, published by the publishing code)."""
    root = tmp_path_factory.mktemp("cut_store")
    publish([CUT_GRAPH], DirectoryTarget(root))
    return root


@pytest.fixture(scope="session")
def cut_settings(cut_store: Path) -> Settings:
    """The default settings over the cut store."""
    return settings_of(cut_store)


@pytest.fixture(scope="session")
def cut_registry(cut_settings: Settings) -> Registry:
    """The cut graph, loaded once."""
    return registry_of(cut_settings)


@pytest.fixture(scope="session")
def cut_idtrack() -> API:
    """idtrack itself over the same cut graph file, with its default settings (the reference answers)."""
    return API.load(str(CUT_GRAPH))


@pytest.fixture
def make_client(cut_settings: Settings, cut_registry: Registry) -> Iterator[Callable[..., TestClient]]:
    """Return ``make(**settings changes)``: a client of a fresh app over the cut graph (its lifespan running)."""
    clients: list[TestClient] = []

    def make(registry: Registry | None = None, **changes: Any) -> TestClient:
        app: ASGIApp = asgi_app(replace(cut_settings, **changes), registry or cut_registry)
        client = TestClient(app, raise_server_exceptions=True)
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    """A client of the app over the cut graph with the default settings (no rate limit in the way)."""
    return make_client(rate_per_minute=0)


# ------------------------------------------------------------------------------------------------------------------
# Real graphs


def real_graphs_folder() -> Path | None:
    """Return the folder of ``IDTRACK_WEB_TEST_GRAPHS``, or ``None``."""
    value = os.environ.get("IDTRACK_WEB_TEST_GRAPHS")
    return Path(value) if value else None


#: The organism whose real graph the tests marked ``real`` use: ``<IDTRACK_WEB_TEST_GRAPHS>/sus_scrofa/<graph>.npz``.
REAL_ORGANISM = "sus_scrofa"


def real_graph_of(folder: Path | None, organism: str = REAL_ORGANISM) -> Path | str:
    """Return the one graph file of *organism* in a folder of real graphs, or why there is none (a skip's reason).

    Args:
        folder: The folder of ``IDTRACK_WEB_TEST_GRAPHS`` (``None``: not set).
        organism: The organism's production name, the name of its subfolder.

    Returns:
        Path | str: The graph file, or the reason in words.
    """
    if folder is None:
        return "IDTRACK_WEB_TEST_GRAPHS is not set: no real graph"
    graphs = sorted((folder / organism).glob("*.npz"))
    if not graphs:
        return (
            f"IDTRACK_WEB_TEST_GRAPHS={folder} holds no {organism}/<graph>.npz: these tests need the real {organism} "
            "graph (SETUP.md, section 5)"
        )
    if len(graphs) > 1:
        return f"IDTRACK_WEB_TEST_GRAPHS={folder} holds {len(graphs)} graph files in {organism}/; one is expected"
    return graphs[0]


@pytest.fixture(scope="session")
def real_pig(tmp_path_factory: pytest.TempPathFactory) -> tuple[Registry, API, Path]:
    """The real pig graph: a store of links, its registry, and idtrack over the same file."""
    graph = real_graph_of(real_graphs_folder())
    if isinstance(graph, str):
        pytest.skip(graph)
    root = tmp_path_factory.mktemp("real_store")
    publish([graph], DirectoryTarget(root, link=True))
    return registry_of(settings_of(root)), API.load(str(graph)), root


# ------------------------------------------------------------------------------------------------------------------
# The OpenAPI document as the judge of every answer


@pytest.fixture(scope="session")
def openapi() -> dict[str, Any]:
    """The checked-in OpenAPI document."""
    document: dict[str, Any] = json.loads(OPENAPI.read_text(encoding="utf-8"))
    return document


@pytest.fixture(scope="session")
def check_schema(openapi: dict[str, Any]) -> Callable[[Any, str], None]:
    """Return ``check(data, schema name)``: raise unless *data* is valid against the document's schema."""
    registry: SchemaRegistry[Any] = SchemaRegistry().with_resource("urn:openapi", DRAFT202012.create_resource(openapi))

    def check(data: Any, name: str) -> None:
        schema = {"$ref": f"urn:openapi#/components/schemas/{name}"}
        validator = jsonschema.Draft202012Validator(
            schema, registry=registry, format_checker=jsonschema.FormatChecker()
        )
        errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
        if errors:
            raise AssertionError(f"{len(errors)} schema errors against {name}: {[e.message for e in errors[:5]]}")

    return check


@pytest.fixture(scope="session")
def check_response(openapi: dict[str, Any], check_schema: Callable[[Any, str], None]) -> Callable[..., Any]:
    """Return ``check(response, path, method)``: the answer's status and body must be what the document declares."""

    def check(response: Any, path: str, method: str = "get") -> Any:
        operation = openapi["paths"][path][method]
        declared = operation["responses"].get(str(response.status_code))
        assert declared is not None, (
            f"{method.upper()} {path} answered {response.status_code}, which it does not declare"
        )
        media = response.headers["content-type"].split(";")[0]
        content = declared["content"]
        assert media in content, f"{media} is not a declared content type of {response.status_code}"
        if media != "application/json":
            return response.text
        data = response.json()
        ref = content[media]["schema"]["$ref"].rsplit("/", 1)[-1]
        check_schema(data, ref)
        assert response.headers.get("x-request-id"), "every answer carries X-Request-ID"
        if response.status_code >= 400:
            assert data["error"]["request_id"] == response.headers["x-request-id"]
        return data

    return check
