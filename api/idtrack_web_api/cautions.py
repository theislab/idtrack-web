"""The evidence of an answer a reader should weigh before trusting it: the api's reading of idtrack's own fields.

idtrack's result says how it read the identifier, which path each candidate took and how the candidates were ranked;
it does not say which of those facts make an answer one to review. The api reads them by the rules below, each a
general rule stated by what the fields mean (never a list of identifiers), and adds the result's ``cautions``: one item
per class of evidence that holds, each with its ``code`` (``cautions`` of ``GET /vocabulary`` gives its meaning), its
``tone`` (``caution``: it changes how far the answer can be trusted; ``note``: an exact fact about it that is no fault),
a sentence with the result's own values, and, where idtrack documents a limitation of that class, the address of that
section of idtrack's documentation.

The rules read the best answer: the candidates marked best, and the steps of their paths. A search is always made with
its path (a request without ``explain`` gets the result without it), so every rule holds for every answer; which
rules read the path is said per code (:py:data:`CAUTIONS`).
"""

from __future__ import annotations

import re
from typing import Any, Literal

Tone = Literal["caution", "note"]

#: Every class of evidence: its tone, what it means (the vocabulary's text), whether it reads the path, and the
#: section of idtrack's documentation of limitations that describes it (its anchor on ``limitations.html``), if any.
CAUTIONS: dict[str, tuple[Tone, str, str | None]] = {
    "bridge": (
        "caution",
        (
            "The best answer is reached through a bridge: where Ensembl's history gives a gene no successor, the walk "
            "left it through an id it carries and entered another gene that carries the same id. That is idtrack's "
            "inference; no record of Ensembl states it."
        ),
        "answers-that-only-a-bridge-reaches",
    ),
    "bridge_beside": (
        "caution",
        (
            "A bridge on the best answer's path joins two genes that lived at the same releases: the gene it enters "
            "did not take the place of the gene it leaves in Ensembl's records, so their shared ids are no sign of "
            "succession."
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
            "At other releases the same string names another gene (or reads as another id): a list made at that time "
            "means that gene. Read it at such a release (`from_release`) to have what it meant then."
        ),
        "without-a-release-a-string-is-what-it-means-today",
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
            "The targets are every id the best gene carries in the database asked: idtrack converts at the level of "
            "the gene, not the counterpart of the identifier alone."
        ),
        None,
    ),
    "split_ranked": (
        "note",
        (
            "The best answer descends through a split of Ensembl's history, and other successors were reached: "
            "idtrack ranks the successors of a split by Ensembl's scores and the candidates' evidence, not by which "
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
        "places_apart",
        "places_unknown",
        "outside_reference",
        "split_ranked",
        "lowest_score",
    }
)
#: The anchor that replaces ``copies-on-patches-and-alternative-loci`` for an LRG record's gene id (idtrack documents
#: that class apart).
_LRG_COPY = "the-grch37-gene-ids-of-lrg-records-list-their-answer-among-the-copies"
_HISTORY = frozenset({"history", "self_loop"})
_DIGITS = re.compile(r"[0-9]+")
_MATCH_NOTES = {
    "unicode": "match_unicode",
    "punctuation": "match_punctuation",
    "par_y": "match_par_y",
    "lrg": "match_lrg",
}


def limitation_url(anchor: str | None, docs_url: str) -> str | None:
    """Return the address of a section of idtrack's limitations (``None`` for none).

    Args:
        anchor: The section's anchor.
        docs_url: Where idtrack's documentation is published (its root, ending in ``/``).

    Returns:
        str | None: The address.
    """
    return None if anchor is None else f"{docs_url}limitations.html#{anchor}"


def _ids(values: list[str], most: int = 6) -> str:
    shown = ", ".join(f"`{v}`" for v in values[:most])
    return shown + (f" and {len(values) - most} more" if len(values) > most else "")


def _ranges(releases: list[int]) -> str:
    """Return releases as runs: ``52-60, 70``."""
    runs: list[list[int]] = []
    for release in sorted(releases):
        if runs and release == runs[-1][1] + 1:
            runs[-1][1] = release
        else:
            runs.append([release, release])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in runs)


def _releases(active: list[Any]) -> str:
    return ", ".join(f"{a} on" if b is None else str(a) if a == b else f"{a}-{b}" for a, b in active)


def _shared(left: list[Any], right: list[Any]) -> bool:
    """Whether two lives (lists of ``[first, last or null]``) hold at one release at least."""
    inf = float("inf")
    return any(
        max(a0, b0) <= min(inf if a1 is None else a1, inf if b1 is None else b1) for a0, a1 in left for b0, b1 in right
    )


class _Reader:
    """One result's best answer: its candidates, the steps of their paths, the path's nodes."""

    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.bests = [c for c in result.get("candidates", []) if c.get("best")]
        path = result.get("path") or {}
        self.steps_all: list[dict[str, Any]] = list(path.get("steps") or [])
        self.nodes = {n["id"]: n for n in path.get("nodes") or []}
        self.bridges: list[dict[str, Any]] = list(path.get("bridges") or [])
        seen: set[int] = set()
        self.steps: list[dict[str, Any]] = []
        for candidate in self.bests:
            for index in [*candidate.get("path", []), *candidate.get("final_path", [])]:
                if index not in seen and 0 <= index < len(self.steps_all):
                    seen.add(index)
                    self.steps.append(self.steps_all[index])
        self.explained = bool(self.steps)
        self.answers = not result.get("no_target") and bool(self.bests)


def _bridge_items(r: _Reader) -> list[tuple[str, str]]:
    result = r.result
    bridged = [c for c in r.bests if c.get("bridges", 0) > 0]
    if not bridged or result.get("no_target"):
        return []
    most = max(c["bridges"] for c in bridged)
    through = list(dict.fromkeys(s["target"] for s in r.steps if s.get("kind") == "bridge_near"))
    found = [
        (
            "bridge",
            f"The best answer is reached through {most} bridge{'s' if most > 1 else ''}"
            + (f" (through {_ids(through)})" if through else "")
            + ": idtrack's inference, which no record of Ensembl states.",
        )
    ]
    beside: list[str] = []
    for candidate in bridged:
        order = [*candidate.get("path", []), *candidate.get("final_path", [])]
        for i, index in enumerate(order):
            near = r.steps_all[index] if 0 <= index < len(r.steps_all) else None
            if near is None or near.get("kind") != "bridge_near" or near.get("source") is None:
                continue
            far = next(
                (
                    r.steps_all[j]
                    for j in order[i + 1 :]
                    if 0 <= j < len(r.steps_all) and r.steps_all[j].get("kind") == "bridge_far"
                ),
                None,
            )
            left, right = r.nodes.get(near["source"]), None if far is None else r.nodes.get(far["target"])
            if left is None or right is None or not _shared(left.get("active", []), right.get("active", [])):
                continue
            text = (
                f"`{left.get('label', left['id'])}` (releases {_releases(left.get('active', []))}) and "
                f"`{right.get('label', right['id'])}` (releases {_releases(right.get('active', []))})"
            )
            if text not in beside:
                beside.append(text)
    if beside:
        found.append(("bridge_beside", f"{'; '.join(beside)} lived at the same releases."))
    if result.get("decided_by") == "bridge_gap":
        runner = next((c for c in result.get("candidates", []) if not c.get("best") and c.get("bridges", 0) > 0), None)
        best = bridged[0]
        if runner is not None:

            def through_ids(candidate: dict[str, Any]) -> list[str]:
                genes = {
                    end
                    for index in [*candidate.get("path", []), *candidate.get("final_path", [])]
                    if 0 <= index < len(r.steps_all)
                    for end in (r.steps_all[index].get("source"), r.steps_all[index].get("target"))
                }
                return [
                    item[0]
                    for b in r.bridges
                    if b.get("taken") and b.get("target") in genes and b.get("source") in genes
                    for item in b.get("through", [])
                ]

            taken = set(through_ids(best))
            own = [i for i in dict.fromkeys(through_ids(runner)) if i not in taken]
            if own:
                labels = [r.nodes.get(i, {}).get("label", i) for i in own]
                found.append(
                    (
                        "bridge_rival",
                        (
                            f"`{runner['target']}` is reached by a bridge from the same gene through {_ids(labels)}, "
                            "ids the bridge taken does not pass; it ranks below by the bridge's gap alone "
                            f"({runner.get('bridge_gap')} "
                            f"against {best.get('bridge_gap')})."
                        ),
                    )
                )
    return found


def _place_items(r: _Reader) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    apart = [s for s in r.steps if s.get("kind") in _HISTORY and s.get("places") == "places_apart"]
    if apart:
        first = apart[0]
        found.append(
            (
                "places_apart",
                f"Ensembl's history at releases {first.get('old_release')} to {first.get('new_release')} joins "
                f"`{first.get('source')}` and `{first.get('target')}`, which do not lie at one place"
                + (f" ({len(apart)} such steps)" if len(apart) > 1 else "")
                + ".",
            )
        )
    unknown = [
        s
        for s in r.steps
        if s.get("kind") in _HISTORY
        and s.get("places") == "other_assemblies"
        and s.get("old_assembly") != s.get("assembly")
    ]
    targets = {s.get("target") for s in r.steps}
    unknown_bridges = [
        b for b in r.bridges if b.get("taken") and b.get("places") == "other_assemblies" and b.get("target") in targets
    ]
    count = len(unknown) + len(unknown_bridges)
    if count:
        found.append(
            (
                "places_unknown",
                (
                    f"{count} step{'s' if count > 1 else ''} of the path join{'' if count > 1 else 's'} genes that "
                    "never lie "
                    "on one assembly at the same time."
                ),
            )
        )
    return found


def _outside_items(r: _Reader, docs_url: str) -> list[tuple[str, str, str | None]]:
    result = r.result
    target = result.get("to_release")
    found: list[tuple[str, str, str | None]] = []
    genes = list(dict.fromkeys(c["gene"] for c in r.bests))
    if r.answers and r.nodes and genes and target is not None:
        outside = [
            g for g in genes if any(a <= target <= b for a, b in (r.nodes.get(g, {}).get("non_reference") or []))
        ]
        if len(outside) == len(genes):
            regions = list(
                dict.fromkeys(
                    p["region"]
                    for g in genes
                    for p in r.nodes.get(g, {}).get("places") or []
                    if not p.get("reference") and any(a <= target <= b for a, b in p.get("releases", []))
                )
            )
            found.append(
                (
                    "outside_reference",
                    f"At release {target}, {'the gene' if len(genes) == 1 else f'all {len(genes)} genes'} of the best "
                    "answer lie outside the reference sequence" + (f" ({_ids(regions, 4)})" if regions else "") + ".",
                    None,
                )
            )
    listed = [g for g in genes if g in (result.get("alternative_locus_genes") or [])]
    if listed and not result.get("no_target"):
        anchor = _LRG_COPY if str(result.get("query_id", "")).strip().startswith("LRG_") else None
        found.append(
            (
                "listed_as_copy",
                f"{_ids(listed)}, the best answer, is also listed in `alternative_locus_genes`.",
                limitation_url(anchor, docs_url) if anchor else None,
            )
        )
    return found


def _reading_items(r: _Reader) -> list[tuple[str, str]]:
    result = r.result
    found: list[tuple[str, str]] = []
    query = str(result.get("query_id", "")).strip()
    if _DIGITS.fullmatch(query) and result.get("graph_id") is not None and result.get("from_release") is not None:
        read = ", ".join(result.get("from_databases") or []) or "a database"
        old = result.get("from_release_inferred") and result.get("from_release") != result.get("to_release")
        if old:
            found.append(
                (
                    "bare_number",
                    (
                        f"`{query}` is held last at release {result['from_release']}, as a {read} id, and was read "
                        "there "
                        f"(no database holds it at release {result.get('to_release')})."
                    ),
                )
            )
        else:
            found.append(("number_read", f"`{query}` was read as a {read} id at release {result['from_release']}."))
    best_genes = {c["gene"] for c in r.bests}
    best_targets = {c["target"] for c in r.bests}
    if len(best_genes) == 1 and len(best_targets) > 1 and not result.get("no_target"):
        found.append(
            (
                "one_gene",
                (
                    f"The {len(best_targets)} targets are the ids `{next(iter(best_genes))}` carries in "
                    f"{result.get('final_database')} at release {result.get('to_release')}."
                ),
            )
        )
    return found


def _ranking_items(r: _Reader) -> list[tuple[str, str]]:
    result = r.result
    found: list[tuple[str, str]] = []
    if r.answers and r.explained:
        split = next(
            (s for s in r.steps if s.get("kind") == "history" and s.get("reason") in {"split", "split_and_merge"}), None
        )
        others = {c["gene"] for c in result.get("candidates", []) if not c.get("best")}
        if split is not None and others:
            found.append(
                (
                    "split_ranked",
                    (
                        f"The path passes Ensembl's {str(split['reason']).replace('_', ' ')} at releases "
                        f"{split.get('old_release')} to {split.get('new_release')}, and {len(others)} other "
                        f"gene{'s were' if len(others) > 1 else ' was'} reached."
                    ),
                )
            )
    unscored = max((c.get("unscored_steps", 0) for c in r.bests), default=0)
    if unscored > 0 and not result.get("no_target"):
        found.append(("unscored", f"{unscored} history step{'s' if unscored > 1 else ''} without Ensembl's score."))
    if any(c.get("final_confidence") == 1 for c in r.bests):
        found.append(("final_other_release", "A target is attached to a transcript or translation of another release."))
    if "read_at_another_release" in (result.get("reasons") or []) and result.get("from_release") is not None:
        found.append(
            (
                "read_at_another_release",
                f"Read at release {result['from_release']}, not {result.get('from_release_given')}, the release given.",
            )
        )
    return found


def _match_items(r: _Reader) -> list[tuple[str, str]]:
    result = r.result
    match = result.get("match")
    if not match:
        return []
    parts = str(match).split(":")
    step = parts.pop()
    where = f"`{result.get('query_id')}` matched `{result.get('graph_id')}` as `{match}`."
    codes = []
    if "synonym" in parts:
        codes.append("match_synonym")
    if "copy" in parts:
        codes.append("match_copy")
    if step in {"case", "separator", "version_newer_than_graph", "version_not_judged"}:
        codes.append(f"match_{step}")
    codes += [code for prefix, code in _MATCH_NOTES.items() if prefix in parts]
    return [(code, where) for code in codes]


def _other_items(r: _Reader) -> list[tuple[str, str]]:
    result = r.result
    found: list[tuple[str, str]] = []
    for reading in result.get("other_readings") or []:
        genes = _ids(list(reading.get("genes") or [])) or "no gene"
        if reading.get("reason") == "other_release" and reading.get("releases"):
            releases = reading["releases"]
            found.append(
                (
                    "other_release",
                    (
                        f"At releases {_ranges(releases)}, `{result.get('query_id')}` was read as "
                        f"`{reading.get('graph_id')}`; read there, it answers {genes} at release "
                        f"{result.get('to_release')}."
                    ),
                )
            )
        else:
            code = "also_read_same_step" if reading.get("reason") == "same_step" else "other_reading"
            found.append(
                (code, f"Also read as `{reading.get('graph_id')}` (as `{reading.get('match')}`), answering {genes}.")
            )
    return found


def _lowest_item(r: _Reader) -> list[tuple[str, str]]:
    if not (r.answers and r.explained):
        return []
    scored = [s for s in r.steps if s.get("kind") in _HISTORY and s.get("weight") is not None and s["weight"] < 1]
    if not scored:
        return []
    low = min(scored, key=lambda s: s["weight"])
    return [
        (
            "lowest_score",
            (
                f"The lowest of Ensembl's scores on the path is {low['weight']!r}, at releases "
                f"{low.get('old_release')} to "
                f"{low.get('new_release')}."
            ),
        )
    ]


def cautions_of(result: dict[str, Any], docs_url: str) -> list[dict[str, Any]]:
    """Return the cautions and notes of a result (its path read where it has one), cautions first.

    Args:
        result: idtrack's ``ConversionResult.to_dict()``, with its path.
        docs_url: Where idtrack's documentation is published (its root, ending in ``/``).

    Returns:
        list[dict[str, Any]]: Each ``{"code", "tone", "text", "limitation"}``, one per class of evidence (and, for the
        readings of the same string, one per reading), in the order a reader meets them.
    """
    r = _Reader(result)
    found: list[tuple[str, str, str | None]] = []
    for code, text in _bridge_items(r) + _place_items(r):
        found.append((code, text, None))
    found += _outside_items(r, docs_url)
    for items in (_reading_items(r), _ranking_items(r), _match_items(r), _other_items(r), _lowest_item(r)):
        found += [(code, text, None) for code, text in items]
    made = []
    for code, text, own in found:
        tone, _, anchor = CAUTIONS[code]
        made.append({"code": code, "tone": tone, "text": text, "limitation": own or limitation_url(anchor, docs_url)})
    if r.result.get("match", "") and "synonym" in str(r.result.get("match")).split(":")[:-1]:
        step = str(r.result.get("match")).split(":")[-1]
        if step in {"case", "separator"}:  # a synonym read without letter case: idtrack documents that class
            for item in made:
                if item["code"] == "match_synonym":
                    item["limitation"] = limitation_url(
                        "symbols-typed-in-small-letters-where-symbols-are-written-in-capitals", docs_url
                    )
    return [item for item in made if item["tone"] == "caution"] + [item for item in made if item["tone"] == "note"]


def vocabulary_terms(docs_url: str) -> list[dict[str, Any]]:
    """Return the ``cautions`` table of ``/vocabulary``.

    Args:
        docs_url: Where idtrack's documentation is published.

    Returns:
        list[dict[str, Any]]: Per code its tone, meaning, whether it reads the path, and its limitation's address.
    """
    return [
        {
            "code": code,
            "tone": tone,
            "meaning": meaning,
            "reads_path": code in PATH_CODES,
            "limitation": limitation_url(anchor, docs_url),
            "source": "idtrack-web",
        }
        for code, (tone, meaning, anchor) in CAUTIONS.items()
    ]


__all__ = ["CAUTIONS", "PATH_CODES", "cautions_of", "limitation_url", "vocabulary_terms"]
