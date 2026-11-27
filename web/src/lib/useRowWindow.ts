// Draw only the rows of a long table that can be seen: the rows inside the window and inside the table's own scrolling
// frame, with some rows more on each side, and a spacer above and below as tall as the rows left out (each row's
// height measured once it has been drawn, estimated before). A table of fewer rows than `from` is drawn whole.
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

export interface RowWindow {
  /** The first row drawn and the one after the last (indices into the rows given). */
  start: number;
  end: number;
  /** The heights of the spacers above and below the rows drawn, in pixels. */
  above: number;
  below: number;
  windowed: boolean;
  /** Tell the height of a row once drawn. */
  measured: (key: number, height: number) => void;
  /** Where a row stands, in pixels from the top of the rows (measured, or estimated before it was drawn); null for a
   *  row not shown. */
  offsetOf: (key: number) => number | null;
}

const OVERSCAN = 12;

export function useRowWindow(
  table: RefObject<HTMLTableElement | null>,
  /** A key per row, in the order drawn (rows keep their measured height across sorts and filters). */
  keys: readonly number[],
  estimate: () => number,
  from = 150,
): RowWindow {
  const windowed = keys.length > from;
  const [heights, setHeights] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [view, setView] = useState<{ top: number; bottom: number } | null>(null);

  const offsets = useMemo(() => {
    const out = new Float64Array(keys.length + 1);
    const guess = estimate();
    for (let i = 0; i < keys.length; i++) out[i + 1] = (out[i] ?? 0) + (heights.get(keys[i] ?? -1) ?? guess);
    return out;
  }, [keys, heights, estimate]);

  useEffect(() => {
    if (!windowed) return;
    const element = table.current;
    const wrap = element?.closest(".table-wrap") ?? null;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!element) return;
      // The top of the first body (a spacer or a row): it moves with the rows, where a sticky head does not.
      const first = element.tBodies[0];
      const rowsTop = (first ?? element).getBoundingClientRect().top;
      const box = wrap?.getBoundingClientRect();
      const headHeight = element.tHead?.getBoundingClientRect().height ?? 0;
      const top = Math.max(0, box ? box.top + headHeight : 0) - rowsTop;
      const bottom = Math.min(window.innerHeight, box ? box.bottom : window.innerHeight) - rowsTop;
      setView((v) => (v && Math.abs(v.top - top) < 8 && Math.abs(v.bottom - bottom) < 8 ? v : { top, bottom }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    wrap?.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      wrap?.removeEventListener("scroll", schedule);
    };
  }, [windowed, table]);

  const measured = useCallback((key: number, height: number) => {
    setHeights((known) => {
      const before = known.get(key);
      if (before !== undefined && Math.abs(before - height) < 0.5) return known;
      return new Map(known).set(key, height);
    });
  }, []);

  const offsetOf = (key: number) => {
    const i = keys.indexOf(key);
    return i < 0 ? null : (offsets[i] ?? 0);
  };
  if (!windowed) return { start: 0, end: keys.length, above: 0, below: 0, windowed, measured, offsetOf };
  return { ...windowOf(offsets, view?.top ?? 0, view?.bottom ?? 1200), windowed, measured, offsetOf };
}

/** The rows to draw of a table whose row `i` spans `offsets[i]` to `offsets[i + 1]` (pixels from the top of its
 *  rows), for a view from `top` to `bottom`: the rows it touches and `overscan` more on each side (at least one row),
 *  and the heights of the spacers above and below them. */
export function windowOf(
  offsets: ArrayLike<number>,
  top: number,
  bottom: number,
  overscan = OVERSCAN,
): { start: number; end: number; above: number; below: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0, above: 0, below: 0 };
  const total = offsets[count] ?? 0;
  const find = (y: number) => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((offsets[mid + 1] ?? 0) <= y) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(lo, count - 1);
  };
  const start = Math.max(0, find(top) - overscan);
  const end = Math.min(count, Math.max(start + 1, find(bottom) + 1 + overscan));
  return { start, end, above: offsets[start] ?? 0, below: total - (offsets[end] ?? total) };
}
