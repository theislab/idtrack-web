"""``GET /organisms/{organism}/showcase``: chosen conversions of a graph, answered once when the server starts.

The home page draws conversions chosen to show the kinds of journey idtrack follows (the *journeys*) and phenomena of
Ensembl's history (the *cases*, each with the kind its answer shows). They are data, one file per organism
(``showcase_data/<organism>.json``: ``checked_on``, the content digest of the graph the cases were checked on, then
``journeys`` and ``cases``, each a query as ``/convert`` takes it, a case with its ``kind``). Each is converted once, in
the master before the workers are forked (so a visit costs no search, and the lazily built parts of the graph that
these conversions touch are shared by every worker), with ``explain=true`` and the server's search budget, exactly as
``GET .../convert`` answers it. A case claims a property of one graph's answer, so the cases are answered only when the
loaded graph is the one they were checked on; ``tests/test_real.py`` checks every case's kind on the real graphs.
"""

from __future__ import annotations

import json
import logging
import time
from importlib import resources
from typing import TYPE_CHECKING, Any

from idtrack_web_api import service
from idtrack_web_api.adapter import ConversionArguments
from idtrack_web_api.errors import ApiError

if TYPE_CHECKING:
    from idtrack_web_api.config import Settings
    from idtrack_web_api.graphs import LoadedGraph

log = logging.getLogger(__name__)

#: The kinds a case can show (``ShowcaseCase.kind``).
KINDS = (
    "lineage",
    "renamed",
    "new_version",
    "replaced",
    "split",
    "merge",
    "handoff",
    "bridge",
    "other_release",
    "tie",
    "final",
    "retired",
    "refused",
)
_QUERY_KEYS = ("identifier", "from_release", "to_release", "final_database")


def data_of(organism: str) -> dict[str, Any] | None:
    """Return the chosen conversions of an organism (``None``: none chosen).

    Args:
        organism: The organism's production name.

    Returns:
        dict[str, Any] | None: ``checked_on``, ``journeys`` and ``cases``.
    """
    found = resources.files("idtrack_web_api").joinpath("showcase_data", f"{organism}.json")
    if not found.is_file():
        return None
    data: dict[str, Any] = json.loads(found.read_text(encoding="utf-8"))
    return data


def _answer(graph: LoadedGraph, item: dict[str, Any], settings: Settings) -> dict[str, Any]:
    query = {key: item.get(key) for key in _QUERY_KEYS} | {"explain": True}
    arguments = ConversionArguments(
        from_release=query["from_release"],
        to_release=query["to_release"],
        final_database=query["final_database"],
        from_database=None,
        explain=True,
        allow_bridges=True,
    )
    try:
        result = service.convert_one(graph, str(query["identifier"]), arguments, settings, time.monotonic() + 3600.0)
    except ApiError as error:
        return {"query": query, "result": None, "error": error.body("showcase")["error"]}
    return {"query": query, "result": result, "error": None}


def compute(graph: LoadedGraph, settings: Settings) -> dict[str, Any]:
    """Return the body of ``/organisms/{organism}/showcase`` for one graph.

    Args:
        graph: The graph.
        settings: The server's settings (its search budget).

    Returns:
        dict[str, Any]: As :py:class:`idtrack_web_api.schemas.ShowcaseResponse` describes it.
    """
    start = time.monotonic()
    digest = graph.graph.identity().content_digest
    data = data_of(graph.organism) or {"checked_on": None, "journeys": [], "cases": []}
    checked = data["checked_on"] is not None and data["checked_on"] == digest
    body = {
        "organism": graph.organism,
        "content_digest": digest,
        "checked_on": data["checked_on"],
        "journeys": [_answer(graph, item, settings) for item in data["journeys"]],
        "cases": [{"kind": c["kind"], **_answer(graph, c, settings)} for c in data["cases"]] if checked else [],
    }
    log.info("%s: showcase answered in %.1f s.", graph.organism, time.monotonic() - start)
    return body
