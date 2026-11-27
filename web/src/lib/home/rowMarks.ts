// Where a row's start and end marks stand so that no two marks of the row touch (DESIGN.md, "The Convert page before a
// conversion"). A journey often starts on a step: read at 59, merged at 59→60, the open circle of the release read and
// the dot of the merge half a release apart would merge into one shape. The rule: the marks of the steps stand where
// their releases put them; the start mark (and likewise the end mark) is moved outward, away from the line, until it
// clears every step's glyph by `clear` pixels, and the line runs on to it. The release read is said in the row's note,
// its accessible name and the list.

/** The x of a row's start and end marks, moved outward off the steps' marks (`marks`: their x) they would touch. */
export function clearEnds(
  start: number,
  end: number,
  marks: readonly number[],
  clear: number,
): { start: number; end: number } {
  const forward = end >= start;
  const away = forward ? -1 : 1;
  const move = (x: number, outward: number) => {
    let at = x;
    // Each move can bring the mark near the next step's glyph; marks are few, so the loop ends.
    for (let i = 0; i <= marks.length; i++) {
      const near = marks.filter((m) => Math.abs(m - at) < clear);
      if (!near.length) break;
      at = outward < 0 ? Math.min(...near) - clear : Math.max(...near) + clear;
    }
    return at;
  };
  return { start: move(start, away), end: move(end, -away) };
}
