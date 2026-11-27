// End-to-end tests in headless Chromium against a running idtrack-web server that serves the api and the built
// frontend (as in production): E2E_BASE_URL (default http://127.0.0.1:8000). E2E_DATA names the graph's test data
// (e2e/data/<name>.json: `pig` for the real pig graph, `cut` for the api tests' small graph); E2E_SCREENSHOTS the
// folder the screenshots of every flow go to (default test-results/screenshots); E2E_BROWSER the browser engine
// (`chromium`, the default, `firefox` or `webkit`, each installed by `npx playwright install <engine>`). SETUP.md,
// "The frontend".
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:8000";
const browser = process.env["E2E_BROWSER"] ?? "chromium";
const device = { chromium: "Desktop Chrome", firefox: "Desktop Firefox", webkit: "Desktop Safari" }[browser];
if (!device) throw new Error(`E2E_BROWSER=${browser}: one of chromium, firefox, webkit`);

// The page opens in its light theme unless another was chosen; the dark projects choose the dark theme as a visitor
// does (kept in the browser's storage), and the system prefers dark too.
const chosenDark = {
  cookies: [],
  origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "idtrack-theme", value: "dark" }] }],
};

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env["CI"] ? 2 : 4,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop-light",
      use: { ...devices[device], viewport: { width: 1440, height: 900 }, colorScheme: "light" },
    },
    {
      name: "desktop-dark",
      use: {
        ...devices[device],
        viewport: { width: 1440, height: 900 },
        colorScheme: "dark",
        storageState: chosenDark,
      },
    },
    {
      name: "phone-light",
      use: {
        ...devices[device],
        viewport: { width: 390, height: 844 },
        colorScheme: "light",
        hasTouch: true,
      },
    },
    {
      name: "phone-dark",
      use: {
        ...devices[device],
        viewport: { width: 390, height: 844 },
        colorScheme: "dark",
        hasTouch: true,
        storageState: chosenDark,
      },
    },
  ],
});
