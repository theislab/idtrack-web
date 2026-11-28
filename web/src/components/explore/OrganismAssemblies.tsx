// An organism's assemblies on its release axis (its page's first figure): each assembly one row, its name written
// once, at its bar; the row is the expandable row of the assembly (a press opens what it serves and holds, the change
// from the assembly before it and its external databases). Drawn in the hairlines of the home's picture: the graph's
// releases a hairline, the releases at which the graph holds data of the assembly a stronger hairline, the releases it
// serves a 6 px rule, a diamond where it takes over from the assembly before (filled where Ensembl publishes a mapping
// of the two, open where it publishes none). One release axis under the rows. Every value is the api's.
import type { AssemblyDescription, GraphDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { MAPPING_WORDS, type Handoff } from "../../lib/explore/handoffs";
import { namePlace } from "../../lib/explore/names";
import { runs } from "../../lib/explore/runs";
import { releaseRanges } from "../../lib/numbers";
import { ReleaseTicks } from "../figure/axis";
import { textWidth } from "../figure/labels";
import { releaseScale, type ReleaseScale } from "../figure/releases";
import { useWidth } from "../figure/useWidth";
import { Expandable } from "../v2/Expandable";
import { Absent, Mono } from "../ui";

/** The strip's height, the y of its rule and the baseline of its name above the rule. */
const STRIP = 34;
const RULE_Y = 24;
const NAME_Y = 13;
/** The size of an assembly's name. */
const NAME_SIZE = 11.5;

function Strip({
  a,
  releases,
  handoff,
  scaleOf,
}: {
  a: AssemblyDescription;
  releases: readonly number[];
  handoff: Handoff | null;
  scaleOf: (width: number) => ReleaseScale;
}) {
  const { ref, width } = useWidth<HTMLSpanElement>(600);
  const scale = scaleOf(width);
  const name = a.name ?? String(a.assembly);
  const serves = runs(a.serves);
  const held = runs(a.releases);
  const span = serves.length ? serves : held;
  const x0 = scale.x((span[0]?.[0] ?? releases[0] ?? 0) - 0.5);
  const x1 = scale.x((span[span.length - 1]?.[1] ?? releases[0] ?? 0) + 0.5);
  const place = namePlace(textWidth(name, NAME_SIZE, "mono") + 2, x0, x1, width);
  return (
    <span className="astrip" ref={ref}>
      <svg width={width} height={STRIP} aria-hidden="true" focusable="false" className="astrip__svg">
        <line
          x1={scale.x0 - scale.step / 2}
          x2={scale.x1 + scale.step / 2}
          y1={RULE_Y}
          y2={RULE_Y}
          className="astrip__track"
        />
        {held.map(([p, q]) => (
          <line
            key={`h${p}`}
            x1={scale.x(p - 0.5)}
            x2={scale.x(q + 0.5)}
            y1={RULE_Y}
            y2={RULE_Y}
            className="astrip__held"
          />
        ))}
        {serves.map(([p, q]) => (
          <rect
            key={`s${p}`}
            x={scale.x(p - 0.5) + 1}
            y={RULE_Y - 3}
            width={Math.max(2, scale.x(q + 0.5) - scale.x(p - 0.5) - 2)}
            height={6}
            rx={3}
            className="astrip__serve"
          />
        ))}
        {handoff ? (
          <path
            d={`M${scale.x(handoff.release - 0.5)},${RULE_Y - 6} l5,6 l-5,6 l-5,-6 Z`}
            className={`arows__handoff arows__handoff--${handoff.mapping}`}
          />
        ) : null}
        <text x={place.x} y={NAME_Y} textAnchor={place.anchor} className="astrip__name">
          {name}
        </text>
      </svg>
    </span>
  );
}

export function OrganismAssemblies({
  description: d,
  assemblies,
  handoffs,
}: {
  description: GraphDescription;
  /** The assemblies in the order they serve releases. */
  assemblies: AssemblyDescription[];
  handoffs: Handoff[];
}) {
  const releases = d.releases;
  const scaleOf = (width: number) => releaseScale(releases, 6, width - 6);
  const { ref: axisRef, width: axisWidth } = useWidth<HTMLSpanElement>(600);
  return (
    <div className="astrips" role="region" aria-label="Assemblies">
      {assemblies.map((a) => {
        const h = handoffs.find((x) => x.to.assembly === a.assembly) ?? null;
        const name = a.name ?? String(a.assembly);
        return (
          <Expandable
            key={a.assembly}
            className="astrips__row"
            summary={
              <>
                <span className="visually-hidden">
                  {name}, {a.serves.length ? `serves releases ${releaseRanges(a.serves)}` : "serves no release"}
                </span>
                <Strip a={a} releases={releases} handoff={h} scaleOf={scaleOf} />
              </>
            }
            meta={a.assembly === d.primary_assembly ? <span className="tag">primary</span> : undefined}
          >
            <dl className="assembly-row__facts">
              <div>
                <dt>Key in IDTrack&apos;s organism table</dt>
                <dd>
                  <Mono>{a.assembly}</Mono>
                </dd>
              </div>
              <div>
                <dt>Serves releases</dt>
                <dd>
                  {a.serves.length ? <Mono>{releaseRanges(a.serves)}</Mono> : <Absent meaning="It serves no release" />}
                </dd>
              </div>
              <div>
                <dt>Holds data at</dt>
                <dd>
                  <Mono>{releaseRanges(a.releases)}</Mono>
                </dd>
              </div>
              <div>
                <dt>From the assembly before</dt>
                <dd>
                  {h ? (
                    <>
                      {h.from.name} at release <Mono>{h.release}</Mono>: {MAPPING_WORDS[h.mapping]}
                    </>
                  ) : (
                    <Absent meaning="It serves the graph's first releases, or no release" />
                  )}
                </dd>
              </div>
              <div className="assembly-row__wide">
                <dt>External databases ({a.external_databases.length})</dt>
                <dd>
                  <ul className="db-chips">
                    {a.external_databases.map(databaseLabel).map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </Expandable>
        );
      })}
      <div className="astrips__axis" aria-hidden="true">
        <span className="astrips__axis-room" ref={axisRef}>
          <svg width={axisWidth} height={26}>
            <ReleaseTicks scale={scaleOf(axisWidth)} y={2} releases={releases} bounds={[0, axisWidth]} />
          </svg>
        </span>
      </div>
    </div>
  );
}
