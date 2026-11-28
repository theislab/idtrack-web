// The footer (DIRECTION.md, "The shell"): one quiet row. IDTrack's version and the graphs' releases as the server
// states them (`GET /api/v1/version`), and the ways out: the documentation, the package, the source, the api's
// documents; this site's and the benchmarks' repositories for reference. Under it who develops IDTrack, and a row of
// the site's own pages with the cookie settings.
import { BENCHMARKS_SOURCE, docsPage, IDTRACK_PACKAGE, IDTRACK_SOURCE, SITE_SOURCE } from "../../lib/links";
import { useOrganisms } from "../../lib/organisms";
import { LogoMark } from "../Logo";
import { Link, Mono } from "../ui";
import { SitePageLinks } from "../SitePages";
import { ConsentSettings } from "./Consent";

export function SiteFooter() {
  const { version, facts } = useOrganisms();
  const releases = version ? [...new Set(version.graphs.map((g) => g.snapshot_release))].join(", ") : null;
  const pending = facts.version === "failed" ? "not read" : "…";
  return (
    <footer className="foot">
      <div className="foot__inner">
        <p className="foot__brand">
          <LogoMark className="foot__mark" />
          <span>
            IDTrack <Mono>{version ? version.idtrack_version : pending}</Mono>
            {version?.idtrack_commit ? (
              <span className="foot__quiet">
                {" "}
                <Mono>{version.idtrack_commit.slice(0, 7)}</Mono>
              </span>
            ) : null}
            <span className="foot__quiet">
              {" "}
              · Ensembl <Mono>{releases ?? pending}</Mono> · api <Mono>{version ? version.api_version : pending}</Mono>{" "}
              · BSD 3-Clause
            </span>
          </span>
        </p>
        <nav className="foot__links" aria-label="IDTrack elsewhere">
          <a href={docsPage()}>Documentation</a>
          <a href={IDTRACK_PACKAGE}>PyPI</a>
          <a href={IDTRACK_SOURCE}>GitHub</a>
          <Link to="/developers">API</Link>
          <a href="/llms.txt">llms.txt</a>
          <span className="foot__quiet">
            Sources: <a href={SITE_SOURCE}>this site</a>, <a href={BENCHMARKS_SOURCE}>the benchmarks</a>
          </span>
        </nav>
        {/* Who stands behind the tool, as IDTrack's documentation states it (its credits, "Institutional Support"). */}
        <p className="foot__origin">
          Developed at the Theis Lab, Institute of Computational Biology, Helmholtz Center Munich (
          <a href={docsPage("authors.html#institutional-support")}>credits</a>).
        </p>
        {/* The site's own pages (legal notice, privacy, licences, accessibility), with the cookie settings where the
            site counts visits. */}
        <nav className="foot__legal" aria-label="About this site">
          <SitePageLinks />
          <ConsentSettings />
        </nav>
      </div>
    </footer>
  );
}
