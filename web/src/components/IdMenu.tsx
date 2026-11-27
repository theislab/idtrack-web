// Every identifier of an answer is a way on: a press opens a small menu of what can be done with it on this site
// (convert it from the release it holds at, read its names there, open it in Convert to choose another database),
// Ensembl's own record of a gene's history, and a copy. The page is a hub, not a dead end. The menu says only what
// a link does; it asks nothing of the api by itself.
import type { ReactNode } from "react";
import { ENSEMBL_GENE, ensemblHistoryHref } from "../lib/answerLinks";
import { convertHref, plainConversion } from "../lib/convertParameters";
import { databaseLabel } from "../lib/databases";
import { href } from "../lib/router";
import type { Symbols } from "../lib/symbols";
import { Toggletip } from "./Toggletip";
import { CopyButton, Link } from "./ui";

/** What a menu needs of the answer it stands in. */
export interface IdContext {
  organism: string;
  /** The answer's target release. */
  toRelease: number;
  /** The database the conversion asked for (`null`: Ensembl genes). */
  finalDatabase: string | null;
  symbols: Symbols | null;
}

const ENSEMBL_ID = /^ENS[A-Z]*[GTP]\d{11}(\.\d+)?$/;

/** The symbol idtrack gives an Ensembl gene at the answer's release (none where it gives none). */
export function SymbolOf({
  gene,
  context,
  except,
  lead = "",
}: {
  gene: string;
  context: IdContext;
  except?: string;
  /** Text set before the symbol where one is shown (a space), and nothing where none is. */
  lead?: string;
}) {
  const symbols = context.symbols?.of.get(gene);
  // A symbol that is the id shown beside it already (an answer in the authority's database) is not said twice.
  if (!symbols?.length || !context.symbols || (except !== undefined && symbols.every((s) => s === except))) return null;
  return (
    <>
      {lead}
      <span className="symbol" title={`${context.symbols.database} at release ${context.symbols.release}`}>
        <span className="visually-hidden">, {context.symbols.database}: </span>
        {symbols.join(" / ")}
      </span>
    </>
  );
}

export function IdMenu({
  id,
  release,
  context,
  children,
  strong = false,
  className = "",
  answer = false,
}: {
  id: string;
  /** The release at which the id holds where it is shown (null: not known). */
  release: number | null;
  context: IdContext;
  /** How the id is shown (default: in the monospaced face). */
  children?: ReactNode;
  strong?: boolean;
  className?: string;
  /** The id is an answer of this conversion (in the database and at the release asked): converting it again there
   *  would give itself, so the menu does not offer it. */
  answer?: boolean;
}) {
  const { organism, toRelease, finalDatabase } = context;
  const gene = ENSEMBL_GENE.test(id) && /\.\d+$/.test(id);
  const ensembl = ENSEMBL_ID.test(id);
  const history = ensemblHistoryHref(organism, id);
  const asked = databaseLabel(finalDatabase ?? "ensembl_gene");
  const at = release ?? toRelease;
  const items: { key: string; node: ReactNode }[] = [];
  if (!answer)
    items.push({
      key: "convert",
      node: (
        <Link to={convertHref(organism, { ...plainConversion(id), fromRelease: release, toRelease, finalDatabase })}>
          Convert it{release !== null ? ` from release ${release}` : ""} to {asked} at {toRelease}
        </Link>
      ),
    });
  items.push({
    key: "database",
    node: (
      <Link to={convertHref(organism, { ...plainConversion(id), fromRelease: at, toRelease: at })}>
        Open it in Convert at release {at}, to choose another database
      </Link>
    ),
  });
  if (gene)
    items.push({
      key: "names",
      node: <Link to={href("/names", { organism, gene: id, release: at })}>Its names at release {at}</Link>,
    });
  else if (!ensembl)
    items.push({
      key: "named",
      node: <Link to={href("/names", { organism, name: id })}>The genes this name names, by release</Link>,
    });
  if (history)
    items.push({
      key: "ensembl",
      node: (
        <a href={history} target="_blank" rel="noreferrer">
          Ensembl&apos;s id history of the gene
          <span className="visually-hidden"> (Ensembl&apos;s site, opens in a new tab)</span>
          <span aria-hidden="true"> ↗</span>
        </a>
      ),
    });
  return (
    <Toggletip
      hover={false}
      className={`idmenu ${className}`}
      label={`${id}: what to do with it`}
      tip={
        <span className="idmenu__card">
          <span className="idmenu__id mono">{id}</span>
          <span className="idmenu__items">
            {items.map((item) => (
              <span key={item.key} className="idmenu__item">
                {item.node}
              </span>
            ))}
            <span className="idmenu__item">
              <CopyButton text={id} label="Copy the id" what={id} />
            </span>
          </span>
        </span>
      }
    >
      {children ?? <span className={`mono ${strong ? "mono--strong" : ""}`}>{id}</span>}
    </Toggletip>
  );
}
