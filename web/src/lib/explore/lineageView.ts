// The view of an organism's lineage field (components/explore/LineageField.tsx): where the field stands in its box for
// a view of the release axis, how a view moves and zooms, and an id's words and the release it is opened at. Pure
// functions of the layout (lib/hero/lineageLayout.ts) and the renderer's frame (components/hero/field.ts).
import type { FieldFrame } from "../../components/hero/field";
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
