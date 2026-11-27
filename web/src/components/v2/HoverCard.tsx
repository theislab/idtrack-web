// A hover card and a popover (DIRECTION.md, "The disclosure components"). The trigger is a button; the card, raised
// above the page, opens on a press (Enter or Space) and, for a hover card, after 350 ms of pointing with a mouse. It
// stays while the pointer is on the trigger or the card and closes 200 ms after the pointer has left both (WCAG
// 1.4.13); Escape closes it from anywhere and keeps the focus where it is; a press outside closes it. A card that would
// pass the window's bottom opens above its trigger, one that would pass its right edge aligns to the trigger's right.
// A card is never the only place of a caution or of the answer.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const OPEN_MS = 350;
const CLOSE_MS = 200;

export function HoverCard({
  trigger,
  label,
  children,
  hover = true,
  className = "",
  triggerClassName = "",
  onOpenChange,
}: {
  /** What the trigger shows. */
  trigger: ReactNode;
  /** The trigger's accessible name, where its content is not words. */
  label?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Open on pointing too (a hover card); false: on a press only (a popover, a menu). */
  hover?: boolean;
  className?: string;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [open, setOpenState] = useState(false);
  const [place, setPlace] = useState<{ above: boolean; right: boolean }>({ above: false, right: false });
  const root = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );
  const later = (value: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOpen(value);
    }, ms);
  };
  const close = useCallback(() => {
    setOpen(false);
  }, [setOpen]);
  // A card closed by any way leaves no timer to open it again.
  useEffect(() => {
    if (!open) window.clearTimeout(timer.current);
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open || !card.current || !root.current) return;
    const r = root.current.getBoundingClientRect();
    const c = card.current.getBoundingClientRect();
    setPlace({
      above: r.bottom + c.height + 12 > window.innerHeight && r.top > c.height + 12,
      right: r.left + c.width + 12 > window.innerWidth,
    });
  }, [open]);
  const pointing = hover
    ? {
        onPointerEnter: (event: ReactPointerEvent) => {
          if (event.pointerType === "mouse") later(true, open ? 0 : OPEN_MS);
        },
        onPointerLeave: (event: ReactPointerEvent) => {
          if (event.pointerType === "mouse") later(false, CLOSE_MS);
        },
      }
    : {};
  return (
    <span className={`hovercard ${className}`} ref={root} {...pointing}>
      <button
        type="button"
        className={`hovercard__trigger ${triggerClassName}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-card` : undefined}
        aria-label={label}
        onClick={() => {
          window.clearTimeout(timer.current);
          setOpen(!open);
        }}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={card}
          id={`${id}-card`}
          role="region"
          aria-label={label}
          className={`hovercard__card${place.above ? " hovercard__card--above" : ""}${place.right ? " hovercard__card--right" : ""}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </span>
  );
}
