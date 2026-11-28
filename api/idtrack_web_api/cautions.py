"""The evidence of an answer a reader should weigh before trusting it: the API's reading of IDTrack's own fields.

IDTrack's result says how it read the identifier, which path each candidate took and how the candidates were ranked;
it does not say which of those facts make an answer one to review. The API reads them by the rules below, each a
general rule stated by what the fields mean (never a list of identifiers), and adds the result's ``cautions``: one item
per class of evidence that holds, each with its ``code`` (``cautions`` of ``GET /api/v1/vocabulary`` gives its
meaning), its ``tone`` (``caution``: it changes how far the answer can be trusted; ``note``: an exact fact about it that is no fault),
a sentence with the result's own values, and, where IDTrack documents a limitation of that class, the address of that
section of the document of limitations the site cites (:py:mod:`idtrack_web_api.limitations`), and, where a conversion
answers what the mark doubts, that conversion (ask). This module is the one source of these classes: the page shows the
marks the API sends. A mark says only what the result's fields (and IDTrack's public calls it names) show.

The rules read the best answer: the candidates marked best, and the steps of their paths. A search is always made with
its path (a request without ``explain`` gets the result without it), so every rule holds for every answer; which
rules read the path is said per code (:py:data:`CAUTIONS`).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from idtrack_web_api import limitations

if TYPE_CHECKING:
    from collections.abc import Callable

Tone = Literal["caution", "note"]

#: Every class of evidence: its tone, what it means (the vocabulary's text), and the section of IDTrack's
#: limitations that describes it (its anchor, a key of :py:data:`idtrack_web_api.limitations.SECTIONS`), if any.
CAUTIONS: dict[str, tuple[Tone, str, str | None]] = {
    "bridge": (
        "caution",
        (
            "The best answer is reached through a bridge: where Ensembl's history gives a gene no successor, the walk "
            "left it through an id it carries and entered another gene that carries the same id. That is IDTrack's "
            "inference; no record of Ensembl states it."
        ),
        "answers-that-only-a-bridge-reaches",
    ),
    "bridge_beside": (
        "caution",
        (
            "A bridge on the best answer's path joins two genes that both exist at one release: the gene it enters "
            "lived beside the gene it leaves rather than after it. A bridge's gene is a plausible successor at that "
            "place, not one that Ensembl's history proves, and here the two genes overlap in time."
        ),
        "answers-that-only-a-bridge-reaches",
    ),
    "bridge_rival": (
        "caution",
        (
            "The bridge taken enters the gene nearest in releases, while another gene, reached by a bridge from the "
            "same gene through ids the bridge taken does not pass, ranks below by the bridge's gap alone."
        ),
        "a-retired-gene-whose-accession-another-gene-holds-today",
    ),
    "runner_named": (
        "caution",
        (
            "At the target release, the name typed is the organism's name authority's symbol of a gene outside the "
            "best answer (IDTrack's `genes_named`), and no gene of the best answer carries it: the name was followed "
            "with its gene from the release it was read at, or ranked by the candidates' evidence at that release, and "
            "at the target release the authority gives it to another gene."
        ),
        "a-symbol-of-the-name-authority-can-answer-another-gene",
    ),
    "name_elsewhere": (
        "caution",
        (
            "The name is read through several databases at the release read, but the best answer through some of them "
            "only, and no gene of it has the name from a name authority or as Ensembl's display name: the databases "
            "left out give the name to other genes (ranked below, or among the copies set apart)."
        ),
        "a-name-that-another-source-gives-another-gene",
    ),
    "own_continuation": (
        "caution",
        (
            "The best answer's path leaves the entry gene's stable id while the id itself lived on: a candidate ranked "
            "below follows the id to a later version, and a branch outranks the id's own continuation."
        ),
        "a-branch-can-outrank-the-gene-s-own-continuation",
    ),
    "projected_symbols": (
        "note",
        (
            "The database asked is a symbol database of the graph that is not the organism's name authority: it holds "
            "another authority's symbols as Ensembl projects them onto the organism's genes."
        ),
        None,
    ),
    "places_apart": (
        "caution",
        (
            "A step of Ensembl's history on the best answer's path joins two genes that do not lie at one place: the "
            "walk follows Ensembl's record, which moved the gene."
        ),
        "an-id-that-ensembl-moves-to-another-place",
    ),
    "places_unknown": (
        "caution",
        (
            "Steps of the best answer's path join genes that never lie on one assembly at the same time: where "
            "Ensembl publishes no mapping of the two assemblies, their places cannot be compared."
        ),
        "places-across-an-assembly-change",
    ),
    "outside_reference": (
        "caution",
        (
            "Every gene of the best answer lies outside the reference sequence at the target release (on a haplotype, "
            "a patch or an alternative locus): the answer holds no gene of the reference sequence."
        ),
        "copies-on-patches-and-alternative-loci",
    ),
    "bare_number": (
        "caution",
        (
            "The identifier is a bare number, read in every database whose ids are numbers, and the graph holds it "
            "only at an earlier release than the target: it was read as an id of a database of that time, which may "
            "not be the one meant. Name the database as `from_database` to read it in one database only."
        ),
        "numbers-that-several-numbering-schemes-share",
    ),
    "unscored": (
        "caution",
        ("The best answer's path holds history steps between two different stable ids to which Ensembl gave no score."),
        None,
    ),
    "final_other_release": (
        "caution",
        (
            "The id in the database asked is attached, at the target release, to a transcript or translation the gene "
            "had at another release, not to the gene itself."
        ),
        None,
    ),
    "read_at_another_release": (
        "caution",
        (
            "The graph does not hold the identifier at the release given; it was read at another release, where the "
            "graph holds it: the answer is what the identifier meant there."
        ),
        None,
    ),
    "match_synonym": (
        "caution",
        "The identifier was read as a synonym, not as the name or id itself.",
        None,
    ),
    "match_copy": (
        "caution",
        "The item was read as the copy of another item of the batch (a name with `-1`, `.1` or `_1` appended).",
        "single-cell-suffixes-after-a-name-that-is-no-authority-s-symbol",
    ),
    "match_case": (
        "caution",
        "The identifier matched only without letter case.",
        None,
    ),
    "match_separator": (
        "caution",
        "The identifier matched only with its separators taken as one.",
        None,
    ),
    "match_version_newer_than_graph": (
        "caution",
        ("The identifier's version is newer than any version the graph holds: it was read as the latest version held."),
        None,
    ),
    "other_release": (
        "caution",
        (
            "At other releases the same string is read otherwise (as another id, or matched another way) and answers "
            "other genes than the best answer, part of it, or none: a list made at that time means those. Read it at "
            "such a release (`from_release`) to have what it meant then."
        ),
        "without-a-release-a-string-is-what-it-means-today",
    ),
    "other_release_same_gene": (
        "note",
        (
            "At other releases the same string is read otherwise (as another id, or matched another way) but answers "
            "the same genes as the best answer: the release a list was made at does not change its answer."
        ),
        None,
    ),
    "other_reading": (
        "caution",
        "The same string is also read as another id, with another answer.",
        None,
    ),
    "listed_as_copy": (
        "note",
        (
            "The best answer is also listed among the copies the result sets apart (`alternative_locus_genes`): the "
            "answer is the gene, and code that drops the genes of that list would drop it."
        ),
        "copies-on-patches-and-alternative-loci",
    ),
    "number_read": (
        "note",
        (
            "The identifier is a bare number, read in every database whose ids are numbers; name the database as "
            "`from_database` to read it in one database only."
        ),
        "numbers-that-several-numbering-schemes-share",
    ),
    "one_gene": (
        "note",
        (
            "The targets are every id the best gene carries in the database asked: IDTrack converts at the level of "
            "the gene, not the counterpart of the identifier alone."
        ),
        None,
    ),
    "split_ranked": (
        "note",
        (
            "The best answer descends through a split of Ensembl's history, and other successors were reached: "
            "IDTrack ranks the successors of a split by Ensembl's scores and the candidates' evidence, not by which "
            "of them lies where the old gene lay."
        ),
        "among-the-successors-of-a-split-the-best-answer-does-not-look-at-the-old-place",
    ),
    "also_read_same_step": (
        "note",
        "The same string is also read as another id at the same step.",
        None,
    ),
    "match_version_not_judged": (
        "note",
        "The identifier's version was not judged (`version_not_judged`).",
        None,
    ),
    "match_unicode": (
        "note",
        "The identifier was read after a Unicode normalisation.",
        None,
    ),
    "match_punctuation": (
        "note",
        "The identifier was read with punctuation removed.",
        None,
    ),
    "match_par_y": (
        "note",
        "A gene's copy on the Y chromosome's pseudoautosomal region was read as its gene.",
        None,
    ),
    "match_lrg": (
        "note",
        "An LRG record was read as its gene.",
        None,
    ),
    "lowest_score": (
        "note",
        (
            "The lowest of Ensembl's mapping scores on the best answer's path, stated exactly (the candidate's score "
            "is the product of the scores along its path)."
        ),
        None,
    ),
}


#: The codes whose rule reads the path (its steps, nodes or bridges).
PATH_CODES = frozenset(
    {
        "bridge_beside",
        "bridge_rival",
        "own_continuation",
        "places_apart",
        "places_unknown",
        "outside_reference",
        "split_ranked",
        "lowest_score",
    }
)
#: The anchor that replaces ``copies-on-patches-and-alternative-loci`` for an LRG record's gene id (IDTrack documents
#: that class apart).
_LRG_COPY = "the-grch37-gene-ids-of-lrg-records-list-their-answer-among-the-copies"
_HISTORY = frozenset({"history", "self_loop"})
_SPLITS = frozenset({"split", "split_and_merge"})
_NUMBER = re.compile(r"^([0-9]+)(?:\.([0-9]+))?$")
_STABLE = re.compile(r"^(ENS[A-Z]*[GTP][0-9]+)\.[0-9]+$")
_MATCH_NOTES = {
    "unicode": ("match_unicode", "Unicode normalised"),
    "punctuation": ("match_punctuation", "punctuation removed"),
    "par_y": ("match_par_y", "Y copy read as its gene"),
    "lrg": ("match_lrg", "LRG record read as its gene"),
}
#: The most genes whose symbols one result's rules look up (a page shows far fewer).
SYMBOLS_MAX = 200


@dataclass(frozen=True)
class Facts:
    """What the rules read beside the result: the organism's symbol databases, who holds a name, genes' symbols.

    Attributes:
        symbol_databases: The organism's symbol databases in IDTrack's order (``idtrack.organisms.SYMBOL_DATABASES``):
            the first a conversion to a release can end in is the organism's name authority there.
        authority_at: The organism's name authority at a release, or ``None`` where the graph holds none there.
        holders: The genes to which a database gives a name (not as a synonym, in any letter case) at a release, each
            with the first release from which it holds the name there without a break (IDTrack's ``genes_named``).
        symbols_of: The symbols of genes at a release in a database: the best targets of IDTrack's conversion of each
            gene (read at that release, to it, without bridges), as the page shows a gene's symbol.
        asked: The database the conversion asked for (``None``: Ensembl genes).
    """

    symbol_databases: tuple[str, ...] = ()
    authority_at: Callable[[int], str | None] = lambda _release: None
    holders: Callable[[str, str, int], dict[str, int]] = lambda _name, _database, _release: {}
    symbols_of: Callable[[list[str], int, str], dict[str, list[str]]] = lambda _genes, _release, _database: {}
    asked: str | None = None


def limitation_url(anchor: str | None) -> str | None:
    """Return the address of a section of IDTrack's limitations in the document the site cites (``None`` for none).

    Args:
        anchor: The section's anchor (a key of :py:data:`idtrack_web_api.limitations.SECTIONS`).

    Returns:
        str | None: The address.
    """
    return None if anchor is None else limitations.url(anchor)


def _code(value: Any) -> str:
    return f"`{value}`"


def _list(items: list[str]) -> str:
    """Return items as words: ``A, B and C``."""
    if len(items) <= 1:
        return items[0] if items else ""
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _plural(count: int, one: str, many: str | None = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def _ranges(releases: list[int]) -> str:
    """Return releases as runs: ``52-60, 70``."""
    runs: list[list[int]] = []
    for release in sorted(releases):
        if runs and release == runs[-1][1] + 1:
            runs[-1][1] = release
        else:
            runs.append([release, release])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in runs)


def _rank_words(ranks: list[int]) -> str:
    return f"rank {ranks[0]}" if len(ranks) == 1 else f"ranks {_ranges(ranks)}"


def _active(active: list[Any]) -> str:
    return ", ".join(f"{a} on" if b is None else str(a) if a == b else f"{a}-{b}" for a, b in active)


def _shared(left: list[Any], right: list[Any]) -> tuple[int, int | None] | None:
    """Return the first and last release at which two lives hold (``None`` last: both still active), or ``None``."""
    first: int | None = None
    last: int | None = None
    still = False
    for a0, a1 in left:
        for b0, b1 in right:
            low = max(a0, b0)
            high = min(math.inf if a1 is None else a1, math.inf if b1 is None else b1)
            if low > high:
                continue
            first = low if first is None else min(first, low)
            if math.isinf(high):
                still = True
            else:
                last = int(high) if last is None else max(last, int(high))
    if first is None:
        return None
    return first, None if still else last


def _stable(identifier: str | None) -> str | None:
    """Return an Ensembl id's stable id without its version (``ENSG00000141510.5``: ``ENSG00000141510``)."""
    if identifier is None:
        return None
    found = _STABLE.match(identifier)
    return found.group(1) if found else identifier


def _active_at(node: dict[str, Any] | None, release: int) -> bool:
    return node is not None and any(release >= a and (b is None or release <= b) for a, b in node.get("active", []))


@dataclass
class _Context:
    """One result's best answer, and what the rules work out from it once."""

    result: dict[str, Any]
    facts: Facts
    bests: list[dict[str, Any]] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    nodes: dict[str, dict[str, Any]] = field(default_factory=dict)
    explained: bool = False

    def __post_init__(self) -> None:
        r = self.result
        self.bests = [c for c in r.get("candidates", []) if c.get("best")]
        path = r.get("path") or {}
        self.nodes = {n["id"]: n for n in path.get("nodes") or []}
        seen: set[int] = set()
        for candidate in _distinct(self.bests):
            for index in [*candidate.get("path", []), *candidate.get("final_path", [])]:
                step = self.step(index)
                if step is not None and index not in seen:
                    seen.add(index)
                    self.steps.append(step)
        self.explained = r.get("path") is not None and bool(self.steps)

    def step(self, index: int) -> dict[str, Any] | None:
        steps = (self.result.get("path") or {}).get("steps") or []
        return steps[index] if 0 <= index < len(steps) else None

    def steps_of(self, candidate: dict[str, Any]) -> list[dict[str, Any]]:
        indices = [*candidate.get("path", []), *candidate.get("final_path", [])]
        return [s for s in (self.step(i) for i in indices) if s is not None]

    def event(self, step: dict[str, Any]) -> str:
        """A history step in Ensembl's direction: its releases and its earlier and later ids."""
        r = self.result
        old, new = step.get("old_release"), step.get("new_release")
        source, target = self.nodes.get(step.get("source") or ""), self.nodes.get(step["target"])
        backward = False
        if old is not None and new is not None:
            if _active_at(source, old) and _active_at(target, new):
                backward = False
            elif _active_at(source, new) and _active_at(target, old):
                backward = True
            else:
                start = r.get("from_release") if r.get("from_release") is not None else r.get("to_release")
                backward = r.get("to_release", 0) < (start or 0)
        earlier, later = (step["target"], step.get("source")) if backward else (step.get("source"), step["target"])
        none = "—"
        return (
            f"releases {none if old is None else old} → {none if new is None else new} "
            f"({_code(earlier or none)} → {_code(later or none)})"
        )


def _distinct(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the candidates of distinct paths to their gene, the first of each (a gene's targets share one path)."""
    seen: set[tuple[int, ...]] = set()
    out = []
    for candidate in candidates:
        key = tuple(candidate.get("path", []))
        if key not in seen:
            seen.add(key)
            out.append(candidate)
    return out


def _bridges_taken(c: _Context, candidate: dict[str, Any]) -> list[tuple[str, str]]:
    """The bridges a candidate's path takes: the gene each leaves and the gene it enters, in the walk's order."""
    steps = c.steps_of(candidate)
    out = []
    for i, near in enumerate(steps):
        if near.get("kind") != "bridge_near" or near.get("source") is None:
            continue
        far = next((s for s in steps[i + 1 :] if s.get("kind") == "bridge_far"), None)
        if far is not None:
            out.append((near["source"], far["target"]))
    return out


def _best_bridges(c: _Context) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for candidate in _distinct(c.bests):
        for pair in _bridges_taken(c, candidate):
            if pair not in out:
                out.append(pair)
    return out


Mark = dict[str, Any]


def _mark(code: str, label: str, text: str, **extra: Any) -> Mark:
    """A mark of a class: its code, the tone of the class (or the one given), its words; ``limitation``: an anchor."""
    return {"code": code, "label": label, "text": text} | extra


def _bridge(c: _Context) -> list[Mark]:
    bridged = [x for x in c.bests if x.get("bridges", 0) > 0]
    if not bridged or c.result.get("no_target"):
        return []
    most = max(x["bridges"] for x in bridged)
    through = list(dict.fromkeys(s["target"] for s in c.steps if s.get("kind") == "bridge_near"))
    return [
        _mark(
            "bridge",
            f"through {_plural(most, 'bridge')}",
            f"The best answer is reached through {_plural(most, 'bridge')}"
            + (f" (through {', '.join(map(_code, through))})" if through else "")
            + ": where Ensembl's history gives a gene no successor, the walk leaves it through an id it carries and "
            "enters another gene that carries the same id. That is IDTrack's inference; no record of Ensembl "
            "states it.",
        )
    ]


def _bridge_beside(c: _Context) -> list[Mark]:
    if not c.explained or c.result.get("no_target"):
        return []
    beside: list[str] = []
    for source, target in _best_bridges(c):
        left, right = c.nodes.get(source), c.nodes.get(target)
        if left is None or right is None:
            continue
        both = _shared(left.get("active", []), right.get("active", []))
        if both is None:
            continue
        at = f" {both[0]}" if both[0] == both[1] else f"s {_active([list(both)])}"
        text = (
            f"{_code(left['label'])} (releases {_active(left.get('active', []))}) and {_code(right['label'])} "
            f"(releases {_active(right.get('active', []))}) both exist at release{at}"
        )
        if text not in beside:
            beside.append(text)
    if not beside:
        return []
    return [
        _mark(
            "bridge_beside",
            "the bridge joins two genes of one time"
            if len(beside) == 1
            else f"{len(beside)} bridges join genes of one time",
            f"{'; '.join(beside)}: the bridge joins two genes that lived side by side, so the gene it enters is not "
            "one that came after the gene it leaves. A bridge's gene is a plausible successor at that place, not one "
            "that Ensembl's history proves.",
        )
    ]


def _bridge_rival(c: _Context) -> list[Mark]:
    r = c.result
    best = next((x for x in c.bests if x.get("bridges", 0) > 0), None)
    if best is None or r.get("no_target") or not c.explained or r.get("decided_by") != "bridge_gap":
        return []
    runner = next((x for x in r.get("candidates", []) if not x.get("best") and x.get("bridges", 0) > 0), None)
    if runner is None:
        return []
    records = (r.get("path") or {}).get("bridges") or []

    def through(candidate: dict[str, Any]) -> list[str]:
        pairs = _bridges_taken(c, candidate)
        return [
            item[0]
            for b in records
            if b.get("taken") and (b.get("source"), b.get("target")) in pairs
            for item in b.get("through", [])
        ]

    taken = set(through(best))
    own = [i for i in dict.fromkeys(through(runner)) if i not in taken]
    if not own:
        return []

    def label(identifier: str) -> str:
        return str(c.nodes.get(identifier, {}).get("label", identifier))

    to = r["to_release"]
    first = label(next((i for i in own if c.nodes.get(i, {}).get("kind") == "external"), own[0]))
    shown = ", ".join(_code(label(i)) for i in own[:6]) + (f" and {len(own) - 6} more" if len(own) > 6 else "")
    rank = r["candidates"].index(runner) + 1
    return [
        _mark(
            "bridge_rival",
            "another gene shares the bridged gene's ids",
            f"The bridge taken enters the gene nearest in releases. {_code(runner['target'])} (rank {rank}), a gene at "
            f"release {to}, is reached by a bridge from the same gene through ids the bridge taken does not pass: "
            f"{shown}. It ranks below only by the bridge's gap in releases ({runner.get('bridge_gap')} against "
            f"{best.get('bridge_gap')}); the criteria before it are equal. Ask by such an id at release {to} to have "
            "the gene that holds it then.",
            alert=True,
            ask={"words": f"Ask {first} at release {to}", "identifier": first, "from_release": to, "to_release": to},
        )
    ]


def _runner_named(c: _Context) -> list[Mark]:
    """The name typed is, at the target release, the name authority's symbol of a gene outside the best answer."""
    r = c.result
    if not c.bests or r.get("no_target") or r.get("graph_id") is None:
        return []
    to = r["to_release"]
    authority = c.facts.authority_at(to)
    typed = str(r.get("query_id", "")).strip()
    if authority is None or not typed:
        return []
    holders = c.facts.holders(typed, authority, to)
    best_ids = {_stable(x["gene"]) for x in c.bests}
    if not holders or any(_stable(g) in best_ids for g in holders):
        return []
    others = list(holders)
    ranks = {_stable(g): i + 1 for i, g in reversed(list(enumerate(x["gene"] for x in r.get("candidates", []))))}
    if authority == (r.get("final_database") or c.facts.asked):  # the targets are the symbols: nothing to ask
        symbols: dict[str, list[str]] = {}
        for x in c.bests:
            symbols.setdefault(x["gene"], [])
            if x["target"] not in symbols[x["gene"]]:
                symbols[x["gene"]].append(x["target"])
    else:
        symbols = c.facts.symbols_of(list(dict.fromkeys(x["gene"] for x in c.bests))[:SYMBOLS_MAX], to, authority)
    best_names = []
    for gene in dict.fromkeys(x["gene"] for x in c.bests):
        own = symbols.get(gene, [])
        best_names.append(
            f"{_code(gene)} carries {', '.join(map(_code, own))}" if own else f"{_code(gene)} carries none"
        )

    def holder(gene: str) -> str:
        rank = ranks.get(_stable(gene))
        where = f"rank {rank}" if rank is not None else "not among the candidates"
        return f"{_code(gene)} ({where}; since release {holders[gene]})"

    frm = r.get("from_release")
    at_own = frm == to
    split = any(s.get("kind") == "history" and s.get("reason") in _SPLITS for s in c.steps)
    how = (
        "IDTrack ranked the best answer first by the evidence of the candidates (Ensembl's display name, then the "
        "support of the name)."
        if at_own
        else f"The name was read at release {frm} and followed with its gene through Ensembl's history to {to}"
        + (", where its gene's successors are ranked by Ensembl's scores" if split else "")
        + f"; at {to} the authority gives the name to another gene."
    )
    anchor = (
        "a-symbol-of-the-name-authority-can-answer-another-gene"
        if at_own
        else "among-the-successors-of-a-split-the-best-answer-does-not-look-at-the-old-place"
        if split
        else "without-a-release-a-string-is-what-it-means-today"
    )
    genes = "a gene" if len(others) == 1 else "genes"
    return [
        _mark(
            "runner_named",
            f"{authority} gives {_code(typed)} to another gene at {to}",
            f"At release {to}, {authority} gives {_code(typed)} to {_list([holder(g) for g in others])}, {genes} "
            f"outside the best answer; of the best answer, {_list(best_names)}. {how} Ask {_code(typed)} at release "
            f"{to} to read the name as it is then.",
            limitation=anchor,
            alert=True,
            ask={"words": f"Ask {typed} at release {to}", "from_release": to, "to_release": to},
        )
    ]


def _name_elsewhere(c: _Context) -> list[Mark]:
    r = c.result
    match = r.get("match") or ""
    if not c.bests or r.get("no_target") or not match or "synonym" in match.split(":"):
        return []
    if any(x.get("authority") or x.get("display_name") for x in c.bests):
        return []
    reached = list(dict.fromkeys(d for x in c.bests for d in x.get("entry_databases", [])))
    if not reached:
        return []
    left = [d for d in r.get("from_databases", []) if d not in reached]
    if not left:
        return []
    below = [
        (x, i + 1)
        for i, x in enumerate(r.get("candidates", []))
        if not x.get("best") and any(d in left for d in x.get("entry_databases", []))
    ]
    copies = len(r.get("alternative_locus_genes") or [])
    where = [
        f"{_plural(len({x['gene'] for x, _ in below}), 'gene')} ranked below ({_rank_words([k for _, k in below])})"
        if below
        else "",
        f"the {_plural(copies, 'copy', 'copies')} on haplotypes, patches or alternative loci the result sets apart"
        if copies
        else "",
    ]
    where = [w for w in where if w]
    authority = c.facts.symbol_databases[0] if c.facts.symbol_databases else None
    source = authority if authority in left else left[0]
    gives = "gives" if len(left) == 1 else "give"
    return [
        _mark(
            "name_elsewhere",
            f"the best answer is read only through {_list(reached)}",
            f"At release {r.get('from_release')}, {_code(r.get('query_id'))} is read through "
            f"{_list(list(r.get('from_databases', [])))}, but the best answer through {_list(reached)} alone: no "
            "gene of "
            f"it has the name from a name authority or as Ensembl's display name. The genes to which {_list(left)} "
            f"{gives} the name are not in the best answer"
            + (f"; they are among {_list(where)}" if where else "")
            + ". Name the database to read the name in it alone.",
            alert=True,
            ask={"words": f"Ask with {source} as the source database", "from_database": source},
        )
    ]


def _own_continuation(c: _Context) -> list[Mark]:
    r = c.result
    frm, to = r.get("from_release"), r.get("to_release")
    if not c.explained or r.get("no_target") or frm is None or to is None or to <= frm:
        return []
    entry = c.bests[0].get("entry_gene") if c.bests else None
    own = _stable(entry)
    if own is None or own == entry:
        return []

    def leaves(candidate: dict[str, Any]) -> dict[str, Any] | None:
        return next(
            (
                s
                for s in c.steps_of(candidate)
                if s.get("kind") in _HISTORY
                and _stable(s.get("source")) == own
                and _stable(s["target"]) != own
                and s.get("old_release") is not None
            ),
            None,
        )

    def lives(candidate: dict[str, Any]) -> int:
        ends: list[int] = [
            int(s["new_release"]) if s.get("new_release") is not None else -1
            for s in c.steps_of(candidate)
            if s.get("kind") in _HISTORY
            and s.get("source") != s["target"]
            and _stable(s.get("source")) == own
            and _stable(s["target"]) == own
        ]
        return max([-1, *ends])

    bests = _distinct(c.bests)
    left = [leaves(x) for x in bests]
    if any(s is None for s in left):
        return []
    left_at = max(s["old_release"] for s in left if s is not None)
    if any(lives(x) > left_at for x in bests):
        return []
    known: dict[tuple[int, ...], int] = {}
    continuing = []
    for i, x in enumerate(r.get("candidates", [])):
        key = tuple(x.get("path", []))
        at = known.setdefault(key, lives(x))
        if not x.get("best") and at > left_at:
            continuing.append(i + 1)
    first = left[0]
    if not continuing or first is None:
        return []
    step = next(
        (
            s
            for k in continuing
            for s in c.steps_of(r["candidates"][k - 1])
            if s.get("kind") in _HISTORY
            and _stable(s.get("source")) == own
            and _stable(s["target"]) == own
            and s.get("source") != s["target"]
        ),
        None,
    )
    ranks = _rank_words(continuing).removeprefix("ranks ").removeprefix("rank ")
    return [
        _mark(
            "own_continuation",
            "the id's own continuation ranks below a branch",
            f"The best answer's path leaves {_code(own)} at {c.event(first)}, while the id itself lived on"
            + (f" ({c.event(step)})" if step else "")
            + f". The candidates that follow the id's own continuation rank {ranks}: IDTrack ranks a branch and the "
            "id's continuation by the product of Ensembl's scores.",
            alert=True,
        )
    ]


def _places_apart(c: _Context) -> list[Mark]:
    if not c.explained:
        return []
    apart = [s for s in c.steps if s.get("kind") in _HISTORY and s.get("places") == "places_apart"]
    if not apart:
        return []
    more = f" ({_plural(len(apart), 'such step')} on the path)" if len(apart) > 1 else ""
    return [
        _mark(
            "places_apart",
            "a step puts the gene elsewhere" if len(apart) == 1 else f"{len(apart)} steps put the gene elsewhere",
            f"Ensembl's history at {c.event(apart[0])} joins two genes that do not lie at one place; the walk follows "
            f"Ensembl's record{more}.",
        )
    ]


def _places_unknown(c: _Context) -> list[Mark]:
    if not c.explained:
        return []
    history = sum(
        1
        for s in c.steps
        if s.get("kind") in _HISTORY
        and s.get("places") == "other_assemblies"
        and s.get("old_assembly") != s.get("assembly")
    )
    records = (c.result.get("path") or {}).get("bridges") or []
    bridges = sum(
        1
        for pair in _best_bridges(c)
        if any(
            b.get("taken") and (b.get("source"), b.get("target")) == pair and b.get("places") == "other_assemblies"
            for b in records
        )
    )
    n = history + bridges
    if not n:
        return []
    parts = [
        p
        for p in (_plural(history, "history step") if history else "", _plural(bridges, "bridge") if bridges else "")
        if p
    ]
    return [
        _mark(
            "places_unknown",
            "places not compared across assemblies" if n == 1 else f"{n} steps across assemblies, places not compared",
            f"{_list(parts)} of the best answer's path join{'s' if n == 1 else ''} genes that never lie on one "
            "assembly "
            "at the same time, and nothing tells them apart: where Ensembl publishes no mapping of the two "
            "assemblies, their places cannot be compared.",
        )
    ]


def _outside_reference(c: _Context) -> list[Mark]:
    r = c.result
    if not c.bests or r.get("no_target") or not r.get("path"):
        return []
    to = r["to_release"]
    genes = list(dict.fromkeys(x["gene"] for x in c.bests))

    def at(ranges: list[Any]) -> bool:
        return any(a <= to <= b for a, b in ranges)

    outside = [g for g in genes if at(c.nodes.get(g, {}).get("non_reference") or [])]
    if not genes or len(outside) != len(genes):
        return []
    regions = list(
        dict.fromkeys(
            p["region"]
            for g in genes
            for p in c.nodes.get(g, {}).get("places") or []
            if not p.get("reference") and at(p.get("releases", []))
        )
    )
    shown = (
        f" ({', '.join(map(_code, regions[:4]))}{f' and {len(regions) - 4} more' if len(regions) > 4 else ''})"
        if regions
        else ""
    )
    whose = "the gene of the best answer lies" if len(genes) == 1 else f"all {len(genes)} genes of the best answer lie"
    return [
        _mark(
            "outside_reference",
            "the answer lies outside the reference sequence"
            if len(genes) == 1
            else "every answer lies outside the reference sequence",
            f"At release {to}, {whose} outside the reference sequence{shown}: on a haplotype, a patch or an "
            "alternative "
            "locus. The answer holds no gene of the reference sequence.",
        )
    ]


def _listed_as_copy(c: _Context) -> list[Mark]:
    r = c.result
    listed = [g for g in dict.fromkeys(x["gene"] for x in c.bests) if g in (r.get("alternative_locus_genes") or [])]
    if not listed or r.get("no_target"):
        return []
    lrg = str(r.get("query_id", "")).startswith("LRG_")
    return [
        _mark(
            "listed_as_copy",
            "the answer is also listed among the copies set apart",
            f"{', '.join(map(_code, listed))}, the best answer, is also listed among the copies the result sets apart "
            "(`alternative_locus_genes`). The answer is the gene; code that drops the genes of that list from a result "
            "would drop it.",
            **({"limitation": _LRG_COPY} if lrg else {}),
        )
    ]


def _number_readings(c: _Context) -> list[dict[str, Any]]:
    """The readings of a number written with a version that the number's rule names (its digits alone)."""
    if not re.fullmatch(r"[0-9]+\.[0-9]+", str(c.result.get("query_id", ""))):
        return []
    return [o for o in c.result.get("other_readings") or [] if o.get("reason") == "unversioned_database"]


def _number(c: _Context) -> list[Mark]:
    r = c.result
    query = str(r.get("query_id", ""))
    form = _NUMBER.match(query)
    if not form or r.get("graph_id") is None or r.get("from_release") is None:
        return []
    read = ", ".join(r.get("from_databases") or []) or "a database"
    old = bool(r.get("from_release_inferred")) and r.get("from_release") != r.get("to_release")
    digits, version = form.group(1), form.group(2)
    others = _number_readings(c)
    other_text = ""
    if others:
        genes = [g for o in others for g in o.get("genes", [])]
        many = any(len(o.get("genes", [])) > 1 for o in others)
        other_text = (
            f" Read without its version, as {_code(digits)}, it answers {', '.join(map(_code, genes))}: another "
            f"gene{'s' if many else ''}, reported by IDTrack beside the answer."
        )
    what = (
        f"{_code(query)} is a number written with the version {version}"
        if version
        else f"{_code(query)} is a bare number"
    )
    if old:
        text = (
            f"{what}, and a number is read in every database whose ids are numbers. The graph holds it last at release "
            f"{r['from_release']}, as a {read} id{f' (version {version})' if version else ''}, and read it there (the "
            f"release was inferred: no database holds it at release {r.get('to_release')}). If it is another "
            "database's number (an NCBI gene id, for example), name that database as the source database"
            f"{', or write it without the version' if version else ''}.{other_text}"
        )
    else:
        text = (
            f"{what}, read as a {read} id at release {r['from_release']}. A number is read in every database whose ids "
            f"are numbers; to read it in one database only, name it as the source database.{other_text}"
        )
    label = f"a number read as a {read} id of release {r['from_release']}" if old else f"a number read as a {read} id"
    extra: dict[str, Any] = {}
    if version and others:
        extra["ask"] = {"words": f"Ask {digits} without the version", "identifier": digits}
    return [_mark("bare_number" if old or others else "number_read", label, text, **extra)]


def _one_gene(c: _Context) -> list[Mark]:
    r = c.result
    genes = {x["gene"] for x in c.bests}
    targets = {x["target"] for x in c.bests}
    if len(genes) != 1 or len(targets) <= 1 or r.get("no_target"):
        return []
    gene = next(iter(genes))
    return [
        _mark(
            "one_gene",
            f"all {len(targets)} ids of one gene",
            f"The {len(targets)} targets are the ids {_code(gene)} carries in "
            f"{r.get('final_database') or 'the database asked'} at release {r.get('to_release')}. IDTrack converts at "
            "the level of the gene: the identifier is read as its gene and followed as a gene, and the answer in the "
            f"database asked is every id of the best gene there, not the counterpart of {_code(r.get('query_id'))} "
            "alone.",
        )
    ]


def _split_ranked(c: _Context) -> list[Mark]:
    r = c.result
    if not c.explained or r.get("no_target"):
        return []
    split = next((s for s in c.steps if s.get("kind") == "history" and s.get("reason") in _SPLITS), None)
    others = {x["gene"] for x in r.get("candidates", []) if not x.get("best")}
    if split is None or not others:
        return []
    return [
        _mark(
            "split_ranked",
            "a split: its successors ranked by score, not by place",
            f"The path of the best answer passes Ensembl's {str(split['reason']).replace('_', ' ')} at "
            f"{c.event(split)}, and {_plural(len(others), 'other gene')} {'was' if len(others) == 1 else 'were'} "
            "reached. IDTrack ranks the successors of a split by Ensembl's scores and the candidates' evidence, not by "
            "which of them lies where the old gene lay.",
        )
    ]


def _unscored(c: _Context) -> list[Mark]:
    n = max([0, *(x.get("unscored_steps", 0) for x in c.bests)])
    if n <= 0 or c.result.get("no_target"):
        return []
    return [
        _mark(
            "unscored",
            f"{_plural(n, 'step')} without Ensembl's score",
            f"The path of the best answer holds {_plural(n, 'history step')} between two different stable ids to which "
            "Ensembl gave no score.",
        )
    ]


def _final_other_release(c: _Context) -> list[Mark]:
    if not any(x.get("final_confidence") == 1 for x in c.bests):
        return []
    return [
        _mark(
            "final_other_release",
            "target attached at another release",
            "The id in the database asked is attached, at the target release, to a transcript or translation that "
            "belonged to the gene at another release, not to the gene itself.",
        )
    ]


def _read_elsewhere(c: _Context) -> list[Mark]:
    r = c.result
    if "read_at_another_release" not in (r.get("reasons") or []) or r.get("from_release") is None:
        return []
    given = r.get("from_release_given")
    given_text = "—" if given is None else given
    return [
        _mark(
            "read_at_another_release",
            f"read at release {r['from_release']}, not {given_text}",
            f"The graph does not hold {_code(r.get('query_id'))} at release {given_text}, the release given; it was "
            f"read at release {r['from_release']}, where the graph holds it. The answer is what the identifier meant "
            "there.",
        )
    ]


def _match(c: _Context) -> list[Mark]:
    r = c.result
    match = r.get("match")
    if not match:
        return []
    parts = str(match).split(":")
    step = parts.pop()
    synonym = "synonym" in parts
    loose = step in {"case", "separator"}
    found: list[tuple[str, str, str | None]] = []
    if synonym:
        anchor = "symbols-typed-in-small-letters-where-symbols-are-written-in-capitals" if loose else None
        found.append(("match_synonym", "read as a synonym", anchor))
    if "copy" in parts:
        found.append(("match_copy", "read as a copy of another item", None))
    if loose:
        words = "read without letter case" if step == "case" else "read with separators taken as one"
        found.append((f"match_{step}", words, None))
    if step == "version_newer_than_graph":
        found.append(("match_version_newer_than_graph", "version newer than the graph: read as its latest", None))
    if step == "version_not_judged":
        found.append(("match_version_not_judged", "version not judged", None))
    found += [(code, words, None) for prefix, (code, words) in _MATCH_NOTES.items() if prefix in parts]
    text = f"{_code(r.get('query_id'))} matched {_code(r.get('graph_id') or '—')} as {_code(match)}."
    return [_mark(code, words, text, **({"limitation": a} if a else {})) for code, words, a in found]


def _read_at_words(r: dict[str, Any]) -> str:
    """How the result itself was read: at the release given, at another, or without a release."""
    given, frm = r.get("from_release_given"), r.get("from_release")
    if given is None:
        return f"Without a release it is read as it is at release {frm}"
    if given == frm:
        return f"It was read at release {frm}, as given"
    return f"It was read at release {frm}, where the graph holds it"


def _readings(c: _Context) -> list[Mark]:
    r = c.result
    named = [id(o) for o in _number_readings(c)]
    best_genes = list(dict.fromkeys(x["gene"] for x in c.bests))
    out = []
    for reading in r.get("other_readings") or []:
        if id(reading) in named:
            continue
        reading_genes = list(reading.get("genes") or [])
        genes = ", ".join(map(_code, reading_genes)) or "no gene"
        if reading.get("reason") == "other_release" and reading.get("releases"):
            releases = list(reading["releases"])
            at = _ranges(releases)
            how = f"is read as {_code(reading.get('graph_id'))} (matched as {_code(reading.get('match'))})"
            if best_genes and set(reading_genes) == set(best_genes):
                many = len(best_genes) > 1
                out.append(
                    _mark(
                        "other_release_same_gene",
                        f"the same {'genes' if many else 'gene'} at releases {at}",
                        f"At releases {at}, {_code(r.get('query_id'))} {how}; read there, it answers the same "
                        f"{'genes' if many else 'gene'} as the best answer, {genes} at release {r.get('to_release')}. "
                        f"{_read_at_words(r)}; a list made at those releases means the same.",
                    )
                )
                continue
            other = [g for g in reading_genes if g not in best_genes]
            if reading.get("graph_id") == r.get("query_id") and other and best_genes:
                meant = f"named {'another gene' if len(other) == 1 else 'other genes'}"
            else:
                meant = how
            part = (
                ", part of the best answer"
                if reading_genes and not other and set(reading_genes) != set(best_genes)
                else ""
            )
            those = "that gene" if len(reading_genes) == 1 else "those genes" if reading_genes else "no gene"
            out.append(
                _mark(
                    "other_release",
                    f"another meaning at releases {at}",
                    f"At releases {at}, {_code(r.get('query_id'))} {meant}; read there, it answers {genes} at release "
                    f"{r.get('to_release')}{part}. {_read_at_words(r)}; a list made at that other time means {those}.",
                    read_at=releases[-1],
                )
            )
            continue
        same = reading.get("reason") == "same_step"
        out.append(
            _mark(
                "also_read_same_step" if same else "other_reading",
                f"also read as {_code(reading.get('graph_id'))}"
                if same
                else f"another reading: {_code(reading.get('graph_id'))}",
                f"{_code(r.get('query_id'))} is also read as {_code(reading.get('graph_id'))} (matched as "
                f"{_code(reading.get('match'))}; its answer: {genes}).",
                **(
                    {"limitation": "single-cell-suffixes-after-a-name-that-is-no-authority-s-symbol"}
                    if reading.get("reason") == "make_unique_suffix"
                    else {}
                ),
            )
        )
    return out


def _projected_symbols(c: _Context) -> list[Mark]:
    order = c.facts.symbol_databases
    asked = c.facts.asked or c.result.get("final_database")
    authority = order[0] if order else None
    if not order or not asked or authority is None or asked == authority or asked not in order:
        return []
    return [
        _mark(
            "projected_symbols",
            f"{asked} is not this organism's name authority",
            f"{asked} is a symbol database of this graph, after {authority} in IDTrack's order of the organism's "
            "symbol databases: it holds another authority's symbols as Ensembl projects them onto this organism's "
            f"genes. The organism's own name authority is {authority}.",
            ask={"words": f"Ask in {authority}", "final_database": authority},
        )
    ]


def _lowest_score(c: _Context) -> list[Mark]:
    if not c.explained or c.result.get("no_target"):
        return []
    scored = [s for s in c.steps if s.get("kind") in _HISTORY and s.get("weight") is not None and s["weight"] < 1]
    if not scored:
        return []
    low = min(scored, key=lambda s: s["weight"])
    return [
        _mark(
            "lowest_score",
            f"lowest Ensembl score {low['weight']!r}",
            f"The lowest of Ensembl's mapping scores on the path of the best answer is {low['weight']!r}, at "
            f"{c.event(low)}. The candidate's score is the product of the scores along its path.",
        )
    ]


#: Every rule, in the order a reader meets the classes: what the answer may be instead first, then the path.
RULES: tuple[Callable[[_Context], list[Mark]], ...] = (
    _bridge,
    _bridge_beside,
    _bridge_rival,
    _runner_named,
    _name_elsewhere,
    _own_continuation,
    _places_apart,
    _places_unknown,
    _outside_reference,
    _listed_as_copy,
    _number,
    _one_gene,
    _split_ranked,
    _unscored,
    _final_other_release,
    _read_elsewhere,
    _match,
    _readings,
    _projected_symbols,
    _lowest_score,
)

#: The fields of the conversion a mark's way on (``ask``) may change; the others are the result's own.
ASK_FIELDS = ("identifier", "from_release", "to_release", "final_database", "from_database")


def cautions_of(result: dict[str, Any], facts: Facts | None = None) -> list[dict[str, Any]]:
    """Return the cautions and notes of a result (its path read where it has one), cautions first.

    Args:
        result: IDTrack's ``ConversionResult.to_dict()``, with its path.
        facts: What the rules read beside the result (:py:class:`Facts`; ``None``: none, so the rules that need the
            organism's symbols hold no mark).

    Returns:
        list[dict[str, Any]]: Each ``{"code", "tone", "label", "text", "limitation", "alert", "ask", "read_at"}``, one
        per class of evidence (and, for the other readings of the string, one per reading), cautions before notes,
        each tone in the order of :py:data:`RULES`.
    """
    c = _Context(result, facts or Facts())
    made = []
    for rule in RULES:
        for mark in rule(c):
            tone, _, anchor = CAUTIONS[mark["code"]]
            ask = mark.get("ask")
            made.append(
                {
                    "code": mark["code"],
                    "tone": tone,
                    "label": mark["label"],
                    "text": mark["text"],
                    "limitation": limitation_url(mark.get("limitation", anchor)),
                    "alert": bool(mark.get("alert", False)),
                    "ask": None
                    if ask is None
                    else {
                        "words": ask["words"],
                        **{name: ask.get(name) for name in ASK_FIELDS},
                        "changes": [name for name in ASK_FIELDS if name in ask],
                    },
                    "read_at": mark.get("read_at"),
                }
            )
    return [m for m in made if m["tone"] == "caution"] + [m for m in made if m["tone"] == "note"]


def vocabulary_terms() -> list[dict[str, Any]]:
    """Return the cautions table of /vocabulary.

    Returns:
        list[dict[str, Any]]: Per code its tone, meaning, whether it reads the path, and its limitation's address.
    """
    return [
        {
            "code": code,
            "tone": tone,
            "meaning": meaning,
            "reads_path": code in PATH_CODES,
            "limitation": limitation_url(anchor),
            "source": "idtrack-web",
        }
        for code, (tone, meaning, anchor) in CAUTIONS.items()
    ]


__all__ = ["CAUTIONS", "PATH_CODES", "RULES", "Facts", "cautions_of", "limitation_url", "vocabulary_terms"]
