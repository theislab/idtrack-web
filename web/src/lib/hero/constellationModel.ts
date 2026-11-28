// The constellation's model: the showcase's most convoluted answers (`path` of `GET /organisms/{organism}/showcase`)
// laid out in three dimensions about the axis of time, and the projection that both renderers and the pointer share.
//
// Time runs along x (the graph's first release at -1, its last at +1). Each journey stands on its own strand at its
// angle about the axis. On a strand each stable id (an Ensembl id without its version) keeps one lane, so the versions
// of an id are beads on one thread; ids of other databases (names, transcripts, external accessions) stand outside
// the strand, so a bridge through them arches out and back. An id is drawn as a thread over the releases at which it
// is active and as a star where it begins (where it has no releases of its own, at the release of its steps); a step
// of the path is a curve from one id to the next, in the hue of its kind. The strands draw together toward the ends of
// time and wind gently about the axis, so the whole is one spindle of helical threads; that form, the lanes and the
// angles are layout, never data: every star and every curve is one id and one step of an answer, at its releases.
import type { ConversionResult, PathStep, ShowcaseResponse } from "../../api/types";

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
  /** The axis of time and the rings of its assembly changes. */
  axis: 5,
} as const;

/** A star's role in its journey. */
export const ROLE = { id: 0, query: 1, answer: 2, external: 3 } as const;

export interface ConstellationJourney {
  /** The id asked for. */
  identifier: string;
  /** The answer (its best candidates, joined). */
  answer: string;
  /** Ids (stars) and steps of the path drawn. */
  nodes: number;
  steps: number;
  /** Steps that split or merge, and steps through another database. */
  fans: number;
  bridges: number;
  /** The star of the id asked for (an index into `stars`). */
  anchor: number;
  /** The strand's angle about the axis where the id asked for stands (radians): it faces the viewer when this angle
   *  and the turn add up to -π/2. */
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
  /** The largest distance of anything from the axis in each of the `ENVELOPE` slices of time (for fitting the room). */
  envelope: number[];
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Slices of time of the envelope. */
const ENVELOPE = 16;
const sliceOf = (x: number) => Math.min(ENVELOPE - 1, Math.max(0, Math.floor(((x + 1) / 2) * ENVELOPE)));

/** How far a strand winds about the axis from one end of time to the other (radians): the threads are gentle helices,
 *  so that as the whole turns they seem to flow along time. */
export const TWIST = 1.1;

/** A strand: its angle about the axis at the middle of time, and its reach (a share of the spindle's radius). */
export interface Strand {
  angle: number;
  reach: number;
}

/** The spindle's radius at time x: wide in the middle of time, drawn together toward its ends. */
export function strandRadius(x: number): number {
  return 0.62 * (0.3 + 0.7 * Math.sqrt(Math.max(0, 1 - x * x)));
}

/** The scale of a strand's lanes at time x. */
function laneScale(x: number): number {
  return 0.6 + 0.4 * Math.sqrt(Math.max(0, 1 - x * x));
}

/** A strand's angle about the axis at time x. */
export const angleAt = (strand: Strand, x: number) => strand.angle + TWIST * x;

/** A point of a strand at time x, at lane offset (u outward, v along the circle). */
export function strandPoint(strand: Strand, x: number, u: number, v: number): [number, number, number] {
  const r = strand.reach * strandRadius(x) + laneScale(x) * u;
  const s = laneScale(x) * v;
  const angle = angleAt(strand, x);
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [x, r * c - s * n, r * n + s * c];
}

const versionless = (id: string) => id.replace(/\.\d+$/, "");

/** An Ensembl gene id with or without its version: it keeps the lane of its stable id. */
const onLane = (kind: string) => kind === "ensembl_gene" || kind === "base_ensembl_gene";

function stepKind(s: PathStep): number {
  if (s.kind === "history" || s.kind === "self_loop") {
    if (s.splits > 0 || s.merges > 0) return KIND.fan;
    if (s.assembly !== null && s.old_assembly !== null && s.assembly !== s.old_assembly) return KIND.assembly;
    return KIND.history;
  }
  return KIND.external;
}

/** The size of an answer's path: the ids it passes and its steps. */
function pathSize(r: ConversionResult): number {
  const steps = r.path?.steps ?? [];
  return new Set(steps.flatMap((s) => [s.source, s.target])).size + steps.length;
}

/** The answers of a showcase whose paths pass the most ids and steps, at most `most`, each once. */
export function convolutedAnswers(showcase: ShowcaseResponse, most: number): ConversionResult[] {
  const unique = new Map<string, ConversionResult>();
  for (const item of [...showcase.cases, ...showcase.journeys]) {
    const r = item.result;
    if (r?.path?.steps.length && !unique.has(r.query_id)) unique.set(r.query_id, r);
  }
  return [...unique.values()]
    .map((r) => ({ r, size: pathSize(r) }))
    .sort((a, b) => b.size - a.size || a.r.query_id.localeCompare(b.r.query_id))
    .slice(0, most)
    .map((x) => x.r);
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

/** The journeys laid out: `most` of the showcase's most convoluted answers over the graph's releases `span`. */
export function constellationOf(showcase: ShowcaseResponse, most: number, span: Span): Constellation {
  const answers = convolutedAnswers(showcase, most);
  const { first, last } = span;
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
  answers.forEach((r, j) => {
    // The most convoluted journey faces the viewer first; the others follow round the axis.
    const strand: Strand = {
      angle: -Math.PI / 2 + (j / Math.max(1, answers.length)) * Math.PI * 2,
      reach: 1 - 0.22 * ((j * 0.618034) % 1),
    };
    const places = placesOf(r, first, last);
    const at = (id: string, x: number): [number, number, number] => {
      const p = places.get(id);
      return strandPoint(strand, x, p?.u ?? 0, p?.v ?? 0);
    };
    // Each id: a thread over its releases.
    for (const p of places.values())
      for (const [a, b] of p.runs) {
        if (a === b) continue;
        const xa = xOf(a);
        const xb = xOf(b);
        const n = Math.max(1, Math.ceil(Math.abs(xb - xa) / 0.04));
        for (let i = 0; i < n; i++)
          push(
            strandPoint(strand, xa + ((xb - xa) * i) / n, p.u, p.v),
            strandPoint(strand, xa + ((xb - xa) * (i + 1)) / n, p.u, p.v),
            KIND.run,
            j,
            p.t,
            p.t,
          );
      }
    // Each step: a curve from one id to the next.
    const steps = (r.path?.steps ?? []).filter((s) => s.source !== null && s.source !== s.target);
    let fans = 0;
    let bridges = 0;
    for (const s of steps) {
      const from = places.get(s.source ?? "");
      const to = places.get(s.target);
      if (!from || !to) continue;
      // A new version of the same id continues its thread (its star marks the version); a step to another id is a
      // curve of its own kind.
      const kind = stepKind(s) === KIND.history && from.u === to.u && from.v === to.v ? KIND.run : stepKind(s);
      if (kind === KIND.fan) fans++;
      if (kind === KIND.external) bridges++;
      const xa = xOf(releaseAt(from, s));
      const xb = xOf(releaseAt(to, s));
      curve(strand, kind === KIND.fan, [xa, from.u, from.v], [xb, to.u, to.v], (a, b, f0, f1) => {
        push(a, b, kind, j, from.t + (to.t - from.t) * f0, from.t + (to.t - from.t) * f1);
      });
    }
    // Each id: a star where it begins.
    let anchor = stars.length / STAR;
    for (const [id, p] of places) {
      const x = xOf(p.runs[0]?.[0] ?? p.time);
      if (p.role === ROLE.query) anchor = stars.length / STAR;
      const point = at(id, x);
      reach(point);
      stars.push(...point, j, Math.min(4, Math.max(1, p.degree - 1)), p.t, p.role);
    }
    const best = r.candidates.filter((c) => c.best).map((c) => c.target);
    journeys.push({
      identifier: r.query_id,
      answer: best.join(", "),
      nodes: places.size,
      steps: steps.length,
      fans,
      bridges,
      anchor,
      angle: angleAt(strand, stars[anchor * STAR] ?? 0),
    });
  });
  // The axis of time, and a ring about it at each assembly change.
  const axis: [number, number, number][] = [];
  for (let i = 0; i <= 24; i++) axis.push([-1 + i / 12, 0, 0]);
  for (let i = 0; i < 24; i++) push(axis[i] ?? [0, 0, 0], axis[i + 1] ?? [0, 0, 0], KIND.axis, -1, 0, 0);
  const changes = span.changes.filter((c) => c > first && c <= last);
  for (const c of changes) {
    const x = xOf(c);
    const ring = 0.06;
    for (let i = 0; i < 40; i++) {
      const a0 = (i / 40) * Math.PI * 2;
      const a1 = ((i + 1) / 40) * Math.PI * 2;
      push(
        [x, ring * Math.cos(a0), ring * Math.sin(a0)],
        [x, ring * Math.cos(a1), ring * Math.sin(a1)],
        KIND.axis,
        -1,
        0,
        0,
      );
    }
  }
  return {
    journeys,
    segments: Float32Array.from(segments),
    stars: Float32Array.from(stars),
    first,
    last,
    changes,
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
 *  stand at one release (a bridge through another database), an arch outward from the axis; a fan of a split or merge
 *  flares outward.  */
function curve(
  strand: Strand,
  fan: boolean,
  a: [number, number, number],
  b: [number, number, number],
  emit: (p: [number, number, number], q: [number, number, number], f0: number, f1: number) => void,
) {
  const dx = b[0] - a[0];
  const flat = Math.abs(dx) < 1e-3;
  // A fan of Ensembl's mapping flares out from the strand and back in, the further the lanes apart the higher.
  const apart = Math.hypot(b[1] - a[1], b[2] - a[2]);
  const lift = fan ? 0.06 + 0.9 * apart : flat ? 0.05 + 0.2 * apart : 0;
  const c1: [number, number, number] = [a[0] + dx / 2, a[1] + lift, a[2]];
  const c2: [number, number, number] = [b[0] - dx / 2, b[1] + lift, b[2]];
  const n = 14;
  let previous = strandPoint(strand, a[0], a[1], a[2]);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    const w = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t] as const;
    const p = [0, 1, 2].map((k) => w[0] * (a[k] ?? 0) + w[1] * (c1[k] ?? 0) + w[2] * (c2[k] ?? 0) + w[3] * (b[k] ?? 0));
    const point = strandPoint(strand, p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
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

/** Per id, the releases of the steps that touch it; and the other ids its steps join it to. */
function touchesOf(steps: readonly PathStep[]) {
  const releases = new Map<string, number[]>();
  const neighbours = new Map<string, Set<string>>();
  for (const s of steps) {
    const at = s.release ?? s.old_release ?? s.new_release;
    const ends = [s.source ?? "", s.target];
    if (at !== null) for (const id of ends) releases.set(id, [...(releases.get(id) ?? []), at]);
    if (s.source === null || s.source === s.target) continue;
    neighbours.set(s.source, (neighbours.get(s.source) ?? new Set()).add(s.target));
    neighbours.set(s.target, (neighbours.get(s.target) ?? new Set()).add(s.source));
  }
  return { releases, neighbours };
}

/** Lanes on a strand: one per stable id, in the order asked, on a sunflower about the strand's centre; ids of other
 *  databases each their own, outside the strand, spread along it in three rows. However many there are, the lanes
 *  keep within a fixed reach of the strand (more lanes stand closer together). */
function lanesFor(stableCount: number, outsideCount: number) {
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
    const lane: [number, number] = [rho * Math.cos(k * GOLDEN), rho * Math.sin(k * GOLDEN)];
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
  const { releases, neighbours } = touchesOf(steps);
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

/** How the constellation stands: its turn about the axis of time, its yaw toward the pointer, the roll of the axis
 *  on the screen, the camera's distance (in half lengths of the axis), and where it is drawn (CSS px). */
export interface Pose {
  turn: number;
  yaw: number;
  roll: number;
  distance: number;
  cx: number;
  cy: number;
  scale: number;
}

/** A point of the model on the screen (CSS px), with its depth (negative toward the viewer) and its perspective. */
export function project(pose: Pose, x: number, y: number, z: number): { x: number; y: number; z: number; k: number } {
  const c = Math.cos(pose.turn);
  const s = Math.sin(pose.turn);
  const py = c * y - s * z;
  const pz = s * y + c * z;
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const qx = cy * x + sy * pz;
  const qz = -sy * x + cy * pz;
  const k = pose.distance / (pose.distance + qz);
  const sx = qx * k;
  const sy2 = py * k;
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  return {
    x: pose.cx + (cr * sx - sr * sy2) * pose.scale,
    y: pose.cy - (sr * sx + cr * sy2) * pose.scale,
    z: qz,
    k,
  };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The room the constellation is composed in (CSS px of the hero): beside the words where the window is wide enough,
 *  else under them; always above the caption. `words` is the box of the headline, the sentence and the actions. */
export function roomOf(width: number, height: number, words: Rect | null, caption: Rect | null): Rect {
  const foot = Math.min(height, caption?.top ?? height);
  const side = words ? words.right + Math.max(32, width * 0.04) : width * 0.42;
  const right = width - Math.max(24, width * 0.05);
  if (width >= 720 && right - side >= Math.max(340, width * 0.34))
    return { left: side, top: Math.max(24, height * 0.05), right, bottom: foot - 16 };
  return { left: 16, top: (words?.bottom ?? height * 0.5) + 16, right: width - 16, bottom: foot - 8 };
}

/** The largest turn the pointer may give the constellation about the vertical (yaw) and its extra turn about time. */
export const TILT = { yaw: 0.16, turn: 0.12 } as const;

/** The pose that fits the constellation inside `room` at every turn and at every tilt the pointer may give it, seen
 *  from `view` (the axis's roll on the screen, and its yaw: the last release toward the viewer), with `margin` CSS px
 *  to spare for the stars' light: nothing is ever cut by the room's edge. */
export function fitPose(model: Constellation, room: Rect, margin: number, view: { roll: number; yaw: number }): Pose {
  const distance = 2.6;
  const probe: Pose = { turn: 0, yaw: 0, roll: view.roll, distance, cx: 0, cy: 0, scale: 1 };
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const take = (yaw: number, x: number, y: number, z: number) => {
    const q = project({ ...probe, yaw }, x, y, z);
    box.minX = Math.min(box.minX, q.x);
    box.maxX = Math.max(box.maxX, q.x);
    box.minY = Math.min(box.minY, q.y);
    box.maxY = Math.max(box.maxY, q.y);
  };
  const yaws = [view.yaw - TILT.yaw, view.yaw, view.yaw + TILT.yaw];
  // The extreme points: each slice of time at the largest reach the model has in it, all the way round.
  for (const [i, reach] of model.envelope.entries())
    for (let ai = 0; ai < 48; ai++) {
      const a = (ai / 48) * Math.PI * 2;
      for (const yaw of yaws)
        for (const x of [-1 + (2 * i) / ENVELOPE, -1 + (2 * (i + 1)) / ENVELOPE])
          take(yaw, x, reach * Math.cos(a), reach * Math.sin(a));
    }
  const w = Math.max(1, room.right - room.left - 2 * margin);
  const h = Math.max(1, room.bottom - room.top - 2 * margin);
  const scale = Math.max(1, Math.min(w / (box.maxX - box.minX), h / (box.maxY - box.minY)));
  return {
    turn: 0,
    yaw: view.yaw,
    roll: view.roll,
    distance,
    scale,
    cx: (room.left + room.right) / 2 - ((box.minX + box.maxX) / 2) * scale,
    cy: (room.top + room.bottom) / 2 - ((box.minY + box.maxY) / 2) * scale,
  };
}
