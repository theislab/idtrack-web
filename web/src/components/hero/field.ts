// The renderer of the home's lineage field: WebGL2 where the browser has it, else one still drawing on a 2D canvas.
// What it draws is the layout of lib/hero/lineageLayout.ts (each gene id a line over the releases it is active at, a
// dot at each new version, a curve for each history edge to another id), nothing else. The still field is drawn once
// into a texture (again only on a resize or a change of theme); each frame composites it, revealed along the time axis
// once, brightened near the pointer, with light travelling along the lines of time and the family under the pointer
// lifted. It draws only while the hero is on screen and the page is shown, and under reduced motion one still frame.
import { EDGE_FLOATS, SEGMENT_FLOATS, type LineageLayout } from "../../lib/hero/lineageLayout";

export interface FieldFrame {
  /** The field's left and right edges, its centre line and half its height, in CSS pixels of the canvas. */
  left: number;
  right: number;
  centre: number;
  half: number;
}

/** A point of the field (fractions) in CSS pixels, as the shaders place it. */
export function placeOf(frame: FieldFrame, x: number, y: number): { x: number; y: number } {
  return { x: frame.left + x * (frame.right - frame.left), y: frame.centre + y * 2 * frame.half };
}

/** The inverse of `placeOf`: fractions of the field for a point in CSS pixels. */
export function fieldAt(frame: FieldFrame, px: number, py: number): { x: number; y: number } {
  return { x: (px - frame.left) / (frame.right - frame.left), y: (py - frame.centre) / (2 * frame.half) };
}

export interface FieldColours {
  ink: [number, number, number];
  history: [number, number, number];
  event: [number, number, number];
  dark: boolean;
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
  destroy(): void;
}

/** Steps of a curve between two releases: a smooth step in y, linear in x. */
const STEPS = 10;
const REVEAL_MS = 1600;

const VERTEX = `#version 300 es
precision highp float;
in float a_t;
in vec4 a_seg;
in vec2 a_meta;
uniform vec4 u_frame; // left, centre, width, half height (device px)
uniform vec2 u_res;
uniform float u_offset;
uniform float u_eras;
out float v_fade;
out float v_x;
out float v_phase;
out float v_era;
void main() {
  float s = a_t * a_t * (3.0 - 2.0 * a_t);
  float x = mix(a_seg.x, a_seg.z, a_t);
  float y = mix(a_seg.y, a_seg.w, s);
  vec2 p = vec2(u_frame.x + x * u_frame.z, u_frame.y + y * 2.0 * u_frame.w + u_offset);
  v_fade = a_meta.x == 1.0 ? a_t : (a_meta.x == 2.0 ? 1.0 - a_t : 1.0);
  v_x = x;
  v_phase = fract(a_meta.y);
  // Growth rings: the ids of the first assembly in full ink, each later era a step lighter.
  v_era = u_eras > 1.0 ? floor(a_meta.y) / (u_eras - 1.0) : 0.0;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float v_fade;
in float v_x;
in float v_phase;
in float v_era;
uniform vec4 u_colour;
uniform float u_time;
uniform float u_pulse;
out vec4 colour;
void main() {
  float a = u_colour.a * v_fade * (u_pulse > 0.5 ? 1.0 : mix(1.0, 0.35, v_era));
  if (u_pulse > 0.5) {
    // Light travelling with time along the line: its head at h, its tail fading behind it.
    float speed = 0.045 + 0.05 * fract(v_phase * 7.13);
    float h = fract(u_time * speed + v_phase) * 1.4 - 0.2;
    float d = h - v_x;
    float tail = 0.05 + 0.04 * fract(v_phase * 3.7);
    float light = d > 0.0 && d < tail ? pow(1.0 - d / tail, 2.2) : 0.0;
    a *= light;
  }
  colour = vec4(u_colour.rgb * a, a);
}`;

const DOT_VERTEX = `#version 300 es
precision highp float;
in vec2 a_dot;
uniform vec4 u_frame;
uniform vec2 u_res;
uniform float u_size;
void main() {
  vec2 p = vec2(u_frame.x + a_dot.x * u_frame.z, u_frame.y + a_dot.y * 2.0 * u_frame.w);
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = u_size;
}`;

const DOT_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 u_colour;
out vec4 colour;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  float a = u_colour.a * smoothstep(1.0, 0.55, r);
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
uniform float u_reveal; // device px: what lies left of it is shown
uniform vec3 u_pointer; // device px, and 1 where the pointer is on the field
uniform float u_radius;
uniform vec3 u_tint;
uniform float u_gain;
out vec4 colour;
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  vec4 c = texture(u_field, v_uv);
  float shown = 1.0 - smoothstep(u_reveal - 60.0, u_reveal, p.x);
  float glow = u_pointer.z * exp(-dot(p - u_pointer.xy, p - u_pointer.xy) / (u_radius * u_radius));
  // The still field holds the density of what is drawn, added up; it is mapped to ink as a veil that never saturates
  // (1 - e^-density), so the dense core reads dark and every sparse edge, birth and retirement stays visible.
  vec3 hue = c.a > 1e-5 ? c.rgb / c.a : vec3(0.0);
  float a = 1.0 - exp(-u_gain * c.a * (1.0 + glow * 1.4));
  vec3 rgb = mix(hue, u_tint, glow * 0.8) * a;
  colour = vec4(rgb, a) * shown;
}`;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("no shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
  return program;
}

/** The ids whose lines carry the travelling light: every id of a family with an edge first (the convoluted
 *  lineages), then others spread through the field, `most` in all. */
function pulseIds(layout: LineageLayout, most: number): number[] {
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
 *  seconds and a fraction of one. */
export function simplified(
  layout: LineageLayout,
  ids: Iterable<number>,
  tolerance: number,
): { straight: Float32Array; curved: Float32Array } {
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

/** The device pixels across which the ids of the widest release are spread (the field's height). */
function spreadOf(frame: FieldFrame, dpr: number): number {
  return 2 * frame.half * dpr;
}

/** A line's weight in the density: where the lines lie thickest they add up to about 1 (the composite's gain then
 *  sets how dark that is), and a line alone keeps a visible weight. On 8-bit textures (no float target) the sum
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

export function createField(canvas: HTMLCanvasElement, layout: LineageLayout, reducedMotion: boolean): Field {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  if (!gl) return createStill(canvas, layout);
  // In software (no GPU) WebGL would hold the page for seconds: the still drawing on a 2D canvas instead, in slices.
  if (drawsInSoftware(gl)) return createStill(fresh(canvas, gl), layout);
  try {
    return createWebgl(canvas, gl, layout, reducedMotion);
  } catch {
    return createStill(fresh(canvas, gl), layout);
  }
}

/** A new canvas in the place of one that holds a WebGL context (a canvas holds one kind of context for good). */
function fresh(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): HTMLCanvasElement {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  const other = document.createElement("canvas");
  other.className = canvas.className;
  canvas.replaceWith(other);
  return other;
}

function createWebgl(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  layout: LineageLayout,
  reducedMotion: boolean,
): Field {
  const lines = compile(gl, VERTEX, LINE_FRAGMENT);
  const dotsProgram = compile(gl, DOT_VERTEX, DOT_FRAGMENT);
  const quad = compile(gl, QUAD_VERTEX, QUAD_FRAGMENT);
  const steps = new Float32Array(STEPS + 1).map((_, i) => i / STEPS);

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
  const drawn = (parts: { straight: Float32Array; curved: Float32Array }) => ({
    straight: curves(parts.straight, SEGMENT_FLOATS, 2),
    curved: curves(parts.curved, SEGMENT_FLOATS),
  });
  const drawLines = (lines: ReturnType<typeof drawn>) => {
    for (const part of [lines.straight, lines.curved]) {
      if (!part.count) continue;
      gl.bindVertexArray(part.vao);
      gl.drawArraysInstanced(gl.LINE_STRIP, 0, part.vertices, part.count);
    }
  };
  const ids = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  // Within a quarter of the gap between two lines, a run is drawn straight.
  const tolerance = 0.25 / layout.widest;

  const threads = curves(layout.segments, SEGMENT_FLOATS);
  const all = drawn(simplified(layout, ids(0, layout.shown), tolerance));
  const focal = drawn(simplified(layout, ids(0, layout.focusIds), tolerance));
  const pulses = drawn(simplified(layout, pulseIds(layout, layout.shown > 2500 ? 600 : 260), tolerance));
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
  let frame: FieldFrame = { left: 0, right: 1, centre: 0.5, half: 0.25 };
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
  const lu = uniforms(lines, ["u_frame", "u_res", "u_offset", "u_colour", "u_time", "u_pulse", "u_eras"] as const);
  const du = uniforms(dotsProgram, ["u_frame", "u_res", "u_size", "u_colour"] as const);
  const qu = uniforms(quad, ["u_field", "u_res", "u_reveal", "u_pointer", "u_radius", "u_tint", "u_gain"] as const);
  // A still field of half floats where the browser can draw into them: thousands of faint lines add up without the
  // steps of 8 bits.
  const floats =
    gl.getExtension("EXT_color_buffer_float") !== null || gl.getExtension("EXT_color_buffer_half_float") !== null;

  const frameUniform = (): [number, number, number, number] => [
    frame.left * dpr,
    frame.centre * dpr,
    (frame.right - frame.left) * dpr,
    frame.half * dpr,
  ];
  function applyLines(colour: [number, number, number, number], pulse: boolean, time: number, offset = 0) {
    gl.useProgram(lines);
    gl.uniform4f(lu.u_frame, ...frameUniform());
    gl.uniform2f(lu.u_res, width, height);
    gl.uniform1f(lu.u_offset, offset);
    gl.uniform4f(lu.u_colour, ...colour);
    gl.uniform1f(lu.u_time, time);
    gl.uniform1f(lu.u_pulse, pulse ? 1 : 0);
    gl.uniform1f(lu.u_eras, layout.eras);
  }

  function blend() {
    gl.enable(gl.BLEND);
    if (colours.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** The still field, into the texture. */
  function drawStill() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (floats) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
    // The lines' ink: in the light theme the text's ink drawn a little toward the history hue (a blue-black), in the
    // dark a pale steel.
    const ink: [number, number, number] = colours.dark
      ? [0.62, 0.7, 0.86]
      : ([0, 1, 2].map((i) => (colours.ink[i] ?? 0) * 0.8 + (colours.history[i] ?? 0) * 0.2) as [
          number,
          number,
          number,
        ]);
    applyLines([...ink, a], false, 0);
    drawLines(all);
    // The showcase's journeys (the first families): drawn again, stronger, the focal threads of the field.
    if (layout.focusIds > 0) {
      applyLines([...ink, colours.dark ? 0.26 : 0.3], false, 0);
      drawLines(focal);
    }
    applyLines([...colours.history, 0.6], false, 0);
    gl.bindVertexArray(edgesOne.vao);
    gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, edgesOne.count);
    applyLines([...colours.event, 1.2], false, 0);
    gl.bindVertexArray(edgesFan.vao);
    gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, edgesFan.count);
    gl.useProgram(dotsProgram);
    gl.uniform4f(du.u_frame, ...frameUniform());
    gl.uniform2f(du.u_res, width, height);
    gl.uniform1f(du.u_size, 1.7 * dpr);
    gl.uniform4f(du.u_colour, ...colours.history, 0.3);
    gl.bindVertexArray(dotVao);
    gl.drawArrays(gl.POINTS, 0, layout.dots.length / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    dirty = false;
  }

  function draw(now: number) {
    if (lost) return;
    const t0 = performance.now();
    if (start < 0) start = now;
    if (dirty) drawStill();
    const elapsed = reducedMotion ? REVEAL_MS : now - start;
    const reveal = Math.min(1, elapsed / REVEAL_MS);
    const eased = 1 - (1 - reveal) ** 4;
    const seconds = (now - start) / 1000;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    blend();
    gl.useProgram(quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(qu.u_field, 0);
    gl.uniform2f(qu.u_res, width, height);
    gl.uniform1f(qu.u_reveal, (frame.left + (frame.right - frame.left + 120) * eased) * dpr);
    gl.uniform3f(qu.u_pointer, (pointer?.x ?? 0) * dpr, (pointer?.y ?? 0) * dpr, pointer ? 1 : 0);
    gl.uniform1f(qu.u_radius, 150 * dpr);
    gl.uniform3f(qu.u_tint, ...colours.history);
    gl.uniform1f(qu.u_gain, colours.dark ? 0.9 : 0.8);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!reducedMotion && reveal >= 1) {
      // The travelling light: in the dark theme light added to the field; in the light theme a bead of the history
      // hue's ink laid over it.
      if (colours.dark) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const light: [number, number, number] = colours.dark ? [0.75, 0.85, 1] : colours.history;
      applyLines([...light, colours.dark ? 0.85 : 0.9], true, seconds);
      drawLines(pulses);
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
      const strong: [number, number, number, number] = colours.dark ? [0.95, 0.97, 1, 1] : [...colours.ink, 1];
      for (const offset of [-0.6 * dpr, 0, 0.6 * dpr]) {
        applyLines(strong, false, 0, offset);
        threads.point(s0);
        gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, s1 - s0);
        if (e1 > e0) {
          applyLines([...colours.event, 1], false, 0, offset);
          allEdges.point(e0);
          gl.drawArraysInstanced(gl.LINE_STRIP, 0, STEPS + 1, e1 - e0);
        }
      }
      threads.point(0);
      allEdges.point(0);
    }
    gl.bindVertexArray(null);
    times.drawMs += performance.now() - t0;
    if (times.last) times.frameMs += now - times.last;
    times.last = now;
    times.frames++;
  }

  function loop(now: number) {
    raf = 0;
    draw(now);
    if (running && !reducedMotion) raf = requestAnimationFrame(loop);
  }

  function request() {
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
  let size: { w: number; h: number; frame: FieldFrame } = {
    w: 1,
    h: 1,
    frame: { left: 0, right: 1, centre: 0.5, half: 0.25 },
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
    const alpha = lineAlpha(layout, spreadOf(f, dpr));
    const ink: [number, number, number] = colours.dark ? [0.62, 0.7, 0.86] : colours.ink;
    // Each curve as the shaders draw it: x along, y by a smooth step, placed on the field or the rings.
    const curve = (data: Float32Array, stride: number, from: number, to: number) => {
      for (let s = from; s < to; s++) {
        const o = s * stride;
        const x0 = data[o] ?? 0;
        const y0 = data[o + 1] ?? 0;
        const x1 = data[o + 2] ?? 0;
        const y1 = data[o + 3] ?? 0;
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const p = placeOf(f, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t * t * (3 - 2 * t));
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
      context.fillStyle = css(colours.history, 0.2);
      for (let d = 0; d < layout.dots.length; d += 2) {
        const p = placeOf(f, layout.dots[d] ?? 0, layout.dots[d + 1] ?? 0);
        context.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
      }
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
    stats: () => ({ frames: 0, meanFrameMs: 0, meanDrawMs: 0 }),
    destroy() {
      if (job) cancelAnimationFrame(job);
    },
  };
}
