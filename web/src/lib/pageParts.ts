// The pages loaded when first visited (all but Convert, so that the first page loads small), and the code of the page
// of the address the app starts at, asked for at once.
import { lazyPart } from "./lazyPart";
import { routeOf } from "./routes";

export const BatchPage = lazyPart(() => import("../pages/BatchPage").then((m) => ({ default: m.BatchPage })));
export const NamesPage = lazyPart(() => import("../pages/NamesPage").then((m) => ({ default: m.NamesPage })));
export const MethodPage = lazyPart(() => import("../pages/MethodPage").then((m) => ({ default: m.MethodPage })));
export const OrganismsIndex = lazyPart(() =>
  import("../pages/OrganismPage").then((m) => ({ default: m.OrganismsIndex })),
);
export const OrganismPage = lazyPart(() => import("../pages/OrganismPage").then((m) => ({ default: m.OrganismPage })));

// The api page is loaded on its first visit (its reference and console are not needed for a conversion).
export const ApiPage = lazyPart(() => import("../pages/ApiPage").then((m) => ({ default: m.ApiPage })));

// The site's own pages (legal notice, privacy, licences, accessibility), each loaded on its first visit.
export const LegalPage = lazyPart(() => import("../pages/site/LegalPage").then((m) => ({ default: m.LegalPage })));
export const PrivacyPage = lazyPart(() =>
  import("../pages/site/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
export const LicencesPage = lazyPart(() =>
  import("../pages/site/LicencesPage").then((m) => ({ default: m.LicencesPage })),
);
export const AccessibilityPage = lazyPart(() =>
  import("../pages/site/AccessibilityPage").then((m) => ({ default: m.AccessibilityPage })),
);

/** The code of the page of an address, fetched at once (beside the entry's own requests of the organisms), so that a
 *  page's code never waits for the organisms to arrive before it is asked for; an address that holds an identifier
 *  also fetches the answer's view beside its conversion. The promise settles when the page's code has arrived (or
 *  failed): the app is first drawn then (main.tsx), over the page's frame, so the page is drawn whole at once. */
function preloadRoute(path: string, search: string): Promise<void> {
  const route = routeOf(path);
  const part = {
    batch: BatchPage,
    names: NamesPage,
    method: MethodPage,
    organisms: OrganismsIndex,
    organism: OrganismPage,
    developers: ApiPage,
    legal: LegalPage,
    "legal-de": LegalPage,
    privacy: PrivacyPage,
    "privacy-de": PrivacyPage,
    licences: LicencesPage,
    accessibility: AccessibilityPage,
  }[route.page as string];
  if (route.page === "convert" && new URLSearchParams(search).has("id"))
    import("../components/ResultView").catch(() => undefined);
  return part?.preload() ?? Promise.resolve();
}

/** The page of the address the app starts at, its code on its way from the moment this module runs. */
export const firstPageReady: Promise<void> =
  typeof window === "undefined" ? Promise.resolve() : preloadRoute(window.location.pathname, window.location.search);
