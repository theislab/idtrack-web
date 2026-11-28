// The site's icons and its card, rendered from the mark as the site draws it (src/components/logoPaths.ts, IDTrack's
// mark): the touch icon (180 px), the web manifest's icons (192 and 512 px) and the card a link to the site shows
// (1200 x 630 px: the mark and the name IDTrack set in Inter, as the masthead sets them, with a line in Source Serif 4),
// each a PNG in public/, drawn by Chromium (Playwright's) from SVG. scripts/icons.lock.json records the digest of what
// they are made from and of each file, so that the check needs no browser: it fails when the mark, a face or this
// script changed since the files were made, or a file was changed by hand.
//
//   npm run icons          render the files (needs Playwright's Chromium: `npx playwright install chromium`)
//   npm run icons:check    fail when the files are not what the current logo and script give
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const lockFile = `${web}scripts/icons.lock.json`;
const FACE = `${web}node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2`;
const SANS = `${web}node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`;
const LOGO = `${web}src/components/logoPaths.ts`;

const PAPER = "#fafaf8";
const INK = "#0e1116";
const INK_2 = "#3b424c";
const LINE = "#c3c5c9";
const HISTORY = "#2f5fd0";

interface Logo {
  markWidth: number;
  markHeight: number;
  edges: string;
  stroke: number;
  nodes: (readonly [number, number, number])[];
}

/** The mark's paths, read from the module the site draws it from. */
export function readLogo(source: string): Logo {
  const text = (name: string) => {
    const found = new RegExp(`export const ${name} =\\s*"([^"]+)"`).exec(source)?.[1];
    if (found === undefined) throw new Error(`logoPaths.ts holds no ${name}`);
    return found;
  };
  const number = (name: string) => Number(new RegExp(`export const ${name} = (\\d+(?:\\.\\d+)?);`).exec(source)?.[1]);
  const nodes = [
    ...(/MARK_NODES[^=]*=\s*\[([\s\S]*?)\];/.exec(source)?.[1] ?? "").matchAll(/\[(\d+), (\d+), (\d+)\]/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
  if (!nodes.length) throw new Error("logoPaths.ts holds no MARK_NODES");
  return {
    markWidth: number("MARK_WIDTH"),
    markHeight: number("MARK_HEIGHT"),
    edges: text("MARK_EDGES"),
    stroke: number("MARK_STROKE"),
    nodes,
  };
}

function markShapes(logo: Logo, colour: string): string {
  const circles = logo.nodes
    .map(([x, y, r]) => `<circle cx="${String(x)}" cy="${String(y)}" r="${String(r)}"/>`)
    .join("");
  return (
    `<path d="${logo.edges}" fill="none" stroke="${colour}" stroke-width="${String(logo.stroke)}" stroke-linecap="round"/>` +
    `<g fill="${colour}">${circles}</g>`
  );
}

/** A square icon: the mark on paper, inside the middle 64 % (the safe zone of a maskable icon is the middle 80 %). */
export function iconSvg(logo: Logo, size: number): string {
  const inner = size * 0.64;
  const scale = inner / Math.max(logo.markWidth, logo.markHeight);
  const x = (size - logo.markWidth * scale) / 2;
  const y = (size - logo.markHeight * scale) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">` +
    `<rect width="100%" height="100%" fill="${PAPER}"/>` +
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})">${markShapes(logo, INK)}</g></svg>`
  );
}

/** The card (1200 x 630): the mark and the name, and one line, on paper, and on the right ids running through the releases, one of
 *  them ending, in the figure grammar of the site. */
export function cardSvg(logo: Logo): string {
  const height = 112;
  const scale = height / logo.markHeight;
  const lines = [
    [800, 1150, 96, false],
    [760, 1150, 140, false],
    [880, 1150, 184, false],
    [760, 1040, 228, true],
    [820, 1150, 272, false],
    [760, 1150, 316, false],
    [960, 1150, 360, false],
    [840, 1150, 404, false],
    [780, 1150, 448, false],
  ] as const;
  const ids = lines
    .map(([x0, x1, y, ends]) =>
      ends
        ? `<rect x="${String(x0)}" y="${String(y - 5)}" width="${String(x1 - x0)}" height="10" rx="2.5" fill="${HISTORY}"/>` +
          `<line x1="${String(x1 + 6)}" x2="${String(x1 + 6)}" y1="${String(y - 14)}" y2="${String(y + 14)}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
          `<line x1="${String(x1 + 22)}" x2="1150" y1="${String(y)}" y2="${String(y)}" stroke="${LINE}" stroke-width="2" stroke-dasharray="1 9" stroke-linecap="round"/>`
        : `<rect x="${String(x0)}" y="${String(y - 1)}" width="${String(x1 - x0)}" height="2" rx="1" fill="${INK}" opacity="0.28"/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
    `<style>@font-face{font-family:"Source Serif 4";src:url("face.woff2") format("woff2");font-weight:200 900}` +
    `@font-face{font-family:"Inter";src:url("sans.woff2") format("woff2");font-weight:100 900}</style>` +
    `<rect width="1200" height="630" fill="${PAPER}"/>` +
    `<g transform="translate(80 194) scale(${scale.toFixed(5)})">${markShapes(logo, INK)}</g>` +
    `<text x="${String(80 + logo.markWidth * scale + 30)}" y="282" font-family="Inter" font-size="104" font-weight="640" letter-spacing="-1" fill="${INK}">IDTrack</text>` +
    `<text x="80" y="370" font-family="'Source Serif 4'" font-size="40" font-weight="420" fill="${INK}">Every gene id has a history.</text>` +
    `<text x="80" y="420" font-family="'Source Serif 4'" font-size="26" font-weight="400" fill="${INK_2}">Gene identifiers followed through Ensembl’s releases,</text>` +
    `<text x="80" y="456" font-family="'Source Serif 4'" font-size="26" font-weight="400" fill="${INK_2}">with the evidence for every step.</text>` +
    `<line x1="80" x2="1120" y1="540" y2="540" stroke="${LINE}" stroke-width="1"/>` +
    `<text x="80" y="580" font-family="'Source Serif 4'" font-size="22" fill="${INK_2}">Theis Lab · Institute of Computational Biology · Helmholtz Munich</text>` +
    `<g>${ids}</g></svg>`
  );
}

/** The files and the SVG each is drawn from. */
function files(logo: Logo): [string, string, number, number][] {
  return [
    ["apple-touch-icon.png", iconSvg(logo, 180), 180, 180],
    ["icon-192.png", iconSvg(logo, 192), 192, 192],
    ["icon-512.png", iconSvg(logo, 512), 512, 512],
    ["social-card.png", cardSvg(logo), 1200, 630],
  ];
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** The digest of everything the files are made from: the mark's module, the faces, this script. */
function sourceDigest(): string {
  return sha256(
    [readFileSync(LOGO), readFileSync(FACE), readFileSync(SANS), readFileSync(fileURLToPath(import.meta.url))]
      .map((b) => sha256(b))
      .join(""),
  );
}

async function render(): Promise<void> {
  const { chromium } = await import("@playwright/test");
  const logo = readLogo(readFileSync(LOGO, "utf8"));
  const browser = await chromium.launch();
  const face = readFileSync(FACE);
  const sans = readFileSync(SANS);
  const record: Record<string, string> = {};
  try {
    for (const [name, svg, width, height] of files(logo)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.route("**/face.woff2", (route) => route.fulfill({ body: face, contentType: "font/woff2" }));
      await page.route("**/sans.woff2", (route) => route.fulfill({ body: sans, contentType: "font/woff2" }));
      await page.route("http://icons.local/", (route) =>
        route.fulfill({
          body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${svg}</body></html>`,
          contentType: "text/html; charset=utf-8",
        }),
      );
      await page.goto("http://icons.local/");
      await page.evaluate("document.fonts.ready.then(() => true)");
      const png = await page.screenshot({ clip: { x: 0, y: 0, width, height }, type: "png" });
      writeFileSync(`${web}public/${name}`, png);
      record[name] = sha256(png);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(
    lockFile,
    `${JSON.stringify({ about: "Written by scripts/icons.ts: do not edit.", source: sourceDigest(), files: record }, null, 2)}\n`,
  );
  console.log(`wrote ${Object.keys(record).join(", ")} in public/`);
}

function check(): void {
  const lock = JSON.parse(readFileSync(lockFile, "utf8")) as { source: string; files: Record<string, string> };
  const problems: string[] = [];
  if (lock.source !== sourceDigest())
    problems.push("the mark, a face or scripts/icons.ts changed since the files were made");
  for (const [name, digest] of Object.entries(lock.files)) {
    let found = "";
    try {
      found = sha256(readFileSync(`${web}public/${name}`));
    } catch {
      found = "missing";
    }
    if (found !== digest) problems.push(`public/${name} is not the file scripts/icons.ts made`);
  }
  if (problems.length) {
    console.error(`${problems.join("; ")} (npm run icons)`);
    process.exit(1);
  }
  console.log(`icons: ${String(Object.keys(lock.files).length)} files, current`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) check();
  else await render();
}
