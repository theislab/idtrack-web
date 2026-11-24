// Converting one identifier, and the path view with real data: what is drawn and read is what the api returned.
import { expect, test } from "@playwright/test";
import { apiConvertUrl, convertUrl, data, expectAccessible, isPhone, shot, waitForResult } from "./helpers";

interface Step {
  kind: string;
  weight: number | null;
}
interface Candidate {
  best: boolean;
  target: string;
  path: number[];
  final_path: number[];
}
interface Result {
  candidates: Candidate[];
  path: { steps: Step[] } | null;
  decided_by: string | null;
  status: string;
  reason: string | null;
  known_versions: string[];
}

test("the empty start page", async ({ page }, info) => {
  await page.goto(`/?organism=${data.organism}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where is this gene at another release?");
  await expect(page.getByText("Nothing converted yet")).toBeVisible();
  await expectAccessible(page);
  await shot(page, info, "01-start-empty");
});

test("convert a symbol from the form", async ({ page }, info) => {
  await page.goto(`/?organism=${data.organism}`);
  await page.getByLabel("Identifier").fill(data.symbol.identifier);
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  await waitForResult(page);
  await expect(page).toHaveURL(new RegExp(`id=${data.symbol.identifier}`));
  const answer = (await (await page.request.get(apiConvertUrl(data.symbol))).json()) as Result;
  for (const best of answer.candidates.filter((c) => c.best)) {
    await expect(page.locator(".answer__targets")).toContainText(best.target);
  }
  await expectAccessible(page);
  await shot(page, info, "02-convert-symbol");
});

test("the path view draws and reads the api's path, step for step", async ({ page }, info) => {
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const raw = await (await page.request.get(apiConvertUrl(data.long))).text();
  const answer = JSON.parse(raw) as Result;
  const steps = answer.path?.steps ?? [];
  expect(steps.length).toBeGreaterThan(3);

  // The reading lists every step of every candidate, in order; each score as the api wrote it.
  const reading = page.locator(".reading");
  await expect(reading.locator(".reading__step")).toHaveCount(
    answer.candidates.reduce((n, c) => n + c.path.length + c.final_path.length, 0),
  );
  const weights = [...raw.slice(raw.indexOf('"steps":')).matchAll(/"weight":(null|[-0-9.eE+]+)/g)].map((m) => m[1]);
  const readingText = await reading.innerText();
  for (const token of weights) if (token !== "null") expect(readingText).toContain(`score ${token ?? ""}`);

  // The drawing: one element per drawn step, the best answer in the answer column with the deciding criterion.
  const drawing = page.getByRole("group", { name: /^Path of/ });
  await expect(drawing).toBeVisible();
  const drawnSteps = drawing.locator("g.pv-step");
  expect(await drawnSteps.count()).toBeGreaterThan(0);
  const best = answer.candidates.find((c) => c.best);
  if (best) await expect(drawing.getByRole("button", { name: new RegExp(`^Candidate 1 \\(best\\)`) })).toBeVisible();

  // Focus and hover give the exact values.
  const firstStep = drawnSteps.first();
  await firstStep.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await shot(page, info, "03-path-long");
  await expectAccessible(page);
});

test("the path view by keyboard alone", async ({ page }, info) => {
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const drawing = page.getByRole("group", { name: /^Path of/ });
  // Tab from the page's start until the drawing's one tab stop is reached.
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await drawing.evaluate((svg) => svg.contains(document.activeElement));
  }
  expect(reached).toBe(true);
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  const first = await tip.innerText();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tip).not.toHaveText(first);
  await page.keyboard.press("Enter");
  await expect(tip).toContainText("Pinned");
  await page.keyboard.press("End");
  await expect(tip).toContainText("Candidate");
  await shot(page, info, "04-path-keyboard");
  await page.keyboard.press("Escape");
  // Escape unpins: no pinned tooltip remains (the tooltip may stay unpinned on focus, or close).
  await expect(tip.filter({ hasText: "Pinned" })).toHaveCount(0);
});

test("zoom and pan along the releases", async ({ page }, info) => {
  test.skip(isPhone(info), "the phone's timeline has its own scale buttons, checked below");
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  // The release labels on the axis say which releases are in view.
  const ticks = page.locator(".pv-axis text");
  const shown = async () => (await ticks.allTextContents()).join(",");
  await page.getByRole("button", { name: "All releases" }).click();
  await expect.poll(shown).not.toBe("");
  const all = await shown();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(shown).not.toBe(all);
  const zoomed = await shown();
  const svg = page.getByRole("group", { name: /^Path of/ });
  const box = await svg.boundingBox();
  if (!box) throw new Error("the drawing has no box");
  await page.mouse.move(box.x + box.width * 0.3, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(shown).not.toBe(zoomed);
  await page.getByRole("button", { name: "Fit the path" }).click();
  await shot(page, info, "05-path-zoomed");
});

test("the phone's vertical timeline", async ({ page }, info) => {
  test.skip(!isPhone(info), "the vertical timeline is the phone's drawing");
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const drawing = page.getByRole("group", { name: /as a timeline from top to bottom/ });
  await expect(drawing).toBeVisible();
  const height = (await drawing.boundingBox())?.height ?? 0;
  await page.getByRole("button", { name: "Spread the releases" }).click();
  await expect.poll(async () => (await drawing.boundingBox())?.height ?? 0).toBeGreaterThan(height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, info, "05-path-phone-timeline");
});

test("a conversion back in time, through bridges", async ({ page }, info) => {
  await page.goto(convertUrl(data.backward));
  await waitForResult(page);
  await expect(page.locator(".reading")).toContainText("travelled backward");
  await expectAccessible(page);
  await shot(page, info, "06-path-backward");
});

test("the states of an answer without a target", async ({ page }, info) => {
  const cases = [
    ["07-not-found", data.notFound],
    ["08-unknown-version", data.unknownVersion],
    ["09-no-target", data.noTarget],
    ["10-no-conversion", data.noConversion],
  ] as const;
  for (const [name, query] of cases) {
    await page.goto(convertUrl(query));
    await waitForResult(page);
    const answer = (await (await page.request.get(apiConvertUrl(query))).json()) as Result;
    if (answer.reason) await expect(page.locator(".result")).toContainText(answer.reason);
    for (const version of answer.known_versions) await expect(page.locator(".result")).toContainText(version);
    await expectAccessible(page);
    await shot(page, info, name);
  }
});

test("the table of candidates highlights a candidate's path", async ({ page }) => {
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const rows = page.getByRole("region", { name: "Candidates, ranked" }).locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(1);
  await rows.nth(1).hover();
  await expect(page.locator(".pv-answer.pv-strong")).toHaveCount(1);
});

test("the conversion's address holds every option and reloads", async ({ page }) => {
  await page.goto(`/?organism=${data.organism}&id=${data.long.identifier}&bridges=false&explain=false`);
  await waitForResult(page);
  await expect(page.getByText("The path was not asked for", { exact: false })).toBeVisible();
  // The options away from their defaults open "More options" by themselves.
  await expect(page.locator("details.convert-form__advanced")).toHaveAttribute("open", "");
  await expect(page.getByRole("switch", { name: "Allow bridges" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Show the path" })).not.toBeChecked();
  await page.goBack();
});
