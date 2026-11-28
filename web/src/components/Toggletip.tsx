// A term that explains itself on a press: a button styled as its text, which opens a small card under it (on a tap, a
// click, Enter or Space) and closes on a second press, Escape, or a press outside. Pointing at it with a mouse opens
// it too, so a definition is never hover-only and never touch-less. The card is the button's description while open.
// WCAG 1.4.13: a card opened by pointing stays while the pointer crosses to it and rests on it (it closes a moment
// after the pointer has left both), Escape closes a shown card from anywhere without moving focus or the pointer, and
// a card that would pass the window's bottom opens above its term.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** How long a card opened by pointing stays after the pointer leaves the term and the card. */
const LEAVE_MS = 200;

export function Toggletip({
  children,
  tip,
  className = "",
  label,
  hover: opensOnHover = true,
}: {
  /** The term as shown. */
  children: ReactNode;
  /** What the card says. */
  tip: ReactNode;
  className?: string;
  /** The button's accessible name where its text alone does not say it. */
  label?: string;
  /** Pointing with a mouse opens the card too (a definition); off for a menu of actions, opened by a press only. */
  hover?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const shown = open || hover;
  const leaving = useRef<number | null>(null);
  const stay = () => {
    if (leaving.current !== null) window.clearTimeout(leaving.current);
    leaving.current = null;
  };
  useEffect(() => stay, []);

  // Escape closes a shown card wherever focus is (a card opened by pointing has no focus of its own).
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setHover(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  // Keep the card inside the window: moved left by what would pass its right edge (16 px kept free). Set on the
  // element itself, measured once it is drawn; its box itself moves (not a transform, which leaves the box where it was
  // and so widens the page by what the card would pass).
  useLayoutEffect(() => {
    const element = card.current;
    if (!shown || !element) return;
    element.style.left = "";
    element.style.right = "";
    element.style.top = "";
    element.style.bottom = "";
    const box = element.getBoundingClientRect();
    const room = document.documentElement.clientWidth - 16;
    const over = box.right - room;
    if (over > 0) {
      element.style.left = `${element.offsetLeft - Math.min(over, Math.max(0, box.left - 16))}px`;
      element.style.right = "auto";
    }
    // Past the window's bottom, and with more room above the term than below it: the card opens above.
    const term = root.current?.getBoundingClientRect();
    if (term && box.bottom > window.innerHeight - 8 && term.top > window.innerHeight - term.bottom) {
      element.style.top = "auto";
      element.style.bottom = "100%";
    }
  }, [shown]);

  return (
    <span
      className={`toggletip ${shown ? "is-open" : ""} ${className}`}
      ref={root}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        stay();
        if (opensOnHover) setHover(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        stay();
        leaving.current = window.setTimeout(() => {
          leaving.current = null;
          setHover(false);
        }, LEAVE_MS);
      }}
    >
      <button
        type="button"
        className="toggletip__term"
        aria-expanded={open}
        aria-describedby={shown ? id : undefined}
        aria-label={label}
        onClick={() => {
          setOpen((o) => !o);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && shown) {
            // Closed here; not passed on, so that a dialog around the term stays open.
            event.stopPropagation();
            setOpen(false);
            setHover(false);
          }
        }}
      >
        {children}
      </button>
      {shown ? (
        <span className="toggletip__card" id={id} ref={card}>
          {tip}
        </span>
      ) : null}
    </span>
  );
}
