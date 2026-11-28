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
// it on to the same control of the page: the same kind of element with the same words (and address, where one has
// it). The frame's control that holds the focus is followed until the app's first commit replaces it.
void firstPageReady.then(() => {
  const frame = new Set(root.querySelectorAll("*"));
  const markOf = (e: Element) => ({ tag: e.tagName, href: e.getAttribute("href"), text: e.textContent.trim() });
  let mark: ReturnType<typeof markOf> | null = null;
  createRoot(root).render(
    <StrictMode>
      <RootBoundary>
        <App />
      </RootBoundary>
    </StrictMode>,
  );
  let frames = 0;
  const follow = () => {
    const now = document.activeElement;
    if (now && now !== document.body && root.contains(now)) {
      // Still a control of the frame: remember it; else the page's own control holds the focus, and nothing is due.
      if (!frame.has(now)) return;
      mark = markOf(now);
    } else if (mark) {
      const wanted = mark;
      const candidates = [...root.querySelectorAll<HTMLElement>(wanted.tag)].filter(
        (e) => !frame.has(e) && e.textContent.trim() === wanted.text,
      );
      const same = candidates.find((e) => e.getAttribute("href") === wanted.href) ?? candidates[0];
      // Handed on from the keyboard, so its ring shows (`focusVisible`, where the browser knows it).
      if (same) {
        same.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
        return;
      }
    }
    if (++frames < 600) requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
});
