// The release a list comes from, as IDTrack's source inference reads it (`POST …/source-inference`, mode `release`):
// every release with the number of the list's distinct identifiers found there, the best release (where most are
// found), the band of releases the list cannot tell apart from the best (IDTrack's one-sided sign test) and the margin
// (the best count minus the best count outside the band). Read from the api's answer alone.
import type { SourceInferenceResponse } from "../api/types";

export interface ReleaseInference {
  /** The best release first, then the rest of the band, as IDTrack orders it. */
  band: number[];
  margin: number | null;
  /** The count of distinct identifiers found at each release. */
  counts: Map<number, number>;
  /** The distinct identifiers found in the graph, and those not found (or refused as identifiers). */
  identifiers: number;
  notFound: number;
}

/** An origin of mode `release` is a release: a whole number. */
const releaseOf = (origin: unknown): number | null =>
  typeof origin === "number" && Number.isInteger(origin) ? origin : null;

/** The inference of the api's answer, or null where its origins are not releases (another mode). */
export function readInference(answer: SourceInferenceResponse): ReleaseInference | null {
  const inference = answer.inference;
  if (inference.mode !== "release") return null;
  const band = inference.band.map(releaseOf);
  if (band.some((r) => r === null) || !band.length) return null;
  const counts = new Map<number, number>();
  for (const [origin, count] of inference.counts) {
    const release = releaseOf(origin);
    if (release === null) return null;
    counts.set(release, count);
  }
  return {
    band: band as number[],
    margin: inference.margin,
    counts,
    identifiers: inference.identifiers,
    notFound: inference.not_found,
  };
}

/** What the inference allows, by IDTrack's documentation of it ("Where a list comes from"): where some release with
 *  identifiers found lies outside the band (`margin` is a number), the list dates itself and its best release is the
 *  reading to offer; where none does (`margin` is null), the list cannot be read at one release on its own: either its
 *  band holds every release of the graph (it does not date itself), or only the band's releases find any of it and
 *  they cannot be told apart. */
export type InferenceVerdict = "dated" | "undated" | "band";
export function verdictOf(inference: ReleaseInference, releases: readonly number[]): InferenceVerdict {
  if (inference.margin !== null) return "dated";
  const band = new Set(inference.band);
  return releases.every((r) => band.has(r)) ? "undated" : "band";
}

/** The band as runs of consecutive releases in words ("64–68", "48–54, 76"). */
export function bandWords(band: readonly number[]): string {
  const sorted = [...band].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const r of sorted) {
    const last = runs[runs.length - 1];
    if (last && r === last[1] + 1) last[1] = r;
    else runs.push([r, r]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${String(a)}–${String(b)}`)).join(", ");
}
