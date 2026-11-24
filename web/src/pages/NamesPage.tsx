// Names: the genes a name names, and the names of a gene, per database and release.
import { useState, type SyntheticEvent } from "react";
import { api } from "../api/client";
import type { GraphDescription, NameMatch } from "../api/types";
import { ErrorPanel } from "../components/ErrorPanel";
import { Button, Field, Link, Mono, Skeleton, Switch, TextInput, TableFrame } from "../components/ui";
import { convertHref, plainConversion } from "../lib/convertParameters";
import { databaseLabel } from "../lib/databases";
import { releaseRanges } from "../lib/numbers";
import { useOrganisms } from "../lib/organisms";
import { href, navigate, useLocation } from "../lib/router";
import { useRequest } from "../lib/useRequest";

export function NamesPage() {
  const { current } = useOrganisms();
  if (!current) return null;
  return <NamesForOrganism key={current.organism} description={current} />;
}

function NamesForOrganism({ description }: { description: GraphDescription }) {
  const organism = description.organism;
  const location = useLocation();
  const asked = {
    name: location.search.get("name") ?? "",
    foldCase: location.search.get("fold_case") === "true",
    gene: location.search.get("gene") ?? "",
    release: location.search.get("release") ?? "",
  };
  const named = useRequest(asked.name ? `${organism}|${asked.name}|${asked.foldCase}` : null, (signal) =>
    api.genesNamed(organism, asked.name, asked.foldCase, signal),
  );
  const releaseValue =
    asked.release === ""
      ? null
      : /^\d+$/.test(asked.release)
        ? Number(asked.release)
        : (asked.release as unknown as number);
  const names = useRequest(asked.gene ? `${organism}|${asked.gene}|${asked.release}` : null, (signal) =>
    api.namesOf(organism, asked.gene, releaseValue, signal),
  );

  const go = (parameters: Record<string, string | boolean | null>) => {
    navigate(href("/names", { organism, ...Object.fromEntries(location.search.entries()), ...parameters }));
  };
  return (
    <div className="page page--names">
      <header className="page-head">
        <p className="eyebrow">Names</p>
        <h1>What a name names, and what a gene is called</h1>
        <p className="lede">
          External databases attach names (symbols, accessions) to Ensembl genes, and the attachments change between
          releases. Each answer lists the database and the exact releases at which it holds.
        </p>
      </header>
      <div className="names-grid">
        <section className="panel" aria-labelledby="genes-named">
          <h2 id="genes-named">Genes a name names</h2>
          <NameForm
            key={`${asked.name}|${String(asked.foldCase)}`}
            name={asked.name}
            foldCase={asked.foldCase}
            onSubmit={(name, foldCase) => {
              go({ name: name || null, fold_case: foldCase ? "true" : null });
            }}
          />
          <div aria-live="polite" aria-busy={named.state === "loading"}>
            {named.state === "loading" ? <TableSkeleton /> : null}
            {named.state === "failed" ? (
              <ErrorPanel error={named.error} onRetry={named.retry} context="The search" />
            ) : null}
            {named.state === "done" ? (
              <Matches
                matches={named.answer.data.matches}
                organism={organism}
                address={Object.fromEntries(location.search.entries())}
                empty={`No external database attaches the name ${asked.name}${asked.foldCase ? " (in any letter case)" : " (as written)"} to a gene of this graph's reference sequence at any of its releases.`}
                first="gene"
              />
            ) : null}
          </div>
        </section>
        <section className="panel" aria-labelledby="names-of">
          <h2 id="names-of">Names of a gene</h2>
          <GeneForm
            key={`${asked.gene}|${asked.release}`}
            gene={asked.gene}
            release={asked.release}
            onSubmit={(gene, release) => {
              go({ gene: gene || null, release: release || null });
            }}
          />
          <div aria-live="polite" aria-busy={names.state === "loading"}>
            {names.state === "loading" ? <TableSkeleton /> : null}
            {names.state === "failed" ? (
              <ErrorPanel error={names.error} onRetry={names.retry} context="The names" />
            ) : null}
            {names.state === "done" ? (
              <Matches
                matches={names.answer.data.matches}
                organism={organism}
                address={Object.fromEntries(location.search.entries())}
                empty={`No external database attaches a name to ${asked.gene} on the reference sequence${asked.release ? ` at release ${asked.release}` : " at any release of this graph"}.`}
                first="name"
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function NameForm({
  name: initialName,
  foldCase: initialFoldCase,
  onSubmit,
}: {
  name: string;
  foldCase: boolean;
  onSubmit: (name: string, foldCase: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const [foldCase, setFoldCase] = useState(initialFoldCase);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onSubmit(name.trim(), foldCase);
  };
  return (
    <form onSubmit={submit} noValidate className="stack">
      <Field label="Name" hint="A symbol or an id of an external database (HGNC Symbol, RefSeq, UniProt…).">
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            className="input--mono"
            value={name}
            placeholder="INS"
            aria-describedby={describedBy}
            maxLength={256}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        )}
      </Field>
      <Switch
        checked={foldCase}
        onChange={setFoldCase}
        label="Ignore letter case"
        hint="Also match the name written in other letter case (Ins, INS)."
      />
      <div>
        <Button type="submit" variant="primary">
          Find genes
        </Button>
      </div>
    </form>
  );
}

function GeneForm({
  gene: initialGene,
  release: initialRelease,
  onSubmit,
}: {
  gene: string;
  release: string;
  onSubmit: (gene: string, release: string) => void;
}) {
  const [gene, setGene] = useState(initialGene);
  const [release, setRelease] = useState(initialRelease);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onSubmit(gene.trim(), release.trim());
  };
  return (
    <form onSubmit={submit} noValidate className="stack">
      <Field
        label="Ensembl gene, with version"
        hint="The gene as Ensembl writes it at a release, with its version (ENSG00000254647.6)."
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            className="input--mono"
            value={gene}
            aria-describedby={describedBy}
            maxLength={256}
            onChange={(e) => {
              setGene(e.target.value);
            }}
          />
        )}
      </Field>
      <Field label="At release" hint="Only the names that hold at this release. Empty: every release.">
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            inputMode="numeric"
            className="input--mono input--release"
            value={release}
            placeholder="all"
            aria-describedby={describedBy}
            onChange={(e) => {
              setRelease(e.target.value);
            }}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="primary">
          List names
        </Button>
      </div>
    </form>
  );
}

function TableSkeleton() {
  return (
    <div className="result--loading">
      <p className="visually-hidden">Looking up…</p>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} width="100%" height={24} className="skeleton--row" />
      ))}
    </div>
  );
}

function Matches({
  matches,
  organism,
  address,
  empty,
  first,
}: {
  matches: NameMatch[];
  organism: string;
  /** The page's address now: a link keeps the other lookup. */
  address: Record<string, string>;
  empty: string;
  first: "gene" | "name";
}) {
  if (!matches.length) {
    return (
      <div className="empty empty--small">
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <TableFrame label="Matches" className="table-frame--cards">
      <table className="table table--cards">
        <thead>
          <tr>
            {first === "gene" ? <th scope="col">Gene</th> : <th scope="col">Name</th>}
            {first === "gene" ? <th scope="col">Name</th> : null}
            <th scope="col">Database</th>
            <th scope="col">Releases</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => {
            return (
              <tr key={i}>
                {first === "gene" ? (
                  <td data-label="Gene">
                    <Link to={href("/names", { ...address, organism, gene: m.gene, release: null })}>
                      <Mono>{m.gene}</Mono>
                    </Link>
                  </td>
                ) : (
                  <td data-label="Name">
                    <Link to={href("/names", { ...address, organism, name: m.name })}>
                      <Mono>{m.name}</Mono>
                    </Link>
                  </td>
                )}
                {first === "gene" ? (
                  <td data-label="Name">
                    <Mono>{m.name}</Mono>
                  </td>
                ) : null}
                <td data-label="Database">
                  {databaseLabel(m.database)}
                  {m.synonym ? <span className="tag">synonym</span> : null}
                </td>
                <td data-label="Releases" className="cell-ranges">
                  <Mono title={m.releases.join(", ")}>{releaseRanges(m.releases)}</Mono>{" "}
                  <Link
                    className="row-link"
                    to={convertHref(organism, plainConversion(first === "gene" ? m.gene : m.name))}
                  >
                    Convert<span className="visually-hidden"> {first === "gene" ? m.gene : m.name}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}
