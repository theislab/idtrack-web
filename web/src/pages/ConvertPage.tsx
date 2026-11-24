// Convert one identifier: the form, and the answer with its candidates, its path and why the best won.
import { useId, useState, type SyntheticEvent } from "react";
import { api } from "../api/client";
import type { GraphDescription } from "../api/types";
import { ErrorPanel } from "../components/ErrorPanel";
import { ResultSkeleton, ResultView } from "../components/ResultView";
import { Button, Field, Select, Switch, TextInput } from "../components/ui";
import {
  convertHref,
  plainConversion,
  readParameters,
  releaseOf,
  type ConvertParameters,
} from "../lib/convertParameters";
import { databaseLabel, sortDatabases } from "../lib/databases";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { navigate, useLocation } from "../lib/router";
import { useRequest } from "../lib/useRequest";

const EXAMPLES: Record<string, string[]> = {
  homo_sapiens: ["INS", "ENSG00000139618", "TP53", "NM_000207"],
  mus_musculus: ["Ins2", "Pdx1", "ENSMUSG00000035804"],
  sus_scrofa: ["INS", "PDX1", "ENSSSCG00000040723", "XP_003123285"],
  macaca_mulatta: ["INS", "PDX1"],
  macaca_fascicularis: ["INS", "PDX1"],
};

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
  if (!current) return null;
  const parameters = readParameters(location.search);
  return (
    <ConvertForOrganism
      key={current.organism}
      description={current}
      parameters={parameters}
      address={location.path + "?" + location.search.toString()}
    />
  );
}

function ConvertForOrganism({
  description,
  parameters,
  address,
}: {
  description: GraphDescription;
  parameters: ConvertParameters;
  address: string;
}) {
  const organism = description.organism;
  const query = parameters.identifier
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
  const result = useRequest(key, (signal) => {
    if (!query) throw new Error("No identifier to convert.");
    return api.convert(organism, query, signal);
  });
  const go = (next: ConvertParameters) => {
    const target = convertHref(organism, next);
    if (target === window.location.pathname + window.location.search) result.retry();
    else navigate(target);
  };
  const first = description.releases[0] ?? "";
  const last = description.releases[description.releases.length - 1] ?? "";

  return (
    <div className="page page--convert">
      <header className="page-head">
        <p className="eyebrow">Convert one identifier</p>
        <h1>Where is this gene at another release?</h1>
        <p className="lede">
          An Ensembl id (with or without its version), a symbol, or an id of another database, followed through
          Ensembl&apos;s releases {first}–{last} of the <em>{organismName(description.organism)}</em> graph to the
          release and database you choose. Every step is shown with the evidence that decided it.
        </p>
      </header>

      {/* The form starts from the address: a link, back or forward gives a fresh form of that address. */}
      <ConvertForm key={address} description={description} parameters={parameters} onSubmit={go} />

      <section className="result-area" aria-live="polite" aria-busy={result.state === "loading"}>
        {result.state === "idle" ? <EmptyConvert /> : null}
        {result.state === "loading" ? <ResultSkeleton description={description} /> : null}
        {result.state === "failed" ? (
          <ErrorPanel error={result.error} onRetry={result.retry} context="The conversion" />
        ) : null}
        {result.state === "done" ? (
          <ResultView
            result={result.answer.data}
            raw={result.answer.raw}
            description={description}
            requestedDatabase={parameters.finalDatabase}
          />
        ) : null}
      </section>
    </div>
  );
}

function ConvertForm({
  description,
  parameters,
  onSubmit,
}: {
  description: GraphDescription;
  parameters: ConvertParameters;
  onSubmit: (parameters: ConvertParameters) => void;
}) {
  const organism = description.organism;
  const [identifier, setIdentifier] = useState(parameters.identifier);
  const [fromRelease, setFromRelease] = useState(parameters.fromRelease === null ? "" : String(parameters.fromRelease));
  const [toRelease, setToRelease] = useState(parameters.toRelease === null ? "" : String(parameters.toRelease));
  const [finalDatabase, setFinalDatabase] = useState(parameters.finalDatabase ?? "");
  const [fromDatabase, setFromDatabase] = useState(parameters.fromDatabase ?? "");
  const [allowBridges, setAllowBridges] = useState(parameters.allowBridges);
  const [explain, setExplain] = useState(parameters.explain);
  const [advanced, setAdvanced] = useState(
    parameters.fromDatabase !== null || !parameters.allowBridges || !parameters.explain,
  );
  const [missing, setMissing] = useState(false);

  const toNumber = /^\d+$/.test(toRelease.trim()) ? Number(toRelease.trim()) : null;
  const finals = useRequest(`${organism}:${toNumber ?? "snapshot"}`, (signal) =>
    api.finalDatabases(organism, toNumber, signal),
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
    if (!isRelease(fromRelease) || !isRelease(toRelease)) return;
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

  const examples = EXAMPLES[organism] ?? [];

  return (
    <form className="panel convert-form" onSubmit={submit} noValidate aria-label="Conversion">
      <div className="convert-form__main">
        <Field
          label="Identifier"
          className="field--identifier"
          error={missing ? "Enter an identifier to convert." : null}
          hint={
            examples.length ? (
              <>
                For example{" "}
                {examples.map((e, i) => (
                  <span key={e}>
                    <button
                      type="button"
                      className="example"
                      onClick={() => {
                        onSubmit(plainConversion(e));
                      }}
                    >
                      {e}
                    </button>
                    {i < examples.length - 1 ? ", " : ""}
                  </span>
                ))}
              </>
            ) : (
              "An Ensembl id, a symbol or another database's id."
            )
          }
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              className="input--mono input--large"
              value={identifier}
              placeholder="ENSG00000139618.19, INS, NM_000207 …"
              aria-describedby={describedBy}
              aria-invalid={missing}
              maxLength={256}
              onChange={(e) => {
                setIdentifier(e.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" className="convert-form__go">
          Convert
        </Button>
      </div>
      <div className="convert-form__grid">
        <ReleaseField
          label="From release"
          hint="The release the identifier is read at. Empty: idtrack infers it (the target release where the identifier exists there, else its latest)."
          value={fromRelease}
          onChange={setFromRelease}
          description={description}
          placeholder="inferred"
        />
        <ReleaseField
          label="To release"
          hint={`The release to convert to. Empty: the graph's last release, ${description.snapshot_release}.`}
          value={toRelease}
          onChange={setToRelease}
          description={description}
          placeholder={String(description.snapshot_release)}
        />
        <Field
          label="Target database"
          hint="The database the answer is given in: an Ensembl gene id (with or without version) or the database's id at the target release."
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

function EmptyConvert() {
  return (
    <div className="empty">
      <svg className="empty__figure" viewBox="0 0 320 64" aria-hidden="true">
        <line x1="8" y1="44" x2="312" y2="44" className="empty__axis" />
        {Array.from({ length: 20 }, (_, i) => (
          <line
            key={i}
            x1={16 + i * 15.2}
            x2={16 + i * 15.2}
            y1="44"
            y2={i % 5 === 0 ? 36 : 40}
            className="empty__axis"
          />
        ))}
        <path d="M24,24 L120,24 C140,24 140,14 160,14 L230,14" className="empty__path" />
        <circle cx="24" cy="24" r="4" className="empty__node" />
        <circle cx="160" cy="14" r="4" className="empty__node" />
        <rect x="292" y="9" width="10" height="10" className="empty__node" />
        <path d="M230,14 L286,14" className="empty__path empty__path--dash" />
      </svg>
      <p className="empty__title">Nothing converted yet</p>
      <p>
        Enter an identifier above. The answer comes with every candidate the search reached, why the best one won, and
        the path through the releases.
      </p>
    </div>
  );
}
