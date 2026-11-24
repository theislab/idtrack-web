// What idtrack is, how to cite it, the data this server answers from, and the limits it enforces.
import { Absent, CopyButton, Link, Mono, Prose, SectionTitle, TableFrame } from "../components/ui";
import type { LimitsResponse } from "../api/types";
import { byteSize, groupedInteger, pythonFloat } from "../lib/numbers";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href } from "../lib/router";
import { useLimits } from "../lib/vocabularyContext";
import limitations from "../generated/limitations.json";

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

export function AboutPage() {
  const { version, organisms } = useOrganisms();
  const limits = useLimits();
  const idtrackVersion = version?.idtrack_version ?? null;
  const bibtex = [
    "@software{idtrack,",
    "  author = {Inecik, Kemal},",
    "  title = {IDTrack: Cross-Temporal and Cross-Database Biological Identifier Mapping},",
    "  url = {https://github.com/theislab/idtrack},",
    ...(idtrackVersion ? [`  version = {${idtrackVersion}},`] : []),
    "  year = {2025}",
    "}",
  ].join("\n");
  return (
    <div className="page page--about">
      <header className="page-head">
        <p className="eyebrow">About</p>
        <h1>idtrack, in the browser</h1>
        <p className="lede">
          Gene identifiers change: Ensembl versions and replaces its ids, splits and merges genes, and moves to new
          genome assemblies; other databases rename what they attach. idtrack follows an identifier through all of it,
          release by release, and says how it got its answer. This site runs idtrack on a server, so it needs no
          installation.
        </p>
      </header>

      <div className="about-grid">
        <section className="panel" aria-labelledby="what">
          <SectionTitle id="what">What it does</SectionTitle>
          <ul className="prose-list">
            <li>
              <strong>Time travel through Ensembl's releases</strong>, forward and backward, along Ensembl's own id
              history (new versions, replacements, splits and merges, each with Ensembl's mapping score).
            </li>
            <li>
              <strong>Across assemblies</strong>: an id of an earlier genome build converts to the build Ensembl
              maintains at the target release; the path shows where the handoff happens.
            </li>
            <li>
              <strong>Across databases</strong>: symbols and accessions of HGNC, NCBI, RefSeq, UniProt and others are
              read as the genes they are attached to at a release, and answers can be given in them.
            </li>
            <li>
              <strong>Ambiguity kept explicit</strong>: every candidate the search reached is ranked and shown, with the
              criterion that put the best before the runner-up; a tie is a tie.
            </li>
          </ul>
          <p>
            idtrack is a Python package: <a href="https://github.com/theislab/idtrack">github.com/theislab/idtrack</a>,
            documented at <a href="https://idtrack.readthedocs.io">idtrack.readthedocs.io</a>. The api this page uses is
            documented at <a href="/api/v1/docs">/api/v1/docs</a>.
          </p>
        </section>

        <section className="panel" aria-labelledby="cite">
          <SectionTitle id="cite" aside={<CopyButton text={bibtex} what="the citation" />}>
            How to cite
          </SectionTitle>
          <p>
            If you use idtrack in your research, please cite it with the version that answered (the version field below
            is this server's).
          </p>
          <pre className="raw raw--cite" role="region" aria-label="Citation in BibTeX" tabIndex={0}>
            {bibtex}
          </pre>
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
                      <th scope="col">Content digest</th>
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
                          <td data-label="Content digest" className="cell-digest">
                            <Mono>{g.content_digest}</Mono>
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
            idtrack states the known limitations of this version, each measured on the graphs of the five organisms.
            Their lead sentences, in idtrack&apos;s words (idtrack <Mono>{limitations.commit.slice(0, 12)}</Mono>):
          </p>
          <ul className="prose-list limitations-list">
            {limitations.items.map((item) => (
              <li key={item}>
                <Prose text={item} />
              </li>
            ))}
          </ul>
          <p>
            Each with how often it matters and what to do instead:{" "}
            <a href={limitations.source}>Current Limitations in idtrack&apos;s documentation</a>.
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
