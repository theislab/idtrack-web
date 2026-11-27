"""The OpenAPI document: the checked-in copy equals what the app serves, and it describes every answer."""

from __future__ import annotations

import dataclasses
import json
import re
import typing
from typing import Any

from idtrack import results

from idtrack_web_api import contract
from idtrack_web_api.adapter import RESULT_CLASSES
from idtrack_web_api.contract import ITEM_ERROR_CODES
from idtrack_web_api.errors import CODES, RETRYABLE
from idtrack_web_api.openapi import openapi_text
from idtrack_web_api.schemas import API_FIELDS, attribute_docs
from idtrack_web_api.vocabulary import vocabulary
from tests.conftest import OPENAPI, resolved

if typing.TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_checked_in_document_is_current() -> None:
    assert OPENAPI.read_text(encoding="utf-8") == openapi_text(), (
        "api/openapi.json is not what the app generates: run `idtrack-web openapi --output api/openapi.json` "
        "(and regenerate the frontend's types)"
    )


def test_served_document_is_the_checked_in_one(client: TestClient) -> None:
    response = client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    assert response.json() == json.loads(OPENAPI.read_text(encoding="utf-8"))


def test_result_schemas_follow_idtrack(openapi: dict[str, Any]) -> None:
    """Every result dataclass of idtrack is a schema with exactly its fields (and the api's few), in order, all
    required, documented by idtrack's text (its table names cited as the vocabulary's keys)."""
    schemas = openapi["components"]["schemas"]
    for cls in RESULT_CLASSES.values():
        schema = schemas[cls.__name__]
        names = [f.name for f in dataclasses.fields(cls)]
        added = list(API_FIELDS.get(cls.__name__, {}))
        assert list(schema["properties"]) == names + added
        assert schema["required"] == names + added
        assert schema["additionalProperties"] is False
        docs = attribute_docs(cls)
        assert all(schema["properties"][n]["description"] == contract.cite(docs[n]) for n in names)
        assert "STEP_REASONS" not in json.dumps(schema) and "BRIDGE_RULES" not in json.dumps(schema)


def _enum_of(prop: dict[str, Any]) -> dict[str, Any]:
    target = prop.get("items", prop) if prop.get("type") == "array" else prop
    if "prefixItems" in target:
        target = target["prefixItems"][1]
    if "anyOf" in target:
        target = next(b for b in target["anyOf"] if b.get("type") == "string")
    return target


def test_closed_sets_are_enumerations_of_the_vocabulary(openapi: dict[str, Any]) -> None:
    """Every closed set of codes is an enumeration with meanings, the same codes as /vocabulary serves."""
    words = vocabulary()
    schemas = openapi["components"]["schemas"]
    table = {
        ("ConversionResult", "status"): "statuses",
        ("ConversionResult", "reason"): "reasons",
        ("ConversionResult", "reasons"): "reasons",
        ("ConversionResult", "decided_by"): "criteria",
        ("OtherReading", "reason"): "reading_reasons",
        ("PathStep", "reason"): "step_reasons",
        ("PathStep", "places"): "place_relations",
        ("BridgeCheck", "places"): "place_relations",
        ("BridgeCheck", "through"): "bridge_rules",
        ("ErrorBody", "code"): "errors",
    }
    for (schema, prop), key in table.items():
        found = _enum_of(schemas[schema]["properties"][prop])
        assert found["enum"] == [t["code"] for t in words[key]], (schema, prop)
        assert len(found["x-enum-descriptions"]) == len(found["enum"])
        assert all(found["x-enum-descriptions"]), (schema, prop)
    assert set(_enum_of(schemas["ErrorInfo"]["properties"]["code"])["enum"]) <= set(CODES)
    match = schemas["ConversionResult"]["properties"]["match"]["anyOf"][0]
    assert match["pattern"].startswith("^((")
    text = json.dumps(openapi)
    assert re.search(r"(?<![-\w])(None|True|False)(?![-\w])", text) is None, "a Python spelling of a JSON value"


def test_every_endpoint_lists_its_error_codes_and_headers(openapi: dict[str, Any]) -> None:
    listed: set[str] = set()
    openapi = resolved(openapi, openapi)
    for path, operations in openapi["paths"].items():
        for method, operation in operations.items():
            codes = contract.ENDPOINT_ERRORS[operation["operationId"]]
            by_status = {s: r for s, r in operation["responses"].items() if int(s) >= 400}
            assert sorted({str(CODES[c][0]) for c in codes}) == sorted(by_status), (path, method)
            for status, response in by_status.items():
                assert response["x-error-codes"] == [c for c in codes if str(CODES[c][0]) == status]
                assert response["x-retryable"] == [c for c in response["x-error-codes"] if c in RETRYABLE]
                assert all(f"`{c}`" in response["description"] for c in response["x-error-codes"])
                if status in {"429", "503"}:
                    assert "Retry-After" in response["headers"]
            for response in operation["responses"].values():
                assert {"X-Request-ID", "Server-Timing"} <= set(response["headers"])
            listed |= set(codes)
    # `not_found` answers a path that is no endpoint: no operation lists it; `invalid_input` (an input idtrack refuses
    # that the api's own checks leave reachable only inside a batch) is a batch item's code.
    assert listed | {"not_found"} | set(ITEM_ERROR_CODES) == set(CODES), set(CODES) - listed
    assert openapi["servers"] and openapi["info"]["license"]["identifier"] == "BSD-3-Clause"
    assert openapi["externalDocs"]["url"].startswith("https://idtrack.readthedocs.io")


def test_every_result_class_reached_from_an_answer_is_listed() -> None:
    """Every result dataclass inside an answer (nested at any depth) is one of the api's result classes."""
    seen: set[type] = set()
    pending: list[type] = [
        RESULT_CLASSES[name] for name in ("ConversionResult", "GraphDescription", "NameMatch", "SourceInference")
    ]
    while pending:
        cls = pending.pop()
        if cls in seen:
            continue
        seen.add(cls)
        for hint in typing.get_type_hints(cls).values():
            pending += [t for t in _types_in(hint) if dataclasses.is_dataclass(t) and isinstance(t, type)]
    assert seen == set(RESULT_CLASSES.values())
    assert all(getattr(results, cls.__name__) is cls for cls in seen)


def _types_in(hint: Any) -> list[Any]:
    return [hint, *[t for arg in typing.get_args(hint) for t in _types_in(arg)]]


def test_every_error_response_is_the_error_schema(openapi: dict[str, Any]) -> None:
    statuses = {status for status, _ in CODES.values()}
    openapi = resolved(openapi, openapi)
    for path, operations in openapi["paths"].items():
        for method, operation in operations.items():
            for status, response in operation["responses"].items():
                if int(status) >= 400:
                    assert int(status) in statuses, (path, method, status)
                    ref = response["content"]["application/json"]["schema"]["$ref"]
                    assert ref == "#/components/schemas/ErrorResponse"


def test_every_example_is_valid_against_its_schema(openapi: dict[str, Any], check_schema: Any) -> None:
    """The examples are real answers; each one is what its schema says (a change of the answers fails here)."""
    checked = 0
    openapi = resolved(openapi, openapi)
    for operations in openapi["paths"].values():
        for operation in operations.values():
            for status, response in operation["responses"].items():
                for media, content in response.get("content", {}).items():
                    ref = content.get("schema", {}).get("$ref")
                    if ref is None or media != "application/json":
                        continue
                    name = ref.rsplit("/", 1)[-1]
                    values = [e["value"] for e in content.get("examples", {}).values()]
                    if "example" in content:
                        values.append(content["example"])
                    for value in values:
                        check_schema(value, name)
                        checked += 1
                    if status != "200":
                        assert {v["error"]["code"] for v in values} <= set(response["x-error-codes"])
    assert checked >= 40
