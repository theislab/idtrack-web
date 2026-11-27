// The batch's results read for its figure: counts of statuses in the vocabulary's order, the releases the identifiers
// were read at, the rows of the table sorted and filtered. Everything is counted from the api's answer as sent; no
// value is changed, rounded or invented.
import type { ConversionResult, PathStep } from "../api/types";
import { crossesAssemblies } from "../components/figure/glyph";
import { looksLikeSpreadsheetDate } from "./batchList";
import { cautionCount, evidenceOf, type EvidenceMark } from "./evidence";
import { NO_VOCABULARY, type Vocabulary } from "./vocabulary";

/** The statuses of a batch in the vocabulary's order (the api's), then any status the vocabulary does not name. */
export function statusCounts(results: readonly ConversionResult[], order: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const known = order.filter((s) => counts.has(s)).map((s): [string, number] => [s, counts.get(s) ?? 0]);
  const other = [...counts.entries()].filter(([s]) => !order.includes(s));
  return [...known, ...other];
}

/** The prefixes of a match as idtrack writes it (`copy:exact` -> `["copy"]`). */
export function matchPrefixes(match: string | null): string[] {
  if (!match) return [];
  return match.split(":").slice(0, -1);
}

/** The result was answered as a copy of another item of the batch (its match carries idtrack's prefix `copy`). */
export function isCopy(result: ConversionResult): boolean {
  return matchPrefixes(result.match).includes("copy");
}

/** How many results are each release's (`from_release`), and how many were read at none. */
export function readAtCounts(results: readonly ConversionResult[]): { byRelease: Map<number, number>; none: number } {
  const byRelease = new Map<number, number>();
  let none = 0;
  for (const r of results) {
    if (r.from_release === null) none += 1;
    else byRelease.set(r.from_release, (byRelease.get(r.from_release) ?? 0) + 1);
  }
  return { byRelease, none };
}

/** The result was read at another release than its target: its answer was followed through Ensembl's history. */
export function travelled(result: ConversionResult): boolean {
  return result.from_release !== null && result.from_release !== result.to_release;
}

/** How an identifier was read, in one class for filtering (the first that applies, in this order): answered as
 *  another item's copy, through a synonym, with letter case or separators ignored, a version newer than the graph read
 *  as the latest, as written; or not read at all. */
export type ReadKind = "copy" | "synonym" | "case" | "separator" | "newer_version" | "written" | "not_read";

export const READ_WORDS: Record<ReadKind, string> = {
  copy: "as another item's copy",
  synonym: "through a synonym",
  case: "letter case ignored",
  separator: "separators ignored",
  newer_version: "a newer version",
  written: "as written",
  not_read: "not read",
};

export function readKind(result: ConversionResult): ReadKind {
  if (!result.match) return "not_read";
  const parts = result.match.split(":");
  const step = parts.pop() ?? "";
  if (parts.includes("copy")) return "copy";
  if (parts.includes("synonym")) return "synonym";
  if (step === "case") return "case";
  if (step === "separator") return "separator";
  if (step === "version_newer_than_graph") return "newer_version";
  return "written";
}

/** How the release an identifier was read at came about: given, set aside for another (the graph does not hold the
 *  identifier at the release given), or inferred by the engine; none when it was not read. */
export type ReleaseHow = "given" | "fallback" | "inferred" | "none";
export function releaseHow(result: ConversionResult): ReleaseHow {
  if (result.from_release === null) return "none";
  if (result.from_release_fallback) return "fallback";
  return result.from_release_inferred ? "inferred" : "given";
}

/** A row of the results table: the result, its place in the input, and what the table shows and filters by. */
export interface BatchRow {
  /** The place in the input, from 0. */
  index: number;
  result: ConversionResult;
  /** The targets of the best answer (none for `no_target`: its candidates are genes, not answers). */
  answers: string[];
  /** The Ensembl genes of the best answer at the target release, each once (for `no_target`, the genes reached). */
  genes: string[];
  read: ReadKind;
  /** The place of the deciding criterion in idtrack's order (from 0), or null without a runner-up. */
  decided: number | null;
  evidence: EvidenceMark[];
  /** Some mark of the evidence is a caution. */
  care: boolean;
  /** The other rows (by index) whose best answer shares a target with this row's, of another identifier. */
  shared: number[];
  /** The genes of the candidates below the best (each once, in rank order): the identifier leads to them too. */
  otherGenes: string[];
  /** What the paths of the best answer crossed, where the result has its paths (null: asked without them). */
  crossed: Crossed | null;
}

/** The kinds of step a path can cross, in the order of a reader's walk through Ensembl's history (DESIGN.md, the
 *  figure grammar: each kind is one glyph and hue). */
export const CROSSINGS = ["version", "replaced", "split", "merge", "handoff", "remap", "bridge", "external"] as const;
export type Crossing = (typeof CROSSINGS)[number];

/** One step of Ensembl's history on a best path, in Ensembl's direction (its event's old and new release). */
export interface CrossedEvent {
  kind: "version" | "replaced" | "split" | "merge" | "handoff" | "remap";
  old: number;
  new: number;
}

export interface Crossed {
  /** The kinds the best paths cross (each once). */
  kinds: Set<Crossing>;
  /** Every history step of the best paths, each once, in the order of the walk; a step that crosses assemblies is
   *  counted also as its own kind (a new version, a replacement, a split or a merge). */
  events: CrossedEvent[];
}

/** An Ensembl stable id without its version (`ENSG00000141510.5` -> `ENSG00000141510`). */
const stableId = (id: string | null) => (id ? (/^(.+)\.\d+$/.exec(id)?.[1] ?? id) : id);

/** The kind of a history step by its reason (idtrack's `step_reasons`): a new version of the same stable id, another
 *  id (a replacement), a split, a merge (a split and merge at once counts as both), a re-mapping of a gene to itself. */
function historyKinds(step: PathStep): CrossedEvent["kind"][] {
  if (step.kind === "self_loop") return ["remap"];
  switch (step.reason) {
    case "new_version":
      return ["version"];
    case "replaced":
      return ["replaced"];
    case "split":
      return ["split"];
    case "merge":
      return ["merge"];
    case "split_and_merge":
      return ["split", "merge"];
    default:
      return stableId(step.source) === stableId(step.target) ? ["version"] : ["replaced"];
  }
}

/** What the paths of a result's best answer crossed: the steps of every best candidate (its path, then its final
 *  path), each once. Read from the explained path the api sent; null without it. */
export function crossedOf(result: ConversionResult): Crossed | null {
  const steps = result.path?.steps;
  if (!result.path || !steps) return null;
  const kinds = new Set<Crossing>();
  const events: CrossedEvent[] = [];
  const seen = new Set<number>();
  const nodes = new Map(result.path.nodes.map((n) => [n.id, n]));
  for (const candidate of result.candidates.filter((c) => c.best)) {
    for (const index of [...candidate.path, ...candidate.final_path]) {
      const step = steps[index];
      if (!step || seen.has(index)) continue;
      seen.add(index);
      if (step.kind === "history" || step.kind === "self_loop") {
        const old = step.old_release ?? step.release;
        const next = step.new_release ?? step.release;
        for (const kind of historyKinds(step)) {
          kinds.add(kind);
          if (old !== null && next !== null) events.push({ kind, old, new: next });
        }
        if (crossesAssemblies(step)) {
          kinds.add("handoff");
          if (old !== null && next !== null) events.push({ kind: "handoff", old, new: next });
        }
      } else if (step.kind === "bridge_near" || step.kind === "bridge_far") kinds.add("bridge");
      else if (step.kind === "entry") {
        const from = step.source === null ? undefined : nodes.get(step.source);
        if (from && (from.kind === "external" || from.kind === "synonym")) kinds.add("external");
      }
    }
  }
  return { kinds, events };
}

/** The rows of a batch, built in one pass over its results (and one over their answers for the shared targets). */
export function batchRows(results: readonly ConversionResult[], vocabulary: Vocabulary = NO_VOCABULARY): BatchRow[] {
  return linkShared(results.map((result, index) => batchRow(result, index, vocabulary)));
}

/** The row of one result (its place among the rows that share its answer is set by `linkShared`). */
export function batchRow(result: ConversionResult, index: number, vocabulary: Vocabulary = NO_VOCABULARY): BatchRow {
  const decidedAt = vocabulary.criteria.findIndex((c) => c.code === result.decided_by);
  const best = result.candidates.filter((c) => c.best);
  const evidence = evidenceOf(result, vocabulary);
  return {
    index,
    result,
    answers: result.no_target ? [] : best.map((c) => c.target),
    genes: [...new Set(best.map((c) => c.gene))],
    read: readKind(result),
    decided: result.decided_by && decidedAt >= 0 ? decidedAt : null,
    evidence,
    care: cautionCount(evidence) > 0,
    shared: [],
    otherGenes: result.no_target
      ? []
      : [...new Set(result.candidates.filter((c) => !c.best).map((c) => c.gene))].filter(
          (g) => !best.some((c) => c.gene === g),
        ),
    crossed: crossedOf(result),
  };
}

/** Each row's `shared`: the other rows, of another identifier, whose best answer shares a target with its own. */
export function linkShared(rows: BatchRow[]): BatchRow[] {
  const byAnswer = new Map<string, number[]>();
  for (const row of rows)
    for (const answer of new Set(row.answers)) {
      const list = byAnswer.get(answer);
      if (list) list.push(row.index);
      else byAnswer.set(answer, [row.index]);
    }
  for (const indices of byAnswer.values()) {
    if (indices.length < 2) continue;
    for (const i of indices) {
      const row = rows[i];
      if (!row) continue;
      const others = indices.filter((j) => j !== i && rows[j]?.result.query_id !== row.result.query_id);
      if (others.length) row.shared = [...new Set([...row.shared, ...others])].sort((x, y) => x - y);
    }
  }
  return rows;
}

/** The answers given to several identifiers (targets shared by rows of different identifiers), and their rows. */
export function sharedAnswers(rows: readonly BatchRow[]): { answers: number; rows: number } {
  const answers = new Set<string>();
  let count = 0;
  for (const row of rows) {
    if (!row.shared.length) continue;
    count += 1;
    for (const answer of row.answers) {
      if (row.shared.some((j) => rows[j]?.answers.includes(answer))) answers.add(answer);
    }
  }
  return { answers: answers.size, rows: count };
}

export type SortKey = "order" | "identifier" | "status" | "answer" | "release" | "decided" | "evidence" | "candidates";
export interface Sort {
  key: SortKey;
  descending: boolean;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "variant" });

/** Rows in the order asked; ties keep the input order, and rows without the value come last in either direction. */
export function sortRows(rows: readonly BatchRow[], sort: Sort, statusOrder: readonly string[]): BatchRow[] {
  const rank = (status: string) => {
    const i = statusOrder.indexOf(status);
    return i < 0 ? statusOrder.length : i;
  };
  const value = (row: BatchRow): string | number | null => {
    switch (sort.key) {
      case "order":
        return row.index;
      case "identifier":
        return row.result.query_id;
      case "status":
        return rank(row.result.status);
      case "answer":
        return row.genes[0] ?? row.answers[0] ?? null;
      case "release":
        return row.result.from_release;
      case "decided":
        return row.decided;
      case "evidence":
        return row.evidence.filter((m) => m.tone === "caution").length * 100 + row.evidence.length;
      case "candidates":
        return row.result.candidates.length;
    }
  };
  const sign = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) {
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      return a.index - b.index;
    }
    const order = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return order === 0 ? a.index - b.index : sign * order;
  });
}

/** What the table shows: rows of the statuses, readings and deciding criteria chosen (all of a kind when none of it is
 *  chosen), only the rows that need care or share an answer when asked, whose identifier, reading or answer holds the
 *  text. */
export interface RowFilter {
  statuses: ReadonlySet<string>;
  reads?: ReadonlySet<ReadKind>;
  /** Codes of `decided_by`; `""` stands for a result without a runner-up. */
  decided?: ReadonlySet<string>;
  /** Rows whose best paths cross any of these kinds of step. */
  crossings?: ReadonlySet<Crossing>;
  care?: boolean;
  shared?: boolean;
  /** Rows whose identifier leads to other genes below the best. */
  several?: boolean;
  /** Rows read at another release than the one given (or, none given, at a release inferred). */
  elsewhere?: boolean;
  /** Not-found rows in the form of a spreadsheet's date. */
  dates?: boolean;
  text?: string;
}

/** A row read elsewhere than the release given, or (none given) at a release idtrack inferred. */
function readElsewhere(row: BatchRow): boolean {
  const how = releaseHow(row.result);
  return how === "fallback" || how === "inferred";
}

/** Several genes reached: the best answer is one gene (not a tie) and the identifier leads to other genes below it. */
export function leadsToOthers(row: BatchRow): boolean {
  return row.result.status === "converted" && row.otherGenes.length > 0;
}

/** A not-found identifier in the form of a date a spreadsheet makes of a cell. */
export function spreadsheetDate(row: BatchRow): boolean {
  return row.result.status === "not_found" && looksLikeSpreadsheetDate(row.result.query_id);
}

export function filterRows(rows: readonly BatchRow[], filter: RowFilter): BatchRow[] {
  const needle = (filter.text ?? "").trim().toLowerCase();
  const { statuses, reads, decided, crossings } = filter;
  return rows.filter((row) => {
    const r = row.result;
    if (statuses.size && !statuses.has(r.status)) return false;
    if (reads?.size && !reads.has(row.read)) return false;
    if (decided?.size && !decided.has(r.decided_by ?? "")) return false;
    if (crossings?.size && ![...crossings].some((k) => row.crossed?.kinds.has(k))) return false;
    if (filter.care && !row.care) return false;
    if (filter.shared && !row.shared.length) return false;
    if (filter.several && !leadsToOthers(row)) return false;
    if (filter.elsewhere && !readElsewhere(row)) return false;
    if (filter.dates && !spreadsheetDate(row)) return false;
    if (!needle) return true;
    return [r.query_id, r.graph_id ?? "", ...row.answers, ...r.candidates.map((c) => c.gene)].some((v) =>
      v.toLowerCase().includes(needle),
    );
  });
}

/** What a batch's rows add up to, for its readouts: every count is of rows (identifiers), from the answer as sent. */
export interface BatchSummary {
  identifiers: number;
  distinct: number;
  care: number;
  several: number;
  bridged: number;
  shared: { answers: number; rows: number };
  /** Read elsewhere than the release given. */
  fallback: number;
  /** Read at a release idtrack inferred. */
  inferred: number;
  dates: number;
  copies: number;
  /** Whether the answer holds the paths (every row with a candidate has its path). */
  paths: boolean;
  /** Rows whose best paths cross each kind of step (only with the paths). */
  crossings: Map<Crossing, number>;
  /** Rows whose best paths hold a split or a merge (each row once). */
  splitOrMerge: number;
  /** The history steps of the best paths by the release of their event's new side, then by kind: each row counted once
   *  per release and kind. */
  events: Map<number, Map<CrossedEvent["kind"], number>>;
  /** The identifiers whose best paths took a step of Ensembl's history at each release (each row once). */
  eventRows: Map<number, number>;
}

export function summaryOf(rows: readonly BatchRow[]): BatchSummary {
  const crossings = new Map<Crossing, number>();
  const events = new Map<number, Map<CrossedEvent["kind"], number>>();
  const eventRows = new Map<number, number>();
  let paths = rows.length > 0;
  let splitOrMerge = 0;
  const summary = {
    identifiers: rows.length,
    distinct: new Set(rows.map((r) => r.result.query_id)).size,
    care: 0,
    several: 0,
    bridged: 0,
    shared: sharedAnswers(rows),
    fallback: 0,
    inferred: 0,
    dates: 0,
    copies: 0,
  };
  for (const row of rows) {
    const r = row.result;
    if (row.care) summary.care += 1;
    if (leadsToOthers(row)) summary.several += 1;
    if (row.evidence.some((m) => m.kind === "bridge")) summary.bridged += 1;
    const how = releaseHow(r);
    if (how === "fallback") summary.fallback += 1;
    if (how === "inferred") summary.inferred += 1;
    if (spreadsheetDate(row)) summary.dates += 1;
    if (isCopy(r)) summary.copies += 1;
    if (r.candidates.length && !row.crossed) paths = false;
    if (!row.crossed) continue;
    for (const kind of row.crossed.kinds) crossings.set(kind, (crossings.get(kind) ?? 0) + 1);
    if (row.crossed.kinds.has("split") || row.crossed.kinds.has("merge")) splitOrMerge += 1;
    const once = new Set<string>();
    for (const release of new Set(row.crossed.events.map((e) => e.new)))
      eventRows.set(release, (eventRows.get(release) ?? 0) + 1);
    for (const e of row.crossed.events) {
      const key = `${String(e.new)}|${e.kind}`;
      if (once.has(key)) continue;
      once.add(key);
      const at = events.get(e.new) ?? new Map<CrossedEvent["kind"], number>();
      at.set(e.kind, (at.get(e.kind) ?? 0) + 1);
      events.set(e.new, at);
    }
  }
  return { ...summary, paths, crossings, splitOrMerge, events, eventRows };
}

/** The history steps of a row in words, in Ensembl's direction (`split 69->70; new version 75->76`), for a table. */
export function eventsWords(crossed: Crossed | null): string {
  if (!crossed) return "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of crossed.events) {
    const text = `${EVENT_WORDS[e.kind]} ${String(e.old)}->${String(e.new)}`;
    if (!seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out.join("; ");
}

/** A kind of history step in a few words. */
export const EVENT_WORDS: Record<CrossedEvent["kind"], string> = {
  version: "new version",
  replaced: "replacement",
  split: "split",
  merge: "merge",
  handoff: "assembly change",
  remap: "re-mapping",
};

/** A count of a kind of history step in words (`2 new versions`, `1 split`). */
export function eventCount(kind: CrossedEvent["kind"], n: number): string {
  const word = EVENT_WORDS[kind];
  return `${String(n)} ${n === 1 ? word : `${word}s`}`;
}

/** Counts of a property of the rows, in the order given, then any value not in it; values without rows left out. */
export function countBy<K>(
  rows: readonly BatchRow[],
  of: (row: BatchRow) => K,
  order: readonly K[] = [],
): [K, number][] {
  const counts = new Map<K, number>();
  for (const row of rows) {
    const k = of(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [
    ...order.filter((k) => counts.has(k)).map((k): [K, number] => [k, counts.get(k) ?? 0]),
    ...[...counts.entries()].filter(([k]) => !order.includes(k)),
  ];
}

/** The statuses drawn with a fill of their own (tables.css): a state's ink, or a hatch where two share a tone. */
const FILLED = new Set(["converted", "tie", "no_target", "not_found", "unknown_version", "no_conversion", "error"]);

/** The mark of a status in the figure; a status the page does not know is drawn with the mark of any other. */
export function statusFill(status: string): string {
  return `sfill sfill--${FILLED.has(status) ? status : "other"}`;
}

const PREFIX_WORDS: Record<string, string> = {
  copy: "another item's copy",
  synonym: "a synonym",
  unicode: "Unicode normalised",
  punctuation: "punctuation removed",
  par_y: "Y copy read as its gene",
  lrg: "LRG record read as its gene",
};
const STEP_WORDS: Record<string, string> = {
  exact: "as written",
  case: "letter case ignored",
  separator: "separators ignored",
  version: "with its version",
  version_newer_than_graph: "version newer than the graph",
  version_not_judged: "version not judged",
};

/** A part of a match (a prefix or the step, idtrack's codes) in a few words; the code, spaced, where none is set. */
export function matchLabel(code: string, role: "prefix" | "step"): string {
  return (role === "prefix" ? PREFIX_WORDS[code] : STEP_WORDS[code]) ?? code.replace(/_/g, " ");
}
