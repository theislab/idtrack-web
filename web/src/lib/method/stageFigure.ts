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
