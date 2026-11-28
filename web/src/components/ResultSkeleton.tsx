// The layout of a result while it loads (and while its code loads): the answer panel, the release axis with its
// assembly bands, a table; sized like the result so that nothing jumps when it arrives.
import { useEffect, type ReactNode } from "react";
import { api } from "../api/client";
import type { GraphDescription } from "../api/types";
import { assemblyBands } from "./figure/releases";
import { Skeleton } from "./ui";

export function ResultSkeleton({
  description,
  identifier = null,
  asked = null,
}: {
  description: GraphDescription;
  /** The identifier asked (the verdict's query, drawn where the verdict will draw it). */
  identifier?: string | null;
  /** The settings it was asked with and Edit, as under the verdict's query. */
  asked?: ReactNode;
}) {
  // While the answer is computed, the organism's databases are asked (held for the session): the answer's symbols and
  // evidence need them, and so do not wait for a second round trip after it comes.
  useEffect(() => {
    api.databases(description.organism).catch(() => undefined);
  }, [description.organism]);
  const bands = assemblyBands(description);
  const total = description.releases.length || 1;
  return (
    <div className="result result--loading" aria-label="Converting">
      <p className="visually-hidden">Converting…</p>
      <div className="figure-panel skeleton-panel skeleton-panel--verdict">
        {identifier ? (
          <div className="skeleton-panel__flow">
            <div className="answer__from">
              <p className="answer__label">Query</p>
              <p className="answer__query-id">
                <span className="mono">
                  <bdi>{identifier}</bdi>
                </span>
              </p>
              {asked}
            </div>
            <Skeleton width="12%" height={2} />
            <Skeleton width="38%" height={36} />
          </div>
        ) : (
          <div className="skeleton-panel__flow">
            <Skeleton width="30%" height={30} />
            <Skeleton width="12%" height={2} />
            <Skeleton width="38%" height={36} />
          </div>
        )}
        <Skeleton width="50%" height={14} />
        <Skeleton width="70%" height={14} />
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
