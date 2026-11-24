// The one place the frontend talks to the api. Every answer is read as the api sent it: the parsed JSON for the
// views, and the raw text beside it, so that what is exported or shown "as sent" is the api's own bytes.
import type {
  BatchRequest,
  BatchResponse,
  ConversionResult,
  ConvertQuery,
  ErrorBody,
  FinalDatabasesResponse,
  GraphDescription,
  HealthResponse,
  LimitsResponse,
  NamesResponse,
  OrganismsResponse,
  VersionResponse,
  VocabularyResponse,
} from "./types";

/** Where the api is: the same origin as the page (the api serves the built frontend, or Vite forwards /api). */
export const API_BASE = "/api/v1";

/** How long the browser waits for an answer before it gives up (the api's own budgets are shorter). */
const TIMEOUT_MS = 120_000;

export interface Answer<T> {
  data: T;
  /** The body as the api sent it. */
  raw: string;
  requestId: string | null;
}

/** The api answered with an error (`{"error": {...}}`). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;
  readonly retryAfter: number | null;
  constructor(status: number, body: ErrorBody, retryAfter: number | null) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

/** No answer from the api: the network, the server down, or a proxy in front of it answering for it. */
export class UnreachableError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "UnreachableError";
    this.status = status;
  }
}

/** The browser stopped waiting (TIMEOUT_MS). */
export class TimeoutError extends Error {
  constructor() {
    super(`The api did not answer within ${TIMEOUT_MS / 1000} seconds.`);
    this.name = "TimeoutError";
  }
}

/** An answer that is not what the api's document promises (a fault, never expected). */
export class UnexpectedAnswerError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UnexpectedAnswerError";
    this.status = status;
  }
}

export type AnyRequestError = ApiError | UnreachableError | TimeoutError | UnexpectedAnswerError;

export function isRequestError(error: unknown): error is AnyRequestError {
  return (
    error instanceof ApiError ||
    error instanceof UnreachableError ||
    error instanceof TimeoutError ||
    error instanceof UnexpectedAnswerError
  );
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

type QueryValue = string | number | boolean | null | undefined;

/** The query string: values that are `null`, `undefined` or `""` are left out (the api's defaults hold then). */
export function queryString(query: Record<string, QueryValue>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    parameters.set(key, String(value));
  }
  const text = parameters.toString();
  return text ? `?${text}` : "";
}

function isErrorBody(value: unknown): value is { error: ErrorBody } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** `json` (default) parses the body; `text` keeps it as text (a TSV). */
  expect?: "json" | "text";
}

async function request(path: string, options: RequestOptions = {}): Promise<Answer<unknown>> {
  const url = API_BASE + path + queryString(options.query ?? {});
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const init: RequestInit = { method: options.method ?? "GET", signal, headers: { Accept: "application/json" } };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { Accept: "application/json", "Content-Type": "application/json" };
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (options.signal?.aborted) throw error; // the caller cancelled: not an error to show
    if (timeout.aborted) throw new TimeoutError();
    throw new UnreachableError("The api cannot be reached.");
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timeout.aborted) throw new TimeoutError();
    throw new UnreachableError("The connection to the api broke while it answered.", response.status);
  }
  const requestId = response.headers.get("x-request-id");
  const isJson = (response.headers.get("content-type") ?? "").startsWith("application/json");
  if (!response.ok) {
    let parsed: unknown = null;
    if (isJson) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    if (isErrorBody(parsed)) {
      const retry = Number(response.headers.get("retry-after"));
      throw new ApiError(response.status, parsed.error, Number.isFinite(retry) && retry > 0 ? retry : null);
    }
    // Not the api's own error: a proxy or gateway answered because the api did not.
    if ([502, 503, 504].includes(response.status) || !requestId) {
      throw new UnreachableError(`The server in front of the api answered ${response.status}.`, response.status);
    }
    throw new UnexpectedAnswerError(`The api answered ${response.status} without an error body.`, response.status);
  }
  if (options.expect === "text") return { data: raw, raw, requestId };
  if (!isJson) {
    throw new UnexpectedAnswerError("The api answered with something that is not JSON.", response.status);
  }
  try {
    return { data: JSON.parse(raw) as unknown, raw, requestId };
  } catch {
    throw new UnexpectedAnswerError("The api's answer is not valid JSON.", response.status);
  }
}

const organismPath = (organism: string) => `/organisms/${encodeURIComponent(organism)}`;

export const api = {
  health: (signal?: AbortSignal) => request("/health", { signal }) as Promise<Answer<HealthResponse>>,
  version: (signal?: AbortSignal) => request("/version", { signal }) as Promise<Answer<VersionResponse>>,
  vocabulary: (signal?: AbortSignal) => request("/vocabulary", { signal }) as Promise<Answer<VocabularyResponse>>,
  limits: (signal?: AbortSignal) => request("/limits", { signal }) as Promise<Answer<LimitsResponse>>,
  organisms: (signal?: AbortSignal) => request("/organisms", { signal }) as Promise<Answer<OrganismsResponse>>,
  organism: (organism: string, signal?: AbortSignal) =>
    request(organismPath(organism), { signal }) as Promise<Answer<GraphDescription>>,
  finalDatabases: (organism: string, toRelease: number | null, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/final-databases`, { query: { to_release: toRelease }, signal }) as Promise<
      Answer<FinalDatabasesResponse>
    >,
  convert: (organism: string, query: ConvertQuery, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/convert`, { query: { ...query }, signal }) as Promise<Answer<ConversionResult>>,
  batch: (organism: string, body: BatchRequest, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/convert/batch`, {
      method: "POST",
      query: { format: "json" },
      body,
      signal,
    }) as Promise<Answer<BatchResponse>>,
  batchTsv: (organism: string, body: BatchRequest, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/convert/batch`, {
      method: "POST",
      query: { format: "tsv" },
      body,
      signal,
      expect: "text",
    }) as Promise<Answer<string>>,
  genesNamed: (organism: string, name: string, foldCase: boolean, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/genes-named`, { query: { name, fold_case: foldCase }, signal }) as Promise<
      Answer<NamesResponse>
    >,
  namesOf: (organism: string, gene: string, release: number | null, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/names-of`, { query: { gene, release }, signal }) as Promise<
      Answer<NamesResponse>
    >,
};
