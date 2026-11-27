// The theme: light (the default), dark, or the system's, one button going round them. Kept in the browser; set on the
// root as `data-theme` before the first paint by index.html, so no other theme flashes.
import { useEffect, useState } from "react";
import { nextTheme, themeLabel, type Theme } from "../lib/theme";

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

/** The theme: one button whose icon shows the theme in force; a press goes on to the next (light, dark, the
 *  system's), kept in the browser. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    // A change of theme is one change of the root's tokens: no control's colour transition runs meanwhile (each would
    // be animated on its own), and nothing of the style is read in the task that makes it.
    const root = document.documentElement;
    const switching = root.getAttribute("data-theme") !== theme;
    if (switching) root.classList.add("theme-switching");
    root.setAttribute("data-theme", theme);
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
    // After the frame that draws the new theme: the style is then computed already, and reading it costs nothing.
    let later = 0;
    const frame = requestAnimationFrame(() => {
      later = window.setTimeout(() => {
        root.classList.remove("theme-switching");
        paint();
      });
    });
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (theme === "system") media?.addEventListener("change", paint);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(later);
      root.classList.remove("theme-switching");
      media?.removeEventListener("change", paint);
    };
  }, [theme]);
  const label = themeLabel(theme);
  return (
    <button
      type="button"
      className="theme-button"
      aria-label={label}
      title={label}
      onClick={() => {
        setTheme(nextTheme);
      }}
    >
      <Icon theme={theme} />
    </button>
  );
}
