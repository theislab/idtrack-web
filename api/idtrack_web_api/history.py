"""``GET /organisms/{organism}/history``: Ensembl's stable id history of genes in a graph, counted once at the start.

The counts are read from IDTrack's graph through its public interface (:py:meth:`idtrack_web_api.adapter.Graph.
history_counts`): plain facts of Ensembl's history (an id created, a version followed by another version or by another
id, kept, retired), never IDTrack's classification of an event, which is a property of a path (a split or a merge is a
``PathStep.reason`` of a conversion). Counting the human graph took about 17 s, so it is done in the master before the
workers are forked, and answered from memory.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from idtrack_web_api.graphs import LoadedGraph

log = logging.getLogger(__name__)


def compute(graph: LoadedGraph) -> dict[str, Any]:
    """Return the body of ``/organisms/{organism}/history`` for one graph.

    Args:
        graph: The graph.

    Returns:
        dict[str, Any]: As :py:class:`idtrack_web_api.schemas.HistoryResponse` describes it.
    """
    start = time.monotonic()
    counts = graph.graph.history_counts()
    seconds = time.monotonic() - start
    log.info("%s: history counted in %.1f s.", graph.organism, seconds)
    return {
        "organism": graph.organism,
        "content_digest": graph.graph.identity().content_digest,
        **counts,
        "compute_seconds": round(seconds, 3),
    }
