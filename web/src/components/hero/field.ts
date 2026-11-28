// The renderer of the home's lineage field: WebGL2 where the browser has it, else one still drawing on a 2D canvas.
// What it draws is the layout of lib/hero/lineageLayout.ts (each gene id a line over the releases it is active at, a
// dot at each new version, a curve for each history edge to another id), nothing else, on a plane seen in perspective:
// the first release far away at the left, the last near at the right, the release axis a level line at the plane's
// foot (`FieldFrame`, one projective map, the same for the shaders, the pointer and the words placed over it). The
// still field is drawn once into a texture of density (again only on a resize or a change of theme); each frame
// composites it into ink (light) or light (dark) with a soft glow of its own density, revealed along the time axis
// once, brightened near the pointer, with light travelling along the lines with time and the family under the pointer
// lifted. It draws only while the hero is on screen and the page is shown, and under reduced motion one still frame.
import { EDGE_FLOATS, SEGMENT_FLOATS, type LineageLayout, type Lines } from "../../lib/hero/lineageLayout";

/** One end of the field: its x and the y of its top and bottom edges, in CSS pixels of the canvas. */
interface FieldEdge {
  x: number;
  top: number;
  bottom: number;
}

/** Where the field lies: its far end (the graph's first release) and its near end (its last). The two ends are
 *  vertical; between them the field is the plane they bound, seen in perspective, so that the far end is smaller and
 *  its releases closer together, as a plane receding from the eye is seen. */
export interface FieldFrame {
  far: FieldEdge;
  near: FieldEdge;
}

/** The projective map of a frame, row-major: (x, y, 1) of the field (x from 0 at the first release to 1 at the last,
 *  y from -0.5 to 0.5 across) to homogeneous CSS pixels; the third coordinate is the depth (1 at the near end). */
function projection(frame: FieldFrame): number[] {
  const nearHalf = Math.max(0.5, (frame.near.bottom - frame.near.top) / 2);
  const farHalf = Math.max(0.5, (frame.far.bottom - frame.far.top) / 2);
  const r = nearHalf / farHalf;
  const nearCentre = (frame.near.top + frame.near.bottom) / 2;
  const farCentre = (frame.far.top + frame.far.bottom) / 2;
  return [
    frame.near.x - r * frame.far.x,
    0,
    r * frame.far.x,
    nearCentre - r * farCentre,
    2 * nearHalf,
    r * farCentre,
    1 - r,
    0,
    r,
  ];
}

/** The inverse of a 3×3 matrix, row-major. */
function inverse(m: number[]): number[] {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

/** The placing of points of the field (fractions) in CSS pixels, as the shaders place them. */
export function placer(frame: FieldFrame): (x: number, y: number) => { x: number; y: number } {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 1] = projection(frame);
  return (x, y) => {
    const w = g * x + h * y + i;
    return { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w };
  };
}

/** A point of the field (fractions) in CSS pixels, as the shaders place it. */
export function placeOf(frame: FieldFrame, x: number, y: number): { x: number; y: number } {
  return placer(frame)(x, y);
}

/** The inverse of `placeOf`: fractions of the field for a point in CSS pixels. */
export function fieldAt(frame: FieldFrame, px: number, py: number): { x: number; y: number } {
  const m = inverse(projection(frame));
  const w = (m[6] ?? 0) * px + (m[7] ?? 0) * py + (m[8] ?? 1);
  return {
    x: ((m[0] ?? 0) * px + (m[1] ?? 0) * py + (m[2] ?? 0)) / w,
    y: ((m[3] ?? 0) * px + (m[4] ?? 0) * py + (m[5] ?? 0)) / w,
  };
}

/** The room the release axis takes under the field (its releases and the assemblies' names). */
const AXIS_ROOM = 46;
/** How much taller the plane's near end is than its far end: a perspective that gives depth and leaves the first
 *  releases room (at 4 the first half of the releases took a fifth of the width). */
const DEPTH = 2.2;

/** Where the lineages lie in the hero, so that no line crosses a word: the plane's foot is a level line (the release
 *  axis) above the caption, its far end (the first release) at the left, its near end (the last) at the right, the
 *  near end DEPTH times as tall as the far. Beside the words (a wide window) the plane is as tall as it can be with
 *  every release's outermost line (`top`, by release, as `LineageLayout.top`) passing clear of the words' box (40 px);
 *  under them (a phone, a narrow window) it fills the room between the words and the caption. `words` is the box of
 *  the words' text in the field's pixels, `foot` the caption's top. */
export function frameOf(
  width: number,
  height: number,
  words: { right: number; bottom: number } | null,
  foot: number,
  top: ArrayLike<number> = [],
): FieldFrame {
  const margin = Math.max(16, Math.min(56, width * 0.035));
  const bottom = Math.max(40, Math.min(height, foot) - AXIS_ROOM);
  const at = (nearTop: number): FieldFrame => ({
    far: { x: margin, top: bottom - (bottom - nearTop) / DEPTH, bottom },
    near: { x: width - margin, top: nearTop, bottom },
  });
  if (!words || width < 900 || words.right > width * 0.58)
    return at(Math.min(bottom - 60, (words?.bottom ?? height * 0.45) + 28));
  const clear = { x: words.right + 40, y: words.bottom + 40 };
  const n = top.length;
  const fits = (nearTop: number) => {
    const place = placer(at(nearTop));
    for (let k = 0; k < n; k++) {
      const p = place(n > 1 ? k / (n - 1) : 0.5, top[k] ?? -0.5);
      if (p.x <= clear.x && p.y < clear.y) return false;
    }
    return true;
  };
  // The highest near end that fits (a lower one always fits when a higher one does).
  let lo = Math.max(12, height * 0.06);
  let hi = bottom - 60;
  if (fits(lo)) return at(lo);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

export interface FieldColours {
  ink: [number, number, number];
  history: [number, number, number];
  event: [number, number, number];
  dark: boolean;
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

export interface Field {
  mode: "webgl2" | "canvas2d";
  /** The canvas drawn on (a fresh one where WebGL was given up). */
  element: HTMLCanvasElement;
  resize(width: number, height: number, frame: FieldFrame): void;
  setColours(colours: FieldColours): void;
  /** The pointer in CSS pixels of the canvas, or null when it left; `lift` the id whose family is lifted, or -1. */
  setPointer(point: { x: number; y: number } | null, lift: number): void;
  setRunning(running: boolean): void;
  /** Frame times measured (ms between frames drawn, and the CPU time of drawing them). */
  stats(): { frames: number; meanFrameMs: number; meanDrawMs: number };
  /** The GPU work of the last frame (WebGL2 only). */
  work(): FieldWork | null;
  /** Draw the frame at a time since the start, in ms (the development switch's stepping of time). */
  drawAt(ms: number): void;
  destroy(): void;
}

/** Steps of a curve between two releases: a smooth step in y, linear in x. */
const STEPS = 10;
/** The reveal along the time axis, once; then the light fades in. */
const REVEAL_MS = 2400;
const LIGHT_IN_MS = 1800;

const VERTEX = `#version 300 es
precision highp float;
in float a_t;
in vec4 a_seg;
in vec2 a_meta;
uniform mat3 u_m; // the field to device px (homogeneous)
uniform vec2 u_res;
uniform float u_offset;
uniform float u_eras;
out float v_fade;
out float v_x;
out float v_phase;
out float v_era;
out float v_scale;
void main() {
  float s = a_t * a_t * (3.0 - 2.0 * a_t);
  float x = mix(a_seg.x, a_seg.z, a_t);
  float y = mix(a_seg.y, a_seg.w, s);
  vec3 h = u_m * vec3(x, y, 1.0);
  vec2 p = h.xy / h.z + vec2(0.0, u_offset);
  v_fade = a_meta.x == 1.0 ? a_t : (a_meta.x == 2.0 ? 1.0 - a_t : 1.0);
  v_x = x;
  v_phase = fract(a_meta.y);
  // Growth rings: the ids of the first assembly in full ink, each later era a step lighter.
  v_era = u_eras > 1.0 ? floor(a_meta.y) / (u_eras - 1.0) : 0.0;
  // The plane's scale here (1 at its near end): lines lie closer together toward the far end.
  v_scale = 1.0 / h.z;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float v_fade;
in float v_x;
in float v_phase;
in float v_era;
in float v_scale;
uniform vec4 u_colour;
uniform vec3 u_young;
uniform float u_time;
uniform float u_pulse;
uniform float u_still;
out vec4 colour;
void main() {
  float a = u_colour.a * v_fade;
  vec3 rgb = u_colour.rgb;
  if (u_still > 0.5) {
    // Growth rings: the ids of the first assembly in the line's ink at the core, each later era's further toward the
    // young ids' colour and lighter. Each thread its own weight, most of them faint and a few bright (fibres of silk
    // catching the light; the mean weight is the same for every line), and as much ink per pixel at the far end as at
    // the near (lines lie closer there), hazing with distance.
    float weight = 0.25 + 3.0 * pow(fract(v_phase * 13.731), 5.0);
    a *= weight * mix(1.0, 0.62, v_era) * v_scale * mix(0.55, 1.0, v_x);
    rgb = mix(u_colour.rgb, u_young, v_era);
  }
  if (u_pulse > 0.5) {
    // Light travelling with time along the line, about half of its cycle on the field: a head, a tail fading behind.
    float speed = 0.034 + 0.03 * fract(v_phase * 7.13);
    float h = fract(u_time * speed + v_phase) * 2.2 - 0.35;
    float d = h - v_x;
    float tail = 0.05 + 0.06 * fract(v_phase * 3.7);
    float light = d > 0.0 && d < tail ? pow(1.0 - d / tail, 2.6) : 0.0;
    light += d <= 0.0 && d > -0.006 ? 1.0 + d / 0.006 : 0.0;
    a *= light;
  }
  colour = vec4(rgb * a, a);
}`;

const DOT_VERTEX = `#version 300 es
precision highp float;
in vec2 a_dot;
uniform mat3 u_m;
uniform vec2 u_res;
uniform float u_size;
out float v_scale;
void main() {
  vec3 h = u_m * vec3(a_dot, 1.0);
  vec2 p = h.xy / h.z;
  v_scale = 1.0 / h.z;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = u_size * (0.45 + 0.55 * v_scale);
}`;

const DOT_FRAGMENT = `#version 300 es
precision highp float;
in float v_scale;
uniform vec4 u_colour;
out vec4 colour;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  float a = u_colour.a * smoothstep(1.0, 0.35, r) * (0.5 + 0.5 * v_scale);
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
uniform mat3 u_inv; // device px to the field
uniform float u_reveal; // the release fraction shown so far
uniform vec3 u_pointer; // device px, and 1 where the pointer is on the field
uniform float u_radius;
uniform vec3 u_tint;
uniform vec3 u_glow;
uniform float u_gain;
uniform float u_dark;
uniform float u_bloom;
uniform vec3 u_ground;
out vec4 colour;
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  vec3 f = u_inv * vec3(p, 1.0);
  float fx = f.x / f.z;
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
    // Light on the night: the lines add up to light, with a bloom of their own density.
    vec3 rgb = mix(hue, u_tint, glow * 0.7) * a + u_glow * halo + u_tint * front * a * 1.4;
    colour = vec4(rgb, min(1.0, max(a, halo))) * shown;
  } else {
    // A cyanotype on paper: a ground of deep blue wherever lines lie (soft where they are sparse), the lines pale on
    // it as they add up, and a faint bleed of the ground around it.
    float cover = 1.0 - exp(-8.0 * c.a);
    vec3 rgb = mix(u_ground, mix(hue, vec3(1.0), glow * 0.5), a) + u_tint * front * a * 1.2;
    float bleed = halo * (1.0 - cover);
    colour = (vec4(rgb, 1.0) * cover + vec4(u_glow, 1.0) * bleed) * shown;
  }
}`;

/** A program's shaders compiled and linked, not waited for (the driver may compile them off the page's thread). */
function startProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("no shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return program;
}

interface Programs {
  lines: WebGLProgram;
  dots: WebGLProgram;
  quad: WebGLProgram;
}

/** Whether the programs are compiled and linked, asked without waiting where the browser can (its
 *  KHR_parallel_shader_compile); then whether they linked. */
function programsDone(gl: WebGL2RenderingContext, programs: Programs): boolean {
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  const all: WebGLProgram[] = [programs.lines, programs.dots, programs.quad];
  if (parallel && !all.every((p) => gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR) === true)) return false;
  for (const p of all)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
  return true;
}

/** The device pixels across which the ids of the widest release are spread at the field's near end. */
function spreadOf(frame: FieldFrame, dpr: number): number {
  return (frame.near.bottom - frame.near.top) * dpr;
}

/** A line's weight in the density: where the lines lie thickest they add up to about 1 (the composite's gain then
 *  sets how deep that is), and a line alone keeps a visible weight. On 8-bit textures (no float target) the sum
 *  saturates at 1 instead. */
function lineAlpha(layout: LineageLayout, spread: number): number {
  const perPixel = layout.widest / Math.max(1, spread);
  return Math.min(0.5, Math.max(0.02, 1 / perPixel));
}

/** Whether WebGL draws in software here (no GPU: SwiftShader, llvmpipe, Microsoft's basic renderer): there a picture
 *  is drawn once and holds still, as under reduced motion (a frame takes a few hundred milliseconds of a CPU). */
export function drawsInSoftware(gl: WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

/** The renderer. `stepped` (the development switch, never in a production build) keeps the animated path where WebGL
 *  draws in software and draws only when `drawAt` is called, so that a script can capture the motion frame by frame. */
export function createField(
  canvas: HTMLCanvasElement,
  layout: LineageLayout,
  reducedMotion: boolean,
  stepped = false,
): Field {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: stepped,
  });
  if (!gl) return createStill(canvas, layout);
  // In software (no GPU) a frame costs a few hundred milliseconds of the GPU process: one still frame is drawn, as under
  // reduced motion, and nothing moves.
  const still = reducedMotion || (!stepped && drawsInSoftware(gl));
  let programs: Programs;
  try {
    programs = {
      lines: startProgram(gl, VERTEX, LINE_FRAGMENT),
      dots: startProgram(gl, DOT_VERTEX, DOT_FRAGMENT),
      quad: startProgram(gl, QUAD_VERTEX, QUAD_FRAGMENT),
    };
  } catch {
    return createStill(fresh(canvas, gl), layout);
  }
  return whenCompiled(canvas, gl, programs, (done) => {
    try {
      return done ? createWebgl(canvas, gl, layout, still, stepped, programs) : createStill(fresh(canvas, gl), layout);
    } catch {
      return createStill(fresh(canvas, gl), layout);
    }
  });
}

/** A field that waits, a frame at a time, for its programs to compile (so that the page's thread never waits on the
 *  driver), keeping what it is told meanwhile, then hands over to the field made by `make` (false: they failed). */
function whenCompiled(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  programs: Programs,
  make: (done: boolean) => Field,
): Field {
  let field: Field | null = null;
  let size: [number, number, FieldFrame] | null = null;
  let colours: FieldColours | null = null;
  let pointer: [{ x: number; y: number } | null, number] | null = null;
  let running: boolean | null = null;
  let raf = 0;
  const poll = () => {
    raf = 0;
    let done: boolean;
    try {
      if (!programsDone(gl, programs)) {
        raf = requestAnimationFrame(poll);
        return;
      }
      done = true;
    } catch {
      done = false;
    }
    field = make(done);
    proxy.element = field.element;
    proxy.mode = field.mode;
    canvas.dispatchEvent(new Event("idtrack:field"));
    if (colours) field.setColours(colours);
    if (size) field.resize(...size);
    if (pointer) field.setPointer(...pointer);
    if (running !== null) field.setRunning(running);
  };
  raf = requestAnimationFrame(poll);
  const proxy: Field = {
    mode: "webgl2",
    element: canvas,
    resize(...args) {
      size = args;
      field?.resize(...args);
    },
    setColours(c) {
      colours = c;
      field?.setColours(c);
    },
    setPointer(...args) {
      pointer = args;
      field?.setPointer(...args);
    },
    setRunning(on) {
      running = on;
      field?.setRunning(on);
    },
    stats: () => field?.stats() ?? { frames: 0, meanFrameMs: 0, meanDrawMs: 0 },
    work: () => field?.work() ?? null,
    drawAt(ms) {
      field?.drawAt(ms);
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      if (field) field.destroy();
      else gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return proxy;
}

/** A new canvas in the place of one that holds a WebGL context (a canvas holds one kind of context for good). */
function fresh(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): HTMLCanvasElement {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  const other = document.createElement("canvas");
  other.className = canvas.className;
  canvas.replaceWith(other);
  return other;
}

/** The inks of each theme. Dark: light on the night (pale steel lines, the younger eras toward the history hue,
 *  added up with a bloom). Light: a cyanotype on the paper (the same pale lines on a ground of deep blue). The two hues
 *  stay accents: the history hue's dots and one-to-one edges, the event hue's fans, the light travelling. */
function paletteOf(colours: FieldColours) {
  const lighten = (rgb: [number, number, number], by: number) =>
    rgb.map((v) => v + (1 - v) * by) as [number, number, number];
  const pale: [number, number, number] = [0.7, 0.79, 0.96];
  return {
    line: pale,
    young: colours.dark ? lighten(colours.history, 0.25) : lighten(colours.history, 0.2),
    focal: colours.dark ? 0.16 : 0.2,
    one: colours.dark ? colours.history : lighten(colours.history, 0.45),
    fan: colours.dark ? colours.event : lighten(colours.event, 0.12),
    dots: colours.dark ? colours.history : ([0.74, 0.88, 1] as [number, number, number]),
    core: [0.86, 0.93, 1] as [number, number, number],
    halo: colours.dark ? ([0.36, 0.55, 1] as [number, number, number]) : ([0.55, 0.72, 1] as [number, number, number]),
    lift: [0.97, 0.98, 1, 1] as [number, number, number, number],
    glow: colours.dark
      ? ([0.3, 0.45, 0.85] as [number, number, number])
      : ([0.16, 0.3, 0.62] as [number, number, number]),
    ground: [0.08, 0.15, 0.33] as [number, number, number],
    gain: colours.dark ? 0.95 : 0.75,
    bloom: colours.dark ? 0.8 : 0.05,
  };
}

function createWebgl(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  layout: LineageLayout,
  reducedMotion: boolean,
  stepped: boolean,
  programs: Programs,
): Field {
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
  /** Draw simplified lines: the straight, then the curved. */
  const drawn = (parts: Lines) => ({
    straight: curves(parts.straight, SEGMENT_FLOATS, 2),
    curved: curves(parts.curved, SEGMENT_FLOATS),
  });
  const drawLines = (lines: ReturnType<typeof drawn>) => {
    for (const part of [lines.straight, lines.curved]) {
      if (!part.count) continue;
      gl.bindVertexArray(part.vao);
      gl.drawArraysInstanced(gl.LINE_STRIP, 0, part.vertices, part.count);
      count(part.vertices * part.count);
    }
  };
  const threads = curves(layout.segments, SEGMENT_FLOATS);
  const all = drawn(layout.lines.all);
  const focal = drawn(layout.lines.focal);
  const pulses = drawn(layout.lines.pulses);
  // Edges in two draws by kind: their kind is the fifth float; sorted so each kind is one range.
  const edgeList: number[][] = [[], []];
  for (let e = 0; e < layout.edges.length / EDGE_FLOATS; e++) {
    const row = Array.from(layout.edges.subarray(e * EDGE_FLOATS, (e + 1) * EDGE_FLOATS));
    edgeList[row[4] === 1 ? 1 : 0]?.push(...row.slice(0, 4), 0, 0);
  }
  const edgesOne = curves(Float32Array.from(edgeList[0] ?? []), EDGE_FLOATS);
  const edgesFan = curves(Float32Array.from(edgeList[1] ?? []), EDGE_FLOATS);
  const allEdges = curves(layout.edges, EDGE_FLOATS);

  const dotVao = gl.createVertexArray();
  gl.bindVertexArray(dotVao);
  const dotBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, layout.dots, gl.STATIC_DRAW);
  const aDot = gl.getAttribLocation(dotsProgram, "a_dot");
  gl.enableVertexAttribArray(aDot);
  gl.vertexAttribPointer(aDot, 2, gl.FLOAT, false, 0, 0);

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
  let colours: FieldColours = {
    ink: [0.05, 0.07, 0.09],
    history: [0.18, 0.37, 0.82],
    event: [0.76, 0.29, 0],
    dark: false,
  };
  let dirty = true;
  let pointer: { x: number; y: number } | null = null;
  let lift = -1;
  let running = false;
  let raf = 0;
  let start = -1;
  let lost = false;
  const times = { frames: 0, frameMs: 0, drawMs: 0, last: 0 };

  function uniforms<K extends string>(program: WebGLProgram, names: readonly K[]) {
    const out = {} as Record<K, WebGLUniformLocation | null>;
    for (const n of names) out[n] = gl.getUniformLocation(program, n);
    return out;
  }
  const lu = uniforms(lines, [
    "u_m",
    "u_young",
    "u_res",
    "u_offset",
    "u_colour",
    "u_time",
    "u_pulse",
    "u_still",
    "u_eras",
  ] as const);
  const du = uniforms(dotsProgram, ["u_m", "u_res", "u_size", "u_colour"] as const);
  const qu = uniforms(quad, [
    "u_field",
    "u_res",
    "u_inv",
    "u_reveal",
    "u_pointer",
    "u_radius",
    "u_tint",
    "u_glow",
    "u_gain",
    "u_dark",
    "u_bloom",
    "u_ground",
  ] as const);
  // A still field of half floats where the browser can draw into them: thousands of faint lines add up without the
  // steps of 8 bits.
  const floats =
    gl.getExtension("EXT_color_buffer_float") !== null || gl.getExtension("EXT_color_buffer_half_float") !== null;
  let textureBytes = 0;

  /** The projection in device pixels, column-major for the shaders, and its inverse. */
  const matrices = () => {
    const scaled: FieldFrame = {
      far: { x: frame.far.x * dpr, top: frame.far.top * dpr, bottom: frame.far.bottom * dpr },
      near: { x: frame.near.x * dpr, top: frame.near.top * dpr, bottom: frame.near.bottom * dpr },
    };
    const m = projection(scaled);
    const columns = (r: number[]) => [0, 3, 6, 1, 4, 7, 2, 5, 8].map((i) => r[i] ?? 0);
    return { m: new Float32Array(columns(m)), inv: new Float32Array(columns(inverse(m))) };
  };
  let projected = matrices();

  function applyLines(
    colour: [number, number, number, number],
    mode: { pulse?: boolean; still?: boolean },
    time: number,
    offset = 0,
  ) {
    gl.useProgram(lines);
    gl.uniformMatrix3fv(lu.u_m, false, projected.m);
    gl.uniform2f(lu.u_res, width, height);
    gl.uniform1f(lu.u_offset, offset);
    gl.uniform4f(lu.u_colour, ...colour);
    gl.uniform3f(lu.u_young, ...paletteOf(colours).young);
    gl.uniform1f(lu.u_time, time);
    gl.uniform1f(lu.u_pulse, mode.pulse ? 1 : 0);
    gl.uniform1f(lu.u_still, mode.still ? 1 : 0);
    gl.uniform1f(lu.u_eras, layout.eras);
  }

  function blend() {
    gl.enable(gl.BLEND);
    if (colours.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
    const palette = paletteOf(colours);
    applyLines([...palette.line, a], { still: true }, 0);
    drawLines(all);
    // The showcase's journeys (the first families): drawn again, stronger, the focal threads of the field.
    if (layout.focusIds > 0) {
      applyLines([...palette.line, palette.focal], {}, 0);
      drawLines(focal);
    }
    applyLines([...palette.one, 0.7], {}, 0);
    gl.bindVertexArray(edgesOne.vao);
    gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, edgesOne.count);
    count((STEPS + 1) * edgesOne.count);
    applyLines([...palette.fan, 1.3], {}, 0);
    gl.bindVertexArray(edgesFan.vao);
    gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, edgesFan.count);
    count((STEPS + 1) * edgesFan.count);
    gl.useProgram(dotsProgram);
    gl.uniformMatrix3fv(du.u_m, false, projected.m);
    gl.uniform2f(du.u_res, width, height);
    gl.uniform1f(du.u_size, 2.6 * dpr);
    gl.uniform4f(du.u_colour, ...palette.dots, colours.dark ? 0.5 : 0.4);
    gl.bindVertexArray(dotVao);
    gl.drawArrays(gl.POINTS, 0, layout.dots.length / 2);
    count(layout.dots.length / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    work.stillDrawCalls = work.drawCalls - before.drawCalls;
    work.stillVertices = work.vertices - before.vertices;
    dirty = false;
  }

  /** One frame at `elapsed` ms since the field began. */
  function draw(elapsed: number) {
    if (lost) return;
    const t0 = performance.now();
    work.drawCalls = 0;
    work.vertices = 0;
    if (dirty) drawStill();
    else {
      work.stillDrawCalls = 0;
      work.stillVertices = 0;
    }
    const shown = reducedMotion ? REVEAL_MS : elapsed;
    const reveal = Math.min(1, shown / REVEAL_MS);
    const eased = 1 - (1 - reveal) ** 3;
    const seconds = elapsed / 1000;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    blend();
    gl.useProgram(quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(qu.u_field, 0);
    gl.uniform2f(qu.u_res, width, height);
    gl.uniformMatrix3fv(qu.u_inv, false, projected.inv);
    gl.uniform1f(qu.u_reveal, reveal >= 1 ? 2 : -0.06 + 1.12 * eased);
    gl.uniform3f(qu.u_pointer, (pointer?.x ?? 0) * dpr, (pointer?.y ?? 0) * dpr, pointer ? 1 : 0);
    gl.uniform1f(qu.u_radius, 170 * dpr);
    const palette = paletteOf(colours);
    gl.uniform3f(qu.u_tint, ...colours.history);
    gl.uniform3f(qu.u_glow, ...palette.glow);
    gl.uniform3f(qu.u_ground, ...palette.ground);
    gl.uniform1f(qu.u_gain, palette.gain);
    gl.uniform1f(qu.u_dark, colours.dark ? 1 : 0);
    gl.uniform1f(qu.u_bloom, palette.bloom);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    count(4);
    const light = reducedMotion ? 0 : Math.min(1, Math.max(0, (shown - REVEAL_MS * 0.8) / LIGHT_IN_MS));
    if (light > 0) {
      // The travelling light: in the dark theme light added to the field, a core and a halo; in the light theme a bead
      // of the history hue's ink laid over it, with a pale halo.
      const { core, halo } = palette;
      const passes: [number, number][] = [
        [0, colours.dark ? 0.95 : 0.9],
        [-1.2, 0.32],
        [1.2, 0.32],
        [-2.6, 0.1],
        [2.6, 0.1],
      ];
      for (const [offset, alpha] of passes) {
        applyLines([...(offset === 0 ? core : halo), alpha * light], { pulse: true }, seconds, offset * dpr);
        drawLines(pulses);
      }
      blend();
    }
    if (lift >= 0 && !reducedMotion) {
      const first = layout.familyOf[2 * lift] ?? lift;
      const last = layout.familyOf[2 * lift + 1] ?? lift;
      const s0 = layout.segmentStart[first] ?? 0;
      const s1 = layout.segmentStart[last + 1] ?? 0;
      const e0 = layout.edgeStart[first] ?? 0;
      const e1 = layout.edgeStart[last + 1] ?? 0;
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const strong = palette.lift;
      for (const offset of [-0.6 * dpr, 0, 0.6 * dpr]) {
        applyLines(strong, {}, 0, offset);
        threads.point(s0);
        gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, s1 - s0);
        count((STEPS + 1) * (s1 - s0));
        if (e1 > e0) {
          applyLines([...palette.fan, 1], {}, 0, offset);
          allEdges.point(e0);
          gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, e1 - e0);
          count((STEPS + 1) * (e1 - e0));
        }
      }
      threads.point(0);
      allEdges.point(0);
    }
    gl.bindVertexArray(null);
    times.drawMs += performance.now() - t0;
    times.frames++;
  }

  function loop(now: number) {
    raf = 0;
    if (start < 0) start = now;
    if (times.last) times.frameMs += now - times.last;
    times.last = now;
    draw(now - start);
    if (running && !reducedMotion) raf = requestAnimationFrame(loop);
  }

  function request() {
    if (stepped) return;
    if (!raf && !lost) raf = requestAnimationFrame(loop);
  }

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    mode: "webgl2",
    element: canvas,
    resize(w, h, f) {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(w * dpr));
      height = Math.max(1, Math.round(h * dpr));
      canvas.width = width;
      canvas.height = height;
      frame = f;
      projected = matrices();
      dirty = true;
      request();
    },
    setColours(c) {
      colours = c;
      dirty = true;
      request();
    },
    setPointer(p, id) {
      if (reducedMotion) return;
      pointer = p;
      lift = id;
      request();
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
    stats() {
      return {
        frames: times.frames,
        meanFrameMs: times.frames > 1 ? times.frameMs / (times.frames - 1) : 0,
        meanDrawMs: times.frames ? times.drawMs / times.frames : 0,
      };
    },
    work() {
      return { ...work, texture: { width, height, bytes: textureBytes } };
    },
    drawAt(ms) {
      draw(ms);
    },
    destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** Without WebGL2: the still field on a 2D canvas, drawn in slices over frames so that no long task holds the page;
 *  no light, no pointer. */
function createStill(canvas: HTMLCanvasElement, layout: LineageLayout): Field {
  const context = canvas.getContext("2d");
  let job = 0;
  let painted = 0;
  let size: { w: number; h: number; frame: FieldFrame } = {
    w: 1,
    h: 1,
    frame: { far: { x: 0, top: 0, bottom: 1 }, near: { x: 1, top: 0, bottom: 1 } },
  };
  let colours: FieldColours = {
    ink: [0.05, 0.07, 0.09],
    history: [0.18, 0.37, 0.82],
    event: [0.76, 0.29, 0],
    dark: false,
  };
  const css = (rgb: [number, number, number], a: number) =>
    `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")} / ${a})`;
  function paint() {
    if (!context) return;
    if (job) cancelAnimationFrame(job);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.w, size.h);
    const f = size.frame;
    const place = placer(f);
    const alpha = lineAlpha(layout, spreadOf(f, dpr));
    const palette = paletteOf(colours);
    // Dark: the pale lines added up as light; light: the cyanotype's blue as ink on the paper.
    const ink = colours.dark ? palette.line : palette.ground;
    context.globalCompositeOperation = colours.dark ? "lighter" : "source-over";
    // Each curve as the shaders draw it: x along, y by a smooth step, placed on the plane.
    const curve = (data: Float32Array, stride: number, from: number, to: number) => {
      for (let s = from; s < to; s++) {
        const o = s * stride;
        const x0 = data[o] ?? 0;
        const y0 = data[o + 1] ?? 0;
        const x1 = data[o + 2] ?? 0;
        const y1 = data[o + 3] ?? 0;
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const p = place(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t * t * (3 - 2 * t));
          if (i === 0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        }
      }
    };
    // One stroke per id, so that lines lying over each other add up as they do on the GPU; drawn in slices of a few
    // milliseconds, one a frame, so that no long task holds the page however slow the device.
    const ids = layout.shown;
    let at = 0;
    const step = () => {
      job = 0;
      context.lineWidth = 1 / dpr;
      context.strokeStyle = css(ink, Math.min(0.12, alpha * 0.22));
      const began = performance.now();
      while (at < ids && performance.now() - began < 3) {
        context.beginPath();
        curve(layout.segments, SEGMENT_FLOATS, layout.segmentStart[at] ?? 0, layout.segmentStart[at + 1] ?? 0);
        context.stroke();
        at++;
      }
      if (at < ids) {
        job = requestAnimationFrame(step);
        return;
      }
      const edges = layout.edges;
      for (const fan of [0, 1]) {
        context.beginPath();
        context.strokeStyle = css(fan ? colours.event : colours.history, fan ? 0.8 : 0.55);
        for (let e = 0; e < edges.length / EDGE_FLOATS; e++)
          if ((edges[e * EDGE_FLOATS + 4] ?? 0) === fan) curve(edges, EDGE_FLOATS, e, e + 1);
        context.stroke();
      }
      context.fillStyle = css(colours.history, 0.3);
      for (let d = 0; d < layout.dots.length; d += 2) {
        const p = place(layout.dots[d] ?? 0, layout.dots[d + 1] ?? 0);
        context.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
      }
      painted++;
    };
    job = requestAnimationFrame(step);
  }
  return {
    mode: "canvas2d",
    element: canvas,
    resize(w, h, frame) {
      size = { w, h, frame };
      paint();
    },
    setColours(c) {
      colours = c;
      paint();
    },
    setPointer: () => undefined,
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
