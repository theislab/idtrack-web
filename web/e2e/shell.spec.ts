// The shell's behaviour, rule by rule: never a white page (a part whose code does not arrive, an answer of another
// form), focus and one status sentence after every request and route change, state that survives an organism switch,
// a link away and Back, deep links with bad values answered with a way on, and no request the page makes twice.
import { expect, test, type Page } from "@playwright/test";
import { convertUrl, data, expectAccessible, shot, waitForResult, withoutPreload } from "./helpers";

/** The page is never white: the masthead and a heading are drawn, and no error escaped to the window. */
async function expectDrawn(page: Page, errors: string[]): Promise<void> {
  await expect(page.locator("header.masthead")).toBeVisible();
  expect(await page.locator("#root").evaluate((root) => root.children.length)).toBeGreaterThan(0);
  expect(errors, errors.join("\n")).toEqual([]);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    // A part whose code did not arrive is caught by its boundary; React still reports it to the window once.
    if (!/dynamically imported module|preload CSS/.test(error.message)) errors.push(error.message);
  });
  return errors;
}

/** The name of the focused element's tag and its text, for an assertion about where the focus is. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return { tag: element?.tagName ?? "", text: (element?.textContent ?? "").trim().slice(0, 120) };
  });

test.describe("never a white page", () => {
  test("a page whose code does not arrive is stated in place, with a way on, and loads when it can", async ({
    page,
  }, info) => {
    const errors = collectErrors(page);
    let missing = true;
    await page.route("**/assets/BatchPage-*.js", (route) =>
      missing
        ? route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"not_found"}}' })
        : route.continue(),
    );
    await page.goto(`/?organism=${data.organism}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Batch" }).click();
    // The page reloads once to fetch the site's current code; the part is missing again, so it is stated.
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
    await expect(alert.getByRole("button", { name: "Reload the page" })).toBeVisible();
    await expectDrawn(page, errors);
    await expectAccessible(page);
    await shot(page, info, "s1-chunk-missing");
    missing = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Many identifiers/ })).toBeVisible();
  });

  test("offline, a page not yet loaded says so and loads by itself when the connection returns", async ({
    page,
    context,
  }, info) => {
    const errors = collectErrors(page);
    await page.goto(`/?organism=${data.organism}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Names" }).click();
    await expect(page.getByRole("heading", { name: /not loaded: the browser is offline/ })).toBeVisible();
    await expectDrawn(page, errors);
    await shot(page, info, "s2-offline-page");
    await context.setOffline(false);
    await expect(page.getByRole("heading", { level: 1, name: /What a name names/ })).toBeVisible();
  });

  test("offline, a conversion says the browser is offline and is asked again when it is back", async ({
    page,
    context,
  }) => {
    await page.goto(`/?organism=${data.organism}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("textbox", { name: "Identifier", exact: true }).fill(data.symbol.identifier);
    await page.getByRole("textbox", { name: "Identifier", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "The browser is offline" })).toBeVisible();
    await context.setOffline(false);
    await waitForResult(page);
  });

  test("an answer of another form is an answer the page cannot read, never a crash", async ({ page }, info) => {
    const errors = collectErrors(page);
    await page.route("**/api/v1/organisms/*/convert?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "X-Request-ID": "e2e-shape" },
        body: '{"status":"converted"}',
      }),
    );
    await page.goto(convertUrl(data.symbol));
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: "An answer the page cannot read" })).toBeVisible();
    await expect(alert).toContainText("is not of the form its document gives");
    await expect(alert).toContainText("e2e-shape");
    await expectDrawn(page, errors);
    await shot(page, info, "s3-answer-of-another-form");
  });

  test("a list of organisms of another form is stated, with a way to ask again", async ({ page }) => {
    await withoutPreload(page); // the page's first answers asked, not written into it
    const errors = collectErrors(page);
    let broken = true;
    await page.route("**/api/v1/organisms", (route) =>
      broken
        ? route.fulfill({ status: 200, contentType: "application/json", body: '{"organisms": null}' })
        : route.continue(),
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "An answer the page cannot read" })).toBeVisible();
    await expectDrawn(page, errors);
    broken = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("focus and one sentence per outcome", () => {
  test("a conversion keeps the form, focuses its answer and says it in one sentence", async ({ page }) => {
    await page.goto(`/?organism=${data.organism}`);
    const field = page.getByRole("textbox", { name: "Identifier", exact: true });
    await field.fill(data.symbol.identifier);
    const answered = page.waitForResponse(
      (r) => r.url().includes("/convert?") && r.url().includes(`identifier=${data.symbol.identifier}&`),
    );
    await field.press("Enter");
    const response = await answered;
    await waitForResult(page);
    await expect.poll(async () => (await focused(page)).tag).toBe("H2");
    // The answer's server time is its own response's Server-Timing header, as sent.
    const app = /app;dur=([^,;]+)/.exec(response.headers()["server-timing"] ?? "")?.[1];
    expect(app, "the answer carries Server-Timing").toBeTruthy();
    await expect(page.locator(".answer__facts")).toContainText(`${app ?? "-"} ms`);
    // The form was not made anew: the field still holds what was sent.
    await expect(field).toHaveValue(data.symbol.identifier);
    await expect(page.locator(".result-area")).not.toHaveAttribute("aria-live", /.+/);
    await expect(page.getByRole("status").filter({ hasText: data.symbol.identifier }).first()).toContainText(
      `: ${data.symbol.identifier}`,
    );
    await expect(page).toHaveTitle(new RegExp(`^${data.symbol.identifier}.* · Convert · idtrack$`));
  });

  test("a route change moves the focus to the new page's heading", async ({ page }) => {
    await page.goto(`/?organism=${data.organism}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const batch = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Batch" });
    await batch.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await focused(page)).tag).toBe("H1");
    await expect(page).toHaveTitle("Batch · idtrack");
  });

  test("a pressed Convert while its conversion is on its way asks nothing more", async ({ page }) => {
    let asked = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/v1/organisms/*/convert?identifier=${data.symbol.identifier}&*`, async (route) => {
      asked += 1;
      await held;
      await route.continue();
    });
    await page.goto(`/?organism=${data.organism}`);
    await page.getByRole("textbox", { name: "Identifier", exact: true }).fill(data.symbol.identifier);
    const convert = page.getByRole("button", { name: "Convert", exact: true });
    await convert.click();
    await expect(page.locator(".result-area")).toHaveAttribute("aria-busy", "true");
    await convert.click();
    await convert.click();
    release();
    await waitForResult(page);
    expect(asked).toBe(1);
  });
});

test.describe("state that survives", () => {
  test("what was typed is kept across an organism switch", async ({ page }) => {
    await page.goto(`/?organism=${data.organism}`);
    const picker = page.getByRole("combobox", { name: "Organism" });
    const options = await picker
      .locator("option")
      .evaluateAll((list) => list.map((o) => (o as HTMLOptionElement).value));
    test.skip(options.length < 2, "the server holds one organism");
    await page.getByRole("textbox", { name: "Identifier", exact: true }).fill("BRCA2");
    const other = options.find((o) => o !== data.organism) ?? "";
    await picker.selectOption(other);
    await expect(page).toHaveURL(new RegExp(`organism=${other}`));
    await expect(page.getByRole("textbox", { name: "Identifier", exact: true })).toHaveValue("BRCA2");
    await picker.selectOption(data.organism);
    await expect(page.getByRole("textbox", { name: "Identifier", exact: true })).toHaveValue("BRCA2");
  });

  test("a converted batch, its list and its setting are kept after a link away and Back, and after a reload", async ({
    page,
  }) => {
    await page.goto(`/batch?organism=${data.organism}`);
    const list = page.getByLabel("Identifiers", { exact: true });
    await list.fill(data.batch.join("\n"));
    await page.getByLabel("To release").fill("");
    await page.getByRole("button", { name: /^Convert \d/ }).click();
    await expect(page.getByRole("button", { name: /api.s JSON$/ })).toBeVisible();
    await expect.poll(async () => (await focused(page)).tag).toMatch(/^H[23]$/);
    await expect(page.getByRole("status").filter({ hasText: "The batch of" }).first()).toContainText(
      `The batch of ${data.batch.length} identifiers is answered`,
    );
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Names" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /What a name names/ })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel("Identifiers", { exact: true })).toHaveValue(data.batch.join("\n"));
    await expect(page.getByRole("button", { name: /api.s JSON$/ })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Identifiers", { exact: true })).toHaveValue(data.batch.join("\n"));
    await expect(page.getByRole("button", { name: /api.s JSON$/ })).toBeVisible();
  });

  test("a pasted column in the Convert field is offered to Batch as a list", async ({ page }, info) => {
    await page.goto(`/?organism=${data.organism}`);
    const field = page.getByRole("textbox", { name: "Identifier", exact: true });
    await field.focus();
    await page.evaluate((text) => {
      const target = document.activeElement as HTMLInputElement;
      const transfer = new DataTransfer();
      transfer.setData("text", text);
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, data.batch.slice(0, 3).join("\n"));
    await expect(page.getByText("You pasted 3 lines.")).toBeVisible();
    await expect(field).toHaveValue("");
    await expectAccessible(page);
    await shot(page, info, "s4-pasted-column");
    await page.getByRole("button", { name: "Convert the 3 as a list" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Many identifiers/ })).toBeVisible();
    await expect(page.getByLabel("Identifiers", { exact: true })).toHaveValue(data.batch.slice(0, 3).join("\n"));
  });
});

test.describe("addresses", () => {
  test("a release out of bounds in a deep link is refused with a way on", async ({ page }, info) => {
    await page.goto(convertUrl({ identifier: data.symbol.identifier, to: 0 }));
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("to_release");
    await expectAccessible(page);
    await shot(page, info, "s5-refusal-way-on");
    await alert.getByRole("button", { name: "Convert without the to release" }).click();
    await waitForResult(page);
    await expect(page).not.toHaveURL(/to=/);
  });

  test("an address that is no page is said at once, with a heading, before the organisms arrive", async ({
    page,
  }, info) => {
    await page.route("**/api/v1/organisms", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    await page.goto("/organisms/sus_scrofa/extra");
    await expect(page.getByRole("heading", { level: 1, name: "No such page" })).toBeVisible({ timeout: 2000 });
    await expect(page).toHaveTitle("Not found · idtrack");
    await expect(page.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveCount(0);
    await expectAccessible(page);
    await shot(page, info, "s6-no-such-page");
  });

  test("a trailing slash names the same page", async ({ page }) => {
    await page.goto("/organisms/");
    await expect(page).toHaveURL(/\/organisms$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("the page never asks twice", () => {
  test("a refusal that names its wait counts it down and is asked again once by itself", async ({ page }) => {
    let refused = 0;
    await page.route("**/api/v1/organisms/*/convert?*", async (route) => {
      if (refused === 0) {
        refused += 1;
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          headers: { "Retry-After": "2", "X-Request-ID": "e2e" },
          body: JSON.stringify({
            error: {
              code: "rate_limited",
              message: "Too many requests.",
              argument: null,
              allowed: null,
              details: null,
              request_id: "e2e",
            },
          }),
        });
      } else await route.continue();
    });
    await page.goto(convertUrl(data.symbol));
    await expect(page.getByRole("button", { name: /Try again in \d s/ })).toBeDisabled();
    await waitForResult(page);
  });

  test("the shell's reads come written into the page, and a return to an answer asks nothing", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/") && !url.pathname.endsWith("/status"))
        asked.push(url.pathname + url.search);
    });
    await page.goto(convertUrl(data.symbol));
    await waitForResult(page);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Names" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /What a name names/ })).toBeVisible();
    await page.goBack();
    await waitForResult(page);
    // Written into the page by the server: never asked.
    for (const path of ["/api/v1/organisms", "/api/v1/version", "/api/v1/vocabulary", "/api/v1/limits"]) {
      expect(
        asked.filter((a) => a === path),
        path,
      ).toHaveLength(0);
    }
    expect(asked.filter((a) => a.includes("/convert?"))).toHaveLength(1);
  });

  test("a return to the home asks nothing of its figures again", async ({ page }) => {
    await page.goto(`/?organism=${data.organism}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const asked: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (/\/(convert|convert\/batch|showcase)$/.test(url.pathname)) asked.push(url.pathname + url.search);
    });
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("link", { name: "Batch" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Many identifiers/ })).toBeVisible();
    await nav.getByRole("link", { name: "Convert" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Follow a gene.id through/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(asked).toEqual([]);
  });
});
