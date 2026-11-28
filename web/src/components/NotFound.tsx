// The page of an address that is not a page of IDTrack (served with 404), and the figure every "no such" state shares
// (an address, a graph the server does not hold): in the figure grammar, ids running on through the releases while one
// ends in the cap of its last release, nothing after it. The way back: every section of the site.
import "../styles/notfound.css";
import { GeneBar } from "./figure/glyphs";
import { Link, Mono } from "./ui";

const SECTIONS: [string, string, string][] = [
  ["/convert", "Convert", "One identifier, to another release or database, with the path that led to its answer."],
  ["/batch", "A list", "A list of identifiers at once, with every answer and a table to export."],
  ["/names", "Names", "Every gene a name or a symbol has been attached to, release by release."],
  ["/organisms", "Explore", "The graphs this server holds: their releases, assemblies and databases."],
  ["/developers", "API", "The http api: every endpoint, its parameters and answers, and a console."],
  ["/method", "Method", "How IDTrack reads, walks, ranks and answers, in IDTrack's own words."],
];

/** Four ids through the releases: three run on, the strong one ends (its last release's cap) and nothing follows. */
export function NoSuchFigure() {
  return (
    <svg className="notfound__figure fig" viewBox="0 0 480 88" aria-hidden="true" focusable="false">
      <GeneBar x0={8} x1={472} y={14} size="thin" strong={false} />
      <GeneBar x0={64} x1={472} y={32} size="thin" strong={false} />
      <GeneBar x0={8} x1={276} y={52} />
      <line className="notfound__cap" x1={280} x2={280} y1={42} y2={62} />
      <line className="notfound__after" x1={290} x2={472} y1={52} y2={52} />
      <GeneBar x0={150} x1={472} y={74} size="thin" strong={false} />
    </svg>
  );
}

/** The address as the visitor typed it: its escapes read back (`/gr%C3%B6%C3%9Fe` is `/größe`), where they read. */
function asTyped(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function NotFound({ path }: { path: string }) {
  return (
    <div className="page notfound">
      <header className="page-head notfound__head">
        <p className="eyebrow">Not a page of IDTrack</p>
        <h1>No such page</h1>
        <p className="lede">
          The address <Mono>{asTyped(path)}</Mono> leads to no page of IDTrack. Like an identifier at its last release,
          it ends here; the pages below go on.
        </p>
      </header>
      <NoSuchFigure />
      <nav aria-label="The pages of IDTrack">
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
      </nav>
    </div>
  );
}
