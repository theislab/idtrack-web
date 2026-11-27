// The geometry of the Convert page's first figure, which journeys it draws when the room holds fewer than all, and the
// words of its sets. The answers come from the server's showcase of the graph (lib/showcase.ts), one answer for the
// whole figure; nothing is converted on the page.
//
// The figure always names its rows. Where the hero's room cannot hold every journey at a named pitch, it draws fewer
// journeys, chosen by one rule (`chooseJourneys`), never all of them without their names. The assembly bands run from
// their names down to the axis as one column each; each set of journeys stands in them under its words, which are set
// on a halo of the paper so that no band edge or guide crosses them.
import { salience, type JourneySet } from "./journeys";

/** The height of one line of the figure's words (sets, events). */
export const LINE = 15;
/** The least pitch of a row on a wide figure: a pointer's target of 24 px (WCAG 2.5.8), its names beside it. */
export const ROW = 24;
/** The largest pitch a wide figure takes to fill its room (more air stands around the figure instead). */
export const ROW_MAX = 32;
/** The pitch of a row on a narrow figure: its names on a line of paper (14 px) above its track (22 px). */
export const NARROW_ROW = 36;
/** The least width of the plot between the gutters for the names to stand in the gutters (about 6 px a release);
 *  below it each row's names stand above its track. */
export const LEAST_PLOT = 400;

/** The names of the assembly bands: inside the bands, and a second line for a band too narrow for its name. */
const BANDS_HEAD = 34;
/** The axis under the rows. */
const AXIS = 34;
/** Air above a set's words, and under a set's rows. */
const SET_AIR = 6;
const AFTER = 3;
/** The line of the release-wide events: a little air under the bands' names, then the lines. */
const EVENT_LINE = 16;

export interface JourneysLayout {
  /** The rows of each set drawn, in order. */
  sets: readonly number[];
  /** The lines each set's words take (1 where they fit the width; more where they wrap). */
  setLines: readonly number[];
  /** The lines of the release-wide events under the bands' names (0: none drawn). */
  events: number;
  /** Whether each row's names stand above its track (a narrow figure) rather than in the gutters. */
  narrow: boolean;
  /** The widths of the gutters (the longest names and their air), on a wide figure. */
  gutters: [number, number];
  /** The height the figure fills: a wide figure's rows take the pitch that fills it, within ROW and ROW_MAX. */
  fit: number;
}

/** The height of the figure's parts that do not grow with its rows. */
function fixedHeight(sets: number, setLines: readonly number[], events: number): number {
  let h = BANDS_HEAD + (events ? 4 + EVENT_LINE * events : 0) + AXIS;
  for (let s = 0; s < sets; s++) h += SET_AIR + LINE * Math.max(1, setLines[s] ?? 1) + 4 + AFTER;
  return h;
}

/** The figure's geometry for a width. Above the rows, the bands' names (inside a band where it has room, else on a
 *  second line), then the lines of the release-wide events, then each set: its words, its rows; under them the axis. On
 *  a wide figure the names of each row stand in the gutters, the left one beside the start of the line, the right one
 *  beside its end; on a narrow one they stand above the row's track, and each row is a track of its own. */
export function journeysGeometry(layout: JourneysLayout) {
  const rows = layout.sets.reduce((t, n) => t + n, 0);
  const linesOf = (s: number) => Math.max(1, layout.setLines[s] ?? 1);
  const fixed = fixedHeight(layout.sets.length, layout.setLines, layout.events);
  const row = layout.narrow
    ? NARROW_ROW
    : Math.max(ROW, Math.min(ROW_MAX, Math.floor((layout.fit - fixed) / Math.max(1, rows))));
  const eventsRow = layout.events ? 4 + EVENT_LINE * layout.events : 0;
  const head = BANDS_HEAD + eventsRow;
  const left = layout.narrow ? 12 : layout.gutters[0];
  const right = layout.narrow ? 12 : layout.gutters[1];
  /** The paper above a set's rows: air, its words, a little air. */
  const setGap = (s: number) => SET_AIR + LINE * linesOf(s) + 4;
  const setOf: number[] = layout.sets.flatMap((n, s) => Array.from({ length: n }, () => s));
  const firstOf: number[] = [];
  const setTops: number[] = [];
  let y = head;
  let j = 0;
  layout.sets.forEach((n, s) => {
    setTops.push(y);
    firstOf.push(j);
    y += setGap(s) + n * row + AFTER;
    j += n;
  });
  const bottom = y;
  /** The top of a set's words (the air above them included). */
  const setTop = (s: number) => setTops[s] ?? head;
  /** The baseline of a set's first line of words. */
  const setBaseline = (s: number) => setTop(s) + SET_AIR + 11;
  /** The block of a set's rows: from the top of its first row to the bottom of its last. */
  const blockTop = (s: number) => setTop(s) + setGap(s);
  const blockBottom = (s: number) => blockTop(s) + (layout.sets[s] ?? 0) * row;
  /** The top of row k. */
  const rowTop = (k: number) => {
    const s = setOf[k] ?? 0;
    return blockTop(s) + (k - (firstOf[s] ?? 0)) * row;
  };
  /** The y of row k's line (on a narrow figure, in the middle of its track, under its names). */
  const lineY = (k: number) => rowTop(k) + (layout.narrow ? 14 + (row - 14) / 2 : row / 2);
  /** On a narrow figure, the baseline of a row's names. */
  const nameY = (k: number) => rowTop(k) + 11;
  /** The baseline of the n-th line of the release-wide events. */
  const eventY = (line: number) => BANDS_HEAD + 4 + EVENT_LINE * line + 11;
  return {
    narrow: layout.narrow,
    row,
    bandsHead: BANDS_HEAD,
    eventsRow,
    head,
    left,
    right,
    rows,
    height: bottom + AXIS,
    bottom,
    axisY: bottom + 4,
    setTop,
    setBaseline,
    blockTop,
    blockBottom,
    rowTop,
    lineY,
    nameY,
    eventY,
    setOf: (k: number) => setOf[k] ?? 0,
  };
}

/** The least rows a set kept shows: two of its journeys (all, where it has fewer), so that a set reads as a set. */
export const SET_LEAST = 2;

/** The least rows of a set of `size` journeys. */
const leastOf = (size: number) => Math.min(size, SET_LEAST);

/** Shares of `rows` among sets of `sizes`, in proportion to their sizes (largest remainders first), each at least
 *  its least (`SET_LEAST`) and at most its size. */
export function apportion(sizes: readonly number[], rows: number): number[] {
  const total = sizes.reduce((t, n) => t + n, 0);
  if (rows >= total) return [...sizes];
  const quotas = sizes.map((n) => (n * rows) / total);
  const shares = quotas.map((q, s) => Math.min(sizes[s] ?? 0, Math.max(leastOf(sizes[s] ?? 0), Math.floor(q))));
  let left = rows - shares.reduce((t, n) => t + n, 0);
  // Too many (each set's least counted): take back from the sets furthest above their quota.
  while (left < 0) {
    let pick = -1;
    shares.forEach((n, s) => {
      if (
        n > leastOf(sizes[s] ?? 0) &&
        (pick === -1 || n - (quotas[s] ?? 0) > (shares[pick] ?? 0) - (quotas[pick] ?? 0))
      )
        pick = s;
    });
    if (pick === -1) break;
    shares[pick] = (shares[pick] ?? 0) - 1;
    left++;
  }
  // Too few: give to the largest remainders, in order.
  const order = quotas
    .map((q, s) => ({ s, rest: q - Math.floor(q) }))
    .sort((a, b) => b.rest - a.rest || a.s - b.s)
    .map((x) => x.s);
  while (left > 0) {
    const before = left;
    for (const s of order) {
      if (left === 0) break;
      if ((shares[s] ?? 0) < (sizes[s] ?? 0)) {
        shares[s] = (shares[s] ?? 0) + 1;
        left--;
      }
    }
    if (left === before) break;
  }
  return shares;
}

/** The `n` most telling journeys of a set, in the set's own order (by `salience`; the set's order between equals). */
function mostTelling<T extends JourneySet>(set: T, n: number): T {
  const kept = set.journeys
    .map((j, i) => ({ j, i, rank: salience(j) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.j);
  return { ...set, journeys: kept };
}

/** What a figure costs: the part that does not grow with its sets and rows, each set's words, and a row. */
export interface JourneysCost {
  /** The bands' names, the events' lines and the axis. */
  head: number;
  /** The words and air of set s. */
  set: (s: number) => number;
  /** A row at the least pitch. */
  row: number;
}

/** The journeys a figure of `room` pixels draws (DESIGN.md, "The journeys"): every one where they fit at the least
 *  pitch; else the sets in the showcase's order while each can hold its least rows (two, or all of a smaller set), the
 *  rows shared among them in proportion to their sizes, and in each set its most telling journeys (`salience`), in
 *  the set's order. */
export function chooseJourneys<T extends JourneySet>(sets: readonly T[], room: number, cost: JourneysCost): T[] {
  const headOf = (k: number) => {
    let h = cost.head;
    for (let s = 0; s < k; s++) h += cost.set(s);
    return h;
  };
  const leastRows = (k: number) => sets.slice(0, k).reduce((t, s) => t + leastOf(s.journeys.length), 0);
  let k = sets.length;
  while (k > 1 && headOf(k) + leastRows(k) * cost.row > room) k--;
  const kept = sets.slice(0, k);
  const sizes = kept.map((s) => s.journeys.length);
  const total = sizes.reduce((t, n) => t + n, 0);
  const rows = Math.max(leastRows(k), Math.min(total, Math.floor((room - headOf(k)) / cost.row)));
  const shares = apportion(sizes, rows);
  return kept.map((set, s) => mostTelling(set, shares[s] ?? 1));
}

/** The words and air a set's head takes. */
export function setHeight(lines: number): number {
  return SET_AIR + LINE * Math.max(1, lines) + 4 + AFTER;
}

/** The bands' names, `events` lines of release-wide events and the axis. */
export function headHeight(events: number): number {
  return BANDS_HEAD + (events ? 4 + EVENT_LINE * events : 0) + AXIS;
}

/** A set's parameters in words, as a short line with the figure's arrow: what is read, at which release, and what it is
 *  answered as, at which release ("HGNC Symbol at 50 → HGNC Symbol at 115"; the api's defaults named: an Ensembl id read
 *  at the release idtrack infers, an Ensembl gene at the graph's last release); a set whose journeys walk back in time
 *  (`back`) says so. */
export function setWords(
  set: { from: number | null; to: number | null; db: string | null },
  snapshot: number,
  readIn: readonly string[] = [],
  back = false,
): string {
  const what = readIn.length ? readIn.join(" and ") : "Ensembl ids";
  const from = set.from !== null ? `at ${set.from}` : "at the release idtrack infers";
  const to = set.to ?? snapshot;
  const backward = back || (set.from !== null && to < set.from);
  const db = set.db ?? "Ensembl gene";
  return `${what} ${from} → ${backward ? "back to " : ""}${db} at ${to}`;
}
