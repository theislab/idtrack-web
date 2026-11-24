"""The tests on real graphs find the pig graph in ``IDTRACK_WEB_TEST_GRAPHS``, or skip with the reason in words."""

from __future__ import annotations

from pathlib import Path

from tests.conftest import REAL_ORGANISM, real_graph_of


def test_not_set() -> None:
    assert real_graph_of(None) == "IDTRACK_WEB_TEST_GRAPHS is not set: no real graph"


def test_a_folder_without_the_organism(tmp_path: Path) -> None:
    (tmp_path / "macaca_fascicularis").mkdir()
    (tmp_path / "macaca_fascicularis" / "graph.npz").write_bytes(b"")
    reason = real_graph_of(tmp_path)
    assert isinstance(reason, str)
    assert f"holds no {REAL_ORGANISM}/<graph>.npz" in reason
    assert "SETUP.md, section 5" in reason
    (tmp_path / REAL_ORGANISM).mkdir()
    assert isinstance(real_graph_of(tmp_path), str)  # an empty organism folder


def test_one_graph_or_too_many(tmp_path: Path) -> None:
    (tmp_path / REAL_ORGANISM).mkdir()
    first = tmp_path / REAL_ORGANISM / "graph_a.npz"
    first.write_bytes(b"")
    assert real_graph_of(tmp_path) == first
    (tmp_path / REAL_ORGANISM / "graph_b.npz").write_bytes(b"")
    reason = real_graph_of(tmp_path)
    assert isinstance(reason, str)
    assert "2 graph files" in reason
