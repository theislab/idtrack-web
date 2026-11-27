// The benchmarks' published results as the Method page reads them (src/generated/benchmarks.json, made by
// scripts/benchmarks.ts from idtrack-reproducibility at one commit): every rate its counts', the strata with their
// intervals, what each family is judged against, the tools on the same lines, and the generator's parsing rules.
import { describe, expect, it } from "vitest";
import benchmarks from "../src/generated/benchmarks.json";
import {
  BENCHMARKS,
  comparable,
  familyRows,
  hardest,
  powerParts,
  shownInterval,
  stratumMeaning,
  taskComparison,
  wrongOnly,
  wrongOnlyCounts,
  idtrackWrongShare,
  judged,
  measuredGraph,
  intervalText,
  rateText,
  strataByRate,
  toolWrongShare,
  WRONG_TICKS,
  wrongPosition,
  wrongRatio,
} from "../src/lib/benchmarks";
import { description } from "./fixtures";
import {
  firstClause,
  firstSentence,
  openWithinOf,
  percent,
  readingOf,
  readJudgeOf,
  strataMeaningsOf,
  strataPattern,
  releaseOf,
  tableRows,
  totalsOf,
  truthOf,
  wilson,
  withoutAsides,
} from "../scripts/benchmarks.ts";

describe("the benchmarks' published results", () => {
  it("name the repository's commit, the tree of the release and the graphs it was asked on", () => {
    expect(benchmarks.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(benchmarks.tree.name).toBe("main");
    for (const digest of Object.values(benchmarks.graphs)) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(measuredGraph("sus_scrofa", description("sus_scrofa").content_digest)).toBe(true);
    expect(measuredGraph("sus_scrofa", "0".repeat(64))).toBe(false);
  });

  it("hold, for every row, a rate that is its counts' and lies in its interval", () => {
    for (const family of BENCHMARKS.families) {
      expect(familyRows(family).length).toBeGreaterThan(0);
      for (const row of family.rows) {
        const { judged: n } = judged(row);
        expect(Math.abs(row.right / n - Number(row.rate))).toBeLessThanOrEqual(1.5e-5);
        expect(Number(row.low)).toBeLessThanOrEqual(Number(row.rate));
        expect(Number(row.high)).toBeGreaterThanOrEqual(Number(row.rate));
        const [low, high] = wilson(row.right, n);
        expect(Math.abs(low - Number(row.low))).toBeLessThanOrEqual(1.5e-5);
        expect(Math.abs(high - Number(row.high))).toBeLessThanOrEqual(1.5e-5);
      }
    }
  });

  it("show the tools' rows as the family's document does, each with idtrack's rate on the same lines", () => {
    for (const t of BENCHMARKS.tools.tools)
      for (const c of t.cells) if (c) expect(Number(c.idtrack)).toBeGreaterThanOrEqual(0);
    expect(Object.keys(BENCHMARKS.tools.tasks)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("place a wrong share on one logarithmic axis from one in a million to all, with ticks every two decades", () => {
    expect(wrongPosition(0)).toBeNull();
    expect(wrongPosition(1e-6)).toBe(0);
    expect(wrongPosition(1)).toBe(1);
    expect(wrongPosition(1e-3)).toBeCloseTo(0.5);
    expect(WRONG_TICKS.map((t) => t.exponent)).toEqual([-6, -4, -2, 0]);
    expect(WRONG_TICKS.map((t) => t.at)).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it("are parsed by the generator's rules: whole per cent half to even, tables and totals", () => {
    expect(percent(0.685)).toBe(68);
    expect(percent(0.695)).toBe(70);
    expect(percent(0.9096)).toBe(91);
    expect(tableRows(["| a | b |", "| --- | ---: |", "| 1 | 2 |"])).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    const doc = [
      "### On main",
      "",
      "| family | organism | n | right | wrong | undetermined | rate (Wilson 95 %) | d4c2dda |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      "| b (now) | pig | 1,000 | 990 | 0 | 10 | 1.00000 (0.99613–1.00000) | no exhaustive reference |",
      "",
    ].join("\n");
    const [row] = totalsOf(doc, "b", [["pig", "sus_scrofa"]]);
    expect(row?.judge).toBe("now");
    expect(row?.referenceNote).toBe("no exhaustive reference");
  });
});

describe("the benchmarks as the page shows them", () => {
  it("show the families in the order of the method's claim: history travel first, robustness last", () => {
    expect(BENCHMARKS.families.map((f) => f.key)).toEqual(["a", "astar", "b", "c", "d", "e"]);
  });

  it("never write a rate the source rounded to 1 or 0 as 1 or 0 where its counts say otherwise", () => {
    expect(rateText("1.00000", { right: 51559144, wrong: 66 }).text).toBe("> 0.99999");
    expect(rateText("1.00000", { right: 10, wrong: 0 }).text).toBe("1.00000");
    expect(rateText("0.0000", { right: 3, wrong: 4000000 }).text).toBe("< 0.0001");
    expect(rateText("0.685", { right: 1, wrong: 1 }, 4).text).toBe("0.6850");
    expect(rateText("1.0", { right: 1, wrong: 1 }, 4)).toEqual({ text: "> 0.9999", published: "1.0", rounded: true });
    for (const family of BENCHMARKS.families)
      for (const row of family.rows) {
        const shown = rateText(row.rate, row);
        if (row.wrong > 0) expect(Number(shown.text.replace(/^[<>] /, ""))).toBeLessThan(1);
      }
  });

  it("write an interval the source rounded to 1 as lying within the last unit below 1", () => {
    expect(intervalText({ low: "1.00000", high: "1.00000", rate: "1.00000", right: 9, wrong: 1 })).toBe(
      "within 0.99999–1",
    );
    expect(intervalText({ low: "0.9", high: "0.95", rate: "0.92", right: 9, wrong: 1 })).toBe("0.9–0.95");
  });

  it("list every stratum with a wrong answer, the lowest rate first, and the hardest per organism", () => {
    for (const family of BENCHMARKS.families) {
      const rows = strataByRate(family);
      for (const s of rows) {
        expect(s.wrong).toBeGreaterThan(0);
        expect(Number(s.low)).toBeLessThanOrEqual(Number(s.rate) + 1e-9);
        expect(Number(s.high)).toBeGreaterThanOrEqual(Number(s.rate) - 1e-9);
      }
      for (let i = 1; i < rows.length; i++)
        expect(Number(rows[i]?.high)).toBeGreaterThanOrEqual(Number(rows[i - 1]?.high));
      for (const o of Object.keys(family.strata.clean)) {
        const h = hardest(family, o);
        if (h)
          expect(
            rows
              .filter((s) => s.organism === o && !wrongOnly(family, s.stratum))
              .every((s) => Number(s.high) >= Number(h.high)),
          ).toBe(true);
      }
    }
    const a = BENCHMARKS.families.find((f) => f.key === "a");
    expect(a && hardest(a, "homo_sapiens")?.stratum).toBe("A5_75_76_born");
    const b = BENCHMARKS.families.find((f) => f.key === "b");
    // A low rate on twelve lines (interval up to 1) does not stand before a low rate on hundreds.
    expect(b && Number(hardest(b, "mus_musculus")?.high)).toBeLessThan(0.5);
  });

  it("say what each family is judged against, from its document, and which truths walk Ensembl's history", () => {
    for (const family of BENCHMARKS.families) {
      expect(family.truth.opening).toMatch(/^Nothing of idtrack/);
      expect(family.truth.source).toMatch(/#truth$/);
    }
    const byKey = new Map(BENCHMARKS.families.map((f) => [f.key, f.truth.history]));
    expect(byKey.get("a")).toBe(true);
    expect(byKey.get("astar")).toBe(true);
    expect(byKey.get("e")).toBe(false);
    expect(BENCHMARKS.historyCaveat).toMatch(/stable_id_event.*the same table idtrack stores/);
    expect(BENCHMARKS.intervals.wilson).toMatch(/independent/);
  });

  it("name the measured idtrack by the release whose answers it has, without the repository's inner names", () => {
    expect(BENCHMARKS.tree.answers).toEqual({ release: "0.1.2", commit: "7f71b26" });
    expect(releaseOf("answers are those of the release 0.1.2 (`7f71b26`: documentation strings only)")).toEqual({
      release: "0.1.2",
      commit: "7f71b26",
    });
    expect(() => releaseOf("a tree")).toThrow();
  });

  it("compare a tool's wrong share with idtrack's on the same lines, exactly where the counts allow", () => {
    const cell = { right: 90, wrong: 9, error: 1, idtrack: "0.99", idtrackN: 100 } as Parameters<
      typeof toolWrongShare
    >[0];
    expect(toolWrongShare(cell)).toBeCloseTo(0.1);
    expect(idtrackWrongShare(cell).share).toBeCloseTo(0.01);
    expect(wrongRatio(0.1, 0.01)).toBe("about 10×");
    expect(wrongRatio(0.0904, 0.0146)).toBe("about 6.2×");
    expect(wrongRatio(0.1155, 0.0002)).toBe("460–770×");
    expect(wrongRatio(0.1, 0.00004)).toBe("more than 1100×");
    expect(wrongRatio(0.1, 0)).toBeNull();
    // A published 1.0 on few lines is exact (half a unit of the 4th decimal is under one line); on many, a bound.
    expect(idtrackWrongShare({ ...cell, idtrack: "1.0", idtrackN: 6677 })).toEqual({ share: 0, bounded: false });
    expect(idtrackWrongShare({ ...cell, idtrack: "1.0", idtrackN: 80000 })).toEqual({ share: 0, bounded: true });
    for (const t of BENCHMARKS.tools.tools)
      for (const c of t.cells)
        if (c) {
          expect(c.kept).toBeLessThanOrEqual(c.posed);
          expect(Math.abs(toolWrongShare(c) - (1 - Number(c.rate)))).toBeLessThanOrEqual(5.0001e-5);
        }
  });

  it("are read by the generator's rules: asides with code or links left out, the first sentence", () => {
    expect(withoutAsides("the walk (`expect`) and the rule (a plain aside)")).toBe(
      "the walk and the rule (a plain aside)",
    );
    expect(withoutAsides("read here ([[the harness]]).")).toBe("read here.");
    expect(firstSentence("One. Two.")).toBe("One.");
    const truth = truthOf(
      ["## Truth", "", "Nothing of idtrack:", "", "- **The walk** (`x`): the strict walk. More.", "", "## Next"].join(
        "\n",
      ),
    );
    expect(truth).toEqual({
      opening: "Nothing of idtrack.",
      items: [{ lead: "The walk", text: "the strict walk." }],
      history: true,
    });
  });
});

describe("the benchmarks' rules for what a rate may say", () => {
  it("never take as the weakest part a stratum in which no line can be judged right, and say it as a count", () => {
    for (const family of BENCHMARKS.families) {
      const right = new Map<string, boolean>();
      for (const s of family.strata.rows) right.set(s.stratum, (right.get(s.stratum) ?? false) || s.right > 0);
      for (const code of family.strata.wrongOnly) expect(right.get(code) ?? false).toBe(false);
      for (const o of BENCHMARKS.tools.organisms) {
        const h = hardest(family, o);
        if (h) expect(wrongOnly(family, h.stratum)).toBe(false);
      }
    }
    const d = BENCHMARKS.families.find((f) => f.key === "d");
    expect(d?.strata.wrongOnly.every((code) => code.endsWith("_open"))).toBe(true);
    expect(d && wrongOnlyCounts(d, "sus_scrofa").wrong).toBeGreaterThan(0);
    expect(d?.truth.openWithin).toMatch(/a gene elsewhere wrong/);
    expect(
      openWithinOf("## Truth\n\njudged with F0's `open_within` (nothing is undetermined, elsewhere wrong).\n"),
    ).toBe("nothing is undetermined, elsewhere wrong");
  });

  it("write no interval of zero width: exact bounds for all right or all wrong, Wilson otherwise, from the counts", () => {
    const allWrong = shownInterval({ low: "0.0000", high: "0.0000", rate: "0.0000", right: 0, wrong: 123 });
    expect(allWrong.method).toBe("exact");
    // Clopper-Pearson for 0 of 123: the upper end 1 - 0.025^(1/123) = 0.02955...
    expect(allWrong.text).toBe("0.0000–0.0296");
    const allRight = shownInterval({ low: "1.0000", high: "1.0000", rate: "1.0000", right: 70324868, wrong: 0 });
    expect(allRight.method).toBe("exact");
    expect(allRight.text).toMatch(/^0\.9999999–1\.0+$/);
    const rounded = shownInterval({ low: "0.9997", high: "0.9997", rate: "0.9997", right: 1703782, wrong: 527 });
    expect(rounded.method).toBe("wilson");
    const [lo, hi] = rounded.text.split("–").map(Number);
    expect(lo).toBeLessThan(hi ?? 0);
    expect(shownInterval({ low: "0.9", high: "0.95", rate: "0.92", right: 9, wrong: 1 })).toEqual({
      text: "0.9–0.95",
      method: "published",
    });
    for (const family of BENCHMARKS.families)
      for (const s of family.strata.rows) {
        const [a, b] = shownInterval(s)
          .text.replace(/^within /, "")
          .split("–");
        expect(a).not.toBe(b);
      }
  });

  it("head B and E by the judge their document says to read, and read it from the document", () => {
    const e = BENCHMARKS.families.find((f) => f.key === "e");
    expect(e?.readJudge).toBe("decided");
    expect(e?.rows[0]?.judge).toBe("decided");
    expect(e?.strata.judge).toBe("decided");
    const b = BENCHMARKS.families.find((f) => f.key === "b");
    expect(b?.readJudge).toBeNull();
    expect(b?.rows[0]?.judge).toBe("now");
    expect(readJudgeOf("### On main\n\nmain builds them, so its `decided` rate is the one to read.\n")).toBe("decided");
    expect(readJudgeOf("### On main\n\nTotals.\n")).toBeNull();
  });

  it("name every part by what its lines ask, in its document's words", () => {
    expect(strataPattern("d1_<id\\|symbol>_<same\\|cross>_<one\\|dominant\\|open>").test("d1_id_cross_open")).toBe(
      true,
    );
    expect(strataPattern("b1_atR_<c>").test("b1_atR_unique")).toBe(true);
    expect(strataPattern("c5_ccds_*").test("c5_ccds_retired")).toBe(true);
    expect(strataPattern("c1_at").test("c1_at_v")).toBe(false);
    expect(firstClause("every handoff (last release L): every id present; more")).toBe("every handoff");
    const doc = [
      "## The sets",
      "",
      "| part | strata | rule |",
      "| --- | --- | --- |",
      "| c1 NCBI gene ids | `c1_at` (every id where held), `c1_retired` | `set` |",
      "",
      "## Truth",
      "",
      "Nothing of idtrack.",
    ].join("\n");
    expect(strataMeaningsOf(doc, ["c1_at", "c1_retired", "c9"])).toEqual({
      c1_at: "NCBI gene ids; every id where held",
      c1_retired: "NCBI gene ids",
      c9: null,
    });
    const a = BENCHMARKS.families.find((f) => f.key === "a");
    expect(a && stratumMeaning(a, "A1")).toMatch(/^every gene id at every release R/);
  });

  it("compare a tool with idtrack only where its kept lines hold answers, and read G's reading of the wrong lines", () => {
    for (const t of BENCHMARKS.tools.tools)
      for (const c of t.cells)
        if (c) {
          expect(c.right + c.wrong + c.undetermined + c.error).toBe(c.kept);
          expect(comparable(c)).toBe(!(c.kept > 0 && Number(c.coverage) === 0));
        }
    const apart = BENCHMARKS.tools.tools.flatMap((t) => t.cells.filter((c) => c && !comparable(c)));
    expect(apart.length).toBeGreaterThan(0);
    expect(BENCHMARKS.tools.tools.filter((t) => t.task !== "b").every((t) => t.reading !== null)).toBe(true);
    const c = taskComparison("c");
    expect(c.compared + c.apart).toBe(
      BENCHMARKS.tools.tools.filter((t) => t.task === "c").flatMap((t) => t.cells.filter(Boolean)).length,
    );
    expect(c.more + c.same + c.fewer).toBe(c.compared);
    const reading = readingOf(
      [
        "## The reading of the disagreements",
        "",
        "<!-- table g:reading -->",
        "| tool | task | tool wrong, read | truly wrong | right under another reading | not a question the tool claims | the service failed | idtrack wrong, read | of them a known limitation |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| BioMart | c | 311 | 16 | 18 | 66 | 0 | 110 | 83 |",
        "",
      ].join("\n"),
    );
    expect(reading).toEqual([
      { tool: "BioMart", task: "c", read: 311, truly: 16, another: 18, notClaimed: 66, failed: 0 },
    ]);
  });

  it("write a tick's exponent apart, with a true minus, so it is drawn at the type scale's floor", () => {
    expect(powerParts(-6)).toEqual({ base: "10", exponent: "−6" });
    expect(powerParts(0)).toBeNull();
  });
});
