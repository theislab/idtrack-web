// A figure's legend and caption (DESIGN.md, "The figure grammar"): the legend beside the graphic it explains, each
// entry the glyph the figure draws; the caption under it in small type, a journal's caption: its letter, what is drawn
// and how to read it, about 75 characters a line (in two columns under a wide figure).
import type { ReactNode } from "react";
import { GlyphSwatch } from "./glyphs";
import type { Glyph } from "./glyph";

export interface LegendEntry {
  key: string;
  glyph?: Glyph | "gene" | "gene-thin" | "cross";
  /** A swatch of the figure's own, where no glyph of the grammar fits (a lane's fill, a hatch). */
  swatch?: ReactNode;
  event?: boolean;
  text: ReactNode;
}

export function FigureLegend({ entries, label = "Legend of the figure" }: { entries: LegendEntry[]; label?: string }) {
  return (
    <ul className="fig-legend" aria-label={label}>
      {entries.map((e) => (
        <li key={e.key}>
          {e.swatch ?? (e.glyph ? <GlyphSwatch glyph={e.glyph} event={e.event ?? false} /> : null)}
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function FigureCaption({
  id,
  letter,
  wide = false,
  className = "",
  children,
}: {
  id?: string;
  letter?: string;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figcaption id={id} className={`fig-caption${wide ? " fig-caption--wide" : ""} ${className}`}>
      {letter ? <strong className="fig-caption__letter">{letter} </strong> : null}
      {children}
    </figcaption>
  );
}
