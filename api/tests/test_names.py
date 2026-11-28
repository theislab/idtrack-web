"""The tool's name in the texts the API serves: IDTrack in prose, ``idtrack`` only where it is code.

Code is a code span (between backticks), an address, a path, a header, a package or command name joined to the word
(``idtrack-web``, ``Idtrack-Graph-Digest``, ``idtrack.API``). The words of IDTrack itself that the API passes on are
its own and are left as IDTrack wrote them: the terms of ``/vocabulary`` whose ``source`` is ``idtrack``, and the
descriptions of the OpenAPI document taken from the docstrings of IDTrack's result classes.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from idtrack_web_api import docs
from idtrack_web_api.adapter import RESULT_CLASSES
from idtrack_web_api.schemas import attribute_docs, plain_text

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

P = "/api/v1"
_CODE = re.compile(r"`[^`]*`")
_ADDRESS = re.compile(r"https?://\S+")
#: The name as a word of prose: not joined to a path, an address, a package or a header by ``-./:_@#``.
_BARE = re.compile(r"(?<![\w./\-#:@])idtrack(?![\w\-/:@#])(?!\.\w)")
_KEYS = ("description", "summary", "title", "x-recorded", "meaning", "message", "text", "label", "retry")


def bare_names(text: str) -> list[str]:
    """Return each prose use of the lower-case name in a text, with the words around it."""
    prose = _ADDRESS.sub("<address>", _CODE.sub("<code>", text))
    return [prose[max(0, m.start() - 50) : m.end() + 50] for m in _BARE.finditer(prose)]


def package_texts() -> set[str]:
    """Every text IDTrack's result classes give in their docstrings, as the API's document writes it."""
    found: set[str] = set()
    for cls in RESULT_CLASSES.values():
        found |= {plain_text(t) for t in attribute_docs(cls).values()}
        if cls.__doc__:
            found |= {plain_text(part.strip()) for part in cls.__doc__.split("\n\n")}
    return found


def prose_of(node: Any, quoted: set[str], where: str = "") -> list[tuple[str, str]]:
    """Every prose use of the lower-case name in a JSON value's texts, with where it is (IDTrack's own words left)."""
    found: list[tuple[str, str]] = []
    if isinstance(node, dict):
        if node.get("source") == "idtrack":
            return found  # a term in IDTrack's own words
        for key, value in node.items():
            if key in {"example", "examples", "value"}:
                continue  # recorded answers: data
            if isinstance(value, str) and key in _KEYS and value not in quoted:
                found += [(f"{where}/{key}", text) for text in bare_names(value)]
            else:
                found += prose_of(value, quoted, f"{where}/{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            found += prose_of(value, quoted, f"{where}[{i}]")
    return found


def test_the_documents_write_idtrack_in_prose(client: TestClient) -> None:
    """The OpenAPI document, the index, the vocabulary, the limits, the versions and the texts for programs."""
    quoted = package_texts()
    found: list[tuple[str, str]] = []
    for path in ("/openapi.json", "", "/vocabulary", "/limits", "/version", "/organisms"):
        found += prose_of(client.get(f"{P}{path}").json(), quoted, path or "/")
    for path in ("/llms.txt", "/llms-full.txt"):
        found += [(path, text) for line in client.get(path).text.splitlines() for text in bare_names(line)]
    assert found == []
    document = client.get(f"{P}/openapi.json").json()
    assert document["info"]["title"] == "IDTrack web API"
    assert client.get("/llms.txt").text.startswith("# IDTrack web API\n")


def test_answers_write_idtrack_in_prose(client: TestClient) -> None:
    """The API's own words in answers: cautions, refusals, the table's provenance line."""
    found: list[tuple[str, str]] = []
    batch = client.post(
        f"{P}/organisms/pig/convert/batch",
        json={"identifiers": ["ENSSSCG00000038317", "1898", "NOT_A_GENE", "TP53"], "explain": True},
    ).json()
    found += prose_of(batch, set(), "batch")
    for refused in (
        client.get(f"{P}/organisms/pig/convert", params={"identifier": ""}),
        client.get(f"{P}/organisms/nowhere/convert", params={"identifier": "TP53"}),
        client.get(f"{P}/organisms/pig/convert", params={"identifier": "TP53", "to_release": "x"}),
        client.post(f"{P}/organisms/pig/source-inference", json={"identifiers": ["TP53"], "mode": "x"}),
    ):
        found += prose_of(refused.json(), set(), str(refused.url))
    table = client.post(f"{P}/organisms/pig/convert/batch?format=tsv&provenance=true", json={"identifiers": ["TP53"]})
    found += [("tsv", text) for text in bare_names(table.text.splitlines()[0])]
    assert found == []


def test_the_texts_for_programs_name_idtrack_in_code_only() -> None:
    """The texts are written from one source: a bare name in a template of ``docs`` fails here too."""
    for template in (docs._READING_TEXT, docs._RULES):  # noqa: SLF001 - the templates themselves
        assert [t for line in template.splitlines() for t in bare_names(line)] == []
