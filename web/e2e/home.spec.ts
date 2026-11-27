// The Convert page before a conversion: one screen, the hero. Its line, its sentence, the form and the ways on; the
// figure of the graph's journeys from the server's showcase (one answer, no conversion asked by the page), with its
// caption and its text alternative; nothing between the hero and the footer. Every text of the figure stands inside it
// and over no mark, on the home of every organism the server holds. A conversion asked from the hero turns the page
// into the answer under the compact form; the strip above an answer that is a case steps through the cases.
import { expect, test, type Page } from "@playwright/test";
import type { ConversionResult, GraphDescription, ShowcaseResponse } from "../src/api/types";
import { isCaseKind } from "../src/lib/home/caseKinds";
import { caseHref, caseQueryOf } from "../src/lib/home/links";
import { answerText } from "../src/lib/home/journeyModel";
import { journeyList, journeySets } from "../src/lib/home/journeys";
import { data, expectAccessible, isPhone, shot, waitForResult } from "./helpers";

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
    for (const svg of document.querySelectorAll<SVGSVGElement>(".hero .journeys__svg")) {
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

test("the start page is one screen: the hero, its figure, then the footer", async ({ page }, info) => {
  const asked = conversionsAsked(page);
  await page.goto(`/?organism=${data.organism}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Follow a gene.id through Ensembl's history$/);
  await expect(page.getByRole("form", { name: "Conversion" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "More of idtrack" }).getByRole("link")).toHaveCount(3);
  await figureDrawn(page);
  // Nothing stands between the hero and the footer, and the hero ends within the first screen (a little more on a
  // short window): no long page.
  await expect(page.locator("main .page > *")).toHaveCount(1);
  const fit = await page.evaluate(() => {
    const hero = document.querySelector(".hero")?.getBoundingClientRect();
    return {
      bottom: (hero?.bottom ?? 0) + window.scrollY,
      viewport: window.innerHeight,
      wide: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  expect(fit.bottom).toBeLessThanOrEqual(fit.viewport * 1.15);
  expect(fit.wide).toBe(false);
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
  await shot(page, info, "01-start-hero");
  expect(asked, "the home converts nothing itself").toEqual([]);
});

test("the journeys: every row the showcase's answer, isolated on focus, opened by Enter", async ({ page }, info) => {
  const showcase = await showcaseOf(page, data.organism);
  test.skip(showcase.journeys.length === 0, "the server's showcase holds no journeys for this graph");
  await page.goto(`/?organism=${data.organism}`);
  await figureDrawn(page);
  if (isPhone(info)) {
    // On a phone the figure is a still image described by its caption; every journey is in its text alternative.
    await expect(page.locator(".hero .journeys__svg")).toHaveAttribute("role", "img");
    await expect(page.locator(".hero .journeys__svg")).toHaveAttribute("aria-describedby", /.+/);
    return;
  }
  const asked = conversionsAsked(page);
  const list = journeyList(journeySets(showcase));
  const rows = page.locator(".hero .journeys__svg [data-journey][role=link]");
  await expect(rows).toHaveCount(list.length);
  for (const [j, journey] of list.entries()) {
    const m = journey.model;
    if (!m) continue;
    await expect(rows.nth(j)).toHaveAttribute(
      "aria-label",
      new RegExp(`^${m.result.query_id.replace(/\./g, "\\.")}, `),
    );
  }
  const drawn = list.findIndex((j) => j.model);
  const next = list.findIndex((j, i) => i > drawn && j.model);
  test.skip(drawn === -1 || next === -1, "fewer than two journeys with an answer to draw");
  await rows.nth(drawn).locator("rect.fig-hit").hover();
  await expect(page.locator(".hero .journeys__svg")).toHaveClass(/is-isolating/);
  await expect(page.getByRole("tooltip")).toContainText(list[drawn]?.model?.result.query_id ?? "-");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await rows.nth(next).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toContainText("step 1 of");
  await expectAccessible(page);
  await shot(page, info, "02-start-journey-focused");
  await page.keyboard.press("Enter");
  await waitForResult(page);
  await expect(page).toHaveURL(new RegExp(`id=${encodeURIComponent(list[next]?.identifier ?? "")}`));
  expect(asked.length).toBe(1);
});

test("a conversion from the hero: the hero gives way to the answer under the compact form", async ({ page }, info) => {
  await page.goto(`/?organism=${data.organism}`);
  const form = page.getByRole("form", { name: "Conversion" });
  await form.getByLabel("Identifier").fill(data.symbol.identifier);
  // The releases and the database are folded in one line that says them, and open on a press.
  const fold = form.getByRole("button", { name: /releases and database/i });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(form.getByLabel("To release")).toBeVisible();
  await form.getByRole("button", { name: "Convert" }).click();
  await waitForResult(page);
  await expect(page.locator(".hero")).toHaveCount(0);
  await expect(page.locator(".convert-form--compact")).toBeVisible();
  await expect(page.locator("[data-result] h2").first()).toBeFocused();
  await shot(page, info, "03-hero-gave-way");
});

test("the figure's texts stand inside it and over no mark, on the home of every organism", async ({ page }, info) => {
  test.skip(isPhone(info), "the phone's figure is a still image without texts");
  for (const graph of await organisms(page)) {
    await page.goto(`/?organism=${graph.organism}`);
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
  await expect(tour).toContainText(`1 / ${cases.length}`);
  if (cases.length > 1) {
    await tour.getByRole("link", { name: /Next/ }).click();
    await waitForResult(page);
    await expect(page).toHaveURL(new RegExp(`id=${encodeURIComponent(cases[1]?.query.identifier ?? "")}`));
    await expect(tour).toContainText(`2 / ${cases.length}`);
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
  await page.goto(`/?organism=${data.organism}`);
  const place = page.locator(".hero__failed");
  await expect(place).toBeVisible();
  await expect(place.getByRole("button", { name: /Try again in \d+ s/ })).toBeDisabled();
  await expect(page.locator(".hero__caption")).toContainText("not drawn");
  await expect(page.getByRole("form", { name: "Conversion" })).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "04-start-showcase-refused");
  expect(asked).toEqual([]);
});
