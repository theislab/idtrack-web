// @vitest-environment jsdom
// Explore's stories: the sketches are as tall as what they draw, a gene that answers nothing is drawn to its last
// release, a name with another meaning as two named lanes, the key draws every mark it names, and the replay's running
// product of Ensembl's scores builds up to the candidate's score.
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { CaseSketch } from "../src/components/explore/CaseSketch";
import { figureHeight, figureModel, PRODUCT_ROOM, runningProduct } from "../src/lib/explore/figureModel";
import {
  activeRuns,
  genesNotDrawn,
  lastRelease,
  shortProduct,
  SKETCH,
  sketchLayout,
  sketchRows,
} from "../src/lib/explore/sketch";
import { KIND_TEXT } from "../src/lib/home/cases";
import { pythonFloat } from "../src/lib/numbers";
import { conversions, description } from "./fixtures";

afterEach(cleanup);

const recorded = conversions();
const answers = recorded.map((c) => c.result);

describe("a case's sketch", () => {
  it("is as tall as what it draws: each row adds its pitch, then a little air and the axis", () => {
    expect(answers.length).toBeGreaterThan(50);
    for (const result of answers) {
      const layout = sketchLayout(result);
      expect(layout.height).toBe(layout.axisY + SKETCH.AXIS_ROOM);
      expect(layout.axisY).toBe(Math.ceil(layout.bottom + SKETCH.AIR));
      for (const y of layout.rows) expect(y).toBeLessThanOrEqual(layout.bottom);
      if (layout.form === "path") {
        expect(layout.rows.length).toBe(sketchRows(result).length);
        expect(layout.more !== null).toBe(genesNotDrawn(result) > 0);
        if (layout.more === null && !(result.path?.refused ?? []).length)
          expect(layout.bottom).toBe(SKETCH.TOP + (layout.rows.length - 1) * SKETCH.PITCH + 4);
      }
    }
    // One row is shorter than three: no sketch holds the room of a taller one.
    const heights = new Set(answers.filter((r) => sketchLayout(r).form === "path").map((r) => sketchLayout(r).height));
    expect(heights.size).toBeGreaterThan(1);
  });

  it("draws an answer that reaches nothing as one lane, a name with another meaning as two", () => {
    for (const result of answers) {
      const layout = sketchLayout(result);
      if (!result.candidates.length) expect(layout.form).toBe("ended");
      if (result.candidates.length && result.other_readings.some((o) => o.reason === "other_release"))
        expect(layout.form).toBe("meaning");
      if (layout.form === "ended") expect(layout.rows).toHaveLength(1);
      if (layout.form === "meaning") expect(layout.rows).toHaveLength(2);
    }
  });

  it("reads a gene's last release from its active releases", () => {
    expect(lastRelease([[68, 75]])).toBe(75);
    expect(
      lastRelease([
        [50, 60],
        [62, 70],
      ]),
    ).toBe(70);
    expect(lastRelease([[80, null]])).toBeNull();
    expect(lastRelease([])).toBeNull();
    expect(activeRuns([[80, null]], 115)).toEqual([[80, 115]]);
  });

  it("draws the life of a gene to its last release, a wait and an empty end at the release asked", async () => {
    const ended = answers.find((r) => r.status === "no_conversion" && r.candidates.length === 0 && r.from_release);
    expect(ended).toBeDefined();
    if (!ended || ended.from_release === null) return;
    const organism = recorded.find((c) => c.result === ended)?.entry.organism ?? "homo_sapiens";
    const from = ended.from_release;
    render(
      <CaseSketch
        result={ended}
        graph={description(organism)}
        label="a gene's life"
        life={{ gene: `${ended.query_id}.1`, active: [[from - 3, from]] }}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector(".case-sketch__cap")).not.toBeNull();
    });
    const words = [...document.querySelectorAll(".case-sketch__words")].map((t) => t.textContent);
    expect(words).toContain(`none at ${ended.to_release}`);
    expect(words.some((w) => w?.startsWith(`${from - 3}–${from}`))).toBe(true);
    expect(document.querySelector(".case-sketch__empty")).not.toBeNull();
  });

  it("names both lanes of a name with another meaning, each with its releases", async () => {
    const meaning = answers.find(
      (r) => r.candidates.some((c) => c.best) && r.other_readings.some((o) => o.reason === "other_release"),
    );
    expect(meaning).toBeDefined();
    if (!meaning) return;
    const organism = recorded.find((c) => c.result === meaning)?.entry.organism ?? "homo_sapiens";
    render(<CaseSketch result={meaning} graph={description(organism)} label="another meaning" />);
    await waitFor(() => {
      expect(document.querySelectorAll(".case-sketch__words")).toHaveLength(2);
    });
    const [first, second] = [...document.querySelectorAll(".case-sketch__words")].map((t) => t.textContent ?? "");
    expect(first.startsWith(`${meaning.from_release ?? meaning.to_release}:`)).toBe(true);
    expect(second).toContain(":");
    expect(document.querySelectorAll(".case-sketch__other").length).toBeGreaterThan(0);
  });

  it("refers to no other figure: the key draws its own marks", () => {
    for (const text of Object.values(KIND_TEXT)) expect(text.concept).not.toMatch(/figure [a-z]\b/);
  });
});

describe("the replay's running product", () => {
  it("builds up step by step to the candidate's score, shortened, never more exact than the page's arithmetic", () => {
    let checked = 0;
    for (const result of answers) {
      const model = figureModel(result);
      if (!model) continue;
      const products = runningProduct(model.steps);
      const values = [...products.values()];
      if (!values.length) continue;
      // It never rises: every score is at most 1.
      for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1] ?? 1);
      const last = values[values.length - 1] ?? 1;
      expect(Math.abs(last - model.answer.score)).toBeLessThanOrEqual(1e-12 * Math.max(1, model.answer.score));
      // The shortened product agrees with the engine's score as far as it is written.
      expect(shortProduct(pythonFloat(last))).toBe(shortProduct(pythonFloat(model.answer.score)));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("is cut, never rounded, and marked where it is cut", () => {
    expect(shortProduct("0.7909885957885995")).toBe("0.790988…");
    expect(shortProduct("0.99")).toBe("0.99");
    expect(shortProduct("1.0")).toBe("1.0");
    expect(shortProduct("0.1999999")).toBe("0.199999…");
  });

  it("has room of its own under the score track", () => {
    expect(figureHeight(2, true) - figureHeight(2)).toBe(PRODUCT_ROOM);
  });
});
