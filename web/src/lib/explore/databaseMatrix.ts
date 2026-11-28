// What a conversion to each release of a graph can end in, as a release-by-database matrix: the server's
// `GET /organisms/{organism}/databases` (for every release, IDTrack's `API.final_databases(release)`; per assembly,
// `API.databases_by_assembly()`), its rows ordered so that what differs stands out: first the databases a conversion
// can end in at some releases only (by the first release, then the last), then those it can end in at every release
// (Ensembl's own first, then the api's order).
import { api, type Answer } from "../../api/client";
import type { DatabasesResponse } from "../../api/types";
import { sortDatabases } from "../databases";

type DatabaseRow = DatabasesResponse["databases"][number];

export interface DatabaseMatrix extends DatabasesResponse {
  /** The endpoint it was read from, as a person can request it. */
  source: string;
  /** How many of the first rows are databases of some releases only. */
  partial: number;
}

/** The api's answer with its rows in the page's order: the databases of some releases first, those of every release
 *  after them. */
export function readMatrix(data: DatabasesResponse): DatabaseMatrix {
  const byName = new Map(data.databases.map((r) => [r.name, r]));
  const ordered = sortDatabases(data.databases.map((r) => r.name))
    .map((n) => byName.get(n))
    .filter((r): r is DatabaseRow => r !== undefined);
  const all = new Set(data.releases);
  const every = (r: DatabaseRow) => r.releases.length === all.size && r.releases.every((x) => all.has(x));
  const first = (r: DatabaseRow) => Math.min(...r.releases);
  const last = (r: DatabaseRow) => Math.max(...r.releases);
  const partial = ordered
    .filter((r) => !every(r))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => first(a.r) - first(b.r) || last(a.r) - last(b.r) || a.i - b.i)
    .map(({ r }) => r);
  const databases = [...partial, ...ordered.filter(every)];
  return { ...data, databases, partial: partial.length, source: `/api/v1/organisms/${data.organism}/databases` };
}

export async function loadDatabaseMatrix(organism: string, signal: AbortSignal): Promise<Answer<DatabaseMatrix>> {
  const answer = await api.databases(organism, signal);
  return { ...answer, data: readMatrix(answer.data) };
}
