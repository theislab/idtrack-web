// The load monitor in the masthead and the API page, against the running server: the monitor's reading, its panel by
// keyboard (focus in, Escape out), the state without an answer; the API page listing every endpoint of the server's
// OpenAPI document as a row that opens to its tabs, the document's recorded request as each example, a request sent
// from its console and answered as the API answers it, the curl line of it, and what the page says of the headers.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { exampleOrganism } from "../src/lib/apiExamples";
import { data, expectAccessible, isPhone, withoutPreload } from "./helpers";

const folder = resolve(
  process.env["E2E_SCREENSHOTS"] ?? join(import.meta.dirname, "..", "test-results", "screenshots"),
);

/** A screenshot of the state, after checking that the page never scrolls sideways. The API page writes the JSON
 *  spelling of types and values on purpose (`integer | null`, a default `true`), so the check of a programming
 *  language's spelling (helpers.ts) does not apply to it. */
async function plainShot(page: Page, info: TestInfo, name: string, fullPage = true) {
  const widths = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(widths[0] ?? 0, "the page scrolls sideways").toBeLessThanOrEqual((widths[1] ?? 0) + 1);
  mkdirSync(folder, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(folder, `${name}--${info.project.name}.png`), fullPage, animations: "disabled" });
}

interface Status {
  workers_alive: number;
  master: unknown;
}

test("the load monitor: a quiet reading, its panel by keyboard, Escape back", async ({ page }, info) => {
  await page.goto(`/convert?organism=${data.organism}`);
  const trigger = page.locator(".load-monitor__trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(/Server load: (ok|busy|saturated)/i);
  if (isPhone(info)) {
    await expect(trigger.locator(".load-monitor__reading").first()).toBeHidden();
  } else {
    await expect(trigger).toContainText("CPU");
    await expect(trigger).toContainText(/MEM \d+\.\d\d GiB/);
    await expect(trigger).toContainText(/CPU \d+\.\d %/);
  }
  await trigger.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Server load" });
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Focus is on the panel's title, and the processes are the server's own.
  await expect(panel.getByRole("heading", { name: "Server load" })).toBeFocused();
  const status = (await (await page.request.get("/api/v1/status")).json()) as Status;
  const rows = panel.getByRole("region", { name: "Processes" }).locator("tbody tr");
  await expect(rows).toHaveCount(status.workers_alive + (status.master ? 1 : 0));
  await expect(panel.getByRole("link", { name: "GET /api/v1/status" })).toHaveAttribute("href", "/api/v1/status");
  await expect(panel.getByText("PSS is the honest sum")).toBeVisible();
  await expectAccessible(page);
  await page.waitForTimeout(400);
  await plainShot(page, info, "40-load-panel", false);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("the load monitor without an answer of /status says so, and never shows a value", async ({ page }, info) => {
  await page.route("**/api/v1/status", (route) => route.abort());
  await page.goto(`/convert?organism=${data.organism}`);
  const trigger = page.locator(".load-monitor__trigger");
  await expect(trigger).toContainText("unreachable");
  await expect(trigger).not.toContainText("GiB");
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Server load" });
  await expect(panel).toContainText("No answer from /status");
  await expect(panel).toContainText("The api cannot be reached.");
  await expect(panel).not.toContainText("GiB");
  await expectAccessible(page);
  await plainShot(page, info, "41-load-unreachable", false);
});

/** Boxes that overlap by more than half a pixel, pairwise. */
async function overlaps(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const boxes = [...document.querySelectorAll(sel)]
      .map((e) => ({ text: e.textContent, r: e.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0);
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]?.r;
        const b = boxes[j]?.r;
        if (!a || !b) continue;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 0.5 && y > 0.5) out.push(`${boxes[i]?.text} / ${boxes[j]?.text}`);
      }
    return out;
  }, selector);
}

test("the load monitor says a reading is late while /status waits, and never shows it as current", async ({ page }) => {
  let hold = false;
  await page.route("**/api/v1/status", async (route) => {
    if (hold) await new Promise((r) => setTimeout(r, 12_000));
    await route.continue().catch(() => undefined);
  });
  await page.goto(`/convert?organism=${data.organism}`);
  const trigger = page.locator(".load-monitor__trigger");
  await expect(trigger).toHaveAccessibleName(/Server load: (ok|busy|saturated)\. CPU .* MEM .* GiB/);
  hold = true;
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Server load" });
  await expect(trigger).toHaveAccessibleName(
    /^Server load: late, no answer from \/status for \d+ s; the last reading, at /,
    {
      timeout: 15_000,
    },
  );
  await expect(panel).toContainText(/No answer from \/status for \d+ s/);
  await expect(panel).toContainText("they are not current");
});

test("the load monitor waits a refusal's Retry-After, and tells an unreadable answer from none", async ({ page }) => {
  let asked = 0;
  let mode: "refuse" | "garbled" = "refuse";
  await page.route("**/api/v1/status", async (route) => {
    asked += 1;
    if (mode === "refuse")
      await route.fulfill({
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "40", "x-request-id": "t" },
        body: JSON.stringify({
          error: {
            code: "rate_limited",
            message: "Too many.",
            argument: null,
            allowed: null,
            details: null,
            request_id: "t",
          },
        }),
      });
    else
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "t" },
        body: "{not json",
      });
  });
  await page.goto("/method");
  const trigger = page.locator(".load-monitor__trigger");
  await expect(trigger).toHaveAccessibleName(/^Server load: refused\./);
  await trigger.click();
  const before = asked;
  await page.waitForTimeout(12_000);
  // Open, the panel would ask every 5 s; the refusal named 40 s.
  expect(asked - before).toBe(0);
  await expect(page.getByRole("dialog", { name: "Server load" })).toContainText("Retry-After");
  await page.keyboard.press("Escape");
  mode = "garbled";
  await page.reload();
  await expect(trigger).toHaveAccessibleName(/^Server load: unreadable\./);
});

test("the load panel on a phone: each process a card under its name, the latency's labels apart", async ({
  page,
}, info) => {
  test.skip(!isPhone(info), "the cards and the narrow strip are the phone's");
  await page.route("**/api/v1/status", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { requests: { latency: Record<string, number> } };
    Object.assign(body.requests.latency, { p50_ms: 1.7, p95_ms: 48, p99_ms: 210, max_ms: 640 });
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
  await page.goto(`/convert?organism=${data.organism}`);
  await page.locator(".load-monitor__trigger").click();
  const panel = page.getByRole("dialog", { name: "Server load" });
  await expect(panel.locator(".load-table__process").first()).toBeVisible();
  // The process's name stands on a line of its own, above its first value.
  const placed = await panel.locator(".load-table tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const name = row.querySelector("th")?.getBoundingClientRect();
      const first = row.querySelector("td")?.getBoundingClientRect();
      return name && first ? first.top - name.bottom : -1;
    }),
  );
  for (const gap of placed) expect(gap).toBeGreaterThanOrEqual(0);
  await panel.locator(".latency-strip").scrollIntoViewIfNeeded();
  expect(await overlaps(page, ".latency-strip__decade")).toEqual([]);
  expect(await overlaps(page, ".latency-strip__name")).toEqual([]);
});

interface OpenApi {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { responses?: Record<string, OpenApiResponse> };
}

interface OpenApiResponse {
  $ref?: string;
  headers?: Record<string, unknown>;
  "x-error-codes"?: string[];
  content?: Record<string, { example?: unknown }>;
}

interface OpenApiOperation {
  parameters?: { name: string; example?: unknown }[];
  requestBody?: { content: Record<string, { example?: unknown }> };
  responses: Record<string, OpenApiResponse>;
}

async function openApi(page: Page): Promise<OpenApi> {
  return (await (await page.request.get("/api/v1/openapi.json")).json()) as OpenApi;
}

/** An endpoint's row, opened to its tabs (a press on the row), and the tab named chosen. */
async function openEndpoint(page: Page, anchor: string, tab?: string) {
  const endpoint = page.locator(`#${anchor}`);
  const toggle = endpoint.locator(".endpoint__toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  if (tab) await endpoint.getByRole("tab", { name: tab, exact: true }).click();
  return endpoint;
}

/** A row of "Using the API" opened (conventions, reading, programs, errors). */
async function openGuide(page: Page, id: string) {
  const summary = page.locator(`#${id} > .expandable > .expandable__summary`);
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
}

test("the API page: a first request above all, its code one press away, the rules for reading an answer", async ({
  page,
}, info) => {
  await page.goto("/developers");
  const first = page.locator("#first-request");
  // The code is one press away, not on the first screen.
  await expect(first.getByRole("region", { name: /A first request in / })).toHaveCount(0);
  await first.getByRole("button", { name: "Show the request" }).click();
  await expect(first.getByRole("region", { name: /A first request in / })).toBeVisible();
  // Sent from the keyboard, the button keeps the focus while it asks and after the answer has come.
  const send = first.getByRole("button", { name: "Send it" });
  await send.focus();
  await page.keyboard.press("Enter");
  await expect(first.getByRole("status")).toContainText(/^200 status converted, best \S+/);
  await expect(first.getByRole("button", { name: "Send it" })).toBeFocused();
  // Reading an answer: its rules, and the recorded answer annotated one press further.
  await openGuide(page, "reading");
  const reading = page.locator("#reading");
  await expect(reading.locator(".api-reading__list li").first()).toBeVisible();
  expect(await reading.locator(".api-reading__list li").count()).toBeGreaterThanOrEqual(5);
  await reading.getByRole("button", { name: /^A recorded answer, annotated/ }).click();
  await expect(reading.locator(".api-annotated__row").first()).toBeVisible();
  // The conventions are folded to one line each; the bounds open to the contract's literals as the contract writes them.
  await openGuide(page, "conventions");
  await page.getByRole("button", { name: /^Bounds of this server/ }).click();
  await expect(page.locator(".api-bounds")).toContainText("rate_per_minute");
  const tall = await page
    .locator(".api-bounds__row")
    .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height).filter((h) => h > 240));
  expect(tall).toEqual([]);
  if (!isPhone(info)) {
    // A method in the contents is one line, whatever its word.
    const methods = await page
      .locator(".api-toc__method")
      .evaluateAll((spans) => spans.map((s) => s.getBoundingClientRect().height));
    for (const h of methods) expect(h).toBeLessThan(20);
  } else {
    // The contents are a bar that stays at the top of the window, never a control floating over the text, and it
    // says no count the page says elsewhere.
    const bar = page.locator("details.api-contents > summary");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText("On this page");
    await page.locator("#recipes").scrollIntoViewIfNeeded();
    await expect(bar).toBeInViewport();
  }
});

test("the API page's contents mark the entry just followed, and open it", async ({ page }, info) => {
  test.skip(isPhone(info), "the contents beside the reference are a wide screen's");
  await page.goto("/developers");
  const document = await openApi(page);
  const count = Object.values(document.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  await expect(page.locator("article.endpoint")).toHaveCount(count); // every endpoint drawn
  const toc = page.getByRole("navigation", { name: "On this page" }).first();
  for (const [name, id, group] of [
    ["Reading an answer", "reading", "Using the API"],
    ["…/convert/batch", "post-organisms-organism-convert-batch", "Conversion"],
    ["Error codes", "errors", "Using the API"],
    ["…/names-of", "get-organisms-organism-names-of", "Names"],
  ] as const) {
    // A group is folded in the contents until one of its entries is read: opened here.
    const details = toc.locator("details", { has: page.locator("summary", { hasText: group }) });
    if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
    const link = toc.locator(`a[href="#${id}"]`);
    await link.click();
    await expect(link, `following ${name}`).toHaveAttribute("aria-current", "location");
    expect(await toc.locator('[aria-current="location"]').count()).toBe(1);
    // What was followed is open.
    await expect(
      page.locator(`#${id} .endpoint__toggle, #${id} > .expandable > .expandable__summary`).first(),
    ).toHaveAttribute("aria-expanded", "true");
    // Every target lands at one offset below the masthead, sections and endpoints alike.
    const top = await page.locator(`#${id}`).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const masthead = await page.locator(".mast").evaluate((e) => Math.round(e.getBoundingClientRect().bottom));
    expect(top - masthead, name).toBeGreaterThanOrEqual(0);
    expect(top - masthead, name).toBeLessThanOrEqual(24);
  }
});

test("each endpoint is one row that opens on About; an address names one and opens it", async ({ page }, info) => {
  await page.goto("/developers#get-organisms-organism-names-of");
  const named = page.locator("#get-organisms-organism-names-of");
  await expect(named.locator(".endpoint__toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(named).toBeInViewport();
  await expect(named.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
  await expect(named.getByRole("tabpanel")).toContainText("gene");
  // Every other row is folded: its method, path, summary, and no console.
  const rows = page.locator("article.endpoint");
  expect(await page.locator(".endpoint__toggle[aria-expanded='true']").count()).toBe(1);
  expect(await page.locator("form.tryit").count()).toBe(0);
  const heights = await rows.evaluateAll((all) =>
    all.filter((a) => !a.classList.contains("endpoint--open")).map((a) => a.getBoundingClientRect().height),
  );
  for (const h of heights) expect(h).toBeLessThan(isPhone(info) ? 110 : 80);
  // A second row opened: on a phone the first folds (one console at a time), on a wide screen both stay.
  await openEndpoint(page, "get-organisms-organism-convert", "Try it");
  await expect(page.locator("form.tryit")).toHaveCount(1);
  await expect(named.locator(".endpoint__toggle")).toHaveAttribute("aria-expanded", isPhone(info) ? "false" : "true");
  await expectAccessible(page);
});

test("the API page marks only the allowances as not applied, and strikes nothing through", async ({ page }) => {
  await page.goto("/developers");
  await openGuide(page, "conventions");
  await page.getByRole("button", { name: /^Bounds of this server/ }).click();
  const limits = (await (await page.request.get("/api/v1/limits")).json()) as {
    allowances_enforced: boolean;
    allowance_fields: string[];
  };
  const rows = page.locator(".api-bounds__row");
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    const name = (await row.locator("summary > .mono").first().innerText()).trim();
    const tagged = (await row.locator(".api-bounds__state").count()) > 0;
    expect(tagged, name).toBe(!limits.allowances_enforced && limits.allowance_fields.includes(name));
    const struck = await row.evaluate((e) =>
      [...e.querySelectorAll("*")].some((c) => getComputedStyle(c).textDecorationLine.includes("line-through")),
    );
    expect(struck, name).toBe(false);
  }
});

test("the API page says exactly which answers carry an ETag, and how each code is retried", async ({ page }) => {
  await page.goto("/developers");
  const document = await openApi(page);
  // The document declares each answer's headers: what it says of ETag and Retry-After is what the page says.
  const refusal = (r: OpenApiResponse) =>
    r.$ref ? (document.components?.responses?.[r.$ref.split("/").pop() ?? ""] ?? {}) : r;
  const withoutTag: string[] = [];
  const waits = new Map<string, boolean>();
  for (const [path, item] of Object.entries(document.paths))
    for (const [method, op] of Object.entries(item)) {
      if (method === "get" && !("ETag" in (op.responses["200"]?.headers ?? {})))
        withoutTag.push(path.replace(/^\/api\/v1/, "") || "/");
      for (const r of Object.values(op.responses).map(refusal))
        for (const code of r["x-error-codes"] ?? [])
          waits.set(code, (waits.get(code) ?? false) || "Retry-After" in (r.headers ?? {}));
    }
  expect(withoutTag.length).toBeGreaterThan(0);
  await openGuide(page, "conventions");
  await page.getByRole("button", { name: /^Requests and answers/ }).click();
  const requests = page.locator(".api-convention").filter({ hasText: "ETag" });
  for (const path of withoutTag) await expect(requests).toContainText(`GET ${path}`);
  await expect(requests).not.toContainText("every GET answer has an ETag");
  await openGuide(page, "errors");
  const vocabulary = (await (await page.request.get("/api/v1/vocabulary")).json()) as {
    errors: { code: string; retryable: boolean }[];
  };
  const table = page.getByRole("region", { name: "Table of error codes" });
  await expect(table.locator("tbody tr")).toHaveCount(vocabulary.errors.length);
  const said = new Map(
    await table
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((r) => [r.querySelector("td")?.textContent ?? "", r.querySelectorAll("td")[2]?.textContent ?? ""]),
      ),
  );
  for (const e of vocabulary.errors) {
    const text = said.get(e.code);
    if (!e.retryable) expect(text, e.code).toBe("no: change the request");
    else if (waits.get(e.code) === true) expect(text, e.code).toBe("yes, after Retry-After");
    else if (waits.get(e.code) === false) expect(text, e.code).toBe("yes; no Retry-After is sent");
  }
});

test("the API page shows a table answer's columns and a recorded table", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = await openEndpoint(page, "post-organisms-organism-convert-batch", "Response");
  await endpoint.getByText("Columns of the table").click();
  const columns = endpoint.getByRole("region", { name: "The table's columns" });
  await expect(columns).toContainText("input_index");
  await expect(columns).toContainText("candidate_count");
  await expect(columns).toContainText("error_code");
  await expect(endpoint).toContainText("provenance=true");
  await endpoint.getByRole("tab", { name: "Examples" }).click();
  await endpoint.locator(".endpoint__recorded > summary", { hasText: /recorded table/ }).click();
  const table = endpoint.getByRole("region", { name: /a recorded table: the table$/ });
  await expect(table.locator("th").first()).toHaveText("input_index");
});

test("the first request says why it has no example when the organisms cannot be read", async ({ page }) => {
  await withoutPreload(page);
  await page.route("**/api/v1/organisms", (route) => route.abort());
  await page.goto("/developers");
  const first = page.locator("#first-request");
  await expect(first.getByRole("status")).toContainText("could not be read");
  await expect(first.getByRole("button", { name: "Try again" })).toBeEnabled();
  await expect(first.getByRole("button", { name: "Send it" })).toHaveCount(0);
  await expect(first).not.toContainText("curl");
});

test("the API page lists every endpoint of the server's OpenAPI document", async ({ page }, info) => {
  await page.goto("/developers");
  const document = await openApi(page);
  const expected = Object.entries(document.paths).flatMap(([path, item]) =>
    Object.keys(item).map((method) => ({ method: method.toUpperCase(), path })),
  );
  const articles = page.locator("article.endpoint");
  await expect(articles).toHaveCount(expected.length);
  for (const { method, path } of expected) {
    await expect(page.getByRole("heading", { level: 3, name: `${method} ${path}`, exact: true })).toBeVisible();
  }
  await expect(page.getByText(`${new URL(page.url()).origin}/api/v1`, { exact: true })).toBeVisible();
  const llms = await page.request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain("# IDTrack web API");
  // The texts for programs and agents, in the contents: a group beside the reference, a row of the bar on a phone.
  if (isPhone(info)) await page.locator("details.api-contents > summary").click();
  else
    await page
      .getByRole("navigation", { name: "On this page" })
      .locator("summary", { hasText: "For programs" })
      .click();
  const contents = page.getByRole("navigation", { name: "On this page" }).filter({ visible: true });
  await expect(contents.getByRole("link", { name: "llms.txt", exact: true })).toHaveAttribute("href", "/llms.txt");
  await expect(contents.getByRole("link", { name: "llms-full.txt" })).toHaveAttribute("href", "/llms-full.txt");
  await expect(contents.getByRole("link", { name: /^openapi\.json/ })).toHaveAttribute("href", "/api/v1/openapi.json");
  await expect(contents.getByRole("link", { name: "The API's index" })).toHaveAttribute("href", "/api/v1");
  if (isPhone(info)) await page.locator("details.api-contents > summary").click();
  // Each endpoint opens to four tabs, About first.
  for (const article of await articles.all()) {
    const id = (await article.getAttribute("id")) ?? "";
    await openEndpoint(page, id);
    await expect(article.getByRole("tablist", { name: /, in detail$/ }).getByRole("tab")).toHaveText([
      "About",
      "Try it",
      "Response",
      "Examples",
    ]);
  }
  await expectAccessible(page);
  await plainShot(page, info, "42-api-page");
});

test("the API page's console sends the example, the document's recorded request, and shows the answer as sent", async ({
  page,
}, info) => {
  await page.goto("/developers");
  const endpoint = await openEndpoint(page, "get-organisms-organism-convert", "Try it");
  const form = endpoint.getByRole("form");
  // The example: the request the document recorded an answer of, where this server holds its organism; else the
  // first of the page's examples that this server holds.
  const health = (await (await page.request.get("/api/v1/health")).json()) as { organisms: string[] };
  const document = await openApi(page);
  const recorded = Object.fromEntries(
    (document.paths["/api/v1/organisms/{organism}/convert"]?.["get"]?.parameters ?? [])
      .filter((p) => p.example !== undefined)
      .map((p) => [p.name, String(p.example)]),
  );
  const own = health.organisms.includes(recorded["organism"] ?? "");
  const organism = own ? (recorded["organism"] ?? "") : exampleOrganism(health.organisms).organism;
  await expect(form.getByLabel(/^organism/)).toHaveValue(organism);
  const identifier = await form.getByLabel(/^identifier/).inputValue();
  if (own) expect(identifier).toBe(recorded["identifier"]);
  else expect(identifier).not.toBe("");
  // Each field has a hint: the first sentence of its parameter's text.
  await expect(form.getByRole("button", { name: "Hint" })).toHaveCount(
    await form.locator(".tryit__field:not(.tryit__field--wide)").count(),
  );
  // The curl line names exactly the request the console sends.
  const curl = await endpoint.getByRole("region", { name: /the request in curl/ }).innerText();
  const url = /'(http[^']+)'/.exec(curl)?.[1] ?? "";
  expect(new URL(url).pathname).toBe(`/api/v1/organisms/${organism}/convert`);
  expect(new URL(url).searchParams.get("identifier")).toBe(identifier);
  if (own)
    for (const [name, value] of Object.entries(recorded))
      if (name !== "organism") expect(new URL(url).searchParams.get(name), name).toBe(value);
  const sent = page.waitForRequest((r) => r.url().includes("/convert?"));
  await form.getByRole("button", { name: "Send GET" }).click();
  expect((await sent).url()).toBe(url);
  const answer = endpoint.getByRole("region", { name: /^The answer of GET [^:]+$/ });
  await expect(answer).toContainText("200");
  await expect(answer).toContainText(/app \d+\.\d+ ms/);
  // The status is said once: in the answer's facts, not again in its heading.
  await expect(endpoint.getByRole("heading", { name: "The answer", exact: true })).toBeFocused();
  const expected = await (await page.request.get(url)).text();
  // JSON opens indented, every value's text kept; "As sent" is the body byte for byte.
  await expect(answer.getByRole("radio", { name: "Indented" })).toBeChecked();
  const indented = await answer.getByRole("region", { name: /body$/ }).innerText();
  expect(JSON.parse(indented)).toEqual(JSON.parse(expected));
  await answer.getByRole("radio", { name: "As sent" }).check();
  const shown = await answer.getByRole("region", { name: /body$/ }).innerText();
  expect(shown).toBe(expected);
  // Examples: the same request, and the recorded answer says whether it is that request's.
  await endpoint.getByRole("tab", { name: "Examples" }).click();
  const example = await endpoint.getByRole("region", { name: /an example of this server in curl/ }).innerText();
  expect(/'(http[^']+)'/.exec(example)?.[1]).toBe(url);
  await expect(endpoint.locator(".endpoint__recorded > summary")).toHaveText(
    own ? "The recorded answer of this request" : /^A recorded answer\s*of another request$/,
  );
  await expectAccessible(page);
  await endpoint.scrollIntoViewIfNeeded();
  await plainShot(page, info, "43-api-console");
});

test("the API page's console shows a refusal with its code and meaning", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = await openEndpoint(page, "get-organisms-organism-names-of", "Try it");
  const form = endpoint.getByRole("form");
  await form.getByLabel(/^gene/).fill("ENSXXXG00000000000.1");
  await form.getByRole("button", { name: "Send GET" }).click();
  const answer = endpoint.getByRole("region", { name: /^The answer of GET [^:]+$/ });
  await expect(answer).toContainText("400");
  await expect(answer).toContainText("unknown_identifier");
  await expect(endpoint.getByRole("region", { name: /the request in curl/ })).toContainText("ENSXXXG00000000000.1");
});

test("the API page's console asks a batch for a table and shows it as one", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = await openEndpoint(page, "post-organisms-organism-convert-batch", "Try it");
  const form = endpoint.getByRole("form");
  await form.getByLabel(/^format/).selectOption("tsv");
  const curl = await endpoint.getByRole("region", { name: /the request in curl/ }).innerText();
  expect(curl).toContain("Accept: text/tab-separated-values");
  const sent = page.waitForRequest((r) => r.url().includes("/convert/batch"));
  await form.getByRole("button", { name: "Send POST" }).click();
  expect((await sent).headers()["accept"]).toBe("text/tab-separated-values");
  const answer = endpoint.getByRole("region", { name: /^The answer of POST [^:]+$/ });
  await expect(answer).toContainText("200");
  await expect(endpoint.getByRole("heading", { name: "The answer", exact: true })).toBeFocused();
  await answer.getByRole("radio", { name: "Table" }).check();
  const table = answer.getByRole("region", { name: /the table$/ });
  await expect(table.locator("th").first()).toHaveText("input_index");
  await expectAccessible(page);
});

test("every endpoint shows a recorded answer of the API, its numbers as written", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = await openEndpoint(page, "get-organisms-organism-convert", "Examples");
  await endpoint.locator(".endpoint__recorded > summary").click();
  const body = endpoint.getByRole("region", { name: /a recorded answer$/ });
  await expect(body).toContainText('"query_id": "ENSG00000141510"');
  await expect(body).toContainText("0.9773331776999999");
  await expect(endpoint.locator(".endpoint__recorded")).toContainText("Recorded: a real answer");
});

test("the API page at 320 px: no sideways scroll with a console open", async ({ page }, info) => {
  test.skip(!isPhone(info), "a phone's width, made narrower");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/developers");
  await openEndpoint(page, "post-organisms-organism-convert-batch", "Try it");
  await openEndpoint(page, "get-organisms-organism-convert", "Try it");
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll, "the page scrolls sideways").toBeLessThanOrEqual(client);
});

test("the strict security policy of every page causes no violation", async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { reportViolation: (t: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  for (const path of ["/", "/batch", "/names", "/organisms", "/method", "/developers", "/no/such/page"]) {
    const response = await page.goto(path);
    expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});
