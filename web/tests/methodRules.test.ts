// The Method page's rules of what it may say and draw: the walk's case taken from the showcase by its stated measure;
// the walk's thread, in the order taken; the other tools in words no wider than their evidence; a rate beside the share
// of its lines judged; the parts of a truth read from IDTrack's own code; the vocabulary's three states.
import { describe, expect, it } from "vitest";
import type { ConversionResult, ShowcaseResponse } from "../src/api/types";
import { figureModel } from "../src/lib/explore/figureModel";
import { bestSteps } from "../src/lib/home/caseKinds";
import {
  BENCHMARKS,
  judgedText,
  rateRange,
  taskComparison,
  taskWords,
  truthFromIdtrack,
  toolWrongShare,
  idtrackWrongShare,
  comparable,
} from "../src/lib/benchmarks";
import { bestPathSize, holdsStage, walkCase } from "../src/lib/method/cases";
import { litPoint, stageModel, stepLanes, threadLength, walkThread } from "../src/lib/method/stageFigure";
import { FAILED_VOCABULARY, NO_VOCABULARY, readVocabulary } from "../src/lib/vocabulary";
import { conversions, description, vocabularyResponse } from "./fixtures";

const all = conversions();

function showcaseOf(results: readonly ConversionResult[]): ShowcaseResponse {
  return {
    organism: "sus_scrofa",
    content_digest: null,
    checked_on: null,
    journeys: results.map((r) => ({
      query: {
        identifier: r.query_id,
        from_release: r.from_release,
        to_release: r.to_release,
        final_database: r.final_database,
        explain: true,
      },
      result: r,
      error: null,
    })),
    cases: [],
  };
}

describe("the walk's case", () => {
  it("is the showcase's answer that walks through a split without a bridge and passes the most ids and steps", () => {
    const results = all.map((c) => c.result);
    const chosen = walkCase(showcaseOf(results));
    const eligible = results.filter(
      (r) => holdsStage("walk", r) && !bestSteps(r).some((s) => s.kind === "bridge_near"),
    );
    expect(eligible.length).toBeGreaterThan(0);
    if (!chosen) throw new Error("no walk case chosen");
    const size = bestPathSize(chosen.result);
    for (const r of eligible) expect(bestPathSize(r)).toBeLessThanOrEqual(size);
    expect(holdsStage("walk", chosen.result)).toBe(true);
    // Whatever order the showcase gives them in, the same answer is chosen.
    expect(walkCase(showcaseOf([...results].reverse()))?.result.query_id).toBe(chosen.result.query_id);
  }, 30_000);

  it("is none where the showcase holds no such answer", () => {
    const plain = all.map((c) => c.result).filter((r) => !holdsStage("walk", r));
    expect(walkCase(showcaseOf(plain))).toBeNull();
  });
});

describe("the walk's thread", () => {
  it("passes every history step in the order taken, through each step's two lanes, and lights up to the cursor", () => {
    let drawn = 0;
    for (const { entry, result } of all) {
      const model = figureModel(result);
      if (!model) continue;
      const stage = stageModel(model, description(entry.organism));
      const walked = model.steps.filter((s) => s.family !== "cross");
      if (!walked.length) continue;
      drawn += 1;
      const at = {
        x: (r: number) => r * 10,
        jointX: (s: (typeof walked)[number]) => s.lo * 10 + 5,
        laneY: (lane: number) => lane * 50,
        barX: (first: number) => first * 10 - 5,
        barEnd: (last: number) => last * 10 + 5,
      };
      const thread = walkThread(stage, walked, at);
      expect(thread.reach).toHaveLength(walked.length);
      walked.forEach((s, i) => {
        const point = thread.points[thread.reach[i] ?? -1];
        const { to } = stepLanes(stage, s);
        expect(point?.[0]).toBe(at.jointX(s));
        expect(point?.[1]).toBe(at.laneY(to ?? stepLanes(stage, s).from ?? 0));
        if (i) expect(thread.reach[i]).toBeGreaterThan(thread.reach[i - 1] ?? -1);
      });
      // Lit up to the step the replay stands on; the whole thread before it starts and at the answer.
      expect(litPoint(thread, null)).toBe(thread.points.length - 1);
      expect(litPoint(thread, walked.length)).toBe(thread.points.length - 1);
      expect(threadLength(thread.points, litPoint(thread, 0))).toBeLessThanOrEqual(threadLength(thread.points));
    }
    expect(drawn).toBeGreaterThan(10);
  }, 30_000);
});

describe("the other tools, in words", () => {
  it("say a tool disagrees with the truth, never that it is wrong, with what the reading found truly wrong", () => {
    for (const task of Object.keys(BENCHMARKS.tools.tasks)) {
      const c = taskComparison(task);
      if (!c.compared && !c.apart) continue;
      const words = taskWords(c);
      expect(words).not.toMatch(/\bwrong more often\b/);
      if (c.more) expect(words).toContain("disagrees with the truth");
      if (c.truly.length) expect(words).toMatch(/% (are )?truly wrong|truly wrong/);
    }
  });

  it("name the comparisons a range leaves out: where IDTrack disagrees on no line, no ratio exists", () => {
    let named = 0;
    for (const task of Object.keys(BENCHMARKS.tools.tasks)) {
      const c = taskComparison(task);
      const rows = BENCHMARKS.tools.tools.filter((t) => t.task === task);
      const expected = rows.flatMap((t) =>
        t.cells.filter(
          (cell): cell is NonNullable<typeof cell> =>
            cell !== null && comparable(cell) && toolWrongShare(cell) > 0 && idtrackWrongShare(cell).share === 0,
        ),
      );
      expect(c.unrated).toHaveLength(expected.length);
      if (expected.length) {
        named += 1;
        expect(taskWords(c)).toMatch(/no ratio/);
      }
    }
    expect(named).toBeGreaterThan(0);
  });
});

describe("a rate and its lines judged", () => {
  it("write the share judged without saying more than its counts", () => {
    expect(judgedText({ right: 85_978 - 4_611, wrong: 4_611, n: 117_470 })).toBe("73.2 %");
    expect(judgedText({ right: 10, wrong: 0, n: 10 })).toBe("100 %");
    expect(judgedText({ right: 99_999, wrong: 0, n: 100_000 })).toBe("> 99.9 %");
    expect(judgedText({ right: 1, wrong: 0, n: 100_000 })).toBe("< 0.1 %");
    expect(judgedText({ right: 0, wrong: 0, n: 5 })).toBe("0 %");
  });

  it("state the range of the headline rates with the family and organism of each end", () => {
    const range = rateRange();
    expect(range).not.toBeNull();
    for (const family of BENCHMARKS.families)
      for (const row of family.rows.filter((r) => r.part === null && r.judge === family.rows[0]?.judge)) {
        expect(Number(row.rate)).toBeGreaterThanOrEqual(Number(range?.low.row.rate));
        expect(Number(row.rate)).toBeLessThanOrEqual(Number(range?.high.row.rate));
      }
  });

  it("find the parts of a truth read from a checkout of IDTrack's code by the commit they name", () => {
    const shared = BENCHMARKS.families.flatMap((f) => truthFromIdtrack(f).map((i) => ({ family: f.key, ...i })));
    for (const item of shared) expect(item.text).toMatch(/`[0-9a-f]{7,40}`/);
    for (const family of BENCHMARKS.families)
      for (const item of family.truth.items)
        if (/`[0-9a-f]{7,40}`/.test(item.text)) expect(shared.some((s) => s.lead === item.lead)).toBe(true);
  });
});

describe("the vocabulary's state", () => {
  it("is loading before it is read, failed only when the api did not give it, done once read", () => {
    expect(NO_VOCABULARY.state).toBe("loading");
    expect(FAILED_VOCABULARY.state).toBe("failed");
    expect(readVocabulary(vocabularyResponse()).state).toBe("done");
  });
});
