// The home's second picture: the releases as rings, an architectural piece in hairlines. Each Ensembl release of the
// graph is one ring, the first innermost (`GET /organisms/{organism}/history`), its line the brighter the more gene ids
// are active there. Outside a ring, a tick for every `unit` gene ids whose first release it is (`created`); inside it,
// a tick for every `unit` retirements of a gene id on the way into it (`retired`); a count that is not a whole number
// of units ends in a shorter tick, as long as the rest is of a unit, so nothing is rounded; every tenth tick is longer,
// as on a ruler. Between a ring and the one before, a spoke in the event hue for each gene version whose history edges
// fan out to two or more versions or in from two or more (`one_to_many` + `many_to_one`, exact). The first ring of each
// later assembly is drawn in the assembly-change hue. A ring glows softly by how much Ensembl changed in it (new
// versions, new ids and retirements over the ids active: its churn), and turns at a pace set by the same churn: a calm
// release barely moves, a churned one turns. Light sweeps outward through the releases on a slow cycle. A slot cut
// through the rings (they are circles, so the cut does not turn) holds the labels of the first ring, each assembly's
// first ring and the last; where the disc rises from the bottom edge, its horizon is the slot.
//
// One fragment shader draws all of it over the disc's square (WebGL2): every line anti-aliased at device pixels, the
// glow without a blur pass, one draw call a frame. Without WebGL2, the same picture is drawn once on a 2D canvas; in
// software WebGL and under reduced motion it is drawn once and holds still.
import type { HistoryResponse } from "../../api/types";
import { drawsInSoftware } from "./field";

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

// ---------------------------------------------------------------------------------------------------------------------
// Where the disc stands: clear of every word of the hero.

export interface RingsPlace {
  /** A whole disc beside the words; half a disc from the right edge; half a disc rising from a horizon at the foot. */
  form: "disc" | "side" | "rise";
  cx: number;
  cy: number;
  inner: number;
  outer: number;
  /** The slot of the labels: to the right (1), to the left (-1), or none (0: the horizon holds them). */
  slot: -1 | 0 | 1;
  /** Below this line (CSS px from the top) nothing is drawn; null: no horizon. */
  horizon: number | null;
}

/** Room kept beyond the rim for the slot's last label. */
const LABEL_ROOM = 34;
/** The band under a horizon for its labels. */
const HORIZON_BAND = 20;

/** The disc's place in a hero of `width` × `height` (CSS px), clear of the words (`words`, the box of their text, or
 *  null) and above `captionTop`. The largest of three compositions, a whole disc preferred where it is not much
 *  smaller than a half one. */
export function ringsPlace(
  width: number,
  height: number,
  words: { right: number; bottom: number } | null,
  captionTop: number,
): RingsPlace {
  const narrow = width < 720;
  const pad = narrow ? 16 : 32;
  const gap = narrow ? 28 : 56;
  const top = pad;
  const bottom = Math.min(height, captionTop) - (narrow ? 12 : 24);
  const left = (words ? words.right : 0) + gap;
  const tall = bottom - top;
  // A whole disc right of the words, its slot to the right.
  const discOuter = Math.max(0, Math.min(width - pad - LABEL_ROOM - left, tall) / 2);
  const disc: RingsPlace = {
    form: "disc",
    cx: left + (width - pad - LABEL_ROOM - left) / 2,
    cy: top + tall / 2,
    inner: 0,
    outer: discOuter,
    slot: 1,
    horizon: null,
  };
  // Half a disc from the right edge, its slot to the left.
  const sideOuter = Math.max(0, Math.min(width - left - LABEL_ROOM, tall / 2));
  const side: RingsPlace = {
    form: "side",
    cx: width,
    cy: top + tall / 2,
    inner: 0,
    outer: sideOuter,
    slot: -1,
    horizon: null,
  };
  // Half a disc rising from a horizon above the caption, under the words.
  const horizon = bottom - HORIZON_BAND;
  const riseOuter = Math.max(0, Math.min(horizon - (words ? words.bottom : 0) - gap, width / 2 - pad));
  const rise: RingsPlace = { form: "rise", cx: width / 2, cy: horizon, inner: 0, outer: riseOuter, slot: 0, horizon };
  const half = sideOuter >= riseOuter ? side : rise;
  const chosen = discOuter >= 0.7 * half.outer && discOuter >= 90 ? disc : half;
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
  /** Where the text stands from its point: after it, before it, or centred under it. */
  align: "after" | "before" | "under";
}

/** The labels of the slot: the release of the first ring and of the last, then each later assembly's first ring with
 *  the assembly's name, then the first ring's assembly; a name that would bring its label within 6 px of another is
 *  left out, and a later assembly's label with it where even its release does not fit (the first and the last are
 *  always given). On a narrow screen, the first and the last only. `charWidth`: a character of the labels' type. */
export function ringLabels(model: RingsModel, place: RingsPlace, narrow: boolean, charWidth = 7): RingLabel[] {
  const n = model.releases.length;
  if (n === 0 || place.outer <= 0) return [];
  const along = place.slot === 0 ? 1 : place.slot;
  // Each label stands outward of its ring (the last one's beyond the rim, in the room kept for it), or under the
  // ring's end on a horizon.
  const align: RingLabel["align"] = place.slot === 0 ? "under" : along > 0 ? "after" : "before";
  const y = place.slot === 0 ? (place.horizon ?? place.cy) + HORIZON_BAND / 2 : place.cy;
  const xOf = (k: number) => place.cx + along * radiusOf(place, k, n);
  const span = (k: number, text: string): [number, number] => {
    const x = xOf(k);
    const w = text.length * charWidth + 4;
    if (align === "under") return [x - w / 2, x + w / 2];
    return align === "after" ? [x + 3, x + 3 + w] : [x - 3 - w, x - 3];
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

// ---------------------------------------------------------------------------------------------------------------------
// The renderer.

interface RingsColours {
  ink: [number, number, number];
  history: [number, number, number];
  event: [number, number, number];
  handoff: [number, number, number];
  dark: boolean;
}

/** Seconds the rings take to grow from the first release to the last, once. */
const GROW_SECONDS = 2.8;
/** The ease of the growth: ring `grow(t)` is reached at `t` seconds. */
const GROW_EASE = 0.85;

/** The second at which ring `k` of `n` has grown in (its label appears with it). */
export function grownAt(k: number, n: number): number {
  return GROW_SECONDS * Math.min(1, (k + 3 + 3) / (n + 7)) ** (1 / GROW_EASE);
}
/** The sweep of light: every `SWEEP_PERIOD` seconds it crosses every ring in `SWEEP_SECONDS`, from the first. */
const SWEEP_PERIOD = 24;
const SWEEP_SECONDS = 9;
const SWEEP_FIRST = GROW_SECONDS + 3;
/** The pace of a ring (radians a second): the calmest, and how much more the most churned turns. */
const PACE_CALM = 0.002;
const PACE_CHURN = 0.03;
/** The golden angle: each ring's ticks start a little further round than the ring inside it. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface Drawn {
  pace: number[];
  churn: number[];
}

function paceOf(model: RingsModel): Drawn {
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
uniform float u_slot;     // 1 to the right, -1 to the left, 0 none
uniform float u_slotHalf; // device px
uniform float u_horizon;  // device px from the top; nothing below it
uniform float u_tick;     // a tick's length, device px
uniform float u_dark;
uniform vec3 u_ink;
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

// The coverage of ticks spread evenly round a ring: \`count\` units, the last tick as long as the rest; \`along\` is how
// far the pixel is from the ring toward the ticks' side (device px), \`angle\` its angle on the ring, \`d\` its radius.
float ticks(float count, float along, float angle, float d, float len) {
  if (count <= 0.0 || along < -0.5) return 0.0;
  float m = ceil(count - 1e-4);
  float step = TAU / m;
  float i = floor(angle / step + 0.5);
  float arc = abs(angle - i * step) * d;
  i = mod(i, m);
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
  float slotted = u_slot == 0.0 ? 1.0 : smoothstep(u_slotHalf - 0.5, u_slotHalf + 0.75, abs(q.y));
  if (u_slot != 0.0 && q.x * u_slot < u_inner * 0.6) slotted = 1.0;
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
    float labelled = step(1.5, b.w);
    float swept = exp(-pow((fk - u_sweep) / 2.6, 2.0));
    float focused = abs(fk - u_focus) < 0.5 ? 1.0 : 0.0;
    float lift = 1.0 + (u_dark > 0.5 ? 1.3 : 0.7) * swept + 0.5 * spot;
    float angle = mod(theta - b.y - b.z * u_time, TAU);
    // Front to back (each mark goes under those before it): ticks and spokes, the ring, its glow.
    // Ticks: the ids new at this release outward, the retirements on the way into it inward.
    float stepC = a.y > 0.0 ? TAU / ceil(a.y - 1e-4) : 1.0;
    float created = ticks(a.y, dr, angle, d, u_tick);
    float retired = ticks(a.z, -dr, mod(angle - 0.5 * stepC - 0.61, TAU), d, u_tick * 0.85);
    float tickLift = 1.0 + (u_dark > 0.5 ? 0.9 : 0.5) * swept + 0.9 * focused + 0.4 * spot;
    over(u_history, (u_dark > 0.5 ? 0.62 : 0.58) * tickLift * created * grown * slotted);
    over(u_ink, (u_dark > 0.5 ? 0.3 : 0.32) * tickLift * retired * grown * slotted);
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
      over(u_event, (u_dark > 0.5 ? 0.6 : 0.5) * apart * tickLift * spoke * grown * slotted);
    }
    // The ring: a hairline at device pixels, a little heavier with more gene ids; an assembly's first ring a pair of
    // hairlines in the assembly-change hue.
    float w = mix(0.8, 1.1, a.x) + 0.5 * focused;
    float ringLine = change > 0.5
      ? max(clamp(0.5 * w + 0.5 - abs(dr - 1.25 * u_dpr), 0.0, 1.0), clamp(0.5 * w + 0.5 - abs(dr + 1.25 * u_dpr), 0.0, 1.0))
      : clamp(0.5 * w + 0.5 - abs(dr), 0.0, 1.0);
    float ringA = change > 0.5 ? (u_dark > 0.5 ? 0.55 : 0.5) : (u_dark > 0.5 ? 0.1 + 0.3 * a.x : 0.08 + 0.27 * a.x);
    ringA = mix(ringA, 0.9, focused);
    // The light passing tints a ring toward the history hue.
    vec3 ringHue = change > 0.5 ? u_handoff : mix(u_ink, u_history, 0.55 * swept);
    over(ringHue, ringA * lift * ringLine * grown * max(slotted, labelled));
    // The glow of a churned ring: soft and only where Ensembl changed much (the square of its relative churn).
    float halo = exp(-pow(dr / (1.6 * u_spacing + 2.0 * u_dpr), 2.0));
    float glow = (u_dark > 0.5 ? 0.24 : 0.1) * b.x * b.x * b.x * b.x;
    over(u_event, glow * halo * grown * slotted);
    // The light passing through the releases, and the ring under the pointer, each a soft light of its own.
    over(u_history, (u_dark > 0.5 ? 0.07 : 0.035) * swept * halo * grown * slotted);
    over(u_ink, (u_dark > 0.5 ? 0.09 : 0.05) * focused * halo * grown * slotted);
  }
  // The air of the disc: a faint light about its centre, under everything.
  float rim = u_inner + u_spacing * float(u_n - 1);
  float air = exp(-pow(d / (u_inner + 0.9 * u_spacing * float(u_n)), 2.0) * 1.6) * smoothstep(rim + 3.0 * u_spacing, rim - 6.0 * u_spacing, d) * clamp((u_grow - f) / 6.0, 0.0, 1.0);
  over(u_dark > 0.5 ? mix(u_history, u_ink, 0.5) : u_ink, (u_dark > 0.5 ? 0.06 : 0.018) * air * clamp(u_grow / float(u_n), 0.0, 1.0));
  colour = acc * shown;
}`;

export interface RingsView {
  mode: "webgl2" | "canvas2d";
  /** The canvas drawn on (another than the one given where WebGL2 failed after it took the canvas). */
  element: HTMLCanvasElement;
  /** True where the rings grow and turn; false where they are drawn once and hold still. */
  readonly moving: boolean;
  resize(width: number, height: number, place: RingsPlace, labelled: readonly number[]): void;
  setColours(colours: RingsColours): void;
  /** The pointer (CSS px) or null; returns the ring under it, or -1. */
  setPointer(point: { x: number; y: number } | null): number;
  setRunning(running: boolean): void;
  stats(): { frames: number; meanFrameMs: number; meanDrawMs: number };
  /** The GPU work of a frame (WebGL2 only): one draw call of a quad over the disc's square, its fragments, the
   *  rings' texture. */
  work(): RingsWork | null;
  /** Draw the moment `seconds` after the start (the development switch's stepping of time). */
  drawAt(seconds: number): void;
  destroy(): void;
}

interface RingsWork {
  drawCalls: number;
  vertices: number;
  fragments: number;
  texture: { width: number; height: number; bytes: number };
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

/** The length of a tick (CSS px) for rings `spacing` apart. */
function tickOf(spacing: number): number {
  return Math.max(3.5, Math.min(9, 1.45 * spacing));
}

/** The slot's half height (CSS px). */
const SLOT_HALF = 8;

/** Each ring's values as two rows of texels: (weight, created ticks, retired ticks, fans) and (churn, phase, pace,
 *  flags: 1 an assembly's first ring, 2 a labelled ring). */
function texelsOf(model: RingsModel, labelled: readonly number[], still: boolean): Float32Array {
  const n = model.releases.length;
  const { pace, churn } = paceOf(model);
  const top = Math.max(1, ...model.active);
  const data = new Float32Array(n * 8);
  for (let k = 0; k < n; k++) {
    const flags = (model.changes.includes(k) ? 1 : 0) + (labelled.includes(k) ? 2 : 0);
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

const LIGHT: RingsColours = {
  ink: [0.05, 0.07, 0.09],
  history: [0.18, 0.37, 0.82],
  event: [0.76, 0.29, 0],
  handoff: [0.75, 0.22, 0.6],
  dark: false,
};

/** The rings' ink: the theme's, a cool silver in the dark. */
const inkOf = (colours: RingsColours): [number, number, number] => (colours.dark ? [0.84, 0.88, 0.95] : colours.ink);

/** A program of the two shaders, or null where they do not compile. */
function programOf(gl: WebGL2RenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** The renderer. `stepped` (the development switch, never in a production build) keeps the animated path where WebGL
 *  draws in software and draws only the moments asked for (`drawAt`). */
export function createRings(
  canvas: HTMLCanvasElement,
  model: RingsModel,
  reduced: boolean,
  stepped = false,
): RingsView {
  const webgl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: stepped,
  });
  if (!webgl) return createStill(canvas, model);
  const program = programOf(webgl);
  if (!program) {
    // A canvas keeps the one kind of context it gave: a new one for the 2D drawing.
    webgl.getExtension("WEBGL_lose_context")?.loseContext();
    const other = document.createElement("canvas");
    other.className = canvas.className;
    canvas.replaceWith(other);
    return createStill(other, model);
  }
  return createWebgl(canvas, webgl, program, model, reduced, stepped);
}

function createWebgl(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  model: RingsModel,
  reduced: boolean,
  stepped: boolean,
): RingsView {
  const n = model.releases.length;
  let dpr = 1;
  let width = 1;
  let height = 1;
  let place: RingsPlace = { form: "disc", cx: 0, cy: 0, inner: 10, outer: 100, slot: 0, horizon: null };
  let labelled: readonly number[] = [];
  let colours = LIGHT;
  let focus = -1;
  let pointer: { x: number; y: number } | null = null;
  let running = false;
  let raf = 0;
  let start = -1;
  let last = 0;
  let drawnAt = 0;
  const times = { frames: 0, frameMs: 0, drawMs: 0 };
  // In software (no GPU) a frame costs a CPU a large part of a second: one frame, held still, as under reduced motion.
  const software = drawsInSoftware(gl);
  const still = reduced || (!stepped && software);
  /** The moment shown when time is stepped by hand (the development switch), else null: the clock's. */
  let forced: number | null = stepped ? 0 : null;
  let area = 0;
  const vao = gl.createVertexArray();
  const texture = gl.createTexture();
  const u = (name: string) => gl.getUniformLocation(program, name);

  function upload() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 2, 0, gl.RGBA, gl.FLOAT, texelsOf(model, labelled, still));
  }

  function draw(now: number) {
    const t0 = performance.now();
    if (start < 0) start = now;
    const seconds = forced ?? (now - start) / 1000;
    const calm = still && forced === null;
    const grow = calm ? n + 4 : -3 + (n + 7) * Math.min(1, seconds / GROW_SECONDS) ** GROW_EASE;
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
    area = Math.max(0, rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1]);
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
    gl.uniform1f(u("u_slot"), place.slot);
    gl.uniform1f(u("u_slotHalf"), SLOT_HALF * dpr);
    gl.uniform1f(u("u_horizon"), place.horizon === null ? 1e9 : place.horizon * dpr);
    gl.uniform1f(u("u_tick"), tickOf(spacing) * dpr);
    gl.uniform1f(u("u_dark"), colours.dark ? 1 : 0);
    gl.uniform3f(u("u_ink"), ...inkOf(colours));
    gl.uniform3f(u("u_history"), ...colours.history);
    gl.uniform3f(u("u_event"), ...colours.event);
    gl.uniform3f(u("u_handoff"), ...colours.handoff);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u("u_data"), 0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
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
    if (running && !still && forced === null) raf = requestAnimationFrame(loop);
  };
  const request = () => {
    asked = true;
    if (!raf) raf = requestAnimationFrame(loop);
  };

  upload();
  return {
    mode: "webgl2",
    element: canvas,
    get moving() {
      return !still;
    },
    resize(w, h, p, marks) {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(w * dpr));
      height = Math.max(1, Math.round(h * dpr));
      canvas.width = width;
      canvas.height = height;
      place = p;
      labelled = marks;
      upload();
      if (forced !== null) draw(performance.now());
      else request();
    },
    setColours(c) {
      colours = c;
      if (forced !== null) draw(performance.now());
      else request();
    },
    setPointer(p) {
      const k = p ? ringAt(place, n, p) : -1;
      // In software a frame costs a CPU hundreds of milliseconds: the words beside the pointer, not a new frame.
      if (reduced || (software && forced === null)) return k;
      pointer = p;
      if (k !== focus || (p && !still)) {
        focus = k;
        if (forced !== null) draw(performance.now());
        else request();
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
      running = false;
      if (raf) cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** Without WebGL2: the same rings drawn once on a 2D canvas (they hold still; the pointer only names its ring). */
function createStill(canvas: HTMLCanvasElement, model: RingsModel): RingsView {
  const n = model.releases.length;
  const { churn } = paceOf(model);
  let dpr = 1;
  let width = 1;
  let height = 1;
  let place: RingsPlace = { form: "disc", cx: 0, cy: 0, inner: 10, outer: 100, slot: 0, horizon: null };
  let labelled: readonly number[] = [];
  let colours = LIGHT;
  const phase = (k: number) => k * GOLDEN;
  const ink = () => inkOf(colours);
  const context = canvas.getContext("2d");
  const paint = () => {
    if (!context) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    if (place.horizon !== null) {
      context.beginPath();
      context.rect(0, 0, width, place.horizon);
      context.clip();
    }
    const css = (rgb: [number, number, number], a: number) =>
      `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")} / ${a.toFixed(3)})`;
    const top = Math.max(1, ...model.active);
    const spacing = n > 1 ? (place.outer - place.inner) / (n - 1) : place.outer;
    const tick = tickOf(spacing);
    const hair = 1 / dpr;
    const spoke = (r0: number, r1: number, a: number) => {
      context.moveTo(place.cx + r0 * Math.cos(a), place.cy + r0 * Math.sin(a));
      context.lineTo(place.cx + r1 * Math.cos(a), place.cy + r1 * Math.sin(a));
    };
    const tickRun = (count: number, r: number, outward: number, length: number, offset: number) => {
      const { whole, rest } = ticksOf(count, model.unit);
      const m = whole + (rest > 0 ? 1 : 0);
      context.beginPath();
      for (let i = 0; i < m; i++) {
        const l = length * (i % 10 === 0 ? 1.75 : 1) * (i === m - 1 && rest > 0 ? rest : 1);
        spoke(r, r + outward * l, offset + (i / m) * Math.PI * 2);
      }
      context.stroke();
    };
    for (let k = 0; k < n; k++) {
      const r = radiusOf(place, k, n);
      const weight = (model.active[k] ?? 0) / top;
      const change = model.changes.includes(k);
      const c = churn[k] ?? 0;
      // The glow, then the ring, then its ticks and spokes.
      if (c * c > 0.02 || change) {
        context.strokeStyle = css(
          change ? colours.handoff : colours.event,
          (colours.dark ? 0.1 : 0.05) * (c * c + 0.6 * (change ? 1 : 0)),
        );
        context.lineWidth = 2.5 * spacing;
        context.beginPath();
        context.arc(place.cx, place.cy, r, 0, Math.PI * 2);
        context.stroke();
      }
      context.lineWidth = change ? 1.35 * hair : hair;
      context.strokeStyle = change
        ? css(colours.handoff, 0.85)
        : css(ink(), colours.dark ? 0.15 + 0.4 * weight : 0.12 + 0.36 * weight);
      context.beginPath();
      context.arc(place.cx, place.cy, r, 0, Math.PI * 2);
      context.stroke();
      context.lineWidth = hair;
      const first = phase(k);
      const created = (model.created[k] ?? 0) / model.unit;
      context.strokeStyle = css(colours.history, 0.7);
      tickRun(model.created[k] ?? 0, r, 1, tick, first);
      context.strokeStyle = css(ink(), 0.42);
      const stepC = created > 0 ? (Math.PI * 2) / Math.ceil(created - 1e-4) : 1;
      tickRun(model.retired[k] ?? 0, r, -1, tick * 0.85, first + 0.5 * stepC + 0.61);
      const fans = k > 0 ? (model.fans[k] ?? 0) : 0;
      if (fans > 0) {
        const apart = Math.max(0.22, Math.min(1, (((Math.PI * 2) / fans) * r) / 4));
        context.strokeStyle = css(colours.event, 0.75 * apart);
        context.beginPath();
        for (let i = 0; i < fans; i++) spoke(r - spacing, r, first - 1.7 * first - 0.37 + (i / fans) * Math.PI * 2);
        context.stroke();
      }
    }
    context.restore();
    // The slot: the paper again, but for the labelled rings' lines across it.
    if (place.slot !== 0) {
      const x0 = place.slot > 0 ? place.cx + place.inner * 0.6 : 0;
      const x1 = place.slot > 0 ? width : place.cx - place.inner * 0.6;
      context.clearRect(x0, place.cy - SLOT_HALF, x1 - x0, 2 * SLOT_HALF);
      context.lineWidth = hair;
      for (const k of labelled) {
        const x = place.cx + place.slot * radiusOf(place, k, n);
        context.strokeStyle = model.changes.includes(k) ? css(colours.handoff, 0.85) : css(ink(), 0.5);
        context.beginPath();
        context.moveTo(x, place.cy - SLOT_HALF);
        context.lineTo(x, place.cy + SLOT_HALF);
        context.stroke();
      }
    }
  };
  return {
    mode: "canvas2d",
    element: canvas,
    moving: false,
    resize(w, h, p, marks) {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = w;
      height = h;
      place = p;
      labelled = marks;
      paint();
    },
    setColours(c) {
      colours = c;
      paint();
    },
    setPointer: (p) => (p ? ringAt(place, n, p) : -1),
    setRunning: () => undefined,
    stats: () => ({ frames: 0, meanFrameMs: 0, meanDrawMs: 0 }),
    work: () => null,
    drawAt: () => undefined,
    destroy: () => undefined,
  };
}
