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
