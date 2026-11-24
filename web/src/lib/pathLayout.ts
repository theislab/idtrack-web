// The path view's layout: deterministic positions from the model (no force, no randomness: positions mean something).
//
// Two axes. Time (`t`) runs along the releases: a node is drawn over the releases the path holds it, a step from the
// release at its source side to the release at its target side. Stack (`s`) separates what happens at the same
// time: the identifier and the forms it is read through above, then one lane per Ensembl gene line, the chosen
// answer's genes on the first lane, alternatives below, genes of one lineage kept on one lane where they fit.
// Horizontal on a wide screen (t = x), vertical on a phone (t = y): the same layout, the axes swapped.
import type { ModelCandidate, ModelNode, ModelStep, PathModel } from "./pathModel";

export interface LayoutMetrics {
  /** Stack distance between the rows of the identifier and its forms. */
  rowGap: number;
  /** Stack height of a lane with one target. */
  laneGap: number;
  /** Stack height added per further target of one gene. */
  subGap: number;
  /** Space before the first row. */
  pad: number;
  /** Time offset per row of the forms above the lanes (so a chain read at one release does not overlap itself). */
  indent: number;
}

export const HORIZONTAL_METRICS: LayoutMetrics = { rowGap: 30, laneGap: 40, subGap: 20, pad: 30, indent: 16 };
export const VERTICAL_METRICS: LayoutMetrics = { rowGap: 26, laneGap: 30, subGap: 20, pad: 18, indent: 14 };

export interface Point {
  t: number;
  s: number;
}

export interface NodePlace {
  node: ModelNode;
  /** Gene lanes: the bar from t0 to t1; other nodes: a point (t0 = t1). */
  t0: number;
  t1: number;
  s: number;
  lane: number | null;
  /** On a best candidate's path. */
  best: boolean;
}

export interface EdgePlace {
  step: ModelStep;
  from: Point;
  to: Point;
  /** The SVG path, in (t, s) coordinates: the view maps them to (x, y) by orientation. */
  d: string;
  /** Where a label or marker of the step sits. */
  mid: Point;
}

export interface AnswerRow {
  candidate: ModelCandidate;
  s: number;
  /** The node of the target when a final step reaches it; the gene itself when the gene is the target. */
  nodeId: string;
}

export interface PathLayout {
  nodes: Map<string, NodePlace>;
  edges: EdgePlace[];
  answers: AnswerRow[];
  /** The time coordinate of the answer column. */
  answerT: number;
  lanes: number;
  upperRows: number;
  /** The stack extent of the drawing. */
  stackSize: number;
  /** Candidates drawn, in the api's order; the others are hidden until asked for. */
  shown: ModelCandidate[];
  hidden: number;
}

interface LayoutOptions {
  /** Release to time coordinate (the view's zoomed scale). */
  scale: (release: number) => number;
  answerT: number;
  metrics: LayoutMetrics;
  /** How many candidates to draw (the best ones always). */
  limit: number;
  /** Swap the sweep of a curve for the vertical drawing (its tangents follow the time axis either way). */
}

/** The candidates drawn: every best one, then the others in the api's order, up to `limit` in all. */
export function shownCandidates(model: PathModel, limit: number): ModelCandidate[] {
  const bests = model.candidates.filter((c) => c.best);
  const others = model.candidates.filter((c) => !c.best);
  return [...bests, ...others.slice(0, Math.max(0, limit - bests.length))].sort((a, b) => a.index - b.index);
}

function overlaps(intervals: [number, number][], interval: [number, number]): boolean {
  return intervals.some(([a, b]) => interval[0] <= b && a <= interval[1]);
}

/** A curve from one point to another whose tangents follow the time axis; a straight line when they nearly align. */
export function curve(from: Point, to: Point): string {
  const dt = to.t - from.t;
  const ds = to.s - from.s;
  if (Math.abs(ds) < 0.5 || Math.abs(dt) < 6) return `M${from.t},${from.s}L${to.t},${to.s}`;
  const bend = dt / 2;
  return `M${from.t},${from.s}C${from.t + bend},${from.s} ${to.t - bend},${to.s} ${to.t},${to.s}`;
}

/** A loop above a lane from one time to another (a gene re-mapped to itself). */
export function loop(from: Point, to: Point, height: number): string {
  const t0 = Math.min(from.t, to.t);
  const t1 = Math.max(from.t, to.t, t0 + 10);
  return `M${t0},${from.s}C${t0},${from.s - height} ${t1},${from.s - height} ${t1},${from.s}`;
}

export function layoutPath(model: PathModel, options: LayoutOptions): PathLayout {
  const { scale, metrics, answerT } = options;
  const shown = shownCandidates(model, options.limit);
  const shownSteps = new Set(shown.flatMap((c) => c.steps));
  const visibleSteps = model.steps.filter((s) => shownSteps.has(s.index));
  const visibleNodeIds = new Set<string>();
  for (const step of visibleSteps) {
    if (step.api.source !== null) visibleNodeIds.add(step.api.source);
    visibleNodeIds.add(step.api.target);
  }
  for (const candidate of shown) visibleNodeIds.add(candidate.api.gene);
  const bestNodes = new Set<string>();
  for (const candidate of shown.filter((c) => c.best)) {
    bestNodes.add(candidate.api.gene);
    for (const index of candidate.steps) {
      const step = model.steps[index];
      if (!step) continue;
      if (step.api.source !== null) bestNodes.add(step.api.source);
      bestNodes.add(step.api.target);
    }
  }

  // Order of first use, best candidates first: the order rows and lanes are given in.
  const order: string[] = [];
  const seen = new Set<string>();
  const takeNode = (id: string | null) => {
    if (id === null || seen.has(id) || !visibleNodeIds.has(id)) return;
    seen.add(id);
    order.push(id);
  };
  if (model.result.graph_id !== null) takeNode(model.result.graph_id);
  const walk = [...shown.filter((c) => c.best), ...shown.filter((c) => !c.best)];
  for (const candidate of walk) {
    for (const index of candidate.steps) {
      const step = model.steps[index];
      if (!step) continue;
      takeNode(step.api.source);
      takeNode(step.api.target);
    }
    takeNode(candidate.api.gene);
  }

  const node = (id: string) => model.nodeById.get(id);
  const upper = order.filter((id) => node(id)?.role === "upper");

  // Lanes of genes: the best candidates' genes on lane 0 where they fit; a gene keeps the lane of the gene it came
  // from where its releases are free there; alternatives never take lane 0.
  const laneOf = new Map<string, number>();
  const laneIntervals: [number, number][][] = [];
  const place = (id: string, preferred: number | null, minimum: number) => {
    const n = node(id);
    if (!n || laneOf.has(id)) return;
    const interval: [number, number] = [n.first, n.last];
    const fits = (lane: number) => !overlaps(laneIntervals[lane] ?? [], interval);
    let lane = preferred !== null && preferred >= minimum && fits(preferred) ? preferred : minimum;
    while (!fits(lane)) lane += 1;
    laneOf.set(id, lane);
    (laneIntervals[lane] ??= []).push(interval);
  };
  for (const candidate of walk) {
    let previous: number | null = candidate.best ? 0 : null;
    const minimum = candidate.best ? 0 : 1;
    const genes: string[] = [];
    if (model.result.graph_id !== null && node(model.result.graph_id)?.role === "gene")
      genes.push(model.result.graph_id);
    for (const index of candidate.steps) {
      const step = model.steps[index];
      if (!step) continue;
      for (const id of [step.api.source, step.api.target]) {
        if (id !== null && node(id)?.role === "gene" && !genes.includes(id)) genes.push(id);
      }
    }
    if (node(candidate.api.gene)?.role === "gene" && !genes.includes(candidate.api.gene))
      genes.push(candidate.api.gene);
    for (const id of genes) {
      if (!visibleNodeIds.has(id)) continue;
      place(id, previous, minimum);
      previous = laneOf.get(id) ?? previous;
    }
  }
  const lanes = laneIntervals.length;

  // Targets per lane (the answer column holds one row per drawn candidate, at its gene's lane).
  const answersPerLane = new Map<number, ModelCandidate[]>();
  for (const candidate of shown) {
    const lane = laneOf.get(candidate.api.gene) ?? 0;
    answersPerLane.set(lane, [...(answersPerLane.get(lane) ?? []), candidate]);
  }
  const laneS: number[] = [];
  let cursor = metrics.pad + upper.length * metrics.rowGap;
  for (let lane = 0; lane < Math.max(lanes, 1); lane += 1) {
    laneS[lane] = cursor;
    const count = answersPerLane.get(lane)?.length ?? 1;
    cursor += metrics.laneGap + Math.max(0, count - 1) * metrics.subGap;
  }
  const stackSize = cursor - metrics.laneGap + metrics.pad;

  const places = new Map<string, NodePlace>();
  upper.forEach((id, row) => {
    const n = node(id);
    if (!n) return;
    const t = scale(n.first) - (upper.length - row) * metrics.indent;
    places.set(id, {
      node: n,
      t0: t,
      t1: t,
      s: metrics.pad + row * metrics.rowGap,
      lane: null,
      best: bestNodes.has(id),
    });
  });
  for (const [id, lane] of laneOf) {
    const n = node(id);
    if (!n) continue;
    places.set(id, {
      node: n,
      t0: scale(n.first),
      t1: scale(n.last),
      s: laneS[lane] ?? 0,
      lane,
      best: bestNodes.has(id),
    });
  }
  // Ids a bridge passes through: on the lane of the gene the walk leaves, at the bridge's release.
  for (const step of visibleSteps) {
    if (step.api.kind !== "bridge_near" || node(step.api.target)?.role !== "bridge") continue;
    if (places.has(step.api.target) || step.api.source === null) continue;
    const from = places.get(step.api.source);
    const n = node(step.api.target);
    if (!n) continue;
    const t = scale(step.targetRelease);
    places.set(step.api.target, {
      node: n,
      t0: t,
      t1: t,
      s: from?.s ?? 0,
      lane: from?.lane ?? null,
      best: bestNodes.has(n.id),
    });
  }

  const answers: AnswerRow[] = [];
  for (const [lane, candidates] of answersPerLane) {
    candidates.forEach((candidate, i) => {
      const finalStep = candidate.api.final_path.length
        ? model.steps[candidate.api.final_path[candidate.api.final_path.length - 1] ?? -1]
        : undefined;
      const s = (laneS[lane] ?? 0) + i * metrics.subGap;
      const nodeId = finalStep ? finalStep.api.target : candidate.api.gene;
      answers.push({ candidate, s, nodeId });
      if (finalStep) {
        const n = node(finalStep.api.target);
        if (n && !places.has(n.id)) {
          places.set(n.id, { node: n, t0: answerT, t1: answerT, s, lane, best: bestNodes.has(n.id) });
        }
      }
    });
  }
  answers.sort((a, b) => a.candidate.index - b.candidate.index);

  // Any node still without a place (a kind this page does not know): above the lanes, at its first release.
  for (const id of order) {
    const n = node(id);
    if (!n || places.has(id)) continue;
    places.set(id, {
      node: n,
      t0: scale(n.first),
      t1: scale(n.first),
      s: metrics.pad,
      lane: null,
      best: bestNodes.has(id),
    });
  }

  const pointOf = (id: string | null, release: number): Point | null => {
    if (id === null) return null;
    const p = places.get(id);
    if (!p) return null;
    if (p.node.role === "gene") return { t: scale(release), s: p.s };
    return { t: p.t0, s: p.s };
  };

  const edges: EdgePlace[] = [];
  for (const step of visibleSteps) {
    const to = pointOf(step.api.target, step.targetRelease);
    if (!to) continue;
    if (step.api.kind === "identity" || step.api.source === null) {
      edges.push({ step, from: to, to, d: "", mid: to });
      continue;
    }
    const from = pointOf(step.api.source, step.sourceRelease);
    if (!from) continue;
    if (step.api.kind === "self_loop") {
      const end = { t: scale(step.targetRelease), s: from.s };
      edges.push({ step, from, to: end, d: loop(from, end, 14), mid: { t: (from.t + end.t) / 2, s: from.s - 11 } });
      continue;
    }
    const target = step.api.kind === "final" ? { t: to.t - 5, s: to.s } : to;
    edges.push({
      step,
      from,
      to: target,
      d: curve(from, target),
      mid: { t: (from.t + target.t) / 2, s: (from.s + target.s) / 2 },
    });
  }

  return {
    nodes: places,
    edges,
    answers,
    answerT,
    lanes,
    upperRows: upper.length,
    stackSize,
    shown,
    hidden: model.candidates.length - shown.length,
  };
}

/** The text of a gene's label in a given width: in full, as its version after a gene of the same id, or cut in the
 *  middle; `null` when not even a short form fits (the full id is then on focus). */
export function fitLabel(text: string, previousOnLane: string | null, width: number, charWidth: number): string | null {
  const fits = (candidate: string) => candidate.length * charWidth <= width;
  if (fits(text)) return text;
  const dot = text.lastIndexOf(".");
  if (previousOnLane !== null && dot > 0) {
    const base = text.slice(0, dot);
    const previousDot = previousOnLane.lastIndexOf(".");
    if (previousDot > 0 && previousOnLane.slice(0, previousDot) === base && fits(text.slice(dot)))
      return text.slice(dot);
  }
  const room = Math.floor(width / charWidth);
  if (room < 6) return null;
  const tail = Math.min(text.length - 1, Math.max(3, Math.ceil((room - 1) / 2)));
  const head = room - 1 - tail;
  if (head < 2) return `…${text.slice(text.length - (room - 1))}`;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
