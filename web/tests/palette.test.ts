// The hues of the kinds of step are told apart by readers with protanopia and deuteranopia (Machado, Oliveira and
// Fernandes 2009 at full severity), by readers with full colour vision, and stand out from the drawing's surface, in
// both themes. Distances are OKLab ΔE ×100: at least 8 under simulation, 15 in full colour; contrast at least 3:1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "..", "src", "styles", "tokens.css"), "utf8");

function block(selector: RegExp): string {
  const match = selector.exec(css);
  if (!match) throw new Error(`no block ${String(selector)}`);
  const start = css.indexOf("{", match.index) + 1;
  let depth = 1;
  let i = start;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
  }
  return css.slice(start, i - 1);
}

function token(text: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(text);
  if (!match?.[1]) throw new Error(`no --${name}`);
  return match[1];
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];

function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const MACHADO: Record<string, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

function simulate(c: [number, number, number], kind: string): [number, number, number] {
  const m = MACHADO[kind] ?? [];
  return m.map((row) =>
    Math.min(1, Math.max(0, (row[0] ?? 0) * c[0] + (row[1] ?? 0) * c[1] + (row[2] ?? 0) * c[2])),
  ) as [number, number, number];
}

const distance = (a: [number, number, number], b: [number, number, number]) =>
  100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
};

const HUES = ["hue-history", "hue-event", "hue-external", "hue-handoff"];
const themes = {
  light: block(/^:root\s*\{/m),
  dark: block(/:root\[data-theme="dark"\]\s*\{/),
};

describe.each(Object.entries(themes))("the %s theme", (_, text) => {
  const hues = HUES.map((h) => token(text, h));
  const surface = token(text, "surface");
  it("keeps every pair of step hues apart", () => {
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const a = rgb(hues[i] ?? "");
        const b = rgb(hues[j] ?? "");
        expect(distance(oklab(a), oklab(b)), `${hues[i] ?? ""} ${hues[j] ?? ""} normal`).toBeGreaterThanOrEqual(15);
        for (const kind of ["protan", "deutan"]) {
          expect(
            distance(oklab(simulate(a, kind)), oklab(simulate(b, kind))),
            `${hues[i] ?? ""} ${hues[j] ?? ""} ${kind}`,
          ).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });
  it("sets every step hue off from the surface at 3:1 or more", () => {
    for (const hue of hues) expect(contrast(hue, surface), hue).toBeGreaterThanOrEqual(3);
  });
  it("sets the text inks off from the surface at 4.5:1 or more", () => {
    for (const ink of ["ink-1", "ink-2", "ink-3", "state-danger", "state-ok", "state-warn"]) {
      expect(contrast(token(text, ink), surface), ink).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(text, ink), token(text, "paper")), ink).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(text, ink), token(text, "band")), ink).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the two dark blocks", () => {
  it("are the same (system dark and the chosen dark theme)", () => {
    const system = block(/:root\[data-theme="system"\]\s*\{/);
    const chosen = themes.dark;
    const tokens = (t: string) =>
      [...t.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => `${m[1] ?? ""}=${m[2] ?? ""}`).sort();
    expect(tokens(system)).toEqual(tokens(chosen));
  });
});
