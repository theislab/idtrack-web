// The visual system's rules, on every page at every width from the smallest phone to a wide screen: nothing scrolls
// sideways, no figure's text runs out of its figure or overlaps another (expectWholeAndTyped); the masthead is opaque,
// one layout on every page, and what scrolls into view stops below it; focus is an outline that forced colours keep.
import { expect, test, type Page } from "@playwright/test";
import { convertUrl, data, expectWholeAndTyped, isPhone, waitForResult } from "./helpers";

const PAGES: [string, string, (page: Page) => Promise<void>][] = [
  [
    "convert",
    `/convert?organism=${data.organism}`,
    async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
  ],
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
      await expect(page.locator(".astrip svg").first()).toBeVisible();
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
  for (const [name, url, ready] of PAGES.slice(0, 8)) {
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
type StatusRoute =
  "waiting" | "ok" | "busy" | "memory" | "saturated" | "late" | "refused" | "unreadable" | "unreachable";
const STATES: StatusRoute[] = [
  "waiting",
  "ok",
  "busy",
  "memory",
  "saturated",
  "late",
  "refused",
  "unreadable",
  "unreachable",
];

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
      workers_alive: number;
      cpu: { share_of_available: number | null; cores_used: number | null };
      memory: { pss_bytes: number | null; limit_bytes: number | null };
      requests: { searches_waiting: number; searches_running: number };
    };
    // The widest values: CPU at 100.0 % of the workers' capacity, memory of three digits of GiB.
    body.cpu.cores_used = body.workers_alive;
    body.cpu.share_of_available = 1;
    body.memory.pss_bytes = Math.round(999.99 * 2 ** 30);
    body.memory.limit_bytes = state === "memory" ? 1000 * 2 ** 30 : 4096 * 2 ** 30;
    body.requests.searches_running = state === "busy" ? body.workers_alive : 0;
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
    const word = {
      waiting: /reading/,
      ok: /Memory/,
      busy: /busy/,
      memory: /memory near its bound/,
      saturated: /saturated/,
      late: /late \d+ s/,
    }[state as string];
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
        // At rest the dot, the state's word (from 641 px) and the readings (from 1280 px); every one inside the trigger.
        const shown = [...element.querySelectorAll(".load-dot, .load-monitor__rest")].filter(
          (e) => e.getBoundingClientRect().width > 0,
        );
        const inner = element.getBoundingClientRect();
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
          fits: shown.every((e) => {
            const content = e.getBoundingClientRect();
            return (
              content.left >= inner.left + parseFloat(style.borderLeftWidth) - 0.5 &&
              content.right <= inner.right - parseFloat(style.borderRightWidth) + 0.5
            );
          }),
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
  // The home's headline is the display (DIRECTION.md, "Type"): its own test (home.spec.ts).
  for (const [name, url, ready] of PAGES.filter(([n]) => n !== "home")) {
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
        // Names over an answer: the head is the title alone, the answer the screen's subject.
        if (!answer) expect(found.head, `${name}: the page's head`).toEqual({ h1: true, lede: name !== "names" });
      }
    });
  }
});

test("the phone's masthead: one row, the page's 16 px edges, for every organism on every page, the sections in a drawer", async ({
  page,
}, info) => {
  test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
  test.setTimeout(240_000);
  const organisms = (
    (await (await page.request.get("/api/v1/organisms")).json()) as { organisms: { organism: string }[] }
  ).organisms.map((o) => o.organism);
  const wrong: string[] = [];
  for (const width of [320, 340, 360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    for (const organism of organisms)
      for (const path of ["/", "/convert", "/batch", "/names"]) {
        await page.goto(`${path}?organism=${organism}`);
        await expect(page.locator(".org-chip__button")).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const m = await page.evaluate(() => {
          const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
          const tools = [...document.querySelectorAll(".mast__tools > *")].filter(
            (e) => e.getBoundingClientRect().width > 0,
          );
          return {
            masthead: box(".mast")?.height ?? 0,
            brand: box(".mast__brand")?.left ?? 0,
            right: Math.max(...tools.map((e) => e.getBoundingClientRect().right)),
            chip: box(".org-chip__button")?.height ?? 0,
            scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        const where = `${path} ${organism} at ${width} px`;
        if (m.masthead > 57) wrong.push(`${where}: the masthead is ${m.masthead} px tall`);
        if (m.brand < 15.5) wrong.push(`${where}: the mark at ${m.brand}`);
        if (m.right > width - 15.5) wrong.push(`${where}: a tool ends at ${m.right}`);
        if (m.chip > 37) wrong.push(`${where}: the chip is ${m.chip} px tall (two lines)`);
        if (m.scroll > 0) wrong.push(`${where}: the page scrolls ${m.scroll} px sideways`);
      }
  }
  expect(wrong).toEqual([]);
  // Below 360 px the home's picture is chosen in the drawer of the sections.
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/?organism=${data.organism}`);
  await expect(page.getByRole("button", { name: /^Home page picture/ })).toBeHidden();
  await page.getByRole("button", { name: "Sections" }).click();
  const drawer = page.getByRole("dialog", { name: "IDTrack" });
  await expect(drawer.getByRole("link", { name: "Explore" })).toBeVisible();
  const pictures = drawer.getByRole("group", { name: "Home page picture" });
  await expect(pictures.getByRole("radio")).toHaveCount(3);
  await pictures.getByRole("radio", { name: "The releases as rings" }).check();
  await expect(page.locator(".hero2__field")).toHaveAttribute("data-picture", "rings");
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

test("the masthead names the organism whole in its chip from 641 px, and every section (Docs too) is in the row from 861 px", async ({
  page,
}, info) => {
  test.skip(!info.project.name.startsWith("desktop-light"), "the widths are set here");
  const organisms = (
    (await (await page.request.get("/api/v1/organisms")).json()) as { organisms: { organism: string }[] }
  ).organisms.map((o) => o.organism);
  for (const width of [641, 861, 1080, 1280, 1366, 1440, 1920]) {
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
      // Whatever the width, the chip names the whole organism to a screen reader.
      await expect(page.locator(".org-chip__button")).toHaveAccessibleName(
        new RegExp(`the organism in view \\(${organism.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}\\)`),
      );
    }
  }
});

/** Boxes of the cards shown, against the window: every one 16 px inside its edges. */
async function cardsOut(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const w = document.documentElement.clientWidth;
    const h = window.innerHeight;
    for (const card of document.querySelectorAll(".hovercard__card, dialog[open] .drawer__sheet")) {
      const r = card.getBoundingClientRect();
      if (r.width === 0) continue;
      const sheet = card.classList.contains("drawer__sheet");
      // A sheet from the bottom spans the window's width by design; a card stands 16 px inside every edge.
      const edge = sheet ? 0 : 15.5;
      if (r.left < edge || r.right > w - edge || r.top < (sheet ? 0 : edge) || r.bottom > h - (sheet ? 0 : edge))
        out.push(
          `${card.className} at [${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.right)}, ${Math.round(r.bottom)}]`,
        );
    }
    return out;
  });
}

test.describe("cards and menus", () => {
  test("the organisms open inside the window at every phone width for every organism; the focus comes back", async ({
    page,
  }, info) => {
    test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
    test.setTimeout(180_000);
    const organisms = (
      (await (await page.request.get("/api/v1/organisms")).json()) as { organisms: { organism: string }[] }
    ).organisms.map((o) => o.organism);
    for (const width of [320, 340, 360, 390, 800]) {
      await page.setViewportSize({ width, height: 740 });
      for (const organism of organisms) {
        await page.goto(`/?organism=${organism}`);
        const chip = page.locator(".org-chip__button");
        await chip.click();
        // Below 641 px a sheet from the bottom, a row of 56 px each; wider, a popover under the chip.
        const options = page.locator(".org-chip__option");
        await expect(options.first()).toBeVisible();
        expect(await cardsOut(page), `${organism} at ${width} px`).toEqual([]);
        if (width < 641) expect((await options.first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
        await page.keyboard.press("Escape");
        await expect(options).toHaveCount(0);
        await expect(chip).toBeFocused();
      }
    }
    // A choice by keyboard: the focus on the chip, the organism said on the status line.
    if (organisms.length > 1) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/convert?organism=${organisms[0] ?? ""}`);
      const chip = page.locator(".org-chip__button");
      await chip.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`organism=${organisms[1] ?? ""}`));
      await expect(chip).toBeFocused();
      await expect(page.locator('p[role="status"]')).toHaveText(/^Organism: .+\.$/);
    }
  });

  test("every hint and menu opens inside the window, by the keyboard's focus too, and gives the focus back", async ({
    page,
  }, info) => {
    test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
    test.setTimeout(180_000);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width < 641 ? 740 : 900 });
      for (const path of ["/method", `/batch?organism=${data.organism}`, convertUrl(data.long)]) {
        await page.goto(path);
        await expect(page.locator("footer.foot")).toBeVisible();
        if (path.includes("id=")) await waitForResult(page);
        const triggers = page.locator(".hovercard__trigger:visible");
        await expect(triggers.first()).toBeVisible();
        const n = Math.min(await triggers.count(), 6);
        for (let i = 0; i < n; i++) {
          const trigger = triggers.nth(i);
          await trigger.scrollIntoViewIfNeeded();
          await trigger.click();
          await expect(page.locator(".hovercard__card").first()).toBeVisible();
          expect(await cardsOut(page), `${path} #${i} at ${width} px`).toEqual([]);
          await page.keyboard.press("Escape");
          await expect(page.locator(".hovercard__card")).toHaveCount(0);
          expect(await page.evaluate(() => document.activeElement?.tagName), `${path} #${i}`).not.toBe("BODY");
        }
      }
    }
    // A field's hint opens on the keyboard's focus, not only on a press (DIRECTION.md, rule 5).
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/batch?organism=${data.organism}`);
    const hint = page.getByRole("button", { name: "Hint" }).first();
    await hint.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(hint).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "Hint" })).toBeVisible();
  });
});

test.describe("tab lists", () => {
  const NAMED = [
    `${convertUrl(data.long)}&tab=record`,
    `/organisms/${data.organism}?tab=history`,
    "/method?accuracy=tools",
    "/method?stage=rank",
  ];

  test("the chosen tab is always in view; a list wider than its room says so at its edges", async ({ page }, info) => {
    test.skip(!info.project.name.startsWith("desktop"), "the widths are set here; once per theme");
    test.setTimeout(180_000);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const path of NAMED) {
        await page.goto(path);
        await expect(page.locator('[role="tab"][aria-selected="true"]').first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(500);
        const lists = await page.evaluate(() =>
          [...document.querySelectorAll('[role="tablist"]')].map((list) => {
            const l = list.getBoundingClientRect();
            const r = list.querySelector('[aria-selected="true"]')?.getBoundingClientRect();
            const rail = list.parentElement?.className ?? "";
            const more = list.scrollWidth > list.clientWidth + 1;
            return {
              name: list.getAttribute("aria-label"),
              shown: r ? r.left >= l.left - 1 && r.right <= l.right + 1 : true,
              marked: !more || /tabs__rail--(start|end)/.test(rail),
            };
          }),
        );
        for (const list of lists) {
          expect(list.shown, `${path} at ${width}: ${list.name}: the chosen tab in view`).toBe(true);
          expect(list.marked, `${path} at ${width}: ${list.name}: more tabs said at the edge`).toBe(true);
        }
      }
    }
  });

  test("an address that names a tab brings its list under the masthead", async ({ page }, info) => {
    test.skip(!info.project.name.startsWith("desktop-light"), "the place is the same in every theme");
    for (const path of NAMED) {
      await page.goto(path);
      const chosen = page.locator('[role="tab"][aria-selected="true"]').first();
      await expect(chosen).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      const top = await page.evaluate(() => {
        const named = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find(
          (t) => t.getBoundingClientRect().top >= 0 && t.getBoundingClientRect().bottom <= innerHeight,
        );
        return named ? named.getBoundingClientRect().top : -1;
      });
      expect(top, `${path}: a chosen tab in the first screen`).toBeGreaterThanOrEqual(0);
      expect(top, `${path}: near the top`).toBeLessThan(400);
    }
  });

  test("in forced colours the chosen tab keeps its bar", async ({ page }, info) => {
    test.skip(!info.project.name.startsWith("desktop-light"), "forced colours are their own theme");
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`/organisms/${data.organism}?tab=databases`);
    const bar = page.locator(".tabs__bar").first();
    await expect(bar).toBeVisible();
    const fill = await bar.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");
    const option = page.locator('.segmented__option[aria-checked="true"]').first();
    if (await option.count()) expect(await option.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
  });
});

test.describe("the organism in view", () => {
  test("is carried by every link of the shell and kept for an address that names none", async ({ page }) => {
    const organisms = (
      (await (await page.request.get("/api/v1/organisms")).json()) as { organisms: { organism: string }[] }
    ).organisms.map((o) => o.organism);
    const other = organisms[organisms.length - 1] ?? data.organism;
    await page.goto(`/convert?organism=${other}`);
    for (const href of await page
      .locator(".mast__nav .mast__link:not(.mast__link--out)")
      .evaluateAll((links) => links.map((l) => l.getAttribute("href") ?? "")))
      expect(href, href).toContain(`organism=${other}`);
    await expect(page.locator(".foot__links a", { hasText: "API" })).toHaveAttribute(
      "href",
      new RegExp(`organism=${other}`),
    );
    // An address that names none shows the one last in view.
    await page.goto("/batch");
    await expect(page.locator(".org-chip__button")).toHaveAccessibleName(new RegExp(other.replace(/_/g, " "), "i"));
    // A graph's own page puts its organism in view; the chip is not on a page of every organism, nor on no page.
    await page.goto(`/organisms/${data.organism}`);
    await expect(page.locator(".mast__brand")).toHaveAttribute("href", new RegExp(`organism=${data.organism}`));
    await expect(page.locator(".org-chip__button")).toHaveCount(0);
    await page.goto("/no/such/page");
    await expect(page.getByRole("heading", { level: 1, name: "No such page" })).toBeVisible();
    await expect(page.locator(".org-chip__button")).toHaveCount(0);
  });
});

test.describe("the masthead's tools", () => {
  test("the palette's code is there before the first press; a page's name ranks over what is typed", async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "a keyboard's shortcut");
    await page.goto(`/convert?organism=${data.organism}`);
    await page.waitForLoadState("networkidle");
    // Fetched once the page is idle: the press asks for no code.
    await expect
      .poll(() =>
        page.evaluate(() => performance.getEntriesByType("resource").some((e) => /CommandPalette/.test(e.name))),
      )
      .toBe(true);
    const asked: string[] = [];
    page.on("request", (request) => {
      if (/\.js$/.test(request.url())) asked.push(request.url());
    });
    await page.keyboard.press("ControlOrMeta+k");
    const field = page.getByRole("combobox", { name: /^Search/ });
    await expect(field).toBeFocused();
    expect(asked.filter((u) => /CommandPalette/.test(u))).toEqual([]);
    await field.fill("api");
    await expect(page.locator(".palette__option").first()).toHaveText(/^The API/);
    await field.fill("dark");
    await expect(page.locator(".palette__option").first()).toHaveText(/^Switch to the dark theme/);
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator('p[role="status"]')).toHaveText("Theme: dark.");
    await expect(page.locator("dialog.palette")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  });

  test("the theme button says the theme now in force; the readings stand at rest on a wide screen", async ({
    page,
  }, info) => {
    test.skip(!info.project.name.startsWith("desktop-light"), "the widths are set here");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/convert?organism=${data.organism}`);
    await page.locator(".theme-button").click();
    await expect(page.locator('p[role="status"]')).toHaveText("Theme: dark.");
    const readings = page.locator(".load-monitor__readings");
    await expect(readings).toBeVisible();
    await expect(readings).toContainText(/CPU\s*\d+\.\d %/);
    await expect(readings).toContainText(/Memory\s*\d+\.\d\d GiB/);
    // Narrower, the readings unfold on pointing, never empty, in a pill of the chip's height.
    for (const width of [1100, 900, 700]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(readings).toBeHidden();
      await page.locator(".load-monitor__trigger").hover();
      const pill = page.locator(".load-monitor__shown");
      await expect(pill).toContainText(/CPU/);
      await expect(pill).toContainText(/Memory/);
      expect(Math.round((await pill.boundingBox())?.height ?? 0), `${width}`).toBe(36);
      await page.mouse.move(0, 400);
    }
  });

  test("a page prints as dark ink on white without the site's controls, whatever the theme", async ({ page }, info) => {
    test.skip(!info.project.name.startsWith("desktop-dark"), "the dark theme is the case to print");
    await page.emulateMedia({ media: "print" });
    for (const path of ["/legal", convertUrl(data.long)]) {
      await page.goto(path);
      await expect(page.locator("footer.foot")).toBeAttached();
      if (path.includes("id=")) await waitForResult(page);
      const m = await page.evaluate(() => ({
        mast: getComputedStyle(document.querySelector(".mast") as Element).display,
        ink: getComputedStyle(document.body).color,
        forms: [...document.querySelectorAll("form, .sections, .tabs__rail")].filter(
          (e) => getComputedStyle(e).display !== "none",
        ).length,
      }));
      expect(m.mast, path).toBe("none");
      expect(m.ink, path).toBe("rgb(0, 0, 0)");
      expect(m.forms, path).toBe(0);
    }
  });
});
