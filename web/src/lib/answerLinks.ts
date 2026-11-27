// The words and links an answer's panels share: the address of a conversion kept in a notebook (its target release
// and its graph written out), the name of its saved answer, Ensembl's page of a gene's history, counts of the kinds
// of step, the words of a match.
import { stepWords } from "./resultWords";
import type { ConversionResult, GraphDescription } from "../api/types";

export const ENSEMBL_GENE = /^ENS[A-Z]*G\d{11}(\.\d+)?$/;

/** The graph's short content digest, as a link writes it (`graph=`): the first 12 hexadecimal digits. */
export function shortDigest(description: GraphDescription): string | null {
  return description.content_digest ? description.content_digest.slice(0, 12) : null;
}

/** The address of this conversion with its target release and its graph written out: a link kept in a notebook asks
 *  for the same release after the server's graphs gain newer ones, and says so when it is opened on another graph. */
export function pinnedLink(result: ConversionResult, description: GraphDescription, location: string): string {
  const url = new URL(location);
  if (!url.searchParams.get("to")) url.searchParams.set("to", String(result.to_release));
  const digest = shortDigest(description);
  if (digest) url.searchParams.set("graph", digest);
  return url.href;
}

export function answerFileName(result: ConversionResult, organism: string): string {
  const safe = result.query_id.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64);
  return `idtrack_${organism}_${safe}_to_${result.to_release}.json`;
}

/** Counts of the kinds of step: every kind where there are at most four, else the three most frequent and "N more
 *  kinds". */
export function kindsText(byReason: readonly { reason: string; count: number }[]): string {
  // The most frequent kinds first (in the path's order among equals), so that what is left out is the rarest.
  const sorted = [...byReason].sort((a, b) => b.count - a.count);
  const shown = sorted.length <= 4 ? sorted : sorted.slice(0, 3);
  const rest = byReason.length - shown.length;
  const text = shown.map((r) => `${r.count} ${stepWords(r.reason)}`).join(" · ");
  return rest > 0 ? `${text} · ${rest} more kind${rest === 1 ? "" : "s"}` : text;
}

/** Ensembl's page of a gene's id history (its site's species path: the organism's name with a capital). */
export function ensemblHistoryHref(organism: string, id: string): string | null {
  if (!ENSEMBL_GENE.test(id)) return null;
  const species = organism.charAt(0).toUpperCase() + organism.slice(1);
  return `https://www.ensembl.org/${species}/Gene/Idhistory?g=${encodeURIComponent(id.replace(/\.\d+$/, ""))}`;
}

/** The words of a match's parts ("synonym, exact"): each part in words, its meaning and code on a press. */
export const MATCH_WORDS: Record<string, string> = {
  exact: "exact",
  case: "without letter case",
  separator: "separators as one",
  version: "with its version",
  version_newer_than_graph: "version newer than the graph",
  version_not_judged: "version not judged",
  copy: "a copy of another item",
  unicode: "Unicode normalised",
  punctuation: "punctuation removed",
  par_y: "Y copy",
  lrg: "LRG record",
  synonym: "synonym",
};
