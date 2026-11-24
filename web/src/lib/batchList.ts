// A list of identifiers for a batch.

/** One identifier per line; a line of a table (tab, comma or semicolon) gives its first cell. Empty lines are skipped. */
export function parseList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => (line.split(/[\t,;]/)[0] ?? "").trim())
    .filter((line) => line !== "");
}
