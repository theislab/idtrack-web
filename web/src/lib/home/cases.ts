// The cases the Convert page shows before a conversion come from the server's showcase of the graph (each a query,
// the kind of phenomenon its answer shows, and the answer: api/idtrack_web_api/showcase_data/). What is written here
// is what a kind means, once for every organism: a title and the concept in plain words, after idtrack's documentation
// (each links to the section that states it). The facts of each case (its identifier, releases, scores, genes) are
// read from its answer on the card, never written here.
import type { CaseKind } from "./caseKinds";

/** A conversion as the page's address writes it (`/?organism=&id=&from=&to=&db=`). */
export interface CaseQuery {
  organism: string;
  identifier: string;
  from?: number;
  to?: number;
  db?: string;
}

export interface KindText {
  title: string;
  /** The concept in plain words. */
  concept: string;
  /** The section of idtrack's documentation that states it. */
  href: string;
}

// Pages of idtrack's documentation, resolved where they are drawn (lib/links.ts `docsPage`).
const HISTORY = "concepts.html#concept-history";

export const KIND_TEXT: Record<CaseKind, KindText> = {
  lineage: {
    title: "A lineage across assemblies",
    concept:
      "An identifier is followed release by release through every version Ensembl gave the gene, across each change of genome assembly, to the release asked.",
    href: HISTORY,
  },
  renamed: {
    title: "A renamed gene",
    concept:
      "Symbols change while genes stay. A symbol of an old table is read at the release the table was made with, and the gene it named there is followed to its symbol at the release asked.",
    href: "reading.html",
  },
  new_version: {
    title: "A new version",
    concept:
      "When Ensembl changes a gene's model it keeps the id and raises its version. Each version change is followed, with Ensembl's score of how much of the gene it kept.",
    href: HISTORY,
  },
  replaced: {
    title: "A replacement",
    concept:
      "Ensembl can retire an id and record another id as the one that continues it. That record is followed, so the old id answers the gene that replaced it.",
    href: HISTORY,
  },
  split: {
    title: "A split",
    concept:
      "Ensembl recorded one gene becoming several. Every descendant is followed and ranked by idtrack's criteria in their order, among them the product of Ensembl's scores along its path and, where all else is equal, the gene's annotation; the first is the answer, and the others stay listed with their places.",
    href: "concepts.html#concept-ranking",
  },
  merge: {
    title: "A merge",
    concept: "Ensembl recorded several genes becoming one. Each of the old ids answers the gene they became.",
    href: HISTORY,
  },
  handoff: {
    title: "Across a genome assembly",
    concept:
      "An identifier of an earlier assembly converts to the gene of the assembly that serves the target release, through Ensembl's history across the assembly change.",
    href: "concepts.html#concept-releases-assemblies",
  },
  bridge: {
    title: "A bridge, marked as one",
    concept:
      "Where Ensembl's history gives a gene no successor, the walk can pass to another gene that carried the same external id, where idtrack's rules allow it: the two genes overlap, or their places cannot be compared and the id left one gene for the other. No Ensembl record states that step: it is idtrack's inference, and the answer says so.",
    href: "concepts.html#concept-bridges",
  },
  other_release: {
    title: "A name with another meaning",
    concept:
      "A string can name one gene at some releases and another gene at others. It is read at the release given, and its meaning at the other releases is reported beside the answer.",
    href: "reading.html",
  },
  tie: {
    title: "A tie, not a guess",
    concept:
      "When the evidence cannot tell genes apart, all of them are the best answer, in a stated order: idtrack does not pick one.",
    href: "concepts.html#concept-ties",
  },
  final: {
    title: "An answer in another database",
    concept: "The answer can be an id of another database: the id the gene carries there at the release asked.",
    href: "databases.html",
  },
  retired: {
    title: "A retired gene",
    concept:
      "A gene that Ensembl retired without a successor answers no gene at a later release, unless a bridge (idtrack's inference, marked as one) reaches another gene; an answer without a gene says why.",
    href: "concepts.html#concept-statuses",
  },
  refused: {
    title: "A step not followed",
    concept:
      "A step of Ensembl's history between a gene of the mitochondrial genome and a gene of a nuclear sequence is no lineage: it is refused, and listed with its reason.",
    href: HISTORY,
  },
};
