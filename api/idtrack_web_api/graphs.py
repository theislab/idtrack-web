"""The loaded graphs of a server: one per organism, loaded once, checked against the manifest.

The graphs are loaded before the worker processes are forked (``preload_app``), so every worker starts with them; a
worker never loads a graph itself.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from idtrack_web_api.adapter import FORMAT_VERSION, Graph, GraphLoadError, organism_of
from idtrack_web_api.data import DataError, ManifestFile, ManifestGraph, VerifiedData

if TYPE_CHECKING:
    from pathlib import Path

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class LoadedGraph:
    """One organism's graph, as the server holds it.

    Attributes:
        organism: The organism.
        graph: The graph (the idtrack calls on it: :py:class:`idtrack_web_api.adapter.Graph`).
        entry: The manifest's entry of the graph.
        path: The verified local file it was loaded from.
        description: idtrack's description of the graph (``to_dict()``).
        load_seconds: How long the load took.
    """

    organism: str
    graph: Graph
    entry: ManifestGraph
    path: Path
    description: dict[str, Any]
    load_seconds: float


@dataclass(frozen=True)
class Registry:
    """Every loaded graph, and what they were read from.

    Attributes:
        graphs: Organism to its graph, in the manifest's order.
        manifest_file: The manifest's key, SHA-256 and size.
    """

    graphs: dict[str, LoadedGraph]
    manifest_file: ManifestFile

    def get(self, name: str) -> LoadedGraph | None:
        """Return the graph of an organism by any name idtrack resolves offline (``sus_scrofa``, ``pig``).

        Args:
            name: The name.

        Returns:
            LoadedGraph | None: The graph; ``None`` if the name means no loaded organism.
        """
        organism = organism_of(name)
        return None if organism is None else self.graphs.get(organism)


def load_graph(
    path: Path, entry: ManifestGraph, budget_states: int | None = None, budget_seconds: float | None = None
) -> LoadedGraph:
    """Load one verified graph file and check that it is the graph the manifest names.

    Args:
        path: The verified file.
        entry: The manifest's entry.
        budget_states: The search budget of one identifier in states (``None``: idtrack's default).
        budget_seconds: The search budget of one identifier in seconds (``None``: idtrack's default).

    Returns:
        LoadedGraph: The graph.

    Raises:
        DataError: If the file is not the manifest's graph (organism, snapshot, content digest, format).
    """
    start = time.monotonic()
    try:
        graph = Graph.load(str(path), budget_states, budget_seconds)
    except GraphLoadError as error:
        msg = f"{entry.file.key} cannot be loaded as a graph: {error}"
        raise DataError(msg) from None
    seconds = time.monotonic() - start
    identity = graph.identity()
    found = {
        "organism": identity.organism,
        "snapshot_release": identity.snapshot_release,
        "content_digest": identity.content_digest,
        "format_version": identity.format_version,
    }
    expected = {
        "organism": entry.organism,
        "snapshot_release": entry.snapshot_release,
        "content_digest": entry.content_digest,
        "format_version": FORMAT_VERSION,
    }
    if found != expected:
        differing = {k: (found[k], expected[k]) for k in found if found[k] != expected[k]}
        msg = f"{entry.file.key} is not the graph the manifest names: {differing} (file, manifest)."
        raise DataError(msg)
    log.info("%s: loaded in %.1f s.", identity.organism, seconds)
    return LoadedGraph(
        organism=identity.organism,
        graph=graph,
        entry=entry,
        path=path,
        description=graph.describe(),
        load_seconds=seconds,
    )


def load_registry(
    data: VerifiedData, budget_states: int | None = None, budget_seconds: float | None = None
) -> Registry:
    """Load every verified graph.

    Args:
        data: The manifest and the verified files.
        budget_states: The search budget of one identifier in states.
        budget_seconds: The search budget of one identifier in seconds.

    Returns:
        Registry: The graphs.
    """
    graphs = {
        organism: load_graph(path, data.manifest.graph(organism), budget_states, budget_seconds)
        for organism, path in data.files.items()
    }
    return Registry(graphs=graphs, manifest_file=data.manifest_file)


def resolve_organisms(names: tuple[str, ...]) -> tuple[str, ...]:
    """Return the production names of organisms given by any name idtrack resolves offline.

    Args:
        names: The names (``IDTRACK_WEB_ORGANISMS``).

    Returns:
        tuple[str, ...]: The organisms, in the order given.

    Raises:
        DataError: If a name means no organism of idtrack, or two names mean one organism.
    """
    organisms = []
    for name in names:
        organism = organism_of(name)
        if organism is None:
            msg = f"IDTRACK_WEB_ORGANISMS: idtrack knows no organism {name!r}."
            raise DataError(msg)
        organisms.append(organism)
    if len(set(organisms)) != len(organisms):
        msg = f"IDTRACK_WEB_ORGANISMS names an organism twice: {list(names)}."
        raise DataError(msg)
    return tuple(organisms)
