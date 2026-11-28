"""The document of IDTrack's limitations that the site cites, and its sections.

The site cites one document of IDTrack's known limitations: ``docs/limitations.rst`` of IDTrack's repository at the
documentation commit the pages quote (``docsCommit`` of ``web/src/generated/limitations.json``, a commit after the one
the API pins whose changes are documentation only, so that it describes the code the server runs). A caution's
``limitation`` (:py:mod:`idtrack_web_api.cautions`) and every link of the API's texts to a limitation are addresses of
its sections, so that each names a section that exists; the published documentation (Read the Docs' ``stable``) is the
document of the release, which lacks the sections written since.

The document and its sections are written here, not read at run time: a server holds no checkout of IDTrack's
repository nor the page's sources. ``tests/test_vocabulary.py`` holds them to the page's generated file (the same
commit, every section and title), so that a change of the pin fails there until both agree.
"""

from __future__ import annotations

#: The document: IDTrack's ``docs/limitations.rst`` at the documentation commit the pages quote.
DOCUMENT = "https://github.com/theislab/idtrack/blob/8ebaaa18491eed6fe1ac101808b852e5025802ec/docs/limitations.rst"

#: Every section of the document by its anchor, with its title, in the document's order.
SECTIONS: dict[str, str] = {
    "without-a-release-a-string-is-what-it-means-today": "Without a release, a string is what it means today",
    "places-across-an-assembly-change": "Places across an assembly change",
    "copies-on-patches-and-alternative-loci": "Copies on patches and alternative loci",
    "numbers-that-several-numbering-schemes-share": "Numbers that several numbering schemes share",
    "a-branch-can-outrank-the-gene-s-own-continuation": "A branch can outrank the gene's own continuation",
    "an-id-that-ensembl-moves-to-another-place": "An id that Ensembl moves to another place",
    "an-id-with-two-lives": "An id with two lives",
    "an-id-that-is-a-transcript-at-some-releases-and-a-translation-at-others": (
        "An id that is a transcript at some releases and a translation at others"
    ),
    "a-symbol-of-the-name-authority-can-answer-another-gene": "A symbol of the name authority can answer another gene",
    "a-name-that-another-source-gives-another-gene": "A name that another source gives another gene",
    "a-name-in-one-letter-case-that-another-gene-s-link-spells-so": (
        "A name in one letter case that another gene's link spells so"
    ),
    "symbols-typed-in-small-letters-where-symbols-are-written-in-capitals": (
        "Symbols typed in small letters where symbols are written in capitals"
    ),
    "answers-that-only-a-bridge-reaches": "Answers that only a bridge reaches",
    "a-retired-gene-whose-accession-another-gene-holds-today": (
        "A retired gene whose accession another gene holds today"
    ),
    "a-split-gene-converted-to-an-external-database": "A split gene converted to an external database",
    "among-the-successors-of-a-split-the-best-answer-does-not-look-at-the-old-place": (
        "Among the successors of a split, the best answer does not look at the old place"
    ),
    "refseq-mrna-in-mouse-releases-80-and-81": "RefSeq_mRNA in mouse releases 80 and 81",
    "the-support-of-a-name-counts-other-letter-cases": "The support of a name counts other letter cases",
    "single-cell-suffixes-after-a-name-that-is-no-authority-s-symbol": (
        "Single-cell suffixes after a name that is no authority's symbol"
    ),
    "the-grch37-gene-ids-of-lrg-records-list-their-answer-among-the-copies": (
        "The GRCh37 gene ids of LRG records list their answer among the copies"
    ),
    "low-9-quotation-marks": "Low-9 quotation marks",
    "databases-the-graph-does-not-hold": "Databases the graph does not hold",
    "mgi-s-symbols-of-mouse-releases-48-to-54-that-are-havana-ids": (
        "MGI's symbols of mouse releases 48 to 54 that are Havana ids"
    ),
    "mirbase-s-names-on-mirna-genes-only": "miRBase's names on miRNA genes only",
    "synonyms-that-are-fragments-of-uniprot-s-evidence-text": "Synonyms that are fragments of UniProt's evidence text",
    "ensembl-s-cross-references-against-the-databases-own-files": (
        "Ensembl's cross references against the databases' own files"
    ),
}

#: The address of the whole list of limitations (the document's heading).
EVERY = f"{DOCUMENT}#limitations"


def url(anchor: str) -> str:
    """Return the address of a section of the document.

    Args:
        anchor: The section's anchor (a key of :py:data:`SECTIONS`).

    Returns:
        str: The address.

    Raises:
        KeyError: For an anchor that is no section of the document.
    """
    if anchor not in SECTIONS:
        raise KeyError(anchor)
    return f"{DOCUMENT}#{anchor}"


def link(anchor: str) -> str:
    """Return a Markdown link to a section: its title, to its address.

    Args:
        anchor: The section's anchor.

    Returns:
        str: ``[title](address)``.
    """
    return f"[{SECTIONS[anchor]}]({url(anchor)})"


__all__ = ["DOCUMENT", "EVERY", "SECTIONS", "link", "url"]
