// The anatomy of an answer: what the result says about each stage of idtrack's work, read from its own fields and
// nothing else. Read (how the identifier matched), walked (the chosen path's steps), ranked (the candidates and the
// criterion that decided), answered (the targets in the database asked). Counts are counts of the api's lists; no
// value is computed from another.
import type { ConversionResult } from "../api/types";
import type { ModelCandidate, PathModel, StepHue } from "./pathModel";

interface StepCount {
  /** The step's reason, as the api names it. */
  reason: string;
  hue: StepHue;
  count: number;
}

export interface Anatomy {
  read: {
    found: boolean;
    graphId: string | null;
    match: string | null;
    databases: string[];
    release: number | null;
    inferred: boolean;
    fallback: boolean;
    given: number | null;
    knownVersions: string[];
  };
  walked: {
    /** The path was asked for (`explain`) and the result has one. */
    explained: boolean;
    /** The candidate whose path is described: the first best answer. */
    candidate: ModelCandidate | null;
    /** The hue of each step of that path, in order (the strip drawn beside the counts). */
    hues: StepHue[];
    steps: number;
    byReason: StepCount[];
    /** The releases of the path's first and last step ends, in the order of travel. */
    releases: [number, number] | null;
    /** The assemblies of the path in order, each named once per run. */
    assemblies: number[];
    handoffs: number;
    /** The bridges the search considered, taken and refused (`path.bridges`), and the history steps it refused. */
    bridgesTaken: number;
    bridgesRefused: number;
    refused: number;
    backward: boolean;
  };
  ranked: {
    candidates: number;
    best: number;
    tie: boolean;
    decidedBy: string | null;
    /** The position of the deciding criterion in idtrack's order (1 first), null where the api's vocabulary lacks it. */
    position: number | null;
    criteria: number;
  };
  answered: {
    targets: string[];
    noTarget: boolean;
    status: string;
  };
}

export function anatomyOf(result: ConversionResult, model: PathModel, criteria: readonly string[]): Anatomy {
  const candidate = model.candidates.find((c) => c.best) ?? null;
  const steps = candidate ? candidate.steps.map((i) => model.steps[i]).filter((s) => s !== undefined) : [];
  const byReason: StepCount[] = [];
  for (const step of steps) {
    const known = byReason.find((r) => r.reason === step.api.reason);
    if (known) known.count += 1;
    else byReason.push({ reason: step.api.reason, hue: step.hue, count: 1 });
  }
  const assemblies: number[] = [];
  const pushAssembly = (assembly: number | null) => {
    if (assembly !== null && assemblies[assemblies.length - 1] !== assembly) assemblies.push(assembly);
  };
  for (const step of steps) {
    if (step.handoff) {
      pushAssembly(step.direction === "backward" ? step.handoff.new : step.handoff.old);
      pushAssembly(step.direction === "backward" ? step.handoff.old : step.handoff.new);
    } else pushAssembly(step.api.assembly);
  }
  const first = steps[0];
  const last = steps[steps.length - 1];
  const bridges = result.path?.bridges ?? [];
  const position = result.decided_by ? criteria.indexOf(result.decided_by) : -1;
  const bests = result.candidates.filter((c) => c.best);
  return {
    read: {
      found: result.graph_id !== null,
      graphId: result.graph_id,
      match: result.match,
      databases: result.from_databases,
      release: result.from_release,
      inferred: result.from_release_inferred,
      fallback: result.from_release_fallback,
      given: result.from_release_given,
      knownVersions: result.known_versions,
    },
    walked: {
      explained: result.path !== null,
      candidate,
      hues: steps.map((s) => s.hue),
      steps: steps.length,
      byReason,
      releases: first && last ? [first.sourceRelease, last.targetRelease] : null,
      assemblies,
      handoffs: steps.filter((s) => s.handoff !== null).length,
      bridgesTaken: bridges.filter((b) => b.taken).length,
      bridgesRefused: bridges.filter((b) => !b.taken).length,
      refused: result.path?.refused.length ?? 0,
      backward: steps.some((s) => s.direction === "backward"),
    },
    ranked: {
      candidates: result.candidates.length,
      best: bests.length,
      tie: result.tie,
      decidedBy: result.decided_by,
      position: position >= 0 ? position + 1 : null,
      criteria: criteria.length,
    },
    answered: {
      targets: [...new Set(bests.map((c) => c.target))],
      noTarget: result.no_target,
      status: result.status,
    },
  };
}
