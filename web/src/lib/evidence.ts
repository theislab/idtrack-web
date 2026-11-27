// The evidence of an answer that a reader should weigh before trusting it, as the api states it on every result
// (`cautions`: one item per class of evidence that holds, computed by the server from the result's own fields; the
// meaning of each class in `/vocabulary`, `cautions`). The page computes none of its own: it reads each item into a
// mark it can draw (`components/Evidence.tsx`, and the status line of panel a for the classes that say another gene may
// be the one meant), with the limitation of idtrack's documentation the item names (its lead sentence and its section
// at the documentation commit the page's text is generated from, `src/generated/limitations.json`).
//
// A "caution" changes how far an answer can be trusted; a "note" says something exact about it that is not a fault.
import type { ConversionResult } from "../api/types";
import limitations from "../generated/limitations.json";
import { NO_VOCABULARY, type Vocabulary } from "./vocabulary";

type EvidenceTone = "caution" | "note";

export interface Limitation {
  title: string;
  lead: string;
  /** The section of idtrack's documentation at the commit the page's text is generated from. */
  href: string;
}

/** A conversion a mark offers as the way on: the result's own, with the parts named here changed. */
export interface EvidenceAsk {
  /** What the link says ("Ask Rhbg at release 115"). */
  words: string;
  identifier?: string;
  fromRelease?: number | null;
  toRelease?: number;
  /** The database to convert to (`null`: Ensembl genes); left out, the one asked. */
  finalDatabase?: string | null;
  fromDatabase?: string | null;
}

export interface EvidenceMark {
  /** The class of evidence, as the api names it (`cautions[].code`). */
  kind: string;
  tone: EvidenceTone;
  /** A few words, shown in the mark. */
  label: string;
  /** What the result says, with its own values (code spans in backticks). */
  detail: string;
  /** The api's text of the class (`/vocabulary`, `cautions`). */
  meaning: string | null;
  /** Where the mark is read from, as the api names it. */
  code: string;
  limitation: Limitation | null;
  /** A release at which to read the identifier again (the release a reading of another time holds). */
  readAt?: number;
  /** The conversion that answers what the mark doubts, where one does. */
  ask?: EvidenceAsk;
  /** Another gene than the best answer may be the gene meant: said beside the status, not only among the marks. */
  alert?: boolean;
}

/** The sections of idtrack's limitations by the anchor of their title (`scripts/limitations.ts`). */
const SECTIONS = new Map(limitations.sections.map((s) => [s.anchor, s]));
const PAGE = limitations.source.replace(/#.*$/, "");

/** The anchors of the limitations the pages name themselves (an identifier not found: "Databases the graph does not
 *  hold"; a list read without a release: "Without a release, a string is what it means today"), the first that the
 *  generated file holds. A unit test fails when no anchor is a section of the file. */
export const LIMITATION_OF = {
  not_held: ["databases-the-graph-does-not-hold"],
  other_release: ["without-a-release-a-string-is-what-it-means-today"],
} as const satisfies Record<string, readonly string[]>;

export function limitationAt(anchors: string | readonly string[]): Limitation | null {
  for (const anchor of typeof anchors === "string" ? [anchors] : anchors) {
    const section = SECTIONS.get(anchor);
    if (section) return { title: section.title, lead: section.lead, href: `${PAGE}#${section.anchor}` };
  }
  return null;
}

type Caution = ConversionResult["cautions"][number];

/** The api's way on as the page's: only the parts the api names as changed are set (a part set to null is changed to
 *  none, a part left out keeps the result's own). */
function askOf(ask: NonNullable<Caution["ask"]>): EvidenceAsk {
  const out: EvidenceAsk = { words: ask.words };
  const changes = new Set(ask.changes);
  if (changes.has("identifier") && ask.identifier !== null) out.identifier = ask.identifier;
  if (changes.has("from_release")) out.fromRelease = ask.from_release;
  if (changes.has("to_release") && ask.to_release !== null) out.toRelease = ask.to_release;
  if (changes.has("final_database")) out.finalDatabase = ask.final_database;
  if (changes.has("from_database")) out.fromDatabase = ask.from_database;
  return out;
}

/** Every mark of the result's best answer, in the api's order (cautions first). */
export function evidenceOf(result: ConversionResult, vocabulary: Vocabulary = NO_VOCABULARY): EvidenceMark[] {
  return result.cautions.map((c) => ({
    kind: c.code,
    tone: c.tone === "note" ? "note" : "caution",
    label: c.label,
    detail: c.text,
    meaning: vocabulary.cautions.get(c.code)?.meaning ?? null,
    code: `cautions[].code = ${c.code}`,
    limitation: c.limitation ? limitationAt(c.limitation.replace(/^[^#]*#/, "")) : null,
    ...(c.alert ? { alert: true } : {}),
    ...(c.ask ? { ask: askOf(c.ask) } : {}),
    ...(c.read_at !== null ? { readAt: c.read_at } : {}),
  }));
}

/** The number of cautions: an answer without any is shown as plainly converted. */
export function cautionCount(marks: readonly EvidenceMark[]): number {
  return marks.filter((m) => m.tone === "caution").length;
}
