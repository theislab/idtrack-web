// How IDTrack answers (a stepper of its five stages, each drawn on a real answer of this server), how often it is right
// (the benchmarks' published results, one organism at a time, the rest behind tabs), and using its answers: what it
// does not do yet, the data this server answers from and the bounds it enforces (tabs), and how to cite IDTrack (its
// own citation, and a sentence for a methods section from this server's versions) in a drawer.
import { docsPage } from "../lib/links";
import { useState } from "react";
import { Absent, Button, CopyButton, Link, Mono, Prose, TableFrame } from "../components/ui";
import { Drawer } from "../components/v2/Drawer";
import { Expandable } from "../components/v2/Expandable";
import { HoverCard } from "../components/v2/HoverCard";
import { Tabs } from "../components/v2/Tabs";
import type { LimitsResponse } from "../api/types";
import { byteSize, groupedInteger, pythonFloat } from "../lib/numbers";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href } from "../lib/router";
import { useLimits } from "../lib/vocabularyContext";
import docs from "../generated/idtrack_docs.json";
import { Accuracy } from "../components/method/Accuracy";
import { MethodStages } from "../components/method/MethodFigure";
import { BENCHMARKS, benchmarkFile, measuredGraph } from "../lib/benchmarks";
import "../styles/method.css";

/** The bounds of this server as it reports them (`/limits`), in words. */
function limitRows(l: LimitsResponse): [string, string, string | undefined][] {
  const seconds = (n: number) => `${pythonFloat(n).replace(/\.0$/, "")} s`;
  return [
    ["Identifiers per batch", groupedInteger(l.batch_max), undefined],
    ["Characters per identifier or name", groupedInteger(l.identifier_max_length), undefined],
    ["Time per request", seconds(l.request_seconds), undefined],
    ["Time per identifier's search", seconds(l.search_seconds), `and ${groupedInteger(l.search_states)} search states`],
    ["Request body", `${groupedInteger(l.body_max_bytes)} bytes`, byteSize(l.body_max_bytes)],
    [
      "Answer",
      `${groupedInteger(l.response_max_bytes)} bytes`,
      `${byteSize(l.response_max_bytes)}; a larger answer is refused, never cut`,
    ],
    [
      "Requests per client",
      l.rate_per_minute === 0 ? "no limit" : `${groupedInteger(l.rate_per_minute)} per minute`,
      l.rate_per_minute === 0 ? undefined : `bursts of ${groupedInteger(l.rate_burst)}`,
    ],
  ];
}

/** How many limitations stand as rows at once; the rest are one press away (a list is bounded by design). */
const LIMITATIONS_SHOWN = 8;

/** A limitation as one row: its title on the surface; its whole first sentence (never cut short), the sentence after
 *  it and the link to the section that sizes it one press away. */
function LimitationItem({ item }: { item: (typeof docs.limitations.items)[number] }) {
  return (
    <li>
      <Expandable summary={<Prose text={item.title} />} className="limitations-list__row">
        <p className="limitations-list__lead">
          <Prose text={item.sentence} />
          {item.next ? (
            <>
              {" "}
              <span className="limitations-list__next">
                <Prose text={item.next} />
              </span>
            </>
          ) : null}
        </p>
        <a href={`${docs.limitations.source.replace(/#.*$/, "")}#${item.anchor}`} className="limitations-list__link">
          Its section in IDTrack&apos;s documentation
        </a>
      </Expandable>
    </li>
  );
}

/** IDTrack's limitations, each a row by its title: the first few, then the rest on request. */
function Limitations() {
  const items = docs.limitations.items;
  return (
    <>
      <ol className="limitations-list">
        {items.slice(0, LIMITATIONS_SHOWN).map((item) => (
          <LimitationItem key={item.anchor} item={item} />
        ))}
      </ol>
      {items.length > LIMITATIONS_SHOWN ? (
        <Expandable summary={`And ${items.length - LIMITATIONS_SHOWN} more`} className="limitations-more">
          <ol className="limitations-list" start={LIMITATIONS_SHOWN + 1}>
            {items.slice(LIMITATIONS_SHOWN).map((item) => (
              <LimitationItem key={item.anchor} item={item} />
            ))}
          </ol>
        </Expandable>
      ) : null}
    </>
  );
}

/** The page's head: the same in every state, and drawn into the page the server sends before the code runs
 *  (scripts/prerender.ts). */
export function MethodHead() {
  return (
    <header className="page-head method-head">
      <h1>How IDTrack answers, and how often it is right</h1>
      <p className="lede">
        Five stages find an answer within one organism&apos;s releases, each drawn here on a real answer of this server.
      </p>
      <nav className="method-index" aria-label="On this page">
        <a href="#method-stages">The five stages</a>
        <a href="#accuracy">How often it is right</a>
        <a href="#method-using">Using its answers</a>
      </nav>
    </header>
  );
}

/** The five stages, one shown at a time. */
function StagesSection() {
  return (
    <section className="method-section" id="method-stages" aria-labelledby="method-stages-title">
      <h2 id="method-stages-title" className="visually-hidden">
        The five stages of an answer
      </h2>
      <MethodStages />
    </section>
  );
}

/** IDTrack's citation and a sentence for a methods section, in a drawer. */
function Cite({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { version } = useOrganisms();
  const idtrackVersion = version?.idtrack_version ?? null;
  // IDTrack's own entry (its documentation at the pinned commit), with the version of the IDTrack that answers here
  // where it differs from the documented one.
  const bibtex = idtrackVersion
    ? docs.citation.bibtex.replace(/version = \{[^}]*\}/, `version = {${idtrackVersion}}`)
    : docs.citation.bibtex;
  const today = new Date().toISOString().slice(0, 10);
  const methodsSentence = version
    ? `Gene identifiers were converted with IDTrack ${version.idtrack_version}${
        version.idtrack_commit ? ` (commit ${version.idtrack_commit.slice(0, 7)})` : ""
      } through its web server (api ${version.api_version}) on ${today}, on graphs of Ensembl release${
        new Set(version.graphs.map((g) => g.snapshot_release)).size === 1 ? "" : "s"
      } ${[...new Set(version.graphs.map((g) => g.snapshot_release))].join(", ")} (${version.graphs
        .map((g) => `${organismName(g.organism)}: content digest ${g.content_digest.slice(0, 12)}`)
        .join("; ")}).`
    : null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Cite IDTrack"
      subtitle="Its citation, and a sentence for a methods section"
    >
      <div className="method-cite">
        <p>
          IDTrack&apos;s citation, as its documentation gives it (<a href={docs.citation.source}>Citing IDTrack</a>
          ). For answers of this site, the version to cite is the IDTrack that answered them on this server
          {idtrackVersion ? (
            <>
              , <Mono>{idtrackVersion}</Mono>
            </>
          ) : null}{" "}
          (<span className="mono">GET /api/v1/version</span>, <span className="mono">idtrack_version</span>), which the
          entry below carries. For IDTrack run as a package, its documentation says: <Prose text={docs.citation.note} />
        </p>
        <div className="method-cite__copy">
          <CopyButton text={bibtex} what="the citation in BibTeX" />
        </div>
        <pre className="raw raw--cite" role="region" aria-label="Citation in BibTeX" tabIndex={0}>
          {bibtex}
        </pre>
        {methodsSentence ? (
          <>
            <h3 className="method-sub method-cite__sub">For a methods section</h3>
            <p className="method-cite__sentence">{methodsSentence}</p>
            <div className="method-cite__copy">
              <CopyButton text={methodsSentence} what="the sentence for a methods section" />
            </div>
            <p className="muted small">
              Written from this server&apos;s versions (<span className="mono">GET /api/v1/version</span>) and
              today&apos;s date; the digests name the graphs exactly (the full digests: Data of this server, on this
              page).
            </p>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

/** The data this server answers from: IDTrack's version and each graph with its content digest. */
function ServerData() {
  const { version, organisms } = useOrganisms();
  if (!version) return <p className="muted">The server&apos;s version could not be read.</p>;
  return (
    <>
      <p>
        IDTrack <Mono>{version.idtrack_version}</Mono>
        {version.idtrack_commit ? (
          <>
            {" "}
            at commit <Mono>{version.idtrack_commit.slice(0, 12)}</Mono>
          </>
        ) : null}
        , api <Mono>{version.api_version}</Mono>, graph format <Mono>{version.graph_format_version}</Mono>.
      </p>
      <TableFrame label="Graphs" className="table-frame--cards">
        <table className="table table--cards">
          <thead>
            <tr>
              <th scope="col">Organism</th>
              <th scope="col">Ensembl releases</th>
              <th scope="col">Built</th>
              <th scope="col">Built by IDTrack</th>
              <th scope="col">Content digest</th>
              <th scope="col">Benchmarked</th>
            </tr>
          </thead>
          <tbody>
            {version.graphs.map((g) => {
              const d = organisms.find((o) => o.organism === g.organism);
              return (
                <tr key={g.organism}>
                  <td data-label="Organism">
                    <Link to={href(`/organisms/${g.organism}`)}>
                      <em>{organismName(g.organism)}</em>
                    </Link>
                  </td>
                  <td data-label="Ensembl releases">
                    <Mono>
                      {d ? `${d.releases[0] ?? ""}–` : ""}
                      {g.snapshot_release}
                    </Mono>
                  </td>
                  <td data-label="Built">
                    {g.build_date ? <Mono>{g.build_date}</Mono> : <Absent meaning="Not recorded in the graph file" />}
                  </td>
                  <td data-label="Built by IDTrack">
                    {g.package_commit ? (
                      <>
                        commit <Mono>{g.package_commit.slice(0, 7)}</Mono>
                      </>
                    ) : (
                      <Absent meaning="Not recorded in the graph file" />
                    )}
                  </td>
                  <td data-label="Content digest" className="cell-digest">
                    <HoverCard
                      className="cell-digest__card"
                      triggerClassName="cell-digest__short mono"
                      trigger={g.content_digest.slice(0, 12)}
                      label={`The content digest of ${organismName(g.organism)}, whole`}
                    >
                      <span className="mono cell-digest__whole">{g.content_digest}</span>
                    </HoverCard>{" "}
                    <CopyButton text={g.content_digest} what={`the content digest of ${organismName(g.organism)}`} />
                  </td>
                  <td data-label="Benchmarked">
                    {measuredGraph(g.organism, g.content_digest) ? "this graph" : "another graph"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </>
  );
}

/** IDTrack's known limitations, each a row by its title. */
function KnownLimitations() {
  return (
    <>
      <p className="method-scope" role="note">
        <strong>Within one organism.</strong> IDTrack converts between the releases and databases of one organism&apos;s
        graph, and computes no orthology between species (
        <a href={docsPage("_notebooks/05_tutorial_humanization_mouse_pig_to_human.html")}>across species</a>).
      </p>
      <p className="method-using__intro">
        The known limitations of the IDTrack that answers here, each from{" "}
        <a href={docs.limitations.source}>its documentation</a> with how often it matters where that can be counted.
      </p>
      <Limitations />
      <p className="method-using__sources small muted">
        Read from IDTrack&apos;s documentation at <Mono>{docs.docsCommit.slice(0, 12)}</Mono>, whose changes since the
        release <Mono>{docs.commit.slice(0, 7)}</Mono> are to its documentation only. What the benchmarks measure that
        IDTrack answers wrongly or cannot decide:{" "}
        <a href={benchmarkFile("results/limitations/limitations.tsv")}>
          the benchmark repository&apos;s known limitations
        </a>{" "}
        (at <Mono>{BENCHMARKS.commit.slice(0, 12)}</Mono>).
      </p>
    </>
  );
}

/** The bounds this server enforces, as it reports them. */
function ServerLimits() {
  const limits = useLimits();
  return (
    <>
      <p>
        The api bounds what one request may ask, so that one person&apos;s search cannot hold the server for others: a
        request over a bound is refused with a message that names the bound.
      </p>
      {limits ? null : <p className="muted">The server&apos;s bounds could not be read.</p>}
      <dl className="limits">
        {(limits ? limitRows(limits) : []).map(([k, v, note]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <Mono>{v}</Mono>
              {note ? <span className="limits__note"> {note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted">This page keeps only your choice of theme in your browser; it sets no cookie.</p>
    </>
  );
}

export function MethodPage() {
  // `#cite` (a link from another page) opens the citation at once.
  const [citing, setCiting] = useState(() => typeof window !== "undefined" && window.location.hash === "#cite");
  return (
    <div className="page page--about page--method">
      <MethodHead />
      <StagesSection />
      <Accuracy />
      <section className="method-section method-using" id="method-using" aria-labelledby="method-using-title">
        <div className="method-section__head method-section__head--row">
          <div>
            <h2 id="method-using-title">Using its answers</h2>
            <p className="method-section__lede">What it does not do yet, the data of this server, and its bounds.</p>
          </div>
          <Button
            variant="secondary"
            aria-haspopup="dialog"
            aria-expanded={citing}
            onClick={() => {
              setCiting(true);
            }}
          >
            Cite IDTrack
          </Button>
        </div>
        <Tabs
          label="Using its answers"
          param="about"
          className="method-using__tabs"
          items={[
            {
              id: "limitations",
              label: "What it does not do yet",
              count: docs.limitations.items.length,
              panel: () => <KnownLimitations />,
            },
            { id: "data", label: "Data of this server", panel: () => <ServerData /> },
            { id: "limits", label: "Limits", panel: () => <ServerLimits /> },
          ]}
        />
      </section>
      <Cite
        open={citing}
        onClose={() => {
          setCiting(false);
          if (window.location.hash === "#cite")
            window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        }}
      />
    </div>
  );
}
