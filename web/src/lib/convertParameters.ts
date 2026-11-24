// The parameters of a conversion in the page's address (`/?organism=&id=&from=&to=&db=&from_db=&bridges=&explain=`), so
// that every answer can be linked to and reloaded.
import { href } from "./router";

export interface ConvertParameters {
  identifier: string;
  /** A release, or the text of the address when it is not a whole number (sent as it is: the api's refusal is shown). */
  fromRelease: number | string | null;
  toRelease: number | string | null;
  finalDatabase: string | null;
  fromDatabase: string | null;
  allowBridges: boolean;
  explain: boolean;
}

/** A release from text: a number, null when empty, or the text itself when it is not a whole number. */
export function releaseOf(text: string | null): number | string | null {
  if (text === null || text.trim() === "") return null;
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

const nonEmpty = (text: string | null) => (text === null || text === "" ? null : text);

export function readParameters(search: URLSearchParams): ConvertParameters {
  return {
    identifier: search.get("id") ?? "",
    fromRelease: releaseOf(search.get("from")),
    toRelease: releaseOf(search.get("to")),
    finalDatabase: nonEmpty(search.get("db")),
    fromDatabase: nonEmpty(search.get("from_db")),
    allowBridges: search.get("bridges") !== "false",
    explain: search.get("explain") !== "false",
  };
}

export function convertHref(organism: string, p: ConvertParameters): string {
  return href("/", {
    organism,
    id: p.identifier,
    from: p.fromRelease,
    to: p.toRelease,
    db: p.finalDatabase,
    from_db: p.fromDatabase,
    bridges: p.allowBridges ? null : "false",
    explain: p.explain ? null : "false",
  });
}

/** The parameters of a conversion of one identifier with everything else at the api's defaults. */
export function plainConversion(identifier: string): ConvertParameters {
  return {
    identifier,
    fromRelease: null,
    toRelease: null,
    finalDatabase: null,
    fromDatabase: null,
    allowBridges: true,
    explain: true,
  };
}
