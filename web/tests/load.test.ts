// The load monitor: its state rule, the conversions of the api's numbers for reading, the samples it keeps and draws,
// and when it asks /status (every 5 s open, every 15 s closed, never while the tab is hidden).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, UnexpectedAnswerError, UnreachableError, type Answer } from "../src/api/client";
import type { StatusResponse } from "../src/api/types";
import {
  appendSample,
  capacityShare,
  occupancy,
  CLOSED_INTERVAL_MS,
  cores,
  coresSource,
  duration,
  GAP_MS,
  gib,
  logTicks,
  monitorState,
  loadState,
  MAX_SAMPLES,
  memoryShare,
  memorySource,
  milliseconds,
  niceTop,
  LATE_MS,
  OPEN_INTERVAL_MS,
  percent,
  placeOnLine,
  runs,
  sampleAges,
  sampleOf,
  seriesPath,
  sparkSpan,
  STATUS_TIMEOUT_MS,
  workWaiting,
  type Sample,
} from "../src/lib/load";
import { LoadStore } from "../src/lib/loadStore";
import { groupedInteger } from "../src/lib/numbers";

const RAW = readFileSync(join(import.meta.dirname, "fixtures", "status_answer.json"), "utf8");
/** A real answer of /status (the five graphs, two workers). */
const recorded = (): StatusResponse => JSON.parse(RAW) as StatusResponse;
/** The server's own samples the recorded answer carries (they begin the page's samples). */
const HISTORY = recorded().history.samples.length;

function withLoad(change: (s: StatusResponse) => void): StatusResponse {
  const s = recorded();
  change(s);
  return s;
}

describe("the work waiting", () => {
  it("counts each request once: the shared queue, the workers' own threads and the listen queue are apart", () => {
    const status = withLoad((s) => {
      s.requests.searches_queued = 31;
      s.requests.searches_waiting = 0;
      s.requests.connections_waiting = 0;
    });
    expect(workWaiting(status)).toBe(31);
    expect(loadState(status)).toBe("saturated");
    status.requests.searches_waiting = 2;
    status.requests.connections_waiting = 3;
    expect(workWaiting(status)).toBe(36);
    status.requests.connections_waiting = null;
    expect(workWaiting(status)).toBe(33);
  });
});

describe("the state rule", () => {
  it("is ok while fewer than 70 % of the workers search, below 90 % of the memory limit, with no search waiting", () => {
    expect(loadState(recorded())).toBe("ok");
    // The machine's cores are not the server's room: a share of them decides nothing.
    expect(loadState(withLoad((s) => (s.cpu.share_of_available = 0.99)))).toBe("ok");
    const one = withLoad((s) => {
      s.workers_alive = 2;
      s.requests.searches_running = 1;
    });
    expect(occupancy(one)).toBe(0.5);
    expect(loadState(one)).toBe("ok");
  });

  it("is busy from 70 % of the workers searching (a worker runs one search at a time)", () => {
    const full = withLoad((s) => {
      s.workers_alive = 2;
      s.requests.searches_running = 2;
    });
    expect(loadState(full)).toBe("busy");
    const three = withLoad((s) => {
      s.workers_alive = 3;
      s.requests.searches_running = 2;
    });
    expect(loadState(three)).toBe("ok");
    three.requests.searches_running = 3;
    expect(loadState(three)).toBe("busy");
  });

  it("reads memory near its bound from 90 % of the limit (PSS), the VM's steady footprint below it", () => {
    const memory = withLoad((s) => {
      s.memory.limit_bytes = 1000;
      s.memory.pss_bytes = 899;
    });
    expect(loadState(memory)).toBe("ok");
    memory.memory.pss_bytes = 900;
    expect(memoryShare(memory)).toBe(0.9);
    expect(loadState(memory)).toBe("memory");
    // SETUP's steady footprint of three workers under a 12 GiB bound: 11,079,015,424 bytes, 86 % of it.
    const steady = withLoad((s) => {
      s.memory.limit_bytes = 12 * 2 ** 30;
      s.memory.pss_bytes = 11_079_015_424;
    });
    expect(loadState(steady)).toBe("ok");
  });

  it("measures CPU against the workers' capacity, one core each", () => {
    const status = withLoad((s) => {
      s.workers_alive = 2;
      s.cpu.cores_used = 1.94;
      s.cpu.cores_available = 12;
    });
    expect(capacityShare(status)).toBeCloseTo(0.97, 10);
    expect(capacityShare(withLoad((s) => (s.workers_alive = 0)))).toBeNull();
  });

  it("is saturated while a search waits, whatever the shares", () => {
    expect(loadState(withLoad((s) => (s.requests.searches_waiting = 1)))).toBe("saturated");
    expect(
      loadState(
        withLoad((s) => {
          s.requests.searches_waiting = 2;
          s.cpu.share_of_available = 0.95;
        }),
      ),
    ).toBe("saturated");
  });

  it("does not use a share the server could not measure", () => {
    const unmeasured = withLoad((s) => {
      s.cpu.share_of_available = null;
      s.memory.pss_bytes = null;
      s.workers_alive = 0;
    });
    expect(memoryShare(unmeasured)).toBeNull();
    expect(loadState(unmeasured)).toBe("ok");
  });

  it("reads the failure's kind after a failed request, waiting before the first answer, late while one waits", () => {
    expect(monitorState(null, null)).toBe("waiting");
    expect(monitorState(null, "unreachable")).toBe("unreachable");
    expect(monitorState({ status: recorded() }, "unreachable")).toBe("unreachable");
    expect(monitorState({ status: recorded() }, null)).toBe("ok");
    expect(monitorState({ status: recorded() }, "refused")).toBe("refused");
    expect(monitorState({ status: recorded() }, "unreadable")).toBe("unreadable");
    expect(monitorState({ status: recorded() }, null, true)).toBe("late");
    // Late needs an earlier answer to be late about: before any, the reading is still on its way.
    expect(monitorState(null, null, true)).toBe("waiting");
  });

  it("counts connections in the listen queue as work that waits", () => {
    const queued = withLoad((s) => {
      s.requests.searches_waiting = 0;
      s.requests.connections_waiting = 3;
    });
    expect(workWaiting(queued)).toBe(3);
    expect(loadState(queued)).toBe("saturated");
    const unread = withLoad((s) => {
      s.requests.searches_waiting = 0;
      s.requests.connections_waiting = null;
    });
    expect(workWaiting(unread)).toBe(0);
    expect(loadState(unread)).toBe("ok");
  });

  it("adds the three disjoint counts of waiting work once each", () => {
    // 31 searches in the queue the workers share, none in the kernel's queue or for a worker's own thread: 31 wait.
    const handedOff = withLoad((s) => {
      s.requests.searches_waiting = 0;
      s.requests.searches_queued = 31;
      s.requests.connections_waiting = 0;
    });
    expect(workWaiting(handedOff)).toBe(31);
    const all = withLoad((s) => {
      s.requests.searches_waiting = 2;
      s.requests.searches_queued = 5;
      s.requests.connections_waiting = 1;
    });
    expect(workWaiting(all)).toBe(8);
  });
});

describe("conversions for reading, each with the exact value", () => {
  it("bytes to GiB (2^30) with the exact count of bytes", () => {
    expect(gib(3078809600)).toEqual({ text: "2.87 GiB", exact: `${groupedInteger(3078809600)} bytes` });
    expect(gib(3078809600).exact.replace(/\D/g, "")).toBe("3078809600");
    expect(gib(107374182400)).toEqual({ text: "100.00 GiB", exact: `${groupedInteger(107374182400)} bytes` });
    expect(gib(0).text).toBe("0.00 GiB");
  });

  it("a share as a percentage, cores and milliseconds, with the api's text", () => {
    expect(percent(0.0083)).toEqual({ text: "0.8 %", exact: "0.0083 as sent" });
    expect(percent(1)).toEqual({ text: "100.0 %", exact: "1.0 as sent" });
    expect(cores(0.37000000000000005)).toEqual({ text: "0.37", exact: "0.37000000000000005 as sent" });
    expect(milliseconds(19.81295272707939)).toEqual({ text: "19.8 ms", exact: "19.81295272707939 ms as sent" });
  });

  it("a duration in words", () => {
    expect(duration(34.238).text).toBe("34 s");
    expect(duration(694.2).text).toBe("11 min 34 s");
    expect(duration(7322).text).toBe("2 h 2 min");
    expect(duration(200000).text).toBe("2 d 7 h");
    expect(duration(34.23801535181701).exact).toBe("34.23801535181701 s as sent");
  });

  it("names the source of the cores and of the limit", () => {
    const s = recorded();
    expect(coresSource(s)).toContain("CPU affinity set");
    const quota = withLoad((t) => {
      t.cpu.source = "cgroup";
      t.cpu.quota_cores = 4;
    });
    expect(coresSource(quota)).toContain("cpu.max quota of 4.0 cores");
    expect(memorySource(s)).toContain("memory.max");
    expect(memorySource(withLoad((t) => (t.memory.source = "meminfo")))).toContain("total memory");
  });

  it("the oldest sample of the processes, CPU and memory apart", () => {
    const s = recorded();
    const processes = [s.master, ...s.workers].filter((p) => p !== null);
    expect(sampleAges(s).cpu).toBe(Math.max(...processes.map((p) => p.cpu_sample_age_seconds ?? 0)));
    expect(sampleAges(s).memory).toBe(Math.max(...processes.map((p) => p.memory_sample_age_seconds ?? 0)));
  });
});

describe("the samples and their lines", () => {
  const at = (t: number, v: number | null, failed = false): Sample => ({
    at: t,
    coresUsed: v,
    cpuShare: v,
    capacityShare: v,
    pssBytes: v,
    limitBytes: null,
    waiting: 0,
    failed,
  });

  it("a sample is the answer's values", () => {
    const s = recorded();
    expect(sampleOf(s, 5)).toEqual({
      at: 5,
      coresUsed: s.cpu.cores_used,
      cpuShare: s.cpu.share_of_available,
      capacityShare: (s.cpu.cores_used ?? 0) / s.workers_alive,
      pssBytes: s.memory.pss_bytes,
      limitBytes: s.memory.limit_bytes,
      waiting: s.requests.searches_waiting,
      failed: false,
    });
  });

  it("keeps at most two hours of samples", () => {
    let samples: Sample[] = [];
    for (let i = 0; i < MAX_SAMPLES + 10; i++) samples = appendSample(samples, at(i, i));
    expect(samples).toHaveLength(MAX_SAMPLES);
    expect(samples[0]?.at).toBe(10);
  });

  it("splits a line at a failed request, an unmeasured value and a gap in time", () => {
    const samples = [at(0, 1), at(5000, 2), at(10000, null, true), at(15000, 3), at(20000, null), at(25000, 4)];
    samples.push(at(25000 + GAP_MS + 1, 5));
    expect(runs(samples, (s) => s.cpuShare).map((r) => r.map((p) => p.v))).toEqual([[1, 2], [3], [4], [5]]);
  });

  it("draws a path in the box, the value axis from 0 to the top", () => {
    const path = seriesPath(
      [
        [
          { at: 0, v: 0 },
          { at: 10, v: 1 },
        ],
      ],
      { from: 0, to: 10, top: 2, width: 100, height: 20 },
    );
    expect(path).toBe("M0.00,20.00L100.00,10.00");
    expect(seriesPath([], { from: 0, to: 10, top: 1, width: 100, height: 20 })).toBe("");
  });

  it("rounds an axis's top up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceTop(0.13)).toBe(0.2);
    expect(niceTop(3.9)).toBe(5);
    expect(niceTop(2.2)).toBe(2.5);
    expect(niceTop(10)).toBe(10);
    expect(niceTop(0)).toBe(1);
  });

  it("ticks a logarithmic axis at 1, 2 and 5 times the powers of ten", () => {
    expect(logTicks(1.5, 40)).toEqual([2, 5, 10, 20]);
    expect(logTicks(0.3, 3)).toEqual([0.5, 1, 2]);
  });
});

describe("the store asks /status", () => {
  let hidden = false;
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    now = 1_000_000;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(answer: (signal?: AbortSignal) => Promise<Answer<StatusResponse>>) {
    const fetcher = vi.fn(answer);
    const store = new LoadStore(
      fetcher,
      () => now,
      () => hidden,
    );
    return { store, fetcher };
  }

  const ok = () => Promise.resolve({ data: recorded(), raw: RAW, requestId: null, serverTiming: null });

  async function advance(ms: number) {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("at once, then every 15 s while closed and every 5 s while open", async () => {
    const { store, fetcher } = make(ok);
    const stop = store.subscribe(() => undefined);
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().samples).toHaveLength(HISTORY + 1);
    await advance(CLOSED_INTERVAL_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Opening right after an answer waits the open interval; opening later than that asks at once.
    store.setOpen(true);
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(OPEN_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await advance(OPEN_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(4);
    store.setOpen(false);
    await advance(OPEN_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await advance(CLOSED_INTERVAL_MS - OPEN_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await advance(OPEN_INTERVAL_MS + 1);
    store.setOpen(true);
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(6);
    stop();
    await advance(CLOSED_INTERVAL_MS * 4);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("never while the tab is hidden, and again when it is shown", async () => {
    const { store, fetcher } = make(ok);
    const stop = store.subscribe(() => undefined);
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    hidden = true;
    store.visibilityChanged();
    await advance(CLOSED_INTERVAL_MS * 10);
    expect(fetcher).toHaveBeenCalledTimes(1);
    hidden = false;
    store.visibilityChanged();
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
  });

  it("says why when /status fails, keeps the last answer, and marks the sample failed", async () => {
    let fail: Error | null = null;
    const { store } = make(() => (fail ? Promise.reject(fail) : ok()));
    const stop = store.subscribe(() => undefined);
    await advance(0);
    fail = new UnreachableError("The api cannot be reached.");
    await advance(CLOSED_INTERVAL_MS);
    const snapshot = store.getSnapshot();
    expect(snapshot.failure?.message).toBe("The api cannot be reached.");
    expect(snapshot.latest?.status.workers_alive).toBe(recorded().workers_alive);
    expect(snapshot.samples.slice(HISTORY).map((s) => s.failed)).toEqual([false, true]);
    fail = new ApiError(
      404,
      {
        code: "not_found",
        message: "No such endpoint.",
        argument: null,
        allowed: null,
        details: null,
        request_id: "x",
      },
      null,
    );
    await advance(CLOSED_INTERVAL_MS);
    expect(store.getSnapshot().failure?.message).toBe("The api answered 404 not_found: No such endpoint.");
    fail = null;
    await advance(CLOSED_INTERVAL_MS);
    expect(store.getSnapshot().failure).toBeNull();
    stop();
  });

  it("marks the reading late while a request waits past LATE_MS, with a gap, and never asks twice at once", async () => {
    let release: (() => void) | null = null;
    let slow = false;
    const { store, fetcher } = make(() =>
      slow
        ? new Promise<Answer<StatusResponse>>((resolve) => {
            release = () => {
              resolve({ data: recorded(), raw: RAW, requestId: null, serverTiming: null });
            };
          })
        : ok(),
    );
    const stop = store.subscribe(() => undefined);
    await advance(0);
    slow = true;
    await advance(CLOSED_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(LATE_MS - 1);
    expect(store.getSnapshot().late).toBeNull();
    await advance(1);
    const since = store.getSnapshot().late?.since;
    expect(since).toBe(now - LATE_MS);
    expect(
      store
        .getSnapshot()
        .samples.slice(HISTORY)
        .map((s) => s.failed),
    ).toEqual([false, true]);
    // Opening the panel while the request is on its way waits for it: no second request.
    store.setOpen(true);
    await advance(OPEN_INTERVAL_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    (release as (() => void) | null)?.();
    await advance(0);
    expect(store.getSnapshot().late).toBeNull();
    expect(
      store
        .getSnapshot()
        .samples.slice(HISTORY)
        .map((s) => s.failed),
    ).toEqual([false, true, false]);
    stop();
  });

  it("begins with the server's own samples, placed on the browser's clock, and fills a stretch without answers", async () => {
    const { store } = make(ok);
    const stop = store.subscribe(() => undefined);
    await advance(0);
    const status = recorded();
    const samples = store.getSnapshot().samples;
    const answered = Date.parse(status.sampled_at);
    // Each of the server's samples stands as long before the answer as the server took it before answering.
    status.history.samples.forEach((h, i) => {
      expect(samples[i]?.at).toBe(now - (answered - Date.parse(h.sampled_at)));
      expect(samples[i]?.pssBytes).toBe(h.pss_bytes);
    });
    expect(samples.map((s) => s.at)).toEqual([...samples.map((s) => s.at)].sort((a, b) => a - b));
    // An answer within the gap adds itself only.
    await advance(CLOSED_INTERVAL_MS);
    expect(store.getSnapshot().samples).toHaveLength(HISTORY + 2);
    // After the tab was hidden for longer than the gap, the server's samples of the stretch come first: those taken
    // after the last sample kept and before the answer, none twice.
    const before = store.getSnapshot().samples.length;
    const lastKept = store.getSnapshot().samples[before - 1]?.at ?? 0;
    hidden = true;
    store.visibilityChanged();
    await advance(GAP_MS * 2);
    hidden = false;
    store.visibilityChanged();
    await advance(0);
    const after = store.getSnapshot().samples;
    expect(after.map((s) => s.at)).toEqual([...after.map((s) => s.at)].sort((a, b) => a - b));
    const filled = status.history.samples.filter((h) => {
      const at = now - (answered - Date.parse(h.sampled_at));
      return at > lastKept && at < now;
    }).length;
    expect(filled).toBeGreaterThan(0);
    expect(after).toHaveLength(before + filled + 1);
    stop();
  });

  it("gives a request up after STATUS_TIMEOUT_MS as unreachable", async () => {
    const { store } = make(
      (signal?: AbortSignal) =>
        new Promise<Answer<StatusResponse>>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const stop = store.subscribe(() => undefined);
    await advance(STATUS_TIMEOUT_MS);
    const failure = store.getSnapshot().failure;
    expect(failure?.kind).toBe("unreachable");
    expect(failure?.message).toBe(`/status did not answer within ${STATUS_TIMEOUT_MS / 1000} s.`);
    stop();
  });

  it("waits a refusal's Retry-After before asking again, whatever asks", async () => {
    let refuse = false;
    const refusal = new ApiError(
      429,
      { code: "rate_limited", message: "Too many.", argument: null, allowed: null, details: null, request_id: "r" },
      40,
    );
    const { store, fetcher } = make(() => (refuse ? Promise.reject(refusal) : ok()));
    const stop = store.subscribe(() => undefined);
    await advance(0);
    refuse = true;
    await advance(CLOSED_INTERVAL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().failure?.kind).toBe("refused");
    refuse = false;
    store.setOpen(true);
    await advance(39_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(1_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().failure).toBeNull();
    stop();
  });

  it("tells an answer it cannot read from no answer", async () => {
    const { store } = make(() => Promise.reject(new UnexpectedAnswerError("The api's answer is not valid JSON.", 200)));
    const stop = store.subscribe(() => undefined);
    await advance(0);
    expect(store.getSnapshot().failure?.kind).toBe("unreadable");
    expect(monitorState(null, store.getSnapshot().failure?.kind ?? null)).toBe("unreadable");
    stop();
  });
});

describe("the masthead's lines and the latency strip", () => {
  it("span the session's samples: at least one closed interval, at most ten minutes", () => {
    const most = 10 * 60 * 1000;
    expect(sparkSpan(null, 5_000, most)).toBe(most);
    expect(sparkSpan(1_000, 1_000, most)).toBe(CLOSED_INTERVAL_MS);
    expect(sparkSpan(0, 45_000, most)).toBe(45_000);
    expect(sparkSpan(0, 3_600_000, most)).toBe(most);
  });

  it("keep a value of 0 and of the top inside the band when inset", () => {
    const path = seriesPath(
      [
        [
          { at: 0, v: 0 },
          { at: 10, v: 4 },
        ],
      ],
      { from: 0, to: 10, top: 4, width: 40, height: 12, inset: 2 },
    );
    expect(path).toBe("M2.00,10.00L38.00,2.00");
  });

  it("place labels on a line without touching, the first given first", () => {
    const placed = placeOnLine(
      [
        { x: 10, text: "1 ms" },
        { x: 100, text: "10 ms" },
        { x: 20, text: "2 ms" },
        { x: 60, text: "5 ms" },
      ],
      120,
    );
    expect(placed.map((p) => p?.text ?? null)).toEqual(["1 ms", "10 ms", null, "5 ms"]);
    const boxes = placed
      .filter((p) => p !== null)
      .map((p) => [p.x - (p.text.length * 6.6) / 2, p.x + (p.text.length * 6.6) / 2]);
    for (const [a, b] of boxes) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(120);
    }
    const sorted = [...boxes].sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0));
    for (let i = 1; i < sorted.length; i++)
      expect((sorted[i]?.[0] ?? 0) - (sorted[i - 1]?.[1] ?? 0)).toBeGreaterThanOrEqual(8);
  });
});
