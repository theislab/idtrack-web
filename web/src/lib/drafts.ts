// What a person typed or pasted and has not sent yet, and what a page computed for them (a batch's results), kept for
// the tab's session: across an organism switch, a link to another page and Back, and a reload. Kept in memory and in
// the browser's session storage (never a cookie, never sent anywhere); without that storage (a private window, a full
// quota) it is kept in memory only, which still holds across the pages of one visit.

const PREFIX = "idtrack:draft:";
const memory = new Map<string, unknown>();

/** What is kept under `key`, when it has the form `is` checks (a value kept by an earlier version of the page, of
 *  another form, is not used). */
export function readDraft<T>(key: string, is: (value: unknown) => value is T): T | undefined {
  let value: unknown = memory.get(key);
  if (!memory.has(key)) {
    try {
      const text = window.sessionStorage.getItem(PREFIX + key);
      if (text === null) return undefined;
      value = JSON.parse(text) as unknown;
      memory.set(key, value);
    } catch {
      return undefined;
    }
  }
  return is(value) ? value : undefined;
}

/** A value that is an object (a record of fields). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const isText = (value: unknown): value is string => typeof value === "string";

const isTextDraft = (value: unknown): value is { over: string; text: string } =>
  isRecord(value) && typeof value["over"] === "string" && typeof value["text"] === "string";

/** Keep `value` under `key` (undefined: forget it). Returns whether it is also in the session's storage. */
export function writeDraft(key: string, value: unknown): boolean {
  if (value === undefined) {
    memory.delete(key);
    try {
      window.sessionStorage.removeItem(PREFIX + key);
    } catch {
      // Nothing stored.
    }
    return true;
  }
  memory.set(key, value);
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    try {
      window.sessionStorage.removeItem(PREFIX + key);
    } catch {
      // Nothing stored.
    }
    return false;
  }
}

/** A text typed over a value of the address: the text is kept while the address still holds the same value, so that
 *  a remount (an organism switch keeps the identifier in the address) restores what was typed, and a new value of the
 *  address (a link, Back) starts from that value. */
export function draftOver(key: string, addressValue: string): string {
  const kept = readDraft(key, isTextDraft);
  return kept?.over === addressValue ? kept.text : addressValue;
}

export function keepDraftOver(key: string, addressValue: string, text: string): void {
  writeDraft(key, text === addressValue ? undefined : { over: addressValue, text });
}
