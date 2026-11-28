// The three themes and the order the theme button goes round them (components/ThemeSwitch.tsx).

export type Theme = "light" | "dark" | "system";
const THEMES: Theme[] = ["light", "dark", "system"];
/** Whether a value is one of the three themes. */
export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);
const NAMES: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

/** The theme after this one, in the order the button goes round: light, dark, the system's. */
export const nextTheme = (theme: Theme): Theme => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "light";

/** What the button says: the theme in force and the one a press gives ("Light mode; switch to dark"). */
export const themeLabel = (theme: Theme): string =>
  `${NAMES[theme]} mode; switch to ${nextTheme(theme) === "system" ? "the system's setting" : NAMES[nextTheme(theme)].toLowerCase()}`;

/** What a press says on the page's status line: the theme now in force (the system's with what it gives now). */
export const themeSaid = (theme: Theme, systemDark: boolean): string =>
  theme === "system"
    ? `Theme: the system's setting, ${systemDark ? "dark" : "light"} now.`
    : `Theme: ${NAMES[theme].toLowerCase()}.`;

/** The event by which another part of the page (the command palette) asks the theme button for a theme. */
export const THEME_REQUEST = "idtrack:theme";

export function requestTheme(theme: Theme): void {
  window.dispatchEvent(new CustomEvent<Theme>(THEME_REQUEST, { detail: theme }));
}
