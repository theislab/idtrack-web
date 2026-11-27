// The floor of the score track (DESIGN.md, "The figure grammar").

/** The floor of the track: 0.9, or the tenth under the lowest score drawn when a score is lower. */
export function scoreFloor(weights: readonly (number | null)[]): number {
  const known = weights.filter((w): w is number => w !== null);
  if (!known.length) return 0.9;
  return Math.max(0, Math.min(0.9, Math.floor(Math.min(...known) * 10) / 10));
}
