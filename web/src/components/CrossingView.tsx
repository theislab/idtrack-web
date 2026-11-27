// The path of an answer that holds no step of Ensembl's history: every step at one release, so a time axis would be
// empty. Drawn instead as what did happen: the identifier read through databases at that release, the gene it is
// read as, and the id in the database asked, left to right (top to bottom on a phone), each node with the glyph of the
// figure grammar and each crossing with its databases. The release is named once.
import type { ModelCandidate, ModelNode, ModelStep, PathModel } from "../lib/pathModel";
import { databaseLabel } from "../lib/databases";
import { nodeKindWords } from "../lib/pathReading";
import { GlyphSwatch } from "./figure/glyphs";
import type { Glyph } from "./figure/glyph";
import { IdMenu, SymbolOf, type IdContext } from "./IdMenu";

/** The candidates drawn: the best, at most this many. */
const SHOWN = 4;

function glyphOfNode(node: ModelNode | undefined, last: boolean): Glyph | "gene" {
  if (!node) return "form";
  if (last && node.role === "target") return "final";
  if (node.api.kind === "ensembl_gene") return "gene";
  if (node.api.kind === "external" || node.api.kind === "synonym") return "read";
  return "form";
}

function stepWords(step: ModelStep): string {
  const dbs = step.api.databases.map(databaseLabel).join(", ");
  switch (step.api.kind) {
    case "entry":
      return dbs ? `read as, through ${dbs}` : "read as";
    case "final":
      return dbs ? `its id in ${dbs}` : "its id in the database";
    case "bridge_near":
      return "leaves through an id it carries";
    case "bridge_far":
      return "enters a gene that carries it";
    case "identity":
      return "its own answer";
    default:
      return step.api.kind.replace(/_/g, " ");
  }
}

function Chain({ candidate, model, context }: { candidate: ModelCandidate; model: PathModel; context: IdContext }) {
  const steps = candidate.steps.map((i) => model.steps[i]).filter((s): s is ModelStep => s !== undefined);
  const first = steps[0];
  const nodes: { id: string; via: ModelStep | null }[] = [];
  if (first && first.api.source !== null) nodes.push({ id: first.api.source, via: null });
  for (const step of steps) {
    if (step.api.kind === "identity") {
      if (!nodes.length) nodes.push({ id: step.api.target, via: step });
      continue;
    }
    nodes.push({ id: step.api.target, via: step });
  }
  return (
    <ol className="crossing__chain" aria-label={`Candidate ${candidate.index + 1}`}>
      {nodes.map(({ id, via }, i) => {
        const node = model.nodeById.get(id);
        const last = i === nodes.length - 1;
        return (
          <li key={`${id}|${i}`} className="crossing__station">
            {via && i > 0 ? (
              <span className={`crossing__link crossing__link--${via.hue}`}>
                <span className="crossing__line" aria-hidden="true" />
                <span className="crossing__words">{stepWords(via)}</span>
              </span>
            ) : null}
            <span className={`crossing__node ${last ? "crossing__node--answer" : ""}`}>
              <GlyphSwatch glyph={glyphOfNode(node, last)} />
              <span className="crossing__id">
                <IdMenu id={node?.label ?? id} release={model.result.to_release} context={context} strong={last} />
                {node?.api.kind === "ensembl_gene" ? (
                  <>
                    {" "}
                    <SymbolOf gene={id} context={context} />
                  </>
                ) : null}
              </span>
              <span className="crossing__kind">
                {last && node?.role === "target"
                  ? `${databaseLabel(context.finalDatabase ?? "ensembl_gene")}: the answer`
                  : node?.api.kind === "external" || node?.api.kind === "synonym"
                    ? node.api.databases.slice(0, 2).map(databaseLabel).join(", ") || nodeKindWords(node.api.kind)
                    : nodeKindWords(node?.api.kind ?? "")}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CrossingView({
  model,
  release,
  readingId,
  context,
}: {
  model: PathModel;
  release: number;
  readingId: string;
  context: IdContext;
}) {
  const bests = model.candidates.filter((c) => c.best);
  const shown = bests.slice(0, SHOWN);
  const rest = model.candidates.length - shown.length;
  return (
    <div
      className="crossing fig"
      role="group"
      aria-label={`The reading at release ${release}`}
      aria-describedby={readingId}
    >
      <p className="crossing__release">
        <span className="eyebrow">Release</span> <span className="mono">{release}</span>{" "}
        <span className="muted">every step holds here: no step of Ensembl&apos;s history</span>
      </p>
      {shown.map((candidate) => (
        <Chain key={candidate.index} candidate={candidate} model={model} context={context} />
      ))}
      {rest > 0 ? (
        <p className="crossing__more muted">
          and {rest} more candidate{rest === 1 ? "" : "s"}, each listed in the decision (panel d).
        </p>
      ) : null}
    </div>
  );
}
