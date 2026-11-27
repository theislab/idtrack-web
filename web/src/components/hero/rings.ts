// The home's second picture: the releases as rings, an architectural piece in hairlines. Each Ensembl release of the
// graph is one ring, the first innermost (`GET /organisms/{organism}/history`): its weight the gene ids active there;
// outside it a tick for each `unit` ids created at that release, inside it a tick for each `unit` ids retired across
// the transition into it; between two rings, one short spoke in the event hue for each gene version whose history
// edges fan out to two or more versions or in from two or more (exact counts); the first ring of each later assembly
// in the assembly-change hue. Each ring turns at a pace set by how much Ensembl changed in it (new versions, new ids
// and retirements over the ids active): a calm release barely moves, a churning one turns. WebGL2, else one still 2D
// drawing.
import type { HistoryResponse } from "../../api/types";
import { drawsInSoftware, type FieldColours } from "./field";

export interface RingsModel {
  releases: number[];
  active: number[];
  created: number[];
  retired: number[];
  fans: number[];
  churn: number[];
  /** Ids per tick. */
  unit: number;
  /** Ring indices at which a later assembly begins. */
  changes: number[];
}

/** The rings of a graph's history; `changes` the first releases of its later assemblies. */
export function ringsOf(history: HistoryResponse, changes: readonly number[]): RingsModel {
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
  const created = history.releases.map((r, k) => (k === 0 ? 0 : r.created));
  const busiest = Math.max(1, ...created, ...retired);
  // About 240 ticks on the busiest ring, at a round number of ids per tick.
  const raw = busiest / 240;
  const unit = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((u) => u >= raw) ?? Math.ceil(raw);
  return {
    releases,
    active,
    created,
    retired,
    fans,
    churn: releases.map((_, k) => (changed[k] ?? 0) / Math.max(1, active[k] ?? 1)),
    unit,
    changes: changes.map((r) => at.get(r)).filter((k): k is number => k !== undefined),
  };
}

/** Kinds of mark (the vertex's fourth value). */
const RING = 0;
const CREATED = 1;
const RETIRED = 2;
const FAN = 3;
const CHANGE = 4;

/** The marks as vertices: radius (0 the first ring, 1 the last), angle, ring, kind, weight; two per segment. */
function geometry(model: RingsModel): Float32Array {
  const n = model.releases.length;
  const out: number[] = [];
  const top = Math.max(1, ...model.active);
  const radius = (k: number) => (n > 1 ? k / (n - 1) : 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < n; k++) {
    const r = radius(k);
    const weight = 0.2 + 0.8 * ((model.active[k] ?? 0) / top);
    const kind = model.changes.includes(k) ? CHANGE : RING;
    const parts = 192;
    for (let i = 0; i < parts; i++) {
      const a0 = (i / parts) * Math.PI * 2;
      const a1 = ((i + 1) / parts) * Math.PI * 2;
      out.push(r, a0, k, kind, weight, r, a1, k, kind, weight);
    }
    const ticks = (count: number, kindOf: number, offset: number) => {
      const m = Math.round(count / model.unit);
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2 + k * golden + offset;
        out.push(r, a, k, kindOf, 1, r, a, k, kindOf, 0);
      }
    };
    ticks(model.created[k] ?? 0, CREATED, 0);
    ticks(model.retired[k] ?? 0, RETIRED, golden / 2);
    const f = model.fans[k] ?? 0;
    for (let i = 0; i < f && k > 0; i++) {
      const a = (i / f) * Math.PI * 2 + k * golden * 1.7;
      out.push(radius(k - 1), a, k, FAN, 1, r, a, k, FAN, 1);
    }
  }
  return Float32Array.from(out);
}

const VERTEX = `#version 300 es
precision highp float;
in vec4 a_mark; // radius, angle, ring, kind
in float a_weight;
uniform vec2 u_res;
uniform vec4 u_place; // centre x, centre y, inner, outer (device px)
uniform float u_turn[128];
uniform float u_tick;
uniform float u_focus;
out float v_kind;
out float v_weight;
out float v_focus;
void main() {
  int ring = int(a_mark.z + 0.5);
  float r = u_place.z + a_mark.x * (u_place.w - u_place.z);
  float kind = a_mark.w;
  // A tick runs from the ring outward (created) or inward (retired); its end is the vertex of weight 0.
  if (kind > 0.5 && kind < 2.5 && a_weight < 0.5) r += kind < 1.5 ? u_tick : -u_tick;
  float a = a_mark.y + u_turn[ring] - 1.5707963;
  vec2 p = u_place.xy + r * vec2(cos(a), sin(a));
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_kind = kind;
  v_weight = kind < 0.5 || kind > 3.5 ? a_weight : 1.0;
  v_focus = abs(a_mark.z - u_focus) < 0.5 ? 1.0 : 0.0;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in float v_kind;
in float v_weight;
in float v_focus;
uniform vec3 u_ink;
uniform vec3 u_hues[3]; // history, event, handoff
uniform float u_alpha;
out vec4 colour;
void main() {
  vec3 rgb = u_ink;
  float a = 0.55 * v_weight;
  if (v_kind > 0.5 && v_kind < 1.5) { rgb = u_hues[0]; a = 0.55; }
  else if (v_kind > 1.5 && v_kind < 2.5) { a = 0.32; }
  else if (v_kind > 2.5 && v_kind < 3.5) { rgb = u_hues[1]; a = 0.9; }
  else if (v_kind > 3.5) { rgb = u_hues[2]; a = 0.5 + 0.4 * v_weight; }
  a *= u_alpha * (v_focus > 0.5 ? 1.8 : 1.0);
  a = min(a, 1.0);
  colour = vec4(rgb * a, a);
}`;

export interface RingsView {
  mode: "webgl2" | "canvas2d";
  resize(width: number, height: number, place: { cx: number; cy: number; inner: number; outer: number }): void;
  setColours(colours: FieldColours & { handoff: [number, number, number] }): void;
  /** The pointer (CSS px) or null; returns the ring under it, or -1. */
  setPointer(point: { x: number; y: number } | null): number;
  setRunning(running: boolean): void;
  stats(): { frames: number; meanFrameMs: number; meanDrawMs: number };
  destroy(): void;
}

export function createRings(canvas: HTMLCanvasElement, model: RingsModel, reduced: boolean): RingsView {
  const n = model.releases.length;
  let dpr = 1;
  let width = 1;
  let height = 1;
  let place = { cx: 0, cy: 0, inner: 10, outer: 100 };
  let colours: FieldColours & { handoff: [number, number, number] } = {
    ink: [0.05, 0.07, 0.09],
    history: [0.18, 0.37, 0.82],
    event: [0.76, 0.29, 0],
    handoff: [0.75, 0.22, 0.6],
    dark: false,
  };
  let focus = -1;
  let running = false;
  let raf = 0;
  let start = -1;
  let last = 0;
  const times = { frames: 0, frameMs: 0, drawMs: 0 };
  let still = reduced;
  // Each ring's pace: a full turn in about 40 minutes for the calmest, in about 2 minutes for the most churned.
  const most = Math.max(1e-6, ...model.churn);
  const pace = model.churn.map((c) => 0.0025 + 0.05 * Math.sqrt(c / most));
  const turns = (seconds: number) => {
    const out = new Float32Array(128);
    for (let k = 0; k < Math.min(n, 128); k++) out[k] = still ? k * 0.21 : k * 0.21 + seconds * (pace[k] ?? 0);
    return out;
  };
  const ringAt = (p: { x: number; y: number }) => {
    const d = Math.hypot(p.x - place.cx, p.y - place.cy);
    const f = (d - place.inner) / Math.max(1, place.outer - place.inner);
    const k = Math.round(f * (n - 1));
    return f < -0.05 || f > 1.05 ? -1 : Math.max(0, Math.min(n - 1, k));
  };

  const webgl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!webgl) return drawStill();
  const gl: WebGL2RenderingContext = webgl;
  if (drawsInSoftware(gl)) still = true;
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return drawStill();
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return drawStill();
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return drawStill();
  const data = geometry(model);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const mark = gl.getAttribLocation(program, "a_mark");
  const weight = gl.getAttribLocation(program, "a_weight");
  gl.enableVertexAttribArray(mark);
  gl.vertexAttribPointer(mark, 4, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(weight);
  gl.vertexAttribPointer(weight, 1, gl.FLOAT, false, 20, 16);
  gl.bindVertexArray(null);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const count = data.length / 5;

  function draw(now: number) {
    const t0 = performance.now();
    if (start < 0) start = now;
    const seconds = (now - start) / 1000;
    const appear = still ? 1 : Math.min(1, seconds / 1.6);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (colours.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform2f(u("u_res"), width, height);
    // The rings open from the centre as the picture appears.
    gl.uniform4f(
      u("u_place"),
      place.cx * dpr,
      place.cy * dpr,
      place.inner * dpr * appear,
      (place.inner + (place.outer - place.inner) * (1 - (1 - appear) ** 3)) * dpr,
    );
    gl.uniform1fv(u("u_turn"), turns(seconds));
    gl.uniform1f(u("u_tick"), 7 * dpr);
    gl.uniform1f(u("u_focus"), focus);
    const ink: [number, number, number] = colours.dark ? [0.82, 0.86, 0.94] : colours.ink;
    gl.uniform3f(u("u_ink"), ...ink);
    gl.uniform3fv(u("u_hues"), [...colours.history, ...colours.event, ...colours.handoff]);
    gl.uniform1f(u("u_alpha"), appear);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.LINES, 0, count);
    gl.bindVertexArray(null);
    times.drawMs += performance.now() - t0;
    if (last) times.frameMs += now - last;
    last = now;
    times.frames++;
  }
  const loop = (now: number) => {
    raf = 0;
    draw(now);
    if (running && !still) raf = requestAnimationFrame(loop);
  };
  const request = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };
  return {
    mode: "webgl2",
    resize(w, h, p) {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(w * dpr));
      height = Math.max(1, Math.round(h * dpr));
      canvas.width = width;
      canvas.height = height;
      place = p;
      request();
    },
    setColours(c) {
      colours = c;
      request();
    },
    setPointer(p) {
      focus = p && !reduced ? ringAt(p) : -1;
      request();
      return focus;
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
    destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };

  /** Without WebGL2: the rings drawn once on a 2D canvas. */
  function drawStill(): RingsView {
    const context = canvas.getContext("2d");
    const paint = () => {
      if (!context) return;
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const data = geometry(model);
      const css = (rgb: [number, number, number], a: number) =>
        `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")} / ${a})`;
      const ink: [number, number, number] = colours.dark ? [0.82, 0.86, 0.94] : colours.ink;
      const turn = turns(0);
      for (let v = 0; v < data.length; v += 10) {
        const kind = data[v + 3] ?? 0;
        const k = data[v + 2] ?? 0;
        const point = (o: number) => {
          let r = place.inner + (data[o] ?? 0) * (place.outer - place.inner);
          if ((kind === CREATED || kind === RETIRED) && (data[o + 4] ?? 1) < 0.5) r += kind === CREATED ? 7 : -7;
          const a = (data[o + 1] ?? 0) + (turn[k] ?? 0) - Math.PI / 2;
          return [place.cx + r * Math.cos(a), place.cy + r * Math.sin(a)] as const;
        };
        const [x0, y0] = point(v);
        const [x1, y1] = point(v + 5);
        context.strokeStyle =
          kind === CREATED
            ? css(colours.history, 0.55)
            : kind === RETIRED
              ? css(ink, 0.32)
              : kind === FAN
                ? css(colours.event, 0.9)
                : kind === CHANGE
                  ? css(colours.handoff, 0.7)
                  : css(ink, 0.55 * (data[v + 4] ?? 1));
        context.beginPath();
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
        context.stroke();
      }
    };
    return {
      mode: "canvas2d",
      resize(w, h, p) {
        dpr = Math.min(2, window.devicePixelRatio || 1);
        width = w * dpr;
        height = h * dpr;
        place = p;
        paint();
      },
      setColours(c) {
        colours = c;
        paint();
      },
      setPointer: () => -1,
      setRunning: () => undefined,
      stats: () => ({ frames: 0, meanFrameMs: 0, meanDrawMs: 0 }),
      destroy: () => undefined,
    };
  }
}
