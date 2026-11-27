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

describe("evidenceOf", () => {
  it("names only limitations that are sections of idtrack's documentation", () => {
    const anchors = new Set(limitations.sections.map((s) => s.anchor));
    for (const list of Object.values(LIMITATION_OF)) expect(list.some((anchor) => anchors.has(anchor))).toBe(true);
    expect(limitations.sections.map((s) => s.lead)).toEqual(limitations.items);
  });

  it.each(all.map((c) => [`${c.entry.organism}/${c.entry.name}`, c.result] as const))(
    "%s: every mark is a caution of the api's, in its order, with its words and its limitation",
    (_, result) => {
      const marks = evidenceOf(result, vocabulary);
      expect(marks.map((m) => m.kind)).toEqual(result.cautions.map((c) => c.code));
      expect(marks.map((m) => m.label)).toEqual(result.cautions.map((c) => c.label));
      // Cautions first.
      const tones = marks.map((m) => m.tone);
      expect(tones).toEqual([...tones].sort((a, b) => (a === b ? 0 : a === "caution" ? -1 : 1)));
      result.cautions.forEach((caution, i) => {
        const mark = marks[i];
        // Every class the api computes is in its vocabulary, and every limitation it names is a section of idtrack's
        // documentation the page holds (its title and lead are shown).
        expect(vocabulary.cautions.has(caution.code), caution.code).toBe(true);
        expect(mark?.meaning).toBe(vocabulary.cautions.get(caution.code)?.meaning);
        if (caution.limitation) expect(mark?.limitation?.title, caution.limitation).toBeTruthy();
        expect(mark?.alert ?? false).toBe(caution.alert);
        expect(mark?.detail).not.toMatch(/\bNone\b|\bTrue\b|\bFalse\b/);
      });
    },
  );

  it("reads the api's way on: only the parts it names as changed", () => {
    const hla = evidenceOf(load("homo_sapiens", "convert_name_other_sources"), vocabulary);
    expect(hla[0]?.kind).toBe("name_elsewhere");
    expect(hla[0]?.alert).toBe(true);
    expect(hla[0]?.ask).toEqual({ words: "Ask with HGNC Symbol as the source database", fromDatabase: "HGNC Symbol" });
    const rival = evidenceOf(load("homo_sapiens", "convert_retired_bridge"), vocabulary).find(
      (m) => m.kind === "bridge_rival",
    );
    expect(rival?.ask?.identifier).toBe("MI0000077");
    expect(rival?.ask?.fromRelease).toBe(115);
    const rhbg = evidenceOf(load("mus_musculus", "convert_runner_named"), vocabulary)[0];
    expect(rhbg?.kind).toBe("runner_named");
    expect(rhbg?.ask?.identifier).toBeUndefined();
    const other = evidenceOf(load("homo_sapiens", "convert_other_release_rnr1"), vocabulary).find(
      (m) => m.kind === "other_release",
    );
    expect(other?.readAt).toBeTypeOf("number");
  });

  it("gives a plain answer no caution", () => {
    expect(cautionCount(evidenceOf(load("homo_sapiens", "convert_tp53"), vocabulary))).toBe(0);
  });

  it("works without the vocabulary (the words of a mark are the api's)", () => {
    const result = load("homo_sapiens", "convert_retired_bridge");
    const marks = evidenceOf(result);
    expect(marks.map((m) => m.label)).toEqual(result.cautions.map((c) => c.label));
    expect(marks.every((m) => m.meaning === null)).toBe(true);
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
