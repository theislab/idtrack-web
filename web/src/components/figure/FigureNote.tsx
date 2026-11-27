// The note of a figure's element: its exact values, over the figure, without moving anything around it. The pointer
// can move onto it without it vanishing (the figure passes the note's pointer props); Escape hides it.
import type { ReactNode } from "react";

/** The note of an element, placed at (x, y) inside a positioned container, kept within its width. */
export function FigureNote({
  x,
  y,
  width,
  children,
  pointer,
}: {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
  pointer?: { onPointerEnter: () => void; onPointerLeave: () => void };
}) {
  const noteWidth = Math.min(320, width - 8);
  const left = Math.max(4, Math.min(width - noteWidth - 4, x - noteWidth / 2));
  return (
    <div className="fig-note" role="tooltip" style={{ left, top: y, width: noteWidth }} {...pointer}>
      {children}
    </div>
  );
}
