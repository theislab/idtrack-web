// The model of the Convert page's figure: the best answer of one real conversion, as idtrack's explained path gives
// it, laid along the releases. Every node and step is the api's object, kept whole; the model only adds where each sits
// on the release axis (the releases at which the path holds each gene) and which steps cross assemblies.
import type { Candidate, ConversionResult, PathNode, PathStep } from "../../api/types";
import { bestSteps, isHandoff } from "./caseKinds";

/** A gene of the path, over the releases the path holds it (from where the walk enters it to where it leaves). */
export interface FigureGene {
  node: PathNode;
  first: number;
  last: number;
  lane: number;
  /** Its place in the walk (0 for the gene the identifier is read as). */
  order: number;
}

/** A step of the path, with the two releases it joins on the axis. */
export interface FigureStep {
  step: PathStep;
  /** Its number in the best candidate's steps (1 for the first). */
  number: number;
  /** The earlier and the later release the step joins (the same release for a step at one release). */
  lo: number;
  hi: number;
  /** A history step, a split or merge, a re-mapping to itself, or a crossing through another node. */
  family: "history" | "event" | "self" | "cross";
  handoff: boolean;
}

export interface FigureModel {
  result: ConversionResult;
  answer: Candidate;
  genes: FigureGene[];
  steps: FigureStep[];
  /** The releases the path spans, ascending. */
  span: [number, number];
  backward: boolean;
  lanes: number;
}

const EVENTS = new Set(["split", "merge", "split_and_merge"]);

function familyOf(step: PathStep): FigureStep["family"] {
  if (step.kind === "self_loop") return "self";
  if (step.kind === "history") return EVENTS.has(step.reason) ? "event" : "history";
  return "cross";
}

/** The releases at the two ends of a step, in the walk's direction: where it leaves its source, enters its target. */
function ends(step: PathStep, backward: boolean): { leave: number | null; enter: number | null } {
  if (step.kind === "history" || step.kind === "self_loop") {
    return backward
      ? { leave: step.new_release, enter: step.old_release }
      : { leave: step.old_release, enter: step.new_release };
  }
  return { leave: step.release, enter: step.release };
}

/** The figure of a result's best answer, or null when the result has no best answer with a path to draw. */
export function figureModel(result: ConversionResult): FigureModel | null {
  const answer = result.candidates.find((c) => c.best);
  const path = result.path;
  if (!answer || !path || result.from_release === null) return null;
  const steps = bestSteps(result);
  const nodes = new Map(path.nodes.map((n) => [n.id, n]));
  const from = result.from_release;
  const to = result.to_release;
  const backward = to < from;
  const isGene = (id: string | null) => id !== null && nodes.get(id)?.kind === "ensembl_gene";

  const held: { id: string; first: number; last: number }[] = [];
  let current = null as { id: string; start: number } | null;
  let at = from;
  const figureSteps: FigureStep[] = [];
  for (const [i, step] of steps.entries()) {
    const { leave, enter } = ends(step, backward);
    const leaveAt = leave ?? at;
    const enterAt = enter ?? leaveAt;
    if (current === null && isGene(step.source) && step.source !== null) current = { id: step.source, start: from };
    if (step.target !== current?.id && isGene(step.target)) {
      if (current) held.push({ id: current.id, first: current.start, last: leaveAt });
      current = { id: step.target, start: enterAt };
    }
    at = enterAt;
    figureSteps.push({
      step,
      number: i + 1,
      lo: Math.min(leaveAt, enterAt),
      hi: Math.max(leaveAt, enterAt),
      family: familyOf(step),
      handoff: isHandoff(step),
    });
  }
  if (current === null && isGene(answer.gene)) current = { id: answer.gene, start: from };
  if (current) held.push({ id: current.id, first: current.start, last: to });

  // Lanes: a gene goes on the first lane where it shares no release with a gene already there (one lineage, one lane).
  const laneEnds: [number, number][][] = [];
  const genes: FigureGene[] = held.map((h, order) => {
    const first = Math.min(h.first, h.last);
    const last = Math.max(h.first, h.last);
    let lane = laneEnds.findIndex((spans) => spans.every(([a, b]) => last < a || first > b));
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push([]);
    }
    laneEnds[lane]?.push([first, last]);
    const node = nodes.get(h.id);
    if (!node) throw new Error(`The path names a gene it does not hold: ${h.id}`);
    return { node, first, last, lane, order };
  });
  const releases = [from, to, ...genes.flatMap((g) => [g.first, g.last]), ...figureSteps.flatMap((s) => [s.lo, s.hi])];
  return {
    result,
    answer,
    genes,
    steps: figureSteps,
    span: [Math.min(...releases), Math.max(...releases)],
    backward,
    lanes: Math.max(1, laneEnds.length),
  };
}

/** How many steps of each reason, in one fixed order (`order`: the vocabulary's order of step reasons; a reason it
 *  does not list comes after them, by name), so the same sentence names reasons in the same order on every graph. */
export function reasonCounts(steps: readonly FigureStep[], order: readonly string[] = []): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.step.reason, (counts.get(s.step.reason) ?? 0) + 1);
  const rank = (r: string) => (order.includes(r) ? order.indexOf(r) : order.length);
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

/** A gene's label beside the one before it: its version alone (".6") where the stable id is the same, else the id. */
export function shortLabel(id: string, previous: string | null): string {
  const dot = id.lastIndexOf(".");
  if (dot > 0 && previous !== null) {
    const base = id.slice(0, dot);
    const previousDot = previous.lastIndexOf(".");
    if (previousDot > 0 && previous.slice(0, previousDot) === base) return id.slice(dot);
  }
  return id;
}

/** The figure's height for a number of lanes: fixed before the answer arrives, so nothing moves when it is drawn. */
export function figureHeight(lanes = 1): number {
  return 248 + (lanes - 1) * 44;
}

/** The gene before gene `i` on its own lane (the last that ends before it starts), or null: a lane's label is read
 *  against it, never against the gene before it in the path (a bridge can join two ids on different lanes). */
export function previousOnLane(genes: readonly FigureGene[], i: number): FigureGene | null {
  const g = genes[i];
  if (!g) return null;
  return genes.filter((o) => o.lane === g.lane && o.last < g.first).sort((a, b) => b.last - a.last)[0] ?? null;
}
