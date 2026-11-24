// Convert many identifiers at once: paste or upload a list, read the results in order, export them as the api gave them.
import { useMemo, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { api } from "../api/client";
import type { BatchRequest, ConversionResult, GraphDescription } from "../api/types";
import { ErrorPanel } from "../components/ErrorPanel";
import {
  Button,
  Field,
  Link,
  Mono,
  Prose,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  TableFrame,
  TextInput,
} from "../components/ui";
import { databaseLabel, sortDatabases } from "../lib/databases";
import { bestWords, noTargetOf } from "../lib/noTarget";
import { groupedInteger } from "../lib/numbers";
import { useOrganisms } from "../lib/organisms";
import { parseList } from "../lib/batchList";
import { convertHref } from "../lib/convertParameters";
import { saveText } from "../lib/save";
import { useAction, useRequest } from "../lib/useRequest";
import { ABSENT } from "../lib/values";
import { statusTitle } from "../lib/vocabulary";
import { useLimits, useVocabulary } from "../lib/vocabularyContext";

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

export function BatchPage() {
  const { current } = useOrganisms();
  if (!current) return null;
  return <BatchForOrganism key={current.organism} description={current} />;
}

function BatchForOrganism({ description }: { description: GraphDescription }) {
  const organism = description.organism;
  const limits = useLimits();
  const [text, setText] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [toRelease, setToRelease] = useState("");
  const [fromRelease, setFromRelease] = useState("");
  const [finalDatabase, setFinalDatabase] = useState("");
  const [fromDatabase, setFromDatabase] = useState("");
  const [allowBridges, setAllowBridges] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [request, setRequest] = useState<BatchRequest | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const identifiers = useMemo(() => parseList(text), [text]);
  const toNumber = /^\d+$/.test(toRelease.trim()) ? Number(toRelease.trim()) : null;
  const finals = useRequest(`${organism}:${toNumber ?? "snapshot"}`, (signal) =>
    api.finalDatabases(organism, toNumber, signal),
  );
  const finalOptions =
    finals.state === "done"
      ? sortDatabases(finals.answer.data.final_databases)
      : sortDatabases(description.final_databases);

  const batch = useAction((signal, body: BatchRequest) => api.batch(organism, body, signal));
  const tsv = useAction((signal, body: BatchRequest) => api.batchTsv(organism, body, signal));

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setFileNote(
        `${file.name} is ${groupedInteger(file.size)} bytes; a list of identifiers is far smaller. Choose a text file with one identifier per line.`,
      );
      return;
    }
    file.text().then(
      (content) => {
        setText(content);
        setFileNote(`Read ${file.name}: ${groupedInteger(parseList(content).length)} identifiers.`);
      },
      () => setFileNote(`${file.name} could not be read.`),
    );
    event.target.value = "";
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!identifiers.length) {
      setProblem("Paste or upload at least one identifier.");
      return;
    }
    for (const value of [fromRelease, toRelease]) {
      if (value.trim() !== "" && !/^\d+$/.test(value.trim())) {
        setProblem("A release is a whole number.");
        return;
      }
    }
    setProblem(null);
    const body: BatchRequest = {
      identifiers,
      from_release: fromRelease.trim() ? Number(fromRelease.trim()) : null,
      to_release: toRelease.trim() ? Number(toRelease.trim()) : null,
      final_database: finalDatabase || null,
      from_database: fromDatabase || null,
      explain: false,
      allow_bridges: allowBridges,
    };
    setRequest(body);
    tsv.reset();
    void batch.start(body);
  };

  const exportJson = () => {
    if (batch.state !== "done") return;
    saveText(batch.answer.raw, `idtrack_${organism}_batch_${stamp()}.json`, "application/json");
  };
  const exportTsv = () => {
    if (!request) return;
    void tsv.start(request).then((answer) => {
      if (answer) saveText(answer.raw, `idtrack_${organism}_batch_${stamp()}.tsv`, "text/tab-separated-values");
    });
  };

  return (
    <div className="page page--batch">
      <header className="page-head">
        <p className="eyebrow">Convert a list</p>
        <h1>Many identifiers, one setting</h1>
        <p className="lede">
          Each identifier is converted with the same releases and databases; the results come back in the order given,
          each with its own status. Export them as TSV (one row per candidate) or JSON, exactly as the api returns them.
        </p>
      </header>
      <form className="panel batch-form" onSubmit={submit} noValidate aria-label="Batch conversion">
        <Field
          label="Identifiers"
          error={problem}
          hint={
            <>
              One per line (the first cell of a table's line).{" "}
              {identifiers.length ? <strong>{groupedInteger(identifiers.length)} identifiers.</strong> : null}{" "}
              {limits ? (
                <>
                  This server takes at most {groupedInteger(limits.batch_max)} per request, each of at most{" "}
                  {groupedInteger(limits.identifier_max_length)} characters.
                </>
              ) : null}
            </>
          }
        >
          {({ id, describedBy }) => (
            <textarea
              id={id}
              className="input input--mono textarea"
              rows={9}
              value={text}
              spellCheck={false}
              aria-describedby={describedBy}
              aria-invalid={Boolean(problem)}
              placeholder={"INS\nPDX1\nENSG00000139618\nNM_000207"}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <div className="batch-form__file">
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.tsv,.csv,text/plain,text/csv,text/tab-separated-values"
            className="visually-hidden"
            id="batch-file"
            aria-label="A file of identifiers"
            onChange={onFile}
            tabIndex={-1}
          />
          <Button onClick={() => fileInput.current?.click()}>Upload a file…</Button>
          <span className="muted" role="status">
            {fileNote ?? "A text, TSV or CSV file; its first column is read."}
          </span>
        </div>
        <div className="convert-form__grid">
          <Field label="From release" hint="Empty: inferred for each identifier.">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                inputMode="numeric"
                className="input--mono"
                value={fromRelease}
                placeholder="inferred"
                aria-describedby={describedBy}
                onChange={(e) => setFromRelease(e.target.value)}
              />
            )}
          </Field>
          <Field label="To release" hint={`Empty: the graph's last release, ${description.snapshot_release}.`}>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                inputMode="numeric"
                className="input--mono"
                value={toRelease}
                placeholder={String(description.snapshot_release)}
                aria-describedby={describedBy}
                onChange={(e) => setToRelease(e.target.value)}
              />
            )}
          </Field>
          <Field label="Target database" hint="The database of the answers.">
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={finalDatabase}
                aria-describedby={describedBy}
                onChange={(e) => setFinalDatabase(e.target.value)}
              >
                <option value="">Ensembl gene (with version), the default</option>
                {finalOptions
                  .filter((d) => d !== "ensembl_gene")
                  .map((d) => (
                    <option key={d} value={d}>
                      {databaseLabel(d)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Source database" hint="Empty: any database.">
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={fromDatabase}
                aria-describedby={describedBy}
                onChange={(e) => setFromDatabase(e.target.value)}
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
            hint="Continue through an id two genes share when history ends."
          />
        </div>
        <div className="batch-form__actions">
          <Button type="submit" variant="primary" disabled={batch.state === "loading"}>
            {batch.state === "loading"
              ? "Converting…"
              : `Convert ${identifiers.length ? groupedInteger(identifiers.length) : ""}`}
          </Button>
        </div>
      </form>

      <section className="result-area" aria-live="polite" aria-busy={batch.state === "loading"}>
        {batch.state === "idle" ? (
          <div className="empty">
            <p className="empty__title">No list converted yet</p>
            <p>Paste identifiers above, or upload a file. The results appear here in your order.</p>
          </div>
        ) : null}
        {batch.state === "loading" ? (
          <div className="result--loading" aria-label="Converting the list">
            <p className="visually-hidden">Converting the list…</p>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} width="100%" height={28} className="skeleton--row" />
            ))}
          </div>
        ) : null}
        {batch.state === "failed" ? (
          <ErrorPanel error={batch.error} context="The batch" onRetry={() => request && void batch.start(request)} />
        ) : null}
        {batch.state === "done" ? (
          <BatchResults
            organism={organism}
            results={batch.answer.data.results}
            request={request}
            onJson={exportJson}
            onTsv={exportTsv}
            tsvState={tsv.state}
          />
        ) : null}
        {tsv.state === "failed" ? <ErrorPanel error={tsv.error} context="The TSV export" /> : null}
      </section>
    </div>
  );
}

function BatchResults({
  organism,
  results,
  request,
  onJson,
  onTsv,
  tsvState,
}: {
  organism: string;
  results: ConversionResult[];
  request: BatchRequest | null;
  onJson: () => void;
  onTsv: () => void;
  tsvState: string;
}) {
  const vocabulary = useVocabulary();
  const asked = request?.final_database ?? null;
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return (
    <div className="batch-results">
      <div className="batch-results__head">
        <p className="batch-results__summary">
          <strong>{groupedInteger(results.length)}</strong> results:{" "}
          {[...counts.entries()].map(([status, n], i) => (
            <span key={status}>
              {i ? " · " : ""}
              {groupedInteger(n)} {statusTitle(status).toLowerCase()}
            </span>
          ))}
        </p>
        <div className="batch-results__export">
          <Button onClick={onTsv} disabled={tsvState === "loading"}>
            {tsvState === "loading" ? "Preparing TSV…" : "Export TSV"}
          </Button>
          <Button onClick={onJson}>Export JSON</Button>
        </div>
      </div>
      <TableFrame label="Results in input order" className="table-frame--cards">
        <table className="table table--batch table--cards">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Identifier</th>
              <th scope="col">Status</th>
              <th scope="col">Answer</th>
              <th scope="col">Read at</th>
              <th scope="col">Why no answer</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const bests = r.no_target ? [] : r.candidates.filter((c) => c.best);
              const absent = noTargetOf(r);
              const meaning = r.reason ? vocabulary.reasons.get(r.reason) : null;
              return (
                <tr key={i}>
                  <td className="num" data-label="#">
                    {i + 1}
                  </td>
                  <td data-label="Identifier">
                    <Mono>{r.query_id}</Mono>
                    {r.graph_id !== null && r.graph_id !== r.query_id ? (
                      <span className="sub">
                        read as <Mono>{r.graph_id}</Mono>
                      </span>
                    ) : null}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={r.status} />
                  </td>
                  <td data-label="Answer">
                    {bests.length ? (
                      bests.map((c) => (
                        <span key={`${c.gene}|${c.target}`} className="cell-line">
                          <Mono strong>{c.target}</Mono>
                        </span>
                      ))
                    ) : absent ? (
                      <span className="cell-line">
                        No {databaseLabel(asked ?? "ensembl_gene")} for {bestWords(absent.best)}
                        <span className="sub">
                          {absent.best.map((gene, k) => (
                            <span key={gene}>
                              <Mono>{gene}</Mono>
                              {k < absent.best.length - 1 ? ", " : ""}
                            </span>
                          ))}
                        </span>
                        {absent.others.length ? (
                          <span className="sub">
                            {absent.others.length} other genes reached, not looked up in the database
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="muted" title="No answer">
                        {ABSENT}
                      </span>
                    )}
                    {!r.no_target && r.candidates.length > bests.length ? (
                      <span className="sub">{r.candidates.length - bests.length} other candidates</span>
                    ) : null}
                  </td>
                  <td className="num" data-label="Read at">
                    {r.from_release === null ? (
                      <span title="Not read at any release (the status says why)">{ABSENT}</span>
                    ) : (
                      <Mono>{r.from_release}</Mono>
                    )}
                  </td>
                  <td data-label="Why no answer">
                    {r.error ? (
                      <span>
                        <Mono>{r.error.type}</Mono>: {r.error.message}
                      </span>
                    ) : r.reason && !r.no_target ? (
                      <span>
                        {meaning ? <Prose text={meaning} /> : null} <span className="code-quiet">{r.reason}</span>
                      </span>
                    ) : r.reason ? (
                      <span className="code-quiet" title={meaning ?? undefined}>
                        {r.reason}
                      </span>
                    ) : null}
                  </td>
                  <td data-label="">
                    <Link
                      className="row-link"
                      to={convertHref(organism, {
                        identifier: r.query_id,
                        fromRelease: request?.from_release ?? null,
                        toRelease: request?.to_release ?? null,
                        finalDatabase: request?.final_database ?? null,
                        fromDatabase: request?.from_database ?? null,
                        allowBridges: request?.allow_bridges ?? true,
                        explain: true,
                      })}
                    >
                      Path<span className="visually-hidden"> of {r.query_id}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
