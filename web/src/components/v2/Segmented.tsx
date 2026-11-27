// A segmented control (DIRECTION.md, "The disclosure components"): two to five views of one thing in a pill track,
// one chosen. A radio group: the arrow keys move and choose; one tab stop.
import { useRef, type KeyboardEvent, type ReactNode } from "react";

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
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label} ref={group}>
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
