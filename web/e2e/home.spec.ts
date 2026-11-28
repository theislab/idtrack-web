// The home: one picture of the graph in view, a headline, a sentence and two calls to action, nothing else to press;
// its picture menu. The Convert page before a conversion: its title, the form with examples from the showcase; the
// figure of the graph's journeys from the server's showcase (one answer, no conversion asked by the page), with its
// legend, its caption and its text alternative.
// At every common window the figure names every row it draws (fewer rows where the room is short, never the rows
// without their names) and stays inside its frame; every text of the figure stands inside it and over no mark, on the
// home of every organism the server holds. An example converts a journey of the showcase that travels; a conversion
// turns the page into the answer under the form in one row, the answer on the first screen; the strip above an answer
// that is a case steps through the cases.
import { expect, test, type Page } from "@playwright/test";
import type { ConversionResult, GraphDescription, ShowcaseResponse } from "../src/api/types";
import { isCaseKind } from "../src/lib/home/caseKinds";
import { caseHref, caseQueryOf } from "../src/lib/home/links";
import { answerText } from "../src/lib/home/journeyModel";
import { journeyList, journeySets } from "../src/lib/home/journeys";
import { convolutedAnswers } from "../src/lib/hero/constellationModel";
import { examplesOf } from "../src/lib/home/examples";
import { convertUrl, data, expectAccessible, isPhone, shot, waitForResult } from "./helpers";

async function organisms(page: Page): Promise<GraphDescription[]> {
  return ((await (await page.request.get("/api/v1/organisms")).json()) as { organisms: GraphDescription[] }).organisms;
}

async function showcaseOf(page: Page, organism: string): Promise<ShowcaseResponse> {
  return (await (await page.request.get(`/api/v1/organisms/${organism}/showcase`)).json()) as ShowcaseResponse;
}

/** The api requests a page makes that convert (the home converts nothing itself). */
function conversionsAsked(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/v1\/organisms\/[^/]+\/convert(\?|$)/.test(r.url())) asked.push(r.url());
  });
  return asked;
}

/** Wait until the hero's figure is drawn (or says why it is not). */
async function figureDrawn(page: Page): Promise<void> {
  await expect(page.locator(".hero__caption")).not.toContainText("drawn when they arrive");
}

/** Every text of the hero's figure lies inside its drawing and over none of its marks (the figure grammar's rule). */
async function textsWholeAndClear(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const svg of document.querySelectorAll<SVGSVGElement>(".convert-journeys .journeys__svg")) {
      const frame = svg.getBoundingClientRect();
      const texts = [...svg.querySelectorAll<SVGTextElement>("text")].filter(
        (t) => t.getBoundingClientRect().width > 0,
      );
      const marks = [...svg.querySelectorAll<SVGGraphicsElement>(".fig-glyph, .jr-end")].map((m) =>
        m.getBoundingClientRect(),
      );
      for (const t of texts) {
        const box = t.getBoundingClientRect();
        if (
          box.left < frame.left - 1 ||
          box.right > frame.right + 1 ||
          box.top < frame.top - 1 ||
          box.bottom > frame.bottom + 1
        )
          found.push(`a text runs out of the figure: ${t.textContent}`);
        for (const m of marks) {
          const x = Math.min(box.right, m.right) - Math.max(box.left, m.left);
          const y = Math.min(box.bottom - 2, m.bottom) - Math.max(box.top + 2, m.top);
          if (x > 1 && y > 1) {
            found.push(`a text lies over a mark: ${t.textContent}`);
            break;
          }
        }
      }
    }
    return found;
  });
}

test("the home is one picture: a headline, a sentence, two calls to action, nothing else to press", async ({
  page,
}, info) => {
  const asked = conversionsAsked(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Every gene id\s*has a history\.$/);
  const hero = page.locator(".hero2");
  // Exactly two controls in the hero: Convert, and the documentation.
  const controls = hero.locator("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
  await expect(controls).toHaveCount(2);
  await expect(hero.getByRole("link", { name: "Convert an identifier" })).toHaveAttribute(
    "href",
    new RegExp(`^/convert\\?organism=`),
  );
  await expect(hero.getByRole("link", { name: /Read the documentation/ })).toBeVisible();
  // The picture is hidden from assistive technology; its caption names what is drawn and the endpoint it comes from.
  await expect(hero.locator(".hero2__field")).toHaveAttribute("aria-hidden", "true");
  await expect(hero.locator(".hero2__caption")).toContainText(`GET /api/v1/organisms/${data.organism}/lineages`, {
    timeout: 30_000,
  });
  const fit = await page.evaluate(() => {
    const box = document.querySelector(".hero2")?.getBoundingClientRect();
    return {
      bottom: (box?.bottom ?? 0) + window.scrollY,
      viewport: window.innerHeight,
      wide: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  expect(fit.bottom).toBeLessThanOrEqual(fit.viewport + 1);
  expect(fit.wide).toBe(false);
  await expectAccessible(page);
  await shot(page, info, "01-home");
  expect(asked, "the home converts nothing").toEqual([]);
});

test("the home's picture menu offers three pictures and keeps the choice", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Choose the home page picture" });
  await button.click();
  const menu = page.getByRole("menu", { name: "Home page picture" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveText("Lineages through the releases");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await expect(page.locator(".hero2__field")).toHaveAttribute("data-picture", "rings");
  await expect(page.locator(".hero2__caption")).toContainText(`GET /api/v1/organisms/${data.organism}/history`, {
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.locator(".hero2__field")).toHaveAttribute("data-picture", "rings");
  await page.goto("/method");
  await expect(page.getByRole("button", { name: "Choose the home page picture" })).toHaveCount(0);
});

test("the convoluted journeys: the showcase's answers about the axis of time, clear of every word", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("idtrack-hero", "constellation");
  });
  await page.goto(`/?organism=${data.organism}`);
  const field = page.locator(".hero2__field");
  await expect(field).toHaveAttribute("data-picture", "constellation");
  await expect(page.locator(".hero2__caption")).toContainText(`GET /api/v1/organisms/${data.organism}/showcase`, {
    timeout: 30_000,
  });
  await expect(field).toHaveAttribute("data-mode", /^(webgl2|canvas2d)$/);
  // The text alternative names every journey drawn: the showcase's answers whose paths pass the most ids and steps.
  const answers = convolutedAnswers(await showcaseOf(page, data.organism), 18);
  const words = (await page.locator(".hero2__caption .visually-hidden").textContent()) ?? "";
  for (const r of answers) expect(words).toContain(r.query_id);
  // The picture's own words (the releases at the axis's ends, the id of the journey that faces the viewer) stand inside
  // the window and clear of the headline, the sentence and the two actions.
  await page.waitForTimeout(500);
  const clashes = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".hero2__words > *")].map((w) => {
      const range = document.createRange();
      range.selectNodeContents(w);
      return range.getBoundingClientRect();
    });
    const labels = [...document.querySelectorAll<HTMLElement>(".hero2__star-id, .hero2__axis-end")].filter(
      (l) => getComputedStyle(l).visibility === "visible" && Number(getComputedStyle(l).opacity) > 0,
    );
    const out: string[] = [];
    for (const l of labels) {
      const r = l.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth) out.push(`${l.textContent} past the window`);
      for (const b of boxes)
        if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top)
          out.push(`${l.textContent} over the words`);
    }
    return out;
  });
  expect(clashes).toEqual([]);
  await expectAccessible(page);
  await shot(page, info, "01-home-constellation");
});

test("the Convert page: its title, the form, then the journeys of the graph", async ({ page }, info) => {
  const asked = conversionsAsked(page);
  await page.goto(`/convert?organism=${data.organism}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert an identifier");
  await expect(page.getByRole("form", { name: "Conversion" })).toBeVisible();
  await figureDrawn(page);
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(wide).toBe(false);
  // The figure: its caption names the endpoint, its text alternative says every journey.
  const showcase = await showcaseOf(page, data.organism);
  const list = journeyList(journeySets(showcase));
  if (list.length) {
    await expect(page.locator(".hero__caption")).toContainText(`GET /api/v1/organisms/${data.organism}/showcase`);
    const words = page.getByRole("list", { name: "The journeys in words" }).locator("li");
    await expect(words).toHaveCount(list.length);
    for (const [j, journey] of list.entries())
      if (journey.model) await expect(words.nth(j)).toContainText(answerText(journey.model).replace(/ \+\d+$/, ""));
  }
  expect(await textsWholeAndClear(page)).toEqual([]);
  await expectAccessible(page);
  await shot(page, info, "02-convert");
  expect(asked, "the Convert page converts nothing by itself").toEqual([]);
});

test("the journeys: every row the showcase's answer, isolated on focus, opened by Enter", async ({ page }, info) => {
  const showcase = await showcaseOf(page, data.organism);
  test.skip(showcase.journeys.length === 0, "the server's showcase holds no journeys for this graph");
  await page.goto(`/convert?organism=${data.organism}`);
  await figureDrawn(page);
  const asked = conversionsAsked(page);
  const list = journeyList(journeySets(showcase));
  const ids = list.map((j) => (j.model ? j.model.result.query_id : j.identifier));
  // Every row drawn is a journey of the showcase, in its order, a link named by its identifier.
  const rows = page.locator(".convert-journeys .journeys__svg [data-journey][role=link]");
  const labels = await rows.evaluateAll((gs) => gs.map((g) => g.getAttribute("aria-label") ?? ""));
  expect(labels.length).toBeGreaterThan(0);
  let at = -1;
  for (const label of labels) {
    const k = ids.findIndex((id, i) => i > at && (label.startsWith(`${id}, `) || label.startsWith(`${id}: `)));
    expect(k, label).toBeGreaterThan(at);
    at = k;
  }
  // The rows with an answer to draw (their names say the release read).
  const drawn = labels.flatMap((label, k) => (label.includes(", read at release ") ? [k] : []));
  const [first, second] = drawn;
  test.skip(first === undefined || second === undefined, "fewer than two journeys with an answer drawn");
  if (first === undefined || second === undefined) return;
  const idOf = (k: number) => labels[k]?.split(",")[0] ?? "-";
  if (isPhone(info)) {
    // On a phone a tap shows the journey; a second tap opens it.
    await rows.nth(first).locator("rect.fig-hit").tap();
    await expect(page.getByRole("tooltip")).toContainText("Tap again");
    await rows.nth(first).locator("rect.fig-hit").tap();
    await waitForResult(page);
    await expect(page).toHaveURL(new RegExp(`id=${encodeURIComponent(idOf(first))}`));
    expect(asked.length).toBe(1);
    return;
  }
  await rows.nth(first).locator("rect.fig-hit").hover();
  await expect(page.locator(".convert-journeys .journeys__svg")).toHaveClass(/is-isolating/);
  await expect(page.getByRole("tooltip")).toContainText(idOf(first));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await rows.nth(second).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toContainText("step 1 of");
  await expectAccessible(page);
  await shot(page, info, "02-start-journey-focused");
  // The full-page capture resizes the window for a moment (the figure is laid out again in it): the row is focused
  // again before its Enter.
  await rows.nth(second).focus();
  await page.keyboard.press("Enter");
  await waitForResult(page);
  await expect(page).toHaveURL(new RegExp(`id=${encodeURIComponent(idOf(second))}`));
  expect(asked.length).toBe(1);
});

/** Where the answer stands: the top of its first heading, and the window's height. */
async function answerTop(page: Page): Promise<{ top: number; height: number }> {
  return page.evaluate(() => ({
    top: (document.querySelector("[data-result] h2")?.getBoundingClientRect().top ?? 1e6) + window.scrollY,
    height: window.innerHeight,
  }));
}

test("a conversion from the hero: the hero gives way to the answer under the form in one row", async ({
  page,
}, info) => {
  await page.goto(`/convert?organism=${data.organism}`);
  const form = page.getByRole("form", { name: "Conversion" });
  await form.getByLabel("Identifier").fill(data.symbol.identifier);
  // The releases and the database are folded in one line that says them, and open on a press.
  const fold = form.getByRole("button", { name: /releases and database/i });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(form.getByLabel("To release")).toBeVisible();
  await form.getByRole("button", { name: "Convert" }).click();
  await waitForResult(page);
  await expect(page.locator(".convert-landing")).toHaveCount(0);
  // No page intro over the answer: the page's name, the form folded in one row, then the answer, on the first screen.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert");
  await expect(page.locator(".page--convert .lede")).toHaveCount(0);
  const compact = page.locator(".convert-form--compact");
  await expect(compact).toBeVisible();
  await expect(compact.getByRole("button", { name: /releases and database/i })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator("[data-result] h2").first()).toBeFocused();
  const { top, height } = await answerTop(page);
  expect(top).toBeLessThan(height * 0.6);
  await shot(page, info, "03-hero-gave-way");
});

test("a link to an answer opens on the answer: the form in one row above it", async ({ page }, info) => {
  await page.goto(convertUrl(data.symbol));
  await waitForResult(page);
  const { top, height } = await answerTop(page);
  expect(top).toBeLessThan(height * 0.6);
  await expectAccessible(page);
  await shot(page, info, "03b-link-opens-on-answer");
});

test("the examples are journeys of the showcase that travel, each named by what it shows", async ({ page }, info) => {
  const showcase = await showcaseOf(page, data.organism);
  const examples = examplesOf(showcase, data.organism);
  await page.goto(`/convert?organism=${data.organism}`);
  const group = page.getByRole("group", { name: "Examples from this graph's showcase" });
  if (!examples.length) {
    await expect(group).toHaveCount(0);
    return;
  }
  const buttons = group.getByRole("button");
  await expect(buttons).toHaveCount(examples.length);
  for (const [k, e] of examples.entries()) {
    expect(e.from).not.toBe(e.to);
    await expect(buttons.nth(k)).toContainText(e.query.identifier);
    await expect(buttons.nth(k)).toContainText(e.title);
    await expect(buttons.nth(k)).toContainText(`${e.from}→${e.to}`);
  }
  // The examples stand on one line each, inside the form's column.
  const boxes = await buttons.evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().top));
  for (let k = 1; k < boxes.length; k++) expect(boxes[k]).toBeGreaterThan(boxes[k - 1] ?? 0);
  const first = examples[0];
  if (!first) return;
  await buttons.nth(0).click();
  await waitForResult(page);
  await expect(page).toHaveURL(new RegExp(`id=${encodeURIComponent(first.query.identifier)}`));
  if (first.query.from !== undefined) await expect(page).toHaveURL(new RegExp(`from=${first.query.from}`));
  const { top, height } = await answerTop(page);
  expect(top).toBeLessThan(height * 0.6);
  await shot(page, info, "03c-example-answer");
});

/** The hero's figure at a window: it names every row it draws, keeps its drawing, legend and caption apart inside its
 *  frame, and the hero is about one screen. */
async function heroAt(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const svg = box(".convert-journeys .journeys__svg");
    const legend = box(".hero__legend .fig-legend:not(.hero__legend-room .fig-legend)");
    const caption = box(".hero__caption");
    const frame = box(".hero__frame");
    if (!svg || !caption || !frame) return ["the figure is not drawn"];
    const rows = document.querySelectorAll(".convert-journeys .journeys__svg [data-journey]").length;
    const named = [...document.querySelectorAll(".convert-journeys .jr-names > g")].filter((g) =>
      [...g.querySelectorAll("text")].some((t) => t.textContent.trim().length > 0),
    ).length;
    if (rows < 1) found.push("no row drawn");
    if (named !== rows) found.push(`${rows} rows drawn, ${named} named`);
    if (legend && svg.bottom > legend.top + 0.5) found.push("the drawing runs into its legend");
    if (svg.bottom > caption.top + 0.5) found.push("the drawing runs into its caption");
    if (caption.bottom > frame.bottom + 1) found.push("the caption runs out of the figure's frame");
    if (svg.top < frame.top - 1) found.push("the drawing runs out of the top of its frame");
    return found;
  });
}

test("at every common window the figure names the journeys it draws and keeps inside its frame", async ({
  page,
}, info) => {
  test.skip(isPhone(info), "the windows are set here, on the desktop project");
  const showcase = await showcaseOf(page, data.organism);
  test.skip(showcase.journeys.length === 0, "the server's showcase holds no journeys for this graph");
  const windows: [number, number][] = [
    [1440, 900],
    [1366, 768],
    [1280, 800],
    [1280, 720],
    [1024, 768],
    [820, 1180],
    [768, 1024],
    [390, 844],
    [2560, 1440],
  ];
  for (const [width, height] of windows) {
    await page.setViewportSize({ width, height });
    await page.goto(`/convert?organism=${data.organism}`);
    await figureDrawn(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(await heroAt(page), `${width}x${height}`).toEqual([]);
    expect(await textsWholeAndClear(page), `${width}x${height}`).toEqual([]);
  }
});

test("the figure's texts stand inside it and over no mark, on the home of every organism", async ({ page }, info) => {
  test.skip(isPhone(info), "the windows of every size are checked on the desktop project");
  for (const graph of await organisms(page)) {
    await page.goto(`/convert?organism=${graph.organism}`);
    await figureDrawn(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(await textsWholeAndClear(page), graph.organism).toEqual([]);
  }
});

test("a case's answer: the strip above it names the case and steps to the next", async ({ page }) => {
  const showcase = await showcaseOf(page, data.organism);
  const cases = showcase.cases.filter(
    (c): c is (typeof showcase.cases)[number] & { result: ConversionResult } =>
      c.kind !== "lineage" && c.result !== null && isCaseKind(c.kind),
  );
  test.skip(cases.length === 0, "the server holds no cases for this graph (another graph than they were checked on)");
  const first = cases[0];
  if (!first) return;
  await page.goto(caseHref(caseQueryOf(data.organism, first.query)));
  await waitForResult(page);
  const tour = page.getByRole("navigation", { name: "The cases of this graph" });
  await expect(tour).toContainText(`Case 1 of ${cases.length}`);
  if (cases.length > 1) {
    await tour.getByRole("link", { name: /Next/ }).click();
    await waitForResult(page);
    await expect(page).toHaveURL(new RegExp(`id=${encodeURIComponent(cases[1]?.query.identifier ?? "")}`));
    await expect(tour).toContainText(`Case 2 of ${cases.length}`);
  }
  await expectAccessible(page);
});

test("a showcase the server refuses is said in its place, with its wait; the form still converts", async ({
  page,
}, info) => {
  const asked = conversionsAsked(page);
  await page.route("**/api/v1/organisms/*/showcase", (route) =>
    route.fulfill({
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "30" },
      body: JSON.stringify({
        error: {
          code: "rate_limited",
          message: "Too many requests from this client: wait 30 seconds.",
          argument: null,
          allowed: null,
          details: null,
          request_id: "e2e",
        },
      }),
    }),
  );
  await page.goto(`/convert?organism=${data.organism}`);
  const place = page.locator(".hero__failed");
  await expect(place).toBeVisible();
  await expect(place.getByRole("button", { name: /Try again in \d+ s/ })).toBeDisabled();
  await expect(page.locator(".hero__caption")).toContainText("not drawn");
  await expect(page.getByRole("form", { name: "Conversion" })).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "04-start-showcase-refused");
  expect(asked).toEqual([]);
});
