/// <reference types="vite/client" />
// The lineages of a graph laid out off the page's thread: the page's one worker (lib/hero/lineageWorker.ts) asks
// `GET /organisms/{organism}/lineages` and lays the answer out (lib/hero/lineageLayout.ts), sending the layout back
// with its typed arrays moved, not copied. Its address passes through the page's one Trusted Types policy of its own
// (`idtrack-worker`, the server's Content-Security-Policy), made once for the page. Where the browser runs no worker,
// or the worker fails, the layout is made here, from the api client's answer (whose refusals the page states).
import { api, API_BASE, type Answer } from "../../api/client";
import lineageWorkerUrl from "./lineageWorker.ts?worker&url";
import { layoutLineages, type LineageLayout } from "./lineageLayout";

const WORKER_URL = new URL(lineageWorkerUrl, window.location.href).href;
let workerPolicy: { createScriptURL: (url: string) => unknown } | null | undefined;

/** The address of the page's worker, as the Worker constructor takes it under the page's Trusted Types. */
export function workerScript(): string | URL {
  const types = (
    window as unknown as {
      trustedTypes?: { createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => unknown };
    }
  ).trustedTypes;
  if (!types) return WORKER_URL;
  workerPolicy ??= types.createPolicy("idtrack-worker", {
    createScriptURL: (url: string) => {
      if (url !== WORKER_URL) throw new TypeError("Not the page's worker.");
      return url;
    },
  }) as { createScriptURL: (url: string) => unknown };
  // A TrustedScriptURL, which the Worker constructor takes where a string is refused.
  return workerPolicy.createScriptURL(WORKER_URL) as string;
}

/** The layout made by the worker, or null where it could not make it (no worker, or the worker failed). */
function inWorker(organism: string, limit: number, eras: readonly number[], signal: AbortSignal) {
  return new Promise<LineageLayout | null>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(workerScript(), { type: "module" });
    } catch {
      resolve(null);
      return;
    }
    const done = (layout: LineageLayout | null) => {
      signal.removeEventListener("abort", stop);
      worker.terminate();
      resolve(layout);
    };
    const stop = () => {
      done(null);
    };
    signal.addEventListener("abort", stop);
    worker.addEventListener("message", (event: MessageEvent<{ layout?: LineageLayout; ids?: string }>) => {
      const { layout, ids } = event.data;
      done(layout ? { ...layout, ids: ids ? ids.split("\n") : [] } : null);
    });
    worker.addEventListener("error", stop);
    worker.addEventListener("messageerror", stop);
    worker.postMessage({
      url: `${API_BASE}/organisms/${encodeURIComponent(organism)}/lineages?limit=${limit}`,
      eras: [...eras],
    });
  });
}

/** The lineages of a graph laid out, as an answer of a request (lib/useRequest.ts): by the worker, else here. */
export async function loadLineageLayout(
  organism: string,
  limit: number,
  eras: readonly number[],
  signal: AbortSignal,
  fresh: boolean,
): Promise<Answer<LineageLayout>> {
  const laid = fresh ? null : await inWorker(organism, limit, eras, signal);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (laid) return { data: laid, raw: "", requestId: null, serverTiming: null };
  const answer = await api.lineages(organism, limit, { signal, fresh });
  return { ...answer, data: layoutLineages(answer.data, eras) };
}
