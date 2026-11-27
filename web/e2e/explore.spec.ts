// Explore and Method against the real server: every stage of the Method page drawn on the real answer its case claims
// (each case converted here and its property read from the api's answer); the benchmarks' rates as the generated file
// holds them, and whether the graphs measured are this server's; Ensembl's id history drawn from the server's own
// counts, and left out where the server does not count it; the assembly changes with their mapping in idtrack's
// words; the database matrix in its order and what each name holds.
import { expect, test, type Page } from "@playwright/test";
import type { ConversionResult, DatabasesResponse, GraphDescription, HistoryResponse } from "../src/api/types";
import { databaseLabel } from "../src/lib/databases";
import { readMatrix } from "../src/lib/explore/databaseMatrix";
import { BENCHMARKS, familyRows, measuredGraph, rateText } from "../src/lib/benchmarks";
import { handoffsOf, MAPPING_WORDS } from "../src/lib/explore/handoffs";
import { historyColumns } from "../src/lib/explore/history";
import { apiQuery } from "../src/lib/home/links";
import { holdsStage, STAGE_CASES, stageCase } from "../src/lib/method/cases";
import { groupedInteger, releaseRanges } from "../src/lib/numbers";
import { data, expectAccessible, shot } from "./helpers";

async function organisms(page: Page): Promise<GraphDescription[]> {
  return ((await (await page.request.get("/api/v1/organisms")).json()) as { organisms: GraphDescription[] }).organisms;
}

/** Scroll through the page, once it is drawn (a page's code arrives after the address), so that every part asked when
 *  it comes into view is asked. */
async function scrollThrough(page: Page): Promise<void> {
  await expect(page.locator("main h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
}

test("Method: every stage is drawn on the real answer its case claims, linked to it", async ({ page }, info) => {
  const graphs = await organisms(page);
  const digests = new Map(graphs.map((g) => [g.organism, g.content_digest]));
  const shown = (["read", "walk", "bridge", "rank", "answer"] as const)
    .map((stage) => stageCase(stage, digests))
    .filter((c) => c !== null);
  // Every case of a graph this server holds with its digest (the one drawn and those after it) still shows what it is
  // drawn for.
  for (const c of STAGE_CASES.filter((x) => digests.get(x.query.organism) === x.checkedOn)) {
    const q = apiQuery(c.query);
    const parameters = new URLSearchParams({ identifier: q.identifier, explain: "true" });
    if (q.from_release !== null) parameters.set("from_release", String(q.from_release));
    if (q.to_release !== null) parameters.set("to_release", String(q.to_release));
    if (q.final_database !== null) parameters.set("final_database", q.final_database);
    const result = (await (
      await page.request.get(`/api/v1/organisms/${c.query.organism}/convert?${parameters.toString()}`)
    ).json()) as ConversionResult;
    expect(holdsStage(c.stage, result), `${c.stage}: ${c.query.identifier}`).toBe(true);
  }
  await page.goto("/method");
  await scrollThrough(page);
  const figures = page.locator("figure.stage-case");
  await expect(figures).toHaveCount(shown.length);
  for (const [i, c] of shown.entries()) {
    const figure = figures.nth(i);
    await figure.scrollIntoViewIfNeeded();
    await expect(figure).toContainText(c.query.identifier);
    await expect(figure.getByRole("link", { name: "Open this answer" })).toHaveAttribute(
      "href",
      new RegExp(`id=${encodeURIComponent(c.query.identifier)}`),
    );
    await expect(figure.locator(".stage-case__loading")).toHaveCount(0);
  }
  if (shown.some((c) => c.stage === "rank")) {
    await expect(page.locator(".rank-fig__row--decides")).toHaveCount(1);
  }
  if (shown.some((c) => c.stage === "read")) {
    await expect(page.locator(".read-fig__step--matched")).toHaveCount(1);
  }
  expect(new Set(STAGE_CASES.map((c) => c.stage)).size).toBe(5);
  await expectAccessible(page);
  await shot(page, info, "28-method-stages");
});

test("Method: the benchmarks' rates as published, and whether this server's graphs are the ones measured", async ({
  page,
}, info) => {
  const graphs = await organisms(page);
  await page.goto("/method#method-evidence");
  const table = page.getByRole("region", { name: "Accuracy of the benchmark families" });
  await expect(table.locator("tbody.bench__family")).toHaveCount(BENCHMARKS.families.length);
  for (const family of BENCHMARKS.families) {
    const body = table.locator("tbody.bench__family", { hasText: family.title });
    for (const { rows } of familyRows(family))
      for (const row of rows.values()) await expect(body).toContainText(rateText(row.rate, row).text);
  }
  // No rate the source rounded to 1 is written as 1 while its counts hold a wrong answer.
  for (const family of BENCHMARKS.families)
    for (const row of family.rows)
      if (row.wrong > 0 && Number(row.rate) >= 1)
        await expect(table.locator("tbody", { hasText: family.title })).toContainText("> 0.99999");
  // What each family is judged against, and the one source a truth shares with idtrack, are on the page.
  await expect(page.locator(".bench-caveat")).toContainText("stable_id_event");
  await expect(table.getByText("What it is judged against")).toHaveCount(BENCHMARKS.families.length);
  const all = graphs.every((g) => measuredGraph(g.organism, g.content_digest));
  await expect(page.locator(".bench__graphs")).toContainText(
    all ? "Measured on the graphs this server holds" : "Measured on other graphs",
  );
  // The tools: each task's rows as the generated file holds them.
  const tools = page.getByRole("region", { name: "Tools against idtrack on the same lines" });
  for (const task of Object.keys(BENCHMARKS.tools.tasks)) {
    await page.getByRole("radio", { name: new RegExp(`^${task} `) }).click();
    await expect(tools.locator("tbody tr")).toHaveCount(BENCHMARKS.tools.tools.filter((t) => t.task === task).length);
  }
  await expect(page.locator("pre.raw--cite")).toContainText("year = {");
  await expectAccessible(page);
  await shot(page, info, "29-method-evidence");
});

test("Explore: Ensembl's id history from the server's counts, and the assembly changes with their mapping", async ({
  page,
}, info) => {
  const graphs = await organisms(page);
  const graph = graphs.find((g) => g.organism === data.organism);
  expect(graph).toBeDefined();
  if (!graph) return;
  const response = await page.request.get(`/api/v1/organisms/${data.organism}/history`);
  await page.goto("/organisms");
  if (response.status() === 200) {
    await expect(page.getByRole("heading", { name: "Ensembl's id history, release by release" })).toBeVisible();
  }
  await page.goto(`/organisms/${data.organism}`);
  // The assemblies: every change of the serving assembly, with whether Ensembl maps it, in idtrack's words.
  const assemblies = page.getByRole("region", { name: "Assemblies", exact: true });
  for (const h of handoffsOf(graph)) await expect(assemblies).toContainText(MAPPING_WORDS[h.mapping]);
  if (response.status() === 200) {
    const history = (await response.json()) as HistoryResponse;
    const columns = historyColumns(history);
    const figure = page.getByRole("group", { name: /^Ensembl's id history of the/ });
    await expect(figure).toBeVisible();
    // The release columns, one per release, each with its exact counts on focus.
    const last = columns[columns.length - 1];
    if (last) {
      await figure.locator("[data-index]").first().focus();
      await page.keyboard.press("End");
      await expect(page.getByRole("tooltip")).toContainText(`Release ${last.release}`);
      await expect(page.getByRole("tooltip")).toContainText(groupedInteger(last.genes));
    }
    const lines = page.getByRole("list", { name: /one release a line$/ }).locator("li");
    await expect(lines).toHaveCount(columns.length);
  }
  // The matrix: databases of some releases first, those of every release after them.
  const matrix = (await (await page.request.get(`/api/v1/organisms/${data.organism}/databases`)).json()) as {
    releases: number[];
    databases: DatabasesResponse["databases"];
    symbol_databases: string[];
  };
  // The api's rows in the page's order (lib/explore/databaseMatrix.ts: some releases first, then every release).
  const ordered = readMatrix({ ...matrix, organism: data.organism, by_assembly: {}, symbol_databases: [] }).databases;
  await expect(page.getByRole("list", { name: "The matrix, one database a line" }).locator("li")).toHaveText(
    ordered.map((d) => `${databaseLabel(d.name)}: releases ${releaseRanges(d.releases)}`),
  );
  await page.getByText(/^What each of the \d+ database names holds$/).click();
  // Every name is either described (a row) or named once among those idtrack does not describe.
  const described = await page.locator(".db-meanings__row").count();
  const unsaid = await page.locator(".db-meanings__unsaid .mono").count();
  expect(described + unsaid).toBe(matrix.databases.length);
  // The symbol databases are said for this organism: only the first of the graph's list is its name authority.
  const authority = page.locator(".db-meanings__row", { hasText: "The symbol of the organism's name authority" });
  await expect(authority).toHaveCount(matrix.symbol_databases.length ? 1 : 0);
  await expectAccessible(page);
  await shot(page, info, "30-organism-history");
});

test("Explore: without the server's history the panel is left out, the rest drawn", async ({ page }) => {
  await page.route("**/api/v1/organisms/*/history", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "not_found",
          message: "There is no endpoint here.",
          argument: null,
          allowed: null,
          details: null,
          request_id: "test",
        },
      }),
    }),
  );
  await page.goto(`/organisms/${data.organism}`);
  await expect(page.locator(".dbm svg")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ensembl's id history, release by release" })).toHaveCount(0);
});

test("Explore: a graph whose history fails says so in its row, with a way to ask again; shares on one axis", async ({
  page,
}) => {
  const graphs = await organisms(page);
  const failing = graphs[0]?.organism ?? data.organism;
  const counted = (await page.request.get(`/api/v1/organisms/${failing}/history`)).status() === 200;
  test.skip(!counted, "this server does not count the history");
  await page.route(`**/api/v1/organisms/${failing}/history`, (route) => route.abort());
  await page.goto("/organisms");
  const rows = page.locator(".idh-rows > li");
  await expect(rows).toHaveCount(graphs.length);
  await expect(rows.first()).toContainText("could not be read");
  await expect(rows.first().getByRole("button", { name: "Try again" })).toBeVisible();
  // Shares: every row on one axis, no row's own scale written.
  await page.getByRole("radio", { name: /^Share of the gene ids active/ }).click();
  await expect(page.locator(".idh-rows__scale")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /^Share of the gene ids active/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expectAccessible(page);
});

test("Explore: an address that names no graph is a page with its own heading, titled Not found", async ({ page }) => {
  await page.goto("/organisms/no_such_organism");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("No graph named");
  await expect(page).toHaveTitle(/^Not found/);
  await expectAccessible(page);
});

test("Explore: another name of a graph shows its page at the graph's own address, as the api reads the name", async ({
  page,
}) => {
  const answer = (await (await page.request.get("/api/v1/organisms")).json()) as {
    organisms: GraphDescription[];
    names: { organism: string; aliases: string[] }[];
  };
  const organism = data.organism;
  const asked = [
    organism.toUpperCase(),
    organism.replace(/_/g, " "),
    ...(answer.names.find((n) => n.organism === organism)?.aliases ?? []),
  ];
  for (const name of asked) {
    // The api answers the same name with the same graph.
    const api = (await (
      await page.request.get(`/api/v1/organisms/${encodeURIComponent(name)}`)
    ).json()) as GraphDescription;
    expect(api.organism).toBe(organism);
    await page.goto(`/organisms/${encodeURIComponent(name)}`);
    await expect(page).toHaveURL(new RegExp(`/organisms/${organism}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("release by release");
  }
});

test("Explore: the page's title says what it holds; the stories, then the graphs side by side", async ({ page }) => {
  await page.goto("/organisms");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stories from Ensembl's history");
  await expect(page.getByRole("heading", { level: 2, name: "The graphs this server holds" })).toBeVisible();
  // The sums say what idtrack counts: the history's markers of creation and retirement are among them.
  await expect(page.locator(".home-facts")).toContainText("with the markers of an id's creation and retirement");
  await expect(page.locator(".home-facts")).toContainText(
    "from each id's creation to its retirement or the last release",
  );
  await expectAccessible(page);
});

test("Method: the terms of each stage folded behind one line, and a way back to the contents", async ({ page }) => {
  await page.goto("/method");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How idtrack answers, and how often it is right");
  const glossaries = page.locator(".method-glossary > details");
  await expect(glossaries).toHaveCount(5);
  for (const g of await glossaries.all()) {
    await expect(g).not.toHaveAttribute("open", "");
    await expect(g.locator("summary")).toContainText("The terms of this stage:");
  }
  await expect(page.getByRole("link", { name: /^Contents/ })).toHaveCount(0);
  await page.locator("#known-limitations").scrollIntoViewIfNeeded();
  const back = page.getByRole("link", { name: /^Contents/ });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.locator("#method-contents")).toBeInViewport();
  await expectAccessible(page);
});

test("Organism: the counts are text, not stops; the build says how to check a graph file", async ({ page }) => {
  await page.goto(`/organisms/${data.organism}`);
  await expect(page.locator(".counts__row").first()).toBeVisible();
  await expect(page.locator(".counts__row[tabindex]")).toHaveCount(0);
  await expect(page.locator(".counts__meaning").first()).not.toBeEmpty();
  await expect(page.getByText("idtrack verify <graph file>")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("[graphs.main]");
});

test("Method: each stage's path on one lane per stable id, the answer's last steps, every limitation whole", async ({
  page,
}) => {
  await page.goto("/method");
  await scrollThrough(page);
  const lanes = page.locator(".stage-fig__lane");
  const count = await lanes.count();
  if (count) {
    const names = await lanes.allTextContents();
    for (const name of names) expect(name).not.toMatch(/\.\d+$/);
  }
  const answer = page.locator(".answer-fig");
  if (await answer.count()) await expect(answer.first()).toContainText(/Status/);
  const items = page.locator(".limitations-list > li");
  await expect.poll(() => items.count()).toBeGreaterThanOrEqual(26);
  for (const text of await items.allTextContents()) expect(text).not.toMatch(/…/);
  await expect(page.locator(".method-ladder")).not.toContainText("idtrack.engine.ranking");
});
