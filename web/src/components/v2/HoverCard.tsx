// A hover card and a popover (DIRECTION.md, "The disclosure components"). The trigger is a button; the card, raised
// above the page, opens on a press (Enter or Space) and, for a hover card, after 350 ms of pointing with a mouse or at
// once on the keyboard's focus. It stays while the pointer is on the trigger or the card and closes 200 ms after the
// pointer (or the focus) has left both (WCAG 1.4.13); Escape closes it from anywhere; a press outside closes it.
//
// One rule places every card, whatever holds its trigger: it is drawn over the page (in the body, or in the dialog
// that holds its trigger), never clipped by a frame that scrolls or folds; it opens below its trigger where it fits,
// else above, else on the side with more room and scrolls inside; it lies at least 16 px inside every edge of the
// window and is never taller than the window less 96 px. A card that closes while it holds the focus gives the focus
// back to its trigger, so a reader never lands on the page's top. Tab from the trigger of an open popover goes into
// its card, and Tab from the card's last control goes on to what follows the trigger.
//
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
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { EDGE, placeCard } from "./placeCard";
import { useExit } from "./useExit";

const OPEN_MS = 350;
const CLOSE_MS = 200;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Give the focus back to a card's trigger, marked for the moment so that this focus opens no card. */
function giveBack(triggerId: string): void {
  const trigger = document.getElementById(triggerId);
  if (!trigger) return;
  trigger.setAttribute("data-given-back", "");
  trigger.focus({ preventScroll: true });
  trigger.removeAttribute("data-given-back");
}

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
  /** The card's family: on the trigger's wrapper and on the card's layer, so a rule `.family .hovercard__card` holds. */
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
  const { shown, closing } = useExit(open);
  const [host, setHost] = useState<Element | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const refocus = useRef(0);
  const triggerId = `${id}-trigger`;
  const cardId = `${id}-card`;
  // Opened: drawn over the page, in the dialog that holds the trigger where one does (a modal's page is inert).
  const setOpen = useCallback(
    (value: boolean) => {
      if (value) setHost(document.getElementById(triggerId)?.closest("dialog") ?? document.body);
      setOpenState(value);
      onOpenChange?.(value);
    },
    [onOpenChange, triggerId],
  );
  const later = (value: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOpen(value);
    }, ms);
  };
  /** Close; a card that holds the focus gives it back to its trigger first (that focus opens no card). */
  const close = useCallback(() => {
    if (document.getElementById(cardId)?.contains(document.activeElement)) giveBack(triggerId);
    setOpen(false);
  }, [setOpen, cardId, triggerId]);
  // A card closed by any way leaves no timer to open it again.
  useEffect(() => {
    if (!open) window.clearTimeout(timer.current);
  }, [open]);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(refocus.current);
    },
    [],
  );
  const inside = (target: EventTarget | null) =>
    target instanceof Node && ((root.current?.contains(target) ?? false) || (card.current?.contains(target) ?? false));
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The card closes, not the dialog that may hold it.
      event.preventDefault();
      close();
    };
    const outside = (event: PointerEvent) => {
      if (inside(event.target)) return;
      const held = Boolean(card.current?.contains(document.activeElement));
      setOpen(false);
      // A press on what takes no focus would leave it on the page's body: it goes back to the trigger.
      if (held)
        refocus.current = window.setTimeout(() => {
          if (document.activeElement === document.body || document.activeElement === null) giveBack(triggerId);
        }, 0);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  });
  // The card's place: measured before it is painted, and again while it is shown when the window scrolls or changes
  // size, or the card's own content does.
  useLayoutEffect(() => {
    if (!shown) return;
    const element = card.current;
    const anchor = button.current;
    if (!element || !anchor) return;
    const place = () => {
      Object.assign(element.style, {
        left: "0px",
        top: "0px",
        right: "auto",
        bottom: "auto",
        maxHeight: "",
        width: "",
        minWidth: "",
      });
      // A card wider than the window's room (a family's own width) takes the room, 16 px inside each edge.
      const room = document.documentElement.clientWidth - 2 * EDGE;
      if (element.offsetWidth > room) Object.assign(element.style, { width: `${room}px`, minWidth: "0px" });
      const at = placeCard(
        anchor.getBoundingClientRect(),
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
      );
      element.style.left = `${at.left}px`;
      element.style.top = `${at.top}px`;
      if (at.maxHeight !== null) element.style.maxHeight = `${at.maxHeight}px`;
      element.classList.toggle("hovercard__card--above", at.above);
    };
    place();
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", again, { capture: true, passive: true });
    window.addEventListener("resize", again);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(again);
    observer?.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", again, { capture: true });
      window.removeEventListener("resize", again);
      observer?.disconnect();
    };
  }, [shown, host]);
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
  // A hover card opens on the keyboard's focus (not on a click's, not on the focus a close gives back), and closes
  // when the focus leaves both the trigger and the card.
  const focusing = hover
    ? {
        onFocus: (event: ReactFocusEvent<HTMLButtonElement>) => {
          if (!event.target.hasAttribute("data-given-back") && event.target.matches(":focus-visible")) later(true, 0);
        },
        onBlur: (event: ReactFocusEvent<HTMLButtonElement>) => {
          if (!inside(event.relatedTarget)) later(false, CLOSE_MS);
        },
      }
    : {};
  const onTriggerKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Tab" || event.shiftKey || !open || onPress) return;
    const first = card.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) return;
    event.preventDefault();
    first.focus();
  };
  const onCardKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !card.current) return;
    const all = [...card.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (event.shiftKey && document.activeElement === all[0]) {
      event.preventDefault();
      giveBack(triggerId);
      setOpen(false);
    } else if (!event.shiftKey && document.activeElement === all[all.length - 1]) {
      // The Tab goes on from the trigger: to what follows it on the page.
      giveBack(triggerId);
      setOpen(false);
    }
  };
  const cardElement = shown ? (
    <div className={`hovercard__layer ${className}`}>
      <div
        ref={card}
        id={cardId}
        role={onPress ? undefined : "region"}
        aria-label={onPress ? undefined : label}
        aria-hidden={onPress ? true : undefined}
        className={`hovercard__card${closing ? " hovercard__card--closing" : ""}`}
        onKeyDown={onCardKey}
        onBlur={(event) => {
          if (hover && !inside(event.relatedTarget)) later(false, CLOSE_MS);
        }}
        {...pointing}
      >
        {typeof children === "function" ? children(close) : children}
      </div>
    </div>
  ) : null;
  return (
    <span className={`hovercard ${className}`} ref={root} {...pointing}>
      <button
        ref={button}
        id={triggerId}
        type="button"
        className={`hovercard__trigger ${triggerClassName}`}
        aria-expanded={onPress ? undefined : open}
        aria-controls={open && !onPress ? cardId : undefined}
        aria-label={label}
        aria-describedby={describedBy}
        onClick={() => {
          window.clearTimeout(timer.current);
          if (onPress) {
            setOpen(false);
            onPress();
          } else setOpen(!open);
        }}
        onKeyDown={onTriggerKey}
        {...focusing}
      >
        {trigger}
      </button>
      {cardElement && host ? createPortal(cardElement, host) : null}
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
