// Stage e on a real answer: the last step of a path drawn as what it is, at the target release: the identifier read as
// its gene, then every id of the database asked that idtrack attaches to that gene there, each through the Ensembl
// form that carries it (the gene itself, its transcript, its translation), in columns by form. The best answers are
// filled squares; where several are best on equal evidence the status says tie, as idtrack's result does. Only the
// api's nodes and steps are drawn: the path's `final` steps of every best candidate (`final_path`), and its entry.
import { useMemo } from "react";
import type { ConversionResult } from "../../api/types";
import { answerLayout, FORMS, HEADS, type Column, type Placed } from "../../lib/method/answerLayout";
import { databaseLabel } from "../../lib/databases";
import { useVocabulary } from "../../lib/vocabularyContext";
import { GlyphSwatch, StepGlyph } from "../figure/glyphs";
import { Term } from "../ResultParts";
import { Prose } from "../ui";
import { FigureLegend } from "../figure/Legend";
import { middleCut, textWidth } from "../figure/labels";
import { useWidth } from "../figure/useWidth";

export function AnswerFigure({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  const { ref, width } = useWidth<HTMLDivElement>(900);
  const layout = useMemo(() => answerLayout(result), [result]);
  const phone = width < 640;
  const columns = FORMS.filter((f) => layout.placed.some((p) => p.column === f));
  const rowH = phone ? 40 : 34;
  const top = 34;
  const height = top + layout.rows * rowH + 10;
  const colW = (width - 8) / Math.max(1, columns.length);
  const cx = (c: Column) => 4 + colW * columns.indexOf(c) + 10;
  const cy = (p: Placed) =>
    p.row < 0 ? top + ((layout.rows - 1) * rowH) / 2 + rowH / 2 : top + p.row * rowH + rowH / 2;
  const at = new Map(layout.placed.map((p) => [p.key, p]));
  const room = colW - 24;
  const label = (id: string) => {
    const size = 11;
    if (textWidth(id, size) <= room) return id;
    const chars = Math.floor(room / (textWidth("0", size) || 7.2));
    return middleCut(id, chars) ?? "";
  };
  const glyph = (p: Placed) =>
    p.column === "target" ? "final" : p.column === "read" ? "read" : p.column === "ensembl_gene" ? "identity" : "form";
  const finalDb = result.final_database ?? "ensembl_gene";
  const legend = (
    <FigureLegend
      entries={[
        { key: "read", glyph: "read", text: "The identifier, read through the database that attaches it" },
        { key: "gene", glyph: "identity", text: "The gene it is read as, at the target release" },
        { key: "form", glyph: "form", text: "An Ensembl form of the gene that carries a target" },
        { key: "final", glyph: "final", text: `An id of ${databaseLabel(finalDb)} attached to the gene: an answer` },
      ]}
    />
  );
  const status = (
    <p className="answer-fig__status">
      <span className="label">Status</span>{" "}
      <Term code={result.status} meaning={vocabulary.statuses.get(result.status)} />{" "}
      <span className="muted">
        {layout.rows} {layout.rows === 1 ? "answer" : "answers"} of one gene
        {vocabulary.statuses.get(result.status) ? (
          <>
            : <Prose text={vocabulary.statuses.get(result.status) ?? ""} />
          </>
        ) : null}
      </span>
    </p>
  );
  if (phone) {
    // On a phone the same nodes as a tree: the identifier, its gene, then each target with the forms that carry it.
    const read = layout.placed.find((p) => p.column === "read");
    const gene = layout.placed.find((p) => p.column === "ensembl_gene");
    const chainOf = (row: number) =>
      layout.placed
        .filter((p) => p.row === row && p.column !== "read" && p.column !== "ensembl_gene")
        .sort((x, y) => FORMS.indexOf(x.column) - FORMS.indexOf(y.column));
    return (
      <div className="answer-fig answer-fig--tree" ref={ref}>
        <ul className="answer-tree" aria-label="The last steps of the answer">
          <li>
            {read ? (
              <span className="answer-tree__node">
                <GlyphSwatch glyph="read" /> <span className="mono">{read.id}</span>
              </span>
            ) : null}
            <ul>
              <li>
                {gene ? (
                  <span className="answer-tree__node">
                    <GlyphSwatch glyph="identity" /> <span className="mono">{gene.id}</span>
                  </span>
                ) : null}
                <ul>
                  {Array.from({ length: layout.rows }, (_, row) => (
                    <li key={row} className="answer-tree__chain">
                      {chainOf(row).map((p, i) => (
                        <span key={p.key} className="answer-tree__node">
                          {i ? <span aria-hidden="true">› </span> : null}
                          <GlyphSwatch glyph={glyph(p)} />{" "}
                          <span className={`mono${p.best ? " answer-tree__best" : ""}`}>{p.id}</span>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </li>
        </ul>
        {legend}
        {status}
      </div>
    );
  }
  return (
    <div className="answer-fig" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${result.query_id} read as ${layout.placed.find((p) => p.column === "ensembl_gene")?.id ?? "its gene"} at release ${result.to_release}, then ${layout.rows} ${layout.rows === 1 ? "id" : "ids"} of ${databaseLabel(finalDb)} attached to it: ${layout.placed
          .filter((p) => p.column === "target")
          .map((p) => p.id)
          .join(", ")}${result.status === "tie" ? "; a tie: equal evidence" : ""}.`}
      >
        {columns.map((c) => (
          <text key={c} x={cx(c) - 6} y={14} className="fig-text fig-text--sans answer-fig__head">
            {c === "target" ? databaseLabel(finalDb) : HEADS[c]}
          </text>
        ))}
        {layout.edges.map((e) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          if (!a || !b) return null;
          // From the end of the earlier node's label to just before the later node's glyph: no line under a label.
          const xa = cx(a.column) + 10 + textWidth(label(a.id), 11) + 4;
          const xb = cx(b.column);
          const ya = cy(a);
          const yb = cy(b);
          const mid = (xa + xb) / 2;
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={`M${xa},${ya} C${mid},${ya} ${mid},${yb} ${xb - 7},${yb}`}
              className={`answer-fig__edge${e.step === null ? " answer-fig__edge--entry" : ""}`}
            />
          );
        })}
        {layout.placed.map((p) => (
          <g
            key={p.key}
            className={
              p.column === "target" ? "fig-hue--external" : p.column === "read" ? "fig-hue--external" : "fig-hue--ink"
            }
          >
            <StepGlyph
              glyph={glyph(p)}
              x={cx(p.column)}
              y={cy(p)}
              size={p.column === "ensembl_gene" ? "thin" : "thick"}
              strong
            />
            <text x={cx(p.column) + 10} y={cy(p) + 4} className={`fig-label${p.best ? " fig-label--first" : ""}`}>
              {label(p.id)}
            </text>
          </g>
        ))}
      </svg>
      {legend}
      {status}
    </div>
  );
}
