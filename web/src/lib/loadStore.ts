// The page's samples of the server's load: one store for the masthead's reading and the panel. It asks `/status`
// every 5 s while the panel is open and every 15 s while it is closed, never while the tab is hidden, and only while
// something shows it; the samples are kept for the charts (at most two hours of them), begun by the server's own
// samples of the last minutes (`history` of the first answer, and of an answer after a stretch without one), so that
// the lines are drawn from the first answer rather than from the page's first minutes. A request that
// has waited longer than LATE_MS makes the reading late (its values are then the last answer's, said to be old, and the
// line has a gap); one unanswered after STATUS_TIMEOUT_MS is given up; a refusal's Retry-After is waited before the
// next ask.
import { useSyncExternalStore } from "react";
import { ApiError, api, isRequestError, UnexpectedAnswerError, type Answer } from "../api/client";
import type { StatusResponse } from "../api/types";
import {
  appendSample,
  CLOSED_INTERVAL_MS,
  LATE_MS,
  OPEN_INTERVAL_MS,
  withAnswer,
  STATUS_TIMEOUT_MS,
  type FailureKind,
  type Sample,
} from "./load";

export interface LoadSnapshot {
  /** The last answer of `/status`, when one came. */
  latest: { status: StatusResponse; raw: string; receivedAt: number } | null;
  /** The last request failed: why, in words, when, and how: refused (the api's own refusal, a 429 or 503 of /status),
   *  unreadable (an answer the page cannot read: not JSON, or not of the document's form) or unreachable (no answer
   *  at all, or none within STATUS_TIMEOUT_MS). `retryAt`: the next ask waits for the refusal's Retry-After. */
  failure: { message: string; at: number; kind: FailureKind; retryAt: number | null } | null;
  /** A request of /status on its way for longer than LATE_MS: since when it was sent. */
  late: { since: number } | null;
  samples: Sample[];
  open: boolean;
}

type Fetcher = (signal: AbortSignal) => Promise<Answer<StatusResponse>>;

/** The ask was given up after STATUS_TIMEOUT_MS. */
class StatusTimeout extends Error {}

function failureText(error: unknown): string {
  if (error instanceof StatusTimeout) return `/status did not answer within ${STATUS_TIMEOUT_MS / 1000} s.`;
  if (error instanceof ApiError) return `The api answered ${error.status} ${error.body.code}: ${error.body.message}`;
  if (isRequestError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function failureKind(error: unknown): FailureKind {
  if (error instanceof ApiError) return "refused";
  if (error instanceof UnexpectedAnswerError) return "unreadable";
  return "unreachable";
}

/** A sample that marks no reading (a failed request, or a request that is late): the charts draw a gap there. */
function gapAt(at: number): Sample {
  return {
    at,
    coresUsed: null,
    cpuShare: null,
    capacityShare: null,
    pssBytes: null,
    limitBytes: null,
    waiting: 0,
    failed: true,
  };
}

export class LoadStore {
  private snapshot: LoadSnapshot = { latest: null, failure: null, late: null, samples: [], open: false };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lateTimer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private lastAsked = 0;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly hidden: () => boolean;

  constructor(
    fetcher: Fetcher = (signal) => api.status(signal),
    now: () => number = () => Date.now(),
    hidden: () => boolean = () => typeof document !== "undefined" && document.visibilityState === "hidden",
  ) {
    this.fetcher = fetcher;
    this.now = now;
    this.hidden = hidden;
  }

  getSnapshot = (): LoadSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  /** The interval in force: shorter while the panel is open. */
  interval(): number {
    return this.snapshot.open ? OPEN_INTERVAL_MS : CLOSED_INTERVAL_MS;
  }

  setOpen(open: boolean): void {
    if (this.snapshot.open === open) return;
    this.set({ open });
    // Opening asks at once when the last answer is older than the open interval; closing slows the next ask.
    if (this.listeners.size) this.schedule(open && this.now() - this.lastAsked >= OPEN_INTERVAL_MS ? 0 : null);
  }

  /** The tab was hidden or shown (`visibilitychange`). */
  visibilityChanged = (): void => {
    if (!this.listeners.size) return;
    if (this.hidden()) this.clear();
    else this.schedule(this.now() - this.lastAsked >= this.interval() ? 0 : null);
  };

  private start(): void {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.visibilityChanged);
    this.schedule(this.now() - this.lastAsked >= this.interval() ? 0 : null);
  }

  private stop(): void {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.clear();
    this.clearLate();
    this.controller?.abort();
    this.controller = null;
    if (this.snapshot.late) this.set({ late: null });
  }

  private clearLate(): void {
    if (this.lateTimer !== null) clearTimeout(this.lateTimer);
    this.lateTimer = null;
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Ask after `delay` ms, or when the interval since the last ask has passed (`null`). */
  private schedule(delay: number | null): void {
    this.clear();
    if (this.hidden()) return;
    // A refusal's Retry-After holds whatever asks: opening the panel, the tab shown again.
    const retryAt = this.snapshot.failure?.retryAt ?? null;
    const due = delay ?? Math.max(0, this.lastAsked + this.interval() - this.now());
    const wait = retryAt === null ? due : Math.max(due, retryAt - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.ask();
    }, wait);
  }

  private async ask(): Promise<void> {
    // One request at a time: a request on its way (late, perhaps) is waited for, never replaced.
    if (this.hidden() || !this.listeners.size || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    const asked = this.now();
    this.lastAsked = asked;
    // Still unanswered after LATE_MS: the reading is late, and the line has a gap from here until an answer comes.
    this.clearLate();
    this.lateTimer = setTimeout(() => {
      this.lateTimer = null;
      if (this.controller !== controller) return;
      this.set({ late: { since: asked }, samples: appendSample(this.snapshot.samples, gapAt(this.now())) });
    }, LATE_MS);
    const timeout = setTimeout(() => {
      controller.abort(new StatusTimeout());
    }, STATUS_TIMEOUT_MS);
    let retryAt: number | null = null;
    try {
      const answer = await this.fetcher(controller.signal);
      if (this.controller !== controller) return;
      const at = this.now();
      this.set({
        latest: { status: answer.data, raw: answer.raw, receivedAt: at },
        failure: null,
        late: null,
        samples: withAnswer(this.snapshot.samples, answer.data, at),
      });
    } catch (error) {
      if (this.controller !== controller) return;
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
      if (controller.signal.aborted && !(reason instanceof StatusTimeout)) return;
      const at = this.now();
      // A refusal that names its wait is not asked again before it (Retry-After, in seconds).
      if (reason instanceof ApiError && reason.retryAfter !== null) retryAt = at + reason.retryAfter * 1000;
      this.set({
        failure: { message: failureText(reason), at, kind: failureKind(reason), retryAt },
        late: null,
        samples: appendSample(this.snapshot.samples, gapAt(at)),
      });
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) {
        this.clearLate();
        this.controller = null;
      }
    }
    if (this.listeners.size) this.schedule(retryAt === null ? null : Math.max(retryAt - this.now(), this.interval()));
  }

  private set(change: Partial<LoadSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
}

/** The page's one store. */
export const loadStore = new LoadStore();

export function useLoad(store: LoadStore = loadStore): LoadSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
