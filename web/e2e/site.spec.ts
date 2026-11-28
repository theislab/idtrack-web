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
];

for (const p of PAGES) {
  test(`${p.path}: its heading, title, canonical address, and accessible`, async ({ page, baseURL }, info) => {
    const response = await page.goto(p.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: p.h1 })).toBeVisible();
    await expect(page).toHaveTitle(p.title);
    const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}${p.path}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${origin}/social-card.png`);
    if (p.lang) await expect(page.locator(".doc")).toHaveAttribute("lang", p.lang);
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

test("the legal notice and its German version link each other, and print as a document", async ({ page }) => {
  await page.goto("/legal");
  await page.getByRole("link", { name: "Deutsch" }).click();
  await expect(page).toHaveURL(/\/legal\/de$/);
  await expect(page.getByRole("heading", { level: 1, name: "Impressum" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".masthead")).toBeHidden();
  await expect(page.locator(".doc__contents")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Impressum" })).toBeVisible();
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
  await expect(page.getByRole("navigation", { name: "The pages of IDTrack" }).getByRole("link")).toHaveCount(6);
  await expectAccessible(page);
  await shot(page, info, "site-404");
});

test("a graph the server does not hold: 404, the same figure", async ({ page }) => {
  const response = await page.goto("/organisms/no_such_organism");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("No graph named");
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
