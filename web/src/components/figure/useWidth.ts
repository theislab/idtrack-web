// The width of a figure's frame, kept current, so that a figure is laid out for its real width (labels keep their
// size) and its frame never changes height when it is drawn. No layout is read during a commit: one ResizeObserver for
// every figure reports each frame's width after the browser's own layout, before the paint, and the figures take it at
// once (flushSync), so the first frame painted is already drawn at its width.
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";

const setters = new Map<Element, (width: number) => void>();
let observer: ResizeObserver | null = null;

function watch(element: Element, set: (width: number) => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  observer ??= new ResizeObserver((entries) => {
    // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- the first frame painted is drawn at its width (above)
    flushSync(() => {
      for (const entry of entries) setters.get(entry.target)?.(entry.contentRect.width);
    });
  });
  setters.set(element, set);
  observer.observe(element);
  return () => {
    setters.delete(element);
    observer?.unobserve(element);
  };
}

/** The width of the element given `ref`, kept current. `ref` is a callback ref (it also holds the element, as
 *  `ref.current`): whenever the element appears, is replaced or goes (a figure that draws nothing until its data come,
 *  a frame swapped for another), the observer follows it, so a figure always measures the element it draws in. */
export function useWidth<T extends HTMLElement>(fallback = 960) {
  const [width, setWidth] = useState(fallback);
  const ref = useMemo(() => {
    const held: { element: T | null; stop: (() => void) | null } = { element: null, stop: null };
    const attach = (element: T | null) => {
      held.stop?.();
      held.stop = null;
      held.element = element;
      if (!element) return;
      held.stop = watch(element, (value) => {
        const next = Math.round(value);
        if (next > 0) setWidth((w) => (Math.abs(w - next) >= 1 ? next : w));
      });
    };
    return Object.defineProperty(attach, "current", { get: () => held.element }) as typeof attach & {
      readonly current: T | null;
    };
  }, []);
  return { ref, width };
}
