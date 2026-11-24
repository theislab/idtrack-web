"""The OpenAPI document of the api as the application generates it (``api/openapi.json`` is a copy a test checks)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from idtrack_web_api.app import create_app
from idtrack_web_api.config import Settings
from idtrack_web_api.data import ManifestFile, default_manifest_key
from idtrack_web_api.graphs import Registry


def openapi_document() -> dict[str, Any]:
    """Return the OpenAPI document (it does not depend on the graphs loaded or on the configured bounds).

    Returns:
        dict[str, Any]: The document.
    """
    settings = Settings(source="directory", directory=Path("/"))
    registry = Registry(graphs={}, manifest_file=ManifestFile(key=default_manifest_key(), sha256="0" * 64, size=1))
    return create_app(settings, registry).openapi()


def openapi_text() -> str:
    """Return the OpenAPI document as the text of ``api/openapi.json``.

    Returns:
        str: JSON with two-space indentation and a final line break.
    """
    return json.dumps(openapi_document(), indent=2, ensure_ascii=False, allow_nan=False) + "\n"
