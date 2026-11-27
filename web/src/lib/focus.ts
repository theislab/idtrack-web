import { useCallback, useEffect, useRef } from "react";

// Focus moved on purpose: after a route change to the new page's heading, after a request a person made to its
// result's heading (or the statement of its failure), brought into view. An element that is not focusable by itself
// is made focusable by script only (tabindex -1), so it never becomes a stop of the Tab key.

/** Focus `element` and bring it into view (the masthead's height is kept free by `scroll-padding-top`). */
function focusInView(element: HTMLElement): void {
  if (!element.matches("a[href], button, input, select, textarea, [tabindex]")) element.tabIndex = -1;
  element.focus({ preventScroll: true });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const box = element.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) {
    element.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }
}

/** Focus the first element of `root` that matches `selector` as soon as it is there (a part of the page may still
 *  be loading); gives up after `timeout` ms or when cancelled (the returned function). */
export function focusWhenThere(root: () => HTMLElement | null, selector: string, timeout = 10_000): () => void {
  let observer: MutationObserver | null = null;
  let timer = 0;
  const stop = () => {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(timer);
  };
  const tryNow = () => {
    const element = root()?.querySelector<HTMLElement>(selector);
    if (!element) return false;
    stop();
    focusInView(element);
    return true;
  };
  if (!tryNow()) {
    observer = new MutationObserver(() => {
      tryNow();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy"],
    });
    timer = window.setTimeout(stop, timeout);
  }
  return stop;
}

/** The selector of the element the address's fragment names (`#history` -> the element of id `history`), or null. */
export function fragmentTarget(hash = window.location.hash): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  return id ? `#${CSS.escape(id)}` : null;
}

/** Bring a result area into view as soon as a request starts (a person sees that something happens). */
export function revealArea(area: HTMLElement | null): void {
  if (!area) return;
  const box = area.getBoundingClientRect();
  if (box.top > window.innerHeight * 0.75 || box.top < 0) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    area.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }
}

/** One pending move of focus for a view: a new one replaces the one before; the view's going cancels it (a render
 *  in between does not, unlike an effect's cleanup). The function is the same at every render, so that an effect
 *  that lists it runs only when its other dependencies change. */
export function useFocusMove(): (root: () => HTMLElement | null, selector: string) => void {
  const pending = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      pending.current?.();
    },
    [],
  );
  return useCallback((root: () => HTMLElement | null, selector: string) => {
    pending.current?.();
    pending.current = focusWhenThere(root, selector);
  }, []);
}
