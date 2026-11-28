// The site's own pages and the files beside them: every key the code keeps in the browser is on the privacy page,
// every source of IDTrack's data has its terms on the licences page, every page has its description and link cards,
// and the generators (licences, icons, security.txt) do what they say.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardSvg, iconSvg, readLogo } from "../scripts/icons.ts";
import { copyrightOf, packageOf, textFile } from "../scripts/licences.ts";
import { expiresOf, securityTxt, SECURITY_CONTACT } from "../scripts/site-files.ts";
import docs from "../src/generated/idtrack_docs.json" with { type: "json" };
import licences from "../src/generated/licences.json" with { type: "json" };
import { writtenDate } from "../src/lib/site/dates";
import { metaHead, PAGE_META } from "../src/lib/pageMeta";
import { PAGE_PATHS, routeOf } from "../src/lib/routes";
import { DATA_TERMS } from "../src/lib/site/dataTerms";
import { STORED } from "../src/lib/site/storage";
import { documentTitle } from "../src/lib/title";

const web = join(import.meta.dirname, "..");

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the privacy page's list of what the browser keeps", () => {
  it("names every key the code stores under, in the page and in index.html", () => {
    const keys = new Set<string>();
    for (const file of sources(join(web, "src"))) {
      const text = readFileSync(file, "utf8");
      if (!/(local|session)Storage\.setItem/.test(text)) continue;
      for (const m of text.matchAll(/const\s+\w*(?:KEY|PREFIX)\s*=\s*"([^"]+)"/g)) keys.add(m[1] ?? "");
    }
    for (const m of readFileSync(join(web, "index.html"), "utf8").matchAll(/Storage\.getItem\("([^"]+)"\)/g))
      keys.add(m[1] ?? "");
    expect(keys.size).toBeGreaterThanOrEqual(4);
    const listed = STORED.map((s) => s.key.replace(/…$/, ""));
    for (const key of keys) expect(listed, key).toContain(key);
  });

  it("says in both languages what each key holds and for how long", () => {
    for (const s of STORED)
      for (const lang of ["en", "de"] as const) expect(s[lang].holds && s[lang].when).toBeTruthy();
  });
});

describe("the licences page", () => {
  it("gives every source of IDTrack's data its terms, from the source's own page", () => {
    const names = docs.sources.items.flatMap((i) => i.resources.map((r) => r.name));
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      const terms = DATA_TERMS[name];
      expect(terms, name).toBeDefined();
      expect(terms?.url, name).toMatch(/^https:\/\//);
    }
    expect(Object.keys(DATA_TERMS).sort()).toEqual([...names].sort());
  });

  it("lists the bundle's packages, each with its licence and its text", () => {
    expect(licences.packages.filter((p) => p.font).map((p) => p.family)).toEqual([
      "Inter",
      "JetBrains Mono",
      "Source Serif 4",
    ]);
    for (const p of licences.packages) {
      expect(p.license, p.name).toMatch(/\S/);
      expect(readFileSync(join(web, "public", p.text), "utf8").length, p.name).toBeGreaterThan(100);
    }
  });

  it("reads a package from a module's path, names its text, finds its copyright line", () => {
    expect(packageOf("/x/node_modules/react-dom/cjs/react-dom.js")).toBe("react-dom");
    expect(packageOf("node_modules/@fontsource-variable/inter/files/a.woff2")).toBe("@fontsource-variable/inter");
    expect(packageOf("/x/node_modules/a/node_modules/@s/b/index.js")).toBe("@s/b");
    expect(packageOf("/x/src/App.tsx")).toBeNull();
    expect(textFile("@fontsource-variable/inter")).toBe("fontsource-variable-inter.txt");
    expect(copyrightOf("MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n")).toBe(
      "Copyright (c) Meta Platforms, Inc. and affiliates.",
    );
    // The licence's own words about copyright notices are no copyright line.
    expect(copyrightOf("Google Inc.\n\nThis license is copied below\ncopyright statement(s).\n")).toBe("");
  });
});

describe("the pages' heads", () => {
  it("describe every page", () => {
    for (const path of PAGE_PATHS) expect(PAGE_META[path]?.description.length ?? 0, path).toBeGreaterThan(40);
    for (const frame of ["organism", "answer", "none"]) expect(PAGE_META[frame]).toBeDefined();
  });

  it("route the site's pages, in both languages, and give each its title", () => {
    expect(routeOf("/legal")).toMatchObject({ page: "legal", title: "Legal notice" });
    expect(routeOf("/legal/de")).toMatchObject({ page: "legal-de", title: "Impressum" });
    expect(routeOf("/privacy/de/")).toMatchObject({ page: "redirect", to: "/privacy/de" });
    expect(routeOf("/licences").page).toBe("licences");
    expect(routeOf("/accessibility").page).toBe("accessibility");
    expect(routeOf("/legal/fr").page).toBe("none");
    expect(documentTitle("Legal notice")).toBe("Legal notice · IDTrack");
    expect(documentTitle("Convert", "TP53")).toBe("TP53 · Convert · IDTrack");
  });

  it("carry the title, the description, the canonical address, the other language and the cards", () => {
    const head = metaHead("Impressum", { description: 'Das "Impressum" & mehr', lang: "de", alternate: "/legal" });
    expect(head).toContain("<title>Impressum · IDTrack</title>");
    expect(head).toContain('<meta name="description" content="Das &quot;Impressum&quot; &amp; mehr">');
    expect(head).toContain('<link rel="canonical" href="%ORIGIN%%PATH%">');
    expect(head).toContain('<link rel="alternate" hreflang="en" href="%ORIGIN%/legal">');
    expect(head).toContain('<link rel="alternate" hreflang="de" href="%ORIGIN%%PATH%">');
    expect(head).toContain('<meta property="og:image" content="%ORIGIN%/social-card.png">');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    const missing = metaHead("Not found", { description: "No page.", noindex: true }, false);
    expect(missing).toContain('<meta name="robots" content="noindex">');
    expect(missing).not.toContain("canonical");
    expect(missing).not.toContain("og:url");
  });
});

describe("security.txt", () => {
  it("names the contact and expires less than a year after the build", () => {
    const now = new Date("2026-11-28T13:45:00Z");
    expect(expiresOf(now).toISOString()).toBe("2027-11-27T00:00:00.000Z");
    const text = securityTxt(now);
    expect(text).toContain(`Contact: ${SECURITY_CONTACT}\n`);
    expect(text).toContain("Expires: 2027-11-27T00:00:00Z\n");
    expect(text.endsWith("\n")).toBe(true);
    // Every line is a comment or a field of RFC 9116.
    for (const line of text.trim().split("\n"))
      expect(line).toMatch(/^(#.*|(Contact|Expires|Preferred-Languages): \S.*)$/);
  });
});

describe("the icons and the card", () => {
  const logo = readLogo(readFileSync(join(web, "src", "components", "logoPaths.ts"), "utf8"));

  it("read the mark from the module the site draws it from", () => {
    expect(logo.nodes).toHaveLength(9);
    expect(logo.edges).toMatch(/^M\d/);
    expect(logo.markWidth).toBeGreaterThan(0);
  });

  it("draw the mark on paper, inside the safe zone of a maskable icon", () => {
    const svg = iconSvg(logo, 512);
    expect(svg).toContain('width="512" height="512"');
    const [, x, y, scale] = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/.exec(svg)?.map(Number) ?? [];
    expect(Math.min(x ?? 0, y ?? 0)).toBeGreaterThanOrEqual(512 * 0.1);
    expect((scale ?? 0) * logo.markWidth).toBeLessThanOrEqual(512 * 0.8);
    expect(cardSvg(logo)).toContain('width="1200" height="630"');
    expect(cardSvg(logo)).toContain(">IDTrack</text>");
  });

  it("are the files the script made from the current logo (scripts/icons.lock.json)", () => {
    const lock = JSON.parse(readFileSync(join(web, "scripts", "icons.lock.json"), "utf8")) as { files: object };
    expect(Object.keys(lock.files).sort()).toEqual([
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "social-card.png",
    ]);
  });
});

describe("the legal pages' dates", () => {
  it("are written in each language's form", () => {
    expect(writtenDate("2026-11-28", "en")).toBe("28 November 2026");
    expect(writtenDate("2026-03-01", "de")).toBe("1. März 2026");
  });
});
