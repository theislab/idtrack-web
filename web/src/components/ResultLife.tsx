// The life of an identifier that converts to nothing (`no_conversion`): what it was at the release it is read at, and
// over which releases each gene it named there exists, drawn on the release axis over the assembly bands, with the
// names the external databases gave each gene there. Read from the api alone: the same identifier converted at the
// release it is read at, with its path (each gene's `active` releases and places), and the names of each gene at that
// release (`/names-of`), at most three genes. The end of a gene's life is read from the releases at which it exists,
// as everywhere in the figures; the result's own reason says why nothing is reached at the target release.
import type { ConversionResult, GraphDescription, PathNode } from "../api/types";
import { api } from "../api/client";
import { assemblyNames, assemblyText } from "../lib/pathReading";
import { useRequest } from "../lib/useRequest";
import { Bands, ReleaseTicks } from "./figure/axis";
import { GeneBar, StepGlyph } from "./figure/glyphs";
import { FigureCaption } from "./figure/Legend";
import { assemblyBands, releaseScale } from "./figure/releases";
import { useWidth } from "./figure/useWidth";
import { Mono } from "./ui";

/** The genes of a life drawn at most (an identifier that named more is said by count). */
const LIFE_GENES = 3;

const ROW = 30;
const TOP = 22;

/** A gene's life in words: "62–75" (its releases), with "on" where it is still active at the graph's last release. */
function lifeText(active: PathNode["active"]): string {
  return active.map(([a, b]) => (b === null ? `${a} on` : a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

/** The last release of a gene, where its life ends inside the graph (null: still active). */
function lastOf(active: PathNode["active"]): number | null {
  if (!active.length || active.some(([, b]) => b === null)) return null;
  return Math.max(...active.map(([, b]) => b ?? 0));
}

function Names({ organism, gene, release }: { organism: string; gene: string; release: number }) {
  const names = useRequest(`names-of:${organism}:${gene}:${release}`, (signal, fresh) =>
    api.namesOf(organism, gene, release, { signal, fresh }),
  );
  if (names.state !== "done") return null;
  const matches = names.answer.data.matches.filter((m) => !m.synonym).slice(0, 4);
  if (!matches.length) return <span className="muted">no name in the graph&apos;s databases at {release}</span>;
  return (
    <>
      named{" "}
      {matches.map((m, i) => (
        <span key={`${m.database}|${m.name}`}>
          {i ? ", " : ""}
          <Mono strong>{m.name}</Mono> <span className="muted">({m.database})</span>
        </span>
      ))}
    </>
  );
}

export function RetiredLife({ result, description }: { result: ConversionResult; description: GraphDescription }) {
  const release = result.from_release;
  const read = result.graph_id;
  const organism = description.organism;
  const key = read !== null && release !== null ? `life:${organism}:${read}:${release}` : null;
  const at = useRequest(key, (signal, fresh) =>
    api.convert(
      organism,
      { identifier: read ?? "", from_release: release, to_release: release, explain: true, allow_bridges: false },
      { signal, fresh },
    ),
  );
  const { ref, width } = useWidth<HTMLDivElement>(0);
  if (release === null || read === null) return null;
  if (at.state !== "done") return <div className="life life--waiting" ref={ref} aria-hidden="true" />;
  const answer = at.answer.data;
  const nodes = new Map((answer.path?.nodes ?? []).map((n) => [n.id, n]));
  const genes = [...new Set(answer.candidates.map((c) => c.gene))]
    .map((id) => nodes.get(id))
    .filter((n): n is PathNode => Boolean(n?.active.length));
  if (!genes.length) return <div ref={ref} />;
  const shown = genes.slice(0, LIFE_GENES);
  const names = assemblyNames(description.assemblies);
  const bands = assemblyBands(description);
  const gutter = width >= 640 ? 190 : 0;
  const x0 = gutter + 8;
  const x1 = Math.max(x0 + 40, width - 16);
  const scale = releaseScale(description.releases, x0, x1);
  const rows = shown.length;
  const axisY = TOP + rows * ROW + 6;
  // The release asked is named on a row of its own under the axis, clear of the bands' names and the axis's labels.
  const height = axisY + 50;
  const to = result.to_release;
  return (
    <figure className="life" aria-labelledby={`life-${read}`}>
      <p className="life__words" id={`life-${read}`}>
        At release <Mono>{release}</Mono>, <Mono>{result.query_id}</Mono>{" "}
        {genes.length === 1 ? "is the gene" : `names ${genes.length} genes`}
        {genes.length > LIFE_GENES ? ` (the first ${LIFE_GENES} drawn)` : ""}:
      </p>
      <ul className="life__genes">
        {shown.map((node) => {
          const last = lastOf(node.active);
          const assemblies = node.assemblies.map((a) => assemblyText(a, names));
          return (
            <li key={node.id}>
              <Mono strong>{node.label}</Mono>, at releases <Mono>{lifeText(node.active)}</Mono>
              {assemblies.length ? ` (${assemblies.join(", ")})` : ""}
              {last !== null ? (
                <>
                  ; its last release is <Mono>{last}</Mono>
                </>
              ) : null}
              ; <Names organism={organism} gene={node.id} release={release} />.
            </li>
          );
        })}
      </ul>
      <div className="life__figure fig" ref={ref}>
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`The releases at which each gene exists, ${shown.map((n) => `${n.label}: ${lifeText(n.active)}`).join("; ")}; read at ${release}, asked at ${to}.`}
          >
            <Bands bands={bands} scale={scale} top={0} bottom={axisY} labelY={13} />
            {shown.map((node, i) => {
              const y = TOP + i * ROW + ROW / 2;
              const last = lastOf(node.active);
              return (
                <g key={node.id}>
                  {gutter ? (
                    <text className="fig-text life__label" x={gutter} y={y + 4} textAnchor="end">
                      {node.label}
                    </text>
                  ) : null}
                  {node.active.map(([a, b], j) => (
                    <GeneBar key={j} x0={scale.x(a - 0.5) + 1} x1={scale.x((b ?? scale.last) + 0.5) - 1} y={y} />
                  ))}
                  {last !== null ? (
                    <line
                      className="life__cap"
                      x1={scale.x(last + 0.5)}
                      x2={scale.x(last + 0.5)}
                      y1={y - 8}
                      y2={y + 8}
                    />
                  ) : null}
                  <StepGlyph glyph="form" x={scale.x(release)} y={y} strong />
                </g>
              );
            })}
            <line className="life__target" x1={scale.x(to)} x2={scale.x(to)} y1={TOP - 4} y2={axisY + 32} />
            <text
              className="fig-text life__target-label"
              x={scale.x(to)}
              y={axisY + 44}
              textAnchor={scale.x(to) > width / 2 ? "end" : "start"}
            >
              asked: {to}, no gene
            </text>
            <ReleaseTicks scale={scale} y={axisY} releases={description.releases} bounds={[0, width]} />
          </svg>
        ) : null}
      </div>
      <FigureCaption>
        Each gene is a bar over the releases at which it exists, its last release capped; the open circle is the release
        the identifier is read at ({release}), the vertical line the release asked ({to}). From the release read,
        Ensembl&apos;s history{result.reasons.includes("no_path_to_target") ? " (and the bridges allowed)" : ""} reaches
        no gene at release {to}. The releases are those of the identifier converted at release {release} with its path
        (each gene&apos;s <Mono>active</Mono> releases); the names, <Mono>/names-of</Mono> at release {release}
        {genes.length > LIFE_GENES ? `; ${genes.length - LIFE_GENES} more genes are in that conversion` : ""}.
      </FigureCaption>
    </figure>
  );
}
