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

test("convert a symbol from the form", async ({ page }, info) => {
  await page.goto(`/convert?organism=${data.organism}`);
  await page.getByLabel("Identifier").fill(data.symbol.identifier);
  await page.getByRole("button", { name: "Convert", exact: true }).click();
  await waitForResult(page);
  await expect(page).toHaveURL(new RegExp(`id=${data.symbol.identifier}`));
  const answer = (await (await page.request.get(apiConvertUrl(data.symbol))).json()) as Result;
  // The first targets of each gene of the best answer stand in the answer (the rest on request).
  for (const best of answer.candidates.filter((c) => c.best).slice(0, 3)) {
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

  // The reading ("In words") lists every step of the best candidate, in order (the others on choice); each score as
  // the api wrote it.
  await page.getByRole("radio", { name: "In words" }).click();
  const reading = page.locator(".reading");
  const best0 = answer.candidates.find((c) => c.best);
  const bestSteps = [...(best0?.path ?? []), ...(best0?.final_path ?? [])];
  // On a phone the first steps are shown, the rest on a press.
  const everyStep = reading.getByRole("button", { name: /^Show all \d+ steps$/ });
  if (await everyStep.count()) await everyStep.click();
  await expect(reading.locator(".steps__row")).toHaveCount(bestSteps.length);
  const weights = [...raw.slice(raw.indexOf('"steps":')).matchAll(/"weight":(null|[-0-9.eE+]+)/g)].map((m) => m[1]);
  const readingText = await reading.innerText();
  for (const index of bestSteps) {
    const token = weights[index];
    if (token && token !== "null") expect(readingText).toContain(token);
  }

  // The drawing: one element per drawn step, the best answer in the answer column with the deciding criterion.
  await page.getByRole("radio", { name: "Drawing" }).click();
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
  // The other views are in the toolbar's popover, "View".
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("button", { name: "All releases" }).click();
  await expect(page.getByRole("button", { name: "All releases" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^View/ })).toBeFocused();
  await expect.poll(shown).not.toBe("");
  const all = await shown();
  // The zoom is in the same popover, two matching icons.
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.keyboard.press("Escape");
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
  // The timeline's scale is in its toolbar's popover, "View".
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("button", { name: "Spread the releases" }).click();
  await expect.poll(async () => (await drawing.boundingBox())?.height ?? 0).toBeGreaterThan(height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, info, "05-path-phone-timeline");
});

test("every note of the path view stands whole in the window, and every element says its state", async ({
  page,
}, info) => {
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const drawing = page.getByRole("group", { name: /^Path of/ });
  await drawing.locator('[tabindex="0"]').first().focus();
  const tip = page.getByRole("tooltip");
  for (let i = 0; i < 30; i++) {
    await expect(tip).toBeVisible();
    // Whole: inside the window, and cut by no frame (what it holds can be scrolled to inside it).
    const box = await tip.evaluate((el) => {
      const b = el.getBoundingClientRect();
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const style = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        if (
          (style.overflowY !== "visible" || style.overflowX === "hidden") &&
          (b.bottom > r.bottom + 1 || b.top < r.top - 1)
        )
          clipped = true;
      }
      const mast = document.querySelector(".mast")?.getBoundingClientRect().bottom ?? 0;
      return {
        top: b.top,
        bottom: b.bottom,
        height: innerHeight,
        clipped,
        mast,
        scrolls: el.scrollHeight > el.clientHeight + 1,
      };
    });
    // Below the sticky masthead and inside the window.
    expect(box.top).toBeGreaterThanOrEqual(box.mast - 1);
    expect(box.bottom).toBeLessThanOrEqual(box.height + 1);
    expect(box.clipped).toBe(false);
    if (box.scrolls) {
      // A note longer than its room is read whole by keyboard: PageDown scrolls it.
      const before = await tip.evaluate((el) => el.scrollTop);
      await page.keyboard.press("PageDown");
      expect(await tip.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    }
    // The element shown is named with its facts and described by the note.
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("aria-describedby", /.+/);
    await expect(focused).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("ArrowRight");
  }
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute("aria-pressed", "true");
  if (!isPhone(info)) {
    // The toolbar says which view it set: the whole path, at first.
    await expect(page.getByRole("button", { name: "Fit the path" })).toHaveAttribute("aria-pressed", "true");
    // The pinned note is let go first (it may stand over the toolbar).
    await page.keyboard.press("Escape");
    const views = page.getByRole("button", { name: /^View/ });
    await views.click();
    await page.getByRole("button", { name: "All releases" }).click();
    await expect(page.getByRole("button", { name: "Fit the path" })).toHaveAttribute("aria-pressed", "false");
    await views.click();
    await expect(page.getByRole("button", { name: "All releases" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
  }
});

test("a note of the path view can be pointed at, and Escape hides it without moving focus (WCAG 1.4.13)", async ({
  page,
}, info) => {
  test.skip(isPhone(info), "a touch screen has no pointing");
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const drawing = page.getByRole("group", { name: /^Path of/ });
  const item = drawing.locator('[role="button"]').first();
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  if (!box) throw new Error("the element has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  // The pointer goes straight from the element onto its note (up or down, where the note stands), a few pixels at a
  // time: the note stays all the way.
  const note = await tip.boundingBox();
  if (!note) throw new Error("the note has no box");
  const x = box.x + box.width / 2;
  const from = box.y + box.height / 2;
  const to = note.y > from ? note.y + 12 : note.y + note.height - 12;
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x, from + ((to - from) * i) / 8);
    await expect(tip).toBeVisible();
  }
  // Escape hides it, wherever the focus is, and the focus does not move.
  await page.locator("body").focus();
  const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).toBe(focused);
});

test("in forced colours, every text of the answer's figures is the system's text colour", async ({ browser }) => {
  const context = await browser.newContext({ forcedColors: "active", colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const dark = await page.evaluate(() =>
    [...document.querySelectorAll(".result svg text")]
      .map((t) => ({ name: t.getAttribute("class") ?? "", fill: getComputedStyle(t).fill }))
      .filter(({ fill }) => {
        const m = /rgb\((\d+), (\d+), (\d+)/.exec(fill);
        return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 128 : false;
      }),
  );
  expect(dark).toEqual([]);
  // A text drawn with a stroke (a halo of the canvas) draws it behind its glyphs, never over them.
  const eroded = await page.evaluate(() =>
    [...document.querySelectorAll(".result svg text")]
      .map((t) => ({ name: t.getAttribute("class") ?? "", style: getComputedStyle(t) }))
      .filter(({ style }) => style.stroke !== "none" && !style.paintOrder.startsWith("stroke"))
      .map(({ name }) => name),
  );
  expect(eroded).toEqual([]);
  // The pressed view of the toolbar keeps its text: the highlight's colours, without the canvas's backplate.
  const pressed = page.locator('.pv-preset[aria-pressed="true"]').first();
  if (await pressed.count()) expect(await pressed.evaluate((b) => getComputedStyle(b).forcedColorAdjust)).toBe("none");
  await context.close();
});

test("a conversion back in time, through bridges", async ({ page }, info) => {
  await page.goto(convertUrl(data.backward));
  await waitForResult(page);
  await page.getByRole("radio", { name: "In words" }).click();
  // Each step of Ensembl's history in Ensembl's direction (the releases ascending), the walk's direction marked apart.
  await expect(page.locator(".reading")).toContainText("walked backward");
  for (const when of await page.locator(".reading .steps__when").allInnerTexts()) {
    const [a, b] = when.split("→").map((t) => Number(t.trim()));
    if (a !== undefined && b !== undefined && !Number.isNaN(b)) expect(a).toBeLessThanOrEqual(b);
  }
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
    // The api's answer as sent, with its reason as the api writes it, is in the answer's record.
    await page.getByRole("tab", { name: "Record" }).click();
    await page.getByRole("button", { name: /^The api's answer, as sent/ }).click();
    if (answer.reason) await expect(page.locator(".result")).toContainText(answer.reason);
    for (const version of answer.known_versions) await expect(page.locator(".result")).toContainText(version);
    await expectAccessible(page);
    await shot(page, info, name);
  }
});

test("the candidate chosen in the decision is the one the path draws strong", async ({ page }) => {
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  await page.getByRole("tab", { name: /^Decision/ }).click();
  const rows = page.getByRole("region", { name: "Candidates, ranked" }).locator("tbody tr.cand__row");
  // The panel follows the tab a moment later.
  await expect(rows.nth(1)).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(1);
  // Pointing at a row marks it; its "On the path" opens the Path tab with that candidate alone drawn strong.
  await rows.nth(1).hover();
  await expect(rows.nth(1)).toHaveClass(/is-highlighted/);
  await rows
    .nth(1)
    .getByRole("button", { name: /^Draw candidate 2, .* strong on the path$/ })
    .click();
  await expect(page.getByRole("tab", { name: /^Path/ })).toHaveAttribute("aria-selected", "true");
  const strong = page.locator(".pv-answer.pv-strong");
  await expect(strong).toHaveCount(1);
  await expect(page.locator(".pv__chosen")).toContainText("Candidate 2");
  // Back to the best answer.
  await page.getByRole("button", { name: "Draw the best answer strong" }).click();
  await expect(page.locator(".pv__chosen")).toHaveCount(0);
});

test("the conversion's address holds every option and reloads", async ({ page }) => {
  await page.goto(`/convert?organism=${data.organism}&id=${data.long.identifier}&bridges=false&explain=false`);
  await waitForResult(page);
  await expect(page.getByText("The path was not asked for", { exact: false })).toBeVisible();
  // The verdict's query says the options away from their defaults; Edit unfolds the form, whose one line says every
  // setting and opens on a press to all their fields.
  await expect(page.locator(".answer__asked")).toContainText("no bridges · no path asked");
  await page.getByRole("button", { name: "Edit the conversion" }).click();
  const fold = page.getByRole("button", { name: /^Settings/ });
  await expect(fold).toContainText("no bridges · no path");
  await fold.click();
  await expect(page.getByRole("switch", { name: "Allow bridges" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Show the path" })).not.toBeChecked();
  await page.goBack();
});

test("every id of an answer is a way on, and a link made on another graph says so", async ({ page }, info) => {
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  // The answer's id opens a menu of where to go from it; its links are this site's addresses.
  const id = page.locator(".answer__id .toggletip__term").first();
  await id.click();
  const menu = page.locator(".answer__id .idmenu__card");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: /^Open it in Convert/ })).toHaveAttribute(
    "href",
    /^\/convert\?organism=/,
  );
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // A link that names another graph than the server's: said above the answer; the server's own: nothing said.
  await page.goto(`${convertUrl(data.long)}&graph=000000000000`);
  await waitForResult(page);
  await expect(page.getByRole("heading", { name: "This link was made on another graph" })).toBeVisible();
  const description = (await (await page.request.get(`/api/v1/organisms/${data.organism}`)).json()) as {
    content_digest: string | null;
  };
  if (description.content_digest) {
    await page.goto(`${convertUrl(data.long)}&graph=${description.content_digest.slice(0, 12)}`);
    await waitForResult(page);
    await expect(page.getByRole("heading", { name: "This link was made on another graph" })).toHaveCount(0);
  }
  await shot(page, info, "07-answer-hub");
});
