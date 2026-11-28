// Tabs (DIRECTION.md, "The disclosure components"): a list of tabs, each with a label and an optional quiet count, a
// sliding indicator under the chosen one, and one panel. The arrow keys move between tabs and choose (automatic
// activation), Home and End go to the ends; Tab leaves to the panel. Only the chosen panel is drawn, and it follows
// the choice a moment later (a deferred value), so the tab answers at once. With `param`, the choice is kept in the page's address (`?tab=`), so every view can be
// linked to and survives a reload; an address that names a tab other than the first brings the tab list just under
// the masthead, so a shared link shows the view it names. With `value`, the page holds the choice (a count that shows
// its rows chooses the table's tab).
//
// A list wider than its room scrolls sideways and says so: the chosen tab is always brought into view, a fade marks
// each edge with more tabs beyond, and a chevron there moves the list by one tab. On a phone a count shows its number
// alone (its words stay in the tab's name).
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { navigate, useLocation } from "../../lib/router";
import { revealIn, useOverflow } from "./overflow";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** A quiet count or word after the label ("2", "7 steps"). */
  count?: ReactNode;
  panel: () => ReactNode;
}

/** A count's number and its words ("21 steps" -> "21", " steps"), so a phone can show the number alone. */
function countParts(count: ReactNode): { number: ReactNode; words: string } {
  if (typeof count !== "string") return { number: count, words: "" };
  const match = /^([\d\u202f\u00a0,.]+)(\s.+)$/.exec(count);
  return match?.[1] && match[2] ? { number: match[1], words: match[2] } : { number: count, words: "" };
}

const reduced = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Bring a tab list to just under the masthead (its `scroll-margin-top`), and keep it there while what stands above
 *  it is still being drawn, until the reader scrolls, presses or types (at most 3 s). */
function bringUnderMasthead(element: HTMLElement): () => void {
  let stopped = false;
  const place = () => {
    if (!stopped && typeof element.scrollIntoView === "function")
      element.scrollIntoView({ block: "start", behavior: "instant" });
  };
  const frame = requestAnimationFrame(place);
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
  observer?.observe(document.body);
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    for (const event of ["wheel", "touchstart", "keydown", "pointerdown"]) window.removeEventListener(event, stop);
  };
  for (const event of ["wheel", "touchstart", "keydown", "pointerdown"])
    window.addEventListener(event, stop, { passive: true });
  const timer = window.setTimeout(stop, 3000);
  return () => {
    window.clearTimeout(timer);
    stop();
  };
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
  const first = initial ?? items[0]?.id ?? "";
  const wanted = value ?? (param ? (fromAddress ?? first) : own);
  const chosen = items.some((t) => t.id === wanted) ? wanted : (items[0]?.id ?? "");
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  // The panel shown: the choice, drawn after the tabs have answered it.
  const shown = useDeferredValue(chosen);
  // A choice made by a press of a tab (not by the address).
  const pressed = useRef(false);

  const choose = useCallback(
    (id: string) => {
      pressed.current = true;
      if (param) {
        const search = new URLSearchParams(window.location.search);
        if (id === first) search.delete(param);
        else search.set(param, id);
        const text = search.toString();
        navigate(`${window.location.pathname}${text ? `?${text}` : ""}`, { replace: true });
      } else if (value === undefined) setOwn(id);
      onChange?.(id);
    },
    [param, first, onChange, value],
  );

  // The indicator follows the chosen tab (measured after layout; it slides where motion is allowed), and the chosen
  // tab stands in the list's view.
  useLayoutEffect(() => {
    const element = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !list.current) return;
    revealIn(list.current, element);
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

  // An address that names another tab than the first (a shared link, a reload, a way in from elsewhere) shows it:
  // the tab list comes just under the masthead. A press of a tab moves nothing.
  useEffect(() => {
    if (pressed.current) {
      pressed.current = false;
      return;
    }
    if (!param || fromAddress === null || fromAddress === first || !root.current) return;
    return bringUnderMasthead(root.current);
  }, [param, fromAddress, first]);

  const edges = useOverflow(list, [items.length]);
  const step = (direction: 1 | -1) => {
    const element = list.current;
    if (!element) return;
    const tabs = [...element.querySelectorAll<HTMLElement>('[role="tab"]')];
    const view = { left: element.scrollLeft, right: element.scrollLeft + element.clientWidth };
    // A tab's offset is from the list's own box (the list is its offset parent), whatever the list's scroll.
    const target =
      direction > 0
        ? tabs.find((t) => t.offsetLeft + t.offsetWidth > view.right + 1)
        : [...tabs].reverse().find((t) => t.offsetLeft < view.left - 1);
    if (!target) return;
    const left = target.offsetLeft;
    element.scrollTo({
      left: direction > 0 ? left + target.offsetWidth - element.clientWidth + 32 : left - 32,
      behavior: reduced() ? "instant" : "smooth",
    });
  };

  const current = items.find((t) => t.id === shown) ?? items.find((t) => t.id === chosen);
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

  return (
    <div className={`tabs ${className}`} ref={root}>
      <div className={`tabs__rail${edges.start ? " tabs__rail--start" : ""}${edges.end ? " tabs__rail--end" : ""}`}>
        <div className="tabs__list" role="tablist" aria-label={label} ref={list}>
          {items.map((t) => {
            const selected = t.id === chosen;
            const count = t.count !== undefined && t.count !== null ? countParts(t.count) : null;
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
                {count ? (
                  <span className="tabs__count">
                    {count.number}
                    {count.words ? <span className="tabs__count-words">{count.words}</span> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
          {bar ? <span className="tabs__bar" aria-hidden="true" style={{ left: bar.left, width: bar.width }} /> : null}
        </div>
        {/* For the pointer: the keyboard moves by the arrow keys, and the tabs are in the list's name. */}
        {edges.start ? (
          <button
            type="button"
            className="tabs__more tabs__more--start"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => {
              step(-1);
            }}
          />
        ) : null}
        {edges.end ? (
          <button
            type="button"
            className="tabs__more tabs__more--end"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => {
              step(1);
            }}
          />
        ) : null}
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
