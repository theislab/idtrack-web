import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { firstPageReady } from "./lib/pageParts";
import { RootBoundary } from "./components/RootBoundary";
import { installChunkWatch } from "./lib/chunks";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/shell.css";
import "./styles/v2.css";
// The figure grammar every page with a figure shares (batch, names, the answer, Explore, the 404 page).
import "./styles/figure.css";

installChunkWatch();

// The fit of identifiers to the text's x-height applies once JetBrains Mono is there (app.css, "Faces"): at once when
// it is already loaded, else when it arrives (a face that never arrives leaves the fallback at its fitted width).
const MONO = '1em "JetBrains Mono Variable"';
const fontsReady = () => {
  document.documentElement.classList.add("fonts-ready");
};
if (typeof document.fonts === "undefined" || document.fonts.check(MONO)) fontsReady();
else
  document.fonts.load(MONO).then(
    (faces) => {
      if (faces.some((face) => face.status === "loaded")) fontsReady();
    },
    () => undefined,
  );

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");
// The root holds the page's frame the server wrote into it (src/prerender.tsx): the masthead and the page's head, drawn
// before any code ran. The app is drawn once the page's own code has arrived (it was fetched beside this entry), so its
// first commit, which replaces the frame, is the page whole.
// A control of the frame that holds the focus when the app replaces the frame (a reader who pressed Tab early) hands
// it on to the same control of the page: the same kind of element with the same address or words.
void firstPageReady.then(() => {
  const held =
    document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
      ? document.activeElement
      : null;
  const mark = held ? { tag: held.tagName, href: held.getAttribute("href"), text: held.textContent.trim() } : null;
  createRoot(root).render(
    <StrictMode>
      <RootBoundary>
        <App />
      </RootBoundary>
    </StrictMode>,
  );
  if (!mark) return;
  let frames = 0;
  const handOn = () => {
    if (
      document.activeElement !== document.body &&
      document.activeElement !== null &&
      root.contains(document.activeElement)
    )
      return;
    const candidates = [...root.querySelectorAll<HTMLElement>(mark.tag)].filter(
      (e) => e.textContent.trim() === mark.text,
    );
    const same = candidates.find((e) => e.getAttribute("href") === mark.href) ?? candidates[0];
    if (same) same.focus({ preventScroll: true });
    else if (++frames < 120) requestAnimationFrame(handOn);
  };
  requestAnimationFrame(handOn);
});
