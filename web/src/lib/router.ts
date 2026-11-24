// A small router over the History api: the page's state lives in its address, so every view can be linked to,
// bookmarked and reloaded.
import { useSyncExternalStore } from "react";

const CHANGE = "idtrack:navigate";

function subscribe(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(CHANGE, callback);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export interface Location {
  path: string;
  search: URLSearchParams;
}

export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, snapshot, snapshot);
  const url = new URL(href, "http://local");
  return { path: url.pathname, search: url.searchParams };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(CHANGE));
}

/** An address from a path and parameters; empty values are left out. */
export function href(path: string, parameters: Record<string, string | number | boolean | null | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}
