// The steps of a journey counted in words, for the figure's note and its text alternative: each reason of the api's
// path steps (`/vocabulary` `step_reasons`, whose meanings are sentences) said as a noun with its number, in the words
// of the figure's legend; a reason this list does not name is said by its code's words.
import type { PathStep } from "../../api/types";
import { spaced } from "../vocabulary";

const NOUNS: Record<string, [string, string]> = {
  entry: ["reading of the identifier", "readings of the identifier"],
  identity: ["gene at the release asked", "genes at the release asked"],
  new_version: ["new version", "new versions"],
  replaced: ["replacement", "replacements"],
  split: ["split", "splits"],
  merge: ["merge", "merges"],
  split_and_merge: ["split and merge", "splits and merges"],
  self_loop: ["re-mapping of the gene to itself", "re-mappings of the gene to itself"],
  bridge_near: ["step into a bridge", "steps into a bridge"],
  bridge_far: ["step out of a bridge", "steps out of a bridge"],
  final: ["answer in the database asked", "answers in the database asked"],
  final_other_release: ["answer through another release's form", "answers through another release's form"],
};

/** A number and its noun ("1 step", "3 steps"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A count of one reason of step in words ("13 new versions"). */
function reasonCount(reason: string, n: number): string {
  const noun = NOUNS[reason];
  return noun ? plural(n, noun[0], noun[1]) : `${n} ${spaced(reason)}`;
}

/** The steps of a path in words, by reason in the order they first occur ("18 steps: 1 reading of the identifier,
 *  13 new versions, …"). */
export function stepsInWords(steps: readonly PathStep[]): string {
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const parts = [...counts.entries()].map(([reason, n]) => reasonCount(reason, n));
  return `${plural(steps.length, "step")}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}
