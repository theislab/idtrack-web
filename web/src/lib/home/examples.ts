// The examples the hero's form offers: conversions of the server's showcase of the graph in view, each labelled by
// what its answer shows, so that the first press shows history travel. Nothing is typed here per organism: the cases
// are the api's data (api/idtrack_web_api/showcase_data/), each with the kind its answer shows, and the rule below picks
// among them.
import type { ShowcaseResponse } from "../../api/types";
import { isCaseKind, type CaseKind } from "./caseKinds";
import { KIND_TEXT, type CaseQuery } from "./cases";
import { caseQueryOf } from "./links";

/** The kinds in the order they show history travel best: a path over every assembly, a renamed gene, a split, a merge,
 *  a step across an assembly, a replacement, a bridge, a new version, an answer in another database. */
const ORDER: readonly CaseKind[] = [
  "lineage",
  "renamed",
  "split",
  "merge",
  "handoff",
  "replaced",
  "bridge",
  "new_version",
  "final",
];

export interface Example {
  kind: CaseKind;
  /** What the answer shows, in the gallery's words ("A renamed gene"). */
  title: string;
  query: CaseQuery;
  /** The release the identifier is read at and the release answered, as the server's answer gives them. */
  from: number;
  to: number;
}

/** Up to `n` examples from the showcase's cases: of the kinds above, each kind once, in that order; only a case whose
 *  answer has a best answer and travels (read at another release than the one answered). */
export function examplesOf(showcase: ShowcaseResponse | null, organism: string, n = 3): Example[] {
  if (!showcase) return [];
  const found: Example[] = [];
  for (const kind of ORDER) {
    const c = showcase.cases.find(
      (x) =>
        x.kind === kind &&
        x.result !== null &&
        x.result.from_release !== null &&
        x.result.from_release !== x.result.to_release &&
        x.result.candidates.some((cd) => cd.best),
    );
    const from = c?.result?.from_release ?? null;
    const to = c?.result?.to_release ?? null;
    if (!c || from === null || to === null || !isCaseKind(c.kind)) continue;
    found.push({ kind: c.kind, title: KIND_TEXT[c.kind].title, query: caseQueryOf(organism, c.query), from, to });
    if (found.length === n) break;
  }
  return found;
}

/** The identifier field's hint from the examples of the graph in view ("e.g. SEPT9"): their identifiers, shortest
 *  first, as many as `room` characters hold, joined by "or" (an organism's own ids, never another's); a plain
 *  description where the server gives no example. */
export function placeholderOf(examples: readonly Example[], room = 24): string {
  const ids = [...new Set(examples.map((e) => e.query.identifier))].sort((a, b) => a.length - b.length);
  let text = "";
  for (const id of ids) {
    const next = text ? `${text} or ${id}` : `e.g. ${id}`;
    if (next.length > room) break;
    text = next;
  }
  return text || "a gene id, symbol or accession";
}
