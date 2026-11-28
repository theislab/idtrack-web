// Where a hover card or a popover goes (HoverCard.tsx): below its trigger where it fits, else above, else on the side
// with more room with its own scroll; aligned with the trigger's left, else its right; at least 16 px inside every
// edge of the window, 8 px from its trigger.

/** The least room between a card and every edge of the window, and between a card and its trigger. */
export const EDGE = 16;
const GAP = 8;
/** A side of the trigger with less room than this is no place for a card: it then covers the window's height. */
const LEAST_ROOM = 120;

/** Where a card goes, by the trigger's box and the card's size, in the window's coordinates (the rule above). */
export function placeCard(
  trigger: { left: number; right: number; top: number; bottom: number },
  card: { width: number; height: number },
  window: { width: number; height: number },
): { left: number; top: number; maxHeight: number | null; above: boolean } {
  const below = window.height - trigger.bottom - GAP - EDGE;
  const above = trigger.top - GAP - EDGE;
  let top: number;
  let maxHeight: number | null = null;
  let up = false;
  if (card.height <= below) top = trigger.bottom + GAP;
  else if (card.height <= above) {
    top = trigger.top - GAP - card.height;
    up = true;
  } else if (Math.max(below, above) < LEAST_ROOM) {
    top = EDGE;
    maxHeight = window.height - 2 * EDGE;
  } else if (below >= above) {
    top = trigger.bottom + GAP;
    maxHeight = below;
  } else {
    top = EDGE;
    maxHeight = above;
    up = true;
  }
  // Aligned with the trigger's left; else with its right; then held inside the window's edges.
  let left = trigger.left;
  if (left + card.width > window.width - EDGE) left = trigger.right - card.width;
  left = Math.max(EDGE, Math.min(left, window.width - EDGE - card.width));
  return { left, top, maxHeight, above: up };
}
