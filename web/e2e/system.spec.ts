// The visual system's rules, on every page at every width from the smallest phone to a wide screen: nothing scrolls
// sideways, no figure's text runs out of its figure or overlaps another (expectWholeAndTyped); the masthead is opaque,
// one layout on every page, and what scrolls into view stops below it; focus is an outline that forced colours keep.
import { expect, test, type Page } from "@playwright/test";
import { convertUrl, data, expectWholeAndTyped, waitForResult } from "./helpers";

const PAGES: [string, string, (page: Page) => Promise<void>][] = [
  [
    "home",
    `/convert?organism=${data.organism}`,
    async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
  ],
  ["answer", convertUrl(data.long), waitForResult],
  ["backward", convertUrl(data.backward), waitForResult],
  ["batch", `/batch?organism=${data.organism}`, () => Promise.resolve()],
  [
    "names",
    `/names?organism=${data.organism}&name=${data.name}`,
    async (page) => {
      await expect(page.locator("main table").first()).toBeVisible();
    },
  ],
  [
    "explore",
    "/organisms",
    async (page) => {
      await expect(page.locator(".journeys-story__figure")).toBeVisible();
      await expect(page.locator(".journeys-story__caption")).not.toContainText("drawn when they arrive");
    },
  ],
  [
    "explore, the graphs",
    "/organisms?tab=graphs",
    async (page) => {
      await expect(page.locator(".arows svg")).toBeVisible();
    },
  ],
  [
    "organism",
    `/organisms/${data.organism}`,
    async (page) => {
      await expect(page.locator(".arows svg")).toBeVisible();
    },
  ],
  [
    "organism, databases by release",
    `/organisms/${data.organism}?tab=databases`,
    async (page) => {
      await expect(page.locator(".dbm svg")).toBeVisible();
    },
  ],
  [
    "method",
    "/method",
    async (page) => {
      await expect(page.locator(".method-panel").first()).toBeVisible();
    },
  ],
  [
    "method, each family whole",
    "/method?accuracy=family",
    async (page) => {
      await expect(page.locator(".bench").first()).toBeVisible();
    },
  ],
  [
    "developers",
    "/developers",
    async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
  ],
  ...(
    [
      ["legal notice", "/legal"],
      ["privacy (German)", "/privacy/de"],
      ["licences", "/licences"],
      ["accessibility", "/accessibility"],
    ] as const
  ).map(([name, url]): [string, string, (page: Page) => Promise<void>] => [
    name,
    url,
    async (page) => {
      await expect(page.locator(".doc__section").first()).toBeVisible();
    },
  ]),
  [
    "not found",
    "/no/such/page",
    async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "No such page" })).toBeVisible();
    },
  ],
];

const WIDTHS = [320, 768, 1024, 2560];

test.describe("every page at every width", () => {
  for (const [name, url, ready] of PAGES) {
    test(`${name}: whole, legible figures, no sideways scroll`, async ({ page }, info) => {
      test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 400 ? 640 : 900 });
        await page.goto(url);
        await ready(page);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.waitForTimeout(700);
        await expectWholeAndTyped(page, name !== "developers");
      }
    });
  }
});

test("the masthead: glass, the same places on every page, what scrolls into view stops below it", async ({
  page,
}, info) => {
  test.skip(info.project.name.startsWith("phone"), "the phone's masthead scrolls away with the page");
  const places: Record<string, number> = {};
  for (const [name, url, ready] of PAGES.slice(0, 7)) {
    await page.goto(url);
    await ready(page);
    const masthead = page.locator(".mast");
    const style = await masthead.evaluate((e) => {
      const s = getComputedStyle(e);
      const html = getComputedStyle(document.documentElement);
      return {
        filter: s.backdropFilter,
        position: s.position,
        height: e.getBoundingClientRect().height,
        padding: parseFloat(html.scrollPaddingTop),
      };
    });
    // Glass: the page shows through blurred, never sharp.
    expect(style.filter, name).toContain("blur");
    expect(style.position).toBe("sticky");
    expect(style.padding).toBeGreaterThanOrEqual(style.height);
    const theme = await page.locator(".theme-button").boundingBox();
    const palette = await page.locator(".mast__palette").boundingBox();
    places[name] = Math.round((theme?.x ?? 0) * 10 + (palette?.y ?? 0));
  }
  expect(new Set(Object.values(places)).size, JSON.stringify(places)).toBe(1);
});

/** Answers of /status for each state the load monitor shows, each with the widest values of its kind (a share of
 *  100.0 %, memory of three digits of GiB), so that the widest content of every state is measured. */
type StatusRoute = "waiting" | "ok" | "busy" | "saturated" | "late" | "refused" | "unreadable" | "unreachable";
const STATES: StatusRoute[] = ["waiting", "ok", "busy", "saturated", "late", "refused", "unreadable", "unreachable"];

async function routeStatus(page: Page, state: StatusRoute): Promise<void> {
  let answered = 0;
  await page.route("**/api/v1/status", async (route) => {
    answered += 1;
    if (state === "waiting" || (state === "late" && answered > 1)) {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      return;
    }
    if (state === "unreachable") return route.abort();
    if (state === "unreadable" && answered > 1)
      return route.fulfill({ status: 200, contentType: "application/json", body: "{" });
    if (state === "refused" && answered > 1)
      return route.fulfill({
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60", "x-request-id": "t" },
        body: JSON.stringify({
          error: {
            code: "rate_limited",
            message: "Too many.",
            argument: null,
            allowed: null,
            details: null,
            request_id: "t",
          },
        }),
      });
    const response = await route.fetch();
    const body = (await response.json()) as {
      cpu: { share_of_available: number | null };
      memory: { pss_bytes: number | null; limit_bytes: number | null };
      requests: { searches_waiting: number };
    };
    body.cpu.share_of_available = state === "ok" ? 0.699 : 1;
    body.memory.pss_bytes = Math.round(999.99 * 2 ** 30);
    body.memory.limit_bytes = 4096 * 2 ** 30;
    if (state === "saturated") body.requests.searches_waiting = 3;
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
}

test("the load monitor keeps one width in every state, so nothing beside it moves", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("desktop-light"), "the widths are set here; the theme changes no width");
  test.setTimeout(240_000);
  const widths = [
    2560, 1440, 1281, 1280, 1241, 1240, 1200, 1181, 1180, 1141, 1140, 1100, 1081, 1080, 1000, 861, 860, 800, 641, 640,
    390, 339, 320,
  ];
  const seen: Record<number, Record<string, number>> = {};
  const overflowing: string[] = [];
  const crowding: string[] = [];
  for (const state of STATES) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await routeStatus(page, state);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/convert?organism=${data.organism}`);
    const trigger = page.locator(".load-monitor__trigger");
    const word = { waiting: /reading/, ok: /MEM/, busy: /busy/, saturated: /saturated/, late: /late \d+ s/ }[
      state as string
    ];
    // The second ask, which the late and refused states need, is sent 15 s after the first.
    if (state === "refused" || state === "unreadable")
      await page.locator(`.load-monitor__trigger--${state}`).waitFor({ timeout: 30_000 });
    else await expect(trigger).toContainText(word ?? state, { timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const box = await trigger.evaluate((element) => {
        // At rest the trigger is its dot; the readings unfold over the masthead, outside it, on pointing or focus.
        const shown = element.querySelector(".load-monitor__dot, .load-dot");
        const inner = element.getBoundingClientRect();
        const content = shown?.getBoundingClientRect();
        const style = getComputedStyle(element);
        // Where the navigation shares the masthead's row with the tools, its last link ends before they begin.
        const links = [...document.querySelectorAll(".mast__nav .mast__link")];
        const nav = links[links.length - 1]?.getBoundingClientRect();
        const tools = document.querySelector(".mast__tools")?.getBoundingClientRect();
        const sameRow = nav && tools ? nav.top < tools.bottom && tools.top < nav.bottom : false;
        return {
          width: inner.width,
          clear: !sameRow || !nav || !tools || nav.right <= tools.left + 0.5,
          // The content stays inside the trigger's padding box.
          fits:
            !content ||
            (content.left >= inner.left + parseFloat(style.borderLeftWidth) - 0.5 &&
              content.right <= inner.right - parseFloat(style.borderRightWidth) + 0.5),
        };
      });
      (seen[width] ??= {})[state] = Math.round(box.width * 10) / 10;
      if (!box.fits) overflowing.push(`${state} at ${width} px`);
      if (!box.clear) crowding.push(`${state} at ${width} px`);
    }
  }
  expect.soft(overflowing, "the content fits the trigger").toEqual([]);
  expect.soft(crowding, "the navigation ends before the tools begin").toEqual([]);
  for (const width of widths)
    expect.soft(new Set(Object.values(seen[width] ?? {})).size, `${width} px: ${JSON.stringify(seen[width])}`).toBe(1);
});

test("focus is an outline, kept as the highlight colour in forced colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(`/convert?organism=${data.organism}`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return null;
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring?.style).not.toBe("none");
  expect(ring?.width ?? 0).toBeGreaterThanOrEqual(2);
  // The theme button shows its ring too.
  await page.locator(".theme-button").focus();
  const theme = await page.evaluate(() => getComputedStyle(document.activeElement as HTMLElement).outlineStyle);
  expect(theme).not.toBe("none");
});

test.describe("one heading system on every page", () => {
  for (const [name, url, ready] of PAGES) {
    test(`${name}: the title, the sections' serif tier, three weights, one head`, async ({ page }, info) => {
      test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url);
        await ready(page);
        await expect(page.locator("main h1")).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const found = await page.evaluate(() => {
          const face = (e: Element) => getComputedStyle(e).fontFamily.split(",")[0]?.replace(/"/g, "") ?? "";
          const size = (e: Element) => parseFloat(getComputedStyle(e).fontSize);
          const h1 = document.querySelector("main h1");
          // A section of the page: every h2 of the content but a statement's title and the first request's card.
          const sections = [...document.querySelectorAll("main h2")].filter(
            (e) => !e.closest(".notice") && !e.classList.contains("api-first__title"),
          );
          const weights = new Set<string>();
          for (const e of document.querySelectorAll("body *")) {
            if (![...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) continue;
            const s = getComputedStyle(e);
            if (s.display === "none" || s.visibility === "hidden") continue;
            weights.add(s.fontWeight);
          }
          // The Convert page before a conversion is its own composition: the title and one sentence.
          const head = document.querySelector("main .page-head") ?? document.querySelector("main .convert-landing");
          return {
            h1: h1 ? { face: face(h1), size: size(h1), text: h1.textContent } : null,
            sections: sections.map((e) => ({ text: e.textContent.slice(0, 30), face: face(e), size: size(e) })),
            weights: [...weights].sort(),
            head: head
              ? {
                  h1: head.querySelector(":scope > h1") !== null,
                  lede: head.querySelector(":scope > .lede, :scope > .convert-landing__lede") !== null,
                }
              : null,
          };
        });
        // Over an answer the page's title is its name for a screen reader (the section's tabs say where the page is,
        // and the answer is the subject), with no head of its own.
        const answer = name === "answer" || name === "backward";
        if (answer) {
          expect(found.h1?.text, `${name} ${width}`).toBe("Convert");
        } else {
          expect(found.h1?.face, `${name} ${width}`).toBe("Source Serif 4 Variable");
          expect(found.h1?.size, `${name} ${width}`).toBe(width >= 720 ? 40 : 28);
        }
        for (const s of found.sections) {
          expect(s.face, `${name} ${width}: ${s.text}`).toBe("Source Serif 4 Variable");
          expect(s.size, `${name} ${width}: ${s.text}`).toBe(width >= 720 ? 28 : 21);
        }
        for (const w of found.weights) expect(["400", "520", "640"], `${name} ${width}: weight ${w}`).toContain(w);
        if (!answer) expect(found.head, `${name}: the page's head`).toEqual({ h1: true, lede: true });
      }
    });
  }
});

test("the phone's masthead: one row, the page's 16 px edges, the sections in a drawer", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto(`/convert?organism=${data.organism}`);
    await expect(page.locator(".org-chip__button")).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      return {
        masthead: box(".mast")?.height ?? 0,
        brand: box(".mast__brand")?.left ?? 0,
        right: Math.max(
          ...[...document.querySelectorAll(".mast__tools > *")].map((e) => e.getBoundingClientRect().right),
        ),
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(m.masthead, `${width}`).toBeLessThanOrEqual(57);
    expect(m.brand, `${width}`).toBeGreaterThanOrEqual(15.5);
    expect(m.right, `${width}: every tool inside the window`).toBeLessThanOrEqual(width - 15.5);
    expect(m.scroll, `${width}`).toBeLessThanOrEqual(0);
  }
  // The sections: a drawer, its links, Escape back to the menu button.
  await page.getByRole("button", { name: "Sections" }).click();
  const drawer = page.getByRole("dialog", { name: "IDTrack" });
  await expect(drawer.getByRole("link", { name: "Explore" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "Sections" })).toBeFocused();
});

/** The pages whose head the build draws into the page the server sends (src/prerender.tsx). */
const FRAMED = ["/batch", "/names", "/organisms", "/method", "/developers"];

test("every page is drawn before its code runs: the masthead and the page's head, in the places the page keeps", async ({
  browser,
}, info) => {
  test.skip(!info.project.name.startsWith("desktop-light"), "the frame is the same in every theme");
  for (const width of [1440, 390]) {
    const off = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false });
    const on = await browser.newContext({ viewport: { width, height: 900 } });
    for (const path of FRAMED) {
      const raw = await off.newPage();
      await raw.goto(`${path}?organism=${data.organism}`);
      await expect(raw.locator(".mast .mast__nav .mast__link")).toHaveCount(5);
      await expect(raw.getByRole("heading", { level: 1 })).toBeVisible();
      const place = (p: Page) =>
        p.locator(".page-head .lede").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return [Math.round(r.left), Math.round(r.top), Math.round(r.width), e.textContent];
        });
      const before = await place(raw);
      const page = await on.newPage();
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") problems.push(m.text());
      });
      await page.goto(`${path}?organism=${data.organism}`);
      await expect(page.locator("footer.foot")).toBeVisible(); // the app drew the page: the frame is replaced
      expect(await place(page), `${path} at ${width} px: the head the code draws is the frame's`).toEqual(before);
      expect(problems, `${path}: nothing refused (an inline style or script) or preloaded in vain`).toEqual([]);
      await raw.close();
      await page.close();
    }
    await off.close();
    await on.close();
  }
});

test("every page's lede starts at one x, under its title", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("desktop-light"), "the widths are set here");
  await page.setViewportSize({ width: 1440, height: 900 });
  const starts = new Set<number>();
  for (const path of FRAMED) {
    await page.goto(path.includes("?") ? path : `${path}?organism=${data.organism}`);
    await expect(page.locator("footer.foot")).toBeVisible();
    const lede = page.locator(".page-head .lede");
    await expect(lede).toBeVisible();
    starts.add(Math.round(await lede.evaluate((e) => e.getBoundingClientRect().left)));
  }
  expect([...starts]).toHaveLength(1);
});

test("the masthead names the organism whole in its chip, and every section (Docs too) is in the row from 861 px", async ({
  page,
}, info) => {
  test.skip(!info.project.name.startsWith("desktop-light"), "the widths are set here");
  const organisms = (
    (await (await page.request.get("/api/v1/organisms")).json()) as { organisms: { organism: string }[] }
  ).organisms.map((o) => o.organism);
  for (const width of [360, 390, 640, 861, 1080, 1280, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    for (const organism of organisms) {
      await page.goto(`/batch?organism=${organism}`);
      await expect(page.locator(".org-chip__button")).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const m = await page.evaluate(() => {
        const chip = document.querySelector<HTMLElement>(".org-chip__button");
        const name = document.querySelector<HTMLElement>(".org-chip__name");
        const nav = document.querySelector<HTMLElement>(".mast__nav");
        const docs = [...document.querySelectorAll(".mast__nav .mast__link")].pop()?.getBoundingClientRect();
        const row = nav?.getBoundingClientRect();
        return {
          fits: Boolean(chip && name && name.scrollWidth <= name.clientWidth + 0.5),
          name: name?.textContent ?? "",
          nav: nav ? getComputedStyle(nav).display !== "none" : false,
          docs: Boolean(docs && row && docs.left >= row.left - 0.5 && docs.right <= row.right + 0.5),
        };
      });
      expect(m.fits, `${organism} at ${width} px: the name stands whole in its chip`).toBe(true);
      expect(m.name.length, `${organism} at ${width} px`).toBeGreaterThan(2);
      if (width >= 861) {
        expect(m.nav, `${width} px: the sections in the row`).toBe(true);
        expect(m.docs, `${organism} at ${width} px: Docs in the row`).toBe(true);
      } else expect(m.nav, `${width} px: the sections in the menu`).toBe(false);
    }
  }
});
