// The home: one picture of the graph in view, a headline, a sentence and two calls to action, nothing else to press;
// its picture menu. The Convert page before a conversion: its title, the form with examples from the showcase (the
// journeys of the graph are Explore's, e2e/journeys.spec.ts). An example converts a journey of the showcase that
// travels; a conversion turns the page into the answer under the form in one row, the answer on the first screen; the
// strip above an answer that is a case steps through the cases.
import { expect, test, type Page } from "@playwright/test";
import type { ConversionResult, ShowcaseResponse } from "../src/api/types";
import { isCaseKind } from "../src/lib/home/caseKinds";
import { caseHref, caseQueryOf } from "../src/lib/home/links";
import { convolutedAnswers } from "../src/lib/hero/constellationModel";
import { examplesOf } from "../src/lib/home/examples";
import { convertUrl, data, expectAccessible, isPhone, shot, waitForResult } from "./helpers";

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

/** Whether the hero's words, as seen, are the same pixels with the picture and without it: nothing of the picture lies
 *  under a word. The picture is drawn whole first (the renderer counts its frames, a 2D drawing its finished drawings,
 *  on the field: `data-frames`). */
async function wordsClearOfPicture(page: Page): Promise<boolean> {
  await expect(page.locator(".hero2__field[data-mode] canvas")).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(async () => page.locator(".hero2__field").getAttribute("data-frames"), { timeout: 60_000 })
    .toMatch(/^[1-9]/);
  const box = await page.evaluate(() => {
    const words = document.querySelector(".hero2__words");
    if (!words) return null;
    const range = document.createRange();
    const boxes = [...words.children].flatMap((child) =>
      child.classList.contains("hero2__actions")
        ? [...child.children].map((c) => c.getBoundingClientRect())
        : (range.selectNodeContents(child), [range.getBoundingClientRect()]),
    );
    const seen = boxes.filter((b) => b.width > 0 && b.height > 0);
    const x = Math.max(0, Math.min(...seen.map((b) => b.left)) - 4);
    const y = Math.max(0, Math.min(...seen.map((b) => b.top)) - 4);
    return {
      x,
      y,
      width: Math.max(...seen.map((b) => b.right)) + 4 - x,
      height: Math.max(...seen.map((b) => b.bottom)) + 4 - y,
    };
  });
  if (!box) return false;
  const withPicture = await page.screenshot({ clip: box, animations: "disabled" });
  await page.locator(".hero2__field canvas").evaluate((c: HTMLElement) => (c.style.visibility = "hidden"));
  const without = await page.screenshot({ clip: box, animations: "disabled" });
  await page.locator(".hero2__field canvas").evaluate((c: HTMLElement) => (c.style.visibility = ""));
  return withPicture.equals(without);
}

test("the home is one picture: a headline, a sentence, two calls to action, nothing else to press", async ({
  page,
}, info) => {
  const asked = conversionsAsked(page);
  // The home of the graph under test (a server of several graphs shows the first by default).
  await page.goto(`/?organism=${data.organism}`);
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
  expect(await wordsClearOfPicture(page), "no line of the picture crosses a word").toBe(true);
  await expectAccessible(page);
  await shot(page, info, "01-home");
  expect(asked, "the home converts nothing").toEqual([]);
});

test("the home's picture menu offers three pictures and keeps the choice", async ({ page }) => {
  // The home of the graph under test (a server of several graphs shows the first by default).
  await page.goto(`/?organism=${data.organism}`);
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

/** Where the rings' disc stands clear of a text of the hero: every text box (the words, the caption) lies beyond the
 *  disc's reach (its rim, the longest tick and its glow) or below its horizon; the slot's labels stand in the slot (or
 *  under the horizon) and touch no other label. The failures, in words. */
async function ringsClear(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const field = document.querySelector<HTMLElement>(".hero2__field");
    const [form, cx, cy, , outer, horizon] = (field?.dataset["place"] ?? "").split(" ");
    if (!field || !form) return ["the rings are not placed"];
    const frame = field.getBoundingClientRect();
    const c = { x: Number(cx), y: Number(cy) };
    const reach = Number(outer) + 18;
    const below = horizon ? Number(horizon) : null;
    const boxes = (selector: string) => {
      const out: { text: string; box: DOMRect }[] = [];
      const range = document.createRange();
      for (const root of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || node.parentElement?.closest(".visually-hidden")) continue;
          range.selectNodeContents(node);
          for (const box of range.getClientRects()) if (box.width > 0) out.push({ text: node.textContent.trim(), box });
        }
      }
      return out;
    };
    for (const { text, box } of boxes(".hero2__words, .hero2__caption")) {
      const left = box.left - frame.left;
      const right = box.right - frame.left;
      const top = box.top - frame.top;
      const bottom = box.bottom - frame.top;
      const dx = Math.max(left - c.x, 0, c.x - right);
      const dy = Math.max(top - c.y, 0, c.y - bottom);
      if (below !== null && top >= below) continue;
      if (Math.hypot(dx, dy) < reach) found.push(`a ring crosses "${text}"`);
    }
    const labels = [...document.querySelectorAll(".hero2__ring-label")].map((l) => l.getBoundingClientRect());
    for (const [i, box] of labels.entries()) {
      const mid = (box.top + box.bottom) / 2 - frame.top;
      if (below === null ? Math.abs(mid - c.y) > 1 || box.height > 16 : box.top - frame.top < below)
        found.push(`a label stands outside the slot (${String(Math.round(mid))})`);
      for (const other of labels.slice(i + 1))
        if (box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom)
          found.push("two labels touch");
    }
    return found;
  });
}

test("the rings stand clear of every word of the hero at every common window", async ({ page }, info) => {
  test.skip(isPhone(info), "the windows are set here, on the desktop project");
  await page.addInitScript(() => {
    localStorage.setItem("idtrack-hero", "rings");
  });
  const windows: [number, number][] = [
    [1440, 900],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [820, 1180],
    [768, 1024],
    [390, 844],
    [2560, 1440],
  ];
  for (const [width, height] of windows) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator(".hero2__field[data-place]")).toHaveCount(1, { timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(300);
    expect(await ringsClear(page), `${String(width)}x${String(height)}`).toEqual([]);
  }
  await shot(page, info, "01b-home-rings");
});

test("the Convert page: its title and the form", async ({ page }, info) => {
  const asked = conversionsAsked(page);
  await page.goto(`/convert?organism=${data.organism}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Convert an identifier");
  await expect(page.getByRole("form", { name: "Conversion" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(wide).toBe(false);
  await expectAccessible(page);
  await shot(page, info, "02-convert");
  expect(asked, "the Convert page converts nothing by itself").toEqual([]);
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

test("a showcase the server refuses: the form still converts", async ({ page }, info) => {
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
  await expect(page.getByRole("form", { name: "Conversion" })).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "04-start-showcase-refused");
  expect(asked).toEqual([]);
});
