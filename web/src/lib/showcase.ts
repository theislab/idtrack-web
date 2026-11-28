// The home's figures from one answer the server computed once per graph (`GET /organisms/{organism}/showcase`): every
// journey and case with its query and its answer exactly as `/convert` gives it. The home converts nothing itself: it
// reads this one answer (held for the page session and shared by every view that needs it, api/client.ts), and where
// the server cannot give it, it says why in the api's words, with the wait the server names.
import { api, type ShowcaseQuery, type ShowcaseResponse } from "../api/client";
import type { ConversionResult } from "../api/types";
import { useRequest } from "./useRequest";

/** A conversion as the home's links write it (absent fields: the api's defaults). */
export interface WantedConversion {
  identifier: string;
  from?: number | null | undefined;
  to?: number | null | undefined;
  db?: string | null | undefined;
}

const same = (q: ShowcaseQuery, w: WantedConversion) =>
  q.identifier === w.identifier &&
  (q.from_release ?? null) === (w.from ?? null) &&
  (q.to_release ?? null) === (w.to ?? null) &&
  (q.final_database ?? null) === (w.db ?? null);

/** The showcase's answer to `wanted`, or null when it does not hold that conversion. */
export function fromShowcase(showcase: ShowcaseResponse | null, wanted: WantedConversion): ConversionResult | null {
  if (!showcase) return null;
  const found =
    showcase.journeys.find((j) => same(j.query, wanted)) ?? showcase.cases.find((c) => same(c.query, wanted));
  return found?.result ?? null;
}

/** The index of the showcase's case that is the conversion `wanted`, or -1. */
export function caseIndex(cases: readonly { query: ShowcaseQuery }[], wanted: WantedConversion): number {
  return cases.findIndex((c) => same(c.query, wanted));
}

/** The showcase's queries of a graph without their answers (a few kilobytes, where the whole showcase is hundreds):
 *  what a view needs that only names the cases (the tour above an answer, the palette). */
export function useShowcaseQueries(organism: string | null) {
  return useRequest(organism === null ? null : `showcase-queries|${organism}`, (signal, fresh) =>
    api.showcaseQueries(organism ?? "", { signal, fresh }),
  );
}

/** The showcase of a graph (one request per page session; the shared cache answers every later view). */
export function useShowcase(organism: string | null) {
  return useRequest(organism === null ? null : `showcase|${organism}`, (signal, fresh) =>
    api.showcase(organism ?? "", { signal, fresh }),
  );
}
