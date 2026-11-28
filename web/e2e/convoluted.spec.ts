// The answer end to end on the convoluted cases of the graph's showcase (splits, merges, ties, bridges, steps across
// assemblies, read from the server: nothing is named here): the verdict stands on the first screen with each caution on
// its line; each caution's triangle opens what it rests on; every tab opens its panel within the window's width; the
// path's toolbar is one row (zoom, "Fit the path", "View"); More, and Cite's drawer, open and give the focus back.
import { expect, test, type Page } from "@playwright/test";
import type { ShowcaseResponse } from "../src/api/types";
import { isCaseKind } from "../src/lib/home/caseKinds";
import { caseHref, caseQueryOf } from "../src/lib/home/links";
import { data, expectAccessible, isPhone, waitForResult } from "./helpers";

async function casesOf(page: Page): Promise<{ kind: string; href: string; identifier: string }[]> {
  const showcase = (await (
    await page.request.get(`/api/v1/organisms/${data.organism}/showcase`)
  ).json()) as ShowcaseResponse;
  return showcase.cases
    .filter((c) => c.result !== null && c.result.candidates.some((x) => x.best) && isCaseKind(c.kind))
    .map((c) => ({
      kind: c.kind,
      href: caseHref(caseQueryOf(data.organism, c.query)),
      identifier: c.query.identifier,
    }));
}

/** Nothing of the page is wider than the window. */
async function fitsTheWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

test("every convoluted case: the verdict, its cautions, the tabs, the toolbar and the actions", async ({
  page,
}, info) => {
  test.setTimeout(600_000);
  const cases = await casesOf(page);
  test.skip(cases.length === 0, "the server's showcase holds no answered cases for this graph");
  for (const [k, item] of cases.entries()) {
    const where = `${item.kind} ${item.identifier}`;
    await page.goto(item.href);
    await waitForResult(page);
    // The verdict's answer is on the first screen.
    const answer = page.locator(".answer__flow");
    const box = await answer.boundingBox();
    expect(box && box.y < (page.viewportSize()?.height ?? 0), where).toBe(true);
    expect(await fitsTheWindow(page), where).toBe(true);
    // Each caution on its line, a sentence; its (i) opens the card of what it rests on, and Escape closes it.
    const marks = page
      .getByRole("list", { name: "Cautions to weigh" })
      .getByRole("button", { name: /^What .* rests on$/ });
    if (await marks.count()) {
      await marks.first().click();
      await expect(page.locator(".answer__caution-card .hovercard__card"), where).toContainText("Why this is flagged");
      await page.keyboard.press("Escape");
      await expect(page.locator(".answer__caution-card .hovercard__card")).toHaveCount(0);
    }
    // The path's toolbar is one row of three tools besides the choice of the drawing or the words.
    const view = page.getByRole("button", { name: /^View/ });
    if (!isPhone(info) && (await view.count())) {
      const tops = await page
        .locator(".pv-toolbar")
        .first()
        .evaluate((bar) => [...bar.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().top)));
      expect(new Set(tops).size, `${where}: the toolbar is one row`).toBe(1);
      await view.click();
      await expect(page.getByRole("button", { name: "All releases" })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    // Every tab opens its panel, and the page stays within the window.
    const tabs = page.getByRole("tablist", { name: "The answer in detail" }).getByRole("tab");
    for (let t = 0; t < (await tabs.count()); t++) {
      await tabs.nth(t).click();
      await expect(tabs.nth(t)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toBeVisible();
      expect(await fitsTheWindow(page), `${where}, tab ${t + 1}`).toBe(true);
    }
    // Copy opens its menu; Cite's drawer opens with its title focused and gives the focus back to Cite.
    await page.getByRole("button", { name: /^Copy: / }).click();
    await expect(page.getByRole("button", { name: /^Save the answer/ })).toBeVisible();
    await page.keyboard.press("Escape");
    const cite = page.getByRole("button", { name: /^Cite/ });
    await cite.click();
    const drawer = page.getByRole("dialog", { name: "Cite this conversion" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("region", { name: "Citation in BibTeX" })).toContainText("@software{idtrack");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(cite).toBeFocused();
    if (k < 2) await expectAccessible(page);
  }
});
