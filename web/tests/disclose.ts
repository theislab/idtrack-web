// What a reader does to reach what an answer keeps behind its tabs, segmented views and expandable rows (DIRECTION.md,
// "The disclosure components"); and the address put back between tests (a tab is kept in it).
import { fireEvent, screen } from "@testing-library/react";

/** Choose the tab of that name. */
export function openTab(name: string | RegExp): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

/** Open the expandable row of that summary. */
export function expand(name: string | RegExp): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** The page's address back at its root. */
export function resetAddress(): void {
  window.history.replaceState(null, "", "/");
}
