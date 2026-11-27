// The layout of the places' drawing of an answer ("Where the genes of the chosen path lie", components/ResultReading.tsx):
// each row in bands of its own, so that no label is drawn over a bar.

/** One row of the places' drawing: an assembly and a sequence region, with every distinct span of the path's genes on
 *  it (identical spans of consecutive versions drawn once, named by their versions). */
export interface PlaceRow {
  assembly: number;
  region: string;
  reference: boolean;
  spans: { start: number; end: number; strand: number; genes: string[] }[];
}

/** The vertical rhythm of the places' drawing: each row is its name (above, on a narrow figure), one lane per distinct
 *  span (the span's versions written over its bar), the row's axis under the last lane, and the first and last base
 *  written under the axis. No label shares a band with a bar, so none can be drawn over one. */
const PLACE = { name: 16, lane: 22, label: 9, axisGap: 6, bases: 16, gap: 14 } as const;

interface PlaceRowLayout {
  row: PlaceRow;
  top: number;
  /** The y of each span's bar, in the row's order of spans. */
  bars: number[];
  axis: number;
  bases: number;
  height: number;
}

/** Each row's bands, top to bottom: (its name), its lanes, its axis, its bases. */
export function placeLayout(rows: readonly PlaceRow[], named: boolean): { rows: PlaceRowLayout[]; height: number } {
  let y = 2;
  const out = rows.map((row) => {
    const top = y;
    const first = top + (named ? PLACE.name + (row.reference ? 0 : 12) : 0) + PLACE.label + 4;
    const bars = row.spans.map((_, i) => first + i * PLACE.lane);
    const axis = (bars[bars.length - 1] ?? first) + 3 + PLACE.axisGap;
    const bases = axis + PLACE.bases - 4;
    const height = axis + PLACE.bases - top;
    y = top + height + PLACE.gap;
    return { row, top, bars, axis, bases, height };
  });
  return { rows: out, height: Math.max(0, y - PLACE.gap + 2) };
}
