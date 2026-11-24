// A request's state for a view: idle, loading, done or failed; a newer request cancels the one before it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isAbort, isRequestError, UnexpectedAnswerError, type AnyRequestError, type Answer } from "../api/client";

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

/** Run `load` whenever `key` changes (null: nothing to load). The state is the answer of the current key only. */
export function useRequest<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<Answer<T>>,
): RequestState<T> & { retry: () => void } {
  const [settled, setSettled] = useState<{ key: string; attempt: number; state: RequestState<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useLatest(load);
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    latest.current(controller.signal).then(
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
    setAttempt((a) => a + 1);
  }, []);
  const state: RequestState<T> =
    key === null
      ? { state: "idle" }
      : settled?.key === key && settled.attempt === attempt
        ? settled.state
        : { state: "loading" };
  return { ...state, retry };
}

/** A request started by an action (a batch, an export): the last one wins, the earlier is cancelled. */
export function useAction<T, A extends unknown[]>(run: (signal: AbortSignal, ...args: A) => Promise<Answer<T>>) {
  const [state, setState] = useState<RequestState<T>>({ state: "idle" });
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
