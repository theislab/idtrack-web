// The type system's rules, read from every stylesheet: three weights (the tokens), and the headings' tiers set once in
// app.css (no page's stylesheet sets the face, size or weight of a section's heading).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = join(import.meta.dirname, "..", "src", "styles");
const sheets = readdirSync(STYLES)
  .filter((f) => f.endsWith(".css"))
  .map((f) => ({ name: f, text: readFileSync(join(STYLES, f), "utf8") }));

/** Each rule of a sheet: its selector and its declarations (comments removed; nested at-rules flattened). */
function rules(text: string): { selector: string; body: string }[] {
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) out.push({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" });
  return out;
}

describe("the type system", () => {
  it("names every size of tokens.css in web/DESIGN.md's table of the type, and no other", () => {
    const tokens = readFileSync(join(STYLES, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const declared = new Set([...tokens.matchAll(/(--text-[\w-]+)\s*:/g)].map((m) => m[1] ?? ""));
    const design = readFileSync(join(import.meta.dirname, "..", "DESIGN.md"), "utf8");
    const section = /\n### Type\n([\s\S]*?)\n### /.exec(design)?.[1] ?? "";
    const tabled = new Set([...section.matchAll(/^\| `(--text-[\w-]+)` \|/gm)].map((m) => m[1] ?? ""));
    expect(declared.size).toBeGreaterThanOrEqual(9);
    expect([...tabled].sort()).toEqual([...declared].sort());
  });

  it("sets every weight with one of the three tokens", () => {
    const tokens = readFileSync(join(STYLES, "tokens.css"), "utf8");
    expect(tokens).toMatch(/--weight-regular: 400;/);
    expect(tokens).toMatch(/--weight-medium: 520;/);
    expect(tokens).toMatch(/--weight-strong: 640;/);
    for (const { name, text } of sheets) {
      const literal = [...text.matchAll(/font-weight:\s*([^;]+);/g)]
        .map((m) => (m[1] ?? "").trim())
        .filter((v) => !/^var\(--weight-(regular|medium|strong)\)$/.test(v));
      expect(literal, name).toEqual([]);
    }
  });

  it("sets the sections' headings once, in app.css: no page's stylesheet gives them a face, size or weight", () => {
    const app = sheets.find((s) => s.name === "app.css")?.text ?? "";
    const registry = /\/\* A section of the page\. \*\/\s*([^{]+)\{/.exec(app)?.[1] ?? "";
    const selectors = registry
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "h2");
    expect(selectors.length).toBeGreaterThanOrEqual(6);
    for (const { name, text } of sheets.filter((s) => s.name !== "app.css")) {
      for (const rule of rules(text)) {
        const parts = rule.selector.split(",").map((s) => s.trim());
        if (!parts.some((p) => selectors.includes(p))) continue;
        expect(rule.body, `${name}: ${rule.selector}`).not.toMatch(/font-(family|size|weight)\s*:/);
      }
    }
  });
});
