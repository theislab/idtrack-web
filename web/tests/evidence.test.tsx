// @vitest-environment jsdom
// The evidence marks of an answer, checked on every recorded real answer: each mark is read from a field the result
// holds (and only where it holds), every limitation it names is a section of idtrack's documentation, and no mark is
// written in a programming language's spelling. The component opens each mark on a press, not on hover alone.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { Evidence } from "../src/components/Evidence";
import limitations from "../src/generated/limitations.json";
import { cautionCount, evidenceOf, LIMITATION_OF } from "../src/lib/evidence";
import { readVocabulary } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { conversions, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());
const all = conversions();
afterEach(cleanup);

const load = (organism: string, name: string) => JSON.parse(fixture(organism, name).raw) as ConversionResult;
const kinds = (result: ConversionResult) => evidenceOf(result, vocabulary).map((m) => m.kind);

describe("evidenceOf", () => {
  it("names only limitations that are sections of idtrack's documentation", () => {
    const anchors = new Set(limitations.sections.map((s) => s.anchor));
    // Each class has at least one of its anchors in the generated file (a newer title first, the pinned one after).
    for (const list of Object.values(LIMITATION_OF)) expect(list.some((anchor) => anchors.has(anchor))).toBe(true);
    expect(limitations.sections.map((s) => s.lead)).toEqual(limitations.items);
  });

  it.each(all.map((c) => [`${c.entry.organism}/${c.entry.name}`, c.result] as const))(
    "%s: every mark rests on a field of the result",
    (_, result) => {
      const marks = evidenceOf(result, vocabulary);
      const bests = result.candidates.filter((c) => c.best);
      // Cautions first.
      const tones = marks.map((m) => m.tone);
      expect(tones).toEqual([...tones].sort((a, b) => (a === b ? 0 : a === "caution" ? -1 : 1)));
      const has = (kind: string) => marks.some((m) => m.kind === kind);
      expect(has("bridge")).toBe(!result.no_target && bests.some((c) => c.bridges > 0));
      expect(has("unscored")).toBe(!result.no_target && bests.some((c) => c.unscored_steps > 0));
      expect(has("read_at_another_release")).toBe(
        result.reasons.includes("read_at_another_release") && result.from_release !== null,
      );
      expect(marks.filter((m) => m.kind === "other_release" || m.kind === "other_reading")).toHaveLength(
        result.other_readings.filter((r) => r.reason !== "other_release" || r.releases.length).length,
      );
      if (!result.path) {
        expect(has("places_apart")).toBe(false);
        expect(has("lowest_score")).toBe(false);
      }
      for (const mark of marks) {
        expect(mark.label.length).toBeGreaterThan(0);
        expect(mark.detail).not.toMatch(/\bNone\b|\bTrue\b|\bFalse\b/);
        if (mark.limitation) expect(mark.limitation.href).toMatch(/^https:\/\/github\.com\/theislab\/idtrack\/blob\//);
      }
    },
  );

  it("marks a bridge, a step to another place and the lowest score of a known answer", () => {
    expect(kinds(load("homo_sapiens", "convert_annotation"))).toEqual(
      expect.arrayContaining(["bridge", "places_apart"]),
    );
    const apart = evidenceOf(load("homo_sapiens", "convert_step_places_places_apart"), vocabulary);
    expect(apart.find((m) => m.kind === "places_apart")?.limitation?.title).toBe(
      "An id that Ensembl moves to another place",
    );
  });

  it("marks a synonym, another meaning at other releases and a version newer than the graph", () => {
    const rnr1 = evidenceOf(load("homo_sapiens", "convert_other_release_rnr1"), vocabulary);
    expect(rnr1.map((m) => m.label)).toEqual(expect.arrayContaining(["read as a synonym"]));
    const other = rnr1.find((m) => m.kind === "other_release");
    expect(other?.readAt).toBeTypeOf("number");
    expect(other?.limitation?.title).toBe("Without a release, a string is what it means today");
    expect(kinds(load("sus_scrofa", "convert_version_newer"))).toContain("match");
    expect(evidenceOf(load("sus_scrofa", "convert_version_newer"), vocabulary)[0]?.label).toContain("newer");
  });

  it("cautions a bare number read in another numbering scheme, and an answer only outside the reference", () => {
    const marks = evidenceOf(load("homo_sapiens", "convert_number_other_scheme"), vocabulary);
    const number = marks.find((m) => m.kind === "bare_number");
    expect(number?.tone).toBe("caution");
    expect(number?.label).toBe("a number read as a Havana transcript id of release 52");
    expect(number?.limitation?.title).toBe("Numbers that several numbering schemes share");
    const outside = marks.find((m) => m.kind === "outside_reference");
    expect(outside?.tone).toBe("caution");
    expect(outside?.limitation?.title).toBe("Copies on patches and alternative loci");
    // A number the graph holds at the target release is a note, not a caution; a gene of the reference, nothing.
    const tp53 = load("homo_sapiens", "convert_tp53");
    const asNumber = { ...tp53, query_id: "7157", graph_id: "7157", from_databases: ["EntrezGene"] };
    expect(evidenceOf(asNumber, vocabulary).find((m) => m.kind === "bare_number")?.tone).toBe("note");
    expect(kinds(tp53)).not.toContain("outside_reference");
  });

  it("names the documented class of a bridge to the gene nearest in releases, and a bridge between genes of one time", () => {
    const marks = evidenceOf(load("homo_sapiens", "convert_retired_bridge"), vocabulary);
    const rival = marks.find((m) => m.kind === "bridge_rival");
    expect(rival?.detail).toContain("ENSG00000284190.1");
    expect(rival?.detail).toContain("MI0000077");
    expect(rival?.limitation?.title).toBe("A retired gene whose accession another gene holds today");
    const beside = marks.find((m) => m.kind === "bridge_beside");
    expect(beside?.detail).toContain("both exist at releases 77–78");
    // A bridge from a gene whose life ended before the gene it enters began (the documentation's good case) has neither.
    for (const { result } of all) {
      const k = kinds(result);
      if (k.includes("bridge_rival")) expect(result.decided_by).toBe("bridge_gap");
      if (k.includes("bridge_beside") || k.includes("bridge_rival")) expect(k).toContain("bridge");
    }
  });

  it("says that an LRG gene's answer is listed among the copies, and that every target is an id of one gene", () => {
    const lrg = evidenceOf(load("homo_sapiens", "convert_lrg_gene_listed_as_copy"), vocabulary);
    expect(lrg.find((m) => m.kind === "listed_as_copy")?.limitation?.title).toBe(
      "The GRCh37 gene ids of LRG records list their answer among the copies",
    );
    for (const { result } of all) {
      const bests = result.candidates.filter((c) => c.best);
      const oneGene =
        !result.no_target &&
        new Set(bests.map((c) => c.gene)).size === 1 &&
        new Set(bests.map((c) => c.target)).size > 1;
      expect(kinds(result).includes("one_gene")).toBe(oneGene);
    }
  });

  it("notes that the successors of a split are ranked by score, not by place", () => {
    const marks = evidenceOf(load("homo_sapiens", "convert_split_and_merge_peers"), vocabulary);
    expect(marks.find((m) => m.kind === "split_ranked")?.limitation?.title).toBe(
      "Among the successors of a split, the best answer does not look at the old place",
    );
    expect(kinds(load("homo_sapiens", "convert_number_other_scheme"))).not.toContain("split_ranked");
  });

  it("gives a plain answer no caution", () => {
    expect(cautionCount(evidenceOf(load("homo_sapiens", "convert_tp53"), vocabulary))).toBe(0);
  });

  it("works without the vocabulary and without the path (a batch's results)", () => {
    const result = load("homo_sapiens", "convert_candidate_bridges");
    const plain = { ...result, path: null };
    expect(evidenceOf(plain).map((m) => m.kind)).toContain("bridge");
  });
});

describe("Evidence", () => {
  it("opens a mark on a press, with what the result says and the limitation", () => {
    const result = load("homo_sapiens", "convert_other_release_rnr1");
    render(
      <VocabularyContext.Provider value={vocabulary}>
        <Evidence result={result} readAtHref={(r) => `/?id=RNR1&from=${r}`} />
      </VocabularyContext.Provider>,
    );
    const list = screen.getByRole("list", { name: "Evidence to weigh" });
    const button = list.querySelector("button");
    expect(button).toBeTruthy();
    if (!button) return;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Caution");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("draws at most a few marks in compact form, and counts the rest", () => {
    const result = load("sus_scrofa", "convert_other_reading_other_release");
    const marks = evidenceOf(result, vocabulary);
    render(
      <VocabularyContext.Provider value={vocabulary}>
        <Evidence result={result} compact max={1} />
      </VocabularyContext.Provider>,
    );
    if (marks.length > 1) expect(document.body.textContent).toContain(`+ ${marks.length - 1} more`);
  });

  it("draws nothing for an answer without a mark", () => {
    const { container } = render(<Evidence result={load("homo_sapiens", "convert_tp53")} marks={[]} />);
    expect(container.textContent).toBe("");
  });
});
