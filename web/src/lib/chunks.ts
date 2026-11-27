// The page's code arrives in parts (a part per page, the answer's view, the load panel, the figures), fetched when
// first needed. A part can fail to arrive: the browser is offline, the connection broke, or the site was updated
// since the page was opened (its parts then have new names, and the old ones are gone). This module tells such a
// failure from a fault of the page, fetches a failed stylesheet again, and reloads the page once when the site was
// updated, saying so after the reload. What a person typed survives a reload (lib/drafts.ts).

const FAILED_LINKS = new WeakSet<Element>();
const CHUNK_ERRORS = new WeakSet<object>();
const RELOAD_KEY = "idtrack:reloaded-for-code";
/** A second reload for missing code within this time is not made: the part is missing on the server, not renamed. */
const RELOAD_GUARD_MS = 5 * 60 * 1000;

const MESSAGES = [
  "Failed to fetch dynamically imported module", // Chromium
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // Safari
  "Unable to preload CSS", // Vite, a stylesheet of a part
  "Outdated Optimize Dep", // Vite's development server
];

/** The failure is code that did not arrive, not a fault of the page. */
export function isChunkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (CHUNK_ERRORS.has(error)) return true;
  const message = error instanceof Error ? error.message : "";
  return MESSAGES.some((m) => message.includes(m));
}

/** Watch for parts that fail to arrive (once, at start): Vite reports them as `vite:preloadError`, and a stylesheet
 *  that fails is remembered so that it can be fetched again. */
export function installChunkWatch(): void {
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (typeof payload === "object" && payload !== null) CHUNK_ERRORS.add(payload);
  });
  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLLinkElement && target.rel === "stylesheet") FAILED_LINKS.add(target);
    },
    true,
  );
}

/** Fetch every stylesheet that failed to arrive once more (a fresh element; the browser does not retry a failed one). */
export async function refetchStylesheets(): Promise<void> {
  const failed = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((link) =>
    FAILED_LINKS.has(link),
  );
  await Promise.all(
    failed.map(
      (link) =>
        new Promise<void>((resolve) => {
          const fresh = document.createElement("link");
          fresh.rel = "stylesheet";
          fresh.href = link.href;
          if (link.crossOrigin !== null) fresh.crossOrigin = link.crossOrigin;
          fresh.addEventListener("load", () => {
            link.remove();
            resolve();
          });
          fresh.addEventListener("error", () => {
            FAILED_LINKS.add(fresh);
            fresh.remove();
            resolve();
          });
          link.after(fresh);
        }),
    ),
  );
}

function readFlag(): { at: number; path: string } | null {
  try {
    const text = window.sessionStorage.getItem(RELOAD_KEY);
    if (!text) return null;
    const value = JSON.parse(text) as { at?: unknown; path?: unknown };
    return typeof value.at === "number" && typeof value.path === "string" ? { at: value.at, path: value.path } : null;
  } catch {
    return null;
  }
}

/** Reload the page once to fetch the site's current code (the browser online, no such reload in the last minutes).
 *  Returns whether the page is being reloaded. */
export function reloadForCode(): boolean {
  if (!navigator.onLine) return false;
  const flag = readFlag();
  if (flag && Date.now() - flag.at < RELOAD_GUARD_MS) return false;
  try {
    window.sessionStorage.setItem(
      RELOAD_KEY,
      JSON.stringify({ at: Date.now(), path: window.location.pathname + window.location.search, said: false }),
    );
  } catch {
    // Without the browser's storage the guard cannot hold: do not risk reloading again and again.
    return false;
  }
  window.location.reload();
  return true;
}

/** After a reload for code, once: the notice to show (the guard itself stays, so that no second reload follows). */
export function takeReloadNotice(): boolean {
  try {
    const text = window.sessionStorage.getItem(RELOAD_KEY);
    if (!text) return false;
    const value = JSON.parse(text) as { at?: number; said?: boolean };
    if (value.said || typeof value.at !== "number" || Date.now() - value.at > RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ ...value, said: true }));
    return true;
  } catch {
    return false;
  }
}
