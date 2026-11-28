// The home's second picture: the releases as rings, an architectural piece in hairlines, sparse and exact. Each
// Ensembl release of the graph is one ring, the first innermost (`GET /organisms/{organism}/history`), its line the
// brighter the more gene ids are active there. Outside a ring, a tick for every `unit` gene ids whose first release it
// is (`created`); inside it, a tick for every `unit` retirements of a gene id on the way into it (`retired`), running
// the other way round. Every ring's ticks stand at one angular pitch, the unit chosen so that the busiest ring's make
// one turn: each ring's new ids fill an arc of its own count, and equal counts are equal angles (a radial chart). A
// count that is not a whole number of units ends in a shorter tick as long as the rest is of a unit, so nothing is
// rounded; every tenth tick is longer, as on a ruler. Between a ring and the one before, a spoke in the event hue for
// each gene version whose history edges fan out to two or more versions or in from two or more (`one_to_many` +
// `many_to_one`, exact). The first ring of each later assembly is drawn in the assembly-change hue. A ring glows softly,
// in the theme's neutral light, by how much Ensembl changed in it (new versions, new ids and retirements over the ids
// active: its churn), and turns at a pace set by the same churn: a calm release barely moves, a churned one turns. A
// neutral light sweeps outward through the releases on a slow cycle. The releases at which the journey this visit
// follows takes a step carry a grain of the history hue on the ray straight up from the centre. The labels of the first ring, each assembly's first ring and
// the last stand on their rings, each appearing as its ring grows in, on the picture's own clock.
//
// One fragment shader draws all of it over the disc's square (WebGL2): every line anti-aliased at device pixels, the
// glow without a blur pass, one draw call a frame. Without WebGL2, or where WebGL draws in software, the same picture
// is drawn once on a 2D canvas (in slices, so that no long task holds the page) and holds still.
import type { HistoryResponse } from "../../api/types";
import {
  devicePixels,
  stillContext,
  hostPicture,
  programsDone,
  startProgram,
  uniformsOf,
  type HeroRoom,
  type Inks,
  type Picture,
  type Rgb,
} from "./canvas";

export interface RingsModel {
  releases: number[];
  /** The assembly each release is served on (its name). */
  assemblies: string[];
  active: number[];
  created: number[];
  retired: number[];
  fans: number[];
  /** New versions, id changes and retirements on the way into a release, over its active gene ids. */
  churn: number[];
  /** Gene ids per tick. */
  unit: number;
  /** The ticks of the busiest ring: they make one turn (the pitch of every ring's ticks is a turn over this). */
  turn: number;
  /** Ring indices at which a later assembly begins. */
  changes: number[];
}

/** The rings of a graph's history; `bands` its assemblies by release (the first band is where the graph begins). */
export function ringsOf(
  history: HistoryResponse,
  bands: readonly { name: string; first: number; last: number }[],
): RingsModel {
  const releases = history.releases.map((r) => r.release);
  const at = new Map(releases.map((r, k) => [r, k]));
  const retired = releases.map(() => 0);
  const fans = releases.map(() => 0);
  const changed = releases.map(() => 0);
  for (const t of history.transitions) {
    const k = at.get(t.to_release);
    if (k === undefined) continue;
    retired[k] = (retired[k] ?? 0) + t.retired;
    fans[k] = (fans[k] ?? 0) + (t.one_to_many ?? 0) + (t.many_to_one ?? 0);
    changed[k] = (changed[k] ?? 0) + t.version_changes + t.id_changes + t.retired;
  }
  const active = history.releases.map((r) => r.genes_active);
  // The first release's ids are where the graph begins, not ids created there.
  const created = history.releases.map((r, k) => (k === 0 ? 0 : r.created));
  const busiest = Math.max(1, ...created, ...retired);
  // About 240 ticks on the busiest ring, at a round number of ids per tick.
  const raw = busiest / 240;
  const unit = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((u) => u >= raw) ?? Math.ceil(raw);
  return {
    releases,
    assemblies: releases.map((r) => bands.find((b) => r >= b.first && r <= b.last)?.name ?? ""),
    active,
    created,
    retired,
    fans,
    churn: releases.map((_, k) => (changed[k] ?? 0) / Math.max(1, active[k] ?? 1)),
    unit,
    turn: Math.max(1, Math.ceil(busiest / unit - 1e-4)),
    changes: bands
      .slice(1)
      .map((b) => at.get(b.first))
      .filter((k): k is number => k !== undefined),
  };
}

/** The number of ticks a count makes at `unit` ids a tick: whole ticks, and the length of a last shorter one (0–1). */
export function ticksOf(count: number, unit: number): { whole: number; rest: number } {
  const whole = Math.floor(count / unit);
  return { whole, rest: (count - whole * unit) / unit };
}

/** The angle (radians) a count's ticks span at the rings' one pitch (`turn` ticks a full turn). */
export function arcOf(count: number, model: Pick<RingsModel, "unit" | "turn">): number {
  return ((Math.PI * 2) / model.turn) * Math.ceil(count / model.unit - 1e-4);
}

// ---------------------------------------------------------------------------------------------------------------------
// Where the disc stands: clear of every word of the hero, inside the content column.

export interface RingsPlace {
  /** A whole disc beside the words; half a disc rising from a horizon at the foot, under them. */
  form: "disc" | "rise";
  cx: number;
  cy: number;
  inner: number;
  outer: number;
  /** Below this line (CSS px from the top) nothing is drawn; null: no horizon. */
  horizon: number | null;
}

/** Room kept beyond the rim for the last ring's label. */
const LABEL_ROOM = 34;
/** The band under a horizon for its labels. */
const HORIZON_BAND = 20;
/** The least outer radius of a disc worth drawing (CSS px). */
const LEAST_RADIUS = 44;

/** The disc's place in the hero's room, clear of the words (with a margin) and above the caption, inside the content
 *  column: the larger of a whole disc beside the words and half a disc rising from a horizon under them, a whole disc
 *  preferred where it is not much smaller. Null where neither leaves a disc worth drawing. */
export function ringsPlace(room: HeroRoom): RingsPlace | null {
  const narrow = room.width < 720;
  const pad = narrow ? 12 : 32;
  const gap = narrow ? 24 : 56;
  const top = pad;
  const bottom = Math.min(room.height, room.captionTop) - (narrow ? 12 : 24);
  const words = room.words;
  const left = words ? words.right + gap : room.left;
  const right = room.right - LABEL_ROOM;
  const tall = bottom - top;
  // A whole disc right of the words.
  const discOuter = Math.max(0, Math.min(right - left, tall) / 2);
  const disc: RingsPlace = {
    form: "disc",
    cx: left + (right - left) / 2,
    cy: top + tall / 2,
    inner: 0,
    outer: discOuter,
    horizon: null,
  };
  // Half a disc rising from a horizon above the caption, under the words.
  const horizon = bottom - HORIZON_BAND;
  const riseOuter = Math.max(
    0,
    Math.min(horizon - (words ? words.bottom : 0) - gap / 2, (room.right - room.left) / 2 - LABEL_ROOM),
  );
  const rise: RingsPlace = {
    form: "rise",
    cx: (room.left + room.right) / 2,
    cy: horizon,
    inner: 0,
    outer: riseOuter,
    horizon,
  };
  const chosen = discOuter >= 0.7 * riseOuter && discOuter >= 90 ? disc : rise;
  if (chosen.outer < LEAST_RADIUS) return null;
  return { ...chosen, inner: chosen.outer * 0.14 };
}

/** The radius of ring `k` of `n`. */
export function radiusOf(place: Pick<RingsPlace, "inner" | "outer">, k: number, n: number): number {
  return place.inner + (n > 1 ? k / (n - 1) : 1) * (place.outer - place.inner);
}

export interface RingLabel {
  k: number;
  release: string;
  name: string;
  x: number;
  y: number;
  /** Where the text stands from its point: after it, or centred under it. */
  align: "after" | "under";
}

/** The labels: the release of the first ring and of the last, then each later assembly's first ring with the
 *  assembly's name, then the first ring's assembly; each on its ring where the ring meets the line through the centre
 *  to the right (on a horizon, under the ring's end). A name that would bring its label within 6 px of another is left
 *  out, and a later assembly's label with it where even its release does not fit (the first and the last are always
 *  given). On a narrow screen, the first and the last only. `charWidth`: a character of the labels' type. */
export function ringLabels(model: RingsModel, place: RingsPlace, narrow: boolean, charWidth = 7): RingLabel[] {
  const n = model.releases.length;
  if (n === 0 || place.outer <= 0) return [];
  const align: RingLabel["align"] = place.horizon === null ? "after" : "under";
  const y = place.horizon === null ? place.cy : place.horizon + HORIZON_BAND / 2;
  const xOf = (k: number) => place.cx + radiusOf(place, k, n);
  const span = (k: number, text: string): [number, number] => {
    const x = xOf(k);
    const w = text.length * charWidth + 4;
    return align === "under" ? [x - w / 2, x + w / 2] : [x + 3, x + 3 + w];
  };
  const out = new Map<number, RingLabel>();
  const spans = new Map<number, [number, number]>();
  const free = (k: number, s: [number, number]) =>
    [...spans].every(([j, [a, b]]) => j === k || s[1] + 6 < a || s[0] > b + 6);
  const put = (k: number, name: string, always: boolean) => {
    const release = String(model.releases[k] ?? "");
    const named = name ? `${release} ${name}` : release;
    const text = free(k, span(k, named)) ? named : always || free(k, span(k, release)) ? release : null;
    if (text === null) return;
    spans.set(k, span(k, text));
    out.set(k, { k, release, name: text === named ? name : "", x: xOf(k), y, align });
  };
  put(0, "", true);
  if (n > 1) put(n - 1, "", true);
  if (!narrow) {
    for (const k of model.changes) if (k > 0 && k < n - 1) put(k, model.assemblies[k] ?? "", false);
    if (model.assemblies[0]) put(0, model.assemblies[0], true);
  }
  return [...out.values()].sort((a, b) => a.k - b.k);
}

/** The ring under a point (CSS px), or -1. */
export function ringAt(place: RingsPlace, n: number, p: { x: number; y: number }): number {
  if (place.horizon !== null && p.y > place.horizon) return -1;
  const d = Math.hypot(p.x - place.cx, p.y - place.cy);
  const spacing = n > 1 ? (place.outer - place.inner) / (n - 1) : 1;
  const f = (d - place.inner) / Math.max(1e-6, spacing);
  if (f < -0.6 || f > n - 0.4) return -1;
  return Math.max(0, Math.min(n - 1, Math.round(f)));
}

// ---------------------------------------------------------------------------------------------------------------------
// The renderer.

/** Seconds the rings take to grow from the first release to the last, once. */
const GROW_SECONDS = 2.8;
/** The ease of the growth. */
const GROW_EASE = 0.85;
/** The sweep of light: every `SWEEP_PERIOD` seconds it crosses every ring in `SWEEP_SECONDS`, from the first. */
const SWEEP_PERIOD = 24;
const SWEEP_SECONDS = 9;
const SWEEP_FIRST = GROW_SECONDS + 3;
/** The pace of a ring (radians a second): the calmest, and how much more the most churned turns. */
const PACE_CALM = 0.002;
const PACE_CHURN = 0.03;
/** The golden angle: each ring's ticks start a little further round than the ring inside it. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** The rings grown in at `seconds` (a fraction of rings: ring `k` is drawn once this passes it, fading in over three). */
function growAt(seconds: number, n: number): number {
  return -3 + (n + 7) * Math.min(1, seconds / GROW_SECONDS) ** GROW_EASE;
}

/** How far ring `k` has grown in (0 not yet, 1 drawn) at `grow`, as the shader draws it (its label with it). */
function grownOf(grow: number, k: number): number {
  return Math.max(0, Math.min(1, (grow - k) / 3));
}

function paceOf(model: RingsModel): { pace: number[]; churn: number[] } {
  const most = Math.max(1e-6, ...model.churn);
  const churn = model.churn.map((c) => Math.sqrt(c / most));
  return { pace: churn.map((c) => PACE_CALM + PACE_CHURN * c), churn };
}

/** Where the sweep of light is at `seconds` (in rings), or far away between sweeps. */
function sweepAt(seconds: number, n: number): number {
  const t = seconds - SWEEP_FIRST;
  if (t < 0) return -1000;
  const into = t % SWEEP_PERIOD;
  if (into > SWEEP_SECONDS) return -1000;
  const x = into / SWEEP_SECONDS;
  const eased = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  return -6 + eased * (n + 12);
}

const VERTEX = `#version 300 es
precision highp float;
uniform vec4 u_rect; // the square drawn, device px: left, top, right, bottom
uniform vec2 u_res;
void main() {
  vec2 corner = vec2(gl_VertexID == 1 || gl_VertexID == 3 ? 1.0 : 0.0, gl_VertexID >= 2 ? 1.0 : 0.0);
  vec2 p = mix(u_rect.xy, u_rect.zw, corner);
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec2 u_centre;    // device px from the top left
uniform float u_inner;
uniform float u_spacing;  // between two rings, device px
uniform int u_n;
uniform float u_dpr;
uniform float u_time;     // seconds the rings have turned
uniform float u_grow;     // rings drawn up to this one (fading in)
uniform float u_sweep;    // the ring the light passes, or far away
uniform float u_focus;    // the ring under the pointer, or -1
uniform vec2 u_pointer;   // device px, or far away
uniform float u_horizon;  // device px from the top; nothing below it
uniform float u_tick;     // a tick's length, device px
uniform float u_pitch;    // the angle between two ticks
uniform float u_dark;
uniform vec3 u_ink;
uniform vec3 u_light;     // the neutral light of the glow and the sweep
uniform vec3 u_history;
uniform vec3 u_event;
uniform vec3 u_handoff;
uniform highp sampler2D u_data; // per ring: (weight, created ticks, retired ticks, fans), (churn, phase, pace, flags)
out vec4 colour;

const float TAU = 6.28318530718;

vec4 acc;
void over(vec3 rgb, float a) {
  a = clamp(a, 0.0, 1.0);
  acc.rgb += rgb * a * (1.0 - acc.a);
  acc.a += a * (1.0 - acc.a);
}

// The coverage of a run of \`count\` ticks at the one pitch from angle 0 onward (\`angle\` the pixel's angle from the
// run's start, 0 to TAU), the last tick as long as the rest of the count; \`along\` is how far the pixel is from the
// ring toward the ticks' side (device px), \`d\` its radius.
float ticks(float count, float along, float angle, float d, float len) {
  if (count <= 0.0 || along < -0.5) return 0.0;
  float m = ceil(count - 1e-4);
  float i = floor(angle / u_pitch + 0.5);
  float turn = TAU / u_pitch;
  if (i > turn - 0.5) i -= turn;
  if (i < 0.0 || i > m - 0.5) return 0.0;
  float arc = abs(angle - i * u_pitch) * d;
  arc = min(arc, abs(angle - TAU - i * u_pitch) * d);
  float rest = count - floor(count - 1e-4);
  float l = len * (mod(i, 10.0) < 0.5 ? 1.75 : 1.0) * (i > m - 1.5 ? rest : 1.0);
  float radial = clamp(along + 0.5, 0.0, 1.0) * clamp(l - along + 0.5, 0.0, 1.0);
  return radial * clamp(1.05 - arc, 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 q = p - u_centre;
  float d = length(q);
  float theta = atan(q.y, q.x);
  acc = vec4(0.0);
  float f = (d - u_inner) / u_spacing;
  int k0 = int(floor(f + 0.5));
  float shown = clamp(u_horizon - p.y + 0.5, 0.0, 1.0);
  float spot = exp(-dot(p - u_pointer, p - u_pointer) / pow(150.0 * u_dpr, 2.0));
  for (int j = -4; j <= 4; j++) {
    int k = k0 + j;
    if (k < 0 || k >= u_n) continue;
    float fk = float(k);
    float grown = clamp((u_grow - fk) / 3.0, 0.0, 1.0);
    if (grown <= 0.0) continue;
    vec4 a = texelFetch(u_data, ivec2(k, 0), 0);
    vec4 b = texelFetch(u_data, ivec2(k, 1), 0);
    float r = u_inner + fk * u_spacing;
    float dr = d - r;
    float change = mod(b.w, 2.0);
    float journey = step(1.5, b.w);
    float swept = exp(-pow((fk - u_sweep) / 2.6, 2.0));
    float focused = abs(fk - u_focus) < 0.5 ? 1.0 : 0.0;
    float lift = 1.0 + (u_dark > 0.5 ? 1.3 : 0.7) * swept + 0.5 * spot;
    float angle = mod(theta - b.y - b.z * u_time, TAU);
    // Front to back (each mark goes under those before it): the journey's grain (on the ray straight up), ticks and
    // spokes, the ring, its glow.
    if (journey > 0.5) {
      vec2 at = u_centre + vec2(0.0, -r);
      float g = exp(-dot(p - at, p - at) / pow(2.2 * u_dpr, 2.0));
      over(u_history, 0.95 * g * grown);
    }
    // Ticks: the ids new at this release outward, the retirements on the way into it inward, the other way round.
    float created = ticks(a.y, dr, angle, d, u_tick);
    float retired = ticks(a.z, -dr, mod(TAU - angle, TAU), d, u_tick * 0.85);
    float tickLift = 1.0 + (u_dark > 0.5 ? 0.9 : 0.5) * swept + 0.9 * focused + 0.4 * spot;
    over(u_history, (u_dark > 0.5 ? 0.62 : 0.6) * tickLift * created * grown);
    over(u_ink, (u_dark > 0.5 ? 0.3 : 0.34) * tickLift * retired * grown);
    // Spokes between this ring and the one inside it: the fans of Ensembl's mapping on the way into this release.
    if (a.w > 0.0 && k > 0) {
      float stepF = TAU / a.w;
      float sa = mod(angle + 1.7 * b.y + 0.37, TAU);
      float i = floor(sa / stepF + 0.5);
      float arc = abs(sa - i * stepF) * d;
      float within = clamp(-dr + 0.5, 0.0, 1.0) * clamp(u_spacing + dr + 0.5, 0.0, 1.0);
      float spoke = clamp(1.0 - arc, 0.0, 1.0) * within;
      // Where spokes lie closer than a few pixels they merge into a band: fainter, so a dense fan is a glow, not a slab.
      float apart = clamp(stepF * d / (5.0 * u_dpr), 0.16, 1.0);
      over(u_event, (u_dark > 0.5 ? 0.6 : 0.5) * apart * tickLift * spoke * grown);
    }
    // The ring: a hairline at device pixels, a little heavier with more gene ids; an assembly's first ring a pair of
    // hairlines in the assembly-change hue.
    float w = mix(0.8, 1.1, a.x) + 0.5 * focused;
    float ringLine = change > 0.5
      ? max(clamp(0.5 * w + 0.5 - abs(dr - 1.25 * u_dpr), 0.0, 1.0), clamp(0.5 * w + 0.5 - abs(dr + 1.25 * u_dpr), 0.0, 1.0))
      : clamp(0.5 * w + 0.5 - abs(dr), 0.0, 1.0);
    float ringA = change > 0.5 ? (u_dark > 0.5 ? 0.55 : 0.5) : (u_dark > 0.5 ? 0.1 + 0.3 * a.x : 0.08 + 0.27 * a.x);
    ringA = mix(ringA, 0.9, focused);
    // The light passing lightens a ring toward the neutral light.
    vec3 ringHue = change > 0.5 ? u_handoff : mix(u_ink, u_light, 0.45 * swept);
    over(ringHue, ringA * lift * ringLine * grown);
    // The glow of a churned ring, in the neutral light: soft and only where Ensembl changed much.
    float halo = exp(-pow(dr / (1.6 * u_spacing + 2.0 * u_dpr), 2.0));
    float glow = (u_dark > 0.5 ? 0.2 : 0.08) * b.x * b.x * b.x * b.x;
    over(u_light, glow * halo * grown);
    // The light passing through the releases, and the ring under the pointer, each a soft light of its own.
    over(u_light, (u_dark > 0.5 ? 0.07 : 0.035) * swept * halo * grown);
    over(u_ink, (u_dark > 0.5 ? 0.09 : 0.05) * focused * halo * grown);
  }
  // The air of the disc: a faint light about its centre, under everything.
  float rim = u_inner + u_spacing * float(u_n - 1);
  float air = exp(-pow(d / (u_inner + 0.9 * u_spacing * float(u_n)), 2.0) * 1.6) * smoothstep(rim + 3.0 * u_spacing, rim - 6.0 * u_spacing, d) * clamp((u_grow - f) / 6.0, 0.0, 1.0);
  over(u_light, (u_dark > 0.5 ? 0.06 : 0.018) * air * clamp(u_grow / float(u_n), 0.0, 1.0));
  colour = acc * shown;
}`;

/** What the rings are placed by: the disc's place and the labels on it. */
export interface RingsLayout {
  place: RingsPlace;
  labels: RingLabel[];
}

export type RingsView = Picture<RingsLayout>;

/** The length of a tick (CSS px) for rings `spacing` apart. */
function tickOf(spacing: number): number {
  return Math.max(3.5, Math.min(9, 1.45 * spacing));
}

/** Each ring's values as two rows of texels: (weight, created ticks, retired ticks, fans) and (churn, phase, pace,
 *  flags: 1 an assembly's first ring, 2 a release of the journey this visit follows). */
function texelsOf(model: RingsModel, journey: ReadonlySet<number>, still: boolean): Float32Array {
  const n = model.releases.length;
  const { pace, churn } = paceOf(model);
  const top = Math.max(1, ...model.active);
  const data = new Float32Array(n * 8);
  for (let k = 0; k < n; k++) {
    const flags = (model.changes.includes(k) ? 1 : 0) + (journey.has(model.releases[k] ?? -1) ? 2 : 0);
    data.set(
      [
        (model.active[k] ?? 0) / top,
        (model.created[k] ?? 0) / model.unit,
        (model.retired[k] ?? 0) / model.unit,
        k > 0 ? (model.fans[k] ?? 0) : 0,
      ],
      k * 4,
    );
    data.set([churn[k] ?? 0, k * GOLDEN, still ? 0 : (pace[k] ?? 0), flags], (n + k) * 4);
  }
  return data;
}

const LIGHT_INKS: Inks = {
  ink: [0.05, 0.07, 0.09],
  paper: [0.98, 0.98, 0.97],
  history: [0.18, 0.37, 0.82],
  event: [0.76, 0.29, 0],
  handoff: [0.75, 0.22, 0.6],
  external: [0, 0.5, 0.36],
  dark: false,
};

/** The rings' ink (the theme's; a cool silver in the dark) and their neutral light (ink in the light theme, silver in
 *  the dark): the glow of churn and the sweep, which are no data hue. */
const inkOf = (inks: Inks): Rgb => (inks.dark ? [0.84, 0.88, 0.95] : inks.ink);
const lightOf = (inks: Inks): Rgb => (inks.dark ? [0.86, 0.9, 0.98] : inks.ink);

/** The labels of the rings, on the picture's own clock: each appears as its ring grows in. */
function createLabels(layer: HTMLElement) {
  const box = document.createElement("div");
  box.className = "hero2__ring-labels";
  layer.append(box);
  let spans: { k: number; span: HTMLSpanElement }[] = [];
  return {
    set(labels: readonly RingLabel[]) {
      box.replaceChildren();
      spans = labels.map((l) => {
        const span = document.createElement("span");
        span.className = `hero2__ring-label hero2__ring-label--${l.align}`;
        span.style.left = `${l.x.toFixed(1)}px`;
        span.style.top = `${l.y.toFixed(1)}px`;
        const release = document.createElement("span");
        release.className = "mono";
        release.textContent = l.release;
        span.append(release);
        if (l.name) {
          const name = document.createElement("span");
          name.className = "hero2__ring-name";
          name.textContent = l.name;
          span.append(name);
        }
        box.append(span);
        return { k: l.k, span };
      });
    },
    show(grow: number) {
      for (const { k, span } of spans) span.style.opacity = grownOf(grow, k).toFixed(3);
    },
    remove() {
      box.remove();
    },
  };
}

/** The renderer. `layer` holds the labels; `journey` the releases of the journey this visit follows; `stepped` the
 *  development switch (the moving path in software too, drawing only the moments asked for). */
export function createRings(
  canvas: HTMLCanvasElement,
  layer: HTMLElement,
  model: RingsModel,
  options: { reduced: boolean; journey: readonly number[]; stepped: boolean; changed?: () => void },
): RingsView {
  const journey = new Set(options.journey);
  const labels = createLabels(layer);
  const host = hostPicture<RingsLayout>(
    canvas,
    {
      attributes: {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        powerPreference: "low-power",
        preserveDrawingBuffer: options.stepped,
      },
      start(gl) {
        const program = startProgram(gl, VERTEX, FRAGMENT);
        return {
          done: () => programsDone(gl, [program]),
          build: () =>
            createWebgl(gl, program, model, { journey, labels, reduced: options.reduced, stepped: options.stepped }),
        };
      },
    },
    (target) => createStill(target, model, journey, labels),
    options.stepped,
    options.changed,
  );
  return {
    ...host,
    get mode() {
      return host.mode;
    },
    get element() {
      return host.element;
    },
    get moving() {
      return host.moving;
    },
    destroy() {
      host.destroy();
      labels.remove();
    },
  };
}

type Labels = ReturnType<typeof createLabels>;

function createWebgl(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  model: RingsModel,
  {
    journey,
    labels,
    reduced,
    stepped,
  }: { journey: ReadonlySet<number>; labels: Labels; reduced: boolean; stepped: boolean },
): RingsView {
  const n = model.releases.length;
  let dpr = 1;
  let width = 1;
  let height = 1;
  let place: RingsPlace = { form: "disc", cx: 0, cy: 0, inner: 10, outer: 100, horizon: null };
  let inks = LIGHT_INKS;
  let focus = -1;
  let pointer: { x: number; y: number } | null = null;
  let running = false;
  let raf = 0;
  let start = -1;
  let last = 0;
  let drawnAt = 0;
  let ended = false;
  const times = { frames: 0, frameMs: 0, drawMs: 0 };
  /** The moment shown when time is stepped by hand (the development switch), else null: the clock's. */
  let forced: number | null = stepped ? 0 : null;
  let area = 0;
  const vao = gl.createVertexArray();
  const texture = gl.createTexture();
  const u = uniformsOf(gl, program);
  const upload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 2, 0, gl.RGBA, gl.FLOAT, texelsOf(model, journey, reduced));
  };
  upload();

  function draw(now: number) {
    if (ended) return;
    const t0 = performance.now();
    if (start < 0) start = now;
    const seconds = forced ?? (now - start) / 1000;
    const calm = reduced && forced === null;
    const grow = calm ? n + 4 : growAt(seconds, n);
    const spacing = n > 1 ? (place.outer - place.inner) / (n - 1) : place.outer;
    const reach = place.outer + 2 * tickOf(spacing) + 3 * spacing + 4;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform2f(u("u_res"), width, height);
    const bottom = place.horizon === null ? place.cy + reach : Math.min(place.cy + reach, place.horizon + 1);
    const rect = [
      Math.max(0, place.cx - reach) * dpr,
      Math.max(0, place.cy - reach) * dpr,
      Math.min(width / dpr, place.cx + reach) * dpr,
      Math.min(height / dpr, bottom) * dpr,
    ] as const;
    gl.uniform4f(u("u_rect"), ...rect);
    area = Math.round(Math.max(0, rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1]));
    gl.uniform2f(u("u_centre"), place.cx * dpr, place.cy * dpr);
    gl.uniform1f(u("u_inner"), place.inner * dpr);
    gl.uniform1f(u("u_spacing"), spacing * dpr);
    gl.uniform1i(u("u_n"), n);
    gl.uniform1f(u("u_dpr"), dpr);
    gl.uniform1f(u("u_time"), calm ? 0 : seconds);
    gl.uniform1f(u("u_grow"), grow);
    gl.uniform1f(u("u_sweep"), calm ? -1000 : sweepAt(seconds, n));
    gl.uniform1f(u("u_focus"), focus);
    gl.uniform2f(u("u_pointer"), pointer ? pointer.x * dpr : -1e5, pointer ? pointer.y * dpr : -1e5);
    gl.uniform1f(u("u_horizon"), place.horizon === null ? 1e9 : place.horizon * dpr);
    gl.uniform1f(u("u_tick"), tickOf(spacing) * dpr);
    gl.uniform1f(u("u_pitch"), (Math.PI * 2) / model.turn);
    gl.uniform1f(u("u_dark"), inks.dark ? 1 : 0);
    gl.uniform3f(u("u_ink"), ...inkOf(inks));
    gl.uniform3f(u("u_light"), ...lightOf(inks));
    gl.uniform3f(u("u_history"), ...inks.history);
    gl.uniform3f(u("u_event"), ...inks.event);
    gl.uniform3f(u("u_handoff"), ...inks.handoff);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u("u_data"), 0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    labels.show(grow);
    times.drawMs += performance.now() - t0;
    if (last) times.frameMs += now - last;
    last = now;
    drawnAt = now;
    times.frames++;
  }
  // The rings move slowly: a frame every 32 ms is smooth for them and halves the work of a display at 60 Hz; a frame
  // asked for (a resize, a theme, the pointer) is drawn at the next one.
  let asked = false;
  const loop = (now: number) => {
    raf = 0;
    if (asked || now - drawnAt >= 31) draw(now);
    asked = false;
    if (running && !reduced && forced === null) raf = requestAnimationFrame(loop);
  };
  const request = () => {
    if (ended) return;
    if (forced !== null) {
      draw(performance.now());
      return;
    }
    asked = true;
    if (!raf) raf = requestAnimationFrame(loop);
  };

  return {
    mode: "webgl2",
    element: gl.canvas as HTMLCanvasElement,
    moving: !reduced,
    resize(w, h, laid) {
      const size = devicePixels(w, h);
      dpr = size.dpr;
      width = size.width;
      height = size.height;
      const canvas = gl.canvas as HTMLCanvasElement;
      canvas.width = width;
      canvas.height = height;
      place = laid.place;
      labels.set(laid.labels);
      labels.show(reduced ? n + 4 : forced === null && start < 0 ? -3 : growAt(forced ?? 0, n));
      request();
    },
    setColours(c) {
      inks = c;
      request();
    },
    setPointer(p) {
      const k = p ? ringAt(place, n, p) : -1;
      if (reduced) return k;
      pointer = p;
      if (k !== focus || p) {
        focus = k;
        request();
      }
      return k;
    },
    setRunning(on) {
      running = on;
      if (on) request();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      }
    },
    stats: () => ({
      frames: times.frames,
      meanFrameMs: times.frames > 1 ? times.frameMs / (times.frames - 1) : 0,
      meanDrawMs: times.frames ? times.drawMs / times.frames : 0,
    }),
    work: () => ({ drawCalls: 1, vertices: 4, fragments: area, texture: { width: n, height: 2, bytes: n * 2 * 16 } }),
    drawAt(seconds) {
      forced = seconds;
      draw(performance.now());
    },
    destroy() {
      ended = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/** The same rings drawn once on a 2D canvas, in slices of a few milliseconds one a frame (they hold still; the
 *  pointer only names its ring). */
function createStill(
  canvas: HTMLCanvasElement,
  model: RingsModel,
  journey: ReadonlySet<number>,
  labels: Labels,
): RingsView {
  const n = model.releases.length;
  const { churn } = paceOf(model);
  let size = { w: 1, h: 1 };
  let place: RingsPlace = { form: "disc", cx: 0, cy: 0, inner: 10, outer: 100, horizon: null };
  let inks = LIGHT_INKS;
  let job = 0;
  let painted = 0;
  const context = stillContext(canvas);
  const paint = () => {
    if (!context) return;
    if (job) cancelAnimationFrame(job);
    const { dpr, width, height } = devicePixels(size.w, size.h);
    canvas.width = width;
    canvas.height = height;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.w, size.h);
    const css = (rgb: Rgb, a: number) =>
      `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")} / ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
    const top = Math.max(1, ...model.active);
    const spacing = n > 1 ? (place.outer - place.inner) / (n - 1) : place.outer;
    const tick = tickOf(spacing);
    const hair = 1 / dpr;
    const pitch = (Math.PI * 2) / model.turn;
    const ink = inkOf(inks);
    const spoke = (r0: number, r1: number, a: number) => {
      context.moveTo(place.cx + r0 * Math.cos(a), place.cy + r0 * Math.sin(a));
      context.lineTo(place.cx + r1 * Math.cos(a), place.cy + r1 * Math.sin(a));
    };
    const tickRun = (count: number, r: number, outward: number, length: number, from: number, way: number) => {
      const { whole, rest } = ticksOf(count, model.unit);
      const m = whole + (rest > 0 ? 1 : 0);
      context.beginPath();
      for (let i = 0; i < m; i++) {
        const l = length * (i % 10 === 0 ? 1.75 : 1) * (i === m - 1 && rest > 0 ? rest : 1);
        spoke(r, r + outward * l, from + way * i * pitch);
      }
      context.stroke();
    };
    const ring = (k: number) => {
      const r = radiusOf(place, k, n);
      const weight = (model.active[k] ?? 0) / top;
      const change = model.changes.includes(k);
      const c = churn[k] ?? 0;
      // The glow, then the ring, then its ticks and spokes.
      if (c * c > 0.02) {
        context.strokeStyle = css(lightOf(inks), (inks.dark ? 0.08 : 0.04) * c * c);
        context.lineWidth = 2.5 * spacing;
        context.beginPath();
        context.arc(place.cx, place.cy, r, 0, Math.PI * 2);
        context.stroke();
      }
      context.lineWidth = change ? 1.35 * hair : hair;
      context.strokeStyle = change
        ? css(inks.handoff, 0.85)
        : css(ink, inks.dark ? 0.15 + 0.4 * weight : 0.12 + 0.36 * weight);
      context.beginPath();
      context.arc(place.cx, place.cy, r, 0, Math.PI * 2);
      context.stroke();
      context.lineWidth = hair;
      const first = k * GOLDEN;
      context.strokeStyle = css(inks.history, 0.72);
      tickRun(model.created[k] ?? 0, r, 1, tick, first, 1);
      context.strokeStyle = css(ink, 0.44);
      tickRun(model.retired[k] ?? 0, r, -1, tick * 0.85, first, -1);
      const fans = k > 0 ? (model.fans[k] ?? 0) : 0;
      if (fans > 0) {
        const apart = Math.max(0.22, Math.min(1, (((Math.PI * 2) / fans) * r) / 4));
        context.strokeStyle = css(inks.event, 0.75 * apart);
        context.beginPath();
        for (let i = 0; i < fans; i++) spoke(r - spacing, r, first - 1.7 * first - 0.37 + (i / fans) * Math.PI * 2);
        context.stroke();
      }
      if (journey.has(model.releases[k] ?? -1)) {
        context.fillStyle = css(inks.history, 0.95);
        context.beginPath();
        context.arc(place.cx, place.cy - r, 2.2, 0, Math.PI * 2);
        context.fill();
      }
    };
    let k = 0;
    const step = () => {
      job = 0;
      const began = performance.now();
      context.save();
      if (place.horizon !== null) {
        context.beginPath();
        context.rect(0, 0, size.w, place.horizon);
        context.clip();
      }
      while (k < n && performance.now() - began < 6) ring(k++);
      context.restore();
      if (k < n) job = requestAnimationFrame(step);
      else painted++;
    };
    job = requestAnimationFrame(step);
  };
  return {
    mode: "canvas2d",
    element: canvas,
    moving: false,
    resize(w, h, laid) {
      size = { w, h };
      place = laid.place;
      labels.set(laid.labels);
      labels.show(n + 4);
      paint();
    },
    setColours(c) {
      inks = c;
      paint();
    },
    setPointer: (p) => (p ? ringAt(place, n, p) : -1),
    setRunning: () => undefined,
    stats: () => ({ frames: painted, meanFrameMs: 0, meanDrawMs: 0 }),
    work: () => null,
    drawAt: () => undefined,
    destroy() {
      if (job) cancelAnimationFrame(job);
    },
  };
}
