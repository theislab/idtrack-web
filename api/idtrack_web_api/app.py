"""The HTTP application: endpoints, error answers, bounds, and (optionally) the built frontend.

Every endpoint is under ``/api/v1``. A success is JSON (a batch also as TSV); every failure is
``{"error": {...}}`` (:py:class:`idtrack_web_api.schemas.ErrorResponse`) with a stable code
(:py:data:`idtrack_web_api.errors.CODES`). Results are idtrack's ``to_dict()`` written as JSON as they are: no
value is rounded, renamed or reformatted on the way. Every response carries ``Server-Timing``: the server's own time
on the request (``app``), and for a request that searched, the time it waited for its worker's search thread
(``queue``) and the search's own time (``search``), in milliseconds.
"""

import asyncio
import collections
import functools
import gzip
import hashlib
import json
import logging
import re
import sys
import threading
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal, TypeVar
from urllib.parse import unquote_to_bytes

import anyio
import pydantic
from fastapi import Depends, FastAPI, Query, Request
from fastapi import Path as PathParam
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from pydantic import BeforeValidator
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.routing import Match
from starlette.types import ASGIApp

import idtrack_web_api
from idtrack_web_api import contract, docs, history, lineages, schemas, service, showcase, tsv, writing
from idtrack_web_api.adapter import FORMAT_VERSION, idtrack_commit, idtrack_version, organism_aliases
from idtrack_web_api.config import DOCS_URL, Settings
from idtrack_web_api.errors import ApiError, error_json, listed
from idtrack_web_api.frontend import Frontend, accepts_gzip, frame_of
from idtrack_web_api.graphs import LoadedGraph, Registry
from idtrack_web_api.guard import API_PREFIX, CONNECTION, SEND_MIN_RATE, STATUS_PATH, Guard
from idtrack_web_api.limits import READ_SHARE, RateLimiter, SearchSlot
from idtrack_web_api.monitor import CACHE_SECONDS, LoadMonitor
from idtrack_web_api.vocabulary import vocabulary

log = logging.getLogger("idtrack_web_api")

T = TypeVar("T")
#: The most problems an ``invalid_request`` answer lists (the message says how many more there were).
DETAILS_MAX = 20
_DIGITS = re.compile(r"[0-9]{1,9}")
#: The page of one organism's graph (``web/src/lib/routes.ts``), its name as the path writes it.
ORGANISM_PAGE = re.compile(r"^/organisms/([^/]+)/?$")
#: JSON's names of the types of Python's values, for messages about a body.
_JSON_TYPES = {
    "dict": "an object", "list": "an array", "str": "a string", "int": "a number", "float": "a number",
    "bool": "`true` or `false`", "NoneType": "`null`",
}  # fmt: skip
#: The query parameters that carry an identifier or a name (refused as ``invalid_identifier``, as in a body).
_TEXT_PARAMETERS = frozenset({"identifier", "name", "gene"})
#: A ``Host`` header the api writes into absolute links (``/llms.txt``) when no ``public_url`` is set: a name or an
#: address, with a port.
_HOST = re.compile(r"[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?|\[[0-9A-Fa-f:.]{2,45}\](:[0-9]{1,5})?")
#: The organism's description of a graph build record that holds no version (``package_version``).
_VERSION = re.compile(r"^[0-9]+(\.[0-9]+)*([a-z]+[0-9]+)?(\.post[0-9]+)?(\.dev[0-9]+)?(\+[A-Za-z0-9.]+)?$")


def _json_bytes(data: Any) -> bytes:
    """Write JSON exactly: floats as their shortest round-trip text, no NaN or infinity, UTF-8."""
    return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def too_large(error: writing.TooLargeError, advice: tuple[str, str | None]) -> ApiError:
    """Return the refusal of an answer that passed ``response_max_bytes`` while it was written.

    Args:
        error: Where writing stopped.
        advice: What in the request can make the answer smaller (it depends on the endpoint and its arguments), in
            words, and the argument to change (:py:func:`advice_of`).

    Returns:
        ApiError: ``response_too_large``, its ``argument`` the one to change where there is one.
    """
    words, argument = advice
    return ApiError(
        "response_too_large",
        f"The answer is larger than the {error.limit} bytes this server sends (writing it stopped at {error.written} "
        f"bytes); {words}.",
        argument=argument,
    )


def advice_of(*, identifiers: int = 1, explain: bool = False) -> tuple[str, str | None]:
    """Return what can make an answer smaller, for the request that was sent.

    Args:
        identifiers: The identifiers the request holds (a batch: more than one).
        explain: Whether it asked for the paths.

    Returns:
        tuple[str, str | None]: The advice in words, and the argument to change first (``explain``: the paths are most
        of an answer; else ``identifiers`` for a batch; ``None`` where nothing helps).
    """
    ways = []
    if explain:
        ways.append("ask without `explain` (the paths are most of the answer)")
    if identifiers > 1:
        ways.append("send fewer identifiers per request")
    if ways:
        return " or ".join(ways), "explain" if explain else "identifiers"
    return "no argument of this request makes it smaller, so the same request is refused again", None


def utf8_query(query: bytes) -> None:
    """Refuse a query whose parameters are not UTF-8 once percent-decoded (as a body that is not UTF-8 is refused).

    Args:
        query: The query string, as sent.

    Raises:
        ApiError: ``invalid_identifier`` for an identifier or a name, ``invalid_request`` for any other parameter.
    """
    for part in query.split(b"&"):
        name, _, value = part.partition(b"=")
        key = unquote_to_bytes(name.replace(b"+", b" ")).decode("utf-8", "replace")
        for what, raw in (("name", name), ("value", value)):
            try:
                unquote_to_bytes(raw.replace(b"+", b" ")).decode("utf-8")
            except UnicodeDecodeError as error:
                code = "invalid_identifier" if what == "value" and key in _TEXT_PARAMETERS else "invalid_request"
                raise ApiError(
                    code,
                    f"The {what} of the query parameter {key!r} is not UTF-8 once percent-decoded (byte {error.start} "
                    "cannot be read); send UTF-8, percent-encoded.",
                    argument=key if what == "value" else None,
                ) from None


def _release_text(value: Any) -> Any:
    """Read a release of the query: digits only (``115``; not ``115.0``, `` 115`` or ``+115``)."""
    if isinstance(value, str):
        if not _DIGITS.fullmatch(value):
            msg = f"must be a whole number from 0 to 999999999, written in digits only, not {json.dumps(value)[:80]}"
            raise ValueError(msg)
        return int(value)
    return value


def _boolean_text(value: Any) -> Any:
    """Read a boolean of the query: ``true`` or ``false`` only (as JSON writes them)."""
    if isinstance(value, str):
        if value not in {"true", "false"}:
            msg = f"must be `true` or `false`, not {json.dumps(value)[:80]}"
            raise ValueError(msg)
        return value == "true"
    return value


def _release_query(text: str) -> Any:
    return Annotated[
        int | None,
        BeforeValidator(_release_text),
        Query(ge=0, le=schemas.RELEASE_MAX, description=f"{text} {schemas.RELEASE_TEXT}"),
    ]


def _boolean_query(text: str) -> Any:
    return Annotated[bool, BeforeValidator(_boolean_text), Query(description=f"{text} Written true or false.")]


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


def _json_type(value: Any) -> str:
    """Return the JSON type of a value as words (a query's value is text)."""
    return _JSON_TYPES.get(type(value).__name__, "that")


def _plural(count: Any, one: str) -> str:
    return f"{count} {one}" + ("" if count == 1 else "s")


#: The api's words for each kind of validation problem (pydantic's ``type``): a function of the problem's context, of
#: what was sent (``sent``: "not a string", or the query's text) and of the validator's own text without its prefix.
_PROBLEM_WORDS: dict[str, Callable[[dict[str, Any], str, str], str]] = {
    "value_error": lambda _ctx, _sent, text: text,
    "int_type": lambda _ctx, sent, _text: f"must be a whole number written as a JSON number (such as 115), {sent}",
    "int_parsing": lambda _ctx, sent, _text: f"must be a whole number written as a JSON number (such as 115), {sent}",
    "int_from_float": lambda _ctx, sent, _text: (
        f"must be a whole number written as a JSON number (such as 115), {sent}"
    ),
    "bool_type": lambda _ctx, sent, _text: f"must be `true` or `false`, {sent}",
    "bool_parsing": lambda _ctx, sent, _text: f"must be `true` or `false`, {sent}",
    "string_type": lambda _ctx, sent, _text: f"must be a string, {sent}",
    "list_type": lambda _ctx, sent, _text: f"must be an array, {sent}",
    "missing": lambda _ctx, _sent, _text: "is required",
    "too_short": lambda ctx, _sent, _text: (
        f"must hold at least {_plural(ctx.get('min_length'), 'item')}, not {ctx.get('actual_length')}"
    ),
    "too_long": lambda ctx, _sent, _text: (
        f"must hold at most {_plural(ctx.get('max_length'), 'item')}, not {ctx.get('actual_length')}"
    ),
    "string_too_short": lambda ctx, _sent, _text: f"must have at least {_plural(ctx.get('min_length'), 'character')}",
    "string_too_long": lambda ctx, _sent, _text: f"must have at most {_plural(ctx.get('max_length'), 'character')}",
    "literal_error": lambda ctx, sent, _text: f"must be {str(ctx.get('expected', '')).replace(chr(39), '`')}, {sent}",
    "enum": lambda ctx, sent, _text: f"must be {str(ctx.get('expected', '')).replace(chr(39), '`')}, {sent}",
    "greater_than_equal": lambda ctx, _sent, _text: f"must be at least {ctx.get('ge')}",
    "less_than_equal": lambda ctx, _sent, _text: f"must be at most {ctx.get('le')}",
}


def problem_text(error: dict[str, Any]) -> str:
    """Return a validation problem in the api's own words: what the value must be, and what was sent instead.

    The validator's own wording (its type names, ``Value error,``, ``after validation``) never reaches a message: each
    kind of problem is written by :py:data:`_PROBLEM_WORDS`, and a problem of another kind keeps the validator's text
    without those words.

    Args:
        error: One problem as pydantic reports it (``type``, ``loc``, ``msg``, ``input``, ``ctx``).

    Returns:
        str: The problem, without the name of the value (the caller writes where it is).
    """
    given = error.get("input")
    in_query = (error.get("loc") or ("",))[0] in {"query", "path"}
    sent = f"not {json.dumps(given, ensure_ascii=False)[:80]}" if in_query else f"not {_json_type(given)}"
    text = str(error.get("msg", "")).removeprefix("Value error, ").replace(" after validation", "")
    words = _PROBLEM_WORDS.get(str(error.get("type", "")))
    return text if words is None else words(error.get("ctx") or {}, sent, text)


def _problems(errors: list[Any], prefix: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Return the validator's problems as the api lists them: where each is, and the problem in the api's words."""
    return [{"location": [*prefix, *_location(e.get("loc", ()))], "message": problem_text(e)} for e in errors]


def _where(location: list[Any]) -> str:
    """Return where a problem is, in words.

    For example ```to_release` in the query``, or ``item 3 (from 0) of `identifiers` in the body``.
    """
    if len(location) < 2 or location[0] not in {"query", "path", "body"}:
        return f"`{'.'.join(map(str, location))}`"
    names = [str(p) for p in location[1:] if not isinstance(p, int)]
    items = [p for p in location[1:] if isinstance(p, int)]
    where = f"`{'.'.join(names)}` in the {location[0]}"
    return f"item {items[-1]} (from 0) of {where}" if items else where


def _argument(details: list[dict[str, Any]]) -> str | None:
    """Return the one argument every problem is about (``query``/``path``/``body`` and a name), else ``None``."""
    names = {
        str(d["location"][1])
        for d in details
        if len(d["location"]) > 1 and d["location"][0] in {"query", "path", "body"}
    }
    if len(names) == 1 and all(len(d["location"]) > 1 for d in details):
        return names.pop()
    return None


def invalid_request_error(problems: list[dict[str, Any]], prefix: str = "The request is not valid") -> ApiError:
    """Return ``invalid_request`` for problems: at most :py:data:`DETAILS_MAX` listed, the rest counted.

    Args:
        problems: ``{"location": [...], "message": ...}`` each.
        prefix: The message's first words.

    Returns:
        ApiError: The error, with ``argument`` when every problem is about one argument.
    """
    shown = problems[:DETAILS_MAX]
    parts = [f"{_where(d['location'])} {str(d['message']).rstrip('.')}" for d in shown]
    more = len(problems) - len(shown)
    if more:
        parts.append(f"and {more} more")
    return ApiError("invalid_request", f"{prefix}: {'; '.join(parts)}.", argument=_argument(problems), details=shown)


#: The deepest nesting of arrays and objects a request's body may have (a batch needs three: the object, the list of
#: identifiers, nothing deeper); deeper is refused before the body is parsed.
BODY_DEPTH_MAX = 32
_JSON_STRING = re.compile(r'"(?:[^"\\]|\\.)*"')


def _nesting_exceeds(text: str, limit: int) -> bool:
    """Whether a JSON text nests arrays and objects deeper than ``limit``, read in linear time (strings left out).

    The parser's own recursion is no bound: how deep it goes before it fails differs between Python's versions.
    """
    brackets = _JSON_STRING.sub("", text)
    opening = brackets.count("[") + brackets.count("{")
    if opening <= limit:
        return False
    depth = 0
    for character in brackets:
        if character in "[{":
            depth += 1
            if depth > limit:
                return True
        elif character in "]}":
            depth -= 1
    return False


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [k for k, _ in pairs]
    if len(set(keys)) != len(keys):
        repeated = sorted({k for k, n in collections.Counter(keys).items() if n > 1})
        msg = f"the keys {listed(repeated, DETAILS_MAX)} are given more than once in one object"
        raise ValueError(msg)
    return dict(pairs)


def _no_constant(name: str) -> Any:
    msg = f"{name} is not a JSON number"
    raise ValueError(msg)


def _check_media(content_type: str, content_encoding: str | None) -> None:
    """Refuse a body that is not uncompressed JSON in UTF-8 (``415 unsupported_media_type``)."""
    codings = [c.strip().lower() for c in (content_encoding or "").split(",") if c.strip()]
    if any(c != "identity" for c in codings):
        msg = "unsupported_media_type"
        raise ApiError(
            msg,
            f"The body is sent with `Content-Encoding: {content_encoding}`; this server reads bodies uncompressed "
            "only: send it without `Content-Encoding` (or as `identity`).",
        )
    kind, _, parameters = content_type.partition(";")
    if kind.strip().lower() != "application/json":
        msg = "unsupported_media_type"
        raise ApiError(
            msg,
            "The body must be JSON with the header `Content-Type: application/json`; got "
            f"{json.dumps(kind.strip().lower() or 'no type')}.",
        )
    for parameter in parameters.split(";"):
        name, _, value = parameter.partition("=")
        if name.strip().lower() == "charset" and value.strip().strip('"').lower() not in {"utf-8", "utf8"}:
            msg = "unsupported_media_type"
            raise ApiError(msg, f"JSON is UTF-8 (RFC 8259); the body declares charset={json.dumps(value.strip())}.")


def read_json_body(
    body: bytes, content_type: str, model: type[pydantic.BaseModel], content_encoding: str | None = None
) -> Any:
    """Read a request body as the api reads every body: UTF-8 JSON, strictly, into *model*; refuse with a 4xx else.

    The body is decoded as UTF-8 (RFC 8259; a declared other charset is ``415``), parsed without NaN or infinity, with
    no key given twice in one object, no number of more than 4,300 digits and no nesting deeper than Python's parser
    reads; an unknown key is refused before the model reads the rest (so that a body of many unknown keys costs no
    more than its parse), and the model's problems are listed (at most :py:data:`DETAILS_MAX`).

    Args:
        body: The bytes.
        content_type: The ``Content-Type`` header.
        model: The body's model.
        content_encoding: The ``Content-Encoding`` header (``None``: not sent); only ``identity`` is read.

    Returns:
        Any: The model's instance.

    Raises:
        ApiError: ``unsupported_media_type`` or ``invalid_request``.
    """
    _check_media(content_type, content_encoding)

    def refuse(message: str) -> ApiError:
        return ApiError(
            "invalid_request",
            f"The body is not valid: {message}.",
            details=[{"location": ["body"], "message": message}],
        )

    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as error:
        msg = f"it is not UTF-8 (byte {error.start} cannot be read)"
        raise refuse(msg) from None
    text = text.removeprefix("\ufeff")  # a byte order mark, which a parser may ignore (RFC 8259, 8.1)
    if _nesting_exceeds(text, BODY_DEPTH_MAX):
        msg = "it is nested more deeply than the server reads"
        raise refuse(msg)
    try:
        data = json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_no_constant)
    except json.JSONDecodeError as error:
        msg = f"it is not JSON ({error.msg} at character {error.pos})"
        raise refuse(msg) from None
    except RecursionError:
        msg = "it is nested more deeply than the server reads"
        raise refuse(msg) from None
    except ValueError as error:  # a key given twice, NaN or infinity, a number too long to read
        if str(error).startswith("Exceeds the limit"):  # Python's bound on the digits of an integer it reads
            msg = f"it holds a number of more than {sys.get_int_max_str_digits()} digits"
            raise refuse(msg) from None
        raise refuse(str(error)) from None
    if not isinstance(data, dict):
        msg = f"it must be a JSON object, not {_JSON_TYPES.get(type(data).__name__, 'that')}"
        raise refuse(msg)
    unknown = [k for k in data if k not in model.model_fields]
    if unknown:
        refusal = invalid_request_error(
            [{"location": ["body", k], "message": "is a key the body does not take"} for k in unknown],
            "The body is not valid",
        )
        refusal.message = f"{refusal.message[:-1]}; it takes {listed(list(model.model_fields))}."
        raise refusal
    try:
        return model.model_validate(data)
    except pydantic.ValidationError as error:
        raise invalid_request_error(_problems(error.errors(), ("body",)), "The body is not valid") from None


def create_app(  # noqa: PLR0915 - every endpoint, in one place
    settings: Settings, registry: Registry, monitor: LoadMonitor | None = None
) -> FastAPI:
    """Make the application over loaded graphs.

    Args:
        settings: The server's settings.
        registry: The loaded graphs.
        monitor: The load monitor shared with the outer layer (``None``: one of its own).

    Returns:
        FastAPI: The application without its outer layer (:py:func:`asgi_app` returns what a server runs).
    """
    slot = SearchSlot(queue_max=settings.queue_max)
    monitor = monitor or LoadMonitor(settings.workers)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # The limiter belongs to the event loop of this worker (made after the fork); so do its row of the load
        # table and its sampler.
        slot.reset()
        monitor.start_sampler()
        try:
            yield
        finally:
            monitor.stop_sampler()
            monitor.detach()

    app = FastAPI(
        title="idtrack web api",
        version=idtrack_web_api.__version__,
        summary="Gene identifiers through Ensembl releases, assemblies and external databases.",
        description=contract.DESCRIPTION,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=None,
        redoc_url=None,
        openapi_tags=[
            {"name": "conversion", "description": "Identifiers converted between releases and databases."},
            {"name": "names", "description": "Names of external databases and the genes they name."},
            {"name": "organisms", "description": "What each loaded graph holds."},
            {"name": "server", "description": "The server: health, load, versions, the meanings of codes, bounds."},
        ],
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.registry = registry
    app.state.slot = slot
    app.state.monitor = monitor
    version_body = _json_bytes(_version(registry, settings.docs_url, settings.analytics_id))
    vocabulary_body = _json_bytes(vocabulary(settings.docs_url))
    limits_body = _json_bytes(limits(settings))
    organisms_body = _json_bytes(
        {
            "organisms": [g.description for g in registry.graphs.values()],
            "names": [
                {"organism": organism, "aliases": list(organism_aliases(organism))} for organism in registry.graphs
            ],
        }
    )
    databases_bodies = {
        organism: _json_bytes({"organism": organism, **graph.graph.databases()})
        for organism, graph in registry.graphs.items()
    }
    graphs_load: list[dict[str, Any]] = [
        {"organism": g.organism, "file_bytes": g.entry.file.size} for g in registry.graphs.values()
    ]
    graphs_bytes = sum(g.entry.file.size for g in registry.graphs.values())
    status_cache: dict[str, Any] = {"at": -float("inf"), "body": b""}
    # The answers computed before the fork, once per graph (the workers inherit them).
    showcases = {organism: showcase.compute(graph, settings) for organism, graph in registry.graphs.items()}
    showcase_bodies = {organism: _json_bytes(body) for organism, body in showcases.items()}
    showcase_queries_bodies = {organism: _json_bytes(showcase.queries_of(body)) for organism, body in showcases.items()}
    lineage_tables = {
        organism: lineages.compute(graph, showcases.get(organism)) for organism, graph in registry.graphs.items()
    }
    del showcases
    history_bodies = {organism: _json_bytes(history.compute(graph)) for organism, graph in registry.graphs.items()}

    # ---------------------------------------------------------------------------------------------------------------
    # Errors

    def methods_at(path: str) -> list[str]:
        """Return the methods the api's routes take at a path (``HEAD`` with every ``GET``)."""
        found: list[str] = []
        scope = {"type": "http", "path": path, "method": "", "root_path": ""}
        for route in app.routes:
            if getattr(route, "name", "") == "frontend":
                continue
            match, _ = route.matches(scope)
            if match != Match.NONE:
                found += sorted(getattr(route, "methods", None) or ())
        if "GET" in found and "HEAD" not in found:
            found.append("HEAD")
        return list(dict.fromkeys(found))

    app.state.methods_at = methods_at

    reference = " The reference for people, with a console per endpoint: `/developers`." if settings.static_dir else ""

    def no_endpoint(path: str) -> ApiError:
        return ApiError(
            "not_found",
            f"There is no endpoint {path}. The api's endpoints are under {API_PREFIX}: `GET {API_PREFIX}` lists them "
            f"all, and `{API_PREFIX}/openapi.json` describes them.{reference}",
        )

    app.state.no_endpoint = no_endpoint

    def not_allowed(request: Request, methods: list[str]) -> ApiError:
        return ApiError(
            "method_not_allowed",
            f"{request.method} is not taken at {request.url.path}; it takes {', '.join(methods)}.",
            allowed=methods,
            headers={"Allow": ", ".join(methods)},
        )

    @app.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError) -> Response:
        return _error_response(request, error)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> Response:
        return _error_response(request, invalid_request_error(_problems(list(error.errors()))))

    @app.exception_handler(Exception)
    async def fault(request: Request, _error: Exception) -> Response:
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
        path = request.url.path
        if error.status_code == 405:
            methods = methods_at(path) if path.startswith("/api/") else ["GET", "HEAD"]
            if not methods:
                return _error_response(request, no_endpoint(path))
            return _error_response(request, not_allowed(request, methods))
        if error.status_code == 404:
            if path == "/api" or path.startswith("/api/"):
                return _error_response(request, no_endpoint(path))
            return _error_response(request, ApiError("not_found", f"There is nothing at {path}."))
        if 400 <= error.status_code < 500:
            return _error_response(request, ApiError("invalid_request", f"The request is not valid: {error.detail}."))
        log.error("Unexpected HTTP error %s in request %s", error.status_code, _request_id(request))
        return _error_response(
            request, ApiError("internal_error", f"Unexpected error; quote the request id {_request_id(request)}.")
        )

    # ---------------------------------------------------------------------------------------------------------------
    # Shared parts of the endpoints

    def only(*names: str) -> Callable[[Request], None]:
        allowed = frozenset(names)

        def check(request: Request) -> None:
            # Linear in the query's length, and refused before anything else reads it: an endpoint takes at most
            # seven parameters, so a query of more items than it takes is refused without counting them.
            keys = [k for k, _ in request.query_params.multi_items()]
            unknown = sorted({k for k in keys if k not in allowed})
            if unknown:
                takes = f"it takes {listed(sorted(allowed))}" if allowed else "it takes none"
                msg = "unknown_parameter"
                raise ApiError(
                    msg,
                    f"This endpoint does not take the query {'parameter' if len(unknown) == 1 else 'parameters'} "
                    f"{listed(unknown, DETAILS_MAX)}; {takes}.",
                    argument=unknown[0],
                    allowed=sorted(allowed),
                )
            repeated = sorted(k for k, n in collections.Counter(keys).items() if n > 1)
            if repeated:
                msg = "unknown_parameter"
                raise ApiError(
                    msg,
                    f"The query {'parameter' if len(repeated) == 1 else 'parameters'} {listed(repeated)} "
                    f"{'is' if len(repeated) == 1 else 'are'} given more than once; give each once.",
                    argument=repeated[0],
                    allowed=sorted(allowed),
                )
            utf8_query(request.scope.get("query_string", b""))

        return check

    def graph_of(
        organism: Annotated[
            str,
            PathParam(
                description=(
                    "The organism: its Ensembl production name (`homo_sapiens`), with spaces or in any letter case "
                    "(`Homo sapiens`), or a short name idtrack declares (`human`, `pig`); the names a server holds: "
                    "`names` of `GET /organisms`."
                ),
                max_length=100,
                examples=["homo_sapiens"],
            ),
        ],
    ) -> LoadedGraph:
        graph = registry.get(organism)
        if graph is None:
            msg = "unknown_organism"
            raise ApiError(
                msg,
                f"This server holds no graph of {organism!r}; it holds {listed(sorted(registry.graphs))} (their "
                "short names: `names` of `GET /api/v1/organisms`).",
                argument="organism",
                allowed=sorted(registry.graphs),
            )
        return graph

    graph_headers = {
        organism: {
            "Idtrack-Version": idtrack_version(),
            "Idtrack-Graph-Digest": str(graph.description.get("content_digest")),
        }
        for organism, graph in registry.graphs.items()
    }

    def answered(
        body: bytes, graph: LoadedGraph | None = None, media_type: str = "application/json", **headers: str
    ) -> Response:
        """An answer of bytes written already, with the graph's and idtrack's versions where it is a graph's."""
        extra = {**(graph_headers.get(graph.organism, {}) if graph is not None else {}), **headers}
        return Response(content=body, media_type=media_type, headers=extra or None)

    def json_body(data: Any, graph: LoadedGraph | None = None) -> Response:
        """An answer computed on the event loop (a table of the graph), within the answer's bound."""
        try:
            body = writing.json_bytes(data, settings.response_max_bytes)
        except writing.TooLargeError as error:
            raise too_large(error, advice_of()) from None
        return answered(body, graph)

    def memory(body: bytes, graph: LoadedGraph | None = None, **headers: str) -> Response:
        return answered(body, graph, **headers)

    def written(advice: tuple[str, str | None]) -> Callable[[Any], bytes]:
        """Write an answer as JSON on the search thread, within the answer's bound."""

        def write(data: Any) -> bytes:
            try:
                return writing.json_bytes(data, settings.response_max_bytes)
            except writing.TooLargeError as error:
                raise too_large(error, advice) from None

        return write

    def thread_full(state: dict[str, Any]) -> ApiError:
        """Return the refusal of a search this worker cannot queue for its search thread (its client's token back)."""
        state["capacity"] = True
        return ApiError(
            "server_busy",
            f"This worker has {slot.waiting} requests waiting for its search thread; retry in a few seconds.",
            headers={"Retry-After": "2"},
        )

    async def on_search_thread(request: Request, work: Callable[[float], Any], write: Callable[[Any], bytes]) -> bytes:
        """Run *work(deadline)* on this worker's search thread, then *write* its result there, waiting in a queue.

        A search that waited more than ``queue_seconds`` for a worker (in the queue the workers share, then for this
        worker's search thread) is answered ``503 server_busy`` without being searched; the request's time budget
        (``request_seconds``, the *deadline*) runs from when its search begins. The search and the writing of its
        answer are charged to the client as its search's time (``Server-Timing``: ``search`` and ``write``) and recorded
        in the mean time of recent searches (which estimates the wait of the next). A request whose client closed its
        connection is not searched: it is dropped where it waits, and a batch stops between its groups
        (``state["gone"]``, set by a watcher of the connection; a search already running finishes, since idtrack cannot
        be stopped mid-search). When it is done, the worker counts its search as ended (the process model then gives it
        the next search), even while the answer is still being sent.
        """
        state = request.scope["state"]
        if slot.waiting >= slot.queue_max:
            raise thread_full(state)
        timing: dict[str, float] = state.setdefault("timing", {})
        queued = time.monotonic()
        gone: threading.Event = state.setdefault("gone", threading.Event())

        async def watch() -> None:
            while True:
                message = await request.receive()
                if message["type"] == "http.disconnect":
                    gone.set()
                    return

        def timed() -> bytes:
            if gone.is_set():
                msg = "request_timeout"
                raise ApiError(msg, "The client closed its connection before its search began.")
            started = time.monotonic()
            # Waiting for this worker's search thread, and before for a worker free of searches (the hand-off queue).
            waited = started - queued + float(state.get("handed_off", 0.0))
            timing["queue"] = timing.get("queue", 0.0) + waited
            if waited > settings.queue_seconds:
                state["capacity"] = True
                raise service.waited_out(settings, waited)
            monitor.search_running(running=True)
            try:
                try:
                    result = work(started + settings.request_seconds)
                finally:
                    timing["search"] = timing.get("search", 0.0) + time.monotonic() - started
                began = time.monotonic()
                try:
                    return write(result)
                finally:
                    timing["write"] = timing.get("write", 0.0) + time.monotonic() - began
            finally:
                monitor.search_running(running=False)
                monitor.search_ended(time.monotonic() - started)

        slot.waiting += 1
        monitor.search_held(1)
        watcher = asyncio.get_running_loop().create_task(watch())
        try:
            return await anyio.to_thread.run_sync(timed, limiter=slot.limiter)
        finally:
            watcher.cancel()
            slot.waiting -= 1
            monitor.search_held(-1)
            connection = CONNECTION.get()
            if connection is not None:
                connection.release_search()

    responses = contract.responses
    explain_query = _boolean_query("Add the path of every candidate (`path`); it makes answers much larger.")
    allow_bridges_query = _boolean_query("Allow bridges through ids two genes share when history ends.")

    # ---------------------------------------------------------------------------------------------------------------
    # Endpoints

    @app.get(
        API_PREFIX,
        response_model=None,
        responses=responses("index", {"model": schemas.IndexResponse, "description": "The api's documents."}),
        tags=["server"],
        summary="Where everything is: the api's documents and every endpoint",
        operation_id="index",
        description=(
            "The entry point for a program that knows only the base address: the OpenAPI document, the texts for "
            "language models, the vocabulary and the bounds, and every endpoint by method, path and summary."
        ),
        dependencies=[Depends(only())],
    )
    async def index() -> Response:
        return memory(index_body["body"])

    @app.get(
        f"{API_PREFIX}/health",
        response_model=None,
        responses=responses("health", {"model": schemas.HealthResponse, "description": "The server is up."}),
        tags=["server"],
        summary="The server is up and holds its graphs (no allowance taken)",
        operation_id="health",
        description="The server is up and its graphs are loaded: the organisms it holds. For health checks.",
        dependencies=[Depends(only())],
    )
    async def health() -> Response:
        return Response(
            content=_json_bytes({"status": "ok", "organisms": list(registry.graphs)}),
            media_type="application/json",
            headers={"Cache-Control": "no-store"},
        )

    @app.get(
        STATUS_PATH,
        response_model=None,
        responses=responses("status", {"model": schemas.StatusResponse, "description": "The server's load."}),
        tags=["server"],
        summary="The server's load: CPU, memory and requests of every worker and the master",
        operation_id="status",
        description=(
            "The load of the whole server, measured by the server: the share of the cores used and the memory (RSS, "
            "PSS, USS) of the master and of every worker, the limit each is measured against and where that limit "
            "comes from, the connections and requests waiting, the latency of recent requests, and the workers that "
            "ended. Cached for about a second; a value that cannot be measured on this machine is `null` and named in "
            "`unavailable`."
        ),
        dependencies=[Depends(only())],
    )
    async def status() -> Response:
        now = time.monotonic()
        if now - status_cache["at"] >= CACHE_SECONDS:
            measured = monitor.snapshot()
            unavailable = measured.pop("unavailable")
            body = {**measured, "graphs": graphs_load, "graphs_file_bytes": graphs_bytes, "unavailable": unavailable}
            status_cache["body"] = _json_bytes(body)
            status_cache["at"] = now
        return memory(status_cache["body"], None, **{"Cache-Control": "no-store"})

    @app.get(
        f"{API_PREFIX}/version",
        response_model=None,
        responses=responses("version", {"model": schemas.VersionResponse, "description": "The versions."}),
        tags=["server"],
        summary="The versions of the api, idtrack and every loaded graph",
        operation_id="version",
        description=(
            "The versions of the api and of idtrack, idtrack's commit, the graph format, the manifest read, and per "
            "graph its file (key, SHA-256, size), content digest and build record. Quote it with any result you "
            "publish."
        ),
        dependencies=[Depends(only())],
    )
    async def version() -> Response:
        return memory(version_body)

    @app.get(
        f"{API_PREFIX}/vocabulary",
        response_model=None,
        responses=responses(
            "vocabulary", {"model": schemas.VocabularyResponse, "description": "The meanings of the codes."}
        ),
        tags=["server"],
        summary="What the codes of the answers mean: idtrack's own tables, the api's where idtrack has none",
        operation_id="vocabulary",
        description=(
            "What every code in an answer means: idtrack's own tables (statuses, reasons, step reasons, criteria, "
            "match steps and prefixes, reading reasons, place relations, bridge rules, the fields of a candidate) and, "
            "where idtrack has none, the api's own words (marked by `source`), and the api's error codes. Read it once "
            "and keep it (`ETag`)."
        ),
        dependencies=[Depends(only())],
    )
    async def vocabulary_endpoint() -> Response:
        return memory(vocabulary_body)

    @app.get(
        f"{API_PREFIX}/limits",
        response_model=None,
        responses=responses("limits", {"model": schemas.LimitsResponse, "description": "The bounds."}),
        tags=["server"],
        summary="The bounds this server enforces, as configured",
        operation_id="limits",
        description=(
            "The bounds this server enforces, as configured: identifiers per batch, characters per identifier, body "
            "and answer sizes, time and search budgets, and each client's allowances."
        ),
        dependencies=[Depends(only())],
    )
    async def limits_endpoint() -> Response:
        return memory(limits_body)

    @app.get(
        f"{API_PREFIX}/organisms",
        response_model=None,
        responses=responses("list_organisms", {"model": schemas.OrganismsResponse, "description": "The organisms."}),
        tags=["organisms"],
        summary="Every loaded organism and what its graph holds",
        operation_id="list_organisms",
        description=(
            "Every organism this server holds and what its graph holds (idtrack's `API.describe()`): releases, "
            "assemblies and the releases each serves, external databases, the build and its counts; and the names "
            "the path `{organism}` takes for each (`names`)."
        ),
        dependencies=[Depends(only())],
    )
    async def organisms() -> Response:
        return memory(organisms_body)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}",
        response_model=None,
        responses=responses(
            "describe_organism", {"model": schemas.GraphDescriptionModel, "description": "The organism's graph."}
        ),
        tags=["organisms"],
        summary="What one organism's graph holds: releases, assemblies, databases, its build",
        operation_id="describe_organism",
        description=(
            "One organism's graph: releases, assemblies and the releases each serves, databases, forms, the build and "
            "its counts."
        ),
        dependencies=[Depends(only())],
    )
    async def organism(graph: Annotated[LoadedGraph, Depends(graph_of)]) -> Response:
        return json_body(graph.description, graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/final-databases",
        response_model=None,
        responses=responses(
            "final_databases",
            {"model": schemas.FinalDatabasesResponse, "description": "The databases at that release."},
        ),
        tags=["organisms"],
        summary="The databases a conversion to a release can end in",
        operation_id="final_databases",
        description=(
            "The databases a conversion to one release can end in (idtrack's `API.final_databases(to_release)`): the "
            "values `final_database` takes for that release. What each holds (an accession, a label, an Ensembl id "
            "with or without version): `GET /organisms/{organism}/databases`."
        ),
        dependencies=[Depends(only("to_release"))],
    )
    async def final_databases(
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        to_release: _release_query("The target release; omitted: the snapshot release.") = None,  # type: ignore[valid-type]
    ) -> Response:
        databases = service.final_databases(graph, to_release)
        release = graph.graph.identity().snapshot_release if to_release is None else to_release
        return json_body({"organism": graph.organism, "to_release": release, "final_databases": databases}, graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/databases",
        response_model=None,
        responses=responses("databases_by_release", {"model": schemas.DatabasesResponse, "description": "The matrix."}),
        tags=["organisms"],
        summary="What a conversion to each release can end in: a release-by-database matrix, and each assembly's",
        operation_id="databases_by_release",
        description=(
            "For every release of the graph, the databases a conversion to it can end in (a release-by-database "
            "matrix: one row per database with the releases it is available at), what each database holds (`kind`: "
            "an Ensembl gene id with or without version, an accession, or a label such as a symbol; the database of "
            "an accession database's labels; the names Ensembl gave it before), and per assembly its external "
            "databases."
        ),
        dependencies=[Depends(only())],
    )
    async def databases(graph: Annotated[LoadedGraph, Depends(graph_of)]) -> Response:
        return memory(databases_bodies[graph.organism], graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/showcase",
        response_model=None,
        responses=responses(
            "showcase", {"model": schemas.ShowcaseResponse, "description": "The showcase of the organism's graph."}
        ),
        tags=["organisms"],
        summary="Chosen conversions of one graph, answered once when the server started: the home page's figures",
        operation_id="showcase",
        description=(
            "Conversions chosen to show the kinds of journey idtrack follows (the journeys) and the phenomena of "
            "Ensembl's history (the cases, each with the kind it shows), each answered with `explain=true` exactly as "
            "`GET .../convert` answers it, computed once per graph when the server started. The cases are given only "
            "where the graph is the one they were checked on (`checked_on`, a content digest); an organism without "
            "chosen conversions has empty lists."
        ),
        dependencies=[Depends(only())],
    )
    async def showcase_endpoint(graph: Annotated[LoadedGraph, Depends(graph_of)]) -> Response:
        return memory(showcase_bodies[graph.organism], graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/showcase/queries",
        response_model=None,
        responses=responses(
            "showcase_queries",
            {"model": schemas.ShowcaseQueriesResponse, "description": "The showcase's queries, without the answers."},
        ),
        tags=["organisms"],
        summary="The showcase's chosen conversions without their answers: each query, and each case's kind",
        operation_id="showcase_queries",
        description=(
            "The conversions of `GET .../showcase` without their answers: each journey's query and each case's query "
            "and kind, the cases given exactly where the showcase gives them. For a page that needs to know which "
            "conversions are cases (to offer the tour of them) without fetching every answer."
        ),
        dependencies=[Depends(only())],
    )
    async def showcase_queries_endpoint(graph: Annotated[LoadedGraph, Depends(graph_of)]) -> Response:
        return memory(showcase_queries_bodies[graph.organism], graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/history",
        response_model=None,
        responses=responses(
            "history", {"model": schemas.HistoryResponse, "description": "Ensembl's gene id history, per release."}
        ),
        tags=["organisms"],
        summary="Ensembl's gene id history in the graph: genes active per release, history edges per transition",
        operation_id="history",
        description=(
            "Ensembl's stable id history of genes as the graph holds it, counted from idtrack's graph (its history "
            "edges and the releases at which each gene version is active): per release the gene ids active and those "
            "created, per pair of releases the history edges by kind of plain fact and the fan of Ensembl's mapping "
            "(versions with two or more distinct later ends, or earlier ends). No event is classified by "
            "idtrack's rules here (a split or a merge is a property of a path; see `PathStep.reason`). Computed once "
            "per graph when the server started."
        ),
        dependencies=[Depends(only())],
    )
    async def history_endpoint(graph: Annotated[LoadedGraph, Depends(graph_of)]) -> Response:
        return memory(history_bodies[graph.organism], graph)

    @functools.lru_cache(maxsize=16)
    def lineage_bytes(organism: str, limit: int) -> bytes:
        return _json_bytes(lineages.body(lineage_tables[organism], limit))

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/lineages",
        response_model=None,
        responses=responses(
            "lineages",
            {"model": schemas.LineagesResponse, "description": "The lineages of gene ids, whole families at a time."},
        ),
        tags=["organisms"],
        summary="The lineages of gene ids in the graph: active releases, new versions, edges to other ids",
        operation_id="lineages",
        description=(
            "The lineages of the graph's gene ids as Ensembl's stable id history gives them, read from idtrack's "
            "graph: per id the releases at which it is active and those at which a new version of it begins, and the "
            "history edges between ids with their releases and Ensembl's scores. Ids joined by such edges form a "
            "family, given whole: first the families of the genes the showcase's answers name, then the others in "
            "a fixed order (the digest of each one's smallest id), until `limit` ids. No event is classified by "
            "idtrack's rules here (a split or a merge is a property of a path; see `PathStep.reason`). Read once per "
            "graph when the server started; the home page draws them."
        ),
        dependencies=[Depends(only("limit"))],
    )
    async def lineages_endpoint(
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        limit: Annotated[
            int,
            Query(
                ge=1,
                le=lineages.LIMIT_MAX,
                description=(
                    f"The most gene ids to give, from 1 to {lineages.LIMIT_MAX}; omitted: {lineages.DEFAULT_LIMIT}. "
                    "A family is given whole or not at all."
                ),
            ),
        ] = lineages.DEFAULT_LIMIT,
    ) -> Response:
        return memory(lineage_bytes(graph.organism, limit), graph)

    from_release_query = _release_query(f"The release it is read at; omitted: inferred. {schemas.FROM_RELEASE_RULE}")
    to_release_query = _release_query("The target release; omitted: the snapshot release.")

    def database_query(text: str, examples: list[str] | None = None) -> Any:
        return Annotated[
            str | None,
            Query(
                description=text,
                examples=examples,
                json_schema_extra={"minLength": 1, "maxLength": schemas.DATABASE_MAX_LENGTH},
            ),
        ]

    final_database_query = database_query(
        "The database of the targets; omitted: `ensembl_gene`. The values a release takes: "
        "`GET /organisms/{organism}/final-databases?to_release=`; what each holds: `kind` of "
        "`GET /organisms/{organism}/databases` (NCBI's gene numbers are `EntrezGene`, its symbols `NCBI gene "
        "(formerly Entrezgene)`).",
        ["HGNC Symbol", "RefSeq_mRNA"],
    )
    from_database_query = database_query(
        "The database the identifier is meant in; omitted: any. The values: `external_databases` of "
        "`GET /organisms/{organism}` (a database's synonyms are read under its name). An identifier that is not an id "
        "of the database named is read as absent from it (`no_conversion` with `no_gene_at_start`, or `not_found`), "
        "not as retired; some databases come in two forms, accessions and their labels (`RefSeq_peptide` and "
        "`RefSeq peptide`: `kind` of `GET /organisms/{organism}/databases`)."
    )
    identifier_query = Annotated[
        str,
        Query(
            description=(
                "An Ensembl id (with or without version), a symbol or another id of a database the graph holds "
                "(`external_databases` of `GET /organisms/{organism}`). White space at its ends is no part of it. Ids "
                "of databases the graph does not hold are `not_found`: the name authorities' own ids (`HGNC:11998`), "
                "UniProt's secondary accessions, entry names and isoforms, RNAcentral, microarray probe sets "
                "(`201746_at`)."
            ),
            examples=["TP53", "ENSG00000141510.5", "NM_000546"],
        ),
    ]

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/convert",
        response_model=None,
        responses=responses(
            "convert",
            {
                "model": schemas.ConversionResultModel,
                "description": "The result: idtrack's `ConversionResult.to_dict()`.",
            },
        ),
        tags=["conversion"],
        summary="Convert one identifier: every candidate ranked, the best marked, optionally its path",
        operation_id="convert",
        description=(
            "Convert one identifier (idtrack's `API.convert`): how the string was read, every candidate the search "
            "reached, ranked, the best marked, the criterion that decided between the best and the runner-up, the "
            "reason of a result without answer, and with `explain=true` the path of every candidate as a graph of "
            "nodes and steps. An identifier not in the graph is not an error: it is a result with status `not_found`. "
            "Only `converted` and `tie` answer in the requested database: for `no_target`, `final_database` is "
            "`ensembl_gene` and the best candidates are the genes reached, standing in for the missing id."
        ),
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
        identifier: identifier_query,
        from_release: from_release_query = None,  # type: ignore[valid-type]
        to_release: to_release_query = None,  # type: ignore[valid-type]
        final_database: final_database_query = None,  # type: ignore[valid-type]
        from_database: from_database_query = None,  # type: ignore[valid-type]
        *,
        explain: explain_query = False,  # type: ignore[valid-type]
        allow_bridges: allow_bridges_query = True,  # type: ignore[valid-type]
    ) -> Response:
        service.require_text(identifier, "identifier", settings)
        conversion = service.conversion_arguments(
            from_release, to_release, final_database, from_database, explain=explain, allow_bridges=allow_bridges
        )
        body = await on_search_thread(
            request,
            lambda deadline: service.convert_one(graph, identifier, conversion, settings, deadline),
            written(advice_of(explain=explain)),
        )
        return answered(body, graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/convert/each-database",
        response_model=None,
        responses=responses(
            "convert_each_database",
            {"model": schemas.EachDatabaseResponse, "description": "One conversion per database."},
        ),
        tags=["conversion"],
        summary="Convert one identifier into every database a conversion to the target release can end in",
        operation_id="convert_each_database",
        description=(
            "Convert one identifier into each database of `GET .../final-databases?to_release=`, in that order: each "
            "conversion exactly as `GET .../convert` answers it with that `final_database` (without `explain`), so "
            "that which databases hold an answer for it, and which, is one request. It is as many searches as there "
            "are databases (about 20), each charged to the client's search time."
        ),
        dependencies=[Depends(only("identifier", "from_release", "to_release", "from_database", "allow_bridges"))],
    )
    async def convert_each_database(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        identifier: identifier_query,
        from_release: from_release_query = None,  # type: ignore[valid-type]
        to_release: to_release_query = None,  # type: ignore[valid-type]
        from_database: from_database_query = None,  # type: ignore[valid-type]
        *,
        allow_bridges: allow_bridges_query = True,  # type: ignore[valid-type]
    ) -> Response:
        service.require_text(identifier, "identifier", settings)
        conversion = service.conversion_arguments(
            from_release, to_release, None, from_database, explain=False, allow_bridges=allow_bridges
        )

        arguments = {
            "identifier": identifier,
            "from_release": from_release,
            "to_release": to_release,
            "from_database": from_database,
            "allow_bridges": allow_bridges,
        }

        def work(deadline: float) -> dict[str, Any]:
            release, conversions = service.convert_each_database(graph, identifier, conversion, settings, deadline)
            return {
                "organism": graph.organism,
                "arguments": arguments,
                "to_release": release,
                "conversions": conversions,
            }

        body = await on_search_thread(request, work, written(advice_of()))
        return answered(body, graph)

    @app.post(
        f"{API_PREFIX}/organisms/{{organism}}/convert/batch",
        response_model=None,
        responses=responses(
            "convert_batch",
            {
                "model": schemas.BatchResponse,
                "content": {"text/tab-separated-values": contract.tsv_content()},
                "description": (
                    "JSON (`format=json`), or a table with one row per candidate (`format=tsv`; its columns and how "
                    "each is written: the description of `text/tab-separated-values`)."
                ),
                "headers": {
                    "Content-Disposition": {
                        "description": (
                            "With `format=tsv`: `attachment; "
                            "filename=\"idtrack_<organism>_<to_release>_<the first 12 characters of the graph's "
                            'digest>.tsv"` (a file to save, named after what produced it).'
                        ),
                        "schema": {"type": "string"},
                    }
                },
            },
        ),
        tags=["conversion"],
        summary="Convert a batch with the same arguments; results in input order, each with its own status",
        operation_id="convert_batch",
        description=(
            "Convert many identifiers at once (idtrack's `API.convert_many`): one result per identifier in input "
            'order, each with its own status. An identifier whose conversion fails is that item\'s `status: "error"` '
            "with `error.code`, and the batch goes on; an identifier the api refuses at its boundary (too long, "
            "control characters inside it) refuses the whole batch (`400 invalid_identifier`, every such index in "
            "`details`). With `read_copies` (the default) an item can be answered as the copy of another item of the "
            "same batch. `format=tsv` gives one row per candidate. Prefer it to many single calls."
        ),
        dependencies=[Depends(only("format", "provenance"))],
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/BatchRequest"}}},
            }
        },
    )
    async def convert_batch(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        answer_format: Annotated[
            Literal["json", "tsv"],
            Query(
                alias="format",
                description=(
                    "`json` (default) or `tsv`: a table with one row per candidate, one for a result without "
                    "candidates (its columns: the description of the `200` answer's `text/tab-separated-values`)."
                ),
            ),
        ] = "json",
        *,
        provenance: _boolean_query(  # type: ignore[valid-type]
            "With `format=tsv`: write one line before the header, beginning with `#`, that names the api's and "
            "idtrack's versions, the organism, the graph's content digest, the arguments and the request's id, so a "
            "saved table stays tied to what produced it (a reader of the table skips it as a comment). Not taken "
            "with `format=json`, whose answer and headers carry the same."
        ) = False,
    ) -> Response:
        if provenance and answer_format != "tsv":
            msg = "invalid_argument"
            raise ApiError(
                msg,
                "`provenance=true` writes a line of the table (`format=tsv`); a JSON answer names the organism and the "
                "arguments itself, and its headers the versions and the graph's digest.",
                argument="provenance",
            )
        body: schemas.BatchRequest = read_json_body(
            await request.body(),
            request.headers.get("content-type", ""),
            schemas.BatchRequest,
            request.headers.get("content-encoding"),
        )
        identifiers = checked_identifiers(body.identifiers)
        conversion = service.conversion_arguments(
            body.from_release,
            body.to_release,
            body.final_database,
            body.from_database,
            explain=body.explain,
            allow_bridges=body.allow_bridges,
        )
        advice = advice_of(identifiers=len(identifiers), explain=body.explain)

        def work(deadline: float) -> list[dict[str, Any]]:
            return service.convert_batch(
                graph,
                identifiers,
                conversion,
                settings,
                deadline,
                read_copies=body.read_copies,
                abandoned=request.scope["state"]["gone"].is_set,
            )

        arguments = body.model_dump(exclude={"identifiers"})
        if answer_format == "tsv":
            identity = graph.graph.identity()
            target = identity.snapshot_release if body.to_release is None else body.to_release
            digest = identity.content_digest or "none"
            head: list[str] = []
            if provenance:
                written_args = ", ".join(f"{k} {json.dumps(v)}" for k, v in arguments.items())
                head.append(
                    f"# idtrack-web {idtrack_web_api.__version__}, idtrack {idtrack_version()}, organism "
                    f"{graph.organism}, graph {digest}, {written_args}, request {_request_id(request)}\n"
                )

            def table(results: list[dict[str, Any]]) -> bytes:
                try:
                    return writing.lines_bytes([*head, *tsv.lines(results)], settings.response_max_bytes)
                except writing.TooLargeError as error:
                    raise too_large(error, advice) from None

            text = await on_search_thread(request, work, table)
            name = f"idtrack_{graph.organism}_{target}_{digest[:12]}.tsv"
            return answered(
                text,
                graph,
                media_type="text/tab-separated-values; charset=utf-8",
                **{"Content-Disposition": f'attachment; filename="{name}"'},
            )
        write = written(advice)
        data = await on_search_thread(
            request,
            work,
            lambda results: write(
                {"organism": graph.organism, "arguments": arguments, "count": len(results), "results": results}
            ),
        )
        return answered(data, graph)

    def checked_identifiers(identifiers: list[str]) -> list[str]:
        """Refuse a list of identifiers over the batch's bound, or holding one the api cannot pass on."""
        if len(identifiers) > settings.batch_max:
            msg = "too_many_identifiers"
            raise ApiError(
                msg,
                f"The list has {len(identifiers)} identifiers; this server takes at most {settings.batch_max} per "
                "request.",
                argument="identifiers",
            )
        problems = [
            {"location": ["body", "identifiers", i], "message": problem}
            for i, text in enumerate(identifiers)
            if (problem := service.check_text(text, "identifiers", settings, ["identifiers", i])) is not None
        ]
        if problems:
            count = len(problems)
            shown = [str(p["message"]) for p in problems[:5]] + ([f"and {count - 5} more"] if count > 5 else [])
            msg = "invalid_identifier"
            raise ApiError(
                msg,
                f"{count} {'identifier' if count == 1 else 'identifiers'} cannot be passed on, so the request is "
                f"refused (remove or correct them and send it again): {'; '.join(shown)}.",
                argument="identifiers",
                details=problems[:DETAILS_MAX],
            )
        return identifiers

    @app.post(
        f"{API_PREFIX}/organisms/{{organism}}/source-inference",
        response_model=None,
        responses=responses(
            "source_inference",
            {"model": schemas.SourceInferenceResponse, "description": "Where the list comes from."},
        ),
        tags=["conversion"],
        summary="Where a list of identifiers comes from: the releases, assemblies or databases it fits",
        operation_id="source_inference",
        description=(
            "Infer where a list of identifiers comes from (idtrack's `API.source_inference`): each distinct "
            "identifier counts once at every origin (release, assembly, database, by `mode`) at which it is an "
            "identifier, read as it was at that release; the best origin is the one where most are found, and the "
            "band holds the origins the list cannot tell apart from it (a one-sided sign test at idtrack's level "
            "0.05). For a list from a paper, ask this first, then convert the list with the band's best release as "
            "`from_release`, so each name is read as it was then. Refused with `unknown_identifier` when none of the "
            "identifiers is in the graph."
        ),
        dependencies=[Depends(only())],
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SourceInferenceRequest"}}},
            }
        },
    )
    async def source_inference(request: Request, graph: Annotated[LoadedGraph, Depends(graph_of)]) -> Response:
        body: schemas.SourceInferenceRequest = read_json_body(
            await request.body(),
            request.headers.get("content-type", ""),
            schemas.SourceInferenceRequest,
            request.headers.get("content-encoding"),
        )
        identifiers = checked_identifiers(body.identifiers)

        def work(_deadline: float) -> dict[str, Any]:
            inference = service.source_inference(graph, identifiers, body.mode)
            best = service.named_origin(inference["band"][0], body.mode) if inference["band"] else None
            return {
                "organism": graph.organism,
                "mode": body.mode,
                "best": best,
                "from_release": None if best is None else best["release"],
                "inference": inference,
            }

        body_bytes = await on_search_thread(request, work, written(advice_of(identifiers=len(identifiers))))
        return answered(body_bytes, graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/genes-named",
        response_model=None,
        responses=responses("genes_named", {"model": schemas.NamesResponse, "description": "The matches."}),
        tags=["names"],
        summary="The genes a name of an external database names, per database and release",
        operation_id="genes_named",
        description=(
            "The genes a name of an external database names (a symbol, a synonym, an accession), per database and the "
            "releases at which each holds (idtrack's `API.genes_named`, each match listing its `releases`). With "
            "`release`, only the matches that hold at that release (what the name means there; to convert it as it "
            "was then: `GET .../convert` with `from_release` and `to_release` that release)."
        ),
        dependencies=[Depends(only("name", "fold_case", "release"))],
    )
    async def genes_named(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        name: Annotated[
            str,
            Query(
                description="The name as written (e.g. a symbol); white space at its ends is no part of it.",
                examples=["TP53"],
            ),
        ],
        *,
        fold_case: _boolean_query("Match without letter case.") = False,  # type: ignore[valid-type]
        release: _release_query(  # type: ignore[valid-type]
            "Only the matches that hold at this release (whose `releases` hold it); omitted: every match."
        ) = None,
    ) -> Response:
        service.require_text(name, "name", settings)
        if not name.strip():
            msg = "missing_value"
            raise ApiError(msg, "`name` is empty; send the name to look up, such as `TP53`.", argument="name")
        arguments = {"name": name, "fold_case": fold_case, "release": release}
        body = await on_search_thread(
            request,
            lambda _deadline: {
                "organism": graph.organism,
                "arguments": arguments,
                "matches": service.genes_named(graph, name, fold_case=fold_case, release=release),
            },
            written(advice_of()),
        )
        return answered(body, graph)

    @app.get(
        f"{API_PREFIX}/organisms/{{organism}}/names-of",
        response_model=None,
        responses=responses("names_of", {"model": schemas.NamesResponse, "description": "The matches."}),
        tags=["names"],
        summary="The names external databases give a gene, per database and release",
        operation_id="names_of",
        description=(
            "The names external databases give one gene, per database and the releases at which each holds (idtrack's "
            "`API.names_of`). The gene is an Ensembl gene id with version; an id without version is refused with "
            "`invalid_argument`, its versions in `allowed`."
        ),
        dependencies=[Depends(only("gene", "release"))],
    )
    async def names_of(
        request: Request,
        graph: Annotated[LoadedGraph, Depends(graph_of)],
        gene: Annotated[
            str,
            Query(
                description=(
                    "An Ensembl gene id with version (e.g. `ENSG00000141510.20`); the versions of an id: "
                    "`known_versions` or the candidates of `GET .../convert`."
                ),
                examples=["ENSG00000141510.20"],
            ),
        ],
        release: _release_query(  # type: ignore[valid-type]
            "Only names that hold at this release; omitted: every release, each match listing its `releases`."
        ) = None,
    ) -> Response:
        service.require_text(gene, "gene", settings)
        body = await on_search_thread(
            request,
            lambda _deadline: {
                "organism": graph.organism,
                "arguments": {"gene": gene, "release": release},
                "matches": service.names_of(graph, gene, release),
            },
            written(advice_of()),
        )
        return answered(body, graph)

    def base_url(request: Request) -> str:
        """The site's address for absolute links: ``public_url``, else the request's, if its host is a plain name."""
        if settings.public_url:
            return settings.public_url
        host = request.headers.get("host", "")
        if not _HOST.fullmatch(host):
            return ""  # links relative to the site, rather than to a host the request named oddly
        return f"{request.url.scheme}://{host}"

    texts: dict[tuple[str, str], tuple[bytes, bytes, str]] = {}

    held = [
        {
            "organism": organism,
            "aliases": list(organism_aliases(organism)),
            "releases": list(graph.description.get("releases", [])),
        }
        for organism, graph in registry.graphs.items()
    ]

    def text_answer(request: Request, kind: str, make: Callable[..., str]) -> Response:
        """A text for programs: made once per site address, compressed for a client that accepts it, revalidated."""
        base = base_url(request)
        found = texts.get((kind, base))
        if found is None:
            body = make(base, openapi(), held).replace(DOCS_URL, settings.docs_url).encode("utf-8")
            found = (
                body,
                gzip.compress(body, compresslevel=9, mtime=0),
                hashlib.blake2b(body, digest_size=16).hexdigest(),
            )
            if len(texts) < 16:
                texts[(kind, base)] = found
        body, packed, digest = found
        coded = accepts_gzip(request.headers.get("accept-encoding"))
        etag = f'"{digest}-gzip"' if coded else f'"{digest}"'
        headers = {"Cache-Control": "no-cache", "ETag": etag, "Vary": "Accept-Encoding"}
        wanted = request.headers.get("if-none-match")
        if wanted is not None and any(
            t.strip() == "*" or t.strip().removeprefix("W/").strip('"').removesuffix("-gzip") == digest
            for t in wanted.split(",")
        ):
            return Response(status_code=304, headers=headers)
        if coded:
            headers["Content-Encoding"] = "gzip"
        return Response(content=packed if coded else body, media_type="text/markdown; charset=utf-8", headers=headers)

    @app.get("/llms.txt", include_in_schema=False)
    async def llms_txt(request: Request) -> Response:
        return text_answer(request, "llms", docs.llms_txt)

    @app.get("/llms-full.txt", include_in_schema=False)
    async def llms_full_txt(request: Request) -> Response:
        return text_answer(request, "llms-full", docs.llms_full_txt)

    def openapi() -> dict[str, Any]:
        """The document, completed by :py:func:`idtrack_web_api.contract.complete` (enums, examples, headers)."""
        if app.openapi_schema is None:
            from fastapi.openapi.utils import get_openapi

            document = get_openapi(
                title=app.title, version=app.version, summary=app.summary, description=app.description,
                routes=app.routes, tags=app.openapi_tags,
            )  # fmt: skip
            app.openapi_schema = contract.complete(document)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]
    index_body = {"body": _json_bytes(contract.index(openapi(), page=settings.static_dir is not None))}

    if settings.static_dir is not None:
        preload = {
            f"{API_PREFIX}/organisms": organisms_body,
            f"{API_PREFIX}/version": version_body,
            f"{API_PREFIX}/vocabulary": vocabulary_body,
            f"{API_PREFIX}/limits": limits_body,
        }
        _serve_frontend(
            app,
            settings.static_dir,
            methods_at,
            not_allowed,
            lambda name: registry.get(name) is not None,
            preload,
            analytics=settings.analytics_id is not None,
        )
    return app


def _serve_frontend(
    app: FastAPI,
    root: Path,
    methods_at: Callable[[str], list[str]],
    not_allowed: Callable[..., ApiError],
    holds: Callable[[str], bool] = lambda _name: True,
    preload: dict[str, bytes] | None = None,
    *,
    analytics: bool = False,
) -> None:
    """Serve the built frontend: its files, and ``index.html`` for every other path without a file extension.

    Text files go compressed to clients that accept gzip, the content-hashed files under ``assets/`` are cached as
    immutable and every other file is revalidated (:py:mod:`idtrack_web_api.frontend`). A path of the page's routes
    gets ``index.html`` with ``200``; any other path without a file extension gets it with ``404`` (the page says
    so), so that the status tells crawlers and link checkers the truth; so does the page of an organism the server does
    not hold (``/organisms/<name>``: ``404``). Every path under ``/api`` that is no endpoint
    is a JSON ``404`` (``405`` with ``Allow`` where the path takes other methods).
    """
    files = Frontend(root, preload, analytics=analytics)
    app.state.frontend = files

    @app.get("/{path:path}", include_in_schema=False, name="frontend")
    async def frontend(request: Request, path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            methods = methods_at(f"/{path}")
            if methods:
                raise not_allowed(request, methods)
            msg = f"/{path}"
            raise app.state.no_endpoint(msg)
        target = files.file(path)
        if target is not None:
            return files.answer(target, request.headers)
        if "." not in Path(path).name and files.index.is_file():
            page = files.is_page(f"/{path}")
            organism = ORGANISM_PAGE.match(f"/{path}")
            if organism is not None and not holds(organism.group(1)):
                page = False  # the page of a graph this server does not hold: the page says so, the status too
            frame = frame_of(f"/{path}", has_identifier="id" in request.query_params) if page else "none"
            return files.answer(files.index, request.headers, status=200 if page else 404, frame=frame)
        msg = "not_found"
        raise ApiError(msg, f"There is no file /{path}.")


#: The fields of ``/limits`` that are per-client allowances (:py:mod:`idtrack_web_api.limits`), applied only where
#: ``rate_per_minute`` is above 0; every other bound holds on every server.
ALLOWANCE_FIELDS: tuple[str, ...] = (
    "rate_per_minute",
    "rate_burst",
    "read_share",
    "rate_search_seconds",
    "rate_search_burst_seconds",
    "rate_concurrent_searches",
)


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
        "queue_seconds": float(settings.queue_seconds),
        "search_seconds": float(settings.search_seconds),
        "search_states": settings.search_states,
        "rate_per_minute": settings.rate_per_minute,
        "rate_burst": settings.rate_burst,
        "read_share": READ_SHARE,
        "rate_search_seconds": float(settings.rate_search_seconds),
        "rate_search_burst_seconds": float(settings.rate_search_burst_seconds),
        "queue_max": settings.queue_max,
        "head_seconds": float(settings.head_seconds),
        "body_seconds": float(settings.body_seconds),
        "answer_cache_bytes": settings.answer_cache_bytes,
        "allowances_enforced": settings.rate_per_minute > 0,
        "allowance_fields": list(ALLOWANCE_FIELDS),
        "rate_concurrent_searches": settings.rate_concurrent_searches,
        "send_seconds": float(settings.send_seconds),
        "send_min_bytes_per_second": SEND_MIN_RATE,
        "sending_max_bytes": settings.sending_max_bytes,
    }


def _version(registry: Registry, docs_url: str = DOCS_URL, analytics_id: str | None = None) -> dict[str, Any]:
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
                **_package_version(identity.package_version),
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
        "docs_url": docs_url,
        "analytics_id": analytics_id,
    }


def _package_version(recorded: str | None) -> dict[str, str | None]:
    """Return a build record's idtrack version as a version, or its text where the record holds no version."""
    if recorded is None or _VERSION.match(recorded):
        return {"package_version": recorded, "package_version_note": None}
    return {"package_version": None, "package_version_note": recorded}


def server_identity(registry: Registry) -> str:
    """Return what every ``ETag`` of a server includes: its start (made once, before the fork), versions and graphs.

    Args:
        registry: The loaded graphs.

    Returns:
        str: A digest; a new one at every start, so that no answer of an earlier start is taken for the current one.
    """
    text = json.dumps([time.time_ns(), _version(registry)], sort_keys=True, default=str)
    return hashlib.blake2b(text.encode(), digest_size=16).hexdigest()


def asgi_app(settings: Settings, registry: Registry, monitor: LoadMonitor | None = None) -> ASGIApp:
    """Return what a server runs: the application inside its outer layer.

    The allowances' table and the load monitor's are made here, in the process that later forks the workers, so the
    workers share them; so are the answers computed once per graph (the showcase, the history).

    Args:
        settings: The server's settings.
        registry: The loaded graphs.
        monitor: The load monitor (``None``: one over the system's ``/proc``).

    Returns:
        ASGIApp: The application.
    """
    limiter = RateLimiter(
        settings.rate_per_minute,
        settings.rate_burst,
        settings.rate_search_seconds,
        settings.rate_search_burst_seconds,
        concurrent_searches=settings.rate_concurrent_searches,
    )
    monitor = monitor or LoadMonitor(settings.workers)
    app = create_app(settings, registry, monitor)
    frontend: Frontend | None = getattr(app.state, "frontend", None)
    page = frontend.policy if frontend is not None else None
    return Guard(
        app, settings, limiter, monitor, identity=server_identity(registry), page=page, methods=app.state.methods_at
    )


__all__ = ["API_PREFIX", "STATUS_PATH", "Guard", "asgi_app", "create_app", "limits", "read_json_body"]
