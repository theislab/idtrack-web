// The batch, names, Explore and Method pages, with real answers; exports equal to the api's own bytes.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { groupedInteger, releaseRanges } from "../src/lib/numbers";
import { spaced, statusTitle } from "../src/lib/vocabulary";
import { data, expectAccessible, expectWholeAndTyped, isPhone, shot } from "./helpers";

test("a batch: results in order with each status, exported as the api returned them", async ({ page }, info) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await expect(page.getByText("No list converted yet")).toBeVisible();
  await shot(page, info, "20-batch-empty");
  await page.getByLabel("Identifiers", { exact: true }).fill(data.batch.join("\n"));
  await page.getByRole("button", { name: /^Convert/ }).click();
  const table = page.getByRole("region", { name: /^Results: / });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(data.batch.length);
  for (const [i, identifier] of data.batch.entries())
    await expect(rows.nth(i).locator("td").nth(1)).toContainText(identifier);

  // The page asks with every path; the api's JSON it saves is that answer, byte for byte.
  const body = {
    identifiers: data.batch,
    from_release: null,
    to_release: null,
    final_database: null,
    from_database: null,
    explain: true,
    allow_bridges: true,
  };
  const json = await page.request.post(`/api/v1/organisms/${data.organism}/convert/batch?format=json`, { data: body });
  const parsed = (await json.json()) as { results: { status: string }[] };
  for (const [i, result] of parsed.results.entries()) {
    await expect(rows.nth(i)).toContainText(statusTitle(result.status));
  }
  // The files are in the drawer "Download and cite".
  await page.getByRole("button", { name: "Download and cite" }).click();
  await expect(page.getByRole("dialog", { name: "Download and cite" })).toBeVisible();
  const downloadJson = page.waitForEvent("download");
  await page.getByRole("button", { name: /api.s JSON$/ }).click();
  const savedJson = readFileSync(await (await downloadJson).path(), "utf8");
  expect(savedJson).toBe(await json.text());

  // The api's TSV (no path in it) is asked again without the paths: the same table of the same graph and settings.
  const tsv = await page.request.post(`/api/v1/organisms/${data.organism}/convert/batch?format=tsv`, {
    data: { ...body, explain: false },
  });
  const downloadTsv = page.waitForEvent("download");
  await page.getByRole("button", { name: /api.s TSV$/ }).click();
  const savedTsv = readFileSync(await (await downloadTsv).path(), "utf8");
  expect(savedTsv).toBe(await tsv.text());
  // The table of one row per identifier: its provenance first (the graph's digest, the versions, the request), then
  // one row per identifier in the order given, each with its status as the api gave it.
  const version = (await (await page.request.get("/api/v1/version")).json()) as {
    idtrack_version: string;
    graphs: { organism: string; content_digest: string }[];
  };
  const downloadTable = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save the table as TSV" }).click();
  const exported = readFileSync(await (await downloadTable).path(), "utf8")
    .trimEnd()
    .split("\n");
  const comments = exported.filter((l) => l.startsWith("#")).join("\n");
  const digest = version.graphs.find((g) => g.organism === data.organism)?.content_digest ?? "";
  expect(comments).toContain(digest);
  expect(comments).toContain(`idtrack ${version.idtrack_version}`);
  expect(comments).toContain(`/organisms/${data.organism}/convert/batch`);
  const rowsOut = exported.filter((l) => !l.startsWith("#"));
  expect(rowsOut).toHaveLength(data.batch.length + 1);
  const columns = rowsOut[0]?.split("\t") ?? [];
  for (const [i, result] of parsed.results.entries()) {
    const cells = rowsOut[i + 1]?.split("\t") ?? [];
    expect(cells[0]).toBe(String(i + 1));
    expect(cells[columns.indexOf("identifier")]).toBe(data.batch[i]);
    expect(cells[columns.indexOf("status")]).toBe(result.status);
  }
  const downloadProvenance = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save the provenance" }).click();
  const provenance = JSON.parse(readFileSync(await (await downloadProvenance).path(), "utf8")) as {
    graph: { content_digest: string };
    request: { body: { identifiers: string[] }; resolved: { to_release: number } };
  };
  expect(provenance.graph.content_digest).toBe(digest);
  // The target the server answered at is pinned beside the request as sent.
  expect(provenance.request.resolved.to_release).toBe(
    (parsed.results[0] as unknown as { to_release: number }).to_release,
  );
  expect(provenance.request.body.identifiers).toEqual(data.batch);
  // The TSV was a second request: the provenance names it.
  expect((provenance as unknown as { tsv: { request_id: string | null } | null }).tsv?.request_id).toBeTruthy();
  await expectAccessible(page);
  await shot(page, info, "21-batch-results");
});

test("a batch's figure: the statuses counted, sorted, filtered, opened to every candidate", async ({ page }, info) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(data.batch.join("\n"));
  const answer = page.waitForResponse((r) => r.url().includes("/convert/batch"));
  await page.getByRole("button", { name: /^Convert/ }).click();
  const response = await answer;
  const parsed = (await response.json()) as {
    results: {
      query_id: string;
      status: string;
      from_release: number | null;
      from_release_inferred: boolean;
      to_release: number;
      no_target: boolean;
      candidates: { target: string; gene: string; best: boolean; bridges: number }[];
    }[];
  };
  const table = page.getByRole("region", { name: /^Results: / });
  const rows = table.locator("tbody:not(.batch-spacer) > tr");
  await expect(rows).toHaveCount(data.batch.length);

  // Panel a: each status's count, as the answer has it; the server's time from its header, as it sent it.
  const counts = new Map<string, number>();
  for (const r of parsed.results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const legend = page.locator(".slegend");
  for (const [status, n] of counts) {
    await expect(legend.locator(".slegend__item", { hasText: statusTitle(status) })).toContainText(String(n));
  }
  // The api times every answer (Server-Timing); the page states the header of its own answer, as sent, with the unit
  // kept beside the number.
  const timing = /app;dur=([^,;]+)/.exec(response.headers()["server-timing"] ?? "");
  expect(timing, "the batch's answer carries Server-Timing").not.toBeNull();
  await page.getByRole("button", { name: "Download and cite" }).click();
  await expect(page.locator(".batch-figure-head__time")).toContainText(`answered in ${timing?.[1] ?? "-"}\u00a0ms`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Download and cite" })).toBeHidden();
  // How the batch was answered: one press away, under the statuses.
  await page.getByRole("button", { name: /^How the batch was answered/ }).click();
  // The counts: one numeral face, words for people (no field names), each count of rows from the answer.
  const inferred = parsed.results.filter((r) => r.from_release !== null && r.from_release_inferred).length;
  const inferredCount = page.locator(".count", { hasText: "Read at a release inferred" });
  if (inferred) await expect(inferredCount.locator(".count__value .mono")).toHaveText(String(inferred));
  else await expect(page.locator(".counts__none")).toContainText("read at a release inferred");
  for (const sub of await page.locator(".count__label, .count__sub").allInnerTexts())
    expect(sub, "a count's words name no field of the api").not.toMatch(/[a-z]+_[a-z]+|\[|\]|≠/);
  const countFaces = await page
    .locator(".count__value .mono")
    .evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fontFamily))]);
  expect(countFaces.length).toBeLessThanOrEqual(1);
  // A count's button keeps its name when pressed (its state is aria-pressed), and shows only its rows.
  const care = page.getByRole("button", { name: /^Show only these rows: Answers that need care/ });
  if ((await care.count()) > 0) {
    const name = await care.getAttribute("aria-label");
    await care.click();
    await expect(care).toHaveAttribute("aria-pressed", "true");
    expect(await care.getAttribute("aria-label")).toBe(name);
    await care.click();
  }
  // Every row gives the gene of its best answer; an answer of several different identifiers says so under it; an
  // answer through a bridge carries its mark.
  const byTarget = new Map<string, Set<string>>();
  for (const r of parsed.results)
    for (const c of r.candidates.filter((x) => x.best && !r.no_target))
      byTarget.set(c.target, (byTarget.get(c.target) ?? new Set()).add(r.query_id));
  for (const [i, r] of parsed.results.entries()) {
    const best = r.candidates.filter((c) => c.best);
    for (const c of best.slice(0, 3)) await expect(rows.nth(i).locator(".b-gene")).toContainText(c.gene);
    const shared = !r.no_target && best.some((c) => (byTarget.get(c.target)?.size ?? 0) > 1);
    await expect(rows.nth(i).locator(".batch-shared")).toHaveCount(shared ? 1 : 0);
    const bridged = best.some((c) => c.bridges > 0);
    await expect(rows.nth(i).locator(".emark", { hasText: /through .*bridge/ })).toHaveCount(bridged ? 1 : 0);
  }

  // Panel b: a status shows only its rows; the sort by status follows the vocabulary's order. The tools of a short
  // table are folded behind one line, so that its rows come first.
  const tools = page.locator("details.batch-tools");
  if ((await tools.getAttribute("open")) === null) await tools.locator("summary").click();
  for (const [status, n] of counts) {
    const chip = page
      .locator(".batch-tools__filters")
      .getByRole("button", { name: new RegExp(`^${statusTitle(status)}`) });
    await chip.click();
    await expect(rows).toHaveCount(n);
    await chip.click();
  }
  await expect(rows).toHaveCount(data.batch.length);
  if (isPhone(info)) await page.getByLabel("Sort by").selectOption("identifier|desc");
  else {
    await table.getByRole("button", { name: /^Identifier/ }).click();
    await table.getByRole("button", { name: /^Identifier/ }).click();
    await expect(table.locator("th[aria-sort=descending]")).toContainText("Identifier");
  }
  const sorted = [...data.batch].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  await expect(rows.first().locator("td").nth(1)).toContainText(sorted[0] ?? "");
  if (isPhone(info)) await page.getByLabel("Sort by").selectOption("order|asc");
  else await table.getByRole("button", { name: /^#/ }).click();

  // A row opens to every candidate, ranked as the api ranks them, and links to the conversion with its path.
  const index = parsed.results.findIndex((r) => r.candidates.length > 0);
  const result = parsed.results[index];
  expect(result).toBeDefined();
  await rows.nth(index).getByRole("button", { expanded: false }).click();
  const detail = page.locator(`#batch-detail-${index}`);
  await expect(detail).toBeVisible();
  for (const candidate of result?.candidates ?? []) await expect(detail).toContainText(candidate.target);
  const link = rows.nth(index).getByRole("link", { name: `Path of ${result?.query_id ?? ""}` });
  await expect(link).toHaveAttribute("href", new RegExp(`id=${encodeURIComponent(result?.query_id ?? "")}`));
  await expectAccessible(page);
  await shot(page, info, "25-batch-opened");
});

test("a batch of 1000 results draws the rows in view and reaches every row", async ({ page }) => {
  // The answer of the server's largest batch, made of the graph's real answers repeated (the server's own answer
  // of 1000 identifiers is checked above for its bound); what is checked here is the page's drawing of them.
  const body = {
    identifiers: data.batch,
    from_release: null,
    to_release: null,
    final_database: null,
    from_database: null,
    explain: false,
    allow_bridges: true,
  };
  const real = (await (
    await page.request.post(`/api/v1/organisms/${data.organism}/convert/batch?format=json`, { data: body })
  ).json()) as { results: { query_id: string }[] };
  const results = Array.from({ length: 1000 }, (_, i) => real.results[i % real.results.length]);
  // The server's own answer with its results made a thousand: every other field of the answer as the api sends it.
  await page.route("**/convert/batch?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-request-id": "e2e" },
      body: JSON.stringify({ ...real, count: results.length, results }),
    }),
  );
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(results.map((r) => r?.query_id ?? "").join("\n"));
  await page.getByRole("button", { name: /^Convert/ }).click();
  const table = page.getByRole("region", { name: /^Results: / });
  const rows = table.locator("tbody:not(.batch-spacer) > tr");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThan(200);
  await expect(page.locator(".batch-tools__shown")).toContainText("All 1 000 rows");
  const last = await page.evaluate(async () => {
    const wrap = document.querySelector<HTMLElement>(".table--batch")?.closest<HTMLElement>(".table-wrap");
    wrap?.scrollIntoView({ block: "end" });
    for (let k = 0; k < 6; k++) {
      if (wrap && getComputedStyle(wrap).maxHeight !== "none") wrap.scrollTop = wrap.scrollHeight;
      else window.scrollTo(0, document.documentElement.scrollHeight);
      for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    }
    const shown = [...document.querySelectorAll(".table--batch tbody:not(.batch-spacer) .batch-index .mono")];
    return shown.at(-1)?.textContent ?? "";
  });
  expect(last).toBe("1000");
  // Deep in the middle, the rows there are drawn, numbered as in the input, and the columns stand where they stood.
  const middle = await page.evaluate(async () => {
    const wrap = document.querySelector<HTMLElement>(".table--batch")?.closest<HTMLElement>(".table-wrap");
    const table = document.querySelector<HTMLElement>(".table--batch");
    const head = [...document.querySelectorAll(".table--batch thead th")].map((th) => th.getBoundingClientRect().width);
    if (wrap && getComputedStyle(wrap).maxHeight !== "none") wrap.scrollTop = wrap.scrollHeight / 2;
    else
      window.scrollTo(0, (table?.getBoundingClientRect().top ?? 0) + window.scrollY + (table?.offsetHeight ?? 0) / 2);
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
    const shown = [...document.querySelectorAll(".table--batch tbody:not(.batch-spacer) .batch-index .mono")].map((e) =>
      Number(e.textContent),
    );
    const after = [...document.querySelectorAll(".table--batch thead th")].map(
      (th) => th.getBoundingClientRect().width,
    );
    return { shown, same: head.every((w, i) => Math.abs(w - (after[i] ?? 0)) < 0.5) };
  });
  expect(middle.shown.some((n) => n > 300 && n < 700)).toBe(true);
  expect(middle.shown).toEqual([...middle.shown].sort((a, b) => a - b));
  expect(middle.same).toBe(true);
  // The pointer rests where Convert was pressed: rows scrolled under it would open a mark's card over its cell (a layer
  // over the page, not a value of the cell); it is moved away before the cells are measured.
  await page.mouse.move(0, 0);
  await expect(page.locator(".table--batch .toggletip__card")).toHaveCount(0);
  await expectWholeAndTyped(page);
});

test("a batch from a file", async ({ page }) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await page.locator("#batch-file").setInputFiles({
    name: "ids.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(data.batch.map((id) => `${id},x`).join("\n")),
  });
  await expect(page.locator(".batch-form__file-note")).toContainText(`${data.batch.length} identifiers`);
  await expect(page.getByLabel("Identifiers", { exact: true })).toHaveValue(
    data.batch.map((id) => `${id},x`).join("\n"),
  );
});

test("a pasted table: its header found by the form of its cells, its column read, its columns kept", async ({
  page,
}, info) => {
  await page.goto(`/batch?organism=${data.organism}`);
  const table = ["identifier\tlog2FC", ...data.batch.map((id, i) => `${id}\t${String(-1.5 + i)}`)].join("\n");
  await page.getByLabel("Identifiers", { exact: true }).fill(table);
  const note = page.locator(".batch-form__table-note");
  await expect(note).toContainText("first line is taken as the header");
  await expect(note).toContainText("column 1 (identifier) is read");
  await expect(page.locator(".batch-form__count .mono").first()).toHaveText(String(data.batch.length));
  await shot(page, info, "26-batch-table-pasted");
  await page.getByRole("button", { name: /^Convert/ }).click();
  const rows = page.getByRole("region", { name: /^Results: / }).locator("tbody:not(.batch-spacer) > tr");
  await expect(rows).toHaveCount(data.batch.length);
  await page.getByRole("button", { name: "Download and cite" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save the table as TSV" }).click();
  const lines = readFileSync(await (await download).path(), "utf8")
    .trimEnd()
    .split("\n")
    .filter((l) => !l.startsWith("#"));
  expect(lines[0]?.split("\t").slice(0, 4)).toEqual(["index", "line", "identifier", "log2FC"]);
  for (const [i, id] of data.batch.entries()) {
    const cells = lines[i + 1]?.split("\t") ?? [];
    expect(cells.slice(0, 4)).toEqual([String(i + 1), String(i + 2), id, String(-1.5 + i)]);
  }
  await page.keyboard.press("Escape");
  // The person can say otherwise: with the header switched off, its line is an identifier too.
  await page.getByRole("switch", { name: "First line is a header" }).uncheck();
  await expect(page.locator(".batch-form__count .mono").first()).toHaveText(String(data.batch.length + 1));
  await expectAccessible(page);
});

test("the batch before a list: what will appear, and an example to try", async ({ page }, info) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await expect(page.getByText("No list converted yet")).toBeVisible();
  // The examples are the Convert page's sets, each with its settings, which fill the form.
  const examples = page.locator(".batch-examples__set");
  if ((await examples.count()) === 0) return;
  const showcase = (await (await page.request.get(`/api/v1/organisms/${data.organism}/showcase`)).json()) as {
    journeys: { query: { identifier: string; from_release: number | null } }[];
  };
  await examples.first().click();
  const value = await page.getByLabel("Identifiers", { exact: true }).inputValue();
  const first = showcase.journeys[0]?.query;
  expect(value.split("\n")[0]).toBe(first?.identifier);
  // The examples fill the setting too, folded under its line (which says it).
  await page.getByRole("button", { name: /^Setting for every identifier/ }).click();
  await expect(page.getByLabel("From release")).toHaveValue(
    first?.from_release === null || first === undefined ? "" : String(first.from_release),
  );
  await page.getByRole("button", { name: /^Convert/ }).click();
  await expect(page.getByRole("region", { name: /^Results: / })).toBeVisible();
  await expectWholeAndTyped(page);
  await shot(page, info, "27-batch-example");
});

test("a batch over the server's bound is refused with the bound before it is sent", async ({ page }, info) => {
  let sent = 0;
  await page.route("**/convert/batch?*", (route) => {
    sent += 1;
    return route.continue();
  });
  const limits = (await (await page.request.get("/api/v1/limits")).json()) as { batch_max: number };
  await page.goto(`/batch?organism=${data.organism}`);
  await page
    .getByLabel("Identifiers", { exact: true })
    .fill(Array.from({ length: limits.batch_max + 1 }, (_, i) => `ID${i}`).join("\n"));
  await page.getByRole("button", { name: /^Convert/ }).click();
  // The server's bound, from /limits, said where the list is, with what to do; nothing is sent.
  const field = page.getByLabel("Identifiers", { exact: true });
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const digits = String(limits.batch_max).replace(/\B(?=(\d{3})+$)/g, "\\D?");
  await expect(page.getByText(/this server converts at most/)).toContainText(
    new RegExp(`at most ${digits} per request`),
  );
  expect(sent).toBe(0);
  await shot(page, info, "22-batch-too-many");
});

test("names: the genes a name names, then the names of one of them", async ({ page }, info) => {
  await page.goto(`/names?organism=${data.organism}`);
  await page.getByLabel("Name", { exact: true }).fill(data.name);
  await page.getByRole("button", { name: "Find genes" }).click();
  const matches = page.getByRole("region", { name: /^The genes .+ names$/ }).first();
  await expect(matches).toBeVisible();
  const answer = (await (
    await page.request.get(`/api/v1/organisms/${data.organism}/genes-named?name=${encodeURIComponent(data.name)}`)
  ).json()) as { matches: { gene: string; releases: number[] }[] };
  // Genes are counted by their id, versions apart; each gene is a group with its versions, and links to its names.
  const ids = [...new Set(answer.matches.map((m) => m.gene.replace(/\.\d+$/, "")))];
  const versions = new Set(answer.matches.map((m) => m.gene)).size;
  await expect(page.locator(".names-summary").first()).toContainText(`${String(ids.length)} gene`);
  await expect(page.locator(".names-summary").first()).toContainText(`${String(versions)} version`);
  const groups = matches.locator("tbody.names-gene");
  await expect(groups).toHaveCount(Math.min(ids.length, 12));
  const firstGene = (await groups.first().locator(".names-gene__id .mono").first().innerText()).trim();
  const latest = answer.matches
    .map((m) => m.gene)
    .filter((g) => g.startsWith(`${firstGene}.`))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .at(-1);
  await groups.first().locator(".names-gene__id").getByRole("link").click();
  await expect(page.getByLabel("Ensembl gene, with version")).toHaveValue(latest ?? "");
  // One question at a time, each table named by what it holds: the names of the gene opened, and the genes the name
  // names one press back, both kept in the address.
  await expect(page.getByRole("region", { name: /^The names of / })).toHaveCount(1);
  await expect(page.getByRole("region", { name: /^The genes .+ names$/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "A name → its genes" }).click();
  await expect(page.getByRole("region", { name: /^The genes .+ names$/ })).toHaveCount(1);
  // Every match is its version's exact releases in words on its gene's lane, as the api gives them.
  const first = page.getByRole("region", { name: /^The genes .+ names$/ });
  if (ids.length <= 12) {
    // Each lane shows its first versions and the rest on a press.
    for (const more of await first.locator(".names-exact__more").all()) await more.click();
    await expect(first.locator(".names-exact__line")).toHaveCount(answer.matches.length);
    const written = await first.locator(".names-exact__line").allInnerTexts();
    for (const m of answer.matches) expect(written.some((w) => w.includes(releaseRanges(m.releases)))).toBe(true);
  }
  // What the databases call each gene at the graph's last release, asked of the server.
  await expect(first.locator(".names-today").first()).toContainText("at ");
  const rows = first.locator("tr.names-lane-row");
  if (!isPhone(info)) {
    // The answer asked by the link is brought into view (a smooth scroll): hover once the page stands still.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let last = -1;
          const check = () => {
            if (window.scrollY === last) resolve();
            else {
              last = window.scrollY;
              window.setTimeout(check, 120);
            }
          };
          check();
        }),
    );
    // Pointing at the first gene's first lane names the first release of its first run on the scale.
    await rows.first().hover();
    const ofGene = answer.matches.filter((m) => m.gene.startsWith(`${firstGene}.`)).flatMap((m) => m.releases);
    const edge = Number(await first.locator(".rscale__edge").first().innerText());
    expect(ofGene).toContain(edge);
  }
  await expectAccessible(page);
  await shot(page, info, "23-names");
});

test("names: nothing found, and an unknown gene", async ({ page }, info) => {
  await page.goto(`/names?organism=${data.organism}&name=NOT_A_NAME_AT_ALL&gene=ENSXXXG00000000000.1`);
  await expect(page.getByText(/No external database attaches the name NOT_A_NAME_AT_ALL/)).toBeVisible();
  await page.getByRole("radio", { name: "A gene → its names" }).click();
  await expect(page).toHaveURL(/ask=names/);
  await expect(page.getByRole("alert")).toContainText("unknown_identifier");
  await shot(page, info, "24-names-empty-and-error");
});

test("Explore: the graphs side by side, then one graph: assemblies, composition, matrix, build", async ({
  page,
}, info) => {
  await page.goto("/organisms");
  await page.getByRole("tab", { name: /^The graphs/ }).click();
  await expect(page).toHaveURL(/tab=graphs/);
  const all = (await (await page.request.get("/api/v1/organisms")).json()) as {
    organisms: { organism: string; counts: Record<string, number> }[];
  };
  const table = page.getByRole("region", { name: "The graphs' builds" });
  await expect(table.locator("tbody tr")).toHaveCount(all.organisms.length);
  await expectAccessible(page);
  await shot(page, info, "26-organisms");

  await page.goto(`/organisms/${data.organism}`);
  const version = (await (await page.request.get("/api/v1/version")).json()) as {
    graphs: { organism: string; content_digest: string; file: { sha256: string } }[];
  };
  const graph = version.graphs.find((g) => g.organism === data.organism);
  expect(graph).toBeDefined();
  await expect(page.getByRole("region", { name: "Assemblies", exact: true })).toBeVisible();
  // The build: the digest short, whole one press away; the file's SHA-256 whole.
  await page.getByRole("tab", { name: "Build" }).click();
  await page.getByRole("button", { name: /^Content digest .*: the whole digest$/ }).click();
  await expect(page.getByText(graph?.content_digest ?? "-", { exact: true })).toBeVisible();
  await expect(page.getByText(graph?.file.sha256 ?? "-", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Composition" }).click();
  // The composition: every count of the build, exactly.
  const counts = all.organisms.find((o) => o.organism === data.organism)?.counts ?? {};
  const rows = page.getByRole("list", { name: "Counts of the build" }).getByRole("listitem");
  await expect(rows).toHaveCount(Object.keys(counts).length);
  for (const [key, value] of Object.entries(counts)) {
    const row = rows.filter({ has: page.locator(".counts__name", { hasText: new RegExp(`^${spaced(key)}`) }) });
    await expect(row).toContainText(groupedInteger(value));
  }
  // The matrix: one row per database of /databases, each with its releases.
  const matrix = (await (await page.request.get(`/api/v1/organisms/${data.organism}/databases`)).json()) as {
    databases: { name: string; releases: number[] }[];
  };
  await page.getByRole("tab", { name: "Databases by release" }).click();
  const lines = page.getByRole("list", { name: "The matrix, one database a line" }).locator("li");
  await expect(lines).toHaveCount(matrix.databases.length);
  const matrixSvg = page.locator(".dbm__svg");
  await matrixSvg.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toContainText("release");
  await expectAccessible(page);
  await shot(page, info, "25-organism");
});

test("Method: the five stages one at a time, the citation in a drawer, the data, the limits", async ({
  page,
}, info) => {
  await page.goto("/method");
  const stages = page.getByRole("tablist", { name: "The stages of an answer" });
  for (const [tab, name] of [
    ["Read", "Read the identifier"],
    ["Walk", "Walk Ensembl's history"],
    ["Bridge", "Bridge through an id two genes carried"],
    ["Rank", "Rank the candidates"],
    ["Answer", "Answer in the database asked"],
  ] as const) {
    await stages.getByRole("tab", { name: new RegExp(`${tab}$`) }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    // One stage at a time: the address keeps it.
    if (tab !== "Read") await expect(page).toHaveURL(new RegExp(`stage=${tab.toLowerCase()}`));
  }
  await stages.getByRole("tab", { name: /Rank$/ }).click();
  const vocabulary = (await (await page.request.get("/api/v1/vocabulary")).json()) as { criteria: { code: string }[] };
  // Every criterion in IDTrack's full words, in the order they decide: one press away under the figure.
  await page.getByRole("button", { name: /The criteria, in IDTrack's full words/ }).click();
  const ladder = page.getByRole("list", { name: "The criteria, in the order they decide" }).locator("li");
  await expect(ladder).toHaveCount(vocabulary.criteria.length);
  await expect(ladder.locator(".method-criteria__code")).toHaveText(vocabulary.criteria.map((c) => c.code));
  // The stepper's way on: Next moves to the next stage and to its tab.
  await page.getByRole("button", { name: /^Next: 5\. Answer/ }).click();
  await expect(stages.getByRole("tab", { name: /Answer$/ })).toBeFocused();
  // The citation: a drawer, opened and closed by keyboard, focus back on its opener.
  const version = (await (await page.request.get("/api/v1/version")).json()) as { idtrack_version: string };
  const cite = page.getByRole("button", { name: "Cite IDTrack" });
  await cite.click();
  const drawer = page.getByRole("dialog", { name: "Cite IDTrack" });
  await expect(drawer.locator("pre.raw--cite")).toContainText(`version = {${version.idtrack_version}}`);
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(cite).toBeFocused();
  await page.getByRole("tab", { name: "Limits" }).click();
  await expect(page.locator("dl.limits > div").first()).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "27-method");
});

test("keyboard alone: from the page's start to an answer", async ({ page }) => {
  await page.goto(`/convert?organism=${data.organism}`);
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
