// What a graph holds: its releases and assemblies, its databases, and the record of its build and file.
import type { GraphDescription, GraphVersion } from "../api/types";
import { ReleaseRuler } from "../components/ReleaseRuler";
import { CopyButton, Link, Mono, Readout, SectionTitle, TableFrame, Absent } from "../components/ui";
import { databaseLabel } from "../lib/databases";
import { byteSize, groupedInteger, releaseRanges } from "../lib/numbers";
import { commonName, organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href, useLocation } from "../lib/router";

export function OrganismsIndex() {
  const { organisms } = useOrganisms();
  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Organisms</p>
        <h1>The graphs this server holds</h1>
        <p className="lede">
          Each organism is one graph of Ensembl's releases, built by idtrack and verified by its checksum when the
          server started.
        </p>
      </header>
      <ul className="organism-list">
        {organisms.map((o) => (
          <li key={o.organism} className="panel organism-card">
            <h2>
              <Link to={href(`/organisms/${o.organism}`)}>
                <em>{organismName(o.organism)}</em>
              </Link>
              {commonName(o.organism) ? <span className="muted"> · {commonName(o.organism)}</span> : null}
            </h2>
            <p>
              Releases <Mono>{releaseRanges(o.releases)}</Mono> · {o.assemblies.length} assemblies ·{" "}
              {o.external_databases.length} external databases
            </p>
            <ReleaseRuler description={o} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrganismPage() {
  const { organisms, version, status } = useOrganisms();
  const location = useLocation();
  const asked = decodeURIComponent(location.path.replace(/^\/organisms\//, "").replace(/\/$/, ""));
  const description = organisms.find((o) => o.organism === asked || commonName(o.organism) === asked);
  if (status !== "done") return null;
  if (!description) {
    return (
      <div className="page">
        <div className="notice notice--danger" role="alert">
          <p className="notice__title">An organism this server does not hold</p>
          <p>
            <Mono>{asked}</Mono> is not loaded here. The server holds:{" "}
            {organisms.map((o, i) => (
              <span key={o.organism}>
                <Link to={href(`/organisms/${o.organism}`)}>{o.organism}</Link>
                {i < organisms.length - 1 ? ", " : ""}
              </span>
            ))}
            .
          </p>
        </div>
      </div>
    );
  }
  const file = version?.graphs.find((g) => g.organism === description.organism) ?? null;
  return <OrganismDetail description={description} file={file} />;
}

function OrganismDetail({ description: d, file }: { description: GraphDescription; file: GraphVersion | null }) {
  return (
    <div className="page page--organism">
      <header className="page-head">
        <p className="eyebrow">Organism</p>
        <h1>
          <em>{organismName(d.organism)}</em>
          {commonName(d.organism) ? <span className="muted"> · {commonName(d.organism)}</span> : null}
        </h1>
        <p className="lede">
          Ensembl releases <Mono>{releaseRanges(d.releases)}</Mono>; the last, <Mono>{d.snapshot_release}</Mono>, is the
          graph's snapshot. <Link to={href("/", { organism: d.organism })}>Convert an identifier of this graph</Link>.
        </p>
      </header>

      <section className="panel" aria-labelledby="releases">
        <SectionTitle id="releases">Releases and assemblies</SectionTitle>
        <ReleaseRuler description={d} />
        <TableFrame label="Assemblies" className="table-frame--cards">
          <table className="table table--cards">
            <thead>
              <tr>
                <th scope="col">Assembly</th>
                <th scope="col">Key</th>
                <th scope="col">Serves releases</th>
                <th scope="col">Holds data at</th>
                <th scope="col">External databases</th>
              </tr>
            </thead>
            <tbody>
              {d.assemblies.map((a) => (
                <tr key={a.assembly}>
                  <td data-label="Assembly">
                    <strong>{a.name ?? <Absent meaning="The graph names no assembly here" />}</strong>
                    {a.assembly === d.primary_assembly ? <span className="tag">primary</span> : null}
                  </td>
                  <td data-label="Key" className="num">
                    <Mono>{a.assembly}</Mono>
                  </td>
                  <td data-label="Serves releases" className="cell-ranges">
                    {a.serves.length ? (
                      <Mono>{releaseRanges(a.serves)}</Mono>
                    ) : (
                      <Absent meaning="It serves no release" />
                    )}
                  </td>
                  <td data-label="Holds data at" className="cell-ranges">
                    <Mono>{releaseRanges(a.releases)}</Mono>
                  </td>
                  <td data-label="External databases" className="cell-wrap">
                    {a.external_databases.map(databaseLabel).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </section>

      <section className="panel" aria-labelledby="databases">
        <SectionTitle id="databases">Databases</SectionTitle>
        <dl className="readouts">
          <Readout label="External databases (any assembly)" wide>
            <ul className="chips">
              {d.external_databases.map((db) => (
                <li key={db} className="chip" title={db}>
                  {databaseLabel(db)}
                </li>
              ))}
            </ul>
          </Readout>
          <Readout label={`Target databases at release ${d.snapshot_release}`} wide>
            <ul className="chips">
              {d.final_databases.map((db) => (
                <li key={db} className="chip" title={db}>
                  {databaseLabel(db)}
                </li>
              ))}
            </ul>
          </Readout>
          <Readout label="Ensembl forms">{d.forms.join(", ")}</Readout>
        </dl>
      </section>

      <section className="panel" aria-labelledby="build">
        <SectionTitle id="build">The graph and its build</SectionTitle>
        <dl className="readouts">
          <Readout label="Content digest" wide>
            {d.content_digest ? <Mono>{d.content_digest}</Mono> : <Absent meaning="Not recorded in the graph file" />}{" "}
            {d.content_digest ? <CopyButton text={d.content_digest} what="content digest" /> : null}
          </Readout>
          <Readout label="Built">
            {d.build_date ? <Mono>{d.build_date}</Mono> : <Absent meaning="Not recorded in the graph file" />}
          </Readout>
          <Readout label="Built by idtrack">
            {d.package_version ? <Mono>{d.package_version}</Mono> : <Absent meaning="Not recorded in the graph file" />}
            {d.package_commit ? (
              <>
                {" "}
                at <Mono>{d.package_commit}</Mono>
              </>
            ) : (
              <span className="muted"> (commit not recorded)</span>
            )}
          </Readout>
          <Readout label="File format">
            {d.format_version === null ? (
              <Absent meaning="A graph made in memory, not read from a file" />
            ) : (
              <Mono>{d.format_version}</Mono>
            )}
          </Readout>
          {file ? (
            <>
              <Readout label="File" wide>
                <Mono>{file.file.key}</Mono>
              </Readout>
              <Readout label="SHA-256, verified at start" wide>
                <Mono>{file.file.sha256}</Mono> <CopyButton text={file.file.sha256} what="SHA-256" />
              </Readout>
              <Readout label="Size">
                <Mono>{groupedInteger(file.file.size)}</Mono> bytes{" "}
                <span className="muted">({byteSize(file.file.size)})</span>
              </Readout>
            </>
          ) : null}
        </dl>
        <TableFrame label="Counts of the build">
          <table className="table table--compact">
            <caption>Counts of the build, as the graph file records them</caption>
            <tbody>
              {Object.entries(d.counts).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k.replace(/_/g, " ")}</th>
                  <td className="num">
                    <Mono>{groupedInteger(v)}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </section>
    </div>
  );
}
