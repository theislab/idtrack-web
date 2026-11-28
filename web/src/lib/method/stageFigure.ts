// The model of the Method page's figure of one answer's path: the best candidate's genes and steps (the Convert page's
// figure model, lib/explore/figureModel.ts, kept whole), laid on a window of releases fitted to the path, one lane per
// stable id, and every label resolving to the gene it names.
//
// - **The window** holds the path's releases with two releases of margin on each side, widened about its middle to at
//   least `MIN_WIDTH` releases (and kept inside the graph's releases), so that a path of a few releases is drawn at a
//   scale where it can be read; an overview strip of the whole axis shows where the window lies.
// - **One stable id, one lane**: the genes of one stable id (`ENSSSCG00000040178.1`, `.2`) lie on one lane, named in the
//   gutter by the stable id; each bar is labelled by its version alone, which therefore always resolves to its lane's
//   id. A bridge or a change of id moves to another lane.
import type { GraphDescription } from "../../api/types";
import type { FigureGene, FigureModel, FigureStep } from "../explore/figureModel";
import { pythonFloat } from "../numbers";
import { spaced } from "../vocabulary";

const MIN_WIDTH = 14;
const MARGIN = 2;

/** The stable id of an Ensembl id with a version ("ENSG…1079.2" → "ENSG…1079"); an id without one is itself. */
export function stableId(id: string): string {
  const dot = id.lastIndexOf(".");
  return dot > 0 && /^\d+$/.test(id.slice(dot + 1)) ? id.slice(0, dot) : id;
}

/** The version part of an id (".2"), or the whole id where it has none. */
export function versionOf(id: string): string {
  const base = stableId(id);
  return base === id ? id : id.slice(base.length);
}

/** The releases of the window: the path's span with a margin, at least `MIN_WIDTH` wide, inside the graph's releases. */
export function windowOf(span: readonly [number, number], releases: readonly number[]): number[] {
  const sorted = [...releases].sort((a, b) => a - b);
  const first = sorted[0] ?? span[0];
  const last = sorted[sorted.length - 1] ?? span[1];
  let lo = Math.max(first, span[0] - MARGIN);
  let hi = Math.min(last, span[1] + MARGIN);
  while (hi - lo + 1 < MIN_WIDTH && (lo > first || hi < last)) {
    if (lo > first) lo -= 1;
    if (hi - lo + 1 < MIN_WIDTH && hi < last) hi += 1;
  }
  lo = Math.max(first, lo);
  hi = Math.min(last, hi);
  return sorted.filter((r) => r >= lo && r <= hi);
}

interface StageLane {
  /** The stable id the lane holds. */
  id: string;
  genes: FigureGene[];
}

export interface StageModel {
  model: FigureModel;
  window: number[];
  lanes: StageLane[];
  /** The lane of each gene's node id. */
  laneOf: Map<string, number>;
}

/** The figure's model: the window and one lane per stable id, in the order the walk first meets each. */
export function stageModel(model: FigureModel, graph: Pick<GraphDescription, "releases">): StageModel {
  const lanes: StageLane[] = [];
  const index = new Map<string, number>();
  for (const gene of [...model.genes].sort((a, b) => a.order - b.order)) {
    const id = stableId(gene.node.id);
    let lane = index.get(id);
    if (lane === undefined) {
      lane = lanes.length;
      index.set(id, lane);
      lanes.push({ id, genes: [] });
    }
    lanes[lane]?.genes.push(gene);
  }
  const laneOf = new Map(model.genes.map((g) => [g.node.id, index.get(stableId(g.node.id)) ?? 0]));
  return { model, window: windowOf(model.span, graph.releases), lanes, laneOf };
}

/** The lanes a step joins: the lane it leaves and the lane it enters (the same for a step along one stable id). */
export function stepLanes(stage: StageModel, step: FigureStep): { from: number | null; to: number | null } {
  const from = step.step.source !== null ? (stage.laneOf.get(step.step.source) ?? null) : null;
  const to = stage.laneOf.get(step.step.target) ?? null;
  return { from, to };
}

/** The thread of a walk: the points it passes, in the order it was taken (from the identifier read, or the first step's
 *  old end, along each lane to each step, through the step from its lane to the next, and on to the answer's gene),
 *  and for each step drawn the index of the last point it reaches. */
export interface Thread {
  points: [number, number][];
  reach: number[];
}

/** Where the thread's places are drawn: a release's x, a step's joint, a lane's y, a gene bar's two ends. */
export interface ThreadScale {
  x: (release: number) => number;
  jointX: (step: FigureStep) => number;
  laneY: (lane: number) => number;
  barX: (first: number) => number;
  barEnd: (last: number) => number;
}

/** The thread of the walk drawn (`walked`: its history steps, in the order taken). */
export function walkThread(stage: StageModel, walked: readonly FigureStep[], at: ThreadScale): Thread {
  const { model } = stage;
  const points: [number, number][] = [];
  const reach: number[] = [];
  const entry = model.steps.find((s) => s.step.kind === "entry" && stage.laneOf.has(s.step.target));
  const first = walked[0];
  if (entry) points.push([at.x(entry.step.release ?? model.span[0]), at.laneY(stepLanes(stage, entry).to ?? 0)]);
  else if (first)
    points.push([at.x(first.step.old_release ?? model.span[0]), at.laneY(stepLanes(stage, first).from ?? 0)]);
  for (const s of walked) {
    const { from, to } = stepLanes(stage, s);
    const x = at.jointX(s);
    points.push([x, at.laneY(from ?? to ?? 0)]);
    if (from !== to) points.push([x, at.laneY(to ?? 0)]);
    reach.push(points.length - 1);
  }
  const last = walked[walked.length - 1];
  if (last) {
    const answer = model.genes.find((g) => g.node.id === model.answer.gene);
    const lane = stepLanes(stage, last).to ?? 0;
    const end = answer ? (model.backward ? at.barX(answer.first) : at.barEnd(answer.last)) : at.jointX(last);
    points.push([end, at.laneY(lane)]);
  }
  return { points, reach };
}

/** The length of a thread up to its point `upTo` (inclusive; all of it by default). */
export function threadLength(points: readonly [number, number][], upTo = points.length - 1): number {
  let length = 0;
  for (let i = 1; i <= upTo && i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

/** The last point of the thread lit while the replay stands on step `cursor` (none: the whole thread). */
export function litPoint(thread: Thread, cursor: number | null): number {
  const whole = thread.points.length - 1;
  if (cursor === null || cursor >= thread.reach.length) return whole;
  return thread.reach[cursor] ?? whole;
}

/** The releases a step joins, in words. */
function stepReleases(s: FigureStep): string {
  const step = s.step;
  if (step.old_release !== null && step.new_release !== null) return `${step.old_release} → ${step.new_release}`;
  return step.release !== null ? `release ${step.release}` : "—";
}

/** What the replay says of the step it stands on (the answer once past the last), in the api's values. */
export function replayReadout(model: FigureModel, walked: readonly FigureStep[], cursor: number | null): string {
  if (cursor === null) return "";
  const at = cursor < walked.length ? walked[cursor] : undefined;
  const n = walked.length;
  if (!at)
    return `The answer at release ${model.result.to_release}: ${model.answer.target}, after ${String(n)} ${n === 1 ? "step" : "steps"} of Ensembl's history.`;
  const st = at.step;
  return `Step ${String(cursor + 1)} of ${String(n)} · ${stepReleases(at)} · ${st.source ?? "—"} → ${st.target} · ${spaced(st.reason)}${
    st.weight === null ? " · no score" : ` · Ensembl's score ${pythonFloat(st.weight)}`
  }`;
}
