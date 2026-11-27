"""The api's own tables of ``/vocabulary`` follow idtrack: each fails here when idtrack's set of codes changes."""

from __future__ import annotations

import dataclasses
import inspect

from idtrack import results
from idtrack.engine import ranking

from idtrack_web_api.vocabulary import ANNOTATION_TEXT, ANSWERING_STATUSES, CRITERION_FIELDS, STATUS_MEANINGS


def test_status_meanings_are_idtracks_statuses() -> None:
    # idtrack's STATUSES has no texts; if it gains them, `/vocabulary` takes idtrack's and this table goes.
    assert isinstance(results.STATUSES, tuple)
    assert set(STATUS_MEANINGS) == set(results.STATUSES)
    assert all(text.strip() for text in STATUS_MEANINGS.values())
    # The statuses that answer in the database asked are statuses, and their meanings say so.
    assert set(results.STATUSES) >= ANSWERING_STATUSES
    assert all(
        "requested database" in STATUS_MEANINGS[code] or "Several" in STATUS_MEANINGS[code]
        for code in ANSWERING_STATUSES
    )


def test_criterion_fields_are_idtracks_criteria() -> None:
    # idtrack's CRITERIA has no table of the fields compared; if it gains one, `/vocabulary` takes it.
    assert isinstance(results.CRITERIA, tuple)
    assert list(CRITERION_FIELDS) == list(results.CRITERIA)
    fields = {f.name for f in dataclasses.fields(results.Candidate)}
    for compared in CRITERION_FIELDS.values():
        assert compared
        for field, first, parts in compared:
            assert field in fields
            assert first in {"yes", "lower", "higher"}
            assert parts is None or field == "annotation"


def test_criterion_fields_read_idtracks_ranking() -> None:
    """The fields each criterion compares are the parts of idtrack's ranking key named so."""
    assert ranking.LINEAGE_CRITERIA == ("final_confidence", "bridges", "bridge_gap", "display_name", "entry_support")
    lineage = [CRITERION_FIELDS[c][0][0] for c in ranking.LINEAGE_CRITERIA]
    # make_pair's lineage: (final confidence, bridges, bridge gap, display rank, -support), lowest first.
    assert lineage == ["final_confidence", "bridges", "bridge_gap", "display_rank", "entry_support"]
    source = inspect.getsource(ranking.make_pair)
    assert "lineage = (confidence, bridges, gap, display_rank, -support)" in source
    assert "within = (unscored, -round(score, 12), 0 if same_as_query else 1)" in source
    assert [f for f, _, _ in CRITERION_FIELDS["score"]] == ["unscored_steps", "score"]


def test_annotation_parts_are_idtracks_words() -> None:
    doc = inspect.getdoc(results.Candidate) or ""
    assert ANNOTATION_TEXT in doc.replace("``", "")
    [(_, _, parts)] = CRITERION_FIELDS["annotation"]
    assert parts is not None
    assert "(" + ", ".join(f"-{part}" for part in parts) + ")" == ANNOTATION_TEXT
