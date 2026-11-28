// The words of an answer's evidence marks as the verdict and the Evidence tab write them: a label as a line's lead, the
// standing claim of a class where the result's own text closes with it, whether a class's meaning adds to the result's
// sentence, and the order the verdict gives the marks (components/Evidence.tsx, components/ResultAnswer.tsx).
import type { EvidenceMark } from "./evidence";

/** A label as the head of a line: its first letter in capitals (an identifier in backticks is left as written). */
export function sentenceCase(text: string): string {
  return text.startsWith("`") ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** A sentence continued after a colon: its first letter small, unless it begins with an identifier or a name. */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) && !/^(IDTrack|Ensembl)\b/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}

/** The sentences of a text (split after a full stop followed by a space and a capital or an identifier). */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z`])/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The standing claim of a mark's class where the answer's own text closes with it: the last sentence of the class's
 *  meaning, when the answer's text ends with the same sentence (a bridge: "That is idtrack's inference; no record of
 *  Ensembl states it."). Null where the answer's text says only what is particular to it. */
export function standingClaim(mark: EvidenceMark): string | null {
  if (!mark.meaning) return null;
  const own = sentencesOf(mark.detail);
  const general = sentencesOf(mark.meaning);
  const last = own[own.length - 1];
  if (own.length < 2 || general.length < 2 || last === undefined) return null;
  return last === general[general.length - 1] ? last : null;
}

/** The words of a text that carry meaning (lower case, four letters or more). */
function wordsOf(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(Boolean));
}

/** Whether the class's meaning adds to what the answer's own text says: less than three in five of its words are the
 *  answer's text's already. */
export function meaningAdds(mark: EvidenceMark): boolean {
  if (!mark.meaning) return false;
  const general = wordsOf(mark.meaning);
  if (!general.size) return false;
  const own = wordsOf(mark.detail);
  const shared = [...general].filter((w) => own.has(w)).length;
  return shared / general.size < 0.6;
}

/** The marks in the verdict's order: those that say another gene may be meant, then the other cautions, then notes. */
export function verdictOrder(marks: readonly EvidenceMark[]): EvidenceMark[] {
  return [
    ...marks.filter((m) => m.tone === "caution" && m.alert),
    ...marks.filter((m) => m.tone === "caution" && !m.alert),
    ...marks.filter((m) => m.tone !== "caution"),
  ];
}
