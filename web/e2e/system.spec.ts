// The visual system's rules, on every page at every width from the smallest phone to a wide screen: nothing scrolls
// sideways, no figure's text runs out of its figure or overlaps another (expectWholeAndTyped); the masthead is opaque,
// one layout on every page, and what scrolls into view stops below it; focus is an outline that forced colours keep.
import { expect, test, type Page } from "@playwright/test";
import { convertUrl, data, expectWholeAndTyped, waitForResult } from "./helpers";

const PAGES: [string, string, (page: Page) => Promise<void>][] = [
  [
    "home",
    `/?organism=${data.organism}`,
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
      await expect(page.locator(".arows svg")).toBeVisible();
    },
  ],
  [
    "organism",
    `/organisms/${data.organism}`,
    async (page) => {
      await expect(page.locator(".dbm svg")).toBeVisible();
    },
  ],
  [
    "method",
    "/method",
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

test("the masthead: opaque, the same places on every page, what scrolls into view stops below it", async ({
  page,
}, info) => {
  test.skip(info.project.name.startsWith("phone"), "the phone's masthead scrolls away with the page");
  const places: Record<string, number> = {};
  for (const [name, url, ready] of PAGES.slice(0, 7)) {
    await page.goto(url);
    await ready(page);
    const masthead = page.locator(".masthead");
    const style = await masthead.evaluate((e) => {
      const s = getComputedStyle(e);
      const html = getComputedStyle(document.documentElement);
      return {
        background: s.backgroundColor,
        position: s.position,
        height: e.getBoundingClientRect().height,
        padding: parseFloat(html.scrollPaddingTop),
      };
    });
    // Opaque: no alpha below 1 in the computed background.
    expect(style.background, name).not.toMatch(/\/\s*0?\.\d|rgba\(.*,\s*0?\.\d+\)/);
    expect(style.position).toBe("sticky");
    expect(style.padding).toBeGreaterThanOrEqual(style.height);
    const theme = await page.locator(".theme-switch").boundingBox();
    const monitor = await page.locator(".load-monitor").boundingBox();
    places[name] = Math.round((theme?.x ?? 0) * 10 + (monitor?.x ?? 0));
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
    await page.goto(`/?organism=${data.organism}`);
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
        const shown = element.querySelector(".load-monitor__shown");
        const inner = element.getBoundingClientRect();
        const content = shown?.getBoundingClientRect();
        const style = getComputedStyle(element);
        // Where the navigation shares the masthead's row with the tools, its last link ends before they begin.
        const links = [...document.querySelectorAll(".nav__link")];
        const nav = links[links.length - 1]?.getBoundingClientRect();
        const tools = document.querySelector(".masthead__tools")?.getBoundingClientRect();
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
  await page.goto(`/?organism=${data.organism}`);
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
  // The checked theme option shows its ring too.
  await page.locator(".theme-switch__option[aria-checked='true']").focus();
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
          // The home before a conversion is the hero: its own composition of the same three parts.
          const head = document.querySelector("main .page-head") ?? document.querySelector("main .hero__text");
          return {
            h1: h1 ? { face: face(h1), size: size(h1) } : null,
            sections: sections.map((e) => ({ text: e.textContent.slice(0, 30), face: face(e), size: size(e) })),
            weights: [...weights].sort(),
            head: head
              ? {
                  eyebrow: head.querySelector(":scope > .eyebrow, :scope > .hero__eyebrow") !== null,
                  h1: head.querySelector(":scope > h1") !== null,
                  lede: head.querySelector(":scope > .lede, :scope > .hero__lede") !== null,
                }
              : null,
          };
        });
        expect(found.h1?.face, `${name} ${width}`).toBe("Source Serif 4 Variable");
        expect(found.h1?.size, `${name} ${width}`).toBe(width >= 720 ? 40 : 28);
        for (const s of found.sections) {
          expect(s.face, `${name} ${width}: ${s.text}`).toBe("Source Serif 4 Variable");
          expect(s.size, `${name} ${width}: ${s.text}`).toBe(width >= 720 ? 28 : 21);
        }
        for (const w of found.weights) expect(["400", "520", "640"], `${name} ${width}: weight ${w}`).toContain(w);
        expect(found.head, `${name}: the page's head`).toEqual({ eyebrow: true, h1: true, lede: true });
      }
    });
  }
});

test("the phone's masthead: two rows, the page's 16 px edges, controls of a finger's size", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto(`/?organism=${data.organism}`);
    await expect(page.locator(".organism-picker select")).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const links = [...document.querySelectorAll<HTMLElement>(".nav__link")];
      const first = links[0];
      const firstText = first
        ? first.getBoundingClientRect().left + parseFloat(getComputedStyle(first).paddingLeft)
        : 0;
      return {
        masthead: box(".masthead")?.height ?? 0,
        firstText,
        brand: box(".brand")?.left ?? 0,
        load: box(".load-monitor__trigger")?.height ?? 0,
        theme: box(".theme-menu__button")?.height ?? 0,
        organism: box(".organism-picker select")?.height ?? 0,
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(m.masthead, `${width}`).toBeLessThanOrEqual(102);
    expect(m.firstText, `${width}: the first link's text on the 16 px edge`).toBeGreaterThanOrEqual(15.5);
    expect(m.firstText, `${width}`).toBeLessThanOrEqual(17);
    expect(m.brand, `${width}`).toBeGreaterThanOrEqual(15.5);
    for (const control of ["load", "theme", "organism"] as const)
      expect(m[control], `${width}: ${control}`).toBeGreaterThanOrEqual(44);
    expect(m.scroll, `${width}`).toBeLessThanOrEqual(0);
  }
  // The theme's menu: the three choices by keyboard, Escape back to its button.
  const before = await page.locator("html").getAttribute("data-theme");
  await page.locator(".theme-menu__button").click();
  const menu = page.locator(".theme-menu");
  await expect(menu.getByRole("radio", { checked: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", before ?? "");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".theme-menu__button")).toBeFocused();
  await page.locator(".theme-menu__button").click();
  await menu.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
