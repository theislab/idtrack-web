// The release axis and the assembly bands of every SVG figure (DESIGN.md, "The figure grammar"): the bands behind the
// drawing, alternately shaded, each named by one rule (its name and releases, its name, its short name, inside the
// band; else on the row under the names, centred on its band), and the release axis under it (a tick per release where there is room,
// longer every fifth, the first and last release and the round ones labelled where they do not touch).
import { bandRange, labelEvery, shortNames, type Band, type ReleaseScale } from "./releases";
import { FIG_TEXT, placeLabels, type LabelRequest, type PlacedLabel } from "./labels";

/** The assembly bands as columns behind a figure. `labelY`: the baseline of the names inside the bands; `outerY`: the
 *  baseline of a second row of names, for the name of a band that has no room inside (none: such a band is named by its short
 *  name where it fits, and always in the figure's caption). `view`: the extent drawn (a zoomed figure). */
export function Bands({
  bands,
  scale,
  top,
  bottom,
  labels = true,
  labelY,
  outerY,
  view,
}: {
  bands: Band[];
  scale: ReleaseScale;
  top: number;
  bottom: number;
  labels?: boolean;
  labelY?: number;
  outerY?: number;
  view?: [number, number];
}) {
  const [v0, v1] = view ?? [scale.x0, scale.x1];
  const short = shortNames(bands.map((b) => b.name));
  const extent = (band: Band) => {
    const left = scale.x(band.first - 0.5);
    const right = scale.x(band.last + 0.5);
    return { left, right, l: Math.max(left, v0), r: Math.min(right, v1) };
  };
  const inside: LabelRequest[] = bands.map((band) => {
    const { l, r } = extent(band);
    const name = band.name;
    const forms = [`${name} ${bandRange(band)}`, name, short.get(name) ?? name].filter(
      (f, i, all) => all.indexOf(f) === i,
    );
    return {
      key: `${band.assembly}-${band.first}`,
      anchor: l + 6,
      forms,
      align: "start",
      rows: ["in"],
      bounds: [l + 6, r - 4],
    };
  });
  const placedInside = labels ? placeLabels(inside, { bounds: [v0, v1] }) : new Map<string, PlacedLabel>();
  const outside: LabelRequest[] =
    labels && outerY !== undefined
      ? bands
          .filter((band) => !placedInside.has(`${band.assembly}-${band.first}`))
          .map((band) => {
            const { l, r } = extent(band);
            return {
              key: `${band.assembly}-${band.first}`,
              anchor: (l + r) / 2,
              forms: [band.name, short.get(band.name) ?? band.name],
              align: "center" as const,
              rows: ["out"],
            };
          })
          .filter((request) => request.anchor >= v0 && request.anchor <= v1)
      : [];
  const placedOutside = placeLabels(outside, {
    bounds: [v0, v1],
  });
  return (
    <g className="fig-bands" aria-hidden="true">
      {bands.map((band, i) => {
        const { left, right } = extent(band);
        return (
          <g key={`${band.assembly}-${band.first}`}>
            <rect
              x={left}
              y={top}
              width={Math.max(0, right - left)}
              height={bottom - top}
              className={i % 2 ? "fig-band fig-band--b" : "fig-band"}
            />
            {i > 0 ? <line x1={left} x2={left} y1={top} y2={bottom} className="fig-band__edge" /> : null}
          </g>
        );
      })}
      {bands.map((band) => {
        const key = `${band.assembly}-${band.first}`;
        const inner = placedInside.get(key);
        const outer = placedOutside.get(key);
        return (
          <g key={`label-${key}`}>
            {inner ? (
              <text x={inner.x} y={labelY ?? top + 14} className="fig-band__name">
                {inner.text.startsWith(`${band.name} `) ? (
                  <>
                    {band.name}
                    <tspan className="fig-band__range"> {bandRange(band)}</tspan>
                  </>
                ) : (
                  inner.text
                )}
              </text>
            ) : null}
            {outer && outerY !== undefined ? (
              <text x={outer.x} y={outerY} textAnchor={outer.anchor} className="fig-band__name fig-band__name--out">
                {outer.text}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** The release axis: a hairline with a tick per release where there is room, longer every fifth and at a labelled
 *  release; the first and the last release labelled, then the round releases (every tenth, then every fifth) where
 *  they touch no label already placed; every label inside `bounds` (the figure's own box). */
export function ReleaseTicks({
  scale,
  y,
  releases,
  labels = true,
  bounds,
}: {
  scale: ReleaseScale;
  y: number;
  releases: readonly number[];
  labels?: boolean;
  bounds?: [number, number];
}) {
  const every = labelEvery(scale.step);
  const first = releases[0];
  const last = releases[releases.length - 1];
  const box: [number, number] = bounds ?? [scale.x0 - scale.step / 2, scale.x1 + scale.step / 2];
  const requests: LabelRequest[] = [];
  const add = (r: number) =>
    requests.push({ key: String(r), anchor: scale.x(r), forms: [String(r)], align: "center", rows: ["axis"] });
  if (first !== undefined) add(first);
  if (last !== undefined && last !== first) add(last);
  for (const r of releases) if (r % (every * 2) === 0 && r !== first && r !== last) add(r);
  for (const r of releases) if (r % every === 0 && r % (every * 2) !== 0 && r !== first && r !== last) add(r);
  const placed = labels ? placeLabels(requests, { bounds: box, gap: 8 }) : new Map<string, PlacedLabel>();
  return (
    <g className="fig-axis" aria-hidden="true">
      <line x1={scale.x0} x2={scale.x1} y1={y} y2={y} className="fig-axis__line" />
      {releases.map((r) => {
        const major = placed.has(String(r));
        const mid = r % 5 === 0;
        const size = major ? 6 : mid ? 4 : scale.step >= 4 ? 2.5 : 0;
        if (!size) return null;
        return <line key={r} x1={scale.x(r)} x2={scale.x(r)} y1={y} y2={y + size} className="fig-axis__tick" />;
      })}
      {[...placed.values()].map((p) => (
        <text key={p.key} x={p.x} y={y + 8 + FIG_TEXT} textAnchor={p.anchor} className="fig-axis__label">
          {p.text}
        </text>
      ))}
    </g>
  );
}
