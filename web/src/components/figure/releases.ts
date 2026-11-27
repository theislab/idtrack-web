// The release axis every figure shares (DESIGN.md, "The figure grammar"). Every release of a graph is one column of
// equal width, in ascending order, so that a graph whose releases had a gap would still draw each release once; the
// assembly bands are the runs of releases each assembly serves (`serving_assembly`). Positions are pixels on a scale
// (`ReleaseScale`, for the drawings in SVG) or fractions of the axis (`Axis`, for the small figures drawn in HTML).
import type { GraphDescription } from "../../api/types";

// ---- The axis ------------------------------------------------------------------------------------------------------

export interface Axis {
  /** Every release of the graph, ascending. */
  releases: number[];
  /** The place of each release on the axis. */
  index: Map<number, number>;
}

export function axisOf(releases: readonly number[]): Axis {
  const sorted = [...new Set(releases)].sort((a, b) => a - b);
  return { releases: sorted, index: new Map(sorted.map((r, i) => [r, i])) };
}

/** The place of a release on the axis as a real number: the index of a release of the axis, between two neighbours
 *  for a release between them (a step's middle, a column's edge), one column per release beyond the ends. */
function position(axis: Axis, release: number): number {
  const { releases } = axis;
  const n = releases.length;
  const first = releases[0];
  const last = releases[n - 1];
  if (first === undefined || last === undefined) return 0;
  const exact = axis.index.get(release);
  if (exact !== undefined) return exact;
  if (release <= first) return release - first;
  if (release >= last) return n - 1 + (release - last);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((releases[mid] ?? 0) <= release) lo = mid;
    else hi = mid;
  }
  const a = releases[lo] ?? first;
  const b = releases[hi] ?? last;
  return lo + (release - a) / (b - a || 1);
}

/** The left edge of a release's cell and its width, as fractions of the axis. */
export function cell(axis: Axis, release: number): { left: number; width: number } | null {
  const i = axis.index.get(release);
  if (i === undefined) return null;
  const n = axis.releases.length;
  return { left: i / n, width: 1 / n };
}

export interface Run {
  first: number;
  last: number;
  /** Fractions of the axis. */
  left: number;
  width: number;
}

/** The runs of consecutive releases of the axis that a set of releases fills (releases off the axis are left out). */
export function runsOf(axis: Axis, releases: readonly number[]): Run[] {
  const places = [...new Set(releases)]
    .map((r) => axis.index.get(r))
    .filter((i): i is number => i !== undefined)
    .sort((a, b) => a - b);
  const n = axis.releases.length;
  const runs: Run[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  const close = () => {
    if (start === null || previous === null) return;
    runs.push({
      first: axis.releases[start] ?? 0,
      last: axis.releases[previous] ?? 0,
      left: start / n,
      width: (previous - start + 1) / n,
    });
  };
  for (const i of places) {
    if (previous !== null && i === previous + 1) {
      previous = i;
      continue;
    }
    close();
    start = i;
    previous = i;
  }
  close();
  return runs;
}

// ---- The scale in pixels -------------------------------------------------------------------------------------------

export interface ReleaseScale {
  first: number;
  last: number;
  x0: number;
  x1: number;
  /** The centre of a release's column (r), its left edge (r - 0.5) or its right edge (r + 0.5); between releases,
   *  in proportion. */
  x: (release: number) => number;
  /** Pixels per release. */
  step: number;
  releases: readonly number[];
}

/** The scale of a graph's releases over [x0, x1]: each release one equal column. */
export function releaseScale(releases: readonly number[], x0: number, x1: number): ReleaseScale {
  const axis = axisOf(releases.length ? releases : [0]);
  const n = axis.releases.length;
  const step = (x1 - x0) / Math.max(1, n);
  return {
    first: axis.releases[0] ?? 0,
    last: axis.releases[n - 1] ?? 0,
    x0,
    x1,
    step,
    releases: axis.releases,
    x: (release: number) => x0 + (position(axis, release) + 0.5) * step,
  };
}

/** A scale from any monotone function of releases (the path view's zoomed scale), over [x0, x1]. */
export function scaleOf(releases: readonly number[], x: (release: number) => number, x0: number, x1: number) {
  const sorted = [...releases].sort((a, b) => a - b);
  return {
    first: sorted[0] ?? 0,
    last: sorted[sorted.length - 1] ?? 0,
    x0,
    x1,
    x,
    step: Math.abs(x(1) - x(0)),
    releases: sorted,
  } satisfies ReleaseScale;
}

/** Which releases may carry a label, for the room a release has: every 5th, every 10th or every 20th. */
export function labelEvery(step: number): number {
  if (step >= 7) return 5;
  if (step >= 3.2) return 10;
  return 20;
}

/** The releases labelled on an axis of fractions: the first, the last and every tenth between, none closer than
 *  `gap` releases to a label already placed (the first and last are always labelled). */
export function tickLabels(axis: Axis, gap = 4): number[] {
  const { releases } = axis;
  const first = releases[0];
  const last = releases[releases.length - 1];
  if (first === undefined || last === undefined) return [];
  if (first === last) return [first];
  const labels = [first];
  for (const r of releases) {
    if (r % 10 !== 0 || r === first || r === last) continue;
    const i = axis.index.get(r) ?? 0;
    const prev = axis.index.get(labels[labels.length - 1] ?? first) ?? 0;
    const end = axis.index.get(last) ?? 0;
    if (i - prev >= gap && end - i >= gap) labels.push(r);
  }
  labels.push(last);
  return labels;
}

// ---- The assembly bands --------------------------------------------------------------------------------------------

export interface Band {
  assembly: number;
  name: string;
  first: number;
  last: number;
}

export interface AxisBand extends Band {
  /** Fractions of the axis. */
  left: number;
  width: number;
}

type Served = Pick<GraphDescription, "releases" | "serving_assembly" | "assemblies">;

/** The runs of releases each assembly serves (`serving_assembly`), named as the graph names them. */
export function assemblyBands(description: Served): Band[] {
  return bandsOf(axisOf(description.releases), description).map(({ assembly, name, first, last }) => ({
    assembly,
    name,
    first,
    last,
  }));
}

/** The bands on an axis of fractions. */
export function bandsOf(
  axis: Axis,
  description: Pick<GraphDescription, "serving_assembly" | "assemblies">,
): AxisBand[] {
  const names = new Map(description.assemblies.map((a) => [a.assembly, a.name ?? String(a.assembly)]));
  const n = axis.releases.length;
  const bands: AxisBand[] = [];
  axis.releases.forEach((release, i) => {
    const assembly = description.serving_assembly[String(release)];
    if (assembly === undefined) return;
    const last = bands[bands.length - 1];
    if (last?.assembly === assembly && last.last === axis.releases[i - 1]) {
      last.last = release;
      last.width = (i + 1) / n - last.left;
    } else {
      bands.push({
        assembly,
        name: names.get(assembly) ?? String(assembly),
        first: release,
        last: release,
        left: i / n,
        width: 1 / n,
      });
    }
  });
  return bands;
}

/** A band's releases as written beside its name ("55–75", or "48" for one release). */
export function bandRange(band: Band): string {
  return band.first === band.last ? `${band.first}` : `${band.first}–${band.last}`;
}

/** The short names of a graph's assemblies: the part every name of the graph begins with (a prefix of at least three
 *  characters ending where a word or a number begins, compared without case) written as the initials of its words and
 *  "…", the rest whole, so that a short name is never a bare number: "Sscrofa11.1" is "S…11.1" beside "Sscrofa9"
 *  ("S…9"), "Macaca_fascicularis_5.0" is "Mf…5.0" beside "Macaca_fascicularis_6.0"; names that share no such prefix
 *  (GRCh38 beside NCBI36) are their own short names. The full name is on focus and in the figure's words. */
export function shortNames(names: readonly string[]): Map<string, string> {
  const unique = [...new Set(names)];
  const out = new Map(unique.map((n) => [n, n]));
  if (unique.length < 2) return out;
  const lower = unique.map((n) => n.toLowerCase());
  let prefix = lower[0] ?? "";
  for (const n of lower) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  // Cut back to a boundary: after a separator, or between a letter and a digit.
  let cut = prefix.length;
  const boundary = (i: number) => {
    const a = prefix[i - 1] ?? "";
    const b = (lower[0] ?? "")[i] ?? "";
    return /[^a-z0-9]/.test(a) || (/[a-z]/.test(a) && /[0-9]/.test(b));
  };
  while (cut > 0 && !boundary(cut)) cut -= 1;
  if (cut < 3) return out;
  for (const n of unique) {
    const rest = n.slice(cut);
    // The shared part's initials, as written in this name (a word begins after a separator).
    const initials = (n.slice(0, cut).match(/[A-Za-z0-9]+/g) ?? []).map((word) => word.charAt(0)).join("");
    if (rest) out.set(n, `${initials}…${rest}`);
  }
  return out;
}
