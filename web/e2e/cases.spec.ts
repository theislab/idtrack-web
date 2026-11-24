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
    if (answer.tie) expect(answerText).toContain("answers equal in every criterion");

    // Every step of every candidate, in order, with its numbers: releases, score, splits and merges, places.
    const candidates = page.locator(".reading__candidate");
    await expect(candidates).toHaveCount(answer.candidates.length);
    for (const [i, candidate] of answer.candidates.entries()) {
      const shown = candidates.nth(i).locator(".reading__step");
      const indices = [...candidate.path, ...candidate.final_path];
      await expect(shown).toHaveCount(indices.length);
      for (const [j, index] of indices.entries()) {
        const step = steps[index];
        if (!step) throw new Error(`step ${index} is not in the path`);
        const text = await shown.nth(j).innerText();
        if (step.kind === "history" || step.kind === "self_loop") {
          expect(text).toContain(`${step.old_release ?? "—"} → ${step.new_release ?? "—"}`);
          const weight = weights[index] ?? "null";
          expect(text).toContain(weight === "null" ? "no score" : `score ${weight}`);
          expect(text).toContain(spaced(step.reason));
          if (step.splits || step.merges)
            expect(text).toContain(`${step.splits} other split, ${step.merges} other merged`);
          if (step.places !== null) expect(text).toContain(spaced(step.places));
        } else if (step.kind !== "identity" && step.release !== null) {
          expect(text).toContain(`release ${step.release}`);
        }
      }
    }

    // Every bridge the search considered, with where the two genes lie, whether it was taken, and each rule.
    const bridges = answer.path?.bridges ?? [];
    const bridgeRows = page.getByRole("region", { name: "Bridges, one row per pair of genes" }).locator("tbody tr");
    await expect(bridgeRows).toHaveCount(bridges.length);
    for (const [i, bridge] of bridges.entries()) {
      const text = await bridgeRows.nth(i).innerText();
      expect(text).toContain(spaced(bridge.places));
      expect(text).toContain(bridge.taken ? "yes" : "no");
      for (const [, rule] of bridge.through) expect(text).toContain(spaced(rule));
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
    for (const reason of answer.reasons) expect(reasons).toContain(reason);

    await expectAccessible(page);
    await shot(page, info, `40-case-${item.name}`);
  });
}
