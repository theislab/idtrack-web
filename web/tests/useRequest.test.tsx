// @vitest-environment jsdom
// useRequest's retries belong to one key: after a retry (or an automatic retry after a refusal), the next key is loaded
// as a first attempt (not `fresh`), so the answers the client holds are used again; and the state it returns is the
// same object from one render to the next until it changes, so that what a view builds from it is built once.
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useRequest } from "../src/lib/useRequest";

test("a new key after a retry is loaded with fresh = false", async () => {
  const load = vi.fn((signal: AbortSignal, fresh: boolean) =>
    Promise.resolve({ data: 1, raw: String(fresh), requestId: signal.aborted ? "aborted" : null, serverTiming: null }),
  );
  const { result, rerender } = renderHook(({ k }: { k: string }) => useRequest(k, load), { initialProps: { k: "A" } });
  await waitFor(() => expect(result.current.state).toBe("done"));
  act(() => result.current.retry());
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  rerender({ k: "B" });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  expect(load.mock.calls.map((c) => c[1])).toEqual([false, true, false]);
  // Back to A: a first attempt again, and a retry of it is fresh.
  rerender({ k: "A" });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(4));
  act(() => result.current.retry());
  await waitFor(() => expect(load).toHaveBeenCalledTimes(5));
  expect(load.mock.calls.map((c) => c[1])).toEqual([false, true, false, false, true]);
});

test("the state is the same object from one render to the next until it changes", async () => {
  const load = () => Promise.resolve({ data: { big: true }, raw: "", requestId: null, serverTiming: null });
  const { result, rerender } = renderHook(({ n }: { n: number }) => [useRequest("A", load), n] as const, {
    initialProps: { n: 0 },
  });
  const loading = result.current[0];
  rerender({ n: 1 });
  expect(result.current[0]).toBe(loading);
  await waitFor(() => expect(result.current[0].state).toBe("done"));
  const done = result.current[0];
  for (let n = 2; n < 6; n++) {
    rerender({ n });
    expect(result.current[0]).toBe(done);
  }
});
