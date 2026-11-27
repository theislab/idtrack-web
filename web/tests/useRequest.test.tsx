// @vitest-environment jsdom
// useRequest's retries belong to one key: after a retry (or an automatic retry after a refusal), the next key is loaded
// as a first attempt (not `fresh`), so the answers the client holds are used again.
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
