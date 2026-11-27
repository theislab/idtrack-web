// Names: the genes a name names, and the names of a gene, per database and release. Each answer is a table whose
// last column draws the releases at which each attachment holds on the graph's release axis (the assemblies serving
// them behind), with the exact releases written under every lane.
import { useEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { api } from "../api/client";
import type { GraphDescription } from "../api/types";
import { ErrorPanel } from "../components/ErrorPanel";
import { NameMatches as Matches } from "../components/NameMatches";
import { Button, Field, Mono, Skeleton, Switch, TextInput } from "../components/ui";
import { nameExamples } from "../lib/batchExamples";
import { useShowcase } from "../lib/showcase";
import { announce } from "../lib/announce";
import { refusedArguments } from "../lib/refusals";
import { draftOver, keepDraftOver } from "../lib/drafts";
import { revealArea, useFocusMove } from "../lib/focus";
import { groupedInteger } from "../lib/numbers";
import { useOrganisms } from "../lib/organisms";
import { href, navigate, useLocation } from "../lib/router";
import { useRequest, type RequestState } from "../lib/useRequest";
import "../styles/tables.css";

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
  const named = useRequest(asked.name ? `${organism}|${asked.name}|${asked.foldCase}` : null, (signal, fresh) =>
    api.genesNamed(organism, asked.name, asked.foldCase, { signal, fresh }),
  );
  const releaseValue =
    asked.release === ""
      ? null
      : /^\d+$/.test(asked.release)
        ? Number(asked.release)
        : (asked.release as unknown as number);
  const names = useRequest(asked.gene ? `${organism}|${asked.gene}|${asked.release}` : null, (signal, fresh) =>
    api.namesOf(organism, asked.gene, releaseValue, { signal, fresh }),
  );
  const namedArea = useRef<HTMLDivElement>(null);
  const namesArea = useRef<HTMLDivElement>(null);
  useFollow(
    asked.name ? `${asked.name}|${asked.foldCase}` : null,
    named,
    namedArea,
    (count) => `${groupedInteger(count)} attachment${count === 1 ? "" : "s"} of the name ${asked.name} to genes.`,
  );
  useFollow(
    asked.gene ? `${asked.gene}|${asked.release}` : null,
    names,
    namesArea,
    (count) =>
      `${groupedInteger(count)} name${count === 1 ? "" : "s"} attached to ${asked.gene}${asked.release ? ` at release ${asked.release}` : ""}.`,
  );

  const go = (parameters: Record<string, string | boolean | null>) => {
    navigate(href("/names", { organism, ...Object.fromEntries(location.search.entries()), ...parameters }));
  };
  const address = Object.fromEntries(location.search.entries());
  const showcase = useShowcase(organism);
  const examples = nameExamples(showcase.state === "done" ? showcase.answer.data : null);
  return (
    <div className="page page--names">
      <header className="page-head">
        <p className="eyebrow">Names</p>
        <h1>What a name names, and what a gene is called</h1>
        <p className="lede">
          External databases attach names (symbols, accessions) to Ensembl genes, and the attachments change between
          releases. Each answer lists the database and the exact releases at which it holds, drawn on the graph&rsquo;s
          releases.
        </p>
      </header>
      <div className="names-stack">
        <section className="panel names-panel" aria-labelledby="genes-named">
          <div className="panel-head">
            <span className="panel-letter" aria-hidden="true">
              a
            </span>
            <h2 id="genes-named" className="panel-head__title">
              Genes a name names
            </h2>
          </div>
          <p className="names-panel__intro">
            Every gene of the reference sequence to which a database attaches the name, at which releases, and whether
            as the name or as a synonym; for each gene, what the same databases call it at the graph&rsquo;s last
            release.
          </p>
          <NameForm
            name={asked.name}
            foldCase={asked.foldCase}
            onSubmit={(name, foldCase) => {
              go({ name: name || null, fold_case: foldCase ? "true" : null });
            }}
          />
          <Examples
            label="Try a name"
            values={examples.names}
            onPick={(name) => {
              go({ name, fold_case: null });
            }}
          />
          <div aria-busy={named.state === "loading"} ref={namedArea}>
            {named.state === "loading" ? <TableSkeleton /> : null}
            {named.state === "failed" ? (
              <ErrorPanel error={named.error} onRetry={named.retry} context="The search" level={3} />
            ) : null}
            {named.state === "done" ? (
              <Matches
                matches={named.answer.data.matches}
                description={description}
                address={address}
                empty={
                  <>
                    No external database attaches the name <Mono>{asked.name}</Mono>
                    {asked.foldCase ? " (in any letter case)" : " (as written)"} to a gene of this graph&rsquo;s
                    reference sequence at any of its releases.
                  </>
                }
                asked={asked.name}
                first="gene"
                release={null}
                endpoint={`GET /api/v1/organisms/${organism}/genes-named`}
              />
            ) : null}
          </div>
        </section>
        <section className="panel names-panel" aria-labelledby="names-of">
          <div className="panel-head">
            <span className="panel-letter" aria-hidden="true">
              b
            </span>
            <h2 id="names-of" className="panel-head__title">
              Names of a gene
            </h2>
          </div>
          <p className="names-panel__intro">
            Every name a database attaches to the gene itself (symbols, their synonyms, gene numbers such as
            NCBI&rsquo;s), grouped as idtrack lists them, at which releases. The accessions of its transcripts and
            proteins (RefSeq, UniProt and others) are not names of the gene: convert the gene to their database to get
            them.
          </p>
          <GeneForm
            gene={asked.gene}
            release={asked.release}
            onSubmit={(gene, release) => {
              go({ gene: gene || null, release: release || null });
            }}
          />
          <Examples
            label="Try a gene"
            values={examples.genes}
            onPick={(gene) => {
              go({ gene, release: null });
            }}
          />
          <div aria-busy={names.state === "loading"} ref={namesArea}>
            {names.state === "loading" ? <TableSkeleton /> : null}
            {names.state === "failed" ? (
              <ErrorPanel
                error={names.error}
                onRetry={names.retry}
                context="The names"
                level={3}
                actions={
                  asked.release && refusedArguments(names.error).includes("release") ? (
                    <Button
                      onClick={() => {
                        go({ release: null });
                      }}
                    >
                      List the names at every release
                    </Button>
                  ) : null
                }
              />
            ) : null}
            {names.state === "done" ? (
              <Matches
                matches={names.answer.data.matches}
                description={description}
                address={address}
                empty={
                  <>
                    No external database attaches a name to <Mono>{asked.gene}</Mono> on the reference sequence
                    {asked.release ? ` at release ${asked.release}` : " at any release of this graph"}.
                  </>
                }
                asked={asked.gene}
                first="name"
                release={typeof releaseValue === "number" ? releaseValue : null}
                endpoint={`GET /api/v1/organisms/${organism}/names-of`}
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function NameForm({
  name: addressName,
  foldCase: addressFoldCase,
  onSubmit,
}: {
  name: string;
  foldCase: boolean;
  onSubmit: (name: string, foldCase: boolean) => void;
}) {
  // The form follows the address (a link, Back) without being made anew, so that a submit keeps its focus; a name
  // typed and not sent is kept across an organism switch (lib/drafts.ts), as the address keeps a name sent.
  const addressKey = `${addressName}|${String(addressFoldCase)}`;
  const [synced, setSynced] = useState(addressKey);
  const [name, setNameState] = useState(() => draftOver("names.name", addressName));
  const [foldCase, setFoldCase] = useState(addressFoldCase);
  if (synced !== addressKey) {
    setSynced(addressKey);
    setNameState(draftOver("names.name", addressName));
    setFoldCase(addressFoldCase);
  }
  const setName = (text: string) => {
    setNameState(text);
    keepDraftOver("names.name", addressName, text);
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    keepDraftOver("names.name", name.trim(), name.trim());
    onSubmit(name.trim(), foldCase);
  };
  return (
    <form onSubmit={submit} noValidate className="names-form" aria-label="Genes a name names">
      <Field label="Name" hint="A symbol or an id of an external database (HGNC Symbol, RefSeq, UniProt…).">
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            className="input--mono"
            value={name}
            placeholder="INS"
            aria-describedby={describedBy}
            aria-required="true"
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
      <div className="names-form__submit">
        <Button type="submit" variant="primary">
          Find genes
        </Button>
      </div>
    </form>
  );
}

function GeneForm({
  gene: addressGene,
  release: addressRelease,
  onSubmit,
}: {
  gene: string;
  release: string;
  onSubmit: (gene: string, release: string) => void;
}) {
  const addressKey = `${addressGene}|${addressRelease}`;
  const [synced, setSynced] = useState(addressKey);
  const [gene, setGene] = useState(addressGene);
  const [release, setRelease] = useState(addressRelease);
  if (synced !== addressKey) {
    setSynced(addressKey);
    setGene(addressGene);
    setRelease(addressRelease);
  }
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    onSubmit(gene.trim(), release.trim());
  };
  return (
    <form onSubmit={submit} noValidate className="names-form" aria-label="Names of a gene">
      <Field
        label="Ensembl gene, with version"
        hint="The gene as Ensembl writes it at a release: its id, a dot and its version."
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            className="input--mono"
            value={gene}
            aria-describedby={describedBy}
            aria-required="true"
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
      <div className="names-form__submit">
        <Button type="submit" variant="primary">
          List names
        </Button>
      </div>
    </form>
  );
}

/** A search the person asked after the page opened: brought into view when it starts, said in one sentence and its
 *  result focused when it ends (the search of the address the page opened with is left where it is). */
function useFollow(
  key: string | null,
  state: RequestState<{ matches: unknown[] }>,
  area: RefObject<HTMLDivElement | null>,
  sentence: (count: number) => string,
): void {
  const first = useRef(key);
  const follow = useRef(false);
  const moveFocus = useFocusMove();
  useEffect(() => {
    if (key === null || key === first.current) return;
    first.current = null;
    follow.current = true;
    revealArea(area.current);
  }, [key, area]);
  const settled = state.state === "done" || state.state === "failed";
  useEffect(() => {
    if (!settled || !follow.current) return;
    follow.current = false;
    if (state.state === "done") announce(sentence(state.answer.data.matches.length));
    moveFocus(() => area.current, '[role="alert"] .notice__title, .names-summary, .empty');
  }, [settled, state, area, sentence, moveFocus]);
}

/** One-click examples under a form: identifiers of the Convert page's figures for this organism. */
function Examples({ label, values, onPick }: { label: string; values: string[]; onPick: (value: string) => void }) {
  if (!values.length) return null;
  return (
    <p className="names-examples">
      <span className="names-examples__label">{label}</span>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className="chip chip--example"
          onClick={() => {
            onPick(value);
          }}
        >
          <Mono>{value}</Mono>
        </button>
      ))}
    </p>
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
