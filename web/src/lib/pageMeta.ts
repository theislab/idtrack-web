// What each page says of itself to a search engine and to a link's preview, written into its frame at build time
// (src/prerender.tsx): its title, one sentence, its canonical address, its other language, the cards of its link (Open
// Graph, Twitter) with the site's card image. The server writes the site's address and the page's canonical path into
// the two slots (api/idtrack_web_api/frontend.py).
import { documentTitle } from "./title";

/** The slots the server fills (frontend.py, ORIGIN_SLOT and PATH_SLOT). */
const ORIGIN = "%ORIGIN%";
const PATH = "%PATH%";

/** The card image of every page (made from the logo by scripts/icons.ts), and its size. */
const CARD = {
  path: "/social-card.png",
  width: 1200,
  height: 630,
  alt: "IDTrack: gene identifiers through Ensembl's history",
};

interface PageMeta {
  description: string;
  /** Kept out of search engines' indexes (an answer, a page that does not exist). */
  noindex?: boolean;
  /** The page's language, where it is not English. */
  lang?: "de";
  /** The same page in the other language. */
  alternate?: string;
}

/** Each page's sentence, by its path (lib/routes.ts); the frames of an organism, an answer and no page by name. */
export const PAGE_META: Record<string, PageMeta> = {
  "/": {
    description:
      "IDTrack follows a gene identifier through Ensembl's releases, one recorded step at a time, and answers with the path that led there.",
  },
  "/convert": {
    description:
      "Convert a gene identifier through Ensembl's releases, genome assemblies and external databases, with the path that led to its answer.",
  },
  "/batch": {
    description: "Convert a list of gene identifiers at once, with every answer, its evidence and a table to export.",
  },
  "/names": {
    description: "Every gene a name or a symbol has named, release by release, and every name a gene has had.",
  },
  "/organisms": {
    description:
      "What can happen to a gene id, told by real identifiers, and the graphs this server holds: releases, assemblies, history.",
  },
  "/developers": {
    description:
      "IDTrack's http api: every endpoint, its parameters and answers, with examples that run and a console.",
  },
  "/method": {
    description: "How IDTrack reads, follows, ranks and answers a gene identifier, and how accurate its answers are.",
  },
  "/legal": {
    description:
      "The legal notice of IDTrack's web app: its provider, Helmholtz Munich, and who is responsible for it.",
    alternate: "/legal/de",
  },
  "/legal/de": {
    description:
      "Das Impressum der Web-App von IDTrack: ihr Anbieter, Helmholtz Munich, und wer für sie verantwortlich ist.",
    lang: "de",
    alternate: "/legal",
  },
  "/privacy": {
    description: "What IDTrack's web app processes when you use it, why, for how long, and your rights.",
    alternate: "/privacy/de",
  },
  "/privacy/de": {
    description: "Was die Web-App von IDTrack bei ihrer Nutzung verarbeitet, warum, wie lange, und Ihre Rechte.",
    lang: "de",
    alternate: "/privacy",
  },
  "/licences": {
    description:
      "The licences of IDTrack's web app, its fonts and software, and the terms of the data behind its answers.",
  },
  "/accessibility": {
    description:
      "The accessibility statement of IDTrack's web app: the standard, how it is tested, and how to report a barrier.",
    alternate: "/accessibility/de",
  },
  "/accessibility/de": {
    description:
      "Die Erklärung zur Barrierefreiheit der Web-App von IDTrack: der Standard, wie er geprüft wird, und wie Sie eine Barriere melden.",
    lang: "de",
    alternate: "/accessibility",
  },
  organism: { description: "What one organism's graph holds: its releases, genome assemblies, databases and history." },
  answer: {
    description:
      "A gene identifier converted by IDTrack, with every candidate ranked and the path that led to the answer.",
    noindex: true,
  },
  none: { description: "No page of IDTrack's web app has this address.", noindex: true },
};

function attribute(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function text(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The tags of a page's head: its title (as the app writes it), description, canonical address and other language
 *  (not for a page that does not exist), robots, and the cards of its link. */
export function metaHead(title: string, meta: PageMeta, canonical = true): string {
  const full = documentTitle(title);
  const url = `${ORIGIN}${PATH}`;
  const tags = [`<title>${text(full)}</title>`, `<meta name="description" content="${attribute(meta.description)}">`];
  if (canonical) tags.push(`<link rel="canonical" href="${url}">`);
  if (meta.alternate) {
    const [en, de] = meta.lang === "de" ? [meta.alternate, null] : [null, meta.alternate];
    tags.push(
      `<link rel="alternate" hreflang="en" href="${en ? ORIGIN + en : url}">`,
      `<link rel="alternate" hreflang="de" href="${de ? ORIGIN + de : url}">`,
    );
  }
  if (meta.noindex) tags.push('<meta name="robots" content="noindex">');
  tags.push(
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="IDTrack">',
    `<meta property="og:locale" content="${meta.lang === "de" ? "de_DE" : "en_GB"}">`,
    `<meta property="og:title" content="${attribute(full)}">`,
    `<meta property="og:description" content="${attribute(meta.description)}">`,
    ...(canonical ? [`<meta property="og:url" content="${url}">`] : []),
    `<meta property="og:image" content="${ORIGIN}${CARD.path}">`,
    `<meta property="og:image:width" content="${String(CARD.width)}">`,
    `<meta property="og:image:height" content="${String(CARD.height)}">`,
    `<meta property="og:image:alt" content="${attribute(CARD.alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${attribute(full)}">`,
    `<meta name="twitter:description" content="${attribute(meta.description)}">`,
    `<meta name="twitter:image" content="${ORIGIN}${CARD.path}">`,
    `<meta name="twitter:image:alt" content="${attribute(CARD.alt)}">`,
  );
  return tags.join("");
}
