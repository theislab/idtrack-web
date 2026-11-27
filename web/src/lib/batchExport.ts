// What a batch's exports carry beside the api's own bytes: a table of one row per identifier made from the answer
// shown (the person's own columns kept when a table was pasted), and the provenance of the answer (the organism, the
// versions and commits of the api and idtrack, the graph's content digest, the request, the times). The api's JSON and
// TSV are saved as they came and never changed; these files say where they came from.
import type { BatchRequest, GraphDescription, VersionResponse } from "../api/types";
import { SEPARATOR_WORDS, type Separator } from "./batchList";
import { eventsWords, releaseHow, type BatchRow } from "./batchTable";

/** Where the identifiers of a batch came from: the column read of the list or table given, with the person's cells. */
export interface BatchSource {
  separator: Separator | null;
  header: string[] | null;
  column: number;
  /** For each identifier sent, in order: its line of the list (from 1) and every cell of that line. */
  rows: { line: number; cells: string[] }[];
}

/** The names of the genes at the target release in another database, from a second batch of the genes. */
export interface GeneNames {
  database: string;
  /** For each gene: its ids in the database (empty: none there), or null when its conversion gave no answer. */
  names: Map<string, string[] | null>;
}

export interface BatchProvenance {
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
    format_version: number | null;
  };
  request: { method: "POST"; path: string; body: Required<BatchRequest> };
  answer: { request_id: string | null; server_timing: string | null; answered_at: string | null; count: number };
  /** The paths were asked and the server would not send them: its code and message (the answer is without them). */
  paths_refused: { code: string; message: string } | null;
  /** The api's TSV of the request, where it was asked (a second request, answered by the same graph). */
  tsv: { request_id: string | null; server_timing: string | null; answered_at: string } | null;
  source: string;
  exported_at: string;
}

export function batchProvenance({
  description,
  version,
  request,
  requestId,
  serverTiming,
  answeredAt,
  count,
  source,
  pathsRefused = null,
  tsv = null,
  now = new Date(),
}: {
  description: GraphDescription;
  version: VersionResponse | null;
  request: Required<BatchRequest>;
  requestId: string | null;
  serverTiming: string | null;
  answeredAt: string | null;
  count: number;
  source: BatchSource | null;
  pathsRefused?: BatchProvenance["paths_refused"];
  tsv?: BatchProvenance["tsv"];
  now?: Date;
}): BatchProvenance {
  return {
    about:
      "The provenance of a batch conversion of idtrack's web app: the server, the graph and the request that gave the answer.",
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
    request: { method: "POST", path: `/api/v1/organisms/${description.organism}/convert/batch`, body: request },
    answer: { request_id: requestId, server_timing: serverTiming, answered_at: answeredAt, count },
    paths_refused: pathsRefused,
    tsv,
    source: sourceWords(source),
    exported_at: now.toISOString(),
  };
}

/** Which column of what the person gave was read, in words. */
function sourceWords(source: BatchSource | null): string {
  if (!source?.separator) return "One identifier per line of the list given.";
  const name = source.header?.[source.column];
  return `Column ${String(source.column + 1)}${name ? ` (${name})` : ""} of a ${SEPARATOR_WORDS[source.separator]}-separated table${source.header ? ", whose first line was taken as its header" : ""}.`;
}

/** A cell a spreadsheet would read as a formula (it begins with =, +, -, @, a tab or a carriage return and is not a
 *  number) is written after an apostrophe, which spreadsheets show as text; every other cell as it is. */
export function spreadsheetSafe(cell: string): string {
  if (!/^[=+\-@\t\r]/.test(cell)) return cell;
  if (/^[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?%?$/.test(cell)) return cell;
  return `'${cell}`;
}

/** A cell of a tab-separated table: tabs and line breaks (which no identifier holds) as spaces, then made safe. */
const tsvCell = (value: string | number | boolean | null): string =>
  spreadsheetSafe(value === null ? "" : String(value).replace(/[\t\r\n]+/g, " "));

/** The table of one row per identifier, in the order given, begun by lines starting with `#` that give its
 *  provenance (most readers skip them: R `comment.char = "#"`, pandas `comment="#"`). */
export function rowTable(
  rows: readonly BatchRow[],
  provenance: BatchProvenance,
  source: BatchSource | null,
  names: GeneNames | null,
): string {
  const request = provenance.request.body;
  const target = request.to_release ?? provenance.graph.snapshot_release;
  const database = request.final_database ?? "ensembl_gene";
  const own = source !== null && (source.header !== null || source.rows.some((r) => r.cells.length > 1));
  const width = own ? Math.max(1, ...source.rows.map((r) => r.cells.length), source.header?.length ?? 0) : 0;
  const ownNames = Array.from({ length: width }, (_, c) =>
    (source?.header?.[c] ?? "") !== "" ? (source?.header?.[c] ?? "") : `column_${String(c + 1)}`,
  );
  const header = [
    "line",
    ...ownNames,
    "identifier",
    "status",
    `gene_at_${String(target)}`,
    ...(database === "ensembl_gene" ? [] : [`answer_${slug(database)}`]),
    ...(names ? [`names_${slug(names.database)}`] : []),
    "read_as",
    "match",
    "from_release",
    "from_release_how",
    "decided_by",
    "candidates",
    "other_genes",
    "history_events",
    "evidence",
    "shared_with_lines",
    "reasons",
  ];
  const lineOf = (index: number) => source?.rows[index]?.line ?? index + 1;
  const body = rows.map((row) => {
    const r = row.result;
    const cells = source?.rows[row.index]?.cells ?? [];
    return [
      lineOf(row.index),
      ...Array.from({ length: width }, (_, c) => cells[c] ?? ""),
      r.query_id,
      r.status,
      row.genes.join(";"),
      ...(database === "ensembl_gene" ? [] : [row.answers.join(";")]),
      ...(names
        ? [
            row.genes
              .flatMap((g) => names.names.get(g) ?? [])
              .filter((v, i, all) => all.indexOf(v) === i)
              .join(";"),
          ]
        : []),
      r.graph_id,
      r.match,
      r.from_release,
      releaseHow(r) === "none" ? "" : releaseHow(r),
      r.decided_by,
      r.candidates.length,
      row.otherGenes.join(";"),
      eventsWords(row.crossed),
      [...new Set(row.evidence.map((m) => m.kind))].join(";"),
      row.shared.map(lineOf).join(";"),
      r.reasons.join(";"),
    ].map(tsvCell);
  });
  const lines = [
    `# ${provenance.about}`,
    `# One row per identifier, in the order given; ${source ? sourceWords(source) : "one identifier per line."}`,
    `# organism ${provenance.organism}; idtrack ${provenance.idtrack_version ?? "unknown"} (commit ${provenance.idtrack_commit ?? "unknown"}); api ${provenance.api_version ?? "unknown"}`,
    `# graph content digest ${provenance.graph.content_digest ?? "unknown"}; snapshot release ${String(provenance.graph.snapshot_release)}; built ${provenance.graph.build_date ?? "at an unknown date"}`,
    `# request ${provenance.request.method} ${provenance.request.path} ${JSON.stringify({ ...request, identifiers: `${String(request.identifiers.length)} identifiers: the column identifier` })}`,
    `# answer request id ${provenance.answer.request_id ?? "none"}; answered ${provenance.answer.answered_at ?? "at an unknown time"}; exported ${provenance.exported_at}`,
    ...(names
      ? [
          `# names_${slug(names.database)}: the ids in ${names.database} of each gene at release ${String(target)}, from a second request of the same endpoint with the genes as identifiers, read and answered at ${String(target)}`,
        ]
      : []),
    `# other_genes: the genes of the candidates below the best answer (the identifier leads to them too); history_events: the steps of Ensembl's history on the best answer's path, in Ensembl's direction (old release->new release)${request.explain ? "" : ", empty: the batch was answered without its paths"}`,
    "# Values are the api's (codes as in GET /api/v1/vocabulary); a cell that begins with = + - @ and is no number is written after an apostrophe, so that a spreadsheet shows it as text.",
    header.map(tsvCell).join("\t"),
    ...body.map((cells) => cells.join("\t")),
  ];
  return `${lines.join("\n")}\n`;
}

/** A database's name as a part of a column's name: letters and digits, the rest as `_`. */
function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
