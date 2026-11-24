// A graph's releases as a ruler over its assembly bands (the same axis the path view draws on).
import type { GraphDescription } from "../api/types";
import { assemblyBands } from "../lib/bands";

export function ReleaseRuler({
  description,
  compact = false,
}: {
  description: Pick<GraphDescription, "releases" | "serving_assembly" | "assemblies">;
  compact?: boolean;
}) {
  const bands = assemblyBands(description);
  const releases = description.releases;
  const first = releases[0] ?? 0;
  const last = releases[releases.length - 1] ?? 0;
  const total = last - first + 1 || 1;
  const percent = (r: number) => ((r - first) / total) * 100;
  return (
    <figure className={`ruler ${compact ? "ruler--compact" : ""}`}>
      <div className="ruler__bands">
        {bands.map((band, i) => (
          <div
            key={band.assembly}
            className={`ruler__band ${i % 2 ? "ruler__band--b" : ""}`}
            style={{ left: `${percent(band.first)}%`, width: `${((band.last - band.first + 1) / total) * 100}%` }}
          >
            <span className="ruler__name">{band.name}</span>
            {!compact ? (
              <span className="ruler__range">
                {band.first}–{band.last}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="ruler__ticks" aria-hidden="true">
        {releases.map((r) => (
          <span
            key={r}
            className={`ruler__tick ${r % 10 === 0 ? "ruler__tick--major" : r % 5 === 0 ? "ruler__tick--mid" : ""}`}
            style={{ left: `${percent(r) + 50 / total}%` }}
          >
            {r % 10 === 0 && !compact ? <span className="ruler__label">{r}</span> : null}
          </span>
        ))}
      </div>
      <figcaption className="visually-hidden">
        Releases {first} to {last}, served by {bands.map((b) => `${b.name} (${b.first}–${b.last})`).join(", ")}.
      </figcaption>
    </figure>
  );
}
