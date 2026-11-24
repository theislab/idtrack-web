// The client reads the api's answers and refusals as they are, and tells an unreachable api from a refusal.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, queryString, UnexpectedAnswerError, UnreachableError } from "../src/api/client";
import { fixture } from "./fixtures";

function respond(status: number, body: string, headers: Record<string, string> = {}) {
  return vi.fn(() => Promise.resolve(new Response(body, { status, headers })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queryString", () => {
  it("leaves out empty values, so the api's defaults hold", () => {
    expect(
      queryString({ identifier: "INS", to_release: null, final_database: "", explain: true, from_release: undefined }),
    ).toBe("?identifier=INS&explain=true");
    expect(queryString({})).toBe("");
  });
});

describe("api", () => {
  it("returns the parsed answer and the bytes as sent", async () => {
    const recorded = fixture("sus_scrofa", "convert_symbol_ins");
    const fetch = respond(200, recorded.raw, { "content-type": "application/json", "x-request-id": "abc" });
    vi.stubGlobal("fetch", fetch);
    const answer = await api.convert("sus_scrofa", { identifier: "INS", explain: true });
    expect(answer.raw).toBe(recorded.raw);
    expect(answer.data).toEqual(JSON.parse(recorded.raw));
    expect(answer.requestId).toBe("abc");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/organisms/sus_scrofa/convert?identifier=INS&explain=true",
      expect.anything(),
    );
  });

  it("reads a refusal into an ApiError with the api's code, message and request id", async () => {
    const recorded = fixture("sus_scrofa", "error_unknown_release");
    vi.stubGlobal("fetch", respond(400, recorded.raw, { "content-type": "application/json", "x-request-id": "r1" }));
    const error = await api.convert("sus_scrofa", { identifier: "INS", to_release: 999 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const body = (JSON.parse(recorded.raw) as { error: { code: string; message: string } }).error;
    expect((error as ApiError).body.code).toBe("unknown_release");
    expect((error as ApiError).body.message).toBe(body.message);
    expect((error as ApiError).status).toBe(400);
  });

  it("reads Retry-After of a rate limit", async () => {
    const body = JSON.stringify({
      error: {
        code: "rate_limited",
        message: "Too many requests.",
        argument: null,
        allowed: null,
        details: null,
        request_id: "x",
      },
    });
    vi.stubGlobal(
      "fetch",
      respond(429, body, { "content-type": "application/json", "x-request-id": "x", "retry-after": "7" }),
    );
    const error = (await api.health().catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfter).toBe(7);
  });

  it("calls a failed connection unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(api.health()).rejects.toBeInstanceOf(UnreachableError);
  });

  it("calls a proxy's answer for a down api unreachable", async () => {
    vi.stubGlobal("fetch", respond(502, "<html>Bad Gateway</html>", { "content-type": "text/html" }));
    const error = (await api.health().catch((e: unknown) => e)) as UnreachableError;
    expect(error).toBeInstanceOf(UnreachableError);
    expect(error.status).toBe(502);
  });

  it("refuses an answer that is not JSON", async () => {
    vi.stubGlobal("fetch", respond(200, "<html></html>", { "content-type": "text/html", "x-request-id": "y" }));
    await expect(api.health()).rejects.toBeInstanceOf(UnexpectedAnswerError);
  });

  it("keeps a TSV export as text", async () => {
    const recorded = fixture("sus_scrofa", "batch_tsv");
    vi.stubGlobal(
      "fetch",
      respond(200, recorded.raw, { "content-type": "text/tab-separated-values; charset=utf-8", "x-request-id": "t" }),
    );
    const answer = await api.batchTsv("sus_scrofa", { identifiers: ["INS"], explain: false, allow_bridges: true });
    expect(answer.raw).toBe(recorded.raw);
    expect(answer.data).toBe(recorded.raw);
  });
});
