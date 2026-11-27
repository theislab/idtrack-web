// Releases as runs of consecutive releases, for drawing.

/** Consecutive releases as [first, last] runs. */
export function runs(releases: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const r of [...releases].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && r === last[1] + 1) last[1] = r;
    else out.push([r, r]);
  }
  return out;
}
