// @vitest-environment jsdom
// A batch held outside its page: asked with every path and again without them when the server will not send them,
// kept for the session once (never again on a later render), asked again by itself only where waiting is the
// remedy, going on while its page is gone; and the rules read from the answer's paths and the names' lanes.
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, UnreachableError, type Answer } from "../src/api/client";
import type { BatchRequest, BatchResponse, ConversionResult, NameMatch } from "../src/api/types";
import { decodeFile } from "../src/lib/batchList";
import { exampleSets, exampleWords } from "../src/lib/batchExamples";
import { batchRun, resetBatchRuns, retryBatch, setBatchAsker, startBatch } from "../src/lib/batchRun";
import { batchRows, crossedOf, eventsWords, filterRows, summaryOf } from "../src/lib/batchTable";
import { useFocusMove } from "../src/lib/focus";
import { groupByGene, turnsOf } from "../src/lib/nameGroups";
import { readVocabulary } from "../src/lib/vocabulary";
import { conversions, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());

const body = (identifiers: string[]): Required<BatchRequest> => ({
  identifiers,
  from_release: null,
  to_release: null,
  final_database: null,
  from_database: null,
  explain: true,
  allow_bridges: true,
  read_copies: true,
});

function answerOf(results: ConversionResult[]): Answer<BatchResponse> {
  const data = { count: results.length, results };
  return { data, raw: JSON.stringify(data), requestId: "r1", serverTiming: "app;dur=1.5" };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const results = (JSON.parse(fixture("sus_scrofa", "batch_json").raw) as BatchResponse).results;

beforeEach(() => {
  resetBatchRuns();
  window.sessionStorage.clear();
});
afterEach(() => {
  setBatchAsker(null);
  vi.useRealTimers();
});

describe("a batch's run", () => {
  it("asks with every path, and is kept for the session once", async () => {
    const asked: BatchRequest[] = [];
    setBatchAsker((_organism, request) => {
      asked.push(request);
      return Promise.resolve(answerOf(results));
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    startBatch("sus_scrofa", { ...body(["A"]), explain: false }, null);
    expect(batchRun("sus_scrofa").run.state).toBe("loading");
    await settle();
    expect(asked[0]?.explain).toBe(true);
    const run = batchRun("sus_scrofa");
    expect(run.run.state).toBe("done");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const writes = () => setItem.mock.calls.filter(([key]) => key.includes("batch.result.sus_scrofa")).length;
    expect(writes()).toBe(1);
    // Reading the run again (any later render) writes nothing more.
    for (let i = 0; i < 5; i++) batchRun("sus_scrofa");
    expect(writes()).toBe(1);
    setItem.mockRestore();
  });

  it("asks again without the paths when the server will not send them, and says so", async () => {
    const asked: boolean[] = [];
    setBatchAsker((_organism, request) => {
      asked.push(request.explain);
      if (request.explain)
        return Promise.reject(
          new ApiError(
            422,
            { code: "response_too_large", message: "The answer has 99 bytes.", request_id: "x" } as never,
            null,
          ),
        );
      return Promise.resolve(answerOf(results));
    });
    startBatch("sus_scrofa", body(["A"]), null);
    await settle();
    await settle();
    expect(asked).toEqual([true, false]);
    const run = batchRun("sus_scrofa");
    expect(run.run.state).toBe("done");
    expect(run.run.state === "done" ? run.run.request.explain : null).toBe(false);
    expect(run.pathsRefused?.code).toBe("response_too_large");
  });

  it("is asked again by itself when the browser is back online, and never otherwise", async () => {
    let calls = 0;
    setBatchAsker(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new UnreachableError("no answer")) : Promise.resolve(answerOf(results));
    });
    startBatch("sus_scrofa", body(["A"]), null);
    await settle();
    expect(batchRun("sus_scrofa").run.state).toBe("failed");
    expect(calls).toBe(1);
    window.dispatchEvent(new Event("online"));
    await settle();
    await settle();
    expect(calls).toBe(2);
    expect(batchRun("sus_scrofa").run.state).toBe("done");
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(calls).toBe(2);
  });

  it("keeps a refusal that is no matter of waiting, until the person asks again", async () => {
    let calls = 0;
    setBatchAsker(() => {
      calls += 1;
      return Promise.reject(
        new ApiError(422, { code: "invalid_request", message: "No.", request_id: "x" } as never, null),
      );
    });
    startBatch("sus_scrofa", body(["A"]), null);
    await settle();
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(calls).toBe(1);
    retryBatch("sus_scrofa");
    await settle();
    expect(calls).toBe(2);
  });

  const refusal = (status: number, code: string, retryAfter: number | null, argument: string | null = null) =>
    new ApiError(status, { code, message: `${code}.`, request_id: "x", argument } as never, retryAfter);

  it("asks a refusal that names its wait again once by itself, then leaves it to the person", async () => {
    vi.useFakeTimers();
    let calls = 0;
    setBatchAsker(() => {
      calls += 1;
      return Promise.reject(refusal(503, "server_busy", 2));
    });
    startBatch("sus_scrofa", body(["A"]), null);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(batchRun("sus_scrofa").retry?.state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    const run = batchRun("sus_scrofa");
    expect(run.run.state).toBe("failed");
    expect(run.retry?.state).toBe("asked");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
  });

  it("asks a rate limit of search seconds again once, never more", async () => {
    vi.useFakeTimers();
    let calls = 0;
    setBatchAsker(() => {
      calls += 1;
      return Promise.reject(refusal(429, "rate_limited", 1));
    });
    startBatch("sus_scrofa", body(["A"]), null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(2);
  });

  it("waits out a refusal for time with the paths still asked, and asks without them only at the person's word", async () => {
    vi.useFakeTimers();
    const asked: boolean[] = [];
    setBatchAsker((_organism, request) => {
      asked.push(request.explain);
      if (asked.length < 3) return Promise.reject(refusal(503, "request_budget_exceeded", 1));
      return Promise.resolve(answerOf(results));
    });
    startBatch("sus_scrofa", body(["A"]), null);
    await vi.advanceTimersByTimeAsync(0);
    // No second request at once: the refusal is about time, not the paths.
    expect(asked).toEqual([true]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(asked).toEqual([true, true]);
    expect(batchRun("sus_scrofa").run.state).toBe("failed");
    retryBatch("sus_scrofa", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([true, true, false]);
    const run = batchRun("sus_scrofa");
    expect(run.run.state).toBe("done");
    expect(run.pathsRefused).toEqual({
      code: "request_budget_exceeded",
      message: "request_budget_exceeded.",
      chosen: true,
    });
  });

  it("asks without the paths at once where the refusal names them", async () => {
    const asked: boolean[] = [];
    setBatchAsker((_organism, request) => {
      asked.push(request.explain);
      if (request.explain) return Promise.reject(refusal(503, "request_budget_exceeded", 5, "explain"));
      return Promise.resolve(answerOf(results));
    });
    startBatch("sus_scrofa", body(["A"]), null);
    await settle();
    await settle();
    expect(asked).toEqual([true, false]);
    expect(batchRun("sus_scrofa").pathsRefused?.chosen).toBeUndefined();
  });

  it("asks after a wait only while the tab is shown", async () => {
    vi.useFakeTimers();
    let calls = 0;
    setBatchAsker(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(refusal(503, "server_busy", 1)) : Promise.resolve(answerOf(results));
    });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    startBatch("sus_scrofa", body(["A"]), null);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(1);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(batchRun("sus_scrofa").run.state).toBe("done");
    visibility.mockRestore();
  });

  it("goes on for its organism while another organism's batch runs", async () => {
    const pending: ((a: Answer<BatchResponse>) => void)[] = [];
    setBatchAsker(() => new Promise((resolve) => pending.push(resolve)));
    startBatch("homo_sapiens", body(["A"]), null);
    startBatch("sus_scrofa", body(["B"]), null);
    pending[0]?.(answerOf(results));
    pending[1]?.(answerOf(results));
    await settle();
    expect(batchRun("homo_sapiens").run.state).toBe("done");
    expect(batchRun("sus_scrofa").run.state).toBe("done");
    expect(batchRun("homo_sapiens").seen).toBe(false);
  });
});

describe("a view's move of focus", () => {
  it("is the same function at every render", () => {
    const { result, rerender } = renderHook(() => useFocusMove());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("what the best paths crossed", () => {
  const all = conversions();
  const byName = (name: string) => all.find((c) => c.entry.name === name)?.result;
  it("reads splits, merges, replacements and assembly changes from the steps, in Ensembl's direction", () => {
    const both = byName("convert_step_reason_split_and_merge");
    const replaced = byName("convert_step_reason_replaced");
    const handoff = byName("convert_handoff");
    expect(both && crossedOf(both)?.kinds.has("split")).toBe(true);
    expect(both && crossedOf(both)?.kinds.has("merge")).toBe(true);
    expect(replaced && crossedOf(replaced)?.kinds.has("replaced")).toBe(true);
    expect(handoff && crossedOf(handoff)?.kinds.has("handoff")).toBe(true);
    for (const { result } of all) {
      const crossed = crossedOf(result);
      if (!result.path) expect(crossed).toBeNull();
      for (const e of crossed?.events ?? []) expect(e.old).toBeLessThanOrEqual(e.new);
    }
    expect(both ? eventsWords(crossedOf(both)) : "").toMatch(/split \d+->\d+; merge \d+->\d+/);
  });

  it("counts every row once per kind, and filters by a kind", () => {
    const rows = batchRows(
      all.map((c) => c.result),
      vocabulary,
    );
    const summary = summaryOf(rows);
    expect(summary.paths).toBe(rows.every((r) => !r.result.candidates.length || r.crossed !== null));
    for (const [kind, n] of summary.crossings) {
      expect(filterRows(rows, { statuses: new Set(), crossings: new Set([kind]) })).toHaveLength(n);
    }
    const either = rows.filter(
      (r) => (r.crossed?.kinds.has("split") ?? false) || (r.crossed?.kinds.has("merge") ?? false),
    ).length;
    expect(summary.splitOrMerge).toBe(either);
    for (const [release, n] of summary.eventRows) {
      expect(n).toBe(rows.filter((r) => r.crossed?.events.some((e) => e.new === release)).length);
    }
  });

  it("names the other genes a converted answer leads to, never the best one", () => {
    const rows = batchRows(
      all.map((c) => c.result),
      vocabulary,
    );
    for (const row of rows) {
      for (const gene of row.otherGenes) expect(row.genes).not.toContain(gene);
      const others = new Set(row.result.candidates.filter((c) => !c.best).map((c) => c.gene));
      if (!row.result.no_target) for (const gene of row.otherGenes) expect(others.has(gene)).toBe(true);
    }
  });
});

describe("a name that becomes a synonym", () => {
  const match = (database: string, synonym: boolean, gene: string, releases: number[]): NameMatch => ({
    name: "SEPT9",
    database,
    synonym,
    gene,
    releases,
  });
  it("turns where the name lane ends the release before its synonym lane begins, in one database only", () => {
    const groups = groupByGene([
      match("HGNC Symbol", false, "ENSG1.17", [90, 91, 92, 93, 94, 95, 96, 97]),
      match("HGNC Symbol", true, "ENSG1.18", [98, 99, 100]),
      match("EntrezGene", true, "ENSG1.18", [98, 99]),
      match("UniProt", false, "ENSG1.17", [90, 91]),
      match("UniProt", true, "ENSG1.18", [95, 96]),
    ]);
    const turns = groups.flatMap(turnsOf);
    expect(turns).toEqual([{ database: "HGNC Symbol", release: 98, version: "ENSG1.18" }]);
  });
});

describe("a file's encoding", () => {
  const utf32 = (text: string, little: boolean) => {
    const codes = [0xfeff, ...Array.from(text, (c) => c.codePointAt(0) ?? 0)];
    const view = new DataView(new ArrayBuffer(codes.length * 4));
    codes.forEach((c, i) => view.setUint32(i * 4, c, little));
    return view.buffer;
  };
  it("reads UTF-32 by its mark, before UTF-16's", () => {
    const le = decodeFile(utf32("INS\nTP53\n", true));
    expect(le).toEqual({ ok: true, text: "INS\nTP53\n", encoding: "UTF-32LE" });
    const be = decodeFile(utf32("Ä1", false));
    expect(be).toEqual({ ok: true, text: "Ä1", encoding: "UTF-32BE" });
    const truncated = decodeFile(utf32("INS", true).slice(0, 10));
    expect(truncated.ok).toBe(false);
  });
});

describe("the examples", () => {
  it("are the Convert page's sets with their settings, each of more than one identifier", () => {
    const showcase = {
      organism: "x",
      content_digest: null,
      checked_on: null,
      cases: [],
      journeys: [
        {
          query: { identifier: "A", from_release: 50, to_release: null, final_database: "HGNC Symbol", explain: true },
        },
        {
          query: { identifier: "B", from_release: 50, to_release: null, final_database: "HGNC Symbol", explain: true },
        },
        { query: { identifier: "C", from_release: 60, to_release: null, final_database: null, explain: true } },
        { query: { identifier: "D", from_release: null, to_release: 48, final_database: null, explain: true } },
        { query: { identifier: "E", from_release: null, to_release: 48, final_database: null, explain: true } },
      ],
    } as never;
    const sets = exampleSets(showcase);
    expect(sets.map((s) => s.identifiers)).toEqual([
      ["A", "B"],
      ["D", "E"],
    ]);
    expect(sets[0] ? exampleWords(sets[0], 115) : "").toBe("read at 50 · to 115 · in HGNC Symbol");
    expect(sets[1] ? exampleWords(sets[1], 115) : "").toBe("read where idtrack infers · to 48 · as Ensembl genes");
  });
});
