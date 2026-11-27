// The path view's layout: deterministic positions from the model (no force, no randomness: positions mean something).
//
// Two axes. Time (`t`) runs along the releases: a node is drawn over the releases the path holds it, a step from the
// release at its source side to the release at its target side. Stack (`s`) separates what happens at the same
// time: the identifier and the forms it is read through above, then one lane per Ensembl gene line, the chosen
// answer's genes on the first lane, alternatives below, genes of one lineage kept on one lane where they fit.
// Horizontal on a wide screen (t = x), vertical on a phone (t = y): the same layout, the axes swapped.
import { middleCut, placeLabels, type PlacedLabel } from "../components/figure/labels";
import type { ModelCandidate, ModelNode, ModelStep, PathModel } from "./pathModel";

export interface LayoutMetrics {
  /** Stack distance between the rows of the identifier and its forms. */
  rowGap: number;
  /** Stack height of a lane with one target. */
  laneGap: number;
  /** Stack height of a lane that holds none of the best answers' genes (one row of scores below it, not two). */
  weakLaneGap: number;
  /** Stack height added per further target of one gene. */
  subGap: number;
  /** Space before the first row. */
  pad: number;
  /** Time offset per row of the forms above the lanes (so a chain read at one release does not overlap itself). */
  indent: number;
  /** Stack distance added between the last row of forms and the first lane (room for the lane's labels). */
  lead: number;
  /** Time distance before the answer column of each id a final path passes through. */
  via: number;
}

// A lane of the wide drawing holds two rows of labels above its bars (the genes' ids), so its height does not change
// with the zoom and nothing below the drawing moves; the steps' scores are drawn on one track under every lane.
export const HORIZONTAL_METRICS: LayoutMetrics = {
  rowGap: 28,
  laneGap: 58,
  weakLaneGap: 48,
  subGap: 30,
  pad: 36,
  indent: 16,
  lead: 20,
  via: 26,
};
export const VERTICAL_METRICS: LayoutMetrics = {
  rowGap: 26,
  laneGap: 30,
  weakLaneGap: 30,
  subGap: 20,
  pad: 18,
  indent: 14,
  lead: 0,
  via: 14,
};

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

interface AnswerRow {
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
  /** The rows above the genes' lanes: the identifier and its forms, then the ids bridges pass through. */
  rows: { id: string; kind: "upper" | "bridge"; s: number }[];
  /** The stack position of each lane of genes. */
  laneS: number[];
  /** Whether each lane holds a gene of the best answers (its lane has two rows of scores below it). */
  laneBest: boolean[];
  /** The stack extent of the drawing. */
  stackSize: number;
  /** Candidates drawn, in the api's order; the others are hidden until asked for. */
  shown: ModelCandidate[];
  hidden: number;
  /** Per lane whose answers were folded (more than `rowsPerLane`): the row under its last drawn answer, and how many
   *  of its candidates are not drawn. */
  folded: { lane: number; s: number; count: number }[];
}

interface LayoutOptions {
  /** Release to time coordinate (the view's zoomed scale). */
  scale: (release: number) => number;
  answerT: number;
  metrics: LayoutMetrics;
  /** How many candidates to draw (the best ones always). */
  limit: number;
  /** At most this many answers drawn per lane (one gene with hundreds of targets); the rest are counted, not drawn. */
  rowsPerLane?: number;
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
function loop(from: Point, to: Point, height: number): string {
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
  // Ids a bridge passes through: each on a row of its own between the forms and the genes, so that leaving Ensembl
  // through an external id and entering another gene is drawn as a move out of the genes' lanes and back.
  const bridgeRows = order.filter(
    (id) =>
      node(id)?.role === "bridge" &&
      visibleSteps.some((step) => step.api.kind === "bridge_near" && step.api.target === id),
  );

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
  const foldedCount = new Map<number, number>();
  const rowsPerLane = options.rowsPerLane ?? Number.POSITIVE_INFINITY;
  for (const candidate of shown) {
    const lane = laneOf.get(candidate.api.gene) ?? 0;
    const list = answersPerLane.get(lane) ?? [];
    if (list.length >= rowsPerLane) {
      foldedCount.set(lane, (foldedCount.get(lane) ?? 0) + 1);
      continue;
    }
    answersPerLane.set(lane, [...list, candidate]);
  }
  const laneS: number[] = [];
  const laneBest: boolean[] = [];
  let lastGap = metrics.laneGap;
  const rowsAbove = upper.length + bridgeRows.length;
  let cursor = metrics.pad + rowsAbove * metrics.rowGap + (rowsAbove ? metrics.lead : 0);
  for (let lane = 0; lane < Math.max(lanes, 1); lane += 1) {
    laneS[lane] = cursor;
    const count = (answersPerLane.get(lane)?.length ?? 1) + (foldedCount.has(lane) ? 1 : 0);
    laneBest[lane] = [...laneOf].some(([id, l]) => l === lane && bestNodes.has(id));
    lastGap = laneBest[lane] ? metrics.laneGap : metrics.weakLaneGap;
    cursor += lastGap + Math.max(0, count - 1) * metrics.subGap;
  }
  const stackSize = cursor - lastGap + metrics.pad + metrics.lead;

  const places = new Map<string, NodePlace>();
  upper.forEach((id, row) => {
    const n = node(id);
    if (!n) return;
    // A staircase of at most four steps before the release the forms are read at (the view reserves that room).
    const t = scale(n.first) - Math.min(4, upper.length - row) * metrics.indent;
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
  // Ids a bridge passes through: on their own row, at the bridge's release.
  for (const step of visibleSteps) {
    if (step.api.kind !== "bridge_near" || node(step.api.target)?.role !== "bridge") continue;
    if (places.has(step.api.target)) continue;
    const n = node(step.api.target);
    const row = bridgeRows.indexOf(step.api.target);
    if (!n || row < 0) continue;
    const t = scale(step.targetRelease);
    places.set(step.api.target, {
      node: n,
      t0: t,
      t1: t,
      s: metrics.pad + (upper.length + row) * metrics.rowGap,
      lane: null,
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
      // The transcripts or translations a final path passes through, between the genes and the answer column.
      const finals = candidate.api.final_path.map((index) => model.steps[index]).filter((x) => x !== undefined);
      finals.slice(0, -1).forEach((through, k) => {
        const n = node(through.api.target);
        if (!n || places.has(n.id)) return;
        const t = answerT - metrics.via * (finals.length - 1 - k);
        places.set(n.id, { node: n, t0: t, t1: t, s, lane, best: bestNodes.has(n.id) });
      });
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
  // (An id of a final path that is not drawn, a folded answer's, has no place: its steps are not drawn.)
  for (const id of order) {
    const n = node(id);
    if (!n || places.has(id) || n.role === "target") continue;
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

  const drawnCandidates = new Set([...answersPerLane.values()].flat().map((c) => c.index));
  const edges: EdgePlace[] = [];
  for (const step of visibleSteps) {
    if (!step.candidates.some((c) => drawnCandidates.has(c))) continue;
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
    rows: [
      ...upper.map((id, row) => ({ id, kind: "upper" as const, s: metrics.pad + row * metrics.rowGap })),
      ...bridgeRows.map((id, row) => ({
        id,
        kind: "bridge" as const,
        s: metrics.pad + (upper.length + row) * metrics.rowGap,
      })),
    ],
    laneS: laneS.slice(0, lanes),
    laneBest: laneBest.slice(0, lanes),
    stackSize,
    shown: shown.filter((c) => drawnCandidates.has(c.index)),
    hidden: model.candidates.length - drawnCandidates.size,
    folded: [...foldedCount].map(([lane, count]) => ({
      lane,
      s: (laneS[lane] ?? 0) + (answersPerLane.get(lane)?.length ?? 0) * metrics.subGap,
      count,
    })),
  };
}

/** The text of a label in a given width of characters: in full, or an identifier cut in its middle (its start and
 *  its version kept); `null` when not even a short form fits (the full id is then on focus). */
export function fitLabel(text: string, room: number): string | null {
  return middleCut(text, Math.floor(room));
}

/** The part of an Ensembl id after its version's dot (".20"), or null for an id without a version. */
export function versionPart(id: string): string | null {
  const dot = id.lastIndexOf(".");
  return dot > 0 && /^\.\d+$/.test(id.slice(dot)) ? id.slice(dot) : null;
}

/** An Ensembl id without its version ("ENSG00000141510"), or the id itself when it has none. */
function baseOf(id: string): string {
  const version = versionPart(id);
  return version === null ? id : id.slice(0, id.length - version.length);
}

/** The label of a gene after the gene before it on its lane (or after the lane's name, an id without version): its
 *  version alone where the two share the id. */
export function laneLabel(id: string, previous: string | null): string {
  const version = versionPart(id);
  if (previous === null || version === null) return id;
  return baseOf(previous) === baseOf(id) ? version : id;
}

/** The id every gene of a lane begins with, the lane's name in the gutter: the first gene's id without its version,
 *  where the lane's first gene has a version (the other genes are then labelled by their versions or their ids). */
export function laneNames(layout: PathLayout): Map<number, string> {
  const first = new Map<number, NodePlace>();
  for (const place of layout.nodes.values()) {
    if (place.node.role !== "gene" || place.lane === null) continue;
    const known = first.get(place.lane);
    if (!known || place.t0 < known.t0) first.set(place.lane, place);
  }
  const names = new Map<number, string>();
  for (const [lane, place] of first)
    if (versionPart(place.node.label) !== null) names.set(lane, baseOf(place.node.label));
  return names;
}

/**
 * The genes' labels of the wide drawing, by the figure grammar's placer: each gene's id (and each id a bridge passes
 * through on a lane) in the two rows above its lane, at the start of its bar, the chosen path's first, then in time
 * order; a gene after a gene of the same id on its lane (or under the lane's name) by its version alone; a long id cut
 * in its middle where its full form has no room. Rows are named `<lane>:a0` and `<lane>:a1`.
 */
export function pathLabels(
  layout: PathLayout,
  bounds: [number, number],
  names = new Map<number, string>(),
): Map<string, PlacedLabel> {
  const byLane = new Map<number, NodePlace[]>();
  for (const place of layout.nodes.values()) {
    if ((place.node.role !== "gene" && place.node.role !== "bridge") || place.lane === null) continue;
    byLane.set(place.lane, [...(byLane.get(place.lane) ?? []), place]);
  }
  const requests: {
    key: string;
    anchor: number;
    forms: string[];
    align: "start";
    rows: string[];
    flip: boolean;
    strong: boolean;
  }[] = [];
  for (const [lane, places] of [...byLane].sort((a, b) => a[0] - b[0])) {
    places.sort((a, b) => a.t0 - b.t0 || a.node.id.localeCompare(b.node.id));
    places.forEach((place, i) => {
      const previous = i > 0 ? (places[i - 1]?.node.label ?? null) : (names.get(lane) ?? null);
      const text = place.node.role === "gene" ? laneLabel(place.node.label, previous) : place.node.label;
      const cut = [14, 10].map((n) => middleCut(text, n)).filter((t): t is string => t !== null && t !== text);
      requests.push({
        key: `n:${place.node.id}`,
        anchor: place.t0,
        forms: [text, ...cut],
        align: "start",
        rows: [`${lane}:a0`, `${lane}:a1`],
        flip: true,
        strong: place.best,
      });
    });
  }
  // The marks a label must not cover, as extents taken in the rows above each lane: a re-mapping's arc rises into the
  // first row; a line that comes down into a lane from above crosses both rows where it meets the lane.
  const taken = new Map<string, [number, number][]>();
  const take = (row: string, span: [number, number]) => {
    taken.set(row, [...(taken.get(row) ?? []), span]);
  };
  const laneOf = (id: string | null) => (id === null ? null : (layout.nodes.get(id)?.lane ?? null));
  for (const edge of layout.edges) {
    if (edge.step.api.kind === "self_loop") {
      const lane = laneOf(edge.step.api.target);
      if (lane !== null) take(`${lane}:a0`, [edge.mid.t - 9, edge.mid.t + 9]);
      continue;
    }
    stubExtents(edge, laneOf, take);
    if (edge.from.s === edge.to.s) continue;
    for (const [end, other, id] of [
      [edge.from, edge.to, edge.step.api.source],
      [edge.to, edge.from, edge.step.api.target],
    ] as const) {
      const lane = laneOf(id);
      if (lane === null || other.s >= end.s) continue;
      take(`${lane}:a0`, [end.t - 5, end.t + 5]);
      take(`${lane}:a1`, [end.t - 5, end.t + 5]);
    }
  }
  return placeLabels([...requests.filter((r) => r.strong), ...requests.filter((r) => !r.strong)], {
    bounds,
    taken,
  });
}

/** The stubs of a split's or merge's other ids leave the event's glyph into the label rows above its lane: toward the
 *  later releases (a split) or from the earlier ones (a merge), along time on the drawing's scale. One or two stubs
 *  stay in the first row; the third rises into the second. */
function stubExtents(
  edge: EdgePlace,
  laneOf: (id: string | null) => number | null,
  take: (row: string, span: [number, number]) => void,
): void {
  const { splits, merges } = edge.step.api;
  const lane = laneOf(edge.step.api.target) ?? laneOf(edge.step.api.source);
  if (lane === null) return;
  for (const [n, side] of [
    [splits, 1],
    [merges, -1],
  ] as const) {
    if (!n) continue;
    const span: [number, number] = side > 0 ? [edge.mid.t + 2, edge.mid.t + 34] : [edge.mid.t - 34, edge.mid.t - 2];
    take(`${lane}:a0`, span);
    if (n >= 3) take(`${lane}:a1`, span);
  }
}

/** The steps drawn on the score track: the strong steps of Ensembl's history (on the chosen path, or of the candidate
 *  pointed at), each at its middle, with the api's score (or none). */
export function scoreSteps(
  layout: PathLayout,
  isStrong: (candidates: number[], best: boolean) => boolean,
): { edge: EdgePlace; weight: number | null; hue: "history" | "event" }[] {
  return layout.edges
    .filter(
      (edge) =>
        (edge.step.api.kind === "history" || edge.step.api.kind === "self_loop") &&
        isStrong(edge.step.candidates, edge.step.best),
    )
    .map((edge) => ({ edge, weight: edge.step.api.weight, hue: edge.step.hue === "event" ? "event" : "history" }));
}

/** The kinds of mark the drawn candidates' paths hold: the legend keys these, the rest behind "Key to every mark". */
export function presentMarks(model: PathModel, limit: number): Set<string> {
  const present = new Set<string>();
  const shown = shownCandidates(model, limit);
  const seenSteps = new Set<number>();
  const seenGenes = new Set<string>();
  if (shown.some((c) => !c.best)) present.add("weak");
  if (shown.length) present.add("final");
  for (const candidate of shown) {
    for (const index of candidate.steps) {
      const step = model.steps[index];
      if (!step) continue;
      // A step shared by many candidates (a gene's hundreds of targets) is read once, and once more for the best.
      if (seenSteps.has(index) && !candidate.best) continue;
      seenSteps.add(index);
      if (step.handoff) present.add("handoff");
      else if (step.kind === "history") present.add("version");
      if (step.kind === "split_merge") present.add("event");
      if (step.api.splits || step.api.merges) present.add("stubs");
      if (step.kind === "self_loop") present.add("loop");
      if (["entry_external", "bridge_near", "bridge_far", "final"].includes(step.kind)) present.add("cross");
      if (step.kind === "bridge_near" || step.kind === "entry_external") present.add("read");
      if (candidate.best && (step.kind === "history" || step.kind === "split_merge" || step.kind === "self_loop"))
        present.add("score");
      for (const id of [step.api.source, step.api.target]) {
        if (id === null || seenGenes.has(id)) continue;
        seenGenes.add(id);
        const node = model.nodeById.get(id);
        if (node?.role !== "gene") continue;
        present.add("gene");
        const ends = node.api.active.flatMap(([a, b]) => [a, b ?? Number.POSITIVE_INFINITY]);
        if (ends.length && (Math.min(...ends) < node.first || Math.max(...ends) > node.last)) present.add("life");
      }
    }
  }
  return present;
}
