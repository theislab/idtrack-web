// A hover card and a popover (DIRECTION.md, "The disclosure components"). The trigger is a button; the card, raised
// above the page, opens on a press (Enter or Space) and, for a hover card, after 350 ms of pointing with a mouse. It
// stays while the pointer is on the trigger or the card and closes 200 ms after the pointer has left both (WCAG
// 1.4.13); Escape closes it from anywhere and keeps the focus where it is; a press outside closes it. A card that would
// pass the window's bottom opens above its trigger, one that would pass its right edge aligns to the trigger's right.
// A card is never the only place of a caution or of the answer. A trigger that does something of its own when pressed
// (an example that fills a form: `onPress`) shows its card on pointing and on focus instead. `Hint` is a field's
// explanation: an (i) beside its label whose card holds the hint (DIRECTION.md, rule 5).
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
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
  onPress,
  describedBy,
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
  /** What a press of the trigger does instead of toggling the card; the card then opens on pointing and on focus. */
  onPress?: () => void;
  /** The id of a text that describes the trigger (read by a screen reader with its name). */
  describedBy?: string;
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
        aria-expanded={onPress ? undefined : open}
        aria-controls={open && !onPress ? `${id}-card` : undefined}
        aria-label={label}
        aria-describedby={describedBy}
        onClick={() => {
          window.clearTimeout(timer.current);
          if (onPress) {
            setOpen(false);
            onPress();
          } else setOpen(!open);
        }}
        {...(onPress
          ? {
              onFocus: (event: ReactFocusEvent<HTMLButtonElement>) => {
                if (event.target.matches(":focus-visible")) later(true, 0);
              },
              onBlur: () => {
                later(false, CLOSE_MS);
              },
            }
          : {})}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={card}
          id={`${id}-card`}
          role={onPress ? undefined : "region"}
          aria-label={onPress ? undefined : label}
          aria-hidden={onPress ? true : undefined}
          className={`hovercard__card${place.above ? " hovercard__card--above" : ""}${place.right ? " hovercard__card--right" : ""}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </span>
  );
}

/** A field's explanation (DIRECTION.md, rule 5): an (i) beside its label, its card holding the hint; the hint is also
 *  the field's description (`descriptionId`, a copy that is never shown), so a screen reader reads it with the field.
 *  The mark is named "Hint" and described by the hint, so that its name never repeats the field's label (a field is
 *  found by its label alone). */
export function Hint({ children, descriptionId }: { children: ReactNode; descriptionId: string }) {
  return (
    <>
      <HoverCard
        trigger={<span className="hint__mark" aria-hidden="true" />}
        label="Hint"
        describedBy={descriptionId}
        className="hint"
        triggerClassName="hint__trigger"
      >
        {children}
      </HoverCard>
      <span id={descriptionId} hidden>
        {children}
      </span>
    </>
  );
}
