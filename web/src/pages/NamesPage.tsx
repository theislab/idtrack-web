// Names: the genes a name names, and the names of a gene, per database and release: two questions, one shown at a time
// (a segmented choice, kept in the address), each with what it answers a press away, each asked at every release or at
// one. Each answer is a table whose last column draws the releases at which each attachment holds on the graph's
// release axis (the assemblies serving them behind), with the exact releases written beside every lane. Once an answer
// is asked, the page's head is its title alone and the answer the screen's subject. A gene id without its version is
// answered by IDTrack's own reading: at a release, convert says which version is active there; without one, its
// versions are offered, each with the releases its path gives, one press each.
import { useEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { api, ApiError } from "../api/client";
import type { ConversionResult, GraphDescription } from "../api/types";
import { ErrorPanel } from "../components/ErrorPanel";
import { NameMatches as Matches } from "../components/NameMatches";
import { Button, Field, Mono, Skeleton, Switch, TextInput } from "../components/ui";
import { Expandable } from "../components/v2/Expandable";
import { Segmented } from "../components/v2/Segmented";
import { nameExamples } from "../lib/batchExamples";
import { useShowcase } from "../lib/showcase";
import { announce } from "../lib/announce";
import { refusedArguments } from "../lib/refusals";
import { draftOver, keepDraftOver } from "../lib/drafts";
import { revealArea, useFocusMove } from "../lib/focus";
import { groupedInteger } from "../lib/numbers";
import { useOrganisms } from "../lib/organisms";
import { organismName } from "../lib/organismNames";
import { databaseLabel, sortDatabases } from "../lib/databases";
import { href, navigate, useLocation } from "../lib/router";
import { useRequest, type RequestState } from "../lib/useRequest";
import "../styles/tables.css";

/** The page's head: the same in every state, and drawn into the page the server sends before the code runs
 *  (scripts/prerender.ts). */
export function NamesHead({ folded = false }: { folded?: boolean }) {
  return (
    <header className={`page-head${folded ? " page-head--folded" : ""}`}>
      <h1>What a name names, and what a gene is called</h1>
      {folded ? null : (
        <p className="lede">Each answer gives the database that attaches a name to a gene, and the exact releases.</p>
      )}
    </header>
  );
}

/** The two questions of the page. */
type Question = "genes" | "names";

/** The question shown: the address's (`ask=names`), else the one whose answer the address holds (a gene and no name:
 *  the names of the gene), else the genes a name names. */
function questionOf(search: URLSearchParams): Question {
  const ask = search.get("ask");
  if (ask === "names" || ask === "genes") return ask;
  return search.get("gene") && !search.get("name") ? "names" : "genes";
}

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
  // A release of the address that is no whole number is refused here, as Convert refuses it: nothing is asked.
  const notRelease = asked.release.trim() !== "" && !/^\d+$/.test(asked.release.trim());
  const releaseValue = asked.release.trim() === "" || notRelease ? null : Number(asked.release.trim());
  const named = useRequest(
    asked.name && !notRelease ? `${organism}|${asked.name}|${asked.foldCase}|${asked.release}` : null,
    (signal, fresh) => api.genesNamed(organism, asked.name, asked.foldCase, releaseValue, { signal, fresh }),
  );
  const names = useRequest(
    asked.gene && !notRelease ? `${organism}|${asked.gene}|${asked.release}` : null,
    (signal, fresh) => api.namesOf(organism, asked.gene, releaseValue, { signal, fresh }),
  );
  // A gene id the api refuses for want of its version names its versions (`allowed`); at a release, IDTrack's convert
  // reads the id there, and the version it answers is asked instead.
  const versions = names.state === "failed" ? versionsOf(names.error, asked.gene) : null;
  const versionAt = useRequest(
    versions && releaseValue !== null ? `${organism}|version|${asked.gene}|${String(releaseValue)}` : null,
    (signal, fresh) =>
      api.convert(
        organism,
        { identifier: asked.gene, from_release: releaseValue, to_release: releaseValue },
        {
          signal,
          fresh,
        },
      ),
  );
  const resolved =
    versionAt.state === "done"
      ? (() => {
          const bests = [...new Set(versionAt.answer.data.candidates.filter((c) => c.best).map((c) => c.target))];
          return bests.length === 1 && versions?.includes(bests[0] ?? "") ? (bests[0] ?? null) : null;
        })()
      : null;
  const namesAt = useRequest(
    resolved && releaseValue !== null ? `${organism}|${resolved}|${String(releaseValue)}` : null,
    (signal, fresh) => api.namesOf(organism, resolved ?? "", releaseValue, { signal, fresh }),
  );
  const namedArea = useRef<HTMLDivElement>(null);
  const namesArea = useRef<HTMLDivElement>(null);
  useFollow(
    asked.name ? `${asked.name}|${asked.foldCase}|${asked.release}` : null,
    named,
    namedArea,
    (count) =>
      `${groupedInteger(count)} attachment${count === 1 ? "" : "s"} of the name ${asked.name} to genes${asked.release ? ` at release ${asked.release}` : ""}.`,
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
  const question = questionOf(location.search);
  // The choice is kept in the address (a link or a reload shows the same question), replacing the entry.
  const choose = (next: Question) => {
    const kept = Object.fromEntries(location.search.entries());
    const plain = next === "genes" ? !(kept["gene"] && !kept["name"]) : Boolean(kept["gene"] && !kept["name"]);
    navigate(href("/names", { organism, ...kept, ask: plain ? null : next }), { replace: true });
  };
  const answered = question === "genes" ? Boolean(asked.name) : Boolean(asked.gene);
  return (
    <div className={`page page--names${answered ? " page--answered" : ""}`}>
      <NamesHead folded={answered} />
      <section className="names-panel" aria-labelledby="names-question">
        <h2 id="names-question" className="visually-hidden">
          {question === "genes" ? "Genes a name names" : "Names of a gene"}
        </h2>
        <Segmented<Question>
          className="names-choice"
          label="The question"
          value={question}
          onChange={choose}
          options={[
            { value: "genes", label: "A name → its genes" },
            { value: "names", label: "A gene → its names" },
          ]}
        />
        {question === "genes" ? (
          <div className="names-view" key="genes">
            <Expandable className="names-about" summary="What this answers">
              <p className="names-panel__intro">
                Every gene of the reference sequence to which a database attaches the name, at which releases, and
                whether as the name or as a synonym; for each gene, what the same databases call it at the graph&rsquo;s
                last release.
              </p>
            </Expandable>
            <NameForm
              placeholder={examples.names[0] ?? ""}
              databases={description.synonym_databases}
              name={asked.name}
              foldCase={asked.foldCase}
              release={asked.release}
              onSubmit={(name, foldCase, release) => {
                go({ name: name || null, fold_case: foldCase ? "true" : null, release: release || null, ask: null });
              }}
            />
            {asked.name ? null : (
              <Examples
                label="Try a name"
                values={examples.names}
                onPick={(name) => {
                  go({ name, fold_case: null, ask: null });
                }}
              />
            )}
            <div aria-busy={named.state === "loading"} ref={namedArea}>
              {notRelease ? (
                <NotRelease
                  description={description}
                  release={asked.release}
                  onClear={() => {
                    go({ release: null });
                  }}
                />
              ) : null}
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
                      reference sequence{" "}
                      {releaseValue === null ? "at any of its releases" : `at release ${String(releaseValue)}`}.
                    </>
                  }
                  asked={asked.name}
                  first="gene"
                  release={releaseValue}
                  endpoint={`GET /api/v1/organisms/${organism}/genes-named`}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="names-view" key="names">
            <Expandable className="names-about" summary="What this answers">
              <p className="names-panel__intro">
                Every name a database attaches to the gene itself (symbols, their synonyms, gene numbers such as
                NCBI&rsquo;s), grouped as IDTrack lists them, at which releases. The accessions of its transcripts and
                proteins (RefSeq, UniProt and others) are not names of the gene: convert the gene to their database to
                get them.
              </p>
            </Expandable>
            <GeneForm
              genePlaceholder={examples.genes[0] ?? ""}
              gene={asked.gene}
              release={asked.release}
              onSubmit={(gene, release) => {
                go({ gene: gene || null, release: release || null, ask: "names" });
              }}
            />
            {asked.gene ? null : (
              <Examples
                label="Try a gene"
                values={examples.genes}
                onPick={(gene) => {
                  go({ gene, release: null, ask: "names" });
                }}
              />
            )}
            <div aria-busy={names.state === "loading"} ref={namesArea}>
              {notRelease ? (
                <NotRelease
                  description={description}
                  release={asked.release}
                  onClear={() => {
                    go({ release: null });
                  }}
                />
              ) : null}
              {names.state === "loading" ? <TableSkeleton /> : null}
              {versions ? (
                <VersionChoice
                  organism={organism}
                  first={description.releases[0] ?? description.snapshot_release}
                  last={description.snapshot_release}
                  gene={asked.gene}
                  versions={versions}
                  release={releaseValue}
                  versionAt={versionAt}
                  resolved={resolved}
                  pick={(version) => {
                    go({ gene: version, ask: "names" });
                  }}
                />
              ) : null}
              {versions && resolved && namesAt.state === "loading" ? <TableSkeleton /> : null}
              {versions && resolved && namesAt.state === "failed" ? (
                <ErrorPanel error={namesAt.error} onRetry={namesAt.retry} context="The names" level={3} />
              ) : null}
              {versions && resolved && namesAt.state === "done" ? (
                <Matches
                  matches={namesAt.answer.data.matches}
                  description={description}
                  address={address}
                  empty={
                    <>
                      No external database attaches a name to <Mono>{resolved}</Mono> on the reference sequence at
                      release {releaseValue}.
                    </>
                  }
                  asked={resolved}
                  first="name"
                  release={releaseValue}
                  endpoint={`GET /api/v1/organisms/${organism}/names-of`}
                />
              ) : null}
              {names.state === "failed" && !versions ? (
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
                  release={releaseValue}
                  endpoint={`GET /api/v1/organisms/${organism}/names-of`}
                />
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function NameForm({
  name: addressName,
  foldCase: addressFoldCase,
  release: addressRelease,
  onSubmit,
  placeholder,
  databases,
}: {
  placeholder: string;
  /** The graph's databases of names, named in the hint. */
  databases: readonly string[];
  name: string;
  foldCase: boolean;
  release: string;
  onSubmit: (name: string, foldCase: boolean, release: string) => void;
}) {
  // The form follows the address (a link, Back) without being made anew, so that a submit keeps its focus; a name
  // typed and not sent is kept across an organism switch (lib/drafts.ts), as the address keeps a name sent.
  const addressKey = `${addressName}|${String(addressFoldCase)}|${addressRelease}`;
  const [synced, setSynced] = useState(addressKey);
  const [name, setNameState] = useState(() => draftOver("names.name", addressName));
  const [foldCase, setFoldCase] = useState(addressFoldCase);
  const [release, setRelease] = useState(addressRelease);
  if (synced !== addressKey) {
    setSynced(addressKey);
    setNameState(draftOver("names.name", addressName));
    setFoldCase(addressFoldCase);
    setRelease(addressRelease);
  }
  const setName = (text: string) => {
    setNameState(text);
    keepDraftOver("names.name", addressName, text);
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    keepDraftOver("names.name", name.trim(), name.trim());
    onSubmit(name.trim(), foldCase, release.trim());
  };
  return (
    <form onSubmit={submit} noValidate className="names-form" aria-label="Genes a name names">
      <Field
        label="Name"
        hint={`A symbol or an id of an external database${databases.length ? ` (${sortDatabases(databases).slice(0, 3).map(databaseLabel).join(", ")}, accessions…)` : ""}.`}
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            className="input--mono"
            value={name}
            placeholder={placeholder}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby={describedBy}
            aria-required="true"
            maxLength={256}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        )}
      </Field>
      <ReleaseInput
        value={release}
        onChange={setRelease}
        hint="Only the genes it names at this release. Empty: every release."
      />
      <div className="names-form__switch">
        <Switch
          checked={foldCase}
          onChange={setFoldCase}
          label="Ignore letter case"
          hint="Also match the name written in other letter case (Ins, INS)."
        />
      </div>
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
  genePlaceholder,
}: {
  genePlaceholder: string;
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
    <form onSubmit={submit} noValidate className="names-form names-form--gene" aria-label="Names of a gene">
      <Field
        label="Ensembl gene"
        hint="The gene as Ensembl writes it at a release: its id, a dot and its version. Without its version, give a release (the version active there is asked), or pick one of its versions."
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            className="input--mono"
            value={gene}
            placeholder={genePlaceholder}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby={describedBy}
            aria-required="true"
            maxLength={256}
            onChange={(e) => {
              setGene(e.target.value);
            }}
          />
        )}
      </Field>
      <ReleaseInput
        value={release}
        onChange={setRelease}
        hint="Only the names that hold at this release. Empty: every release."
      />
      <div className="names-form__submit">
        <Button type="submit" variant="primary">
          List names
        </Button>
      </div>
    </form>
  );
}

/** The field of the release a question is asked at (empty: every release). */
function ReleaseInput({ value, onChange, hint }: { value: string; onChange: (value: string) => void; hint: string }) {
  return (
    <Field label="At release" hint={hint} className="names-form__release">
      {({ id, describedBy }) => (
        <TextInput
          id={id}
          inputMode="numeric"
          className="input--mono input--release"
          value={value}
          placeholder="all"
          aria-describedby={describedBy}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      )}
    </Field>
  );
}

/** A release of the address that is no whole number, refused on the page (nothing is asked), with the graph's
 *  releases and the question asked at every release one press away. */
function NotRelease({
  description,
  release,
  onClear,
}: {
  description: GraphDescription;
  release: string;
  onClear: () => void;
}) {
  return (
    <div className="notice notice--danger" role="alert">
      <h3 className="notice__title">Not a release: {release}</h3>
      <p>
        A release is a whole number; the <em>{organismName(description.organism)}</em> graph holds releases{" "}
        <Mono>{description.releases[0]}</Mono> to <Mono>{description.releases[description.releases.length - 1]}</Mono>.
        Nothing was asked of the api.
      </p>
      <div className="notice__actions">
        <Button onClick={onClear}>Ask at every release</Button>
      </div>
    </div>
  );
}

/** The versions the api names for a gene id refused for want of its version (`invalid_argument` on `gene`, each
 *  allowed value that id with a version), or null for any other refusal. */
function versionsOf(error: unknown, gene: string): string[] | null {
  if (!(error instanceof ApiError) || error.body.code !== "invalid_argument" || error.body.argument !== "gene")
    return null;
  const allowed = (error.body.allowed ?? []).map(String).filter((v) => v.startsWith(`${gene.trim()}.`));
  return allowed.length ? allowed : null;
}

/** A gene id without its version: at a release, the version IDTrack's convert reads there (its names follow); without
 *  one, every version the graph holds as a chip with the releases its path gives (one batch of the versions, each with
 *  its path), a press asking its names. */
function VersionChoice({
  organism,
  first,
  last,
  gene,
  versions,
  release,
  versionAt,
  resolved,
  pick,
}: {
  organism: string;
  /** The graph's first and last releases. */
  first: number;
  last: number;
  gene: string;
  versions: string[];
  release: number | null;
  versionAt: RequestState<ConversionResult> & { retry: () => void };
  resolved: string | null;
  pick: (version: string) => void;
}) {
  // Each version's releases as IDTrack's paths give them (the `active` of its node): the versions followed to the
  // graph's last release and back to its first, so that a version retired before the last release, or born after the
  // first, stands on one of the two paths.
  const lives = useRequest(release === null ? `${organism}|versions|${versions.join(",")}` : null, async (signal) => {
    const ask = (to: number) =>
      api.batch(
        organism,
        {
          identifiers: versions,
          from_release: null,
          to_release: to,
          final_database: null,
          from_database: null,
          explain: true,
          allow_bridges: false,
          read_copies: false,
        },
        signal,
      );
    const forward = await ask(last);
    const backward = await ask(first);
    const active = new Map<string, [number, number][]>();
    for (const result of [...forward.data.results, ...backward.data.results])
      for (const node of result.path?.nodes ?? [])
        if (versions.includes(node.id) && !active.has(node.id) && node.active.length)
          // An open end (still active at the graph's last release) is that release.
          active.set(
            node.id,
            node.active.map(([a, b]): [number, number] => [a, b ?? last]),
          );
    return { ...backward, data: active };
  });
  if (release !== null) {
    if (versionAt.state === "failed")
      return <ErrorPanel error={versionAt.error} onRetry={versionAt.retry} context="The version" level={3} />;
    if (versionAt.state !== "done")
      return (
        <p className="names-version-line muted">
          Reading {gene} at release {release}…
        </p>
      );
    return (
      <p className="names-version-line">
        {resolved ? (
          <>
            <Mono>{gene}</Mono> is <Mono strong>{resolved}</Mono> at release <Mono>{release}</Mono> (IDTrack&rsquo;s
            convert).
          </>
        ) : (
          <>
            IDTrack&rsquo;s convert reads no one version of <Mono>{gene}</Mono> at release <Mono>{release}</Mono>: pick
            one.
          </>
        )}
      </p>
    );
  }
  const active = lives.state === "done" ? lives.answer.data : null;
  return (
    <div className="names-version-choice" role="group" aria-labelledby="names-version-choice">
      <p className="names-version-line" id="names-version-choice">
        <Mono>{gene}</Mono> has {versions.length === 1 ? "one version" : `${groupedInteger(versions.length)} versions`}{" "}
        in this graph: pick one, or give a release.
      </p>
      <ul className="names-version-chips">
        {versions.map((version) => {
          const runs = active?.get(version);
          return (
            <li key={version}>
              <button
                type="button"
                className="chip names-version-chip"
                onClick={() => {
                  pick(version);
                }}
              >
                <Mono>{version.slice(gene.trim().length)}</Mono>
                {runs?.length ? (
                  <span className="chip__count mono">
                    {runs.map(([a, b]) => (a === b ? String(a) : `${String(a)}–${String(b)}`)).join(", ")}
                  </span>
                ) : null}
                <span className="visually-hidden">{`: the names of ${version}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
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
    moveFocus(() => area.current, '[role="alert"] .notice__title, .names-verdict, .empty');
  }, [settled, state, area, sentence, moveFocus]);
}

/** One-click examples under a form: identifiers of the Convert page's figures for this organism. */
function Examples({ label, values, onPick }: { label: string; values: string[]; onPick: (value: string) => void }) {
  // The row holds its height before the examples come (the showcase is asked beside the page), so that nothing under
  // it moves when they arrive.
  if (!values.length) return <p className="names-examples" aria-hidden="true" />;
  return (
    <p className="names-examples">
      <span className="names-examples__label">{label}</span>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className="example names-examples__value"
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
    <div className="result--loading names-skeleton">
      <p className="visually-hidden">Looking up…</p>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} width="100%" height={24} className="skeleton--row" />
      ))}
    </div>
  );
}
