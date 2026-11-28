// Explore and Method, on recorded answers of the real graphs and on the generated files: the assembly changes with
// their mapping as idtrack's documentation lists them; what each database name holds; Ensembl's id history read per
// release; the stage cases read from an answer's own fields; the parsing rules of the generator of idtrack's documentation
// (scripts/idtrack-docs.ts). The benchmarks' are in benchmarks.test.ts.
import { describe, expect, it } from "vitest";
import type { HistoryResponse, LineagesResponse } from "../src/api/types";
import docs from "../src/generated/idtrack_docs.json";
import { shortNames } from "../src/components/figure/releases";
import { databaseMeaning } from "../src/lib/databaseMeanings";
import { handoffsOf, mappingOf } from "../src/lib/explore/handoffs";
import { changed, historyColumns, niceMax } from "../src/lib/explore/history";
import { holdsStage } from "../src/lib/method/cases";
import { layoutLineages } from "../src/lib/hero/lineageLayout";
import { chipName } from "../src/lib/explore/chips";
import {
  keyMove,
  LEAST_SPAN,
  linePath,
  lineWords,
  moveView,
  releaseFor,
  viewFrame,
} from "../src/lib/explore/lineageView";
import { conversions, description } from "./fixtures";
import { changesOf, codeWords, forReaders, learnRefTitles, plain } from "../scripts/idtrack-docs.ts";

describe("assembly changes", () => {
  it("are every change of the serving assembly, each with its mapping as idtrack's documentation lists it", () => {
    const pig = handoffsOf(description("sus_scrofa"));
    expect(pig.map((h) => `${h.from.name}>${h.to.name}@${h.release}`)).toEqual([
      "Sscrofa9>Sscrofa10.2@67",
      "Sscrofa10.2>Sscrofa11.1@90",
    ]);
    expect(pig.map((h) => h.mapping)).toEqual(["published", "none"]);
    const human = handoffsOf(description("homo_sapiens"));
    expect(human.map((h) => h.mapping)).toEqual(["published", "published"]);
  });

  it("are unstated where the documentation names them in neither list, never guessed", () => {
    expect(mappingOf("GRCh38", "NCBI36")).toBe("unstated");
    for (const c of docs.assemblyMapping.mapped) expect(mappingOf(c.from, c.to)).toBe("published");
    for (const c of docs.assemblyMapping.unmapped) expect(mappingOf(c.from, c.to)).toBe("none");
  });

  it("are read from the documentation's lists, a later name written as its differing part completed", () => {
    expect(changesOf("human NCBI36 to GRCh37 to GRCh38, pig Sscrofa9 to Sscrofa11.1 across both changes")).toEqual([
      { organism: "human", from: "NCBI36", to: "GRCh37" },
      { organism: "human", from: "GRCh37", to: "GRCh38" },
      { organism: "pig", from: "Sscrofa9", to: "Sscrofa11.1" },
    ]);
    expect(
      changesOf("rhesus MMUL_1 to Mmul_8.0.1 and Mmul_8.0.1 to Mmul_10, cynomolgus Macaca_fascicularis_5.0 to 6.0"),
    ).toEqual([
      { organism: "rhesus", from: "MMUL_1", to: "Mmul_8.0.1" },
      { organism: "rhesus", from: "Mmul_8.0.1", to: "Mmul_10" },
      { organism: "cynomolgus", from: "Macaca_fascicularis_5.0", to: "Macaca_fascicularis_6.0" },
    ]);
  });
});

describe("database names", () => {
  it("are described by idtrack's page where it lists them, by the listed name of which they are a kind", () => {
    expect(databaseMeaning("EntrezGene")?.holds).toBe("NCBI's gene id");
    expect(databaseMeaning("NCBI gene (formerly Entrezgene)")?.holds).toBe("NCBI's symbol");
    const predicted = databaseMeaning("RefSeq_mRNA_predicted");
    expect(predicted?.described).toBe("RefSeq_mRNA");
    expect(databaseMeaning("Vega_gene")).toBeNull();
    expect(databaseMeaning("HGNC")).toBeNull();
  });

  it("read the documentation's text for a reader: no reference to the interface, no Python spelling", () => {
    expect(plain("``final_database`` of :py:meth:`idtrack.API.convert` (:ref:`Concepts <concepts>`)")).toBe(
      "`final_database` of `convert` (Concepts)",
    );
    expect(
      forReaders("A step has no score (`PathStep.weight` is `None`) and ranks below. `x=False` turns it off."),
    ).toBe("A step has no score and ranks below.");
    for (const text of [docs.mappingScore.text, ...docs.assemblyMapping.paragraphs])
      expect(text).not.toMatch(/\b(None|True|False)\b/);
  });

  it("show a cross-reference as the title of the section it names, never its bare label", () => {
    learnRefTitles(".. _test-rules:\n\nFour rules of a test\n--------------------\n\nText.\n");
    expect(plain("as the rules say (:ref:`test-rules`)")).toBe("as the rules say (Four rules of a test)");
    expect(plain("(:ref:`an-unknown-label`)")).toBe("(an unknown label)");
    // The limitations as the page lists them name no label of the documentation's build.
    for (const item of docs.limitations.items)
      for (const text of [item.sentence, item.next]) expect(text).not.toMatch(/\((?:[a-z]+-)+[a-z]+\)/);
  });

  it("say a field or a table named in code in words, other code kept", () => {
    expect(codeWords("reported in `result.other_readings`, not answered")).toBe(
      "reported in the result's other readings, not answered",
    );
    expect(codeWords("and `Candidate.score`, the product")).toBe("and the candidate's score, the product");
    expect(codeWords("(Ensembl's `assembly_exception`)")).toBe("(Ensembl's assembly exception)");
    expect(codeWords('in `RefSeq_dna` and `view("all")`')).toBe('in `RefSeq_dna` and `view("all")`');
  });
});

describe("Ensembl's id history", () => {
  const history: HistoryResponse = {
    organism: "x",
    content_digest: null,
    releases: [
      { release: 1, genes_active: 10, versions_active: 10, created: 10 },
      { release: 2, genes_active: 11, versions_active: 12, created: 2 },
      { release: 3, genes_active: 11, versions_active: 11, created: 0 },
    ],
    transitions: [
      { from_release: 1, to_release: 2, version_changes: 3, id_changes: 1, same_version: 4, retired: 1, scored: 5 },
      { from_release: 1, to_release: 3, version_changes: 0, id_changes: 0, same_version: 0, retired: 2, scored: 0 },
      { from_release: 2, to_release: 3, version_changes: 2, id_changes: 0, same_version: 1, retired: 0, scored: 2 },
    ],
    compute_seconds: 0.1,
  };

  it("is read per release from the transitions that end there, the first release marked as the graph's start", () => {
    const columns = historyColumns(history);
    expect(columns.map((c) => c.first)).toEqual([true, false, false]);
    expect(columns.map(changed)).toEqual([0, 5, 4]);
    expect(columns[2]?.into.map((t) => t.from_release)).toEqual([1, 2]);
    expect(columns[2]?.retired).toBe(2);
    expect(columns[1]?.scored).toBe(5);
  });

  it("draws each part on a scale to the next round number at or above its largest value", () => {
    expect(niceMax(15854)).toBe(20000);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(40000)).toBe(40000);
  });
});

describe("the stages of the method", () => {
  const all = conversions();
  it("are read from an answer's own fields", () => {
    const bridge = all.find((c) => holdsStage("bridge", c.result));
    expect(bridge).toBeDefined();
    const split = all.find((c) => holdsStage("walk", c.result));
    expect(split).toBeDefined();
    for (const { result } of all) {
      if (holdsStage("rank", result)) expect(result.decided_by).not.toBeNull();
      if (holdsStage("read", result)) expect(result.match).not.toBe("exact");
    }
  });
});

describe("the assemblies' short names", () => {
  it("keep an abbreviation of the shared part: never a bare number", () => {
    const pig = shortNames(["Sscrofa9", "Sscrofa10.2", "Sscrofa11.1"]);
    expect([...pig.values()]).toEqual(["S…9", "S…10.2", "S…11.1"]);
    const macaque = shortNames(["Macaca_fascicularis_5.0", "Macaca_fascicularis_6.0"]);
    expect([...macaque.values()]).toEqual(["Mf…5.0", "Mf…6.0"]);
    // Names that share no prefix of three characters keep their own names.
    expect([...shortNames(["NCBI36", "GRCh37", "GRCh38"]).values()]).toEqual(["NCBI36", "GRCh37", "GRCh38"]);
    for (const short of [...pig.values(), ...macaque.values()]) expect(short).not.toMatch(/^[\d.]+$/);
  });
});

describe("an organism's lineage field", () => {
  const lineages: LineagesResponse = {
    organism: "sus_scrofa",
    content_digest: "0".repeat(64),
    releases: [10, 11, 12, 13],
    genes: 5,
    families: 3,
    focus_families: 1,
    limit: 4,
    ids: ["A", "B", "C", "D"],
    family_starts: [0, 2, 3],
    active: [[[10, 11]], [[12, 13]], [[10, 13]], [[11, 13]]],
    versions: [[11], [], [12, 13], []],
    edges: [[0, 1, 11, 12, 0.9]],
  };
  const layout = layoutLineages(lineages);

  it("fills the box's width with the view, and leaves the axis its room", () => {
    const whole = viewFrame(1000, 540, [0, 1]);
    expect(whole.far.x).toBe(16);
    expect(whole.near.x).toBe(984);
    expect(whole.far.top + whole.far.bottom + 40).toBe(540);
    // Seen square on: both ends alike, so the renderer's map is a plain scaling.
    expect(whole.far.top).toBe(whole.near.top);
    expect(whole.far.bottom).toBe(whole.near.bottom);
    // A view of the axis's second half: its start at the left edge, the first half outside the box.
    const half = viewFrame(1000, 540, [0.5, 1]);
    expect(half.far.x + (half.near.x - half.far.x) * 0.5).toBeCloseTo(16);
    expect(half.near.x).toBeCloseTo(984);
  });

  it("zooms about a point, pans, and stays within the axis and above the narrowest view", () => {
    expect(moveView([0, 1], { factor: 0.5, at: 0.5 })).toEqual([0.25, 0.75]);
    expect(moveView([0.25, 0.75], { delta: 0.5 })).toEqual([0.5, 1]);
    expect(moveView([0.25, 0.75], { delta: -1 })).toEqual([0, 0.5]);
    const narrow = moveView([0.4, 0.6], { factor: 0.01 });
    expect(narrow[1] - narrow[0]).toBeCloseTo(LEAST_SPAN);
    expect(moveView([0.2, 0.4], { factor: 100 })).toEqual([0, 1]);
  });

  it("says an id's runs, new versions and family, and opens it where it is active", () => {
    const a = layout.ids.indexOf("A");
    const c = layout.ids.indexOf("C");
    expect(lineWords(layout, a)).toBe(
      "active at 10–11 · 1 new version · a family of 2 ids · on a journey of the showcase",
    );
    expect(lineWords(layout, c)).toBe("active at 10–13 · 2 new versions");
    // At a release it is active at, that release; elsewhere its last.
    expect(releaseFor(layout, a, 1)).toBe(11);
    expect(releaseFor(layout, a, 3)).toBe(11);
  });

  it("moves a pick along a line's releases, to the lines beside it, to its ends; draws the line it picks", () => {
    const c = layout.ids.indexOf("C");
    const d = layout.ids.indexOf("D");
    expect(keyMove(layout, { id: c, k: 1 }, "ArrowRight")).toEqual({ id: c, k: 2 });
    expect(keyMove(layout, { id: c, k: 3 }, "ArrowRight")).toBeNull();
    expect(keyMove(layout, { id: c, k: 2 }, "Home")).toEqual({ id: c, k: 0 });
    expect(keyMove(layout, { id: d, k: 1 }, "End")).toEqual({ id: d, k: 3 });
    // Up and down stay at the release, on another id active there.
    const other = keyMove(layout, { id: c, k: 1 }, "ArrowDown") ?? keyMove(layout, { id: c, k: 1 }, "ArrowUp");
    expect(other?.k).toBe(1);
    expect(Number.isNaN(layout.y[(other?.id ?? 0) * 4 + 1] ?? Number.NaN)).toBe(false);
    expect(keyMove(layout, { id: c, k: 1 }, "x")).toBeUndefined();
    // The line of A: active at 10 and 11 only, one stretch of two points.
    const path = linePath(layout, { id: layout.ids.indexOf("A"), k: 0 }, viewFrame(1000, 540, [0, 1]));
    expect(path.d.match(/[ML]/g)).toEqual(["M", "L"]);
    expect(path.at.x).toBe(16);
  });

  it("names an organism's chip by its common name", () => {
    expect(chipName("sus_scrofa")).toBe("Pig");
    expect(chipName("homo_sapiens")).toBe("Human");
  });
});
