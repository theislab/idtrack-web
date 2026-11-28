// Real paths of every kind of step idtrack's explained path holds (e2e/data/<graph>.json, `cases`): the page states
// each number of the api's answer, step for step, and the checks the search made (bridges, other readings), as sent.
// The api's answer is idtrack's own `to_dict()` (the api's tests and scripts/check_endpoints.py compare them bit for
// bit), so what the page shows is idtrack's explained path.
import { expect, test } from "@playwright/test";
import { apiConvertUrl, convertUrl, data, expectAccessible, shot, waitForResult } from "./helpers";

interface Step {
  kind: string;
  source: string | null;
  target: string;
  release: number | null;
  old_release: number | null;
  new_release: number | null;
  weight: number | null;
  splits: number;
  merges: number;
  reason: string;
  places: string | null;
}
interface Candidate {
  best: boolean;
  gene: string;
  target: string;
  path: number[];
  final_path: number[];
}
interface Bridge {
  source: string;
  target: string;
  places: string;
  taken: boolean;
  through: [string, string][];
}
interface Reading {
  graph_id: string;
  reason: string;
  genes: string[];
  releases: number[];
}
interface Result {
  status: string;
  tie: boolean;
  no_target: boolean;
  reasons: string[];
  candidates: Candidate[];
  other_readings: Reading[];
  path: { steps: Step[]; bridges: Bridge[]; refused: Step[] } | null;
}

const spaced = (code: string) => code.replace(/_/g, " ");
/** A step's reason in the page's words (a re-mapping of a gene to itself is called so on every figure and table). */
const stepWords = (code: string) => (code === "self_loop" ? "re-mapped to itself" : spaced(code));
const cases = data.cases ?? [];

test.skip(cases.length === 0, "this graph's test data names no cases");

for (const item of cases) {
  test(`the path of a case: ${item.name}`, async ({ page }, info) => {
    await page.goto(convertUrl(item.query));
    await waitForResult(page);
    const raw = await (await page.request.get(apiConvertUrl(item.query))).text();
    const answer = JSON.parse(raw) as Result;
    if (item.status) expect(answer.status).toBe(item.status);
    const steps = answer.path?.steps ?? [];
    // The weights exactly as the api wrote them (Python's shortest round-trip text), in the order of the steps.
    const section = raw.slice(raw.indexOf('"steps":'));
    const weights = [...section.matchAll(/"weight":(null|[-0-9.eE+]+)/g)].map((m) => m[1] ?? "null");

    // The answer: the targets of the best answer, or, when the best answer has no id in the database, its genes; the
    // absence is stated for the best answer only, and every other gene reached is a link that converts it.
    const answerText = await page.locator(".answer").innerText();
    for (const c of answer.candidates.filter((x) => x.best)) expect(answerText).toContain(c.target);
    if (answer.no_target) {
      await expect(page.locator(".answer__targets")).toHaveCount(0);
      for (const c of answer.candidates) expect(c.target).toBe(c.gene);
      await expect(page.locator(".answer__headline")).toContainText(
        /for the (best-ranked gene|genes of the best answer)/,
      );
      const others = [...new Set(answer.candidates.filter((x) => !x.best).map((x) => x.gene))];
      await expect(page.locator(".answer__other-genes a")).toHaveCount(others.length);
      expect(answerText).not.toMatch(/none has|these genes/);
    }
    // A tie of genes is said so; a tie of one gene's ids is said to be ids of one gene, all part of the best answer.
    if (answer.tie)
      expect(answerText).toContain(
        new Set(answer.candidates.filter((x) => x.best).map((x) => x.gene)).size > 1
          ? "equal best: a tie"
          : "ids of one gene, all part of the best answer",
      );
    // The evidence to weigh stands under the status: a bridge of the best answer is named there.
    if (!answer.no_target && answer.candidates.some((c) => c.best && (c as { bridges?: number }).bridges))
      await expect(page.locator(".answer__cautions")).toContainText("bridge");

    // Every step of a candidate, in order, with its numbers: releases (Ensembl's order), score, splits and merges,
    // places; the candidates one at a time, the first few chosen in turn (the Path tab, in words).
    if (steps.length) await page.getByRole("radio", { name: "In words" }).click();
    const choose = page.locator(".reading").getByLabel("Candidate", { exact: true });
    for (const [i, candidate] of answer.candidates.slice(0, 4).entries()) {
      if (answer.candidates.length > 1) await choose.selectOption(String(i));
      const shown = page.locator(".reading .steps__row");
      // On a phone the first steps are shown, the rest on a press.
      const everyStep = page.locator(".reading").getByRole("button", { name: /^Show all \d+ steps$/ });
      if (await everyStep.count()) await everyStep.click();
      const indices = [...candidate.path, ...candidate.final_path];
      await expect(shown).toHaveCount(indices.length);
      // The walk's order: the api's, but a run of re-mappings of one gene listed in the walk's direction.
      const texts = await shown.allInnerTexts();
      for (const [j, index] of indices.entries()) {
        const step = steps[index];
        if (!step) throw new Error(`step ${index} is not in the path`);
        const releases = `${step.old_release ?? "—"} → ${step.new_release ?? "—"}`;
        const text = step.kind === "self_loop" ? (texts.find((t) => t.includes(releases)) ?? "") : (texts[j] ?? "");
        if (step.kind === "history" || step.kind === "self_loop") {
          expect(text).toContain(`${step.old_release ?? "—"} → ${step.new_release ?? "—"}`);
          const weight = weights[index] ?? "null";
          expect(text).toContain(weight === "null" ? "no score" : weight);
          expect(text).toContain(stepWords(step.reason));
          if (step.splits) expect(text).toContain(`the earlier id also passed to ${step.splits} other id`);
          if (step.merges) expect(text).toContain(`${step.merges} other id`);
          if (step.places !== null) expect(text).toContain(spaced(step.places));
        } else if (step.kind !== "identity" && step.release !== null) {
          expect(text).toContain(String(step.release));
        }
      }
    }

    // Every bridge the search considered, with where the two genes lie, whether it was taken, and each rule: the taken
    // first, the refused on a press, every list bounded and opened whole on a press (the Reading tab, each topic a row
    // opened on a press).
    await page.getByRole("tab", { name: /^Reading/ }).click();
    // The panel follows the tab a moment later.
    await expect(page.getByRole("tabpanel", { name: /^Reading/ })).toBeVisible();
    for (const topic of [/^The bridges the search considered/, /^Steps not followed/]) {
      const row = page.getByRole("button", { name: topic });
      if (await row.count()) await row.click();
    }
    const bridges = answer.path?.bridges ?? [];
    const refusedCount = bridges.filter((b) => !b.taken).length;
    if (refusedCount) await page.getByRole("button", { name: `Show the ${refusedCount} refused` }).click();
    // Each press changes its button's name: press the first left until none is.
    for (const name of [/^Show all \d+$/, /^and \d+ more$/]) {
      const more = page.locator(".result__bridges").getByRole("button", { name });
      while ((await more.count()) > 0) await more.first().click();
    }
    const bridgeRows = page.locator(".result__bridges tbody tr");
    await expect(bridgeRows).toHaveCount(bridges.length);
    const bridgeTexts = (await bridgeRows.allInnerTexts()).join("\n");
    expect((bridgeTexts.match(/\byes\b/g) ?? []).length).toBeGreaterThanOrEqual(bridges.filter((b) => b.taken).length);
    for (const bridge of bridges) {
      expect(bridgeTexts).toContain(spaced(bridge.places));
      for (const [, rule] of bridge.through) expect(bridgeTexts).toContain(spaced(rule));
    }
    await expect(page.locator(".result__refused li")).toHaveCount(answer.path?.refused.length ?? 0);

    // The other readings of the identifier, with what each answers and at which releases.
    const readingRows = page.getByRole("region", { name: "Other readings of the identifier" }).locator("tbody tr");
    await expect(readingRows).toHaveCount(answer.other_readings.length);
    for (const [i, reading] of answer.other_readings.entries()) {
      const text = await readingRows.nth(i).innerText();
      expect(text).toContain(spaced(reading.reason));
      for (const gene of reading.genes) expect(text).toContain(gene);
      for (const release of reading.releases) expect(text).toContain(String(release));
    }
    const reasons = await page.locator(".readouts").innerText();
    // Every reason in words (its code and meaning on a press).
    for (const reason of answer.reasons) expect(reasons).toContain(spaced(reason));

    await expectAccessible(page);
    await shot(page, info, `40-case-${item.name}`);
  });
}
