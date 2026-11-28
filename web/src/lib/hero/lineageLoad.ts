// The lineages of a graph laid out, for the home's picture and the History tab's field alike: the api client asks
// `GET /organisms/{organism}/lineages` (its checks of the answer's form, its refusals stated, its answers shared for
// the page session), and the page's one worker (./lineageWorker.ts) reads the text the api sent and lays it out
// (./lineageLayout.ts), sending the layout back with its typed arrays moved, not copied, so that a slow phone's thread
// stays free. The worker's address passes through the page's one Trusted Types policy of its own (`idtrack-worker`,
// the server's Content-Security-Policy), made once for the page. Where the browser runs no worker, or the worker
// fails to load or to lay them out, the layout is made here, by the same function.
import { api, type Answer } from "../../api/client";
import type { LineagesResponse } from "../../api/types";
import lineageWorkerUrl from "./lineageWorker.ts?worker&url";
import { layoutLineages, type LayoutAsk, type LineageLayout } from "./lineageLayout";

const WORKER_URL = new URL(lineageWorkerUrl, window.location.href).href;
let workerPolicy: TrustedTypePolicy | undefined;

/** The address of the page's worker, as the Worker constructor takes it under the page's Trusted Types. */
function workerScript(): string | URL {
  const types = window.trustedTypes;
  if (!types) return WORKER_URL;
  workerPolicy ??= types.createPolicy("idtrack-worker", {
    createScriptURL: (url: string) => {
      if (url !== WORKER_URL) throw new TypeError("Not the page's worker.");
      return url;
    },
  });
  // A TrustedScriptURL, which the Worker constructor takes where the policy enforces it (TypeScript's DOM types do
  // not name it among the constructor's arguments yet).
  return workerPolicy.createScriptURL(WORKER_URL) as unknown as string;
}

/** The layout of an answer made by the worker, or null where it could not make it (no worker, or the worker failed
 *  to load or to lay it out). */
function inWorker(answer: Answer<LineagesResponse>, eras: readonly number[], signal: AbortSignal) {
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
    const stop = (event?: Event) => {
      event?.preventDefault();
      done(null);
    };
    signal.addEventListener("abort", stop);
    worker.addEventListener("message", (event: MessageEvent<{ layout?: LineageLayout; ids?: string }>) => {
      const { layout, ids } = event.data;
      done(layout ? { ...layout, ids: ids ? ids.split("\n") : [] } : null);
    });
    worker.addEventListener("error", stop);
    worker.addEventListener("messageerror", stop);
    const ask: LayoutAsk = { raw: answer.raw, eras: [...eras] };
    worker.postMessage(ask);
  });
}

/** The lineages of a graph laid out, as an answer of a request (lib/useRequest.ts): read by the api client, laid out
 *  by the worker, else here. */
export async function loadLineageLayout(
  organism: string,
  limit: number,
  eras: readonly number[],
  signal: AbortSignal,
  fresh: boolean,
): Promise<Answer<LineageLayout>> {
  const answer = await api.lineages(organism, limit, { signal, fresh });
  const laid = await inWorker(answer, eras, signal);
  if (signal.aborted) throw new DOMException("The layout was not wanted any more.", "AbortError");
  return { ...answer, raw: "", data: laid ?? layoutLineages(answer.data, eras) };
}
