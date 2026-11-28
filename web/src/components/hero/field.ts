// The renderer of the lineage field (the home's default picture, and the History tab's field): WebGL2 where the page
// draws by a GPU, else one still drawing on a 2D canvas. What it draws is the layout of lib/hero/lineageLayout.ts (each
// gene id a line over the releases it is active at, a grain at each new version, a curve for each history edge to
// another id), nothing else, on a field seen in perspective: the first release far away at the left, the last near at
// the right, the release axis a line at the field's foot (`FieldFrame`, one map, the same for the shaders, the pointer
// and the words placed over it). The still field is drawn once into a texture of density (again only on a resize or a
// change of theme); each frame composites it into ink (light) or light (dark), revealed along the time axis once,
// brightened near the pointer, with light travelling along the lines with time (and along the edges it meets, and
// flaring at the new versions it passes) and the family under the pointer lifted. It draws only while seen, and under
// reduced motion one still frame.
import {
  DOT_FLOATS,
  EDGE_FLOATS,
  SEGMENT_FLOATS,
  simplified,
  type LineageLayout,
  type Lines,
} from "../../lib/hero/lineageLayout";
import {
  devicePixels,
  stillContext,
  hostPicture,
  programsDone,
  startProgram,
  uniformsOf,
  type FrameStats,
  type HeroRoom,
  type Inks,
  type Picture,
  type Point,
  type Rgb,
} from "./canvas";

/** One end of the field: its x and the y of its top and bottom edges, in CSS pixels of the canvas. */
interface FieldEdge {
  x: number;
  top: number;
  bottom: number;
}

/** Where the field lies: its far end (the graph's first release) and its near end (its last), each vertical. Between
 *  them the releases lie as on a plane receding from the eye (`depth`: how much closer together they lie at the far
 *  end than at the near; by default the ratio of the ends' heights, a true plane), and the field's height grows from
 *  the far end's to the near end's as the `flare`-th power of the way across (1, the default: linearly, a true plane;
 *  more: the field stays low longer and opens toward the present, a horn). */
export interface FieldFrame {
  far: FieldEdge;
  near: FieldEdge;
  depth?: number;
  flare?: number;
}

/** The numbers of a frame's map. */
function shapeOf(frame: FieldFrame) {
  const farHalf = Math.max(0.5, (frame.far.bottom - frame.far.top) / 2);
  const nearHalf = Math.max(0.5, (frame.near.bottom - frame.near.top) / 2);
  return { farHalf, nearHalf, depth: frame.depth ?? nearHalf / farHalf, flare: frame.flare ?? 1 };
}

/** The share of the way across the screen of a fraction of the time axis (perspective of ratio `depth`). */
const screenShare = (u: number, depth: number) => u / (depth - (depth - 1) * u);
/** Its inverse. */
const fieldShare = (s: number, depth: number) => (depth * s) / (1 + (depth - 1) * s);

/** The placing of points of the field (x from 0 at the first release to 1 at the last, y from -0.5 to 0.5 across) in
 *  CSS pixels, as the shaders place them. */
export function placer(frame: FieldFrame): (x: number, y: number) => { x: number; y: number } {
  const { farHalf, nearHalf, depth, flare } = shapeOf(frame);
  return (u, y) => {
    const s = screenShare(u, depth);
    const bottom = frame.far.bottom + (frame.near.bottom - frame.far.bottom) * s;
    const half = farHalf + (nearHalf - farHalf) * Math.max(0, s) ** flare;
    return { x: frame.far.x + (frame.near.x - frame.far.x) * s, y: bottom - half + 2 * half * y };
  };
}

/** A point of the field (fractions) in CSS pixels, as the shaders place it. */
export function placeOf(frame: FieldFrame, x: number, y: number): { x: number; y: number } {
  return placer(frame)(x, y);
}

/** The inverse of `placeOf`: fractions of the field for a point in CSS pixels. */
export function fieldAt(frame: FieldFrame, px: number, py: number): { x: number; y: number } {
  const { farHalf, nearHalf, depth, flare } = shapeOf(frame);
  const s = (px - frame.far.x) / (frame.near.x - frame.far.x || 1);
  const bottom = frame.far.bottom + (frame.near.bottom - frame.far.bottom) * s;
  const half = farHalf + (nearHalf - farHalf) * Math.max(0, s) ** flare;
  return { x: fieldShare(s, depth), y: (py - bottom + half) / (2 * half) };
}

/** The room the release axis takes under the field: the releases, the names under them, and a second row of names. */
export const AXIS_ROOM = 62;
/** The axis without its names (a narrow window). */
export const AXIS_ROOM_NARROW = 32;
/** How much closer together the releases lie at the far end than at the near (at 4 the first half of the releases
 *  took a fifth of the width). */
const DEPTH = 2.2;
/** How far the field's outermost line keeps from the words (CSS px). */
const CLEAR = 40;
/** The least height of a field worth drawing (CSS px at its near end), and its least width. */
const LEAST = { height: 48, width: 200 } as const;
/** Below this height of its near end the field is a flat band: no perspective. */
const FLAT_BELOW = 160;
/** The flares tried, the least first, and the ratios of the near end's height to the far end's (the plane's depth
 *  first): the field opens toward the present only as much as the words ask for its near end to reach the top of the
 *  hero's upper third. The releases stay spaced by `DEPTH` whatever the heights. */
const FLARES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const RATIOS = [DEPTH, 2.8, 3.5, 4.5];

/** Where the lineages lie in the hero, so that no line crosses a word: the field's foot a level line above the
 *  caption (with the axis under it), its far end at the content column's left edge, its near end at its right edge.
 *  Of three compositions the one that draws the field largest: beside the words (the field's outermost line, `top` by
 *  release as `LineageLayout.top`, kept `CLEAR` px from the words' box; its near end as high as the top of the hero's
 *  upper third where a flare lets it, the field opening toward the present), to the right of the words (a short
 *  window), or under them (a phone: a flat band where it is low). Null where no room is left for it. */
export function frameOf(room: HeroRoom, top: ArrayLike<number> = [], axis = AXIS_ROOM): FieldFrame | null {
  const foot = Math.min(room.height, room.captionTop) - axis;
  const pad = Math.max(12, room.height * 0.05);
  const n = top.length;
  const words = room.words;
  const build = (
    left: number,
    right: number,
    nearTop: number,
    flare: number,
    flat: boolean,
    ratio = DEPTH,
  ): FieldFrame => {
    const nearHalf = (foot - nearTop) / 2;
    const farHalf = flat ? nearHalf : nearHalf / ratio;
    return {
      far: { x: left, top: foot - 2 * farHalf, bottom: foot },
      near: { x: right, top: nearTop, bottom: foot },
      depth: flat ? 1.6 : DEPTH,
      flare,
    };
  };
  const clearOfWords = (frame: FieldFrame) => {
    if (!words) return true;
    const place = placer(frame);
    for (let k = 0; k < n; k++) {
      const p = place(n > 1 ? k / (n - 1) : 0.5, top[k] ?? -0.5);
      if (p.x < words.right + CLEAR && p.x > words.left - CLEAR && p.y < words.bottom + CLEAR) return false;
    }
    return true;
  };
  const options: FieldFrame[] = [];
  // Beside the words: across the content column, as tall as the words let it be.
  if (words && room.right - room.left >= LEAST.width) {
    const target = room.height * 0.3;
    let best: FieldFrame | null = null;
    search: for (const ratio of RATIOS)
      for (const flare of FLARES) {
        const frameAt = (nearTop: number) => build(room.left, room.right, nearTop, flare, false, ratio);
        const nearTop = highest(pad, foot - LEAST.height, (t) => clearOfWords(frameAt(t)));
        if (nearTop === null) continue;
        const frame = frameAt(nearTop);
        if (!best || frame.near.top < best.near.top - 1) best = frame;
        if (nearTop <= target) break search;
      }
    if (best) options.push(best);
    // To the right of the words (a short window): its own room, from the top.
    const left = words.right + CLEAR;
    if (room.right - left >= LEAST.width && foot - pad >= LEAST.height)
      options.push(build(left, room.right, pad, 1, foot - pad < FLAT_BELOW));
  }
  // Under the words (or the whole room where there are none).
  const below = words ? words.bottom + CLEAR / 2 : pad;
  if (foot - below >= LEAST.height) options.push(build(room.left, room.right, below, 1, foot - below < FLAT_BELOW));
  const size = (f: FieldFrame) => (f.near.bottom - f.near.top) * (f.near.x - f.far.x);
  const chosen = options.sort((a, b) => size(b) - size(a))[0];
  return chosen && chosen.near.bottom - chosen.near.top >= LEAST.height ? chosen : null;
}

/** The highest (least) of the values from `lo` to `hi` that `fits`, where a larger value fits when a smaller one does;
 *  null where not even `hi` fits. */
function highest(lo: number, hi: number, fits: (value: number) => boolean): number | null {
  if (hi <= lo || !fits(hi)) return null;
  if (fits(lo)) return lo;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 24; i++) {
    const mid = (a + b) / 2;
    if (fits(mid)) b = mid;
    else a = mid;
  }
  return b;
}

/** What one frame asks of the GPU, counted as it is drawn (the still pass only when it is redrawn). */
interface FieldWork {
  drawCalls: number;
  vertices: number;
  stillDrawCalls: number;
  stillVertices: number;
  /** The still field's texture: its size in device pixels and bytes (with its mipmaps). */
  texture: { width: number; height: number; bytes: number };
}

/** The lineage field's renderer. `setPointer` takes the id whose family is lifted (or -1). */
export type Field = Picture<FieldFrame>;

/** Steps of a curve between two releases: a smooth step in y, linear in x. */
const STEPS = 10;
/** The reveal along the time axis, once; the light fades in from part of the way through it. */
const REVEAL_MS = 2400;
const LIGHT_FROM = 0.55;
const LIGHT_IN_MS = 1800;

/** The light travelling along a line (or an edge, or reaching a grain): where its head is at a time, as a fraction of
 *  the field (about half of its cycle on the field), how long its tail is, and how bright it is at a point. The same
 *  for every pass, so that light leaving a line along an edge leaves it as it passes. */
const PULSE = `
float pulseSpeed(float phase) { return 0.034 + 0.03 * fract(phase * 7.13); }
float pulseHead(float phase, float time) { return fract(time * pulseSpeed(phase) + phase) * 2.2 - 0.35; }
float pulseTail(float phase) { return 1.5 * (0.05 + 0.06 * fract(phase * 3.7)); }
float pulseLight(float x, float phase, float time) {
  float d = pulseHead(phase, time) - x;
  float tail = pulseTail(phase);
  float light = d > 0.0 && d < tail ? pow(1.0 - d / tail, 2.6) : 0.0;
  return light + (d <= 0.0 && d > -0.006 ? 1.0 + d / 0.006 : 0.0);
}`;

/** The field's map in the shaders: `u_ends` the ends' x and feet, `u_shape` their half heights, the depth and the
 *  flare (device px). Returns the point and the field's scale there (1 at the near end). */
const PLACE = `
uniform vec4 u_ends;
uniform vec4 u_shape;
vec3 place(vec2 f) {
  float r = u_shape.z;
  float s = f.x / (r - (r - 1.0) * f.x);
  float bottom = mix(u_ends.z, u_ends.w, s);
  float spread = u_shape.x + (u_shape.y - u_shape.x) * pow(max(s, 0.0), u_shape.w);
  return vec3(mix(u_ends.x, u_ends.y, s), bottom - spread + 2.0 * spread * f.y, spread / u_shape.y);
}`;

const VERTEX = `#version 300 es
precision highp float;
in float a_t;
in vec4 a_seg;
in vec2 a_meta;
uniform vec2 u_res;
uniform float u_offset;
uniform float u_eras;
uniform float u_edges; // 1: the instances are edges (their kind, then the phase of the id they leave)
${PLACE}
out float v_fade;
out float v_x;
out float v_phase;
out float v_era;
out float v_scale;
out float v_kind;
void main() {
  float s = a_t * a_t * (3.0 - 2.0 * a_t);
  float x = mix(a_seg.x, a_seg.z, a_t);
  float y = mix(a_seg.y, a_seg.w, s);
  vec3 p = place(vec2(x, y));
  bool edge = u_edges > 0.5;
  v_fade = edge ? 1.0 : (a_meta.x == 1.0 ? a_t : (a_meta.x == 2.0 ? 1.0 - a_t : 1.0));
  v_kind = edge ? a_meta.x : -1.0;
  v_x = x;
  v_phase = fract(a_meta.y);
  // Growth rings: the ids of the first assembly in full ink, each later era a step lighter.
  v_era = u_eras > 1.0 ? floor(a_meta.y) / (u_eras - 1.0) : 0.0;
  v_scale = p.z;
  vec2 clip = (p.xy + vec2(0.0, u_offset)) / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float v_fade;
in float v_x;
in float v_phase;
in float v_era;
in float v_scale;
in float v_kind;
uniform vec4 u_colour;
uniform vec3 u_young;
uniform float u_time;
uniform float u_pulse;
uniform float u_still;
uniform float u_kind;   // only edges of this kind (-1: every one)
uniform float u_phase;  // the light's phase for every line drawn (-1: each line's own)
uniform vec4 u_fibre;   // a thread's weight: floor + gain * h^power (h its hash); the haze at the far end
${PULSE}
out vec4 colour;
void main() {
  if (u_kind >= 0.0 && abs(v_kind - u_kind) > 0.5) discard;
  float a = u_colour.a * v_fade;
  vec3 rgb = u_colour.rgb;
  if (u_still > 0.5) {
    // Growth rings: the ids of the first assembly in the line's ink, each later era's further toward the young ids'
    // colour and lighter. Each thread its own weight, most of them faint and a few strong (the mean weight is the same
    // for every line), and as much ink per pixel at the far end as at the near (lines lie closer there), hazing with
    // distance.
    float weight = u_fibre.x + u_fibre.y * pow(fract(v_phase * 13.731), u_fibre.z);
    a *= weight * mix(1.0, 0.62, v_era) * v_scale * mix(u_fibre.w, 1.0, v_x);
    rgb = mix(u_colour.rgb, u_young, v_era);
  }
  if (u_pulse > 0.5) a *= pulseLight(v_x, u_phase >= 0.0 ? u_phase : v_phase, u_time);
  colour = vec4(rgb * a, a);
}`;

const DOT_VERTEX = `#version 300 es
precision highp float;
in vec3 a_dot;
uniform vec2 u_res;
uniform float u_size;
uniform float u_time;
uniform float u_flare; // 0: a grain of the still field; 1: the light passing it
uniform float u_crowd; // grains lie this many deep where a release re-versions many ids (each is lighter by it)
${PLACE}
${PULSE}
out float v_alpha;
out float v_flare;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec3 p = place(a_dot.xy);
  float h = hash(float(gl_VertexID));
  // A grain: a little to one side of its line or the other, of a weight of its own (a column of new versions reads as
  // grains, never a bar).
  vec2 jitter = u_flare > 0.5 ? vec2(0.0) : vec2((h - 0.5) * 2.4 * u_size / 2.0, 0.0);
  vec2 clip = (p.xy + jitter) / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float phase = fract(a_dot.z);
  // The light reaching it: a flare of about 300 ms as the head passes.
  float width = 0.3 * pulseSpeed(phase) * 2.2;
  float d = pulseHead(phase, u_time) - a_dot.x;
  v_flare = u_flare > 0.5 ? exp(-pow(d / width, 2.0)) : 0.0;
  // Most grains faint and a few strong, all lighter where they lie deep (a release that re-versions many ids is a
  // column of grains, never a bar).
  float weight = 0.25 + 1.75 * pow(hash(float(gl_VertexID) * 1.7 + 3.1), 3.0);
  v_alpha = u_flare > 0.5 ? v_flare : weight / max(1.0, u_crowd / p.z);
  gl_PointSize = u_flare > 0.5 ? u_size * 3.2 * (0.6 + 0.4 * v_flare) : u_size;
}`;

const DOT_FRAGMENT = `#version 300 es
precision highp float;
in float v_alpha;
in float v_flare;
uniform vec4 u_colour;
uniform float u_flare;
out vec4 colour;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float shape = u_flare > 0.5 ? exp(-2.2 * dot(c, c)) : 1.0;
  float a = u_colour.a * v_alpha * shape;
  colour = vec4(u_colour.rgb * a, a);
}`;

const QUAD_VERTEX = `#version 300 es
precision highp float;
in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

const QUAD_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_field;
uniform vec2 u_res;
uniform vec4 u_ends;
uniform vec4 u_shape;
uniform float u_reveal; // the release fraction shown so far
uniform vec3 u_pointer; // device px, and 1 where the pointer is on the field
uniform float u_radius;
uniform vec3 u_tint;
uniform vec3 u_glow;
uniform vec3 u_deep;   // dark: the ink of the sparse field (a two-stop ramp toward the lines' own light)
uniform float u_gain;
uniform float u_dark;
uniform float u_bloom;
uniform float u_floor; // light: the least ink of a pixel a line passes
out vec4 colour;
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  float s = (p.x - u_ends.x) / max(1.0, u_ends.y - u_ends.x);
  float fx = u_shape.z * s / (1.0 + (u_shape.z - 1.0) * s);
  vec4 c = texture(u_field, v_uv);
  // The glow: the density itself, seen through its mipmaps (a wide soft blur at no cost per line).
  float near = textureLod(u_field, v_uv, 2.5).a;
  float wide = textureLod(u_field, v_uv, 4.5).a;
  float shown = 1.0 - smoothstep(u_reveal - 0.06, u_reveal, fx);
  float front = u_reveal < 1.04 ? exp(-pow((fx - u_reveal + 0.01) / 0.018, 2.0)) : 0.0;
  float glow = u_pointer.z * exp(-dot(p - u_pointer.xy, p - u_pointer.xy) / (u_radius * u_radius));
  // The still field holds the density of what is drawn, added up; it is mapped to ink (or light) as a veil that never
  // saturates (1 - e^-density), so the dense core is deep and every sparse edge, birth and retirement stays visible.
  vec3 hue = c.a > 1e-5 ? c.rgb / c.a : vec3(0.0);
  float a = 1.0 - exp(-u_gain * c.a * (1.0 + glow * 1.2));
  float halo = (1.0 - exp(-u_bloom * (0.6 * near + 0.4 * wide))) * (1.0 - a * 0.6);
  if (u_dark > 0.5) {
    // Light on the night: the sparse field a deep indigo, the dense core its lines' own pale light (two stops), with
    // a bloom of its own density.
    vec3 ramp = mix(u_deep, hue, smoothstep(0.05, 0.85, a));
    vec3 rgb = mix(ramp, u_tint, glow * 0.7) * a + u_glow * halo + u_tint * front * a * 1.4;
    colour = vec4(rgb, min(1.0, max(a, halo))) * shown;
  } else {
    // Ink on the paper, an engraving: the hairlines' density is the ink (the paper shows between them), each pixel a
    // line passes at least a floor of ink so that a sparse fan stays drawn; the pointer's light draws them toward the
    // history hue.
    a = c.a > 0.002 ? max(a, u_floor) : a;
    vec3 rgb = mix(hue, u_tint, glow * 0.6) * a + u_glow * halo + u_tint * front * a * 0.9;
    colour = vec4(rgb, min(1.0, a + halo * (1.0 - a))) * shown;
  }
}`;

/** The device pixels across which the ids of the widest release are spread at the field's near end. */
function spreadOf(frame: FieldFrame, dpr: number): number {
  return (frame.near.bottom - frame.near.top) * dpr;
}

/** A line's weight in the density: where the lines lie thickest they add up to about 1 (the composite's gain then
 *  sets how deep that is), and a line alone keeps a visible weight. */
function lineAlpha(layout: LineageLayout, spread: number): number {
  const perPixel = layout.widest / Math.max(1, spread);
  return Math.min(0.5, Math.max(0.02, 1 / perPixel));
}

/** An edge's weight in the density: where the most edges cross one cell of the layout's grid (its 99.9th percentile,
 *  `edgeCrowd`) they add up to about 0.9, so that where hundreds of fans meet at an assembly change every curve stays a
 *  curve; an edge alone keeps its full weight. */
function edgeAlpha(layout: LineageLayout, frame: FieldFrame, dpr: number): number {
  const { farHalf, nearHalf } = shapeOf(frame);
  const cell = (2 * Math.sqrt(farHalf * nearHalf) * dpr) / 128;
  return Math.min(1.3, Math.max(0.03, (0.9 * cell) / Math.max(1, layout.edgeCrowd)));
}

const mixed = (p: Rgb, q: Rgb, t: number): Rgb => p.map((v, i) => v + ((q[i] ?? 0) - v) * t) as Rgb;
const lighten = (rgb: Rgb, by: number): Rgb => rgb.map((v) => v + (1 - v) * by) as Rgb;

/** The inks of each theme. Dark: light on the night (pale steel lines, the younger eras toward the history hue, added
 *  up with a bloom; most threads faint, a few bright; the sparse field deep indigo). Light: ink on the paper, an
 *  engraving (deep blue-black hairlines, the younger eras toward the history hue; most threads a fine haze and a few cut
 *  strong; the showcase's journeys deeper). The travelling light: in the dark a comet of light; in the light a cut of
 *  the paper with a bead of deep ink in it (the event hue on an edge). */
function paletteOf(inks: Inks) {
  if (inks.dark)
    return {
      line: [0.7, 0.79, 0.96] as Rgb,
      young: lighten(inks.history, 0.25),
      deep: [0.11, 0.15, 0.33] as Rgb,
      focal: [0.78, 0.85, 1] as Rgb,
      focalAlpha: 0.08,
      journeyAlpha: 0.22,
      dots: lighten(inks.history, 0.2),
      dotAlpha: 0.4,
      core: [0.88, 0.94, 1] as Rgb,
      halo: [0.36, 0.55, 1] as Rgb,
      lift: [0.97, 0.98, 1] as Rgb,
      glow: [0.3, 0.45, 0.85] as Rgb,
      gain: 0.85,
      bloom: 0.7,
      floor: 0,
      fibre: [0.25, 3.0, 5.0, 0.55] as [number, number, number, number],
    };
  return {
    line: mixed(inks.ink, inks.history, 0.12),
    young: mixed(inks.history, inks.ink, 0.35),
    deep: inks.ink,
    focal: mixed(inks.history, inks.ink, 0.45),
    focalAlpha: 0.16,
    journeyAlpha: 0.5,
    dots: inks.history,
    dotAlpha: 0.4,
    core: inks.ink,
    halo: inks.paper,
    lift: inks.ink,
    glow: lighten(inks.history, 0.6),
    gain: 1.05,
    bloom: 0.06,
    floor: 0.1,
    fibre: [0.1, 4.3, 8.0, 0.3] as [number, number, number, number],
  };
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

/** How the field is to be drawn: under reduced motion; the ids of the journey this visit follows (drawn strongest,
 *  the first light along them; empty for none); the development switch. */
export interface FieldOptions {
  reduced: boolean;
  focus?: readonly number[];
  stepped?: boolean;
  /** Called when the renderer's mode or canvas changes (its programs compiled, or WebGL given up). */
  changed?: () => void;
}

/** The renderer: WebGL2 where the page draws by a GPU (`canvas.ts`, `pageGraphics`), else the still on a 2D canvas. */
export function createField(canvas: HTMLCanvasElement, layout: LineageLayout, options: FieldOptions): Field {
  const focus = options.focus ?? [];
  const focal = focus.length ? simplified(layout, focus, layout.tolerance) : null;
  return hostPicture<FieldFrame>(
    canvas,
    {
      attributes: {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        powerPreference: "low-power",
        preserveDrawingBuffer: options.stepped ?? false,
      },
      start(gl) {
        const programs = {
          lines: startProgram(gl, VERTEX, LINE_FRAGMENT),
          dots: startProgram(gl, DOT_VERTEX, DOT_FRAGMENT),
          quad: startProgram(gl, QUAD_VERTEX, QUAD_FRAGMENT),
        };
        return {
          done: () => programsDone(gl, Object.values(programs)),
          build: () => createWebgl(gl, programs, layout, focal, options),
        };
      },
    },
    (target) => createStill(target, layout, focal),
    options.stepped ?? false,
    options.changed,
  );
}

interface Programs {
  lines: WebGLProgram;
  dots: WebGLProgram;
  quad: WebGLProgram;
}

function createWebgl(
  gl: WebGL2RenderingContext,
  programs: Programs,
  layout: LineageLayout,
  focal: Lines | null,
  options: FieldOptions,
): Field {
  const reduced = options.reduced;
  const stepped = options.stepped ?? false;
  const { lines, dots: dotsProgram, quad } = programs;
  const steps = new Float32Array(STEPS + 1).map((_, i) => i / STEPS);
  const work = { drawCalls: 0, vertices: 0, stillDrawCalls: 0, stillVertices: 0 };
  const count = (vertices: number) => {
    work.drawCalls++;
    work.vertices += vertices;
  };

  /** A vertex array of instanced curves over `data` (segments or edges), from instance `first`; `vertices` along
   *  each (2: a straight line). */
  function curves(data: Float32Array, stride: number, vertices = STEPS + 1) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const t = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, t);
    gl.bufferData(gl.ARRAY_BUFFER, vertices === 2 ? new Float32Array([0, 1]) : steps, gl.STATIC_DRAW);
    const at = gl.getAttribLocation(lines, "a_t");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 1, gl.FLOAT, false, 0, 0);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const seg = gl.getAttribLocation(lines, "a_seg");
    const meta = gl.getAttribLocation(lines, "a_meta");
    const point = (first: number) => {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(seg);
      gl.vertexAttribPointer(seg, 4, gl.FLOAT, false, stride * 4, first * stride * 4);
      gl.vertexAttribDivisor(seg, 1);
      gl.enableVertexAttribArray(meta);
      gl.vertexAttribPointer(meta, 2, gl.FLOAT, false, stride * 4, first * stride * 4 + 16);
      gl.vertexAttribDivisor(meta, 1);
    };
    point(0);
    return { vao, count: data.length / stride, point, vertices };
  }
  type Curves = ReturnType<typeof curves>;
  /** Simplified lines: the straight, then the curved. */
  const drawn = (parts: Lines) => ({
    straight: curves(parts.straight, SEGMENT_FLOATS, 2),
    curved: curves(parts.curved, SEGMENT_FLOATS),
  });
  const drawLines = (set: ReturnType<typeof drawn>) => {
    for (const part of [set.straight, set.curved]) drawCurves(part);
  };
  const drawCurves = (part: Curves, from = 0, to = part.count) => {
    if (to <= from) return;
    if (from) part.point(from);
    gl.bindVertexArray(part.vao);
    gl.drawArraysInstanced(gl.LINE_STRIP, 0, part.vertices, to - from);
    count(part.vertices * (to - from));
    if (from) part.point(0);
  };
  const threads = curves(layout.segments, SEGMENT_FLOATS);
  const all = drawn(layout.lines.all);
  const showcase = drawn(layout.lines.focal);
  const pulses = drawn(layout.lines.pulses);
  const journey = focal ? drawn(focal) : null;
  // Edges in two draws by kind (the kind is the fifth float).
  const byKind = (kind: number) => {
    const out: number[] = [];
    for (let e = 0; e < layout.edges.length / EDGE_FLOATS; e++)
      if ((layout.edges[e * EDGE_FLOATS + 4] ?? 0) === kind)
        out.push(...layout.edges.subarray(e * EDGE_FLOATS, (e + 1) * EDGE_FLOATS));
    return Float32Array.from(out);
  };
  const edgesOne = curves(byKind(0), EDGE_FLOATS);
  const edgesFan = curves(byKind(1), EDGE_FLOATS);
  const allEdges = curves(layout.edges, EDGE_FLOATS);
  const pulseEdges = curves(layout.pulseEdges, EDGE_FLOATS);

  const dotArray = (data: Float32Array) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const at = gl.getAttribLocation(dotsProgram, "a_dot");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 3, gl.FLOAT, false, DOT_FLOATS * 4, 0);
    return { vao, count: data.length / DOT_FLOATS };
  };
  const grains = dotArray(layout.dots);
  const flares = dotArray(layout.pulseDots);

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aCorner = gl.getAttribLocation(quad, "a_corner");
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  let dpr = 1;
  let width = 1;
  let height = 1;
  let frame: FieldFrame = { far: { x: 0, top: 0, bottom: 1 }, near: { x: 1, top: 0, bottom: 1 } };
  let inks: Inks = LIGHT_INKS;
  let dirty = true;
  let pointer: Point | null = null;
  let lift = -1;
  let running = false;
  let raf = 0;
  let start = -1;
  let ended = false;
  const times = { frames: 0, frameMs: 0, drawMs: 0, last: 0 };
  const lu = uniformsOf(gl, lines);
  const du = uniformsOf(gl, dotsProgram);
  const qu = uniformsOf(gl, quad);
  // A still field of half floats where the browser can draw into them: thousands of faint lines add up without the
  // steps of 8 bits.
  const floats =
    gl.getExtension("EXT_color_buffer_float") !== null || gl.getExtension("EXT_color_buffer_half_float") !== null;
  let textureBytes = 0;

  /** The frame's map in device pixels, for the shaders. */
  const shape = () => {
    const s = shapeOf(frame);
    return {
      ends: [frame.far.x * dpr, frame.near.x * dpr, frame.far.bottom * dpr, frame.near.bottom * dpr] as const,
      shape: [s.farHalf * dpr, s.nearHalf * dpr, s.depth, s.flare] as const,
    };
  };
  let mapped = shape();
  const setPlace = (at: (name: string) => WebGLUniformLocation | null) => {
    gl.uniform4f(at("u_ends"), ...mapped.ends);
    gl.uniform4f(at("u_shape"), ...mapped.shape);
  };

  function applyLines(
    colour: [number, number, number, number],
    mode: { pulse?: boolean; still?: boolean; edges?: boolean; kind?: number; phase?: number },
    time: number,
    offset = 0,
  ) {
    gl.useProgram(lines);
    setPlace(lu);
    gl.uniform2f(lu("u_res"), width, height);
    gl.uniform1f(lu("u_offset"), offset);
    gl.uniform4f(lu("u_colour"), ...colour);
    const palette = paletteOf(inks);
    gl.uniform3f(lu("u_young"), ...palette.young);
    gl.uniform4f(lu("u_fibre"), ...palette.fibre);
    gl.uniform1f(lu("u_time"), time);
    gl.uniform1f(lu("u_pulse"), mode.pulse ? 1 : 0);
    gl.uniform1f(lu("u_still"), mode.still ? 1 : 0);
    gl.uniform1f(lu("u_edges"), mode.edges ? 1 : 0);
    gl.uniform1f(lu("u_kind"), mode.kind ?? -1);
    gl.uniform1f(lu("u_phase"), mode.phase ?? -1);
    gl.uniform1f(lu("u_eras"), layout.eras);
  }

  function applyDots(colour: [number, number, number, number], flare: boolean, time: number) {
    gl.useProgram(dotsProgram);
    setPlace(du);
    gl.uniform2f(du("u_res"), width, height);
    gl.uniform1f(du("u_size"), 2 * dpr);
    gl.uniform1f(du("u_time"), time);
    gl.uniform1f(du("u_flare"), flare ? 1 : 0);
    // How many grains deep a column of new versions lies at the near end: the ids' spacing against a grain's size.
    gl.uniform1f(du("u_crowd"), (2 * dpr) / Math.max(0.05, spreadOf(frame, dpr) / layout.widest));
    gl.uniform4f(du("u_colour"), ...colour);
  }

  /** The still field, into the texture, with its mipmaps (the composite's glow). */
  function drawStill() {
    const before = { ...work };
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (floats) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    textureBytes = Math.round(width * height * (floats ? 8 : 4) * (4 / 3));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Density: everything is added up here (the composite maps it to ink).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const a = lineAlpha(layout, spreadOf(frame, dpr));
    const palette = paletteOf(inks);
    applyLines([...palette.line, a], { still: true }, 0);
    drawLines(all);
    // The showcase's journeys (the first families): drawn again, stronger, two pixels wide with a soft glow, the focal
    // threads.
    // Where the showcase's families are more than a seventh of the lines (a phone's sample), the strong threads are
    // lighter by as much, so that they stay threads and never fill a band.
    const close = Math.max(0.25, Math.min(1, (0.15 * layout.shown) / Math.max(1, layout.focusIds)));
    if (layout.focusIds > 0)
      for (const [offset, share] of [
        [-1.5, 0.3],
        [-0.5, 1],
        [0.5, 1],
        [1.5, 0.3],
      ] as const) {
        applyLines([...palette.focal, palette.focalAlpha * share * close], {}, 0, offset * dpr);
        drawLines(showcase);
      }
    // The journey this visit follows: the strongest of all.
    if (journey)
      for (const offset of [-0.6, 0, 0.6]) {
        applyLines([...palette.focal, palette.journeyAlpha * close], {}, 0, offset * dpr);
        drawLines(journey);
      }
    const ea = edgeAlpha(layout, frame, dpr);
    applyLines([...inks.history, Math.min(0.7, ea)], { edges: true }, 0);
    drawCurves(edgesOne);
    applyLines([...inks.event, ea], { edges: true }, 0);
    drawCurves(edgesFan);
    applyDots([...palette.dots, palette.dotAlpha], false, 0);
    gl.bindVertexArray(grains.vao);
    gl.drawArrays(gl.POINTS, 0, grains.count);
    count(grains.count);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    work.stillDrawCalls = work.drawCalls - before.drawCalls;
    work.stillVertices = work.vertices - before.vertices;
    dirty = false;
  }

  /** The travelling light: in the dark a comet of light added to the field; in the light a cut of the paper along the
   *  line with a bead of deep ink in it (the event hue along an edge), and the grains it passes flaring. */
  function drawLight(seconds: number, light: number) {
    const palette = paletteOf(inks);
    const cut: [number, number][] = inks.dark
      ? [
          [-1.2, 0.32],
          [1.2, 0.32],
          [-2.6, 0.1],
          [2.6, 0.1],
        ]
      : [
          [-2.5, 0.55],
          [-1.5, 0.85],
          [1.5, 0.85],
          [2.5, 0.55],
        ];
    const core: [number, number][] = inks.dark
      ? [[0, 0.95]]
      : [
          [-0.4, 0.95],
          [0.4, 0.95],
        ];
    // The journey of this visit carries the first light: its head leaves the far end as the light fades in.
    const startAt = (REVEAL_MS * LIGHT_FROM) / 1000;
    const journeyPhase = (speed: number) => (((0.16 - startAt * speed) % 1) + 1) % 1;
    const passes = (offsets: [number, number][], rgb: Rgb, edgeRgb: Rgb) => {
      for (const [offset, alpha] of offsets) {
        applyLines([...rgb, alpha * light], { pulse: true }, seconds, offset * dpr);
        drawLines(pulses);
        if (journey) {
          applyLines([...rgb, alpha * light], { pulse: true, phase: journeyPhase(0.05) }, seconds, offset * dpr);
          drawLines(journey);
        }
        applyLines([...edgeRgb, alpha * light], { pulse: true, edges: true }, seconds, offset * dpr);
        drawCurves(pulseEdges);
      }
    };
    if (inks.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    passes(cut, palette.halo, inks.dark ? inks.event : palette.halo);
    passes(core, palette.core, inks.event);
    applyDots([...(inks.dark ? palette.core : inks.history), 0.9 * light], true, seconds);
    gl.bindVertexArray(flares.vao);
    gl.drawArrays(gl.POINTS, 0, flares.count);
    count(flares.count);
  }

  /** One frame at `elapsed` ms since the field began. */
  function draw(elapsed: number) {
    if (ended) return;
    const t0 = performance.now();
    work.drawCalls = 0;
    work.vertices = 0;
    if (dirty) drawStill();
    else {
      work.stillDrawCalls = 0;
      work.stillVertices = 0;
    }
    const shown = reduced ? REVEAL_MS : elapsed;
    const reveal = Math.min(1, shown / REVEAL_MS);
    const eased = 1 - (1 - reveal) ** 3;
    const seconds = elapsed / 1000;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (inks.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(qu("u_field"), 0);
    gl.uniform2f(qu("u_res"), width, height);
    setPlace(qu);
    gl.uniform1f(qu("u_reveal"), reveal >= 1 ? 2 : -0.06 + 1.12 * eased);
    gl.uniform3f(qu("u_pointer"), (pointer?.x ?? 0) * dpr, (pointer?.y ?? 0) * dpr, pointer ? 1 : 0);
    gl.uniform1f(qu("u_radius"), 170 * dpr);
    const palette = paletteOf(inks);
    gl.uniform3f(qu("u_tint"), ...inks.history);
    gl.uniform3f(qu("u_glow"), ...palette.glow);
    gl.uniform3f(qu("u_deep"), ...palette.deep);
    gl.uniform1f(qu("u_gain"), palette.gain);
    gl.uniform1f(qu("u_dark"), inks.dark ? 1 : 0);
    gl.uniform1f(qu("u_bloom"), palette.bloom);
    gl.uniform1f(qu("u_floor"), palette.floor);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    count(4);
    const light = reduced ? 0 : Math.min(1, Math.max(0, (shown - REVEAL_MS * LIGHT_FROM) / LIGHT_IN_MS));
    if (light > 0) drawLight(seconds, light);
    if (lift >= 0 && !reduced) drawLift(palette.lift);
    gl.bindVertexArray(null);
    times.drawMs += performance.now() - t0;
    times.frames++;
  }

  /** The family under the pointer, lifted: its lines in full ink, each of its edges in the hue of its kind. */
  function drawLift(ink: Rgb) {
    const first = layout.familyOf[2 * lift] ?? lift;
    const last = layout.familyOf[2 * lift + 1] ?? lift;
    const s0 = layout.segmentStart[first] ?? 0;
    const s1 = layout.segmentStart[last + 1] ?? 0;
    const e0 = layout.edgeStart[first] ?? 0;
    const e1 = layout.edgeStart[last + 1] ?? 0;
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const offset of [-0.6 * dpr, 0, 0.6 * dpr]) {
      applyLines([...ink, 1], {}, 0, offset);
      drawCurves(threads, s0, s1);
      applyLines([...inks.history, 1], { edges: true, kind: 0 }, 0, offset);
      drawCurves(allEdges, e0, e1);
      applyLines([...inks.event, 1], { edges: true, kind: 1 }, 0, offset);
      drawCurves(allEdges, e0, e1);
    }
  }

  function loop(now: number) {
    raf = 0;
    if (start < 0) start = now;
    if (times.last) times.frameMs += now - times.last;
    times.last = now;
    draw(now - start);
    if (running && !reduced) raf = requestAnimationFrame(loop);
  }

  function request() {
    if (stepped || ended) return;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  return {
    mode: "webgl2",
    element: gl.canvas as HTMLCanvasElement,
    moving: !reduced,
    resize(w, h, f) {
      const size = devicePixels(w, h);
      dpr = size.dpr;
      width = size.width;
      height = size.height;
      const canvas = gl.canvas as HTMLCanvasElement;
      canvas.width = width;
      canvas.height = height;
      frame = f;
      mapped = shape();
      dirty = true;
      request();
    },
    setColours(c) {
      inks = c;
      dirty = true;
      request();
    },
    setPointer(p, id) {
      if (reduced) return -1;
      pointer = p;
      lift = id;
      request();
      return id;
    },
    setRunning(on) {
      running = on;
      if (on) request();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        times.last = 0;
      }
    },
    stats(): FrameStats {
      return {
        frames: times.frames,
        meanFrameMs: times.frames > 1 ? times.frameMs / (times.frames - 1) : 0,
        meanDrawMs: times.frames ? times.drawMs / times.frames : 0,
      };
    },
    work(): FieldWork {
      return { ...work, texture: { width, height, bytes: textureBytes } };
    },
    drawAt(seconds) {
      draw(seconds * 1000);
    },
    destroy() {
      ended = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/** The weight classes of the 2D still: the threads' weights (as the shader gives them, from each line's phase) in a few
 *  classes, each class drawn at its own alpha. */
const CLASSES = 6;

/** The still field on a 2D canvas (without WebGL2, or where WebGL draws in software): the same lines, edges and grains
 *  as the WebGL still, each line a single hairline at a low alpha by its weight, drawn in batches of one path per
 *  weight class and hue, in slices of a few milliseconds one a frame, so that no long task holds the page. On a device
 *  of four cores or fewer, 1,500 of the lines (every journey's, then an even share of the others). No light, no lift. */
function createStill(canvas: HTMLCanvasElement, layout: LineageLayout, focal: Lines | null): Field {
  const context = stillContext(canvas);
  let job = 0;
  let painted = 0;
  let size: { w: number; h: number; frame: FieldFrame } = {
    w: 1,
    h: 1,
    frame: { far: { x: 0, top: 0, bottom: 1 }, near: { x: 1, top: 0, bottom: 1 } },
  };
  let inks: Inks = LIGHT_INKS;
  const slow = typeof navigator !== "undefined" && (navigator.hardwareConcurrency || 8) <= 4;
  const share = slow ? Math.min(1, 1500 / Math.max(1, layout.shown)) : 1;
  const css = (rgb: Rgb, a: number) =>
    `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")} / ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  /** A line's phase and its weight class, as the shader reads them. */
  const classOf = (meta: number, fibre: readonly number[]) => {
    const phase = meta - Math.floor(meta);
    const h = (phase * 13.731) % 1;
    const weight = (fibre[0] ?? 0) + (fibre[1] ?? 0) * h ** (fibre[2] ?? 1);
    const top = (fibre[0] ?? 0) + (fibre[1] ?? 0);
    return Math.min(CLASSES - 1, Math.floor((weight / top) ** 0.5 * CLASSES));
  };
  function paint() {
    if (!context) return;
    if (job) cancelAnimationFrame(job);
    const { dpr, width, height } = devicePixels(size.w, size.h);
    canvas.width = width;
    canvas.height = height;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.w, size.h);
    const f = size.frame;
    const place = placer(f);
    const palette = paletteOf(inks);
    const base = lineAlpha(layout, spreadOf(f, dpr));
    context.globalCompositeOperation = inks.dark ? "lighter" : "source-over";
    context.lineCap = "butt";
    // Each curve as the shaders draw it: x along, y by a smooth step, placed on the field.
    const trace = (path: Path2D, data: Float32Array, o: number, straight: boolean) => {
      const x0 = data[o] ?? 0;
      const y0 = data[o + 1] ?? 0;
      const x1 = data[o + 2] ?? 0;
      const y1 = data[o + 3] ?? 0;
      const n = straight ? 1 : 6;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = place(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t * t * (3 - 2 * t));
        if (i === 0) path.moveTo(p.x, p.y);
        else path.lineTo(p.x, p.y);
      }
    };
    // The work, as batches: each a set of rows of one array, one stroke.
    interface Batch {
      data: Float32Array;
      stride: number;
      rows: number[];
      straight: boolean;
      style: string;
      width: number;
    }
    const batches: Batch[] = [];
    const meanWeight = palette.fibre[0] + palette.fibre[1] / (palette.fibre[2] + 1);
    for (const [data, straight] of [
      [layout.lines.all.straight, true],
      [layout.lines.all.curved, false],
    ] as const) {
      // By weight class, and by era: the first assembly's ids in the line's ink, the later ones toward the young ids'
      // colour and lighter, as the shader draws them.
      const rows: number[][] = Array.from({ length: CLASSES * 2 }, () => []);
      for (let r = 0; r < data.length / SEGMENT_FLOATS; r++) {
        const meta = data[r * SEGMENT_FLOATS + 5] ?? 0;
        if (share < 1 && ((meta % 1) * 7.77) % 1 > share) continue;
        rows[classOf(meta, palette.fibre) + (meta >= 1 ? CLASSES : 0)]?.push(r);
      }
      rows.forEach((list, i) => {
        const c = i % CLASSES;
        const young = i >= CLASSES;
        const weight = ((c + 0.5) / CLASSES) ** 2 * (palette.fibre[0] + palette.fibre[1]);
        batches.push({
          data,
          stride: SEGMENT_FLOATS,
          rows: list,
          straight,
          style: css(
            young ? palette.young : palette.line,
            Math.min(0.8, base * (weight / meanWeight) * (young ? 0.62 : 1) * 0.65),
          ),
          width: 1 / dpr,
        });
      });
    }
    if (focal)
      for (const [data, straight] of [
        [focal.straight, true],
        [focal.curved, false],
      ] as const)
        batches.push({
          data,
          stride: SEGMENT_FLOATS,
          rows: Array.from({ length: data.length / SEGMENT_FLOATS }, (_, i) => i),
          straight,
          style: css(palette.focal, 0.75),
          width: 1.6,
        });
    const ea = Math.min(0.9, edgeAlpha(layout, f, dpr));
    for (const kind of [0, 1]) {
      const rows: number[] = [];
      for (let e = 0; e < layout.edges.length / EDGE_FLOATS; e++)
        if ((layout.edges[e * EDGE_FLOATS + 4] ?? 0) === kind) rows.push(e);
      batches.push({
        data: layout.edges,
        stride: EDGE_FLOATS,
        rows,
        straight: false,
        style: css(kind ? inks.event : inks.history, kind ? ea : Math.min(0.6, ea)),
        width: 1,
      });
    }
    let b = 0;
    let row = 0;
    let path = new Path2D();
    const CHUNK = 400;
    const step = () => {
      job = 0;
      const began = performance.now();
      while (b < batches.length && performance.now() - began < 6) {
        const batch = batches[b];
        if (!batch) break;
        const end = Math.min(batch.rows.length, row + CHUNK);
        for (; row < end; row++) trace(path, batch.data, (batch.rows[row] ?? 0) * batch.stride, batch.straight);
        // One stroke a chunk: lines of a chunk do not add up where they cross, chunks do (the density, coarsely).
        context.strokeStyle = batch.style;
        context.lineWidth = batch.width;
        context.stroke(path);
        path = new Path2D();
        if (row >= batch.rows.length) {
          b++;
          row = 0;
        }
      }
      if (b < batches.length) {
        job = requestAnimationFrame(step);
        return;
      }
      // The grains of the new versions.
      // Each lighter where they lie deep (a release that re-versions many ids is a column of grains, never a bar).
      const crowd = Math.max(1, 2 / Math.max(0.05, spreadOf(f, dpr) / layout.widest));
      context.fillStyle = css(palette.dots, Math.min(0.9, (palette.dotAlpha * 1.6) / crowd));
      for (let d = 0; d < layout.dots.length; d += DOT_FLOATS) {
        const p = place(layout.dots[d] ?? 0, layout.dots[d + 1] ?? 0);
        const jitter = ((((d * 0.618034) % 1) + 1) % 1) - 0.5;
        context.fillRect(p.x - 1 + jitter * 1.2, p.y - 1, 2, 2);
      }
      painted++;
    };
    job = requestAnimationFrame(step);
  }
  return {
    mode: "canvas2d",
    element: canvas,
    moving: false,
    resize(w, h, frame) {
      size = { w, h, frame };
      paint();
    },
    setColours(c) {
      inks = c;
      paint();
    },
    setPointer: () => -1,
    setRunning: () => undefined,
    // The drawings finished (one each time the field is drawn again).
    stats: () => ({ frames: painted, meanFrameMs: 0, meanDrawMs: 0 }),
    work: () => null,
    drawAt: () => undefined,
    destroy() {
      if (job) cancelAnimationFrame(job);
    },
  };
}
