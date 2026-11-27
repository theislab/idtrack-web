"""The cautions on the real human graph: a documented class of wrong answers carries its sign (skipped without it)."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.test_real_showcase import client_of

if TYPE_CHECKING:
    from collections.abc import Iterator

    from fastapi.testclient import TestClient

P = "/api/v1"
pytestmark = pytest.mark.real


@pytest.fixture(scope="module")
def human(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    yield from client_of("homo_sapiens", tmp_path_factory)


def test_a_number_answered_by_copies_off_the_reference_says_so(human: TestClient) -> None:
    """`1898` is held last as a Havana number of release 52, and every gene it answers at 115 lies on a haplotype of
    the MHC region: the answer is a tie, and both facts are cautions, with or without the path, in a batch too."""
    alone = human.get(f"{P}/organisms/homo_sapiens/convert", params={"identifier": "1898"}).json()
    assert alone["status"] == "tie"
    codes = [c["code"] for c in alone["cautions"] if c["tone"] == "caution"]
    assert codes == ["outside_reference", "bare_number"]
    assert alone["cautions"][0]["limitation"].endswith("#copies-on-patches-and-alternative-loci")
    batch = human.post(f"{P}/organisms/homo_sapiens/convert/batch", json={"identifiers": ["1898", "TP53"]}).json()
    assert batch["results"][0]["cautions"] == alone["cautions"]
    assert [c for c in batch["results"][1]["cautions"] if c["tone"] == "caution"] == []
