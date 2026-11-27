// The three themes and the order the theme button goes round them (components/ThemeSwitch.tsx).

export type Theme = "light" | "dark" | "system";
const THEMES: Theme[] = ["light", "dark", "system"];
const NAMES: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

/** The theme after this one, in the order the button goes round: light, dark, the system's. */
export const nextTheme = (theme: Theme): Theme => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "light";

/** What the button says: the theme in force and the one a press gives ("Light mode; switch to dark"). */
export const themeLabel = (theme: Theme): string =>
  `${NAMES[theme]} mode; switch to ${nextTheme(theme) === "system" ? "the system's" : NAMES[nextTheme(theme)].toLowerCase()}`;
