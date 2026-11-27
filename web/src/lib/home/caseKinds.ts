// What makes an answer of the api a case of a kind: each kind is read from the answer's own fields (the steps of a
// best candidate's path, the other readings, the status, the refused steps), never from the identifier. The api's
// showcase tests check every case of its data with the same rules (api/tests/test_real_showcase.py), the end-to-end
// tests check the cards the page draws, and the unit tests check the rules on recorded answers.
import type { ConversionResult, PathStep } from "../../api/types";

/** The kinds of the showcase's cases (`ShowcaseCase.kind`). */
export type CaseKind =
  | "lineage"
  | "renamed"
  | "new_version"
  | "replaced"
  | "split"
  | "merge"
  | "handoff"
  | "bridge"
  | "other_release"
  | "tie"
  | "final"
  | "retired"
  | "refused";

export const CASE_KINDS: readonly CaseKind[] = [
  "lineage",
  "renamed",
  "new_version",
  "replaced",
  "split",
  "merge",
  "handoff",
  "bridge",
  "other_release",
  "tie",
  "final",
  "retired",
  "refused",
];

export const isCaseKind = (kind: string): kind is CaseKind => (CASE_KINDS as readonly string[]).includes(kind);

/** The steps of the first best candidate, in order (its path, then its final path). */
export function bestSteps(result: ConversionResult): PathStep[] {
  const best = result.candidates.find((c) => c.best);
  const steps = result.path?.steps ?? [];
  if (!best) return [];
  return [...best.path, ...best.final_path].map((i) => steps[i]).filter((s): s is PathStep => s !== undefined);
}

/** A history step between two assemblies: the assembly of its old end is not that of its new end. */
export function isHandoff(step: PathStep): boolean {
  return (
    (step.kind === "history" || step.kind === "self_loop") &&
    step.old_assembly !== null &&
    step.assembly !== null &&
    step.old_assembly !== step.assembly
  );
}

/** A symbol read in the database it is answered in, whose best answer is another string. */
export function isRenamedAnswer(result: ConversionResult): boolean {
  const asked = result.final_database;
  if (asked === null || !result.from_databases.includes(asked)) return false;
  const targets = result.candidates.filter((c) => c.best).map((c) => c.target);
  return targets.length > 0 && !targets.includes(result.query_id);
}

/** Whether the answer is a case of the kind (`assemblies`: every assembly of the graph, for a lineage). */
export function holdsKind(kind: CaseKind, result: ConversionResult, assemblies?: ReadonlySet<number>): boolean {
  const steps = bestSteps(result);
  const reasons = new Set(steps.map((s) => s.reason));
  const answered = result.candidates.some((c) => c.best);
  switch (kind) {
    case "new_version":
    case "replaced":
    case "merge":
    case "final":
      return reasons.has(kind) && answered;
    case "renamed":
      return reasons.has("final") && isRenamedAnswer(result);
    case "split":
      return reasons.has("split") || reasons.has("split_and_merge");
    case "handoff":
      return steps.some(isHandoff);
    case "bridge":
      return reasons.has("bridge_near") && reasons.has("bridge_far");
    case "other_release":
      return result.other_readings.some((r) => r.reason === "other_release");
    case "tie":
      return result.status === "tie" && result.tie;
    case "retired":
      return result.status === "no_conversion" && result.reasons.includes("no_path_to_target");
    case "refused":
      return (result.path?.refused ?? []).some((s) => s.reason === "mitochondrial_genome");
    case "lineage": {
      if (!assemblies) return answered && steps.some(isHandoff);
      const held = new Set(steps.flatMap((s) => [s.assembly, s.old_assembly]).filter((a): a is number => a !== null));
      return held.size === assemblies.size && [...assemblies].every((a) => held.has(a));
    }
  }
}
