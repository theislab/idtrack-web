// The batch's behaviour as a person meets it: a failure says only what will happen (a batch that failed for want of
// an answer is asked again when the connection returns), work started is never dropped by an organism switch, the
// answer is kept for the session once (typing does not write it again), a row named in another row is reached by a
// press, and a large insertion never holds the page. The summary and the tabs of the results.
import { expect, test } from "@playwright/test";
import { data, expectAccessible, expectWholeAndTyped } from "./helpers";

const list = () => data.batch.join("\n");

test("a batch that got no answer is asked again when the browser is back online", async ({ page, context }) => {
  let posts = 0;
  let fail = true;
  await page.route("**/convert/batch?format=json", (route) => {
    posts += 1;
    if (fail) return route.abort("connectionreset");
    return route.continue();
  });
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(list());
  await page.getByRole("button", { name: /^Convert/ }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("asked again when the browser is back online");
  const before = posts;
  fail = false;
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(page.locator(".batch-figure-head__line")).toBeVisible();
  expect(posts).toBeGreaterThan(before);
});

test("a batch under way goes on when the organism is switched, and is there on its return", async ({ page }) => {
  const organisms = (await (await page.request.get("/api/v1/organisms")).json()) as {
    organisms: { organism: string }[];
  };
  const other = organisms.organisms.map((o) => o.organism).find((o) => o !== data.organism);
  test.skip(other === undefined, "the server holds one organism");
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/convert/batch?format=json", async (route) => {
    const body = route.request().postDataJSON() as { identifiers: string[] };
    if (body.identifiers.length === data.batch.length) await held;
    await route.continue();
  });
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(list());
  await page.getByRole("button", { name: /^Convert/ }).click();
  await expect(page.locator(".batch-loading")).toBeVisible();
  // The organism switched in the masthead's chip (a new page load would end every script of the page).
  await page.locator(".org-chip__button").click();
  await page
    .locator(".org-chip__option", {
      hasText: (other ?? "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`organism=${other ?? ""}`));
  await expect(page.locator(".batch-elsewhere")).toContainText("is being converted");
  release();
  await expect(page.locator(".batch-elsewhere")).toContainText("is done");
  await page.locator(".batch-elsewhere").getByRole("link").click();
  await expect(page.locator(".batch-figure-head__line")).toContainText(`${String(data.batch.length)} identifiers`);
});

test("the answer is kept for the session once: typing in the list does not write it again", async ({ page }) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(list());
  await page.getByRole("button", { name: /^Convert/ }).click();
  await expect(page.getByRole("region", { name: /^Results: / })).toBeVisible();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const w = window as unknown as { __writes: number };
    w.__writes = 0;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its own `this` below
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.includes("batch.result")) w.__writes += 1;
      original.call(this, key, value);
    };
  });
  const field = page.getByLabel("Identifiers", { exact: true });
  await field.press("End");
  await page.keyboard.type("abcdefghij");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(0);
  // After a reload the answer is still there.
  await page.reload();
  await expect(page.locator(".batch-figure-head__line")).toBeVisible();
});

test("a row named in another row ('also the answer of #3') is reached by a press", async ({ page }) => {
  // The same identifier twice under two spellings shares its answer; a repeat of one identifier does not count.
  const ids = [...data.batch, data.batch[0] ?? "", data.batch[0]?.toLowerCase() ?? ""];
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(ids.join("\n"));
  await page.getByRole("button", { name: /^Convert/ }).click();
  await expect(page.getByRole("region", { name: /^Results: / })).toBeVisible();
  const go = page.locator(".batch-shared__go").first();
  test.skip((await go.count()) === 0, "no shared answer in this graph's list");
  const target = Number((await go.innerText()).replace("#", ""));
  await go.click();
  await expect(page.locator(`tbody[data-row="${String(target - 1)}"] .batch-toggle`)).toBeFocused();
});

test("a thousand lines inserted at once never hold the page, and the result has no field name in its words", async ({
  page,
}) => {
  const many = Array.from({ length: 1000 }, (_, i) => data.batch[i % data.batch.length] ?? "").join("\n");
  await page.goto(`/batch?organism=${data.organism}`);
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__long.push(e.duration);
    }).observe({ type: "longtask" });
  });
  await page.getByLabel("Identifiers", { exact: true }).fill(many);
  await expect(page.locator(".batch-form__count .mono").first()).toHaveText("1 000");
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  expect(Math.max(0, ...long)).toBeLessThan(500);
  await page.getByRole("button", { name: /^Convert/ }).click();
  await expect(page.getByRole("region", { name: /^Results: / })).toBeVisible();
  await expectWholeAndTyped(page);
  await expectAccessible(page);
});

test("a refusal that names its wait is asked again once by itself, then left to the person", async ({ page }) => {
  const posts: number[] = [];
  const start = Date.now();
  await page.route("**/convert/batch?format=json", (route) => {
    posts.push(Date.now() - start);
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "retry-after": "1", "x-request-id": "e2e" },
      body: JSON.stringify({
        error: {
          code: "server_busy",
          message: "The server is busy; retry later.",
          argument: null,
          allowed: null,
          details: null,
          request_id: "e2e",
          retry_after: 1,
          allowance: null,
        },
      }),
    });
  });
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(list());
  await page.getByRole("button", { name: /^Convert/ }).click();
  await expect(page.locator(".batch-retry")).toContainText("asked again by itself at");
  await page.waitForTimeout(4000);
  expect(posts).toHaveLength(2);
});

test("a refusal for time is waited out with the paths, and asked without them only at the person's word", async ({
  page,
}) => {
  // The batch's own asks only: the result page then asks batches of its own (the names beside each gene, at the
  // target release), which are no ask of the list again.
  const explains: boolean[] = [];
  await page.route("**/convert/batch?format=json", (route) => {
    const body = route.request().postDataJSON() as { explain: boolean; identifiers: string[] };
    if (body.identifiers.join("\n") !== list()) return route.continue();
    explains.push(body.explain);
    if (body.explain)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "retry-after": "1", "x-request-id": "e2e" },
        body: JSON.stringify({
          error: {
            code: "request_budget_exceeded",
            message:
              "The request waited its whole time budget (20 s) for the server before its search began; retry later.",
            argument: null,
            allowed: null,
            details: null,
            request_id: "e2e",
            retry_after: 1,
            allowance: null,
          },
        }),
      });
    return route.continue();
  });
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(list());
  await page.getByRole("button", { name: /^Convert/ }).click();
  await expect(page.locator(".batch-retry")).toContainText("asked again by itself at");
  // Never at once without the paths: two asks, both with them.
  expect(explains).toEqual([true, true]);
  await page.getByRole("button", { name: "Ask without the paths" }).click();
  await expect(page.locator(".batch-figure-head__line")).toBeVisible();
  // Once, and never again by itself: still once after a wait longer than the refusal's.
  expect(explains).toEqual([true, true, false]);
  await page.waitForTimeout(2000);
  expect(explains).toEqual([true, true, false]);
  await expect(page.locator(".batch-figure-head__setting")).toContainText("not sent (why?)");
});

test("an item read as another item's copy opens the path of that item, whose answer is the row's", async ({ page }) => {
  const name = data.symbol.identifier;
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(`${name}\n${name}-1`);
  await page.getByRole("button", { name: /^Convert/ }).click();
  const row = page.locator('tbody[data-row="1"]');
  await expect(row).toBeVisible();
  test.skip(!(await row.locator(".b-id").innerText()).includes("read as"), "not read as a copy here");
  const word = /(Converted|Tie|No target|Not found|Unknown version|No conversion)/.exec(
    await row.locator(".b-status .status").first().innerText(),
  )?.[1];
  const href = await row.getByRole("link", { name: /^Path/ }).getAttribute("href");
  expect(new URL(href ?? "", "http://x").searchParams.get("id")).toBe(name);
  await row.getByRole("link", { name: /^Path/ }).click();
  await expect(page.locator("main .status").first()).toContainText(word ?? "?");
});

test("the summary draws only the counts that hold rows; the others are one quiet line", async ({ page }) => {
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(list());
  await page.getByRole("button", { name: /^Convert/ }).click();
  // The answer's head is set in the section's tier, and takes the focus when the answer comes.
  const head = page.locator("#batch-summary");
  await expect(head).toBeFocused();
  expect(await head.evaluate((e) => getComputedStyle(e).fontFamily)).toContain("Source Serif");
  // The counts are one press away, under the statuses; the results are tabs (the table first).
  await expect(page.locator(".counts")).toHaveCount(0);
  await page.getByRole("button", { name: /^How the batch was answered/ }).click();
  await expect(page.locator(".counts")).toBeVisible();
  for (const value of await page.locator(".count__value .mono").allInnerTexts())
    expect(value === "…" || Number(value.replace(/\s/g, "")) > 0, `a drawn count is no zero: ${value}`).toBe(true);
  await expect(page.getByRole("tab", { name: /^Table/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Through the releases" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("What the best paths crossed");
});

test("a table that fits its frame scrolls with the page, never in a box of its own", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`/batch?organism=${data.organism}`);
  await page.getByLabel("Identifiers", { exact: true }).fill(list());
  await page.getByRole("button", { name: /^Convert/ }).click();
  const wrap = page.locator(".table--batch").locator("xpath=ancestor::*[contains(@class,'table-wrap')]");
  await expect(wrap).toBeVisible();
  const overflowY = await wrap.evaluate((e) => getComputedStyle(e).overflowY);
  expect(["visible", "clip"]).toContain(overflowY);
});

test("Names refuses a release that is no whole number without asking the api", async ({ page }) => {
  let asked = 0;
  await page.route("**/names-of**", (route) => {
    asked += 1;
    return route.continue();
  });
  await page.goto(`/names?organism=${data.organism}&gene=${data.unknownVersion.identifier}&release=abc`);
  await expect(page.getByRole("heading", { name: "Not a release: abc" })).toBeVisible();
  expect(asked).toBe(0);
  await page.getByRole("button", { name: "List the names at every release" }).click();
  await expect(page).not.toHaveURL(/release=abc/);
});
