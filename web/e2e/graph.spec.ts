// Flows that need what only some graphs hold: genes on alternative loci, and a very large answer (the human graph).
import { expect, test } from "@playwright/test";
import { apiConvertUrl, convertUrl, data, expectAccessible, shot, waitForResult } from "./helpers";

test("genes on alternative loci are named beside the answer, not as candidates", async ({ page }, info) => {
  const query = data.alternativeLoci;
  test.skip(!query, "this graph's test data names no identifier with genes on alternative loci");
  if (!query) return;
  await page.goto(convertUrl(query));
  await waitForResult(page);
  const answer = (await (await page.request.get(apiConvertUrl(query))).json()) as { alternative_locus_genes: string[] };
  expect(answer.alternative_locus_genes.length).toBeGreaterThan(0);
  const readout = page.locator(".readout", { hasText: "Also on alternative loci" });
  for (const gene of answer.alternative_locus_genes) await expect(readout).toContainText(gene);
  await expectAccessible(page);
  await shot(page, info, "30-alternative-loci");
});

test("a very large answer: every candidate listed, the drawing bounded, every step read", async ({ page }, info) => {
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
  await expect(page.getByRole("region", { name: "Candidates, ranked" }).locator("tbody tr")).toHaveCount(
    answer.candidates.length,
  );
  await expect(page.locator(".pv__more")).toContainText(`of ${answer.candidates.length} candidates are drawn`);
  await expect(page.locator(".reading__step")).toHaveCount(
    answer.candidates.reduce((n, c) => n + c.path.length + c.final_path.length, 0),
  );
  await shot(page, info, "31-large-answer");
  await page.getByRole("button", { name: `Draw all ${answer.candidates.length}` }).click();
  await expect(page.locator(".pv__more")).toContainText(`All ${answer.candidates.length} candidates are drawn`);
});
