// How the command palette finds and orders what is typed (components/v2/CommandPalette.tsx). An entry is found by the
// starts of the words of its name and of the words it is also known by, never by a piece inside a word ("api" finds
// "The API", not "sapiens"). Groups come in the order of their best match: an exact name first, then a name that
// begins with what is typed, then a word that does. What is typed is offered as a conversion first where it is shaped
// like an identifier or nothing else matches, else after the matches.

export interface Entry {
  id: string;
  group: string;
  label: string;
  /** Words it is also found by. */
  words?: string;
}

const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** How well `entry` matches `query` (lower case): 3 its name exactly, 2 its name's start, 1 every word typed starts a
 *  word of its name or its words, 0 none. */
export function matchScore(entry: Entry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = entry.label.toLowerCase();
  if (name === q) return 3;
  if (name.startsWith(q)) return 2;
  const known = tokens(`${entry.label} ${entry.words ?? ""}`);
  const typed = tokens(q);
  if (typed.length && typed.every((t) => known.some((k) => k.startsWith(t)))) return 1;
  return 0;
}

/** Whether a text reads as an identifier rather than words: one token with a digit (ENSG00000141510, TP53, NM_000207,
 *  pdx1) or in capitals (INS). */
export function idShaped(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return /\d/.test(t) || (/^[A-Z][A-Z0-9_.:-]+$/.test(t) && t.length >= 2);
}

/** The species part of an Ensembl stable id (`ENSSSCG00000038317` -> `ENSSSC`; human's `ENSG...` -> `ENS`): the
 *  letters before the one of the feature (gene, transcript, protein, exon) and the eleven digits. */
export function ensemblSpecies(text: string): string | null {
  const match = /^(ENS[A-Z]*?)[GTPE]\d{11}(?:\.\d+)?$/i.exec(text.trim());
  return match?.[1] ? match[1].toUpperCase() : null;
}

/** The entries that match, groups by their best match, entries by theirs (the given order within a score); the
 *  conversions of what is typed (`typed`) first or after them by the rule above. Without a query, every entry in the
 *  given order. */
export function ranked<T extends Entry>(entries: readonly T[], typed: readonly T[], query: string): T[] {
  const q = query.trim();
  if (!q) return [...entries];
  const scored = entries.map((e, i) => ({ e, i, s: matchScore(e, q) })).filter((x) => x.s > 0);
  const best = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  for (const x of scored) {
    best.set(x.e.group, Math.max(best.get(x.e.group) ?? 0, x.s));
    if (!firstSeen.has(x.e.group)) firstSeen.set(x.e.group, x.i);
  }
  scored.sort(
    (a, b) =>
      (best.get(b.e.group) ?? 0) - (best.get(a.e.group) ?? 0) ||
      (firstSeen.get(a.e.group) ?? 0) - (firstSeen.get(b.e.group) ?? 0) ||
      b.s - a.s ||
      a.i - b.i,
  );
  const found = scored.map((x) => x.e);
  return idShaped(q) || !found.length ? [...typed, ...found] : [...found, ...typed];
}
