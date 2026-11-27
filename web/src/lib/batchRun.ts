// A batch a person started, held outside the page that started it: one run per organism, which goes on when the page
// is left (an organism switch, a row's path) and is kept for the session the moment its answer comes (once, never again
// on a later render). A batch is a pure function of its body, so a run that failed because nothing answered is asked
// again by itself when the browser is back online or the tab is shown again; a refusal that names its wait
// (`Retry-After`) is asked again by itself once, after the wait and while the tab is shown, and a refusal of that one
// automatic ask is left to the person (the run says when it was asked and that it was refused again). A busy server is
// never asked again and again by its own page.
//
// The batch is asked with every path (`explain`), so that the table, its evidence and the figure of what the paths
// crossed read one answer, and the api's JSON saved is that answer. Where the server refuses the paths themselves (the
// answer would be larger than it sends, or its refusal names `explain` as the argument to change), the batch is asked
// once more without them, as the api's own message advises, and the run says so. A refusal for time (the server busy,
// or the request out of its budget) is not a refusal of the paths: it is waited out once like any other, and only the
// person may then ask without the paths.
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

/** Why a batch was answered without its paths: the server refused them (its code and message), or the person asked
 *  without them after a refusal for time (`chosen`, with that refusal's code and message). */
export interface PathsRefused {
  code: string;
  message: string;
  chosen?: boolean;
}

/** The one automatic ask of a refused batch: waiting for the time the api named (until when, in ms since the epoch),
 *  or sent (when, ISO 8601). */
export type AutoRetry = { state: "waiting"; until: number } | { state: "asked"; at: string };

export interface BatchRun {
  /** Counts the runs of the organism: a page follows the run it started. */
  id: number;
  run: BatchRunState;
  source: BatchSource | null;
  /** The batch was answered without its paths, and why. */
  pathsRefused: PathsRefused | null;
  /** The person has seen the answer (on its organism's page). */
  seen: boolean;
  /** The automatic ask after a refusal that named its wait, where there is one. */
  retry: AutoRetry | null;
}

/** A converted batch kept for the session: its request, the api's answer as sent, where its identifiers came from. */
interface KeptBatch {
  request: Required<BatchRequest>;
  raw: string;
  requestId: string | null;
  serverTiming: string | null;
  answeredAt?: string | null;
  source?: BatchSource | null;
  pathsRefused?: PathsRefused | null;
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
  let restored: BatchRun = {
    id: 0,
    run: { state: "idle" },
    source: null,
    pathsRefused: null,
    seen: true,
    retry: null,
  };
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
        retry: null,
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

/** Whether a refusal of the batch with its paths is a refusal of the paths themselves, which the api advises to meet by
 *  asking without them: the answer larger than the server sends, or a refusal naming `explain` as the argument to
 *  change. A refusal for time (the server busy, the request's budget spent waiting or searching) is not: it is waited
 *  out, with the paths still asked. */
export function refusesPaths(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.body.code === "response_too_large" || error.body.argument === "explain");
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

/** How a batch is started: by the person (the default), or by the page itself, once, after the wait a refusal named
 *  (`afterWait`: a refusal of it is then left to the person); with every path (the default) or, the person's choice
 *  after a refusal for time, without them (`withoutPaths`: the refusal it answers). */
interface StartOptions {
  afterWait?: boolean;
  withoutPaths?: PathsRefused;
}

/** Start a batch of an organism (the one before it, if still under way, is cancelled). */
export function startBatch(
  organism: string,
  request: Required<BatchRequest>,
  source: BatchSource | null,
  options: StartOptions = {},
): number {
  controllers.get(organism)?.abort();
  recoveries.get(organism)?.();
  recoveries.delete(organism);
  const controller = new AbortController();
  controllers.set(organism, controller);
  counter += 1;
  const id = counter;
  const retry: AutoRetry | null = options.afterWait ? { state: "asked", at: new Date().toISOString() } : null;
  const first: Required<BatchRequest> = { ...request, explain: !options.withoutPaths };
  set(organism, {
    id,
    run: { state: "loading", request: first, startedAt: Date.now() },
    source,
    pathsRefused: options.withoutPaths ?? null,
    seen: false,
    retry,
  });
  const current = () => runs.get(organism)?.id === id && !controller.signal.aborted;
  void (async () => {
    let body = first;
    let refused: PathsRefused | null = options.withoutPaths ?? null;
    try {
      let answer: Answer<BatchResponse>;
      try {
        answer = await ask(organism, body, controller.signal);
      } catch (error) {
        if (!body.explain || !refusesPaths(error)) throw error;
        refused = { code: error.body.code, message: error.body.message };
        body = { ...request, explain: false };
        if (current())
          set(organism, {
            id,
            run: { state: "loading", request: body, startedAt: Date.now() },
            source,
            pathsRefused: refused,
            seen: false,
            retry,
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
      set(organism, {
        id,
        run: { state: "done", request: body, answer, answeredAt },
        source,
        pathsRefused: refused,
        seen: false,
        retry,
      });
    } catch (error) {
      if (controller.signal.aborted || isAbort(error) || !current()) return;
      const failure = asRequestError(error);
      // The one automatic ask after a wait the api named; a refusal of that ask is the person's to answer.
      const wait =
        !options.afterWait && waitsToRetry(failure) && (failure.retryAfter ?? 0) <= AUTO_RETRY_MAX_SECONDS;
      set(organism, {
        id,
        run: { state: "failed", request: body, error: failure },
        source,
        pathsRefused: refused,
        seen: false,
        retry: wait ? { state: "waiting", until: failure.receivedAt + (failure.retryAfter ?? 0) * 1000 } : retry,
      });
      recover(organism, id, request, source, failure, wait, refused);
    }
  })();
  return id;
}

/** Ask a failed batch again by itself where waiting is the remedy, as long as it is still the organism's run: when the
 *  browser is back online or the tab is shown again (nothing answered), or once after the wait a refusal named, when
 *  the tab is shown (`wait`). A run the person asked without the paths is asked so again. */
function recover(
  organism: string,
  id: number,
  request: Required<BatchRequest>,
  source: BatchSource | null,
  failure: AnyRequestError,
  wait: boolean,
  refused: PathsRefused | null,
): void {
  const stillFailed = () => {
    const run = runs.get(organism);
    return run?.id === id && run.run.state === "failed";
  };
  const options = (afterWait: boolean): StartOptions =>
    refused?.chosen ? { afterWait, withoutPaths: refused } : { afterWait };
  if (failure instanceof UnreachableError) {
    const again = () => {
      if (document.visibilityState === "visible" && navigator.onLine && stillFailed()) {
        stop();
        startBatch(organism, request, source, options(false));
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
  if (!wait || !(failure instanceof ApiError)) return;
  const left = Math.max(0, failure.receivedAt + (failure.retryAfter ?? 0) * 1000 - Date.now());
  // After the wait, asked once: at once where the tab is shown, else when it is shown again.
  const again = () => {
    if (document.visibilityState !== "visible") return;
    stop();
    if (stillFailed()) startBatch(organism, request, source, options(true));
  };
  const timer = window.setTimeout(() => {
    document.addEventListener("visibilitychange", again);
    again();
  }, left);
  const stop = () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", again);
    recoveries.delete(organism);
  };
  recoveries.set(organism, stop);
}

/** Ask the organism's last batch again now (Try again): with every path, or without them where the person chooses so
 *  after a refusal for time (that refusal is then said beside the answer). */
export function retryBatch(organism: string, withoutPaths = false): void {
  const run = runs.get(organism);
  if (!run || run.run.state === "idle") return;
  const request = run.run.request;
  const refusal = run.run.state === "failed" && run.run.error instanceof ApiError ? run.run.error.body : null;
  startBatch(
    organism,
    { ...request, explain: true },
    run.source,
    withoutPaths
      ? { withoutPaths: { code: refusal?.code ?? "", message: refusal?.message ?? "", chosen: true } }
      : {},
  );
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
