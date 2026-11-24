// The path in words: every step of every candidate, in order, with the exact values the api sent. The same text is
// shown beside the drawing, read by screen readers, and copied.
import type { AssemblyDescription, GenePlace } from "../api/types";
import { databaseLabel } from "./databases";
import { pythonFloat } from "./numbers";
import type { ModelCandidate, ModelNode, ModelStep, PathModel } from "./pathModel";
import { databaseList } from "./pathModel";
import { prose } from "./values";
import { spaced, type Vocabulary } from "./vocabulary";

export type AssemblyNames = Map<number, string>;

export function assemblyNames(assemblies: readonly AssemblyDescription[]): AssemblyNames {
  return new Map(assemblies.map((a) => [a.assembly, a.name ?? String(a.assembly)]));
}

export function assemblyText(assembly: number | null, names: AssemblyNames): string {
  if (assembly === null) return "none";
  const name = names.get(assembly);
  return name && name !== String(assembly) ? `${name} (${assembly})` : String(assembly);
}

const NODE_KIND_WORDS: Record<string, string> = {
  ensembl_gene: "Ensembl gene",
  base_ensembl_gene: "Ensembl gene id without version",
  ensembl_transcript: "Ensembl transcript",
  ensembl_translation: "Ensembl translation",
  external: "external id",
  synonym: "synonym",
};

export function nodeKindWords(kind: string): string {
  return NODE_KIND_WORDS[kind] ?? kind;
}

export function nodeName(node: ModelNode | undefined, id: string | null): string {
  if (id === null) return "—";
  return node ? node.label : id;
}

function ranges(list: readonly (readonly [number, number])[] | readonly number[][]): string {
  return list.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

/** Where a gene lies, with the exact values the api sent: assembly, region, first and last base, strand, releases. */
export function placeText(place: GenePlace, names: AssemblyNames): string {
  const strand = place.strand > 0 ? "+" : place.strand < 0 ? "−" : String(place.strand);
  const where = `${assemblyText(place.assembly, names)} ${place.region}:${place.start}–${place.end} (${strand} strand)`;
  const reference = place.reference ? "" : ", outside the reference sequence";
  return `${where}, releases ${ranges(place.releases)}${reference}`;
}

/** A relation of two genes' places, with its meaning from the api where it gives one. */
export function placesText(code: string, vocabulary: Vocabulary): string {
  const meaning = vocabulary.placeRelations.get(code);
  return meaning ? `${spaced(code)}: ${prose(meaning)}` : spaced(code);
}

/** The facts of a node, each as label and exact value. */
export function nodeFacts(node: ModelNode, names: AssemblyNames): [string, string][] {
  const facts: [string, string][] = [
    ["Identifier", node.api.label],
    ["Kind", `${nodeKindWords(node.api.kind)} (${node.api.kind})`],
  ];
  if (node.api.id !== node.api.label) facts.push(["Node", node.api.id]);
  if (node.api.databases.length) facts.push(["Databases", databaseList(node.api.databases)]);
  if (node.api.active.length) {
    facts.push([
      "Active",
      node.api.active
        .map(([a, b]) => (b === null ? `${a} to the graph's last release` : a === b ? `${a}` : `${a}–${b}`))
        .join(", "),
    ]);
    const ends = node.api.active.map(([, b]) => b).filter((b): b is number => b !== null);
    const open = node.api.active.some(([, b]) => b === null);
    if (!open && ends.length) {
      // The api has no retirement step: the end is read from the releases at which the gene exists.
      facts.push(["Last release", `${Math.max(...ends)}, read from its active releases (no retirement step is given)`]);
    }
  }
  if (node.api.assemblies.length)
    facts.push(["Assemblies", node.api.assemblies.map((a) => assemblyText(a, names)).join(", ")]);
  if (node.api.non_reference.length) facts.push(["Outside the reference sequence", ranges(node.api.non_reference)]);
  node.api.places.forEach((place, i, all) => {
    facts.push([all.length === 1 ? "Place" : `Place ${i + 1}`, placeText(place, names)]);
  });
  facts.push([
    "On the path",
    node.first === node.last ? `release ${node.first}` : `releases ${node.first}–${node.last}`,
  ]);
  for (const [key, value] of Object.entries(node.extra)) facts.push([key, JSON.stringify(value)]);
  return facts;
}

/** The facts of a step, each as label and exact value. */
export function stepFacts(
  step: ModelStep,
  model: PathModel,
  names: AssemblyNames,
  vocabulary: Vocabulary,
): [string, string][] {
  const a = step.api;
  const source = a.source === null ? undefined : model.nodeById.get(a.source);
  const target = model.nodeById.get(a.target);
  const facts: [string, string][] = [
    ["Step", `${spaced(a.reason)} (${a.kind})`],
    ["Why", prose(vocabulary.stepReasons.get(a.reason) ?? "The api gives no text for this reason.")],
  ];
  if (a.source !== null) facts.push(["From", nodeName(source, a.source)]);
  facts.push(["To", nodeName(target, a.target)]);
  if (a.old_release !== null || a.new_release !== null) {
    facts.push([
      "Ensembl event",
      `release ${a.old_release ?? "—"} → ${a.new_release ?? "—"} (old id's last, new id's first)`,
    ]);
    if (step.direction) facts.push(["Travel", step.direction === "forward" ? "forward in time" : "backward in time"]);
  }
  if (a.release !== null) facts.push(["Release", String(a.release)]);
  else if (a.kind === "final") facts.push(["Release", "another release than the target (final confidence 1)"]);
  if (a.weight !== null) facts.push(["Score", pythonFloat(a.weight)]);
  else if (a.kind === "history") facts.push(["Score", "none given"]);
  if (a.kind === "history" || a.splits || a.merges) {
    facts.push(["Split", `${a.splits} other id${a.splits === 1 ? "" : "s"} at this release`]);
    facts.push(["Merged", `${a.merges} other id${a.merges === 1 ? "" : "s"} at this release`]);
  }
  if (a.databases.length) facts.push(["Databases", a.databases.map(databaseLabel).join(", ")]);
  if (step.handoff) {
    facts.push([
      "Assembly handoff",
      `${assemblyText(step.handoff.old, names)} → ${assemblyText(step.handoff.new, names)}`,
    ]);
  } else if (a.assembly !== null) {
    facts.push(["Assembly", assemblyText(a.assembly, names)]);
  }
  if (a.places !== null) facts.push(["Places", placesText(a.places, vocabulary)]);
  if (a.key !== null) facts.push(["History edge key", String(a.key)]);
  for (const [key, value] of Object.entries(step.extra)) facts.push([key, JSON.stringify(value)]);
  return facts;
}

/** One step in one sentence, with its exact values. */
export function stepSentence(step: ModelStep, model: PathModel, names: AssemblyNames): string {
  const a = step.api;
  const source = a.source === null ? undefined : model.nodeById.get(a.source);
  const target = model.nodeById.get(a.target);
  const from = nodeName(source, a.source);
  const to = nodeName(target, a.target);
  const dbs = a.databases.length ? ` [${a.databases.map(databaseLabel).join(", ")}]` : "";
  switch (a.kind) {
    case "identity":
      return `${to} exists at release ${model.result.to_release}: it is its own answer.`;
    case "entry":
      return `${from} is read at release ${a.release ?? "—"} as ${to}${dbs}.`;
    case "history":
    case "self_loop": {
      const what = spaced(a.reason);
      const score = a.weight === null ? "no score" : `score ${pythonFloat(a.weight)}`;
      const counts = a.splits || a.merges ? `, ${a.splits} other split, ${a.merges} other merged` : "";
      const handoff = step.handoff
        ? `, assembly ${assemblyText(step.handoff.old, names)} → ${assemblyText(step.handoff.new, names)}`
        : "";
      const travel = step.direction === "backward" ? ", travelled backward" : "";
      const places = a.places === null ? "" : `, ${spaced(a.places)}`;
      return `${from} → ${to}: ${what} at releases ${a.old_release ?? "—"} → ${a.new_release ?? "—"} (${score}${counts}${handoff}${places}${travel}).`;
    }
    case "bridge_near":
      return `${from} leaves at release ${a.release ?? "—"} through ${to}, an id it carries${dbs}.`;
    case "bridge_far":
      return `${from} enters ${to}, another gene that carries it, at release ${a.release ?? "—"}${dbs}.`;
    case "final":
      return a.release === null
        ? `${from} has the id ${to} through a transcript or translation it had at another release${dbs}.`
        : `${from} has the id ${to} at release ${a.release}${dbs}.`;
    default:
      return `${from} → ${to} (${a.kind}, ${a.reason}).`;
  }
}

export function candidateTitle(candidate: ModelCandidate): string {
  const c = candidate.api;
  const role = c.best ? "best" : "alternative";
  const target = c.target === c.gene ? c.gene : `${c.target} (gene ${c.gene})`;
  return `Candidate ${candidate.index + 1} (${role}): ${target}`;
}

/** The whole reading as plain text (copied by the copy button). */
export function readingText(model: PathModel, names: AssemblyNames): string {
  const r = model.result;
  const lines = [
    `${r.query_id} at release ${r.from_release ?? "—"} → release ${r.to_release}, ${r.final_database ?? "no database"}: ${r.status}`,
  ];
  for (const candidate of model.candidates) {
    lines.push("", candidateTitle(candidate));
    if (!candidate.steps.length) lines.push("  (no path: the conversion was asked without explain)");
    candidate.steps.forEach((index, i) => {
      const step = model.steps[index];
      if (step) lines.push(`  ${i + 1}. ${stepSentence(step, model, names)}`);
    });
  }
  return lines.join("\n");
}
