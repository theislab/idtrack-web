// The steps of an answer, counted and written one way on every page. A journey's steps are the steps of its best
// answer's path as the answer's "In words" table lists them: the first best candidate's `path`, then its
// `final_path` (lib/home/caseKinds.ts `bestSteps`). Where every candidate's steps are meant (the explained path of
// all candidates, as the answer's Path tab draws it), the count says so ("36 steps over 3 candidates"). A history step
// is written in Ensembl's direction, its earlier id first, whichever way the walk went; the walk's own direction is
// said beside it. How convoluted an answer is, for choosing and ordering examples, is one graded measure read from
// the same path (`convolution`), stated in words by `CONVOLUTION_WORDS`.
import type { ConversionResult, PathStep } from "../../api/types";
import { bestSteps, isHandoff, type CaseKind } from "../home/caseKinds";
import { buildModel } from "../pathModel";

/** The steps of a journey: the best answer's path as "In words" lists them. */
export function journeySteps(result: ConversionResult): PathStep[] {
  return bestSteps(result);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The steps of a journey in words ("15 steps"). */
export function journeyStepsText(result: ConversionResult): string {
  return plural(journeySteps(result).length, "step");
}

/** Every step of the explained path of all candidates (the Path tab's drawing), in words: "21 steps over 16
 *  candidates" where more than one candidate shares it, else as a journey's steps. */
export function allStepsText(result: ConversionResult): string {
  const steps = result.path?.steps.length ?? 0;
  const candidates = result.candidates.length;
  return candidates > 1 ? `${plural(steps, "step")} over ${plural(candidates, "candidate")}` : plural(steps, "step");
}

/** A history step in Ensembl's direction: the event's earlier id (at its last release, `old`) and its later id (at
 *  its first, `new`), and whether the walk took it from the later id to the earlier (`backward`). Other steps keep the
 *  walk's order (`earlier` is the step's source). */
export interface EnsemblStep {
  step: PathStep;
  earlier: string | null;
  later: string;
  old: number | null;
  new: number | null;
  backward: boolean;
}

const isHistory = (s: PathStep) => s.kind === "history" || s.kind === "self_loop";

/** The best path's steps, each in Ensembl's direction (the direction of a history step read from the lives of its two
 *  genes, as the answer's path model reads it; without them, from the conversion's direction). */
export function ensemblSteps(result: ConversionResult): EnsemblStep[] {
  const steps = journeySteps(result);
  if (!steps.length) return [];
  const model = buildModel(result);
  const direction = new Map(model.steps.map((s) => [s.api, s.direction]));
  const conversionBack = result.from_release !== null && result.to_release < result.from_release;
  return steps.map((step) => {
    if (!isHistory(step))
      return { step, earlier: step.source, later: step.target, old: null, new: null, backward: false };
    const d = direction.get(step) ?? (conversionBack ? "backward" : "forward");
    const backward = d === "backward";
    return {
      step,
      earlier: backward ? step.target : step.source,
      later: (backward ? step.source : step.target) ?? step.target,
      old: step.old_release,
      new: step.new_release,
      backward,
    };
  });
}

/** Whether the conversion walks back in time (to an earlier release than the one read). */
export function walksBack(result: ConversionResult): boolean {
  return result.from_release !== null && result.to_release < result.from_release;
}

/** An Ensembl id without its version ("ENSG00000258574" of "ENSG00000258574.1"). */
export function stableId(id: string): string {
  return id.replace(/\.\d+$/, "");
}

/** The parts of the graded measure of how convoluted an answer is, each counted on its best path. */
export interface Convolution {
  /** History steps whose two genes are different stable ids. */
  idChanges: number;
  /** History steps whose earlier id passed to other ids too (`splits` > 0). */
  splits: number;
  /** History steps whose later id received other ids too (`merges` > 0). */
  merges: number;
  /** Bridges taken (each `bridge_near` step opens one). */
  bridges: number;
  /** History steps from one genome assembly to the next. */
  handoffs: number;
  /** History steps of any kind (breaks ties). */
  history: number;
  /** The measure: the sum of the five counts above. */
  total: number;
}

/** The measure in one sentence, for the captions that rank by it. */
export const CONVOLUTION_WORDS =
  "ranked by the changes of id, splits, merges, bridges and steps across an assembly change on each best answer's path, added up (ties by its history steps)";

/** How convoluted an answer is (DESIGN.md, "The journeys"): read from its best path, never from the identifier. */
export function convolution(result: ConversionResult | null): Convolution {
  const none = { idChanges: 0, splits: 0, merges: 0, bridges: 0, handoffs: 0, history: 0, total: 0 };
  if (!result) return none;
  const steps = journeySteps(result);
  if (!steps.length) return none;
  const c = { ...none };
  for (const s of steps) {
    if (s.kind === "bridge_near") c.bridges += 1;
    if (!isHistory(s)) continue;
    c.history += 1;
    if (s.source !== null && stableId(s.source) !== stableId(s.target)) c.idChanges += 1;
    if (s.splits > 0) c.splits += 1;
    if (s.merges > 0) c.merges += 1;
    if (isHandoff(s)) c.handoffs += 1;
  }
  c.total = c.idChanges + c.splits + c.merges + c.bridges + c.handoffs;
  return c;
}

/** Order by the measure, most convoluted first (ties: more history steps first, then the order given). */
export function byConvolution<T>(items: readonly T[], resultOf: (item: T) => ConversionResult | null): T[] {
  const ranked = items.map((item, i) => ({ item, i, c: convolution(resultOf(item)) }));
  ranked.sort((a, b) => b.c.total - a.c.total || b.c.history - a.c.history || a.i - b.i);
  return ranked.map((r) => r.item);
}

/** What a kind's concept does not say of this case: that its walk runs back in time (each of Ensembl's events then
 *  followed from the later id to the earlier), and that its path passes through a bridge where the kind is not one. */
export function conceptClauses(kind: CaseKind, result: ConversionResult): string[] {
  const clauses: string[] = [];
  if (walksBack(result))
    clauses.push(
      `Here the walk runs back in time, from release ${result.from_release ?? "—"} to ${result.to_release}: it follows each of Ensembl's events from the later id to the earlier.`,
    );
  if (kind !== "bridge" && kind !== "refused" && journeySteps(result).some((s) => s.kind === "bridge_near"))
    clauses.push("Its path also passes through a bridge: IDTrack's inference, which no record of Ensembl states.");
  return clauses;
}

/** A step of a path as a sentence without its ids (they go beside it, on a line of their own), in Ensembl's terms:
 *  what Ensembl recorded between the two releases (every count the api's), or what the walk did through another id;
 *  a history step the walk took from the later id to the earlier says it was followed back. `assembly` names the two
 *  assemblies of a step across a change of assembly. */
export function stepSentence(
  step: PathStep,
  { backward = false, assembly = null }: { backward?: boolean; assembly?: [string, string] | null } = {},
): string {
  const others = (n: number) => `${n} other ${n === 1 ? "id" : "ids"}`;
  const at =
    step.old_release !== null && step.new_release !== null
      ? `At releases ${step.old_release}→${step.new_release}`
      : step.release !== null
        ? `At release ${step.release}`
        : "";
  const across = assembly ? `, across the change of assembly from ${assembly[0]} to ${assembly[1]}` : "";
  const back = backward ? ", and the walk followed it back in time" : "";
  const lead = at ? `${at} ` : "";
  switch (step.reason) {
    case "new_version":
      return `${lead}Ensembl gave the gene a new version${across}${back}.`;
    case "replaced":
      return `${lead}Ensembl replaced the id by another${across}${back}.`;
    case "split":
    case "merge":
    case "split_and_merge": {
      const parts = [
        step.splits ? `split the earlier id, which passed to ${others(step.splits)} too` : "",
        step.merges ? `merged ${others(step.merges)} into the later id` : "",
      ].filter(Boolean);
      return `${lead}Ensembl ${parts.length ? parts.join(" and ") : step.reason.replace(/_/g, " ")}${across}${back}.`;
    }
    case "self_loop":
      return `${lead}Ensembl re-mapped the gene to itself, with a score${across}.`;
    case "bridge_near":
      return `${lead}Ensembl's history of the gene goes no further; the walk leaves it through an id it carries.`;
    case "bridge_far":
      return `${lead}The walk enters a gene that carries the same id: a bridge, IDTrack's inference, which no record of Ensembl states.`;
    case "entry":
      return `${lead}The identifier is read as the gene it names.`;
    case "final":
      return `${lead}The gene's id in the database asked.`;
    case "identity":
      return `${lead}The gene is its own answer.`;
    default:
      return `${lead}${step.reason.replace(/_/g, " ")}.`;
  }
}
