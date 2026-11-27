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
      // Every other reading is a mark of its own, but the digits of a number written with a version, which the number's
      // mark names.
      const versioned = /^\d+\.\d+$/.test(result.query_id);
      expect(marks.filter((m) => m.kind === "other_release" || m.kind === "other_reading")).toHaveLength(
        result.other_readings.filter(
          (r) =>
            (r.reason !== "other_release" || r.releases.length) && !(versioned && r.reason === "unversioned_database"),
        ).length,
      );
      // Where another gene may be the one meant, the mark says so beside the status, with a limitation of idtrack's.
      for (const mark of marks.filter((m) => m.alert)) {
        expect(mark.tone).toBe("caution");
        expect(mark.limitation).not.toBeNull();
      }
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

  it("counts the bridges the best answer's paths take, each pair of genes once, not every record of the search", () => {
    // Pig: one bridge on the path, across assemblies; the search recorded four pairs of the same two genes' versions.
    const one = evidenceOf(load("sus_scrofa", "convert_bridge_check_taken"), vocabulary);
    expect(one.find((m) => m.kind === "places_unknown")?.label).toBe("places not compared across assemblies");
    expect(one.find((m) => m.kind === "places_unknown")?.detail).toMatch(/^1 bridge of the best answer's path joins/);
    // Five tied best answers share two bridges (55 pairs recorded by the search).
    const tied = evidenceOf(load("sus_scrofa", "convert_bridges_tied"), vocabulary);
    expect(tied.find((m) => m.kind === "places_unknown")?.label).toBe("2 steps across assemblies, places not compared");
  });

  it("says where another gene may be the one meant, with the conversion that answers it", () => {
    // HLA-DRB3 at 70 in HGNC Symbol: read through three databases, the tie through UniProt's gene names alone; the
    // genes of HGNC's symbol are the copies set apart (idtrack's documented example).
    const hla = evidenceOf(load("homo_sapiens", "convert_name_other_sources"), vocabulary);
    const elsewhere = hla.find((m) => m.kind === "name_elsewhere");
    expect(elsewhere?.alert).toBe(true);
    expect(elsewhere?.label).toBe("the best answer is read only through UniProtKB Gene Name");
    expect(elsewhere?.detail).toContain("the 14 copies on haplotypes, patches or alternative loci");
    expect(elsewhere?.ask).toEqual({
      words: "Ask with HGNC Symbol as the source database",
      fromDatabase: "HGNC Symbol",
    });
    expect(elsewhere?.limitation?.title).toBe("A name that another source gives another gene");
    // Pig ENSSSCG00000014532 from 56 to 98: the best answer left the id at 66 → 67, the id lived on to 89 → 90.
    const branch = evidenceOf(load("sus_scrofa", "convert_branch_continuation"), vocabulary);
    const own = branch.find((m) => m.kind === "own_continuation");
    expect(own?.detail).toContain("releases 66 → 67");
    expect(own?.detail).toContain("releases 89 → 90");
    expect(own?.detail).toContain("rank 4–6");
    expect(own?.limitation?.title).toBe("A branch can outrank the gene's own continuation");
    // Mouse Rhbg read at 77: its gene split; at 115 the runner-up carries MGI's Rhbg, the best answer Gm38392.
    const rhbg = load("mus_musculus", "convert_runner_named");
    expect(evidenceOf(rhbg, vocabulary).some((m) => m.kind === "runner_named")).toBe(false);
    const symbols = {
      database: "MGI Symbol",
      of: new Map([
        ["ENSMUSG00000103766.6", ["Gm38392"]],
        ["ENSMUSG00000104445.2", ["Rhbg"]],
      ]),
    };
    const named = evidenceOf(rhbg, vocabulary, { symbols }).find((m) => m.kind === "runner_named");
    expect(named?.alert).toBe(true);
    expect(named?.detail).toContain("`ENSMUSG00000104445.2` (rank 2) carries `Rhbg` as MGI Symbol");
    expect(named?.ask).toEqual({ words: "Ask Rhbg at release 115", fromRelease: 115, toRelease: 115 });
    // The best answer's own symbol being the name typed: no mark.
    const plain = evidenceOf(rhbg, vocabulary, {
      symbols: { database: "MGI Symbol", of: new Map([["ENSMUSG00000103766.6", ["Rhbg"]]]) },
    });
    expect(plain.some((m) => m.kind === "runner_named")).toBe(false);
    // The retired MIR21 id: the way on is an accession the runner-up holds today.
    const rival = evidenceOf(load("homo_sapiens", "convert_retired_bridge"), vocabulary).find(
      (m) => m.kind === "bridge_rival",
    );
    expect(rival?.alert).toBe(true);
    expect(rival?.ask?.identifier).toBe("MI0000077");
  });

  it("names the other reading of a number written with a version, and a symbol database that is not the authority's", () => {
    const versioned = evidenceOf(load("homo_sapiens", "convert_versioned_number"), vocabulary);
    const number = versioned.find((m) => m.kind === "bare_number");
    expect(number?.tone).toBe("caution");
    expect(number?.label).toBe("a number read as a Havana translation id of release 51");
    expect(number?.detail).toContain("Read without its version, as `2633`, it answers `ENSG00000117228.12`");
    expect(number?.ask).toEqual({ words: "Ask 2633 without the version", identifier: "2633" });
    expect(versioned.some((m) => m.kind === "other_reading")).toBe(false);
    const pig = JSON.parse(fixture("sus_scrofa", "databases").raw) as { symbol_databases: string[] };
    const projected = evidenceOf(load("sus_scrofa", "convert_projected_no_target"), vocabulary, {
      symbolDatabases: pig.symbol_databases,
      asked: "HGNC Symbol",
    }).find((m) => m.kind === "projected_symbols");
    expect(projected?.label).toBe("HGNC Symbol is not this organism's name authority");
    expect(projected?.ask).toEqual({ words: "Ask in VGNC Symbol", finalDatabase: "VGNC Symbol" });
    // The authority itself asked: no mark.
    expect(
      evidenceOf(load("sus_scrofa", "convert_projected_no_target"), vocabulary, {
        symbolDatabases: pig.symbol_databases,
        asked: "VGNC Symbol",
      }).some((m) => m.kind === "projected_symbols"),
    ).toBe(false);
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
