// The theme: light (the default), dark, or the system's. Kept in the browser; set on the root as `data-theme`
// before the first paint by index.html, so no other theme flashes.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type Theme = "light" | "dark" | "system";
const THEMES: Theme[] = ["light", "dark", "system"];
const KEY = "idtrack-theme";

function readTheme(): Theme {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
}

function Icon({ theme }: { theme: Theme }) {
  if (theme === "light")
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M13.4 10.2A5.6 5.6 0 0 1 5.8 2.6a5.6 5.6 0 1 0 7.6 7.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.7" y="2.5" width="12.6" height="8.6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 13.8h5M8 11.1v2.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const NAMES: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

/** The theme's choices as a radio group: one tab stop, the arrow keys move the choice. */
function ThemeChoices({
  theme,
  choose,
  className,
  focusFirst = false,
  done,
}: {
  theme: Theme;
  choose: (t: Theme) => void;
  className: string;
  focusFirst?: boolean;
  /** Called after a press (not an arrow key) chose a theme. */
  done?: () => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusFirst) group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [focusFirst]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = THEMES[(THEMES.indexOf(theme) + step + THEMES.length) % THEMES.length] ?? "light";
    choose(next);
    const button = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`);
    button?.focus();
  };
  return (
    <div className={className} role="radiogroup" aria-label="Theme" ref={group}>
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          aria-label={NAMES[t]}
          title={`${NAMES[t]} theme`}
          tabIndex={theme === t ? 0 : -1}
          data-value={t}
          className="theme-switch__option"
          onClick={() => {
            choose(t);
            done?.();
          }}
          onKeyDown={onKeyDown}
        >
          <Icon theme={t} />
          <span className="theme-switch__word" aria-hidden="true">
            {NAMES[t]}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The theme: three choices side by side on a wide screen; on a phone, one button of a finger's size (the theme
 *  shown) that opens the same three choices under it, closed by a choice, Escape or a press outside. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      if (theme === "light") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, theme);
    } catch {
      // Storage may be off (a private window): the choice then lasts for this page only.
    }
    // The browser's own chrome (a phone's address bar) takes the paper of the theme shown; under "system" it follows
    // the system's scheme as it changes.
    const paint = () => {
      const meta = document.querySelector('meta[name="theme-color"]');
      const paper = getComputedStyle(document.body).backgroundColor;
      if (meta && paper) meta.setAttribute("content", paper);
    };
    paint();
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (theme === "system") media?.addEventListener("change", paint);
    return () => {
      media?.removeEventListener("change", paint);
    };
  }, [theme]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setMenu(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  return (
    <div className="theme" ref={root}>
      <ThemeChoices theme={theme} choose={setTheme} className="theme-switch" />
      <button
        ref={button}
        type="button"
        className="theme-menu__button"
        aria-expanded={menu}
        aria-controls={menu ? menuId : undefined}
        aria-label={`Theme: ${NAMES[theme]}`}
        onClick={() => {
          setMenu((m) => !m);
        }}
      >
        <Icon theme={theme} />
      </button>
      {menu ? (
        <div className="theme-menu" id={menuId}>
          <ThemeChoices
            theme={theme}
            choose={setTheme}
            done={() => {
              setMenu(false);
              button.current?.focus();
            }}
            className="theme-menu__choices"
            focusFirst
          />
        </div>
      ) : null}
    </div>
  );
}
