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


def test_another_gene_that_may_be_meant_is_said_with_its_way_on(human: TestClient) -> None:
    """HLA-DRB3 read at 70 in HGNC symbols: the tie is read through UniProt's gene names alone, while HGNC gives the
    name to the copies set apart; the retired MIR21 gene id: a bridge enters a host gene, and the gene that holds the
    miRNA's accession today ranks below by the bridge's gap alone."""
    hla = human.get(
        f"{P}/organisms/homo_sapiens/convert",
        params={"identifier": "HLA-DRB3", "from_release": 70, "to_release": 70, "final_database": "HGNC Symbol"},
    ).json()
    [elsewhere] = [c for c in hla["cautions"] if c["code"] == "name_elsewhere"]
    assert elsewhere["alert"] and elsewhere["ask"]["from_database"] == "HGNC Symbol"
    assert elsewhere["ask"]["changes"] == ["from_database"]
    retired = human.get(
        f"{P}/organisms/homo_sapiens/convert", params={"identifier": "ENSG00000199004", "from_release": 84}
    ).json()
    codes = [c["code"] for c in retired["cautions"]]
    assert codes[:3] == ["bridge", "bridge_beside", "bridge_rival"]
    rival = retired["cautions"][2]
    assert rival["alert"] and rival["ask"]["identifier"] == "MI0000077"
