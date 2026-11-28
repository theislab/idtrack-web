// The examples the Convert page offers: conversions of the server's showcase of the graph in view, the most
// convoluted first by a stated measure, each labelled by what its answer shows, with a small sketch of its path and a
// line of facts read from the answer's own fields. Nothing is typed here per organism: the cases are the api's data
// (api/idtrack_web_api/showcase_data/), each with the kind its answer shows, and the rules below pick among them.
import type { ConversionResult, PathStep, ShowcaseResponse } from "../../api/types";
import { stableId } from "../pathReading";
import { bestSteps, isCaseKind, isHandoff, type CaseKind } from "./caseKinds";
import { KIND_TEXT, type CaseQuery } from "./cases";
import { caseQueryOf } from "./links";

/** How the measure of convolution is stated where it is used (the examples' hover card, DESIGN.md). */
export const MEASURE_WORDS =
  "the turns of the best answer's path: its changes of stable id, Ensembl's splits and merges on it, its steps across a genome assembly and its bridges";

/** A history step that is one of Ensembl's events with other ids (a split or a merge of the record). */
const isFan = (step: PathStep) => step.kind === "history" && (step.splits > 0 || step.merges > 0);

/** The convolution of an answer, by the measure stated above: over the path of its first best answer, the steps
 *  between two stable ids, the steps that are Ensembl's splits or merges, the steps between two assemblies, and the
 *  bridges, added up (each step counted once per property it has). */
export function convolution(result: ConversionResult): number {
  const steps = bestSteps(result);
  const best = result.candidates.find((c) => c.best);
  const changes = steps.filter(
    (s) => s.kind === "history" && s.source !== null && stableId(s.source) !== stableId(s.target),
  ).length;
  return changes + steps.filter(isFan).length + steps.filter(isHandoff).length + (best?.bridges ?? 0);
}

/** What an answer's own fields say a reader should know before reading it as a plain line, in a few words each:
 *  walked backward (an earlier release asked than read), through a bridge (IDTrack's inference, no record of Ensembl),
 *  another gene (the best answer is another stable id than the one read), a tie of genes. */
export function answerFacts(result: ConversionResult): string[] {
  const facts: string[] = [];
  const best = result.candidates.find((c) => c.best);
  if (result.from_release !== null && result.to_release < result.from_release) facts.push("walked backward");
  if (best && best.bridges > 0) facts.push(best.bridges === 1 ? "through a bridge" : `through ${best.bridges} bridges`);
  const read = stableId(best?.entry_gene ?? result.graph_id);
  const genes = new Set(result.candidates.filter((c) => c.best).map((c) => stableId(c.gene)));
  if (best && result.tie && genes.size > 1) facts.push(`a tie of ${genes.size} genes`);
  else if (best && read !== null && !genes.has(read)) facts.push("another gene");
  return facts;
}

export interface Example {
  kind: CaseKind;
  /** What the answer shows, in the gallery's words ("A renamed gene"). */
  title: string;
  query: CaseQuery;
  /** The release the identifier is read at and the release answered, as the server's answer gives them. */
  from: number;
  to: number;
  /** The convolution of its answer (`convolution`). */
  turns: number;
  /** The facts its answer's fields state (`answerFacts`). */
  facts: string[];
  /** The answer, for its sketch. */
  result: ConversionResult;
}

/** Up to `n` examples from the showcase's cases: answered cases that travel (read at another release than the one
 *  answered), the most convoluted first by `convolution` (in the showcase's order where equal), one of each kind; so
 *  a kind's plain case is offered only where the graph holds no deeper case of another kind. */
export function examplesOf(showcase: ShowcaseResponse | null, organism: string, n = 3): Example[] {
  if (!showcase) return [];
  const pool: Example[] = [];
  for (const c of showcase.cases) {
    const result = c.result;
    if (!result || !isCaseKind(c.kind)) continue;
    const from = result.from_release;
    if (from === null || from === result.to_release || !result.candidates.some((cd) => cd.best)) continue;
    pool.push({
      kind: c.kind,
      title: KIND_TEXT[c.kind].title,
      query: caseQueryOf(organism, c.query),
      from,
      to: result.to_release,
      turns: convolution(result),
      facts: answerFacts(result),
      result,
    });
  }
  const ranked = pool.map((e, i) => ({ e, i })).sort((a, b) => b.e.turns - a.e.turns || a.i - b.i);
  const found: Example[] = [];
  for (const { e } of ranked) {
    if (found.some((f) => f.kind === e.kind)) continue;
    found.push(e);
    if (found.length === n) break;
  }
  return found;
}

/** The identifier field's hint: the most convoluted example's identifier ("e.g. ENSG00000258574"), where it fits in
 *  `room` characters; a plain description where the server gives no example. */
export function placeholderOf(examples: readonly Example[], room = 24): string {
  const first = examples[0]?.query.identifier;
  return first && first.length + 5 <= room ? `e.g. ${first}` : "a gene id, symbol or accession";
}

/** A sketch of an answer's best path in the grammar of the answer's drawing: each stable id of the path on a lane of
 *  its own over the releases it holds there, Ensembl's steps between ids as short diagonals (an event of other ids, a
 *  split or merge, marked), a bridge dashed; time runs left to right from the earliest release to the latest. */
export interface PathSketch {
  first: number;
  last: number;
  lanes: { id: string; from: number; to: number }[];
  steps: { from: number; to: number; laneFrom: number; laneTo: number; fan: boolean; bridge: boolean }[];
  /** The release read at and the release answered. */
  read: number;
  answered: number;
}

export function pathSketch(result: ConversionResult): PathSketch | null {
  const steps = bestSteps(result);
  if (result.from_release === null || !steps.length) return null;
  const read = result.from_release;
  const answered = result.to_release;
  const lanes: PathSketch["lanes"] = [];
  const laneOf = (id: string | null, release: number): number | null => {
    const stable = stableId(id);
    if (stable === null || !/^ENS[A-Z]*G\d+$/.test(stable)) return null;
    let lane = lanes.findIndex((l) => l.id === stable);
    if (lane < 0) {
      lanes.push({ id: stable, from: release, to: release });
      lane = lanes.length - 1;
    }
    const held = lanes[lane];
    if (held) {
      held.from = Math.min(held.from, release);
      held.to = Math.max(held.to, release);
    }
    return lane;
  };
  const drawn: PathSketch["steps"] = [];
  let bridgeFrom: { lane: number; release: number } | null = null;
  for (const step of steps) {
    if (step.kind === "history" || step.kind === "self_loop") {
      const old = step.old_release ?? step.release;
      const next = step.new_release ?? step.release;
      if (old === null || next === null) continue;
      // A walk back in time leaves each step from its later id: the step is drawn in Ensembl's direction.
      const [earlier, later] = answered < read ? [step.target, step.source] : [step.source, step.target];
      const a = laneOf(earlier, old);
      const b = laneOf(later, next);
      if (a === null || b === null) continue;
      drawn.push({ from: old, to: next, laneFrom: a, laneTo: b, fan: isFan(step), bridge: false });
    } else if (step.kind === "entry" || step.kind === "identity") {
      const at = step.release ?? read;
      laneOf(step.target, at);
    } else if (step.kind === "bridge_near") {
      const at = step.release ?? read;
      const lane = laneOf(step.source, at);
      if (lane !== null) bridgeFrom = { lane, release: at };
    } else if (step.kind === "bridge_far") {
      const at = step.release ?? answered;
      const lane = laneOf(step.target, at);
      if (lane !== null && bridgeFrom) {
        const [x, y] =
          bridgeFrom.release <= at ? [bridgeFrom, { lane, release: at }] : [{ lane, release: at }, bridgeFrom];
        drawn.push({ from: x.release, to: y.release, laneFrom: x.lane, laneTo: y.lane, fan: false, bridge: true });
      }
      bridgeFrom = null;
    }
  }
  if (!lanes.length) return null;
  // Each lane runs to the release read or answered where its id is the first or the last of the walk.
  const firstLane = lanes[0];
  const lastLane = lanes[lanes.length - 1];
  if (firstLane) {
    firstLane.from = Math.min(firstLane.from, read);
    firstLane.to = Math.max(firstLane.to, read);
  }
  if (lastLane) {
    lastLane.from = Math.min(lastLane.from, answered);
    lastLane.to = Math.max(lastLane.to, answered);
  }
  const ends = [read, answered, ...lanes.flatMap((l) => [l.from, l.to])];
  return { first: Math.min(...ends), last: Math.max(...ends), lanes, steps: drawn, read, answered };
}
