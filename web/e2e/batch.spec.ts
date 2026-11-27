// The batch's behaviour as a person meets it: a failure says only what will happen (a batch that failed for want of
// an answer is asked again when the connection returns), work started is never dropped by an organism switch, the
// answer is kept for the session once (typing does not write it again), a row named in another row is reached by a
// press, and a large insertion never holds the page.
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
  await expect(page.locator(".batch-figure-head__title")).toBeVisible();
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
  // The organism switched in the page's own picker (a new page load would end every script of the page).
  await page.getByRole("combobox", { name: "Organism" }).selectOption(other ?? "");
  await expect(page.locator(".batch-elsewhere")).toContainText("is being converted");
  release();
  await expect(page.locator(".batch-elsewhere")).toContainText("is done");
  await page.locator(".batch-elsewhere").getByRole("link").click();
  await expect(page.locator(".batch-figure-head__title")).toContainText(`${String(data.batch.length)} identifiers`);
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
  await expect(page.locator(".batch-figure-head__title")).toBeVisible();
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
