/// <reference types="vite/client" />
// What the home's pictures and the History tab's lineage field share: the theme's inks read from the page, the watch
// on the theme, on the element being on screen and on reduced motion; the one decision of the page on how WebGL draws
// here; the care of a WebGL context that the browser takes away and gives back; and the development clock that steps
// the pictures' time. One definition of each, so that a rule changes in one place.

export type Rgb = [number, number, number];

/** The inks of a theme, as fractions of 255, and whether the theme is dark. */
export interface Inks {
  ink: Rgb;
  paper: Rgb;
  history: Rgb;
  event: Rgb;
  handoff: Rgb;
  external: Rgb;
  dark: boolean;
}

let probe2d: CanvasRenderingContext2D | null | undefined;

/** A CSS colour as fractions of 255 (`fallback` where the browser cannot read it). */
function rgbOf(value: string, fallback: Rgb = [0, 0, 0]): Rgb {
  probe2d ??= document.createElement("canvas").getContext("2d");
  if (!probe2d) return fallback;
  probe2d.fillStyle = "#000";
  probe2d.fillStyle = value.trim() || "#000";
  const hex = probe2d.fillStyle;
  if (hex.startsWith("#") && hex.length === 7)
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
  const parts = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(hex);
  return parts ? [Number(parts[1]) / 255, Number(parts[2]) / 255, Number(parts[3]) / 255] : fallback;
}

/** Whether the theme in force is dark (the theme chosen, or the system's where "system" is chosen). */
function isDark(): boolean {
  const theme = document.documentElement.getAttribute("data-theme");
  return (
    theme === "dark" ||
    (theme === "system" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

/** The theme's inks, read from `element`'s computed style (the site's tokens). */
export function readInks(element: Element): Inks {
  const style = getComputedStyle(element);
  const token = (name: string) => rgbOf(style.getPropertyValue(name));
  return {
    ink: token("--ink-1"),
    paper: rgbOf(style.getPropertyValue("--paper"), [1, 1, 1]),
    history: token("--hue-history"),
    event: token("--hue-event"),
    handoff: token("--hue-handoff"),
    external: token("--hue-external"),
    dark: isDark(),
  };
}

/** Whether the visitor asks for reduced motion. */
export function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Call `change` at each change of the theme (the attribute, the system's scheme, or a redraw asked for). */
export function watchTheme(change: () => void): () => void {
  const themes = new MutationObserver(change);
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const scheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  scheme?.addEventListener("change", change);
  window.addEventListener("idtrack:recolour", change);
  return () => {
    themes.disconnect();
    scheme?.removeEventListener("change", change);
    window.removeEventListener("idtrack:recolour", change);
  };
}

/** Run a renderer only while `element` is on screen and the page is shown. */
export function watchVisible(element: Element, run: (on: boolean) => void): () => void {
  let onScreen = true;
  const apply = () => {
    run(onScreen && document.visibilityState === "visible");
  };
  const seen =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          apply();
        });
  seen?.observe(element);
  document.addEventListener("visibilitychange", apply);
  apply();
  return () => {
    seen?.disconnect();
    document.removeEventListener("visibilitychange", apply);
  };
}

/** How WebGL draws on this page: whether WebGL2 is there at all, and whether it draws in software (no GPU:
 *  SwiftShader, llvmpipe, Microsoft's basic renderer), where a frame of a picture costs a CPU hundreds of milliseconds
 *  and the browser's own copy of a WebGL canvas to the screen waits for it: there every picture is a still on a 2D
 *  canvas and no WebGL pass is drawn. */
export interface Graphics {
  webgl2: boolean;
  software: boolean;
}

let graphics: Graphics | null = null;
/** The small canvas the decision was read on, kept for the page's life: no context is ever given up on purpose. */
let probeCanvas: HTMLCanvasElement | null = null;

/** The renderer's name a WebGL2 context reports (unmasked where the browser gives it). */
function rendererOf(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
}

/** Whether a renderer's name is one of software (no GPU). */
export function softwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

/** The page's one decision on WebGL, read once on a canvas of one pixel that is never drawn on screen. */
export function pageGraphics(): Graphics {
  if (graphics) return graphics;
  probeCanvas = document.createElement("canvas");
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = probeCanvas.getContext("webgl2", { powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  graphics = { webgl2: gl !== null, software: gl !== null && softwareRenderer(rendererOf(gl)) };
  return graphics;
}

/** A new canvas in the place of `canvas` (a canvas keeps the one kind of context it first gave): the old one is let go,
 *  its context with it. */
function freshCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const other = document.createElement("canvas");
  other.className = canvas.className;
  for (const name of canvas.getAttributeNames())
    if (name !== "width" && name !== "height") other.setAttribute(name, canvas.getAttribute(name) ?? "");
  canvas.replaceWith(other);
  return other;
}

/** The 2D context a still is drawn on, rasterized on the CPU: the still is drawn once, and where the browser would
 *  rasterize a 2D canvas with the same software GL the page avoids (no GPU), each of its strokes would queue work
 *  that holds the page's frames for seconds. (`willReadFrequently` is the browser's switch to a CPU canvas.) */
export function stillContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d", { willReadFrequently: true });
}

/** How long a picture waits for its lost context to come back before it draws its still instead. */
export const RESTORE_WAIT_MS = 2000;

/** The care of a WebGL context the browser takes away (a GPU reset, a driver update, too many contexts): the loss is
 *  accepted so that the context may come back (`lost` stops drawing); when it comes back, `restored` builds the
 *  programs and buffers again from the model the renderer holds and draws; when it does not come back within
 *  `RESTORE_WAIT_MS`, `giveUp` draws the still instead. */
function watchContext(
  canvas: HTMLCanvasElement,
  on: { lost: () => void; restored: () => void; giveUp: () => void },
): () => void {
  let timer = 0;
  const lost = (event: Event) => {
    event.preventDefault();
    on.lost();
    window.clearTimeout(timer);
    timer = window.setTimeout(on.giveUp, RESTORE_WAIT_MS);
  };
  const restored = () => {
    window.clearTimeout(timer);
    timer = 0;
    on.restored();
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  return () => {
    window.clearTimeout(timer);
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restored);
  };
}

/** The development switch (`?hero-frames` on the development server, never in a production build): every picture
 *  takes the moving path even where WebGL draws in software and draws only the moments asked for, by
 *  `window.__heroTime(seconds)`; `window.__heroWork()` reads the last frame's GPU work. */
export const STEPPED =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("hero-frames");

/** Hand the development clock to a picture (only under `STEPPED`); the returned function takes it back. */
export function exposeClock(draw: (seconds: number) => void, work: () => unknown): () => void {
  if (!STEPPED) return () => undefined;
  window.__heroTime = draw;
  window.__heroWork = work;
  return () => {
    if (window.__heroTime === draw) delete window.__heroTime;
    if (window.__heroWork === work) delete window.__heroWork;
  };
}

/** The room of the hero a picture is composed in (CSS px of the field): its size, the box of the words (their text
 *  and the actions, the actions with a margin of their own), the caption's top and the content column's edges. */
export interface HeroRoom {
  width: number;
  height: number;
  words: { left: number; top: number; right: number; bottom: number } | null;
  captionTop: number;
  left: number;
  right: number;
}

/** A point in CSS pixels of a picture's canvas. */
export interface Point {
  x: number;
  y: number;
}

/** What a picture's renderer measures of its own frames. */
export interface FrameStats {
  frames: number;
  meanFrameMs: number;
  meanDrawMs: number;
}

/** A picture's renderer, the same for the three pictures and the History tab's field: placed by `resize` (the size of
 *  its canvas in CSS px and where in it the picture stands, `P`), inked by `setColours`, lit by the pointer
 *  (`setPointer` takes what the page found under it, `lift`, and returns what the renderer found there, or -1), run
 *  only while seen. */
export interface Picture<P> {
  readonly mode: "webgl2" | "canvas2d";
  /** The canvas drawn on (another than the one given where WebGL was given up). */
  readonly element: HTMLCanvasElement;
  /** True where the picture moves; false where it is drawn once and holds still. */
  readonly moving: boolean;
  resize(width: number, height: number, place: P): void;
  setColours(inks: Inks): void;
  setPointer(point: Point | null, lift: number): number;
  setRunning(running: boolean): void;
  stats(): FrameStats;
  /** The GPU work of the last frame (WebGL2 only), for the development switch. */
  work(): unknown;
  /** Draw the moment `seconds` after the start (the development switch). */
  drawAt(seconds: number): void;
  destroy(): void;
}

/** How a picture is drawn by WebGL2: the context's attributes; `start` compiles its programs on a context and returns
 *  whether they are done (asked without waiting where the browser can, KHR_parallel_shader_compile) and how to build
 *  the picture once they are (it throws where they failed). */
export interface WebglPart<P> {
  attributes: WebGLContextAttributes;
  start(gl: WebGL2RenderingContext): { done(): boolean; build(): Picture<P> };
}

/** A picture that draws by WebGL2 where the page's decision allows it, else its still on a 2D canvas (`still`); that
 *  waits a frame at a time for its programs, so that the page's thread never waits on the driver; that builds itself
 *  again on its context when the browser gives a lost context back, and draws its still when it does not within
 *  `RESTORE_WAIT_MS`. Everything it is told meanwhile is kept and given to the picture it ends up with. `changed` is
 *  called when its mode or canvas changes. `stepped`: the development switch (the moving path in software too). */
export function hostPicture<P>(
  canvas: HTMLCanvasElement,
  webgl: WebglPart<P>,
  still: (canvas: HTMLCanvasElement) => Picture<P>,
  stepped: boolean,
  changed: () => void = () => undefined,
): Picture<P> {
  let element = canvas;
  let inner: Picture<P> | null = null;
  let size: [number, number, P] | null = null;
  let inks: Inks | null = null;
  let pointer: [Point | null, number] | null = null;
  let running: boolean | null = null;
  let raf = 0;
  let stopWatch: () => void = () => undefined;
  let ended = false;
  const replay = (picture: Picture<P>) => {
    if (inks) picture.setColours(inks);
    if (size) picture.resize(...size);
    if (pointer) picture.setPointer(...pointer);
    if (running !== null) picture.setRunning(running);
  };
  // `changed` is said of changes after the host is made, never while it is being made (its maker holds no host yet).
  let made = false;
  const become = (picture: Picture<P>) => {
    inner = picture;
    replay(picture);
    if (made) changed();
  };
  const toStill = () => {
    if (ended) return;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    stopWatch();
    inner?.destroy();
    element = freshCanvas(element);
    become(still(element));
  };
  const graphics = pageGraphics();
  if (!graphics.webgl2 || (graphics.software && !stepped)) {
    become(still(element));
  } else {
    const gl = element.getContext("webgl2", webgl.attributes);
    if (!gl) become(still(freshCanvas(element)));
    else {
      const begin = () => {
        let pending: ReturnType<WebglPart<P>["start"]>;
        try {
          pending = webgl.start(gl);
        } catch {
          toStill();
          return;
        }
        const poll = () => {
          raf = 0;
          let picture: Picture<P>;
          try {
            if (!pending.done()) {
              raf = requestAnimationFrame(poll);
              return;
            }
            picture = pending.build();
          } catch {
            toStill();
            return;
          }
          become(picture);
        };
        raf = requestAnimationFrame(poll);
      };
      stopWatch = watchContext(element, {
        lost: () => {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          inner?.destroy();
          inner = null;
        },
        restored: begin,
        giveUp: toStill,
      });
      begin();
    }
  }
  made = true;
  return {
    get mode() {
      return inner?.mode ?? "webgl2";
    },
    get element() {
      return element;
    },
    get moving() {
      return inner?.moving ?? false;
    },
    resize(...args) {
      size = args;
      inner?.resize(...args);
    },
    setColours(value) {
      inks = value;
      inner?.setColours(value);
    },
    setPointer(...args) {
      pointer = args;
      return inner?.setPointer(...args) ?? -1;
    },
    setRunning(on) {
      running = on;
      inner?.setRunning(on);
    },
    stats: () => inner?.stats() ?? { frames: 0, meanFrameMs: 0, meanDrawMs: 0 },
    work: () => inner?.work() ?? null,
    drawAt(seconds) {
      inner?.drawAt(seconds);
    },
    destroy() {
      ended = true;
      if (raf) cancelAnimationFrame(raf);
      stopWatch();
      inner?.destroy();
    },
  };
}

/** A program of two shaders, compiled and linked without waiting (`programsDone` asks whether they are). */
export function startProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("A shader could not be made.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return program;
}

/** Whether programs are compiled and linked, asked without waiting where the browser can (its
 *  KHR_parallel_shader_compile); then whether they linked (it throws where one did not). */
export function programsDone(gl: WebGL2RenderingContext, programs: readonly WebGLProgram[]): boolean {
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  if (parallel && !programs.every((p) => gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR) === true))
    return false;
  for (const p of programs)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "A program failed.");
  return true;
}

/** A program's uniforms by name, looked up once. */
export function uniformsOf(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): (name: string) => WebGLUniformLocation | null {
  const cache = new Map<string, WebGLUniformLocation | null>();
  return (name) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name) ?? null;
  };
}

/** A canvas's size in device pixels for `width` × `height` CSS px (the device's ratio, at most 2). */
export function devicePixels(width: number, height: number): { dpr: number; width: number; height: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return { dpr, width: Math.max(1, Math.round(width * dpr)), height: Math.max(1, Math.round(height * dpr)) };
}
