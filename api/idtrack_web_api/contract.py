"""The api's contract as a program reads it: what the OpenAPI document holds beyond what FastAPI writes.

FastAPI writes the endpoints, parameters and schemas; :py:func:`complete` adds, from the api's own tables, what a
client needs to use the api from the document alone:

- **closed sets as enumerations**, each with its meanings (``x-enum-descriptions``, in the order of ``enum``), from the
  same tables as ``/vocabulary`` (``tests/test_openapi.py`` compares them): the statuses, reasons, step reasons,
  criteria, reading reasons, place relations, bridge rules, the error codes; a match (prefixes, then a step) as a
  pattern with both tables;
- **the error codes each endpoint can answer** (:py:data:`ENDPOINT_ERRORS`), per status, in each response's text and as
  ``x-error-codes``, with the code's ``enum`` narrowed to them;
- **the headers** every answer carries (``X-Request-ID``, ``Server-Timing``), those of a ``GET`` of the api that is
  kept (``ETag``, ``Cache-Control``) and those of a refusal to retry (``Retry-After``);
- **examples**: real answers of this api over the human graph of Ensembl 115 (``examples.json``, written by
  ``scripts/record_examples.py``; ``tests/test_real.py`` checks them against the graph where it is present), every one
  checked against its schema;
- ``servers``, ``license`` and ``externalDocs``; the batch's request body (read by the api's own strict reader).
"""

from __future__ import annotations

import copy
import json
import re
from importlib import resources
from typing import Any

from idtrack_web_api import schemas
from idtrack_web_api.adapter import (
    BRIDGE_RULES,
    CRITERIA,
    MATCH_PREFIXES,
    MATCH_STEPS,
    PLACE_RELATIONS,
    READING_REASONS,
    REASONS,
    STATUSES,
    STEP_REASONS,
)
from idtrack_web_api.cautions import CAUTIONS
from idtrack_web_api.errors import CODES, RETRYABLE, TITLES
from idtrack_web_api.vocabulary import STATUS_MEANINGS

DESCRIPTION = (
    "Converts gene identifiers (Ensembl gene, transcript and protein ids, symbols, other databases' ids) between "
    "Ensembl releases, genome assemblies and databases, within one organism at a time, with idtrack: every answer is "
    "idtrack's own record, with the path that led to it."
)

#: Codes every endpoint can answer: a path and query too long, an unknown or repeated query parameter, a wrong method at
#: its path, a fault.
_EVERY = ("unknown_parameter", "uri_too_long", "method_not_allowed", "internal_error")
#: Codes of an endpoint that reads from memory: its allowance of reads.
_READ = (*_EVERY, "rate_limited")
#: Codes of every searching request: its allowances, the queue of searches, the client gone before its search, the
#: request's time budget, the answer's bound, a malformed parameter, an identifier or name the api cannot pass on.
_SEARCH = (
    *_READ,
    "unknown_organism",
    "invalid_request",
    "invalid_identifier",
    "server_busy",
    "request_timeout",
    "request_budget_exceeded",
    "response_too_large",
)
#: Codes of a request with a JSON body.
_BODY = ("payload_too_large", "unsupported_media_type", "too_many_identifiers")

#: The error codes each endpoint can answer, by ``operationId``: each reached by a test (``tests/test_errors.py``), and
#: every refusal a test meets checked to be listed for its endpoint (``tests/conftest.py``).
ENDPOINT_ERRORS: dict[str, tuple[str, ...]] = {
    "index": _READ,
    "health": _EVERY,
    "status": _READ,
    "version": _READ,
    "vocabulary": _READ,
    "limits": _READ,
    "list_organisms": _READ,
    "describe_organism": (*_READ, "unknown_organism"),
    "final_databases": (*_READ, "unknown_organism", "invalid_request", "unknown_release"),
    "databases_by_release": (*_READ, "unknown_organism"),
    "showcase": (*_READ, "unknown_organism"),
    "showcase_queries": (*_READ, "unknown_organism"),
    "history": (*_READ, "unknown_organism"),
    "convert": (
        *_SEARCH,
        "unknown_release",
        "unknown_database",
        "invalid_argument",
        "missing_value",
        "search_budget_exceeded",
    ),
    "convert_each_database": (
        *_SEARCH,
        "unknown_release",
        "unknown_database",
        "invalid_argument",
        "missing_value",
        "search_budget_exceeded",
    ),
    "convert_batch": (*_SEARCH, *_BODY, "unknown_release", "unknown_database", "invalid_argument"),
    "source_inference": (*_SEARCH, *_BODY, "unknown_identifier"),
    "genes_named": (*_SEARCH, "unknown_release", "missing_value"),
    "names_of": (*_SEARCH, "unknown_release", "unknown_identifier", "invalid_argument"),
}

#: idtrack's input codes, which a batch item's error can carry.
_IDTRACK_INPUT = (
    "unknown_release",
    "unknown_database",
    "unknown_identifier",
    "missing_value",
    "invalid_argument",
    "invalid_input",
)

#: The codes a batch item's ``error.code`` can carry (:py:func:`idtrack_web_api.adapter.item_error_code`).
ITEM_ERROR_CODES = (*_IDTRACK_INPUT, "unknown_organism", "search_budget_exceeded", "internal_error")

#: The metrics of ``Server-Timing`` (:py:func:`idtrack_web_api.guard.server_timing` writes them) and what each
#: measures: the one text of them, which the OpenAPI document carries as ``x-metrics`` of the header (the page's
#: meanings are generated from it).
TIMING_METRICS: dict[str, str] = {
    "app": (
        "The server's whole time on the request, from the moment a worker took its connection until its answer "
        "started; it contains `queue`, `search` and `write`."
    ),
    "queue": (
        "For a request that searched: the time it waited for a worker free of searches and for that worker's search "
        "thread."
    ),
    "search": "For a request that searched: the search's own time.",
    "write": "For a request that searched: the time spent writing its answer and compressing it.",
    "cache": (
        'Sent as `cache;desc="hit"` for an answer sent again from the server\'s memory without a search, and '
        '`cache;desc="revalidated"` for a `304` to an `If-None-Match` that names the answer\'s `ETag`.'
    ),
}

_CACHED_HEADERS = ("ETag", "Cache-Control")
#: The headers of an answer of one graph (an endpoint under ``/organisms/{organism}``).
_GRAPH_HEADERS = ("Idtrack-Version", "Idtrack-Graph-Digest")
HEADERS: dict[str, dict[str, Any]] = {
    "X-Request-ID": {
        "description": (
            "The request's id (also `error.request_id`): the client's own `X-Request-ID` where it sent one of 1 to 64 "
            "letters, digits and `._:-`, else 32 hexadecimal digits the server made; quote it when reporting an "
            "`internal_error`."
        ),
        "schema": {"type": "string", "pattern": "^[A-Za-z0-9._:-]{1,64}$"},
    },
    "Idtrack-Version": {
        "description": "The version of idtrack that answered (as `idtrack_version` of `GET /version`).",
        "schema": {"type": "string"},
    },
    "Idtrack-Graph-Digest": {
        "description": (
            "The content digest of the graph that answered (`content_digest` of the organism in `GET /version`): "
            "record it with the answer, so a result stays tied to its graph without a second request."
        ),
        "schema": {"type": "string"},
    },
    "RateLimit-Policy": {
        "description": (
            "Where the per-client allowances apply (`allowances_enforced` of `GET /limits`): each allowance as the "
            'IETF draft on rate-limit fields writes a policy, `"searches";q=30;w=15`: its name (as `allowance` of a '
            "`429` names it), `q` the most a client holds, `w` the seconds in which an empty allowance fills again."
        ),
        "schema": {"type": "string"},
    },
    "RateLimit": {
        "description": (
            'The client\'s standing in the allowances this request drew on, `"searches";r=29;t=1`: `r` what is left '
            "(whole units: requests, or seconds of search), `t` the seconds until it is full again."
        ),
        "schema": {"type": "string"},
    },
    "Server-Timing": {
        "description": (
            "The server's own time on the request, in milliseconds, as metrics `name;dur=` (`x-metrics` gives the "
            "meaning of each): "
            + "; ".join(f"`{name}`: {text[0].lower()}{text[1:].rstrip('.')}" for name, text in TIMING_METRICS.items())
            + "."
        ),
        "schema": {"type": "string"},
        "example": "app;dur=12.402, queue;dur=0.081, search;dur=11.734, write;dur=0.204",
        "x-metrics": TIMING_METRICS,
    },
    "Retry-After": {
        "description": "Whole seconds to wait before sending the request again.",
        "schema": {"type": "integer", "minimum": 1},
    },
    "ETag": {
        "description": (
            "The answer's tag: the server's identity (its start, versions and graphs) and the request, digested; send "
            "it as `If-None-Match` to be answered `304` while it holds (`-gzip` ends the tag of a compressed answer; "
            "either form matches)."
        ),
        "schema": {"type": "string"},
    },
    "Cache-Control": {
        "description": "`public, max-age=600`: an answer may be reused for ten minutes, then revalidated.",
        "schema": {"type": "string"},
    },
}

#: Where each closed set of codes is a field of a schema: (schema, property, table, whether in a list).
_ENUMS: tuple[tuple[str, str, dict[str, str], bool], ...] = (
    ("ConversionResult", "status", STATUS_MEANINGS, False),
    ("ConversionResult", "reason", REASONS, False),
    ("ConversionResult", "reasons", REASONS, True),
    ("ConversionResult", "decided_by", {c: f"The criterion `{c}` decided." for c in CRITERIA}, False),
    ("OtherReading", "reason", READING_REASONS, False),
    ("PathStep", "reason", STEP_REASONS, False),
    ("PathStep", "places", PLACE_RELATIONS, False),
    ("BridgeCheck", "places", PLACE_RELATIONS, False),
    ("BridgeCheck", "through", BRIDGE_RULES, True),
    ("ShowcaseCase", "kind", {}, False),
    ("ShowcaseQueryCase", "kind", {}, False),
)


def enum_tables() -> dict[tuple[str, str], list[str]]:
    """Return every enumeration the document holds, by (schema, property), in its order.

    Returns:
        dict[tuple[str, str], list[str]]: The codes.
    """
    from idtrack_web_api.showcase import KINDS

    found = {(schema, prop): list(table) for schema, prop, table, _ in _ENUMS}
    found[("ConversionResult", "status")] = list(STATUSES)
    found[("ConversionResult", "decided_by")] = list(CRITERIA)
    found[("ShowcaseCase", "kind")] = list(KINDS)
    found[("ShowcaseQueryCase", "kind")] = list(KINDS)
    found[("ErrorBody", "code")] = list(CODES)
    found[("ErrorInfo", "code")] = list(ITEM_ERROR_CODES)
    found[("Caution", "code")] = list(CAUTIONS)
    found[("CautionTerm", "code")] = list(CAUTIONS)
    return found


def _match_pattern() -> str:
    prefixes = "|".join(re.escape(p) for p in MATCH_PREFIXES)
    steps = "|".join(re.escape(s) for s in MATCH_STEPS)
    return f"^(({prefixes}):)*({steps})$"


def _set_enum(prop: dict[str, Any], codes: list[str], meanings: dict[str, str], *, listed: bool) -> None:
    """Put an enumeration (and its meanings) on a property's string schema.

    The schema is the property's own, its items' for a list, or the second part's of a pair for a list of pairs.
    """
    target = prop.get("items", prop) if listed else prop
    if "prefixItems" in target:
        target = target["prefixItems"][1]
    branches = target.get("anyOf")
    if branches is not None:
        target = next(b for b in branches if b.get("type") == "string")
    target["enum"] = codes
    if meanings:
        target["x-enum-descriptions"] = [meanings.get(c, "") for c in codes]


#: idtrack's names of its tables, as its texts cite them, and the vocabulary's key of each.
_TABLES = {
    "STATUSES": "statuses",
    "REASONS": "reasons",
    "STEP_REASONS": "step_reasons",
    "CRITERIA": "criteria",
    "MATCH_STEPS": "match_steps",
    "MATCH_PREFIXES": "match_prefixes",
    "READING_REASONS": "reading_reasons",
    "PLACE_RELATIONS": "place_relations",
    "BRIDGE_RULES": "bridge_rules",
    "BRIDGE_RULES_TAKEN": "bridge_rules",
}
_TABLE_NAME = re.compile(r"`(" + "|".join(sorted(_TABLES, key=len, reverse=True)) + r")`")


def cite(text: str) -> str:
    """Return a text with idtrack's names of its tables replaced by the vocabulary's key (a document a client has).

    Args:
        text: A description.

    Returns:
        str: The text.
    """
    return _TABLE_NAME.sub(lambda m: f"`{_TABLES[m.group(1)]}` of `GET /vocabulary`", text)


def _cite_vocabulary(node: Any) -> None:
    """Apply :py:func:`cite` to every description of a part of the document."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "description" and isinstance(value, str):
                node[key] = cite(value)
            else:
                _cite_vocabulary(value)
    elif isinstance(node, list):
        for item in node:
            _cite_vocabulary(item)


def _json_schema_bounds(schema: dict[str, Any]) -> None:
    """Write a parameter's bounds as JSON Schema writes them (``minimum``, ``maximum`` on its integer branch).

    FastAPI copies the bounds of a parameter whose type has a validator in front as pydantic's own keys (``ge``,
    ``le``), which JSON Schema does not know.
    """
    bounds = {"minimum": schema.pop("ge", None), "maximum": schema.pop("le", None)}
    if all(v is None for v in bounds.values()):
        return
    branches = schema.get("anyOf") or [schema]
    for branch in branches:
        if branch.get("type") == "integer":
            branch.update({k: v for k, v in bounds.items() if v is not None})


def responses(operation_id: str, success: dict[str, Any]) -> dict[int | str, dict[str, Any]]:
    """Return the ``responses`` of an endpoint: its success, and its error codes by status.

    Args:
        operation_id: The endpoint's ``operationId`` (a key of :py:data:`ENDPOINT_ERRORS`).
        success: The ``200`` response.

    Returns:
        dict[int | str, dict[str, Any]]: For FastAPI's ``responses``.
    """
    found: dict[int | str, dict[str, Any]] = {200: success}
    by_status: dict[int, list[str]] = {}
    for code in ENDPOINT_ERRORS[operation_id]:
        by_status.setdefault(CODES[code][0], []).append(code)
    for status, codes in sorted(by_status.items()):
        named = "; ".join(f"`{code}`, {TITLES[code][0].lower()}{TITLES[code][1:].rstrip('.')}" for code in codes)
        text = f"{named}. (What each means and whether to retry: `errors` of `GET /api/v1/vocabulary`.)"
        found[status] = {"model": schemas.ErrorResponse, "description": text}
    return found


def tsv_content() -> dict[str, Any]:
    """Return the ``text/tab-separated-values`` content of a batch's answer: its columns, how each is written.

    Returns:
        dict[str, Any]: The media type object; ``x-columns`` lists the columns in order, each with its group
        (``result``, ``error`` or ``candidate``) and what it holds.
    """
    from idtrack_web_api import tsv

    columns = [
        {"name": name, "group": tsv.column_group(name), "description": tsv.column_text(name)} for name in tsv.COLUMNS
    ]
    rows = [f"| `{c['name']}` | {c['group']} | {c['description']} |" for c in columns]
    text = (
        "A table of tab-separated values, UTF-8, each line ending in a line feed: the first line names the columns, "
        "then one row per candidate of each result in input order (a result without candidates: one row, its "
        "candidate columns empty). A result's columns repeat on each of its rows. Each value as the JSON answer "
        "writes it: `null` as an empty cell; `true` and `false` as those words; a number as written in the JSON "
        "answer (nothing rounded); a list's items joined by `;`. The explained path (`path`, `final_path`) is not in "
        "the table: ask for JSON. With `provenance=true`, one line before the header begins with `#` and names the "
        "graph and the request (`Content-Disposition` names the file after the organism, the target release and "
        "the graph's digest). The columns, in order (also as `x-columns`):\n\n"
        "| Column | Of | What it holds |\n| --- | --- | --- |\n" + "\n".join(rows)
    )
    return {"schema": {"type": "string", "description": text}, "x-columns": columns}


_RATE_HEADERS = ("RateLimit-Policy", "RateLimit")


def _typed(value: Any, schema: dict[str, Any]) -> Any:
    """Return a recorded query value (text) as the parameter's type writes it: an integer or a boolean."""
    kinds = {branch.get("type") for branch in schema.get("anyOf", [schema])}
    if isinstance(value, str):
        if "integer" in kinds and value.isdigit():
            return int(value)
        if "boolean" in kinds and value in {"true", "false"}:
            return value == "true"
    return value


def _examples() -> dict[str, Any]:
    found = resources.files("idtrack_web_api").joinpath("examples.json")
    if not found.is_file():
        return {}
    data: dict[str, Any] = json.loads(found.read_text(encoding="utf-8"))
    return data


def complete(document: dict[str, Any]) -> dict[str, Any]:  # noqa: PLR0912, PLR0915 - one pass over the document
    """Complete FastAPI's document (see the module's text).

    Args:
        document: The document as FastAPI wrote it.

    Returns:
        dict[str, Any]: The completed document.
    """
    document = copy.deepcopy(document)
    components = document.setdefault("components", {})
    found = components.setdefault("schemas", {})
    for name in ("HTTPValidationError", "ValidationError"):
        found.pop(name, None)
    for model in (schemas.BatchRequest, schemas.SourceInferenceRequest):
        body = model.model_json_schema(ref_template="#/components/schemas/{model}")
        for prop in body["properties"].values():
            if prop.get("default", ...) is None:
                del prop["default"]  # absent and `null` mean the same: the text says what
        found[model.__name__] = body
    tables = enum_tables()
    meanings = {(schema, prop): table for schema, prop, table, _ in _ENUMS}
    meanings[("ErrorBody", "code")] = {c: m for c, (_, m) in CODES.items()}
    meanings[("ErrorInfo", "code")] = meanings[("ErrorBody", "code")]
    meanings[("Caution", "code")] = {code: meaning for code, (_, meaning, _) in CAUTIONS.items()}
    meanings[("CautionTerm", "code")] = meanings[("Caution", "code")]
    listed = {(schema, prop): is_list for schema, prop, _, is_list in _ENUMS}
    for (schema, prop), codes in tables.items():
        target = found.get(schema, {}).get("properties", {}).get(prop)
        if target is not None:
            _set_enum(target, codes, meanings.get((schema, prop), {}), listed=listed.get((schema, prop), False))
    for schema in ("ConversionResult", "OtherReading"):
        target = found.get(schema, {}).get("properties", {}).get("match")
        if target is not None:
            branches = target.get("anyOf") or [target]
            for branch in branches:
                if branch.get("type") == "string":
                    branch["pattern"] = _match_pattern()
                    branch["x-match-prefixes"] = dict(MATCH_PREFIXES)
                    branch["x-match-steps"] = dict(MATCH_STEPS)
    _cite_vocabulary(found)
    components["headers"] = HEADERS
    examples = _examples()
    components["examples"] = {
        code: {
            "summary": f"`{code}`"
            + (" (written by the api's own code: no request makes it on purpose)" if "constructed" in value else ""),
            "value": value.get("answer", value),
        }
        for code, value in examples.get("errors", {}).items()
    }
    for path, operations in document.get("paths", {}).items():
        for method, operation in operations.items():
            op = operation.get("operationId")
            for parameter in operation.get("parameters", []):
                schema = parameter.get("schema", {})
                _json_schema_bounds(schema)
                # FastAPI writes a parameter's text twice (the parameter's and its schema's) and a title from its name:
                # the document keeps the parameter's text once.
                if schema.get("description") == parameter.get("description"):
                    schema.pop("description", None)
                schema.pop("title", None)
            for status, response in operation.get("responses", {}).items():
                if status == "422" and "content" in response:
                    schema = response["content"].get("application/json", {}).get("schema", {})
                    if schema.get("$ref") == "#/components/schemas/HTTPValidationError":
                        continue
                headers = {name: {"$ref": f"#/components/headers/{name}"} for name in ("X-Request-ID", "Server-Timing")}
                if status in {"429", "503"}:
                    headers["Retry-After"] = {"$ref": "#/components/headers/Retry-After"}
                if path.startswith("/api/v1") and op != "health":
                    headers |= {name: {"$ref": f"#/components/headers/{name}"} for name in _RATE_HEADERS}
                if status == "200" and method == "get" and op not in {"health", "status"}:
                    headers |= {name: {"$ref": f"#/components/headers/{name}"} for name in _CACHED_HEADERS}
                if status == "200" and "{organism}" in path:
                    headers |= {name: {"$ref": f"#/components/headers/{name}"} for name in _GRAPH_HEADERS}
                response["headers"] = {**headers, **response.get("headers", {})}
                if status != "200" and op in ENDPOINT_ERRORS:
                    codes = [c for c in ENDPOINT_ERRORS[op] if str(CODES[c][0]) == status]
                    response["x-error-codes"] = codes
                    response["x-retryable"] = [c for c in codes if c in RETRYABLE]
                    content = response.setdefault("content", {}).setdefault("application/json", {})
                    recorded = [c for c in codes if c in examples.get("errors", {})]
                    if recorded:
                        content["examples"] = {c: {"$ref": f"#/components/examples/{c}"} for c in recorded}
            for code in [c for c in operation.get("responses", {}) if c == "422"]:
                schema = operation["responses"][code].get("content", {}).get("application/json", {}).get("schema", {})
                if schema.get("$ref") == "#/components/schemas/HTTPValidationError":
                    del operation["responses"][code]
            sample = examples.get("operations", {}).get(op)
            if sample is not None:
                ok = operation["responses"]["200"].setdefault("content", {})
                for media, value in sample.get("responses", {}).items():
                    ok.setdefault(media, {})["example"] = value
                    if "recorded" in sample:
                        ok[media]["x-recorded"] = sample["recorded"]
                for parameter in operation.get("parameters", []):
                    value = sample.get("parameters", {}).get(parameter["name"])
                    if value is not None:
                        parameter["example"] = _typed(value, parameter.get("schema", {}))
                        parameter.get("schema", {}).pop("examples", None)
                        parameter.pop("examples", None)
                if "body" in sample and "requestBody" in operation:
                    operation["requestBody"]["content"]["application/json"]["example"] = sample["body"]
    _share_refusals(document)
    document["servers"] = [{"url": "/", "description": "The origin that serves this document."}]
    document["info"]["license"] = {"name": "BSD-3-Clause", "identifier": "BSD-3-Clause"}
    document["externalDocs"] = {
        "description": "idtrack's documentation: what it answers, how, and its known limitations",
        "url": "https://idtrack.readthedocs.io/en/stable/",
    }
    return document


def _share_refusals(document: dict[str, Any]) -> None:
    """Write each refusal response once, in ``components/responses``, and refer to it from every operation that has it.

    An operation's refusals of one status are the same object wherever their codes are the same, so the document holds
    each once, named after what it holds: ``Refusal<status>`` where every operation that answers the status answers it
    with the same codes (``Refusal414``), else ``Refusal<status>_<operationId>`` after the first operation, in the
    document's order, that answers it with those codes (``Refusal400_convert``, which ``convert_each_database`` shares).
    """
    shared: dict[str, Any] = document.setdefault("components", {}).setdefault("responses", {})
    found: dict[tuple[str, str], list[str]] = {}  # (status, response) -> the operations that answer it
    for operations in document.get("paths", {}).values():
        for operation in operations.values():
            for status, response in operation.get("responses", {}).items():
                if status != "200" and "$ref" not in response:
                    key = (status, json.dumps(response, sort_keys=True))
                    found.setdefault(key, []).append(operation["operationId"])
    kinds: dict[str, int] = {}
    for status, _ in found:
        kinds[status] = kinds.get(status, 0) + 1
    names = {
        key: f"Refusal{key[0]}" if kinds[key[0]] == 1 else f"Refusal{key[0]}_{operations[0]}"
        for key, operations in found.items()
    }
    for operations in document.get("paths", {}).values():
        for operation in operations.values():
            for status, response in operation.get("responses", {}).items():
                if status == "200" or "$ref" in response:
                    continue
                name = names[(status, json.dumps(response, sort_keys=True))]
                shared[name] = response
                operation["responses"][status] = {"$ref": f"#/components/responses/{name}"}


def index(document: dict[str, Any], *, page: bool) -> dict[str, Any]:
    """Return the body of ``GET /api/v1``: the api's documents and every endpoint of the document.

    Args:
        document: The OpenAPI document.
        page: Whether the server serves the page (``/developers``).

    Returns:
        dict[str, Any]: As :py:class:`idtrack_web_api.schemas.IndexResponse` describes it.
    """
    endpoints = [
        {
            "method": method.upper(),
            "path": path,
            "operation_id": operation["operationId"],
            "summary": operation.get("summary", ""),
        }
        for path, operations in document["paths"].items()
        for method, operation in operations.items()
    ]
    return {
        "api_version": document["info"]["version"],
        "openapi": "/api/v1/openapi.json",
        "llms_txt": "/llms.txt",
        "llms_full_txt": "/llms-full.txt",
        "reference": "/developers" if page else None,
        "vocabulary": "/api/v1/vocabulary",
        "limits": "/api/v1/limits",
        "organisms": "/api/v1/organisms",
        "endpoints": endpoints,
    }


__all__ = [
    "DESCRIPTION",
    "ENDPOINT_ERRORS",
    "HEADERS",
    "ITEM_ERROR_CODES",
    "TIMING_METRICS",
    "complete",
    "enum_tables",
    "index",
    "responses",
]
