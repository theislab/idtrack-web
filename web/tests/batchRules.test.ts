// The batch's rules read from its answer: a name its database calls otherwise at the target, a gene put before another
// gene by Ensembl's score alone, the release a list comes from, every evidence code of the table defined, and the
// sentence for a methods section written from the run.
import { describe, expect, it } from "vitest";
import type { Candidate, ConversionResult } from "../src/api/types";
import { bandWords, readInference } from "../src/lib/batchInference";
import { batchProvenance, EVIDENCE_CODES, methodsSentence } from "../src/lib/batchExport";
import { batchRows, decidedByScoreAmongGenes, renamedRows } from "../src/lib/batchTable";
import { readVocabulary } from "../src/lib/vocabulary";
import { description, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());
const base = (JSON.parse(fixture("sus_scrofa", "batch_json").raw) as { results: ConversionResult[] }).results[0];

const candidate = (over: Partial<Candidate>): Candidate => ({ ...(base?.candidates[0]!), ...over });
const result = (over: Partial<ConversionResult>): ConversionResult => ({ ...(base!), ...over });

describe("a name its database calls otherwise at the target", () => {
  const rows = batchRows(
    [
      result({
        query_id: "SEPT9",
        graph_id: "SEPT9",
        status: "converted",
        from_databases: ["HGNC Symbol"],
        no_target: false,
        candidates: [candidate({ gene: "G1", target: "G1", best: true })],
      }),
      result({
        query_id: "TP53",
        graph_id: "TP53",
        status: "converted",
        from_databases: ["HGNC Symbol"],
        no_target: false,
        candidates: [candidate({ gene: "G2", target: "G2", best: true })],
      }),
      result({
        query_id: "ENSG1",
        graph_id: "ENSG1.1",
        status: "converted",
        from_databases: [],
        no_target: false,
        candidates: [candidate({ gene: "G3", target: "G3", best: true })],
      }),
    ],
    vocabulary,
  );
  const names = new Map<string, string[] | null>([
    ["G1", ["SEPTIN9"]],
    ["G2", ["TP53"]],
    ["G3", ["X"]],
  ]);
  it("counts a name read in the database whose answer the database names otherwise, nothing else", () => {
    expect(renamedRows(rows, "HGNC Symbol", names)).toEqual([{ index: 0, read: "SEPT9", now: ["SEPTIN9"] }]);
  });
  it("reads the names from the answers where the batch answered in that database", () => {
    expect(renamedRows(rows, "HGNC Symbol", null).map((r) => r.read)).toEqual(["SEPT9", "TP53"]);
  });
});

describe("a gene put before another gene by Ensembl's score alone", () => {
  const scored = (runnerGene: string) =>
    batchRows(
      [
        result({
          status: "converted",
          decided_by: "score",
          no_target: false,
          candidates: [
            candidate({ gene: "A", target: "A", best: true, score: 0.92713 }),
            candidate({ gene: runnerGene, target: runnerGene, best: false, score: 0.921403 }),
          ],
        }),
      ],
      vocabulary,
    )[0];
  it("is a converted answer decided by score whose runner-up is another gene", () => {
    const other = scored("B");
    const same = scored("A");
    expect(other && decidedByScoreAmongGenes(other)).toBe(true);
    expect(same && decidedByScoreAmongGenes(same)).toBe(false);
  });
});

describe("the release a list comes from", () => {
  it("reads the band, the margin and the counts of mode release, and nothing of another mode", () => {
    const answer = {
      organism: "homo_sapiens",
      inference: {
        mode: "release",
        band: [67, 66, 68],
        margin: 6,
        counts: [
          [67, 40],
          [66, 37],
          [68, 36],
          [70, 31],
        ],
        identifiers: 40,
        not_found: 0,
      },
    } as never;
    const read = readInference(answer);
    expect(read?.band[0]).toBe(67);
    expect(read?.counts.get(70)).toBe(31);
    expect(bandWords(read?.band ?? [])).toBe("66–68");
    expect(bandWords([48, 49, 50, 76])).toBe("48–50, 76");
    expect(readInference({ organism: "x", inference: { mode: "assembly_release", band: [[37, 67]] } } as never)).toBe(
      null,
    );
  });
});

describe("the files of a batch", () => {
  it("define every evidence code they can write", () => {
    for (const [kind, words] of Object.entries(EVIDENCE_CODES)) expect(words.length, kind).toBeGreaterThan(20);
  });
  it("give a sentence for a methods section written from the run", () => {
    const request = {
      identifiers: ["A", "B", "C"],
      from_release: 67,
      to_release: null,
      final_database: null,
      from_database: null,
      explain: true,
      allow_bridges: true,
      read_copies: true,
    };
    const provenance = batchProvenance({
      description: description("homo_sapiens"),
      version: { api_version: "0.1.2", idtrack_version: "0.1.2", idtrack_commit: "x" } as never,
      request,
      requestId: "r",
      serverTiming: null,
      answeredAt: "2026-11-27T10:00:00.000Z",
      count: 3,
      source: null,
      resolvedTo: 115,
    });
    const sentence = methodsSentence({
      provenance,
      organismName: "Homo sapiens",
      counts: [
        ["converted", 2],
        ["no_conversion", 1],
      ],
      statusWords: (status, n) => `${status} ${String(n)}`,
      databaseWords: "as Ensembl genes",
    });
    expect(sentence).toContain("3 gene identifiers of Homo sapiens were converted from Ensembl release 67 to");
    expect(sentence).toContain("Ensembl release 115");
    expect(sentence).toContain("idtrack 0.1.2");
    expect(sentence).toContain("on 2026-11-27");
    expect(sentence).toContain("converted 2, no_conversion 1.");
  });
});
