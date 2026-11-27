// What a case's small figure draws (components/explore/CaseSketch.tsx): its rows and the stretch of releases it shows.
import type { ConversionResult } from "../../api/types";
import { candidateSteps, isEnsembl, marksOf } from "../home/journeyModel";

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

/** The geometry of a sketch, top to bottom (px): the overview strip of the graph's whole axis (its line at
 *  `OVERVIEW_Y`, its end releases written beside it, every glyph of their text inside the drawing), the view's top
 *  (the bands, their names on its first line), the first row's line and the rows' pitch; under the last thing drawn,
 *  `AIR` and the release axis with its labels (`AXIS_ROOM`). */
export const SKETCH = {
  OVERVIEW_Y: 7,
  OVERVIEW_TEXT_Y: 11,
  VIEW_TOP: 30,
  TOP: 56,
  PITCH: 16,
  /** A lane of its own with its words on a line above it (a retired gene, a name with another meaning). */
  LANE_PITCH: 30,
  AIR: 12,
  AXIS_ROOM: 22,
} as const;

/** What a sketch draws in its view, row by row, and so its height: the best path's row, the other genes' rows, the
 *  line of "+N more genes", a reading at one release as three marks in one column, the lanes of a name with another
 *  meaning or of a retired gene (each with its words above it), and a refused step. The figure is as tall as what it
 *  draws, plus a little air and its axis: no card of the gallery holds an empty band. */
export interface SketchLayout {
  /** The kind of drawing: a path (with the other genes' rows), one release read as a crossing, two lanes (a name with
   *  another meaning), or a gene whose life ends before the release asked. */
  form: "path" | "crossing" | "meaning" | "ended";
  /** The y of each row drawn (the best path's first). */
  rows: number[];
  /** The y of the line "+N more genes", or null. */
  more: number | null;
  /** The y of the lowest mark drawn. */
  bottom: number;
  /** The release axis's line, and the drawing's height. */
  axisY: number;
  height: number;
}

export function sketchLayout(result: ConversionResult): SketchLayout {
  const { TOP, PITCH, LANE_PITCH, AIR, AXIS_ROOM } = SKETCH;
  const meaning = result.other_readings.some((o) => o.reason === "other_release" && o.releases.length > 0);
  const rows = sketchRows(result);
  let form: SketchLayout["form"];
  let ys: number[];
  let more: number | null = null;
  let bottom: number;
  if (rows.length === 0) {
    form = "ended";
    ys = [TOP + 12];
    bottom = ys[0] ?? TOP;
  } else if (meaning) {
    form = "meaning";
    ys = [TOP + 12, TOP + 12 + LANE_PITCH];
    bottom = (ys[1] ?? TOP) + 4;
  } else if (atOneRelease(result)) {
    form = "crossing";
    const external = result.final_database !== null && !isEnsembl(result.final_database);
    ys = external ? [TOP - 6, TOP + PITCH - 2, TOP + 2 * PITCH + 2] : [TOP - 4, TOP + PITCH + 4];
    bottom = (ys[ys.length - 1] ?? TOP) + 4;
  } else {
    form = "path";
    ys = rows.map((_, r) => TOP + r * PITCH);
    bottom = (ys[ys.length - 1] ?? TOP) + 4;
    if (genesNotDrawn(result) > 0) {
      more = TOP + rows.length * PITCH + 4;
      bottom = more + 3;
    }
    if ((result.path?.refused ?? []).length) bottom = Math.max(bottom, TOP + Math.min(2, rows.length) * PITCH + 2);
  }
  const axisY = Math.ceil(bottom + AIR);
  return { form, rows: ys, more, bottom, axisY, height: axisY + AXIS_ROOM };
}

/** The releases at which a gene exists (its `active` ranges, an open end at the graph's last release) as runs. */
export function activeRuns(active: readonly [number, number | null][], last: number): [number, number][] {
  return active.map(([a, b]) => [a, b ?? last]);
}

/** The last release at which a gene exists, where it ends inside the graph (null: it is active at the graph's last
 *  release). Read from its `active` releases, as everywhere in the figures. */
export function lastRelease(active: readonly [number, number | null][]): number | null {
  if (!active.length || active.some(([, b]) => b === null)) return null;
  return Math.max(...active.map(([, b]) => b ?? 0));
}

/** A product of Ensembl's scores as the page computes it, shortened for reading: at most `decimals` decimals, the rest
 *  cut and marked with "…" (never rounded), so that the page's own product, whose last digit can differ from the
 *  engine's by the order of its multiplications, is never written as more exact than it is. */
export function shortProduct(text: string, decimals = 6): string {
  const dot = text.indexOf(".");
  if (dot < 0 || text.length - dot - 1 <= decimals || /e/i.test(text)) return text;
  return `${text.slice(0, dot + 1 + decimals)}…`;
}

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

/** The releases a sketch shows: those its answer's paths span (and the releases of another meaning, and `also`: the
 *  releases at which a gene that answers nothing existed), two more on each side, and at least fourteen, within the graph's releases. A case lies on a short stretch of the axis: the sketch is
 *  that stretch, zoomed, under an overview of the graph's whole axis that marks it. */
export function sketchWindow(
  result: ConversionResult,
  releases: readonly number[],
  also: readonly number[] = [],
): number[] {
  const at: number[] = [result.to_release, ...also];
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

/** The marks of the gallery's key: those its sketches draw, read from the answers as the sketches read them (the key
 *  lists exactly the marks drawn). */
export type KeyMark =
  | "form"
  | "read"
  | "answer"
  | "final"
  | "version"
  | "event"
  | "loop"
  | "handoff"
  | "bridge"
  | "branch"
  | "ended"
  | "other";

export function keyMarks(results: readonly ConversionResult[]): Set<KeyMark> {
  const marks = new Set<KeyMark>();
  for (const result of results) {
    const layout = sketchLayout(result);
    if (result.from_release !== null) marks.add(result.from_databases.some((d) => !isEnsembl(d)) ? "read" : "form");
    if (layout.form === "ended") {
      marks.add("ended");
      continue;
    }
    if (layout.form === "meaning") {
      marks.add("other");
      continue;
    }
    const external = result.final_database !== null && !isEnsembl(result.final_database);
    const rows = sketchRows(result);
    if (layout.form === "path" && rows.length > 1) marks.add("branch");
    for (const row of rows) {
      const candidate = result.candidates[row.candidate];
      if (!candidate) continue;
      const own = marksOf(candidateSteps(result, candidate), result.to_release).slice(row.from);
      for (const m of own)
        if (
          m.kind === "version" ||
          m.kind === "event" ||
          m.kind === "loop" ||
          m.kind === "handoff" ||
          m.kind === "bridge"
        )
          marks.add(m.kind);
      marks.add(external && own.some((m) => m.kind === "final") ? "final" : "answer");
    }
    if (layout.form === "crossing") marks.add(external ? "final" : "answer");
  }
  return marks;
}
