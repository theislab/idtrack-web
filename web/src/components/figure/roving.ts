// A figure as one tab stop: the arrow keys move along its elements in reading order, Home and End jump; pointing at an
// element shows the same note as focusing it. The note holds the element's exact values (as the api sent them) and
// sits over the figure without moving anything around it. It can be pointed at itself without vanishing, and Escape
// hides it without moving focus (WCAG 1.4.13): it shows again on the next move of the pointer or of focus.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

/** How long a note stays after the pointer leaves its element, so that the pointer can reach the note. */
const LEAVE_MS = 160;

/** The element under the pointer, kept a moment after the pointer leaves it and while the pointer is on its note. */
export function useHover<K>() {
  const [hover, setHover] = useState<K | null>(null);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const enter = useCallback((key: K) => {
    clear();
    setHover(key);
  }, []);
  const leave = useCallback((key?: K) => {
    clear();
    timer.current = window.setTimeout(() => {
      setHover((h) => (key === undefined || h === key ? null : h));
    }, LEAVE_MS);
  }, []);
  /** Props for the note: the pointer on it keeps it. */
  const note = {
    onPointerEnter: () => {
      clear();
    },
    onPointerLeave: () => {
      leave();
    },
  };
  const drop = useCallback(() => {
    clear();
    setHover(null);
  }, []);
  return { hover, enter, leave, note, drop };
}

/** Escape hides a shown note until the pointer or focus moves again. */
export function useDismiss(shown: boolean) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!shown || dismissed) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [shown, dismissed]);
  const reset = useCallback(() => {
    setDismissed(false);
  }, []);
  return { dismissed, reset };
}

export interface Roving {
  /** The element whose note is shown (focused or pointed at), or null. */
  shown: number | null;
  /** The element in focus (for its ring), or null. */
  focused: number | null;
  /** Props for the element at `index`. */
  bind: (index: number) => {
    tabIndex: number;
    onFocus: () => void;
    onBlur: () => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
    "data-index": number;
  };
  /** Props for the note. */
  note: { onPointerEnter: () => void; onPointerLeave: () => void };
}

/** Roving focus over `count` elements; `columns` makes the arrows move by rows too (a matrix). */
export function useRoving(count: number, container: () => HTMLElement | SVGElement | null, columns = 0): Roving {
  const [current, setCurrent] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);
  const pointer = useHover<number>();
  const visible = pointer.hover ?? focused;
  const dismiss = useDismiss(visible !== null);
  const move = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(count - 1, index));
      setCurrent(next);
      const element = container()?.querySelector<HTMLElement | SVGElement>(`[data-index="${next}"]`);
      element?.focus();
    },
    [count, container],
  );
  const bind = (index: number) => ({
    tabIndex: index === Math.min(current, count - 1) ? 0 : -1,
    "data-index": index,
    onFocus: () => {
      setCurrent(index);
      setFocused(index);
      dismiss.reset();
    },
    onBlur: () => {
      setFocused((f) => (f === index ? null : f));
    },
    onPointerEnter: () => {
      pointer.enter(index);
      dismiss.reset();
    },
    onPointerLeave: () => {
      pointer.leave(index);
    },
    onKeyDown: (event: KeyboardEvent) => {
      const row = columns > 0 ? columns : 1;
      const keys: Record<string, () => void> = {
        ArrowRight: () => {
          move(index + 1);
        },
        ArrowLeft: () => {
          move(index - 1);
        },
        ArrowDown: () => {
          move(index + row);
        },
        ArrowUp: () => {
          move(index - row);
        },
        Home: () => {
          move(0);
        },
        End: () => {
          move(count - 1);
        },
      };
      const action = keys[event.key];
      if (action) {
        event.preventDefault();
        pointer.drop();
        action();
      }
    },
  });
  return { shown: dismiss.dismissed ? null : visible, focused, bind, note: pointer.note };
}
