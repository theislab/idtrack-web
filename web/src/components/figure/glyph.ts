// The kinds of step the figures draw (DESIGN.md, "The figure grammar"): which glyph a step of the api's explained path
// takes, and the hue of its family. The marks themselves are drawn by glyphs.tsx.
import type { PathStep } from "../../api/types";

export type Glyph =
  /** A new version or a replacement in Ensembl's id history: a tick across the gene's bar. */
  | "version"
  /** A split, a merge, or both: a dot. */
  | "event"
  /** A re-mapping of a gene to itself: an arc over the bar. */
  | "loop"
  /** A history step between two assemblies: a diamond (filled on the chosen path, outlined on an alternative). */
  | "handoff"
  /** The identifier read through an external database: an open square. */
  | "read"
  /** A bridge through an id two genes carry: an open square with a dot. */
  | "bridge"
  /** The answer's id in the database asked: a filled square. */
  | "final"
  /** A gene that is its own answer: a ring. */
  | "identity"
  /** An Ensembl form of the identifier (a transcript, a translation, an id without version) read as its gene, or the
   *  release the identifier is read at: an open circle. */
  | "form";

export type Hue = "history" | "event" | "external" | "handoff" | "ink";

export const HUE: Record<Glyph, Hue> = {
  version: "history",
  event: "event",
  loop: "history",
  handoff: "handoff",
  read: "external",
  bridge: "external",
  final: "external",
  identity: "ink",
  form: "ink",
};

const EVENTS = new Set(["split", "merge", "split_and_merge"]);

/** A history step whose two ends lie on different assemblies. */
export function crossesAssemblies(step: PathStep): boolean {
  return (
    (step.kind === "history" || step.kind === "self_loop") &&
    step.old_assembly !== null &&
    step.assembly !== null &&
    step.old_assembly !== step.assembly
  );
}

/** A split, a merge, or both. */
export function isEvent(step: PathStep): boolean {
  return step.kind === "history" && EVENTS.has(step.reason);
}

/** The glyph of a step of the api's explained path, by its kind (and, for history, its reason and assemblies; for an
 *  entry, the kind of the identifier it reads: an external id or a synonym is read through its database). */
export function glyphOf(step: PathStep, sourceKind?: string): Glyph {
  if (crossesAssemblies(step)) return "handoff";
  if (step.kind === "self_loop") return "loop";
  if (step.kind === "history") return isEvent(step) ? "event" : "version";
  if (step.kind === "bridge_near" || step.kind === "bridge_far") return "bridge";
  if (step.kind === "final") return "final";
  if (step.kind === "identity") return "identity";
  if (step.kind === "entry") return sourceKind === "external" || sourceKind === "synonym" ? "read" : "form";
  return "form";
}
