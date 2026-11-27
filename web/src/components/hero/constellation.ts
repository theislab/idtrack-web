// The home's third picture: the showcase's most convoluted journeys as a constellation that turns slowly about the
// axis of time. Each journey is the path its answer holds (`path.steps` of `GET /organisms/{organism}/showcase`): a
// star for each gene version or id it passes, a line for each step, in the hue of its kind (Ensembl's id history; a
// split or merge; a step across assemblies; a crossing through an external database or a bridge). Releases run along
// the axis, left to right; the journeys stand around it, each on its own strand. WebGL2, else one still 2D drawing.
import type { ConversionResult, ShowcaseResponse } from "../../api/types";
import { drawsInSoftware, type FieldColours } from "./field";

export interface Constellation {
  journeys: { identifier: string; answer: string; nodes: number; steps: number }[];
  /** Per star: x (time, -1..1), y and z (around the axis), its journey, its size. */
  stars: Float32Array;
  /** Per line: two ends (x, y, z each), its kind (0 history, 1 split or merge, 2 across assemblies, 3 external or
   *  bridge), its journey. */
  lines: Float32Array;
  first: number;
  last: number;
}

const STAR = 5;
const LINE = 8;

/** The journeys of a showcase whose paths pass the most ids and steps, at most `most`. */
export function constellationOf(showcase: ShowcaseResponse, most: number): Constellation {
  const answers: ConversionResult[] = [...showcase.cases, ...showcase.journeys]
    .map((item) => item.result)
    .filter((r): r is ConversionResult => Boolean(r?.path?.steps.length));
  const unique = new Map<string, ConversionResult>();
  for (const r of answers) if (!unique.has(r.query_id)) unique.set(r.query_id, r);
  const ranked = [...unique.values()]
    .map((r) => ({
      r,
      size: new Set(r.path?.steps.flatMap((s) => [s.source, s.target])).size + (r.path?.steps.length ?? 0),
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, most)
    .map((x) => x.r);
  const releases = ranked.flatMap((r) =>
    (r.path?.steps ?? [])
      .flatMap((s) => [s.old_release, s.new_release, s.release])
      .filter((v): v is number => v !== null),
  );
  const first = Math.min(...releases);
  const last = Math.max(...releases);
  const xOf = (release: number) => (last > first ? ((release - first) / (last - first)) * 2 - 1 : 0);
  const stars: number[] = [];
  const lines: number[] = [];
  const journeys: Constellation["journeys"] = [];
  ranked.forEach((r, j) => {
    const steps = r.path?.steps ?? [];
    // Each id's time: the mean of the releases of the steps that touch it.
    const times = new Map<string, number[]>();
    const touch = (id: string | null, release: number | null) => {
      if (id === null || release === null) return;
      times.set(id, [...(times.get(id) ?? []), release]);
    };
    for (const s of steps) {
      touch(s.source, s.old_release ?? s.release);
      touch(s.target, s.new_release ?? s.release);
    }
    // Lanes: one per stable id (an id without its version), in the order they are reached, centred on the strand.
    const lanes = new Map<string, number>();
    for (const id of times.keys()) {
      const base = id.replace(/\.\d+$/, "");
      if (!lanes.has(base)) lanes.set(base, lanes.size);
    }
    const angle = (j / Math.max(1, ranked.length)) * Math.PI * 2;
    const radius = 0.55;
    const place = (id: string): [number, number, number] => {
      const t = times.get(id) ?? [first];
      const x = xOf(t.reduce((a, b) => a + b, 0) / t.length);
      const lane = (lanes.get(id.replace(/\.\d+$/, "")) ?? 0) - (lanes.size - 1) / 2;
      const offset = lane * 0.07;
      // The strand stands at its angle around the axis; its lanes spread along the circle's tangent.
      return [
        x,
        Math.sin(angle) * radius + Math.cos(angle) * offset,
        Math.cos(angle) * radius - Math.sin(angle) * offset,
      ];
    };
    const degree = new Map<string, number>();
    for (const s of steps) {
      if (s.source === null) continue;
      degree.set(s.source, (degree.get(s.source) ?? 0) + 1);
      degree.set(s.target, (degree.get(s.target) ?? 0) + 1);
      const a = place(s.source);
      const b = place(s.target);
      const kind =
        s.kind === "history" || s.kind === "self_loop"
          ? s.splits > 0 || s.merges > 0
            ? 1
            : s.assembly !== null && s.old_assembly !== null && s.assembly !== s.old_assembly
              ? 2
              : 0
          : 3;
      lines.push(...a, ...b, kind, j);
    }
    for (const id of times.keys()) stars.push(...place(id), j, Math.min(4, degree.get(id) ?? 1));
    const best = r.candidates.find((c) => c.best);
    journeys.push({ identifier: r.query_id, answer: best?.target ?? "", nodes: times.size, steps: steps.length });
  });
  return { journeys, stars: Float32Array.from(stars), lines: Float32Array.from(lines), first, last };
}

const VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec2 a_meta; // journey, size or kind
uniform vec2 u_res;
uniform vec4 u_view; // centre x, centre y, half width, half height (device px)
uniform vec2 u_turn; // angle about the time axis, tilt
uniform float u_focus;
uniform float u_star;
out float v_depth;
out float v_focus;
out float v_kind;
void main() {
  float c = cos(u_turn.x), s = sin(u_turn.x);
  vec3 p = vec3(a_pos.x, c * a_pos.y - s * a_pos.z, s * a_pos.y + c * a_pos.z);
  float ct = cos(u_turn.y), st = sin(u_turn.y);
  p = vec3(ct * p.x + st * p.z, p.y, -st * p.x + ct * p.z);
  float perspective = 1.0 / (1.0 + 0.3 * p.z);
  vec2 screen = u_view.xy + vec2(p.x * u_view.z, p.y * u_view.w) * perspective;
  vec2 clip = screen / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_depth = clamp(0.5 - 0.5 * p.z, 0.0, 1.0);
  v_focus = abs(a_meta.x - u_focus) < 0.5 ? 1.0 : 0.0;
  v_kind = a_meta.y;
  gl_PointSize = u_star * (1.6 + a_meta.y * 0.9) * perspective * (1.0 + v_focus * 0.6);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float v_depth;
in float v_focus;
in float v_kind;
uniform vec3 u_hues[4];
uniform float u_alpha;
uniform float u_dim;
out vec4 colour;
void main() {
  int k = int(v_kind + 0.5);
  vec3 rgb = u_hues[k];
  float a = u_alpha * mix(0.25, 1.0, v_depth) * mix(u_dim, 1.0, v_focus);
  colour = vec4(rgb * a, a);
}`;

const STAR_FRAGMENT = `#version 300 es
precision highp float;
in float v_depth;
in float v_focus;
uniform vec3 u_ink;
uniform float u_alpha;
uniform float u_dim;
out vec4 colour;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  float core = smoothstep(0.35, 0.0, r);
  float halo = smoothstep(1.0, 0.1, r) * 0.35;
  float a = (core + halo) * u_alpha * mix(0.3, 1.0, v_depth) * mix(u_dim, 1.0, v_focus);
  colour = vec4(u_ink * a, a);
}`;

export interface ConstellationView {
  mode: "webgl2" | "canvas2d";
  resize(width: number, height: number, view: { cx: number; cy: number; hw: number; hh: number }): void;
  setColours(colours: FieldColours & { handoff: [number, number, number]; external: [number, number, number] }): void;
  /** The pointer (CSS px) or null; returns the journey nearest it, or -1. */
  setPointer(point: { x: number; y: number } | null): number;
  setRunning(running: boolean): void;
  stats(): { frames: number; meanFrameMs: number; meanDrawMs: number };
  destroy(): void;
}

export function createConstellation(
  canvas: HTMLCanvasElement,
  model: Constellation,
  reducedMotion: boolean,
): ConstellationView {
  let dpr = 1;
  let width = 1;
  let height = 1;
  let view = { cx: 0, cy: 0, hw: 1, hh: 1 };
  let colours = {
    ink: [0.05, 0.07, 0.09] as [number, number, number],
    history: [0.18, 0.37, 0.82] as [number, number, number],
    event: [0.76, 0.29, 0] as [number, number, number],
    handoff: [0.75, 0.22, 0.6] as [number, number, number],
    external: [0, 0.5, 0.36] as [number, number, number],
    dark: false,
  };
  let pointer: { x: number; y: number } | null = null;
  let focus = -1;
  let tilt = 0;
  let running = false;
  let raf = 0;
  let start = -1;
  let last = 0;
  const times = { frames: 0, frameMs: 0, drawMs: 0 };
  let quiet = reducedMotion;
  const angleAt = (seconds: number) => (quiet ? 0.6 : 0.6 + seconds * 0.06);

  /** A star's place on the screen (CSS px), as the shader puts it. */
  const project = (x: number, y: number, z: number, angle: number) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const py = c * y - s * z;
    let pz = s * y + c * z;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const px = ct * x + st * pz;
    pz = -st * x + ct * pz;
    const k = 1 / (1 + 0.3 * pz);
    return { x: view.cx + px * view.hw * k, y: view.cy + py * view.hh * k };
  };

  const webgl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!webgl) return still();
  const gl: WebGL2RenderingContext = webgl;
  // In software the constellation is drawn once and holds still.
  if (drawsInSoftware(gl)) quiet = true;

  const compile = (vertex: string, fragment: string) => {
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
  };
  let linesProgram: WebGLProgram;
  let starsProgram: WebGLProgram;
  try {
    linesProgram = compile(VERTEX, LINE_FRAGMENT);
    starsProgram = compile(VERTEX, STAR_FRAGMENT);
  } catch {
    return still();
  }
  const array = (program: WebGLProgram, data: Float32Array, stride: number, metaOffset: number) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "a_pos");
    const meta = gl.getAttribLocation(program, "a_meta");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, stride * 4, 0);
    gl.enableVertexAttribArray(meta);
    gl.vertexAttribPointer(meta, 2, gl.FLOAT, false, stride * 4, metaOffset * 4);
    gl.bindVertexArray(null);
    return vao;
  };
  // Lines: each end its own vertex (x, y, z, journey, kind).
  const lineVertices = new Float32Array((model.lines.length / LINE) * 2 * 5);
  for (let l = 0; l < model.lines.length / LINE; l++) {
    const o = l * LINE;
    const kind = model.lines[o + 6] ?? 0;
    const journey = model.lines[o + 7] ?? 0;
    lineVertices.set([model.lines[o] ?? 0, model.lines[o + 1] ?? 0, model.lines[o + 2] ?? 0, journey, kind], l * 10);
    lineVertices.set(
      [model.lines[o + 3] ?? 0, model.lines[o + 4] ?? 0, model.lines[o + 5] ?? 0, journey, kind],
      l * 10 + 5,
    );
  }
  const lineVao = array(linesProgram, lineVertices, 5, 3);
  const starVao = array(starsProgram, model.stars, STAR, 3);
  const lineCount = lineVertices.length / 5;
  const starCount = model.stars.length / STAR;

  function setCommon(program: WebGLProgram, angle: number) {
    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, "u_res"), width, height);
    gl.uniform4f(gl.getUniformLocation(program, "u_view"), view.cx * dpr, view.cy * dpr, view.hw * dpr, view.hh * dpr);
    gl.uniform2f(gl.getUniformLocation(program, "u_turn"), angle, tilt);
    gl.uniform1f(gl.getUniformLocation(program, "u_focus"), focus);
    gl.uniform1f(gl.getUniformLocation(program, "u_star"), 3 * dpr);
    gl.uniform1f(gl.getUniformLocation(program, "u_dim"), focus >= 0 ? 0.35 : 1);
  }

  function draw(now: number) {
    const t0 = performance.now();
    if (start < 0) start = now;
    const seconds = (now - start) / 1000;
    const appear = quiet ? 1 : Math.min(1, seconds / 1.4);
    const angle = angleAt(seconds);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (colours.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    setCommon(linesProgram, angle);
    gl.uniform3fv(gl.getUniformLocation(linesProgram, "u_hues"), [
      ...colours.history,
      ...colours.event,
      ...colours.handoff,
      ...colours.external,
    ]);
    gl.uniform1f(gl.getUniformLocation(linesProgram, "u_alpha"), (colours.dark ? 0.7 : 0.75) * appear);
    gl.bindVertexArray(lineVao);
    gl.drawArrays(gl.LINES, 0, lineCount);
    setCommon(starsProgram, angle);
    const ink: [number, number, number] = colours.dark ? [0.86, 0.9, 1] : colours.ink;
    gl.uniform3f(gl.getUniformLocation(starsProgram, "u_ink"), ...ink);
    gl.uniform1f(gl.getUniformLocation(starsProgram, "u_alpha"), 0.9 * appear);
    gl.bindVertexArray(starVao);
    gl.drawArrays(gl.POINTS, 0, starCount);
    gl.bindVertexArray(null);
    times.drawMs += performance.now() - t0;
    if (last) times.frameMs += now - last;
    last = now;
    times.frames++;
  }
  const loop = (now: number) => {
    raf = 0;
    draw(now);
    if (running && !quiet) raf = requestAnimationFrame(loop);
  };
  const request = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  return {
    mode: "webgl2",
    resize(w, h, v) {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(w * dpr));
      height = Math.max(1, Math.round(h * dpr));
      canvas.width = width;
      canvas.height = height;
      view = v;
      request();
    },
    setColours(c) {
      colours = c;
      request();
    },
    setPointer(p) {
      if (quiet) return -1;
      pointer = p;
      tilt = p ? ((p.x - view.cx) / Math.max(1, view.hw)) * 0.12 : 0;
      focus = -1;
      if (p) {
        const angle = angleAt(((last || performance.now()) - Math.max(0, start)) / 1000);
        let best = 26;
        for (let s = 0; s < starCount; s++) {
          const o = s * STAR;
          const q = project(model.stars[o] ?? 0, model.stars[o + 1] ?? 0, model.stars[o + 2] ?? 0, angle);
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < best) {
            best = d;
            focus = model.stars[o + 3] ?? -1;
          }
        }
      }
      request();
      return pointer ? focus : -1;
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

  /** Without WebGL2: the constellation drawn once, unturned. */
  function still(): ConstellationView {
    const context = canvas.getContext("2d");
    const paint = () => {
      if (!context) return;
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const hues = [colours.history, colours.event, colours.handoff, colours.external];
      for (let l = 0; l < model.lines.length / LINE; l++) {
        const o = l * LINE;
        const a = project(model.lines[o] ?? 0, model.lines[o + 1] ?? 0, model.lines[o + 2] ?? 0, 0.6);
        const b = project(model.lines[o + 3] ?? 0, model.lines[o + 4] ?? 0, model.lines[o + 5] ?? 0, 0.6);
        const rgb = hues[model.lines[o + 6] ?? 0] ?? colours.history;
        context.strokeStyle = `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")} / 0.7)`;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      const ink = colours.dark ? [0.86, 0.9, 1] : colours.ink;
      context.fillStyle = `rgb(${ink.map((v) => Math.round(v * 255)).join(" ")} / 0.85)`;
      for (let s = 0; s < model.stars.length / STAR; s++) {
        const o = s * STAR;
        const q = project(model.stars[o] ?? 0, model.stars[o + 1] ?? 0, model.stars[o + 2] ?? 0, 0.6);
        context.beginPath();
        context.arc(q.x, q.y, 1.5 + (model.stars[o + 4] ?? 1) * 0.5, 0, Math.PI * 2);
        context.fill();
      }
    };
    return {
      mode: "canvas2d",
      resize(w, h, v) {
        dpr = Math.min(2, window.devicePixelRatio || 1);
        width = w * dpr;
        height = h * dpr;
        view = v;
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
