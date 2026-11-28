// @vitest-environment jsdom
// The verdict as a reader meets it on real answers of the human graph: a reading of the string at other releases that
// leads to the answer's own gene is no other meaning; the sentence states Ensembl's events on the path of every answer,
// one candidate or many; each caution is a sentence with what it rests on a press away; the status says the notes and
// links the limitations where no caution is raised; the Evidence tab says each fact once, labelled by whose reading it
// is; a walk back in time to no gene states the gene's first release and its place. The examples of Convert, their
// facts and sketches, the citation's forms and the identifiers made visible are checked here too.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionResult, ShowcaseResponse } from "../src/api/types";
import { forgetAnswers } from "../src/api/client";
import { ResultView } from "../src/components/ResultView";
import { pathEvents, visibleCharacters } from "../src/lib/answerWords";
import { meaningAdds, standingClaim, verdictOrder } from "../src/lib/evidenceWords";
import docs from "../src/generated/idtrack_docs.json";
import { outcomeWords, referenceRis, referenceText } from "../src/lib/answerProvenance";
import { evidenceOf } from "../src/lib/evidence";
import { answerFacts, examplesOf, pathSketch, placeholderOf } from "../src/lib/home/examples";
import { convolution } from "../src/lib/path/steps";
import { HORIZONTAL_METRICS, layoutPath } from "../src/lib/pathLayout";
import { buildModel } from "../src/lib/pathModel";
import { readVocabulary } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { openTab, resetAddress } from "./disclose";
import { description, fixture, recorded, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());

const load = (name: string) => JSON.parse(fixture("homo_sapiens", name).raw) as ConversionResult;

/** The recorded answers of the human graph served by their address, as the api sent them. */
function serveRecorded() {
  const entries = recorded("homo_sapiens");
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString(), "http://page.test");
    const entry = entries.find((e) => {
      if (`/api/v1${e.path}` !== url.pathname) return false;
      const query = Object.entries(e.query).map(([k, v]) => [k, String(v)]);
      const asked = [...url.searchParams.entries()];
      return query.length === asked.length && query.every(([k, v]) => url.searchParams.get(k ?? "") === v);
    });
    if (!entry) return Promise.reject(new Error(`no recorded answer for ${url.pathname}${url.search}`));
    return Promise.resolve(
      new Response(entry.raw, { status: entry.status, headers: { "content-type": "application/json" } }),
    );
  });
}

function show(name: string) {
  const entry = fixture("homo_sapiens", name);
  const result = JSON.parse(entry.raw) as ConversionResult;
  render(
    <VocabularyContext.Provider value={vocabulary}>
      <ResultView
        result={result}
        raw={entry.raw}
        description={description("homo_sapiens")}
        requestedDatabase={(entry.query["final_database"] as string | undefined) ?? null}
      />
    </VocabularyContext.Provider>,
  );
  return result;
}

const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";

beforeEach(() => {
  forgetAnswers();
  serveRecorded();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetAddress();
});

describe("a reading at other releases", () => {
  it("that leads to the answer's own gene is the api's note, not a caution: no other meaning on the verdict", () => {
    const result = show("convert_other_release_same_gene");
    const codes = result.cautions.map((c) => c.code);
    // The recorded answer: C17orf44 read at 67; at its other releases it is read as the same gene.
    expect(codes).toContain("other_release_same_gene");
    expect(codes).not.toContain("other_release");
    const verdict = text(".answer");
    expect(verdict).not.toContain("named another gene");
    expect(screen.queryAllByRole("link", { name: /^Read it at release/ })).toHaveLength(0);
    openTab(/^Evidence/);
    expect(document.body.textContent).toContain("the same gene at releases");
  });

  it("that leads to another gene is the api's caution on the verdict, with the way to read it there", () => {
    const result = show("convert_other_release_rnr1");
    const caution = result.cautions.find((c) => c.code === "other_release");
    expect(caution?.read_at).not.toBeNull();
    const line = [...document.querySelectorAll(".answer__caution")].find((l) =>
      l.textContent.toLowerCase().includes((caution?.label ?? "-").toLowerCase()),
    );
    expect(line?.querySelector("a")?.textContent).toBe(`Read it at release ${caution?.read_at ?? ""} →`);
  });
});

describe("the verdict's sentence", () => {
  it("states Ensembl's events on the path of an answer of one candidate: several by kind, count and span", () => {
    const result = show("convert_showcase_merge");
    expect(result.candidates).toHaveLength(1);
    const events = pathEvents(buildModel(result));
    expect(events.map((e) => e.reason)).toEqual(expect.arrayContaining(["split", "merge", "split_and_merge"]));
    // Every event in Ensembl's direction, the earlier release first.
    const releases = events.flatMap((e) => e.releases.map((r) => r.split(" → ").map(Number)));
    for (const [a, b] of releases) expect(a).toBeLessThan(b ?? 0);
    const count = releases.length;
    const ends = releases.flat();
    expect(text(".answer__sentence")).toBe(
      `One answer, the only candidate; its path holds ${count} of Ensembl's splits and merges, from release ${Math.min(...ends)} to ${Math.max(...ends)}.`,
    );
  });

  it("states the events of the best of several candidates too", () => {
    const result = show("convert_showcase_split");
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(text(".answer__sentence")).toMatch(
      /One best answer, ranked first of 16 candidates; its path holds Ensembl's/,
    );
  });
});

describe("the cautions and notes of the verdict", () => {
  it("writes each caution as a sentence, the bridge as IDTrack's inference, with what it rests on a press away", () => {
    const result = show("convert_showcase_bridge");
    const marks = evidenceOf(result, vocabulary).filter((m) => m.tone === "caution");
    const lines = [...document.querySelectorAll(".answer__caution")];
    expect(lines).toHaveLength(marks.length);
    // Another gene first, then the other cautions.
    expect(lines[0]?.textContent).toMatch(/^Another gene may be the one meant: /);
    const bridge = lines.find((l) => l.textContent.startsWith("Through 1 bridge"));
    expect(bridge?.textContent).toMatch(
      /^Through 1 bridge: that is IDTrack's inference; no record of Ensembl states it\./,
    );
    // Each line ends in a sentence and carries a visible (i) that opens what it rests on.
    for (const line of lines) {
      const why = line.querySelector<HTMLButtonElement>(".answer__caution-why");
      expect(why?.getAttribute("aria-label")).toMatch(/^What “.+” rests on$/);
    }
    const why = bridge?.querySelector<HTMLButtonElement>(".answer__caution-why");
    if (why) fireEvent.click(why);
    expect(bridge?.textContent).toContain("Answers that only a bridge reaches");
  });

  it("says 'no caution' as a link to the limitations, and counts the notes with the first named", () => {
    const result = show("convert_showcase_split");
    const marks = evidenceOf(result, vocabulary);
    expect(marks.filter((m) => m.tone === "caution")).toHaveLength(0);
    const none = screen.getByRole("link", { name: /^no caution raised by this site's rules/ });
    expect(none.getAttribute("href")).toMatch(/limitations\.html$/);
    const notes = marks.filter((m) => m.tone === "note");
    expect(text(".answer__note-count")).toContain(`${notes.length} notes:`);
    const link = document.querySelector<HTMLAnchorElement>(".answer__note-link");
    expect(link?.getAttribute("href")).toMatch(/tab=evidence/);
    if (link) fireEvent.click(link);
    expect(screen.getByRole("tab", { name: /^Evidence/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("orders and titles the Evidence tab as the verdict does, each fact said once, labelled by whose reading", () => {
    const result = show("convert_showcase_bridge");
    openTab(/^Evidence/);
    const marks = verdictOrder(evidenceOf(result, vocabulary));
    const heads = [...document.querySelectorAll(".evidence-list__head")].map((h) => h.textContent);
    expect(heads[0]).toMatch(/Another gene may be the one meant: /);
    expect(heads).toHaveLength(marks.length);
    for (const [i, mark] of marks.entries()) {
      const item = document.querySelectorAll(".evidence-list__item")[i];
      // The class's meaning is shown only where it adds to the answer's own sentence, folded, as this site's reading.
      const meaning = item?.querySelector(".evidence__card-meaning")?.textContent ?? null;
      if (meaningAdds(mark)) expect(meaning).toMatch(/^This site's reading: /);
      else expect(meaning).toBeNull();
      // The limitation is one linked line, its title alone.
      if (mark.limitation)
        expect(item?.querySelector(".evidence__card-limitation")?.textContent).toBe(
          `Known limitation of IDTrack: ${mark.limitation.title} (IDTrack's documentation, opens in a new tab) ↗`,
        );
    }
    // The split's rule is said once on its card (its meaning repeats the answer's sentence); the limitation's title
    // beside it is a link.
    const split = [...document.querySelectorAll(".evidence-list__item")].find((i) =>
      i.textContent.includes("successors of a split"),
    );
    const said = (split?.querySelector(".evidence__card")?.textContent ?? "").replace(
      split?.querySelector(".evidence__card-limitation")?.textContent ?? "",
      "",
    );
    expect((said.match(/successors of a split/g) ?? []).length).toBe(1);
  });

  it("reads a class's standing claim only where the answer's own text closes with it", () => {
    const marks = evidenceOf(load("convert_showcase_bridge"), vocabulary);
    const bridge = marks.find((m) => m.kind === "bridge");
    expect(bridge && standingClaim(bridge)).toBe("That is IDTrack's inference; no record of Ensembl states it.");
    for (const mark of marks.filter((m) => m.kind !== "bridge")) expect(standingClaim(mark)).toBeNull();
  });
});

describe("an answer without a gene, walked back in time", () => {
  it("states the gene's first release (the end the walk meets) and where it lies", async () => {
    const result = show("convert_backward_no_conversion");
    expect(result.to_release).toBeLessThan(result.from_release ?? 0);
    const words = await screen.findByText(/its first release is/);
    expect(words.closest("li")?.textContent).toMatch(
      /ENSG00000237495\.3, at releases 58–61 \(GRCh37\), on HSCHR6_MHC_MCF, outside the reference sequence; its first release is 58/,
    );
    expect(document.body.textContent).not.toContain("its last release is");
    // The release read is marked as IDTrack's inference on the arrow.
    expect(text(".answer__arrow-text")).toContain("61 (inferred)");
  });
});

describe("the citation", () => {
  it("gives the reference as text and RIS from the BibTeX entry's own fields", () => {
    const bibtex = docs.citation.bibtex;
    expect(referenceText(bibtex)).toBe(
      "Inecik, K. (2026). IDTrack: Cross-Temporal and Cross-Database Biological Identifier Mapping (version 0.1.2) [Software]. https://github.com/theislab/idtrack",
    );
    expect(referenceRis(bibtex)).toBe(
      "TY  - COMP\nAU  - Inecik, Kemal\nTI  - IDTrack: Cross-Temporal and Cross-Database Biological Identifier Mapping\nPY  - 2026\nET  - 0.1.2\nUR  - https://github.com/theislab/idtrack\nER  - \n",
    );
  });

  it("states what IDTrack answered in the methods sentence: a bridge, a tie, the rank", () => {
    expect(outcomeWords(load("convert_showcase_merge"), "Ensembl gene")).toBe(
      "IDTrack answered ENSG00000183483.1 through 1 bridge",
    );
    expect(outcomeWords(load("convert_showcase_tie"), "Ensembl gene")).toMatch(/^IDTrack answered a tie of 3 genes \(/);
    expect(outcomeWords(load("convert_showcase_split"), "Ensembl gene")).toBe(
      "IDTrack answered ENSG00000211620.1, ranked first of 16 candidates",
    );
    expect(outcomeWords(load("convert_backward_no_conversion"), "Ensembl gene")).toBe(
      "IDTrack gave no answer (status no_conversion)",
    );
  });
});

describe("an identifier as typed", () => {
  it("shows the characters a Unicode normalisation removes by their code points", () => {
    expect(visibleCharacters("‮TP53")).toBe("⟨U+202E⟩TP53");
    expect(visibleCharacters("TP​53")).toBe("TP⟨U+200B⟩53");
    expect(visibleCharacters("TP53")).toBe("TP53");
  });
});

/** A showcase of the recorded showcase answers, each a case of the kind it shows. */
function showcase(): ShowcaseResponse {
  const cases = (
    [
      ["split", "convert_showcase_split"],
      ["tie", "convert_showcase_tie"],
      ["bridge", "convert_showcase_bridge"],
      ["merge", "convert_showcase_merge"],
    ] as const
  ).map(([kind, name]) => {
    const entry = fixture("homo_sapiens", name);
    const q = entry.query;
    return {
      kind,
      query: {
        identifier: String(q["identifier"]),
        from_release: q["from_release"] === undefined ? null : Number(q["from_release"]),
        to_release: q["to_release"] === undefined ? null : Number(q["to_release"]),
        final_database: null,
        explain: true,
      },
      result: JSON.parse(entry.raw) as ConversionResult,
    };
  });
  return {
    organism: "homo_sapiens",
    content_digest: null,
    checked_on: null,
    journeys: [],
    cases,
  } as unknown as ShowcaseResponse;
}

describe("the examples of Convert", () => {
  it("are the most convoluted cases by the stated measure, one of each kind, with their facts", () => {
    const examples = examplesOf(showcase(), "homo_sapiens");
    expect(examples).toHaveLength(3);
    expect(new Set(examples.map((e) => e.kind)).size).toBe(3);
    // Ranked by the measure, the most convoluted first, whatever the showcase's order.
    const turns = examples.map((e) => e.turns);
    expect([...turns].sort((a, b) => b - a)).toEqual(turns);
    expect(examples[0]?.kind).toBe("merge");
    expect(examples[0]?.turns).toBe(convolution(load("convert_showcase_merge")).total);
    // The least convoluted kind is left out where three deeper ones stand.
    const all = showcase().cases.flatMap((c) => (c.result ? [convolution(c.result).total] : []));
    expect(Math.min(...turns)).toBeGreaterThanOrEqual([...all].sort((a, b) => b - a)[2] ?? 0);
    expect(placeholderOf(examples)).toBe("e.g. ENSG00000258574");
    expect(placeholderOf([])).toBe("a gene id, symbol or accession");
  });

  it("state what their answers' fields say: walked backward, through a bridge, another gene, a tie", () => {
    expect(answerFacts(load("convert_showcase_merge"))).toEqual([
      "walked backward",
      "through a bridge",
      "another gene",
    ]);
    expect(answerFacts(load("convert_showcase_split"))).toEqual(["walked backward", "another gene"]);
    expect(answerFacts(load("convert_showcase_tie"))).toEqual(["walked backward", "a tie of 3 genes"]);
  });

  it("are sketched with a lane per stable id of the best path, the bridge dashed", () => {
    const merge = load("convert_showcase_merge");
    const sketch = pathSketch(merge);
    expect(sketch).not.toBeNull();
    const best = merge.candidates.find((c) => c.best);
    const ids = new Set(
      [...(best?.path ?? []), ...(best?.final_path ?? [])]
        .map((i) => merge.path?.steps[i])
        .flatMap((s) => (s ? [s.source, s.target] : []))
        .filter((id): id is string => id !== null && /^ENSG\d+/.test(id))
        .map((id) => id.replace(/\.\d+$/, "")),
    );
    expect(sketch?.lanes.map((l) => l.id).sort()).toEqual([...ids].sort());
    expect(sketch?.steps.filter((s) => s.bridge)).toHaveLength(1);
    // Drawn in Ensembl's direction: every step from the earlier release to the later.
    for (const step of sketch?.steps ?? []) expect(step.from).toBeLessThanOrEqual(step.to);
  });
});

describe("the drawing of a path", () => {
  it("gives each stable id of the best path a lane of its own, in the order the walk meets them", () => {
    const result = load("convert_showcase_merge");
    const model = buildModel(result);
    const layout = layoutPath(model, {
      scale: (r) => r * 10,
      answerT: 2000,
      metrics: HORIZONTAL_METRICS,
      limit: 10,
    });
    const stable = (id: string) => id.replace(/\.\d+$/, "");
    const bestGenes = [...layout.nodes.values()].filter((p) => p.node.role === "gene" && p.best);
    const ids = new Set(bestGenes.map((p) => stable(p.node.label)));
    expect(ids.size).toBeGreaterThanOrEqual(5);
    expect(new Set(bestGenes.map((p) => p.lane)).size).toBe(ids.size);
    for (const id of ids)
      expect(new Set(bestGenes.filter((p) => stable(p.node.label) === id).map((p) => p.lane)).size).toBe(1);
  });
});
