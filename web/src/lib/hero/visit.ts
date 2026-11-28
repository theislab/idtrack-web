// Which visit of the home this is in this browser: a counter kept in the browser (`idtrack-visit`, listed on the
// privacy page), read and moved on once a page load, so that each visit follows the next of the showcase's journeys.
// Where the browser keeps nothing, every visit is the first.
const KEY = "idtrack-visit";

let visit: number | null = null;

/** The number of this visit (0 the first), the same for the whole page load. */
export function visitNumber(): number {
  if (visit !== null) return visit;
  let n = 0;
  try {
    n = Math.max(0, Math.floor(Number(window.localStorage.getItem(KEY) ?? "0")) || 0);
    window.localStorage.setItem(KEY, String(n + 1));
  } catch {
    n = 0;
  }
  visit = n;
  return n;
}
