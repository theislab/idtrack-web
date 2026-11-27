// The geometry of the Convert page's first figure and the words of its sets. The answers come from the server's
// showcase of the graph (lib/showcase.ts), one answer for the whole figure; nothing is converted on the page.
//
// Each set of journeys is a block of its own: its words on a line of paper above it, then its rows over the assembly
// bands. No band, guide or line of a row crosses the words of a set, and no line runs from one set into another.
import type { JourneySet } from "./journeys";

export interface JourneysLayout {
  /** The sets' sizes, in order. */
  sets: readonly number[];
  /** The lines each set's words take (1 where they fit the width; more where they wrap). */
  setLines?: readonly number[];
  /** The lines of the release-wide events under the bands' names (0: none drawn). */
  events: number;
  /** On a wide screen, the widths of the gutters' longest texts (measured by the figure's label placer). */
  gutters?: [number, number];
  /** The height the figure must fit (the hero): the rows' pitch is chosen to fill it, within bounds. */
  fit?: number;
}

export function layoutOf(
  sets: readonly JourneySet[],
  events: number,
  gutters?: [number, number],
  setLines?: readonly number[],
  fit?: number,
): JourneysLayout {
  return {
    sets: sets.map((s) => s.journeys.length),
    events,
    ...(gutters ? { gutters } : {}),
    ...(setLines ? { setLines } : {}),
    ...(fit !== undefined ? { fit } : {}),
  };
}

/** The least pitch of a row whose names stand in the gutters (a name is 11 px high); below it a figure that must fit
 *  its height is drawn as a still image of its lines, the names left to its text alternative. */
export const LEAST_NAMED_ROW = 14;

/** Below this width a figure that fits a height is a still image (a phone's hero). */
export const STILL_FIGURE = 560;
/** The pitch of a row in a still image: its glyphs never touch the next row's. */
const STILL_ROW = 12;

/** The sets a still image of `height` holds whole, in order, at STILL_ROW (at least the first). */
export function setsThatFit<T extends { journeys: readonly unknown[] }>(sets: readonly T[], height: number): T[] {
  const room = height - 34 - 34;
  const kept: T[] = [];
  let used = 0;
  for (const set of sets) {
    const need = 5 + 6 + set.journeys.length * STILL_ROW;
    if (kept.length && used + need > room) break;
    kept.push(set);
    used += need;
  }
  return kept;
}

/** Below this width the figure is a phone's: each row's names stand on a line of paper above its track. */
export const PHONE_FIGURE = 760;
/** The height of one line of the figure's words (sets, events). */
export const LINE = 15;

/** The figure's geometry for a width. On a wide screen the names of each row stand in the gutters, the left one beside
 *  the start of the line, the right one beside its end; on a phone they stand above the row's track, and each row is a
 *  track of its own over the bands. Above the rows, two lines for the names of the assembly bands (inside a band where
 *  it has room, else above it), then the lines of the release-wide events, then each set: its words, its rows. */
export function journeysGeometry(width: number, layout: JourneysLayout) {
  const rows = layout.sets.reduce((t, n) => t + n, 0);
  const bandsHead = 34;
  const linesOf = (s: number) => Math.max(1, layout.setLines?.[s] ?? 1);
  const fitting = layout.fit !== undefined;
  const axis = 34;
  const fixedOf = (gap: (s: number) => number, head: number) =>
    head + layout.sets.reduce((t, _, s) => t + gap(s) + 6, 0) + axis;
  const eventsHead = layout.events ? 8 + LINE * layout.events : 0;
  const namedGap = (s: number) => (fitting ? 8 : 12) + LINE * linesOf(s);
  // A figure that fits a height (the hero) takes the pitch that fills it, its names in the gutters, down to
  // LEAST_NAMED_ROW; below that, and on a phone always, it is a still image of its lines: no names, no words of the
  // sets or the events (the caption and the text alternative say them), the sets a few pixels apart.
  const fitted = fitting
    ? Math.floor(((layout.fit ?? 0) - fixedOf(namedGap, bandsHead + eventsHead)) / Math.max(1, rows))
    : 0;
  const still = fitting && (width < STILL_FIGURE || fitted < LEAST_NAMED_ROW);
  const phone = !fitting && width < PHONE_FIGURE;
  const eventsRow = still ? 0 : eventsHead;
  const head = bandsHead + eventsRow;
  /** The paper above a set: its words and a little air (in a still image, the air alone). */
  const setGap = (s: number) => (still ? 5 : namedGap(s));
  const stillPitch = fitting ? Math.floor(((layout.fit ?? 0) - fixedOf(setGap, head)) / Math.max(1, rows)) : 0;
  /** A row: on a phone a line of names (14 px) over a track (20 px); in a fitted figure the pitch that fills it. */
  const row = still
    ? Math.max(8, Math.min(STILL_ROW + 2, stillPitch))
    : fitting
      ? Math.max(LEAST_NAMED_ROW, Math.min(22, fitted))
      : phone
        ? 36
        : 22;
  /** Air under a set's block. */
  const after = phone ? 4 : 6;
  // The gutters hold their longest text and 14 px, between 96 and 300 px.
  const fit = (w: number | undefined) => Math.min(300, Math.max(96, Math.ceil((w ?? 162) + 14)));
  // On a phone the names stand above the tracks; the gutters only give the end marks room to stand clear of a step.
  const left = phone || still ? 12 : fit(layout.gutters?.[0]);
  const right = phone || still ? 12 : fit(layout.gutters?.[1]);
  const setOf: number[] = layout.sets.flatMap((n, s) => Array.from({ length: n }, () => s));
  const firstOf: number[] = [];
  const setTops: number[] = [];
  let y = head;
  let j = 0;
  layout.sets.forEach((n, s) => {
    setTops.push(y);
    firstOf.push(j);
    y += setGap(s) + n * row + after;
    j += n;
  });
  const bottom = y;
  /** The top of a set's words. */
  const setTop = (s: number) => setTops[s] ?? head;
  /** The block of a set's rows: from the top of its first row to the bottom of its last. */
  const blockTop = (s: number) => setTop(s) + setGap(s);
  const blockBottom = (s: number) => blockTop(s) + (layout.sets[s] ?? 0) * row;
  /** The top of row j. */
  const rowTop = (k: number) => {
    const s = setOf[k] ?? 0;
    return blockTop(s) + (k - (firstOf[s] ?? 0)) * row;
  };
  /** The y of row j's line (on a phone, in the middle of its track, under its names). */
  const lineY = (k: number) => rowTop(k) + (phone ? 25 : row / 2);
  /** On a phone, the baseline of a row's names. */
  const nameY = (k: number) => rowTop(k) + 11;
  /** On a phone, the track of a row (its band strip). */
  const trackTop = (k: number) => rowTop(k) + 15;
  const trackBottom = (k: number) => rowTop(k) + row;
  const height = bottom + axis;
  return {
    phone,
    still,
    row,
    bandsHead,
    eventsRow,
    head,
    left,
    right,
    rows,
    height,
    axisY: bottom + 4,
    setGap,
    setTop,
    blockTop,
    blockBottom,
    rowTop,
    lineY,
    nameY,
    trackTop,
    trackBottom,
    setOf: (k: number) => setOf[k] ?? 0,
  };
}

/** A set's parameters in words, as parts: the release it is read at (with the databases every journey of the set is
 *  read in), the release asked, the database asked; the api's defaults named (the release idtrack infers, the graph's
 *  last release, an Ensembl gene). */
function setParts(
  set: { from: number | null; to: number | null; db: string | null },
  snapshot: number,
  readIn: readonly string[] = [],
): [string, string] {
  const from = set.from !== null ? `Read at ${set.from}` : "Read at the release idtrack infers";
  const read = readIn.length ? ` in ${readIn.join(" and ")}` : "";
  const back = set.to !== null && set.from !== null && set.to < set.from;
  const db = set.db !== null ? `in ${set.db}` : "as an Ensembl gene";
  return [`${from}${read}`, `answered ${back ? "back " : ""}at ${set.to ?? snapshot} ${db}`];
}

/** A set's parameters in one sentence ("Read at 50 in HGNC Symbol, answered at 115 in HGNC Symbol"). */
export function setWords(
  set: { from: number | null; to: number | null; db: string | null },
  snapshot: number,
  readIn: readonly string[] = [],
): string {
  return setParts(set, snapshot, readIn).join(", ");
}
