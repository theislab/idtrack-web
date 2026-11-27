// What a `no_target` result says, and no more: idtrack ranks the genes reached as Ensembl genes and takes the target
// from the genes of the best answer; where none of them has an id in the database asked for, the result is the genes.
// So the absence is the best answer's only: the other genes reached were not looked up in the database, and may have
// an id there (idtrack's known limitation on a gene whose history splits, in its documentation's own words).
import type { ConversionResult } from "../api/types";
import limitations from "../generated/limitations.json";

export interface NoTarget {
  /** The genes of the best answer: those the absence of an id is stated for. */
  best: string[];
  /** The other genes reached, ranked below: their ids in the database were not looked up. */
  others: string[];
  /** idtrack's own sentence of the limitation, where the path holds a split (else null). */
  limitation: string | null;
}

/** The words idtrack's limitation on splits begins with, by which its item of the generated list is found. */
const SPLIT_LIMITATION_START = "A gene whose history splits";

export function splitLimitation(): string | null {
  return limitations.items.find((item) => item.startsWith(SPLIT_LIMITATION_START)) ?? null;
}

export function noTargetOf(result: ConversionResult): NoTarget | null {
  if (!result.no_target) return null;
  const best = [...new Set(result.candidates.filter((c) => c.best).map((c) => c.gene))];
  const others = [...new Set(result.candidates.filter((c) => !c.best).map((c) => c.gene))].filter(
    (gene) => !best.includes(gene),
  );
  const split = (result.path?.steps ?? []).some(
    (step) => step.kind === "history" && ["split", "split_and_merge"].includes(step.reason),
  );
  return { best, others, limitation: others.length && split ? splitLimitation() : null };
}

/** The genes of the best answer in words: "the best-ranked gene" or "the genes of the best answer". */
export function bestWords(best: readonly string[]): string {
  return best.length === 1 ? "the best-ranked gene" : "the genes of the best answer";
}

/** The identifier schemes of databases idtrack's graphs do not hold, by their published forms (UniProt's accession
 *  and entry name, RNAcentral's id): an identifier not found in such a form is told what it is, with idtrack's
 *  limitation "Databases the graph does not hold". The form alone is judged: a string of the form that the graph holds
 *  (a primary accession Ensembl attaches) is found, and never reaches this. */
export type NotHeldScheme = "uniprot_accession" | "uniprot_isoform" | "uniprot_entry_name" | "rnacentral";

/** UniProt's accession, as UniProt publishes its form (six or ten characters). */
const UNIPROT_ACCESSION = "(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})";

export function notHeldScheme(id: string): NotHeldScheme | null {
  const text = id.trim();
  if (new RegExp(`^${UNIPROT_ACCESSION}$`).test(text)) return "uniprot_accession";
  if (new RegExp(`^${UNIPROT_ACCESSION}-\\d+$`).test(text)) return "uniprot_isoform";
  if (/^[A-Z0-9]{1,10}_[A-Z0-9]{1,5}$/.test(text) && /[A-Z]/.test(text.split("_")[1] ?? ""))
    return "uniprot_entry_name";
  if (/^URS[0-9A-F]{10}(?:_\d+)?$/.test(text)) return "rnacentral";
  return null;
}

/** What each scheme is, and how to ask instead, in the words of idtrack's limitation. */
export const NOT_HELD_WORDS: Record<NotHeldScheme, { what: string; instead: string }> = {
  uniprot_accession: {
    what: "a UniProt accession",
    instead:
      "The graph holds the primary accessions Ensembl attaches to genes, not UniProt's secondary accessions (of entries merged into another): ask by the entry's primary accession, the symbol or the Ensembl id.",
  },
  uniprot_isoform: {
    what: "a UniProt isoform",
    instead:
      "The graph holds no UniProt isoforms: ask by the entry's primary accession without the suffix, the symbol or the Ensembl id.",
  },
  uniprot_entry_name: {
    what: "a UniProt entry name",
    instead:
      "The graph holds no UniProt entry names (but those early releases display as genes' names): ask by the accession, the symbol or the Ensembl id.",
  },
  rnacentral: {
    what: "an RNAcentral id",
    instead: "The graph holds no RNAcentral ids: ask by the symbol or the Ensembl id.",
  },
};
