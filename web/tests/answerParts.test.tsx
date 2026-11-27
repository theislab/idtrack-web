// @vitest-environment jsdom
// The answer's parts that ask the api for more, and the words that follow the result: the life of an identifier that
// converts to nothing (its genes at the release read, from the api), the other ids of a split or merge named on a
// press, the status in a sentence that fits the candidates, no symbol shown for a gene without one, the hint for a name
// authority's own id, and the provenance saved beside an answer.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { forgetAnswers } from "../src/api/client";
import { ResultView } from "../src/components/ResultView";
import { answerProvenance, citationOf, methodsSentence } from "../src/lib/answerProvenance";
import docs from "../src/generated/idtrack_docs.json";
import { readerText } from "../src/lib/resultWords";
import { readVocabulary } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { description, fixture, recorded, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());

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
      new Response(entry.raw, {
        status: entry.status,
        headers: { "content-type": "application/json", "x-request-id": "t" },
      }),
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

beforeEach(() => {
  forgetAnswers();
  serveRecorded();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an identifier that converts to nothing", () => {
  it("draws the life of its gene at the release read, its last release and its names, from the api", async () => {
    show("convert_no_conversion_retired");
    const words = await screen.findByText(/its last release is/);
    expect(words.closest("li")?.textContent).toMatch(
      /ENSG00000180725\.4, at releases 62–75 \(GRCh37\); its last release is 75/,
    );
    expect(await screen.findByText("AC015871.1")).toBeTruthy();
    expect(screen.getByRole("img", { name: /ENSG00000180725\.4: 62–75; read at 67, asked at 115/ })).toBeTruthy();
    // The status's words name no field of the result.
    expect(document.querySelector(".answer__codes")?.textContent).not.toContain("`");
    expect(document.querySelector(".answer__codes")?.textContent).not.toMatch(/reasons says why/);
  });
});

describe("words that follow the result", () => {
  it("says the best of several candidates and the split on its path, not 'one target'", () => {
    show("convert_split_and_merge_peers");
    const status = document.querySelector(".answer__status-text")?.textContent ?? "";
    expect(status).toContain("One best answer, ranked first of 2 candidates");
    expect(status).toContain("split and merge at 69 → 70");
    expect(status).not.toContain("leads to one target");
    // The deciding values are given beside the criterion.
    expect(document.querySelector(".answer__decision")?.textContent).toMatch(
      /by score \(unscored steps 0, score 0\.998716 against unscored steps 0, score 0\.997436\)/,
    );
  });

  it("names the other ids of a split or merge, from the api's conversion of the same transition", async () => {
    show("convert_split_and_merge_peers");
    // A path of few such events names them at once (one conversion each); the press hides them.
    const [button] = screen.getAllByRole("button", { name: "Hide" });
    expect(button).toBeTruthy();
    if (!button) return;
    // The conversions it asks are recorded where the fixture holds them; here the api answers what it holds.
    expect(await screen.findAllByText(/the api.s conversion of ENSG00000228654\.1/)).not.toHaveLength(0);
    expect(screen.getAllByText(/the api.s conversion of ENSG00000228654\.1 from release 69 to 70/)).not.toHaveLength(0);
  });

  it("shows no symbol for a gene the database asked gives none, and says so", () => {
    show("convert_split_no_target");
    const reached = document.querySelector(".answer__reached")?.textContent ?? "";
    expect(reached).toMatch(/\(Ensembl gene; no HGNC Symbol\)/);
    const others = document.querySelector(".answer__other-genes")?.textContent ?? "";
    expect(others).not.toMatch(/HGNC Symbol: ENSG/);
  });

  it("tells a name authority's own id that the graphs do not hold such ids, with the way on", async () => {
    show("convert_not_found_authority_id");
    await screen.findByText((_, element) => Boolean(element?.matches(".answer__hint")));
    expect(document.querySelector(".answer__hint")?.textContent).toContain("has the form of HGNC's own id of a gene");
    expect(document.querySelector(".answer__hint a")?.textContent).toContain("Databases the graph does not hold");
  });

  it("leaves the codes of fields out of idtrack's words for a reader", () => {
    expect(readerText("No gene descends from it (a retired id, for instance); `reasons` says why.")).toBe(
      "No gene descends from it (a retired id, for instance).",
    );
    expect(readerText("the versions that exist are listed (`known_versions`), and no other")).toBe(
      "the versions that exist are listed, and no other",
    );
    expect(readerText("raised an error (see `error`).")).toBe("raised an error.");
  });

  it("marks the answer that is also listed among the copies set apart", () => {
    show("convert_lrg_gene_listed_as_copy");
    expect(document.querySelector(".copies-list")?.textContent).toContain("the answer itself, also listed here");
  });
});

describe("the provenance of one answer", () => {
  it("names the graph, the versions and the request as asked", () => {
    const entry = fixture("homo_sapiens", "convert_tp53");
    const result = JSON.parse(entry.raw) as ConversionResult;
    const provenance = answerProvenance({
      result,
      description: description("homo_sapiens"),
      version: null,
      apiUrl: "/api/v1/organisms/homo_sapiens/convert?identifier=TP53&explain=true",
      requestId: "abc",
      serverTiming: "app;dur=1.2",
      receivedAt: "2026-11-27T10:00:00.000Z",
      file: "idtrack_homo_sapiens_TP53_to_115.json",
      now: new Date("2026-11-27T10:01:00Z"),
    });
    expect(provenance.request).toEqual({
      method: "GET",
      path: "/api/v1/organisms/homo_sapiens/convert",
      query: { identifier: "TP53", explain: "true" },
    });
    expect(provenance.graph.content_digest).toBe(description("homo_sapiens").content_digest);
    expect(provenance.answer).toMatchObject({ query_id: "TP53", status: result.status, request_id: "abc" });
    expect(provenance.exported_at).toBe("2026-11-27T10:01:00.000Z");
  });
});

describe("citing one answer", () => {
  const version = {
    api_version: "0.1.2",
    idtrack_version: "0.1.2",
    idtrack_commit: "7f71b2606a61b7e46b99361406ad403ae21eb5b9",
    graphs: [],
  } as unknown as Parameters<typeof methodsSentence>[0]["version"];

  it("gives idtrack's citation with the version that answered, and a sentence of this exact run", () => {
    expect(citationOf(docs.citation.bibtex, { ...version, idtrack_version: "9.9.9" })).toContain("version = {9.9.9}");
    expect(citationOf(docs.citation.bibtex, null)).toBe(docs.citation.bibtex);
    const entry = fixture("homo_sapiens", "convert_number_other_scheme");
    const result = JSON.parse(entry.raw) as ConversionResult;
    const graph = description("homo_sapiens");
    const sentence = methodsSentence({
      result,
      description: graph,
      version,
      database: "Ensembl gene (with version)",
      bridges: true,
      date: "2026-11-27",
    });
    expect(sentence).toBe(
      `The identifier 1898 (Homo sapiens) was converted with idtrack 0.1.2 (commit 7f71b26) through its web server (api 0.1.2) on 2026-11-27: read at Ensembl release 52 (inferred by idtrack), converted to release 115 in Ensembl gene (with version), bridges allowed, on the graph of Ensembl releases ${graph.releases[0] ?? ""}–${graph.releases[graph.releases.length - 1] ?? ""}, content digest ${graph.content_digest?.slice(0, 12) ?? ""}.`,
    );
  });

  it("opens the citation from the answer's actions", async () => {
    show("convert_tp53");
    fireEvent.click(screen.getByRole("button", { name: /^Cite/ }));
    expect((await screen.findByRole("region", { name: "Citation in BibTeX" })).textContent).toContain(
      "@software{idtrack",
    );
    // The sentence waits for the server's versions (here none is recorded under that address: only the citation).
    expect(screen.getByRole("button", { name: /^Cite/ }).getAttribute("aria-expanded")).toBe("true");
  });
});
