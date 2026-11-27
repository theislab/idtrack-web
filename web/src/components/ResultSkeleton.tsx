// The layout of a result while it loads (and while its code loads): the answer panel, the release axis with its
// assembly bands, a table; sized like the result so that nothing jumps when it arrives.
import type { GraphDescription } from "../api/types";
import { assemblyBands } from "./figure/releases";
import { Skeleton } from "./ui";

export function ResultSkeleton({ description }: { description: GraphDescription }) {
  const bands = assemblyBands(description);
  const total = description.releases.length || 1;
  return (
    <div className="result result--loading" aria-label="Converting">
      <p className="visually-hidden">Converting…</p>
      <div className="figure-panel skeleton-panel">
        <Skeleton width="18%" height={12} />
        <div className="skeleton-panel__flow">
          <Skeleton width="30%" height={30} />
          <Skeleton width="12%" height={2} />
          <Skeleton width="38%" height={36} />
        </div>
        <Skeleton width="50%" height={14} />
        <div className="skeleton-panel__stages">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={92} />
          ))}
        </div>
      </div>
      <div className="figure-panel skeleton-panel">
        <Skeleton width="24%" height={12} />
        <div className="skeleton-axis" aria-hidden="true">
          {bands.map((band) => (
            <div
              key={band.assembly}
              className="skeleton-axis__band"
              style={{
                flexGrow: band.last - band.first + 1,
                flexBasis: `${((band.last - band.first + 1) / total) * 100}%`,
              }}
            >
              <span className="skeleton-axis__name">{band.name}</span>
            </div>
          ))}
          <div className="skeleton-axis__track">
            <Skeleton width="55%" height={3} />
            <Skeleton width="35%" height={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
