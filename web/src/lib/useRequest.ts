// A request's state for a view: idle, loading, done or failed; a newer request cancels the one before it. A read that
// failed because nothing answered is asked again by itself when the browser is back online or the tab is shown again;
// a refusal that names its wait (`Retry-After`, a rate limit or a busy server) is asked again once after that wait.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  answersGeneration,
  onAnswersGeneration,
  ApiError,
  isAbort,
  isRequestError,
  UnexpectedAnswerError,
  UnreachableError,
  type AnyRequestError,
  type Answer,
} from "../api/client";

/** The longest wait of `Retry-After` after which a read is asked again by itself (longer: the person decides). */
const AUTO_RETRY_MAX_SECONDS = 120;

/** A refusal the api asks to repeat after a wait it names. */
export function waitsToRetry(error: AnyRequestError): error is ApiError {
  return error instanceof ApiError && (error.status === 429 || error.status === 503) && error.retryAfter !== null;
}

export type RequestState<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; answer: Answer<T> }
  | { state: "failed"; error: AnyRequestError };

function asRequestError(error: unknown): AnyRequestError {
  if (isRequestError(error)) return error;
  return new UnexpectedAnswerError(error instanceof Error ? error.message : String(error), 0);
}

/** Keep the latest value of a callback without making it a dependency. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Run `load` whenever `key` changes (null: nothing to load), and again when the server's graphs change (a new
 *  generation of the answers held, api/client.ts). The state is the answer of the current key only. `fresh` is true on
 *  a retry: the answer is asked of the api again even when one is held. The object returned is the same from one
 *  render to the next until the state changes, so that what a view builds from it (a layout, a renderer) is built once
 *  per answer. */
export function useRequest<T>(
  asked: string | null,
  load: (signal: AbortSignal, fresh: boolean) => Promise<Answer<T>>,
): RequestState<T> & { retry: () => void } {
  const generation = useSyncExternalStore(onAnswersGeneration, answersGeneration, answersGeneration);
  const key = asked === null ? null : `${asked}\u0000${String(generation)}`;
  const [settled, setSettled] = useState<{ key: string; attempt: number; state: RequestState<T> } | null>(null);
  // The retries of the current key: a new key starts again at its first attempt (asked without `fresh`).
  const [tries, setTries] = useState<{ key: string | null; n: number }>({ key, n: 0 });
  if (tries.key !== key) setTries({ key, n: 0 });
  const attempt = tries.key === key ? tries.n : 0;
  const latest = useLatest(load);
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    latest.current(controller.signal, attempt > 0).then(
      (answer) => {
        if (!controller.signal.aborted) setSettled({ key, attempt, state: { state: "done", answer } });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setSettled({ key, attempt, state: { state: "failed", error: asRequestError(error) } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [key, attempt, latest]);
  const retry = useCallback(() => {
    setTries((t) => ({ key, n: (t.key === key ? t.n : 0) + 1 }));
  }, [key]);
  const current = key !== null && settled?.key === key && settled.attempt === attempt ? settled.state : null;
  const phase = key === null ? "idle" : current ? null : "loading";
  const state = useMemo<RequestState<T>>(
    () => current ?? (phase === "idle" ? { state: "idle" } : { state: "loading" }),
    [current, phase],
  );
  const failure = state.state === "failed" ? state.error : null;
  useRecovery(key, state.state, failure, retry);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}

/** Ask again by itself where waiting is the remedy: back online or shown again after nothing answered; once (per key,
 *  until an answer comes) after the wait a refusal names. */
function useRecovery(
  key: string | null,
  phase: RequestState<unknown>["state"],
  failure: AnyRequestError | null,
  retry: () => void,
): void {
  const waited = useRef<string | null>(null);
  useEffect(() => {
    if (phase === "done") waited.current = null;
  }, [phase]);
  useEffect(() => {
    if (failure instanceof UnreachableError) {
      const again = () => {
        if (document.visibilityState === "visible" && navigator.onLine) retry();
      };
      window.addEventListener("online", again);
      document.addEventListener("visibilitychange", again);
      return () => {
        window.removeEventListener("online", again);
        document.removeEventListener("visibilitychange", again);
      };
    }
    if (
      failure &&
      key !== null &&
      waitsToRetry(failure) &&
      waited.current !== key &&
      (failure.retryAfter ?? 0) <= AUTO_RETRY_MAX_SECONDS
    ) {
      const left = Math.max(0, failure.receivedAt + (failure.retryAfter ?? 0) * 1000 - Date.now());
      const timer = window.setTimeout(() => {
        waited.current = key;
        retry();
      }, left);
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [key, failure, retry]);
}

/** A request started by an action (a batch, an export): the last one wins, the earlier is cancelled. `initial` is
 *  the state to start in (an answer kept from an earlier visit of the page). */
export function useAction<T, A extends unknown[]>(
  run: (signal: AbortSignal, ...args: A) => Promise<Answer<T>>,
  initial: RequestState<T> = { state: "idle" },
) {
  const [state, setState] = useState<RequestState<T>>(initial);
  const controller = useRef<AbortController | null>(null);
  const latest = useLatest(run);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const start = useCallback(
    (...args: A) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setState({ state: "loading" });
      return latest.current(current.signal, ...args).then(
        (answer) => {
          if (!current.signal.aborted) setState({ state: "done", answer });
          return answer;
        },
        (error: unknown) => {
          if (current.signal.aborted || isAbort(error)) return null;
          setState({ state: "failed", error: asRequestError(error) });
          return null;
        },
      );
    },
    [latest],
  );
  const reset = useCallback(() => {
    controller.current?.abort();
    setState({ state: "idle" });
  }, []);
  return { ...state, start, reset };
}
