// The view of an organism's lineage field (components/explore/LineageField.tsx): where the field stands in its box for
// a view of the release axis, how a view moves and zooms, and an id's words and the release it is opened at. Pure
// functions of the layout (lib/hero/lineageLayout.ts) and the renderer's frame (components/hero/field.ts).
import { placeOf, type FieldFrame } from "../../components/hero/field";
import { runsOf, type LineageLayout } from "../hero/lineageLayout";

/** The room under the field for its release axis (px). */
const AXIS_ROOM = 40;
/** The narrowest view: this share of the axis (about seven releases of a graph of sixty-eight). */
export const LEAST_SPAN = 0.1;

/** The field's frame for a box and a view of the axis (`[from, to]`, fractions): the view fills the box's width. */
export function viewFrame(width: number, height: number, view: readonly [number, number]): FieldFrame {
  const pad = width < 720 ? 8 : 16;
  const inner = Math.max(1, width - 2 * pad);
  const span = Math.max(1e-6, view[1] - view[0]);
  const left = pad - (view[0] / span) * inner;
  const usable = Math.max(1, height - AXIS_ROOM);
  return { left, right: left + inner / span, centre: usable / 2, half: usable * 0.47 };
}

/** A view moved by `delta` (fractions of the axis) and scaled by `factor` about `at`, kept within the axis. */
export function moveView(
  view: readonly [number, number],
  { delta = 0, factor = 1, at = (view[0] + view[1]) / 2 }: { delta?: number; factor?: number; at?: number | undefined },
): [number, number] {
  const span = Math.min(1, Math.max(LEAST_SPAN, (view[1] - view[0]) * factor));
  let from = at - (at - view[0]) * (span / (view[1] - view[0])) + delta;
  from = Math.min(1 - span, Math.max(0, from));
  return [from, from + span];
}

/** An id's words: its runs of active releases, its new versions, its family. */
export function lineWords(layout: LineageLayout, id: number): string {
  const runs = runsOf(layout, id);
  const family = (layout.familyOf[2 * id + 1] ?? 0) - (layout.familyOf[2 * id] ?? 0) + 1;
  const versions = layout.versionCounts[id] ?? 0;
  const releases = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
  return `active at ${releases}${versions ? ` · ${versions} new version${versions === 1 ? "" : "s"}` : ""}${
    family > 1 ? ` · a family of ${family} ids` : ""
  }${id < layout.focusIds ? " · on a journey of the showcase" : ""}`;
}

/** The release an id is opened at: the release `k` points at where the id is active there, else its last. */
export function releaseFor(layout: LineageLayout, id: number, k: number): number {
  const n = layout.releases.length;
  if (!Number.isNaN(layout.y[id * n + k] ?? NaN)) return layout.releases[k] ?? 0;
  const runs = runsOf(layout, id);
  return runs[runs.length - 1]?.[1] ?? layout.releases[n - 1] ?? 0;
}

/** An id picked in the field and the release index it is picked at. */
export interface Picked {
  id: number;
  k: number;
}

/** Where a key moves the pick: ← → along the id's releases (to the next release it is active at), ↑ ↓ to the line
 *  beside it at that release, Home and End to its first and last release; null where it cannot move, undefined for
 *  a key that does not move it. */
export function keyMove(layout: LineageLayout, current: Picked, key: string): Picked | null | undefined {
  const n = layout.releases.length;
  const active = (k: number) => !Number.isNaN(layout.y[current.id * n + k] ?? Number.NaN);
  if (key === "ArrowRight" || key === "ArrowLeft") {
    const step = key === "ArrowRight" ? 1 : -1;
    for (let k = current.k + step; k >= 0 && k < n; k += step) if (active(k)) return { id: current.id, k };
    return null;
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const column = layout.columns[current.k] ?? new Int32Array();
    const at = column.indexOf(current.id);
    const j = at < 0 ? Math.floor(column.length / 2) : at + (key === "ArrowDown" ? 1 : -1);
    const other = column[Math.max(0, Math.min(column.length - 1, j))];
    return other === undefined ? null : { id: other, k: current.k };
  }
  if (key === "Home" || key === "End") {
    const runs = runsOf(layout, current.id);
    const release = key === "Home" ? runs[0]?.[0] : runs[runs.length - 1]?.[1];
    const k = release === undefined ? -1 : layout.releases.indexOf(release);
    return k >= 0 ? { id: current.id, k } : null;
  }
  return undefined;
}

/** The path of a picked id over the releases it is active at (broken where it is not), and the point picked, in the
 *  frame's pixels. */
export function linePath(
  layout: LineageLayout,
  picked: Picked,
  frame: FieldFrame,
): { d: string; at: { x: number; y: number } } {
  const n = layout.releases.length;
  const xAt = (k: number) => (n > 1 ? k / (n - 1) : 0.5);
  const parts: string[] = [];
  let drawing = false;
  for (let k = 0; k < n; k++) {
    const y = layout.y[picked.id * n + k];
    if (y === undefined || Number.isNaN(y)) {
      drawing = false;
      continue;
    }
    const p = placeOf(frame, xAt(k), y);
    parts.push(`${drawing ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    drawing = true;
  }
  const y = layout.y[picked.id * n + picked.k] ?? 0;
  return { d: parts.join(""), at: placeOf(frame, xAt(picked.k), Number.isNaN(y) ? 0 : y) };
}
