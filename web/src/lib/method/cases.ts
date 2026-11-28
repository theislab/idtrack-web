// The real answers the Method page draws, one per stage of an answer: each a conversion of this server, asked when its
// panel comes into view and drawn from the api's answer as it comes. A stage's case claims a property of one graph's
// answer (the reading took a step past `exact`; the walk splits; a bridge was taken; a criterion decided between two
// candidates; the answer is an id of another database), so it is shown only where the server holds the graph it was
// checked on (its content digest); `holds` reads the property from the answer's own fields, and the end-to-end tests
// convert every case on the real graphs and check it (e2e/method.spec.ts).
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

export const STAGE_CASES: StageCase[] = [
  { stage: "read", query: { organism: "homo_sapiens", identifier: "tp53" }, checkedOn: HUMAN_115 },
  { stage: "walk", query: { organism: "sus_scrofa", identifier: "ENSSSCG00000038317.1", to: 86 }, checkedOn: PIG_115 },
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
