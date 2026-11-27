// The page of an address that is not a page of idtrack: said plainly, with the address as typed, a small drawing in
// the figure grammar (a gene's bar ending in the cap of its last release: nothing follows it), and the way to every
// section of the site.
import "../styles/notfound.css";
import { GeneBar } from "./figure/glyphs";
import { Link, Mono } from "./ui";

const SECTIONS: [string, string, string][] = [
  ["/", "Convert", "One identifier, to another release or database, with the path that led to its answer."],
  ["/batch", "Batch", "A list of identifiers at once, with every answer and a table to export."],
  ["/names", "Names", "Every gene a name or a symbol has been attached to, release by release."],
  ["/organisms", "Explore", "The graphs this server holds: their releases, assemblies and databases."],
  ["/developers", "API", "The http api: every endpoint, its parameters and answers, and a console."],
  ["/method", "Method", "How idtrack reads, walks, ranks and answers, in idtrack's own words."],
];

export function NotFound({ path }: { path: string }) {
  return (
    <div className="page notfound">
      <header className="page-head notfound__head">
        <p className="eyebrow">Not a page of idtrack</p>
        <h1>No such page</h1>
        <p className="lede">
          The address <Mono>{path}</Mono> leads to no page of this site. Every page is listed below.
        </p>
      </header>
      <svg className="notfound__figure fig" viewBox="0 0 320 40" aria-hidden="true" focusable="false">
        <GeneBar x0={4} x1={196} y={20} />
        <line className="notfound__cap" x1={200} x2={200} y1={10} y2={30} />
        <line className="notfound__after" x1={208} x2={316} y1={20} y2={20} />
      </svg>
      <ul className="notfound__sections">
        {SECTIONS.map(([to, name, what]) => (
          <li key={to}>
            <Link to={to} className="notfound__link">
              {name}
            </Link>
            <p>{what}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
