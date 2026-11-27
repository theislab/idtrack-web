// @vitest-environment jsdom
// The answer's panel a and its helpers, on recorded real answers: the verdict keeps its shape whatever the answer's
// size (one gene with its first targets, the rest on request), a link carries its target release and graph, the
// symbols are asked of the organism's name authority in one batch, and the words and labels follow the result.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { ResultView } from "../src/components/ResultView";
import { TARGETS_SHOWN } from "../src/components/ResultAnswer";
import { ensemblHistoryHref, kindsText, pinnedLink, shortDigest } from "../src/lib/answerLinks";
import { atOneRelease, buildModel } from "../src/lib/pathModel";
import { eventCounts, stableId } from "../src/lib/pathReading";
import { authorityOf } from "../src/lib/symbols";
import { readVocabulary } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { openTab, resetAddress } from "./disclose";
import { conversions, description, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());
afterEach(() => {
  cleanup();
  resetAddress();
});

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

describe("panel a", () => {
  // The symbols are asked of the api; here the api is not there, and the answer is shown without them.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no api in a unit test")));

  it("reads an answer of many targets as the genes they are ids of, the first targets shown", () => {
    const result = show("homo_sapiens", "convert_kind_entry_long");
    const bests = result.candidates.filter((c) => c.best);
    const genes = new Set(bests.map((c) => c.gene));
    expect(document.querySelectorAll(".answer__group")).toHaveLength(Math.min(3, genes.size));
    const listed = document.querySelectorAll(".answer__list-ids li").length;
    expect(listed).toBeLessThanOrEqual(TARGETS_SHOWN * Math.min(3, genes.size));
    expect(document.querySelector(".answer__count")?.textContent).toContain(
      String(new Set(bests.map((c) => c.target)).size),
    );
    // The status stands with the answer, not after the list of every target.
    const answer = document.querySelector(".answer");
    const status = document.querySelector(".answer__codes");
    expect(answer?.contains(status ?? null)).toBe(true);
    const all = screen.queryByRole("button", { name: /^Show all/ });
    if (all) {
      fireEvent.click(all);
      expect(document.querySelectorAll(".answer__list-ids li").length).toBeGreaterThan(listed);
    }
  });

  it("names the state of the deciding criterion, and says a decision once", () => {
    show("homo_sapiens", "convert_tp53");
    openTab("Record");
    const facts = document.querySelector(".answer__facts")?.textContent ?? "";
    expect(facts).toContain("— (one candidate)");
    expect(document.querySelector(".answer")?.textContent).not.toContain("no criterion had to decide");
  });

  it("states a tie as a tie in the facts", () => {
    show("homo_sapiens", "convert_status_tie");
    openTab("Record");
    expect(document.querySelector(".answer__facts")?.textContent).toContain("none: a tie");
  });

  it("labels an answer without a target by what was asked for", () => {
    show("sus_scrofa", "convert_not_found");
    expect(document.querySelectorAll(".answer__label")[1]?.textContent).toMatch(/^Asked for/);
  });

  it("offers an unknown version converted without its version, at the release given", () => {
    const result = show("sus_scrofa", "convert_unknown_version");
    const base = stableId(result.query_id);
    expect(base).not.toBe(result.query_id);
    expect(screen.getByRole("link", { name: new RegExp(`Convert ${base ?? ""} without its version`) })).toBeTruthy();
  });

  it("opens a menu of ways on from an identifier", () => {
    show("homo_sapiens", "convert_tp53");
    const term = document.querySelector<HTMLButtonElement>(".answer__id .toggletip__term");
    expect(term).toBeTruthy();
    if (!term) return;
    fireEvent.click(term);
    // The answer is not offered converted again where it is (it would give itself).
    expect(screen.queryByRole("link", { name: /^Convert it/ })).toBeNull();
    expect(screen.getByRole("link", { name: /^Open it in Convert at release/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Its names at release/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /id history/ }).getAttribute("href")).toMatch(
      /^https:\/\/www\.ensembl\.org\/Homo_sapiens\/Gene\/Idhistory\?g=ENSG\d+$/,
    );
  });

  it("draws a path at one release as the databases crossed", () => {
    const one = conversions().find(({ result }) => atOneRelease(buildModel(result)) !== null);
    expect(one).toBeDefined();
    if (!one) return;
    show(one.entry.organism, one.entry.name);
    expect(screen.getByRole("group", { name: /^The reading at release/ })).toBeTruthy();
  });
});

describe("the answer's helpers", () => {
  it("pins the target release and the graph in a copied link", () => {
    const result = JSON.parse(fixture("homo_sapiens", "convert_tp53").raw) as ConversionResult;
    const graph = description("homo_sapiens");
    const link = new URL(pinnedLink(result, graph, "https://example.org/?organism=homo_sapiens&id=TP53"));
    expect(link.searchParams.get("to")).toBe(String(result.to_release));
    expect(link.searchParams.get("graph")).toBe(shortDigest(graph));
    expect(shortDigest(graph)).toMatch(/^[0-9a-f]{12}$/);
    // A release written in the address is kept as it is.
    expect(new URL(pinnedLink(result, graph, "https://example.org/?id=TP53&to=90")).searchParams.get("to")).toBe("90");
  });

  it("names the organism's name authority in idtrack's order", () => {
    const at = (names: string[], release = 100) => names.map((name) => ({ name, releases: [release] }));
    // idtrack's order: pig's VGNC before HGNC; a database not held at the release is passed over.
    expect(authorityOf(["VGNC Symbol", "HGNC Symbol"], at(["HGNC Symbol", "VGNC Symbol"]), 100)).toBe("VGNC Symbol");
    expect(authorityOf(["VGNC Symbol", "HGNC Symbol"], at(["HGNC Symbol"]), 100)).toBe("HGNC Symbol");
    expect(authorityOf(["MGI Symbol"], at(["HGNC Symbol", "MGI Symbol"]), 100)).toBe("MGI Symbol");
    expect(authorityOf(["HGNC Symbol"], at(["HGNC Symbol"], 99), 100)).toBeNull();
    expect(authorityOf(["HGNC Symbol"], at(["RefSeq_mRNA"]), 100)).toBeNull();
  });

  it("writes kinds of step, the other ids of a split or merge, and Ensembl's page in words", () => {
    expect(kindsText([{ reason: "new_version", count: 1 }])).toBe("1 new version");
    expect(
      kindsText([
        { reason: "a", count: 1 },
        { reason: "b", count: 1 },
        { reason: "c", count: 1 },
        { reason: "d", count: 1 },
        { reason: "e", count: 1 },
      ]),
    ).toBe("1 a · 1 b · 1 c · 2 more kinds");
    expect(eventCounts(1, 0)).toBe("the earlier id also passed to 1 other id");
    expect(eventCounts(0, 2)).toBe("2 other ids also passed to the later id");
    expect(ensemblHistoryHref("sus_scrofa", "ENSSSCG00000038317.1")).toBe(
      "https://www.ensembl.org/Sus_scrofa/Gene/Idhistory?g=ENSSSCG00000038317",
    );
    expect(ensemblHistoryHref("homo_sapiens", "NM_000207")).toBeNull();
    expect(stableId("ENSG00000141510.20")).toBe("ENSG00000141510");
    expect(stableId("TP53")).toBe("TP53");
  });
});
