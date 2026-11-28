// The tab's title: the page's name, and what a page shows when it shows one thing (an answer), with the site's name.
// The frames' titles are written by the same rule (lib/pageMeta.ts), so the server's page and the app's agree.
let page = "";
let detail: string | null = null;

/** The site's name as every title ends. */
const SITE_NAME = "IDTrack";

/** A title of the page's name (and what it shows), with the site's name. */
export function documentTitle(name: string, shown: string | null = null): string {
  return [shown, name, SITE_NAME].filter(Boolean).join(" · ");
}

function write(): void {
  document.title = documentTitle(page, detail);
}

/** The page's name ("Convert", "Batch"). A page that sets a detail clears it when it goes. */
export function setPageTitle(name: string): void {
  page = name;
  write();
}

/** What the page shows ("TP53 → ENSG00000141510.20"), or null for the page's name alone. */
export function setTitleDetail(text: string | null): void {
  detail = text;
  write();
}
