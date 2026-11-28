// The journeys of the Convert page's first figure, as the server's showcase of the graph holds them
// (`GET /organisms/{organism}/showcase`: each a query as /convert takes it and its answer, computed once when the server
// started). Nothing about their answers is written here: the figure draws what the server returns, and its caption
// counts what it drew. The identifiers are chosen per graph in the api's data (api/idtrack_web_api/showcase_data/);
// consecutive journeys with the same parameters (the release read at, the release asked, the database asked) form one
// set, named in the figure by those parameters.
import type { ConversionResult, ShowcaseResponse } from "../../api/types";
import { stableId } from "../path/steps";
import { isEnsembl, journeyModel, type JourneyModel } from "./journeyModel";

interface JourneyParameters {
  from: number | null;
  to: number | null;
  db: string | null;
}

export interface Journey {
  /** The set it belongs to (its index in the figure's sets). */
  set: number;
  identifier: string;
  result: ConversionResult | null;
  /** The api's refusal of this conversion when the server started, in its own words (else null). */
  error: { code: string; message: string } | null;
  model: JourneyModel | null;
}

export interface JourneySet extends JourneyParameters {
  journeys: Journey[];
}

const sameParameters = (a: JourneyParameters, b: JourneyParameters) =>
  a.from === b.from && a.to === b.to && a.db === b.db;

/** The showcase's journeys in sets of consecutive equal parameters, each with its model when it has a path to draw. */
export function journeySets(showcase: ShowcaseResponse): JourneySet[] {
  const sets: JourneySet[] = [];
  for (const item of showcase.journeys) {
    const q = item.query;
    const parameters = { from: q.from_release ?? null, to: q.to_release ?? null, db: q.final_database ?? null };
    let set = sets[sets.length - 1];
    if (!set || !sameParameters(set, parameters)) {
      set = { ...parameters, journeys: [] };
      sets.push(set);
    }
    set.journeys.push({
      set: sets.length - 1,
      identifier: q.identifier,
      result: item.result ?? null,
      error: item.error ? { code: item.error.code, message: item.error.message } : null,
      model: item.result ? journeyModel(item.result) : null,
    });
  }
  return sets;
}

/** Every journey of the figure, in the order of its rows. */
export function journeyList(sets: readonly JourneySet[]): Journey[] {
  return sets.flatMap((s) => s.journeys);
}

/** The external databases every journey of a set is read in (in the order the first journey's answer gives them):
 *  named once, in the set's words; a database only some of its journeys are read in is named in each journey's note
 *  and in the list. */
export function readDatabases(set: JourneySet): string[] {
  const results = set.journeys.flatMap((j) => (j.result ? [j.result] : []));
  if (!results.length) return [];
  const [first, ...rest] = results;
  return (first?.from_databases ?? []).filter((d) => !isEnsembl(d) && rest.every((r) => r.from_databases.includes(d)));
}

/** The bridges a journey's best answer passes through: each id two genes carry, with its databases. */
export function bridgesOf(j: Journey): { id: string; databases: string[] }[] {
  return (j.model?.marks ?? [])
    .filter((m) => m.step.kind === "bridge_near")
    .map((m) => ({ id: m.step.target, databases: m.step.databases.filter((d) => !isEnsembl(d)) }));
}

/** Whether a journey's answer names the gene otherwise than the identifier it started from: a symbol read in the
 *  database it is answered in, whose best answer is another string (a renamed gene). */
export function isRenamed(j: Journey): boolean {
  const r = j.result;
  if (r === null) return false;
  const asked = r.final_database;
  if (asked === null || !r.from_databases.includes(asked)) return false;
  const targets = r.candidates.filter((c) => c.best).map((c) => c.target);
  return targets.length > 0 && !targets.includes(r.query_id);
}

/** Runs of rows of one set, next to each other, whose best answers are the same targets (two genes merged into one,
 *  or two ids of one gene): [first row, last row] of each run of two or more. */
export function sameAnswerGroups(list: readonly Journey[]): [number, number][] {
  const key = (j: Journey) =>
    j.model ? `${j.set}|${[...new Set(j.model.best.map((c) => c.target))].sort().join(",")}` : null;
  const groups: [number, number][] = [];
  let start = 0;
  for (let k = 1; k <= list.length; k++) {
    const a = list[start];
    const b = list[k];
    const same = a && b && key(a) !== null && key(a) === key(b);
    if (!same) {
      if (k - 1 > start) groups.push([start, k - 1]);
      start = k;
    }
  }
  return groups;
}

/** Whether a journey's answer is another string than the identifier read (shown in bold). */
export function answerChanged(j: Journey): boolean {
  if (!j.model || !j.result) return false;
  const targets = j.result.candidates.filter((c) => c.best).map((c) => c.target);
  return !targets.includes(j.result.query_id);
}

/** The marks a legend of the journeys can name: a change of stable id (the line's tone), the stubs of a split or a
 *  merge, a step across an assembly change that is also one (the diamond with the event's dot). */
export type LegendMark =
  | "idchange"
  | "version"
  | "event"
  | "fork"
  | "loop"
  | "handoff"
  | "handoffEvent"
  | "cross"
  | "bridge"
  | "back"
  | "same";

/** The kinds of mark the journeys hold, in the legend's order: the legend names these and only these. */
export function legendMarks(list: readonly Journey[]): LegendMark[] {
  const found = new Set<LegendMark>();
  for (const j of list) {
    const m = j.model;
    if (!m) continue;
    const genes = new Set((m.result.path?.nodes ?? []).filter((n) => n.kind === "ensembl_gene").map((n) => n.id));
    const stable = m.marks.filter((mk) => genes.has(mk.step.target)).map((mk) => stableId(mk.step.target));
    if (new Set(stable).size > 1) found.add("idchange");
    for (const mk of m.marks) {
      if (mk.kind === "version" || mk.kind === "event" || mk.kind === "loop" || mk.kind === "handoff")
        found.add(mk.kind);
      if (mk.kind === "handoff" && ["split", "merge", "split_and_merge"].includes(mk.step.reason))
        found.add("handoffEvent");
      if (mk.step.kind === "history" && (mk.step.splits > 0 || mk.step.merges > 0)) found.add("fork");
      if (mk.kind === "bridge") found.add("bridge");
    }
    const read = m.result.from_databases.some((d) => !isEnsembl(d));
    const asked = m.result.final_database;
    const answered = asked !== null && !isEnsembl(asked) && m.marks.some((mk) => mk.kind === "final");
    if (read || answered) found.add("cross");
    if (m.backward) found.add("back");
  }
  if (sameAnswerGroups(list).length) found.add("same");
  const order: LegendMark[] = [
    "idchange",
    "version",
    "event",
    "fork",
    "loop",
    "handoff",
    "handoffEvent",
    "cross",
    "bridge",
    "back",
    "same",
  ];
  return order.filter((k) => found.has(k));
}
