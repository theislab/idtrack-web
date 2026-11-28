// The HTTP API: its base address with its copy, a first request (its code one press away), then how to use the API as
// tabs (the conventions every endpoint shares, how to read an answer, the rules for programs, the error codes), every
// endpoint read live from the server's OpenAPI document (`/api/v1/openapi.json`), each folded to one row that opens to
// its tabs (About, Try it, Response, Examples), and recipes: the same answers from the Python package, and a whole
// feature list over HTTP. The contents (a column beside the reference, a bar on a narrower screen) hold the texts for
// programs and agents (llms.txt, llms-full.txt, the OpenAPI document, the API's index).
import { docsPage } from "../lib/links";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_BASE, api, send, type Exchange } from "../api/client";
import type { LimitsResponse } from "../api/types";
import { ErrorPanel } from "../components/ErrorPanel";
import { CodeBlock, CodeChoice, CodeTabs, LanguageProvider } from "../components/api/CodeTabs";
import { EndpointSection } from "../components/api/EndpointSection";
import { ExchangeView } from "../components/api/Exchange";
import { Button, CopyButton, Mono, Prose, Skeleton } from "../components/ui";
import { Expandable } from "../components/v2/Expandable";
import {
  exampleOrganism,
  exampleRequest,
  recordedRequest,
  requestUrl,
  type OrganismExample,
  type RequestSpec,
} from "../lib/apiExamples";
import { pipelinePython, pipelineR } from "../lib/apiRecipes";
import { rawValueAt } from "../lib/jsonView";
import { groupedInteger, pythonFloat } from "../lib/numbers";
import {
  endpoints,
  fieldsOf,
  firstSentence,
  grouped,
  tocPath,
  type Endpoint,
  type OpenApiDocument,
} from "../lib/openapi";
import { useOrganisms } from "../lib/organisms";
import { parseServerTiming, TIMING_METRICS } from "../lib/serverTiming";
import { usePhone } from "../lib/usePhone";
import { useRequest } from "../lib/useRequest";
import { useLimits, useVocabulary } from "../lib/vocabularyContext";
import "../styles/api.css";

/** Bring the place a press asked for into view, once (the ref is emptied). */
function bringIntoView(place: { current: string | null }) {
  const id = place.current;
  if (id === null) return;
  place.current = null;
  window.document.getElementById(id)?.scrollIntoView();
}

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

/** The rows of "Using the API", each with the address that opens it (`/developers#errors`). */
const GUIDE = [
  { id: "conventions", label: "Conventions", meta: "requests and answers, errors, bounds, timing" },
  { id: "reading", label: "Reading an answer", meta: "the rules, and a recorded answer annotated" },
  { id: "programs", label: "For programs and agents", meta: "how a client should use the API" },
  { id: "errors", label: "Error codes", meta: "each code's status, whether to retry, what it means" },
] as const;
type GuideTab = (typeof GUIDE)[number]["id"];

function isGuideTab(id: string): id is GuideTab {
  return GUIDE.some((g) => g.id === id);
}

/** The texts for programs and agents, each one click away. */
function ProgramTexts({ openapi }: { openapi: string | null }) {
  return (
    <>
      <a href="/llms.txt" className="api-toc__link">
        llms.txt
      </a>
      <a href="/llms-full.txt" className="api-toc__link">
        llms-full.txt
      </a>
      <a href={`${API_BASE}/openapi.json`} className="api-toc__link">
        openapi.json{openapi ? <span className="api-toc__count">OpenAPI {openapi}</span> : null}
      </a>
      <a href={API_BASE} className="api-toc__link">
        The API&apos;s index
      </a>
    </>
  );
}

/** The page's contents: how to use the API (its tabs), every endpoint folded by its group (the group being read
 *  open), the recipes, and the texts for programs. */
function ContentsLinks({
  groups,
  active,
  openapi,
  follow,
  programs,
  onFollow,
}: {
  groups: ReturnType<typeof grouped>;
  active: string | null;
  openapi: string | null;
  follow: (id: string) => void;
  /** The texts for programs: a folded group (beside the reference), or a row of the list (in the bar). */
  programs: "group" | "row";
  onFollow?: () => void;
}) {
  const link = (id: string, label: ReactNode, current: boolean, className = "") => (
    <a
      key={id}
      href={`#${id}`}
      className={`api-toc__link ${className}`}
      aria-current={current ? "location" : undefined}
      onClick={() => {
        follow(id);
        onFollow?.();
      }}
    >
      {label}
    </a>
  );
  return (
    <>
      <TocGroup
        title="Using the API"
        count={GUIDE.length}
        holds={active !== null && (active === "using" || isGuideTab(active))}
      >
        {GUIDE.map((g) => link(g.id, g.label, active === g.id))}
      </TocGroup>
      {groups.map((g) => (
        <TocGroup
          key={g.tag}
          title={g.title}
          count={g.endpoints.length}
          holds={active !== null && (active === `group-${g.tag}` || g.endpoints.some((e) => e.anchor === active))}
        >
          {link(`group-${g.tag}`, `About ${g.title.toLowerCase()}`, active === `group-${g.tag}`)}
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
              active === e.anchor,
              "api-toc__link--endpoint",
            ),
          )}
        </TocGroup>
      ))}
      {link("recipes", "Recipes", active === "recipes")}
      {programs === "group" ? (
        <TocGroup title="For programs" holds={false}>
          <ProgramTexts openapi={openapi} />
        </TocGroup>
      ) : (
        <div className="api-contents__programs" role="group" aria-label="For programs">
          <span className="api-contents__programs-name">For programs</span>
          <ProgramTexts openapi={openapi} />
        </div>
      )}
    </>
  );
}

/** A group of the contents, folded to its name (and count); it opens by itself while one of its entries is read. */
function TocGroup({
  title,
  count,
  holds,
  children,
}: {
  title: string;
  count?: number;
  holds: boolean;
  children: ReactNode;
}) {
  // Open while one of its entries is read, until the reader folds or opens it by hand.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? holds;
  return (
    <details
      className="api-toc__group"
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) setChosen(event.currentTarget.open);
      }}
    >
      <summary className="api-toc__group-name">
        {title} {count !== undefined ? <span className="api-toc__count">{count}</span> : null}
      </summary>
      {open ? children : null}
    </details>
  );
}

/** The section or endpoint being read: the last whose top has passed a line just below where an anchor lands, watched
 *  with an IntersectionObserver (no layout read on scroll). Every target lands at one offset (the page's scroll padding
 *  and the targets' one scroll margin), read once after the first frame (never while the page is laid out the first
 *  time) and again when the window's size changes, so the entry just followed is the one marked. */
function useReading(groups: ReturnType<typeof grouped>, complete: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    const watch = () => {
      observer?.disconnect();
      const targets = [
        ...document.querySelectorAll<HTMLElement>(".api-section, .api-guide__item, .endpoint, .api-first"),
      ];
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
  }, [groups, complete]);
  return active;
}

/** The contents beside the reference on a wide screen. */
function Contents({
  groups,
  complete,
  openapi,
  follow,
}: {
  groups: ReturnType<typeof grouped>;
  complete: boolean;
  openapi: string | null;
  follow: (id: string) => void;
}) {
  const active = useReading(groups, complete);
  return (
    <nav className="api-toc" aria-label="On this page">
      <p className="api-toc__head">On this page</p>
      <ContentsLinks groups={groups} active={active} openapi={openapi} follow={follow} programs="group" />
    </nav>
  );
}

/** On a narrower screen, a bar that stays under the masthead and opens to the same list, the texts for programs a
 *  row of it (no control floats over the text). */
function PhoneContents({
  groups,
  openapi,
  follow,
}: {
  groups: ReturnType<typeof grouped>;
  openapi: string | null;
  follow: (id: string) => void;
}) {
  // The list is drawn only while the bar is open (a folded list is no part of the page).
  const [open, setOpen] = useState(false);
  return (
    <details
      className="api-contents"
      id="contents"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>On this page</summary>
      {open ? (
        <nav aria-label="On this page" className="api-contents__list">
          <ContentsLinks
            groups={groups}
            active={null}
            openapi={openapi}
            follow={follow}
            programs="row"
            onFollow={() => {
              setOpen(false);
            }}
          />
        </nav>
      ) : null}
    </details>
  );
}

/** A first request, above everything else: the example conversion of this server in a sentence and a button, its code
 *  (in the language the page shows) one press away, and its answer on a press, trimmed to what it says, the whole
 *  answer one press away. Without a request it can ask (the organisms not read, none held) it says why, never a request
 *  that cannot answer. */
function FirstRequest({
  origin,
  spec,
  organisms,
}: {
  origin: string;
  /** The convert endpoint's example request; null while it is not known. */
  spec: RequestSpec | null;
  organisms: {
    status: "loading" | "done" | "failed";
    held: number;
    retry: () => void;
    /** The organism the examples ask, and whether the document has come (an example could be read from it). */
    organism: string;
    ready: boolean;
  };
}) {
  const [answer, setAnswer] = useState<Exchange | "asking" | "failed" | null>(null);
  const [shown, setShown] = useState(false);
  const asking = useRef(false);
  const run = () => {
    // A press while the first is out sends nothing more; the button keeps the focus all along.
    if (asking.current || !spec) return;
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
  const value = (name: string) => spec?.values[name] ?? "";
  return (
    <section className="api-first" id="first-request" aria-labelledby="first-request-title">
      <h2 id="first-request-title" className="api-first__title">
        A first request
      </h2>
      {spec ? (
        <>
          <p className="api-card__text">
            Convert <Mono>{value("identifier")}</Mono>
            {value("from_release") ? (
              <>
                {" "}
                as of release <Mono>{value("from_release")}</Mono>
              </>
            ) : null}{" "}
            to {value("final_database") ? <Mono>{value("final_database")}</Mono> : "its Ensembl gene"}
            {value("to_release") ? (
              <>
                {" "}
                at release <Mono>{value("to_release")}</Mono>
              </>
            ) : null}{" "}
            in this server&apos;s <Mono>{value("organism")}</Mono> graph: one <Mono>GET</Mono>, JSON back.
          </p>
          <div className="api-first__run">
            <Button
              variant="primary"
              onClick={run}
              aria-disabled={answer === "asking" ? true : undefined}
              className={answer === "asking" ? "is-busy" : ""}
            >
              {answer === "asking" ? "Asking…" : "Send it"}
            </Button>
            <Button
              variant="quiet"
              aria-expanded={shown}
              aria-controls="first-request-code"
              onClick={() => {
                setShown(!shown);
              }}
            >
              {shown ? "Hide the request" : "Show the request"}
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
          {shown ? (
            <div className="api-first__code" id="first-request-code">
              <CodeTabs origin={origin} spec={spec} what="A first request" />
            </div>
          ) : null}
          {typeof answer === "object" && answer !== null ? (
            <details className="schema__nested api-first__whole">
              <summary>The whole answer, as sent</summary>
              <ExchangeView exchange={answer} what="The first request's answer" />
            </details>
          ) : null}
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
                  : organisms.ready
                    ? `The page knows no identifier of the ${organisms.organism} graph: write one into the console of GET …/convert under Conversion below.`
                    : "Reading the API's document, to ask with its example…"}
          </p>
          {organisms.status === "failed" ? <Button onClick={organisms.retry}>Try again</Button> : null}
        </div>
      )}
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

/** The section "Reading an answer" of /llms-full.txt (the API's one text of its rules), as its list of rules. */
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

/** How to read an answer: the rules, each a line that opens to the whole rule, then the convert endpoint's recorded
 *  answer annotated field by field (one press away). */
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
    <div className="api-reading">
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
                  <p className="api-rule__plain">
                    <Marked text={lead} />
                  </p>
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
        From <a href="/llms-full.txt">/llms-full.txt</a>, section &quot;Reading an answer&quot;: the same rules the API
        gives language models; each opens to the whole rule.
      </p>
      <Expandable
        className="api-reading__figure"
        summary="A recorded answer, annotated"
        meta={
          recorded !== null ? (
            <span className="api-reading__query">
              <Mono>{plain(["query_id"])}</Mono> at release <Mono>{plain(["from_release"])}</Mono> to{" "}
              <Mono>{plain(["final_database"])}</Mono>
            </span>
          ) : undefined
        }
      >
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
                    <Mono>{key}</Mono>{" "}
                    {value.length > 80 ? (
                      <details className="api-annotated__long">
                        <summary>
                          <Mono strong>{value.slice(0, 1)}…</Mono>{" "}
                          <span className="schema__count">{value.length} characters as written</span>
                        </summary>
                        <Mono strong>{value}</Mono>
                      </details>
                    ) : (
                      <Mono strong>{value}</Mono>
                    )}
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
          The convert endpoint&apos;s recorded answer in <Mono>/api/v1/openapi.json</Mono>, of the request{" "}
          <Mono>{plain(["query_id"])}</Mono> at release <Mono>{plain(["from_release"])}</Mono> to{" "}
          <Mono>{plain(["final_database"])}</Mono> at release <Mono>{plain(["to_release"])}</Mono> (strings in their
          JSON quotes), each value as written there, each meaning the document&apos;s description of its field.
        </p>
      </Expandable>
    </div>
  );
}

type ErrorEntry = ReturnType<typeof useVocabulary>["errors"] extends Map<string, infer E> ? E : never;

/** Whether a retry helps, and after what, as the vocabulary says it (`retryable`, `retry_after`). */
function retryWords(e: { retryable: boolean; retryAfter: boolean }): { short: string; long: string } {
  if (!e.retryable) return { short: "no", long: ": change the request" };
  return e.retryAfter
    ? { short: "yes", long: ", after Retry-After" }
    : { short: "yes", long: "; no Retry-After is sent" };
}

/** The GET endpoints whose success carries no `ETag`, as the document declares their headers. */
function withoutEtag(list: Endpoint[]): Endpoint[] {
  return list.filter(
    (e) => e.method === "GET" && !e.answers.some((a) => a.status.startsWith("2") && a.headers.includes("ETag")),
  );
}

/** A list in words: "a", "a and b", "a, b and c". */
function listed(items: ReactNode[]): ReactNode {
  return items.map((item, i) => (
    <span key={i}>
      {i === 0 ? "" : i === items.length - 1 ? " and " : ", "}
      {item}
    </span>
  ));
}

/** The conventions every endpoint shares, each an expandable row with its gist on one line. */
function Conventions({
  limits,
  limitFields,
  limitsFailed,
  timing,
  uncached,
}: {
  limits: LimitsResponse | null;
  limitFields: ReturnType<typeof fieldsOf>;
  limitsFailed: boolean;
  timing: string | null;
  uncached: Endpoint[];
}) {
  const [errorExample, setErrorExample] = useState<Exchange | "asking" | "failed" | null>(null);
  const askError = () => {
    setErrorExample("asking");
    send("GET", `${API_BASE}/organisms/not_an_organism`, null).then(setErrorExample, () => {
      setErrorExample("failed");
    });
  };
  // The bounds the API names as per-client allowances: configured, and applied only where it enforces them.
  const allowances = new Set(limits?.allowance_fields ?? []);
  const allowancesOff = limits !== null && !limits.allowances_enforced;
  return (
    <div className="api-conventions">
      <Expandable className="api-convention" summary="Requests and answers" meta="JSON under /api/v1; no key">
        <ul className="api-list">
          <li>
            Every endpoint is under <Mono>{API_BASE}</Mono> and answers JSON (<Mono>application/json</Mono>); a batch
            can also answer a table (<Mono>format=tsv</Mono>).
          </li>
          <li>
            A <Mono>GET</Mono> takes its arguments in the query; the batch is a <Mono>POST</Mono> of a JSON body with{" "}
            <Mono>Content-Type: application/json</Mono>. A query parameter the endpoint does not take, or one given
            twice, is refused.
          </li>
          <li>
            An organism is its Ensembl production name (<Mono>homo_sapiens</Mono>) or a short name IDTrack knows (
            <Mono>human</Mono>); <Mono>GET /organisms</Mono> lists those this server holds.
          </li>
          <li>
            A result is IDTrack&apos;s <Mono>to_dict()</Mono>: a float is written as the shortest text that reads back
            as the same double, which JSON parsers read exactly. The API adds three things of its own, each said to be
            the API&apos;s: <Mono>cautions</Mono> on every result (its reading of the result&apos;s evidence, each with
            its code and the limitation of IDTrack it falls under), the stable <Mono>error.code</Mono> of a batch item
            that failed, and around a list&apos;s answers the <Mono>organism</Mono> and the <Mono>arguments</Mono> as
            read.
          </li>
          <li>
            No key and no cookie: any page may call the API from a browser (CORS{" "}
            <Mono>Access-Control-Allow-Origin: *</Mono>).
          </li>
          <li>
            A success of a <Mono>GET</Mono> carries an <Mono>ETag</Mono>: sent back as <Mono>If-None-Match</Mono>, an
            unchanged answer is <Mono>304</Mono>, without a search.{" "}
            {uncached.length ? (
              <>
                None is sent by{" "}
                {listed(
                  uncached.map((e) => (
                    <Mono key={e.key}>
                      {e.method} {tocPath(e.path)}
                    </Mono>
                  )),
                )}{" "}
                (their answers are never kept),
              </>
            ) : (
              <>None is sent</>
            )}{" "}
            by a <Mono>POST</Mono> or by a refusal (the headers of each answer: Response, under each endpoint).
          </li>
        </ul>
      </Expandable>
      <Expandable className="api-convention" summary="Errors" meta="one envelope, a stable code">
        <p className="api-card__text">
          Every answer that is not a success is one object, <Mono>{`{"error": {...}}`}</Mono>, with a stable{" "}
          <Mono>code</Mono> (Error codes), a <Mono>message</Mono> that says what to change, the <Mono>argument</Mono> it
          is about and the values it <Mono>allowed</Mono>, where there are any, the <Mono>details</Mono> of a request of
          the wrong shape, and the <Mono>request_id</Mono>. Ask this server for an organism it does not hold:
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
          <Button
            className="api-card__ask"
            onClick={() => {
              if (errorExample !== "asking") askError();
            }}
            aria-disabled={errorExample === "asking" ? true : undefined}
          >
            {errorExample === "asking" ? "Asking…" : "Ask this server"}
          </Button>
        )}
      </Expandable>
      <Expandable
        className="api-convention"
        summary="Bounds of this server"
        meta={limitFields.length ? `${limitFields.length} bounds, GET /api/v1/limits` : "GET /api/v1/limits"}
      >
        {limits && limitFields.length ? (
          <ul className="api-bounds">
            {limitFields.map((f) => {
              const value = (limits as unknown as Record<string, unknown>)[f.name];
              const allowance = allowances.has(f.name);
              return (
                <li key={f.name} className={`api-bounds__row${allowance ? " api-bounds__row--allowance" : ""}`}>
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
        ) : limitsFailed ? (
          <p className="muted">The bounds could not be read: the request of /api/v1/limits failed.</p>
        ) : (
          <Skeleton height={160} />
        )}
        <p className="api-card__source">
          <Mono>GET /api/v1/limits</Mono>, each bound opening to the document&apos;s description of it; the per-client
          allowances are those <Mono>allowance_fields</Mono> names
          {allowancesOff ? ", configured but not applied on this server (allowances_enforced is false)" : ""}.
        </p>
      </Expandable>
      <Expandable className="api-convention" summary="Timing" meta="Server-Timing on every answer">
        <p className="api-card__text">
          Every answer carries <Mono>Server-Timing</Mono>, in milliseconds measured by the server, readable by any page
          (it is exposed to every origin). Its metrics, in the API&apos;s words (<Mono>x-metrics</Mono> of the header in
          the document):
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
      </Expandable>
    </div>
  );
}

/** How a program, an agent or another automated client should use the API: rules, each opening to its whole text. */
function ForPrograms({
  limits,
  waitCodes,
}: {
  limits: LimitsResponse | null;
  /** The error codes whose answers carry `Retry-After`, with their status. */
  waitCodes: [string, { status: number }][];
}) {
  return (
    <ol className="api-rules">
      <li>
        <details className="api-rule">
          <summary>
            <strong>Read the document.</strong>
          </summary>
          <p>
            <a href={`${API_BASE}/openapi.json`}>/api/v1/openapi.json</a> describes every endpoint, parameter and field
            (with the meaning of each), every closed set of codes as an enumeration, the error codes of each endpoint
            and a recorded answer of each, with the request it answers; <a href="/llms-full.txt">/llms-full.txt</a> says
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
            Ask with <Mono>Accept: application/json</Mono>; send a body as <Mono>application/json</Mono>, typed strictly
            (a release is a number, never <Mono>&quot;115&quot;</Mono>).
          </p>
        </details>
      </li>
      <li>
        <details className="api-rule">
          <summary>
            <strong>Branch on the code, not the message.</strong>
          </summary>
          <p>
            <Mono>error.code</Mono> is stable; the message is for people and may change. A code that is not retryable
            (Error codes) will not change on a retry: change the request.
          </p>
        </details>
      </li>
      <li>
        <details className="api-rule">
          <summary>
            <strong>Wait when told to.</strong>
          </summary>
          <p>
            {waitCodes.length ? (
              <>
                On{" "}
                {listed(
                  waitCodes.map(([code, e]) => (
                    <Mono key={code}>
                      {e.status} {code}
                    </Mono>
                  )),
                )}
                , the answer carries <Mono>Retry-After</Mono>: wait that many seconds, then retry; wait longer each time
                it repeats.
              </>
            ) : (
              <>
                Where an answer carries <Mono>Retry-After</Mono>, wait that many seconds, then retry; wait longer each
                time it repeats.
              </>
            )}{" "}
            How to go on after each code is the vocabulary&apos;s <Mono>retry</Mono> (Error codes); the recipe below
            follows it.
          </p>
        </details>
      </li>
      <li>
        <details className="api-rule">
          <summary>
            <strong>Many identifiers, one request.</strong>
          </summary>
          <p>
            Send up to {limits ? <Mono>{groupedInteger(limits.batch_max)}</Mono> : "the bound of"} identifiers in one{" "}
            <Mono>POST …/convert/batch</Mono> rather than one request each: the results come in input order, each with
            its own status, and an identifier whose conversion fails is that item&apos;s error (with its{" "}
            <Mono>code</Mono>). An identifier the API refuses at its boundary (too long, control characters) refuses the
            whole batch, with every such index in <Mono>details</Mono>: correct it and send again. An item that is
            another item of the same batch with <Mono>-</Mono>, <Mono>.</Mono> or <Mono>_</Mono> and a number appended (
            <Mono>TP53-1</Mono>, <Mono>TP53_10</Mono>) can be answered as its copy; send{" "}
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
            {limits ? <Mono>{groupedInteger(limits.response_max_bytes)}</Mono> : "the bound of"} bytes is refused (
            <Mono>response_too_large</Mono>), never cut.
          </p>
        </details>
      </li>
      <li>
        <details className="api-rule">
          <summary>
            <strong>Keep to the bounds of /limits.</strong>
          </summary>
          <p>
            They are under Conventions, Bounds of this server: at most{" "}
            {limits ? <Mono>{limits.identifier_max_length}</Mono> : "the bound of"} characters per identifier,{" "}
            {limits ? <Mono>{pythonFloat(limits.request_seconds)}</Mono> : "the budget of"} s of search per request
            (from when its search begins),{" "}
            {limits ? <Mono>{pythonFloat(limits.search_seconds)}</Mono> : "the budget of"} s per identifier&apos;s
            search, and at most {limits ? <Mono>{pythonFloat(limits.queue_seconds)}</Mono> : "the bound of"} s waiting
            for a worker (longer is <Mono>503 server_busy</Mono>, unsearched); the rate is {rateWords(limits)}.
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
            <Mono>/organisms</Mono> and <Mono>/version</Mono> change only when the server&apos;s graphs or versions do (
            <Mono>/version</Mono> names each graph&apos;s content digest), so they can be kept between runs.
          </p>
        </details>
      </li>
      <li>
        <details className="api-rule">
          <summary>
            <strong>Quote the request id</strong>
          </summary>
          <p>
            (<Mono>error.request_id</Mono>, also the <Mono>X-Request-ID</Mono> header of every answer) when reporting an{" "}
            <Mono>internal_error</Mono>.
          </p>
        </details>
      </li>
    </ol>
  );
}

/** The error codes of `/vocabulary`: each its status, whether a retry helps (and after what), and what it says. */
function ErrorCodes({ errors }: { errors: [string, ErrorEntry][] }) {
  return errors.length ? (
    <div className="table-wrap" role="region" aria-label="Table of error codes" tabIndex={0}>
      <table className="table table--compact table--cards api-errors">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col" className="num">
              Status
            </th>
            <th scope="col">Retry</th>
            <th scope="col">What it says (each opens to when, and how to go on)</th>
          </tr>
        </thead>
        <tbody>
          {errors.map(([code, e]) => {
            const retry = retryWords(e);
            return (
              <tr key={code}>
                <td data-label="Code">
                  <Mono strong>{code}</Mono>
                </td>
                <td data-label="Status" className="num">
                  <Mono>{e.status}</Mono>
                </td>
                <td data-label="Retry">
                  {retry.short}
                  <span className="api-errors__long">{retry.long}</span>
                </td>
                <td data-label="When" className="cell-wrap">
                  {/* One child: in the cards of a phone, prose with code wraps as one paragraph. */}
                  <details className="cell-value">
                    <summary>{e.title}</summary>
                    <div>
                      <Prose text={e.meaning} literal /> <Prose text={e.retry} literal />
                    </div>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="muted">
      The API&apos;s vocabulary did not answer; the codes are in the OpenAPI document&apos;s answers of each endpoint.
    </p>
  );
}

const INSTALL = `pip install idtrack                  # the package
pip install "idtrack[harmonize]"     # with HarmonizeFeatures, for count matrices`;

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

/** The page's head: the same in every state, and drawn into the page the server sends before the code runs
 *  (scripts/prerender.ts). */
export function ApiHead() {
  return (
    <header className="page-head api-head">
      <h1>IDTrack over HTTP</h1>
      <p className="lede">Every answer on this site comes from this API, and every example runs here.</p>
    </header>
  );
}

export function ApiPage() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const base = `${origin}${API_BASE}`;
  const document = useRequest("openapi", (signal) => api.openapi(signal));
  const limits = useLimits();
  const vocabulary = useVocabulary();
  const { organisms, facts, status: organismsStatus, retry: retryOrganisms } = useOrganisms();
  const heldKey = organisms.map((o) => o.organism).join(" ");
  const held = useMemo(() => (heldKey ? heldKey.split(" ") : []), [heldKey]);
  const { organism, example } = exampleOrganism(held);
  const phone = usePhone();
  const doc = document.state === "done" ? (document.answer.data as OpenApiDocument) : null;
  const raw = document.state === "done" ? document.answer.raw : null;
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
  // Every endpoint's example request of this server, and the request its recorded answer is of (made once per
  // document and organisms: a console keeps what is typed into it).
  const examples = useMemo(
    () =>
      new Map(
        list.map((e) => [
          e.anchor,
          {
            example: exampleRequest(e, organism, example, held),
            recorded: recordedRequest(e),
          },
        ]),
      ),
    [list, organism, example, held],
  );
  const timing = document.state === "done" ? (document.answer.serverTiming ?? null) : null;
  const limitFields = doc ? fieldsOf(doc, "LimitsResponse") : [];
  const complete = doc !== null;
  const openapi = doc?.openapi ?? null;

  // The first request: the convert endpoint's example (the document's recorded request where this server can answer
  // it); without the document, the page's own example of the organism, so the first request does not wait on it.
  const convert = list.find((e) => e.key === `GET ${API_BASE}/organisms/{organism}/convert`);
  const convertExample = convert ? (examples.get(convert.anchor)?.example ?? null) : null;
  // Asked only of an organism this server holds, with an identifier to ask.
  const firstSpec: RequestSpec | null =
    organismsStatus !== "done"
      ? null
      : convertExample
        ? held.includes(convertExample.values["organism"] ?? "") && convertExample.values["identifier"]
          ? convertExample
          : null
        : document.state === "failed" && example
          ? fallbackFirst(organism, example)
          : null;

  // Which endpoints are open, which tab of "Using the API" is shown, and where to bring the window once drawn.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [guide, setGuide] = useState<ReadonlySet<GuideTab>>(() => new Set());
  // Where to bring the window once the page is drawn with the change a press made.
  const scrollTo = useRef<string | null>(null);
  const anchors = useMemo(() => new Set(list.map((e) => e.anchor)), [list]);
  /** Follow an address of the page: a tab of "Using the API" is chosen, an endpoint opened (on a phone, the only one
   *  open), and either brought into view once drawn. False where the address is none of these. */
  const follow = useCallback(
    (id: string): boolean => {
      const target = isGuideTab(id) || anchors.has(id) ? id : null;
      if (target === null) return false;
      if (isGuideTab(id)) setGuide((now) => (now.has(id) ? now : new Set(now).add(id)));
      else
        setOpen((now) =>
          now.has(id) && (!phone || now.size === 1) ? now : phone ? new Set([id]) : new Set(now).add(id),
        );
      scrollTo.current = target;
      // Where nothing changed (the tab already shown, the endpoint already open), no drawing follows: the next frame.
      requestAnimationFrame(() => {
        bringIntoView(scrollTo);
      });
      return true;
    },
    [anchors, phone],
  );
  const toggle = (id: string) => {
    setOpen((now) => {
      if (now.has(id)) {
        const next = new Set(now);
        next.delete(id);
        return next;
      }
      // On a phone one endpoint is open at a time: its console is the one on the screen.
      return phone ? new Set([id]) : new Set(now).add(id);
    });
  };
  // After every drawing: the place a press asked for, once.
  useLayoutEffect(() => {
    bringIntoView(scrollTo);
  });
  // The address's fragment, on arrival (once the document is drawn) and on every change.
  useEffect(() => {
    if (!complete) return;
    const read = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && !follow(id)) window.document.getElementById(id)?.scrollIntoView();
    };
    read();
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("hashchange", read);
    };
  }, [complete, follow]);

  const errors = [...vocabulary.errors.entries()];
  const waitCodes = errors.filter(([, e]) => e.retryable && e.retryAfter);
  const uncached = withoutEtag(list);

  const guidePanel = (id: GuideTab): ReactNode =>
    id === "conventions" ? (
      <Conventions
        limits={limits}
        limitFields={limitFields}
        limitsFailed={facts.limits === "failed" || document.state === "failed"}
        timing={timing}
        uncached={uncached}
      />
    ) : id === "reading" ? (
      <ReadingAnAnswer doc={doc} raw={raw} />
    ) : id === "programs" ? (
      <ForPrograms limits={limits} waitCodes={waitCodes} />
    ) : (
      <ErrorCodes errors={errors} />
    );

  return (
    <LanguageProvider>
      <div className="page api-page">
        <ApiHead />

        <p className="api-base">
          <span className="api-base__label">Base address</span>
          <Mono strong>{base}</Mono>
          <CopyButton text={base} what="the base address" />
        </p>

        <PhoneContents groups={groups} openapi={openapi} follow={follow} />

        <div className="api-layout">
          <Contents groups={groups} complete={complete} openapi={openapi} follow={follow} />
          <div className="api-main">
            <FirstRequest
              origin={origin}
              spec={firstSpec}
              organisms={{
                status: organismsStatus,
                held: held.length,
                retry: retryOrganisms,
                organism,
                ready: document.state !== "loading",
              }}
            />

            <Section id="using" title="Using the API">
              <div className="api-guide">
                {GUIDE.map((g) => (
                  <div key={g.id} id={g.id} className="api-guide__item">
                    <Expandable
                      summary={g.label}
                      meta={g.meta}
                      expanded={guide.has(g.id)}
                      onExpandedChange={(opened) => {
                        setGuide((now) => {
                          const next = new Set(now);
                          if (opened) next.add(g.id);
                          else next.delete(g.id);
                          return next;
                        });
                      }}
                    >
                      {guidePanel(g.id)}
                    </Expandable>
                  </div>
                ))}
              </div>
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
                <Section key={g.tag} id={`group-${g.tag}`} title={g.title} aside={g.about}>
                  <div className="endpoints">
                    {g.endpoints.map((e) => {
                      const made = examples.get(e.anchor);
                      if (!made) return null;
                      return (
                        <EndpointSection
                          key={`${e.key} ${requestUrl("", made.example)} ${made.example.body ?? ""}`}
                          document={doc}
                          endpoint={e}
                          example={made.example}
                          recorded={made.recorded}
                          origin={origin}
                          organisms={held}
                          open={open.has(e.anchor)}
                          onToggle={() => {
                            toggle(e.anchor);
                          }}
                          releases={releases}
                          batchMax={limits?.batch_max ?? null}
                          raw={raw}
                        />
                      );
                    })}
                  </div>
                </Section>
              ))
            )}

            <Section id="recipes" title="Recipes">
              <div className="api-guide api-recipes">
                <Expandable summary="Locally, in Python" meta="IDTrack itself: the same answers without a server">
                  <div className="api-local">
                    <p className="api-card__text">
                      The API answers with IDTrack, the Python package (Python 3.12 to 3.15). Installed, it builds an
                      organism&apos;s graph once from Ensembl and answers offline, with the same results as this server
                      for the same graph. Its <a href={docsPage()}>documentation</a> has the quickstart, how it answers
                      and its limitations.
                    </p>
                    <p className="api-card__text" id="harmonizing">
                      For single-cell and other count matrices, IDTrack&apos;s <Mono>HarmonizeFeatures</Mono> converts
                      the features of several <Mono>.h5ad</Mono> datasets to one Ensembl release and merges them into
                      one AnnData, with a report of every feature&apos;s conversion, nothing dropped or rewritten
                      silently (<a href={docsPage("harmonization.html")}>Harmonizing Datasets</a>, where the example
                      makes its own toy datasets).
                    </p>
                    <CodeBlock code={INSTALL} what="the install commands" label="Install" language="bash" />
                    <CodeChoice
                      what="IDTrack in Python"
                      items={[
                        {
                          key: "convert",
                          label: "Convert (IDTrack's README)",
                          code: PYTHON_EXAMPLE,
                          language: "python",
                        },
                        {
                          key: "harmonize",
                          label: "Harmonize (IDTrack's documentation)",
                          code: HARMONIZE_EXAMPLE,
                          language: "python",
                        },
                      ]}
                    />
                  </div>
                </Expandable>
                <Expandable
                  summary="A whole feature list, over HTTP"
                  meta="in Python and R: the list dated, batched and written with its provenance"
                >
                  <>
                    <p className="api-card__text api-prose">
                      A list of any length in requests of at most this server&apos;s <Mono>batch_max</Mono>, read as it
                      was when it was made: give the Ensembl release of its annotation (<Mono>FROM_RELEASE</Mono>
                      ), or let one <Mono>POST …/source-inference</Mono> date the list. IDTrack&apos;s answer is a band
                      of releases the list fits as well as its best one, and a <Mono>margin</Mono>: where the margin is
                      a number, every batch is read at the inferred <Mono>from_release</Mono>; where it is{" "}
                      <Mono>null</Mono>, the band holds every release, the list does not date itself, and each
                      identifier is read at its own release (with a warning). The band and the margin are written in the
                      table&apos;s first line either way.
                    </p>
                    <p className="api-card__text api-prose">
                      It waits as told on <Mono>429</Mono> and <Mono>503</Mono>, sends a batch in halves when{" "}
                      <Mono>request_budget_exceeded</Mono> comes again, keeps a name and its copies (the name with{" "}
                      <Mono>-</Mono>, <Mono>.</Mono> or <Mono>_</Mono> and a number appended, IDTrack&apos;s rule) in
                      one request, keeps only the answers in the database asked (<Mono>converted</Mono> and{" "}
                      <Mono>tie</Mono>) with how each was read (<Mono>match</Mono>), the bridges it crossed and the
                      criterion that decided it, and writes above the table the graph every answer came from (
                      <Mono>Idtrack-Graph-Digest</Mono> of each answer, checked to be one) and both releases. A
                      batch&apos;s own table (<Mono>format=tsv</Mono>) names the same with <Mono>provenance=true</Mono>.
                    </p>
                    <CodeChoice
                      what="The pipeline"
                      items={[
                        {
                          key: "python",
                          label: "Python (requests)",
                          code: pipelinePython(base),
                          language: "python",
                        },
                        { key: "r", label: "R (httr2)", code: pipelineR(base), language: "r" },
                      ]}
                    />
                  </>
                </Expandable>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </LanguageProvider>
  );
}

/** The first request without the document: convert the page's example identifier of the organism, at the graph's
 *  last release (every parameter but the identifier left to the API's defaults). */
function fallbackFirst(organism: string, example: OrganismExample): RequestSpec {
  return {
    method: "GET",
    path: `${API_BASE}/organisms/{organism}/convert`,
    values: { organism, identifier: example.identifier },
    kinds: { identifier: "string" },
    order: ["identifier"],
    pathNames: ["organism"],
    body: null,
  };
}
