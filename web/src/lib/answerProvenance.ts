// The provenance of one conversion's answer, saved beside the answer as sent: which server, idtrack and graph gave it,
// and the request that asked for it, so that a file kept as evidence for one doubtful identifier says where it came
// from as the batch's exports do (`lib/batchExport.ts`). The answer itself is saved byte for byte, apart from this.
import type { ConversionResult, GraphDescription, VersionResponse } from "../api/types";

export interface AnswerProvenance {
  about: string;
  organism: string;
  api_version: string | null;
  idtrack_version: string | null;
  idtrack_commit: string | null;
  graph: {
    content_digest: string | null;
    snapshot_release: number;
    build_date: string | null;
    built_by_idtrack: string | null;
    built_by_commit: string | null;
    format_version: number | string | null;
  };
  request: { method: "GET"; path: string; query: Record<string, string> };
  answer: {
    query_id: string;
    status: string;
    request_id: string | null;
    server_timing: string | null;
    received_at: string;
    file: string;
  };
  exported_at: string;
}

/** The provenance of `result`, asked at `apiUrl` (the api's address of the conversion, with its query). */
export function answerProvenance({
  result,
  description,
  version,
  apiUrl,
  requestId,
  serverTiming,
  receivedAt,
  file,
  now = new Date(),
}: {
  result: ConversionResult;
  description: GraphDescription;
  version: VersionResponse | null;
  apiUrl: string | null;
  requestId: string | null;
  serverTiming: string | null;
  receivedAt: string;
  file: string;
  now?: Date;
}): AnswerProvenance {
  const url = new URL(apiUrl ?? `/api/v1/organisms/${description.organism}/convert`, "http://server.invalid");
  return {
    about:
      "The provenance of one conversion of IDTrack's web app: the server, the graph and the request that gave the answer saved beside it.",
    organism: description.organism,
    api_version: version?.api_version ?? null,
    idtrack_version: version?.idtrack_version ?? null,
    idtrack_commit: version?.idtrack_commit ?? null,
    graph: {
      content_digest: description.content_digest,
      snapshot_release: description.snapshot_release,
      build_date: description.build_date ?? null,
      built_by_idtrack: description.package_version ?? null,
      built_by_commit: description.package_commit ?? null,
      format_version: description.format_version,
    },
    request: { method: "GET", path: url.pathname, query: Object.fromEntries(url.searchParams) },
    answer: {
      query_id: result.query_id,
      status: result.status,
      request_id: requestId,
      server_timing: serverTiming,
      received_at: receivedAt,
      file,
    },
    exported_at: now.toISOString(),
  };
}

/** idtrack's citation as its documentation gives it (`src/generated/idtrack_docs.json`), with the version of the idtrack
 *  that answered where the server names one (the documentation asks for the version used). */
export function citationOf(bibtex: string, version: VersionResponse | null): string {
  return version ? bibtex.replace(/version = \{[^}]*\}/, `version = {${version.idtrack_version}}`) : bibtex;
}

/** The fields of a BibTeX entry (`key = {value}`, one a line, as IDTrack's documentation writes its citation). */
function bibtexFields(bibtex: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of bibtex.matchAll(/^\s*([a-z]+)\s*=\s*\{(.*)\},?\s*$/gm)) {
    const [, key, value] = match;
    if (key && value !== undefined) fields[key] = value;
  }
  return fields;
}

/** The reference as one line of text, from the BibTeX entry's own fields ("Inecik, K. (2026). IDTrack: … (version
 *  0.1.2) [Software]. https://…"): for a reader whose reference manager takes neither BibTeX nor RIS. */
export function referenceText(bibtex: string): string {
  const f = bibtexFields(bibtex);
  const authors = (f["author"] ?? "")
    .split(/\s+and\s+/)
    .filter(Boolean)
    .map((name) => {
      const [family = "", given = ""] = name.split(",").map((part) => part.trim());
      const initials = given
        .split(/\s+/)
        .filter(Boolean)
        .map((g) => `${g.charAt(0)}.`)
        .join(" ");
      return initials ? `${family}, ${initials}` : family;
    })
    .join(", ");
  const version = f["version"] ? ` (version ${f["version"]})` : "";
  const url = f["url"] ? ` ${f["url"]}` : "";
  return `${authors} (${f["year"] ?? "n.d."}). ${f["title"] ?? ""}${version} [Software].${url}`;
}

/** The reference in RIS (EndNote, Zotero, Mendeley, Word's managers), from the BibTeX entry's own fields: a computer
 *  program (`TY  - COMP`), its authors, title, year, version (`ET`) and address. */
export function referenceRis(bibtex: string): string {
  const f = bibtexFields(bibtex);
  const lines = ["TY  - COMP"];
  for (const author of (f["author"] ?? "").split(/\s+and\s+/).filter(Boolean)) lines.push(`AU  - ${author.trim()}`);
  if (f["title"]) lines.push(`TI  - ${f["title"]}`);
  if (f["year"]) lines.push(`PY  - ${f["year"]}`);
  if (f["version"]) lines.push(`ET  - ${f["version"]}`);
  if (f["url"]) lines.push(`UR  - ${f["url"]}`);
  lines.push("ER  - ");
  return `${lines.join("\n")}\n`;
}

/** What IDTrack answered, in a few words for a methods sentence: the target (or the targets), a tie of genes with
 *  their ids, the bridges the best answer passes and its rank among the candidates, or why there is no answer. */
export function outcomeWords(result: ConversionResult, database: string): string {
  const bests = result.candidates.filter((c) => c.best);
  const list = (ids: string[]) =>
    ids.length <= 5 ? ids.join(", ") : `${ids.slice(0, 5).join(", ")} and ${ids.length - 5} more`;
  if (!bests.length) return `IDTrack gave no answer (status ${result.status})`;
  const genes = [...new Set(bests.map((c) => c.gene))];
  if (result.no_target) return `IDTrack's best answer, ${list(genes)}, has no id in ${database}`;
  const targets = [...new Set(bests.map((c) => c.target))];
  const best = bests[0];
  const bridges = best && best.bridges > 0 ? ` through ${best.bridges} bridge${best.bridges === 1 ? "" : "s"}` : "";
  if (result.tie && genes.length > 1)
    return `IDTrack answered a tie of ${genes.length} genes (${list(targets)})${bridges}`;
  const rank = result.candidates.length > 1 ? `, ranked first of ${result.candidates.length} candidates` : "";
  return `IDTrack answered ${list(targets)}${bridges}${rank}`;
}

/** A sentence for a methods section that states this one conversion exactly: the identifier, the organism, the release
 *  it was read at (and how), the release and database asked, the bridges allowed or not, idtrack's and the api's
 *  versions and commit, the graph's releases and content digest, the date, and what IDTrack answered. Every value is
 *  the answer's, the graph's description's or `/version`'s. */
export function methodsSentence({
  result,
  description,
  version,
  database,
  bridges,
  date,
}: {
  result: ConversionResult;
  description: GraphDescription;
  version: VersionResponse;
  /** The database asked, in words. */
  database: string;
  /** Whether the conversion allowed bridges. */
  bridges: boolean;
  /** The day, as YYYY-MM-DD. */
  date: string;
}): string {
  const name = description.organism.replace(/_/g, " ");
  const species = name.charAt(0).toUpperCase() + name.slice(1);
  const read =
    result.from_release === null
      ? "not read at any release"
      : `read at Ensembl release ${result.from_release}${
          result.from_release_fallback
            ? ` (release ${result.from_release_given ?? ""} was given, where the graph does not hold it)`
            : result.from_release_inferred
              ? " (inferred by IDTrack)"
              : ""
        }`;
  const first = description.releases[0];
  const last = description.releases[description.releases.length - 1];
  const digest = description.content_digest ? `, content digest ${description.content_digest.slice(0, 12)}` : "";
  return (
    `The identifier ${result.query_id} (${species}) was converted with IDTrack ${version.idtrack_version}` +
    `${version.idtrack_commit ? ` (commit ${version.idtrack_commit.slice(0, 7)})` : ""} through its web server` +
    ` (api ${version.api_version}) on ${date}: ${read}, converted to release ${result.to_release} in ${database}` +
    `, ${bridges ? "bridges allowed" : "Ensembl's history alone (no bridges)"}, on the graph of Ensembl releases` +
    ` ${first ?? ""}–${last ?? ""}${digest}; ${outcomeWords(result, database)}.`
  );
}
