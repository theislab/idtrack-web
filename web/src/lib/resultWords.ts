// Small words and tables the panels of a result share.
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
