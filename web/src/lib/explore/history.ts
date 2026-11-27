// Ensembl's id history of a graph per release, as the server counts it (`GET /organisms/{organism}/history`): for every
// release the gene ids active and those created there; for every pair of releases some history edge spans, the edges
// by kind. The figure draws each release's column from the transitions that end there (their later release), so that
// what changed into a release stands at that release; a transition between releases apart is kept whole in the note.
import { scaleLinear } from "d3-scale";
import type { ConversionResult, HistoryResponse, PathStep, ShowcaseResponse } from "../../api/types";
import { bestSteps, isCaseKind, isHandoff } from "../home/caseKinds";
import { KIND_TEXT } from "../home/cases";
import { groupedInteger } from "../numbers";

type HistoryTransition = HistoryResponse["transitions"][number];
export type ShowcaseCase = ShowcaseResponse["cases"][number];

export interface HistoryColumn {
  release: number;
  genes: number;
  versions: number;
  /** Ids that begin at this release (at the graph's first release: every id of it, which the graph starts with). */
  created: number;
  /** The transitions whose later release is this one. */
  into: HistoryTransition[];
  versionChanges: number;
  idChanges: number;
  retired: number;
  /** Edges that keep an id and its version across Ensembl's mapping, with its score (a re-mapping to itself). */
  kept: number;
  scored: number;
  /** Gene versions whose edges reach two or more gene versions (the fan out of Ensembl's mapping: where a gene splits);
   *  null where the server does not count it. */
  fanOut: number | null;
  /** Gene versions reached from two or more gene versions (the fan in: where genes merge); null where not counted. */
  fanIn: number | null;
  /** The first release of the graph: its ids are where the graph begins, not ids Ensembl created there. */
  first: boolean;
}

export function historyColumns(history: HistoryResponse): HistoryColumn[] {
  const releases = [...history.releases].sort((a, b) => a.release - b.release);
  const first = releases[0]?.release;
  const into = new Map<number, HistoryTransition[]>();
  for (const t of history.transitions) into.set(t.to_release, [...(into.get(t.to_release) ?? []), t]);
  type Count = "version_changes" | "id_changes" | "retired" | "same_version" | "scored";
  const sum = (ts: readonly HistoryTransition[], field: Count) => ts.reduce((s, t) => s + t[field], 0);
  // A fan count the server does not send stays unknown (null), never a zero.
  const fan = (ts: readonly HistoryTransition[], field: "one_to_many" | "many_to_one") =>
    ts.some((t) => t[field] === null || t[field] === undefined) ? null : ts.reduce((s, t) => s + (t[field] ?? 0), 0);
  return releases.map((r) => {
    const ts = into.get(r.release) ?? [];
    return {
      release: r.release,
      genes: r.genes_active,
      versions: r.versions_active,
      created: r.created,
      into: ts,
      versionChanges: sum(ts, "version_changes"),
      idChanges: sum(ts, "id_changes"),
      retired: sum(ts, "retired"),
      kept: sum(ts, "same_version"),
      scored: sum(ts, "scored"),
      fanOut: fan(ts, "one_to_many"),
      fanIn: fan(ts, "many_to_one"),
      first: r.release === first,
    };
  });
}

/** Whether the server counts the fan of Ensembl's mapping (splits and merges) for every release of a history. */
export function fansCounted(columns: readonly HistoryColumn[]): boolean {
  return columns.length > 0 && columns.every((c) => c.fanOut !== null && c.fanIn !== null);
}

/** What changed into a release: the version changes, the changes of id and the retirements (an edge that keeps an id
 *  and its version, a re-mapping to itself, is counted apart: `kept`). */
export function changed(c: HistoryColumn): number {
  return c.versionChanges + c.idChanges + c.retired;
}

/** The heights of the history figure, for a reserve held while the answer comes (compact: without an axis of its own,
 *  under one shared axis; an organism's page: without its numbered marks, which follow the showcase). */
export function historyHeight(compact: boolean): number {
  return compact ? 112 : 458;
}

/** A case's kind in the words of the gallery's titles ("A split"), never its code; a kind the gallery does not name is
 *  said in plain words of its code. */
export function kindWords(kind: string): string {
  return isCaseKind(kind) ? KIND_TEXT[kind].title : kind.replace(/_/g, " ");
}

/** The largest value of a part's scale: the next round number at or above the largest count drawn. */
export function niceMax(value: number): number {
  return (
    scaleLinear()
      .domain([0, Math.max(1, value)])
      .nice(2)
      .domain()[1] ?? Math.max(1, value)
  );
}

/** What changed into a release as a share of the gene ids active at the release before it (the ids the edges leave),
 *  and the ids created as a share of those active at the release: the measure in which organisms of different sizes
 *  can stand on one axis. Null where the denominator is zero or the release is the graph's first. */
export function shares(columns: readonly HistoryColumn[]): {
  changed: number | null;
  created: number | null;
  fanOut: number | null;
  fanIn: number | null;
}[] {
  return columns.map((c, i) => {
    const before = columns[i - 1];
    const of = (v: number | null) => (before && before.genes > 0 && v !== null ? v / before.genes : null);
    return {
      changed: of(changed(c)),
      created: !c.first && c.genes > 0 ? c.created / c.genes : null,
      fanOut: of(c.fanOut),
      fanIn: of(c.fanIn),
    };
  });
}

/** The columns of a graph's history, tallest first (what changed into them), with whether the serving assembly changes
 *  at the release: what the caption names instead of saying that every tall column is a new assembly. */
export function tallest(
  columns: readonly HistoryColumn[],
  servingAssembly: Readonly<Record<string, number>>,
  count = 4,
): { release: number; changed: number; newAssembly: boolean }[] {
  return [...columns]
    .filter((c) => !c.first && changed(c) > 0)
    .sort((a, b) => changed(b) - changed(a) || a.release - b.release)
    .slice(0, count)
    .map((c) => {
      const previous = columns[columns.indexOf(c) - 1];
      const here = servingAssembly[String(c.release)];
      const before = previous ? servingAssembly[String(previous.release)] : undefined;
      return {
        release: c.release,
        changed: changed(c),
        newAssembly: here !== undefined && before !== undefined && here !== before,
      };
    });
}

/** The later release of a history step (where what changed stands on the figure), or of a bridge's far end; null for
 *  a step at no pair of releases. */
function laterRelease(step: PathStep): number | null {
  if (step.old_release !== null && step.new_release !== null) return Math.max(step.old_release, step.new_release);
  return step.release;
}

/** The step of a showcase case that makes it the kind it is (a replacement, a split, a merge, an assembly change, a
 *  bridge, a new version; for a lineage its first change of assembly); null for a kind no single step makes. */
function caseStep(kind: string, result: ConversionResult): PathStep | null {
  const steps = bestSteps(result);
  const find = (test: (s: PathStep) => boolean) => steps.find(test) ?? null;
  switch (kind) {
    case "replaced":
    case "new_version":
      return find((s) => s.reason === kind);
    case "split":
      return find((s) => s.reason === "split" || s.reason === "split_and_merge");
    case "merge":
      return find((s) => s.reason === "merge" || s.reason === "split_and_merge");
    case "handoff":
    case "lineage":
      return find(isHandoff);
    case "bridge":
      return find((s) => s.reason === "bridge_far");
    default:
      return null;
  }
}

export interface CaseMark {
  /** Its number in the list of the server's cases under the figure (1 for the first). */
  number: number;
  case: ShowcaseCase;
  /** The release its defining step stands at, or null (a kind no single step makes). */
  release: number | null;
  step: PathStep | null;
}

/** The server's cases of a graph, numbered, each at the release of the step that makes it its kind. */
export function caseMarks(cases: readonly ShowcaseCase[]): CaseMark[] {
  return cases.map((c, i) => {
    const step = c.result ? caseStep(c.kind, c.result) : null;
    return { number: i + 1, case: c, step, release: step ? laterRelease(step) : null };
  });
}

/** The cases whose best path holds a history step into the release (an edge whose later release it is). */
export function casesThrough(marks: readonly CaseMark[], release: number): CaseMark[] {
  return marks.filter(
    (m) =>
      m.case.result !== null &&
      bestSteps(m.case.result).some(
        (s) => (s.kind === "history" || s.kind === "self_loop") && laterRelease(s) === release,
      ),
  );
}

const plural = (n: number, one: string, many: string) => `${groupedInteger(n)} ${n === 1 ? one : many}`;

/** A transition's counts in words, each kind once, the scored edges as a count of edges. */
export function transitionWords(t: HistoryTransition): string {
  const moved = t.version_changes + t.id_changes;
  const fan =
    t.one_to_many === null || t.one_to_many === undefined || t.many_to_one === null || t.many_to_one === undefined
      ? ""
      : `; ${plural(t.one_to_many, "version is", "versions are")} mapped to two or more (a split), ${plural(t.many_to_one, "version receives", "versions receive")} two or more (a merge)`;
  return `${plural(t.version_changes, "version", "versions")} to another version, ${plural(t.id_changes, "version", "versions")} to another id (${groupedInteger(moved)} changed), ${plural(t.retired, "id", "ids")} retired; ${plural(t.same_version, "id keeps", "ids keep")} its version (re-mapped to itself)${fan}; ${plural(t.scored, "of these edges carries", "of these edges carry")} Ensembl's score`;
}

/** What changed into a release, in words: every history edge that ends there, by what it does to the id. */
export function columnWords(c: HistoryColumn): string {
  const fan =
    c.fanOut === null || c.fanIn === null
      ? ""
      : `; ${plural(c.fanOut, "version is", "versions are")} mapped to two or more, ${plural(c.fanIn, "receives", "receive")} two or more`;
  return `${plural(changed(c), "history edge changes or retires", "history edges change or retire")} an id (${groupedInteger(c.versionChanges + c.idChanges)} changed, ${groupedInteger(c.retired)} retired); ${plural(c.kept, "keeps", "keep")} it and its version (re-mapped to itself)${fan}`;
}
