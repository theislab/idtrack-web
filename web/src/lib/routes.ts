// The pages of the app by address: decided from the path alone, before anything is asked of the api, so that an
// address that is no page is said at once. The api's server answers every one of these paths with the app; any
// other path is "No such page".

/** The site's own pages (the legal notice and the privacy page each in English and in German, the licences, the
 *  accessibility statement): they need no organism. */
type SitePage = "legal" | "legal-de" | "privacy" | "privacy-de" | "licences" | "accessibility";

export type Route =
  | { page: "home" | "convert" | "batch" | "names" | "organisms" | "developers" | "method" | SitePage; title: string }
  | { page: "organism"; title: string; organism: string }
  | { page: "redirect"; title: string; to: string }
  | { page: "none"; title: string };

const PAGES: Record<string, { page: Exclude<Route["page"], "organism" | "redirect" | "none">; title: string }> = {
  "/": { page: "home", title: "Gene ids through Ensembl's history" },
  "/convert": { page: "convert", title: "Convert" },
  "/batch": { page: "batch", title: "Batch" },
  "/names": { page: "names", title: "Names" },
  "/organisms": { page: "organisms", title: "Explore" },
  "/developers": { page: "developers", title: "API" },
  "/method": { page: "method", title: "Method" },
  "/legal": { page: "legal", title: "Legal notice" },
  "/legal/de": { page: "legal-de", title: "Impressum" },
  "/privacy": { page: "privacy", title: "Privacy" },
  "/privacy/de": { page: "privacy-de", title: "Datenschutz" },
  "/licences": { page: "licences", title: "Licences" },
  "/accessibility": { page: "accessibility", title: "Accessibility" },
};

/** The paths of the pages (the server answers each with the page and 200; the sitemap lists them). */
export const PAGE_PATHS: readonly string[] = Object.keys(PAGES);

/** The page of a path. A trailing slash names the same page (`/batch/` is `/batch`); `/organisms/<name>` is one
 *  graph's page, and anything deeper is no page. */
export function routeOf(path: string): Route {
  const exact = PAGES[path];
  if (exact) return exact;
  if (path.length > 1 && path.endsWith("/")) {
    const trimmed = path.replace(/\/+$/, "") || "/";
    if (trimmed in PAGES || /^\/organisms\/[^/]+$/.test(trimmed)) {
      return { page: "redirect", title: PAGES[trimmed]?.title ?? "Explore", to: trimmed };
    }
  }
  const organism = /^\/organisms\/([^/]+)$/.exec(path)?.[1];
  if (organism) {
    let name = organism;
    try {
      name = decodeURIComponent(organism);
    } catch {
      return { page: "none", title: "Not found" };
    }
    return { page: "organism", title: name, organism: name };
  }
  return { page: "none", title: "Not found" };
}
