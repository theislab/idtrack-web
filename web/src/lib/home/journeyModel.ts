// One journey of the Convert page's first figure: a conversion's best answer as idtrack's explained path gives it,
// placed on the release axis. The steps are the api's objects, in the order of the best candidate's path; the model
// adds only where each sits (a history step between the two releases it joins, a cross-reference step at its release)
// and which crossings leave Ensembl for an external database (the databases the identifier was read through, the
// databases a bridge passes through, the database the answer is given in).
import type { Candidate, ConversionResult, PathStep } from "../../api/types";
import { glyphOf } from "../../components/figure/glyph";
import { bestSteps } from "./caseKinds";

type MarkKind = "version" | "event" | "loop" | "handoff" | "entry" | "bridge" | "final" | "identity";

export interface JourneyMark {
  step: PathStep;
  /** Its number among the best candidate's steps (1 for the first). */
  number: number;
  kind: MarkKind;
  /** Where it sits on the axis, in releases (a history step halfway between its two releases). */
  at: number;
}

interface Crossing {
  at: number;
  databases: string[];
  role: "read" | "bridge" | "answer";
}

export interface JourneyModel {
  result: ConversionResult;
  best: Candidate[];
  marks: JourneyMark[];
  crossings: Crossing[];
  /** The releases the drawn line spans. */
  lo: number;
  hi: number;
  backward: boolean;
}

/** Ensembl's own relations and forms, which are not external databases. */
export function isEnsembl(database: string): boolean {
  return /^(base_)?ensembl_/.test(database);
}

/** The mark of a step: the figure grammar's glyph for Ensembl's history (a version, a split or merge, a re-mapping, a
 *  handoff), the crossing it is for the other kinds. */
function kindOf(step: PathStep): MarkKind {
  if (step.kind === "history" || step.kind === "self_loop") {
    const glyph = glyphOf(step);
    return glyph === "handoff" || glyph === "event" || glyph === "loop" ? glyph : "version";
  }
  if (step.kind === "bridge_near" || step.kind === "bridge_far") return "bridge";
  if (step.kind === "final") return "final";
  if (step.kind === "identity") return "identity";
  return "entry";
}

/** The steps of one candidate, in order (its path, then its final path). */
export function candidateSteps(result: ConversionResult, candidate: Candidate): PathStep[] {
  const steps = result.path?.steps ?? [];
  return [...candidate.path, ...candidate.final_path]
    .map((i) => steps[i])
    .filter((s): s is PathStep => s !== undefined);
}

/** The marks of a list of steps on the release axis (a history step halfway between its two releases). */
export function marksOf(steps: readonly PathStep[], to: number): JourneyMark[] {
  return steps.map((step, i) => {
    const at =
      step.old_release !== null && step.new_release !== null
        ? (step.old_release + step.new_release) / 2
        : (step.release ?? to);
    return { step, number: i + 1, kind: kindOf(step), at };
  });
}

export function journeyModel(result: ConversionResult): JourneyModel | null {
  const best = result.candidates.filter((c) => c.best);
  if (!best.length || result.from_release === null || !result.path) return null;
  const from = result.from_release;
  const to = result.to_release;
  const marks: JourneyMark[] = bestSteps(result).map((step, i) => {
    const at =
      step.old_release !== null && step.new_release !== null
        ? (step.old_release + step.new_release) / 2
        : (step.release ?? to);
    return { step, number: i + 1, kind: kindOf(step), at };
  });
  const crossings: Crossing[] = [];
  const read = result.from_databases.filter((d) => !isEnsembl(d));
  if (read.length) crossings.push({ at: from, databases: read, role: "read" });
  for (const m of marks) {
    if (m.step.kind === "bridge_near") {
      const databases = m.step.databases.filter((d) => !isEnsembl(d));
      if (databases.length) crossings.push({ at: m.at, databases, role: "bridge" });
    }
  }
  const asked = result.final_database;
  if (asked !== null && !isEnsembl(asked) && marks.some((m) => m.kind === "final")) {
    crossings.push({ at: to, databases: [asked], role: "answer" });
  }
  const releases = [from, to, ...marks.map((m) => m.at)];
  return {
    result,
    best,
    marks,
    crossings,
    lo: Math.min(...releases),
    hi: Math.max(...releases),
    backward: to < from,
  };
}

/** The best answer's targets in words: one target, or a tie and its number of targets. */
export function answerText(model: JourneyModel): string {
  const targets = [...new Set(model.best.map((c) => c.target))];
  if (targets.length === 1) return targets[0] ?? "";
  return `${targets[0] ?? ""} +${targets.length - 1}`;
}

/** A release at which many of the journeys drawn take a step of one kind: the figure says what happened there. */
export interface ReleaseEvent {
  /** The step's two releases (Ensembl's direction: the earlier, then the later). */
  old: number;
  new: number;
  /** A history step across an assembly change, a re-mapping of genes to themselves, or a new version or a
   *  replacement. */
  kind: "handoff" | "loop" | "version";
  /** The journeys that take such a step there, and the journeys drawn. */
  journeys: number;
  of: number;
  /** For a handoff, the assemblies of its two ends (their keys, as the steps give them). */
  assemblies: [number, number] | null;
}

/** The releases at which at least `share` of the journeys drawn (and at least three) take a history step of one kind,
 *  counted from the steps of their best answers: each journey once per release and kind. Most journeys first. */
export function releaseEvents(models: readonly JourneyModel[], share = 0.4): ReleaseEvent[] {
  const seen = new Map<string, { event: ReleaseEvent; journeys: Set<number> }>();
  models.forEach((m, j) => {
    for (const mark of m.marks) {
      const s = mark.step;
      if ((s.kind !== "history" && s.kind !== "self_loop") || s.old_release === null || s.new_release === null)
        continue;
      const kind =
        mark.kind === "handoff"
          ? "handoff"
          : mark.kind === "loop"
            ? "loop"
            : mark.kind === "version"
              ? "version"
              : null;
      if (!kind) continue;
      const old = Math.min(s.old_release, s.new_release);
      const later = Math.max(s.old_release, s.new_release);
      const assemblies: [number, number] | null =
        kind === "handoff" && s.old_assembly !== null && s.assembly !== null
          ? s.new_release >= s.old_release
            ? [s.old_assembly, s.assembly]
            : [s.assembly, s.old_assembly]
          : null;
      const key = `${kind}|${old}|${later}|${assemblies?.join(">") ?? ""}`;
      const entry = seen.get(key) ?? {
        event: { old, new: later, kind, journeys: 0, of: models.length, assemblies },
        journeys: new Set<number>(),
      };
      entry.journeys.add(j);
      seen.set(key, entry);
    }
  });
  const least = Math.max(3, Math.ceil(share * models.length));
  return [...seen.values()]
    .map(({ event, journeys }) => ({ ...event, journeys: journeys.size }))
    .filter((e) => e.journeys >= least)
    .sort((a, b) => b.journeys - a.journeys || a.old - b.old);
}

/** The words of a release-wide event (the journeys drawn that take such a step there). */
export function eventWords(e: ReleaseEvent, assemblyName: (key: number) => string): string {
  if (e.kind === "handoff" && e.assemblies)
    return `cross ${assemblyName(e.assemblies[0])} → ${assemblyName(e.assemblies[1])}`;
  if (e.kind === "handoff") return "cross an assembly change";
  return e.kind === "loop" ? "re-mapped to themselves" : "take a new version";
}

/** The events the figure draws: the most shared of each kind first (an assembly change, a re-mapping, a new version),
 *  then the most shared of the rest, at most `n`, in the order of the releases. */
export function drawnEvents(events: readonly ReleaseEvent[], n: number): ReleaseEvent[] {
  const firsts = (["handoff", "loop", "version"] as const).flatMap((k) => {
    const e = events.find((x) => x.kind === k);
    return e ? [e] : [];
  });
  const rest = events.filter((e) => !firsts.includes(e));
  return [...firsts, ...rest].slice(0, n).sort((a, b) => a.old - b.old);
}
