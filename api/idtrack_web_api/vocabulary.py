"""What the codes of the answers mean (``/vocabulary``): idtrack's own tables, and the api's where idtrack has none.

Every code idtrack's results carry is listed from idtrack's own table of it (:py:mod:`idtrack_web_api.adapter`), with
idtrack's text wherever idtrack gives one. Two readings idtrack does not give as data are the api's, kept here and
nowhere else, each marked as the api's (``source``), and each tied by a test (``tests/test_vocabulary.py``) to
idtrack's set of codes, so that a change of idtrack fails the tests until the table follows it:

- :py:data:`STATUS_MEANINGS`: the meaning of each status (idtrack's ``STATUSES`` holds the codes only; the words below
  restate idtrack's documentation of ``ConversionResult.status`` and ``reasons``).
- :py:data:`CRITERION_FIELDS`: for each criterion, the ``Candidate`` fields the ranking compares and which value ranks
  first, and the parts of a field that is a tuple (idtrack names them only in the field's text and in
  ``idtrack.engine.ranking``).
"""

from __future__ import annotations

from typing import Any, Literal

from idtrack_web_api import schemas
from idtrack_web_api.adapter import (
    BRIDGE_RULES,
    BRIDGE_RULES_TAKEN,
    CRITERIA,
    MATCH_PREFIXES,
    MATCH_STEPS,
    PLACE_RELATIONS,
    READING_REASONS,
    REASONS,
    RESULT_CLASSES,
    STATUSES,
    STEP_REASONS,
)
from idtrack_web_api.errors import CODES

#: The meaning of each value of ``ConversionResult.status``, in the api's words: idtrack's table ``STATUSES`` holds the
#: codes only. Each restates idtrack's documentation of the status (its usage guide, "Outcome", and the attributes of
#: ``ConversionResult``); the keys are idtrack's set of statuses, which a test compares.
STATUS_MEANINGS: dict[str, str] = {
    "converted": "One best answer: the identifier leads to one target in the requested database.",
    "tie": (
        "Several genes or targets are equal in all the evidence that decides; all of them are the best answer, in "
        "ascending order of gene id and target id."
    ),
    "no_target": (
        "Genes were reached at the target release, but none of the genes of the best answer has an id in the "
        "requested database: the candidates are the genes themselves, never another gene's id."
    ),
    "not_found": "The identifier is not in the graph: unknown, or of a database the graph does not include.",
    "unknown_version": (
        "An Ensembl id or a sequence accession with a version the graph does not hold; the versions that exist are "
        "listed (`known_versions`), and no other version's gene is answered."
    ),
    "no_conversion": (
        "The identifier is in the graph, but no gene at the target release descends from it (a retired id, for "
        "instance); `reasons` says why."
    ),
    "error": "In a batch: the conversion of this identifier raised an error (`error`); the batch went on.",
}

First = Literal["yes", "lower", "higher"]

#: For each criterion of idtrack's ``CRITERIA``: the ``Candidate`` fields the ranking compares, in order, each with the
#: value that ranks first, and for a field that is a tuple the names of its parts (each part the negated count, as the
#: field's text in idtrack states: ``(-external ids, -transcripts, -translations)``). Read from idtrack's ranking
#: (``idtrack.engine.ranking.make_pair``, ``decided_by``); the keys are idtrack's criteria, which a test compares.
CRITERION_FIELDS: dict[str, tuple[tuple[str, First, tuple[str, ...] | None], ...]] = {
    "own_version": (("own_version", "yes", None),),
    "final_confidence": (("final_confidence", "lower", None),),
    "bridges": (("bridges", "lower", None),),
    "bridge_gap": (("bridge_gap", "lower", None),),
    "display_name": (("display_rank", "lower", None),),
    "entry_support": (("entry_support", "higher", None),),
    "score": (("unscored_steps", "lower", None), ("score", "higher", None)),
    "same_as_query": (("same_as_query", "yes", None),),
    "annotation": (("annotation", "lower", ("external ids", "transcripts", "translations")),),
}

#: The names of the parts of ``Candidate.annotation`` as idtrack's text of that field writes them (a test reads them
#: there): each part is the negated count.
ANNOTATION_TEXT = "(-external ids, -transcripts, -translations)"


def _terms(table: dict[str, str]) -> list[dict[str, Any]]:
    return [{"code": code, "meaning": schemas.plain_text(text), "source": "idtrack"} for code, text in table.items()]


def vocabulary() -> dict[str, Any]:
    """Return the body of ``/vocabulary``.

    Returns:
        dict[str, Any]: As :py:class:`idtrack_web_api.schemas.VocabularyResponse` describes it.
    """
    candidate = schemas.attribute_docs(RESULT_CLASSES["Candidate"])
    return {
        "statuses": [{"code": code, "meaning": STATUS_MEANINGS[code], "source": "idtrack-web"} for code in STATUSES],
        "reasons": _terms(REASONS),
        "step_reasons": _terms(STEP_REASONS),
        "criteria": [
            {
                "code": code,
                "meaning": candidate.get(code),
                "source": "idtrack",
                "fields": [
                    {"field": field, "first": first, "parts": None if parts is None else list(parts)}
                    for field, first, parts in CRITERION_FIELDS[code]
                ],
            }
            for code in CRITERIA
        ],
        "candidate_fields": _terms(candidate),
        "match_steps": _terms(MATCH_STEPS),
        "match_prefixes": _terms(MATCH_PREFIXES),
        "reading_reasons": _terms(READING_REASONS),
        "place_relations": _terms(PLACE_RELATIONS),
        "bridge_rules": [
            {
                "code": code,
                "meaning": schemas.plain_text(text),
                "source": "idtrack",
                "taken": code in BRIDGE_RULES_TAKEN,
            }
            for code, text in BRIDGE_RULES.items()
        ],
        "errors": [{"code": code, "status": status, "meaning": text} for code, (status, text) in CODES.items()],
    }


__all__ = ["ANNOTATION_TEXT", "CRITERION_FIELDS", "STATUS_MEANINGS", "vocabulary"]
