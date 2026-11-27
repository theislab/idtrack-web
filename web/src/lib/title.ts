// The tab's title: the page's name, and what a page shows when it shows one thing (an answer), with the site's name.
let page = "";
let detail: string | null = null;

function write(): void {
  document.title = [detail, page, "idtrack"].filter(Boolean).join(" · ");
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
