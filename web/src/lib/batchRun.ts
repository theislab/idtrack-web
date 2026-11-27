// A batch a person started, held outside the page that started it: one run per organism, which goes on when the page
// is left (an organism switch, a row's path) and is kept for the session the moment its answer comes (once, never again
// on a later render). A batch is a pure function of its body, so a run that failed because nothing answered is asked
// again by itself when the browser is back online or the tab is shown again, and a refusal that names its wait is
// asked again once after it; what the page says of a failure is therefore true of the batch too.
//
// The batch is asked with every path (`explain`), so that the table, its evidence and the figure of what the paths
// crossed read one answer, and the api's JSON saved is that answer. Where the server will not send the paths (the
// answer would be larger than it sends, or would take longer than a request may), the batch is asked once more
// without them, as the api's own message advises, and the run says so.
import { useSyncExternalStore } from "react";
import {
  api,
  ApiError,
  isAbort,
  isRequestError,
  UnexpectedAnswerError,
  UnreachableError,
  type Answer,
  type AnyRequestError,
} from "../api/client";
import type { BatchRequest, BatchResponse } from "../api/types";
import type { BatchSource } from "./batchExport";
import { isRecord, readDraft, writeDraft } from "./drafts";
import { waitsToRetry } from "./useRequest";

/** The longest wait of `Retry-After` after which a batch is asked again by itself (longer: the person decides). */
const AUTO_RETRY_MAX_SECONDS = 120;

type BatchRunState =
  | { state: "idle" }
  | { state: "loading"; request: Required<BatchRequest>; startedAt: number }
  | { state: "done"; request: Required<BatchRequest>; answer: Answer<BatchResponse>; answeredAt: string }
  | { state: "failed"; request: Required<BatchRequest>; error: AnyRequestError };

export interface BatchRun {
  /** Counts the runs of the organism: a page follows the run it started. */
  id: number;
  run: BatchRunState;
  source: BatchSource | null;
  /** The paths were asked and refused: the answer is the batch without them (the api's code, in words). */
  pathsRefused: { code: string; message: string } | null;
  /** The person has seen the answer (on its organism's page). */
  seen: boolean;
}

/** A converted batch kept for the session: its request, the api's answer as sent, where its identifiers came from. */
interface KeptBatch {
  request: Required<BatchRequest>;
  raw: string;
  requestId: string | null;
  serverTiming: string | null;
  answeredAt?: string | null;
  source?: BatchSource | null;
  pathsRefused?: { code: string; message: string } | null;
}

const isKeptBatch = (value: unknown): value is KeptBatch =>
  isRecord(value) &&
  isRecord(value["request"]) &&
  Array.isArray(value["request"]["identifiers"]) &&
  typeof value["raw"] === "string" &&
  (value["requestId"] === null || typeof value["requestId"] === "string") &&
  (value["serverTiming"] === null || typeof value["serverTiming"] === "string");

const keyOf = (organism: string) => `batch.result.${organism}`;

const runs = new Map<string, BatchRun>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const recoveries = new Map<string, () => void>();
let counter = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function set(organism: string, next: BatchRun): void {
  runs.set(organism, next);
  emit();
}

/** The run of an organism: the one held, else the answer kept for the session (restored once), else none. */
export function batchRun(organism: string): BatchRun {
  const held = runs.get(organism);
  if (held) return held;
  const kept = readDraft(keyOf(organism), isKeptBatch);
  let restored: BatchRun = { id: 0, run: { state: "idle" }, source: null, pathsRefused: null, seen: true };
  if (kept) {
    try {
      const data = JSON.parse(kept.raw) as BatchResponse;
      restored = {
        id: 0,
        run: {
          state: "done",
          request: kept.request,
          answer: { data, raw: kept.raw, requestId: kept.requestId, serverTiming: kept.serverTiming },
          answeredAt: kept.answeredAt ?? "",
        },
        source: kept.source ?? null,
        pathsRefused: kept.pathsRefused ?? null,
        seen: true,
      };
    } catch {
      // A kept answer that no longer reads is forgotten.
    }
  }
  runs.set(organism, restored);
  return restored;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The run of an organism, kept up to date. */
export function useBatchRun(organism: string): BatchRun {
  return useSyncExternalStore(
    subscribe,
    () => batchRun(organism),
    () => batchRun(organism),
  );
}

/** Every run of another organism that is under way, or done and not yet seen (the page says where it is). */
export function useOtherRuns(organism: string): { organism: string; run: BatchRun }[] {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => otherRunsKey(organism),
    () => otherRunsKey(organism),
  );
  return snapshot
    ? snapshot.split("|").flatMap((part) => {
        const o = part.split(":")[0] ?? "";
        const run = runs.get(o);
        return run ? [{ organism: o, run }] : [];
      })
    : [];
}

function otherRunsKey(organism: string): string {
  return [...runs.entries()]
    .filter(([o, r]) => o !== organism && (r.run.state === "loading" || (r.run.state === "done" && !r.seen)))
    .map(([o, r]) => `${o}:${String(r.id)}:${r.run.state}`)
    .join("|");
}

/** Mark the answer of an organism as seen (its page shows it). */
export function markSeen(organism: string): void {
  const run = runs.get(organism);
  if (run && !run.seen && run.run.state === "done") set(organism, { ...run, seen: true });
}

/** Whether a refusal of the batch with its paths is one the api advises to meet by asking without them. */
function refusesPaths(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (["response_too_large", "request_budget_exceeded", "request_timeout"].includes(error.body.code) ||
      error.body.argument === "explain")
  );
}

function asRequestError(error: unknown): AnyRequestError {
  if (isRequestError(error)) return error;
  return new UnexpectedAnswerError(error instanceof Error ? error.message : String(error), 0);
}

/** The api asked for a batch (a function so that tests may stand in for it). */
type Ask = (organism: string, body: BatchRequest, signal: AbortSignal) => Promise<Answer<BatchResponse>>;
let ask: Ask = (organism, body, signal) => api.batch(organism, body, signal);
export function setBatchAsker(next: Ask | null): void {
  ask = next ?? ((organism, body, signal) => api.batch(organism, body, signal));
}

/** Start a batch of an organism (the one before it, if still under way, is cancelled). */
export function startBatch(organism: string, request: Required<BatchRequest>, source: BatchSource | null): number {
  controllers.get(organism)?.abort();
  recoveries.get(organism)?.();
  recoveries.delete(organism);
  const controller = new AbortController();
  controllers.set(organism, controller);
  counter += 1;
  const id = counter;
  const withPaths: Required<BatchRequest> = { ...request, explain: true };
  set(organism, {
    id,
    run: { state: "loading", request: withPaths, startedAt: Date.now() },
    source,
    pathsRefused: null,
    seen: false,
  });
  const current = () => runs.get(organism)?.id === id && !controller.signal.aborted;
  const settle = (state: BatchRunState, pathsRefused: BatchRun["pathsRefused"] = null) => {
    if (!current()) return;
    set(organism, { id, run: state, source, pathsRefused, seen: false });
  };
  void (async () => {
    let body = withPaths;
    let refused: BatchRun["pathsRefused"] = null;
    try {
      let answer: Answer<BatchResponse>;
      try {
        answer = await ask(organism, body, controller.signal);
      } catch (error) {
        if (!refusesPaths(error)) throw error;
        refused = { code: error.body.code, message: error.body.message };
        body = { ...request, explain: false };
        if (current())
          set(organism, {
            id,
            run: { state: "loading", request: body, startedAt: Date.now() },
            source,
            pathsRefused: refused,
            seen: false,
          });
        answer = await ask(organism, body, controller.signal);
      }
      if (!current()) return;
      const answeredAt = new Date().toISOString();
      // Kept for the session once, as it came (a full storage keeps it in memory only); written after the answer is
      // drawn, so that writing a large answer never holds its first frame.
      const kept: KeptBatch = {
        request: body,
        raw: answer.raw,
        requestId: answer.requestId,
        serverTiming: answer.serverTiming,
        answeredAt,
        source,
        pathsRefused: refused,
      };
      window.setTimeout(() => {
        if (runs.get(organism)?.id === id) writeDraft(keyOf(organism), kept);
      }, 250);
      settle({ state: "done", request: body, answer, answeredAt }, refused);
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return;
      const failure = asRequestError(error);
      settle({ state: "failed", request: body, error: failure }, refused);
      recover(organism, id, request, source, failure);
    }
  })();
  return id;
}

/** Ask a failed batch again by itself where waiting is the remedy (back online, shown again; once after a wait the
 *  api names), as long as it is still the organism's run. */
function recover(
  organism: string,
  id: number,
  request: Required<BatchRequest>,
  source: BatchSource | null,
  failure: AnyRequestError,
): void {
  const stillFailed = () => {
    const run = runs.get(organism);
    return run?.id === id && run.run.state === "failed";
  };
  if (failure instanceof UnreachableError) {
    const again = () => {
      if (document.visibilityState === "visible" && navigator.onLine && stillFailed()) {
        stop();
        startBatch(organism, request, source);
      }
    };
    const stop = () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
      recoveries.delete(organism);
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    recoveries.set(organism, stop);
    return;
  }
  if (waitsToRetry(failure) && (failure.retryAfter ?? 0) <= AUTO_RETRY_MAX_SECONDS) {
    const left = Math.max(0, failure.receivedAt + (failure.retryAfter ?? 0) * 1000 - Date.now());
    const timer = window.setTimeout(() => {
      recoveries.delete(organism);
      if (stillFailed()) startBatch(organism, request, source);
    }, left);
    recoveries.set(organism, () => {
      window.clearTimeout(timer);
      recoveries.delete(organism);
    });
  }
}

/** Ask the organism's last batch again now (Try again). */
export function retryBatch(organism: string): void {
  const run = runs.get(organism);
  if (!run || run.run.state === "idle") return;
  const request = run.run.request;
  startBatch(organism, { ...request, explain: true }, run.source);
}

/** Forget every run (tests). */
export function resetBatchRuns(): void {
  for (const c of controllers.values()) c.abort();
  for (const stop of recoveries.values()) stop();
  controllers.clear();
  recoveries.clear();
  runs.clear();
  emit();
}
