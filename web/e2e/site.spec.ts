// The site's own pages (legal notice, privacy, licences, accessibility), the page of an address that is no page, the
// maintenance page Caddy serves while the api cannot answer, and the files beside the pages (robots.txt, the sitemap,
// security.txt, the web manifest, the icons and the card): each served as it should be, each page accessible in both
// themes at both widths, and no page asking anything of another site before the visitor's consent.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convertUrl, data, expectAccessible, shot } from "./helpers";

const PAGES: { path: string; h1: string; title: string; lang?: string }[] = [
  { path: "/legal", h1: "Legal notice", title: "Legal notice · IDTrack" },
  { path: "/legal/de", h1: "Impressum", title: "Impressum · IDTrack", lang: "de" },
  { path: "/privacy", h1: "Privacy", title: "Privacy · IDTrack" },
  { path: "/privacy/de", h1: "Datenschutz", title: "Datenschutz · IDTrack", lang: "de" },
  { path: "/licences", h1: "Licences", title: "Licences · IDTrack" },
  { path: "/accessibility", h1: "Accessibility", title: "Accessibility · IDTrack" },
  { path: "/accessibility/de", h1: "Barrierefreiheit", title: "Barrierefreiheit · IDTrack", lang: "de" },
];

for (const p of PAGES) {
  test(`${p.path}: its heading, title, canonical address, language, and accessible`, async ({
    page,
    baseURL,
  }, info) => {
    const response = await page.goto(p.path);
    expect(response?.status()).toBe(200);
    // The page declares its language to the browser before any script has run, and keeps it.
    expect(await response?.text()).toContain(`<html lang="${p.lang ?? "en"}">`);
    await expect(page.getByRole("heading", { level: 1, name: p.h1 })).toBeVisible();
    await expect(page).toHaveTitle(p.title);
    const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}${p.path}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${origin}/social-card.png`);
    await expect(page.locator("html")).toHaveAttribute("lang", p.lang ?? "en");
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
      "content",
      p.lang === "de" ? "de_DE" : "en_GB",
    );
    if (p.lang) {
      await expect(page.locator(".doc")).toHaveAttribute("lang", p.lang);
      for (const english of ["header.mast", "footer.foot"])
        await expect(page.locator(english)).toHaveAttribute("lang", "en");
    }
    // Dated, and every section listed beside the text is on the page.
    await expect(page.locator(".doc__meta time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
    for (const link of await page.locator(".doc__contents a").all()) {
      const id = ((await link.getAttribute("href")) ?? "").slice(1);
      await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
    await expectAccessible(page);
    await shot(page, info, `site${p.path.replaceAll("/", "-")}`);
  });
}

test("the legal pages are readable before any code has run (drawn whole by the server)", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/legal");
  await expect(page.getByRole("heading", { level: 1, name: "Legal notice" })).toBeVisible();
  await expect(page.getByText("Helmholtz Zentrum München").first()).toBeVisible();
  await page.goto("/privacy/de");
  await expect(page.getByRole("heading", { level: 2, name: "Ihre Rechte" })).toBeVisible();
  await context.close();
});

test("each page with a German version links it both ways, and the document leaves for English", async ({ page }) => {
  for (const [en, de, name] of [
    ["/legal", "/legal/de", "Impressum"],
    ["/privacy", "/privacy/de", "Datenschutz"],
    ["/accessibility", "/accessibility/de", "Barrierefreiheit"],
  ] as const) {
    await page.goto(en);
    await page.getByRole("link", { name: "Deutsch" }).click();
    await expect(page).toHaveURL(new RegExp(`${de}$`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(new RegExp(`${en}$`));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  }
});

test("a document prints alone, in dark ink on white whatever the theme, its parts spaced", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("idtrack-theme", "dark");
  });
  await page.goto("/legal/de");
  await expect(page.getByRole("heading", { level: 1, name: "Impressum" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header.mast")).toBeHidden();
  await expect(page.locator("footer.foot")).toBeHidden();
  await expect(page.locator(".doc__contents")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Impressum" })).toBeVisible();
  const printed = await page.evaluate(() => {
    const ink = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).color : "";
    };
    const first = document.querySelector("#anbieter ~ p");
    const next = first?.nextElementSibling;
    return {
      label: ink(".doc__facts dt"),
      meta: ink(".doc__meta"),
      gap: first && next ? next.getBoundingClientRect().top - first.getBoundingClientRect().bottom : 0,
    };
  });
  // The light theme's quiet ink (#484e58) on the page, never the dark theme's pale one; the address below its line.
  expect(printed.label).toBe("rgb(72, 78, 88)");
  expect(printed.meta).toBe("rgb(72, 78, 88)");
  expect(printed.gap).toBeGreaterThan(8);
});

test("the privacy page's keys of the browser's storage break only after a hyphen or a colon", async ({ page }) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/privacy");
    const breaks = await page.locator(".doc__key .mono").evaluateAll((keys) =>
      keys.flatMap((key) => {
        // Each character's line, in order: a new line may begin only after "-" or ":".
        const found: string[] = [];
        const walker = document.createTreeWalker(key, NodeFilter.SHOW_TEXT);
        let previous: { char: string; top: number } | null = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? "";
          for (let i = 0; i < text.length; i++) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const top = Math.round(range.getBoundingClientRect().top);
            if (previous && top > previous.top + 2 && !/[-:]/.test(previous.char))
              found.push(`${key.textContent} after "${previous.char}"`);
            previous = { char: text[i] ?? "", top };
          }
        }
        return found;
      }),
    );
    expect(breaks, `${String(width)} px`).toEqual([]);
  }
});

test("the licences give each group of the data's sources one row, its description once", async ({ page }) => {
  await page.goto("/licences");
  const rows = page
    .getByRole("region", { name: "The sources of the graphs' data and their terms" })
    .locator("tbody tr");
  const described = await rows.evaluateAll((all) => all.map((row) => row.querySelector("td")?.textContent ?? ""));
  expect(described.length).toBeGreaterThan(3);
  expect(new Set(described).size).toBe(described.length);
});

test("the privacy page says what this server does: it counts no visits, and states nothing of its https", async ({
  page,
}) => {
  // The servers of the tests count no visits and do not state how they are reached over https.
  await page.goto("/privacy");
  await expect(page.getByText("This server counts no visits")).toBeVisible();
  await expect(page.locator(".doc__key", { hasText: "idtrack-consent" })).toHaveCount(0);
  await expect(page.getByText("this server does not state which")).toBeVisible();
  await page.goto("/privacy/de");
  await expect(page.getByText("Dieser Server zählt keine Besuche")).toBeVisible();
  await expect(page.getByText("welcher, gibt dieser Server nicht an")).toBeVisible();
});

test("the footer leads to the site's own pages", async ({ page }) => {
  await page.goto("/method");
  const row = page.getByRole("navigation", { name: "About this site" });
  for (const name of ["Legal notice", "Privacy", "Licences", "Accessibility"])
    await expect(row.getByRole("link", { name })).toBeVisible();
  await row.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
});

test("the licences' texts are served beside the site, each listed package with its own", async ({ page, request }) => {
  await page.goto("/licences");
  const texts = await page
    .locator('.doc a[href^="/licences/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  expect(texts.length).toBeGreaterThan(10);
  for (const href of new Set(texts)) {
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  }
  const ofl = await (await request.get("/licences/fontsource-variable-inter.txt")).text();
  expect(ofl).toContain("SIL Open Font License, Version 1.1");
});

test("an address that is no page: 404, its own heading, the way back", async ({ page }, info) => {
  const response = await page.goto("/no/such/page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "No such page" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  const sections = page.getByRole("navigation", { name: "The pages of IDTrack" }).getByRole("link");
  await expect(sections).toHaveCount(6);
  // In whole rows: three of two on a phone, two of three on a wider screen.
  const rows = new Set(
    await sections.evaluateAll((links) => links.map((a) => Math.round(a.getBoundingClientRect().top))),
  );
  expect(rows.size).toBe((page.viewportSize()?.width ?? 0) >= 900 ? 2 : 3);
  await expectAccessible(page);
  await shot(page, info, "site-404");
});

test("an address with escapes is quoted as it was typed", async ({ page }) => {
  await page.goto("/gr%C3%B6%C3%9Fe");
  await expect(page.locator(".notfound__head .lede")).toContainText("/größe");
});

test("a graph the server does not hold: 404, the same figure, its name as typed", async ({ page }) => {
  const response = await page.goto("/organisms/no_such_organism");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("No graph named");
  await page.goto("/organisms/nope");
  await expect(page).toHaveTitle("Not found · nope · IDTrack");
  await expect(page.locator(".notfound__figure")).toBeVisible();
  await expectAccessible(page);
});

test("the maintenance page: no script, accessible, in the site's look", async ({ page }, info) => {
  const html = readFileSync(join(import.meta.dirname, "..", "..", "deploy", "maintenance.html"), "utf8");
  await page.route("**/maintenance", (route) =>
    route.fulfill({ status: 503, body: html, contentType: "text/html; charset=utf-8" }),
  );
  const asked: string[] = [];
  page.on("request", (r) => asked.push(r.url()));
  await page.goto("/maintenance");
  await expect(page.getByRole("heading", { level: 1, name: "Back in a moment" })).toBeVisible();
  expect(asked.filter((u) => !u.endsWith("/maintenance"))).toEqual([]);
  // In the site's own faces, written into the page; the line's dots round at any width.
  const drawn = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      faces: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      dots: [...document.querySelectorAll(".line circle")].map((c) => {
        const box = c.getBoundingClientRect();
        return Math.abs(box.width - box.height) < 0.1;
      }),
    };
  });
  expect(drawn.faces.sort()).toEqual(["Inter Variable", "Source Serif 4 Variable"]);
  expect(drawn.dots).toEqual([true, true]);
  await expectAccessible(page);
  await shot(page, info, "site-maintenance");
});

test("robots.txt, the sitemap and security.txt, with their types", async ({ request, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
  const robots = await request.get("/robots.txt");
  expect(robots.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.headers()["content-type"]).toBe("application/xml");
  const locs = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  for (const p of [
    "/",
    "/legal",
    "/legal/de",
    "/privacy",
    "/licences",
    "/accessibility",
    "/accessibility/de",
    `/organisms/${data.organism}`,
  ])
    expect(locs).toContain(`${origin}${p}`);
  for (const loc of locs) expect((await request.get(loc ?? "")).status(), loc).toBe(200);
  const security = await request.get("/.well-known/security.txt");
  expect(security.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  const text = await security.text();
  expect(text).toMatch(/^Contact: https:\/\/github\.com\/theislab\/idtrack-web\/security\/advisories\/new$/m);
  const expires = Date.parse(/^Expires: (.+)$/m.exec(text)?.[1] ?? "");
  expect(expires - Date.now()).toBeGreaterThan(0);
  expect(expires - Date.now()).toBeLessThan(365 * 24 * 3600 * 1000);
});

test("the web manifest, the icons and the card", async ({ page, request }) => {
  await page.goto("/legal");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/site.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  const manifest = await request.get("/site.webmanifest");
  expect(manifest.headers()["content-type"]).toBe("application/manifest+json");
  const icons = ((await manifest.json()) as { icons: { src: string; type: string }[] }).icons;
  for (const path of [...icons.map((i) => i.src), "/apple-touch-icon.png", "/social-card.png"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toMatch(/^image\/(png|svg\+xml)/);
  }
});

test("no page asks anything of another site before the visitor's consent", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
  const elsewhere = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "data:" && url.protocol !== "blob:" && url.origin !== origin) elsewhere.add(url.href);
  });
  const paths = [
    "/",
    convertUrl(data.symbol),
    "/batch",
    "/names",
    "/organisms",
    `/organisms/${data.organism}`,
    "/developers",
    "/method",
    ...PAGES.map((p) => p.path),
    "/no/such/page",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  expect([...elsewhere]).toEqual([]);
});
