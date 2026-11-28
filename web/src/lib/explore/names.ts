// Where a name stands beside a mark of a release axis: never dropped, never shortened.

/** Where a name `w` px wide stands at a bar from `x0` to `x1` in a drawing `width` px wide: from the bar's start, or
 *  ending at its end where it would pass the drawing's right edge, or from the drawing's left edge where neither fits. */
export function namePlace(w: number, x0: number, x1: number, width: number): { x: number; anchor: "start" | "end" } {
  if (x0 + w <= width - 2) return { x: Math.max(2, x0), anchor: "start" };
  if (x1 - w >= 2) return { x: Math.min(width - 2, x1), anchor: "end" };
  return { x: 2, anchor: "start" };
}
