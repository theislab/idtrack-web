// @vitest-environment jsdom
// The shell's rules: every answer is checked against its endpoint's shape; answers are shared and held, and a request
// is cancelled only when no view waits for it; the routes are decided from the path; what was typed is kept; a part
// that fails is stated in its place and can be asked for again; a failed read recovers by itself where waiting helps.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Suspense } from "react";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, forgetAnswers, heldAnswers, UnexpectedAnswerError, UnreachableError } from "../src/api/client";
import { shapeProblem, type Shape } from "../src/api/shape";
import { RESPONSES, SCHEMAS } from "../src/api/shapes";
import type { ConversionResult } from "../src/api/types";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { ErrorPanel } from "../src/components/ErrorPanel";
import { Link } from "../src/components/ui";
import { NO_VOCABULARY } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { useWidth } from "../src/components/figure/useWidth";
import { decodeFile, linesWithControls, normalizeLines, parseList } from "../src/lib/batchList";
import { isChunkError } from "../src/lib/chunks";
import { draftOver, isText, keepDraftOver, readDraft, writeDraft } from "../src/lib/drafts";
import { lazyPart } from "../src/lib/lazyPart";
import { batchSentence, conversionSentence, conversionTitle } from "../src/lib/outcomes";
import { refusedArguments } from "../src/lib/refusals";
import { routeOf } from "../src/lib/routes";
import { fromShowcase } from "../src/lib/showcase";
import { useRequest } from "../src/lib/useRequest";
import { OrganismsProvider, useOrganisms } from "../src/lib/organisms";
import { description, fixture, ORGANISMS, recorded } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  forgetAnswers();
});

/** The endpoint of a recorded request, as the document names it. */
function endpointOf(method: string, path: string): string {
  const short = path.replace(/^\/api\/v1/, "").replace(/^\/organisms\/[^/]+/, "/organisms/{organism}");
  return `${method} ${short || "/"}`;
}

describe("the shape of every answer", () => {
  const answers = ORGANISMS.flatMap((organism) =>
    recorded(organism).filter((e) => e.status === 200 && e.file.endsWith(".json")),
  );

  it("is given for every endpoint of the document that answers JSON", () => {
    const document = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "api", "openapi.json"), "utf8")) as {
      paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, unknown> }> }>>;
    };
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!operation.responses["200"]?.content?.["application/json"]) continue;
        expect(RESPONSES[endpointOf(method.toUpperCase(), path)], `${method} ${path}`).toBeDefined();
      }
    }
  });

  it("holds for every answer the api gave when it was recorded", () => {
    expect(answers.length).toBeGreaterThan(100);
    for (const entry of answers) {
      const shape = RESPONSES[endpointOf(entry.method, entry.path)];
      if (!shape) continue;
      expect(shapeProblem(JSON.parse(entry.raw), shape), `${entry.organism}/${entry.name}`).toBeNull();
    }
  });

  it("names the first place where an answer departs from it", () => {
    const convert = RESPONSES["GET /organisms/{organism}/convert"] ?? "any";
    const result = JSON.parse(recorded("sus_scrofa").find((e) => e.name === "convert_candidates_5")?.raw ?? "{}") as {
      candidates: Record<string, unknown>[];
    };
    expect(shapeProblem({}, convert)).toBe("the answer has no field query_id");
    const broken = structuredClone(result);
    broken.candidates[1] = { ...broken.candidates[1], score: "high" };
    expect(shapeProblem(broken, convert)).toMatch(/^candidates\[1\]\.score is a string, not a number/);
    expect(shapeProblem({ organisms: null }, RESPONSES["GET /organisms"] ?? "any")).toBe(
      "organisms is null, not a list",
    );
  });

  it("allows fields the document does not name yet, and any value of a code", () => {
    const shape: Shape = { o: { status: "string" } };
    expect(shapeProblem({ status: "a_new_status", added: [1, 2] }, shape)).toBeNull();
  });

  it("checks a list of fixed length, a map and a nullable field", () => {
    expect(shapeProblem([1, null], { t: ["integer", { u: ["integer", "null"] }] })).toBeNull();
    expect(shapeProblem([1], { t: ["integer", "integer"] })).toBe("the answer has 1 items, not 2");
    expect(shapeProblem({ a: 1, b: "x" }, { m: "integer" })).toBe("b is a string, not an integer");
    expect(shapeProblem(1.5, "integer")).toBe("the answer is a number, not an integer");
    expect(Object.keys(SCHEMAS)).toContain("ConversionResult");
  });
});

function respond(body: string, headers: Record<string, string> = {}, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", "x-request-id": "rid", ...headers },
  });
}

describe("the client", () => {
  const organisms = JSON.stringify({ organisms: [description("sus_scrofa")] });

  it("refuses an answer of another form as an answer the page cannot read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(respond('{"organisms": null}'))),
    );
    const error = (await api.organisms().catch((e: unknown) => e)) as UnexpectedAnswerError;
    expect(error).toBeInstanceOf(UnexpectedAnswerError);
    expect(error.message).toContain("GET /organisms");
    expect(error.message).toContain("organisms is null, not a list");
    expect(error.requestId).toBe("rid");
  });

  it("asks once for an answer two views need at once, and holds it", async () => {
    const fetch = vi.fn(() => Promise.resolve(respond(organisms)));
    vi.stubGlobal("fetch", fetch);
    const [a, b] = await Promise.all([api.organisms(), api.organisms()]);
    expect(a.raw).toBe(b.raw);
    await api.organisms();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(heldAnswers()).toBe(1);
    await api.organisms({ fresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a shared request only when every view that waited has gone", async () => {
    const signals: AbortSignal[] = [];
    let answer: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        if (init.signal) signals.push(init.signal);
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      }),
    );
    const first = new AbortController();
    const second = new AbortController();
    const a = api.organisms(first.signal);
    const b = api.organisms(second.signal);
    first.abort();
    await expect(a).rejects.toThrow();
    expect(signals[0]?.aborted).toBe(false);
    answer(respond(organisms));
    await expect(b).resolves.toMatchObject({ requestId: "rid" });
    const third = new AbortController();
    forgetAnswers();
    const c = api.organisms(third.signal);
    third.abort();
    await expect(c).rejects.toThrow();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("does not hold a failure, nor a conversion that ended in an error of its own", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respond('{"error":{"code":"internal_error","message":"x","request_id":"r"}}', {}, 500))
      .mockResolvedValue(respond(organisms));
    vi.stubGlobal("fetch", fetch);
    await expect(api.organisms()).rejects.toBeInstanceOf(ApiError);
    await api.organisms();
    expect(fetch).toHaveBeenCalledTimes(2);
    const erred = JSON.parse(
      recorded("sus_scrofa").find((e) => e.path.endsWith("/convert") && e.status === 200)?.raw ?? "{}",
    ) as ConversionResult;
    const fetch2 = vi.fn(() => Promise.resolve(respond(JSON.stringify({ ...erred, status: "error" }))));
    vi.stubGlobal("fetch", fetch2);
    await api.convert("sus_scrofa", { identifier: "X" });
    await api.convert("sus_scrofa", { identifier: "X" });
    expect(fetch2).toHaveBeenCalledTimes(2);
  });

  it("says when the browser is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const error = (await api.health().catch((e: unknown) => e)) as UnreachableError;
    expect(error).toBeInstanceOf(UnreachableError);
    expect(error.offline).toBe(true);
  });

  it("names the arguments a refusal refused, from its argument and its details", () => {
    const error = new ApiError(
      400,
      {
        code: "invalid_request",
        message: "x",
        argument: null,
        allowed: null,
        details: [{ location: ["query", "to_release"], message: "Input should be greater than or equal to 1" }],
        request_id: "r",
      },
      null,
    );
    expect(refusedArguments(error)).toEqual(["to_release"]);
    expect(refusedArguments(new UnreachableError("x"))).toEqual([]);
  });
});

describe("the routes", () => {
  it("are decided from the path alone", () => {
    expect(routeOf("/").page).toBe("home");
    expect(routeOf("/convert").page).toBe("convert");
    expect(routeOf("/method")).toMatchObject({ page: "method" });
    expect(routeOf("/organisms/sus_scrofa")).toMatchObject({ page: "organism", organism: "sus_scrofa" });
    expect(routeOf("/organisms/")).toMatchObject({ page: "redirect", to: "/organisms" });
    expect(routeOf("/batch/")).toMatchObject({ page: "redirect", to: "/batch" });
    expect(routeOf("/organisms/sus_scrofa/extra").page).toBe("none");
    expect(routeOf("/no-such-page").page).toBe("none");
    expect(routeOf("/organisms/%E0%A4%A").page).toBe("none");
  });
});

describe("what was typed", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("is kept over the same value of the address and dropped for a new one", () => {
    keepDraftOver("t.id", "INS", "BRCA2");
    expect(draftOver("t.id", "INS")).toBe("BRCA2");
    expect(draftOver("t.id", "TP53")).toBe("TP53");
    keepDraftOver("t.id", "INS", "INS");
    expect(draftOver("t.id", "INS")).toBe("INS");
  });

  it("is read only in the form it was kept in", () => {
    writeDraft("t.list", ["not", "text"]);
    expect(readDraft("t.list", isText)).toBeUndefined();
    writeDraft("t.list", "INS\nTP53");
    expect(readDraft("t.list", isText)).toBe("INS\nTP53");
  });
});

describe("a list of identifiers", () => {
  it("splits at every common line ending, as the field shows it", () => {
    expect(parseList("INS\rTP53\r\nBRCA2\nPDX1 MYC\u0085EGFR")).toEqual([
      "INS",
      "TP53",
      "BRCA2",
      "PDX1",
      "MYC",
      "EGFR",
    ]);
    expect(normalizeLines("A\rB\r\nC")).toBe("A\nB\nC");
    expect(linesWithControls(["INS", "TP\u000053", "BRCA2\u0007"])).toEqual([2, 3]);
  });

  it("reads a file by its bytes: UTF-8, UTF-16 with or without a mark, else Windows-1252; refuses a spreadsheet", () => {
    const bytes = (values: number[]) => new Uint8Array(values).buffer;
    expect(decodeFile(new TextEncoder().encode("INS\nCAFÉ").buffer)).toEqual({
      ok: true,
      text: "INS\nCAFÉ",
      encoding: "UTF-8",
    });
    expect(decodeFile(bytes([0x43, 0x41, 0x46, 0xc9]))).toEqual({ ok: true, text: "CAFÉ", encoding: "windows-1252" });
    expect(decodeFile(bytes([0xff, 0xfe, 0x49, 0, 0x4e, 0, 0x53, 0]))).toMatchObject({
      text: "INS",
      encoding: "UTF-16LE",
    });
    expect(decodeFile(bytes([0, 0x49, 0, 0x4e, 0, 0x53, 0, 0x0a]))).toMatchObject({
      text: "INS\n",
      encoding: "UTF-16BE",
    });
    expect(decodeFile(bytes([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toMatchObject({ ok: false });
    expect(decodeFile(bytes([0x49, 0x4e, 0x53, 0, 0x0a]))).toMatchObject({ ok: false });
  });
});

describe("an outcome in one sentence", () => {
  const results = ORGANISMS.flatMap((organism) =>
    recorded(organism)
      .filter((e) => e.path.endsWith("/convert") && e.status === 200)
      .map((e) => JSON.parse(e.raw) as ConversionResult),
  );

  it("is short, whatever the answer's size, and names the query and the status", () => {
    for (const result of results) {
      const sentence = conversionSentence(result);
      expect(sentence.length).toBeLessThan(400);
      expect(sentence).toContain(result.query_id);
      expect(conversionTitle(result)).toContain(result.query_id);
    }
    expect(batchSentence(results.slice(0, 3))).toMatch(/^The batch of 3 identifiers is answered: /);
  });
});

describe("the showcase", () => {
  it("gives a conversion only for its exact query", () => {
    const result = { query_id: "X" } as ConversionResult;
    const showcase = {
      organism: "o",
      content_digest: null,
      checked_on: null,
      journeys: [
        {
          query: { identifier: "X", from_release: 48, to_release: null, final_database: null, explain: true },
          result,
          error: null,
        },
      ],
      cases: [],
    };
    expect(fromShowcase(showcase, { identifier: "X", from: 48 })).toBe(result);
    expect(fromShowcase(showcase, { identifier: "X" })).toBeNull();
    expect(fromShowcase(null, { identifier: "X", from: 48 })).toBeNull();
  });
});

describe("a part that fails", () => {
  it("tells code that did not arrive from a fault of the page", () => {
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: /assets/x.js"))).toBe(true);
    expect(isChunkError(new Error("Unable to preload CSS for /assets/x.css"))).toBe(true);
    expect(isChunkError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("is stated in its place, the rest stays, and it is asked for again", async () => {
    let fail = true;
    let loads = 0;
    const Part = lazyPart(() => {
      loads += 1;
      if (fail) return Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/p.js"));
      return Promise.resolve({ default: () => <p>The part</p> });
    });
    // Code that did not arrive while online reloads the page once (jsdom does not navigate; the guard is then set).
    window.sessionStorage.setItem("idtrack:reloaded-for-code", JSON.stringify({ at: Date.now(), path: "/" }));
    render(
      <div>
        <p>The rest</p>
        <ErrorBoundary part="This page">
          <Suspense fallback={<p>Loading</p>}>
            <Part />
          </Suspense>
        </ErrorBoundary>
      </div>,
    );
    expect(await screen.findByRole("heading", { name: "This page could not be loaded" })).toBeTruthy();
    expect(screen.getByText("The rest")).toBeTruthy();
    expect(loads).toBe(2); // asked for once more at once
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The part")).toBeTruthy();
  });

  it("states a fault while drawing, and starts again at another address", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): never {
      throw new TypeError("Cannot read properties of undefined (reading 'map')");
    }
    const { rerender } = render(
      <ErrorBoundary part="The answer" resetKey="a">
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("reading 'map'");
    rerender(
      <ErrorBoundary part="The answer" resetKey="b">
        <p>Another answer</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Another answer")).toBeTruthy();
  });
});

describe("a read that failed", () => {
  function Reader({ load }: { load: (signal: AbortSignal, fresh: boolean) => Promise<never> | Promise<unknown> }) {
    const state = useRequest("k", load as never);
    return <p>{state.state}</p>;
  }

  it("is asked again by itself when the browser is back online", async () => {
    const load = vi.fn().mockRejectedValueOnce(new UnreachableError("down")).mockResolvedValue({ data: 1, raw: "1" });
    render(<Reader load={load} />);
    expect(await screen.findByText("failed")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(await screen.findByText("done")).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith(expect.anything(), true);
  });

  it("is asked again once after the wait a refusal names, not again and again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const limited = () =>
      new ApiError(
        429,
        { code: "rate_limited", message: "x", argument: null, allowed: null, details: null, request_id: "r" },
        2,
      );
    const load = vi.fn().mockImplementation(() => Promise.reject(limited()));
    render(<Reader load={load} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("a change of the server's graphs", () => {
  function respond(body: string) {
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "x-request-id": "rid" } });
  }

  function Shown() {
    const { version, organisms } = useOrganisms();
    return (
      <p>
        digest {organisms[0]?.content_digest ?? "-"}; version digest {version?.graphs[0]?.content_digest ?? "-"}
      </p>
    );
  }

  it("reads every fact of the graphs anew (/version too), asking /organisms once", async () => {
    const pig = description("sus_scrofa");
    const version = JSON.parse(fixture("sus_scrofa", "version").raw) as { graphs: { content_digest: string }[] };
    let graphs = 1;
    const digest = () => `${"a".repeat(63)}${String(graphs)}`;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const path = url.replace("/api/v1", "").split("?")[0] ?? "";
        asked.push(path);
        if (path === "/organisms")
          return Promise.resolve(respond(JSON.stringify({ organisms: [{ ...pig, content_digest: digest() }] })));
        if (path === "/version")
          return Promise.resolve(
            respond(
              JSON.stringify({ ...version, graphs: version.graphs.map((g) => ({ ...g, content_digest: digest() })) }),
            ),
          );
        return Promise.resolve(respond(fixture("sus_scrofa", path.slice(1)).raw));
      }),
    );
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const view = render(
      <OrganismsProvider>
        <Shown />
      </OrganismsProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(view.container.textContent).toContain(`version digest ${"a".repeat(63)}1`);
    // The server is given other graphs; the tab is shown again two minutes later.
    graphs = 2;
    now += 120_000;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(asked.filter((p) => p === "/organisms")).toHaveLength(2);
    expect(view.container.textContent).toContain(`version digest ${"a".repeat(63)}2`);
  });
});

describe("a figure's width", () => {
  it("is measured on the element it draws in, whenever that element appears or is replaced", () => {
    const observed: Element[] = [];
    let report: ((entries: { target: Element; contentRect: { width: number } }[]) => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        unobserve(element: Element) {
          observed.splice(observed.indexOf(element), 1);
        }
        disconnect() {
          observed.length = 0;
        }
      },
    );
    function Figure({ shown, kind }: { shown: boolean; kind: string }) {
      const { ref, width } = useWidth<HTMLDivElement>(0);
      if (!shown) return <p>nothing yet</p>;
      return (
        <div ref={ref} data-kind={kind}>
          width {width}
        </div>
      );
    }
    const view = render(<Figure shown={false} kind="a" />);
    expect(observed).toHaveLength(0);
    view.rerender(<Figure shown kind="a" />);
    expect(observed).toHaveLength(1);
    const [frame] = observed;
    if (!frame) throw new Error("no element observed");
    act(() => {
      report?.([{ target: frame, contentRect: { width: 640 } }]);
    });
    expect(view.container.textContent).toBe("width 640");
    view.rerender(<Figure shown={false} kind="a" />);
    expect(observed).toHaveLength(0);
  });
});

describe("a statement of a failure", () => {
  it("names what failed, whatever the code, and heads the page where it is the whole page", () => {
    const error = new ApiError(
      500,
      {
        code: "internal_error",
        message: "Simulated failure.",
        argument: null,
        allowed: null,
        details: null,
        request_id: "abc",
      },
      null,
    );
    const { container } = render(
      <VocabularyContext
        value={{
          ...NO_VOCABULARY,
          errors: new Map([
            ["internal_error", { code: "internal_error", title: "A fault of the server.", retryable: true } as never],
          ]),
        }}
      >
        <ErrorPanel error={error} context="The list of organisms" level={1} />
      </VocabularyContext>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("A fault of the server.");
    expect(container.textContent).toContain("The list of organisms was refused: Simulated failure.");
  });
});

describe("a link to a place on a page", () => {
  it("keeps the place in the address and does not send the reader to the page's top", () => {
    const scrolled = vi.fn();
    vi.stubGlobal("scrollTo", scrolled);
    window.history.replaceState(null, "", "/");
    render(<Link to="/method#method-evidence">How it is measured</Link>);
    fireEvent.click(screen.getByRole("link", { name: "How it is measured" }));
    expect(window.location.pathname + window.location.hash).toBe("/method#method-evidence");
    expect(scrolled).not.toHaveBeenCalled();
    render(<Link to="/batch">Batch</Link>);
    fireEvent.click(screen.getByRole("link", { name: "Batch" }));
    expect(scrolled).toHaveBeenCalledWith({ top: 0 });
  });
});
