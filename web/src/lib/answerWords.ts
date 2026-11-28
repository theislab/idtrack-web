// Facts of one answer that its verdict and its Reading tab state in words: Ensembl's events on the best answer's path,
// and an identifier as typed with what a Unicode normalisation removed made visible (components/ResultAnswer.tsx,
// components/ResultReading.tsx).
import type { PathModel } from "./pathModel";

/** Ensembl's events of a reason on the best path, in the page's words ("split" -> "splits"). */
const EVENT_WORDS: Record<string, [string, string]> = {
  split: ["split", "splits"],
  merge: ["merge", "merges"],
  split_and_merge: ["split and merge", "splits and merges"],
  replaced: ["replacement", "replacements"],
};

/** The events of Ensembl's history on the path of the first best answer, by reason in the order of their first release,
 *  each with the releases it joins in Ensembl's direction (earlier to later), from the path's own steps. */
export function pathEvents(model: PathModel): { reason: string; words: string; releases: string[] }[] {
  const best = model.candidates.find((c) => c.best);
  if (!best) return [];
  const byReason = new Map<string, { first: number; releases: string[] }>();
  for (const index of best.steps) {
    const step = model.steps[index];
    if (step?.api.kind !== "history" || !(step.api.reason in EVENT_WORDS)) continue;
    const old = step.api.old_release;
    const next = step.api.new_release;
    if (old === null || next === null) continue;
    const entry = byReason.get(step.api.reason) ?? { first: old, releases: [] };
    const text = `${old} → ${next}`;
    if (!entry.releases.includes(text)) entry.releases.push(text);
    entry.first = Math.min(entry.first, old);
    byReason.set(step.api.reason, entry);
  }
  return [...byReason]
    .sort((a, b) => a[1].first - b[1].first)
    .map(([reason, entry]) => {
      const releases = [...entry.releases].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
      const [one, many] = EVENT_WORDS[reason] ?? [reason, reason];
      return { reason, words: releases.length === 1 ? one : many, releases };
    });
}

/** An identifier as typed with every character a Unicode normalisation removes or changes made visible: a format or
 *  control character (a mark of direction, a zero-width space, a byte-order mark) as its code point, `⟨U+202E⟩`. */
export function visibleCharacters(text: string): string {
  return Array.from(text)
    .map((ch) =>
      /[\p{Cf}\p{Cc}]/u.test(ch) ? `⟨U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}⟩` : ch,
    )
    .join("");
}
