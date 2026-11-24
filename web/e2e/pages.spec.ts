// The batch, names, organism and about pages, with real answers; exports equal to the api's own bytes.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { statusTitle } from "../src/lib/vocabulary";
import { data, expectAccessible, shot } from "./helpers";

test("a batch: results in order with each status, exported as the api returned them", async ({ page }, info) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await expect(page.getByText("No list converted yet")).toBeVisible();
  await shot(page, info, "20-batch-empty");
  await page.getByLabel("Identifiers", { exact: true }).fill(data.batch.join("\n"));
  await page.getByRole("button", { name: /^Convert/ }).click();
  const table = page.getByRole("region", { name: "Results in input order" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(data.batch.length);
  for (const [i, identifier] of data.batch.entries())
    await expect(rows.nth(i).locator("td").nth(1)).toContainText(identifier);

  const body = {
    identifiers: data.batch,
    from_release: null,
    to_release: null,
    final_database: null,
    from_database: null,
    explain: false,
    allow_bridges: true,
  };
  const json = await page.request.post(`/api/v1/organisms/${data.organism}/convert/batch?format=json`, { data: body });
  const parsed = (await json.json()) as { results: { status: string }[] };
  for (const [i, result] of parsed.results.entries()) {
    await expect(rows.nth(i)).toContainText(statusTitle(result.status));
  }
  const downloadJson = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const savedJson = readFileSync(await (await downloadJson).path(), "utf8");
  expect(savedJson).toBe(await json.text());

  const tsv = await page.request.post(`/api/v1/organisms/${data.organism}/convert/batch?format=tsv`, { data: body });
  const downloadTsv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export TSV" }).click();
  const savedTsv = readFileSync(await (await downloadTsv).path(), "utf8");
  expect(savedTsv).toBe(await tsv.text());
  await expectAccessible(page);
  await shot(page, info, "21-batch-results");
});

test("a batch from a file", async ({ page }) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await page.locator("#batch-file").setInputFiles({
    name: "ids.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(data.batch.map((id) => `${id},x`).join("\n")),
  });
  await expect(page.getByRole("status")).toContainText(`${data.batch.length} identifiers`);
  await expect(page.getByLabel("Identifiers", { exact: true })).toHaveValue(
    data.batch.map((id) => `${id},x`).join("\n"),
  );
});

test("a batch over the server's bound is refused with the bound", async ({ page }, info) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await page
    .getByLabel("Identifiers", { exact: true })
    .fill(Array.from({ length: 1001 }, (_, i) => `ID${i}`).join("\n"));
  await page.getByRole("button", { name: /^Convert/ }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("too_many_identifiers");
  await expect(alert).toContainText("at most 1000");
  await shot(page, info, "22-batch-too-many");
});

test("names: the genes a name names, then the names of one of them", async ({ page }, info) => {
  await page.goto(`/names?organism=${data.organism}`);
  await page.getByLabel("Name", { exact: true }).fill(data.name);
  await page.getByRole("button", { name: "Find genes" }).click();
  const matches = page.getByRole("region", { name: "Matches" }).first();
  await expect(matches).toBeVisible();
  const gene = await matches.locator("tbody tr").first().locator("td").first().innerText();
  await matches.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page.getByLabel("Ensembl gene, with version")).toHaveValue(gene);
  await expect(page.getByRole("region", { name: "Matches" })).toHaveCount(2);
  await expectAccessible(page);
  await shot(page, info, "23-names");
});

test("names: nothing found, and an unknown gene", async ({ page }, info) => {
  await page.goto(`/names?organism=${data.organism}&name=NOT_A_NAME_AT_ALL&gene=ENSXXXG00000000000.1`);
  await expect(page.getByText(/No external database attaches the name NOT_A_NAME_AT_ALL/)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("unknown_identifier");
  await shot(page, info, "24-names-empty-and-error");
});

test("the organism's page: releases, assemblies, databases, digest and build", async ({ page }, info) => {
  await page.goto(`/organisms/${data.organism}`);
  const version = (await (await page.request.get("/api/v1/version")).json()) as {
    graphs: { organism: string; content_digest: string; file: { sha256: string } }[];
  };
  const graph = version.graphs.find((g) => g.organism === data.organism);
  expect(graph).toBeDefined();
  await expect(page.getByText(graph?.content_digest ?? "-", { exact: true })).toBeVisible();
  await expect(page.getByText(graph?.file.sha256 ?? "-", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Assemblies", exact: true })).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "25-organism");
  await page.goto("/organisms");
  await expectAccessible(page);
  await shot(page, info, "26-organisms");
});

test("the about page: what idtrack is, how to cite it, the data and the limits", async ({ page }, info) => {
  await page.goto("/about");
  const version = (await (await page.request.get("/api/v1/version")).json()) as { idtrack_version: string };
  await expect(page.locator("pre.raw--cite")).toContainText(`version = {${version.idtrack_version}}`);
  await expect(page.getByRole("heading", { name: "Limits" })).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "27-about");
});

test("keyboard alone: from the page's start to an answer", async ({ page }) => {
  await page.goto(`/?organism=${data.organism}`);
  await page.keyboard.press("Tab");
  await expect(page.getByText("Skip to the content")).toBeFocused();
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.getByLabel("Identifier").evaluate((input) => input === document.activeElement);
  }
  expect(found).toBe(true);
  await page.keyboard.type(data.symbol.identifier);
  await page.keyboard.press("Enter");
  await expect(page.locator("article.result")).toBeVisible();
});
