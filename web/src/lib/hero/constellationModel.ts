// The model of the home's third picture: the showcase's most convoluted answers (`path` of
// `GET /organisms/{organism}/showcase`) as a braided cable about a horizontal axis of time, and the projection that
// both renderers and the pointer share.
//
// Time runs along x (the graph's first release at -1, its last at +1). Each journey winds about the axis as its own
// coil, and the coil's form is the journey's data: its radius at a release grows with the number of the path's ids
// active there (a split swells it, a merge draws it in), and it turns about the axis by the steps the path takes at
// each release (a calm journey runs nearly straight, a convoluted one coils). On a coil each stable id (an Ensembl id
// without its version) keeps one lane, so the versions of an id are beads on one thread and the ids after a split
// leave the knot on lanes of their own; ids of other databases (names, transcripts, external accessions) stand outside
// the coil, so a step into another database arches out and back. An id is drawn as a thread over the releases at
// which it is active and as a star where it begins (where it has no releases of its own, at the release of its
// steps); a step of the path is a curve from one id to the next, in the hue of its kind; the id where a path splits or
// merges is a knot. Where each coil starts round the axis, and how far out it lies at most, are layout; everything
// else is the answer's.
import type { ConversionResult, PathStep, ShowcaseResponse } from "../../api/types";
import { byConvolution, journeySteps, journeyStepsText } from "../path/steps";

/** Floats per segment: two ends (x, y, z each), the kind, the journey, the place in the path at each end (0..1). */
export const SEGMENT = 10;
/** Floats per star: x, y, z, the journey, its size, its place in the path (0..1), its role. */
export const STAR = 7;

/** What a segment draws. */
export const KIND = {
  /** An id held over the releases at which it is active. */
  run: 0,
  /** A step of Ensembl's id history from one version or id to another, one to one. */
  history: 1,
  /** A step where Ensembl's mapping splits or merges (a fan out of an id, or into one). */
  fan: 2,
  /** A step between two assemblies. */
  assembly: 3,
  /** A step into or out of another database: an entry, a bridge, the final step to the database asked for. */
  external: 4,
  /** The axis of time. */
  axis: 5,
  /** A ring about the axis where a later assembly begins. */
  change: 6,
} as const;

/** A star's role in its journey. */
export const ROLE = { id: 0, query: 1, answer: 2, external: 3, knot: 4 } as const;

interface ConstellationJourney {
  /** The id asked for. */
  identifier: string;
  /** The answer (its best candidates, joined). */
  answer: string;
  /** The ids drawn (stars). */
  nodes: number;
  /** The journey's steps (lib/path/steps.ts: its best answer's path), counted and in words. */
  steps: number;
  stepsText: string;
  /** Curves drawn where Ensembl's mapping splits or merges, and curves into or through another database. */
  fans: number;
  bridges: number;
  /** The star of the id asked for (an index into `stars`). */
  anchor: number;
  /** The coil's angle about the axis where the id asked for stands (radians): it faces the viewer when this angle and
   *  the turn add up to -π/2. */
  angle: number;
}

export interface Constellation {
  journeys: ConstellationJourney[];
  segments: Float32Array;
  stars: Float32Array;
  first: number;
  last: number;
  /** The first release of each later assembly, drawn as a ring about the axis. */
  changes: number[];
  /** The releases of the axis's ticks: every tenth release. */
  ticks: number[];
  /** The largest distance of anything from the axis in each of the `ENVELOPE` slices of time (for fitting the room,
   *  and for keeping words clear of the cable). */
  envelope: number[];
}

/** Slices of time of the envelope. */
export const ENVELOPE = 24;
const sliceOf = (x: number) => Math.min(ENVELOPE - 1, Math.max(0, Math.floor(((x + 1) / 2) * ENVELOPE)));

/** The farthest a coil lies from the axis, and the scale of its lanes (model units: the axis runs from -1 to 1). */
const REACH = 0.24;
const LANE = 0.32;
/** How far a coil turns about the axis by itself from one end of time to the other, and at most in all (radians). */
const DRIFT = 0.6;
const MOST_TWIST = 3 * Math.PI;

/** A coil: its radius and its angle about the axis at each release (by index), smoothed. */
interface Coil {
  radius: Float32Array;
  angle: Float32Array;
}

/** A value of a per-release array at time x, between releases linearly. */
function at(values: Float32Array, x: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const f = Math.min(n - 1, Math.max(0, ((x + 1) / 2) * (n - 1)));
  const k = Math.floor(f);
  const a = values[k] ?? 0;
  const b = values[Math.min(n - 1, k + 1)] ?? a;
  return a + (b - a) * (f - k);
}

/** A point of a coil at time x, at lane offset (u outward, v along the circle). */
function coilPoint(coil: Coil, x: number, u: number, v: number): [number, number, number] {
  const r = at(coil.radius, x) + LANE * u;
  const s = LANE * v;
  const angle = at(coil.angle, x);
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [x, r * c - s * n, r * n + s * c];
}

/** A running mean over `half` releases each side (a coil swells and turns over a few releases, never at a corner). */
function smooth(values: readonly number[], half: number): Float32Array {
  return Float32Array.from(values, (_, k) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(values.length - 1, k + half); j++) {
      sum += values[j] ?? 0;
      n++;
    }
    return n ? sum / n : 0;
  });
}

const versionless = (id: string) => id.replace(/\.\d+$/, "");

/** An Ensembl gene id with or without its version: it keeps the lane of its stable id. */
const onLane = (kind: string) => kind === "ensembl_gene" || kind === "base_ensembl_gene";

/** Whether a step splits or merges: Ensembl's mapping fans out of its source or into its target. */
const fans = (s: PathStep) => (s.kind === "history" || s.kind === "self_loop") && (s.splits > 0 || s.merges > 0);

function stepKind(s: PathStep): number {
  if (s.kind === "history" || s.kind === "self_loop") {
    if (fans(s)) return KIND.fan;
    if (s.assembly !== null && s.old_assembly !== null && s.assembly !== s.old_assembly) return KIND.assembly;
    return KIND.history;
  }
  return KIND.external;
}

/** The release a step is taken at (its new release, else its own, else its old). */
const stepRelease = (s: PathStep) => s.new_release ?? s.release ?? s.old_release;

/** The answers of a showcase whose paths are the most convoluted (lib/path/steps.ts, `convolution`: the one measure
 *  of every page), at most `most`, each once. */
export function convolutedAnswers(showcase: ShowcaseResponse, most: number): ConversionResult[] {
  const unique = new Map<string, ConversionResult>();
  for (const item of [...showcase.cases, ...showcase.journeys]) {
    const r = item.result;
    if (r?.path?.steps.length && !unique.has(r.query_id)) unique.set(r.query_id, r);
  }
  return byConvolution([...unique.values()], (r) => r).slice(0, most);
}

/** The releases at which an answer's path takes its steps, each once, in order. */
export function stepReleases(r: ConversionResult): number[] {
  const out = new Set<number>();
  for (const s of r.path?.steps ?? []) {
    const release = stepRelease(s);
    if (release !== null && s.source !== null) out.add(release);
  }
  return [...out].sort((a, b) => a - b);
}

/** The gene ids (without their versions) an answer's path passes. */
export function pathGenes(r: ConversionResult): Set<string> {
  return new Set((r.path?.nodes ?? []).filter((n) => onLane(n.kind)).map((n) => versionless(n.id)));
}

interface Span {
  first: number;
  last: number;
  changes: readonly number[];
}

interface Place {
  /** Lane offsets. */
  u: number;
  v: number;
  /** The releases at which the id is active, clipped to the span; empty for an id of another database. */
  runs: [number, number][];
  /** Its time where it has no runs (the mean release of its steps). */
  time: number;
  /** Its place in the path (0 the id asked for, 1 the farthest). */
  t: number;
  degree: number;
  role: number;
}

/** The journeys laid out: `most` of the showcase's most convoluted answers over the graph's releases `span`;
 *  `facing` the journey that faces the viewer first (by its place among them). */
export function constellationOf(showcase: ShowcaseResponse, most: number, span: Span): Constellation {
  const answers = convolutedAnswers(showcase, most);
  const { first, last } = span;
  const n = Math.max(1, last - first + 1);
  const xOf = (release: number) => (last > first ? ((release - first) / (last - first)) * 2 - 1 : 0);
  const segments: number[] = [];
  const stars: number[] = [];
  const journeys: ConstellationJourney[] = [];
  const envelope = new Array<number>(ENVELOPE).fill(0);
  const reach = (p: [number, number, number]) => {
    const i = sliceOf(p[0]);
    envelope[i] = Math.max(envelope[i] ?? 0, Math.hypot(p[1], p[2]));
  };
  const push = (
    a: [number, number, number],
    b: [number, number, number],
    kind: number,
    j: number,
    t0: number,
    t1: number,
  ) => {
    segments.push(...a, ...b, kind, j, t0, t1);
    reach(a);
    reach(b);
  };
  // Each journey's ids held at each release and steps taken at each release.
  const laid = answers.map((r) => {
    const places = placesOf(r, first, last);
    const held = new Array<number>(n).fill(0);
    for (const p of places.values())
      for (const [a, b] of p.runs) for (let k = a - first; k <= b - first; k++) held[k] = (held[k] ?? 0) + 1;
    const taken = new Array<number>(n).fill(0);
    for (const s of r.path?.steps ?? []) {
      const release = stepRelease(s);
      if (release === null || s.source === null || s.source === s.target) continue;
      const k = Math.min(n - 1, Math.max(0, release - first));
      taken[k] = (taken[k] ?? 0) + 1;
    }
    return { r, places, held, taken };
  });
  const mostHeld = Math.max(1, ...laid.flatMap((l) => l.held));
  const mostTaken = Math.max(1, ...laid.map((l) => l.taken.reduce((a, b) => a + b, 0)));
  // A step turns a coil by the same angle in every journey, chosen so that the journey of the most steps turns at
  // most MOST_TWIST.
  const perStep = (MOST_TWIST - DRIFT) / mostTaken;
  laid.forEach(({ r, places, held, taken }, j) => {
    const base = (j / Math.max(1, answers.length)) * Math.PI * 2;
    const share = 0.62 + 0.38 * ((j * 0.618034) % 1);
    let turned = base;
    const angles = taken.map((steps) => (turned += DRIFT / n + perStep * steps));
    const coil: Coil = {
      radius: smooth(
        held.map((h) => REACH * share * (0.35 + (0.65 * Math.log2(1 + h)) / Math.log2(1 + mostHeld))),
        2,
      ),
      angle: smooth(angles, 2),
    };
    const point = (id: string, x: number): [number, number, number] => {
      const p = places.get(id);
      return coilPoint(coil, x, p?.u ?? 0, p?.v ?? 0);
    };
    // Each id: a thread over its releases.
    for (const p of places.values())
      for (const [a, b] of p.runs) {
        if (a === b) continue;
        const xa = xOf(a);
        const xb = xOf(b);
        const pieces = Math.max(1, Math.ceil(Math.abs(xb - xa) / 0.025));
        for (let i = 0; i < pieces; i++)
          push(
            coilPoint(coil, xa + ((xb - xa) * i) / pieces, p.u, p.v),
            coilPoint(coil, xa + ((xb - xa) * (i + 1)) / pieces, p.u, p.v),
            KIND.run,
            j,
            p.t,
            p.t,
          );
      }
    // Each step: a curve from one id to the next.
    const steps = (r.path?.steps ?? []).filter((s) => s.source !== null && s.source !== s.target);
    let fanned = 0;
    let bridges = 0;
    for (const s of steps) {
      const from = places.get(s.source ?? "");
      const to = places.get(s.target);
      if (!from || !to) continue;
      // A new version of the same id continues its thread (its star marks the version); a step to another id is a
      // curve of its own kind.
      const kind = stepKind(s) === KIND.history && from.u === to.u && from.v === to.v ? KIND.run : stepKind(s);
      if (kind === KIND.fan) fanned++;
      if (kind === KIND.external) bridges++;
      const xa = xOf(releaseAt(from, s));
      const xb = xOf(releaseAt(to, s));
      curve(coil, [xa, from.u, from.v], [xb, to.u, to.v], (a, b, f0, f1) => {
        push(a, b, kind, j, from.t + (to.t - from.t) * f0, from.t + (to.t - from.t) * f1);
      });
    }
    // Each id: a star where it begins.
    let anchor = stars.length / STAR;
    for (const [id, p] of places) {
      const x = xOf(p.runs[0]?.[0] ?? p.time);
      if (p.role === ROLE.query) anchor = stars.length / STAR;
      const q = point(id, x);
      reach(q);
      stars.push(...q, j, Math.min(4, Math.max(1, p.degree - 1)), p.t, p.role);
    }
    const best = r.candidates.filter((c) => c.best).map((c) => c.target);
    const ax = stars[anchor * STAR] ?? 0;
    journeys.push({
      identifier: r.query_id,
      answer: best.join(", "),
      nodes: places.size,
      steps: journeySteps(r).length,
      stepsText: journeyStepsText(r),
      fans: fanned,
      bridges,
      anchor,
      angle: at(coil.angle, ax),
    });
  });
  // The axis of time, and a ring about it at each assembly change.
  for (let i = 0; i < 48; i++) push([-1 + i / 24, 0, 0], [-1 + (i + 1) / 24, 0, 0], KIND.axis, -1, 0, 0);
  const changes = span.changes.filter((c) => c > first && c <= last);
  for (const c of changes) {
    const x = xOf(c);
    const ring = 0.035;
    for (let i = 0; i < 40; i++) {
      const a0 = (i / 40) * Math.PI * 2;
      const a1 = ((i + 1) / 40) * Math.PI * 2;
      segments.push(x, ring * Math.cos(a0), ring * Math.sin(a0), x, ring * Math.cos(a1), ring * Math.sin(a1));
      segments.push(KIND.change, -1, 0, 0);
    }
  }
  const ticks: number[] = [];
  for (let r = Math.ceil(first / 10) * 10; r <= last; r += 10) if (r > first && r < last) ticks.push(r);
  return {
    journeys,
    segments: Float32Array.from(segments),
    stars: Float32Array.from(stars),
    first,
    last,
    changes,
    ticks,
    envelope,
  };
}

/** The release at which a step meets an id: of a step of the history, its old or its new release, whichever the id is
 *  active at (else the nearer); of a step through another database, its release, within the id's releases. */
function releaseAt(p: Place, s: PathStep): number {
  if (!p.runs.length) return p.time;
  const within = (r: number) => p.runs.some(([a, b]) => r >= a && r <= b);
  const nearest = (r: number) =>
    p.runs.reduce((best, [a, b]) => {
      const c = Math.min(Math.max(r, a), b);
      return Math.abs(c - r) < Math.abs(best - r) ? c : best;
    }, p.runs[0]?.[0] ?? r);
  if (s.old_release !== null && s.new_release !== null) {
    if (within(s.old_release) && !within(s.new_release)) return s.old_release;
    if (within(s.new_release) && !within(s.old_release)) return s.new_release;
    return nearest(s.old_release);
  }
  return nearest(s.release ?? s.old_release ?? s.new_release ?? p.time);
}

/** A step's curve between two lane points (x, u, v), as segments: an S between lanes along time; where both ends
 *  stand at one release (a step into another database and back), an arch outward from the axis. */
function curve(
  coil: Coil,
  a: [number, number, number],
  b: [number, number, number],
  emit: (p: [number, number, number], q: [number, number, number], f0: number, f1: number) => void,
) {
  const dx = b[0] - a[0];
  const flat = Math.abs(dx) < 1e-3;
  const apart = Math.hypot(b[1] - a[1], b[2] - a[2]);
  const lift = flat ? 0.12 + 0.3 * apart : 0;
  const c1: [number, number, number] = [a[0] + dx / 2, a[1] + lift, a[2]];
  const c2: [number, number, number] = [b[0] - dx / 2, b[1] + lift, b[2]];
  const n = 14;
  let previous = coilPoint(coil, a[0], a[1], a[2]);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    const w = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t] as const;
    const p = [0, 1, 2].map((k) => w[0] * (a[k] ?? 0) + w[1] * (c1[k] ?? 0) + w[2] * (c2[k] ?? 0) + w[3] * (b[k] ?? 0));
    const point = coilPoint(coil, p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    emit(previous, point, (i - 1) / n, t);
    previous = point;
  }
}

/** Each id's distance in steps from `start`, following the path's steps from source to target. */
function depthsOf(start: string, steps: readonly PathStep[]): Map<string, number> {
  const next = new Map<string, string[]>();
  for (const s of steps)
    if (s.source !== null && s.source !== s.target) next.set(s.source, [...(next.get(s.source) ?? []), s.target]);
  const depth = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (const id of queue)
    for (const t of next.get(id) ?? [])
      if (!depth.has(t)) {
        depth.set(t, (depth.get(id) ?? 0) + 1);
        queue.push(t);
      }
  return depth;
}

/** Per id, the releases of the steps that touch it; the other ids its steps join it to; the ids a split leaves or a
 *  merge reaches (the knots). */
function touchesOf(steps: readonly PathStep[]) {
  const releases = new Map<string, number[]>();
  const neighbours = new Map<string, Set<string>>();
  const knots = new Set<string>();
  for (const s of steps) {
    const at = s.release ?? s.old_release ?? s.new_release;
    const ends = [s.source ?? "", s.target];
    if (at !== null) for (const id of ends) releases.set(id, [...(releases.get(id) ?? []), at]);
    if (s.source === null || s.source === s.target) continue;
    neighbours.set(s.source, (neighbours.get(s.source) ?? new Set()).add(s.target));
    neighbours.set(s.target, (neighbours.get(s.target) ?? new Set()).add(s.source));
    if (fans(s)) {
      if (s.splits > 0) knots.add(s.source);
      if (s.merges > 0) knots.add(s.target);
    }
  }
  return { releases, neighbours, knots };
}

/** Lanes on a coil: one per stable id, in the order asked, on a sunflower about the coil's line; ids of other
 *  databases each their own, outside the coil, spread along it in three rows. However many there are, the lanes keep
 *  within a fixed reach of the coil (more lanes stand closer together). */
function lanesFor(stableCount: number, outsideCount: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const stable = new Map<string, [number, number]>();
  const step = Math.min(0.034, 0.17 / Math.sqrt(Math.max(1, stableCount - 1)));
  const along = Math.min(0.03, 0.27 / Math.max(1, outsideCount - 1));
  let outside = 0;
  return (id: string, laned: boolean): [number, number] => {
    if (!laned) {
      const lane: [number, number] = [0.14 + 0.03 * (outside % 3), (outside - (outsideCount - 1) / 2) * along];
      outside++;
      return lane;
    }
    const key = versionless(id);
    const known = stable.get(key);
    if (known) return known;
    const k = stable.size;
    const rho = step * Math.sqrt(k);
    const lane: [number, number] = [rho * Math.cos(k * golden), rho * Math.sin(k * golden)];
    stable.set(key, lane);
    return lane;
  };
}

/** Every id of an answer's path: its lane, its releases, its place in the path, how many steps meet it, its role. */
function placesOf(r: ConversionResult, first: number, last: number): Map<string, Place> {
  const places = new Map<string, Place>();
  const path = r.path;
  if (!path) return places;
  const nodes = new Map(path.nodes.map((n) => [n.id, n]));
  const steps = path.steps.filter((s) => s.source !== null);
  // The ids in the order reached, from the id asked for (the query's node, else the first step's source).
  const start = nodes.has(r.query_id) ? r.query_id : (steps[0]?.source ?? path.nodes[0]?.id ?? r.query_id);
  const depth = depthsOf(start, steps);
  const farthest = Math.max(1, ...depth.values());
  const ids = [...new Set([start, ...steps.flatMap((s) => [s.source ?? "", s.target])].filter((id) => id !== ""))];
  const laned = (id: string) => onLane(nodes.get(id)?.kind ?? "");
  const laneOf = lanesFor(new Set(ids.filter(laned).map(versionless)).size, ids.filter((id) => !laned(id)).length);
  const { releases, neighbours, knots } = touchesOf(steps);
  const best = new Set(r.candidates.filter((c) => c.best).map((c) => c.target));
  for (const id of ids) {
    const onStrand = laned(id);
    const [u, v] = laneOf(id, onStrand);
    const runs: [number, number][] = onStrand
      ? (nodes.get(id)?.active ?? [])
          .map(([a, b]): [number, number] => [Math.max(first, a), Math.min(last, b ?? last)])
          .filter(([a, b]) => a <= b)
      : [];
    const own = releases.get(id) ?? [];
    const time = own.length ? own.reduce((a, b) => a + b, 0) / own.length : (runs[0]?.[0] ?? first);
    let role: number = onStrand ? ROLE.id : ROLE.external;
    if (knots.has(id)) role = ROLE.knot;
    if (best.has(id)) role = ROLE.answer;
    if (id === start) role = ROLE.query;
    places.set(id, {
      u,
      v,
      runs,
      time: Math.min(last, Math.max(first, time)),
      t: (depth.get(id) ?? farthest) / farthest,
      degree: neighbours.get(id)?.size ?? 1,
      role,
    });
  }
  return places;
}

/** How the cable stands: its turn about the axis of time, its yaw toward the pointer, the camera's distance (in half
 *  lengths of the axis), its girth (how far its coils are drawn from the axis, as a share of the model's), and where it
 *  is drawn (CSS px). */
export interface Pose {
  turn: number;
  yaw: number;
  distance: number;
  girth: number;
  cx: number;
  cy: number;
  scale: number;
}

/** A point of the model on the screen (CSS px), with its depth (negative toward the viewer) and its perspective. */
export function project(pose: Pose, x: number, y: number, z: number): { x: number; y: number; z: number; k: number } {
  const c = Math.cos(pose.turn);
  const s = Math.sin(pose.turn);
  const py = (c * y - s * z) * pose.girth;
  const pz = (s * y + c * z) * pose.girth;
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const qx = cy * x + sy * pz;
  const qz = -sy * x + cy * pz;
  const k = pose.distance / (pose.distance + qz);
  return { x: pose.cx + qx * k * pose.scale, y: pose.cy - py * k * pose.scale, z: qz, k };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far the cable keeps from the words and from the hero's sides (CSS px), and its least size. */
const GAP = 48;
/** On a narrow hero (a phone) the cable keeps 6 % of the width from each side instead. */
const gapOf = (width: number) => Math.min(GAP, width * 0.06);
const LEAST = { length: 160, height: 72 } as const;

/** The room the cable is composed in (CSS px of the hero): a band across the hero, its axis horizontal, starting 48 px
 *  right of the words at the band's height (each block of the words its own box: a band below the headline only has
 *  to clear the sentence and the actions) and ending 48 px short of the hero's right edge, always above the caption.
 *  Of the bands that start at the top or under a block of the words, the one where the cable is drawn largest, among
 *  those whose axis spans at least 55 % of the hero's width where one does. Null where none leaves a cable worth
 *  drawing. `words` are the boxes of the words' blocks. */
export function roomOf(width: number, height: number, words: readonly Rect[], caption: Rect | null): Rect | null {
  const foot = Math.min(height, caption?.top ?? height) - 16;
  const right = width - gapOf(width);
  const pad = Math.max(16, height * 0.04);
  const tops = [pad, ...words.map((w) => w.bottom + 24)].filter((t) => t < foot);
  const bands = tops.map((top) => {
    const beside = words.filter((w) => w.bottom + 12 > top && w.top - 12 < foot);
    const left = Math.max(gapOf(width), ...beside.map((w) => w.right + GAP));
    return { left, top, right, bottom: foot };
  });
  const fits = bands.filter((b) => b.right - b.left >= LEAST.length && b.bottom - b.top >= LEAST.height);
  const size = (b: Rect) => (b.right - b.left) * Math.min(b.bottom - b.top, 0.36 * (b.right - b.left));
  const long = fits.filter((b) => b.right - b.left >= 0.55 * width);
  const chosen = (long.length ? long : fits).sort((a, b) => size(b) - size(a))[0];
  return chosen ?? null;
}

/** The largest turn the pointer may give the cable about the vertical (yaw) and its extra turn about time. */
export const TILT = { yaw: 0.1, turn: 0.12 } as const;

/** The pose that fits the cable inside `room` at every turn and at every tilt the pointer may give it, seen from `yaw`
 *  (the last release a little toward the viewer), with `margin` CSS px to spare across (the releases at the axis's
 *  ends) and up and down (the stars' light): nothing is ever cut by the room's edge. The girth fills the room's height
 *  as far as a cable of its length may be thick. */
export function fitPose(model: Constellation, room: Rect, margin: { x: number; y: number }, yaw: number): Pose {
  const distance = 3.2;
  const w = Math.max(1, room.right - room.left - 2 * margin.x);
  const h = Math.max(1, room.bottom - room.top - 2 * margin.y);
  const box = (girth: number) => {
    const probe: Pose = { turn: 0, yaw: 0, distance, girth, cx: 0, cy: 0, scale: 1 };
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const y of [yaw - TILT.yaw, yaw, yaw + TILT.yaw])
      for (const [i, reach] of model.envelope.entries())
        for (let ai = 0; ai < 32; ai++) {
          const a = (ai / 32) * Math.PI * 2;
          for (const x of [-1 + (2 * i) / ENVELOPE, -1 + (2 * (i + 1)) / ENVELOPE]) {
            const q = project({ ...probe, yaw: y }, x, reach * Math.cos(a), reach * Math.sin(a));
            b.minX = Math.min(b.minX, q.x);
            b.maxX = Math.max(b.maxX, q.x);
            b.minY = Math.min(b.minY, q.y);
            b.maxY = Math.max(b.maxY, q.y);
          }
        }
    return b;
  };
  // The girth: the cable as thick as the room lets it be, at most a third of its length (it stays a cable), or three
  // fifths of it in a room taller than wide (a phone), where a thin cable would leave the room empty.
  const flat = box(1);
  const length = flat.maxX - flat.minX;
  const thick = Math.max(1e-6, flat.maxY - flat.minY);
  const most = h > w ? 0.6 : 0.34;
  const girth = Math.max(0.5, Math.min(3.5, ((h / w) * length) / thick, (most * length) / thick));
  const b = box(girth);
  const scale = Math.max(1, Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY)));
  return {
    turn: 0,
    yaw,
    distance,
    girth,
    scale,
    cx: (room.left + room.right) / 2 - ((b.minX + b.maxX) / 2) * scale,
    cy: (room.top + room.bottom) / 2 - ((b.minY + b.maxY) / 2) * scale,
  };
}

/** The cable's extent on the screen at a pose (CSS px): its box over every turn and every tilt the pointer may give
 *  it (the words beside it, its releases at the axis's ends and the pointer's words stand outside it). */
export function bandOf(model: Constellation, pose: Pose): Rect {
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const yaw of [pose.yaw - TILT.yaw, pose.yaw, pose.yaw + TILT.yaw])
    for (const [i, reach] of model.envelope.entries())
      for (let ai = 0; ai < 24; ai++) {
        const a = (ai / 24) * Math.PI * 2;
        for (const x of [-1 + (2 * i) / ENVELOPE, -1 + (2 * (i + 1)) / ENVELOPE]) {
          const q = project({ ...pose, yaw }, x, reach * Math.cos(a), reach * Math.sin(a));
          box.left = Math.min(box.left, q.x);
          box.right = Math.max(box.right, q.x);
          box.top = Math.min(box.top, q.y);
          box.bottom = Math.max(box.bottom, q.y);
        }
      }
  return box;
}
