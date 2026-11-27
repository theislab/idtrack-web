// One endpoint of the api, read from the OpenAPI document: method and path, what it answers, its parameters (each a
// line, the rest of its text on demand), its body, its answers (folded to one line) with their fields and, for a
// table, its columns; beside it the request in four languages, a recorded answer and a console that sends it.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isAbort, send, type Exchange } from "../../api/client";
import { announce } from "../../lib/announce";
import { acceptOf, requestUrl, type RequestSpec } from "../../lib/apiExamples";
import { rawValueAt } from "../../lib/jsonView";
import {
  fieldsOf,
  firstSentence,
  schemaDescription,
  type Endpoint,
  type Media,
  type OpenApiDocument,
  type Parameter,
} from "../../lib/openapi";
import { Button, Mono, Prose } from "../ui";
import { CodeTabs } from "./CodeTabs";
import { ExchangeView, JsonText, TsvTable } from "./Exchange";

/** The releases of the graph the page's examples ask, to say where a release argument's accepted values lie. */
export interface ReleaseRange {
  organism: string;
  first: number;
  last: number;
}

const PHONE = "(max-width: 640px)";

function onPhoneChange(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

/** Whether the window is a phone's: there an endpoint's request opens on demand, so the reference reads quickly. */
function usePhone(): boolean {
  return useSyncExternalStore(
    onPhoneChange,
    () => typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches,
    () => false,
  );
}

/** A count and its noun, singular for one: "1 field", "4 fields". */
function counted(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A disclosure whose content is made on its first opening (the fields of a large schema are many). */
export function LazyDetails({
  summary,
  children,
  className,
}: {
  summary: ReactNode;
  children: () => ReactNode;
  className: string;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>{summary}</summary>
      {opened ? children() : null}
    </details>
  );
}

/** The path with its parameters set apart. */
function PathText({ path }: { path: string }) {
  const parts = path.split(/(\{[^}]+\})/);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("{") ? (
          <span key={i} className="endpoint__param">
            {part}
          </span>
        ) : (
          <span key={i}>
            {part.split("/").map((segment, j) => (
              <span key={j}>
                {j ? (
                  <>
                    /<wbr />
                  </>
                ) : null}
                {segment}
              </span>
            ))}
          </span>
        ),
      )}
    </>
  );
}

function defaultText(value: unknown): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRelease(p: Parameter): boolean {
  return p.kind === "integer" && (p.name === "release" || p.name.endsWith("_release"));
}

/** A parameter's facts beyond its text: its default, and the values it takes (this server's releases for a release). */
function ParameterMeta({ p, releases }: { p: Parameter; releases: ReleaseRange | null }) {
  const d = defaultText(p.default);
  const graph = isRelease(p) && releases !== null;
  if (d === null && !p.bounds && !graph) return null;
  return (
    <span className="params__meta">
      {d !== null ? (
        <>
          Default <Mono>{d}</Mono>.
        </>
      ) : null}{" "}
      {graph ? (
        <>
          This server&apos;s <Mono>{releases.organism}</Mono> graph covers releases <Mono>{releases.first}</Mono> to{" "}
          <Mono>{releases.last}</Mono> (<Mono>GET /organisms/{releases.organism}</Mono>, <Mono>releases</Mono>).
        </>
      ) : p.bounds ? (
        <>Accepts {p.bounds}.</>
      ) : null}
    </span>
  );
}

/** Each parameter on one line (name, type, required, where, the first sentence of its text); the rest on demand. */
function ParameterRows({ parameters, releases }: { parameters: Parameter[]; releases: ReleaseRange | null }) {
  return (
    <ul className="params">
      {parameters.map((p) => {
        const { first, rest } = firstSentence(p.description);
        const head = (
          <>
            <span className="params__head">
              <Mono strong>{p.name}</Mono>
              <span className="params__type">
                <Mono>{p.type}</Mono>
              </span>
              <span className={`params__flag ${p.required ? "params__flag--required" : ""}`}>
                {p.required ? "required" : "optional"}
              </span>
              <span className="params__in">in {p.in}</span>
            </span>
            <span className="params__first">
              <Prose literal text={first} />
            </span>
          </>
        );
        const more = rest !== "" || p.default !== undefined || p.bounds !== null || isRelease(p);
        return (
          <li key={`${p.in}-${p.name}`} className="params__row">
            {more ? (
              <details className="params__fold">
                <summary>{head}</summary>
                <p className="params__text">
                  {rest ? <Prose literal text={rest} /> : null} <ParameterMeta p={p} releases={releases} />
                </p>
              </details>
            ) : (
              <div className="params__plain">{head}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const NOTHING_SEEN: ReadonlySet<string> = new Set();

/** The fields of a schema, and below them, each named schema they hold (once), to the depth given. */
function SchemaFields({
  document,
  name,
  seen = NOTHING_SEEN,
  depth = 0,
}: {
  document: OpenApiDocument;
  name: string;
  seen?: ReadonlySet<string>;
  depth?: number;
}) {
  const fields = fieldsOf(document, name);
  const here = new Set(seen).add(name);
  const nested = [...new Set(fields.flatMap((f) => f.refs))].filter(
    (r) => !here.has(r) && fieldsOf(document, r).length,
  );
  const after = new Set([...here, ...nested]);
  return (
    <div className="schema">
      <dl className="schema__fields">
        {fields.map((f) => (
          <div key={f.name} className="schema__row">
            <dt>
              <Mono strong>{f.name}</Mono> <span className="schema__type mono">{f.type}</span>
              {f.required ? null : <span className="schema__optional">optional</span>}
            </dt>
            <dd>
              <Prose literal text={f.description} />
            </dd>
          </div>
        ))}
      </dl>
      {depth < 4
        ? nested.map((r) => (
            <LazyDetails
              key={r}
              className="schema__nested"
              summary={
                <>
                  <Mono strong>{r}</Mono>{" "}
                  <span className="schema__count">{counted(fieldsOf(document, r).length, "field")}</span>
                </>
              }
            >
              {() => (
                <>
                  {schemaDescription(document, r) ? (
                    <p className="schema__about">
                      <Prose literal text={schemaDescription(document, r).split("\n\n")[0] ?? ""} />
                    </p>
                  ) : null}
                  <SchemaFields document={document} name={r} seen={after} depth={depth + 1} />
                </>
              )}
            </LazyDetails>
          ))
        : null}
    </div>
  );
}

const GROUP_WORDS: Record<string, string> = {
  result: "The result's columns, repeated on each of its rows",
  error: "The columns of an item's error (empty unless its status is error)",
  candidate: "The candidate's columns, one row per candidate (empty on the row of a result without candidates)",
};

/** A table answer: how each value is written (the document's text before its list of columns), and its columns by
 *  group, each with what it holds. */
function TableColumns({ media }: { media: Media }) {
  const rules = media.description.split(" The columns, in order")[0] ?? "";
  const groups = [...new Set(media.columns.map((c) => c.group))];
  return (
    <>
      <p className="schema__about">
        <Prose literal text={rules} />
      </p>
      <div className="table-wrap" role="region" aria-label="The table's columns" tabIndex={0}>
        <table className="table table--compact api-columns">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">What it holds</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g}>
              <tr className="api-columns__group">
                <th scope="colgroup" colSpan={2}>
                  {GROUP_WORDS[g] ?? g}
                </th>
              </tr>
              {media.columns
                .filter((c) => c.group === g)
                .map((c) => (
                  <tr key={c.name}>
                    <th scope="row">
                      <Mono>{c.name}</Mono>
                    </th>
                    <td>
                      <Prose literal text={c.description} />
                    </td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}

function TryIt({
  endpoint,
  spec,
  setSpec,
  reset,
  origin,
  organisms,
}: {
  endpoint: Endpoint;
  spec: RequestSpec;
  setSpec: (s: RequestSpec) => void;
  reset: () => void;
  origin: string;
  organisms: string[];
}) {
  const id = useId();
  const [state, setState] = useState<
    | { state: "idle" }
    | { state: "loading"; url: string }
    | { state: "done"; exchange: Exchange; url: string; method: string }
    | { state: "failed"; message: string; url: string }
  >({ state: "idle" });
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // An answer came: focus moves to its heading, and one sentence says what came (not the whole answer).
    if (state.state === "done") {
      answerHeading.current?.focus();
      announce(`${endpoint.key}: answered ${state.exchange.status} ${state.exchange.statusText}.`);
    } else if (state.state === "failed") {
      answerHeading.current?.focus();
      announce(`${endpoint.key}: no answer.`);
    }
  }, [state, endpoint.key]);
  useEffect(() => {
    // The console opens in place of its button: focus moves to its first control.
    form.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => {
      controller.current?.abort();
    };
  }, []);
  const url = requestUrl(origin, spec);
  const go = () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ state: "loading", url });
    send(spec.method, url, spec.body, current.signal, acceptOf(spec)).then(
      (exchange) => {
        if (!current.signal.aborted) setState({ state: "done", exchange, url, method: spec.method });
      },
      (error: unknown) => {
        if (current.signal.aborted || isAbort(error)) return;
        setState({ state: "failed", message: error instanceof Error ? error.message : String(error), url });
      },
    );
  };
  const set = (name: string, value: string) => {
    setSpec({ ...spec, values: { ...spec.values, [name]: value } });
  };
  return (
    <form
      ref={form}
      className="tryit"
      aria-label={`Try ${endpoint.key}`}
      onSubmit={(event) => {
        event.preventDefault();
        go();
      }}
    >
      {endpoint.parameters.length || spec.body !== null ? (
        <div className="tryit__fields">
          {endpoint.parameters.map((p) => {
            const fieldId = `${id}-${p.name}`;
            const value = spec.values[p.name] ?? "";
            return (
              <div key={p.name} className="tryit__field">
                <label htmlFor={fieldId} className="tryit__label">
                  <Mono>{p.name}</Mono>
                  {p.required ? <span className="tryit__required"> required</span> : null}
                </label>
                {p.kind === "boolean" || p.kind === "enum" ? (
                  <span className="select">
                    <select
                      id={fieldId}
                      className="select__control tryit__control"
                      value={value}
                      onChange={(e) => {
                        set(p.name, e.target.value);
                      }}
                    >
                      <option value="">
                        {p.default === undefined ? "not sent" : `not sent (default ${defaultText(p.default) ?? ""})`}
                      </option>
                      {(p.kind === "boolean" ? ["true", "false"] : p.enumValues).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : p.name === "organism" && organisms.length ? (
                  <span className="select">
                    <select
                      id={fieldId}
                      className="select__control tryit__control"
                      value={value}
                      onChange={(e) => {
                        set(p.name, e.target.value);
                      }}
                    >
                      {organisms.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : (
                  <input
                    id={fieldId}
                    className="input input--mono tryit__control"
                    type="text"
                    inputMode={p.kind === "integer" ? "numeric" : undefined}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={value}
                    placeholder={p.required ? "" : "not sent"}
                    onChange={(e) => {
                      set(p.name, e.target.value);
                    }}
                  />
                )}
              </div>
            );
          })}
          {spec.body !== null ? (
            <div className="tryit__field tryit__field--wide">
              <label htmlFor={`${id}-body`} className="tryit__label">
                Body <span className="tryit__required">{endpoint.body?.contentType ?? "application/json"}</span>
              </label>
              <textarea
                id={`${id}-body`}
                className="input input--mono textarea tryit__body"
                rows={3}
                spellCheck={false}
                value={spec.body}
                onChange={(e) => {
                  setSpec({ ...spec, body: e.target.value });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="tryit__none">This endpoint takes no parameter.</p>
      )}
      <div className="tryit__actions">
        <Button type="submit" variant="primary" disabled={state.state === "loading"}>
          {state.state === "loading" ? "Sending…" : `Send ${endpoint.method}`}
        </Button>
        <Button variant="quiet" onClick={reset}>
          Reset to the example
        </Button>
      </div>
      <div className="tryit__answer" aria-busy={state.state === "loading"}>
        {state.state === "done" ? (
          <>
            <h5 className="tryit__answer-title" ref={answerHeading} tabIndex={-1}>
              The answer: <span className="mono">{state.exchange.status}</span> {state.exchange.statusText}
            </h5>
            <ExchangeView exchange={state.exchange} what={`The answer of ${state.method} ${endpoint.path}`} />
          </>
        ) : state.state === "failed" ? (
          <div className="notice notice--danger">
            <h5 className="notice__title" ref={answerHeading} tabIndex={-1}>
              No answer
            </h5>
            <p>{state.message}</p>
          </div>
        ) : null}
      </div>
    </form>
  );
}

/** A recorded answer of the document, as its text is written there (no number written again), read from the
 *  document's text only when it is opened. */
function RecordedAnswer({ raw, endpoint, media }: { raw: string; endpoint: Endpoint; media: Media }) {
  const method = endpoint.method.toLowerCase();
  const table = media.type.startsWith("text/tab-separated-values");
  const read = () =>
    rawValueAt(raw, ["paths", endpoint.path, method, "responses", "200", "content", media.type, "example"]);
  return (
    <LazyDetails
      className="schema__nested endpoint__recorded"
      summary={
        <>
          {table ? "A recorded table" : "A recorded answer"}{" "}
          <span className="schema__count">human graph, Ensembl 115</span>
        </>
      }
    >
      {() => {
        const text = read();
        if (text === null) return <p className="muted">The document holds no recorded answer here.</p>;
        if (table) {
          const tsv = JSON.parse(text) as string;
          return <TsvTable raw={tsv} what={`${endpoint.key}: a recorded table`} />;
        }
        return (
          <pre
            className="exchange__body exchange__body--indented endpoint__recorded-body"
            role="region"
            aria-label={`${endpoint.key}: a recorded answer`}
            tabIndex={0}
          >
            <JsonText raw={text} />
          </pre>
        );
      }}
    </LazyDetails>
  );
}

/** The answers of an endpoint folded to one line (its success and the statuses of its refusals); open, each status
 *  with its codes. */
function Answers({ endpoint }: { endpoint: Endpoint }) {
  const answers = endpoint.answers;
  const success = answers.find((a) => a.status.startsWith("2"));
  const failures = answers.filter((a) => Number(a.status) >= 400);
  // The schema every failure answers with, when they share one (the error envelope): named once, not on each row.
  const errorSchema =
    failures.length && failures.every((a) => a.schema && a.schema === failures[0]?.schema)
      ? (failures[0]?.schema ?? null)
      : null;
  const codes = failures.reduce((n, a) => n + a.codes.length, 0);
  return (
    <details className="answers-fold">
      <summary>
        <span className="answers-fold__label">Answers</span>{" "}
        {success ? (
          <>
            <Mono strong>{success.status}</Mono> {success.media.map((m) => m.schema ?? m.type).join(" or ")}
          </>
        ) : null}
        {failures.length ? (
          <span className="answers-fold__refusals">
            {" "}
            · refusals <Mono>{failures.map((a) => a.status).join(" ")}</Mono> ({counted(codes, "code")})
          </span>
        ) : null}
      </summary>
      <dl className="answers">
        {answers.map((a) => (
          <div key={a.status} className="answers__row">
            <dt>
              <Mono strong>{a.status}</Mono>
            </dt>
            <dd>
              {a.codes.length ? (
                <span className="answers__codes">
                  {a.codes.map((c, i) => (
                    <span key={c}>
                      {i ? ", " : ""}
                      <a href="#errors" className="answers__code">
                        <Mono>{c}</Mono>
                      </a>
                    </span>
                  ))}
                </span>
              ) : (
                <Prose literal text={a.description} />
              )}
              {a.schema && a.schema !== errorSchema ? (
                <>
                  {" "}
                  <Mono>{a.schema}</Mono>
                </>
              ) : null}
              {a.contentTypes.length > 1 ? (
                <span className="answers__types"> ({a.contentTypes.join(", ")})</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {errorSchema ? (
        <p className="answers__note">
          Every status from 400 is answered with <Mono>{errorSchema}</Mono>, the error envelope (Conventions, b), its{" "}
          <Mono>code</Mono> one of those listed for the status (their meanings: Error codes, below).
        </p>
      ) : null}
    </details>
  );
}

export function EndpointSection({
  document,
  endpoint,
  example,
  origin,
  organisms,
  releases = null,
  batchMax = null,
  raw = null,
}: {
  document: OpenApiDocument;
  endpoint: Endpoint;
  example: RequestSpec;
  origin: string;
  organisms: string[];
  /** The releases of the graph the examples ask (null: not known yet). */
  releases?: ReleaseRange | null;
  /** This server's `batch_max` (null: not known yet). */
  batchMax?: number | null;
  /** The document's text as sent (its recorded answers are read from it exactly). */
  raw?: string | null;
}) {
  const [spec, setSpec] = useState(example);
  const [trying, setTrying] = useState(false);
  const phone = usePhone();
  const success = endpoint.answers.find((a) => a.status.startsWith("2"));
  const titleId = useId();
  return (
    <article className="endpoint" id={endpoint.anchor} aria-labelledby={titleId}>
      <header className="endpoint__head">
        <h3 id={titleId} className="endpoint__title">
          <span className={`method method--${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>{" "}
          <code className="endpoint__path">
            <PathText path={endpoint.path} />
          </code>
        </h3>
        <a className="endpoint__anchor" href={`#${endpoint.anchor}`} aria-label={`Link to ${endpoint.key}`}>
          #
        </a>
      </header>
      <p className="endpoint__summary">
        <Prose literal text={endpoint.summary} />
      </p>
      {endpoint.description ? (
        endpoint.description.length > 160 ? (
          <details className="endpoint__about">
            <summary>
              <span className="endpoint__description">
                <Prose literal text={endpoint.description} />
              </span>
              <span className="endpoint__about-more" aria-hidden="true">
                the whole description
              </span>
            </summary>
          </details>
        ) : (
          <p className="endpoint__description">
            <Prose literal text={endpoint.description} />
          </p>
        )
      ) : null}
      <div className="endpoint__grid">
        <div className="endpoint__spec">
          <h4 className="endpoint__label">
            Parameters{" "}
            {endpoint.parameters.length ? (
              <span className="endpoint__label-aside">each line opens to the rest of its text</span>
            ) : (
              <span className="endpoint__label-aside">none</span>
            )}
          </h4>
          {endpoint.parameters.length ? <ParameterRows parameters={endpoint.parameters} releases={releases} /> : null}
          {endpoint.body?.schema ? (
            <LazyDetails
              className="schema__nested schema__nested--top"
              summary={
                <>
                  Body: <Mono strong>{endpoint.body.schema}</Mono>{" "}
                  <span className="schema__count">
                    {endpoint.body.contentType}, {counted(fieldsOf(document, endpoint.body.schema).length, "field")}
                  </span>
                </>
              }
            >
              {() => {
                const name = endpoint.body?.schema ?? "";
                return (
                  <>
                    {schemaDescription(document, name) ? (
                      <p className="schema__about">
                        <Prose literal text={schemaDescription(document, name)} />
                      </p>
                    ) : null}
                    {batchMax !== null ? (
                      <p className="params__meta">
                        This server takes at most <Mono>{batchMax}</Mono> identifiers per request (
                        <Mono>batch_max</Mono> of <Mono>GET /limits</Mono>).
                      </p>
                    ) : null}
                    <SchemaFields document={document} name={name} />
                  </>
                );
              }}
            </LazyDetails>
          ) : null}
          <Answers endpoint={endpoint} />
          {success?.media.map((m) =>
            m.schema ? (
              <LazyDetails
                key={m.type}
                className="schema__nested schema__nested--top"
                summary={
                  <>
                    Fields of the answer: <Mono strong>{m.schema}</Mono>{" "}
                    <span className="schema__count">{counted(fieldsOf(document, m.schema).length, "field")}</span>
                  </>
                }
              >
                {() => {
                  const name = m.schema ?? "";
                  const about = schemaDescription(document, name).split("\n\n")[0] ?? "";
                  return (
                    <>
                      {about ? (
                        <p className="schema__about">
                          <Prose literal text={about} />
                        </p>
                      ) : null}
                      <SchemaFields document={document} name={name} />
                    </>
                  );
                }}
              </LazyDetails>
            ) : m.columns.length ? (
              <LazyDetails
                key={m.type}
                className="schema__nested schema__nested--top"
                summary={
                  <>
                    Columns of the table: <Mono strong>{m.type}</Mono>{" "}
                    <span className="schema__count">{counted(m.columns.length, "column")}</span>
                  </>
                }
              >
                {() => <TableColumns media={m} />}
              </LazyDetails>
            ) : null,
          )}
        </div>
        <div className={`endpoint__run ${trying ? "endpoint__run--console" : ""}`}>
          <h4 className={`endpoint__label${phone && !trying ? " visually-hidden" : ""}`}>
            Request{" "}
            <span className="endpoint__label-aside">{trying ? "as set below" : "an example of this server"}</span>
          </h4>
          {phone && !trying ? (
            <LazyDetails
              className="schema__nested schema__nested--top"
              summary={
                <>
                  The request <span className="schema__count">curl, Python, R, JavaScript</span>
                </>
              }
            >
              {() => <CodeTabs origin={origin} spec={spec} what={`${endpoint.key}, the request`} />}
            </LazyDetails>
          ) : (
            <CodeTabs origin={origin} spec={spec} what={`${endpoint.key}, the request`} />
          )}
          {trying ? (
            <TryIt
              endpoint={endpoint}
              spec={spec}
              setSpec={setSpec}
              reset={() => {
                setSpec(example);
              }}
              origin={origin}
              organisms={organisms}
            />
          ) : (
            <div className="endpoint__more">
              <Button
                className="endpoint__try"
                onClick={() => {
                  setTrying(true);
                }}
              >
                Try it<span className="visually-hidden">: {endpoint.key}</span>
              </Button>
              {raw !== null
                ? success?.media
                    .filter((m) => m.recorded)
                    .map((m) => <RecordedAnswer key={m.type} raw={raw} endpoint={endpoint} media={m} />)
                : null}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
