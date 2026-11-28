// What closes leaves with a short fade (DIRECTION.md, "Motion": every change of state moves): a card, a drawer or the
// palette asked to close is kept drawn for `--dur-exit` (160 ms, tokens.css) with its closing class, then goes. Under
// reduced motion, and where the browser cannot say (a test's DOM), it goes at once.
import { useEffect, useState } from "react";

/** The exit's length in milliseconds (tokens.css `--dur-exit`). */
export const EXIT_MS = 160;

/** Whether a closing may move: motion is allowed and the browser can say so. */
export function exitMoves(): boolean {
  const matchMedia = (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
  return typeof matchMedia === "function" && !matchMedia.call(window, "(prefers-reduced-motion: reduce)").matches;
}

/** `shown` while open or leaving; `closing` while leaving (for `EXIT_MS` after `open` turned false). */
export function useExit(open: boolean): { shown: boolean; closing: boolean } {
  const [was, setWas] = useState(open);
  const [closing, setClosing] = useState(false);
  if (was !== open) {
    setWas(open);
    setClosing(!open && exitMoves());
  }
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setClosing(false);
    }, EXIT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [closing]);
  return { shown: open || closing, closing };
}
