// @vitest-environment jsdom
// The rules of the answer that a reader checks with the numbers beside them: scores cut, never rounded; an identifier
// not found told what its form is, by the form alone; a tie of candidates of different entry genes said to be equal in
// the criteria of lineage only; the places' drawing with no label in a band of bars; one word for one kind of step.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { ResultView } from "../src/components/ResultView";
import { placeLayout } from "../src/lib/places";
import { notHeldScheme } from "../src/lib/noTarget";
import { shortScore, stepWords } from "../src/lib/resultWords";
import { readVocabulary } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { description, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());
afterEach(cleanup);

function show(organism: string, name: string) {
  const recorded = fixture(organism, name);
  const result = JSON.parse(recorded.raw) as ConversionResult;
  const database = (recorded.query["final_database"] as string | undefined) ?? null;
  render(
    <VocabularyContext.Provider value={vocabulary}>
      <ResultView result={result} raw={recorded.raw} description={description(organism)} requestedDatabase={database} />
    </VocabularyContext.Provider>,
  );
  return result;
}

describe("scores in a table", () => {
  it("cuts after six significant digits with an ellipsis, never rounds, and keeps the whole value", () => {
    expect(shortScore(0.8019000000000001)).toEqual({ text: "0.8019…", exact: "0.8019000000000001" });
    expect(shortScore(0.7909885957885995)).toEqual({ text: "0.790988…", exact: "0.7909885957885995" });
    expect(shortScore(0.940993)).toEqual({ text: "0.940993", exact: "0.940993" });
    expect(shortScore(1)).toEqual({ text: "1.0", exact: "1.0" });
    expect(shortScore(0.0012345678)).toEqual({ text: "0.00123456…", exact: "0.0012345678" });
  });
});

describe("an identifier not found", () => {
  it("is told the scheme its form is of, by its published form alone", () => {
    expect(notHeldScheme("Q15086")).toBe("uniprot_accession");
    expect(notHeldScheme("A0A024R1R8")).toBe("uniprot_accession");
    expect(notHeldScheme("P04637-2")).toBe("uniprot_isoform");
    expect(notHeldScheme("P53_HUMAN")).toBe("uniprot_entry_name");
    expect(notHeldScheme("URS0000761A87")).toBe("rnacentral");
    for (const other of ["TP53", "ENSG00000141510", "HGNC:11998", "1-Mar", "NM_000546", "MIR21"])
      expect(notHeldScheme(other)).toBeNull();
  });
});

describe("a tie", () => {
  it("of candidates of different entry genes is equal in the criteria of lineage only, its differing scores shown", () => {
    const result = show("homo_sapiens", "convert_tie_entry_genes");
    expect(new Set(result.candidates.map((c) => c.entry_gene)).size).toBe(2);
    const text = document.querySelector(".decision-none")?.textContent ?? "";
    expect(text).toContain("equal in the 6 criteria of lineage");
    expect(text).toContain("descend from 2 different entry genes");
    expect(text).toContain("score, same as query and annotation, which compare only successors of one entry gene");
    expect(text).toContain("0.713681");
    expect(text).toContain("0.926330");
    expect(text).not.toContain("equal in every criterion");
    // What a tie of genes means for a list, in idtrack's terms, with its documentation.
    expect(screen.getByText(/For a list or a count matrix/)).toBeTruthy();
  });

  it("of the ids of one gene is not drawn as a tie between genes", () => {
    // 43 RefSeq ids of one gene: idtrack's word "tie", without a tie's colour or its words for genes.
    show("sus_scrofa", "convert_kind_identity_long");
    expect(document.querySelector(".answer__codes--one-gene")).not.toBeNull();
    expect(document.querySelector(".answer-panel--warn")).toBeNull();
    expect(document.querySelector(".answer__count")?.textContent).toContain("all part of the best answer");
    expect(screen.queryByText(/For a list or a count matrix/)).toBeNull();
    cleanup();
    show("homo_sapiens", "convert_status_tie");
    expect(document.querySelector(".answer__codes--one-gene")).toBeNull();
    expect(document.querySelector(".answer-panel--warn")).not.toBeNull();
  });
});

describe("the places' drawing", () => {
  it("draws each row's labels in bands of their own: names over bars, the axis and its bases under the last bar", () => {
    const rows = [1, 2, 3].map((n) => ({
      assembly: 1,
      region: String(n),
      reference: n !== 3,
      spans: Array.from({ length: n }, (_, i) => ({ start: i, end: 10 + i, strand: 1, genes: [`G${i}`] })),
    }));
    for (const named of [true, false]) {
      const { rows: laid, height } = placeLayout(rows, named);
      let bottom = 0;
      for (const row of laid) {
        expect(row.top).toBeGreaterThanOrEqual(bottom);
        row.bars.forEach((y, i) => {
          // The span's versions stand over its bar (baseline 6 px above), clear of the bar above.
          const label = [y - 13, y - 6];
          const above = row.bars[i - 1];
          if (above !== undefined) expect(label[0]).toBeGreaterThan(above + 3);
          expect(label[1]).toBeLessThan(y - 3);
        });
        const last = row.bars[row.bars.length - 1] ?? 0;
        expect(row.axis).toBeGreaterThan(last + 3);
        expect(row.bases - 9).toBeGreaterThan(row.axis);
        bottom = row.top + row.height;
      }
      expect(height).toBeGreaterThanOrEqual(bottom);
    }
  });
});

describe("words", () => {
  it("name a re-mapping of a gene to itself one way on every figure and table", () => {
    expect(stepWords("self_loop")).toBe("re-mapped to itself");
    expect(stepWords("new_version")).toBe("new version");
  });
});
