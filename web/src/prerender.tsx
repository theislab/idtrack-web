// The frame of each page as HTML, made at build time (scripts/prerender.ts) and sent by the server inside the page's
// root, so that the masthead and the page's head (its eyebrow, title and lede: the largest text of its first screen)
// are drawn before any of the page's code has arrived. It is the pages' own markup in the state before the server's
// organisms are known (no organism is named): the same components the app draws, so it cannot drift from them. The app
// renders into the root as usual and replaces the frame in its first commit (nothing is hydrated): what the frame shows
// is what the app's first frame shows, and a frame that differed would be replaced, never shifted.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { Header } from "./App";
import { OrganismsProvider } from "./lib/organisms";
import { ApiHead } from "./pages/ApiPage";
import { BatchHead } from "./pages/BatchPage";
import { ConvertPage } from "./pages/ConvertPage";
import { MethodHead } from "./pages/MethodPage";
import { NamesHead } from "./pages/NamesPage";
import { ExploreHead } from "./pages/OrganismPage";

export interface Frame {
  /** The address the frame is drawn at (its path decides the masthead's current link). */
  address: string;
  /** The page's module whose code (and the code it imports) the page sent for this frame preloads; none for the
   *  Convert page, whose code is the entry's. */
  module: string | null;
  body: () => ReactNode;
}

/** The frames by name; the server picks one by the address it answers (api/idtrack_web_api/frontend.py). */
export const FRAMES: Record<string, Frame> = {
  convert: { address: "/", module: null, body: () => <ConvertPage /> },
  answer: { address: "/?id=_", module: "src/components/ResultView.tsx", body: () => <ConvertPage /> },
  batch: {
    address: "/batch",
    module: "src/pages/BatchPage.tsx",
    body: () => (
      <div className="page page--batch">
        <BatchHead />
      </div>
    ),
  },
  names: {
    address: "/names",
    module: "src/pages/NamesPage.tsx",
    body: () => (
      <div className="page page--names">
        <NamesHead />
      </div>
    ),
  },
  organisms: {
    address: "/organisms",
    module: "src/pages/OrganismPage.tsx",
    body: () => (
      <div className="page page--explore">
        <ExploreHead />
      </div>
    ),
  },
  organism: {
    address: "/organisms/_",
    module: "src/pages/OrganismPage.tsx",
    body: () => <div className="page page--organism" />,
  },
  developers: {
    address: "/developers",
    module: "src/pages/ApiPage.tsx",
    body: () => (
      <div className="page api-page">
        <ApiHead />
      </div>
    ),
  },
  method: {
    address: "/method",
    module: "src/pages/MethodPage.tsx",
    body: () => (
      <div className="page page--about page--method">
        <MethodHead />
      </div>
    ),
  },
  none: { address: "/_", module: null, body: () => <div className="page" /> },
};

/** The frame's markup, drawn at the address the global `window` is at (the build sets it to `frame.address`). */
export function frameHtml(frame: Frame): string {
  return renderToString(
    <OrganismsProvider>
      <Header />
      <main id="main" tabIndex={-1}>
        {frame.body()}
      </main>
    </OrganismsProvider>,
  );
}
