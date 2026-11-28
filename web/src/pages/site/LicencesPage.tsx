// The licences page (/licences): on which terms the site's code, IDTrack, the texts and figures, the fonts, the
// software the browser receives (generated from the production bundle: src/generated/licences.json) and the data
// IDTrack's graphs hold (its documentation's sources, each with its terms as it states them) may be reused; and how
// to cite IDTrack (its documentation's citation).
import { Doc, DocHead, Section, Wide, type DocSection } from "../../components/site/Doc";
import { writtenDate } from "../../lib/site/dates";
import { CopyButton, Link, Mono } from "../../components/ui";
import docs from "../../generated/idtrack_docs.json" with { type: "json" };
import licences from "../../generated/licences.json" with { type: "json" };
import { IDTRACK_PACKAGE, IDTRACK_SOURCE, SITE_SOURCE } from "../../lib/links";
import { DATA_TERMS, TERMS_READ } from "../../lib/site/dataTerms";
import { LEGAL_READ } from "../../lib/site/facts";

const SECTIONS = {
  code: { id: "code", title: "This site's code" },
  idtrack: { id: "idtrack", title: "IDTrack" },
  texts: { id: "texts", title: "Texts, figures and names" },
  fonts: { id: "fonts", title: "Fonts" },
  software: { id: "software", title: "Software your browser receives" },
  data: { id: "data", title: "The data" },
  cite: { id: "cite", title: "How to cite IDTrack" },
} satisfies Record<string, DocSection>;

const fonts = licences.packages.filter((p) => p.font);
const software = licences.packages.filter((p) => !p.font);

/** Every resource of IDTrack's data sources, with its source's description and its terms. */
const resources = docs.sources.items.flatMap((item) =>
  item.resources.map((resource) => ({ ...resource, what: item.description, terms: DATA_TERMS[resource.name] })),
);

export function LicencesPage() {
  return (
    <Doc
      head={
        <DocHead
          title="Licences"
          lede="On which terms you may reuse this site's code, texts and figures, the fonts and software it sends, and the data behind its answers."
          updated={LEGAL_READ}
        />
      }
      sections={Object.values(SECTIONS)}
      className="doc--licences"
    >
      <Section section={SECTIONS.code}>
        <p>
          The web app&apos;s code (the api, the pages and their tests, the deployment) is published under the BSD
          3-Clause License, in its repository <a href={SITE_SOURCE}>github.com/theislab/idtrack-web</a>; the binding
          text is the repository&apos;s <a href={`${SITE_SOURCE}/blob/main/LICENSE`}>LICENSE</a>. Copyright © 2025,
          Theis Lab.
        </p>
      </Section>

      <Section section={SECTIONS.idtrack}>
        <p>
          IDTrack, the Python package that computes every answer of this site, is published under the BSD 3-Clause
          License as well (<a href={`${IDTRACK_SOURCE}/blob/main/LICENSE`}>its LICENSE</a>; source on{" "}
          <a href={IDTRACK_SOURCE}>GitHub</a>, package on <a href={IDTRACK_PACKAGE}>PyPI</a>). Copyright © 2025, Theis
          Lab.
        </p>
      </Section>

      <Section section={SECTIONS.texts}>
        <p>
          The texts of this site, its figures and its logo are part of its repository and published under the same BSD
          3-Clause License. The facts a figure draws are not the site&apos;s to license: they are the data of the
          sources below, under their terms.
        </p>
        <p>
          The licence covers no name or logo as a mark: you may say where something comes from, but not use the names
          IDTrack, Theis Lab or Helmholtz Munich, or their logos, to suggest that they made, approved or support what
          you do. The names of Helmholtz Munich and of the databases below belong to their owners.
        </p>
      </Section>

      <Section section={SECTIONS.fonts}>
        <p>
          The site sets its text in three typefaces, served by the site itself. Each is licensed by its authors under
          the SIL Open Font License 1.1, not by the site; each licence text, with its copyright notices as the
          font&apos;s package ships it, is published beside the fonts:
        </p>
        <ul>
          {fonts.map((f) => (
            <li key={f.name}>
              <a href={f.url}>{f.family}</a>
              {f.copyright ? ` (${f.copyright.split(" (")[0] ?? ""})` : ""}: {f.license},{" "}
              <a href={f.text}>licence text</a>.
            </li>
          ))}
        </ul>
      </Section>

      <Section section={SECTIONS.software}>
        <p>
          Your browser receives parts of {software.length} open-source packages besides the site&apos;s own code, each
          under its own licence, which the site cannot change. The list is made from the site&apos;s production bundle
          whenever it is built (nothing in it is kept by hand); each licence text is published beside the site&apos;s
          files.
        </p>
        <Wide label="The packages in the code your browser receives">
          <table className="doc__table">
            <caption>The packages in the code your browser receives</caption>
            <thead>
              <tr>
                <th scope="col">Package</th>
                <th scope="col">Version</th>
                <th scope="col">Licence</th>
                <th scope="col">Copyright</th>
              </tr>
            </thead>
            <tbody>
              {software.map((p) => (
                <tr key={p.name}>
                  <th scope="row">
                    <a href={p.url}>{p.name}</a>
                  </th>
                  <td>
                    <Mono>{p.version}</Mono>
                  </td>
                  <td>
                    <a href={p.text}>{p.license}</a>
                  </td>
                  <td>{p.copyright.replace(/^Copyright\s*(\(c\)|©)?\s*/i, "") || "In its licence text"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Wide>
      </Section>

      <Section section={SECTIONS.data}>
        <p>
          IDTrack&apos;s graphs are built from Ensembl&apos;s releases and the external databases Ensembl
          cross-references (<a href={docs.sources.source}>IDTrack&apos;s data sources</a>). Facts such as which id
          followed which, or which symbol names a gene, are reused under the terms of their source, as each states them
          (read on {writtenDate(TERMS_READ, "en")}):
        </p>
        <Wide label="The sources of the graphs' data and their terms">
          <table className="doc__table">
            <caption>The sources of the graphs&apos; data and their terms</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">What it gives</th>
                <th scope="col">Terms, in its own words</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.name}>
                  <th scope="row">{r.url ? <a href={r.url}>{r.name}</a> : r.name}</th>
                  <td>{r.what}</td>
                  <td>
                    {r.terms ? (
                      <>
                        <strong>{r.terms.rule}</strong>: “{r.terms.quote}” (<a href={r.terms.url}>its terms</a>)
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Wide>
        <p>
          Where a source asks for credit, give it with the data you reuse; the answers of this site name the database of
          every identifier they give.
        </p>
      </Section>

      <Section section={SECTIONS.cite}>
        <p>If you use IDTrack in your research, cite it as its documentation asks:</p>
        <pre className="doc__code" role="region" aria-label="The citation of IDTrack in BibTeX" tabIndex={0}>
          <code>{docs.citation.bibtex}</code>
        </pre>
        <p>
          <CopyButton text={docs.citation.bibtex} label="Copy the citation" what="The citation of IDTrack" />
        </p>
        <p className="doc__meta">
          {docs.citation.note.replace(/`([^`]+)`/g, "$1")} The <Link to="/method">Method</Link> page cites the method of
          every answer.
        </p>
      </Section>
    </Doc>
  );
}
