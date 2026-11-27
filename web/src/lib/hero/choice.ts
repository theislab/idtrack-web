// The home's picture, chosen in the masthead (components/shell/HeroMenu.tsx) and kept in the browser: the lineages
// (the default), the releases as rings, or the convoluted journeys as a constellation. Shared by the menu and the home.
import { useSyncExternalStore } from "react";

export type HeroChoice = "lineages" | "rings" | "constellation";

export const HERO_CHOICES: { value: HeroChoice; label: string }[] = [
  { value: "lineages", label: "Lineages through the releases" },
  { value: "rings", label: "The releases as rings" },
  { value: "constellation", label: "Convoluted journeys" },
];

const KEY = "idtrack-hero";
const CHANGE = "idtrack:hero";

function read(): HeroChoice {
  try {
    const value = window.localStorage.getItem(KEY);
    return HERO_CHOICES.some((c) => c.value === value) ? (value as HeroChoice) : "lineages";
  } catch {
    return "lineages";
  }
}

let current: HeroChoice | null = null;

export function chooseHero(choice: HeroChoice): void {
  current = choice;
  try {
    if (choice === "lineages") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // Storage may be off: the choice lasts for this page.
  }
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener(CHANGE, callback);
  };
}

const snapshot = (): HeroChoice => (current ??= read());

export function useHeroChoice(): HeroChoice {
  return useSyncExternalStore(subscribe, snapshot, () => "lineages");
}
