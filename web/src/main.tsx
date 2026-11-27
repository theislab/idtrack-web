import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { startTransition, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, firstPageReady } from "./App";
import { RootBoundary } from "./components/RootBoundary";
import { installChunkWatch } from "./lib/chunks";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/shell.css";

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
// first commit, which replaces the frame, is the page whole; it is drawn in a transition, in slices that leave the
// main thread free between them.
void firstPageReady.then(() => {
  startTransition(() => {
    createRoot(root).render(
      <StrictMode>
        <RootBoundary>
          <App />
        </RootBoundary>
      </StrictMode>,
    );
  });
});
