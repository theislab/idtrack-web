// IDTrack's meanings (the api's vocabulary) read for a person rather than a programmer, by rules about the form of the
// text, never about a particular code: the full text stays one press away, in IDTrack's words.
//
// - An aside in parentheses that opens with code and says in words after a colon what it is keeps the words
//   ("(`gene.display_xref_id`: Ensembl's own name of the gene there)" → "(Ensembl's own name of the gene there)"); one
//   that is only code (a module, a field, a quoted value) is left out ("(`idtrack.engine.ranking`; `decided_by` is
//   `"display_name"` where it decided)", "(`known_versions`)").
// - A sort key written as a tuple of negated counts ("`(-external ids, -transcripts, -translations)`") is said in words:
//   the more of each, the earlier, in that order.
// - A value in a programming language's spelling (`null`, `None`, `True`, `False`) is said as a word.
// - The remaining code (a field's name) stays code as IDTrack writes it (`entry_gene`), drawn in the monospaced face:
//   a field named in words would read as a noun of the sentence ("into gene").

const VALUE_WORDS: Record<string, string> = {
  null: "none",
  None: "none",
  True: "yes",
  False: "no",
  true: "yes",
  false: "no",
};

/** The first sentence of a text (for a list that shows each meaning in one line). */
export function firstSentence(text: string): string {
  const found = /^[\s\S]*?[.?!](?=\s+[A-Z`(0-9]|\s*$)/.exec(text.trim());
  return found ? found[0] : text.trim();
}

function tupleWords(inner: string): string | null {
  const parts = inner.split(/,\s*/).map((p) => p.trim());
  if (parts.length < 2 || !parts.every((p) => p.startsWith("-"))) return null;
  const names = parts.map((p) => p.slice(1).trim());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}` : names[0];
  return `the numbers of ${list ?? ""} (the more of each, the earlier, in that order)`;
}

export function readerText(text: string): string {
  let out = text;
  // A tuple of negated counts written as code.
  out = out.replace(/`\(([^`()]*)\)`/g, (whole, inner: string) => tupleWords(inner) ?? whole);
  // Asides that open with code.
  out = out.replace(/\s*\((`[^`]*`)([^()]*)\)/g, (_whole, _code: string, rest: string) => {
    const words = /^\s*:\s*(.+)$/.exec(rest);
    if (words?.[1] && !/^[`"]/.test(words[1].trim())) return ` (${words[1].trim()})`;
    return "";
  });
  // Values in a programming language's spelling.
  out = out.replace(/`"?(null|None|True|False|true|false)"?`/g, (_w, v: string) => VALUE_WORDS[v] ?? v);
  return out
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
