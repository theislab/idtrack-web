// Counting visits (the server's `IDTRACK_WEB_ANALYTICS_ID`, reported by `/version` as `analytics_id`): Google
// Analytics, loaded only after the visitor accepts, with Google signals and ad personalisation off.
//
// One rule decides what Google may learn of a page: its address on this site without the query or the fragment (which
// hold what is converted), its name ("Convert · IDTrack", never the tab's title, which on an answer holds the answer),
// and as the page that led there only another site's origin (an address of this site carries a query). The fields are
// given to the tag before it is loaded and again at every change of page, before anything is counted, so that every
// hit the tag sends, its own automatic ones (engagement, scrolling, a change of the browser's history) included,
// carries them rather than the browser's address, title and referrer. The tag's cookies are kept on this host alone
// (`cookie_domain: "none"`), never on a domain above it that other sites share.
//
// A consent withdrawn, in this tab or in another one of the site (the browser's `storage` event), stops the tag
// (Google's `ga-disable-<id>`) and deletes its cookies on this host. Nothing is deleted where nothing was counted: a
// page whose tag never started and whose consent was never granted touches no cookie. The choice is kept in the
// browser.
import { useSyncExternalStore } from "react";
import { routeOf } from "./routes";
import { documentTitle, organismLike, pageNameOf } from "./title";

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

let current: Consent | undefined;

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

function subscribe(callback: () => void): () => void {
  // Another tab of the site changed the choice: this tab reads it again (the event never fires in the tab that wrote).
  const stored = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    current = read();
    callback();
  };
  window.addEventListener(CHANGE, callback);
  window.addEventListener("storage", stored);
  return () => {
    window.removeEventListener(CHANGE, callback);
    window.removeEventListener("storage", stored);
  };
}

export function useConsent(): Consent {
  return useSyncExternalStore(
    subscribe,
    () => (current === undefined ? (current = read()) : current),
    () => null,
  );
}

/** The path a page is counted under: the path of a page of the site, a graph's page only where its name reads as an
 *  organism's name (the rule by which the page echoes it, lib/title.ts), and `/404` for every address that is no page
 *  (it holds whatever was typed). */
export function countedPath(path: string): string {
  const route = routeOf(path);
  if (route.page === "none") return "/404";
  if (route.page === "redirect") return route.to;
  if (route.page === "organism" && !organismLike(route.organism)) return "/404";
  return path;
}

/** Everything Google is told of the page at `path` (the rule at the top of this file). */
export function pageFields(path: string): { page_location: string; page_title: string; page_referrer: string } {
  let referrer = "";
  try {
    const from = new URL(document.referrer);
    if (from.origin !== window.location.origin && /^https?:$/.test(from.protocol)) referrer = `${from.origin}/`;
  } catch {
    // No referrer, or none that parses: none is given.
  }
  return {
    page_location: `${window.location.origin}${countedPath(path)}`,
    page_title: documentTitle(pageNameOf(path)),
    page_referrer: referrer,
  };
}

/** The measurement id whose tag this page loaded (null: none yet). */
let started: string | null = null;

/** Google's switch that stops its tag for one measurement id: a property of the window named after the id (so not a
 *  name a type can declare: it is set and read by its name). */
const disabled = (id: string) => `ga-disable-${id}`;
const setDisabled = (id: string, value: boolean) => Reflect.set(window, disabled(id), value);
const isDisabled = (id: string) => Reflect.get(window, disabled(id)) === true;

/** Load Google's tag for `id`, once, with the fields of the page at `path` (and let it count again where a consent was
 *  withdrawn before). */
export function startAnalytics(id: string, path: string): void {
  setDisabled(id, false);
  if (started === id) return;
  started = id;
  const layer = (window.dataLayer ??= []);
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- Google's tag reads only an arguments object from its data layer.
    layer.push(arguments);
  };
  const fields = pageFields(path);
  window.gtag("js", new Date());
  window.gtag("set", fields);
  window.gtag("config", id, {
    ...fields,
    send_page_view: false,
    cookie_domain: "none",
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const url = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  // The page's Trusted Types allow one policy of its own, which passes the tag's address and nothing else.
  const policy = window.trustedTypes?.createPolicy("idtrack-analytics", {
    createScriptURL: (value: string) => {
      if (value !== url) throw new TypeError("Not the address of Google's tag.");
      return value;
    },
  });
  const script = document.createElement("script");
  script.async = true;
  // The policy's trusted address itself is given to the element (its type names a string; the browser takes either).
  Reflect.set(script, "src", policy ? policy.createScriptURL(url) : url);
  document.head.append(script);
}

/** Count the page at `path`: the tag is first given the page's fields (so that its own hits from now on carry them),
 *  then the page is counted with them. */
export function countPage(path: string): void {
  if (started === null || isDisabled(started)) return;
  const fields = pageFields(path);
  window.gtag?.("set", fields);
  window.gtag?.("event", "page_view", fields);
}

/** Stop counting for `id` where this page started its tag (a consent withdrawn here or in another tab): Google's tag is
 *  told to send nothing more, and its cookies (`_ga`, `_ga_<the id without "G-">`) are deleted on this host, where
 *  `cookie_domain: "none"` keeps them. A page that never counted touches nothing. */
export function stopAnalytics(id: string): void {
  if (started !== id) return;
  setDisabled(id, true);
  for (const name of ["_ga", `_ga_${id.replace(/^G-/, "")}`])
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}
