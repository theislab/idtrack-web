// The path view's model: the api's explained path read into what is drawn, without adding a fact.
//
// The api gives one graph per conversion (`path.nodes`, `path.steps`) and, per candidate, the indices of its steps
// (`path` from the identifier to the gene, `final_path` from the gene to the target). The model keeps every step as
// the api sent it and adds only what drawing needs: for each step, the release at each of its ends and the kind it is
// drawn as; for each node, the releases over which the path holds it. The tests check, on real answers, that every
// candidate's drawn path is its api path, step for step.
//
// Every field of a node and a step that the api's document names is read; a field it does not name (an idtrack newer
// than the document) is kept in `extra` and shown with its exact value. idtrack names no runner-up: the decision is
// shown between the best answer and the first candidate that is not best, the pair idtrack's ranking compares
// (`decided_by`: "the runner-up (the first pair that is not best)").
import type { Candidate, ConversionResult, PathNode, PathStep } from "../api/types";
import { databaseLabel } from "./databases";

/** How a step is drawn. One hue per kind; the same everywhere on the page. */
export type StepHue = "history" | "event" | "external" | "ink";

/** The kind of a step for drawing. */
type DrawKind =
  | "identity" // the gene is its own answer: a ring, no line
  | "entry_external" // an external id or synonym read as an Ensembl id: crossing from an external database
  | "entry_ensembl" // an Ensembl form (transcript, translation, id without version) read as its gene
  | "history" // a version change or a replacement in Ensembl's id history
  | "split_merge" // a split, a merge, or both, in Ensembl's id history
  | "self_loop" // Ensembl re-mapped a gene to itself with a score
  | "bridge_near" // leaving a gene through an id it carries
  | "bridge_far" // entering another gene that carries the same id
  | "final" // the gene's id in the target database
  | "other"; // a kind this page does not know: drawn plainly, its values shown as sent

const HUE_OF: Record<DrawKind, StepHue> = {
  identity: "ink",
  entry_external: "external",
  entry_ensembl: "ink",
  history: "history",
  split_merge: "event",
  self_loop: "history",
  bridge_near: "external",
  bridge_far: "external",
  final: "external",
  other: "ink",
};

type NodeRole = "gene" | "upper" | "bridge" | "target";

export interface ModelNode {
  id: string;
  api: PathNode;
  /** The identifier for reading (the api's label of the node). */
  label: string;
  synonym: boolean;
  role: NodeRole;
  /** The node is the identifier as the graph read it (`graph_id`). */
  isQuery: boolean;
  /** The releases over which the path holds the node (from the releases of its steps). */
  first: number;
  last: number;
  /** Fields the api's document does not name (an idtrack newer than the document), with their values as sent. */
  extra: Record<string, unknown>;
}

export interface ModelStep {
  index: number;
  api: PathStep;
  kind: DrawKind;
  hue: StepHue;
  /** The release at the step's source side and at its target side (equal for a step that holds at one release). */
  sourceRelease: number;
  targetRelease: number;
  /** For a history step: the direction of travel through Ensembl's event (old -> new is forward). */
  direction: "forward" | "backward" | null;
  /** For a history step between assemblies: the assemblies on each side of the event (old, new). */
  handoff: { old: number; new: number } | null;
  /** The candidates (indices in the api's order) whose paths use the step. */
  candidates: number[];
  /** Part of a best candidate's path. */
  best: boolean;
  extra: Record<string, unknown>;
}

export interface ModelCandidate {
  /** Index in the api's `candidates` (its rank, 0 first). */
  index: number;
  api: Candidate;
  /** `path` then `final_path`: every step from the identifier to the target, in order. */
  steps: number[];
  best: boolean;
}

export interface Decision {
  /** The criterion's key, as the api named it. */
  key: string;
  best: ModelCandidate;
  /** The first candidate that is not best (idtrack names no runner-up). */
  runnerUp: ModelCandidate;
}

export interface PathModel {
  result: ConversionResult;
  nodes: ModelNode[];
  nodeById: Map<string, ModelNode>;
  steps: ModelStep[];
  candidates: ModelCandidate[];
  /** The releases the path touches, lowest and highest (null without a path). */
  span: [number, number] | null;
  decision: Decision | null;
  /** Problems of the api's data the model found (a step index out of range, a node missing): shown, never hidden. */
  problems: string[];
}

const KNOWN_NODE_FIELDS = new Set([
  "id",
  "kind",
  "label",
  "databases",
  "active",
  "assemblies",
  "non_reference",
  "places",
]);
const KNOWN_STEP_FIELDS = new Set([
  "kind",
  "source",
  "target",
  "key",
  "release",
  "old_release",
  "new_release",
  "weight",
  "splits",
  "merges",
  "databases",
  "assembly",
  "old_assembly",
  "reason",
  "places",
]);

function extraFields(value: object, known: Set<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) if (!known.has(key)) extra[key] = field;
  return extra;
}

function activeAt(node: PathNode | undefined, release: number): boolean {
  if (!node) return false;
  return node.active.some(([start, end]) => release >= start && (end === null || release <= end));
}

function drawKind(step: PathStep, source: PathNode | undefined): DrawKind {
  switch (step.kind) {
    case "identity":
      return "identity";
    case "entry":
      return source && (source.kind === "external" || source.kind === "synonym") ? "entry_external" : "entry_ensembl";
    case "history":
      return ["split", "merge", "split_and_merge"].includes(step.reason) ? "split_merge" : "history";
    case "self_loop":
      return "self_loop";
    case "bridge_near":
      return "bridge_near";
    case "bridge_far":
      return "bridge_far";
    case "final":
      return "final";
    default:
      return "other";
  }
}

/** The direction of a history step: forward when the source lives on the old side of Ensembl's event. */
export function historyDirection(
  step: PathStep,
  nodes: Map<string, PathNode>,
  result: ConversionResult,
): "forward" | "backward" | null {
  const source = step.source === null ? undefined : nodes.get(step.source);
  const target = nodes.get(step.target);
  const { old_release: oldRelease, new_release: newRelease } = step;
  if (oldRelease === null || newRelease === null) return null;
  if (activeAt(source, oldRelease) && activeAt(target, newRelease)) return "forward";
  if (activeAt(source, newRelease) && activeAt(target, oldRelease)) return "backward";
  // The nodes' life does not say (a node without active ranges): the direction of the conversion does.
  const from = result.from_release ?? result.to_release;
  return result.to_release >= from ? "forward" : "backward";
}

function stepReleases(
  step: PathStep,
  direction: "forward" | "backward" | null,
  result: ConversionResult,
): [number, number] {
  const fallback = result.to_release;
  if (step.kind === "history" || step.kind === "self_loop") {
    const oldRelease = step.old_release ?? step.release ?? fallback;
    const newRelease = step.new_release ?? step.release ?? fallback;
    return direction === "backward" ? [newRelease, oldRelease] : [oldRelease, newRelease];
  }
  if (step.kind === "identity") return [result.to_release, result.to_release];
  // A step at one release; a final step of confidence 1 holds at another release (`release` is null): it is drawn at
  // the target release, and its text says so.
  const release = step.release ?? (step.kind === "entry" ? (result.from_release ?? fallback) : fallback);
  return [release, release];
}

/** The decision between the best answer and the runner-up, as the api states it (`decided_by`). */
function decisionOf(result: ConversionResult, candidates: ModelCandidate[]): Decision | null {
  if (!result.decided_by) return null;
  const runnerUp = candidates.find((c) => !c.best) ?? null;
  if (!runnerUp) return null;
  const bests = candidates.filter((c) => c.best);
  // idtrack compares the lineage criteria with the first best answer, and the criteria within a lineage (score, being
  // the query, annotation) with the best successor of the runner-up's own entry gene (idtrack/engine/ranking.py,
  // `decided_by`); the best answers are equal in the lineage, so any of them shows the lineage's values.
  const within = ["score", "same_as_query", "annotation"].includes(result.decided_by);
  const rival = (within ? bests.find((c) => c.api.entry_gene === runnerUp.api.entry_gene) : undefined) ?? bests[0];
  if (!rival) return null;
  return { key: result.decided_by, best: rival, runnerUp };
}

export function buildModel(result: ConversionResult): PathModel {
  const problems: string[] = [];
  const apiNodes = result.path?.nodes ?? [];
  const apiSteps = result.path?.steps ?? [];
  const nodeMap = new Map(apiNodes.map((n) => [n.id, n]));

  const candidates: ModelCandidate[] = result.candidates.map((candidate, index) => {
    const steps = [...candidate.path, ...candidate.final_path];
    for (const step of steps) {
      if (!Number.isInteger(step) || step < 0 || step >= apiSteps.length) {
        problems.push(`Candidate ${index + 1} names step ${step}, which the path does not hold.`);
      }
    }
    return { index, api: candidate, steps: steps.filter((s) => s >= 0 && s < apiSteps.length), best: candidate.best };
  });

  const usedBy = new Map<number, number[]>();
  for (const candidate of candidates) {
    for (const step of candidate.steps) usedBy.set(step, [...(usedBy.get(step) ?? []), candidate.index]);
  }

  const steps: ModelStep[] = apiSteps.map((api, index) => {
    const source = api.source === null ? undefined : nodeMap.get(api.source);
    if (api.source !== null && !source) problems.push(`Step ${index} leaves ${api.source}, which is not a node.`);
    if (!nodeMap.has(api.target)) problems.push(`Step ${index} enters ${api.target}, which is not a node.`);
    const kind = drawKind(api, source);
    const direction =
      api.kind === "history" || api.kind === "self_loop" ? historyDirection(api, nodeMap, result) : null;
    const [sourceRelease, targetRelease] = stepReleases(api, direction, result);
    const handoff =
      api.kind === "history" && api.old_assembly !== null && api.assembly !== null && api.old_assembly !== api.assembly
        ? { old: api.old_assembly, new: api.assembly }
        : null;
    const users = usedBy.get(index) ?? [];
    return {
      index,
      api,
      kind,
      hue: HUE_OF[kind],
      sourceRelease,
      targetRelease,
      direction,
      handoff,
      candidates: users,
      best: users.some((c) => candidates[c]?.best === true),
      extra: extraFields(api, KNOWN_STEP_FIELDS),
    };
  });

  // Roles: Ensembl genes on lanes; targets of final steps in the answer column; ids a bridge passes through on the
  // lane of the gene it leaves; everything else (the identifier, the forms it is read through) above the lanes.
  const roleOf = new Map<string, NodeRole>();
  for (const step of steps) {
    if (step.api.kind === "final") roleOf.set(step.api.target, "target");
  }
  for (const step of steps) {
    if (step.api.kind === "bridge_near" && !roleOf.has(step.api.target)) roleOf.set(step.api.target, "bridge");
  }

  const releasesOf = new Map<string, number[]>();
  const touch = (id: string | null, release: number) => {
    if (id === null) return;
    releasesOf.set(id, [...(releasesOf.get(id) ?? []), release]);
  };
  for (const step of steps) {
    touch(step.api.source, step.sourceRelease);
    touch(step.api.target, step.targetRelease);
  }
  for (const candidate of candidates) touch(candidate.api.gene, result.to_release);
  if (result.graph_id !== null && result.from_release !== null) touch(result.graph_id, result.from_release);

  const nodes: ModelNode[] = apiNodes.map((api) => {
    const releases = releasesOf.get(api.id) ?? [result.to_release];
    const role = roleOf.get(api.id) ?? (api.kind === "ensembl_gene" ? "gene" : "upper");
    return {
      id: api.id,
      api,
      label: api.label,
      synonym: api.kind === "synonym",
      role,
      isQuery: api.id === result.graph_id,
      first: Math.min(...releases),
      last: Math.max(...releases),
      extra: extraFields(api, KNOWN_NODE_FIELDS),
    };
  });

  // The releases the drawing spans: every step's, and the releases the identifier is read at and converted to.
  const touched = steps.flatMap((s) => [s.sourceRelease, s.targetRelease]);
  if (touched.length) {
    touched.push(result.to_release);
    if (result.from_release !== null) touched.push(result.from_release);
  }
  const span: [number, number] | null = touched.length ? [Math.min(...touched), Math.max(...touched)] : null;

  return {
    result,
    nodes,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    steps,
    candidates,
    span,
    decision: decisionOf(result, candidates),
    problems,
  };
}

/** A history step in Ensembl's direction: the event's earlier id (at its last release, `old_release`) and its later
 *  id (at its first, `new_release`), whichever way the walk went. */
export function ensemblPair(
  step: PathStep,
  direction: "forward" | "backward" | null,
): { earlier: string | null; later: string | null } {
  return direction === "backward"
    ? { earlier: step.target, later: step.source }
    : { earlier: step.source, later: step.target };
}

/** The databases of a step or node for reading (a synonym database marked as such). */
export function databaseList(databases: readonly string[]): string {
  return databases.map(databaseLabel).join(", ");
}

/** The answer's path holds no history step and every step holds at one release. */
export function atOneRelease(model: PathModel): number | null {
  if (!model.steps.length) return null;
  if (model.steps.some((s) => s.api.kind === "history" || s.api.kind === "self_loop")) return null;
  const releases = new Set(model.steps.flatMap((s) => [s.sourceRelease, s.targetRelease]));
  return releases.size === 1 ? ([...releases][0] ?? null) : null;
}
