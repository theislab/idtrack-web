// Explore's first figure, the journeys of the graph (components/explore/Journeys.tsx), against the real server: its
// caption names the endpoint and its text alternative says every journey; every row drawn is a journey of the
// showcase, the most convoluted of its set first, isolated and named on focus and opened by Enter; at every common
// window every row it draws has its name and the figure keeps its drawing and caption inside its frame; every text
// stands inside it and over no mark, for every organism; a showcase the server refuses is said in the figure's place,
// with its wait. The page converts nothing by itself.
import { expect, test, type Page } from "@playwright/test";
import type { GraphDescription, ShowcaseResponse } from "../src/api/types";
import { answerText } from "../src/lib/home/journeyModel";
import { journeyList, journeySets } from "../src/lib/home/journeys";
import { rankedSets } from "../src/lib/home/useJourneys";
import { data, expectAccessible, isPhone, shot, waitForResult } from "./helpers";

async function organisms(page: Page): Promise<GraphDescription[]> {
  return ((await (await page.request.get("/api/v1/organisms")).json()) as { organisms: GraphDescription[] }).organisms;
}

async function showcaseOf(page: Page, organism: string): Promise<ShowcaseResponse> {
  return (await (await page.request.get(`/api/v1/organisms/${organism}/showcase`)).json()) as ShowcaseResponse;
}

/** The api requests a page makes that convert (Explore converts nothing itself but the lives of its retired cases). */
function conversionsAsked(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/v1\/organisms\/[^/]+\/convert(\?|$)/.test(r.url()) && !r.url().includes("allow_bridges=false"))
      asked.push(r.url());
  });
  return asked;
}

/** Wait until the journeys' figure is drawn (or says why it is not). */
async function figureDrawn(page: Page): Promise<void> {
  await expect(page.locator(".journeys-story__caption")).not.toContainText("drawn when they arrive");
}

/** Every text of the journeys' figure lies inside its drawing and over none of its marks (the figure grammar's rule). */
async function textsWholeAndClear(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const svg of document.querySelectorAll<SVGSVGElement>(".journeys-story .journeys__svg")) {
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

test("Explore's journeys: the caption names the endpoint, the list says every journey", async ({ page }, info) => {
  const asked = conversionsAsked(page);
  await page.goto(`/organisms?organism=${data.organism}`);
  await figureDrawn(page);
  const showcase = await showcaseOf(page, data.organism);
  const list = journeyList(rankedSets(journeySets(showcase)));
  if (list.length) {
    await page.getByRole("button", { name: "More about this figure" }).first().click();
    await expect(page.locator(".journeys-story__caption")).toContainText(
      `GET /api/v1/organisms/${data.organism}/showcase`,
    );
    const words = page.getByRole("list", { name: "The journeys in words" }).locator("li");
    await expect(words).toHaveCount(list.length);
    for (const [j, journey] of list.entries())
      if (journey.model) await expect(words.nth(j)).toContainText(answerText(journey.model).replace(/ \+\d+$/, ""));
  }
  expect(await textsWholeAndClear(page)).toEqual([]);
  await expectAccessible(page);
  await shot(page, info, "44-explore-journeys");
  expect(asked, "Explore converts nothing by itself").toEqual([]);
});

test("the journeys: every row the showcase's answer, isolated on focus, opened by Enter", async ({ page }, info) => {
  const showcase = await showcaseOf(page, data.organism);
  test.skip(showcase.journeys.length === 0, "the server's showcase holds no journeys for this graph");
  await page.goto(`/organisms?organism=${data.organism}`);
  await figureDrawn(page);
  const asked = conversionsAsked(page);
  const list = journeyList(rankedSets(journeySets(showcase)));
  const ids = list.map((j) => (j.model ? j.model.result.query_id : j.identifier));
  // Every row drawn is a journey of the showcase, in the ranked order (the most convoluted of its set first), a link
  // named by its identifier.
  const rows = page.locator(".journeys-story .journeys__svg [data-journey][role=link]");
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
  await expect(page.locator(".journeys-story .journeys__svg")).toHaveClass(/is-isolating/);
  await expect(page.getByRole("tooltip")).toContainText(idOf(first));
  // The row pointed at is named on the figure itself.
  await expect(page.locator(".journeys-story .jr-names text", { hasText: idOf(first) })).toHaveCount(1);
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

/** The journeys' figure at a window: every row it draws has its name (its accessible name; its ids are written on the
 *  row in focus, none at rest), and it keeps its drawing and caption apart inside its frame. */
async function figureAt(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const svg = box(".journeys-story .journeys__svg");
    const caption = box(".journeys-story__caption");
    const frame = box(".journeys-story__frame");
    if (!svg || !caption || !frame) return ["the figure is not drawn"];
    const rows = [...document.querySelectorAll(".journeys-story .journeys__svg [data-journey]")];
    const named = rows.filter((g) => (g.getAttribute("aria-label") ?? "").trim().length > 0).length;
    const written = document.querySelectorAll(".journeys-story .jr-names text").length;
    if (rows.length < 1) found.push("no row drawn");
    if (named !== rows.length) found.push(`${rows.length} rows drawn, ${named} named`);
    if (written > 0 && !document.querySelector(".journeys-story .journeys__svg.is-isolating"))
      found.push(`${written} ids written at rest`);
    if (svg.bottom > caption.top + 0.5) found.push("the drawing runs into its caption");
    if (caption.bottom > frame.bottom + 1) found.push("the caption runs out of the figure's frame");
    if (svg.top < frame.top - 1) found.push("the drawing runs out of the top of its frame");
    return found;
  });
}

test("at every common window every journey drawn has its name, and the figure keeps inside its frame", async ({
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
    await page.goto(`/organisms?organism=${data.organism}`);
    await figureDrawn(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect.poll(() => figureAt(page), { message: `${width}x${height}` }).toEqual([]);
    expect(await textsWholeAndClear(page), `${width}x${height}`).toEqual([]);
  }
});

test("the figure's texts stand inside it and over no mark, for every organism", async ({ page }, info) => {
  test.skip(isPhone(info), "the windows of every size are checked on the desktop project");
  for (const graph of await organisms(page)) {
    await page.goto(`/organisms?organism=${graph.organism}`);
    await figureDrawn(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(await textsWholeAndClear(page), graph.organism).toEqual([]);
  }
});

test("Explore's journeys: a showcase the server refuses is said in their place, with its wait", async ({
  page,
}, info) => {
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
  await page.goto(`/organisms?organism=${data.organism}`);
  const place = page.locator(".journeys-story__failed");
  await expect(place).toBeVisible();
  await expect(place.getByRole("button", { name: /Try again in \d+ s/ })).toBeDisabled();
  await expect(page.locator(".journeys-story__caption")).toContainText("not drawn");
  await expectAccessible(page);
  await shot(page, info, "44b-explore-showcase-refused");
});
