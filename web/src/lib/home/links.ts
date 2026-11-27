// Addresses of the home page's cases: the page's own address of a conversion, and the api's.
import type { GraphDescription, ShowcaseQuery } from "../../api/types";
import { convertHref, plainConversion } from "../convertParameters";
import type { CaseQuery } from "./cases";

/** The address of a case's conversion on the Convert page. */
export function caseHref(query: CaseQuery): string {
  return convertHref(query.organism, {
    ...plainConversion(query.identifier),
    fromRelease: query.from ?? null,
    toRelease: query.to ?? null,
    finalDatabase: query.db ?? null,
  });
}

/** The api's query of a case, with the path (explain), as the Convert page asks it. */
export function apiQuery(query: CaseQuery) {
  return {
    identifier: query.identifier,
    from_release: query.from ?? null,
    to_release: query.to ?? null,
    final_database: query.db ?? null,
    explain: true,
  };
}

/** The address of the api's answer to a case, as a person can request it. */
export function apiAddress(query: CaseQuery): string {
  const parameters = new URLSearchParams({ identifier: query.identifier });
  if (query.from !== undefined) parameters.set("from_release", String(query.from));
  if (query.to !== undefined) parameters.set("to_release", String(query.to));
  if (query.db !== undefined) parameters.set("final_database", query.db);
  parameters.set("explain", "true");
  return `/api/v1/organisms/${query.organism}/convert?${parameters.toString()}`;
}

/** Every release of a set of graphs, ascending. */
export function releasesOf(graphs: readonly GraphDescription[]): number[] {
  return [...new Set(graphs.flatMap((g) => g.releases))].sort((a, b) => a - b);
}

/** A showcase's query as the page's address writes it (the api's defaults left out). */
export function caseQueryOf(organism: string, q: ShowcaseQuery): CaseQuery {
  return {
    organism,
    identifier: q.identifier,
    ...(q.from_release !== null ? { from: q.from_release } : {}),
    ...(q.to_release !== null ? { to: q.to_release } : {}),
    ...(q.final_database !== null ? { db: q.final_database } : {}),
  };
}
