// The load monitor in the masthead and the api page, against the running server: the monitor's reading, its panel by
// keyboard (focus in, Escape out), the state without an answer; the api page listing every endpoint of the server's
// OpenAPI document, a request sent from its console and answered as the api answers it, and the curl line of it.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { exampleOrganism } from "../src/lib/apiExamples";
import { data, expectAccessible, isPhone, withoutPreload } from "./helpers";

const folder = resolve(
  process.env["E2E_SCREENSHOTS"] ?? join(import.meta.dirname, "..", "test-results", "screenshots"),
);

/** A screenshot of the state, after checking that the page never scrolls sideways. The api page writes the JSON
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

test("the api page: a first request above all, the rules for reading an answer, bounds that read on a phone", async ({
  page,
}, info) => {
  await page.goto("/developers");
  const first = page.locator("#first-request");
  await first.getByRole("button", { name: "Send it" }).click();
  await expect(first.getByRole("status")).toContainText(/^200 status converted, best \S+/);
  const reading = page.locator("#reading");
  await expect(reading.locator(".api-reading__list li").first()).toBeVisible();
  expect(await reading.locator(".api-reading__list li").count()).toBeGreaterThanOrEqual(5);
  await expect(reading.locator(".api-annotated__row").first()).toBeVisible();
  // The conventions are folded to one line each; the bounds open to the contract's literals as the contract writes them.
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
    // The contents are a bar that stays at the top of the window, never a control floating over the text.
    const bar = page.locator("details.api-contents > summary");
    await expect(bar).toBeVisible();
    await page.locator("#errors").scrollIntoViewIfNeeded();
    await expect(bar).toBeInViewport();
    expect(await page.locator(".api-contents__back").count()).toBe(0);
  }
});

test("the api page's contents mark the entry just followed", async ({ page }, info) => {
  test.skip(isPhone(info), "the contents beside the reference are a wide screen's");
  await page.goto("/developers");
  const document = (await (await page.request.get("/api/v1/openapi.json")).json()) as OpenApi;
  const count = Object.values(document.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  await expect(page.locator("article.endpoint")).toHaveCount(count); // every endpoint drawn
  const toc = page.getByRole("navigation", { name: "On this page" }).first();
  for (const [name, id] of [
    ["Reading an answer", "reading"],
    ["…/convert/batch", "post-organisms-organism-convert-batch"],
    ["Error codes", "errors"],
    ["…/names-of", "get-organisms-organism-names-of"],
  ] as const) {
    const link = toc.locator(`a[href="#${id}"]`);
    // An endpoint's group is folded in the contents until one of its entries is read: opened here.
    const group = link.locator("xpath=ancestor::details[1]");
    if ((await group.count()) && !(await group.evaluate((d) => (d as HTMLDetailsElement).open)))
      await group.locator(":scope > summary").click();
    await link.click();
    await expect(link, `following ${name}`).toHaveAttribute("aria-current", "location");
    expect(await toc.locator('[aria-current="location"]').count()).toBe(1);
    // Every target lands at one offset below the masthead, sections and endpoints alike.
    const top = await page.locator(`#${id}`).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const masthead = await page.locator(".mast").evaluate((e) => Math.round(e.getBoundingClientRect().bottom));
    expect(top - masthead, name).toBeGreaterThanOrEqual(0);
    expect(top - masthead, name).toBeLessThanOrEqual(24);
  }
});

test("the api page marks only the allowances as not applied, and strikes nothing through", async ({ page }) => {
  await page.goto("/developers");
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

test("the api page shows a table answer's columns and a recorded table", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = page.locator("#post-organisms-organism-convert-batch");
  await endpoint.getByRole("tab", { name: "Response" }).click();
  await endpoint.getByText("Columns of the table").click();
  const columns = endpoint.getByRole("region", { name: "The table's columns" });
  await expect(columns).toContainText("input_index");
  await expect(columns).toContainText("candidate_count");
  await expect(columns).toContainText("error_code");
  await expect(endpoint).toContainText("provenance=true");
  await endpoint.getByRole("tab", { name: "Examples" }).click();
  await endpoint.getByText("A recorded table").click();
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

interface OpenApi {
  paths: Record<string, Record<string, unknown>>;
}

test("the api page lists every endpoint of the server's OpenAPI document", async ({ page }, info) => {
  await page.goto("/developers");
  const document = (await (await page.request.get("/api/v1/openapi.json")).json()) as OpenApi;
  const expected = Object.entries(document.paths).flatMap(([path, item]) =>
    Object.keys(item).map((method) => ({ method: method.toUpperCase(), path })),
  );
  const articles = page.locator("article.endpoint");
  await expect(articles).toHaveCount(expected.length);
  for (const { method, path } of expected) {
    await expect(page.getByRole("heading", { level: 3, name: `${method} ${path}`, exact: true })).toBeVisible();
  }
  await expect(page.getByText(`${new URL(page.url()).origin}/api/v1`, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download the OpenAPI document" })).toHaveAttribute(
    "href",
    "/api/v1/openapi.json",
  );
  const llms = await page.request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain("# idtrack web api");
  // The texts for programs and agents, one click away at the head of the page.
  const agents = page.getByRole("navigation", { name: "The api as text, for programs and agents" });
  await expect(agents.getByRole("link", { name: "llms.txt", exact: true })).toHaveAttribute("href", "/llms.txt");
  await expect(agents.getByRole("link", { name: "llms-full.txt" })).toHaveAttribute("href", "/llms-full.txt");
  await expect(agents.getByRole("link", { name: "openapi.json" })).toHaveAttribute("href", "/api/v1/openapi.json");
  // Each endpoint is its summary and four tabs.
  for (const article of await articles.all())
    await expect(article.getByRole("tablist", { name: /, in detail$/ }).getByRole("tab")).toHaveText([
      "Try it",
      /^Parameters/,
      "Response",
      "Examples",
    ]);
  // The error codes are the api's own table, folded to one line.
  await page.getByRole("button", { name: /^Error codes/ }).click();
  const vocabulary = (await (await page.request.get("/api/v1/vocabulary")).json()) as { errors: { code: string }[] };
  await expect(page.getByRole("region", { name: "Error codes" }).locator("tbody tr")).toHaveCount(
    vocabulary.errors.length,
  );
  await expectAccessible(page);
  await plainShot(page, info, "42-api-page");
});

test("the api page's console sends the example and shows the answer as the api sent it", async ({ page }, info) => {
  await page.goto("/developers");
  const endpoint = page.locator("#get-organisms-organism-convert");
  await endpoint.getByRole("tab", { name: "Try it" }).click();
  const form = endpoint.getByRole("form");
  // The examples' organism: the first of the page's examples that this server holds.
  const health = (await (await page.request.get("/api/v1/health")).json()) as { organisms: string[] };
  const { organism } = exampleOrganism(health.organisms);
  await expect(form.getByLabel(/^organism/)).toHaveValue(organism);
  const identifier = await form.getByLabel(/^identifier/).inputValue();
  expect(identifier).not.toBe("");
  // The curl line names exactly the request the console sends.
  const curl = await endpoint.getByRole("region", { name: /the request in curl/ }).innerText();
  const url = /'(http[^']+)'/.exec(curl)?.[1] ?? "";
  expect(new URL(url).pathname).toBe(`/api/v1/organisms/${organism}/convert`);
  expect(new URL(url).searchParams.get("identifier")).toBe(identifier);
  const sent = page.waitForRequest((r) => r.url().includes("/convert?"));
  await form.getByRole("button", { name: "Send GET" }).click();
  expect((await sent).url()).toBe(url);
  const answer = endpoint.getByRole("region", { name: /^The answer of GET [^:]+$/ });
  await expect(answer).toContainText("200");
  await expect(answer).toContainText(/app \d+\.\d+ ms/);
  const expected = await (await page.request.get(url)).text();
  // JSON opens indented, every value's text kept; "As sent" is the body byte for byte.
  await expect(answer.getByRole("radio", { name: "Indented" })).toBeChecked();
  const indented = await answer.getByRole("region", { name: /body$/ }).innerText();
  expect(JSON.parse(indented)).toEqual(JSON.parse(expected));
  await answer.getByRole("radio", { name: "As sent" }).check();
  const shown = await answer.getByRole("region", { name: /body$/ }).innerText();
  expect(shown).toBe(expected);
  await expectAccessible(page);
  await endpoint.scrollIntoViewIfNeeded();
  await plainShot(page, info, "43-api-console");
});

test("the api page's console shows a refusal with its code and meaning", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = page.locator("#get-organisms-organism-names-of");
  await endpoint.getByRole("tab", { name: "Try it" }).click();
  const form = endpoint.getByRole("form");
  await form.getByLabel(/^gene/).fill("ENSXXXG00000000000.1");
  await form.getByRole("button", { name: "Send GET" }).click();
  const answer = endpoint.getByRole("region", { name: /^The answer of GET [^:]+$/ });
  await expect(answer).toContainText("400");
  await expect(answer).toContainText("unknown_identifier");
  await expect(endpoint.getByRole("region", { name: /the request in curl/ })).toContainText("ENSXXXG00000000000.1");
});

test("the api page's console asks a batch for a table and shows it as one", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = page.locator("#post-organisms-organism-convert-batch");
  await endpoint.getByRole("tab", { name: "Try it" }).click();
  const form = endpoint.getByRole("form");
  await form.getByLabel(/^format/).selectOption("tsv");
  const curl = await endpoint.getByRole("region", { name: /the request in curl/ }).innerText();
  expect(curl).toContain("Accept: text/tab-separated-values");
  const sent = page.waitForRequest((r) => r.url().includes("/convert/batch"));
  await form.getByRole("button", { name: "Send POST" }).click();
  expect((await sent).headers()["accept"]).toBe("text/tab-separated-values");
  const answer = endpoint.getByRole("region", { name: /^The answer of POST [^:]+$/ });
  await expect(answer).toContainText("200");
  await expect(endpoint.getByRole("heading", { name: /^The answer: 200/ })).toBeFocused();
  await answer.getByRole("radio", { name: "Table" }).check();
  const table = answer.getByRole("region", { name: /the table$/ });
  await expect(table.locator("th").first()).toHaveText("input_index");
  await expectAccessible(page);
});

test("every endpoint shows a recorded answer of the api, its numbers as written", async ({ page }) => {
  await page.goto("/developers");
  const endpoint = page.locator("#get-organisms-organism-convert");
  await endpoint.getByRole("tab", { name: "Examples" }).click();
  await endpoint.getByText("A recorded answer").click();
  const body = endpoint.getByRole("region", { name: /a recorded answer$/ });
  await expect(body).toContainText('"query_id": "ENSG00000141510"');
  await expect(body).toContainText("0.9773331776999999");
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
