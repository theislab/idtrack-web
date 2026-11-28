// The layout of the home's lineage field (`GET /organisms/{organism}/lineages`): every gene id given is a line over the
// releases at which a version of it is active. At each release the active ids stand in one fixed order (the order the
// api gives: whole families, families in the order of a hash), centred on the axis, so that the field's outline at a
// release is the number of ids alive there and every line bends as ids are born and retired around it. Coordinates are
// fractions: x from 0 (the graph's first release) to 1 (its last), y from -0.5 to 0.5 of the field's height, the
// widest release filling it. Nothing here draws; the renderer (components/hero/field.ts) reads the typed arrays.
import type { LineagesResponse } from "../../api/types";

/** A segment's floats: x0, y0, x1, y1, its fade (0 none, 1 in, 2 out), and its line's era plus phase: the whole part
 *  the era of the id (the assembly that served the release it began at, 0 the first), the fraction its phase (from
 *  its index). */
export const SEGMENT_FLOATS = 6;
/** An edge's floats: x0, y0, x1, y1, its kind (0 one to one, 1 a fan of Ensembl's mapping), unused. */
export const EDGE_FLOATS = 6;

export interface LineageLayout {
  releases: number[];
  /** Ids given, and all ids of the graph. */
  shown: number;
  genes: number;
  /** Per release (by index): the active ids from the top edge to the bottom (indices into `ids`). */
  columns: Int32Array[];
  /** The most ids active at one release (the field's height). */
  widest: number;
  /** Per release (by index), the y of the field's top edge there: its outermost line, half a line out (-0.5 at the
   *  widest release; 0 where no id is active). */
  top: Float32Array;
  /** Per id, the y of the id at each release index (NaN where it is not active), row-major: id * releases + k. */
  y: Float32Array;
  segments: Float32Array;
  /** Per id, its first segment (ids' segments are contiguous, in the order of the ids); length ids + 1. */
  segmentStart: Int32Array;
  edges: Float32Array;
  /** Per id, its first edge (edges stand with their family, the family's from its first id); length ids + 1. */
  edgeStart: Int32Array;
  /** The new versions: x, y per dot. */
  dots: Float32Array;
  /** Per id, its family's first and last id (inclusive). */
  familyOf: Int32Array;
  familyStarts: number[];
  /** The ids of the families of the showcase's journeys come first: those before this index. */
  focusIds: number;
  /** The eras the ids began in (the graph's assemblies). */
  eras: number;
  /** Counts of what is drawn, for the caption and the text alternative. */
  counts: { versions: number; edges: number; fans: number; families: number };
  ids: string[];
  /** Per id, its runs of active releases, flat (`first, last` pairs), from `runStart[id]` to `runStart[id + 1]`. */
  runs: Int32Array;
  runStart: Int32Array;
  versionCounts: Int32Array;
  /** What the renderer draws: every id's line, the showcase's journeys' lines (drawn stronger) and the lines that
   *  carry the travelling light, simplified (`simplified`). */
  lines: { all: Lines; focal: Lines; pulses: Lines };
}

/** Segments to draw: those drawn as straight lines (two vertices each) and those drawn as curves. */
export interface Lines {
  straight: Float32Array;
  curved: Float32Array;
}

/** The ids whose lines carry the travelling light: the ids of the showcase's journeys first (the focal threads),
 *  then every id of a family with an edge (the convoluted lineages), then others spread through the field, `most` in
 *  all. */
function pulseIds(layout: Pick<LineageLayout, "focusIds" | "familyStarts" | "shown">, most: number): number[] {
  const chosen: number[] = [];
  for (let i = 0; i < layout.focusIds && chosen.length < most * 0.4; i++) chosen.push(i);
  const starts = [...layout.familyStarts, layout.shown];
  for (let f = 0; f < starts.length - 1 && chosen.length < most * 0.6; f++) {
    const first = starts[f] ?? 0;
    const last = (starts[f + 1] ?? 0) - 1;
    if (last > first) for (let i = first; i <= last && chosen.length < most * 0.6; i++) chosen.push(i);
  }
  const step = Math.max(1, Math.floor(layout.shown / Math.max(1, most - chosen.length)));
  const taken = new Set(chosen);
  for (let i = 0; i < layout.shown && chosen.length < most; i += step) if (!taken.has(i)) chosen.push(i);
  return chosen;
}

/** The segments of some ids, simplified for drawing: a run of segments of one id whose height changes by less than
 *  `tolerance` at each release (a shift of a fraction of a pixel) is one straight segment, drawn with two vertices;
 *  the others are curves. On a laptop's GPU it saves little; in software rendering it is the difference between
 *  seconds and a fraction of one. Made here, with the layout (in the page's worker), not on the page's thread. */
export function simplified(
  layout: Pick<LineageLayout, "segments" | "segmentStart">,
  ids: Iterable<number>,
  tolerance: number,
): Lines {
  const straight: number[] = [];
  const curved: number[] = [];
  const seg = layout.segments;
  for (const i of ids) {
    const a = layout.segmentStart[i] ?? 0;
    const b = layout.segmentStart[i + 1] ?? 0;
    let run: number[] | null = null;
    const flush = () => {
      if (run) straight.push(...run);
      run = null;
    };
    for (let k = a; k < b; k++) {
      const o = k * SEGMENT_FLOATS;
      const x0 = seg[o] ?? 0;
      const y0 = seg[o + 1] ?? 0;
      const x1 = seg[o + 2] ?? 0;
      const y1 = seg[o + 3] ?? 0;
      const fade = seg[o + 4] ?? 0;
      const meta = seg[o + 5] ?? 0;
      if (fade !== 0) {
        flush();
        straight.push(x0, y0, x1, y1, fade, meta);
      } else if (Math.abs(y1 - y0) < tolerance) {
        const r: number[] | null = run;
        if (r && Math.abs((r[2] ?? 0) - x0) < 1e-6) {
          r[2] = x1;
          r[3] = y1;
        } else {
          flush();
          run = [x0, y0, x1, y1, 0, meta];
        }
      } else {
        flush();
        curved.push(x0, y0, x1, y1, 0, meta);
      }
    }
    flush();
  }
  return { straight: Float32Array.from(straight), curved: Float32Array.from(curved) };
}

/** A fraction of the axis for a release index: releases evenly spaced (Ensembl's releases are consecutive numbers). */
const xOf = (k: number, n: number) => (n > 1 ? k / (n - 1) : 0.5);

/** The layout; `eras` are the first releases of the graph's assemblies after the first (an id's era is how many of
 *  them its first release has reached). */
export function layoutLineages(body: LineagesResponse, eras: readonly number[] = []): LineageLayout {
  const releases = body.releases;
  const n = releases.length;
  const index = new Map(releases.map((r, k) => [r, k]));
  const count = body.ids.length;
  // Which releases each id is active at, by index.
  const on = new Uint8Array(count * n);
  body.active.forEach((runs, i) => {
    for (const run of runs) {
      const a = index.get(run[0] ?? Number.NaN);
      const b = index.get(run[1] ?? Number.NaN);
      if (a === undefined || b === undefined) continue;
      for (let k = a; k <= b; k++) on[i * n + k] = 1;
    }
  });
  // Growth rings: each family on one side of the centre line (by the parity of its place in the api's order, which
  // is a hash), and on each side, at each release, the active ids by the release they began at (the oldest nearest the
  // centre), then by family and id. The order on a side never changes, so no two lines cross; an id born later
  // enters at the edge, and lines close in where ids are retired.
  const familyFirst = new Int32Array(count);
  const fstarts = [...body.family_starts, count];
  for (let f = 0; f < fstarts.length - 1; f++)
    for (let i = fstarts[f] ?? 0; i < (fstarts[f + 1] ?? 0); i++) familyFirst[i] = f;
  const birth = new Int32Array(count).fill(n);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < n; k++)
      if (on[i * n + k]) {
        birth[i] = k;
        break;
      }
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (p, q) => (birth[p] ?? 0) - (birth[q] ?? 0) || (familyFirst[p] ?? 0) - (familyFirst[q] ?? 0) || p - q,
  );
  const side = (i: number) => ((familyFirst[i] ?? 0) % 2 === 0 ? -1 : 1);
  let widest = 1;
  const above = new Int32Array(n);
  const below = new Int32Array(n);
  for (let k = 0; k < n; k++)
    for (let i = 0; i < count; i++) {
      if (!on[i * n + k]) continue;
      if (side(i) < 0) above[k] = (above[k] ?? 0) + 1;
      else below[k] = (below[k] ?? 0) + 1;
    }
  for (let k = 0; k < n; k++) widest = Math.max(widest, 2 * Math.max(above[k] ?? 0, below[k] ?? 0));
  const y = new Float32Array(count * n).fill(Number.NaN);
  const columns: Int32Array[] = [];
  const edgeTop = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let up = 0;
    let down = 0;
    const top: number[] = [];
    const bottom: number[] = [];
    for (const i of order) {
      if (!on[i * n + k]) continue;
      if (side(i) < 0) {
        y[i * n + k] = -(up + 0.5) / widest;
        up++;
        top.push(i);
      } else {
        y[i * n + k] = (down + 0.5) / widest;
        down++;
        bottom.push(i);
      }
    }
    // The column from the top edge down: the upper side outermost first, then the lower side.
    columns.push(Int32Array.from([...top.reverse(), ...bottom]));
    edgeTop[k] = up ? -up / widest : 0;
  }
  // Segments: one per pair of consecutive releases an id is active at; a short lead-in where an id begins after the
  // graph's first release, a lead-out where it ends before the last (half a release, fading).
  const segments: number[] = [];
  const segmentStart = new Int32Array(count + 1);
  const half = n > 1 ? 0.5 / (n - 1) : 0;
  for (let i = 0; i < count; i++) {
    segmentStart[i] = segments.length / SEGMENT_FLOATS;
    const firstRelease = releases[birth[i] ?? 0] ?? 0;
    const era = eras.filter((e) => firstRelease >= e).length;
    const phase = era + ((((i * 0.6180339887) % 1) + 1) % 1) * 0.999;
    for (let k = 0; k < n; k++) {
      if (!on[i * n + k]) continue;
      const yk = y[i * n + k] ?? 0;
      const before = k > 0 && on[i * n + k - 1];
      const after = k < n - 1 && on[i * n + k + 1];
      if (!before && k > 0) segments.push(xOf(k, n) - half, yk, xOf(k, n), yk, 1, phase);
      if (after) segments.push(xOf(k, n), yk, xOf(k + 1, n), y[i * n + k + 1] ?? 0, 0, phase);
      else if (k < n - 1) segments.push(xOf(k, n), yk, xOf(k, n) + half, yk, 2, phase);
    }
  }
  segmentStart[count] = segments.length / SEGMENT_FLOATS;
  // Edges between ids: a fan where a version's edges across one pair of releases reach two or more ids, or two or more
  // ids' edges reach one id (Ensembl's mapping fanning out or in).
  const outs = new Map<string, number>();
  const ins = new Map<string, number>();
  for (const [a, b, old, now] of body.edges) {
    outs.set(`${a}|${old}|${now}`, (outs.get(`${a}|${old}|${now}`) ?? 0) + 1);
    ins.set(`${b}|${old}|${now}`, (ins.get(`${b}|${old}|${now}`) ?? 0) + 1);
  }
  const familyOf = new Int32Array(count * 2);
  const starts = [...body.family_starts, count];
  for (let f = 0; f < starts.length - 1; f++)
    for (let i = starts[f] ?? 0; i < (starts[f + 1] ?? 0); i++) {
      familyOf[2 * i] = starts[f] ?? 0;
      familyOf[2 * i + 1] = (starts[f + 1] ?? 1) - 1;
    }
  const edges: number[] = [];
  const edgeStart = new Int32Array(count + 1);
  let fans = 0;
  let drawnEdges = 0;
  // Edges in the order of their family's first id, so that a family's edges are contiguous.
  const firstOf = (edge: (number | null)[]) => familyOf[2 * Number(edge[0])] ?? 0;
  const byFamily = [...body.edges].sort((p, q) => firstOf(p) - firstOf(q));
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    edgeStart[i] = edges.length / EDGE_FLOATS;
    for (let edge = byFamily[cursor]; edge && firstOf(edge) === i; edge = byFamily[cursor]) {
      const [a, b, old, now] = edge.map(Number) as [number, number, number, number];
      cursor++;
      const ka = index.get(old);
      const kb = index.get(now);
      if (ka === undefined || kb === undefined) continue;
      const ya = y[a * n + ka];
      const yb = y[b * n + kb];
      if (ya === undefined || yb === undefined || Number.isNaN(ya) || Number.isNaN(yb)) continue;
      const fan = (outs.get(`${a}|${old}|${now}`) ?? 0) > 1 || (ins.get(`${b}|${old}|${now}`) ?? 0) > 1;
      if (fan) fans++;
      drawnEdges++;
      edges.push(xOf(ka, n), ya, xOf(kb, n), yb, fan ? 1 : 0, 0);
    }
  }
  edgeStart[count] = edges.length / EDGE_FLOATS;
  const dots: number[] = [];
  const versionCounts = new Int32Array(count);
  body.versions.forEach((list, i) => {
    versionCounts[i] = list.length;
    for (const release of list) {
      const k = index.get(release);
      if (k === undefined) continue;
      const yk = y[i * n + k];
      if (yk === undefined || Number.isNaN(yk)) continue;
      dots.push(xOf(k, n), yk);
    }
  });
  // Within a quarter of the gap between two lines, a run is drawn straight.
  const tolerance = 0.25 / widest;
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  const focusIds = body.family_starts[body.focus_families] ?? count;
  const drawing = { segments: Float32Array.from(segments), segmentStart };
  const lines = {
    all: simplified(drawing, range(0, count), tolerance),
    focal: simplified(drawing, range(0, focusIds), tolerance),
    pulses: simplified(
      drawing,
      pulseIds({ focusIds, familyStarts: body.family_starts, shown: count }, count > 2500 ? 420 : 200),
      tolerance,
    ),
  };
  return {
    releases,
    shown: count,
    genes: body.genes,
    columns,
    widest,
    top: edgeTop,
    y,
    segments: drawing.segments,
    segmentStart,
    edges: Float32Array.from(edges),
    edgeStart,
    dots: Float32Array.from(dots),
    familyOf,
    familyStarts: body.family_starts,
    focusIds,
    eras: eras.length + 1,
    counts: { versions: dots.length / 2, edges: drawnEdges, fans, families: body.family_starts.length },
    ids: body.ids,
    ...flatRuns(body.active),
    versionCounts,
    lines,
  };
}

/** The id under a point of the field (fractions as above), or -1: the nearest release, then the id whose line there
 *  is nearest in height, within a line and a half. */
export function idAt(layout: LineageLayout, x: number, y: number): number {
  const n = layout.releases.length;
  const k = Math.round(Math.min(1, Math.max(0, x)) * (n - 1));
  const column = layout.columns[k];
  if (!column?.length) return -1;
  const at = (j: number) => layout.y[(column[j] ?? 0) * n + k] ?? 0;
  let lo = 0;
  let hi = column.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid) < y) lo = mid + 1;
    else hi = mid;
  }
  const best = [lo - 1, lo]
    .filter((j) => j >= 0 && j < column.length)
    .sort((p, q) => Math.abs(at(p) - y) - Math.abs(at(q) - y))[0];
  if (best === undefined || Math.abs(at(best) - y) > 1.5 / layout.widest + 0.004) return -1;
  return column[best] ?? -1;
}

/** The runs of every id in two typed arrays (sent from a worker without copying thousands of small arrays). */
function flatRuns(active: number[][][]): { runs: Int32Array; runStart: Int32Array } {
  const runStart = new Int32Array(active.length + 1);
  const flat: number[] = [];
  active.forEach((list, i) => {
    runStart[i] = flat.length;
    for (const run of list) flat.push(run[0] ?? 0, run[1] ?? 0);
  });
  runStart[active.length] = flat.length;
  return { runs: Int32Array.from(flat), runStart };
}

/** The runs of one id as `[first, last]` pairs. */
export function runsOf(layout: LineageLayout, id: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = layout.runStart[id] ?? 0; r < (layout.runStart[id + 1] ?? 0); r += 2)
    out.push([layout.runs[r] ?? 0, layout.runs[r + 1] ?? 0]);
  return out;
}
