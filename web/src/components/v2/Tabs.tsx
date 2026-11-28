// Tabs (DIRECTION.md, "The disclosure components"): a list of tabs, each with a label and an optional quiet count, a
// sliding indicator under the chosen one, and one panel. The arrow keys move between tabs and choose (automatic
// activation), Home and End go to the ends; Tab leaves to the panel. Only the chosen panel is drawn. With `param`,
// the choice is kept in the page's address (`?tab=`), so every view can be linked to and survives a reload; with
// `value`, the page holds the choice (a count that shows its rows chooses the table's tab).
import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { navigate, useLocation } from "../../lib/router";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** A quiet count or word after the label ("2", "7 steps"). */
  count?: ReactNode;
  panel: () => ReactNode;
}

export function Tabs({
  items,
  label,
  param,
  initial,
  className = "",
  onChange,
  value,
}: {
  items: TabItem[];
  /** The tab list's accessible name. */
  label: string;
  /** The address's parameter that keeps the choice; none: the choice is the component's own. */
  param?: string;
  initial?: string;
  className?: string;
  onChange?: (id: string) => void;
  /** The chosen tab, where the page holds the choice (with `onChange`). */
  value?: string;
}) {
  const base = useId().replace(/:/g, "");
  const location = useLocation();
  const fromAddress = param ? location.search.get(param) : null;
  const [own, setOwn] = useState(initial ?? items[0]?.id ?? "");
  const wanted = value ?? (param ? (fromAddress ?? initial ?? items[0]?.id ?? "") : own);
  const chosen = items.some((t) => t.id === wanted) ? wanted : (items[0]?.id ?? "");
  const list = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  const choose = useCallback(
    (id: string) => {
      if (param) {
        const search = new URLSearchParams(window.location.search);
        if (id === (initial ?? items[0]?.id)) search.delete(param);
        else search.set(param, id);
        const text = search.toString();
        navigate(`${window.location.pathname}${text ? `?${text}` : ""}`, { replace: true });
      } else if (value === undefined) setOwn(id);
      onChange?.(id);
    },
    [param, initial, items, onChange, value],
  );

  // The indicator follows the chosen tab (measured after layout; it slides where motion is allowed).
  useLayoutEffect(() => {
    const element = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element) return;
    const measure = () => {
      setBar({ left: element.offsetLeft, width: element.offsetWidth });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
    };
  }, [chosen, items.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = items.findIndex((t) => t.id === chosen);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const id = items[next]?.id;
    if (!id) return;
    choose(id);
    list.current?.querySelector<HTMLElement>(`#${base}-tab-${id}`)?.focus();
  };

  const current = items.find((t) => t.id === chosen);
  return (
    <div className={`tabs ${className}`}>
      <div className="tabs__list" role="tablist" aria-label={label} ref={list}>
        {items.map((t) => {
          const selected = t.id === chosen;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className="tabs__tab"
              onClick={() => {
                choose(t.id);
              }}
              onKeyDown={onKeyDown}
            >
              <span className="tabs__label">{t.label}</span>
              {t.count !== undefined && t.count !== null ? <span className="tabs__count">{t.count}</span> : null}
            </button>
          );
        })}
        {bar ? <span className="tabs__bar" aria-hidden="true" style={{ left: bar.left, width: bar.width }} /> : null}
      </div>
      {current ? (
        <div
          key={current.id}
          role="tabpanel"
          id={`${base}-panel-${current.id}`}
          aria-labelledby={`${base}-tab-${current.id}`}
          className="tabs__panel"
          tabIndex={0}
        >
          {current.panel()}
        </div>
      ) : null}
    </div>
  );
}
