// The frames of the pages (src/prerender.tsx), written after the build into dist/frames.json: for each, its markup (the
// masthead and the page's head, drawn before the page's code arrives) and the links the page sent with it carries in
// its head, so that the page's own code is fetched beside the entry instead of after it (`modulepreload` of the page's
// module and every module it imports that the entry does not, and a preload of its stylesheets). The server writes a
// frame into the root of index.html and its links into its head, by the address it answers
// (api/idtrack_web_api/frontend.py); index.html itself stays the page without a frame.
//
//   node scripts/prerender.ts            after `vite build` (npm run build runs it)
//
// The pages are drawn in Node by Vite's own module loader, at each frame's address, as the browser draws them before
// the server's organisms are known.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

interface Chunk {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
}

interface FramesModule {
  FRAMES: Record<string, { address: string; module: string | null }>;
  frameHtml: (frame: unknown) => string;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}dist`;
const manifest = JSON.parse(readFileSync(`${dist}/.vite/manifest.json`, "utf8")) as Record<string, Chunk>;

/** A module's chunk and every chunk it imports, depth first (its own first). */
function chunksOf(key: string, seen = new Set<string>()): string[] {
  if (seen.has(key)) return [];
  seen.add(key);
  const chunk = manifest[key];
  if (!chunk) throw new Error(`The build's manifest has no ${key}.`);
  return [key, ...(chunk.imports ?? []).flatMap((k) => chunksOf(k, seen))];
}

const entry = Object.keys(manifest).find((k) => manifest[k]?.isEntry);
if (!entry) throw new Error("The build's manifest names no entry.");
const ofEntry = new Set(chunksOf(entry));

/** The links of a page's module: what the entry already loads is left out. */
function links(module: string | null): string {
  if (module === null) return "";
  const own = chunksOf(module).filter((k) => !ofEntry.has(k));
  const scripts = own.map((k) => `<link rel="modulepreload" crossorigin href="/${manifest[k]?.file ?? ""}">`);
  const styles = [...new Set(own.flatMap((k) => manifest[k]?.css ?? []))].map(
    (css) => `<link rel="preload" as="style" crossorigin href="/${css}">`,
  );
  return [...scripts, ...styles].join("");
}

/** Put what the pages' modules read of the browser where they look for it, for a document at `address`: its location
 *  (the router reads the address), no stored choice (storage that holds nothing: the default theme) and no element
 *  the server writes (no block of answers: the organisms are not known yet). Nothing else of a browser is read while
 *  a page is drawn to text (effects do not run). */
function at(address: string): void {
  const location = new URL(address, "http://localhost");
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined };
  const window = { location, localStorage: storage, sessionStorage: storage, ...listeners };
  const document = { getElementById: () => null, visibilityState: "visible", ...listeners };
  for (const [name, value] of Object.entries({ window, document, localStorage: storage, sessionStorage: storage }))
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

at("/");
const vite = await createServer({
  root,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const frames = (await vite.ssrLoadModule("/src/prerender.tsx")) as FramesModule;
  const out: Record<string, { html: string; head: string }> = {};
  for (const [name, frame] of Object.entries(frames.FRAMES)) {
    at(frame.address);
    // The masthead's tools (the organism, the load, the search, the picture, the theme) answer only once the app has
    // replaced the frame: until then they are inert, so a press never lands on a control that cannot answer it (the
    // links work as links).
    const html = frames.frameHtml(frame).replace('<div class="mast__tools">', '<div class="mast__tools" inert="">');
    if (!html.includes('class="mast__tools" inert=""')) throw new Error(`The frame ${name} has no masthead tools.`);
    // The theme chosen is the visitor's (kept in their browser), unknown here: the frame's theme button says none.
    const frameHtml = html.replace(
      /(<button type="button" class="theme-button") aria-label="[^"]*" title="[^"]*"/,
      "$1",
    );
    // The page's security policy allows no inline style or script: a frame that held one would be refused by the
    // browser (and said so in its console).
    if (/\sstyle="|<script/i.test(html)) throw new Error(`The frame ${name} holds an inline style or script.`);
    out[name] = { html: frameHtml, head: links(frame.module) };
  }
  writeFileSync(`${dist}/frames.json`, `${JSON.stringify({ frames: out }, null, 1)}\n`);
  console.log(
    `wrote dist/frames.json: ${Object.entries(out)
      .map(([name, f]) => `${name} ${(f.html.length / 1024).toFixed(1)} KB`)
      .join(", ")}`,
  );
} finally {
  await vite.close();
}
