// The conversions this browser opened last (at most five), for the command palette's "Recent": kept in the browser
// (listed on the privacy page: lib/site/storage.ts) until cleared there. Each is the conversion's address as it was
// opened: the organism, the identifier and the releases and database it named.
import { useEffect } from "react";
import { useLocation } from "./router";

const KEY = "idtrack-recent";
const MOST = 5;

export interface Recent {
  organism: string;
  identifier: string;
  from: string | null;
  to: string | null;
  db: string | null;
}

const same = (a: Recent, b: Recent) =>
  a.organism === b.organism && a.identifier === b.identifier && a.from === b.from && a.to === b.to && a.db === b.db;

const isRecent = (value: unknown): value is Recent => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const text = (x: unknown) => x === null || typeof x === "string";
  return (
    typeof v["organism"] === "string" &&
    typeof v["identifier"] === "string" &&
    text(v["from"]) &&
    text(v["to"]) &&
    text(v["db"])
  );
};

export function readRecent(): Recent[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isRecent).slice(0, MOST) : [];
  } catch {
    return [];
  }
}

export function addRecent(recent: Recent): void {
  try {
    const next = [recent, ...readRecent().filter((r) => !same(r, recent))].slice(0, MOST);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be off (a private window): nothing is kept.
  }
}

export function clearRecent(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}

/** Every conversion the page opens (an address of Convert that names an identifier) is kept as recent. */
export function useRecentConversions(organism: string | null): void {
  const { path, search } = useLocation();
  const identifier = path === "/convert" ? search.get("id") : null;
  const from = search.get("from");
  const to = search.get("to");
  const db = search.get("db");
  const named = search.get("organism") ?? organism;
  useEffect(() => {
    if (identifier?.trim() && named) addRecent({ organism: named, identifier, from, to, db });
  }, [identifier, from, to, db, named]);
}
