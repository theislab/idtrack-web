// The api's OpenAPI document, read for the api page: every endpoint with its parameters, its body and its answers,
// and the fields of each schema, as the document gives them. Nothing here is a copy of the document: the page reads
// it live from `GET /api/v1/openapi.json`.

/** The parts of an OpenAPI 3.1 document the page reads (everything else is ignored, never required). */
export interface Schema {
  $ref?: string;
  type?: string | string[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  title?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  example?: unknown;
  examples?: unknown[];
}

interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
}

interface MediaObject {
  schema?: Schema;
  example?: unknown;
}

interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: { required?: boolean; description?: string; content?: Record<string, MediaObject> };
  responses?: Record<string, ResponseObject>;
}

interface ResponseObject {
  $ref?: string;
  description?: string;
  content?: Record<string, MediaObject>;
  "x-error-codes"?: string[];
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; summary?: string; description?: string };
  paths?: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, Schema>; responses?: Record<string, ResponseObject> };
}

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  /** The type in words of the document's schema: `integer`, `string`, `"json" | "tsv"`, `boolean`. */
  type: string;
  /** The schema's own type, for the console's control: a boolean is a choice, an integer a number field. */
  kind: "string" | "integer" | "number" | "boolean" | "enum";
  nullable: boolean;
  enumValues: string[];
  default: unknown;
  /** The bounds the document states (`1 ≤ value ≤ 100000`, `at most 100 characters`). */
  bounds: string | null;
  description: string;
}

interface Answer {
  status: string;
  description: string;
  contentTypes: string[];
  /** The schema's name (`ConversionResult`), where the answer is a named schema. */
  schema: string | null;
  /** The error codes this endpoint answers with this status (`x-error-codes`), in the document's order. */
  codes: string[];
  /** A recorded answer of this api, where the document holds one (JSON as it came). */
  example: unknown;
}

export interface Endpoint {
  method: string;
  path: string;
  /** `method path`: the endpoint's key on the page (its anchor). */
  key: string;
  anchor: string;
  operationId: string | null;
  summary: string;
  description: string;
  tag: string;
  parameters: Parameter[];
  body: { schema: string | null; contentType: string; required: boolean } | null;
  answers: Answer[];
}

export interface Field {
  name: string;
  type: string;
  required: boolean;
  description: string;
  /** The named schemas this field holds (an object, or a list of them), to be read below it. */
  refs: string[];
}

const METHODS = ["get", "put", "post", "delete", "patch", "options", "head"];

/** The name of a schema reference (`#/components/schemas/Candidate` → `Candidate`). */
function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/** The schema behind a reference of the document. */
function resolve(document: OpenApiDocument, schema: Schema): Schema {
  if (!schema.$ref) return schema;
  return document.components?.schemas?.[refName(schema.$ref)] ?? {};
}

function literal(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

/** A schema's type in words, as the document states it: `integer | null`, `list of Candidate`, `"json" | "tsv"`. */
export function typeText(schema: Schema | undefined): string {
  if (!schema) return "any";
  if (schema.$ref) return refName(schema.$ref);
  if (schema.enum) return schema.enum.map(literal).join(" | ");
  if (schema.const !== undefined) return literal(schema.const);
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return union.map(typeText).join(" | ");
  if (schema.allOf?.length === 1) return typeText(schema.allOf[0]);
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") return `list of ${typeText(schema.items)}`;
  if (schema.type === "object" && typeof schema.additionalProperties === "object")
    return `map of string to ${typeText(schema.additionalProperties)}`;
  return schema.type ?? "any";
}

/** The named schemas a schema holds directly (itself, its list's items, the members of its union). */
function refsOf(schema: Schema | undefined): string[] {
  if (!schema) return [];
  if (schema.$ref) return [refName(schema.$ref)];
  const parts = [
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.allOf ?? []),
    ...(schema.items ? [schema.items] : []),
    ...(typeof schema.additionalProperties === "object" ? [schema.additionalProperties] : []),
  ];
  return [...new Set(parts.flatMap(refsOf))];
}

/** The members of a union that are not `null` (a parameter `integer | null` is an integer that may be left out). */
function nonNull(schema: Schema): Schema[] {
  const union = schema.anyOf ?? schema.oneOf;
  if (!union) return [schema];
  return union.filter((s) => s.type !== "null");
}

function boundsText(schemas: Schema[]): string | null {
  const parts: string[] = [];
  for (const s of schemas) {
    if (s.minimum !== undefined && s.maximum !== undefined) parts.push(`${s.minimum} to ${s.maximum}`);
    else if (s.minimum !== undefined) parts.push(`at least ${s.minimum}`);
    else if (s.maximum !== undefined) parts.push(`at most ${s.maximum}`);
    if (s.maxLength !== undefined) parts.push(`at most ${s.maxLength} characters`);
    if (s.minLength !== undefined && s.minLength > 0) parts.push(`at least ${s.minLength} characters`);
  }
  return parts.length ? parts.join("; ") : null;
}

function parameterOf(p: ParameterObject): Parameter {
  const schema = p.schema ?? {};
  const members = nonNull(schema);
  const nullable = members.length < (schema.anyOf ?? schema.oneOf ?? [schema]).length;
  const main = members[0] ?? {};
  const enumValues = (main.enum ?? []).map(String);
  const t = Array.isArray(main.type) ? main.type[0] : main.type;
  const kind: Parameter["kind"] = enumValues.length
    ? "enum"
    : t === "integer" || t === "number" || t === "boolean"
      ? t
      : "string";
  return {
    name: p.name,
    in: (["path", "query", "header", "cookie"].includes(p.in) ? p.in : "query") as Parameter["in"],
    required: p.required === true,
    type: members.map(typeText).join(" | ") || "any",
    kind,
    nullable,
    enumValues,
    default: schema.default,
    bounds: boundsText(members),
    description: p.description ?? schema.description ?? "",
  };
}

/** An anchor for an endpoint: `get-organisms-organism-convert`. */
export function anchorOf(method: string, path: string): string {
  const rest = path
    .replace(/^\/api\/v\d+/, "")
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${method.toLowerCase()}-${rest || "root"}`;
}

/** Every endpoint of the document, in the document's order. */
export function endpoints(document: OpenApiDocument): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const media = Object.entries(op.requestBody?.content ?? {});
      const [contentType = "application/json", bodyMedia] = media[0] ?? [];
      out.push({
        method: method.toUpperCase(),
        path,
        key: `${method.toUpperCase()} ${path}`,
        anchor: anchorOf(method, path),
        operationId: op.operationId ?? null,
        summary: op.summary ?? "",
        description: op.description ?? "",
        tag: op.tags?.[0] ?? "other",
        parameters: (op.parameters ?? []).map(parameterOf),
        body: op.requestBody
          ? {
              schema: bodyMedia?.schema?.$ref ? refName(bodyMedia.schema.$ref) : null,
              contentType,
              required: op.requestBody.required === true,
            }
          : null,
        answers: Object.entries(op.responses ?? {})
          .map(([status, given]) => {
            // A refusal the document writes once and refers to (`components/responses`).
            const r = given.$ref ? (document.components?.responses?.[refName(given.$ref)] ?? {}) : given;
            const contents = Object.entries(r.content ?? {});
            const json = contents.find(([type]) => type === "application/json")?.[1] ?? contents[0]?.[1];
            return {
              status,
              description: r.description ?? "",
              contentTypes: contents.map(([type]) => type),
              schema: json?.schema?.$ref ? refName(json.schema.$ref) : null,
              codes: r["x-error-codes"] ?? [],
              example: json?.example,
            };
          })
          .sort((a, b) => a.status.localeCompare(b.status)),
      });
    }
  }
  return out;
}

/** The groups of the page, in this order; a tag the page does not know is a group of its own after them. */
const GROUPS: { tag: string; title: string; about: string }[] = [
  { tag: "conversion", title: "Conversion", about: "One identifier, or a batch, to a release and a database." },
  { tag: "names", title: "Names", about: "The genes a name of an external database names, and the names of a gene." },
  {
    tag: "organisms",
    title: "Graphs",
    about: "What each organism's graph holds: releases, assemblies, databases, its build.",
  },
  {
    tag: "server",
    title: "Server",
    about: "Health, load, versions, the meaning of every code, and the bounds.",
  },
];

export function grouped(list: Endpoint[]): { tag: string; title: string; about: string; endpoints: Endpoint[] }[] {
  const known = GROUPS.map((g) => ({ ...g, endpoints: list.filter((e) => e.tag === g.tag) }));
  const others = [...new Set(list.map((e) => e.tag))]
    .filter((t) => !GROUPS.some((g) => g.tag === t))
    .sort()
    .map((tag) => ({
      tag,
      title: tag.charAt(0).toUpperCase() + tag.slice(1),
      about: "",
      endpoints: list.filter((e) => e.tag === tag),
    }));
  return [...known, ...others].filter((g) => g.endpoints.length);
}

/** The fields of a named schema, in the document's order. */
export function fieldsOf(document: OpenApiDocument, name: string): Field[] {
  const schema = document.components?.schemas?.[name];
  if (!schema?.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([field, s]) => ({
    name: field,
    type: typeText(s),
    required: required.has(field),
    description: s.description ?? resolve(document, s).description ?? "",
    refs: refsOf(s),
  }));
}

/** A named schema's own description. */
export function schemaDescription(document: OpenApiDocument, name: string): string {
  return document.components?.schemas?.[name]?.description ?? "";
}

/** An endpoint's path in the contents: without the base, and "…" for the organism's part of a longer path. */
export function tocPath(path: string): string {
  const rest = path.replace(/^\/api\/v\d+/, "") || "/";
  return rest.startsWith("/organisms/{organism}/") ? rest.replace("/organisms/{organism}", "…") : rest;
}
