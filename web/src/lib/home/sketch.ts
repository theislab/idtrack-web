// What a case's small figure draws (components/home/CaseSketch.tsx): its rows and the stretch of releases it shows.
import type { ConversionResult } from "../../api/types";
import { candidateSteps, marksOf } from "./journeyModel";

/** The rows a sketch draws: the best candidate first, then up to two others (a split's or a tie's). */
export function sketchRows(result: ConversionResult): { candidate: number; strong: boolean; from: number }[] {
  const ranked = result.candidates.map((c, i) => ({ c, i }));
  const best = ranked.find(({ c }) => c.best);
  if (!best) return [];
  const bestPath = [...best.c.path, ...best.c.final_path];
  const others = ranked.filter(({ c, i }) => i !== best.i && c.gene !== best.c.gene).slice(0, 2);
  return [
    { candidate: best.i, strong: true, from: 0 },
    ...others.map(({ c, i }) => {
      const path = [...c.path, ...c.final_path];
      let k = 0;
      while (k < path.length && path[k] === bestPath[k]) k += 1;
      return { candidate: i, strong: c.best, from: k };
    }),
  ];
}

export const SKETCH_HEIGHT = 128;

/** The genes of an answer a sketch does not draw: a split's or a tie's other genes beyond the rows drawn. */
export function genesNotDrawn(result: ConversionResult): number {
  const drawn = new Set(sketchRows(result).map((r) => result.candidates[r.candidate]?.gene));
  return new Set(result.candidates.map((c) => c.gene).filter((g) => !drawn.has(g))).size;
}

/** Whether an answer holds at one release only: no step of Ensembl's history, the release read is the release asked
 *  (a reading through databases, drawn as a crossing in one column). */
export function atOneRelease(result: ConversionResult): boolean {
  const best = result.candidates.find((c) => c.best);
  if (!best || result.from_release !== result.to_release) return false;
  return candidateSteps(result, best).every((s) => s.kind !== "history" && s.kind !== "self_loop");
}

/** The releases a sketch shows: those its answer's paths span (and the releases of another meaning), two more on each
 *  side, and at least fourteen, within the graph's releases. A case lies on a short stretch of the axis: the sketch is
 *  that stretch, zoomed, under an overview of the graph's whole axis that marks it. */
export function sketchWindow(result: ConversionResult, releases: readonly number[]): number[] {
  const at: number[] = [result.to_release];
  if (result.from_release !== null) at.push(result.from_release);
  for (const row of sketchRows(result)) {
    const c = result.candidates[row.candidate];
    if (c) for (const m of marksOf(candidateSteps(result, c), result.to_release)) at.push(m.at);
  }
  for (const s of result.path?.refused ?? [])
    for (const r of [s.old_release, s.new_release]) if (r !== null) at.push(r);
  // The releases at which the string meant another gene (a name with another meaning): drawn on a lane of their own.
  for (const o of result.other_readings) if (o.reason === "other_release") at.push(...o.releases);
  const first = releases[0] ?? 0;
  const last = releases[releases.length - 1] ?? 0;
  let lo = Math.max(first, Math.floor(Math.min(...at)) - 2);
  let hi = Math.min(last, Math.ceil(Math.max(...at)) + 2);
  while (releases.filter((r) => r >= lo && r <= hi).length < 14 && (lo > first || hi < last)) {
    if (lo > first) lo -= 1;
    if (hi < last) hi += 1;
  }
  return releases.filter((r) => r >= lo && r <= hi);
}
