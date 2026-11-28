// What Explore's stories draw of a graph's showcase (`GET /organisms/{organism}/showcase`), read from its answers:
// the journey up close (the first case of kind `lineage`), the gallery's cards (every other case, the other lineage
// cases among them), and the longest journey any of its answers takes. The card of a step across an assembly change
// is the answer of the showcase (a case or a journey) that crosses one with the most changes of id on its best path,
// of those no other card or view shows: the plainest handoff is kept only where the graph has none more convoluted.
import type { ConversionResult, ShowcaseResponse } from "../../api/types";
import { holdsKind } from "../home/caseKinds";
import { convolution, journeySteps } from "../path/steps";

type ShowcaseCase = ShowcaseResponse["cases"][number];

export interface StoriesOf {
  /** The journey up close (the first lineage case with an answer), or null. */
  upClose: ShowcaseCase | null;
  /** The gallery's cards, in the showcase's order. */
  cases: ShowcaseCase[];
  /** The most steps of Ensembl's history on the best path of any answer of the showcase. */
  longest: number;
}

const answered = (r: ConversionResult | null | undefined): r is ConversionResult => Boolean(r);

/** The history steps on an answer's best path. */
const historySteps = (r: ConversionResult) =>
  journeySteps(r).filter((s) => s.kind === "history" || s.kind === "self_loop").length;

export function storiesOf(showcase: ShowcaseResponse): StoriesOf {
  const upClose = showcase.cases.find((c) => c.kind === "lineage" && c.result) ?? null;
  const rest = showcase.cases.filter((c) => c !== upClose);
  const shownIds = new Set(
    [upClose, ...rest.filter((c) => c.kind !== "handoff")].flatMap((c) => (c?.result ? [c.result.query_id] : [])),
  );
  // The handoff card: of the answers that cross an assembly change and are no other card's, the most changes of id
  // (ties: the measure of the journeys, then the showcase's order, its own handoff case first).
  const own = rest.find((c) => c.kind === "handoff") ?? null;
  const pool = [
    ...(own ? [own] : []),
    ...showcase.journeys.map((j): ShowcaseCase => ({
      kind: "handoff",
      query: j.query,
      result: j.result ?? null,
      error: j.error ?? null,
    })),
  ].filter(
    (c): c is ShowcaseCase & { result: ConversionResult } =>
      answered(c.result) && holdsKind("handoff", c.result) && !shownIds.has(c.result.query_id),
  );
  const better = (a: ConversionResult, b: ConversionResult | null) => {
    if (!b) return true;
    const [x, y] = [convolution(a), convolution(b)];
    return x.idChanges > y.idChanges || (x.idChanges === y.idChanges && x.total > y.total);
  };
  let handoff: ShowcaseCase | null = own;
  for (const c of pool) if (better(c.result, handoff?.result ?? null)) handoff = { ...c, kind: "handoff" };
  const cases = rest.map((c) => (c === own && handoff ? handoff : c));
  const answers = [...showcase.cases.map((c) => c.result), ...showcase.journeys.map((j) => j.result)].filter(answered);
  const longest = Math.max(0, ...answers.map(historySteps));
  return { upClose, cases, longest };
}
