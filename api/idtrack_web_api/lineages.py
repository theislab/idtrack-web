"""``GET /organisms/{organism}/lineages``: the lineages of a graph's gene ids, whole families at a time.

A gene id's lineage is what Ensembl's stable id history says of it as the graph holds it: the releases at which a
version of it is active (``TheGraph.active_releases``), the releases at which a new version of it begins (a history
edge from one version of the id to another), and its history edges to versions of other ids, each with its two
releases and Ensembl's mapping score. Ids joined by such edges, directly or through others, form a family; a family is
given whole or not at all, so that every edge between ids given has both its ends.

The families that hold a gene of the showcase's answers (the journeys and cases the site draws) come first, in the
order of the showcase; then every other family, ordered by the SHA-256 digest of its smallest id (a fixed order that
favours no kind of family); a request for ``limit`` gene ids is given the families in that order until the next would
pass it. Reading the human
graph took about 30 s, so it is done in the master before the workers are forked, and answered from memory.
"""

from __future__ import annotations

import hashlib
import logging
import math
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator

if TYPE_CHECKING:
    from idtrack_web_api.graphs import LoadedGraph

log = logging.getLogger(__name__)

#: The gene ids given when a request names no ``limit``: enough for a figure of the whole history, small to send.
DEFAULT_LIMIT = 12_000
#: The most gene ids one answer gives (about 2 MB of JSON for the human graph).
LIMIT_MAX = 50_000


@dataclass(frozen=True)
class Table:
    """The lineages of one graph, in the order they are given."""

    organism: str
    content_digest: str | None
    releases: list[int]
    genes: int
    families: int
    #: Per family in order: its ids, each ``(id, active runs, version releases)``, and its edges between them as
    #: ``(index in family, index in family, old release, new release, score or None)``.
    rows: list[tuple[list[tuple[str, list[list[int]], list[int]]], list[tuple[int, int, int, int, float | None]]]]
    #: How many of the first families hold a gene of the showcase's answers.
    focus: int
    compute_seconds: float


def _runs(mask: int, releases: list[int]) -> list[list[int]]:
    """The runs of consecutive graph releases set in an active-release mask, as ``[first, last]``."""
    runs: list[list[int]] = []
    previous: int | None = None
    for release in releases:
        if not mask >> release & 1:
            continue
        if runs and runs[-1][1] == previous:
            runs[-1][1] = release
        else:
            runs.append([release, release])
        previous = release
    return runs


def _families(masks: dict[str, int], edges: Iterable[tuple[str, str, int, int]]) -> dict[str, str]:
    """Join the ids an edge joins, through any number of others.

    Args:
        masks: The ids (the keys).
        edges: The edges between ids.

    Returns:
        dict[str, str]: Each id's parent; the root of a family is its smallest id.
    """
    parent = {base: base for base in masks}

    def find(base: str) -> str:
        while parent[base] != base:
            parent[base] = parent[parent[base]]
            base = parent[base]
        return base

    for a, b, _, _ in edges:
        if a in parent and b in parent:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    return parent


def _strings(value: object) -> Iterator[str]:
    """Every string inside a JSON value."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def compute(graph: LoadedGraph, showcase: object = None) -> Table:
    """Read every gene id's lineage from the graph's public interface and order the families.

    Args:
        graph: The graph.
        showcase: The showcase's body of this graph (its answers name the genes whose families come first), or None.

    Returns:
        Table: The lineages, families in the order of the digest of their smallest id.
    """
    start = time.monotonic()
    g = graph.graph.api.graph
    releases = [int(r) for r in g.releases]
    masks: dict[str, int] = {}
    versions: dict[str, set[int]] = {}
    edges: dict[tuple[str, str, int, int], float | None] = {}
    for node in g.nodes:
        if not g.is_backbone(node) or g.version(node) in {"Void", "Retired"}:
            continue
        base = g.base_id(node)
        masks[base] = masks.get(base, 0) | g.active_releases(node).mask
        for edge in g.history_edges(node):
            if edge.node == node or g.version(edge.node) in {"Void", "Retired"}:
                continue
            other = g.base_id(edge.node)
            if other == base:
                versions.setdefault(base, set()).add(int(edge.new_release))
                continue
            key = (base, other, int(edge.old_release), int(edge.new_release))
            score = None if math.isnan(edge.weight) else float(edge.weight)
            # Two versions of one id may each have an edge to the other id across the same releases: the best score
            # Ensembl gave between the two ids there is kept.
            if key not in edges or (score is not None and (edges[key] is None or score > edges[key])):  # type: ignore[operator]
                edges[key] = score
    parent = _families(masks, edges)

    def find(base: str) -> str:
        while parent[base] != base:
            base = parent[base]
        return base

    members: dict[str, list[str]] = {}
    for base in masks:
        members.setdefault(find(base), []).append(base)
    family_edges: dict[str, list[tuple[str, str, int, int, float | None]]] = {}
    for (a, b, old, new), score in edges.items():
        if a in parent and b in parent:
            family_edges.setdefault(find(a), []).append((a, b, old, new, score))
    # The families of the genes the showcase's answers name (a string of an answer that is a gene id of the graph, with
    # or without its version), in the order they are named; then the rest by digest.
    focus: list[str] = []
    for text in _strings(showcase):
        base = text if text in masks else text.rsplit(".", 1)[0]
        if base in masks and find(base) not in focus:
            focus.append(find(base))
    chosen = set(focus)
    rest = sorted((r for r in members if r not in chosen), key=lambda r: hashlib.sha256(r.encode()).hexdigest())
    rows = []
    for root in [*focus, *rest]:
        runs = {base: _runs(masks[base], releases) for base in members[root]}
        # Within a family: by the first release a version of the id is active, then by the id.
        ids = sorted(members[root], key=lambda b: (runs[b][0][0] if runs[b] else releases[-1] + 1, b))
        index = {base: i for i, base in enumerate(ids)}
        rows.append(
            (
                [(base, runs[base], sorted(versions.get(base, ()))) for base in ids],
                sorted((index[a], index[b], old, new, score) for a, b, old, new, score in family_edges.get(root, [])),
            )
        )
    seconds = time.monotonic() - start
    log.info("%s: lineages of %d gene ids read in %.1f s.", graph.organism, len(masks), seconds)
    return Table(
        organism=graph.organism,
        content_digest=graph.graph.identity().content_digest,
        releases=releases,
        genes=len(masks),
        families=len(rows),
        rows=rows,
        focus=len(focus),
        compute_seconds=round(seconds, 3),
    )


def body(table: Table, limit: int) -> dict[str, object]:
    """Return the body of ``/organisms/{organism}/lineages`` for at most *limit* gene ids.

    Args:
        table: The graph's lineages.
        limit: The most gene ids to give.

    Returns:
        dict[str, object]: As :py:class:`idtrack_web_api.schemas.LineagesResponse` describes it.
    """
    ids: list[str] = []
    active: list[list[list[int]]] = []
    versions: list[list[int]] = []
    edges: list[list[int | float | None]] = []
    families: list[int] = []
    for family, family_edges in table.rows:
        if len(ids) + len(family) > limit:
            # The next family in the order does not fit; a smaller one after it is not taken instead, so that the
            # families given are always a prefix of the one order.
            break
        offset = len(ids)
        families.append(offset)
        for base, runs, changes in family:
            ids.append(base)
            active.append(runs)
            versions.append(changes)
        edges.extend([offset + a, offset + b, old, new, score] for a, b, old, new, score in family_edges)
    return {
        "organism": table.organism,
        "content_digest": table.content_digest,
        "releases": table.releases,
        "genes": table.genes,
        "families": table.families,
        "focus_families": min(table.focus, len(families)),
        "limit": limit,
        "ids": ids,
        "family_starts": families,
        "active": active,
        "versions": versions,
        "edges": edges,
        "compute_seconds": table.compute_seconds,
    }
