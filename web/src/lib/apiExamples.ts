// The api page's requests: the example of each endpoint on this server, the address the console sends, and the same
// request written for curl, Python (requests), R (httr2) and JavaScript (fetch). One description of a request makes
// all of them, so the curl line is the request the console sends (tests/apiExamples.test.ts).
import { consoleHeaders } from "../api/client";
import type { Endpoint } from "./openapi";

/** A request of one endpoint: its values as typed (text), empty values left out. */
export interface RequestSpec {
  method: string;
  /** The path as the document writes it, with `{name}` for each path parameter. */
  path: string;
  /** Every parameter's value as typed, by name (path and query). */
  values: Record<string, string>;
  /** The kinds of the query parameters, for the languages that type their values. */
  kinds: Record<string, "string" | "integer" | "number" | "boolean" | "enum">;
  /** The order of the query parameters (the document's). */
  order: string[];
  /** The path parameters' names. */
  pathNames: string[];
  /** The body as typed (JSON text), or `null` for none. */
  body: string | null;
}

/** Identifiers that exist in each organism's graph of this site's data (Ensembl 115), to make the examples run. */
export interface OrganismExample {
  /** A symbol that converts. */
  identifier: string;
  /** An Ensembl gene id with version at the snapshot release (names-of). */
  gene: string;
  /** A name an external database gives (genes-named). */
  name: string;
}

/**
 * The examples' identifiers, by organism. A server holding none of these organisms gets examples with the first
 * organism it holds and the parameters to fill in; the end-to-end tests check that every example answers.
 */
export const EXAMPLES: Record<string, OrganismExample> = {
  homo_sapiens: { identifier: "TP53", gene: "ENSG00000141510.20", name: "TP53" },
  sus_scrofa: { identifier: "HSPB1", gene: "ENSSSCG00000039962.3", name: "HSPB1" },
  mus_musculus: { identifier: "Trp53", gene: "ENSMUSG00000059552.14", name: "Trp53" },
  macaca_mulatta: { identifier: "TP53", gene: "ENSMMUG00000008639.4", name: "TP53" },
  macaca_fascicularis: { identifier: "TP53", gene: "ENSMFAG00000038506.2", name: "TP53" },
};

/** The organism the examples use: the first of EXAMPLES the server holds, else the first it holds. */
export function exampleOrganism(held: readonly string[]): { organism: string; example: OrganismExample | null } {
  const known = Object.keys(EXAMPLES).find((o) => held.includes(o));
  if (known) return { organism: known, example: EXAMPLES[known] ?? null };
  return { organism: held[0] ?? "homo_sapiens", example: null };
}

/** The example body of a batch: the example identifier, its gene without version, and a string that is no gene. */
function exampleBatchBody(example: OrganismExample | null): string {
  const ids = example ? [example.identifier, example.gene.replace(/\.\d+$/, ""), "NOT_A_GENE"] : ["<identifier>"];
  return JSON.stringify({ identifiers: ids });
}

/** The example of an endpoint: its required parameters filled with this server's example, the rest left out. */
export function exampleRequest(endpoint: Endpoint, organism: string, example: OrganismExample | null): RequestSpec {
  const values: Record<string, string> = {};
  for (const p of endpoint.parameters) {
    if (p.name === "organism") values[p.name] = organism;
    else if (!p.required) values[p.name] = "";
    else if (p.name === "identifier") values[p.name] = example?.identifier ?? "";
    else if (p.name === "gene") values[p.name] = example?.gene ?? "";
    else if (p.name === "name") values[p.name] = example?.name ?? "";
    else values[p.name] = "";
  }
  const query = endpoint.parameters.filter((p) => p.in === "query");
  return {
    method: endpoint.method,
    path: endpoint.path,
    values,
    kinds: Object.fromEntries(query.map((p) => [p.name, p.kind])),
    order: query.map((p) => p.name),
    pathNames: endpoint.parameters.filter((p) => p.in === "path").map((p) => p.name),
    body: endpoint.body ? exampleBatchBody(example) : null,
  };
}

/** The path with its parameters filled (each encoded as a path segment). */
function filledPath(spec: RequestSpec): string {
  return spec.path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(spec.values[name] ?? ""));
}

/** The query's pairs in the document's order, empty values left out (the api's defaults hold then). */
function queryPairs(spec: RequestSpec): [string, string][] {
  return spec.order.filter((name) => (spec.values[name] ?? "") !== "").map((name) => [name, spec.values[name] ?? ""]);
}

/** The full address of the request on `origin`. */
export function requestUrl(origin: string, spec: RequestSpec): string {
  const query = new URLSearchParams(queryPairs(spec)).toString();
  return `${origin}${filledPath(spec)}${query ? `?${query}` : ""}`;
}

/** What a request asks for: a table for a batch with `format=tsv`, JSON for every other. */
export function acceptOf(spec: RequestSpec): string {
  return spec.path.endsWith("/batch") && spec.values["format"] === "tsv"
    ? "text/tab-separated-values"
    : "application/json";
}

/** A word for a shell, in single quotes (a single quote inside closed, escaped and reopened). */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The request as curl: the address, the method, the headers and the body exactly as the console sends them. */
export function curl(origin: string, spec: RequestSpec): string {
  const lines = [
    `curl -sS${spec.method === "GET" ? "" : ` -X ${spec.method}`} ${shellQuote(requestUrl(origin, spec))}`,
  ];
  for (const [name, value] of Object.entries(consoleHeaders(spec.body !== null, acceptOf(spec)))) {
    lines.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (spec.body !== null) lines.push(`--data-raw ${shellQuote(spec.body)}`);
  return lines.join(" \\\n  ");
}

function parsedBody(spec: RequestSpec): { ok: true; value: unknown } | { ok: false } {
  if (spec.body === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(spec.body) as unknown };
  } catch {
    return { ok: false };
  }
}

function isInteger(text: string): boolean {
  return /^-?\d+$/.test(text);
}

const INDENT = "    ";

/** A JSON value as a Python literal. */
export function pythonLiteral(value: unknown, depth = 1): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  const pad = INDENT.repeat(depth);
  const end = INDENT.repeat(depth - 1);
  if (Array.isArray(value)) {
    const items = value.map((v) => pythonLiteral(v, depth + 1));
    const flat = `[${items.join(", ")}]`;
    return flat.length <= 72 ? flat : `[\n${items.map((i) => `${pad}${i},`).join("\n")}\n${end}]`;
  }
  if (typeof value === "object") {
    const items = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${JSON.stringify(k)}: ${pythonLiteral(v, depth + 1)}`,
    );
    const flat = `{${items.join(", ")}}`;
    return flat.length <= 72 ? flat : `{\n${items.map((i) => `${pad}${i},`).join("\n")}\n${end}}`;
  }
  return JSON.stringify(value);
}

/** A name in R: bare where it is syntactic, else between backticks with a backslash and a backtick inside escaped, so
 *  that no name a person types can become code. */
export function rName(name: string): string {
  if (/^[A-Za-z][A-Za-z0-9._]*$/.test(name)) return name;
  const escaped = name
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `\`${escaped}\``;
}

/** A JSON value as R for httr2's `req_body_json()` (jsonlite, scalars unboxed): a list for an array or object. */
export function rLiteral(value: unknown, depth = 1): string {
  if (value === null) return "NA";
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  const pad = "  ".repeat(depth + 1);
  const end = "  ".repeat(depth);
  const wrap = (items: string[]) => {
    const flat = `list(${items.join(", ")})`;
    return flat.length <= 70 ? flat : `list(\n${items.map((i) => `${pad}${i}`).join(",\n")}\n${end})`;
  };
  if (Array.isArray(value)) return wrap(value.map((v) => rLiteral(v, depth + 1)));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return "structure(list(), names = character(0))";
    return wrap(entries.map(([k, v]) => `${rName(k)} = ${rLiteral(v, depth + 1)}`));
  }
  return JSON.stringify(value);
}

function baseUrl(origin: string, spec: RequestSpec): string {
  return `${origin}${filledPath(spec)}`;
}

/** A query value in Python or R: an integer bare, every other value as the text sent. */
function scalar(spec: RequestSpec, name: string, value: string): string {
  return spec.kinds[name] === "integer" && isInteger(value) ? value : JSON.stringify(value);
}

export function python(origin: string, spec: RequestSpec): string {
  const pairs = queryPairs(spec);
  const lines = ["import requests", "", `response = requests.${spec.method.toLowerCase()}(`];
  lines.push(`    ${JSON.stringify(baseUrl(origin, spec))},`);
  if (pairs.length) {
    const items = pairs.map(([k, v]) => `${JSON.stringify(k)}: ${scalar(spec, k, v)}`);
    const flat = `{${items.join(", ")}}`;
    lines.push(
      flat.length <= 80
        ? `    params=${flat},`
        : `    params={\n${items.map((i) => `        ${i},`).join("\n")}\n    },`,
    );
  }
  const body = parsedBody(spec);
  if (body.ok) lines.push(`    json=${pythonLiteral(body.value, 2)},`);
  else if (spec.body !== null)
    lines.push(`    data=${JSON.stringify(spec.body)},`, `    headers={"Content-Type": "application/json"},`);
  lines.push("    timeout=60,", ")");
  lines.push(
    "if not response.ok:",
    '    if response.headers.get("Content-Type", "").startswith("application/json"):',
    '        error = response.json()["error"]  # the api\'s refusal: a stable code, a message for people',
    "        raise RuntimeError(f\"{error['code']}: {error['message']}\")",
    "    response.raise_for_status()  # not the api's answer (a proxy's page, for one)",
  );
  lines.push(
    spec.path.endsWith("/batch") && spec.values["format"] === "tsv"
      ? "table = response.text"
      : "answer = response.json()",
  );
  return lines.join("\n");
}

export function r(origin: string, spec: RequestSpec): string {
  const pairs = queryPairs(spec);
  const lines = ["library(httr2)", "", `answer <- request(${JSON.stringify(baseUrl(origin, spec))}) |>`];
  if (pairs.length) {
    const items = pairs.map(([k, v]) => `${rName(k)} = ${scalar(spec, k, v)}`);
    lines.push(`  req_url_query(${items.join(", ")}) |>`);
  }
  const body = parsedBody(spec);
  if (body.ok) lines.push(`  req_body_json(${rLiteral(body.value, 1)}) |>`);
  else if (spec.body !== null) lines.push(`  req_body_raw(${JSON.stringify(spec.body)}, type = "application/json") |>`);
  lines.push(
    "  # an error stops here with the api's code and message (its body: last_response())",
    '  req_error(body = \\(resp) if (grepl("json", resp_content_type(resp))) {',
    "    error <- resp_body_json(resp)$error",
    '    paste0(error$code, ": ", error$message)',
    "  }) |>",
    "  req_perform() |>",
  );
  lines.push(
    spec.path.endsWith("/batch") && spec.values["format"] === "tsv" ? "  resp_body_string()" : "  resp_body_json()",
  );
  return lines.join("\n");
}

export function javascript(origin: string, spec: RequestSpec): string {
  const pairs = queryPairs(spec);
  const lines = [`const url = new URL(${JSON.stringify(baseUrl(origin, spec))});`];
  if (pairs.length) {
    const items = pairs.map(
      ([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`,
    );
    lines.push(`url.search = new URLSearchParams({ ${items.join(", ")} }).toString();`);
  }
  const headers = Object.entries(consoleHeaders(spec.body !== null, acceptOf(spec)))
    .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(", ");
  const body = parsedBody(spec);
  const options = [
    ...(spec.method === "GET" ? [] : [`method: ${JSON.stringify(spec.method)}`]),
    `headers: { ${headers} }`,
    ...(body.ok
      ? [`body: JSON.stringify(${JSON.stringify(body.value, null, 2).replace(/\n/g, "\n  ")})`]
      : spec.body !== null
        ? [`body: ${JSON.stringify(spec.body)}`]
        : []),
  ];
  lines.push(`const response = await fetch(url, {\n  ${options.join(",\n  ")},\n});`);
  const tsv = spec.path.endsWith("/batch") && spec.values["format"] === "tsv";
  lines.push(
    "if (!response.ok) {",
    "  // The api's refusal is JSON with a stable code; anything else (a proxy's page) is said by its status.",
    '  if (!(response.headers.get("Content-Type") ?? "").startsWith("application/json"))',
    "    throw new Error(`${response.status} ${response.statusText}`);",
    "  const { error } = await response.json();",
    "  throw new Error(`${error.code}: ${error.message}`);",
    "}",
    tsv ? "const answer = await response.text();" : "const answer = await response.json();",
  );
  return lines.join("\n");
}

export const LANGUAGES = [
  { key: "curl", label: "curl", write: curl },
  { key: "python", label: "Python", write: python },
  { key: "r", label: "R", write: r },
  { key: "javascript", label: "JavaScript", write: javascript },
] as const;
