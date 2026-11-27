// Small words and tables the panels of a result share.
import { pythonFloat } from "./numbers";
import type { Criterion } from "./vocabulary";

/** The ranking record of a candidate, in idtrack's order of the criteria, where the api's vocabulary is not at hand. */
export const RECORD: Criterion[] = [
  "own_version",
  "final_confidence",
  "bridges",
  "bridge_gap",
  "display_name",
  "entry_support",
  "score",
  "same_as_query",
  "annotation",
].map((code) => ({ code, meaning: null, fields: [] }));

/** The criteria that compare the successors of one entry gene (idtrack's documentation, "The best answer and ties":
 *  the lineage criteria compare the entry genes; then, among the successors of the entry genes that stay, these decide).
 *  Two candidates of different entry genes are never ranked by them. */
export const SUCCESSOR_CRITERIA: readonly string[] = ["score", "same_as_query", "annotation"];

/** A kind of step in the page's words where they differ from its code spaced: one name for one concept on every
 *  figure, legend and table (the hero's key says "re-mapped to itself"). */
const STEP_WORDS: Record<string, string> = { self_loop: "re-mapped to itself" };

/** A step's reason (or kind) in words. */
export function stepWords(code: string): string {
  return STEP_WORDS[code] ?? code.replace(/_/g, " ");
}

/** The tone of a status, for its colour (the words are the status itself). */
export function statusTone(status: string): "ok" | "warn" | "danger" | "none" {
  if (status === "converted") return "ok";
  if (status === "tie" || status === "no_target") return "warn";
  if (status === "error") return "danger";
  return "none";
}

/** idtrack's or the api's text for a reader of the answer: the references it makes to fields of the result by their
 *  code (`(\`known_versions\`)`, "; \`reasons\` says why", "(see \`error\`)") are left out, since the page shows those
 *  fields' values in words beside it; the rest of the text is kept as written. */
export function readerText(text: string): string {
  return text
    .replace(/\s*\((?:see )?`[^`]+`\)/g, "")
    .replace(/[;,]\s*`[^`]+` says why/g, "")
    .replace(/\s+([.;,])/g, "$1");
}

/** The significant digits a score is shown with in a table before "…" (Ensembl writes its scores with six). */
export const SCORE_DIGITS = 6;

/** A score as a table shows it: idtrack's text of the float (`pythonFloat`), cut after its sixth significant digit
 *  (trailing zeros left out) with "…" where more digits follow, so that a product's floating-point tail (`0.8019000000000001`)
 *  is not read as data; never rounded. `exact` is the whole text, shown on focus and copied. */
export function shortScore(score: number): { text: string; exact: string } {
  const exact = pythonFloat(score);
  const form = /^(-?)(\d+)\.(\d+)$/.exec(exact);
  if (!form) return { text: exact, exact };
  const [, sign = "", whole = "", fraction = ""] = form;
  const digits = (whole === "0" ? "" : whole) + fraction;
  const lead = digits.length - digits.replace(/^0+/, "").length;
  const significant = digits.length - lead;
  if (significant <= SCORE_DIGITS) return { text: exact, exact };
  const keep = (whole === "0" ? lead : 0) + SCORE_DIGITS - (whole === "0" ? 0 : whole.length);
  if (keep <= 0) return { text: exact, exact };
  const cut = fraction.slice(0, keep).replace(/0+$/, "");
  return { text: `${sign}${whole}.${cut || "0"}…`, exact };
}
