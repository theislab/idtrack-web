// The rules of Explore and the organism pages: what each database name holds for one organism (from idtrack's
// documentation and the graph's symbol databases), what each count of the build is, the history's shares, tallest
// columns and the server's cases on it, the generator's rules for idtrack's documentation, and the cached formatter.
import { describe, expect, it } from "vitest";
import type { ConversionResult, HistoryResponse } from "../src/api/types";
import docs from "../src/generated/idtrack_docs.json";
import { describeDatabase, sourceOf, symbolRole } from "../src/lib/databaseMeanings";
import { caseMarks, casesThrough, changed, historyColumns, shares, tallest } from "../src/lib/explore/history";
import { bestSteps } from "../src/lib/home/caseKinds";
import { groupedInteger } from "../src/lib/numbers";
import {
  completePart,
  countMeaningsOf,
  eventsOf,
  isDocumentation,
  limitationSentencesOf,
  projectionsOf,
  sourcesOf,
} from "../scripts/idtrack-docs.ts";
import { conversions } from "./fixtures";

describe("database names, for one organism", () => {
  it("call only the organism's own first symbol database its name authority", () => {
    expect(symbolRole("HGNC Symbol", ["HGNC Symbol"], "human")).toEqual({ role: "authority" });
    expect(symbolRole("VGNC Symbol", ["VGNC Symbol", "HGNC Symbol"], "pig")).toEqual({ role: "authority" });
    expect(symbolRole("MGI Symbol", ["MGI Symbol"], "mouse")).toEqual({ role: "authority" });
  });

  it("say that HGNC's symbols on pig and macaque genes are projected, in idtrack's words, naming the authority", () => {
    const pig = symbolRole("HGNC Symbol", ["VGNC Symbol", "HGNC Symbol"], "pig");
    expect(pig).toMatchObject({ role: "projected", authority: "VGNC Symbol" });
    expect(pig?.role === "projected" ? pig.phrase : "").toBe("the HGNC symbols projected onto pig and macaque genes");
    expect(symbolRole("HGNC Symbol", ["VGNC Symbol", "HGNC Symbol"], "crab-eating macaque")?.role).toBe("projected");
  });

  it("say a symbol database of another organism is not the authority where the organism lists it not", () => {
    expect(symbolRole("HGNC Symbol", ["MGI Symbol"], "mouse")).toEqual({
      role: "other",
      of: "human",
      authority: "MGI Symbol",
    });
  });

  it("describe what idtrack's page describes, each of a pair by its own words, and leave the rest undescribed", () => {
    const graph = { symbolDatabases: ["HGNC Symbol"], commonName: "human" };
    expect(describeDatabase("ensembl_gene", graph).meaning?.holds).toBe("The Ensembl gene id with version (default)");
    expect(describeDatabase("base_ensembl_gene", graph).meaning?.holds).toBe("The Ensembl gene id without version");
    expect(describeDatabase("CCDS", graph).meaning?.holds).toBe("the accessions of CCDS");
    expect(describeDatabase("CCDS label", graph).meaning?.holds).toBe("the labels of CCDS");
    expect(describeDatabase("UniProtKB/Swiss-Prot", graph).meaning?.note).toBe("UniProt's entry names");
    expect(describeDatabase("RefSeq DNA predicted", graph).meaning?.described).toBe("RefSeq DNA");
    expect(describeDatabase("Havana gene", graph).meaning).toBeNull();
  });

  it("name each resource by idtrack's data sources, from the name or from what it holds", () => {
    expect(sourceOf("Uniprot/SPTREMBL", null)?.resources[0]?.name).toBe("UniProt");
    expect(sourceOf("EntrezGene", "NCBI's gene id")?.resources.map((r) => r.name)).toContain("NCBI Gene");
    expect(sourceOf("Havana transcript", null)?.resources.map((r) => r.name)).toContain("Havana");
    expect(sourceOf("RFAM label", null)?.resources.map((r) => r.name)).toContain("Rfam");
    expect(sourceOf("IMGT/GENE-DB", null)).toBeNull();
  });
});

describe("the counts of a build", () => {
  it("each take what idtrack says of the thing of its name, never a sentence about one node", () => {
    const builder = 'counts = {\n  "nodes": n,\n  "places": p,\n  "history_edges": h,\n  "merged": m,\n}';
    const graph =
      '    def places(self, node: str) -> tuple:\n        """Return where a gene lies: on which assembly.\n\n' +
      '    def history_edges(self, node: str) -> tuple:\n        """Return the edges that leave a node.\n\n';
    const record = "";
    const concepts =
      "The graph\n---------\n\nIts nodes are identifiers: ids. Its edges are of two kinds:\n\n* **history**: the history;\n";
    const out = countMeaningsOf(builder, graph, record, concepts);
    expect(out.find((c) => c.key === "places")?.meaning).toBe("Where a gene lies: on which assembly.");
    expect(out.find((c) => c.key === "nodes")?.meaning).toBe("Identifiers: ids.");
    expect(out.find((c) => c.key === "history_edges")?.meaning).toBe("The history.");
    expect(out.find((c) => c.key === "merged")?.meaning).toBeNull();
  });

  it("are generated for every count the builder records", () => {
    expect(docs.counts.items.map((c) => c.key)).toContain("carried_places");
    expect(docs.counts.items.find((c) => c.key === "history_edges")?.meaning).not.toMatch(/\ba node\b/);
  });
});

describe("idtrack's documentation, read by the generator", () => {
  it("completes a part of one word in the first part's place", () => {
    expect(completePart("The Ensembl gene id with version (default)", "without")).toBe(
      "The Ensembl gene id without version",
    );
    expect(completePart("NCBI's gene id", "NCBI's symbol")).toBe("NCBI's symbol");
  });

  it("reads data sources, projections, events and limitations as written", () => {
    const authors =
      "Data Sources\n~~~~~~~~~~~~\n\n.. list-table::\n\n    * - Database\n      - Description\n    * - `Rfam <https://rfam.org/>`_, Havana and Vega\n      - RNA families\n";
    expect(sourcesOf(authors)).toEqual([
      {
        resources: [
          { name: "Rfam", url: "https://rfam.org/" },
          { name: "Havana", url: null },
          { name: "Vega", url: null },
        ],
        description: "RNA families",
      },
    ]);
    expect(projectionsOf("the HGNC symbols projected onto pig and macaque genes were")[0]?.organisms).toEqual([
      "pig",
      "macaque",
    ]);
    const concepts =
      "History travel and Ensembl's scores\n-----------------------------------\n\n.. list-table::\n\n    * - Event\n      - What\n" +
      "    * - ``a``\n      - A.\n    * - ``b``, ``c``\n      - B or C.\n    * - ``d``\n      - D.\n    * - ``e``\n      - E.\n";
    expect(eventsOf(concepts).map((e) => e.reasons)).toEqual([["a"], ["b", "c"], ["d"], ["e"]]);
    expect(isDocumentation("docs/limitations.rst")).toBe(true);
    expect(isDocumentation("idtrack/api.py")).toBe(false);
  });

  it("gives every limitation its whole first sentence, never cut short", () => {
    const rst =
      "Limitations\n-----------\n\nOne\n~~~\n\n**A lead** that goes on. A second.\n\nTwo\n~~~\n\n**Whole.** Next.\n";
    expect(limitationSentencesOf(rst).map((l) => [l.sentence, l.next])).toEqual([
      ["A lead that goes on.", "A second."],
      ["Whole.", "Next."],
    ]);
    for (const item of docs.limitations.items) expect(item.sentence).not.toMatch(/…$/);
    expect(docs.limitations.items.length).toBeGreaterThanOrEqual(26);
  });
});

describe("Ensembl's id history, read for a person", () => {
  const history: HistoryResponse = {
    organism: "x",
    content_digest: null,
    releases: [
      { release: 1, genes_active: 10, versions_active: 10, created: 10 },
      { release: 2, genes_active: 20, versions_active: 20, created: 5 },
      { release: 3, genes_active: 20, versions_active: 20, created: 0 },
    ],
    transitions: [
      { from_release: 1, to_release: 2, version_changes: 6, id_changes: 2, same_version: 0, retired: 2, scored: 8 },
      { from_release: 2, to_release: 3, version_changes: 1, id_changes: 0, same_version: 0, retired: 0, scored: 1 },
    ],
    compute_seconds: 0.1,
  };

  it("measures what changed into a release by the ids active before it, and ids created by those active", () => {
    const columns = historyColumns(history);
    expect(columns.map(changed)).toEqual([0, 10, 1]);
    expect(shares(columns)).toEqual([
      { changed: null, created: null },
      { changed: 1, created: 0.25 },
      { changed: 0.05, created: 0 },
    ]);
  });

  it("names the tallest columns and whether the serving assembly changes there", () => {
    const columns = historyColumns(history);
    expect(tallest(columns, { "1": 7, "2": 8, "3": 8 })).toEqual([
      { release: 2, changed: 10, newAssembly: true },
      { release: 3, changed: 1, newAssembly: false },
    ]);
  });

  it("places each case at the release of the step that makes it its kind, and finds the cases through a release", () => {
    const split = conversions().find((c) =>
      bestSteps(c.result).some((s) => s.reason === "split" || s.reason === "split_and_merge"),
    );
    expect(split).toBeDefined();
    if (!split) return;
    const result: ConversionResult = split.result;
    const marks = caseMarks([{ kind: "split", query: { identifier: "x" } as never, result, error: null }]);
    const release = marks[0]?.release ?? null;
    expect(release).not.toBeNull();
    expect(casesThrough(marks, release ?? 0)).toHaveLength(1);
    expect(caseMarks([{ kind: "tie", query: { identifier: "x" } as never, result, error: null }])[0]?.release).toBe(
      null,
    );
  });
});

describe("counts", () => {
  it("are grouped with thin spaces by one formatter", () => {
    expect(groupedInteger(1234567)).toBe("1 234 567");
    expect(groupedInteger(12)).toBe("12");
  });
});
