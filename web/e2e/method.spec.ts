// The Method page holds still and says only what is true: nothing moves after its first paint on any of its views (a
// layout shift under 0.05 at a laptop's and a phone's size), the notice that the api's vocabulary could not be read
// never shows while it is being read, the index under the title leads to each section, and on a phone the stepper is
// five dots.
import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

const VIEWS = [
  "/method",
  "/method?stage=walk",
  "/method?stage=bridge",
  "/method?stage=rank",
  "/method?stage=answer",
  "/method?accuracy=all",
];

test.describe("the Method page holds still", () => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`no layout shift over 0.05 and no false notice, at ${String(width)}×${String(height)}`, async ({
      page,
    }, info) => {
      test.skip(!info.project.name.startsWith("desktop-light"), "the sizes are set here");
      await page.setViewportSize({ width, height });
      await page.addInitScript(() => {
        const w = window as unknown as { __shift: number; __notice: number };
        w.__shift = 0;
        w.__notice = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
            if (!entry.hadRecentInput) w.__shift += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
        new MutationObserver(() => {
          if (document.documentElement.textContent.includes("vocabulary could not be read")) w.__notice += 1;
        }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      });
      for (const view of VIEWS) {
        await page.goto(view);
        await expect(page.locator("footer.foot")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);
        const { shift, notice } = await page.evaluate(() => {
          const w = window as unknown as { __shift: number; __notice: number };
          return { shift: w.__shift, notice: w.__notice };
        });
        expect(shift, `${view}: the layout's shift after the first paint`).toBeLessThan(0.05);
        expect(notice, `${view}: the vocabulary's failure is said only when it failed`).toBe(0);
      }
    });
  }
});

test("the index under the title leads to each section; on a phone the stages are five dots", async ({ page }, info) => {
  await page.goto("/method");
  const index = page.getByRole("navigation", { name: "On this page" });
  for (const [name, target] of [
    ["How often it is right", "#accuracy"],
    ["Using its answers", "#method-using"],
    ["The five stages", "#method-stages"],
  ] as const) {
    await index.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(page.locator(target)).toBeInViewport();
  }
  const tabs = page.getByRole("tablist", { name: "The stages of an answer" }).getByRole("tab");
  await expect(tabs).toHaveCount(5);
  if (info.project.name.startsWith("phone")) {
    // Five numbered dots on one line, each named for assistive technology; the stage's name is its panel's title.
    const tops = await tabs.evaluateAll((all) => all.map((t) => Math.round(t.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const list = page.getByRole("tablist", { name: "The stages of an answer" });
    expect(await list.evaluate((l) => l.scrollWidth <= l.clientWidth + 1)).toBe(true);
    await expect(tabs.nth(1)).toHaveAccessibleName(/Walk/);
  }
  await expectAccessible(page);
});
