// The batch's list and table read from what was pasted, the evidence marks, the rows' shared answers, the table of
// one row per identifier with its provenance, and the drawing window of a long table: every rule on the form of the
// data only.
import { describe, expect, it } from "vitest";
import type { BatchResponse, ConversionResult } from "../src/api/types";
import {
  cellKind,
  detectHeader,
  looksLikeSpreadsheetDate,
  parseList,
  parseTable,
  splitCells,
} from "../src/lib/batchList";
import { batchProvenance, rowTable, spreadsheetSafe } from "../src/lib/batchExport";
import { verdictOf } from "../src/lib/batchInference";
import { batchRows, filterRows, readKind, sharedAnswers } from "../src/lib/batchTable";
import { cautionCount, evidenceOf } from "../src/lib/evidence";
import { windowOf } from "../src/lib/useRowWindow";
import { readVocabulary } from "../src/lib/vocabulary";
import { description, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());

describe("parseList", () => {
  it("reads one identifier per line and the first cell of a table", () => {
    expect(parseList("INS\n\n PDX1 \r\nGCG\tglucagon\nNM_000207\tx\nA\tB\n")).toEqual([
      "INS",
      "PDX1",
      "GCG",
      "NM_000207",
      "A",
    ]);
    expect(parseList("INS,x\nPDX1,y")).toEqual(["INS", "PDX1"]);
  });
  it("keeps the order and repeats", () => {
    expect(parseList("b\na\nb")).toEqual(["b", "a", "b"]);
  });
});

describe("a pasted table", () => {
  it("splits cells outside quotes and reads quoted cells without their quotes", () => {
    expect(splitCells('"a,b", c ,"say ""x"""', ",")).toEqual(["a,b", "c", 'say "x"']);
    expect(splitCells("a\tb", null)).toEqual(["a\tb"]);
  });

  it("judges cells by their form", () => {
    expect(cellKind("-2.86")).toBe("number");
    expect(cellKind("1,5")).toBe("number");
    expect(cellKind("ENSG00000141510.9")).toBe("ensembl");
    expect(cellKind("ENSMUSG00000051951")).toBe("ensembl");
    expect(cellKind("TP53")).toBe("text");
    expect(cellKind("")).toBe("empty");
  });

  it("takes a first line of text over a column of numbers or Ensembl ids as the header", () => {
    const table = parseTable(
      "Ensembl Gene ID\tAssociated Gene Name\tlog2FC\nENSG00000141510.9\tTP53\t-2.86\nENSG00000012048.13\tBRCA1\t-2.71\n",
    );
    expect(table.header).toEqual(["Ensembl Gene ID", "Associated Gene Name", "log2FC"]);
    expect(table.identifiers).toEqual(["ENSG00000141510.9", "ENSG00000012048.13"]);
    expect(table.rows.map((r) => r.line)).toEqual([2, 3]);
    expect(table.rows[0]?.cells).toEqual(["ENSG00000141510.9", "TP53", "-2.86"]);
    const features = parseTable(
      "gene_id\tgene_name\tfeature_type\nENSMUSG00000051951\tXkr4\tGene Expression\nENSMUSG00000089699\tGm1992\tGene Expression\n",
    );
    expect(features.detected).toEqual({ column: 0, kind: "ensembl" });
    expect(features.identifiers).toHaveLength(2);
    const symbols = parseTable("symbol,log2FC\nINS,1.2\nTP53,-0.4\n");
    expect(symbols.detected).toEqual({ column: 1, kind: "number" });
    expect(symbols.identifiers).toEqual(["INS", "TP53"]);
  });

  it("leaves a list without a header as it is, and follows the person's choice", () => {
    expect(parseTable("INS\nTP53\nBRCA2\n").header).toBeNull();
    expect(detectHeader([["INS"], ["TP53"]], 0)).toBeNull();
    expect(parseTable("gene\nINS\nTP53\n", { header: true }).identifiers).toEqual(["INS", "TP53"]);
    const off = parseTable("Ensembl Gene ID\tx\nENSG00000141510.9\t1\nENSG00000012048.13\t2\n", { header: false });
    expect(off.identifiers[0]).toBe("Ensembl Gene ID");
    expect(parseTable("a\tTP53\nb\tINS\n", { column: 1 }).identifiers).toEqual(["TP53", "INS"]);
    expect(parseTable("a\t\nb\tINS\n", { column: 1 }).skipped).toEqual([1]);
  });

  it("knows the forms a spreadsheet gives a date, and no gene", () => {
    for (const date of ["1-Mar", "2-Sep", "Sep-2", "01-mar-2020", "2023-09-02", "9/2/2023"])
      expect(looksLikeSpreadsheetDate(date)).toBe(true);
    for (const symbol of ["MARCH1", "SEPT2", "MAT1", "TP53", "NM_000207", "1"])
      expect(looksLikeSpreadsheetDate(symbol)).toBe(false);
  });
});

function results(organism: string, name = "batch_json"): ConversionResult[] {
  return (JSON.parse(fixture(organism, name).raw) as BatchResponse).results;
}

const first = results("homo_sapiens")[0];
if (!first) throw new Error("no result in the fixture");
const base: ConversionResult = first;
const make = (over: Partial<ConversionResult>): ConversionResult => ({ ...base, ...over });

describe("the evidence of an answer", () => {
  it("is the api's cautions of each row, in the api's order, the cautions counted", () => {
    for (const organism of ["homo_sapiens", "sus_scrofa"])
      for (const result of results(organism)) {
        const marks = evidenceOf(result, vocabulary);
        expect(marks.map((m) => m.kind)).toEqual(result.cautions.map((c) => c.code));
        expect(cautionCount(marks)).toBe(result.cautions.filter((c) => c.tone === "caution").length);
      }
    expect(evidenceOf(make({ cautions: [] }), vocabulary)).toEqual([]);
  });

  it("reads the kind of a reading from its match", () => {
    expect(readKind(make({ match: "exact" }))).toBe("written");
    expect(readKind(make({ match: "copy:synonym:exact" }))).toBe("copy");
    expect(readKind(make({ match: "unicode:synonym:case" }))).toBe("synonym");
    expect(readKind(make({ match: "case" }))).toBe("case");
    expect(readKind(make({ match: null }))).toBe("not_read");
  });
});

describe("the rows of a batch", () => {
  const best = base.candidates.find((c) => c.best);
  if (!best) throw new Error("no best candidate in the fixture");
  const answerOf = (query_id: string, target: string) =>
    make({ query_id, no_target: false, candidates: [{ ...best, target, gene: target, best: true }] });
  const list = [answerOf("A", "G1"), answerOf("B", "G1"), answerOf("A", "G1"), answerOf("C", "G2")];

  it("flags an answer shared by different identifiers, not by a repeat of one", () => {
    const rows = batchRows(list, vocabulary);
    expect(rows.map((r) => r.shared)).toEqual([[1], [0, 2], [1], []]);
    expect(sharedAnswers(rows)).toEqual({ answers: 1, rows: 3 });
    expect(filterRows(rows, { statuses: new Set(), shared: true }).map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("writes one row per identifier with the person's columns and the provenance first", () => {
    const rows = batchRows(list, vocabulary);
    const graph = description("homo_sapiens");
    const request = {
      identifiers: list.map((r) => r.query_id),
      from_release: null,
      to_release: null,
      final_database: null,
      from_database: null,
      explain: false,
      allow_bridges: true,
      read_copies: true,
    };
    const source = {
      separator: "\t" as const,
      header: ["id", "log2FC"],
      column: 0,
      rows: list.map((r, i) => ({ line: i + 2, cells: [r.query_id, i === 1 ? "=1+1" : "-0.5"] })),
    };
    const provenance = batchProvenance({
      description: graph,
      version: null,
      request,
      requestId: "r1",
      serverTiming: null,
      answeredAt: "2026-11-27T00:00:00.000Z",
      count: list.length,
      source,
      resolvedTo: 115,
      now: new Date("2026-11-27T01:00:00Z"),
    });
    expect(provenance.request.resolved).toEqual({ to_release: 115, from_release: "inferred for each identifier" });
    // Every key of the provenance is in the api's style (snake case), the source inference's too.
    const inferred = batchProvenance({
      description: graph,
      version: null,
      request: { ...request, from_release: 67 },
      requestId: "r1",
      serverTiming: null,
      answeredAt: null,
      count: list.length,
      source: {
        ...source,
        inferred: { release: 67, band: [67, 66], margin: 13, identifiers: 38, not_found: 2, request_id: "r2" },
      },
      resolvedTo: 115,
      now: new Date("2026-11-27T01:00:00Z"),
    });
    const keys = (value: unknown): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([k, v]) => (Array.isArray(value) ? keys(v) : [k, ...keys(v)]))
        : [];
    expect(keys(inferred).filter((k) => /[A-Z]/.test(k))).toEqual([]);
    expect(inferred.source_inference).toMatchObject({ not_found: 2, request_id: "r2" });
    const text = rowTable(rows, provenance, source, null);
    const lines = text.trimEnd().split("\n");
    const comments = lines.filter((l) => l.startsWith("#"));
    expect(comments.join("\n")).toContain(graph.content_digest ?? "");
    expect(comments.join("\n")).toContain("homo_sapiens");
    const table = lines.filter((l) => !l.startsWith("#"));
    const head = table[0]?.split("\t") ?? [];
    expect(head.slice(0, 6)).toEqual(["index", "line", "id", "log2FC", "identifier", "status"]);
    expect(head).toContain("gene_at_115");
    expect(table).toHaveLength(list.length + 1);
    const cell = (row: number, column: string) => table[row]?.split("\t")[head.indexOf(column)];
    // One numbering with the page (#, from 1) beside the line of what was given.
    expect(cell(1, "index")).toBe("1");
    expect(cell(1, "line")).toBe("2");
    expect(cell(1, "log2FC")).toBe("-0.5");
    expect(cell(2, "log2FC")).toBe("'=1+1");
    expect(cell(2, "shared_with")).toBe("1;3");
    // Every code of the evidence written is defined in the head.
    for (const kind of new Set(rows.flatMap((r) => r.evidence.map((m) => m.kind))))
      expect(comments.some((c) => c.startsWith(`#   ${kind}: `))).toBe(true);
    // The same table as CSV: a cell with a comma is quoted.
    const csv = rowTable(
      rows,
      provenance,
      { ...source, rows: source.rows.map((r) => ({ ...r, cells: [r.cells[0] ?? "", "a,b"] })) },
      null,
      null,
      "csv",
    );
    expect(csv.split("\n").find((l) => l.startsWith("1,"))).toContain('"a,b"');
  });

  it("writes a cell a spreadsheet would read as a formula as text, and numbers as they are", () => {
    expect(spreadsheetSafe("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(spreadsheetSafe("@SUM(1)")).toBe("'@SUM(1)");
    expect(spreadsheetSafe("-2.86")).toBe("-2.86");
    expect(spreadsheetSafe("+1")).toBe("+1");
    expect(spreadsheetSafe("TP53")).toBe("TP53");
  });
});

describe("the drawing window of a long table", () => {
  const offsets = Float64Array.from({ length: 401 }, (_, i) => i * 40);
  it("draws the rows in view and a margin around them, with spacers for the rest", () => {
    const w = windowOf(offsets, 4000, 4800, 5);
    expect(w.start).toBe(95);
    expect(w.end).toBe(126);
    expect(w.above).toBe(95 * 40);
    expect(w.below).toBe((400 - 126) * 40);
  });
  it("reaches the first and the last row, and an empty table", () => {
    expect(windowOf(offsets, 0, 400, 5).start).toBe(0);
    const last = windowOf(offsets, 15600, 17000, 5);
    expect(last.end).toBe(400);
    expect(last.below).toBe(0);
    expect(windowOf(Float64Array.from([0]), 0, 100)).toEqual({ start: 0, end: 0, above: 0, below: 0 });
  });
});

describe("where a list comes from: the margin decides, as IDTrack's documentation and the api's texts say", () => {
  const of = (band: number[], margin: number | null) => ({
    band,
    margin,
    counts: new Map(band.map((r) => [r, 3])),
    identifiers: 3,
    notFound: 0,
  });
  it("a margin dates the list: its best release is the reading to send", () => {
    expect(verdictOf(of([57, 56, 58], 2))).toBe("dated");
  });
  it("no margin: the list does not date itself, whether its band holds every release or fewer", () => {
    expect(verdictOf(of([56, 57, 58, 59, 60], null))).toBe("undated");
    expect(verdictOf(of([56, 57, 58], null))).toBe("undated");
  });
});
