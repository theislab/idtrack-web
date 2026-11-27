// The page's width is a phone's (below 641 px): the tables of the answer turn into cards, its actions follow it, and
// its lists show fewer rows at first.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 640px)";

export function usePhone(): boolean {
  // A browser has matchMedia; a test's DOM may not.
  const matchMedia = (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
  const media = typeof matchMedia === "function" ? matchMedia.call(window, QUERY) : null;
  return useSyncExternalStore(
    (listener) => {
      media?.addEventListener("change", listener);
      return () => media?.removeEventListener("change", listener);
    },
    () => media?.matches ?? false,
  );
}
