// The real answers the Method page draws, one per stage of an answer: each a conversion of this server, drawn from the
// api's answer as it comes. A stage's case claims a property of one graph's answer (the reading took a step past
// `exact`; the walk splits; a bridge was taken; a criterion decided between two candidates; the answer is an id of
// another database). The walk's case is read from the showcase of the graph in view by a stated measure (`walkCase`);
// the others are conversions asked when their panel comes into view, each shown only where the server holds the graph
// it was checked on (its content digest). `holdsStage` reads the property from the answer's own fields, and the
// end-to-end tests convert every case on the real graphs and check it (e2e/explore.spec.ts).
import type { ShowcaseQuery, ShowcaseResponse } from "../../api/client";
import type { ConversionResult } from "../../api/types";
import type { CaseQuery } from "../home/cases";
import { bestSteps } from "../home/caseKinds";

export type Stage = "read" | "walk" | "bridge" | "rank" | "answer";

export interface StageCase {
  stage: Stage;
  query: CaseQuery;
  /** The content digest of the graph the case was checked on. */
  checkedOn: string;
}

const HUMAN_115 = "f922779314f8a27dd1d1a7a4f24e7b6a316fa7fb8f7b071f3d66857095682cfb";
const PIG_115 = "80bda9b3bb224243664e8b35d2ea602255b02b4dd39abb22e982f7aa2aff62df";

/** The cases of the stages but the walk's (read from the showcase, `walkCase`). */
export const STAGE_CASES: StageCase[] = [
  { stage: "read", query: { organism: "homo_sapiens", identifier: "tp53" }, checkedOn: HUMAN_115 },
  // A bridge whose two genes lie at one place (both on one assembly), IDTrack's documented case of a bridge, first; where
  // the server holds no human graph of this digest, a bridge across an assembly change Ensembl does not map, whose
  // places cannot be compared (the panel says so, with IDTrack's limitation).
  {
    stage: "bridge",
    query: { organism: "homo_sapiens", identifier: "ENSG00000198477", from: 48 },
    checkedOn: HUMAN_115,
  },
  {
    stage: "bridge",
    query: { organism: "sus_scrofa", identifier: "ENSSSCP00000069370.1", to: 56 },
    checkedOn: PIG_115,
  },
  { stage: "rank", query: { organism: "sus_scrofa", identifier: "RNF223" }, checkedOn: PIG_115 },
  {
    stage: "answer",
    query: { organism: "sus_scrofa", identifier: "100626121", db: "Uniprot/SPTREMBL" },
    checkedOn: PIG_115,
  },
];

/** Whether an answer shows what its stage's figure is drawn for. */
export function holdsStage(stage: Stage, result: ConversionResult): boolean {
  const reasons = new Set(bestSteps(result).map((s) => s.reason));
  switch (stage) {
    case "read":
      return result.match !== null && result.match !== "exact";
    case "walk":
      return reasons.has("split") || reasons.has("split_and_merge");
    case "bridge":
      return reasons.has("bridge_near") && reasons.has("bridge_far") && (result.path?.bridges.length ?? 0) > 0;
    case "rank":
      return result.decided_by !== null && result.candidates.some((c) => !c.best);
    case "answer":
      return reasons.has("final") && result.final_database !== "ensembl_gene";
  }
}

/** The case of a stage this server can show: the first of the stage's cases whose graph is held with the digest it was
 *  checked on. */
export function stageCase(stage: Stage, digests: ReadonlyMap<string, string | null>): StageCase | null {
  return STAGE_CASES.find((c) => c.stage === stage && digests.get(c.query.organism) === c.checkedOn) ?? null;
}

/** The size of an answer's best path: the ids it passes and its steps (the measure by which the showcase's most
 *  convoluted answers are chosen, lib/hero/constellationModel.ts, here of the path the figure draws). */
export function bestPathSize(result: ConversionResult): number {
  const steps = bestSteps(result);
  return new Set(steps.flatMap((s) => [s.source, s.target])).size + steps.length;
}

/** The walk's case: of the showcase's answers (its cases, then its journeys, each identifier once), those whose best
 *  path walks through a split (what the stage draws) and takes no bridge (the next stage's), the one whose best path
 *  passes the most ids and steps; between equals, the first identifier in alphabetical order. Null where the showcase
 *  holds none. */
export function walkCase(showcase: ShowcaseResponse): { query: ShowcaseQuery; result: ConversionResult } | null {
  const seen = new Set<string>();
  const found: { query: ShowcaseQuery; result: ConversionResult; size: number }[] = [];
  for (const item of [...showcase.cases, ...showcase.journeys]) {
    const result = item.result;
    if (!result || seen.has(result.query_id)) continue;
    seen.add(result.query_id);
    if (!holdsStage("walk", result) || bestSteps(result).some((s) => s.kind === "bridge_near")) continue;
    found.push({ query: item.query, result, size: bestPathSize(result) });
  }
  found.sort((a, b) => b.size - a.size || a.result.query_id.localeCompare(b.result.query_id));
  const best = found[0];
  return best ? { query: best.query, result: best.result } : null;
}
