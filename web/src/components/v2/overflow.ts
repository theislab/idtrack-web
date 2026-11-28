// A row of choices wider than its room (a tab list, a segmented control on a phone) scrolls sideways and says so: which
// of its edges have more beyond them (for a fade and a chevron there), and the chosen one brought into its view.
import { useLayoutEffect, useState, type RefObject } from "react";

/** The edges of `row` with more beyond them, measured again when it scrolls or changes size, or `deps` change. */
export function useOverflow(row: RefObject<HTMLElement | null>, deps: unknown[]): { start: boolean; end: boolean } {
  const [edges, setEdges] = useState({ start: false, end: false });
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured again when what the row holds changes
  }, deps);
  return edges;
}

/** Bring `item` into the view of the row that scrolls it, sideways only (the page does not scroll). */
export function revealIn(row: HTMLElement, item: HTMLElement): void {
  const pad = 32;
  const left = item.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
  const right = left + item.offsetWidth;
  if (left < row.scrollLeft + pad) row.scrollLeft = Math.max(0, left - pad);
  else if (right > row.scrollLeft + row.clientWidth - pad) row.scrollLeft = right - row.clientWidth + pad;
}
