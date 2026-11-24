"""The HTTP application: endpoints, error answers, bounds, and (optionally) the built frontend.

Every endpoint is under ``/api/v1``. A success is JSON (a batch also as TSV); every failure is
``{"error": {...}}`` (:py:class:`idtrack_web_api.schemas.ErrorResponse`) with a stable code
(:py:data:`idtrack_web_api.errors.CODES`). Results are idtrack's ``to_dict()`` written as JSON as they are: no
value is rounded, renamed or reformatted on the way.
"""

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal, TypeVar

import anyio
from fastapi import Depends, FastAPI, Query, Request
from fastapi import Path as PathParam
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

import idtrack_web_api
from idtrack_web_api import schemas, service, tsv
from idtrack_web_api.adapter import FORMAT_VERSION, idtrack_commit, idtrack_version
from idtrack_web_api.config import Settings
from idtrack_web_api.errors import ApiError, error_json
from idtrack_web_api.graphs import LoadedGraph, Registry
from idtrack_web_api.limits import RateLimiter, SearchSlot
from idtrack_web_api.vocabulary import vocabulary

log = logging.getLogger("idtrack_web_api")
access_log = logging.getLogger("idtrack_web_api.access")

API_PREFIX = "/api/v1"
_UNLIMITED = (f"{API_PREFIX}/health",)
_SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
]
T = TypeVar("T")


def _json_bytes(data: Any) -> bytes:
    """Write JSON exactly: floats as their shortest round-trip text, no NaN or infinity, UTF-8."""
    return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _state(scope: Scope) -> dict[str, Any]:
    state: dict[str, Any] = scope.setdefault("state", {})
    return state


async def _send_error(send: Send, error: ApiError, request_id: str) -> None:
    body = error_json(error, request_id)
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    headers += [(k.lower().encode(), v.encode()) for k, v in error.headers.items()]
    await send({"type": "http.response.start", "status": error.status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


class Guard:
    """The outermost layer: request id, security headers, access log, the rate limit, the body bound, faults as 500.

    No exception leaves it: an error after the response started is logged and the connection closed; one before is
    answered as ``500 internal_error`` with the request's id (the traceback goes to the log only).
    """

    def __init__(self, app: ASGIApp, settings: Settings, limiter: RateLimiter) -> None:
        self.app = app
        self.settings = settings
        self.limiter = limiter

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Serve one connection event."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = uuid.uuid4().hex
        state = _state(scope)
        state["request_id"] = request_id
        state["arrived"] = time.monotonic()
        status = {"code": 0}

        async def send_marked(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                headers = [*message.get("headers", []), (b"x-request-id", request_id.encode()), *_SECURITY_HEADERS]
                message = {**message, "headers": headers}
            await send(message)

        client = scope.get("client")
        client_host = client[0] if client else "unknown"
        try:
            path: str = scope["path"]
            if path.startswith(API_PREFIX) and path not in _UNLIMITED:
                wait = self.limiter.take(client_host)
                if wait is not None:
                    await _send_error(
                        send_marked,
                        ApiError(
                            "rate_limited",
                            f"More than {self.settings.rate_per_minute} requests per minute from this client; retry in "
                            f"{RateLimiter.retry_after(wait)} s.",
                            headers={"Retry-After": RateLimiter.retry_after(wait)},
                        ),
                        request_id,
                    )
                    return
            replayed = await self._bounded_body(scope, receive, send_marked, request_id)
            if replayed is None:
                return
            await self.app(scope, replayed, send_marked)
        except Exception:
            log.exception("Internal error in request %s (%s %s)", request_id, scope.get("method"), scope.get("path"))
            if status["code"] == 0:
                await _send_error(
                    send_marked,
                    ApiError(
                        "internal_error",
                        f"The server failed to answer this request; quote the request id {request_id} when "
                        "reporting it.",
                    ),
                    request_id,
                )
        finally:
            seconds = time.monotonic() - state["arrived"]
            access_log.info(
                "%s %s %s %d %.3fs %s", client_host, scope.get("method"), scope.get("path"), status["code"], seconds,
                request_id,
            )  # fmt: skip

    async def _bounded_body(self, scope: Scope, receive: Receive, send: Send, request_id: str) -> Receive | None:
        """Read a request body up to the bound and replay it; answer 413 (and return ``None``) when it is larger."""
        if scope.get("method") not in {"POST", "PUT", "PATCH"}:
            return receive
        limit = self.settings.body_max_bytes
        too_large = ApiError(
            "payload_too_large", f"The request body is larger than {limit} bytes; send fewer identifiers per request."
        )
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    await _send_error(
                        send, ApiError("invalid_request", "The Content-Length header is not a number."), request_id
                    )
                    return None
                if declared > limit:
                    await _send_error(send, too_large, request_id)
                    return None
        chunks: list[bytes] = []
        size = 0
        more = True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return None
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                await _send_error(send, too_large, request_id)
                return None
            chunks.append(chunk)
            more = message.get("more_body", False)
        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        return replay


def _request_id(request: Request) -> str:
    return str(request.scope.get("state", {}).get("request_id", "none"))


def _error_response(request: Request, error: ApiError) -> Response:
    return Response(
        content=error_json(error, _request_id(request)),
        status_code=error.status,
        media_type="application/json",
        headers=error.headers,
    )


def _location(raw: tuple[Any, ...] | list[Any]) -> list[str | int]:
    return [p if isinstance(p, int) and not isinstance(p, bool) else str(p) for p in raw]


def create_app(settings: Settings, registry: Registry) -> FastAPI:  # noqa: PLR0915 - every endpoint, in one place
    """Make the application over loaded graphs.

    Args:
        settings: The server's settings.
        registry: The loaded graphs.

    Returns:
        FastAPI: The application without its outer layer (:py:func:`asgi_app` returns what a server runs).
    """
    slot = SearchSlot(queue_max=settings.queue_max)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # The limiter belongs to the event loop of this worker (made after the fork).
        slot.reset()
        yield

    app = FastAPI(
        title="idtrack web api",
        version=idtrack_web_api.__version__,
        summary="Gene identifiers through Ensembl releases, assemblies and external databases.",
        description=(
            "Converts gene identifiers between Ensembl releases and databases with idtrack. Every result is "
            'idtrack\'s own `to_dict()`, unchanged; every error is `{"error": {...}}` with a stable `code`.'
        ),
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.registry = registry
    app.state.slot = slot
    version_body = _json_bytes(_version(registry))
    vocabulary_body = _json_bytes(vocabulary())
    limits_body = _json_bytes(limits(settings))

    # ---------------------------------------------------------------------------------------------------------------
    # Errors

    @app.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError) -> Response:
        return _error_response(request, error)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> Response:
        details = [{"location": _location(e.get("loc", ())), "message": str(e.get("msg", ""))} for e in error.errors()]
        message = "; ".join(f"{'.'.join(map(str, d['location']))}: {d['message']}" for d in details)
        return _error_response(
            request, ApiError("invalid_request", f"The request is not valid: {message}", details=details)
        )

    @app.exception_handler(Exception)
    async def fault(request: Request, error: Exception) -> Response:
        # Answered here; the outer layer (Guard) logs the traceback with the request's id.
        request_id = _request_id(request)
        return _error_response(
            request,
            ApiError(
                "internal_error",
                f"The server failed to answer this request; quote the request id {request_id} when reporting it.",
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, error: StarletteHTTPException) -> Response:
        if error.status_code == 405:
            return _error_response(request, ApiError("method_not_allowed", f"{request.method} is not allowed here."))
        if error.status_code == 404:
            return _error_response(request, ApiError("not_found", f"There is nothing at {request.url.path}."))
        log.error("Unexpected HTTP error %s in request %s", error.status_code, _request_id(request))
        return _error_response(
            request, ApiError("internal_error", f"Unexpected error; quote the request id {_request_id(request)}.")
        )

    # ---------------------------------------------------------------------------------------------------------------
    # Shared parts of the endpoints

    def only(*names: str) -> Callable[[Request], None]:
        allowed = set(names)

        def check(request: Request) -> None:
            keys = [k for k, _ in request.query_params.multi_items()]
            unknown = sorted({k for k in keys if k not in allowed})
            if unknown:
                raise ApiError(
                    "unknown_parameter",
                    f"This endpoint does not take the query parameters {unknown}.",
                    allowed=sorted(allowed),
                )
            repeated = sorted({k for k in keys if keys.count(k) > 1})
            if repeated:
                raise ApiError("unknown_parameter", f"The query parameters {repeated} are given more than once.")

        return check

    def json_content(request: Request) -> None:
        kind = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if kind != "application/json":
            raise ApiError(
                "unsupported_media_type",
                f"The body must be JSON with the header `Content-Type: application/json`; got {kind or 'no type'!r}.",
            )

    def graph_of(
        organism: Annotated[
            str, PathParam(description="The organism: `sus_scrofa`, or a short name (`pig`).", max_length=100)
        ],
    ) -> LoadedGraph:
        graph = registry.get(organism)
        if graph is None:
            raise ApiError(
                "unknown_organism",
                f"This server holds no graph of {organism!r}; it holds {sorted(registry.graphs)}.",
                argument="organism",
                allowed=sorted(registry.graphs),
            )
        return graph

    def json_body(data: Any) -> Response:
        body = _json_bytes(data)
        if len(body) > settings.response_max_bytes:
            raise ApiError(
                "response_too_large",
                f"The answer has {len(body)} bytes; this server sends at most {settings.response_max_bytes}. "
                "Ask without "
                "`explain`, or for fewer identifiers.",
            )
        return Response(content=body, media_type="application/json")

    async def on_search_thread(request: Request, work: Callable[[float], T]) -> T:
        """Run *work(deadline)* on this worker's search thread, waiting in a bounded queue."""
        if slot.waiting >= slot.queue_max:
            raise ApiError(
                "server_busy",
                f"This worker has {slot.waiting} requests waiting; retry in a few seconds.",
                headers={"Retry-After": "2"},
            )
        deadline = float(request.scope["state"]["arrived"]) + settings.request_seconds
        slot.waiting += 1
        try:
            return await anyio.to_thread.run_sync(work, deadline, limiter=slot.limiter)
        finally:
            slot.waiting -= 1

    errors_common: dict[int | str, dict[str, Any]] = {
        400: {"model": schemas.ErrorResponse, "description": "The request is not valid (see `error.code`)."},
        404: {"model": schemas.ErrorResponse, "description": "No such organism (`unknown_organism`) or endpoint."},
        429: {"model": schemas.ErrorResponse, "description": "Too many requests from this client (`rate_limited`)."},
        500: {"model": schemas.ErrorResponse, "description": "A fault of the server (`internal_error`)."},
    }
    errors_search: dict[int | str, dict[str, Any]] = {
        **errors_common,
        408: {"model": schemas.ErrorResponse, "description": "Out of the request's time budget."},
        422: {"model": schemas.ErrorResponse, "description": "A search over its budget, or an answer too large."},
        503: {"model": schemas.ErrorResponse, "description": "The server is busy (`server_busy`)."},
    }

    explain_query = Annotated[bool, Query(description="Add the path of every candidate (`path`).")]
    allow_bridges_query = Annotated[
        bool, Query(description="Allow bridges through ids two genes share when history ends.")
    ]

    # ---------------------------------------------------------------------------------------------------------------
    # Endpoints

    @app.get(
        f"{API_PREFIX}/health",
        response_model=None,
        responses={200: {"model": schemas.HealthResponse}, 400: errors_common[400], 500: errors_common[500]},
        tags=["server"],
        summary="The server is up and holds its graphs",
        dependencies=[Depends(only())],
    )
    async def health() -> Response:
        return json_body({"status": "ok", "organisms": list(registry.graphs)})

    @app.get(
        f"{API_PREFIX}/version",
        response_model=None,
        responses={200: {"model": schemas.VersionResponse}, **errors_common},
        tags=["server"],
        summary="The versions of the api, idtrack and every loaded graph",
        dependencies=[Depends(only())],
    )
    async def version() -> Response:
        return Response(content=version_body, media_type="application/json")

    @app.get(
        f"{API_PREFIX}/vocabulary",
        response_model=None,
        responses={200: {"model": schemas.VocabularyResponse}, **errors_common},
        tags=["server"],
        summary="What the codes of the answers mean: idtrack's own tables, the api's where idtrack has none",
        dependencies=[Depends(only())],
    )
    async def vocabulary_endpoint() -> Response:
        return Response(content=vocabulary_body, media_type="application/json")

    @app.get(
        f"{API_PREFIX}/limits",
        response_model=None,
        responses={200: {"model": schemas.LimitsResponse}, **errors_common},
        tags=["server"],
        summary="The bounds this server enforces, as configured",
        dependencies=[Depends(only())],
    )
    async def limits_endpoint() -> Response:
        return Response(content=limits_body, media_type="application/json")

    @app.get(
        f"{API_PREFIX}/organisms",
        response_model=None,
        responses={200: {"model": schemas.OrganismsResponse}, **errors_common},
        tags=["organisms"],
        summary="Every loaded organism and what its graph holds",
        dependencies=[Depends(only())],
    )
    async def organisms() -> Response:
        return json_body({"organisms": [g.description for g in registry.graphs.values()]})

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}",
        response_model=None,
        responses={200: {"model": schemas.GraphDescriptionModel}, **errors_common},
        tags=["organisms"],
        summary="What one organism's graph holds: releases, assemblies, databases, its build",
        dependencies=[Depends(only())],
    )
    async def organism(graph: Annotated[LoadedGraph, Depends(graph_of)]) -> Response:
        return json_body(graph.description)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/final-databases",
        response_model=None,
        responses={200: {"model": schemas.FinalDatabasesResponse}, **errors_common},
        tags=["organisms"],
        summary="The databases a conversion to a release can end in",
        dependencies=[Depends(only("to_release"))],
    )
    async def final_databases(
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        to_release: Annotated[
            int | None, Query(ge=1, le=100_000, description="The target release; omitted: the snapshot release.")
        ] = None,
    ) -> Response:
        databases = service.final_databases(graph, to_release)
        release = graph.graph.identity().snapshot_release if to_release is None else to_release
        return json_body({"organism": graph.organism, "to_release": release, "final_databases": databases})

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/convert",
        response_model=None,
        responses={200: {"model": schemas.ConversionResultModel}, **errors_search},
        tags=["conversion"],
        summary="Convert one identifier: every candidate ranked, the best marked, optionally its path",
        dependencies=[
            Depends(
                only(
                    "identifier",
                    "from_release",
                    "to_release",
                    "final_database",
                    "from_database",
                    "explain",
                    "allow_bridges",
                )
            )
        ],
    )
    async def convert(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        identifier: Annotated[
            str, Query(description="An Ensembl id (with or without version), a symbol or another id.")
        ],
        from_release: Annotated[
            int | None, Query(ge=1, le=100_000, description="The release it is read at; omitted: inferred.")
        ] = None,
        to_release: Annotated[
            int | None, Query(ge=1, le=100_000, description="The target release; omitted: the snapshot release.")
        ] = None,
        final_database: Annotated[
            str | None, Query(description="The database of the targets; omitted: `ensembl_gene`.")
        ] = None,
        from_database: Annotated[str | None, Query(description="The database the identifier is meant in.")] = None,
        explain: explain_query = False,
        allow_bridges: allow_bridges_query = True,
    ) -> Response:
        service.require_text(identifier, "identifier", settings)
        conversion = service.conversion_arguments(
            from_release, to_release, final_database, from_database, explain, allow_bridges
        )
        result = await on_search_thread(
            request, lambda deadline: service.convert_one(graph, identifier, conversion, settings, deadline)
        )
        return json_body(result)

    @app.post(
        f"{API_PREFIX}/organisms/{{organism}}/convert/batch",
        response_model=None,
        responses={
            200: {
                "model": schemas.BatchResponse,
                "content": {
                    "text/tab-separated-values": {
                        "schema": {"type": "string"},
                        "example": "\t".join(tsv.COLUMNS) + "\n",
                    }
                },
                "description": "JSON (`format=json`) or a table with one row per candidate (`format=tsv`).",
            },
            **errors_search,
            413: {"model": schemas.ErrorResponse, "description": "Too large a body or too many identifiers."},
            415: {"model": schemas.ErrorResponse, "description": "A body that is not `application/json`."},
        },
        tags=["conversion"],
        summary="Convert a batch with the same arguments; results in input order, each with its own status",
        dependencies=[Depends(only("format")), Depends(json_content)],
    )
    async def convert_batch(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        body: schemas.BatchRequest,
        format: Annotated[
            Literal["json", "tsv"], Query(description="`json` (default) or `tsv` (one row per candidate).")
        ] = "json",
    ) -> Response:
        if len(body.identifiers) > settings.batch_max:
            raise ApiError(
                "too_many_identifiers",
                f"The batch has {len(body.identifiers)} identifiers; this server takes at most "
                f"{settings.batch_max} per "
                "request.",
                argument="identifiers",
            )
        problems = [
            {"location": ["body", "identifiers", i], "message": problem}
            for i, text in enumerate(body.identifiers)
            if (problem := service.check_text(text, "identifiers", settings, ["identifiers", i])) is not None
        ]
        if problems:
            raise ApiError(
                "invalid_identifier",
                f"{len(problems)} identifiers cannot be converted: "
                + "; ".join(str(p["message"]) for p in problems[:5])
                + (" ..." if len(problems) > 5 else ""),
                argument="identifiers",
                details=problems,
            )
        conversion = service.conversion_arguments(
            body.from_release,
            body.to_release,
            body.final_database,
            body.from_database,
            body.explain,
            body.allow_bridges,
        )
        results = await on_search_thread(
            request, lambda deadline: service.convert_batch(graph, body.identifiers, conversion, settings, deadline)
        )
        if format == "tsv":
            text = tsv.write(results).encode("utf-8")
            if len(text) > settings.response_max_bytes:
                raise ApiError(
                    "response_too_large",
                    f"The table has {len(text)} bytes; this server sends at most {settings.response_max_bytes}.",
                )
            return Response(
                content=text,
                media_type="text/tab-separated-values; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="idtrack_{graph.organism}.tsv"'},
            )
        return json_body({"count": len(results), "results": results})

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/genes-named",
        response_model=None,
        responses={200: {"model": schemas.NamesResponse}, **errors_search},
        tags=["names"],
        summary="The genes a name of an external database names, per database and release",
        dependencies=[Depends(only("name", "fold_case"))],
    )
    async def genes_named(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        name: Annotated[str, Query(description="The name as written (e.g. a symbol).")],
        fold_case: Annotated[bool, Query(description="Match without letter case.")] = False,
    ) -> Response:
        service.require_text(name, "name", settings)
        matches = await on_search_thread(request, lambda _deadline: service.genes_named(graph, name, fold_case))
        return json_body({"matches": matches})

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/names-of",
        response_model=None,
        responses={200: {"model": schemas.NamesResponse}, **errors_search},
        tags=["names"],
        summary="The names external databases give a gene, per database and release",
        dependencies=[Depends(only("gene", "release"))],
    )
    async def names_of(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        gene: Annotated[str, Query(description="An Ensembl gene id with version (e.g. `ENSSSCG00000063423.1`).")],
        release: Annotated[
            int | None, Query(ge=1, le=100_000, description="Only names that hold at this release; omitted: all.")
        ] = None,
    ) -> Response:
        service.require_text(gene, "gene", settings)
        matches = await on_search_thread(request, lambda _deadline: service.names_of(graph, gene, release))
        return json_body({"matches": matches})

    def openapi() -> dict[str, Any]:
        """The document, without FastAPI's own validation answer (this api answers 400 `invalid_request`)."""
        if app.openapi_schema is None:
            from fastapi.openapi.utils import get_openapi

            document = get_openapi(
                title=app.title, version=app.version, summary=app.summary, description=app.description,
                routes=app.routes, tags=app.openapi_tags,
            )  # fmt: skip
            for operations in document.get("paths", {}).values():
                for operation in operations.values():
                    responses = operation.get("responses", {})
                    default = responses.get("422", {}).get("content", {}).get("application/json", {}).get("schema", {})
                    if default.get("$ref") == "#/components/schemas/HTTPValidationError":
                        del responses["422"]
            schemas_found = document.get("components", {}).get("schemas", {})
            for name in ("HTTPValidationError", "ValidationError"):
                schemas_found.pop(name, None)
            app.openapi_schema = document
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]

    if settings.static_dir is not None:
        _serve_frontend(app, settings.static_dir)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
            expose_headers=["X-Request-ID", "Retry-After", "Content-Disposition"],
        )
    return app


def _serve_frontend(app: FastAPI, root: Path) -> None:
    """Serve the built frontend: its files, and ``index.html`` for every other path without a file extension."""
    root = root.resolve()
    index = root / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str) -> Response:
        if path == API_PREFIX.lstrip("/") or path.startswith(API_PREFIX.lstrip("/") + "/"):
            raise ApiError("not_found", f"There is no endpoint /{path}.")
        target = (root / path).resolve()
        if target.is_relative_to(root) and target.is_file():
            return FileResponse(target)
        if "." not in Path(path).name and index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        raise ApiError("not_found", f"There is no file /{path}.")


def limits(settings: Settings) -> dict[str, Any]:
    """Return the body of ``/limits``: the bounds of the server's settings.

    Args:
        settings: The server's settings.

    Returns:
        dict[str, Any]: As :py:class:`idtrack_web_api.schemas.LimitsResponse` describes it.
    """
    return {
        "batch_max": settings.batch_max,
        "identifier_max_length": settings.identifier_max_length,
        "body_max_bytes": settings.body_max_bytes,
        "response_max_bytes": settings.response_max_bytes,
        "request_seconds": float(settings.request_seconds),
        "search_seconds": float(settings.search_seconds),
        "search_states": settings.search_states,
        "rate_per_minute": settings.rate_per_minute,
        "rate_burst": settings.rate_burst,
        "queue_max": settings.queue_max,
    }


def _version(registry: Registry) -> dict[str, Any]:
    """Return the body of ``/version``."""
    graphs = []
    for graph in registry.graphs.values():
        identity = graph.graph.identity()
        graphs.append(
            {
                "organism": graph.organism,
                "snapshot_release": identity.snapshot_release,
                "file": graph.entry.file.model_dump(mode="json"),
                "format_version": identity.format_version,
                "content_digest": identity.content_digest,
                "package_version": identity.package_version,
                "package_commit": identity.package_commit,
                "build_date": identity.build_date,
            }
        )
    return {
        "api_version": idtrack_web_api.__version__,
        "idtrack_version": idtrack_version(),
        "idtrack_commit": idtrack_commit(),
        "graph_format_version": FORMAT_VERSION,
        "manifest": registry.manifest_file.model_dump(mode="json"),
        "graphs": graphs,
    }


def asgi_app(settings: Settings, registry: Registry) -> ASGIApp:
    """Return what a server runs: the application inside its outer layer.

    Args:
        settings: The server's settings.
        registry: The loaded graphs.

    Returns:
        ASGIApp: The application.
    """
    limiter = RateLimiter(settings.rate_per_minute, settings.rate_burst)
    return Guard(create_app(settings, registry), settings, limiter)


__all__ = ["API_PREFIX", "Guard", "asgi_app", "create_app", "limits"]
