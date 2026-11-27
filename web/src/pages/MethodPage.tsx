// How idtrack answers (the method, as a figure of lettered panels, each stage drawn on a real answer of this server),
// how often it is right (the benchmarks' published results), the data this server answers from, how to cite idtrack
// (its own citation, and a sentence for a methods section from this server's versions), what it does not do yet, and
// the bounds this server enforces.
import { docsPage } from "../lib/links";
import { Absent, CopyButton, Disclosure, Link, Mono, Prose, SectionTitle, TableFrame } from "../components/ui";
import type { LimitsResponse } from "../api/types";
import { byteSize, groupedInteger, pythonFloat } from "../lib/numbers";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href } from "../lib/router";
import { useLimits } from "../lib/vocabularyContext";
import docs from "../generated/idtrack_docs.json";
import { AccuracyPanel, ToolsPanel } from "../components/method/Benchmarks";
import { MethodFigure } from "../components/method/MethodFigure";
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

/** How many limitations stand at display size; the rest are one press away (a list is bounded by design). */
const LIMITATIONS_SHOWN = 8;

function LimitationItem({ item }: { item: (typeof docs.limitations.items)[number] }) {
  return (
    <li>
      <a href={`${docs.limitations.source.replace(/#.*$/, "")}#${item.anchor}`} className="limitations-list__lead">
        <Prose text={item.sentence} />
      </a>
      {item.next && item.sentence.length < 90 ? (
        <span className="limitations-list__next">
          <Prose text={item.next} />
        </span>
      ) : null}
    </li>
  );
}

/** idtrack's limitations, each by its first sentence, linked: the first few, then the rest on request, numbered on. */
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
        <Disclosure summary={`and ${items.length - LIMITATIONS_SHOWN} more`}>
          <ol className="limitations-list" start={LIMITATIONS_SHOWN + 1}>
            {items.slice(LIMITATIONS_SHOWN).map((item) => (
              <LimitationItem key={item.anchor} item={item} />
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </>
  );
}

export function MethodPage() {
  const { version, organisms } = useOrganisms();
  const limits = useLimits();
  const idtrackVersion = version?.idtrack_version ?? null;
  // idtrack's own entry (its documentation at the pinned commit), with the version of the idtrack that answers here
  // where it differs from the documented one.
  const bibtex = idtrackVersion
    ? docs.citation.bibtex.replace(/version = \{[^}]*\}/, `version = {${idtrackVersion}}`)
    : docs.citation.bibtex;
  const today = new Date().toISOString().slice(0, 10);
  const methodsSentence = version
    ? `Gene identifiers were converted with idtrack ${version.idtrack_version}${
        version.idtrack_commit ? ` (commit ${version.idtrack_commit.slice(0, 7)})` : ""
      } through its web server (api ${version.api_version}) on ${today}, on graphs of Ensembl release${
        new Set(version.graphs.map((g) => g.snapshot_release)).size === 1 ? "" : "s"
      } ${[...new Set(version.graphs.map((g) => g.snapshot_release))].join(", ")} (${version.graphs
        .map((g) => `${organismName(g.organism)}: content digest ${g.content_digest.slice(0, 12)}`)
        .join("; ")}).`
    : null;
  return (
    <div className="page page--about page--method">
      <header className="page-head">
        <p className="eyebrow">Method</p>
        <h1>How idtrack answers, and how often it is right</h1>
        <p className="lede">
          An answer is found in five stages, each drawn below on a real answer of this server; then how often the
          answers agree with Ensembl&apos;s records and the authorities, and with the tools people use, as the
          benchmarks measured them.
        </p>
        <p className="method-scope" role="note">
          <strong>Within one organism.</strong> Each graph is one organism&apos;s releases: idtrack converts between the
          releases and databases of that organism, and does not compute orthology between species (idtrack&apos;s
          documentation,{" "}
          <a href={docsPage("_notebooks/05_tutorial_humanization_mouse_pig_to_human.html")}>across species</a>
          ).
        </p>
      </header>

      <MethodFigure />
      <AccuracyPanel />
      <ToolsPanel />

      <div className="about-grid method-after">
        <section className="panel" aria-labelledby="cite">
          <SectionTitle id="cite" aside={<CopyButton text={bibtex} what="the citation" />}>
            How to cite
          </SectionTitle>
          <p>
            idtrack&apos;s citation, as its documentation gives it (<a href={docs.citation.source}>Citing idtrack</a>
            ), with the version of the idtrack that answers on this server: <Prose text={docs.citation.note} />
          </p>
          <pre className="raw raw--cite" role="region" aria-label="Citation in BibTeX" tabIndex={0}>
            {bibtex}
          </pre>
          {methodsSentence ? (
            <>
              <h3 className="method-sub method-cite__sub">
                For a methods section <CopyButton text={methodsSentence} what="the sentence for a methods section" />
              </h3>
              <p className="method-cite__sentence">{methodsSentence}</p>
              <p className="muted small">
                Written from this server&apos;s versions (<span className="mono">GET /api/v1/version</span>) and
                today&apos;s date; the digests name the graphs exactly (the full digests are in the table beside).
              </p>
            </>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="data">
          <SectionTitle id="data">The data this server answers from</SectionTitle>
          {version ? (
            <>
              <p>
                idtrack <Mono>{version.idtrack_version}</Mono>
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
                      <th scope="col">Built by idtrack</th>
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
                            {g.build_date ? (
                              <Mono>{g.build_date}</Mono>
                            ) : (
                              <Absent meaning="Not recorded in the graph file" />
                            )}
                          </td>
                          <td data-label="Built by idtrack">
                            {g.package_commit ? (
                              <>
                                commit <Mono>{g.package_commit.slice(0, 7)}</Mono>
                              </>
                            ) : (
                              <Absent meaning="Not recorded in the graph file" />
                            )}
                          </td>
                          <td data-label="Content digest" className="cell-digest">
                            <span className="mono" title={g.content_digest}>
                              {g.content_digest.slice(0, 12)}
                            </span>
                            <span className="visually-hidden"> (full digest: {g.content_digest})</span>{" "}
                            <CopyButton
                              text={g.content_digest}
                              what={`the content digest of ${organismName(g.organism)}`}
                            />
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
          ) : (
            <p className="muted">The server's version could not be read.</p>
          )}
        </section>

        <section className="panel" aria-labelledby="known-limitations">
          <SectionTitle id="known-limitations">What idtrack does not do yet</SectionTitle>
          <p>
            idtrack states the known limitations of the version that answers here, with how often each matters where it
            can be counted on the five graphs. Each, in the first sentence idtrack opens it with (its documentation at{" "}
            <Mono>{docs.docsCommit.slice(0, 12)}</Mono>, whose changes since the release{" "}
            <Mono>{docs.commit.slice(0, 7)}</Mono> are to its documentation only), linked to the section that sizes it
            and says what to do instead:
          </p>
          <Limitations />
          <p>
            All of them, with their measured sizes:{" "}
            <a href={docs.limitations.source}>Limitations in idtrack&apos;s documentation</a>. What the benchmarks
            measure that idtrack answers wrongly or cannot decide is listed by the benchmark repository:{" "}
            <a href={benchmarkFile("results/limitations/limitations.tsv")}>its known limitations</a> (at{" "}
            <Mono>{BENCHMARKS.commit.slice(0, 12)}</Mono>).
          </p>
        </section>

        <section className="panel" aria-labelledby="limits">
          <SectionTitle id="limits">Limits</SectionTitle>
          <p>
            The api bounds what one request may ask, so that one person&apos;s search cannot hold the server for others.
            These are this server&apos;s bounds, as it reports them; a request over a bound is refused with a message
            that names the bound.
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
        </section>
      </div>
    </div>
  );
}
