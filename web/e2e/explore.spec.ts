// Explore and Method against the real server: every stage of the Method page drawn on the real answer its case claims
// (each case converted here and its property read from the api's answer); the benchmarks' rates as the generated file
// holds them, and whether the graphs measured are this server's; Ensembl's id history drawn from the server's own
// counts, and a failed history said with a way to ask again; the assembly changes with their mapping in IDTrack's
// words; the database matrix in its order, what each name holds and a conversion into each; the stories' sentences
// in Ensembl's direction, the journeys ranked, the journey up close with its cautions; the lineage field moved by
// buttons, found by id, and an address's bad release said.
import { expect, test, type Page } from "@playwright/test";
import type {
  ConversionResult,
  DatabasesResponse,
  GraphDescription,
  HistoryResponse,
  ShowcaseResponse,
} from "../src/api/types";
import { databaseLabel } from "../src/lib/databases";
import { readMatrix } from "../src/lib/explore/databaseMatrix";
import { BENCHMARKS, comparable, familyRows, measuredGraph, rateText } from "../src/lib/benchmarks";
import { handoffsOf, MAPPING_WORDS } from "../src/lib/explore/handoffs";
import { historyColumns } from "../src/lib/explore/history";
import { apiQuery } from "../src/lib/home/links";
import { ensemblSteps, walksBack } from "../src/lib/path/steps";
import { storiesOf } from "../src/lib/explore/gallery";
import { holdsStage, STAGE_CASES, stageCase, walkCase } from "../src/lib/method/cases";
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
  const shown = (["read", "bridge", "rank", "answer"] as const)
    .map((stage) => stageCase(stage, digests))
    .filter((c) => c !== null);
  // The walk's case is the showcase's answer of the graph in view chosen by its stated measure: it walks through a
  // split and is drawn, with its thread and replay.
  const current = graphs.find((g) => g.organism === "homo_sapiens") ?? graphs[0];
  if (current) {
    const showcase = (await (
      await page.request.get(`/api/v1/organisms/${current.organism}/showcase`)
    ).json()) as ShowcaseResponse;
    const walk = walkCase(showcase);
    if (walk) {
      expect(holdsStage("walk", walk.result)).toBe(true);
      await page.goto(`/method?stage=walk&organism=${current.organism}`);
      await scrollThrough(page);
      const figure = page.locator("figure.stage-case");
      await expect(figure).toContainText(walk.query.identifier);
      await expect(figure.locator(".stage-fig .stage-thread__lit")).toHaveCount(1);
      await figure.getByRole("button", { name: "Next step" }).click();
      await expect(figure.locator(".stage-replay__readout")).toContainText(/^Step 1 of \d+/);
    }
  }
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
  // One stage at a time: each stage's tab shows its figure.
  await page.goto("/method");
  for (const c of shown) {
    await page.goto(`/method?stage=${c.stage}`);
    await scrollThrough(page);
    const figure = page.locator("figure.stage-case");
    await expect(figure).toHaveCount(1);
    await expect(figure).toContainText(c.query.identifier);
    await expect(figure.getByRole("link", { name: "Open this answer" })).toHaveAttribute(
      "href",
      new RegExp(`id=${encodeURIComponent(c.query.identifier)}`),
    );
    await expect(figure.locator(".stage-case__loading")).toHaveCount(0);
    if (c.stage === "rank") await expect(page.locator(".rank-fig__row--decides")).toHaveCount(1);
    if (c.stage === "read") await expect(page.locator(".read-fig__step--matched")).toHaveCount(1);
  }
  expect(new Set(STAGE_CASES.map((c) => c.stage)).size).toBe(4);
  await expectAccessible(page);
  await shot(page, info, "28-method-stages");
});

test("Method: the benchmarks' rates as published, and whether this server's graphs are the ones measured", async ({
  page,
}, info) => {
  const graphs = await organisms(page);
  await page.goto("/method?accuracy=family");
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
  // No interval of zero width is written, and no part where no answer can be judged right is the weakest.
  const zeroWidth = await table.evaluate((t: HTMLElement) =>
    [...t.innerText.matchAll(/(\d\.\d+)–(\d\.\d+)/g)].filter((m) => m[1] === m[2]).map((m) => m[0]),
  );
  expect(zeroWidth).toEqual([]);
  for (const family of BENCHMARKS.families)
    for (const code of family.strata.wrongOnly)
      await expect(table.locator(".bench__hard", { hasText: code })).toHaveCount(0);
  // The rates in brief: every family's headline rate, one organism at a time, all of them behind a tab; what a
  // family asks in a hover card on its name.
  await page.getByRole("tab", { name: "One organism" }).click();
  const one = page.locator(".accuracy__one");
  const chips = one.getByRole("radiogroup", { name: "The organism measured" }).getByRole("radio");
  await expect(chips.first()).toBeVisible();
  for (let k = 0; k < (await chips.count()); k++) {
    await chips.nth(k).click();
    for (const family of BENCHMARKS.families) await expect(one).toContainText(family.title);
  }
  // What each family is judged against, one press from its rate; a truth that walks Ensembl's history says so there,
  // in the benchmarks' words, and is tagged beside the name.
  for (const family of BENCHMARKS.families) {
    if (!familyRows(family).length) continue;
    await one.getByRole("button", { name: `What ${family.title} is judged against` }).click();
    // The card is drawn over the page, outside the table that holds its trigger.
    const card = page.locator(".accuracy__measures");
    await expect(card).toContainText("Judged against:");
    if (family.truth.history) await expect(card).toContainText("stable_id_event");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  }
  await expect(one.locator(".accuracy__tag")).toHaveCount(BENCHMARKS.families.filter((f) => f.truth.history).length);
  // The organism chosen is kept in the address.
  await chips.last().click();
  await expect(page).toHaveURL(/organism=/);
  await page.getByRole("tab", { name: "All organisms" }).click();
  const summary = page.getByRole("region", { name: "Right / judged per family and organism" });
  for (const family of BENCHMARKS.families) {
    await expect(summary).toContainText(family.title);
    const [first] = familyRows(family);
    for (const row of first?.rows.values() ?? []) await expect(summary).toContainText(rateText(row.rate, row).text);
  }
  await page.getByRole("tab", { name: "Each family whole" }).click();
  // What each family is judged against, and the one source a truth shares with idtrack, are on the page.
  await expect(page.locator(".bench-caveat").first()).toContainText("stable_id_event");
  await expect(table.getByText("What it is judged against")).toHaveCount(BENCHMARKS.families.length);
  const all = graphs.every((g) => measuredGraph(g.organism, g.content_digest));
  await expect(page.locator(".bench__graphs")).toContainText(
    all ? "Measured on the graphs this server holds" : "Measured on other graphs",
  );
  // The tools: each task's rows as the generated file holds them.
  await page.getByRole("tab", { name: "Other tools" }).click();
  const tools = page.getByRole("region", { name: "Tools against idtrack on the same lines" });
  for (const task of Object.keys(BENCHMARKS.tools.tasks)) {
    await page.getByRole("radio", { name: new RegExp(`^${task} `) }).click();
    await expect(tools.locator("tbody tr")).toHaveCount(BENCHMARKS.tools.tools.filter((t) => t.task === task).length);
    const apart = BENCHMARKS.tools.tools
      .filter((t) => t.task === task)
      .flatMap((t) => t.cells.filter((c) => c !== null && !comparable(c)));
    await expect(tools.locator(".tools__apart")).toHaveCount(apart.length);
  }
  await page.getByRole("button", { name: "Cite IDTrack" }).click();
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
  expect(response.status()).toBe(200);
  await page.goto("/organisms?tab=graphs");
  await expect(page.getByRole("heading", { name: "Ensembl's id history, release by release" })).toBeVisible();
  await page.goto(`/organisms/${data.organism}`);
  // The assemblies: every change of the serving assembly, with whether Ensembl maps it, in IDTrack's words, in the
  // assembly's row opened.
  const assemblies = page.getByRole("region", { name: "Assemblies", exact: true });
  await expect(assemblies.locator(".expandable__summary").first()).toBeVisible();
  for (const row of await assemblies.locator(".expandable__summary").all()) await row.click();
  for (const h of handoffsOf(graph)) await expect(assemblies).toContainText(MAPPING_WORDS[h.mapping]);
  {
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByRole("radio", { name: "Counts per release" }).click();
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
  await page.getByRole("tab", { name: "Databases by release" }).click();
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
  await page.getByRole("button", { name: /^What each database name holds/ }).click();
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

test("Organism: a history the server refuses is said where it is drawn, with a way to ask again", async ({ page }) => {
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
  await page.goto(`/organisms/${data.organism}?tab=databases`);
  await expect(page.locator(".dbm svg")).toBeVisible();
  await page.goto(`/organisms/${data.organism}?tab=history`);
  await page.getByRole("radio", { name: "Counts per release" }).click();
  await expect(page.getByText("The history could not be read")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Explore: a graph whose history fails says so in its row, with a way to ask again; shares on one axis", async ({
  page,
}) => {
  const graphs = await organisms(page);
  const failing = graphs[0]?.organism ?? data.organism;
  expect((await page.request.get(`/api/v1/organisms/${failing}/history`)).status()).toBe(200);
  await page.route(`**/api/v1/organisms/${failing}/history`, (route) => route.abort());
  await page.goto("/organisms?tab=graphs");
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

test("Organism: an address that names a release of the history shows that release's exact counts", async ({ page }) => {
  const response = await page.request.get(`/api/v1/organisms/${data.organism}/history`);
  expect(response.status()).toBe(200);
  const columns = historyColumns((await response.json()) as HistoryResponse).filter((c) => !c.first);
  const column = columns[Math.floor(columns.length / 2)];
  if (!column) return;
  await page.goto(`/organisms/${data.organism}?release=${column.release}`);
  await expect(page.getByRole("tooltip")).toContainText(`Release ${column.release}`);
  await expect(page.getByRole("tooltip")).toContainText(groupedInteger(column.genes));
});

test("Explore: the page's title says what it holds; the stories, then the graphs side by side", async ({ page }) => {
  const graphsHeld = (await organisms(page)).length;
  await page.goto("/organisms");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stories from Ensembl's history");
  // Two tabs: the stories first (the organism's chips above them), the graphs side by side.
  // (on a phone, one menu of the graphs)
  if (graphsHeld > 1)
    await expect(
      page
        .getByRole("radiogroup", { name: "Stories of the graph" })
        .or(page.getByRole("combobox", { name: "Stories of the graph" })),
    ).toBeVisible();
  await page.getByRole("tab", { name: /^The graphs/ }).click();
  await expect(page).toHaveURL(/tab=graphs/);
  // The tab's name is not said again as a heading; its sums in a few words each, what each counts in a hover card:
  // the history's markers of creation and retirement are among what IDTrack counts.
  await expect(page.getByRole("heading", { name: "The graphs this server holds" })).toHaveCount(0);
  await expect(page.locator(".home-facts")).toContainText("identifiers");
  await page.getByRole("button", { name: 'What "identifiers" counts' }).click();
  await expect(page.locator(".fact__definition")).toContainText("with the markers of an id's creation and retirement");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: 'What "history edges" counts' }).click();
  await expect(page.locator(".fact__definition")).toContainText(
    "from each id's creation to its retirement or the last release",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "How each is summed" }).click();
  await expect(page.locator(".facts__sources")).toContainText("counts.nodes");
  await expectAccessible(page);
});

test("Method: the terms of each stage folded behind one line", async ({ page }) => {
  await page.goto("/method");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How IDTrack answers, and how often it is right");
  // Read, walk, bridge and answer fold their lists of terms; rank's ladder of criteria is its figure.
  let folded = 0;
  for (const stage of ["read", "walk", "bridge", "rank", "answer"]) {
    await page.goto(`/method?stage=${stage}`);
    await expect(page.locator(".method-panel").first()).toBeVisible();
    const glossary = page.locator(".method-glossary > .expandable__summary");
    folded += await glossary.count();
    for (const g of await glossary.all()) {
      await expect(g).toHaveAttribute("aria-expanded", "false");
      await expect(g).toContainText("The terms of this stage");
    }
  }
  expect(folded).toBe(4);
  await expectAccessible(page);
});

test("Organism: the counts are text, not stops; the build says how to check a graph file", async ({ page }) => {
  await page.goto(`/organisms/${data.organism}`);
  await expect(page.locator(".counts__row").first()).toBeVisible();
  await expect(page.locator(".counts__row[tabindex]")).toHaveCount(0);
  // Each row one line; what IDTrack says a count is, in a hover card on its (i).
  await page.locator(".counts__about .hint__trigger").first().click();
  await expect(page.locator(".counts__meaning").first()).not.toBeEmpty();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Build" }).click();
  await expect(page.getByText("idtrack verify <graph file>")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("[graphs.main]");
});

test("Method: each stage's path on one lane per stable id, the answer's last steps, every limitation whole", async ({
  page,
}) => {
  for (const stage of ["walk", "bridge"]) {
    await page.goto(`/method?stage=${stage}`);
    await scrollThrough(page);
    const lanes = page.locator(".stage-fig__lane");
    const count = await lanes.count();
    if (count) {
      const names = await lanes.allTextContents();
      for (const name of names) expect(name).not.toMatch(/\.\d+$/);
    }
  }
  await page.goto("/method?stage=answer");
  await scrollThrough(page);
  const answer = page.locator(".answer-fig");
  if (await answer.count()) await expect(answer.first()).toContainText(/Status/);
  await page.getByRole("button", { name: /^And \d+ more/ }).click();
  const items = page.locator(".limitations-list > li");
  await expect.poll(() => items.count()).toBeGreaterThanOrEqual(26);
  // Each limitation a row by its title; opened, its whole first sentence, never cut short, and its section.
  for (const row of await items.all()) {
    await row.locator(".expandable__summary").click();
    await expect(row.locator(".limitations-list__lead")).toBeVisible();
    await expect(row.locator(".limitations-list__link")).toHaveAttribute("href", /#/);
  }
  for (const text of await items.allTextContents()) expect(text).not.toMatch(/…/);
  // A criterion's meaning is read for a person: an aside of code is left out of the figure's cards.
  await page.goto("/method?stage=rank");
  await scrollThrough(page);
  const terms = page.locator(".rank-fig .defined__trigger");
  if (await terms.count()) {
    for (const term of await terms.all()) {
      await term.click();
      await expect(page.locator(".defined__meaning")).not.toContainText("idtrack.engine.ranking");
      await page.keyboard.press("Escape");
    }
  }
});

test("Organism: the History tab's lineage field, by keyboard: a line's words read out, Enter opens it in Convert", async ({
  page,
}, info) => {
  const lineages = await page.request.get(`/api/v1/organisms/${data.organism}/lineages?limit=50`);
  expect(lineages.status()).toBe(200);
  await page.goto(`/organisms/${data.organism}?tab=history`);
  await expect(page.getByRole("radio", { name: "Every id, a line" })).toBeChecked();
  const field = page.getByRole("application", { name: /^The lineages of [\d  ,]+ gene ids of the/ });
  await field.focus();
  const readout = page.locator(".lineage-field__readout");
  await expect(readout).toContainText(/active at \d+/);
  const first = (await readout.locator(".mono").first().innerText()).trim();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(readout).toContainText(/Convert it from release \d+/);
  // The view zooms along the releases and back.
  await page.keyboard.press("+");
  await expect(page.locator(".lineage-field__view")).toContainText(" of ");
  await page.getByRole("button", { name: "All releases" }).click();
  await expect(page.locator(".lineage-field__view")).not.toContainText(" of ");
  await expectAccessible(page);
  await shot(page, info, "31-organism-lineages");
  await field.focus();
  const id = (await readout.locator(".mono").first().innerText()).trim();
  expect(id.length).toBeGreaterThan(0);
  expect(first.length).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/convert\\?organism=${data.organism}&id=${id}&from=\\d+`));
});

test("Explore: every gallery sentence writes a step in Ensembl's direction, and a walk back in time as one", async ({
  page,
}) => {
  const showcase = (await (
    await page.request.get(`/api/v1/organisms/${data.organism}/showcase`)
  ).json()) as ShowcaseResponse;
  await page.goto(`/organisms?organism=${data.organism}`);
  // A graph whose showcase holds no cases draws no gallery: nothing to read.
  if (!storiesOf(showcase).cases.length) return;
  const cards = page.locator("li.case");
  await expect(cards.first()).toBeVisible();
  for (const c of storiesOf(showcase).cases) {
    const r = c.result;
    if (!r || !["merge", "replaced", "split"].includes(c.kind)) continue;
    // The card of this case: its kind, and its line naming its identifier.
    const card = page
      .locator(`li.case[data-kind="${c.kind}"]`)
      .filter({ has: page.locator(".case__line", { hasText: c.query.identifier }) })
      .first();
    await card.getByRole("button", { name: /^About this case/ }).click();
    // The hover card is drawn over the page, named by its trigger.
    const story = page.getByRole("region", { name: /^About this case/ }).locator(".case__story");
    const steps = ensemblSteps(r);
    // The step the card writes: the kind's own reason first, then the combined one (as the card chooses it).
    const reasons =
      c.kind === "split"
        ? ["split", "split_and_merge"]
        : c.kind === "merge"
          ? ["merge", "split_and_merge"]
          : ["replaced"];
    const s = reasons.map((reason) => steps.find((e) => e.step.reason === reason)).find(Boolean);
    if (s) {
      // The later id is the merge's product or the replacement, whichever way the walk went.
      if (c.kind === "replaced") await expect(story).toContainText(`replaced ${s.earlier ?? ""} by ${s.later}`);
      else await expect(story).toContainText(` into ${s.later}`);
      if (s.backward) await expect(story).toContainText(`the walk followed it back, from ${s.later}`);
    }
    if (c.kind === "split") await expect(story).not.toContainText(walksBack(r) ? "descend" : "ancestors");
    if (walksBack(r))
      await expect(page.getByRole("region", { name: /^About this case/ }).locator(".case__concept")).toContainText(
        "the walk runs back in time",
      );
    await page.keyboard.press("Escape");
  }
  // The cards stand on rows of one height: the kinds' names of one row share their line.
  const tops = await page
    .locator("li.case .case__title")
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + window.scrollY)));
  const columns = await page
    .locator("ol.cases")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  for (let k = 0; k + columns <= tops.length; k += columns)
    expect(new Set(tops.slice(k, k + columns)).size, `row ${k / columns + 1}`).toBe(1);
  await expectAccessible(page);
});

test("Explore: the journeys drawn are the most convoluted, without their ids at rest; all of them one press away", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/organisms?organism=${data.organism}`);
  const figure = page.locator(".journeys__svg");
  await expect(figure.locator(".jr-row").first()).toBeVisible();
  // At rest, no id is written on the rows; pointing at one names it.
  await expect(page.locator(".jr-names text")).toHaveCount(0);
  const drawn = await figure.locator(".jr-row").count();
  await figure.locator(".jr-row").first().focus();
  await expect(page.locator(".jr-names text").first()).toBeVisible();
  // Its key is a hover card.
  await page.getByRole("button", { name: "Key: reading the journeys" }).click();
  await expect(page.getByRole("list", { name: "The marks of the journeys" })).toBeVisible();
  await page.keyboard.press("Escape");
  // "Draw all" draws every journey; the filter keeps those of one kind.
  const all = page.getByRole("button", { name: /^Draw all \d+/ });
  const total = Number((await all.innerText()).replace(/\D+/g, ""));
  await all.click();
  await expect(figure.locator(".jr-row")).toHaveCount(total);
  expect(total).toBeGreaterThanOrEqual(drawn);
  await page.getByRole("radio", { name: "Back in time" }).click();
  for (const row of await figure.locator(".jr-row").all()) await expect(row).toHaveClass(/jr-row--back/);
  await shot(page, info, "32-explore-journeys");
});

test("Explore: the journey up close states its answer's cautions and names a bridge in its key", async ({ page }) => {
  const showcase = (await (await page.request.get(`/api/v1/organisms/${data.organism}/showcase`)).json()) as {
    cases: { kind: string; result: ConversionResult | null }[];
  };
  const lineage = showcase.cases.find((c) => c.kind === "lineage" && c.result)?.result;
  await page.goto(`/organisms?organism=${data.organism}`);
  if (!lineage) return;
  const up = page.locator("figure.hero-figure");
  await expect(up).toBeVisible();
  for (const caution of lineage.cautions.filter((c) => c.tone === "caution"))
    await expect(up.locator(".hero-figure__cautions")).toContainText(caution.label);
  const bridged = ensemblSteps(lineage).some((s) => s.step.kind === "bridge_near");
  if (bridged) await expect(up.locator(".fig-legend")).toContainText("A bridge, IDTrack's inference");
  // The replay writes each step as a sentence, its ids on a line of their own.
  await up.getByRole("button", { name: "Next step" }).click();
  await expect(page.locator(".replay__words")).toContainText(/^Step 1 of \d+\./);
  await expect(page.locator(".replay__values")).not.toBeEmpty();
});

test("Organism: the tabs start on the first screen; the lineage field moves by buttons, finds an id, and the address's bad release is said", async ({
  page,
}) => {
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/organisms/${data.organism}`);
    const tabs = page.getByRole("tablist", { name: /graph in detail$/ });
    await expect(tabs).toBeVisible();
    const box = await tabs.boundingBox();
    expect(box && box.y + box.height, `${width}x${height}`).toBeLessThanOrEqual(height);
  }
  // Each assembly is named once, at its bar; its row opens it.
  const graph = (await organisms(page)).find((g) => g.organism === data.organism);
  for (const a of graph?.assemblies ?? [])
    if (a.name) await expect(page.locator(".astrip__name", { hasText: a.name })).toHaveCount(1);
  // A release the graph does not hold, in the address: said, as Convert says it.
  await page.goto(`/organisms/${data.organism}?tab=history&release=abc`);
  await expect(page.getByRole("alert")).toContainText("Not a release: abc");
  await page.goto(`/organisms/${data.organism}?tab=history&release=0`);
  await expect(page.getByRole("alert")).toContainText("Not a release of this graph: 0");
  await page.getByRole("button", { name: "Show every release" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The field: zoomed in, the earlier and later buttons move the view by half of it, without a drag.
  await page.getByRole("radio", { name: "Every id, a line" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const view = page.locator(".lineage-field__view");
  const before = await view.innerText();
  await page.getByRole("button", { name: "Earlier releases" }).click();
  await expect(view).not.toHaveText(before);
  await page.getByRole("button", { name: "Later releases" }).click();
  await expect(view).toHaveText(before);
  // An id found by its name is lifted and read out.
  const lineages = (await (await page.request.get(`/api/v1/organisms/${data.organism}/lineages?limit=50`)).json()) as {
    ids: string[];
  };
  const id = lineages.ids[0];
  if (id) {
    await page.getByRole("searchbox", { name: "An id of this graph" }).fill(id.toLowerCase());
    await page.getByRole("button", { name: "Find" }).click();
    await expect(page.locator(".lineage-field__readout")).toContainText(id);
    await page.goto(`/organisms/${data.organism}?tab=history&id=${id}`);
    await expect(page.locator(".lineage-field__readout")).toContainText(id);
  }
  // A database row leads to a conversion into it.
  await page.goto(`/organisms/${data.organism}?tab=databases`);
  const link = page.getByRole("list", { name: "The matrix, one database a line" }).getByRole("link").first();
  await expect(link).toHaveAttribute("href", /\/convert\?organism=[^&]+&to=\d+&db=/);
  await expectAccessible(page);
});
