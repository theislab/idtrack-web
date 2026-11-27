// The http api: the conventions every endpoint shares, how a program should use it, then every endpoint read live from
// the server's OpenAPI document (`/api/v1/openapi.json`) with examples of this server that run, a console per
// endpoint, the error codes from `/vocabulary`, and the same answers from the Python package.
import { docsPage } from "../lib/links";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_BASE, api, send, type Exchange } from "../api/client";
import type { LimitsResponse } from "../api/types";
import { ErrorPanel } from "../components/ErrorPanel";
import { CodeBlock, CodeChoice, CodeTabs, LanguageProvider } from "../components/api/CodeTabs";
import { EndpointSection } from "../components/api/EndpointSection";
import { ExchangeView } from "../components/api/Exchange";
import { Button, CopyButton, Mono, Prose, Skeleton } from "../components/ui";
import {
  exampleOrganism,
  exampleRequest,
  requestUrl,
  type OrganismExample,
  type RequestSpec,
} from "../lib/apiExamples";
import { pipelinePython, pipelineR } from "../lib/apiRecipes";
import { rawValueAt } from "../lib/jsonView";
import { groupedInteger, pythonFloat } from "../lib/numbers";
import { endpoints, fieldsOf, firstSentence, grouped, tocPath, type OpenApiDocument } from "../lib/openapi";
import { useOrganisms } from "../lib/organisms";
import { parseServerTiming, TIMING_METRICS } from "../lib/serverTiming";
import { useRequest } from "../lib/useRequest";
import { useLimits, useVocabulary } from "../lib/vocabularyContext";
import "../styles/api.css";

/** The value of a bound of `/limits` as sent, with its unit where the field's name states one (what the value means
 *  is the field's description, beside it). */
function boundValue(name: string, value: number): string {
  if (name.endsWith("_bytes"))
    return `${groupedInteger(value)} bytes${value >= 1024 * 1024 ? ` (${value / 1024 / 1024} MiB)` : ""}`;
  if (name.endsWith("_seconds")) return `${pythonFloat(value)} s`;
  return groupedInteger(value);
}

function rateWords(limits: LimitsResponse | null): string {
  if (!limits) return "…";
  if (limits.rate_per_minute === 0) return "not limited on this server";
  const searchTime =
    limits.rate_search_seconds > 0 ? `, and ${pythonFloat(limits.rate_search_seconds)} s of search per minute` : "";
  return `${groupedInteger(limits.rate_per_minute)} searches per minute per client (bursts of ${groupedInteger(limits.rate_burst)})${searchTime}; other requests ${limits.read_share} times as many`;
}

function Section({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="api-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="api-section__head section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {aside ? <p className="api-section__aside">{aside}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The page's contents: its sections and every endpoint, grouped as the document groups them. */
function ContentsLinks({
  groups,
  active,
  onFollow,
}: {
  groups: ReturnType<typeof grouped>;
  active: string | null;
  onFollow?: () => void;
}) {
  const link = (id: string, label: ReactNode, className = "") => (
    <a
      href={`#${id}`}
      className={`api-toc__link ${className}`}
      aria-current={active === id ? "location" : undefined}
      onClick={onFollow}
    >
      {label}
    </a>
  );
  return (
    <>
      {link("first-request", "A first request")}
      {link("conventions", "Conventions")}
      {link("reading", "Reading an answer")}
      {link("programs", "For programs and automated clients")}
      {groups.map((g) => (
        <div key={g.tag} className="api-toc__group">
          {link(`group-${g.tag}`, g.title)}
          {g.endpoints.map((e) =>
            link(
              e.anchor,
              <>
                <span className={`api-toc__method method-text--${e.method.toLowerCase()}`}>{e.method}</span>
                <span className="api-toc__path">
                  {tocPath(e.path)
                    .split("/")
                    .map((part, i) => (
                      <span key={i}>
                        {i ? (
                          <>
                            /<wbr />
                          </>
                        ) : null}
                        {part}
                      </span>
                    ))}
                </span>
              </>,
              "api-toc__link--endpoint",
            ),
          )}
        </div>
      ))}
      {link("errors", "Error codes")}
      {link("locally", "Locally, in Python")}
      {link("pipeline", "A whole feature list")}
    </>
  );
}

/** The section or endpoint being read: the last whose top has passed a line just below where an anchor lands, watched
 *  with an IntersectionObserver (no layout read on scroll). Every target lands at one offset (the page's scroll padding
 *  and the targets' one scroll margin), read once after the first frame (never while the page is laid out the first
 *  time) and again when the window's size changes, so the entry just followed is the one marked. */
function useReading(groups: ReturnType<typeof grouped>): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    const watch = () => {
      observer?.disconnect();
      const targets = [...document.querySelectorAll<HTMLElement>(".api-section, .endpoint, .api-first")];
      const [first] = targets;
      if (!first) return;
      const landing =
        (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) +
        (parseFloat(getComputedStyle(first).scrollMarginTop) || 0);
      const line = Math.ceil(landing) + 8;
      const passed = new Map<string, boolean>();
      const order = targets.map((t) => t.id);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            // Above the line: the target's top has passed it (it intersects the region above the line, or lies
            // wholly above it).
            passed.set(entry.target.id, entry.isIntersecting || entry.boundingClientRect.bottom < line);
          }
          let current: string | null = null;
          for (const id of order) if (passed.get(id)) current = id;
          setActive(current);
        },
        { rootMargin: `0px 0px -${Math.max(0, window.innerHeight - line)}px 0px` },
      );
      for (const t of targets) observer.observe(t);
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(watch);
    };
    later();
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", later);
      observer?.disconnect();
    };
  }, [groups]);
  return active;
}

/** The contents beside the reference on a wide screen; on a narrower one, a bar that stays under the masthead and
 *  opens to the same list (no control floats over the text). */
function Contents({ groups }: { groups: ReturnType<typeof grouped> }) {
  const active = useReading(groups);
  return (
    <nav className="api-toc" aria-label="On this page">
      <p className="api-toc__head">On this page</p>
      <ContentsLinks groups={groups} active={active} />
    </nav>
  );
}

function PhoneContents({ groups, count }: { groups: ReturnType<typeof grouped>; count: number }) {
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <details className="api-contents" id="contents" ref={details}>
      <summary>
        On this page <span className="api-contents__count">{count ? `${count} endpoints` : ""}</span>
      </summary>
      <nav aria-label="On this page" className="api-contents__list">
        <ContentsLinks
          groups={groups}
          active={null}
          onFollow={() => {
            if (details.current) details.current.open = false;
          }}
        />
      </nav>
    </details>
  );
}

/** A fact of the head: its value, a placeholder of the value's own size while it comes, or "not read" when its request
 *  failed. */
function Fact({
  label,
  state,
  failed,
  children,
  className = "",
}: {
  label: string;
  state: "loading" | "done" | "failed";
  failed: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`api-facts__item ${className}`}>
      <dt>{label}</dt>
      <dd>
        {state === "done" ? (
          children
        ) : state === "failed" ? (
          <span className="muted" title={failed}>
            not read
          </span>
        ) : (
          <span className="api-facts__pending" aria-label="loading">
            …
          </span>
        )}
      </dd>
    </div>
  );
}

/** A first request, above everything else: the example conversion of this server, its curl line (in the language the
 *  page shows), and its answer on a press, trimmed to what it says, the whole answer one press away. Without an
 *  example identifier (the organisms not read, or none of the page's examples held) it says why, never a request
 *  that cannot answer. */
function FirstRequest({
  origin,
  organism,
  example,
  organisms,
}: {
  origin: string;
  organism: string;
  example: OrganismExample | null;
  organisms: { status: "loading" | "done" | "failed"; held: number; retry: () => void };
}) {
  const spec: RequestSpec = {
    method: "GET",
    path: `${API_BASE}/organisms/{organism}/convert`,
    values: { organism, identifier: example?.identifier ?? "" },
    kinds: { identifier: "string" },
    order: ["identifier"],
    pathNames: ["organism"],
    body: null,
  };
  const [answer, setAnswer] = useState<Exchange | "asking" | "failed" | null>(null);
  const asking = useRef(false);
  const run = () => {
    if (asking.current) return; // a second press while the first is out sends nothing more
    asking.current = true;
    setAnswer("asking");
    send("GET", requestUrl(origin, spec), null).then(
      (exchange) => {
        asking.current = false;
        setAnswer(exchange);
      },
      () => {
        asking.current = false;
        setAnswer("failed");
      },
    );
  };
  const summary = typeof answer === "object" && answer !== null ? firstSummary(answer.raw) : null;
  return (
    <section className="api-first" id="first-request" aria-labelledby="first-request-title">
      <div className="api-first__text">
        <h2 id="first-request-title" className="api-first__title">
          A first request
        </h2>
        {example ? (
          <>
            <p className="api-card__text">
              Convert <Mono>{example.identifier}</Mono> in this server&apos;s <Mono>{organism}</Mono> graph to the
              Ensembl gene at the graph&apos;s last release: one <Mono>GET</Mono>, JSON back. Every parameter, and the
              request in Python, R and JavaScript, are under Conversion below.
            </p>
            <div className="api-first__run">
              <Button variant="primary" onClick={run} disabled={answer === "asking"}>
                {answer === "asking" ? "Asking…" : "Send it"}
              </Button>
              {summary ? (
                <p className="api-first__summary" role="status">
                  <Mono strong>{typeof answer === "object" && answer ? answer.status : ""}</Mono> {summary}
                </p>
              ) : answer === "failed" ? (
                <p className="api-first__summary" role="status">
                  No answer came from the server.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="api-first__missing" role="status">
            <p className="api-card__text">
              {organisms.status === "failed"
                ? "The list of this server's organisms could not be read, so the page has no identifier to ask with yet."
                : organisms.status === "loading"
                  ? "Reading this server's organisms, to ask with an identifier of one of its graphs…"
                  : organisms.held === 0
                    ? "This server holds no graph, so there is nothing to convert."
                    : `The page knows no identifier of the ${organism} graph: write one into the console of GET …/convert under Conversion below.`}
            </p>
            {organisms.status === "failed" ? <Button onClick={organisms.retry}>Try again</Button> : null}
          </div>
        )}
      </div>
      {example ? (
        <div className="api-first__code">
          <CodeTabs origin={origin} spec={spec} what="A first request" />
          {typeof answer === "object" && answer !== null ? (
            <details className="schema__nested api-first__whole">
              <summary>The whole answer, as sent</summary>
              <ExchangeView exchange={answer} what="The first request's answer" />
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** What an answer of convert says, in a line: its status and best targets (a string without its JSON quotes). */
function firstSummary(raw: string): string | null {
  const text = (path: string[]) => {
    const value = rawValueAt(raw, path);
    return value?.startsWith('"') ? (JSON.parse(value) as string) : value;
  };
  const status = text(["status"]);
  if (status === null) {
    const code = text(["error", "code"]);
    return code ? `error ${code}` : null;
  }
  const targets: string[] = [];
  for (let i = 0; ; i++) {
    const best = rawValueAt(raw, ["candidates", String(i), "best"]);
    if (best === null) break;
    if (best === "true") targets.push(text(["candidates", String(i), "target"]) ?? "");
  }
  return `status ${status}${targets.length ? `, best ${targets.join(", ")}` : ""}`;
}

/** The fields of the recorded answer annotated: what a reader weighs, in the document's own words. */
const READ_FIELDS: { path: string[]; schema: string }[] = [
  { path: ["status"], schema: "ConversionResult" },
  { path: ["match"], schema: "ConversionResult" },
  { path: ["from_release"], schema: "ConversionResult" },
  { path: ["from_release_inferred"], schema: "ConversionResult" },
  { path: ["final_database"], schema: "ConversionResult" },
  { path: ["candidates", "0", "target"], schema: "Candidate" },
  { path: ["candidates", "0", "best"], schema: "Candidate" },
  { path: ["candidates", "0", "bridges"], schema: "Candidate" },
  { path: ["candidates", "0", "score"], schema: "Candidate" },
  { path: ["candidates", "0", "history_steps"], schema: "Candidate" },
  { path: ["decided_by"], schema: "ConversionResult" },
  { path: ["other_readings"], schema: "ConversionResult" },
  { path: ["cautions"], schema: "ConversionResult" },
];

/** Inline marks of a rule's text: `code` and **strong**. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className="mono">
            {part}
          </code>
        ) : (
          part.split("**").map((piece, j) => (j % 2 ? <strong key={`${i}-${j}`}>{piece}</strong> : piece))
        ),
      )}
    </>
  );
}

/** The section "Reading an answer" of /llms-full.txt (the api's one text of its rules), as its list of rules. */
function useReadingRules(): { state: "loading" | "done" | "failed"; rules: string[] } {
  const [result, setResult] = useState<{ state: "loading" | "done" | "failed"; rules: string[] }>({
    state: "loading",
    rules: [],
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/llms-full.txt", { signal: controller.signal, headers: { Accept: "text/markdown, text/plain" } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(
        (text) => {
          const start = text.indexOf("\n## Reading an answer");
          const end = start < 0 ? -1 : text.indexOf("\n## ", start + 4);
          const body = start < 0 ? "" : text.slice(start, end < 0 ? undefined : end);
          const rules = body
            .split("\n")
            .filter((line) => line.startsWith("- "))
            .map((line) => line.slice(2));
          setResult({ state: rules.length ? "done" : "failed", rules });
        },
        () => {
          if (!controller.signal.aborted) setResult({ state: "failed", rules: [] });
        },
      );
    return () => {
      controller.abort();
    };
  }, []);
  return result;
}

/** A rule's lead (its words in bold, else its first sentence) and the rest, which opens on demand. */
function ruleParts(rule: string): { lead: string; rest: string } {
  const bold = /^\*\*([^*]+)\*\*\s*(.*)$/s.exec(rule);
  if (bold) return { lead: bold[1] ?? "", rest: bold[2] ?? "" };
  const { first, rest } = firstSentence(rule);
  return { lead: first, rest };
}

function ReadingAnAnswer({ doc, raw }: { doc: OpenApiDocument | null; raw: string | null }) {
  const rules = useReadingRules();
  const recorded =
    raw !== null
      ? rawValueAt(raw, [
          "paths",
          `${API_BASE}/organisms/{organism}/convert`,
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "example",
        ])
      : null;
  // A string of the caption without its JSON quotes (a number or a literal as written).
  const plain = (path: string[]) => {
    const text = recorded !== null ? rawValueAt(recorded, path) : null;
    if (text === null) return "";
    return text.startsWith('"') ? (JSON.parse(text) as string) : text;
  };
  const describe = (schema: string, field: string) =>
    doc ? (fieldsOf(doc, schema).find((f) => f.name === field)?.description ?? "") : "";
  return (
    <Section
      id="reading"
      title="Reading an answer"
      aside="Which answers are weaker evidence, and what the api cannot answer."
    >
      <div className="api-reading">
        <div className="api-reading__rules">
          {rules.state === "done" ? (
            <ul className="api-list api-reading__list">
              {rules.rules.map((rule, i) => {
                const { lead, rest } = ruleParts(rule);
                return (
                  <li key={i}>
                    {rest ? (
                      <details className="api-rule">
                        <summary>
                          <Marked text={lead} />
                        </summary>
                        <p>
                          <Marked text={rest} />
                        </p>
                      </details>
                    ) : (
                      <Marked text={lead} />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : rules.state === "failed" ? (
            <p className="muted">
              The rules could not be read from <a href="/llms-full.txt">/llms-full.txt</a>, where they are written.
            </p>
          ) : (
            <Skeleton height={220} />
          )}
          <p className="api-card__source">
            From <a href="/llms-full.txt">/llms-full.txt</a>, section &quot;Reading an answer&quot;: the same rules the
            api gives language models; each opens to the whole rule.
          </p>
        </div>
        <figure className="api-reading__figure">
          <figcaption className="api-reading__head">
            <span className="label">A recorded answer, annotated</span>
            {recorded !== null ? (
              <span className="api-reading__query">
                <Mono>{plain(["query_id"])}</Mono> at release <Mono>{plain(["from_release"])}</Mono> to{" "}
                <Mono>{plain(["final_database"])}</Mono> at release <Mono>{plain(["to_release"])}</Mono>
              </span>
            ) : null}
          </figcaption>
          {recorded !== null && doc ? (
            <dl className="api-annotated">
              {READ_FIELDS.map(({ path, schema }) => {
                const value = rawValueAt(recorded, path);
                if (value === null) return null;
                const name = path[path.length - 1] ?? "";
                const key = path.length > 1 ? `candidates[0].${name}` : name;
                return (
                  <div key={key} className="api-annotated__row">
                    <dt>
                      <Mono>{key}</Mono> <Mono strong>{value}</Mono>
                    </dt>
                    <dd>
                      <Prose text={describe(schema, name)} literal />
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <Skeleton height={320} />
          )}
          <p className="api-card__source">
            The convert endpoint&apos;s recorded answer in <Mono>/api/v1/openapi.json</Mono> (strings in their JSON
            quotes), each value as written there, each meaning the document&apos;s description of its field.
          </p>
        </figure>
      </div>
    </Section>
  );
}

const HARMONIZE_EXAMPLE = `from idtrack.harmonize import HarmonizeFeatures

harmonizer = HarmonizeFeatures(
    project_name="my_project",
    data_h5ad_dict={"study_a": "study_a.h5ad", "study_b": "study_b.h5ad"},
    project_local_repository="./harmonization",   # the result cache, one JSON file per dataset
    idtrack_local_repository="./idtrack_cache",   # the local repository that holds the graph
    to_release=115,
    organism="homo_sapiens",
    snapshot_release=115,
    final_database="HGNC Symbol",
    verbosity=0,
)
report = harmonizer.conversion_report()        # one row per input feature
adata = harmonizer.unify_multiple_anndatas(features="union")   # or features="intersect"`;

const PYTHON_EXAMPLE = `import os

from idtrack import API

os.makedirs("./idtrack_cache", exist_ok=True)              # the local repository: tables and graph files
api = API.build("homo_sapiens", 115, "./idtrack_cache")    # built once (hours for human), then loaded in seconds
print(api.convert("TP53").targets())                                                    # ('ENSG00000141510.20',)
print(api.convert("ENSG00000141510", from_release=100, final_database="HGNC Symbol").targets())   # ('TP53',)`;

export function ApiPage() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const base = `${origin}${API_BASE}`;
  const document = useRequest("openapi", (signal) => api.openapi(signal));
  const limits = useLimits();
  const vocabulary = useVocabulary();
  const { organisms, version, facts, status: organismsStatus, retry: retryOrganisms } = useOrganisms();
  const held = organisms.map((o) => o.organism);
  const { organism, example } = exampleOrganism(held);
  const [errorExample, setErrorExample] = useState<Exchange | "asking" | "failed" | null>(null);
  const askError = () => {
    setErrorExample("asking");
    send("GET", `${API_BASE}/organisms/not_an_organism`, null).then(setErrorExample, () => {
      setErrorExample("failed");
    });
  };

  const doc = document.state === "done" ? (document.answer.data as OpenApiDocument) : null;
  const raw = document.state === "done" ? document.answer.raw : null;
  const docState = document.state === "done" ? "done" : document.state === "failed" ? "failed" : "loading";
  const described = organisms.find((o) => o.organism === organism);
  const releases = described?.releases.length
    ? {
        organism,
        first: described.releases[0] ?? 0,
        last: described.releases[described.releases.length - 1] ?? 0,
      }
    : null;
  const list = useMemo(() => (doc ? endpoints(doc) : []), [doc]);
  const groups = useMemo(() => grouped(list), [list]);
  const timing = document.state === "done" ? (document.answer.serverTiming ?? null) : null;
  const limitFields = doc ? fieldsOf(doc, "LimitsResponse") : [];
  // The endpoints are drawn once the document has come: an address with an endpoint's anchor is honoured then.
  useEffect(() => {
    if (!doc || !window.location.hash) return;
    const target = window.document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    target?.scrollIntoView();
  }, [doc]);
  const errors = [...vocabulary.errors.entries()];
  // The bounds the api names as per-client allowances: configured, and applied only where it enforces them.
  const allowances = new Set(limits?.allowance_fields ?? []);
  const allowancesOff = limits !== null && !limits.allowances_enforced;

  return (
    <LanguageProvider>
      <div className="page api-page">
        <header className="page-head api-head">
          <p className="eyebrow">API</p>
          <h1>idtrack over HTTP</h1>
          <p className="lede">
            Every answer of this site is an answer of its api: JSON in, idtrack&apos;s own results out, unchanged (no
            field renamed, no number rounded). The reference below is read from this server&apos;s OpenAPI document as
            it serves it, and every example runs against this server.
          </p>
        </header>

        <dl className="api-facts">
          <div className="api-facts__item api-facts__item--base">
            <dt>Base address</dt>
            <dd>
              <Mono strong>{base}</Mono>
              <CopyButton text={base} what="the base address" />
            </dd>
          </div>
          <Fact label="Document" state={docState} failed="The request of /api/v1/openapi.json failed.">
            OpenAPI <Mono>{doc?.openapi ?? "?"}</Mono>, api <Mono>{doc?.info?.version ?? "?"}</Mono>
          </Fact>
          <Fact label="Endpoints" state={docState} failed="The request of /api/v1/openapi.json failed.">
            <Mono>{list.length}</Mono>
          </Fact>
          <Fact label="Rate" state={facts.limits} failed="The request of /api/v1/limits failed.">
            {rateWords(limits)}
          </Fact>
          <Fact label="idtrack" state={facts.version} failed="The request of /api/v1/version failed.">
            <Mono>{version?.idtrack_version ?? ""}</Mono>
          </Fact>
        </dl>
        <p className="api-links">
          <a href={`${API_BASE}/openapi.json`} download="idtrack-openapi.json">
            Download the OpenAPI document
          </a>
          <a href="/llms.txt">llms.txt, the index for language models</a>
          <a href="/llms-full.txt">llms-full.txt, every rule and example as text</a>
          <a href={API_BASE}>The api&apos;s index (JSON)</a>
          <span className="api-links__source">
            Sources: <Mono>/api/v1/openapi.json</Mono>, <Mono>/api/v1/limits</Mono>, <Mono>/api/v1/vocabulary</Mono>
          </span>
        </p>

        <PhoneContents groups={groups} count={list.length} />

        <div className="api-layout">
          <Contents groups={groups} />
          <div className="api-main">
            <FirstRequest
              origin={origin}
              organism={organism}
              example={example}
              organisms={{ status: organismsStatus, held: held.length, retry: retryOrganisms }}
            />
            <Section id="conventions" title="Conventions" aside="What every endpoint shares.">
              <div className="api-conventions">
                <div className="api-card">
                  <h3 className="api-card__title">
                    <span className="panel-letter" aria-hidden="true">
                      a
                    </span>
                    Requests and answers
                  </h3>
                  <ul className="api-list">
                    <li>
                      Every endpoint is under <Mono>{API_BASE}</Mono> and answers JSON (<Mono>application/json</Mono>
                      ); a batch can also answer a table (<Mono>format=tsv</Mono>).
                    </li>
                    <li>
                      A <Mono>GET</Mono> takes its arguments in the query; the batch is a <Mono>POST</Mono> of a JSON
                      body with <Mono>Content-Type: application/json</Mono>. A query parameter the endpoint does not
                      take, or one given twice, is refused.
                    </li>
                    <li>
                      An organism is its Ensembl production name (<Mono>homo_sapiens</Mono>) or a short name idtrack
                      knows (<Mono>human</Mono>); <Mono>GET /organisms</Mono> lists those this server holds.
                    </li>
                    <li>
                      A result is idtrack&apos;s <Mono>to_dict()</Mono>: a float is written as the shortest text that
                      reads back as the same double, which JSON parsers read exactly. The api adds three things of its
                      own, each said to be the api&apos;s: <Mono>cautions</Mono> on every result (its reading of the
                      result&apos;s evidence, each with its code and the limitation of idtrack it falls under), the
                      stable <Mono>error.code</Mono> of a batch item that failed, and around a list&apos;s answers the{" "}
                      <Mono>organism</Mono> and the <Mono>arguments</Mono> as read.
                    </li>
                    <li>
                      No key and no cookie: any page may call the api from a browser (CORS{" "}
                      <Mono>Access-Control-Allow-Origin: *</Mono>), and every <Mono>GET</Mono> answer has an{" "}
                      <Mono>ETag</Mono>: sent back as <Mono>If-None-Match</Mono>, an unchanged answer is{" "}
                      <Mono>304</Mono>, without a search.
                    </li>
                  </ul>
                </div>
                <div className="api-card">
                  <h3 className="api-card__title">
                    <span className="panel-letter" aria-hidden="true">
                      b
                    </span>
                    Errors
                  </h3>
                  <p className="api-card__text">
                    Every answer that is not a success is one object, <Mono>{`{"error": {...}}`}</Mono>, with a stable{" "}
                    <Mono>code</Mono> (the table below), a <Mono>message</Mono> that says what to change, the{" "}
                    <Mono>argument</Mono> it is about and the values it <Mono>allowed</Mono>, where there are any, the{" "}
                    <Mono>details</Mono> of a request of the wrong shape, and the <Mono>request_id</Mono>. Ask this
                    server for an organism it does not hold:
                  </p>
                  <p className="api-card__request">
                    <Mono>GET /api/v1/organisms/not_an_organism</Mono>
                    {typeof errorExample === "object" && errorExample ? (
                      <>
                        {" "}
                        → <Mono strong>{errorExample.status}</Mono>
                      </>
                    ) : null}
                  </p>
                  {typeof errorExample === "object" && errorExample ? (
                    <pre className="raw api-raw">{errorExample.raw}</pre>
                  ) : errorExample === "failed" ? (
                    <p className="api-card__text">No answer came from the server.</p>
                  ) : (
                    <Button className="api-card__ask" onClick={askError} disabled={errorExample === "asking"}>
                      {errorExample === "asking" ? "Asking…" : "Ask this server"}
                    </Button>
                  )}
                </div>
                <div className="api-card api-card--wide">
                  <h3 className="api-card__title">
                    <span className="panel-letter" aria-hidden="true">
                      c
                    </span>
                    Bounds of this server
                  </h3>
                  {limits && limitFields.length ? (
                    <ul className="api-bounds">
                      {limitFields.map((f) => {
                        const value = (limits as unknown as Record<string, unknown>)[f.name];
                        const allowance = allowances.has(f.name);
                        return (
                          <li
                            key={f.name}
                            className={`api-bounds__row${allowance ? " api-bounds__row--allowance" : ""}`}
                          >
                            <details>
                              <summary>
                                <Mono>{f.name}</Mono>{" "}
                                <span className="api-bounds__value">
                                  <Mono strong>
                                    {typeof value === "number"
                                      ? boundValue(f.name, value)
                                      : Array.isArray(value)
                                        ? `${value.length} names`
                                        : String(value)}
                                  </Mono>
                                </span>
                                {allowance && allowancesOff ? (
                                  <span className="api-bounds__state">configured, not applied on this server</span>
                                ) : null}
                              </summary>
                              <p className="api-bounds__meaning">
                                <Prose text={f.description} literal />
                                {Array.isArray(value) ? (
                                  <>
                                    {" "}
                                    {value.map((v, i) => (
                                      <span key={String(v)}>
                                        {i ? ", " : ""}
                                        <Mono>{String(v)}</Mono>
                                      </span>
                                    ))}
                                    .
                                  </>
                                ) : null}
                              </p>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  ) : facts.limits === "failed" || document.state === "failed" ? (
                    <p className="muted">The bounds could not be read: the request of /api/v1/limits failed.</p>
                  ) : (
                    <Skeleton height={160} />
                  )}
                  <p className="api-card__source">
                    <Mono>GET /api/v1/limits</Mono>, each bound opening to the document&apos;s description of it; the
                    per-client allowances are those <Mono>allowance_fields</Mono> names
                    {allowancesOff ? ", configured but not applied on this server (allowances_enforced is false)" : ""}.
                  </p>
                </div>
                <div className="api-card api-card--wide">
                  <h3 className="api-card__title">
                    <span className="panel-letter" aria-hidden="true">
                      d
                    </span>
                    Timing
                  </h3>
                  <p className="api-card__text">
                    Every answer carries <Mono>Server-Timing</Mono>, in milliseconds measured by the server, readable by
                    any page (it is exposed to every origin). Its metrics, in the api&apos;s words (
                    <Mono>x-metrics</Mono> of the header in the document):
                  </p>
                  <dl className="api-timing">
                    {Object.entries(TIMING_METRICS).map(([name, meaning]) => (
                      <div key={name}>
                        <dt>
                          <Mono strong>{name}</Mono>
                        </dt>
                        <dd>
                          <Prose text={meaning} literal />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {timing ? (
                    <p className="api-card__request">
                      This page&apos;s request of the document: <Mono>Server-Timing: {timing}</Mono>
                      {parseServerTiming(timing).length ? null : " (not read)"}
                    </p>
                  ) : null}
                </div>
              </div>
            </Section>

            <ReadingAnAnswer doc={doc} raw={raw} />

            <Section
              id="programs"
              title="For programs and automated clients"
              aside="How an automated client should use the api."
            >
              <ol className="api-rules">
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Read the document.</strong>
                    </summary>
                    <p>
                      <a href={`${API_BASE}/openapi.json`}>/api/v1/openapi.json</a> describes every endpoint, parameter
                      and field (with the meaning of each), every closed set of codes as an enumeration, the error codes
                      of each endpoint and a recorded answer of each; <a href="/llms-full.txt">/llms-full.txt</a> says
                      the rules in one text, and <Mono>GET {API_BASE}</Mono> names every endpoint.
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Send and read JSON.</strong>
                    </summary>
                    <p>
                      Ask with <Mono>Accept: application/json</Mono>; send a body as <Mono>application/json</Mono>,
                      typed strictly (a release is a number, never <Mono>&quot;115&quot;</Mono>).
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Branch on the code, not the message.</strong>
                    </summary>
                    <p>
                      <Mono>error.code</Mono> is stable; the message is for people and may change. A code that is not
                      retryable (the table below) will not change on a retry: change the request.
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Wait when told to.</strong>
                    </summary>
                    <p>
                      On <Mono>429 rate_limited</Mono>, <Mono>503 server_busy</Mono> and{" "}
                      <Mono>503 request_budget_exceeded</Mono>, wait the <Mono>Retry-After</Mono> seconds, then retry;
                      wait longer each time it repeats (the recipe below does).
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Many identifiers, one request.</strong>
                    </summary>
                    <p>
                      Send up to {limits ? <Mono>{groupedInteger(limits.batch_max)}</Mono> : "the bound of"} identifiers
                      in one <Mono>POST …/convert/batch</Mono> rather than one request each: the results come in input
                      order, each with its own status, and an identifier whose conversion fails is that item&apos;s
                      error (with its <Mono>code</Mono>). An identifier the api refuses at its boundary (too long,
                      control characters) refuses the whole batch, with every such index in <Mono>details</Mono>:
                      correct it and send again. An item that is another item of the same batch with <Mono>-1</Mono>,{" "}
                      <Mono>.1</Mono> or <Mono>_1</Mono> appended can be answered as its copy; send{" "}
                      <Mono>&quot;read_copies&quot;: false</Mono> to convert every item alone.
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Ask for the path only when you read it.</strong>
                    </summary>
                    <p>
                      <Mono>explain=true</Mono> adds every candidate&apos;s path; an answer over{" "}
                      {limits ? <Mono>{groupedInteger(limits.response_max_bytes)}</Mono> : "the bound of"} bytes is
                      refused (<Mono>response_too_large</Mono>), never cut.
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Keep to the bounds of /limits.</strong>
                    </summary>
                    <p>
                      They are above (Conventions, c): at most{" "}
                      {limits ? <Mono>{limits.identifier_max_length}</Mono> : "the bound of"} characters per identifier,{" "}
                      {limits ? <Mono>{pythonFloat(limits.request_seconds)}</Mono> : "the budget of"} s of search per
                      request (from when its search begins),{" "}
                      {limits ? <Mono>{pythonFloat(limits.search_seconds)}</Mono> : "the budget of"} s per
                      identifier&apos;s search, and at most{" "}
                      {limits ? <Mono>{pythonFloat(limits.queue_seconds)}</Mono> : "the bound of"} s waiting for a
                      worker (longer is <Mono>503 server_busy</Mono>, unsearched); the rate is {rateWords(limits)}.
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Read meanings from the server.</strong>
                    </summary>
                    <p>
                      <Mono>/vocabulary</Mono> gives the meaning of every status, reason, criterion and error code; it,{" "}
                      <Mono>/organisms</Mono> and <Mono>/version</Mono> change only when the server&apos;s graphs or
                      versions do (<Mono>/version</Mono> names each graph&apos;s content digest), so they can be kept
                      between runs.
                    </p>
                  </details>
                </li>
                <li>
                  <details className="api-rule">
                    <summary>
                      <strong>Quote the request id</strong>
                    </summary>
                    <p>
                      (<Mono>error.request_id</Mono>, also the <Mono>X-Request-ID</Mono> header of every answer) when
                      reporting an <Mono>internal_error</Mono>.
                    </p>
                  </details>
                </li>
              </ol>
            </Section>

            {document.state === "failed" ? (
              <ErrorPanel error={document.error} onRetry={document.retry} context="The OpenAPI document" />
            ) : !doc ? (
              <div aria-busy="true">
                <p className="visually-hidden">Loading the OpenAPI document…</p>
                <Skeleton height={28} width="30%" />
                <Skeleton height={320} className="skeleton--gap" />
              </div>
            ) : (
              groups.map((g) => (
                <Section
                  key={g.tag}
                  id={`group-${g.tag}`}
                  title={g.title}
                  aside={
                    <>
                      {g.about} <span className="api-section__count">{g.endpoints.length} endpoints</span>
                    </>
                  }
                >
                  {g.endpoints.map((e) => (
                    <EndpointSection
                      key={e.key}
                      document={doc}
                      endpoint={e}
                      example={exampleRequest(e, organism, example)}
                      origin={origin}
                      organisms={held}
                      releases={releases}
                      batchMax={limits?.batch_max ?? null}
                      raw={raw}
                    />
                  ))}
                </Section>
              ))
            )}

            <Section id="errors" title="Error codes" aside="From /api/v1/vocabulary: every code the api answers.">
              {errors.length ? (
                <div className="table-wrap" role="region" aria-label="Table of error codes" tabIndex={0}>
                  <table className="table table--compact table--cards api-errors">
                    <thead>
                      <tr>
                        <th scope="col">Code</th>
                        <th scope="col" className="num">
                          Status
                        </th>
                        <th scope="col">Retry</th>
                        <th scope="col">What it says (each opens to when, and what to change)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errors.map(([code, e]) => (
                        <tr key={code}>
                          <td data-label="Code">
                            <Mono strong>{code}</Mono>
                          </td>
                          <td data-label="Status" className="num">
                            <Mono>{e.status}</Mono>
                          </td>
                          <td data-label="Retry">
                            {e.retryable ? "retry (after Retry-After)" : "change the request"}
                          </td>
                          <td data-label="When" className="cell-wrap">
                            {/* One child: in the cards of a phone, prose with code wraps as one paragraph. */}
                            <details className="cell-value">
                              <summary>{e.title}</summary>
                              <div>
                                <Prose text={e.meaning} literal />
                              </div>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">
                  The api&apos;s vocabulary did not answer; the codes are in the OpenAPI document&apos;s answers above.
                </p>
              )}
            </Section>

            <Section id="locally" title="Locally, in Python" aside="The same answers without a server.">
              <div className="api-local">
                <p className="api-card__text">
                  The api answers with idtrack, the Python package (Python 3.12 to 3.15). Installed, it builds an
                  organism&apos;s graph once from Ensembl and answers offline, with the same results as this server for
                  the same graph. Its <a href={docsPage()}>documentation</a> has the quickstart, how it answers and its
                  limitations.
                </p>
                <CodeBlock code="pip install idtrack" what="the install command" label="Install" language="bash" />
                <CodeBlock
                  code={PYTHON_EXAMPLE}
                  what="the Python example"
                  label="Convert (idtrack's README)"
                  language="python"
                />
                <h3 className="api-local__title" id="harmonizing">
                  Harmonizing count matrices
                </h3>
                <p className="api-card__text">
                  For single-cell and other count matrices, idtrack&apos;s <Mono>HarmonizeFeatures</Mono> converts the
                  features of several <Mono>.h5ad</Mono> datasets to one Ensembl release and merges them into one
                  AnnData, with a report of every feature&apos;s conversion, nothing dropped or rewritten silently (
                  <a href={docsPage("harmonization.html")}>Harmonizing Datasets</a>, where the example makes its own toy
                  datasets).
                </p>
                <CodeBlock
                  code={'pip install "idtrack[harmonize]"'}
                  what="the install command of the harmonization"
                  label="Install"
                  language="bash"
                />
                <CodeBlock
                  code={HARMONIZE_EXAMPLE}
                  what="the harmonization example"
                  label="Harmonize (idtrack's documentation)"
                  language="python"
                />
              </div>
            </Section>

            <Section
              id="pipeline"
              title="A whole feature list, over HTTP"
              aside="The list's release, batches, waits and the graph's digest beside the answers."
            >
              <p className="api-card__text api-prose">
                A list of any length in requests of at most this server&apos;s <Mono>batch_max</Mono>, read as it was
                when it was made: give the Ensembl release of its annotation (<Mono>FROM_RELEASE</Mono>), or let one{" "}
                <Mono>POST …/source-inference</Mono> find it from the list (its <Mono>from_release</Mono>), sent with
                every batch. It waits as told on <Mono>429</Mono> and <Mono>503</Mono>, keeps a name and its copies (
                <Mono>-1</Mono>, <Mono>.1</Mono> or <Mono>_1</Mono> appended) in one request, keeps only the answers in
                the database asked (<Mono>converted</Mono> and <Mono>tie</Mono>) with how each was read (
                <Mono>match</Mono>), the bridges it crossed and the criterion that decided it, and writes above the
                table the graph every answer came from (<Mono>Idtrack-Graph-Digest</Mono> of each answer, checked to be
                one) and both releases. A batch&apos;s own table (<Mono>format=tsv</Mono>) names the same with{" "}
                <Mono>provenance=true</Mono>.
              </p>
              <CodeChoice
                what="The pipeline"
                items={[
                  { key: "python", label: "Python (requests)", code: pipelinePython(base), language: "python" },
                  { key: "r", label: "R (httr2)", code: pipelineR(base), language: "r" },
                ]}
              />
            </Section>
          </div>
        </div>
      </div>
    </LanguageProvider>
  );
}
