// The frame of each page as HTML, made at build time (scripts/prerender.ts) and sent by the server inside the page's
// root, so that the masthead and the page's head (its eyebrow, title and lede: the largest text of its first screen)
// are drawn before any of the page's code has arrived. It is the pages' own markup in the state before the server's
// organisms are known (no organism is named): the same components the app draws, so it cannot drift from them. The app
// renders into the root as usual and replaces the frame in its first commit (nothing is hydrated): what the frame shows
// is what the app's first frame shows, and a frame that differed would be replaced, never shifted.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { ConvertSections, Masthead } from "./components/shell/Masthead";
import { metaHead, PAGE_META } from "./lib/pageMeta";
import { OrganismsProvider } from "./lib/organisms";
import { routeOf } from "./lib/routes";
import { ApiHead } from "./pages/ApiPage";
import { BatchHead } from "./pages/BatchPage";
import { ConvertPage } from "./pages/ConvertPage";
import { HomePage } from "./pages/HomePage";
import { MethodHead } from "./pages/MethodPage";
import { NamesHead } from "./pages/NamesPage";
import { ExploreHead } from "./pages/OrganismPage";
import { AccessibilityPage } from "./pages/site/AccessibilityPage";
import { LegalPage } from "./pages/site/LegalPage";
import { LicencesPage } from "./pages/site/LicencesPage";
import { PrivacyPage } from "./pages/site/PrivacyPage";

export interface Frame {
  /** The address the frame is drawn at (its path decides the masthead's current link). */
  address: string;
  /** The page's module whose code (and the code it imports) the page sent for this frame preloads; none for the
   *  home and the Convert page, whose code is the entry's. */
  module: string | null;
  body: () => ReactNode;
  /** The page's own entry of lib/pageMeta.ts (its path, or a frame's name for an organism, an answer and no page). */
  meta: string;
}

/** The frames by name; the server picks one by the address it answers (api/idtrack_web_api/frontend.py). */
export const FRAMES: Record<string, Frame> = {
  home: { address: "/", module: null, body: () => <HomePage />, meta: "/" },
  convert: { address: "/convert", module: null, body: () => <ConvertPage />, meta: "/convert" },
  answer: {
    address: "/convert?id=_",
    module: "src/components/ResultView.tsx",
    body: () => <ConvertPage />,
    meta: "answer",
  },
  batch: {
    address: "/batch",
    module: "src/pages/BatchPage.tsx",
    meta: "/batch",
    body: () => (
      <div className="page page--batch">
        <BatchHead />
      </div>
    ),
  },
  names: {
    address: "/names",
    module: "src/pages/NamesPage.tsx",
    meta: "/names",
    body: () => (
      <div className="page page--names">
        <NamesHead />
      </div>
    ),
  },
  organisms: {
    address: "/organisms",
    module: "src/pages/OrganismPage.tsx",
    meta: "/organisms",
    body: () => (
      <div className="page page--explore">
        <ExploreHead />
      </div>
    ),
  },
  organism: {
    address: "/organisms/_",
    module: "src/pages/OrganismPage.tsx",
    meta: "organism",
    body: () => <div className="page page--organism" />,
  },
  developers: {
    address: "/developers",
    module: "src/pages/ApiPage.tsx",
    meta: "/developers",
    body: () => (
      <div className="page api-page">
        <ApiHead />
      </div>
    ),
  },
  method: {
    address: "/method",
    module: "src/pages/MethodPage.tsx",
    meta: "/method",
    body: () => (
      <div className="page page--about page--method">
        <MethodHead />
      </div>
    ),
  },
  // The site's own pages are drawn whole: they are text, readable before any code has run.
  legal: { address: "/legal", module: "src/pages/site/LegalPage.tsx", body: () => <LegalPage />, meta: "/legal" },
  "legal-de": {
    address: "/legal/de",
    module: "src/pages/site/LegalPage.tsx",
    body: () => <LegalPage lang="de" />,
    meta: "/legal/de",
  },
  privacy: {
    address: "/privacy",
    module: "src/pages/site/PrivacyPage.tsx",
    body: () => <PrivacyPage />,
    meta: "/privacy",
  },
  "privacy-de": {
    address: "/privacy/de",
    module: "src/pages/site/PrivacyPage.tsx",
    body: () => <PrivacyPage lang="de" />,
    meta: "/privacy/de",
  },
  licences: {
    address: "/licences",
    module: "src/pages/site/LicencesPage.tsx",
    body: () => <LicencesPage />,
    meta: "/licences",
  },
  accessibility: {
    address: "/accessibility",
    module: "src/pages/site/AccessibilityPage.tsx",
    body: () => <AccessibilityPage />,
    meta: "/accessibility",
  },
  "accessibility-de": {
    address: "/accessibility/de",
    module: "src/pages/site/AccessibilityPage.tsx",
    body: () => <AccessibilityPage lang="de" />,
    meta: "/accessibility/de",
  },
  none: { address: "/_", module: null, body: () => <div className="page" />, meta: "none" },
};

/** The tags of a frame's head: the title the app gives its address, the page's description, canonical address and
 *  link cards (lib/pageMeta.ts); a page that does not exist has no canonical address. */
export function frameMeta(frame: Frame): string {
  const meta = PAGE_META[frame.meta];
  if (!meta) throw new Error(`No description of the page ${frame.meta} (lib/pageMeta.ts).`);
  const route = routeOf(new URL(frame.address, "http://localhost").pathname);
  const title = route.page === "organism" ? "Explore" : route.title;
  return metaHead(title, meta, frame.meta !== "none");
}

/** The frame's markup, drawn at the address the global `window` is at (the build sets it to `frame.address`). */
/** The language of a frame's page, which the server writes into the page's `<html lang>`. */
export function frameLang(frame: Frame): "en" | "de" {
  return PAGE_META[frame.meta]?.lang ?? "en";
}

export function frameHtml(frame: Frame): string {
  return renderToString(
    <OrganismsProvider>
      <Masthead />
      <main id="main" tabIndex={-1}>
        <ConvertSections />
        {frame.body()}
      </main>
    </OrganismsProvider>,
  );
}
