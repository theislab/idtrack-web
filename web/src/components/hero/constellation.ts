// The home's third picture: the showcase's most convoluted journeys as a braided cable about a horizontal axis of time
// (the model, its layout and its projection: lib/hero/constellationModel.ts), turning slowly about that axis. Each id
// is a star where it begins and a thread over the releases at which it is active; each step of an answer's path a
// curve in the hue of its kind; where a path splits or merges, a knot of the event hue. Depth is real: perspective, a
// fog that lets the far side of the cable recede, and a depth of field held small (what stands off the axis softens,
// keeping its light). A light travels each journey from the id asked for to its answer. The axis is drawn, with a
// tick at every tenth release, a ring at each change of assembly (named), and the first and the last release beyond
// its ends. The pointer tilts the whole toward it and lifts the journey nearest it (its threads in full ink, its stars
// ringed; the page names it beside the cable). WebGL2 draws it; without it, or where WebGL draws in software, one
// still drawing on a 2D canvas, drawn in slices so no long task holds the page; under reduced motion one still frame.
import {
  bandOf,
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
import {
  devicePixels,
  stillContext,
  hostPicture,
  programsDone,
  startProgram,
  uniformsOf,
  type Inks,
  type Picture,
  type Rgb,
} from "./canvas";

/** What the cable is placed by: the boxes of the words' blocks and the caption's box, in the field's pixels. */
export interface CablePlace {
  words: Rect[];
  caption: Rect | null;
}

/** The cable's renderer; `band` is its extent on the screen at rest (null where it is not drawn), so that the page
 *  names a lifted journey outside it, never over a strand. */
export type ConstellationView = Picture<CablePlace> & { band(): Rect | null };

/** A star's radius (CSS px) before its size, role and depth. */
const STAR_RADIUS = 1.7;
/** A full turn about the axis of time, in seconds. */
const TURN_SECONDS = 120;
/** The reveal along time, in seconds. */
const REVEAL_SECONDS = 2.6;
/** Seconds of one journey's travelling light. */
const PULSE_SECONDS = 14;
/** Room kept free round the cable (CSS px): across, for the release written beyond each end of the axis; up and down,
 *  for the stars' light. */
const MARGIN = { x: 40, y: 14 } as const;
/** How far beyond the strands at each end of the axis its release is written (CSS px, to the label's centre). */
const AXIS_LABEL_PX = 14;
/** The axis is seen turned a little: the last release toward the viewer. */
const YAW = 0.16;
/** How far short of facing the viewer the journey this visit follows stands when the picture is first seen. */
const FIRST_TURN = 0.18;

/** The look of each theme: the thread's core width, the halo (dark: light glows), the softening per unit of depth (CSS
 *  px), the far side's share of light, the alphas of an id's thread, a step, the axis, and the travelling light. */
const LOOK = {
  dark: {
    core: 1.1,
    halo: 3.2,
    haloStrength: 0.16,
    blur: 2.4,
    far: 0.22,
    run: 0.36,
    step: 0.62,
    axis: 0.55,
    pulse: 1.6,
  },
  light: { core: 1.15, halo: 0, haloStrength: 0, blur: 1.4, far: 0.24, run: 0.62, step: 0.86, axis: 0.62, pulse: 1 },
} as const;

const PLACE = `
uniform vec2 u_res;
uniform vec2 u_pose;  // turn, yaw
uniform vec4 u_place; // centre x, centre y, scale (device px), the camera's distance
uniform float u_girth;
// A point on the screen (device px), its depth (negative toward the viewer) and its perspective.
vec4 place(vec3 p) {
  float c = cos(u_pose.x), s = sin(u_pose.x);
  vec3 q = vec3(p.x, (c * p.y - s * p.z) * u_girth, (s * p.y + c * p.z) * u_girth);
  float cy = cos(u_pose.y), sy = sin(u_pose.y);
  q = vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
  float k = u_place.w / (u_place.w + q.z);
  return vec4(u_place.xy + vec2(q.x, -q.y) * k * u_place.z, q.z, k);
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
uniform vec3 u_hues[7];
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
  bool still = kind >= 5;
  float blur = still ? 0.0 : abs(s.z) * u_look.z * u_dpr;
  float weight = kind == 0 ? 0.75 : kind == 2 ? 1.2 : kind == 5 ? 1.3 : kind == 6 ? 1.0 : 1.0;
  float core = u_look.x * u_dpr * (still ? 1.0 : s.w) * weight;
  float sigma = max(0.45 * u_dpr, 0.5 * core + 0.5 * blur);
  float halo = still ? 0.0 : u_look.y * u_dpr * s.w;
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
  float base = kind == 0 ? u_alphas.x : still ? u_alphas.z : kind == 4 ? 0.75 * u_alphas.y : u_alphas.y;
  // Softened by depth, a thread keeps its light (spread wider, dimmer); the far side recedes into the paper.
  float energy = (0.5 * core + 0.45 * u_dpr) / sigma;
  float fog = still ? 1.0 : mix(1.0, u_look.w, smoothstep(-0.3, 0.55, s.z));
  float x = mix(a_p0.x, a_p1.x, along);
  float front = -1.2 + 2.4 * u_reveal;
  float shown = 1.0 - smoothstep(front - 0.18, front, x);
  bool mine = u_focus < 0.0 || abs(a_meta.y - u_focus) < 0.5 || still;
  bool lifted = u_focus >= 0.0 && abs(a_meta.y - u_focus) < 0.5;
  float t = mix(a_meta.z, a_meta.w, along);
  float head = fract(u_time / ${PULSE_SECONDS.toFixed(1)} + hash(a_meta.y)) * 1.7 - 0.35;
  float pulse = still ? 0.0 : exp(-pow((t - head) / 0.07, 2.0)) * u_alphas.w;
  v_rgb = u_hues[kind];
  v_alpha = base * energy * fog * shown * (mine ? 1.0 : 0.18) * (lifted ? 1.7 : 1.0) * (1.0 + pulse * (mine ? 1.0 : 0.3));
}`;

const SEGMENT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_rgb;
in float v_alpha;
in float v_across;
in float v_sigma;
in float v_halo;
uniform float u_haloStrength;
uniform float u_absorb; // 1: ink, added up as absorbance over the paper (light); 0: light (dark), or drawn directly
uniform vec3 u_paper;
out vec4 colour;
void main() {
  float g = exp(-0.5 * v_across * v_across / (v_sigma * v_sigma));
  float h = v_halo > 0.0 ? exp(-abs(v_across) / v_halo) * u_haloStrength : 0.0;
  float a = clamp(v_alpha * (g + h), 0.0, 1.0);
  if (u_absorb > 0.5) colour = vec4(1.3 * a * max(vec3(0.0), 1.0 - v_rgb / max(u_paper, vec3(0.05))), 0.0);
  else colour = vec4(v_rgb * a, a);
}`;

/** The threads added up (light in dark, ink in light) are mapped to the screen without saturating: light as
 *  1 - e^-light, ink as the paper's colour times e^-ink, so a dense core stays luminous (or deep) and never a slab. */
const COMPOSITE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_sum;
uniform float u_dark;
uniform vec3 u_paper;
out vec4 colour;
void main() {
  vec3 sum = texelFetch(u_sum, ivec2(gl_FragCoord.xy), 0).rgb;
  if (u_dark > 0.5) {
    vec3 c = 1.0 - exp(-sum);
    colour = vec4(c, max(c.r, max(c.g, c.b)));
  } else {
    vec3 t = exp(-sum);
    float a = 1.0 - min(t.r, min(t.g, t.b));
    colour = vec4(u_paper * (t - (1.0 - a)), a);
  }
}`;

const STAR_VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec4 a_meta; // journey, size, place in the path, role
uniform float u_dpr;
uniform float u_reveal;
uniform float u_focus;
uniform float u_star;
uniform vec4 u_look;
uniform float u_dark;
uniform vec3 u_inks[5]; // an id, the id asked for, an answer, an id of another database, a knot
${PLACE}
out vec3 v_rgb;
out float v_alpha;
out float v_core;
out float v_knock;
out float v_ring;
flat out int v_role;
void main() {
  vec4 s = place(a_pos);
  gl_Position = vec4((s.xy / u_res * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
  int role = int(a_meta.w + 0.5);
  float blur = abs(s.z) * u_look.z * u_dpr;
  float r = u_star * u_dpr * s.w * (0.8 + 0.25 * (a_meta.y - 1.0)) * (role == 2 ? 1.5 : role == 4 ? 1.35 : role == 3 ? 0.8 : 1.0);
  float total = r + 0.6 * blur;
  bool lifted = u_focus >= 0.0 && abs(a_meta.x - u_focus) < 0.5;
  float sprite = min(160.0, 2.0 * total * (role == 2 || role == 4 || lifted ? 6.0 : role == 1 ? 3.6 : 3.0) + 2.0);
  gl_PointSize = sprite;
  v_core = total / (0.5 * sprite);
  float shown = 1.0 - smoothstep(-1.2 + 2.4 * u_reveal - 0.18, -1.2 + 2.4 * u_reveal, a_pos.x);
  float fog = mix(1.0, u_look.w, smoothstep(-0.3, 0.55, s.z));
  bool mine = u_focus < 0.0 || lifted;
  // Brighter along the path toward its answer; the answer and the knots brightest.
  float bright = role == 2 || role == 4 ? 1.0 : role == 1 ? 0.95 : 0.5 + 0.45 * a_meta.z;
  v_alpha = (lifted ? 1.0 : bright * fog) * shown * (mine ? 1.0 : 0.18) * (r * r) / (total * total);
  v_knock = (1.0 - u_dark) * (1.0 - smoothstep(-0.1, 0.35, s.z)) * shown * (mine ? 1.0 : 0.18);
  v_rgb = u_inks[role];
  v_ring = lifted ? 1.0 : 0.0;
  v_role = role;
}`;

const STAR_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_rgb;
in float v_alpha;
in float v_core;
in float v_knock;
in float v_ring;
flat in int v_role;
uniform float u_dark;
uniform vec3 u_paper;
out vec4 colour;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = length(c);
  float core = exp(-0.5 * pow(d / (0.55 * v_core), 2.0));
  float halo = (v_role == 4 ? 1.0 : u_dark) * exp(-d / (0.9 * v_core)) * (v_role == 4 ? 0.45 : 0.32);
  float mark = 0.0;
  if (v_role == 2) {
    // An answer: a fine cross of light (dark), a ring of ink (light).
    float glint = exp(-abs(c.x) / 0.018) * exp(-abs(c.y) / 0.42) + exp(-abs(c.y) / 0.018) * exp(-abs(c.x) / 0.42);
    float ring = exp(-pow((d - 1.9 * v_core) / (0.16 * v_core), 2.0));
    mark = mix(ring * 0.6, glint * 0.7, u_dark);
  } else if (v_role == 1 || v_ring > 0.5) {
    // The id asked for, and every id of the journey lifted: a ring about it.
    mark = exp(-pow((d - 1.7 * v_core) / (0.14 * v_core), 2.0)) * mix(0.6, 0.85, u_dark);
  }
  float ink = clamp((core + halo + mark) * v_alpha, 0.0, 1.0);
  float knock = v_knock * (1.0 - smoothstep(1.15 * v_core, 1.45 * v_core, d)) * 0.9;
  float a = ink + knock * (1.0 - ink);
  colour = vec4(v_rgb * ink + u_paper * knock * (1.0 - ink), a);
}`;

const mixRgb = (a: Rgb, b: Rgb, f: number): Rgb => [0, 1, 2].map((i) => (a[i] ?? 0) * (1 - f) + (b[i] ?? 0) * f) as Rgb;

/** The hues of the segments' kinds and the inks of the stars' roles, in a theme: in the light theme the threads in
 *  ink weight (the history hue drawn toward the ink), in the dark light. */
function palette(c: Inks) {
  const white: Rgb = [1, 1, 1];
  const light = (rgb: Rgb) => (c.dark ? mixRgb(rgb, white, 0.18) : rgb);
  const hues: Rgb[] = [
    c.dark ? mixRgb(c.history, white, 0.35) : mixRgb(c.history, c.ink, 0.45),
    light(c.history),
    light(c.event),
    light(c.handoff),
    light(c.external),
    c.dark ? [0.78, 0.82, 0.92] : c.ink,
    light(c.handoff),
  ];
  const inks: Rgb[] = c.dark
    ? [[0.86, 0.9, 1], mixRgb(c.history, white, 0.5), [1, 0.96, 0.88], mixRgb(c.external, white, 0.35), light(c.event)]
    : [c.ink, c.history, c.ink, c.external, c.event];
  return { hues, inks };
}

/** The scale of threads and stars with the picture's own (a picture drawn small keeps fine lines and small stars). */
const sizeOf = (pose: Pose) => Math.max(0.6, Math.min(1.2, pose.scale / 400));

/** How far the reveal along time has drawn the picture at time x (0 not yet, 1 drawn), as the shaders draw it. */
function revealed(x: number, reveal: number): number {
  const front = -1.2 + 2.4 * reveal;
  const f = Math.max(0, Math.min(1, (x - (front - 0.18)) / 0.18));
  return 1 - f * f * (3 - 2 * f);
}

/** The words of the picture (hidden from assistive technology with the field): the first and the last release beyond
 *  the axis's ends, a tick at every tenth release, and each change of assembly named over the cable. */
function createLabels(layer: HTMLElement, model: Constellation, names: ReadonlyMap<number, string>) {
  const box = document.createElement("div");
  box.className = "hero2__cable";
  const make = (className: string, text: string) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    box.append(span);
    return span;
  };
  const ends = [model.first, model.last].map((r) => make("hero2__axis-end mono", String(r)));
  const ticks = model.ticks.map((r) => ({ r, span: make("hero2__axis-tick", "") }));
  const changes = model.changes.map((r) => ({
    r,
    span: make("hero2__axis-change", `${String(r)} ${names.get(r) ?? ""}`.trim()),
  }));
  layer.append(box);
  const xOf = (release: number) =>
    model.last > model.first ? ((release - model.first) / (model.last - model.first)) * 2 - 1 : 0;
  return {
    place(pose: Pose, reveal: number, band: Rect) {
      const a = project(pose, -1, 0, 0);
      const b = project(pose, 1, 0, 0);
      // The first and the last release beyond the strands at the axis's ends, on the axis's line.
      ends.forEach((span, i) => {
        const end = i === 0 ? a : b;
        const x = i === 0 ? Math.min(end.x, band.left) - AXIS_LABEL_PX : Math.max(end.x, band.right) + AXIS_LABEL_PX;
        span.style.transform = `translate(${x.toFixed(1)}px, ${end.y.toFixed(1)}px)`;
        span.style.opacity = revealed(i === 0 ? -1 : 1, reveal).toFixed(3);
      });
      for (const { r, span } of ticks) {
        const p = project(pose, xOf(r), 0, 0);
        span.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        span.style.opacity = revealed(xOf(r), reveal).toFixed(3);
      }
      for (const { r, span } of changes) {
        const p = project(pose, xOf(r), 0, 0);
        span.style.transform = `translate(${p.x.toFixed(1)}px, ${(band.top - 20).toFixed(1)}px)`;
        span.style.opacity = revealed(xOf(r), reveal).toFixed(3);
      }
    },
    remove() {
      box.remove();
    },
  };
}

/** How the cable is to be drawn: under reduced motion; the journey this visit follows (it faces the viewer first);
 *  the names of the assemblies by their first release; the development switch. */
export interface CableOptions {
  reduced: boolean;
  facing: number;
  names: ReadonlyMap<number, string>;
  stepped: boolean;
  changed?: () => void;
}

/** The pose and the room of a cable laid in the hero, shared by its renderers. */
function cableState(model: Constellation, facing: number) {
  const firstTurn = -Math.PI / 2 - (model.journeys[facing]?.angle ?? -Math.PI / 2) + FIRST_TURN;
  const state: {
    room: Rect | null;
    rest: Pose;
    box: Rect;
    place(width: number, height: number, laid: CablePlace): void;
    band: () => Rect | null;
  } = {
    room: null,
    rest: { turn: firstTurn, yaw: YAW, distance: 3.2, girth: 1, cx: 0, cy: 0, scale: 1 },
    box: { left: 0, right: 0, top: 0, bottom: 0 },
    place(width, height, laid) {
      state.room = roomOf(width, height, laid.words, laid.caption);
      if (state.room) {
        state.rest = { ...fitPose(model, state.room, MARGIN, YAW), turn: firstTurn };
        state.box = bandOf(model, state.rest);
      }
    },
    band: () => (state.room ? state.box : null),
  };
  return state;
}

export function createConstellation(
  canvas: HTMLCanvasElement,
  layer: HTMLElement,
  model: Constellation,
  options: CableOptions,
): ConstellationView {
  const labels = createLabels(layer, model, options.names);
  const state = cableState(model, options.facing);
  const host = hostPicture<CablePlace>(
    canvas,
    {
      attributes: { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: options.stepped },
      start(gl) {
        const programs = {
          segments: startProgram(gl, SEGMENT_VERTEX, SEGMENT_FRAGMENT),
          stars: startProgram(gl, STAR_VERTEX, STAR_FRAGMENT),
          composite: startProgram(gl, COMPOSITE_VERTEX, COMPOSITE_FRAGMENT),
        };
        return {
          done: () => programsDone(gl, Object.values(programs)),
          build: () => createWebgl(gl, programs, model, state, labels, options),
        };
      },
    },
    (target) => createStill(target, model, state, labels),
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
    band: () => state.band(),
    destroy() {
      host.destroy();
      labels.remove();
    },
  };
}

type Labels = ReturnType<typeof createLabels>;
type CableState = ReturnType<typeof cableState>;

function createWebgl(
  gl: WebGL2RenderingContext,
  programs: { segments: WebGLProgram; stars: WebGLProgram; composite: WebGLProgram },
  model: Constellation,
  state: CableState,
  labels: Labels,
  options: CableOptions,
): ConstellationView {
  const reduced = options.reduced;
  let dpr = 1;
  let width = 1;
  let height = 1;
  let inks: Inks | null = null;
  let focus = -1;
  // The pointer's pull (target and present): yaw toward it across, a little more turn toward it up and down.
  const pull = { yaw: 0, turn: 0, toYaw: 0, toTurn: 0 };
  const motion = { running: false, raf: 0, start: -1, previous: -1, last: 0 };
  const times = { frames: 0, frameMs: 0, drawMs: 0 };
  let forced: number | null = options.stepped ? 0 : null;
  let ended = false;
  const su = uniformsOf(gl, programs.segments);
  const pu = uniformsOf(gl, programs.stars);
  const cu = uniformsOf(gl, programs.composite);
  const segmentVao = segmentArray(gl, programs.segments, model.segments);
  const target = sumTarget(gl);
  const starVao = starArray(gl, programs.stars, model.stars);
  const segmentCount = model.segments.length / SEGMENT;
  const starCount = model.stars.length / STAR;
  const work = { drawCalls: 0, segments: segmentCount, stars: starCount };

  /** The pose at `seconds` after the picture began. */
  const poseAt = (seconds: number): Pose => ({
    ...state.rest,
    turn: state.rest.turn + (reduced ? 0 : (seconds / TURN_SECONDS) * Math.PI * 2) + pull.turn,
    yaw: state.rest.yaw + pull.yaw,
  });
  const revealAt = (seconds: number) => (reduced ? 1 : 1 - Math.pow(1 - Math.min(1, seconds / REVEAL_SECONDS), 3));

  function common(at: (name: string) => WebGLUniformLocation | null, pose: Pose, seconds: number, reveal: number) {
    gl.uniform2f(at("u_res"), width, height);
    gl.uniform2f(at("u_pose"), pose.turn, pose.yaw);
    gl.uniform4f(at("u_place"), pose.cx * dpr, pose.cy * dpr, pose.scale * dpr, pose.distance);
    gl.uniform1f(at("u_girth"), pose.girth);
    gl.uniform1f(at("u_dpr"), dpr);
    gl.uniform1f(at("u_time"), reduced ? 0 : seconds);
    gl.uniform1f(at("u_reveal"), reveal);
    gl.uniform1f(at("u_focus"), focus);
    const look = inks?.dark ? LOOK.dark : LOOK.light;
    const size = sizeOf(pose);
    gl.uniform4f(at("u_look"), look.core * size, look.halo * size, look.blur * size, look.far);
  }

  function draw(now: number) {
    if (ended || !inks || !state.room) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const t0 = performance.now();
    if (motion.start < 0) motion.start = now;
    const seconds = forced ?? (now - motion.start) / 1000;
    // The pointer's pull eases in (about a third of a second).
    const dt = motion.previous < 0 ? 0 : Math.min(0.1, Math.max(0, (now - motion.previous) / 1000));
    motion.previous = now;
    const ease = forced !== null ? 1 : 1 - Math.exp(-dt * 5);
    pull.yaw += (pull.toYaw - pull.yaw) * ease;
    pull.turn += (pull.toTurn - pull.turn) * ease;
    const pose = poseAt(seconds);
    const reveal = revealAt(seconds);
    const look = inks.dark ? LOOK.dark : LOOK.light;
    const { hues, inks: starInks } = palette(inks);
    const paper = inks.paper;
    gl.viewport(0, 0, width, height);
    // The threads: added up in the texture of half floats where there is one (light, or ink as absorbance), then
    // mapped to the screen; else drawn directly (dark adds light, light lays ink over the paper).
    const summed = target.ready();
    gl.bindFramebuffer(gl.FRAMEBUFFER, summed ? target.framebuffer : null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (summed || inks.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(programs.segments);
    common(su, pose, seconds, reveal);
    gl.uniform3fv(su("u_hues"), hues.flat());
    gl.uniform4f(su("u_alphas"), look.run, look.step, look.axis, reduced ? 0 : look.pulse);
    gl.uniform1f(su("u_haloStrength"), look.haloStrength);
    gl.uniform1f(su("u_absorb"), summed && !inks.dark ? 1 : 0);
    gl.uniform3f(su("u_paper"), ...paper);
    gl.bindVertexArray(segmentVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segmentCount);
    work.drawCalls = 1;
    if (summed) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
      gl.useProgram(programs.composite);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.uniform1i(cu("u_sum"), 0);
      gl.uniform1f(cu("u_dark"), inks.dark ? 1 : 0);
      gl.uniform3f(cu("u_paper"), ...paper);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
      work.drawCalls++;
    }
    // The stars over the threads: dark adds light, light lays ink over a little paper that sets each apart.
    if (inks.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(programs.stars);
    common(pu, pose, seconds, reveal);
    gl.uniform1f(pu("u_star"), STAR_RADIUS * sizeOf(pose));
    gl.uniform1f(pu("u_dark"), inks.dark ? 1 : 0);
    gl.uniform3fv(pu("u_inks"), starInks.flat());
    gl.uniform3f(pu("u_paper"), ...paper);
    gl.bindVertexArray(starVao);
    gl.drawArrays(gl.POINTS, 0, starCount);
    gl.bindVertexArray(null);
    work.drawCalls++;
    labels.place(pose, reveal, state.box);
    times.drawMs += performance.now() - t0;
    if (motion.last) times.frameMs += now - motion.last;
    motion.last = now;
    times.frames++;
  }
  const loop = (now: number) => {
    motion.raf = 0;
    draw(now);
    if (motion.running && !reduced && forced === null) motion.raf = requestAnimationFrame(loop);
  };
  const request = () => {
    if (ended) return;
    if (forced !== null) {
      draw(performance.now());
      return;
    }
    if (!motion.raf) motion.raf = requestAnimationFrame(loop);
  };
  const currentSeconds = () =>
    forced ?? (motion.start < 0 ? 0 : ((motion.last || performance.now()) - motion.start) / 1000);

  return {
    mode: "webgl2",
    element: gl.canvas as HTMLCanvasElement,
    moving: !reduced,
    resize(w, h, laid) {
      const size = devicePixels(w, h);
      dpr = size.dpr;
      width = size.width;
      height = size.height;
      state.place(w, h, laid);
      const canvas = gl.canvas as HTMLCanvasElement;
      canvas.width = width;
      canvas.height = height;
      target.resize(width, height);
      request();
    },
    setColours(c) {
      inks = c;
      request();
    },
    setPointer(point) {
      if (reduced || !state.room) return -1;
      focus = point ? nearest(model, poseAt(currentSeconds()), point) : -1;
      const room = state.room;
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
    work: () => ({ ...work }),
    drawAt(seconds) {
      forced = seconds;
      draw(performance.now());
    },
    band: () => state.band(),
    destroy() {
      ended = true;
      motion.running = false;
      if (motion.raf) cancelAnimationFrame(motion.raf);
      motion.raf = 0;
    },
  };
}

/** The journey whose star or thread is nearest the pointer (within 28 CSS px), or -1. */
function nearest(model: Constellation, pose: Pose, point: { x: number; y: number }): number {
  let best = 28;
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
  if (journey >= 0) return journey;
  for (let i = 0; i < model.segments.length / SEGMENT; i += 2) {
    const o = i * SEGMENT;
    const j = model.segments[o + 7] ?? -1;
    if (j < 0) continue;
    const q = project(pose, model.segments[o] ?? 0, model.segments[o + 1] ?? 0, model.segments[o + 2] ?? 0);
    const d = Math.hypot(q.x - point.x, q.y - point.y);
    if (d < best * 0.6) {
      best = d / 0.6;
      journey = j;
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

/** The still cable on a 2D canvas: the same model and pose, drawn once (in slices of about 6 ms a frame), far things
 *  first. */
function createStill(
  canvas: HTMLCanvasElement,
  model: Constellation,
  state: CableState,
  labels: Labels,
): ConstellationView {
  const context = stillContext(canvas);
  let job = 0;
  let painted = 0;
  let size = { w: 1, h: 1 };
  let inks: Inks | null = null;
  const paint = () => {
    if (!context) return;
    if (job) cancelAnimationFrame(job);
    const { dpr, width, height } = devicePixels(size.w, size.h);
    canvas.width = width;
    canvas.height = height;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.w, size.h);
    if (!inks || !state.room) return;
    const pose = state.rest;
    const queue = stillMarks(model, pose, inks, inks.paper);
    labels.place(pose, 1, state.box);
    let i = 0;
    const slice = () => {
      job = 0;
      const until = performance.now() + 6;
      while (i < queue.length && performance.now() < until) {
        const end = Math.min(queue.length, i + 200);
        for (; i < end; i++) queue[i]?.(context);
      }
      if (i < queue.length) job = requestAnimationFrame(slice);
      else painted++;
    };
    job = requestAnimationFrame(slice);
  };
  return {
    mode: "canvas2d",
    element: canvas,
    moving: false,
    resize(w, h, laid) {
      size = { w, h };
      state.place(w, h, laid);
      paint();
    },
    setColours(c) {
      inks = c;
      paint();
    },
    setPointer: () => -1,
    setRunning: () => undefined,
    stats: () => ({ frames: painted, meanFrameMs: 0, meanDrawMs: 0 }),
    work: () => null,
    drawAt: () => undefined,
    band: () => state.band(),
    destroy() {
      if (job) cancelAnimationFrame(job);
    },
  };
}

/** The still picture's marks, far ones first: each segment and each star as the shaders draw them (depth softens and
 *  fades them; dark adds light, light lays ink). */
function stillMarks(model: Constellation, pose: Pose, inks: Inks, paper: Rgb): Mark[] {
  const marks = [...segmentMarks(model, pose, inks), ...starMarks(model, pose, inks, paper)];
  // Far first, so near threads and stars lie over far ones.
  marks.sort((m, n) => n.z - m.z);
  return marks.map((m) => m.draw);
}

function segmentMarks(model: Constellation, pose: Pose, inks: Inks) {
  const look = inks.dark ? LOOK.dark : LOOK.light;
  const size = sizeOf(pose);
  const { hues } = palette(inks);
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
    const still = kind >= KIND.axis;
    const z = still ? -10 : (a.z + b.z) / 2;
    const k = still ? 1 : (a.k + b.k) / 2;
    const weight = kind === KIND.run ? 0.75 : kind === KIND.fan ? 1.2 : kind === KIND.axis ? 1.3 : 1;
    const core = look.core * size * k * weight;
    const blur = still ? 0 : Math.abs(z) * look.blur * size;
    const base =
      kind === KIND.run ? look.run : still ? look.axis : kind === KIND.external ? 0.75 * look.step : look.step;
    const alpha = base * (still ? 1 : fogAt(look, z)) * ((0.5 * core + 0.45) / Math.max(0.45, 0.5 * core + 0.5 * blur));
    const rgb = hues[kind] ?? hues[1] ?? [0, 0, 0];
    marks.push({
      z,
      draw(context) {
        // Light adds up without burning out (screen); ink deepens where threads cross (multiply).
        context.globalCompositeOperation = inks.dark ? "screen" : "multiply";
        context.lineCap = "butt";
        if (inks.dark && !still) {
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

function starMarks(model: Constellation, pose: Pose, inks: Inks, paper: Rgb) {
  const look = inks.dark ? LOOK.dark : LOOK.light;
  const size = sizeOf(pose);
  const { inks: starInks } = palette(inks);
  const marks: { z: number; draw: Mark }[] = [];
  const disc = (context: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
  };
  for (let s = 0; s < model.stars.length / STAR; s++) {
    const o = s * STAR;
    const q = project(pose, model.stars[o] ?? 0, model.stars[o + 1] ?? 0, model.stars[o + 2] ?? 0);
    const role = model.stars[o + 6] ?? 0;
    const roleSize = role === ROLE.answer ? 1.5 : role === ROLE.knot ? 1.35 : role === ROLE.external ? 0.8 : 1;
    const r = STAR_RADIUS * size * q.k * (0.8 + 0.25 * ((model.stars[o + 4] ?? 1) - 1)) * roleSize;
    const blur = Math.abs(q.z) * look.blur * size * 0.6;
    const placeLight =
      role === ROLE.answer || role === ROLE.knot
        ? 1
        : role === ROLE.query
          ? 0.95
          : 0.5 + 0.45 * (model.stars[o + 5] ?? 0);
    const bright = placeLight * fogAt(look, q.z) * (r / (r + blur)) ** 2;
    const ink = starInks[role] ?? starInks[0] ?? [0, 0, 0];
    const knock = inks.dark ? 0 : Math.max(0, 1 - Math.max(0, (q.z + 0.1) / 0.45));
    const ring = role === ROLE.answer ? 1.9 : role === ROLE.query ? 1.7 : 0;
    marks.push({
      z: q.z - 0.001,
      draw(context) {
        context.globalCompositeOperation = inks.dark ? "lighter" : "source-over";
        if (knock > 0) {
          context.fillStyle = css(paper, 0.92 * knock);
          disc(context, q.x, q.y, 1.35 * (r + blur));
          context.fill();
        }
        if (inks.dark || role === ROLE.knot) {
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

/** The texture of half floats the threads are added up in, and its framebuffer; not ready where the browser cannot
 *  draw into half floats (then the threads are drawn directly). */
function sumTarget(gl: WebGL2RenderingContext) {
  const floats =
    gl.getExtension("EXT_color_buffer_float") !== null || gl.getExtension("EXT_color_buffer_half_float") !== null;
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  let complete = false;
  return {
    texture,
    framebuffer,
    ready: () => complete,
    resize(width: number, height: number) {
      if (!floats) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
  };
}
