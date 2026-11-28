/// <reference types="vite/client" />
// The home's third picture: the showcase's most convoluted journeys as a sculpture of light that turns slowly about
// the axis of time (the model, its layout and its projection: lib/hero/constellationModel.ts). Each id is a star where
// it begins and a thread over the releases at which it is active; each step of an answer's path a luminous curve in the
// hue of its kind, the fans of a split or merge the brightest. Depth is real: perspective, a fog that lets the far side
// recede, and a depth of field held small (what stands off the axis softens, keeping its light). A light travels each
// journey from the id asked for to its answer; the id of the journey that turns to face the viewer appears beside it.
// The pointer tilts the whole toward it and lifts the journey under it (visual only: the picture is hidden from
// assistive technology and never focused). WebGL2 draws it; where there is none, or WebGL runs in software (no GPU),
// one still drawing on a 2D canvas, drawn in slices so no long task holds the page; under reduced motion one still frame.
import {
  fitPose,
  KIND,
  project,
  ROLE,
  roomOf,
  SEGMENT,
  STAR,
  TILT,
  type Constellation,
  type Pose,
  type Rect,
} from "../../lib/hero/constellationModel";
import { drawsInSoftware } from "./field";

export type Rgb = [number, number, number];

export interface ConstellationColours {
  ink: Rgb;
  history: Rgb;
  event: Rgb;
  handoff: Rgb;
  external: Rgb;
  dark: boolean;
}

export interface ConstellationView {
  mode: "webgl2" | "canvas2d";
  /** The canvas drawn on (a fresh one where WebGL was given up). */
  element: HTMLCanvasElement;
  /** The field's size (CSS px) and the boxes of the hero's words and caption in it: the room the picture fills. */
  resize(width: number, height: number, words: Rect | null, caption: Rect | null): void;
  setColours(colours: ConstellationColours): void;
  /** The pointer (CSS px of the field) or null; returns the journey whose star is nearest it, or -1. */
  setPointer(point: { x: number; y: number } | null): number;
  setRunning(running: boolean): void;
  stats(): { frames: number; meanFrameMs: number; meanDrawMs: number };
  destroy(): void;
}

/** How far beyond each end of the axis its release is written (CSS px, to the label's centre). */
const AXIS_LABEL_PX = 18;
/** A star's radius (CSS px) before its size, role and depth. */
const STAR_RADIUS = 1.7;
/** A full turn about the axis of time, in seconds. */
const TURN_SECONDS = 120;
/** The reveal along time, in seconds. */
const REVEAL_SECONDS = 2.6;
/** Seconds of one journey's travelling light. */
const PULSE_SECONDS = 14;
/** Room kept free round the picture (CSS px): across, for the release at each end of the axis; up and down. */
const MARGIN = { x: 24, y: 16 } as const;
/** How the axis of time is seen: rolled a little on a wide screen (rising toward the present), and turned so that
 *  the last release stands toward the viewer and the first recedes. */
const VIEW = { roll: 0.1, yaw: 0.62 } as const;
/** How far short of facing the viewer the most convoluted journey stands when the picture is first seen. */
const FIRST_TURN = 0.22;

/** The look of each theme: the thread's core width, the halo (dark: light glows), the softening per unit of depth (CSS
 *  px), the far side's share of light, the alphas of an id's thread, a step, the axis, and the travelling light. */
const LOOK = {
  dark: { core: 1.1, halo: 3.2, haloStrength: 0.16, blur: 2.4, far: 0.2, run: 0.36, step: 0.6, axis: 0.24, pulse: 1.6 },
  light: { core: 0.9, halo: 0, haloStrength: 0, blur: 1.6, far: 0.2, run: 0.3, step: 0.5, axis: 0.22, pulse: 1.1 },
} as const;

const PLACE = `
uniform vec2 u_res;
uniform vec3 u_pose;  // turn, yaw, roll
uniform vec4 u_place; // centre x, centre y, scale (device px), the camera's distance
// A point on the screen (device px), its depth (negative toward the viewer) and its perspective.
vec4 place(vec3 p) {
  float c = cos(u_pose.x), s = sin(u_pose.x);
  vec3 q = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  float cy = cos(u_pose.y), sy = sin(u_pose.y);
  q = vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
  float k = u_place.w / (u_place.w + q.z);
  vec2 v = q.xy * k;
  float cr = cos(u_pose.z), sr = sin(u_pose.z);
  v = vec2(cr * v.x - sr * v.y, sr * v.x + cr * v.y);
  return vec4(u_place.xy + vec2(v.x, -v.y) * u_place.z, q.z, k);
}
float hash(float j) { return fract(sin(j * 12.9898 + 4.1) * 43758.5453); }
`;

const SEGMENT_VERTEX = `#version 300 es
precision highp float;
in vec2 a_corner; // along (0, 1), side (-1, 1)
in vec3 a_p0;
in vec3 a_p1;
in vec4 a_meta;   // kind, journey, place in the path at each end
uniform float u_dpr;
uniform float u_time;
uniform float u_reveal;
uniform float u_focus;
uniform vec3 u_hues[6];
uniform vec4 u_look;   // core (CSS px), halo (CSS px), softening per unit of depth (CSS px), the far side's light
uniform vec4 u_alphas; // an id's thread, a step, the axis, the travelling light
${PLACE}
out vec3 v_rgb;
out float v_alpha;
out float v_across;
out float v_sigma;
out float v_halo;
void main() {
  vec4 s0 = place(a_p0);
  vec4 s1 = place(a_p1);
  float along = a_corner.x;
  vec4 s = mix(s0, s1, along);
  int kind = int(a_meta.x + 0.5);
  float blur = abs(s.z) * u_look.z * u_dpr;
  float weight = kind == 0 ? 0.75 : kind == 2 ? 1.3 : kind == 5 ? 0.7 : 1.0;
  float core = u_look.x * u_dpr * s.w * weight;
  float sigma = max(0.45 * u_dpr, 0.5 * core + 0.5 * blur);
  float halo = u_look.y * u_dpr * s.w;
  float reach = 3.0 * sigma + 3.0 * halo + 1.0;
  vec2 d = s1.xy - s0.xy;
  float len = length(d);
  vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  vec2 pos = s.xy + n * a_corner.y * reach;
  vec2 clip = pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_across = a_corner.y * reach;
  v_sigma = sigma;
  v_halo = halo;
  // Steps through other databases gather where an answer bridges many ids at once: a lighter hand there.
  float base = kind == 0 ? u_alphas.x : kind == 5 ? u_alphas.z : kind == 4 ? 0.75 * u_alphas.y : u_alphas.y;
  // Softened by depth, a thread keeps its light (spread wider, dimmer); the far side recedes into the paper.
  float energy = (0.5 * core + 0.45 * u_dpr) / sigma;
  float fog = mix(1.0, u_look.w, smoothstep(-0.3, 0.55, s.z));
  float x = mix(a_p0.x, a_p1.x, along);
  float front = -1.2 + 2.4 * u_reveal;
  float shown = 1.0 - smoothstep(front - 0.18, front, x);
  bool mine = u_focus < 0.0 || abs(a_meta.y - u_focus) < 0.5 || kind == 5;
  float t = mix(a_meta.z, a_meta.w, along);
  float head = fract(u_time / ${PULSE_SECONDS.toFixed(1)} + hash(a_meta.y)) * 1.7 - 0.35;
  float pulse = kind == 5 ? 0.0 : exp(-pow((t - head) / 0.07, 2.0)) * u_alphas.w;
  v_rgb = u_hues[kind];
  v_alpha = base * energy * fog * shown * (mine ? 1.0 : 0.2) * (1.0 + pulse * (mine ? 1.0 : 0.3));
}`;

const SEGMENT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_rgb;
in float v_alpha;
in float v_across;
in float v_sigma;
in float v_halo;
uniform float u_haloStrength;
out vec4 colour;
void main() {
  float g = exp(-0.5 * v_across * v_across / (v_sigma * v_sigma));
  float h = v_halo > 0.0 ? exp(-abs(v_across) / v_halo) * u_haloStrength : 0.0;
  float a = clamp(v_alpha * (g + h), 0.0, 1.0);
  colour = vec4(v_rgb * a, a);
}`;

const STAR_VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec4 a_meta; // journey, size, place in the path, role
uniform float u_dpr;
uniform float u_time;
uniform float u_reveal;
uniform float u_focus;
uniform float u_star;
uniform vec4 u_look;
uniform float u_dark;
uniform vec3 u_inks[4]; // an id, the id asked for, an answer, an id of another database
${PLACE}
out vec3 v_rgb;
out float v_alpha;
out float v_core;
out float v_knock;
flat out int v_role;
void main() {
  vec4 s = place(a_pos);
  gl_Position = vec4((s.xy / u_res * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
  int role = int(a_meta.w + 0.5);
  float blur = abs(s.z) * u_look.z * u_dpr;
  float r = u_star * u_dpr * s.w * (0.8 + 0.25 * (a_meta.y - 1.0)) * (role == 2 ? 1.5 : role == 3 ? 0.8 : 1.0);
  float total = r + 0.6 * blur;
  float sprite = min(160.0, 2.0 * total * (role == 2 ? 6.0 : role == 1 ? 3.6 : 3.0) + 2.0);
  gl_PointSize = sprite;
  v_core = total / (0.5 * sprite);
  float shown = 1.0 - smoothstep(-1.2 + 2.4 * u_reveal - 0.18, -1.2 + 2.4 * u_reveal, a_pos.x);
  float fog = mix(1.0, u_look.w, smoothstep(-0.3, 0.55, s.z));
  bool mine = u_focus < 0.0 || abs(a_meta.x - u_focus) < 0.5;
  // Brighter along the path toward its answer; the answer brightest.
  float bright = role == 2 ? 1.0 : role == 1 ? 0.95 : 0.5 + 0.45 * a_meta.z;
  v_alpha = bright * fog * shown * (mine ? 1.0 : 0.2) * (r * r) / (total * total);
  v_knock = (1.0 - u_dark) * (1.0 - smoothstep(-0.1, 0.35, s.z)) * shown * (mine ? 1.0 : 0.2);
  v_rgb = u_inks[role];
  v_role = role;
}`;

const STAR_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_rgb;
in float v_alpha;
in float v_core;
in float v_knock;
flat in int v_role;
uniform float u_dark;
uniform vec3 u_paper;
out vec4 colour;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = length(c);
  float core = exp(-0.5 * pow(d / (0.55 * v_core), 2.0));
  float halo = u_dark * exp(-d / (0.9 * v_core)) * 0.32;
  float mark = 0.0;
  if (v_role == 2) {
    // An answer: a fine cross of light (dark), a ring of ink (light).
    float glint = exp(-abs(c.x) / 0.018) * exp(-abs(c.y) / 0.42) + exp(-abs(c.y) / 0.018) * exp(-abs(c.x) / 0.42);
    float ring = exp(-pow((d - 1.9 * v_core) / (0.16 * v_core), 2.0));
    mark = mix(ring * 0.6, glint * 0.7, u_dark);
  } else if (v_role == 1) {
    // The id asked for: a ring about it.
    mark = exp(-pow((d - 1.7 * v_core) / (0.14 * v_core), 2.0)) * mix(0.55, 0.85, u_dark);
  }
  float ink = clamp((core + halo + mark) * v_alpha, 0.0, 1.0);
  float knock = v_knock * (1.0 - smoothstep(1.15 * v_core, 1.45 * v_core, d)) * 0.9;
  float a = ink + knock * (1.0 - ink);
  colour = vec4(v_rgb * ink + u_paper * knock * (1.0 - ink), a);
}`;

/** Development only (none of it is in the production bundle): `?heroclock=<seconds>` draws the moving picture at that
 *  moment, even where WebGL runs in software and under reduced motion, and `window.idtrackHeroClock(seconds)` draws
 *  another moment: frame sequences of the motion without a GPU, at fixed steps of time. */
function devClock(): number | null {
  const asked = new URLSearchParams(window.location.search).get("heroclock");
  return asked === null ? null : Number(asked) || 0;
}

function parseColour(value: string): Rgb {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return [1, 1, 1];
  probe.fillStyle = value.trim() || "#fff";
  const hex = probe.fillStyle;
  if (hex.startsWith("#") && hex.length === 7)
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
  const parts = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(hex);
  return parts ? [Number(parts[1]) / 255, Number(parts[2]) / 255, Number(parts[3]) / 255] : [1, 1, 1];
}

const mixRgb = (a: Rgb, b: Rgb, f: number): Rgb => [0, 1, 2].map((i) => (a[i] ?? 0) * (1 - f) + (b[i] ?? 0) * f) as Rgb;

/** The hues of the segments' kinds and the inks of the stars' roles, in a theme. */
function palette(c: ConstellationColours) {
  const white: Rgb = [1, 1, 1];
  const light = (rgb: Rgb) => (c.dark ? mixRgb(rgb, white, 0.18) : rgb);
  const hues: Rgb[] = [
    c.dark ? mixRgb(c.history, white, 0.35) : mixRgb(c.history, c.ink, 0.2),
    light(c.history),
    light(c.event),
    light(c.handoff),
    light(c.external),
    c.dark ? [0.75, 0.8, 0.9] : c.ink,
  ];
  const inks: Rgb[] = c.dark
    ? [[0.86, 0.9, 1], mixRgb(c.history, white, 0.5), [1, 0.96, 0.88], mixRgb(c.external, white, 0.35)]
    : [c.ink, c.history, c.ink, c.external];
  return { hues, inks };
}

/** The scale of threads and stars with the picture's own (a picture drawn small keeps fine lines and small stars). */
const sizeOf = (pose: Pose) => Math.max(0.6, Math.min(1.2, pose.scale / 300));

/** How far the reveal along time has drawn the picture at time x (0 not yet, 1 drawn), as the shaders draw it. */
function revealed(x: number, reveal: number): number {
  const front = -1.2 + 2.4 * reveal;
  const f = Math.max(0, Math.min(1, (x - (front - 0.18)) / 0.18));
  return 1 - f * f * (3 - 2 * f);
}

/** The labels of the picture (hidden from assistive technology with the field): each journey's id, shown as its
 *  strand turns to face the viewer, and the first and last release at the ends of the axis. */
function createLabels(layer: HTMLElement, model: Constellation) {
  const box = document.createElement("div");
  box.className = "hero2__stars";
  const ids = model.journeys.map((j) => {
    const span = document.createElement("span");
    span.className = "hero2__star-id mono";
    span.textContent = j.identifier;
    box.append(span);
    return span;
  });
  const ends = [model.first, model.last].map((release) => {
    const span = document.createElement("span");
    span.className = "hero2__axis-end mono";
    span.textContent = String(release);
    box.append(span);
    return span;
  });
  layer.append(box);
  const shown = new Array<number>(ids.length).fill(-1);
  return {
    place(pose: Pose, room: Rect, focus: number, reveal: number) {
      // One id at a time: the journey whose strand most squarely faces the viewer (1: straight at them), as it does.
      let facing = 0.93;
      let face = -1;
      model.journeys.forEach((j, i) => {
        const f = -Math.sin(j.angle + pose.turn);
        if (f > facing) {
          facing = f;
          face = i;
        }
      });
      // Each release a little beyond its end of the axis, along the axis as it is seen.
      const a = project(pose, -1, 0, 0);
      const b = project(pose, 1, 0, 0);
      const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      model.journeys.forEach((j, i) => {
        const span = ids[i];
        if (!span) return;
        const o = j.anchor * STAR;
        const x = model.stars[o] ?? 0;
        let opacity = focus >= 0 || i !== face ? 0 : Math.min(1, (facing - 0.93) / 0.05) * revealed(x, reveal);
        opacity = Math.round(opacity * 50) / 50;
        if (opacity === 0 && shown[i] === 0) return;
        shown[i] = opacity;
        span.style.visibility = opacity > 0 ? "visible" : "hidden";
        span.style.opacity = String(opacity * 0.9);
        if (opacity === 0) return;
        const q = project(pose, x, model.stars[o + 1] ?? 0, model.stars[o + 2] ?? 0);
        // Beside its star, toward the room's middle, and away from a release written at an end of the axis.
        let left = q.x > (room.left + room.right) / 2;
        const near = [a, b].find((e) => Math.hypot(e.x - q.x, e.y - q.y) < 72);
        if (near) left = near.x > q.x;
        // Never past the room's edge: a label that would cross it goes to the other side of its star.
        const width = span.offsetWidth + 24;
        if (left && q.x - width < room.left) left = false;
        else if (!left && q.x + width > room.right) left = true;
        span.classList.toggle("hero2__star-id--left", left);
        span.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`;
      });
      ends.forEach((span, i) => {
        const end = i === 0 ? a : b;
        const out = (i === 0 ? -1 : 1) * AXIS_LABEL_PX;
        const x = end.x + along.x * out;
        const y = end.y + along.y * out;
        span.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        span.style.opacity = String(revealed(i === 0 ? -1 : 1, reveal));
      });
    },
    remove() {
      box.remove();
    },
  };
}

export function createConstellation(
  canvas: HTMLCanvasElement,
  layer: HTMLElement,
  model: Constellation,
  reducedMotion: boolean,
): ConstellationView {
  const clock = import.meta.env.DEV ? devClock() : null;
  const labels = createLabels(layer, model);
  let dpr = 1;
  let width = 1;
  let height = 1;
  let room: Rect = { left: 0, top: 0, right: 1, bottom: 1 };
  // The most convoluted journey (the first) is first seen nearly facing the viewer.
  const firstTurn = -Math.PI / 2 - (model.journeys[0]?.angle ?? -Math.PI / 2) + FIRST_TURN;
  let rest: Pose = { turn: firstTurn, yaw: 0, roll: 0, distance: 2.6, cx: 0, cy: 0, scale: 1 };
  let colours: ConstellationColours = {
    ink: [0.05, 0.07, 0.09],
    history: [0.18, 0.37, 0.82],
    event: [0.76, 0.29, 0],
    handoff: [0.75, 0.22, 0.6],
    external: [0, 0.5, 0.36],
    dark: false,
  };
  let paper: Rgb = [1, 1, 1];
  let focus = -1;
  // The pointer's pull (target and present): yaw toward it across, a little more turn toward it up and down.
  const pull = { yaw: 0, turn: 0, toYaw: 0, toTurn: 0 };
  const motion = { running: false, raf: 0, start: -1, previous: -1, last: 0 };
  const times = { frames: 0, frameMs: 0, drawMs: 0 };
  const forced = clock !== null;
  let quiet = reducedMotion && !forced;

  /** The pose at `seconds` after the picture began. */
  const poseAt = (seconds: number): Pose => ({
    ...rest,
    turn: rest.turn + (quiet ? 0 : (seconds / TURN_SECONDS) * Math.PI * 2) + pull.turn,
    yaw: rest.yaw + pull.yaw,
  });
  const revealAt = (seconds: number) => (quiet ? 1 : 1 - Math.pow(1 - Math.min(1, seconds / REVEAL_SECONDS), 3));

  const measure = (w: number, h: number, words: Rect | null, caption: Rect | null) => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.round(w * dpr));
    height = Math.max(1, Math.round(h * dpr));
    room = roomOf(w, h, words, caption);
    const wide = room.left > 16;
    const inner = { ...room, left: room.left + MARGIN.x, right: room.right - MARGIN.x };
    rest = { ...fitPose(model, inner, MARGIN.y, { roll: wide ? VIEW.roll : 0, yaw: VIEW.yaw }), turn: firstTurn };
  };
  const readPaper = () => {
    paper = parseColour(getComputedStyle(layer).getPropertyValue("--paper"));
  };

  const webgl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!webgl) return still(canvas);
  const gl: WebGL2RenderingContext = webgl;
  // In software (no GPU) WebGL would hold the page: the still drawing on a 2D canvas instead (in development the
  // clock may ask for the moving picture there, to see its motion).
  if (drawsInSoftware(gl) && !forced) return still(fresh(canvas, gl));
  let programs: { segments: Program; stars: Program };
  try {
    programs = {
      segments: program(gl, SEGMENT_VERTEX, SEGMENT_FRAGMENT),
      stars: program(gl, STAR_VERTEX, STAR_FRAGMENT),
    };
  } catch {
    return still(fresh(canvas, gl));
  }
  const segmentVao = segmentArray(gl, programs.segments.handle, model.segments);
  const starVao = starArray(gl, programs.stars.handle, model.stars);
  const segmentCount = model.segments.length / SEGMENT;
  const starCount = model.stars.length / STAR;

  function common(p: Program, pose: Pose, seconds: number, reveal: number) {
    gl.useProgram(p.handle);
    gl.uniform2f(p.at("u_res"), width, height);
    gl.uniform3f(p.at("u_pose"), pose.turn, pose.yaw, pose.roll);
    gl.uniform4f(p.at("u_place"), pose.cx * dpr, pose.cy * dpr, pose.scale * dpr, pose.distance);
    gl.uniform1f(p.at("u_dpr"), dpr);
    gl.uniform1f(p.at("u_time"), quiet ? 0 : seconds);
    gl.uniform1f(p.at("u_reveal"), reveal);
    gl.uniform1f(p.at("u_focus"), focus);
    const look = colours.dark ? LOOK.dark : LOOK.light;
    const size = sizeOf(pose);
    gl.uniform4f(p.at("u_look"), look.core * size, look.halo * size, look.blur * size, look.far);
  }

  function draw(now: number) {
    const t0 = performance.now();
    if (motion.start < 0) motion.start = now;
    const seconds = (now - motion.start) / 1000;
    // The pointer's pull eases in (about a third of a second).
    const dt = motion.previous < 0 ? 0 : Math.min(0.1, Math.max(0, (now - motion.previous) / 1000));
    motion.previous = now;
    const ease = 1 - Math.exp(-dt * 5);
    pull.yaw += (pull.toYaw - pull.yaw) * ease;
    pull.turn += (pull.toTurn - pull.turn) * ease;
    const pose = poseAt(seconds);
    const reveal = revealAt(seconds);
    const look = colours.dark ? LOOK.dark : LOOK.light;
    const { hues, inks } = palette(colours);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // Dark: light adds up and glows; light: ink lies over the paper.
    if (colours.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const s = programs.segments;
    common(s, pose, seconds, reveal);
    gl.uniform3fv(s.at("u_hues"), hues.flat());
    gl.uniform4f(s.at("u_alphas"), look.run, look.step, look.axis, quiet ? 0 : look.pulse);
    gl.uniform1f(s.at("u_haloStrength"), look.haloStrength);
    gl.bindVertexArray(segmentVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segmentCount);
    if (!colours.dark) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const p = programs.stars;
    common(p, pose, seconds, reveal);
    gl.uniform1f(p.at("u_star"), STAR_RADIUS * sizeOf(pose));
    gl.uniform1f(p.at("u_dark"), colours.dark ? 1 : 0);
    gl.uniform3fv(p.at("u_inks"), inks.flat());
    gl.uniform3f(p.at("u_paper"), ...paper);
    gl.bindVertexArray(starVao);
    gl.drawArrays(gl.POINTS, 0, starCount);
    gl.bindVertexArray(null);
    labels.place(pose, room, focus, reveal);
    times.drawMs += performance.now() - t0;
    if (motion.last) times.frameMs += now - motion.last;
    motion.last = now;
    times.frames++;
  }
  const loop = (now: number) => {
    motion.raf = 0;
    draw(now);
    if (motion.running && !quiet) motion.raf = requestAnimationFrame(loop);
  };
  const request = () => {
    if (clock !== null) {
      draw(motion.start < 0 ? 0 : motion.start + clock * 1000);
      return;
    }
    if (!motion.raf) motion.raf = requestAnimationFrame(loop);
  };
  if (import.meta.env.DEV && clock !== null) {
    motion.start = 0;
    (window as unknown as { idtrackHeroClock?: (seconds: number) => void }).idtrackHeroClock = (seconds) => {
      draw(seconds * 1000);
    };
  }

  return {
    mode: "webgl2",
    element: canvas,
    resize(w, h, words, caption) {
      measure(w, h, words, caption);
      canvas.width = width;
      canvas.height = height;
      readPaper();
      request();
    },
    setColours(c) {
      colours = c;
      readPaper();
      request();
    },
    setPointer(point) {
      if (quiet) return -1;
      focus = point ? nearest(model, poseAt(currentSeconds()), point) : -1;
      const halfW = Math.max(1, (room.right - room.left) / 2);
      const halfH = Math.max(1, (room.bottom - room.top) / 2);
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      pull.toYaw = point ? clamp((point.x - (room.left + room.right) / 2) / halfW) * TILT.yaw : 0;
      pull.toTurn = point ? clamp((point.y - (room.top + room.bottom) / 2) / halfH) * TILT.turn : 0;
      request();
      return focus;
    },
    setRunning(on) {
      motion.running = on;
      if (on) request();
      else if (motion.raf) {
        cancelAnimationFrame(motion.raf);
        motion.raf = 0;
        motion.last = 0;
      }
    },
    stats: () => ({
      frames: times.frames,
      meanFrameMs: times.frames > 1 ? times.frameMs / (times.frames - 1) : 0,
      meanDrawMs: times.frames ? times.drawMs / times.frames : 0,
    }),
    destroy() {
      motion.running = false;
      if (motion.raf) cancelAnimationFrame(motion.raf);
      labels.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };

  function currentSeconds() {
    return motion.start < 0 ? 0 : ((motion.last || performance.now()) - motion.start) / 1000;
  }

  /** The still picture on a 2D canvas: the same model and pose, drawn once (in slices of about 6 ms a frame), far
   *  things first. */
  function still(target: HTMLCanvasElement): ConstellationView {
    quiet = true;
    const context = target.getContext("2d");
    let job = 0;
    const paint = () => {
      if (!context) return;
      if (job) cancelAnimationFrame(job);
      target.width = width;
      target.height = height;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const pose = poseAt(0);
      const queue = stillMarks(model, pose, colours, paper);
      labels.place(pose, room, -1, 1);
      let i = 0;
      const slice = () => {
        job = 0;
        const until = performance.now() + 6;
        while (i < queue.length && performance.now() < until) {
          const end = Math.min(queue.length, i + 200);
          for (; i < end; i++) queue[i]?.(context);
        }
        if (i < queue.length) job = requestAnimationFrame(slice);
      };
      slice();
    };
    return {
      mode: "canvas2d",
      element: target,
      resize(w, h, words, caption) {
        measure(w, h, words, caption);
        readPaper();
        paint();
      },
      setColours(c) {
        colours = c;
        readPaper();
        paint();
      },
      setPointer: () => -1,
      setRunning: () => undefined,
      stats: () => ({ frames: 0, meanFrameMs: 0, meanDrawMs: 0 }),
      destroy() {
        if (job) cancelAnimationFrame(job);
        labels.remove();
      },
    };
  }
}

/** The journey whose star is nearest the pointer (within 24 CSS px), or -1. */
function nearest(model: Constellation, pose: Pose, point: { x: number; y: number }): number {
  let best = 24;
  let journey = -1;
  for (let s = 0; s < model.stars.length / STAR; s++) {
    const o = s * STAR;
    const q = project(pose, model.stars[o] ?? 0, model.stars[o + 1] ?? 0, model.stars[o + 2] ?? 0);
    const d = Math.hypot(q.x - point.x, q.y - point.y);
    if (d < best) {
      best = d;
      journey = model.stars[o + 3] ?? -1;
    }
  }
  return journey;
}

type Mark = (context: CanvasRenderingContext2D) => void;
type Look = (typeof LOOK)["dark" | "light"];

const css = (rgb: Rgb, a: number) =>
  `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")} / ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** The share of light left at depth z (the far side recedes), as the shaders give it. */
function fogAt(look: Look, z: number) {
  const f = Math.max(0, Math.min(1, (z + 0.3) / 0.85));
  return 1 + (look.far - 1) * f * f * (3 - 2 * f);
}

/** The still picture's marks, far ones first: each segment and each star as the shaders draw them (depth softens and
 *  fades them; dark adds light, light lays ink). */
function stillMarks(model: Constellation, pose: Pose, colours: ConstellationColours, paper: Rgb): Mark[] {
  const marks = [...segmentMarks(model, pose, colours), ...starMarks(model, pose, colours, paper)];
  // Far first, so near threads and stars lie over far ones.
  marks.sort((m, n) => n.z - m.z);
  return marks.map((m) => m.draw);
}

function segmentMarks(model: Constellation, pose: Pose, colours: ConstellationColours) {
  const look = colours.dark ? LOOK.dark : LOOK.light;
  const size = sizeOf(pose);
  const { hues } = palette(colours);
  const marks: { z: number; draw: Mark }[] = [];
  const stroke = (context: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }) => {
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  };
  for (let i = 0; i < model.segments.length / SEGMENT; i++) {
    const o = i * SEGMENT;
    const a = project(pose, model.segments[o] ?? 0, model.segments[o + 1] ?? 0, model.segments[o + 2] ?? 0);
    const b = project(pose, model.segments[o + 3] ?? 0, model.segments[o + 4] ?? 0, model.segments[o + 5] ?? 0);
    const kind = model.segments[o + 6] ?? 0;
    const z = (a.z + b.z) / 2;
    const k = (a.k + b.k) / 2;
    const weight = kind === KIND.run ? 0.75 : kind === KIND.fan ? 1.3 : kind === KIND.axis ? 0.7 : 1;
    const core = look.core * size * k * weight;
    const blur = Math.abs(z) * look.blur * size;
    const base =
      kind === KIND.run
        ? look.run
        : kind === KIND.axis
          ? look.axis
          : kind === KIND.external
            ? 0.75 * look.step
            : look.step;
    const alpha = base * fogAt(look, z) * ((0.5 * core + 0.45) / Math.max(0.45, 0.5 * core + 0.5 * blur));
    const rgb = hues[kind] ?? hues[1] ?? [0, 0, 0];
    marks.push({
      z,
      draw(context) {
        context.globalCompositeOperation = colours.dark ? "lighter" : "source-over";
        context.lineCap = "butt";
        if (colours.dark) {
          context.strokeStyle = css(rgb, alpha * look.haloStrength * 0.9);
          context.lineWidth = core + blur + 2 * look.halo * size * k;
          stroke(context, a, b);
        }
        context.strokeStyle = css(rgb, alpha * 0.9);
        context.lineWidth = Math.max(0.7, core + blur);
        stroke(context, a, b);
      },
    });
  }
  return marks;
}

function starMarks(model: Constellation, pose: Pose, colours: ConstellationColours, paper: Rgb) {
  const look = colours.dark ? LOOK.dark : LOOK.light;
  const size = sizeOf(pose);
  const { inks } = palette(colours);
  const marks: { z: number; draw: Mark }[] = [];
  const disc = (context: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
  };
  for (let s = 0; s < model.stars.length / STAR; s++) {
    const o = s * STAR;
    const q = project(pose, model.stars[o] ?? 0, model.stars[o + 1] ?? 0, model.stars[o + 2] ?? 0);
    const role = model.stars[o + 6] ?? 0;
    const roleSize = role === ROLE.answer ? 1.5 : role === ROLE.external ? 0.8 : 1;
    const r = STAR_RADIUS * size * q.k * (0.8 + 0.25 * ((model.stars[o + 4] ?? 1) - 1)) * roleSize;
    const blur = Math.abs(q.z) * look.blur * size * 0.6;
    const placeLight = role === ROLE.answer ? 1 : role === ROLE.query ? 0.95 : 0.5 + 0.45 * (model.stars[o + 5] ?? 0);
    const bright = placeLight * fogAt(look, q.z) * (r / (r + blur)) ** 2;
    const ink = inks[role] ?? inks[0] ?? [0, 0, 0];
    const knock = colours.dark ? 0 : Math.max(0, 1 - Math.max(0, (q.z + 0.1) / 0.45));
    const ring = role === ROLE.answer ? 1.9 : role === ROLE.query ? 1.7 : 0;
    marks.push({
      z: q.z - 0.001,
      draw(context) {
        context.globalCompositeOperation = colours.dark ? "lighter" : "source-over";
        if (knock > 0) {
          context.fillStyle = css(paper, 0.92 * knock);
          disc(context, q.x, q.y, 1.35 * (r + blur));
          context.fill();
        }
        if (colours.dark) {
          const glow = context.createRadialGradient(q.x, q.y, 0, q.x, q.y, 3 * (r + blur));
          glow.addColorStop(0, css(ink, 0.35 * bright));
          glow.addColorStop(1, css(ink, 0));
          context.fillStyle = glow;
          disc(context, q.x, q.y, 3 * (r + blur));
          context.fill();
        }
        context.fillStyle = css(ink, bright);
        disc(context, q.x, q.y, r + blur * 0.5);
        context.fill();
        if (ring) {
          context.strokeStyle = css(ink, 0.8 * bright);
          context.lineWidth = 1;
          disc(context, q.x, q.y, ring * (r + blur));
          context.stroke();
        }
      },
    });
  }
  return marks;
}

interface Program {
  handle: WebGLProgram;
  at(name: string): WebGLUniformLocation | null;
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const handle = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("no shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    gl.attachShader(handle, shader);
  }
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle) ?? "program");
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    handle,
    at(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(handle, name));
      return cache.get(name) ?? null;
    },
  };
}

/** The segments as instances of one quad (two triangles across the segment, widened in the vertex shader). */
function segmentArray(gl: WebGL2RenderingContext, handle: WebGLProgram, data: Float32Array) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(handle, "a_corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const [name, size, offset] of [
    ["a_p0", 3, 0],
    ["a_p1", 3, 3],
    ["a_meta", 4, 6],
  ] as const) {
    const at = gl.getAttribLocation(handle, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, size, gl.FLOAT, false, SEGMENT * 4, offset * 4);
    gl.vertexAttribDivisor(at, 1);
  }
  gl.bindVertexArray(null);
  return vao;
}

function starArray(gl: WebGL2RenderingContext, handle: WebGLProgram, data: Float32Array) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(handle, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, STAR * 4, 0);
  const meta = gl.getAttribLocation(handle, "a_meta");
  gl.enableVertexAttribArray(meta);
  gl.vertexAttribPointer(meta, 4, gl.FLOAT, false, STAR * 4, 3 * 4);
  gl.bindVertexArray(null);
  return vao;
}

/** A new canvas in the place of one that holds a WebGL context (a canvas holds one kind of context for good). */
function fresh(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): HTMLCanvasElement {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  const other = document.createElement("canvas");
  other.className = canvas.className;
  canvas.replaceWith(other);
  return other;
}
