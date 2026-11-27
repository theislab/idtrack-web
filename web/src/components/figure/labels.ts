// The one label placer of the figures (DESIGN.md, "The figure grammar"). Every label is measured, placed by one
// deterministic rule and never overlaps another label or leaves its figure; a label with no room in any of its forms
// and rows is left out (its full text is on focus, in the figure's note and in its text alternative). Labels are drawn
// over the marks with a halo of the figure's ground (`.fig-text`), so a line that must pass behind a label is cut by
// it rather than crossing it.

/** The faces of the figures' text. */
export type Face = "mono" | "sans";

/** The figures' text size in pixels (`--text-2xs`, the floor) and the larger one for titles in a figure. */
export const FIG_TEXT = 11;
const FIG_TEXT_LARGE = 12;

/** JetBrains Mono's advance is 600 units of 1000 for every character; at the figures' sizes the browser rounds it
 *  to whole pixels (7 px at 11 px, measured in Chromium), so the placer reckons with 0.64 of the size. */
const MONO_ADVANCE = 0.64;

let context: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

/** The width of a text in pixels: for the monospaced face one rounded advance a character, measured for the sans
 *  where a canvas is at hand (a browser), estimated where it is not (a test's DOM). */
export function textWidth(text: string, size = FIG_TEXT, face: Face = "mono", weight = 400): number {
  if (face === "mono") return text.length * MONO_ADVANCE * size;
  const key = `${weight} ${size} ${text}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  if (context === undefined) {
    // A DOM without a canvas of its own (jsdom, in the unit tests) is given the estimate.
    const canvas = typeof navigator !== "undefined" && !navigator.userAgent.includes("jsdom");
    try {
      context = canvas && typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    } catch {
      context = null;
    }
  }
  let width = text.length * 0.56 * size;
  if (context) {
    const font = `${weight} ${size}px "Inter Variable", Inter, system-ui, sans-serif`;
    context.font = font;
    width = context.measureText(text).width;
    // A width measured before the face has loaded is the fallback's: it is used, not kept, so the next layout (after
    // the face arrives) measures the face itself.
    const fonts = typeof document === "undefined" ? undefined : (document as { fonts?: FontFaceSet }).fonts;
    if (fonts && !fonts.check(font)) return width;
  }
  cache.set(key, width);
  return width;
}

/** Words set on as many lines of at most `width` pixels as they need (a word is never cut). */
export function wrapWords(text: string, width: number, size = FIG_TEXT_LARGE, face: Face = "sans"): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, face) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** An identifier shortened to `room` characters, cut in its middle so that its start and its end (the version) stay
 *  readable ("ENSSSCG…08047.2"); `null` when not even six characters fit. Only identifiers are cut, never words. */
export function middleCut(text: string, room: number): string | null {
  if (text.length <= room) return text;
  if (room < 6) return null;
  const tail = Math.min(text.length - 1, Math.max(3, Math.ceil((room - 1) / 2)));
  const head = room - 1 - tail;
  if (head < 2) return `…${text.slice(text.length - (room - 1))}`;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export interface LabelRequest {
  key: string;
  /** Where the label belongs, along the figure's axis of placement (x on a wide drawing). */
  anchor: number;
  /** Its forms in the order tried (the full text first). */
  forms: string[];
  /** `start`: the text begins at the anchor (or, with `flip`, ends there when it has no room after it); `center`:
   *  centred on it, shifted inside the bounds near an end; `end`: the text ends at the anchor. */
  align: "start" | "center" | "end";
  /** The rows it may take, in the order tried (rows are shared by every label of one placement). */
  rows: string[];
  /** Allow a `start` label to end at the anchor instead. */
  flip?: boolean;
  /** Bounds of its own (a band's extent), inside the placement's bounds. */
  bounds?: [number, number];
  size?: number;
  face?: Face;
  weight?: number;
}

export interface PlacedLabel {
  key: string;
  row: string;
  text: string;
  /** The extent of the text along the axis of placement. */
  t0: number;
  t1: number;
  /** Where to draw it and how: the SVG text's x and text-anchor. */
  x: number;
  anchor: "start" | "middle" | "end";
}

export interface Placement {
  /** The extent every label stays within. */
  bounds: [number, number];
  /** The least distance between two labels of a row. */
  gap?: number;
  /** Extents already taken in a row (marks a label must not cover), by row. */
  taken?: Map<string, [number, number][]>;
}

/** Place labels in the order given (the first has the highest priority): each takes the first of its forms and rows
 *  (and, for `start` with `flip`, the side after the anchor before the side before it) where it overlaps nothing
 *  already placed in the row and stays within its bounds. The same requests always give the same labels. */
export function placeLabels(requests: readonly LabelRequest[], placement: Placement): Map<string, PlacedLabel> {
  const gap = placement.gap ?? 6;
  const taken = new Map<string, [number, number][]>();
  for (const [row, spans] of placement.taken ?? []) taken.set(row, [...spans]);
  const placed = new Map<string, PlacedLabel>();
  for (const request of requests) {
    const lo = Math.max(placement.bounds[0], request.bounds?.[0] ?? -Infinity);
    const hi = Math.min(placement.bounds[1], request.bounds?.[1] ?? Infinity);
    let done = false;
    for (const text of request.forms) {
      if (done) break;
      const w = textWidth(text, request.size, request.face, request.weight);
      const spans: [number, number, PlacedLabel["anchor"]][] = [];
      if (request.align === "center") {
        const left = Math.min(Math.max(request.anchor - w / 2, lo), hi - w);
        spans.push([left, left + w, "middle"]);
      } else if (request.align === "end") {
        spans.push([request.anchor - w, request.anchor, "end"]);
      } else {
        spans.push([request.anchor, request.anchor + w, "start"]);
        if (request.flip) spans.push([request.anchor - w, request.anchor, "end"]);
      }
      for (const row of request.rows) {
        if (done) break;
        for (const [t0, t1, anchor] of spans) {
          if (t0 < lo - 0.5 || t1 > hi + 0.5) continue;
          const spansOfRow = taken.get(row) ?? [];
          if (spansOfRow.some(([a, b]) => t0 < b + gap && a < t1 + gap)) continue;
          spansOfRow.push([t0, t1]);
          taken.set(row, spansOfRow);
          const x = anchor === "middle" ? (t0 + t1) / 2 : anchor === "end" ? t1 : t0;
          placed.set(request.key, { key: request.key, row, text, t0, t1, x, anchor });
          done = true;
          break;
        }
      }
    }
  }
  return placed;
}

/** Labels stacked along one line (a phone's timeline): each at its wanted place or pushed down below the one before,
 *  never closer than `pitch`; the caller joins a pushed label to its place with a leader. */
export function stackLabels<T extends { at: number }>(wanted: readonly T[], pitch: number): (T & { placed: number })[] {
  let floor = -Infinity;
  return [...wanted]
    .sort((a, b) => a.at - b.at)
    .map((w) => {
      const placed = Math.max(w.at, floor + pitch);
      floor = placed;
      return { ...w, placed };
    });
}
