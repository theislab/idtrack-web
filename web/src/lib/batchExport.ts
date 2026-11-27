// What a batch's exports carry beside the api's own bytes: a table of one row per identifier made from the answer
// shown (the person's own columns kept when a table was pasted), as TSV or CSV, and the provenance of the answer (the
// organism, the versions and commits of the api and idtrack, the graph's content digest, the request as sent and as
// the server resolved it, every other request whose answers the table holds, the times), as JSON and as a methods
// sentence. The api's JSON and TSV are saved as they came and never changed; these files say where they came from.
// Every code a file writes is defined in it: the api's codes by the vocabulary (`GET /api/v1/vocabulary`), the
// evidence codes, which are this page's own, in the file's head.
import type { BatchRequest, GraphDescription, VersionResponse } from "../api/types";
import type { Life } from "./batchLives";
import { SEPARATOR_WORDS, type Separator } from "./batchList";
import type { PathsRefused } from "./batchRun";
import { eventsWords, releaseHow, type BatchRow } from "./batchTable";
import type { EvidenceMark } from "./evidence";
import { pythonFloat } from "./numbers";

/** Where the identifiers of a batch came from: the column read of the list or table given, with the person's cells,
 *  and the release the list was found to come from where the person had it inferred. */
export interface BatchSource {
  separator: Separator | null;
  header: string[] | null;
  column: number;
  /** For each identifier sent, in order: its line of the list (from 1) and every cell of that line. */
  rows: { line: number; cells: string[] }[];
  /** The release read at, as idtrack's source inference of the list gave it (`POST …/source-inference`). */
  inferred?: InferredRelease | null;
  /** Where each different identifier was sent once (a list over the server's bound by its repeats alone): for each
   *  place of the list, the index of its identifier among those sent. */
  places?: number[] | null;
}

/** The release of a list from idtrack's source inference: the best release, the band of releases the list cannot
 *  tell apart from it, the margin, and the request that gave it. */
export interface InferredRelease {
  release: number;
  band: number[];
  margin: number | null;
  identifiers: number;
  notFound: number;
  requestId: string | null;
}

/** The names of the genes at the target release in another database, from a second batch of the genes. */
export interface GeneNames {
  database: string;
  /** For each gene: its ids in the database (empty: none there), or null when its conversion gave no answer. */
  names: Map<string, string[] | null>;
  /** The requests that gave them. */
  requestIds: (string | null)[];
}

/** A request of the same endpoint whose answers the table holds beside the batch's own. */
export interface OtherRequest {
  /** What it asked, in words. */
  about: string;
  body: Omit<Required<BatchRequest>, "identifiers"> & { identifiers: number };
  request_ids: (string | null)[];
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
  /** The request as sent, and as the server resolved it (an empty target is the graph's last release, which a later
   *  graph moves: `resolved` pins it; an empty release read at is inferred for each identifier). */
  request: {
    method: "POST";
    path: string;
    body: Required<BatchRequest>;
    resolved: { to_release: number; from_release: number | "inferred for each identifier" };
  };
  answer: { request_id: string | null; server_timing: string | null; answered_at: string | null; count: number };
  /** The batch was answered without its paths: the code and message of the refusal, and whether the person chose to
   *  ask without them after a refusal for time. */
  paths_refused: PathsRefused | null;
  /** The api's TSV of the request, where it was asked (a second request, answered by the same graph). */
  tsv: { request_id: string | null; server_timing: string | null; answered_at: string } | null;
  /** The other requests whose answers the table holds: the names beside the genes, what retired identifiers were. */
  other_requests: OtherRequest[];
  /** The release read at, where the person took it from idtrack's source inference of the list. */
  source_inference: InferredRelease | null;
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
  resolvedTo,
  pathsRefused = null,
  tsv = null,
  others = [],
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
  /** The target release the server answered at (every result's `to_release`). */
  resolvedTo: number;
  pathsRefused?: BatchProvenance["paths_refused"];
  tsv?: BatchProvenance["tsv"];
  others?: OtherRequest[];
  now?: Date;
}): BatchProvenance {
  return {
    about:
      "The provenance of a batch conversion of idtrack's web app: the server, the graph and the requests that gave the answer.",
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
    request: {
      method: "POST",
      path: `/api/v1/organisms/${description.organism}/convert/batch`,
      body: request,
      resolved: {
        to_release: resolvedTo,
        from_release: request.from_release ?? "inferred for each identifier",
      },
    },
    answer: { request_id: requestId, server_timing: serverTiming, answered_at: answeredAt, count },
    paths_refused: pathsRefused,
    tsv,
    other_requests: others,
    source_inference: source?.inferred ?? null,
    source: sourceWords(source),
    exported_at: now.toISOString(),
  };
}

/** Which column of what the person gave was read, in words. */
function sourceWords(source: BatchSource | null): string {
  const once = source?.places
    ? ` Each different identifier was sent once, and its answer is given at every place of its identifier (${String(source.places.length)} places).`
    : "";
  if (!source?.separator) return `One identifier per line of the list given.${once}`;
  const name = source.header?.[source.column];
  return `Column ${String(source.column + 1)}${name ? ` (${name})` : ""} of a ${SEPARATOR_WORDS[source.separator]}-separated table${source.header ? ", whose first line was taken as its header" : ""}.${once}`;
}

/** The evidence codes of the table: this page's classes of evidence (`src/lib/evidence.ts`), each in a sentence. A
 *  unit test checks that every class has its sentence. */
export const EVIDENCE_CODES: Record<EvidenceMark["kind"], string> = {
  bridge:
    "the best answer is reached through a bridge: an id two genes carry, idtrack's inference where Ensembl's history ends",
  bridge_beside: "a bridge joins two genes that existed at the same releases, so neither took the other's place",
  bridge_rival:
    "another gene, reached by a bridge from the same gene through ids the bridge taken does not pass, ranks below only by the bridge's gap",
  places_apart: "a step of Ensembl's history on the path joins genes that do not lie at one place",
  places_unknown: "a step across assemblies whose places cannot be compared (no published mapping of the assemblies)",
  outside_reference:
    "every gene of the best answer lies outside the reference sequence (a haplotype, patch or alternative locus)",
  listed_as_copy: "the best answer is also listed among the copies the result sets apart (alternative_locus_genes)",
  bare_number: "a bare number, read in every database whose ids are numbers",
  one_gene: "the targets are every id of one gene in the database asked, not the identifier's counterpart alone",
  split_ranked: "the path passes a split; its successors are ranked by Ensembl's scores, not by place",
  unscored: "the path holds history steps between two different ids without Ensembl's score",
  final_other_release: "the target is attached to a transcript or translation of the gene at another release",
  read_at_another_release: "read at another release than the one given (the graph does not hold it there)",
  match: "matched otherwise than as written (a synonym, letter case, separators, a copy, a newer version)",
  other_release: "the string has another meaning at other releases",
  other_reading: "the string has another reading idtrack reports",
  lowest_score:
    "the lowest of Ensembl's mapping scores on the best path, where one is below 1 (0 to 1: how much of the old gene the new one keeps)",
};

/** A cell a spreadsheet would read as a formula (it begins with =, +, -, @, a tab or a carriage return and is not a
 *  number) is written after an apostrophe, which spreadsheets show as text; every other cell as it is. */
export function spreadsheetSafe(cell: string): string {
  if (!/^[=+\-@\t\r]/.test(cell)) return cell;
  if (/^[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?%?$/.test(cell)) return cell;
  return `'${cell}`;
}

export type TableFormat = "tsv" | "csv";

/** A cell of the table: in a TSV, tabs and line breaks (which no identifier holds) as spaces; in a CSV, quoted where it
 *  holds a comma, a quote or a line break (RFC 4180); then made safe for a spreadsheet. */
function cellOf(value: string | number | boolean | null, format: TableFormat): string {
  const text = spreadsheetSafe(value === null ? "" : String(value).replace(/[\t\r\n]+/g, " "));
  if (format === "tsv" || !/[",]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A mark's label in plain words (its code spans without their backticks). */
const plain = (text: string) => text.replace(/`/g, "");

/** The table of one row per identifier, in the order given, begun by lines starting with `#` that give its
 *  provenance and define its columns (most readers skip them: R `comment.char = "#"`, pandas `comment="#"`). */
export function rowTable(
  rows: readonly BatchRow[],
  provenance: BatchProvenance,
  source: BatchSource | null,
  names: GeneNames | null,
  lives: ReadonlyMap<number, Life> | null = null,
  format: TableFormat = "tsv",
): string {
  const request = provenance.request.body;
  const target = provenance.request.resolved.to_release;
  const database = request.final_database ?? "ensembl_gene";
  const own = source !== null && (source.header !== null || source.rows.some((r) => r.cells.length > 1));
  const width = own ? Math.max(1, ...source.rows.map((r) => r.cells.length), source.header?.length ?? 0) : 0;
  const ownNames = Array.from({ length: width }, (_, c) =>
    (source?.header?.[c] ?? "") !== "" ? (source?.header?.[c] ?? "") : `column_${String(c + 1)}`,
  );
  const namesColumn = names ? `names_${slug(names.database)}` : null;
  const namesOf = (gene: string) => (names?.names.get(gene) ?? []).join(",");
  const header = [
    "index",
    "line",
    ...ownNames,
    "identifier",
    "status",
    `gene_at_${String(target)}`,
    ...(database === "ensembl_gene" ? [] : [`answer_${slug(database)}`]),
    ...(namesColumn ? [namesColumn] : []),
    "score",
    "read_as",
    "match",
    "from_release",
    "from_release_how",
    "decided_by",
    "runner_up_gene",
    "runner_up_score",
    "candidates",
    "other_genes",
    ...(namesColumn ? [`other_genes_${namesColumn}`] : []),
    "history_events",
    "last_release",
    "name_at_read_release",
    "evidence",
    "evidence_words",
    "shared_with",
    "reasons",
  ];
  const lineOf = (index: number) => source?.rows[index]?.line ?? index + 1;
  const body = rows.map((row) => {
    const r = row.result;
    const cells = source?.rows[row.index]?.cells ?? [];
    const best = r.candidates.filter((c) => c.best);
    // One score per gene of the best answer, in the order of the genes (a gene's best candidate's).
    const scores = row.genes.map((g) => {
      const c = best.find((b) => b.gene === g);
      return c ? pythonFloat(c.score) : "";
    });
    const runnerUp = r.decided_by ? r.candidates.find((c) => !c.best) : undefined;
    const life = lives?.get(row.index) ?? null;
    const lifeGene = life?.genes[0];
    return [
      row.index + 1,
      lineOf(row.index),
      ...Array.from({ length: width }, (_, c) => cells[c] ?? ""),
      r.query_id,
      r.status,
      row.genes.join(";"),
      ...(database === "ensembl_gene" ? [] : [row.answers.join(";")]),
      ...(namesColumn ? [row.genes.length ? row.genes.map(namesOf).join(";") : ""] : []),
      scores.join(";"),
      r.graph_id,
      r.match,
      r.from_release,
      releaseHow(r) === "none" ? "" : releaseHow(r),
      r.decided_by,
      runnerUp?.gene ?? "",
      runnerUp ? pythonFloat(runnerUp.score) : "",
      r.candidates.length,
      row.otherGenes.join(";"),
      ...(namesColumn ? [row.otherGenes.length ? row.otherGenes.map(namesOf).join(";") : ""] : []),
      eventsWords(row.crossed),
      lifeGene?.last ?? "",
      life?.names?.join(",") ?? "",
      [...new Set(row.evidence.map((m) => m.kind))].join(";"),
      row.evidence.map((m) => plain(m.label)).join("; "),
      row.shared.map((j) => String(j + 1)).join(";"),
      r.reasons.join(";"),
    ].map((value) => cellOf(value, format));
  });
  const kinds = [...new Set(rows.flatMap((row) => row.evidence.map((m) => m.kind)))];
  const lines = [
    `# ${provenance.about}`,
    `# One row per identifier, in the order given; ${source ? sourceWords(source) : "one identifier per line."}`,
    `# organism ${provenance.organism}; idtrack ${provenance.idtrack_version ?? "unknown"} (commit ${provenance.idtrack_commit ?? "unknown"}); api ${provenance.api_version ?? "unknown"}`,
    `# graph content digest ${provenance.graph.content_digest ?? "unknown"}; snapshot release ${String(provenance.graph.snapshot_release)}; built ${provenance.graph.build_date ?? "at an unknown date"}`,
    `# request ${provenance.request.method} ${provenance.request.path} ${JSON.stringify({ ...request, identifiers: `${String(request.identifiers.length)} identifiers: the column identifier` })}; answered at release ${String(target)}${request.from_release === null ? ", each identifier read at the release inferred for it" : ""}`,
    `# answer request id ${provenance.answer.request_id ?? "none"}; answered ${provenance.answer.answered_at ?? "at an unknown time"}; exported ${provenance.exported_at}`,
    ...(provenance.source_inference
      ? [
          `# from_release ${String(provenance.source_inference.release)} as idtrack's source inference of the list gave it (POST /api/v1/organisms/${provenance.organism}/source-inference, request id ${provenance.source_inference.requestId ?? "none"}): releases ${provenance.source_inference.band.join(",")} cannot be told apart from it`,
        ]
      : []),
    ...provenance.other_requests.map(
      (o) => `# ${o.about}: request ids ${o.request_ids.map((id) => id ?? "none").join(", ")}`,
    ),
    "# index: the row's place in the list (# on the page); line: its line in what was given; shared_with: the index of every other row whose best answer shares a target with this one",
    `# score: the score of the best answer's candidate of each gene (the product of Ensembl's mapping scores along its path), as the api sends it; runner_up_gene and runner_up_score: the first candidate below the best, which decided_by compares with it`,
    ...(namesColumn && names
      ? [
          `# ${namesColumn}: the ids in ${names.database} of each gene at release ${String(target)} (genes separated by ; in the order of gene_at_${String(target)}, a gene's ids by ,), from a second request of the same endpoint with the genes as identifiers, read and answered at ${String(target)}`,
        ]
      : []),
    `# other_genes: the genes of the candidates below the best answer (the identifier leads to them too); history_events: the steps of Ensembl's history on the best answer's path, in Ensembl's direction (old release->new release)${request.explain ? "" : ", empty: the batch was answered without its paths"}`,
    "# last_release and name_at_read_release: for an identifier that converts to nothing, the last release of the gene it was at its release, and the name the organism's name authority gave it there",
    "# status, match, from_release_how, decided_by and reasons are the api's codes (GET /api/v1/vocabulary); evidence holds this page's codes of what the answer rests on beyond Ensembl's history of the identifier as written, evidence_words each in words with its values:",
    ...kinds.map((k) => `#   ${k}: ${EVIDENCE_CODES[k]}`),
    `# a cell that begins with = + - @ and is no number is written after an apostrophe, so that a spreadsheet shows it as text`,
    header.map((h) => cellOf(h, format)).join(format === "tsv" ? "\t" : ","),
    ...body.map((cells) => cells.join(format === "tsv" ? "\t" : ",")),
  ];
  return `${lines.join("\n")}\n`;
}

/** The sentence of a methods section that says what the batch did, written from the run: the number of identifiers and
 *  the organism, the releases, the database, the settings, idtrack's and the api's versions, the graph's digest, the
 *  date, and what came back. */
export function methodsSentence({
  provenance,
  organismName,
  counts,
  statusWords,
  databaseWords,
}: {
  provenance: BatchProvenance;
  organismName: string;
  counts: readonly [string, number][];
  statusWords: (status: string, n: number) => string;
  databaseWords: string;
}): string {
  const body = provenance.request.body;
  const n = body.identifiers.length;
  const from =
    body.from_release === null
      ? "each read at the release idtrack inferred for it"
      : `from Ensembl release ${String(body.from_release)}`;
  const date = (provenance.answer.answered_at ?? provenance.exported_at).slice(0, 10);
  const digest = provenance.graph.content_digest ? provenance.graph.content_digest.slice(0, 12) : "unknown";
  const outcome = counts.map(([status, count]) => statusWords(status, count)).join(", ");
  return `${String(n)} gene identifier${n === 1 ? "" : "s"} of ${organismName} were converted ${from} to Ensembl release ${String(provenance.request.resolved.to_release)} (${databaseWords}) with idtrack ${provenance.idtrack_version ?? "(version unknown)"} through its web server (api ${provenance.api_version ?? "unknown"}; graph content digest ${digest}; bridges ${body.allow_bridges ? "allowed" : "not allowed"}) on ${date}, with these statuses: ${outcome}.`;
}

/** A database's name as a part of a column's name: letters and digits, the rest as `_`. */
function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
