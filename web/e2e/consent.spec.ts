// Counting visits, only with consent (lib/analytics.ts, components/shell/Consent.tsx), on a page as a server that
// counts visits sends it: its preloaded `/version` names a measurement id and (for these tests only) no policy stops
// Google's tag. Every request to another host is answered here, so nothing leaves the machine: Google's tag is a copy
// recorded once where E2E_GTAG names one (else an empty script, and the page's own data layer is read), and every hit
// is recorded and answered empty.
//
// What is shown: nothing is asked of Google before Accept; every hit carries the page's path and name alone, never a
// query, an identifier or an answer; Google's cookies stay on the site's host and another site's cookie of the domain
// above survives; a consent withdrawn in one tab stops every tab; the notice is a bar that covers nothing of the home's
// hero at any size and no focused link, comes right after "Skip to the content", lets Escape leave it, hands the focus
// to the page after an answer, and is accessible (axe) in both themes.
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { convertUrl, data, expectAccessible, shot } from "./helpers";

/** Google's tag as recorded once (E2E_GTAG: the file of `https://www.googletagmanager.com/gtag/js?id=<the id>`, as
 *  Google sent it for the site's property), with the property's two automatic measurements that read the browser's
 *  address themselves switched off, as the site requires of its property (SETUP.md, "Counting visits"): page views on
 *  a change of the browser's history, and form interactions. */
const RECORDED = process.env["E2E_GTAG"] ? readFileSync(process.env["E2E_GTAG"], "utf8") : null;
const TAG = RECORDED?.replace('"vtp_enableHistoryEvents":true', '"vtp_enableHistoryEvents":false').replace(
  '"vtp_enableForm":true',
  '"vtp_enableForm":false',
);
/** The measurement id the recorded tag belongs to (its destination), else a test's own. */
const ID = (RECORDED && /"vtp_instanceDestinationId":"(G-[A-Z0-9]+)"/.exec(RECORDED)?.[1]) ?? "G-E2ETEST";
const NEEDS_TAG = "needs E2E_GTAG, a recorded copy of Google's tag";

/** One hit as Google would receive it: its event, the page's address (dl), title (dt) and referrer (dr). */
interface Hit {
  en?: string;
  dl?: string;
  dt?: string;
  dr?: string;
  [key: string]: string | undefined;
}

/** The context as a counting server's visitor has it: documents carry the id, other hosts are answered here. A page
 *  reached under another name of the server (`server`) is fetched from the server's own address (`source`, which the
 *  test runner can resolve). */
async function counting(
  context: BrowserContext,
  server: string,
  hits: Hit[],
  asked: string[],
  source: string = server,
): Promise<void> {
  const host = new URL(server).host;
  await context.route(
    (url) => url.host !== host,
    async (route) => {
      const request = route.request();
      asked.push(request.url());
      if (request.url().includes("/collect")) {
        const query = Object.fromEntries(new URL(request.url()).searchParams);
        const lines = (request.postData() ?? "").split("\n").filter(Boolean);
        if (lines.length === 0) hits.push(query);
        for (const line of lines) hits.push({ ...query, ...Object.fromEntries(new URLSearchParams(line)) });
      }
      if (request.url().startsWith("https://www.googletagmanager.com/gtag/js"))
        return route.fulfill({ status: 200, contentType: "text/javascript", body: TAG ?? "" });
      return route.fulfill({ status: 204, body: "" });
    },
  );
  await context.route(
    (url) => url.host === host && !url.pathname.startsWith("/api/") && !/\.[a-z0-9]+$/i.test(url.pathname),
    async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const address = new URL(route.request().url());
      const response = await route.fetch({ url: `${new URL(source).origin}${address.pathname}${address.search}` });
      const headers = { ...response.headers() };
      delete headers["content-security-policy"];
      const body = (await response.text()).replace(
        /analytics_id\\":(null|\\"G-[A-Z0-9]+\\")/,
        `analytics_id\\":\\"${ID}\\"`,
      );
      return route.fulfill({ response, headers, body });
    },
  );
}

const notice = (page: Page) => page.getByRole("region", { name: "Counting visits" });

/** The events the page gave its data layer (what the tag would send). */
const events = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((a) => Array.from(a as ArrayLike<unknown>))
      .filter((a) => a[0] === "event"),
  );

const flag = (page: Page) =>
  page.evaluate((id) => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], ID);

test("before an answer nothing is asked of Google, and a Decline keeps it so", async ({ context, page, baseURL }) => {
  const hits: Hit[] = [];
  const asked: string[] = [];
  await counting(context, baseURL ?? "", hits, asked);
  for (const path of ["/", convertUrl(data.symbol), "/organisms", "/privacy"]) {
    await page.goto(path);
    await expect(notice(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
  expect(asked).toEqual([]);
  await notice(page).getByRole("button", { name: "Decline" }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.goto(convertUrl(data.long));
  await page.goto("/method");
  await page.waitForLoadState("networkidle");
  expect(asked).toEqual([]);
  expect(await events(page)).toEqual([]);
});

test("after Accept then Decline, a page change sends nothing to Google, and its cookies are gone", async ({
  context,
  page,
  baseURL,
}) => {
  const hits: Hit[] = [];
  const asked: string[] = [];
  await counting(context, baseURL ?? "", hits, asked);
  await page.goto(convertUrl(data.symbol));
  await notice(page).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  // The count of a page holds its path and its name, never the identifier converted (in the tab's title).
  await expect.poll(async () => (await events(page)).length).toBeGreaterThan(0);
  expect(JSON.stringify(await events(page))).not.toContain(data.symbol.identifier);
  expect((await events(page))[0]?.[2]).toMatchObject({
    page_location: `${new URL(page.url()).origin}/convert`,
    page_title: "Convert · IDTrack",
    page_referrer: "",
  });
  await context.addCookies([
    { name: "_ga", value: "GA1.1.1.1", url: page.url() },
    { name: `_ga_${ID.slice(2)}`, value: "GS1.1.1", url: page.url() },
  ]);
  // Withdrawn: the footer asks again (and gives the notice the focus), and the visitor declines.
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await expect(notice(page).getByRole("button", { name: "Decline" })).toBeFocused();
  await notice(page).getByRole("button", { name: "Decline" }).click();
  expect(await flag(page)).toBe(true);
  const cookies = (await context.cookies()).map((c) => c.name);
  expect(cookies).not.toContain("_ga");
  expect(cookies).not.toContain(`_ga_${ID.slice(2)}`);
  const before = { requests: asked.length, events: (await events(page)).length };
  await page.getByRole("navigation", { name: "Convert" }).getByRole("link", { name: "A list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Convert a list" })).toBeVisible();
  await page.getByRole("navigation", { name: "Convert" }).getByRole("link", { name: "Names" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /What a name names/ })).toBeVisible();
  await page.waitForTimeout(500);
  expect(asked.length).toBe(before.requests);
  expect((await events(page)).length).toBe(before.events);
});

test("a consent withdrawn in one tab stops the others", async ({ context, baseURL }) => {
  const hits: Hit[] = [];
  const asked: string[] = [];
  await counting(context, baseURL ?? "", hits, asked);
  const first = await context.newPage();
  await first.goto(convertUrl(data.symbol));
  await notice(first).getByRole("button", { name: "Accept" }).click();
  const second = await context.newPage();
  await second.goto("/batch");
  await expect.poll(async () => (await events(second)).length).toBe(1);
  expect(await flag(second)).toBe(false);
  // The first tab withdraws: the second stops at once, asks again, and counts no page after.
  await first.getByRole("button", { name: "Cookie settings" }).click();
  await notice(first).getByRole("button", { name: "Decline" }).click();
  await expect.poll(() => flag(second)).toBe(true);
  await expect(notice(second)).toHaveCount(0);
  await second.getByRole("navigation", { name: "Convert" }).getByRole("link", { name: "Names" }).click();
  await expect(second.getByRole("heading", { level: 1, name: /What a name names/ })).toBeVisible();
  await second.waitForTimeout(500);
  expect((await events(second)).length).toBe(1);
});

test("every hit carries the page's path and name alone: no query, identifier or answer", async ({
  context,
  page,
  baseURL,
}) => {
  test.skip(!TAG, NEEDS_TAG);
  const hits: Hit[] = [];
  const asked: string[] = [];
  await counting(context, baseURL ?? "", hits, asked);
  const origin = new URL(baseURL ?? "").origin;
  // Arrive on an answer from another site's page with a query of its own, accept, then a second answer in the page,
  // a scroll, another page (by the footer's link), and the tab hidden (when the tag sends what it holds).
  await page.goto(convertUrl(data.symbol), { referer: "https://example.org/a/page?with=a-query" });
  await expect(page.locator("article.result")).toBeVisible();
  await notice(page).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => hits.length).toBeGreaterThan(0);
  // Over an answer the form is folded into the verdict's query: Edit unfolds it.
  await page.getByRole("button", { name: "Edit the conversion" }).click();
  await page.getByLabel("Identifier").fill(data.long.identifier);
  await page.getByLabel("Identifier").press("Enter");
  await expect(page).toHaveURL(new RegExp(data.long.identifier));
  await expect(page.locator("article.result")).toBeVisible();
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(1500);
  await page.getByRole("contentinfo").getByRole("link", { name: "API", exact: true }).click();
  await expect(page).toHaveURL(/\/developers$/);
  // A few seconds on the page, so that the tag has time of engagement to report when the tab is hidden.
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
  });
  await expect.poll(() => hits.filter((h) => h.en === "user_engagement").length).toBeGreaterThan(0);
  const words = [data.symbol.identifier, data.long.identifier, "?", "→", "example.org/a"];
  for (const hit of hits) {
    expect(hit.dl, JSON.stringify(hit)).toMatch(new RegExp(`^${origin}/(convert|developers)$`));
    expect(hit.dt, JSON.stringify(hit)).toMatch(/^(Convert|API) · IDTrack$/);
    for (const field of [hit.dl, hit.dt, hit.dr]) for (const word of words) expect(field ?? "").not.toContain(word);
    expect(hit.dr ?? "", JSON.stringify(hit)).toMatch(/^(https:\/\/example\.org\/)?$/);
  }
  const kinds = new Set(hits.map((h) => h.en));
  expect(kinds.has("page_view") && kinds.has("user_engagement"), [...kinds].join(", ")).toBe(true);
});

test("the privacy page names the id this server counts with, its cookie and the key of the choice", async ({
  context,
  page,
  baseURL,
}) => {
  const hits: Hit[] = [];
  const asked: string[] = [];
  await counting(context, baseURL ?? "", hits, asked);
  await page.goto("/privacy");
  const statistics = page.locator("section", { has: page.locator("#statistics") });
  await expect(statistics).toContainText(`the stream ${ID}`);
  await expect(statistics).toContainText(`_ga_${ID.slice(2)}`);
  await expect(statistics).not.toContainText("This server counts no visits");
  await expect(page.locator(".doc__key", { hasText: "idtrack-consent" })).toHaveCount(1);
});

test.describe("Google's cookies on the site's host alone", () => {
  // Two names of one server, one a level deeper than the other, both under a domain another site shares.
  const HOSTS = ["idtrack.example.test", "idtrack.unit.example.test"];

  for (const host of HOSTS) {
    test(`on ${host}: another site's cookies of the domain above stay, before and after counting`, async ({
      browserName,
      baseURL,
    }) => {
      test.skip(browserName !== "chromium", "names a host by Chromium's resolver rules");
      const port = new URL(baseURL ?? "").port;
      const server = `http://${host}:${port}`;
      // The names resolve to the server; a page this test fulfils has no network address of its own, so Chromium's
      // checks of requests from it into the local network are off for this browser.
      const browser = await chromium.launch({
        args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1", "--disable-features=LocalNetworkAccessChecks"],
      });
      const context = await browser.newContext({ baseURL: server });
      const hits: Hit[] = [];
      const asked: string[] = [];
      await counting(context, server, hits, asked, baseURL ?? "");
      const theirs = [
        { name: "_ga", value: "GA1.1.their-site", domain: ".example.test", path: "/" },
        { name: `_ga_${ID.slice(2)}`, value: "GS1.1.their-site", domain: ".example.test", path: "/" },
        { name: "their-session", value: "1", domain: ".example.test", path: "/" },
      ];
      await context.addCookies(theirs);
      const page = await context.newPage();
      const kept = async () =>
        (await context.cookies(server))
          .filter((c) => c.domain === ".example.test")
          .map((c) => `${c.name}=${c.value}`)
          .sort();
      const all = theirs.map((c) => `${c.name}=${c.value}`).sort();
      // A visit without an answer, then a Decline: nothing of theirs is touched.
      await page.goto("/convert");
      await expect(notice(page)).toBeVisible();
      expect(await kept()).toEqual(all);
      await notice(page).getByRole("button", { name: "Decline" }).click();
      await page.reload();
      expect(await kept()).toEqual(all);
      if (TAG) {
        // Counted: the tag's cookies are the host's alone; withdrawn: the host's go, theirs stay.
        await page.getByRole("button", { name: "Cookie settings" }).click();
        await notice(page).getByRole("button", { name: "Accept" }).click();
        await expect
          .poll(async () =>
            (await context.cookies(server))
              .filter((c) => c.domain === host)
              .map((c) => c.name)
              .sort(),
          )
          .toEqual(["_ga", `_ga_${ID.slice(2)}`]);
        expect(await kept()).toEqual(all);
        await page.getByRole("button", { name: "Cookie settings" }).click();
        expect((await context.cookies(server)).filter((c) => c.domain === host)).toEqual([]);
        expect(await kept()).toEqual(all);
      }
      await browser.close();
    });
  }
});

test.describe("the notice", () => {
  test("covers nothing of the home's hero at any size: its words, both calls to action, its caption", async ({
    context,
    page,
    baseURL,
  }) => {
    const hits: Hit[] = [];
    const asked: string[] = [];
    await counting(context, baseURL ?? "", hits, asked);
    const sizes: [number, number][] = [
      [320, 568],
      [360, 640],
      [390, 844],
      [768, 1024],
      [1024, 600],
      [1366, 768],
      [1440, 900],
    ];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(notice(page)).toBeVisible();
      await expect(page.locator(".hero2__caption")).toBeVisible();
      const found = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const bar = box(".consent");
        const parts = [".hero2__title", ".hero2__lede", ".hero2__primary", ".hero2__secondary", ".hero2__caption"];
        const under = parts.filter((selector) => {
          const b = box(selector);
          return bar && b && b.bottom > bar.top && b.top < bar.bottom && b.right > bar.left && b.left < bar.right;
        });
        return { height: bar ? bar.height : 0, under, bottom: bar?.bottom ?? 0 };
      });
      expect(found.under, `${width}x${height}`).toEqual([]);
      // Docked at the window's foot (to the pixel: a layout may place it a fraction off).
      expect(Math.abs(found.bottom - height), `${width}x${height}`).toBeLessThan(0.5);
      expect(found.height, `${width}x${height}`).toBeLessThanOrEqual(width >= 720 ? 64 : 120);
    }
  });

  test("comes right after the skip link, lets Escape leave it, and hands the focus on; no focused link under it", async ({
    context,
    page,
    baseURL,
  }, info) => {
    const hits: Hit[] = [];
    const asked: string[] = [];
    await counting(context, baseURL ?? "", hits, asked);
    await page.goto("/method");
    await expect(notice(page)).toBeVisible();
    await expectAccessible(page);
    await shot(page, info, "consent-method");
    // Tab: the skip link, then the notice's link and its two answers.
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      names.push(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim()));
    }
    expect(names).toEqual(["Skip to the content", "Details", "Decline", "Accept"]);
    // Escape leaves the notice for the page, answering nothing.
    await page.keyboard.press("Escape");
    await expect(page.locator("main#main")).toBeFocused();
    await expect(notice(page)).toBeVisible();
    // Every link of the footer, reached by the keyboard, stands clear of the notice.
    const footer = page.locator("footer.foot a, footer.foot button");
    const count = await footer.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i++) {
      const target = footer.nth(i);
      await target.focus();
      const clear = await target.evaluate((element) => {
        const bar = document.querySelector(".consent")?.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return !bar || box.bottom <= bar.top;
      });
      expect(clear, (await target.textContent()) ?? "").toBe(true);
    }
    // An answer by keyboard: the notice goes, the page keeps the focus, nothing is reserved any more.
    await notice(page).getByRole("button", { name: "Decline" }).focus();
    await page.keyboard.press("Enter");
    await expect(notice(page)).toHaveCount(0);
    await expect(page.locator("main#main")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--consent-h"))).toBe("");
  });

  test("is accessible on the home and an answer, in this project's theme and width", async ({
    context,
    page,
    baseURL,
  }, info) => {
    const hits: Hit[] = [];
    const asked: string[] = [];
    await counting(context, baseURL ?? "", hits, asked);
    for (const path of ["/", convertUrl(data.symbol)]) {
      await page.goto(path);
      await expect(notice(page)).toBeVisible();
      await expectAccessible(page);
    }
    await shot(page, info, "consent-answer");
  });
});
