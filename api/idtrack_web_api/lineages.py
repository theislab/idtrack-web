"""``GET /organisms/{organism}/lineages``: the lineages of a graph's gene ids, whole families at a time.

A gene id's lineage is what Ensembl's stable id history says of it as the graph holds it: the runs of the graph's
releases at which a version of it is active (``TheGraph.active_releases``; a release of the graph at which no version
is active ends a run, so an id active again after a gap has a run on each side of it), the releases at which a new
version of it begins (a history edge from one version of the id to another), and its history edges to versions of
other ids, each with its two releases and Ensembl's mapping score. Ids joined by such edges, directly or through
others, form a family; a family is given whole or not at all, so that every edge between ids given has both its ends.

Reading every gene id's lineage walks the whole graph (about 30 s for the human graph), so it is done once, when the
graph is published (``idtrack-web publish``, :py:func:`compute`): the publisher writes the lineages of every gene id
as one JSON file named by its content beside the graph file, and the manifest names it with its SHA-256 and size
(SETUP.md, section 7, "The lineages file"). The server reads that file at start (:py:func:`read`) and orders the
families (:py:func:`table`): first those that hold a gene of the showcase's answers (the journeys and cases the site
draws), in the order of the showcase; then every other family in the file's order, the SHA-256 digest of its smallest
id (a fixed order that favours no kind of family), and writes each list of the answer once over every family
(:py:class:`Table`). A request for ``limit`` gene ids is given the families in that order until the next would pass
it: its answer is a function of how many families fit (:py:meth:`Table.families_within`), cut from those lists
(:py:func:`body_bytes`) at the cost of copying its bytes; the answers the site's pages ask for are written at the start
(:py:data:`PREPARED_LIMITS`).
"""

from __future__ import annotations

import bisect
import hashlib
import json
import logging
import math
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, TypedDict, cast

from idtrack_web_api.data import DataError

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator
    from pathlib import Path

    from idtrack_web_api.adapter import Graph
    from idtrack_web_api.data import ManifestGraph

log = logging.getLogger(__name__)

#: The gene ids given when a request names no ``limit``: enough for a figure of the whole history, small to send.
DEFAULT_LIMIT = 12_000
#: The most gene ids one answer gives (about 2 MB of JSON for the human graph).
LIMIT_MAX = 50_000
#: The limits whose answers the server writes at its start: those the site's pages ask for (the home's picture and an
#: organism's History tab: ``web/src/components/hero/HeroField.tsx``, ``web/src/components/explore/LineageField.tsx``),
#: the default and the largest.
PREPARED_LIMITS = (1_500, 4_000, DEFAULT_LIMIT, LIMIT_MAX)
#: How many other answers each worker keeps (the last asked).
RECENT_ANSWERS = 16
#: The version of the lineages file's own layout (``layout`` in the file).
FILE_LAYOUT = 1
#: The largest lineages file read (the human graph's is about 9 MB).
FILE_MAX_BYTES = 256 * 1024 * 1024


class LineagesFile(TypedDict):
    """The content of a lineages file (layout 1): the graph it was read from, then every family as ``/lineages``."""

    layout: int
    organism: str
    content_digest: str
    releases: list[int]
    genes: int
    ids: list[str]
    family_starts: list[int]
    active: list[list[list[int]]]
    versions: list[list[int]]
    edges: list[list[int | float | None]]


#: One family as the server holds it: its ids, each ``(id, active runs, version releases)``, and its edges between
#: them as ``(index in family, index in family, old release, new release, score or None)``.
Family = tuple[list[tuple[str, list[list[int]], list[int]]], list[tuple[int, int, int, int, float | None]]]


@dataclass(frozen=True)
class Table:
    """The lineages of one graph, in the order they are given, with every answer's parts written once.

    The body for the first *k* families is the same few heading fields and, for each list, the first items of the one
    list over every family (an edge's indices are its ids' places in the whole order, which a prefix keeps): each list
    is written once as JSON items joined by commas (``parts``), with the byte at which each family's items end
    (``ends``), so that an answer of any size is cut from them (:py:func:`body_bytes`) rather than written again.
    """

    organism: str
    content_digest: str
    releases: list[int]
    genes: int
    families: int
    #: How many of the first families hold a gene of the showcase's answers.
    focus: int
    #: Per family in the order given, the number of ids given with it and the families before it (``sizes[0]`` is 0).
    sizes: list[int]
    #: Per list of the body (``ids``, ``family_starts``, ``active``, ``versions``, ``edges``), its items over every
    #: family as JSON joined by commas.
    parts: dict[str, bytes]
    #: Per list, the byte of ``parts`` at which the items of the first *k* families end (``ends[name][0]`` is 0).
    ends: dict[str, list[int]]

    def families_within(self, limit: int) -> int:
        """Return how many families, taken whole in the order, fit in *limit* gene ids (the next would pass it).

        Args:
            limit: The most gene ids.

        Returns:
            int: The families: every *limit* from one family's end to the next one's gives the same number.
        """
        return bisect.bisect_right(self.sizes, limit) - 1


#: The lists of the body, in its order (after the heading fields).
LISTS = ("ids", "family_starts", "active", "versions", "edges")


def active_runs(mask: int, releases: list[int]) -> list[list[int]]:
    """The runs of consecutive graph releases set in an active-release mask, as ``[first, last]``.

    A run is a stretch of the graph's releases, one after the other in *releases*, at each of which the mask is set:
    a release of the graph at which it is not set ends the run, so that an id active again after a gap has two.
    """
    runs: list[list[int]] = []
    open_run = False
    for release in releases:
        if not mask >> release & 1:
            open_run = False
            continue
        if open_run:
            runs[-1][1] = release
        else:
            runs.append([release, release])
            open_run = True
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


def compute(graph: Graph) -> LineagesFile:
    """Read every gene id's lineage from the graph's public interface: the lineages file's content.

    Args:
        graph: The graph.

    Returns:
        LineagesFile: ``layout``, ``organism``, ``content_digest``, ``releases``, ``genes``, then every family in the
        order of the SHA-256 digest of its smallest id, as the body of ``/lineages`` gives families: ``ids``,
        ``family_starts``, ``active``, ``versions`` and ``edges`` (indices into ``ids``).
    """
    start = time.monotonic()
    g = graph.api.graph
    identity = graph.identity()
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
    ids: list[str] = []
    family_starts: list[int] = []
    active: list[list[list[int]]] = []
    changes: list[list[int]] = []
    links: list[list[int | float | None]] = []
    for root in sorted(members, key=lambda r: hashlib.sha256(r.encode()).hexdigest()):
        runs = {base: active_runs(masks[base], releases) for base in members[root]}
        # Within a family: by the first release a version of the id is active, then by the id.
        order = sorted(members[root], key=lambda b: (runs[b][0][0] if runs[b] else releases[-1] + 1, b))
        offset = len(ids)
        index = {base: offset + i for i, base in enumerate(order)}
        family_starts.append(offset)
        for base in order:
            ids.append(base)
            active.append(runs[base])
            changes.append(sorted(versions.get(base, ())))
        links.extend(
            [a, b, old, new, score]
            for a, b, old, new, score in sorted(
                (index[a], index[b], old, new, score) for a, b, old, new, score in family_edges.get(root, [])
            )
        )
    log.info("%s: lineages of %d gene ids read in %.1f s.", identity.organism, len(masks), time.monotonic() - start)
    return {
        "layout": FILE_LAYOUT,
        "organism": identity.organism,
        "content_digest": identity.content_digest or "",
        "releases": releases,
        "genes": len(masks),
        "ids": ids,
        "family_starts": family_starts,
        "active": active,
        "versions": changes,
        "edges": links,
    }


def file_bytes(content: LineagesFile) -> bytes:
    """Return the lineages file's bytes: compact JSON, keys sorted, a final line break.

    The same graph always gives the same bytes, so the file's key, named by its content, is the same at every
    publication.

    Args:
        content: As :py:func:`compute` returns it.

    Returns:
        bytes: The file.
    """
    return (json.dumps(content, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def read(path: Path, entry: ManifestGraph) -> LineagesFile:
    """Read a verified lineages file and check that it is of this layout and of the manifest's graph.

    Args:
        path: The file (its size and SHA-256 verified against the manifest).
        entry: The manifest's entry of the graph.

    Returns:
        LineagesFile: The file's content.

    Raises:
        DataError: If it is not a lineages file of this layout, or not of the graph the manifest names.
    """
    key = entry.lineages.key
    start = time.monotonic()
    try:
        content: object = json.loads(path.read_bytes())
    except (OSError, ValueError) as error:
        msg = f"{key}: the lineages file cannot be read ({error}); publish the graphs again (idtrack-web publish)."
        raise DataError(msg) from None
    found = {k: content.get(k) for k in ("layout", "organism", "content_digest")} if isinstance(content, dict) else {}
    expected = {"layout": FILE_LAYOUT, "organism": entry.organism, "content_digest": entry.content_digest}
    if found != expected:
        msg = (
            f"{key} is not the lineages file of the manifest's graph in this server's layout: {found} (file), "
            f"{expected} (expected); publish the graphs again (idtrack-web publish)."
        )
        raise DataError(msg)
    read_file = cast("LineagesFile", content)
    log.info("%s: lineages of %d gene ids read from %s in %.2f s.", entry.organism, read_file["genes"], key,
             time.monotonic() - start)  # fmt: skip
    return read_file


def table(content: LineagesFile, showcase: object = None) -> Table:
    """Order the families of a lineages file: those of the showcase's genes first, then the file's order.

    Args:
        content: The lineages file's content (:py:func:`read`).
        showcase: The showcase's body of this graph (its answers name the genes whose families come first), or None.

    Returns:
        Table: The lineages, families in the order they are given.
    """
    ids: list[str] = content["ids"]
    starts = [*content["family_starts"], len(ids)]
    family_of: dict[str, int] = {}
    rows: list[Family] = []
    for f in range(len(starts) - 1):
        first, end = starts[f], starts[f + 1]
        for i in range(first, end):
            family_of[ids[i]] = f
        rows.append(
            (
                [(ids[i], content["active"][i], content["versions"][i]) for i in range(first, end)],
                [],
            )
        )
    for a, b, old, new, score in content["edges"]:
        f = family_of[ids[int(a or 0)]]
        offset = starts[f]
        rows[f][1].append((int(a or 0) - offset, int(b or 0) - offset, int(old or 0), int(new or 0), score))
    # The families of the genes the showcase's answers name (a string of an answer that is a gene id of the graph, with
    # or without its version), in the order they are named; then the rest in the file's order.
    focus: list[int] = []
    for text in _strings(showcase):
        named = family_of.get(text)
        if named is None:
            named = family_of.get(text.rsplit(".", 1)[0])
        if named is not None and named not in focus:
            focus.append(named)
    chosen = set(focus)
    ordered = [rows[f] for f in focus] + [row for f, row in enumerate(rows) if f not in chosen]
    return _written(content, ordered, len(focus))


def _written(content: LineagesFile, ordered: list[Family], focus: int) -> Table:
    """Write each family's items of every list once, in the order given (:py:class:`Table`)."""
    pieces: dict[str, list[bytes]] = {name: [] for name in LISTS}
    ends: dict[str, list[int]] = {name: [0] for name in LISTS}
    sizes = [0]
    for family, family_edges in ordered:
        offset = sizes[-1]
        items: dict[str, list[object]] = {
            "ids": [base for base, _, _ in family],
            "family_starts": [offset],
            "active": [runs for _, runs, _ in family],
            "versions": [changes for _, _, changes in family],
            "edges": [[offset + a, offset + b, old, new, score] for a, b, old, new, score in family_edges],
        }
        for name in LISTS:
            # A family's items as JSON without the brackets: joined to the items before it by a comma.
            text = json.dumps(items[name], ensure_ascii=False, allow_nan=False, separators=(",", ":"))[1:-1].encode()
            if text:
                pieces[name].append(text)
            ends[name].append(ends[name][-1] + len(text) + (1 if text and ends[name][-1] else 0))
        sizes.append(offset + len(family))
    return Table(
        organism=content["organism"],
        content_digest=content["content_digest"],
        releases=content["releases"],
        genes=content["genes"],
        families=len(ordered),
        focus=focus,
        sizes=sizes,
        parts={name: b",".join(pieces[name]) for name in LISTS},
        ends=ends,
    )


def body_bytes(table: Table, families: int) -> bytes:
    """Return the body of ``/organisms/{organism}/lineages`` that gives the first *families* families, as JSON.

    The answer to a ``limit`` is this body for :py:meth:`Table.families_within` of it: a function of the families
    given, cut from the lists written once (:py:class:`Table`), so that its cost is that of copying its bytes.

    Args:
        table: The graph's lineages.
        families: How many of the families, in the order, to give.

    Returns:
        bytes: As :py:class:`idtrack_web_api.schemas.LineagesResponse` describes it.
    """
    head = json.dumps(
        {
            "organism": table.organism,
            "content_digest": table.content_digest,
            "releases": table.releases,
            "genes": table.genes,
            "families": table.families,
            "focus_families": min(table.focus, families),
        },
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode()
    lists = b",".join(
        b'"' + name.encode() + b'":[' + table.parts[name][: table.ends[name][families]] + b"]" for name in LISTS
    )
    return head[:-1] + b"," + lists + b"}"
