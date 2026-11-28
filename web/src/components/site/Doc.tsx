// The site's own pages (the legal notice, privacy, licences, accessibility) as one kind of document: a calm head (the
// title, one sentence, the date the page was last read against its sources and the page in its other language), then
// sections in one column of good measure, with a short list of them beside it on a wide screen. Each page is complete
// in itself and prints as a document (doc.css, "Print").
import "../../styles/doc.css";
import type { ReactNode } from "react";
import { writtenDate } from "../../lib/site/dates";
import { Link } from "../ui";

export interface DocSection {
  id: string;
  title: string;
}

/** The head of a document, in every page's composition (the eyebrow, the title, the lede): then when it was updated,
 *  and the page in its other language. */
export function DocHead({
  title,
  lede,
  updated,
  lang = "en",
  other,
}: {
  title: string;
  lede: ReactNode;
  /** The day the page was last read against its sources (ISO). */
  updated: string;
  lang?: "en" | "de";
  /** The same page in the other language. */
  other?: { to: string; lang: "en" | "de" };
}) {
  return (
    <header className="page-head doc__head">
      <p className="eyebrow">{lang === "de" ? "Über diese Website" : "About this site"}</p>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
      <p className="doc__meta">
        {lang === "de" ? "Stand" : "Updated"} <time dateTime={updated}>{writtenDate(updated, lang)}</time>
        {other ? (
          <>
            <span aria-hidden="true"> · </span>
            <Link to={other.to} className="doc__other">
              <span lang={other.lang}>{other.lang === "de" ? "Deutsch" : "English"}</span>
            </Link>
          </>
        ) : null}
      </p>
    </header>
  );
}

/** A document: its head, its sections (each a `section` whose heading's id is in `sections`), and the list of them. */
export function Doc({
  head,
  sections,
  lang = "en",
  className = "",
  children,
}: {
  head: ReactNode;
  sections: DocSection[];
  lang?: "en" | "de";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`page doc ${className}`} lang={lang === "en" ? undefined : lang}>
      {head}
      <div className="doc__body">
        <nav className="doc__contents" aria-label={lang === "de" ? "Auf dieser Seite" : "On this page"}>
          <p className="doc__contents-title" aria-hidden="true">
            {lang === "de" ? "Auf dieser Seite" : "On this page"}
          </p>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="doc__text">{children}</div>
      </div>
    </div>
  );
}

/** One section of a document, under its heading. */
export function Section({ section, children }: { section: DocSection; children: ReactNode }) {
  return (
    <section className="doc__section" aria-labelledby={section.id}>
      <h2 id={section.id}>{section.title}</h2>
      {children}
    </section>
  );
}

/** Facts as a list of terms and values (an address, a register number). */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="doc__facts">
      {items.map(([term, value], i) => (
        // The facts of one list are fixed: their order is their identity.
        <div key={i}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An address written as one block, line by line. */
export function Address({ lines }: { lines: ReactNode[] }) {
  return (
    <address className="doc__address">
      {lines.map((line, i) => (
        // The lines of an address are fixed: their order is their identity.
        <span key={i}>{line}</span>
      ))}
    </address>
  );
}

/** A table that may be wider than a phone: a region that scrolls sideways, which a keyboard can reach and scroll. */
export function Wide({ label, children }: { label: string; children: ReactNode }) {
  return (
    // A region that scrolls is a stop of the Tab key, so that a keyboard can scroll it (WCAG 2.1.1).
    <div className="doc__scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
