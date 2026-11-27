// The path in words: every step of every candidate, in order, with the exact values the api sent. The same text is
// shown beside the drawing, read by screen readers, and copied.
import type { AssemblyDescription, GenePlace } from "../api/types";
import { databaseLabel } from "./databases";
import { pythonFloat } from "./numbers";
import {
  type ModelCandidate,
  type ModelNode,
  type ModelStep,
  type PathModel,
  databaseList,
  ensemblPair,
} from "./pathModel";
import { prose } from "./values";
import { spaced, type Vocabulary } from "./vocabulary";

export type AssemblyNames = Map<number, string>;

export function assemblyNames(assemblies: readonly AssemblyDescription[]): AssemblyNames {
  return new Map(assemblies.map((a) => [a.assembly, a.name ?? String(a.assembly)]));
}

/** An assembly by its name (idtrack's key of it, a number that reads like a release, is left to `assemblyKeyText`). */
export function assemblyText(assembly: number | null, names: AssemblyNames): string {
  if (assembly === null) return "none";
  return names.get(assembly) ?? String(assembly);
}

/** An assembly by its name and idtrack's key of it, for the exact values on focus: "Sscrofa11.1 (key 111)". */
function assemblyKeyText(assembly: number | null, names: AssemblyNames): string {
  if (assembly === null) return "none";
  const name = names.get(assembly);
  return name && name !== String(assembly) ? `${name} (idtrack's key ${assembly})` : String(assembly);
}

/** The stable id of an Ensembl id with version (the identifier scheme: `<stable id>.<version>`). */
export function stableId(id: string | null): string | null {
  if (id === null) return null;
  return /^(ENS[A-Z]*[GTP]\d+)\.\d+$/.exec(id)?.[1] ?? id;
}

/** A history step without Ensembl's score between two versions of one stable id: idtrack does not count it among a
 *  path's steps without a score (`Candidate.unscored_steps` counts those between two different stable ids). */
export function unscoredUncounted(step: ModelStep): boolean {
  const a = step.api;
  return (
    (a.kind === "history" || a.kind === "self_loop") && a.weight === null && stableId(a.source) === stableId(a.target)
  );
}

/** The words of a step's absent score: whether idtrack counts it among the steps without a score. */
function noScoreText(step: ModelStep): string {
  return unscoredUncounted(step)
    ? "no score (one stable id: not counted as unscored)"
    : "no score (counted as unscored)";
}

/** What a split or a merge also took, in Ensembl's direction: the earlier id passed to other ids too (a split), other
 *  ids passed to the later id too (a merge). */
export function eventCounts(splits: number, merges: number): string {
  const ids = (n: number) => `${n} other id${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (splits) parts.push(`the earlier id also passed to ${ids(splits)}`);
  if (merges) parts.push(`${ids(merges)} also passed to the later id`);
  return parts.join("; ");
}

/** A history step's two ids in Ensembl's direction (the earlier id first), as the reading names them. */
function historyIds(step: ModelStep, model: PathModel): { earlier: string; later: string } {
  const pair = ensemblPair(step.api, step.direction);
  const name = (id: string | null) => nodeName(id === null ? undefined : model.nodeById.get(id), id);
  return { earlier: name(pair.earlier), later: name(pair.later) };
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

function nodeName(node: ModelNode | undefined, id: string | null): string {
  if (id === null) return "—";
  return node ? node.label : id;
}

function ranges(list: readonly (readonly [number, number])[] | readonly number[][]): string {
  return list.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

/** Where a gene lies, with the exact values the api sent: assembly, region, first and last base, strand, releases. */
function placeText(place: GenePlace, names: AssemblyNames): string {
  const strand = place.strand > 0 ? "+" : place.strand < 0 ? "−" : String(place.strand);
  const where = `${assemblyText(place.assembly, names)} ${place.region}:${place.start}–${place.end} (${strand} strand)`;
  const reference = place.reference ? "" : ", outside the reference sequence";
  return `${where}, releases ${ranges(place.releases)}${reference}`;
}

/** A relation of two genes' places, with its meaning from the api where it gives one. */
function placesText(code: string, vocabulary: Vocabulary): string {
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
    const ids = historyIds(step, model);
    facts.push([
      "Ensembl event",
      `${ids.earlier} → ${ids.later} at release ${a.old_release ?? "—"} → ${a.new_release ?? "—"} (the earlier id's last release, the later id's first)`,
    ]);
    if (step.direction)
      facts.push([
        "Walked",
        step.direction === "forward"
          ? "forward, in Ensembl's direction"
          : `backward, from the later id to the earlier (${ids.later} to ${ids.earlier})`,
      ]);
  }
  if (a.release !== null) facts.push(["Release", String(a.release)]);
  else if (a.kind === "final") facts.push(["Release", "another release than the target (final confidence 1)"]);
  if (a.weight !== null) facts.push(["Score", pythonFloat(a.weight)]);
  else if (a.kind === "history" || a.kind === "self_loop")
    facts.push([
      "Score",
      unscoredUncounted(step)
        ? "none given; between two versions of one stable id, so not counted among the path's steps without a score"
        : "none given; counted among the path's steps without a score (unscored steps)",
    ]);
  if (a.kind === "history" || a.splits || a.merges) {
    facts.push([
      "Split",
      `the earlier id also passed to ${a.splits} other id${a.splits === 1 ? "" : "s"} at release ${a.old_release ?? "—"}`,
    ]);
    facts.push([
      "Merge",
      `${a.merges} other id${a.merges === 1 ? "" : "s"} also passed to the later id at release ${a.new_release ?? "—"}`,
    ]);
  }
  if (a.databases.length) facts.push(["Databases", a.databases.map(databaseLabel).join(", ")]);
  if (step.handoff) {
    facts.push([
      "Assembly handoff",
      `${assemblyKeyText(step.handoff.old, names)} → ${assemblyKeyText(step.handoff.new, names)}`,
    ]);
  } else if (a.assembly !== null) {
    facts.push(["Assembly", assemblyKeyText(a.assembly, names)]);
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
      // In Ensembl's direction (the earlier id, at the event's old release, first), whichever way the walk went.
      const ids = historyIds(step, model);
      const what = spaced(a.reason);
      const score = a.weight === null ? noScoreText(step) : `score ${pythonFloat(a.weight)}`;
      const counts = a.splits || a.merges ? `; ${eventCounts(a.splits, a.merges)}` : "";
      const handoff = step.handoff
        ? `; assembly ${assemblyText(step.handoff.old, names)} → ${assemblyText(step.handoff.new, names)}`
        : "";
      const places = a.places === null ? "" : `; ${spaced(a.places)}`;
      const travel = step.direction === "backward" ? ` Walked backward, from ${ids.later} to ${ids.earlier}.` : "";
      return `${ids.earlier} → ${ids.later}: ${what} at releases ${a.old_release ?? "—"} → ${a.new_release ?? "—"} (${score}${counts}${handoff}${places}).${travel}`;
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
      return `${from} → ${to} (${spaced(a.kind)}, ${spaced(a.reason)}).`;
  }
}

/** One fact of a step in the reading's timeline (its text is the same words as the step's sentence). */
interface StepFact {
  kind: "score" | "counts" | "assembly" | "places" | "databases";
  text: string;
  /** The score of a history step (for its bar), as the api sent it. */
  weight?: number | null;
}

/** A step for the timeline: when (the releases), who (from and to), what (the reason or the act), and its facts, in
 *  the words of `stepSentence`. */
export interface StepParts {
  when: string;
  /** For a history step, the earlier id of Ensembl's event; else the node the walk leaves. */
  from: string | null;
  /** For a history step, the later id; else the node the walk enters. */
  to: string;
  what: string;
  facts: StepFact[];
  /** A history step the walk took from its later id to its earlier one. */
  backward: boolean;
}

export function stepParts(step: ModelStep, model: PathModel, names: AssemblyNames): StepParts {
  const a = step.api;
  const source = a.source === null ? undefined : model.nodeById.get(a.source);
  const target = model.nodeById.get(a.target);
  const from = a.source === null ? null : nodeName(source, a.source);
  const to = nodeName(target, a.target);
  const at = String(a.release ?? "—");
  const databases: StepFact[] = a.databases.length
    ? [{ kind: "databases", text: a.databases.map(databaseLabel).join(", ") }]
    : [];
  switch (a.kind) {
    case "identity":
      return {
        when: String(model.result.to_release),
        from: null,
        to,
        what: `exists at release ${model.result.to_release}: it is its own answer`,
        facts: [],
        backward: false,
      };
    case "entry":
      return { when: at, from, to, what: `read at release ${at}`, facts: databases, backward: false };
    case "history":
    case "self_loop": {
      const ids = historyIds(step, model);
      const facts: StepFact[] = [
        {
          kind: "score",
          text: a.weight === null ? noScoreText(step) : `score ${pythonFloat(a.weight)}`,
          weight: a.weight,
        },
      ];
      if (a.splits || a.merges) facts.push({ kind: "counts", text: eventCounts(a.splits, a.merges) });
      if (step.handoff)
        facts.push({
          kind: "assembly",
          text: `assembly ${assemblyText(step.handoff.old, names)} → ${assemblyText(step.handoff.new, names)}`,
        });
      if (a.places !== null) facts.push({ kind: "places", text: spaced(a.places) });
      return {
        when: `${a.old_release ?? "—"} → ${a.new_release ?? "—"}`,
        from: ids.earlier,
        to: ids.later,
        what: spaced(a.reason),
        facts,
        backward: step.direction === "backward",
      };
    }
    case "bridge_near":
      return {
        when: at,
        from,
        to,
        what: `leaves at release ${at} through an id it carries`,
        facts: databases,
        backward: false,
      };
    case "bridge_far":
      return {
        when: at,
        from,
        to,
        what: `enters another gene that carries it, at release ${at}`,
        facts: databases,
        backward: false,
      };
    case "final":
      return a.release === null
        ? {
            when: String(model.result.to_release),
            from,
            to,
            what: "the id through a transcript or translation it had at another release",
            facts: databases,
            backward: false,
          }
        : {
            when: at,
            from,
            to,
            what: `the id in the database at release ${a.release}`,
            facts: databases,
            backward: false,
          };
    default:
      return { when: at, from, to, what: `${spaced(a.kind)}, ${spaced(a.reason)}`, facts: [], backward: false };
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
    readingOrder(candidate, model).forEach((index, i) => {
      const step = model.steps[index];
      if (step) lines.push(`  ${i + 1}. ${stepSentence(step, model, names)}`);
    });
  }
  return lines.join("\n");
}

/** The steps of a candidate in the order the reading lists them: the api's order (the walk's), except that a run of
 *  re-mappings of one gene to itself is listed in the walk's direction (latest first where the walk goes back in
 *  time), since the api gives such a run in Ensembl's order whichever way the walk went. The walk's direction is that
 *  of the history steps around the run, else that of the conversion. */
export function readingOrder(candidate: ModelCandidate, model: PathModel): number[] {
  const order = [...candidate.steps];
  const steps = order.map((i) => model.steps[i]);
  const r = model.result;
  const overall = r.from_release !== null && r.to_release < r.from_release ? "backward" : "forward";
  let i = 0;
  while (i < order.length) {
    const step = steps[i];
    if (step?.api.kind !== "self_loop") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < order.length && steps[j]?.api.kind === "self_loop" && steps[j]?.api.target === step.api.target) j += 1;
    const around = [...steps.slice(0, i).reverse(), ...steps.slice(j)].find(
      (s) => s?.api.kind === "history" && s.direction !== null,
    );
    const backward = (around?.direction ?? overall) === "backward";
    const run = order.slice(i, j).sort((a, b) => {
      const ra = model.steps[a]?.api.old_release ?? 0;
      const rb = model.steps[b]?.api.old_release ?? 0;
      return backward ? rb - ra : ra - rb;
    });
    order.splice(i, j - i, ...run);
    i = j;
  }
  return order;
}

/** Identifiers in natural order: the digits of a version as a number (`.4` before `.10`). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}
