// The one place the frontend talks to the api. Every answer is read as the api sent it: the parsed JSON for the
// views, and the raw text beside it, so that what is exported or shown "as sent" is the api's own bytes. Every JSON
// answer is checked against the shape the api's document gives it before a page reads it (./shape.ts), so that an
// answer of another form is a stated fault, never a page that breaks. Answers that are pure functions of the graph and
// the arguments (everything but /health, /status and the batch) are asked once per page session and shared: two views
// that need one answer make one request, and a view seen again is drawn from the answer already held.
import { RESPONSES } from "./shapes";
import { shapeProblem, type Shape } from "./shape";
import type {
  BatchRequest,
  BatchResponse,
  ConversionResult,
  ConvertQuery,
  ErrorBody,
  DatabasesResponse,
  FinalDatabasesResponse,
  GraphDescription,
  HealthResponse,
  HistoryResponse,
  LimitsResponse,
  ShowcaseResponse,
  SourceInferenceRequest,
  SourceInferenceResponse,
  StatusResponse,
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
  /** The answer's `Server-Timing` header as sent (the server's own times, in ms; lib/serverTiming.ts reads it), or
   *  null when the answer has none. */
  serverTiming: string | null;
}

/** The api answered with an error (`{"error": {...}}`). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;
  /** The seconds the api asks to wait before asking again (`Retry-After`), or null. */
  readonly retryAfter: number | null;
  /** When the refusal arrived (`Date.now()`), from which the wait of `retryAfter` is counted. */
  readonly receivedAt: number;
  constructor(status: number, body: ErrorBody, retryAfter: number | null) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
    this.receivedAt = Date.now();
  }
}

/** No answer from the api: the browser offline, the network, the server down, or a proxy answering for it. */
export class UnreachableError extends Error {
  readonly status: number | null;
  /** The browser said it was offline when the request failed (`navigator.onLine`). */
  readonly offline: boolean;
  constructor(message: string, status: number | null = null, offline = false) {
    super(message);
    this.name = "UnreachableError";
    this.status = status;
    this.offline = offline;
  }
}

/** The browser says it has no network (`navigator.onLine` is false). */
export function browserOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
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
  /** The request whose answer it was (`x-request-id`), when the api named it. */
  readonly requestId: string | null;
  constructor(message: string, status: number, requestId: string | null = null) {
    super(message);
    this.name = "UnexpectedAnswerError";
    this.status = status;
    this.requestId = requestId;
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
  /** The shape the parsed answer must have (default: the document's shape of the endpoint, `endpoint`). */
  shape?: Shape;
  /** The endpoint as the document names it (`GET /organisms/{organism}`), whose shape the answer is checked against. */
  endpoint?: string;
  /** `no-cache`: the browser asks the api again (revalidating its copy by its ETag) rather than answer from its cache. */
  cache?: RequestCache;
}

/** The fault of an answer whose form is not the endpoint's (null: it has the form). */
function answerProblem(data: unknown, options: RequestOptions): string | null {
  const shape = options.shape ?? (options.endpoint ? RESPONSES[options.endpoint] : undefined);
  if (!shape) return null;
  const problem = shapeProblem(data, shape);
  return problem === null
    ? null
    : `The answer of ${options.endpoint ?? "the api"} is not of the form its document gives: ${problem}.`;
}

async function request(path: string, options: RequestOptions = {}): Promise<Answer<unknown>> {
  const url = API_BASE + path + queryString(options.query ?? {});
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const init: RequestInit = { method: options.method ?? "GET", signal, headers: { Accept: "application/json" } };
  if (options.cache) init.cache = options.cache;
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
    if (browserOffline()) throw new UnreachableError("The browser is offline.", null, true);
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
  const serverTiming = response.headers.get("server-timing");
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
  if (options.expect === "text") return { data: raw, raw, requestId, serverTiming };
  if (!isJson) {
    throw new UnexpectedAnswerError("The api answered with something that is not JSON.", response.status, requestId);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new UnexpectedAnswerError("The api's answer is not valid JSON.", response.status, requestId);
  }
  const problem = answerProblem(data, options);
  if (problem !== null) throw new UnexpectedAnswerError(problem, response.status, requestId);
  return { data, raw, requestId, serverTiming };
}

// The answers held for the page session: each by its address, shared by every view that asks while it is on its way
// and kept once it came (the oldest let go beyond MAX_HELD answers or MAX_HELD_BYTES of text). A request is cancelled
// only when every view that waited for it has gone.
interface Held {
  promise: Promise<Answer<unknown>>;
  controller: AbortController;
  waiting: number;
  settled: boolean;
  bytes: number;
}

const held = new Map<string, Held>();
const MAX_HELD = 64;
const MAX_HELD_BYTES = 24 * 1024 * 1024;

function letGoOfOldest(): void {
  let bytes = 0;
  for (const entry of held.values()) bytes += entry.bytes;
  for (const [key, entry] of held) {
    if (held.size <= MAX_HELD && bytes <= MAX_HELD_BYTES) break;
    if (!entry.settled) continue;
    held.delete(key);
    bytes -= entry.bytes;
  }
}

/** The id of the block of answers the server writes into the page it sends (`/organisms`, `/version`, `/vocabulary`,
 *  `/limits`: a JSON object of each address and the answer's text as the api sends it). */
export const PRELOAD_ID = "idtrack-preload";

/** Hold the answers the server wrote into the page, as if asked already: the first paint waits for no request of
 *  the api. An answer that is not of its endpoint's form is left to be asked as any other. */
export function holdPreloaded(
  root: Pick<Document, "getElementById"> | null = typeof document === "undefined" ? null : document,
): number {
  const text = root?.getElementById(PRELOAD_ID)?.textContent;
  if (!text) return 0;
  let texts: unknown;
  try {
    texts = JSON.parse(text);
  } catch {
    return 0;
  }
  if (typeof texts !== "object" || texts === null) return 0;
  let count = 0;
  for (const [key, raw] of Object.entries(texts as Record<string, unknown>)) {
    if (typeof raw !== "string" || !key.startsWith(API_BASE) || held.has(key)) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (answerProblem(data, { endpoint: `GET ${key.slice(API_BASE.length)}` }) !== null) continue;
    const answer: Answer<unknown> = { data, raw, requestId: null, serverTiming: null };
    held.set(key, {
      promise: Promise.resolve(answer),
      controller: new AbortController(),
      waiting: 0,
      settled: true,
      bytes: raw.length,
    });
    count += 1;
  }
  return count;
}

holdPreloaded();

/** Forget every answer held (when the server's graphs changed, so that nothing of the earlier graphs is shown). */
export function forgetAnswers(): void {
  for (const entry of held.values()) if (!entry.settled) entry.controller.abort();
  held.clear();
}

/** The number of answers held (for the tests). */
export function heldAnswers(): number {
  return held.size;
}

interface ShareOptions {
  signal?: AbortSignal | undefined;
  /** Ask the api again even when its answer is held (a retry, or the person asked again on purpose). */
  fresh?: boolean | undefined;
}

/** A GET whose answer is shared and held: see above. `keep` says whether an answer is worth holding (a conversion
 *  that ended in an error of its own, a time budget for example, is asked again next time). */
function shared(
  key: string,
  run: (signal: AbortSignal) => Promise<Answer<unknown>>,
  { signal, fresh }: ShareOptions,
  keep: (answer: Answer<unknown>) => boolean = () => true,
): Promise<Answer<unknown>> {
  let entry = held.get(key);
  if (entry && fresh) {
    if (!entry.settled && entry.waiting > 0) {
      // A request for it is on its way and others wait for it: asking again would only repeat it.
    } else {
      held.delete(key);
      entry = undefined;
    }
  }
  if (!entry) {
    const controller = new AbortController();
    const created: Held = { controller, waiting: 0, settled: false, bytes: 0, promise: Promise.resolve(null as never) };
    created.promise = run(controller.signal).then(
      (answer) => {
        created.settled = true;
        if (held.get(key) === created) {
          if (keep(answer)) {
            created.bytes = answer.raw.length;
            letGoOfOldest();
          } else held.delete(key);
        }
        return answer;
      },
      (error: unknown) => {
        if (held.get(key) === created) held.delete(key);
        throw error;
      },
    );
    // A request nobody waits for any more ends in an AbortError that no view reads.
    created.promise.catch(() => undefined);
    held.set(key, created);
    entry = created;
  } else {
    // The most recently used last, so that the oldest is let go first.
    held.delete(key);
    held.set(key, entry);
  }
  const current = entry;
  if (current.settled) return current.promise;
  current.waiting += 1;
  return new Promise<Answer<unknown>>((resolve, reject) => {
    let done = false;
    const leave = () => {
      if (done) return false;
      done = true;
      current.waiting -= 1;
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    function onAbort() {
      if (!leave()) return;
      if (current.waiting === 0 && !current.settled) {
        current.controller.abort();
        if (held.get(key) === current) held.delete(key);
      }
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    current.promise.then(
      (answer) => {
        if (leave()) resolve(answer);
      },
      (error: unknown) => {
        if (leave()) reject(error instanceof Error || error instanceof DOMException ? error : new Error(String(error)));
      },
    );
  });
}

/** A GET of the api, checked against its endpoint's shape, shared and held. */
function get<T>(
  path: string,
  endpoint: string,
  share: ShareOptions,
  extra: { query?: Record<string, QueryValue>; shape?: Shape; keep?: (answer: Answer<T>) => boolean } = {},
): Promise<Answer<T>> {
  const key = API_BASE + path + queryString(extra.query ?? {});
  const options: RequestOptions = { endpoint };
  if (extra.query) options.query = extra.query;
  if (extra.shape) options.shape = extra.shape;
  // Asked again on purpose (a retry): past the browser's own cache too, so that a changed answer is seen.
  return shared(
    key,
    (signal) => request(path, { ...options, signal, ...(share.fresh ? { cache: "no-cache" as const } : {}) }),
    share,
    extra.keep as ((answer: Answer<unknown>) => boolean) | undefined,
  ) as Promise<Answer<T>>;
}

const organismPath = (organism: string) => `/organisms/${encodeURIComponent(organism)}`;

/** The home's figures of one graph and their queries: the api's schemas (`GET /organisms/{organism}/showcase`). */
export type { ShowcaseQuery, ShowcaseResponse } from "./types";

const SHOWCASE_ENDPOINT = "GET /organisms/{organism}/showcase";
const showcaseQueryShape: Shape = {
  o: { identifier: "string" },
  opt: {
    from_release: { u: ["integer", "null"] },
    to_release: { u: ["integer", "null"] },
    final_database: { u: ["string", "null"] },
    explain: "boolean",
  },
};
/** The showcase's shape: the document's once the api describes the endpoint, else the form its answer is made in. */
const SHOWCASE_SHAPE: Shape = RESPONSES[SHOWCASE_ENDPOINT] ?? {
  o: {
    organism: "string",
    journeys: { a: { o: { query: showcaseQueryShape, result: { r: "ConversionResult" } } } },
    cases: { a: { o: { kind: "string", query: showcaseQueryShape, result: { r: "ConversionResult" } } } },
  },
  opt: { content_digest: { u: ["string", "null"] } },
};

/** A conversion that ended in an error of its own (a time budget, for example) is asked again, not held. */
const keepConversion = (answer: Answer<ConversionResult>) => answer.data.status !== "error";

type Share = ShareOptions | AbortSignal | undefined;
/** The options of a shared GET from a signal (the views' older form) or the options themselves. */
const share = (value: Share): ShareOptions => (value instanceof AbortSignal ? { signal: value } : (value ?? {}));

export const api = {
  health: (signal?: AbortSignal) =>
    request("/health", { signal, endpoint: "GET /health" }) as Promise<Answer<HealthResponse>>,
  status: (signal?: AbortSignal) =>
    request("/status", { signal, endpoint: "GET /status" }) as Promise<Answer<StatusResponse>>,
  /** The api's OpenAPI document, as it serves it (the api page reads every endpoint from it). */
  openapi: (options?: Share) => get<unknown>("/openapi.json", "GET /openapi.json", share(options), { shape: "object" }),
  version: (options?: Share) => get<VersionResponse>("/version", "GET /version", share(options)),
  vocabulary: (options?: Share) => get<VocabularyResponse>("/vocabulary", "GET /vocabulary", share(options)),
  limits: (options?: Share) => get<LimitsResponse>("/limits", "GET /limits", share(options)),
  organisms: (options?: Share) => get<OrganismsResponse>("/organisms", "GET /organisms", share(options)),
  organism: (organism: string, options?: Share) =>
    get<GraphDescription>(organismPath(organism), "GET /organisms/{organism}", share(options)),
  finalDatabases: (organism: string, toRelease: number | null, options?: Share) =>
    get<FinalDatabasesResponse>(
      `${organismPath(organism)}/final-databases`,
      "GET /organisms/{organism}/final-databases",
      share(options),
      { query: { to_release: toRelease } },
    ),
  databases: (organism: string, options?: Share) =>
    get<DatabasesResponse>(
      `${organismPath(organism)}/databases`,
      "GET /organisms/{organism}/databases",
      share(options),
    ),
  convert: (organism: string, query: ConvertQuery, options?: Share) =>
    get<ConversionResult>(`${organismPath(organism)}/convert`, "GET /organisms/{organism}/convert", share(options), {
      query: { ...query },
      keep: keepConversion,
    }),
  /** The home's figures of a graph, from one answer the server computed once. */
  showcase: (organism: string, options?: Share) =>
    get<ShowcaseResponse>(`${organismPath(organism)}/showcase`, SHOWCASE_ENDPOINT, share(options), {
      shape: SHOWCASE_SHAPE,
    }),
  /** Ensembl's gene id history in a graph, counted once by the server. */
  history: (organism: string, options?: Share) =>
    get<HistoryResponse>(`${organismPath(organism)}/history`, "GET /organisms/{organism}/history", share(options)),
  batch: (organism: string, body: BatchRequest, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/convert/batch`, {
      method: "POST",
      query: { format: "json" },
      body,
      signal,
      endpoint: "POST /organisms/{organism}/convert/batch",
    }) as Promise<Answer<BatchResponse>>,
  sourceInference: (organism: string, body: SourceInferenceRequest, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/source-inference`, {
      method: "POST",
      body,
      signal,
      endpoint: "POST /organisms/{organism}/source-inference",
    }) as Promise<Answer<SourceInferenceResponse>>,
  batchTsv: (organism: string, body: BatchRequest, signal?: AbortSignal) =>
    request(`${organismPath(organism)}/convert/batch`, {
      method: "POST",
      query: { format: "tsv" },
      body,
      signal,
      expect: "text",
    }) as Promise<Answer<string>>,
  genesNamed: (organism: string, name: string, foldCase: boolean, options?: Share) =>
    get<NamesResponse>(
      `${organismPath(organism)}/genes-named`,
      "GET /organisms/{organism}/genes-named",
      share(options),
      {
        query: { name, fold_case: foldCase },
      },
    ),
  namesOf: (organism: string, gene: string, release: number | null, options?: Share) =>
    get<NamesResponse>(`${organismPath(organism)}/names-of`, "GET /organisms/{organism}/names-of", share(options), {
      query: { gene, release },
    }),
};

/** A request of the api page's console, answered whatever its status: what was sent and what came back, as sent. */
export interface Exchange {
  status: number;
  statusText: string;
  contentType: string | null;
  requestId: string | null;
  serverTiming: string | null;
  retryAfter: string | null;
  /** The body as the api sent it (decoded as UTF-8). */
  raw: string;
  /** The body's size in bytes, as received (after any decompression of the wire). */
  bytes: number;
  /** Milliseconds from sending to the last byte, measured by the browser. */
  elapsedMs: number;
}

/** The headers the console sends: JSON is asked for; a body is JSON. The api page's curl lines say the same. */
export function consoleHeaders(hasBody: boolean, accept = "application/json"): Record<string, string> {
  return hasBody ? { Accept: accept, "Content-Type": "application/json" } : { Accept: accept };
}

/** Send one request exactly as given (the api page's "Try it"): any status is an answer; only no answer is an error. */
export async function send(
  method: string,
  url: string,
  body: string | null,
  signal?: AbortSignal,
  accept = "application/json",
): Promise<Exchange> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const init: RequestInit = { method, signal: combined, headers: consoleHeaders(body !== null, accept) };
  if (body !== null) init.body = body;
  const started = performance.now();
  let response: Response;
  let buffer: ArrayBuffer;
  try {
    response = await fetch(url, init);
    buffer = await response.arrayBuffer();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new TimeoutError();
    throw new UnreachableError("The api cannot be reached.");
  }
  const elapsedMs = performance.now() - started;
  return {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    requestId: response.headers.get("x-request-id"),
    serverTiming: response.headers.get("server-timing"),
    retryAfter: response.headers.get("retry-after"),
    raw: new TextDecoder("utf-8").decode(buffer),
    bytes: buffer.byteLength,
    elapsedMs,
  };
}
