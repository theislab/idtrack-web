// Explore's stories against the real server: nothing the reader sees moves while the stories load (the layout shifts
// summed, as the browser reports them); every case is a small figure as tall as what it draws, the cards standing on
// rows of one height whose kinds' names share a line, its concept in its hover card, the key (a hover card over the
// gallery) drawing every mark it names; the replay of the journey up close writes each step as a sentence, then its
// ids, Ensembl's score and the product of the scores so far, and ends on the candidate's score as the api gives it.
import { expect, test, type Page } from "@playwright/test";
import type { ShowcaseResponse } from "../src/api/types";
import { isCaseKind } from "../src/lib/home/caseKinds";
import { storiesOf } from "../src/lib/explore/gallery";
import { sketchLayout } from "../src/lib/explore/sketch";
import { pythonFloat } from "../src/lib/numbers";
import { data, expectAccessible, shot } from "./helpers";

async function showcaseOf(page: Page, organism: string): Promise<ShowcaseResponse> {
  return (await (await page.request.get(`/api/v1/organisms/${organism}/showcase`)).json()) as ShowcaseResponse;
}

/** The gallery's cases (every case but the journey up close, the handoff card the most convoluted handoff). */
const casesOf = (showcase: ShowcaseResponse) =>
  storiesOf(showcase).cases.filter((c) => c.result !== null && isCaseKind(c.kind));

test("Explore: nothing in view moves while the stories load", async ({ page }) => {
  const showcase = await showcaseOf(page, data.organism);
  // A showcase without cases gives the room held for them back once it has come: there is nothing to hold it for.
  test.skip(casesOf(showcase).length === 0, "the server's showcase holds no cases for this graph");
  await page.addInitScript(() => {
    const w = window as unknown as { shifts: number[] };
    w.shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
        if (!entry.hadRecentInput) w.shifts.push(entry.value);
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(`/organisms?organism=${data.organism}`);
  await expect(page.locator(".case").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() =>
    (window as unknown as { shifts: number[] }).shifts.reduce((total, value) => total + value, 0),
  );
  expect(cls).toBeLessThan(0.05);
});

test("Explore: every case is a small figure as tall as what it draws, the key draws its marks", async ({
  page,
}, info) => {
  const showcase = await showcaseOf(page, data.organism);
  const cases = casesOf(showcase);
  test.skip(cases.length === 0, "the server's showcase holds no cases for this graph");
  await page.goto(`/organisms?organism=${data.organism}`);
  const cards = page.locator(".case");
  await expect(cards).toHaveCount(cases.length);
  await expect(page.locator(".case-sketch svg")).toHaveCount(cases.length);
  // Each sketch is as tall as its layout says: a sketch of one row holds no room of a taller one.
  const heights = await page
    .locator(".case-sketch svg")
    .evaluateAll((svgs) => svgs.map((s) => Number(s.getAttribute("height"))));
  expect(heights).toEqual(cases.map((c) => (c.result ? sketchLayout(c.result).height : 0)));
  // The cards stand on rows of one height: the cards of a row start and end together, and their kinds' names share
  // one line.
  const rows = await page.locator(".case").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      const t = e.querySelector(".case__title")?.getBoundingClientRect();
      return [Math.round(r.top), Math.round(r.bottom), Math.round(t?.top ?? 0)];
    }),
  );
  const byRow = new Map<number, number[][]>();
  for (const box of rows) byRow.set(box[0] ?? 0, [...(byRow.get(box[0] ?? 0) ?? []), box]);
  for (const row of byRow.values()) {
    expect(new Set(row.map((b) => b[1])).size).toBe(1);
    expect(new Set(row.map((b) => b[2])).size).toBe(1);
  }
  // A card is its sketch, its kind and one line; its concept is one gesture away, in its hover card.
  const first = cards.first();
  await expect(first.locator(".case__line")).toContainText(cases[0]?.query.identifier ?? "-");
  await expect(first.locator(".case__concept")).toHaveCount(0);
  await first.getByRole("button", { name: /^About this case/ }).click();
  // The hover card is drawn over the page, named by its trigger.
  await expect(page.getByRole("region", { name: /^About this case/ }).locator(".case__concept")).toBeVisible();
  await page.keyboard.press("Escape");
  // Every text of a sketch inside its drawing.
  const outside = await page.locator(".case-sketch svg").evaluateAll((svgs) =>
    svgs.flatMap((svg) => {
      const b = svg.getBoundingClientRect();
      return [...svg.querySelectorAll("text")]
        .map((t) => ({ t: t.textContent, r: t.getBoundingClientRect() }))
        .filter(
          ({ r }) =>
            r.width > 0 &&
            (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1),
        )
        .map(({ t }) => t);
    }),
  );
  expect(outside).toEqual([]);
  // The hairlines that open from the overview to the view pass at least 4 px from every text of the sketch.
  const near = await page.locator(".case-sketch svg").evaluateAll((svgs) =>
    svgs.flatMap((svg) => {
      const texts = [...svg.querySelectorAll("text")].map((t) => t.getBoundingClientRect());
      return [...svg.querySelectorAll(".case-sketch__zoom")].flatMap((line) => {
        const r = line.getBoundingClientRect();
        const points = [...(line as SVGPolylineElement).points];
        const box = svg.getBoundingClientRect();
        const hits: string[] = [];
        for (let p = 1; p < points.length; p++) {
          const from = points[p - 1];
          const to = points[p];
          if (!from || !to) continue;
          for (let k = 0; k <= 40; k++) {
            const x = box.left + from.x + (to.x - from.x) * (k / 40);
            const y = box.top + from.y + (to.y - from.y) * (k / 40);
            for (const t of texts)
              if (x > t.left - 4 && x < t.right + 4 && y > t.top - 4 && y < t.bottom + 4)
                hits.push(`${Math.round(x)},${Math.round(y)} near text at ${Math.round(t.left)}`);
          }
        }
        return r.width >= 0 ? hits.slice(0, 1) : [];
      });
    }),
  );
  expect(near).toEqual([]);
  // The key, in a hover card over the gallery: each mark beside its word, and no reference to another figure.
  await page.getByRole("button", { name: "Key: reading the sketches" }).click();
  const key = page.locator(".cases-key .hovercard__card");
  await expect(key.locator(".case-key li")).not.toHaveCount(0);
  expect(await key.locator(".case-key li").count()).toBe(await key.locator(".case-key li svg").count());
  await expect(key).not.toContainText("figure a");
  await expectAccessible(page);
  await shot(page, info, "45-explore-cases");
});

test("Explore: the replay writes the product of the scores so far and ends on the candidate's score", async ({
  page,
}) => {
  const showcase = await showcaseOf(page, data.organism);
  const lineage = showcase.cases.find((c) => c.kind === "lineage" && c.result);
  test.skip(!lineage?.result, "the server's showcase holds no journey up close for this graph");
  const best = lineage?.result?.candidates.find((c) => c.best);
  await page.goto(`/organisms?organism=${data.organism}`);
  const next = page.getByRole("button", { name: "Next step" });
  await next.scrollIntoViewIfNeeded();
  const readout = page.locator(".replay__readout");
  let scored = false;
  while (await next.isEnabled()) {
    await next.click();
    // A sentence first, then the step's ids and values.
    // (the last press reaches the answer, said in its own sentence)
    await expect(readout.locator(".replay__words")).toContainText(/^(Step \d+ of \d+\. |The answer at release \d+)/);
    const values = (await readout.locator(".replay__values").textContent()) ?? "";
    if (/ · Ensembl's score \d/.test(values)) {
      expect(values).toMatch(/product so far \d\.\d+/);
      scored = true;
    }
  }
  expect(scored).toBe(true);
  await expect(readout.locator(".replay__words")).toContainText(
    "Its score is the product of Ensembl's scores along the path.",
  );
  // The candidate's score as the api gives it: written whole, or cut for reading with the whole one press away.
  const score = pythonFloat(best?.score ?? 0);
  const cut = readout.locator(".replay__exact-button");
  if (await cut.count()) {
    await cut.click();
    await expect(page.locator(".replay__exact .hovercard__card")).toContainText(score);
  } else await expect(readout.locator(".replay__values")).toContainText(score);
});
