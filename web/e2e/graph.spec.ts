// Flows that need what only some graphs hold: genes on alternative loci, and a very large answer (the human graph).
import { expect, test } from "@playwright/test";
import { apiConvertUrl, convertUrl, data, expectAccessible, isPhone, shot, waitForResult } from "./helpers";

test("genes on alternative loci are named beside the answer, not as candidates", async ({ page }, info) => {
  const query = data.alternativeLoci;
  test.skip(!query, "this graph's test data names no identifier with genes on alternative loci");
  if (!query) return;
  await page.goto(convertUrl(query));
  await waitForResult(page);
  const answer = (await (await page.request.get(apiConvertUrl(query))).json()) as { alternative_locus_genes: string[] };
  expect(answer.alternative_locus_genes.length).toBeGreaterThan(0);
  // How the identifier was read: the Reading tab.
  await page.getByRole("tab", { name: /^Reading/ }).click();
  const readout = page.locator(".readout", { hasText: "Copies set apart" });
  for (const gene of answer.alternative_locus_genes) await expect(readout).toContainText(gene);
  await expectAccessible(page);
  await shot(page, info, "30-alternative-loci");
});

test("a very large answer: the verdict on the first screen, every list bounded, every candidate reachable", async ({
  page,
}, info) => {
  const query = data.large;
  test.skip(!query, "this graph's test data names no very large answer");
  if (!query) return;
  test.setTimeout(180_000);
  await page.goto(convertUrl(query));
  await waitForResult(page);
  const answer = (await (await page.request.get(apiConvertUrl(query))).json()) as {
    candidates: { path: number[]; final_path: number[] }[];
  };
  expect(answer.candidates.length).toBeGreaterThan(100);
  // The query, the answer and the status stand on the first screen of the answer, whatever its size.
  const panel = page.locator(".answer-panel");
  const top = (await panel.boundingBox())?.y ?? 0;
  const status = (await page.locator(".answer__codes").boundingBox())?.y ?? 0;
  const viewport = page.viewportSize()?.height ?? 900;
  expect(status - top).toBeLessThan(viewport);
  // One gene with its first targets, the rest on request; the drawing bounded; the candidates paged (the Decision
  // tab); one candidate's steps at a time (the Path tab, in words).
  await expect(page.locator(".answer__list-ids li")).toHaveCount(6);
  await expect(page.locator(".pv__more")).toContainText(`of ${answer.candidates.length} candidates are drawn`);
  // The page stays light: a bounded number of elements, with the tab of the drawing open.
  expect(await page.evaluate(() => document.getElementsByTagName("*").length)).toBeLessThan(6000);
  await page.getByRole("radio", { name: "In words" }).click();
  const best = answer.candidates[0];
  const steps = (best?.path.length ?? 0) + (best?.final_path.length ?? 0);
  await expect(page.locator(".reading .steps__row")).toHaveCount(isPhone(info) ? Math.min(6, steps) : steps);
  await page.getByRole("tab", { name: /^Decision/ }).click();
  const rows = page.getByRole("region", { name: "Candidates, ranked" }).locator("tbody tr.cand__row");
  await expect(rows).toHaveCount(isPhone(info) ? 10 : 25);
  await expect(page.locator(".pager").first()).toContainText(`of ${answer.candidates.length}`);
  expect(await page.evaluate(() => document.getElementsByTagName("*").length)).toBeLessThan(6000);
  await page.getByRole("button", { name: "Next" }).first().click();
  await expect(rows.first()).toContainText(isPhone(info) ? "11" : "26");
  await page.getByRole("button", { name: `Show all ${answer.candidates.length}` }).click();
  await expect(page.locator(".answer__list-ids li")).toHaveCount(answer.candidates.length);
  await shot(page, info, "31-large-answer");
  await page.getByRole("tab", { name: /^Path/ }).click();
  await page.getByRole("radio", { name: "Drawing" }).click();
  await page.getByRole("button", { name: `Draw all ${answer.candidates.length}` }).click();
  await expect(page.locator(".pv__more")).toContainText(`All ${answer.candidates.length} candidates are drawn`);
});
