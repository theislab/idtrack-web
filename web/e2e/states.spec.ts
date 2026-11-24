// Every designed state: loading, the api's refusals (each with what to change), the api unreachable, unknown places.
import { expect, test } from "@playwright/test";
import { convertUrl, data, expectAccessible, shot } from "./helpers";

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
  // The code's meaning is the api's own (`/vocabulary`), the message says what to change for this request.
  const vocabulary = (await (await page.request.get("/api/v1/vocabulary")).json()) as {
    errors: { code: string; meaning: string }[];
  };
  const meaning = vocabulary.errors.find((e) => e.code === "unknown_release")?.meaning ?? "-";
  await expect(alert.locator(".notice__title")).toHaveText(meaning);
  await expect(alert).toContainText(/Accepted for to_release/);
  await expectAccessible(page);
  await shot(page, info, "12-error-unknown-release");
});

test("a release that is not a number, checked by the api", async ({ page }) => {
  await page.goto(`/?organism=${data.organism}&id=${data.symbol.identifier}&to=abc`);
  await expect(page.getByRole("alert")).toContainText("invalid_request");
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
  await expect(alert).toContainText("Try again in 12 s.");
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  await shot(page, info, "14-error-rate-limited");
});

test("an organism the server does not hold", async ({ page }, info) => {
  await page.goto("/?organism=unicorn");
  await expect(page.getByRole("alert")).toContainText("An organism this server does not hold");
  await page.goto("/organisms/unicorn");
  await expect(page.getByRole("alert")).toContainText("unicorn");
  await shot(page, info, "15-unknown-organism");
});

test("a page that does not exist", async ({ page }, info) => {
  await page.goto("/no/such/page");
  await expect(page.getByText("No such page")).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "16-not-found-page");
});

test("the theme can be chosen and is kept", async ({ page }) => {
  await page.goto("/about");
  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Theme").selectOption("system");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});
