// @vitest-environment jsdom
// The batch's figure and the names' lanes, on the recorded answers of the real api: every count is the answer's own,
// every release of a match is drawn and written, the table sorts, filters and opens to every candidate, and the
// server's time is shown only when its header is sent.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BatchRequest, BatchResponse, ConversionResult, NamesResponse } from "../src/api/types";
import { BatchResults, type BatchAnswer } from "../src/components/BatchResults";
import { NameMatches } from "../src/components/NameMatches";
import {
  batchRows,
  filterRows,
  isCopy,
  matchPrefixes,
  readAtCounts,
  sortRows,
  statusCounts,
  travelled,
} from "../src/lib/batchTable";
import { releaseRanges } from "../src/lib/numbers";
import { groupByGene, nameCounts } from "../src/lib/nameGroups";
import { axisOf, bandsOf, cell, runsOf, tickLabels } from "../src/components/figure/releases";
import { readVocabulary } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { ORGANISMS, description, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());
const order = [...vocabulary.statuses.keys()];

afterEach(cleanup);

function batch(organism: string, name = "batch_json"): ConversionResult[] {
  return (JSON.parse(fixture(organism, name).raw) as BatchResponse).results;
}

function request(results: ConversionResult[]): Required<BatchRequest> {
  return {
    identifiers: results.map((r) => r.query_id),
    from_release: null,
    to_release: null,
    final_database: null,
    from_database: null,
    explain: false,
    allow_bridges: true,
    read_copies: true,
  };
}

function answerOf(results: ConversionResult[], serverTiming: string | null): BatchAnswer {
  return {
    results,
    count: results.length,
    request: request(results),
    raw: JSON.stringify({ count: results.length, results }),
    serverTiming,
    requestId: null,
    answeredAt: null,
    source: null,
    pathsRefused: null,
  };
}

/** Text of the page with its titles and labels (where a value's meaning stands on focus). */
function shownText(): string {
  const titles = [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? "");
  const labels = [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") ?? "");
  // A file's own bytes shown as they are (pre.raw) are no words of the page, as in the end-to-end checks.
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("pre.raw").forEach((e) => {
    e.remove();
  });
  return `${clone.textContent} ${titles.join(" ")} ${labels.join(" ")}`;
}

describe("the batch's counts", () => {
  for (const organism of ORGANISMS) {
    for (const name of ["batch_json", "batch_json_copies"]) {
      it(`${organism} ${name}: counts in the vocabulary's order that sum to the results`, () => {
        const results = batch(organism, name);
        const counts = statusCounts(results, order);
        expect(counts.reduce((sum, [, n]) => sum + n, 0)).toBe(results.length);
        const known = counts.map(([s]) => s).filter((s) => order.includes(s));
        expect(known).toEqual(order.filter((s) => known.includes(s)));
        for (const [status, n] of counts) expect(results.filter((r) => r.status === status)).toHaveLength(n);
        const { byRelease, none } = readAtCounts(results);
        expect([...byRelease.values()].reduce((a, b) => a + b, 0) + none).toBe(results.length);
        expect(none).toBe(results.filter((r) => r.from_release === null).length);
      });
    }
  }

  it("a copy is a result whose match carries idtrack's prefix copy", () => {
    expect(matchPrefixes("copy:synonym:exact")).toEqual(["copy", "synonym"]);
    expect(matchPrefixes("exact")).toEqual([]);
    expect(matchPrefixes(null)).toEqual([]);
    for (const organism of ORGANISMS) {
      const results = batch(organism, "batch_json_copies");
      const copies = results.filter(isCopy);
      expect(copies.length).toBeGreaterThan(0);
      for (const r of copies) expect(r.match?.split(":")).toContain("copy");
    }
  });

  it("travel is a release read other than the target", () => {
    const results = batch("homo_sapiens");
    for (const r of results) expect(travelled(r)).toBe(r.from_release !== null && r.from_release !== r.to_release);
  });
});

describe("the batch's rows", () => {
  const results = batch("homo_sapiens");
  const rows = batchRows(results);

  it("sort keeps ties in input order and puts absent values last both ways", () => {
    for (const descending of [false, true]) {
      const sorted = sortRows(rows, { key: "release", descending }, order);
      const releases = sorted.map((r) => r.result.from_release);
      const firstAbsent = releases.indexOf(null);
      if (firstAbsent >= 0) expect(releases.slice(firstAbsent).every((r) => r === null)).toBe(true);
      const present = releases.filter((r): r is number => r !== null);
      expect(present).toEqual([...present].sort((a, b) => (descending ? b - a : a - b)));
      const ties = sorted.filter((r, i) => i > 0 && sorted[i - 1]?.result.from_release === r.result.from_release);
      for (const tie of ties) {
        const before = sorted[sorted.indexOf(tie) - 1];
        expect(before?.index ?? -1).toBeLessThan(tie.index);
      }
    }
    const byStatus = sortRows(rows, { key: "status", descending: false }, order).map((r) => r.result.status);
    expect(byStatus).toEqual([...byStatus].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(sortRows(rows, { key: "order", descending: true }, order).map((r) => r.index)).toEqual(
      rows.map((r) => r.index).reverse(),
    );
  });

  it("filter by status and by text, and the answers are the best candidates' targets", () => {
    const status = results[0]?.status ?? "converted";
    expect(filterRows(rows, { statuses: new Set([status]) }).every((r) => r.result.status === status)).toBe(true);
    expect(filterRows(rows, { statuses: new Set() })).toHaveLength(rows.length);
    const first = results[0]?.query_id ?? "";
    expect(
      filterRows(rows, { statuses: new Set(), text: first.toLowerCase() }).some((r) => r.result.query_id === first),
    ).toBe(true);
    for (const row of rows) {
      const best = row.result.no_target ? [] : row.result.candidates.filter((c) => c.best).map((c) => c.target);
      expect(row.answers).toEqual(best);
    }
  });
});

describe("the release axis", () => {
  for (const organism of ORGANISMS) {
    const graph = description(organism);
    const axis = axisOf(graph.releases);

    it(`${organism}: the bands are the runs of serving_assembly, covering every release once`, () => {
      const bands = bandsOf(axis, graph);
      const covered = bands.flatMap((b) => axis.releases.filter((r) => r >= b.first && r <= b.last));
      expect(covered).toEqual(axis.releases);
      for (const band of bands) {
        for (const r of axis.releases.filter((x) => x >= band.first && x <= band.last))
          expect(graph.serving_assembly[String(r)]).toBe(band.assembly);
        expect(band.name).toBe(graph.assemblies.find((a) => a.assembly === band.assembly)?.name);
      }
      const widths = bands.reduce((sum, b) => sum + b.width, 0);
      expect(widths).toBeCloseTo(1, 10);
    });

    it(`${organism}: the labels hold the first and the last release`, () => {
      const labels = tickLabels(axis, 4);
      expect(labels[0]).toBe(axis.releases[0]);
      expect(labels[labels.length - 1]).toBe(axis.releases[axis.releases.length - 1]);
    });
  }

  it("runs fill exactly the releases given, each release one cell", () => {
    const axis = axisOf([50, 51, 52, 53, 54, 55, 56, 57]);
    const runs = runsOf(axis, [57, 51, 52, 54, 54]);
    expect(runs.map((r) => [r.first, r.last])).toEqual([
      [51, 52],
      [54, 54],
      [57, 57],
    ]);
    expect(runs[0]?.left).toBeCloseTo(1 / 8, 12);
    expect(runs[0]?.width).toBeCloseTo(2 / 8, 12);
    expect(cell(axis, 99)).toBeNull();
    expect(runsOf(axis, [99])).toEqual([]);
  });
});

describe("the batch's figure", () => {
  for (const organism of ORGANISMS) {
    it(`${organism}: one row per result, filtered by a status, opened to every candidate`, () => {
      const results = batch(organism);
      render(
        <VocabularyContext.Provider value={vocabulary}>
          <BatchResults description={description(organism)} answer={answerOf(results, null)} />
        </VocabularyContext.Provider>,
      );
      const region = screen.getByRole("region", { name: /^Results: / });
      const rows = () => within(region).getAllByRole("row").slice(1);
      expect(rows()).toHaveLength(results.length);
      results.forEach((r, i) => {
        expect(rows()[i]?.textContent).toContain(r.query_id);
      });
      expect(screen.queryByText("Server time")).toBeNull();
      for (const [status, n] of statusCounts(results, order)) {
        const chip = screen.getByRole("button", { name: new RegExp(`^${status.replace(/_/g, " ")}`, "i") });
        fireEvent.click(chip);
        expect(rows()).toHaveLength(n);
        fireEvent.click(chip);
      }
      const withCandidates = results.findIndex((r) => r.candidates.length > 0);
      const toggle = within(rows()[withCandidates] ?? document.body).getByRole("button", { expanded: false });
      fireEvent.click(toggle);
      const detail = document.getElementById(`batch-detail-${withCandidates}`);
      expect(detail).not.toBeNull();
      for (const candidate of results[withCandidates]?.candidates ?? [])
        expect(detail?.textContent).toContain(candidate.target);
      const spelling = /\b(None|True|False|null|undefined|NaN)\b/.exec(shownText());
      expect(spelling?.[0]).toBeUndefined();
    });
  }

  it("states the server's time from its header", () => {
    const results = batch("sus_scrofa");
    render(
      <VocabularyContext.Provider value={vocabulary}>
        <BatchResults
          description={description("sus_scrofa")}
          answer={answerOf(results, "app;dur=12.5, queue;dur=0.1, search;dur=11.9")}
        />
      </VocabularyContext.Provider>,
    );
    const time = screen.getByRole("button", { name: /^answered in 12\.5 ms on the server/ });
    expect(time.textContent).toBe("12.5\u00a0ms");
    fireEvent.click(time);
    const card = document.querySelector(".toggletip__card")?.textContent ?? "";
    expect(card).toContain("app 12.5 · queue 0.1 · search 11.9");
  });
});

describe("the names' lanes", () => {
  for (const organism of ORGANISMS) {
    for (const name of ["genes_named_ins", "genes_named_ins_fold"]) {
      it(`${organism} ${name}: one group per gene id, every version's releases written and drawn`, async () => {
        const matches = (JSON.parse(fixture(organism, name).raw) as NamesResponse).matches;
        const graph = description(organism);
        render(
          <NameMatches
            matches={matches}
            description={graph}
            address={{}}
            empty="none"
            first="gene"
            release={null}
            endpoint="GET"
            asked="INS"
          />,
        );
        // The figure is drawn once what the genes are called today is settled (here no server answers: it says so).
        const region = await screen.findByRole("region", { name: "Matches" }, { timeout: 4000 });
        const groups = groupByGene(matches);
        const bodies = region.querySelectorAll("tbody.names-gene");
        expect(bodies).toHaveLength(Math.min(groups.length, 12));
        const counts = nameCounts(matches);
        const summary = document.querySelector(".names-summary")?.textContent ?? "";
        expect(summary).toContain(`${String(counts.genes)} gene`);
        expect(summary).toContain(`${String(counts.versions)} version`);
        const axis = axisOf(graph.releases);
        // Every version's releases on a press of its lane's "+ N versions".
        for (const more of [...region.querySelectorAll<HTMLButtonElement>(".names-exact__more")]) fireEvent.click(more);
        groups.slice(0, 12).forEach((group, g) => {
          const body = bodies[g];
          if (!body) throw new Error(`no group ${String(g)}`);
          expect(body.querySelector(".names-gene__id")?.textContent).toContain(group.gene);
          const lanes = body.querySelectorAll("tr.names-lane-row");
          expect(lanes).toHaveLength(group.lanes.length);
          group.lanes.forEach((lane, l) => {
            const row = lanes[l];
            if (!row) throw new Error("no lane");
            expect(row.querySelectorAll(".rlane__run")).toHaveLength(runsOf(axis, lane.releases).length);
            expect(row.querySelectorAll(".rlane__run--synonym").length > 0).toBe(lane.synonym);
            const lines = [...row.querySelectorAll(".names-exact__line")].map((e) => e.textContent);
            expect(lines).toHaveLength(lane.parts.length);
            lane.parts.forEach((part, k) => {
              expect(lines[k]).toContain(releaseRanges(part.releases));
              expect(lines[k]).toContain(/\.\d+$/.exec(part.gene)?.[0] ?? part.gene);
            });
          });
        });
        // Every match is written once, as its version's line.
        const all = [...region.querySelectorAll(".names-exact__line")];
        expect(all).toHaveLength(
          groups.slice(0, 12).reduce((n, g) => n + g.lanes.reduce((m, l) => m + l.parts.length, 0), 0),
        );
      });
    }
    it(`${organism} names_of_ins_gene: a row per match, every release written and drawn`, () => {
      const matches = (JSON.parse(fixture(organism, "names_of_ins_gene").raw) as NamesResponse).matches;
      const graph = description(organism);
      render(
        <NameMatches
          matches={matches}
          description={graph}
          address={{}}
          empty="none"
          first="name"
          release={null}
          endpoint="GET"
        />,
      );
      const region = screen.getByRole("region", { name: "Matches" });
      const rows = within(region).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(Math.min(matches.length, 40));
      const axis = axisOf(graph.releases);
      matches.slice(0, 40).forEach((m, i) => {
        const row = rows[i];
        if (!row) throw new Error(`no row ${String(i)}`);
        expect(row.textContent).toContain(releaseRanges(m.releases));
        expect(row.textContent).toContain(m.name);
        expect(row.querySelectorAll(".rlane__run")).toHaveLength(runsOf(axis, m.releases).length);
        expect(row.querySelectorAll(".rlane__run--synonym").length > 0).toBe(m.synonym);
      });
    });
  }

  it("counts genes by their id and versions apart, in natural order", () => {
    const m = (gene: string, releases: number[], database = "HGNC Symbol", synonym = false) => ({
      name: "X",
      gene,
      database,
      synonym,
      releases,
    });
    const matches = [
      m("ENSG00000000002.10", [70, 71]),
      m("ENSG00000000002.4", [60, 61]),
      m("ENSG00000000002.11", [72], "HGNC Symbol", true),
      m("ENSG00000000001.1", [50, 51, 52]),
    ];
    expect(nameCounts(matches)).toMatchObject({ genes: 2, versions: 4, attachments: 4, synonyms: 1 });
    const groups = groupByGene(matches);
    expect(groups.map((g) => g.gene)).toEqual(["ENSG00000000001", "ENSG00000000002"]);
    expect(groups[1]?.versions).toEqual(["ENSG00000000002.4", "ENSG00000000002.10", "ENSG00000000002.11"]);
    expect(groups[1]?.lanes.map((l) => [l.synonym, l.parts.map((p) => p.gene)])).toEqual([
      [false, ["ENSG00000000002.4", "ENSG00000000002.10"]],
      [true, ["ENSG00000000002.11"]],
    ]);
  });

  it("says the absence as the page gives it", () => {
    render(
      <NameMatches
        matches={[]}
        description={description("sus_scrofa")}
        address={{}}
        empty="Nothing here."
        first="gene"
        release={null}
        endpoint="GET"
      />,
    );
    expect(screen.getByText("Nothing here.")).toBeTruthy();
  });
});
