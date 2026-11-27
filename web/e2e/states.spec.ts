// Every designed state: loading, the api's refusals (each with what to change), the api unreachable, unknown places.
import { expect, test } from "@playwright/test";
import { convertUrl, data, expectAccessible, isPhone, shot, withoutPreload } from "./helpers";

test("loading shows the skeleton of the axis", async ({ page }, info) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/organisms/*/convert?*", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(convertUrl(data.symbol));
  await expect(page.locator(".skeleton-axis")).toBeVisible();
  await expect(page.locator(".result-area")).toHaveAttribute("aria-busy", "true");
  await shot(page, info, "11-loading");
  release();
  await expect(page.locator("article.result")).toBeVisible();
});

test("an unknown release: the api's message, the accepted values, what to change", async ({ page }, info) => {
  await page.goto(convertUrl({ identifier: data.symbol.identifier, to: 999 }));
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("unknown_release");
  // The code's title is the api's own (`/vocabulary`), the message says what to change for this request.
  const vocabulary = (await (await page.request.get("/api/v1/vocabulary")).json()) as {
    errors: { code: string; title: string }[];
  };
  const meaning = vocabulary.errors.find((e) => e.code === "unknown_release")?.title ?? "-";
  await expect(alert.locator(".notice__title")).toHaveText(meaning);
  // The accepted values in the words of the form; the api's message on request.
  await expect(alert).toContainText(/Accepted for the target release/);
  await expectAccessible(page);
  await shot(page, info, "12-error-unknown-release");
});

test("a release that is not a number is said in the graph's terms, and nothing is asked", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/convert")) asked.push(request.url());
  });
  await page.goto(`/?organism=${data.organism}&id=${data.symbol.identifier}&to=abc`);
  await expect(page.getByRole("alert")).toContainText("Not a release: abc");
  await expect(page.getByRole("alert")).toContainText("graph holds releases");
  await expect(page.getByRole("button", { name: "Convert without the to release" })).toBeVisible();
  expect(asked).toEqual([]);
  await expect(page.getByLabel("To release")).toHaveValue("abc");
  await expect(page.getByText("A release is a whole number.")).toBeVisible();
});

test("an unknown database", async ({ page }) => {
  await page.goto(convertUrl({ identifier: data.symbol.identifier, db: "NoSuchDatabase" }));
  await expect(page.getByRole("alert")).toContainText("unknown_database");
});

test("an empty identifier is caught before asking", async ({ page }) => {
  await page.goto(`/?organism=${data.organism}`);
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  await expect(page.getByText("Enter an identifier to convert.")).toBeVisible();
  await expect(page.getByLabel("Identifier")).toHaveAttribute("aria-invalid", "true");
});

test("the api unreachable, then back", async ({ page }, info) => {
  await withoutPreload(page); // the page's first answers asked, not written into it
  let down = true;
  await page.route("**/api/v1/organisms", async (route) => {
    if (down) await route.abort("connectionrefused");
    else await route.continue();
  });
  await page.goto("/");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The api cannot be reached");
  await expectAccessible(page);
  await shot(page, info, "13-api-unreachable");
  down = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a gateway answering for a down api", async ({ page }) => {
  await page.route("**/api/v1/organisms/*/convert?*", (route) =>
    route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>" }),
  );
  await page.goto(convertUrl(data.symbol));
  await expect(page.getByRole("alert")).toContainText("a gateway answered 502");
});

test("rate limited: wait and try again", async ({ page }, info) => {
  await page.route("**/api/v1/organisms/*/convert?*", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "12", "X-Request-ID": "e2e" },
      body: JSON.stringify({
        error: {
          code: "rate_limited",
          message: "Too many requests from this client; retry after 12 s.",
          argument: null,
          allowed: null,
          details: null,
          request_id: "e2e",
        },
      }),
    }),
  );
  await page.goto(convertUrl(data.symbol));
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("rate_limited");
  // The wait the api names is counted down on the button, which is pressed only when it is over.
  await expect(alert).toContainText("The api asks to wait 12 s before asking again");
  await expect(alert.getByRole("button", { name: /Try again in 1[0-2] s/ })).toBeDisabled();
  await shot(page, info, "14-error-rate-limited");
});

test("an organism the server does not hold", async ({ page }, info) => {
  await page.goto("/?organism=unicorn");
  await expect(page.getByRole("alert")).toContainText("An organism this server does not hold");
  await page.goto("/organisms/unicorn");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("unicorn");
  await expect(page).toHaveTitle(/^Not found/);
  await shot(page, info, "15-unknown-organism");
});

test("a page that does not exist", async ({ page }, info) => {
  await page.goto("/no/such/page");
  await expect(page.getByText("No such page")).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "16-not-found-page");
});

test.describe("the theme", () => {
  // A first visit: nothing chosen yet, whatever the project chooses.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the theme is light by default and can be chosen and kept", async ({ page }, info) => {
    // On a phone the three choices are in the menu of one button (it closes on a choice).
    const choose = async (name: string) => {
      if (isPhone(info)) await page.locator(".theme-menu__button").click();
      await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name }).click();
    };
    await page.goto("/method");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await choose("Dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (isPhone(info)) await expect(page.locator(".theme-menu__button")).toHaveAccessibleName("Theme: Dark");
    await choose("System");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await choose("Light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
