// Convert one identifier: the form, and the answer with its candidates, its path and why the best won.
import { Suspense, useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { api, API_BASE, queryString } from "../api/client";
import type { GraphDescription } from "../api/types";
import { ConvertEmpty } from "../components/ConvertEmpty";
import { CaseTour } from "../components/home/CaseTour";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ErrorPanel } from "../components/ErrorPanel";
import { ResultSkeleton } from "../components/ResultSkeleton";
import { Button, Field, Select, Switch, TextInput } from "../components/ui";
import {
  convertHref,
  plainConversion,
  readParameters,
  releaseOf,
  type ConvertParameters,
} from "../lib/convertParameters";
import { assemblyBands } from "../components/figure/releases";
import { databaseLabel, sortDatabases } from "../lib/databases";
import { commonName, organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { announce } from "../lib/announce";
import { refusedArguments } from "../lib/refusals";
import { BATCH_TEXT_DRAFT } from "../lib/batchList";
import { draftOver, isRecord, keepDraftOver, readDraft, writeDraft } from "../lib/drafts";
import { revealArea, useFocusMove } from "../lib/focus";
import { lazyPart } from "../lib/lazyPart";
import { groupedInteger } from "../lib/numbers";
import { conversionSentence, conversionTitle } from "../lib/outcomes";
import { href, navigate, useLocation } from "../lib/router";
import { setTitleDetail } from "../lib/title";
import { useRequest } from "../lib/useRequest";
import { useLimits } from "../lib/vocabularyContext";
import { examplesOf, type Example } from "../lib/home/examples";
import { useShowcase } from "../lib/showcase";
import "../styles/convert.css";

// The answer's view (with the path view and its d3 modules) is fetched when a result needs it: the first load stays
// small, and the skeleton of the result stands in while it loads.
const ResultView = lazyPart(() => import("../components/ResultView").then((m) => ({ default: m.ResultView })));

const isRelease = (text: string) => text.trim() === "" || /^\d+$/.test(text.trim());

function ReleaseField({
  label,
  hint,
  value,
  onChange,
  description,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  description: GraphDescription;
  placeholder: string;
}) {
  const listId = useId();
  const invalid = !isRelease(value);
  return (
    <Field label={label} hint={hint} error={invalid ? "A release is a whole number." : null}>
      {({ id, describedBy }) => (
        <>
          <TextInput
            id={id}
            inputMode="numeric"
            className="input--mono input--release"
            value={value}
            placeholder={placeholder}
            list={listId}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
          <datalist id={listId}>
            {description.releases.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </>
      )}
    </Field>
  );
}

export function ConvertPage() {
  const { current } = useOrganisms();
  const location = useLocation();
  const parameters = readParameters(location.search);
  // Before a conversion the page is the hero (components/ConvertEmpty.tsx), whose head paints before the organisms are
  // known; once a conversion is asked, the page is its answer under the form in one row, with no page intro: the
  // answer is the first screen's subject.
  const idle = !parameters.identifier;
  return (
    <div className={`page page--convert${idle ? " page--hero" : " page--answer"}`}>
      {idle && !current ? <ConvertEmpty description={null} form={null} /> : null}
      {!idle && !current ? <ConvertTitle /> : null}
      {current ? (
        <ConvertForOrganism
          key={current.organism}
          description={current}
          parameters={parameters}
          linkedGraph={location.search.get("graph")}
        />
      ) : null}
    </div>
  );
}

/** The page's title over an answer: the section's name above the form, in the eyebrow's type (the answer below is the
 *  screen's subject; the hero said what idtrack does). */
function ConvertTitle() {
  return <h1 className="convert-title eyebrow">Convert</h1>;
}

/** The fields of the address that the api is asked; their refused value can be left out (a way on after a refusal). */
const FIELD_OF_ARGUMENT: Record<string, { field: keyof ConvertParameters; label: string }> = {
  from_release: { field: "fromRelease", label: "the from release" },
  to_release: { field: "toRelease", label: "the to release" },
  final_database: { field: "finalDatabase", label: "the target database" },
  from_database: { field: "fromDatabase", label: "the source database" },
};

function ConvertForOrganism({
  description,
  parameters,
  linkedGraph,
}: {
  description: GraphDescription;
  parameters: ConvertParameters;
  /** The graph's short digest a copied link carries (`graph=`), or null. */
  linkedGraph: string | null;
}) {
  const organism = description.organism;
  // A release in the address that is no whole number is said at once, in the graph's terms, and nothing is asked.
  const notRelease =
    typeof parameters.fromRelease === "string"
      ? ({ field: "fromRelease", value: parameters.fromRelease, label: "the from release" } as const)
      : typeof parameters.toRelease === "string"
        ? ({ field: "toRelease", value: parameters.toRelease, label: "the to release" } as const)
        : null;
  const query =
    parameters.identifier && !notRelease
      ? {
          identifier: parameters.identifier,
          // A release that is not a number goes to the api as written: its refusal is the message shown.
          from_release: parameters.fromRelease as number | null,
          to_release: parameters.toRelease as number | null,
          final_database: parameters.finalDatabase,
          from_database: parameters.fromDatabase,
          explain: parameters.explain,
          allow_bridges: parameters.allowBridges,
        }
      : null;
  const key = query ? `${organism}|${JSON.stringify(query)}` : null;
  // A conversion the person cancelled while it was on its way: asked no more until Convert is pressed again.
  const [cancelled, setCancelled] = useState<string | null>(null);
  const isCancelled = key !== null && key === cancelled;
  const result = useRequest(isCancelled ? null : key, (signal, fresh) => {
    if (!query) throw new Error("No identifier to convert.");
    return api.convert(organism, query, { signal, fresh });
  });
  const area = useRef<HTMLElement>(null);
  // A conversion asked after the page opened (the form, an example, a link of the page, Back) is brought into view
  // and its answer focused when it comes; the conversion of the address the page opened with is left where it is.
  const follow = useRef(false);
  const moveFocus = useFocusMove();
  const firstKey = useRef(key);
  useEffect(() => {
    if (key === null || key === firstKey.current) return;
    firstKey.current = null;
    follow.current = true;
    revealArea(area.current);
    if (query) announce(`Converting ${query.identifier}…`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of the conversion counts, not its parameters' identity
  }, [key]);
  const settled = result.state === "done" || result.state === "failed";
  useEffect(() => {
    if (!settled || !follow.current) return;
    follow.current = false;
    if (result.state === "done") announce(conversionSentence(result.answer.data));
    moveFocus(() => area.current, '[data-result] h2, [role="alert"] .notice__title');
  }, [settled, result, moveFocus]);
  useEffect(() => {
    if (result.state !== "done") return;
    setTitleDetail(conversionTitle(result.answer.data));
    return () => {
      setTitleDetail(null);
    };
  }, [result]);

  const go = (next: ConvertParameters) => {
    setCancelled(null);
    const target = convertHref(organism, next);
    if (target !== window.location.pathname + window.location.search) {
      navigate(target);
      return;
    }
    // The same conversion again: while it is on its way, a second press asks nothing more; once answered, it is asked
    // of the api again (on purpose: the person pressed Convert).
    if (result.state === "loading") return;
    follow.current = true;
    revealArea(area.current);
    result.retry();
  };
  const refused = result.state === "failed" ? refusedArguments(result.error) : [];
  const ways = refused
    .map((argument) => ({ argument, field: FIELD_OF_ARGUMENT[argument] }))
    .filter((w): w is { argument: string; field: { field: keyof ConvertParameters; label: string } } =>
      Boolean(w.field && parameters[w.field.field] !== null),
    );

  // Before a conversion, the hero with the form in it; then the compact form over the answer (also over a refusal of
  // the address or a cancelled conversion, which send nothing).
  if (result.state === "idle" && !notRelease && !isCancelled)
    return (
      <ConvertEmpty
        description={description}
        form={<ConvertForm description={description} parameters={parameters} onSubmit={go} variant="hero" />}
      />
    );
  return (
    <>
      <ConvertTitle />
      {/* One form for the answer's life: it follows the address (a link, Back), and a submit keeps its focus. */}
      <ConvertForm description={description} parameters={parameters} onSubmit={go} />

      <section
        className="result-area"
        aria-busy={result.state === "loading"}
        aria-label={`The conversion of ${parameters.identifier || "an identifier"}`}
        ref={area}
      >
        {notRelease ? (
          <div className="notice notice--danger" role="alert">
            <h2 className="notice__title">Not a release: {notRelease.value}</h2>
            <p>
              A release is a whole number; the <em>{organismName(organism)}</em> graph holds releases{" "}
              <span className="mono">{description.releases[0]}</span> to{" "}
              <span className="mono">{description.releases[description.releases.length - 1]}</span>. Nothing was asked
              of the api.
            </p>
            <div className="notice__actions">
              <Button
                onClick={() => {
                  go({ ...parameters, [notRelease.field]: null });
                }}
              >
                Convert without {notRelease.label}
              </Button>
            </div>
          </div>
        ) : null}
        {isCancelled ? (
          <div className="notice" role="status">
            <p>
              The conversion of <span className="mono">{parameters.identifier}</span> was cancelled; nothing more is
              asked of the api.
            </p>
            <div className="notice__actions">
              <Button
                onClick={() => {
                  setCancelled(null);
                }}
              >
                Convert it again
              </Button>
            </div>
          </div>
        ) : null}
        {result.state === "loading" ? (
          <>
            <Waiting
              identifier={parameters.identifier}
              onCancel={() => {
                setCancelled(key);
                announce(`The conversion of ${parameters.identifier} was cancelled.`);
              }}
            />
            <ResultSkeleton description={description} />
          </>
        ) : null}
        {result.state === "failed" ? (
          <ErrorPanel
            error={result.error}
            onRetry={result.retry}
            context="The conversion"
            actions={ways.map((w) => (
              <Button
                key={w.argument}
                onClick={() => {
                  go({ ...parameters, [w.field.field]: null });
                }}
              >
                Convert without {w.field.label}
              </Button>
            ))}
          />
        ) : null}
        {result.state === "done" && query ? (
          <ErrorBoundary part="The answer" resetKey={key ?? ""}>
            <Suspense fallback={<ResultSkeleton description={description} />}>
              <div data-result="">
                <CaseTour organism={organism} parameters={parameters} />
                <GraphNotice linked={linkedGraph} description={description} />
                <ResultView
                  result={result.answer.data}
                  raw={result.answer.raw}
                  description={description}
                  requestedDatabase={parameters.finalDatabase}
                  apiUrl={`${API_BASE}/organisms/${encodeURIComponent(organism)}/convert${queryString({ ...query })}`}
                  serverTiming={result.answer.serverTiming}
                  requestId={result.answer.requestId}
                />
              </div>
            </Suspense>
          </ErrorBoundary>
        ) : null}
      </section>
    </>
  );
}

/** A conversion on its way: after a moment, what is being asked and for how long, with a way to stop it. */
function Waiting({ identifier, onCancel }: { identifier: string; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  if (seconds < 2) return null;
  return (
    <div className="notice convert-waiting">
      <p>
        Converting <span className="mono">{identifier}</span>… <span className="mono">{seconds}</span> s. A large answer
        or a busy server takes longer; the server&apos;s load is in the masthead.
      </p>
      <div className="notice__actions">
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** A link made on another graph than the server's: said above the answer, which is this graph's. */
function GraphNotice({ linked, description }: { linked: string | null; description: GraphDescription }) {
  const here = description.content_digest?.slice(0, 12) ?? null;
  if (!linked || !here || linked.toLowerCase() === here) return null;
  return (
    <div className="notice notice--warn graph-notice" role="note">
      <h2 className="notice__title">This link was made on another graph</h2>
      <p>
        The link names the graph <span className="mono">{linked}</span>; this server holds the{" "}
        <em>{organismName(description.organism)}</em> graph <span className="mono">{here}</span> (its content digest).
        The answer below is this graph&apos;s, and can differ from the one the link was copied from.
      </p>
    </div>
  );
}

/** The form's fields as text, from the address. */
function fieldsOf(parameters: ConvertParameters) {
  return {
    fromRelease: parameters.fromRelease === null ? "" : String(parameters.fromRelease),
    toRelease: parameters.toRelease === null ? "" : String(parameters.toRelease),
    finalDatabase: parameters.finalDatabase ?? "",
    fromDatabase: parameters.fromDatabase ?? "",
    allowBridges: parameters.allowBridges,
    explain: parameters.explain,
  };
}
type Fields = ReturnType<typeof fieldsOf>;

const isFieldsDraft = (value: unknown): value is { over: string; fields: Fields } => {
  if (!isRecord(value) || typeof value["over"] !== "string" || !isRecord(value["fields"])) return false;
  const f = value["fields"];
  return (
    ["fromRelease", "toRelease", "finalDatabase", "fromDatabase"].every((k) => typeof f[k] === "string") &&
    typeof f["allowBridges"] === "boolean" &&
    typeof f["explain"] === "boolean"
  );
};

/** Lines of a pasted text (every common line ending), without empty ones. */
function pastedLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n|\u2028|\u0085/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ConvertForm({
  description,
  parameters,
  onSubmit,
  variant = "compact",
}: {
  description: GraphDescription;
  parameters: ConvertParameters;
  onSubmit: (parameters: ConvertParameters) => void;
  /** In the hero (the releases and the database folded, the organism beside them) or over an answer. */
  variant?: "hero" | "compact";
}) {
  const organism = description.organism;
  const hero = variant === "hero";
  const { organisms, choose } = useOrganisms();
  const limits = useLimits();
  // What the address says, and what was typed over it and not sent: the identifier is kept across organisms (the
  // address keeps it too), the other fields belong to one graph (lib/drafts.ts).
  const addressKey = JSON.stringify(parameters);
  const fieldsKey = `convert.fields.${organism}`;
  const typedFields = (): Fields => {
    const kept = readDraft(fieldsKey, isFieldsDraft);
    return kept?.over === addressKey ? kept.fields : fieldsOf(parameters);
  };
  const [synced, setSynced] = useState(addressKey);
  const [identifier, setIdentifierState] = useState(() => draftOver("convert.identifier", parameters.identifier));
  const [fields, setFieldsState] = useState(typedFields);
  const [missing, setMissing] = useState(false);
  const [pasted, setPasted] = useState<string[] | null>(null);
  if (synced !== addressKey) {
    // The address changed (a submit, a link, Back): the form shows it, without being made anew (its focus stays).
    setSynced(addressKey);
    setIdentifierState(draftOver("convert.identifier", parameters.identifier));
    setFieldsState(typedFields());
    setMissing(false);
  }
  const setIdentifier = (text: string) => {
    setIdentifierState(text);
    keepDraftOver("convert.identifier", parameters.identifier, text);
  };
  const setField = <K extends keyof Fields>(name: K, value: Fields[K]) => {
    const next = { ...fields, [name]: value };
    setFieldsState(next);
    const same = JSON.stringify(next) === JSON.stringify(fieldsOf(parameters));
    writeDraft(fieldsKey, same ? undefined : { over: addressKey, fields: next });
  };
  const { fromRelease, toRelease, finalDatabase, fromDatabase, allowBridges, explain } = fields;
  const setFromRelease = (v: string) => {
    setField("fromRelease", v);
  };
  const setToRelease = (v: string) => {
    setField("toRelease", v);
  };
  const setFinalDatabase = (v: string) => {
    setField("finalDatabase", v);
  };
  const setFromDatabase = (v: string) => {
    setField("fromDatabase", v);
  };
  const setAllowBridges = (v: boolean) => {
    setField("allowBridges", v);
  };
  const setExplain = (v: boolean) => {
    setField("explain", v);
  };
  // The releases and the database fold under one line that says them, a press away from their fields: over an answer
  // always (the form is one row and the answer the screen's subject), in the hero unless the address sets one of them.
  const settingsId = useId();
  const [settingsOpen, setSettingsOpen] = useState(
    () =>
      hero && (parameters.fromRelease !== null || parameters.toRelease !== null || parameters.finalDatabase !== null),
  );
  const [advanced, setAdvanced] = useState(
    parameters.fromDatabase !== null || !parameters.allowBridges || !parameters.explain,
  );

  const toNumber = /^\d+$/.test(toRelease.trim()) ? Number(toRelease.trim()) : null;
  const finals = useRequest(`${organism}:${toNumber ?? "snapshot"}`, (signal, fresh) =>
    api.finalDatabases(organism, toNumber, { signal, fresh }),
  );
  const finalOptions =
    finals.state === "done"
      ? sortDatabases(finals.answer.data.final_databases)
      : sortDatabases(description.final_databases);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!identifier.trim()) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setPasted(null);
    if (!isRelease(fromRelease) || !isRelease(toRelease)) return;
    keepDraftOver("convert.identifier", identifier.trim(), identifier.trim());
    writeDraft(fieldsKey, undefined);
    onSubmit({
      identifier: identifier.trim(),
      fromRelease: releaseOf(fromRelease),
      toRelease: releaseOf(toRelease),
      finalDatabase: finalDatabase === "" ? null : finalDatabase,
      fromDatabase: fromDatabase === "" ? null : fromDatabase,
      allowBridges,
      explain,
    });
  };

  // The hero's examples: conversions of the graph's showcase that travel, each labelled by what its answer shows.
  const showcase = useShowcase(hero ? organism : null);
  const examples = examplesOf(showcase.state === "done" ? showcase.answer.data : null, organism);

  return (
    <form
      className={`${hero ? "" : "panel "}convert-form convert-form--${variant}${settingsOpen ? "" : " convert-form--folded"}`}
      onSubmit={submit}
      noValidate
      aria-label="Conversion"
    >
      <div className="convert-form__main">
        <Field
          label="Identifier"
          className="field--identifier"
          error={missing ? "Enter an identifier to convert." : null}
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              className="input--mono input--large"
              value={identifier}
              placeholder="a gene id, symbol or accession"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="go"
              aria-describedby={describedBy}
              aria-invalid={missing}
              aria-required="true"
              maxLength={256}
              onChange={(e) => {
                setIdentifier(e.target.value);
              }}
              onPaste={(e) => {
                // A pasted column of identifiers is not joined into one: the page offers the list to Batch.
                const lines = pastedLines(e.clipboardData.getData("text"));
                if (lines.length < 2) return;
                e.preventDefault();
                setPasted(lines);
              }}
            />
          )}
        </Field>
        <div
          id={settingsId}
          className={`convert-form__settings${settingsOpen ? "" : " is-collapsed"}`}
          role="group"
          aria-label={hero ? "Organism, releases and database" : "Releases and database"}
        >
          {hero && organisms.length > 1 ? (
            <Field label="Organism" className="field--organism">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  value={organism}
                  aria-describedby={describedBy}
                  onChange={(e) => {
                    choose(e.target.value);
                  }}
                >
                  {organisms.map((o) => (
                    <option key={o.organism} value={o.organism}>
                      {organismName(o.organism)}
                      {commonName(o.organism) ? ` (${commonName(o.organism)})` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <ReleaseField
            label="From release"
            hint="Where the identifier is read. Empty: idtrack infers it."
            value={fromRelease}
            onChange={setFromRelease}
            description={description}
            placeholder="inferred"
          />
          <ReleaseField
            label="To release"
            hint={`The release asked. Empty: ${description.snapshot_release}, the graph's last.`}
            value={toRelease}
            onChange={setToRelease}
            description={description}
            placeholder={String(description.snapshot_release)}
          />
          <Field
            label="Target database"
            className="field--database"
            hint="An Ensembl gene id (the default) or the gene's id in another database at the release asked."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={finalDatabase}
                aria-describedby={describedBy}
                onChange={(e) => {
                  setFinalDatabase(e.target.value);
                }}
              >
                <option value="">Ensembl gene (with version), the default</option>
                {finalOptions
                  .filter((d) => d !== "ensembl_gene")
                  .map((d) => (
                    <option key={d} value={d}>
                      {databaseLabel(d)}
                    </option>
                  ))}
                {finalDatabase && !finalOptions.includes(finalDatabase) ? (
                  <option value={finalDatabase}>{databaseLabel(finalDatabase)} (not at this release)</option>
                ) : null}
              </Select>
            )}
          </Field>
        </div>
        <button
          type="button"
          className="convert-form__settings-toggle"
          aria-expanded={settingsOpen}
          aria-controls={settingsId}
          onClick={() => {
            setSettingsOpen((o) => !o);
          }}
        >
          <span className="convert-form__settings-label">
            {hero ? "Organism, releases and database" : "Releases and database"}
          </span>{" "}
          <span className="convert-form__settings-value">
            {hero ? (
              <>
                <em>{organismName(organism)}</em>,{" "}
              </>
            ) : null}
            from <span className="mono">{fromRelease.trim() || "inferred"}</span> to{" "}
            <span className="mono">{toRelease.trim() || description.snapshot_release}</span>,{" "}
            {finalDatabase ? databaseLabel(finalDatabase) : "Ensembl gene"}
          </span>
        </button>
        <Button type="submit" variant="primary" className="convert-form__go">
          Convert
        </Button>
        {hero ? (
          <Examples
            examples={examples}
            waiting={showcase.state === "loading" || showcase.state === "idle"}
            onPick={(e) => {
              onSubmit({
                ...plainConversion(e.query.identifier),
                fromRelease: e.query.from ?? null,
                toRelease: e.query.to ?? null,
                finalDatabase: e.query.db ?? null,
              });
            }}
          />
        ) : null}
      </div>
      {pasted ? (
        <div className="notice convert-form__pasted" role="status">
          <p>
            You pasted {groupedInteger(pasted.length)} lines. This field converts one identifier; Batch converts a list
            {limits ? ` of up to ${groupedInteger(limits.batch_max)}` : ""} with the same setting.
          </p>
          <div className="notice__actions">
            <Button
              variant="primary"
              onClick={() => {
                writeDraft(BATCH_TEXT_DRAFT, pasted.join("\n"));
                navigate(href("/batch", { organism }));
              }}
            >
              Convert the {groupedInteger(pasted.length)} as a list
            </Button>{" "}
            <Button
              onClick={() => {
                setIdentifier(pasted[0] ?? "");
                setPasted(null);
              }}
            >
              Use the first line only
            </Button>
          </div>
        </div>
      ) : null}
      <div className="convert-form__foot">
        <RangeNote description={description} fromRelease={fromRelease} toRelease={toRelease} />
      </div>
      <details
        className="convert-form__advanced"
        open={advanced}
        onToggle={(e) => {
          setAdvanced(e.currentTarget.open);
        }}
      >
        <summary>More options</summary>
        <div className="convert-form__grid">
          <Field
            label="Source database"
            hint="The database the identifier belongs to, when a name means different genes in different databases. Empty: any database."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={fromDatabase}
                aria-describedby={describedBy}
                onChange={(e) => {
                  setFromDatabase(e.target.value);
                }}
              >
                <option value="">Any database</option>
                {description.external_databases.map((d) => (
                  <option key={d} value={d}>
                    {databaseLabel(d)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Switch
            checked={allowBridges}
            onChange={setAllowBridges}
            label="Allow bridges"
            hint="When Ensembl's history ends before the target release, continue through an id that two genes share (a symbol, an accession). Off: history alone."
          />
          <Switch
            checked={explain}
            onChange={setExplain}
            label="Show the path"
            hint="Ask for every candidate's path (explain). Off: the answer and the ranking only, a smaller answer."
          />
        </div>
      </details>
    </form>
  );
}

/** The hero's examples, one a line: the identifier, the release it is read at, and what its answer shows. Their room
 *  is held while the showcase is on its way (nothing moves when they come); where the server gives none, none stand. */
function Examples({
  examples,
  waiting,
  onPick,
}: {
  examples: Example[];
  waiting: boolean;
  onPick: (example: Example) => void;
}) {
  if (!examples.length && !waiting) return null;
  return (
    <div
      className={`convert-examples${examples.length ? "" : " convert-examples--waiting"}`}
      role="group"
      aria-label="Examples from this graph's showcase"
    >
      <span className="convert-examples__label" aria-hidden="true">
        Try
      </span>
      <ul className="convert-examples__list">
        {examples.map((e) => (
          <li key={`${e.kind}-${e.query.identifier}`}>
            <button
              type="button"
              className="convert-example"
              aria-label={`${e.query.identifier}, read at release ${e.from} and answered at ${e.to}: ${e.title.toLowerCase()}`}
              onClick={() => {
                onPick(e);
              }}
            >
              <span className="convert-example__id mono">{e.query.identifier}</span>
              <span className="convert-example__at mono">
                {e.from}→{e.to}
              </span>
              <span className="convert-example__kind">{e.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The releases asked for, on the graph's assemblies (which assembly serves each release, from the graph's own
 *  description): what the conversion will cross, said before it is asked. */
function RangeNote({
  description,
  fromRelease,
  toRelease,
}: {
  description: GraphDescription;
  fromRelease: string;
  toRelease: string;
}) {
  const bands = assemblyBands(description);
  const release = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
  const from = release(fromRelease);
  const to = release(toRelease) ?? description.snapshot_release;
  const bandOf = (r: number) => bands.find((b) => r >= b.first && r <= b.last) ?? null;
  const toBand = bandOf(to);
  const fromBand = from === null ? null : bandOf(from);
  if (!toBand || (from !== null && !fromBand)) return null;
  const crossed =
    fromBand && from !== null ? bands.filter((b) => b.last >= Math.min(from, to) && b.first <= Math.max(from, to)) : [];
  return (
    <p className="convert-form__range">
      {fromBand && from !== null ? (
        <>
          From release <span className="mono">{from}</span> ({fromBand.name}) to <span className="mono">{to}</span> (
          {toBand.name})
          {crossed.length > 1
            ? `: the releases between are served by ${crossed.length} assemblies, ${crossed.map((b) => b.name).join(", ")}.`
            : `: one assembly serves the releases between.`}
        </>
      ) : (
        <>
          To release <span className="mono">{to}</span> ({toBand.name}); the release the identifier is read at is
          inferred: the release asked where the identifier exists there, else its latest.
        </>
      )}
    </p>
  );
}
