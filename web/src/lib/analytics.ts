// Counting visits (the server's `IDTRACK_WEB_ANALYTICS_ID`, reported by `/version` as `analytics_id`): Google
// Analytics, loaded only after the visitor accepts, and asked to count the page's path alone (never its query, which
// holds what is converted), with Google signals and ad personalisation off. The choice is kept in the browser.
import { useSyncExternalStore } from "react";

export type Consent = "granted" | "denied" | null;

const KEY = "idtrack-consent";
const CHANGE = "idtrack:consent";

function read(): Consent {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Keep the visitor's choice (`null`: ask again). */
export function setConsent(consent: Consent): void {
  try {
    if (consent === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, consent);
  } catch {
    // Storage may be off: the choice lasts for this page.
  }
  current = consent;
  window.dispatchEvent(new Event(CHANGE));
}

let current: Consent | undefined;

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener(CHANGE, callback);
  };
}

export function useConsent(): Consent {
  return useSyncExternalStore(
    subscribe,
    () => (current === undefined ? (current = read()) : current),
    () => null,
  );
}

interface Tagged {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  trustedTypes?: { createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => unknown };
}

let started: string | null = null;

/** Load Google's tag for `id`, once. */
export function startAnalytics(id: string): void {
  if (started === id) return;
  started = id;
  const w = window as unknown as Tagged;
  w.dataLayer = w.dataLayer ?? [];
  const layer = w.dataLayer;
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- Google's tag reads only an arguments object from its data layer.
    layer.push(arguments);
  };
  w.gtag("js", new Date());
  w.gtag("config", id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const url = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  // The page's Trusted Types allow one policy of its own, which passes the tag's address and nothing else.
  const policy = w.trustedTypes?.createPolicy("idtrack-analytics", {
    createScriptURL: (value: string) => {
      if (value !== url) throw new TypeError("Not the address of Google's tag.");
      return value;
    },
  }) as { createScriptURL: (value: string) => string } | undefined;
  const script = document.createElement("script");
  script.async = true;
  script.src = policy ? policy.createScriptURL(url) : url;
  document.head.append(script);
}

/** Count one page: its path only. */
export function countPage(path: string): void {
  const w = window as unknown as Tagged;
  w.gtag?.("event", "page_view", {
    page_location: `${window.location.origin}${path}`,
    page_path: path,
    page_title: document.title,
  });
}
