// Explore and Method, on recorded answers of the real graphs and on the generated files: the assembly changes with
// their mapping as idtrack's documentation lists them; what each database name holds; Ensembl's id history read per
// release; the stage cases read from an answer's own fields; the parsing rules of the generator of idtrack's documentation
// (scripts/idtrack-docs.ts). The benchmarks' are in benchmarks.test.ts.
import { describe, expect, it } from "vitest";
import type { HistoryResponse } from "../src/api/types";
import docs from "../src/generated/idtrack_docs.json";
import { shortNames } from "../src/components/figure/releases";
import { databaseMeaning } from "../src/lib/databaseMeanings";
import { handoffsOf, mappingOf } from "../src/lib/explore/handoffs";
import { changed, historyColumns, niceMax } from "../src/lib/explore/history";
import { holdsStage } from "../src/lib/method/cases";
import { conversions, description } from "./fixtures";
import { changesOf, forReaders, plain } from "../scripts/idtrack-docs.ts";

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
