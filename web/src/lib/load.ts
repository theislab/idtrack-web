// The server's load (`GET /api/v1/status`) for the masthead's reading and its panel: the state rule, the conversions
// of the api's numbers for reading (each with the exact value it came from), and the samples this page keeps.
//
// Every number shown is the api's or a stated conversion of it: bytes to GiB (1 GiB = 2^30 bytes), a share to a
// percentage, seconds to minutes and hours; the exact value is on focus.
import type { StatusResponse } from "../api/types";
import { groupedInteger, pythonFloat } from "./numbers";

/** The share of the cores available, or of the memory limit, from which the server reads as busy. */
const BUSY_SHARE = 0.7;

export type LoadState = "ok" | "busy" | "saturated" | "late" | "refused" | "unreadable" | "unreachable" | "waiting";

/** A request of /status still unanswered after this long makes the reading late: its values are then the last
 *  answer's, said to be old (below the open interval, so that a late answer is told before the next ask is due). */
export const LATE_MS = 4_000;
/** A request of /status unanswered after this long is given up (the reading is then unreachable). */
export const STATUS_TIMEOUT_MS = 30_000;

/** The state rule, in words (shown in the panel under the state). */
export const STATE_RULE =
  "OK below 70 % of the cores available and below 70 % of the memory limit in the server's own footprint (its processes' PSS summed; what else the limit's cgroup holds is shown, not counted); busy from 70 % of either; saturated while work waits (a search for a worker free of searches, a search for its worker's own search thread, or a connection in the kernel's listen queue); late while /status has not answered for 4 s (the values are then its last answer, a sign of load in itself); refused while /status answers with a refusal; unreadable while it answers with something this page cannot read; unreachable while this page gets no answer from /status.";

/** What each state says of the server now. */
export const STATE_SENTENCES: Record<LoadState, string> = {
  ok: "The cores used and the server's footprint are below 70 % of the cores available and of the memory limit, and no work waits for a worker.",
  busy: "The cores used or the server's footprint is at 70 % or more of the cores available or of the memory limit.",
  saturated:
    "Work waits: a search for a worker free of searches or for its worker's own search thread, or a connection in the kernel's listen queue; new work queues until a worker is free.",
  late: "The server has not answered /status for a while (a busy server answers it late too); the values are its last answer, not current.",
  refused:
    "The server answered /status with a refusal (too many requests from this address, or busy); the values are its last answer.",
  unreadable:
    "The server answered /status with something this page cannot read; the values are its last readable answer.",
  unreachable: "This page gets no answer from /status.",
  waiting: "The first answer of /status is on its way.",
};

export const STATE_WORDS: Record<LoadState, string> = {
  ok: "OK",
  busy: "Busy",
  saturated: "Saturated",
  late: "Late",
  refused: "Refused",
  unreadable: "Unreadable",
  unreachable: "Unreachable",
  waiting: "Reading",
};

/** The work waiting, in the three places the api counts apart (they never overlap, so their sum counts each request
 *  once): searches handed on to the queue the workers share, searches waiting for their worker's own search thread,
 *  and connections in the kernel's listen queue (`null`, not read, counts nothing). */
export function waitingParts(status: StatusResponse): { queued: number | null; thread: number; listen: number | null } {
  return {
    queued: status.requests.searches_queued ?? null,
    thread: status.requests.searches_waiting,
    listen: status.requests.connections_waiting,
  };
}

/** All the work waiting: the sum of its three disjoint places. */
export function workWaiting(status: StatusResponse): number {
  const { queued, thread, listen } = waitingParts(status);
  return thread + (queued ?? 0) + (listen ?? 0);
}

/** The share of the memory limit the server's processes hold (their PSS summed), or `null` where either is unknown. */
export function memoryShare(status: StatusResponse): number | null {
  const { pss_bytes: pss, limit_bytes: limit } = status.memory;
  if (pss === null || limit === null || limit <= 0) return null;
  return pss / limit;
}

/** Which state an answer of `/status` shows. Saturated wins over busy; a share the api could not measure is not used. */
export function loadState(status: StatusResponse): "ok" | "busy" | "saturated" {
  if (workWaiting(status) > 0) return "saturated";
  const cpu = status.cpu.share_of_available;
  const memory = memoryShare(status);
  if ((cpu !== null && cpu >= BUSY_SHARE) || (memory !== null && memory >= BUSY_SHARE)) return "busy";
  return "ok";
}

/** A value for reading and the exact value it was converted from (shown on focus). */
export interface Reading {
  text: string;
  exact: string;
}

const GIB = 2 ** 30;

/** Bytes as GiB to two decimals (1 GiB = 2^30 bytes), with the exact count of bytes. */
export function gib(bytes: number): Reading {
  return { text: `${(bytes / GIB).toFixed(2)} GiB`, exact: `${groupedInteger(bytes)} bytes` };
}

/** A share (1.0 = all) as a percentage to one decimal, with the api's value. */
export function percent(share: number): Reading {
  return { text: `${(share * 100).toFixed(1)} %`, exact: `${pythonFloat(share)} as sent` };
}

/** Cores to two decimals (the kernel counts CPU time in 10 ms ticks: one interval's share is exact to about 0.01). */
export function cores(value: number): Reading {
  return { text: value.toFixed(2), exact: `${pythonFloat(value)} as sent` };
}

/** Milliseconds to one decimal, with the api's value. */
export function milliseconds(value: number): Reading {
  return { text: `${value.toFixed(1)} ms`, exact: `${pythonFloat(value)} ms as sent` };
}

/** A duration in seconds in words (days, hours, minutes, seconds), with the api's seconds. */
export function duration(seconds: number): Reading {
  const whole = Math.max(0, Math.floor(seconds));
  const d = Math.floor(whole / 86400);
  const h = Math.floor((whole % 86400) / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const parts = d ? [`${d} d`, `${h} h`] : h ? [`${h} h`, `${m} min`] : m ? [`${m} min`, `${s} s`] : [`${s} s`];
  return { text: parts.join(" "), exact: `${pythonFloat(seconds)} s as sent` };
}

/** A count of seconds as sent, to one decimal for reading. */
export function seconds(value: number): Reading {
  return { text: `${value.toFixed(1)} s`, exact: `${pythonFloat(value)} s as sent` };
}

/** What sets the cores available, in words. */
export function coresSource(status: StatusResponse): string {
  const { source, affinity_cores: affinity, quota_cores: quota } = status.cpu;
  if (source === "cgroup")
    return `a cgroup v2 cpu.max quota of ${quota === null ? "?" : pythonFloat(quota)} cores (the CPU affinity set holds ${affinity})`;
  if (source === "affinity")
    return `the CPU affinity set (${affinity} CPUs${quota === null ? "; no cgroup quota" : `; a cgroup quota of ${pythonFloat(quota)} cores is larger`})`;
  return `the machine's CPU count (${affinity})`;
}

/** What sets the memory limit, in words. */
export function memorySource(status: StatusResponse): string {
  const source = status.memory.source;
  if (source === "cgroup") return "the smallest cgroup v2 memory.max of the server's cgroup and its ancestors";
  if (source === "meminfo") return "the machine's total memory (no cgroup limit is set)";
  return "neither a cgroup limit nor the machine's memory could be read";
}

/** The oldest sample an answer rests on: the largest sample age of its processes, CPU and memory apart. */
export function sampleAges(status: StatusResponse): { cpu: number | null; memory: number | null } {
  const processes = [...(status.master ? [status.master] : []), ...status.workers];
  const largest = (values: (number | null)[]) => {
    const known = values.filter((v): v is number => v !== null);
    return known.length ? Math.max(...known) : null;
  };
  return {
    cpu: largest(processes.map((p) => p.cpu_sample_age_seconds)),
    memory: largest(processes.map((p) => p.memory_sample_age_seconds)),
  };
}

/** One sample this page took of `/status`: when it arrived (the browser's clock) and the values the charts draw. */
export interface Sample {
  /** Milliseconds since the epoch, by the browser's clock, when the answer arrived. */
  at: number;
  coresUsed: number | null;
  cpuShare: number | null;
  pssBytes: number | null;
  limitBytes: number | null;
  waiting: number;
  /** `true` for a failed request (drawn as a gap). */
  failed: boolean;
}

export function sampleOf(status: StatusResponse, at: number): Sample {
  return {
    at,
    coresUsed: status.cpu.cores_used,
    cpuShare: status.cpu.share_of_available,
    pssBytes: status.memory.pss_bytes,
    limitBytes: status.memory.limit_bytes,
    waiting: workWaiting(status),
    failed: false,
  };
}

/** The server's own samples of the last minutes (`history`), placed on the browser's clock: each at the time of the
 *  answer that carried it less how much earlier than that answer the server took it (so that the two clocks need not
 *  agree). The share of the cores and the limit are the answer's (the cores available and the limit do not change
 *  while a server runs). */
export function historyOf(status: StatusResponse, receivedAt: number): Sample[] {
  const answered = Date.parse(status.sampled_at);
  const available = status.cpu.cores_available;
  return status.history.samples
    .map((s) => ({ s, before: answered - Date.parse(s.sampled_at) }))
    .filter(({ before }) => Number.isFinite(before) && before >= 0)
    .map(({ s, before }) => ({
      at: receivedAt - before,
      coresUsed: s.cores_used,
      cpuShare: s.cores_used === null || available <= 0 ? null : s.cores_used / available,
      pssBytes: s.pss_bytes,
      limitBytes: status.memory.limit_bytes,
      waiting: s.waiting ?? 0,
      failed: false,
    }));
}

/** The most samples kept: two hours at one every 5 s. */
export const MAX_SAMPLES = 1440;

export function appendSample(samples: readonly Sample[], sample: Sample): Sample[] {
  const next = [...samples, sample];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

/** The samples after an answer: where the page holds no sample of the last `GAP_MS` (its first answer, or after the tab
 *  was hidden or the server unreachable), the server's own samples of that stretch first, then the answer's. */
export function withAnswer(samples: readonly Sample[], status: StatusResponse, at: number): Sample[] {
  const last = samples.findLast((s) => !s.failed)?.at ?? null;
  let next: Sample[] = [...samples];
  if (last === null || at - last > GAP_MS) {
    const after = last ?? Number.NEGATIVE_INFINITY;
    const gapAfter = samples[samples.length - 1]?.at ?? Number.NEGATIVE_INFINITY;
    next = [...next, ...historyOf(status, at).filter((s) => s.at > after && s.at > gapAfter && s.at < at)];
  }
  next.push(sampleOf(status, at));
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

/** The polling intervals: while the panel is open, while it is closed (nothing while the tab is hidden). */
export const OPEN_INTERVAL_MS = 5_000;
export const CLOSED_INTERVAL_MS = 15_000;
/** Two samples further apart than this are not joined by a line (the tab was hidden, or a request failed). */
export const GAP_MS = CLOSED_INTERVAL_MS * 2.5;

/** The runs of a series that are drawn joined: split at a failed sample, an unknown value or a gap in time. */
export function runs(samples: readonly Sample[], value: (s: Sample) => number | null): { at: number; v: number }[][] {
  const out: { at: number; v: number }[][] = [];
  let run: { at: number; v: number }[] = [];
  let previous: number | null = null;
  for (const s of samples) {
    const v = s.failed ? null : value(s);
    if (v === null || (previous !== null && s.at - previous > GAP_MS)) {
      if (run.length) out.push(run);
      run = [];
    }
    if (v !== null) run.push({ at: s.at, v });
    previous = s.at;
  }
  if (run.length) out.push(run);
  return out;
}

/** Where a series is drawn: the times [from, to] across a box of width × height, the value axis from 0 to `top`,
 *  `inset` inside the box on every side (so that a mark at a value of 0 or of `top` stays inside it; 0 if not given). */
export interface SeriesBox {
  from: number;
  to: number;
  top: number;
  width: number;
  height: number;
  inset?: number;
}

/** An SVG path of a series in its box. */
export function seriesPath(series: { at: number; v: number }[][], box: SeriesBox): string {
  const { from } = box;
  const { x, y } = seriesScale(box);
  return series
    .map((run) =>
      run
        .filter((p) => p.at >= from)
        .map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(2)},${y(p.v).toFixed(2)}`)
        .join(""),
    )
    .filter(Boolean)
    .join("");
}

/** The scales of `seriesPath`: a time to x, a value to y. */
export function seriesScale({ from, to, top, width, height, inset = 0 }: SeriesBox) {
  const span = Math.max(1, to - from);
  const scale = top > 0 ? top : 1;
  const w = Math.max(0, width - 2 * inset);
  const h = Math.max(0, height - 2 * inset);
  return {
    x: (at: number) => inset + ((at - from) / span) * w,
    y: (v: number) => inset + h - Math.min(1, Math.max(0, v / scale)) * h,
  };
}

/** A round top for a chart's value axis: the next of 1, 2, 2.5, 5 × 10^k at or above `value`. */
export function niceTop(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

/** How the last request of /status failed: refused (the api's own refusal), unreadable (an answer this page cannot
 *  read) or unreachable (no answer at all). */
export type FailureKind = "refused" | "unreadable" | "unreachable";

/** The state of the masthead's reading: the failure's after a failed request, reading before any answer, late while a
 *  request has waited longer than `LATE_MS`, else the last answer's. */
export function monitorState(
  latest: { status: StatusResponse } | null,
  failure: FailureKind | null,
  late = false,
): LoadState {
  if (failure) return failure;
  if (!latest) return "waiting";
  if (late) return "late";
  return loadState(latest.status);
}

/** A span of the session's samples for the masthead's lines: from the first sample to the latest, at least one
 *  closed interval (so that two samples already span the line) and at most `most` (ten minutes). */
export function sparkSpan(first: number | null, latest: number, most: number): number {
  if (first === null) return most;
  return Math.min(most, Math.max(CLOSED_INTERVAL_MS, latest - first));
}

/** A time of the browser's clock, hours to seconds. */
export function clock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Ticks of a logarithmic axis from `lo` to `hi`: 1, 2 and 5 times the powers of ten between them. */
export function logTicks(lo: number, hi: number): number[] {
  const ticks: number[] = [];
  for (let p = 10 ** Math.floor(Math.log10(lo)); p <= hi; p *= 10)
    for (const m of [1, 2, 5]) {
      const t = m * p;
      if (t >= lo && t <= hi) ticks.push(Number(t.toPrecision(6)));
    }
  return ticks;
}

/** The advance of the monospaced face at the figures' 11 px (0.6 em), to measure a label before it is drawn. */
const MONO_ADVANCE = 0.6 * 11;
/** The least room between two labels of the strip. */
const LABEL_GAP = 8;

/** Labels placed on a line without touching: each `[x, text]` in priority order is kept where it stays inside
 *  [0, width] and `LABEL_GAP` from every label kept before it on its row; `rows` rows are tried in turn. */
export function placeOnLine(
  labels: readonly { x: number; text: string }[],
  width: number,
  rows = 1,
): ({ x: number; text: string; row: number } | null)[] {
  const taken: [number, number][][] = Array.from({ length: rows }, () => []);
  return labels.map(({ x, text }) => {
    const half = (text.length * MONO_ADVANCE) / 2;
    const lo = Math.max(0, Math.min(width - 2 * half, x - half));
    const hi = lo + 2 * half;
    if (hi > width + 0.5) return null;
    for (let row = 0; row < rows; row++) {
      const line = taken[row] ?? [];
      if (line.every(([a, b]) => hi + LABEL_GAP <= a || lo >= b + LABEL_GAP)) {
        line.push([lo, hi]);
        return { x: lo + half, text, row };
      }
    }
    return null;
  });
}
