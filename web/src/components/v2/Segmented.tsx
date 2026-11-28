// A segmented control (DIRECTION.md, "The disclosure components"): two to five views of one thing in a pill track,
// one chosen, its pill sliding to the option chosen. A radio group: the arrow keys move and choose; one tab stop. Wider
// than its room (a phone), it scrolls sideways with the chosen option in view and a fade at each edge with more
// options beyond.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { revealIn, useOverflow } from "./overflow";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name. */
  label: string;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const edges = useOverflow(group, [options.length]);
  // The pill under the chosen option, measured after layout (it slides where motion is allowed).
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const row = group.current;
    const checked = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!row || !checked) return;
    revealIn(row, checked);
    const measure = () => {
      setPill({
        left: checked.offsetLeft,
        top: checked.offsetTop,
        width: checked.offsetWidth,
        height: checked.offsetHeight,
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(checked);
    return () => {
      observer?.disconnect();
    };
  }, [value, options.length]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = options.findIndex((o) => o.value === value);
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div
      className={`segmented${pill ? " segmented--pill" : ""}${edges.start ? " segmented--more-start" : ""}${edges.end ? " segmented--more-end" : ""} ${className}`}
      role="radiogroup"
      aria-label={label}
      ref={group}
    >
      {pill ? <span className="segmented__pill" aria-hidden="true" style={pill} /> : null}
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-value={o.value}
            className="segmented__option"
            onClick={() => {
              onChange(o.value);
            }}
            onKeyDown={onKeyDown}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
