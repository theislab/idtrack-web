// The places the site links to beyond itself: idtrack's documentation (where the server says it is published:
// `GET /api/v1/version` `docs_url`, set by `IDTRACK_WEB_DOCS_URL`; Read the Docs until then), its source and package,
// and, as references only, the sources of this site and of idtrack's benchmarks.

/** idtrack's documentation, where it is published unless the server names another address. */
export const DEFAULT_DOCS = "https://idtrack.readthedocs.io/en/stable/";
export const IDTRACK_SOURCE = "https://github.com/theislab/idtrack";
export const IDTRACK_PACKAGE = "https://pypi.org/project/idtrack/";
export const SITE_SOURCE = "https://github.com/theislab/idtrack-web";
export const BENCHMARKS_SOURCE = "https://github.com/theislab/idtrack-reproducibility";

let root = DEFAULT_DOCS;

/** Take the documentation's address the server names (a root ending in "/"): an absolute http(s) address, as the
 *  server's setting takes it (https in production; http only for a local test, `config._https_url`); anything else is
 *  ignored and the default stays. */
export function setDocsRoot(url: string | null | undefined): void {
  if (url && /^https?:\/\//.test(url)) root = url.endsWith("/") ? url : `${url}/`;
}

/** A page of idtrack's documentation (`concepts.html#concept-history`), or its front page. */
export function docsPage(page = ""): string {
  return root + page.replace(/^\/+/, "");
}
