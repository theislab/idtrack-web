// @vitest-environment jsdom
// Explore's journeys and cases, its matrix and the Method figure, on recorded answers of the real api: each model
// keeps every step of the best answer, in order, with the api's values; the journeys are the showcase's in sets of
// equal parameters, and the release-wide events are counted from them; the facts are the sums of what /organisms
// sent; a case's kind is read from its answer, and its card says the answer's own values; the Method figure states
// every code of the api's vocabulary it names, with the api's meaning.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversionResult, DatabasesResponse, ShowcaseResponse } from "../src/api/types";
import { CaseGallery } from "../src/components/explore/CaseGallery";
import { sketchRows, atOneRelease, genesNotDrawn, sketchWindow } from "../src/lib/explore/sketch";
import { MethodStages } from "../src/components/method/MethodFigure";
import { readMatrix } from "../src/lib/explore/databaseMatrix";
import { runs } from "../src/lib/explore/runs";
import { releaseScale, shortNames } from "../src/components/figure/releases";
import { bestSteps, CASE_KINDS, holdsKind, isHandoff, isRenamedAnswer } from "../src/lib/home/caseKinds";
import { KIND_TEXT } from "../src/lib/home/cases";
import { placeholderOf } from "../src/lib/home/examples";
import { facts } from "../src/lib/explore/facts";
import { figureModel, previousOnLane, shortLabel, type FigureGene } from "../src/lib/explore/figureModel";
import {
  candidateSteps,
  eventWords,
  isEnsembl,
  journeyModel,
  releaseEvents,
  spans,
} from "../src/lib/home/journeyModel";
import {
  bridgesOf,
  journeyList,
  journeySets,
  readDatabases,
  salience,
  sameAnswerGroups,
} from "../src/lib/home/journeys";
import { clearEnds } from "../src/lib/home/rowMarks";
import { caseHref, caseQueryOf } from "../src/lib/home/links";
import {
  apportion,
  chooseJourneys,
  headHeight,
  journeysGeometry,
  NARROW_ROW,
  ROW,
  ROW_MAX,
  setHeight,
  setWords,
} from "../src/lib/home/useJourneys";
import { groupedInteger, releaseRanges } from "../src/lib/numbers";
import { prose } from "../src/lib/values";
import { readVocabulary, spaced } from "../src/lib/vocabulary";
import { OrganismsProvider } from "../src/lib/organisms";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { conversions, description, vocabularyResponse } from "./fixtures";

afterEach(cleanup);

const answers = conversions().map((c) => c.result);
const withPath = answers.filter((r) => r.path && r.candidates.some((c) => c.best));

describe("the figure of one answer", () => {
  it("keeps every step of the best answer, in order, and holds each gene where the walk holds it", () => {
    expect(withPath.length).toBeGreaterThan(50);
    for (const result of withPath) {
      const model = figureModel(result);
      if (!model || result.from_release === null) continue;
      const steps = bestSteps(result);
      expect(model.steps.map((s) => s.step)).toEqual(steps);
      expect(model.steps.map((s) => s.number)).toEqual(steps.map((_, i) => i + 1));
      for (const s of model.steps) {
        expect(s.lo).toBeLessThanOrEqual(s.hi);
        expect(s.handoff).toBe(isHandoff(s.step));
      }
      for (const g of model.genes) {
        expect(g.first).toBeLessThanOrEqual(g.last);
        expect(g.node.kind).toBe("ensembl_gene");
      }
      // Genes on one lane never share a release.
      for (const a of model.genes)
        for (const b of model.genes)
          if (a !== b && a.lane === b.lane) expect(a.last < b.first || b.last < a.first).toBe(true);
      expect(model.span[0]).toBeLessThanOrEqual(Math.min(result.from_release, result.to_release));
      expect(model.span[1]).toBeGreaterThanOrEqual(Math.max(result.from_release, result.to_release));
    }
  });

  it("reads a label against the gene before it on its own lane, not the path's previous gene", () => {
    // A bridge's path: 040178.2 -> 040178.1 (lane 0), then through an id to 001079.2 -> 001079.1 on lane 1 at
    // earlier releases; walked back in time, the path's order is not the lanes'.
    const gene = (id: string, first: number, last: number, lane: number, order: number): FigureGene => ({
      node: { id } as FigureGene["node"],
      first,
      last,
      lane,
      order,
    });
    const genes = [
      gene("ENSSSCG00000040178.2", 98, 106, 0, 0),
      gene("ENSSSCG00000040178.1", 90, 97, 0, 1),
      gene("ENSSSCG00000001079.2", 67, 89, 1, 2),
      gene("ENSSSCG00000001079.1", 56, 66, 0, 3),
    ];
    expect(previousOnLane(genes, 3)).toBeNull();
    expect(previousOnLane(genes, 0)?.node.id).toBe("ENSSSCG00000040178.1");
    const label = (i: number) => shortLabel(genes[i]?.node.id ?? "", previousOnLane(genes, i)?.node.id ?? null);
    expect(label(3)).toBe("ENSSSCG00000001079.1");
    expect(label(0)).toBe(".2");
  });

  it("shortens a label to the version only beside the same stable id", () => {
    expect(shortLabel("ENSG00000141510.6", "ENSG00000141510.5")).toBe(".6");
    expect(shortLabel("ENSG00000062716.8", "ENSG00000199004.1")).toBe("ENSG00000062716.8");
    expect(shortLabel("ENSG00000141510.5", null)).toBe("ENSG00000141510.5");
  });
});

describe("the journeys", () => {
  it("draw every step of the best answer and leave Ensembl only for external databases", () => {
    for (const result of withPath) {
      const model = journeyModel(result);
      if (!model || result.from_release === null) continue;
      expect(model.marks.map((m) => m.step)).toEqual(bestSteps(result));
      for (const c of model.crossings) for (const d of c.databases) expect(isEnsembl(d)).toBe(false);
      const read = model.crossings.find((c) => c.role === "read");
      expect(read?.databases ?? []).toEqual(result.from_databases.filter((d) => !isEnsembl(d)));
      const answered = model.crossings.find((c) => c.role === "answer");
      if (answered) expect(answered.databases).toEqual([result.final_database]);
      expect(model.lo).toBeLessThanOrEqual(Math.min(result.from_release, result.to_release));
      expect(model.hi).toBeGreaterThanOrEqual(Math.max(result.from_release, result.to_release));
      for (const m of model.marks) {
        expect(m.at).toBeGreaterThanOrEqual(model.lo);
        expect(m.at).toBeLessThanOrEqual(model.hi);
      }
    }
  });

  it("are the showcase's, in sets of consecutive equal parameters, one row each", () => {
    const showcase = showcaseOf(withPath.slice(0, 30));
    const sets = journeySets(showcase);
    const list = journeyList(sets);
    expect(list.map((j) => j.identifier)).toEqual(showcase.journeys.map((j) => j.query.identifier));
    for (const [i, set] of sets.entries()) {
      for (const j of set.journeys) {
        expect(j.set).toBe(i);
        const q = showcase.journeys.find((x) => x.result === j.result)?.query;
        expect([q?.from_release ?? null, q?.to_release ?? null, q?.final_database ?? null]).toEqual([
          set.from,
          set.to,
          set.db,
        ]);
      }
      if (i > 0) {
        const prev = sets[i - 1];
        expect(prev && [prev.from, prev.to, prev.db]).not.toEqual([set.from, set.to, set.db]);
      }
    }
    for (const narrow of [false, true]) {
      const g = journeysGeometry({
        sets: sets.map((x) => x.journeys.length),
        setLines: sets.map(() => 1),
        events: 3,
        narrow,
        gutters: [120, 120],
        fit: 900,
      });
      for (let j = 1; j < list.length; j++) expect(g.rowTop(j)).toBeGreaterThan(g.rowTop(j - 1));
      // Each set's words stand above its block: no row of another set reaches into them.
      for (let s = 0; s < sets.length; s++) {
        expect(g.blockTop(s)).toBeGreaterThan(g.setBaseline(s));
        if (s > 0) expect(g.setTop(s)).toBeGreaterThanOrEqual(g.blockBottom(s - 1));
      }
      expect(g.height).toBeGreaterThan(g.blockBottom(sets.length - 1));
      expect(g.row).toBe(narrow ? NARROW_ROW : g.row);
    }
  });

  it("draw fewer journeys where the room is short, never fewer names: the rows chosen by the one rule", () => {
    const sets = journeySets(showcaseOf(withPath.slice(0, 40)));
    const all = journeyList(sets);
    const lines = sets.map(() => 1);
    const cost = { head: headHeight(3), set: (s: number) => setHeight(lines[s] ?? 1), row: ROW };
    for (const room of [180, 300, 420, 560, 700, 900, 1200, 2400]) {
      const chosen = chooseJourneys(sets, room, cost);
      const drawn = journeyList(chosen);
      // A prefix of the sets, each with at least one row, each row one of its set's journeys, in the set's order.
      expect(chosen.length).toBeGreaterThan(0);
      for (const [s, set] of chosen.entries()) {
        expect(set.journeys.length).toBeGreaterThan(0);
        const order = set.journeys.map((j) => sets[s]?.journeys.indexOf(j) ?? -1);
        expect(order.every((k, i) => k >= 0 && (i === 0 || k > (order[i - 1] ?? -1)))).toBe(true);
        // The ones left out of a set are no more telling than the ones drawn.
        const left = (sets[s]?.journeys ?? []).filter((j) => !set.journeys.includes(j));
        const worstDrawn = Math.max(...set.journeys.map(salience));
        for (const j of left) expect(salience(j)).toBeGreaterThanOrEqual(worstDrawn);
      }
      // They fit the room at the least named pitch, where at least one row of one set does.
      const g = journeysGeometry({
        sets: chosen.map((x) => x.journeys.length),
        setLines: chosen.map(() => 1),
        events: 3,
        narrow: false,
        gutters: [120, 120],
        fit: room,
      });
      if (drawn.length > 1) expect(g.height).toBeLessThanOrEqual(room);
      expect(g.row).toBeGreaterThanOrEqual(ROW);
      expect(g.row).toBeLessThanOrEqual(ROW_MAX);
      if (room >= 2400) expect(drawn.length).toBe(all.length);
    }
  });

  it("share the rows among the sets in proportion to their sizes, two at least (all of a smaller set)", () => {
    expect(apportion([10, 4, 3, 4, 2], 12)).toEqual([4, 2, 2, 2, 2]);
    expect(apportion([10, 4, 3, 4, 2], 16)).toEqual([7, 3, 2, 2, 2]);
    expect(apportion([10, 4, 3, 4, 2], 23)).toEqual([10, 4, 3, 4, 2]);
    expect(apportion([20, 1, 1], 4)).toEqual([2, 1, 1]);
    expect(apportion([5, 5], 4)).toEqual([2, 2]);
    for (const rows of [10, 11, 13, 16, 20])
      expect(apportion([10, 4, 3, 4, 2], rows).reduce((t, n) => t + n, 0)).toBe(rows);
  });

  it("join rows of one set whose answers are the same gene", () => {
    const sets = journeySets(showcaseOf(withPath.slice(0, 40)));
    for (const [a, b] of sameAnswerGroups(journeyList(sets))) {
      const list = journeyList(sets);
      expect(b).toBeGreaterThan(a);
      const key = (k: number) => [...new Set(list[k]?.model?.best.map((c) => c.target))].sort().join();
      for (let k = a; k <= b; k++) {
        expect(key(k)).toBe(key(a));
        expect(list[k]?.set).toBe(list[a]?.set);
      }
    }
  });

  it("name the databases every journey of a set is read in, and the bridges a journey passes through", () => {
    const sets = journeySets(showcaseOf(withPath));
    for (const set of sets) {
      const read = readDatabases(set);
      for (const j of set.journeys) for (const d of read) expect(j.result?.from_databases).toContain(d);
      for (const d of read) expect(isEnsembl(d)).toBe(false);
      for (const j of set.journeys)
        expect(bridgesOf(j).length).toBe(j.model?.marks.filter((m) => m.step.kind === "bridge_near").length ?? 0);
    }
  });

  it("keep a row's start and end marks clear of its steps' glyphs, moved outward", () => {
    expect(clearEnds(100, 300, [103, 200], 9)).toEqual({ start: 94, end: 300 });
    expect(clearEnds(100, 300, [200, 296], 9)).toEqual({ start: 100, end: 305 });
    // A journey back in time: the start is on the right, moved right; the end on the left, moved left.
    expect(clearEnds(300, 100, [297, 104], 9)).toEqual({ start: 306, end: 95 });
    // A chain of glyphs: the mark moves past each it would touch.
    expect(clearEnds(100, 300, [104, 96], 9).start).toBe(87);
    const { start, end } = clearEnds(50, 400, [55, 60, 395], 9);
    for (const m of [55, 60, 395]) {
      expect(Math.abs(m - start)).toBeGreaterThanOrEqual(9);
      expect(Math.abs(m - end)).toBeGreaterThanOrEqual(9);
    }
  });

  it("mark a short assembly name as one, never a bare number", () => {
    const short = shortNames(["Sscrofa9", "Sscrofa10.2", "Sscrofa11.1"]);
    expect(short.get("Sscrofa9")).toBe("S…9");
    expect(short.get("Sscrofa11.1")).toBe("S…11.1");
    expect(shortNames(["Macaca_fascicularis_5.0", "Macaca_fascicularis_6.0"]).get("Macaca_fascicularis_5.0")).toBe(
      "Mf…5.0",
    );
    expect(shortNames(["NCBI36", "GRCh37", "GRCh38"]).get("NCBI36")).toBe("NCBI36");
  });

  it("say where many of them step at one release, counted from their steps", () => {
    const models = withPath.flatMap((r) => {
      const m = journeyModel(r);
      return m ? [m] : [];
    });
    const events = releaseEvents(models, 0.05);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.of).toBe(models.length);
      expect(e.journeys).toBeGreaterThanOrEqual(Math.max(3, Math.ceil(0.05 * models.length)));
      const by = models.filter((m) =>
        m.marks.some(
          (mk) =>
            (mk.step.kind === "history" || mk.step.kind === "self_loop") &&
            Math.min(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.old &&
            Math.max(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.new &&
            (e.kind === "handoff"
              ? mk.kind === "handoff"
              : e.kind === "loop"
                ? mk.kind === "loop"
                : mk.kind === "version"),
        ),
      );
      expect(by.length).toBeGreaterThanOrEqual(e.journeys);
    }
    for (let i = 1; i < events.length; i++)
      expect(events[i - 1]?.journeys).toBeGreaterThanOrEqual(events[i]?.journeys ?? 0);
    // Each is counted among the journeys across it (those that span its two releases), and its words say so.
    for (const e of events) {
      expect(e.across).toBe(models.filter((m) => spans(m, e.old, e.new)).length);
      expect(e.across).toBeGreaterThanOrEqual(e.journeys);
      const words = eventWords(e, (key) => `A${key}`);
      expect(words.line).toContain(`${e.old}→${e.new}`);
      expect(words.line).toContain(
        e.journeys === e.across
          ? `all ${e.across} journeys across it`
          : `${e.journeys} of the ${e.across} journeys across it`,
      );
      // The two lines are the one line's words, split after what happened.
      expect(words.lines.join(" ").replace(/ · /g, " ")).toBe(words.line.replace(/ · /g, " "));
    }
  });

  it("name each set by the parameters its request sends, the defaults by the api's rule", () => {
    expect(setWords({ from: 48, to: null, db: "HGNC Symbol" }, 115, ["HGNC Symbol"])).toBe(
      "HGNC Symbol at 48 → HGNC Symbol at 115",
    );
    expect(setWords({ from: null, to: 48, db: null }, 115, [], true)).toBe(
      "Ensembl ids at the release idtrack infers → back to Ensembl gene at 48",
    );
    expect(setWords({ from: 101, to: 48, db: null }, 115)).toBe("Ensembl ids at 101 → back to Ensembl gene at 48");
  });
});

describe("the hero's examples", () => {
  it("hint the identifier field with the graph's own examples, shortest first, as many as fit", () => {
    const ex = (identifier: string) => ({
      kind: "renamed" as const,
      title: "A renamed gene",
      query: { organism: "o", identifier },
      from: 50,
      to: 115,
    });
    expect(placeholderOf([ex("ENSG00000141510.5"), ex("SEPT9"), ex("ENSG00000277780.1")])).toBe("e.g. SEPT9");
    expect(placeholderOf([ex("ENSMUSG00000059552"), ex("Sept9"), ex("Ins2")])).toBe("e.g. Ins2 or Sept9");
    expect(placeholderOf([ex("ENSG00000141510.5")], 40)).toBe("e.g. ENSG00000141510.5");
    expect(placeholderOf([])).toBe("a gene id, symbol or accession");
  });
});

describe("the kinds of the cases", () => {
  it("are read from the answer's own fields", () => {
    for (const result of answers) {
      expect(holdsKind("tie", result)).toBe(result.status === "tie" && result.tie);
      const reasons = new Set(bestSteps(result).map((s) => s.reason));
      expect(holdsKind("merge", result)).toBe(reasons.has("merge") && result.candidates.some((c) => c.best));
      expect(holdsKind("handoff", result)).toBe(bestSteps(result).some(isHandoff));
      expect(holdsKind("bridge", result)).toBe(reasons.has("bridge_near") && reasons.has("bridge_far"));
      expect(holdsKind("renamed", result)).toBe(reasons.has("final") && isRenamedAnswer(result));
      expect(holdsKind("retired", result)).toBe(
        result.status === "no_conversion" && result.reasons.includes("no_path_to_target"),
      );
      expect(holdsKind("refused", result)).toBe(
        (result.path?.refused ?? []).some((s) => s.reason === "mitochondrial_genome"),
      );
    }
  });

  it("each have a title, a concept and the page of idtrack's documentation that states it", () => {
    for (const kind of CASE_KINDS) {
      const text = KIND_TEXT[kind];
      expect(text.title.length).toBeGreaterThan(3);
      // The concept says more than its title (no "a split." for a split).
      expect(text.concept.length).toBeGreaterThan(60);
      expect(text.concept.toLowerCase()).not.toBe(`${text.title.toLowerCase()}.`);
      expect(text.href).toMatch(/^[a-z_]+\.html(#[a-z-]+)?$/);
    }
  });

  it("open the address of their query", () => {
    const query = caseQueryOf("homo_sapiens", {
      identifier: "SEPT9",
      from_release: 50,
      to_release: null,
      final_database: "HGNC Symbol",
      explain: true,
    });
    const url = new URL(caseHref(query), "http://local");
    expect(url.searchParams.get("organism")).toBe("homo_sapiens");
    expect(url.searchParams.get("id")).toBe("SEPT9");
    expect(url.searchParams.get("from")).toBe("50");
    expect(url.searchParams.get("db")).toBe("HGNC Symbol");
    expect(url.searchParams.get("to")).toBeNull();
  });

  it("are drawn from the best answer, the other genes from where their paths leave it", () => {
    for (const result of withPath) {
      const rows = sketchRows(result);
      const best = result.candidates.findIndex((c) => c.best);
      expect(rows[0]?.candidate).toBe(best);
      expect(rows.length).toBeLessThanOrEqual(3);
      const bestPath = candidateSteps(result, candidateAt(result, best));
      for (const row of rows.slice(1)) {
        const own = candidateSteps(result, candidateAt(result, row.candidate));
        expect(own.slice(0, row.from)).toEqual(bestPath.slice(0, row.from));
        if (row.from < own.length && row.from < bestPath.length) expect(own[row.from]).not.toBe(bestPath[row.from]);
      }
    }
  });

  it("draw a case on its stretch of the axis, with how many genes are not drawn", () => {
    const releases = Array.from({ length: 68 }, (_, i) => 48 + i);
    for (const result of withPath) {
      const window = sketchWindow(result, releases);
      expect(window.length).toBeGreaterThanOrEqual(14);
      for (const r of [result.from_release, result.to_release]) if (r !== null && r >= 48) expect(window).toContain(r);
      const drawn = new Set(sketchRows(result).map((r) => result.candidates[r.candidate]?.gene));
      expect(genesNotDrawn(result)).toBe(
        new Set(result.candidates.map((c) => c.gene).filter((g) => !drawn.has(g))).size,
      );
      if (atOneRelease(result)) expect(result.from_release).toBe(result.to_release);
    }
  });

  it("say the answer's own values on their card", async () => {
    const tie = answers.find((r) => holdsKind("tie", r) && r.path);
    expect(tie).toBeDefined();
    if (!tie) return;
    render(
      <VocabularyContext.Provider value={readVocabulary(vocabularyResponse())}>
        <CaseGallery
          graph={description(organismOf(tie))}
          cases={[{ kind: "tie", query: queryOf(tie), result: tie, error: null }]}
        />
      </VocabularyContext.Provider>,
    );
    // The cards are drawn once what changes their words has come (here: requests that fail at once).
    expect(await screen.findByRole("link", { name: /A tie, not a guess/ }, { timeout: 4000 })).toBeTruthy();
    const card = document.querySelector(".case");
    // On its surface: the kind, the identifier and its releases; the concept and the values in its hover card.
    expect(card?.querySelector(".case__line")?.textContent).toContain(tie.query_id);
    expect(card?.textContent).not.toContain(KIND_TEXT.tie.concept);
    fireEvent.click(screen.getByRole("button", { name: /^About this case: a tie, not a guess/ }));
    for (const target of new Set(
      tie.candidates
        .filter((c) => c.best)
        .slice(0, 2)
        .map((c) => c.target),
    ))
      expect(card?.textContent).toContain(target);
    expect(card?.textContent).toContain(KIND_TEXT.tie.concept);
    // The small figure is drawn once the page has painted what comes first.
    await waitFor(() => {
      expect(document.querySelector(".case-sketch svg[role=img]")?.getAttribute("aria-label")).toContain(tie.query_id);
    });
  });
});

function candidateAt(result: ConversionResult, i: number) {
  const c = result.candidates[i];
  if (!c) throw new Error(`no candidate ${i}`);
  return c;
}

/** A showcase of recorded answers, each as a journey with the query that gives its parameters. */
function showcaseOf(results: readonly ConversionResult[]): ShowcaseResponse {
  return {
    organism: "homo_sapiens",
    content_digest: null,
    checked_on: null,
    journeys: results.map((r) => ({ query: queryOf(r), result: r, error: null })),
    cases: [],
  };
}

function queryOf(r: ConversionResult) {
  return {
    identifier: r.query_id,
    from_release: r.from_release,
    to_release: r.to_release,
    final_database: r.final_database,
    explain: true,
  };
}

function organismOf(r: ConversionResult): string {
  return conversions().find((c) => JSON.stringify(c.result) === JSON.stringify(r))?.entry.organism ?? "homo_sapiens";
}

describe("the facts of the server", () => {
  it("are the sums of the counts /organisms sent", () => {
    const graphs = ["homo_sapiens", "sus_scrofa"].map(description);
    const shown = new Map(facts(graphs).map((f) => [f.key, f.value]));
    for (const key of ["nodes", "history_edges", "cross_reference_edges"]) {
      const total = graphs.reduce((t, g) => t + (g.counts[key] ?? 0), 0);
      expect(shown.get(key)).toBe(groupedInteger(total));
    }
    expect(shown.get("graphs")).toBe("2");
    expect(shown.get("assemblies")).toBe(String(graphs.reduce((t, g) => t + g.assemblies.length, 0)));
    expect(shown.get("databases")).toBe(String(new Set(graphs.flatMap((g) => g.external_databases)).size));
    const releases = [...new Set(graphs.flatMap((g) => g.releases))].sort((a, b) => a - b);
    expect(shown.get("releases")).toBe(releaseRanges(releases));
  });
});

describe("Explore", () => {
  // What each database holds (`kind` and the rest of a row of GET /organisms/{organism}/databases).
  const accession = {
    kind: "accession" as const,
    versioned: null,
    authority: false,
    labels: null,
    labels_of: [],
    former_names: [],
  };
  const ensembl = {
    kind: "ensembl" as const,
    versioned: true,
    authority: false,
    labels: null,
    labels_of: [],
    former_names: [],
  };
  it("lists the databases of some releases first, then those of every release (Ensembl's own first)", () => {
    const data: DatabasesResponse = {
      organism: "sus_scrofa",
      releases: [56, 57],
      databases: [
        { name: "EntrezGene", form: "gene", releases: [56], ...accession },
        { name: "base_ensembl_gene", form: null, releases: [56, 57], ...ensembl, versioned: false },
        { name: "ensembl_gene", form: null, releases: [56, 57], ...ensembl },
      ],
      by_assembly: {},
      symbol_databases: ["VGNC Symbol", "HGNC Symbol"],
    };
    expect(readMatrix(data).databases.map((d) => d.name)).toEqual(["EntrezGene", "ensembl_gene", "base_ensembl_gene"]);
    expect(readMatrix(data).partial).toBe(1);
    expect(readMatrix(data).source).toBe("/api/v1/organisms/sus_scrofa/databases");
  });

  it("draws releases as runs and as equal columns", () => {
    expect(runs([60, 56, 57, 58])).toEqual([
      [56, 58],
      [60, 60],
    ]);
    const scale = releaseScale(
      Array.from({ length: 68 }, (_, i) => 48 + i),
      0,
      680,
    );
    expect(scale.step).toBe(10);
    expect(scale.x(47.5)).toBe(0);
    expect(scale.x(115.5)).toBe(680);
  });
});

describe("the Method figure", () => {
  it("states every code it names with the api's meaning, criteria in the api's order", () => {
    const vocabulary = readVocabulary(vocabularyResponse());
    render(
      <OrganismsProvider>
        <VocabularyContext.Provider value={vocabulary}>
          <MethodStages />
        </VocabularyContext.Provider>
      </OrganismsProvider>,
    );
    // One stage at a time: each tab chosen in turn, every folded row of its panel opened, the words gathered.
    let text = "";
    let order: (string | null)[] = [];
    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      for (const row of screen.getByRole("tabpanel").querySelectorAll<HTMLElement>('button[aria-expanded="false"]'))
        if (row.classList.contains("expandable__summary")) fireEvent.click(row);
      text += document.body.textContent;
      const ladder = screen.queryByRole("list", { name: "The criteria, in the order they decide" });
      if (ladder)
        order = [...ladder.querySelectorAll(".method-ladder__body .method-code")].map((e) => e.textContent);
    }
    const plain = (t: string) => prose(t).replace(/`/g, "");
    for (const [code, meaning] of [
      ...vocabulary.matchSteps,
      ...vocabulary.matchPrefixes,
      ...vocabulary.readingReasons,
      ...vocabulary.placeRelations,
    ]) {
      expect(text).toContain(spaced(code));
      if (meaning) expect(text).toContain(plain(meaning));
    }
    for (const [code, rule] of vocabulary.bridgeRules) {
      expect(text).toContain(spaced(code));
      if (rule.meaning) expect(text).toContain(plain(rule.meaning));
    }
    for (const code of [
      "new_version",
      "replaced",
      "self_loop",
      "split",
      "merge",
      "split_and_merge",
      "bridge_near",
      "bridge_far",
      "final",
      "final_other_release",
      "identity",
      "mitochondrial_genome",
    ]) {
      const meaning = vocabulary.stepReasons.get(code);
      expect(meaning).toBeTruthy();
      expect(text).toContain(plain(meaning ?? ""));
    }
    for (const [, meaning] of vocabulary.statuses) if (meaning) expect(text).toContain(plain(meaning));
    expect(order).toEqual(vocabulary.criteria.map((c) => spaced(c.code)));
  });

  it("says so when the vocabulary could not be read", () => {
    render(
      <OrganismsProvider>
        <MethodStages />
      </OrganismsProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("could not be read");
  });
});
