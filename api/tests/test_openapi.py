"""The OpenAPI document: the checked-in copy equals what the app serves, and it describes every answer."""

from __future__ import annotations

import dataclasses
import json
import typing
from typing import Any

from fastapi.testclient import TestClient
from idtrack import results

from idtrack_web_api.adapter import RESULT_CLASSES
from idtrack_web_api.errors import CODES
from idtrack_web_api.openapi import openapi_text
from idtrack_web_api.schemas import attribute_docs
from tests.conftest import OPENAPI


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
    """Every result dataclass of idtrack is a schema with exactly its fields, in order, all required, documented."""
    schemas = openapi["components"]["schemas"]
    for cls in RESULT_CLASSES.values():
        schema = schemas[cls.__name__]
        names = [f.name for f in dataclasses.fields(cls)]
        assert list(schema["properties"]) == names
        assert schema["required"] == names
        assert schema["additionalProperties"] is False
        docs = attribute_docs(cls)
        assert all(schema["properties"][n]["description"] == docs[n] for n in names)


def test_every_result_class_reached_from_an_answer_is_listed() -> None:
    """Every result dataclass inside an answer (nested at any depth) is one of the api's result classes."""
    seen: set[type] = set()
    pending: list[type] = [RESULT_CLASSES[name] for name in ("ConversionResult", "GraphDescription", "NameMatch")]
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
    for path, operations in openapi["paths"].items():
        for method, operation in operations.items():
            for status, response in operation["responses"].items():
                if int(status) >= 400:
                    assert int(status) in statuses, (path, method, status)
                    ref = response["content"]["application/json"]["schema"]["$ref"]
                    assert ref == "#/components/schemas/ErrorResponse"
