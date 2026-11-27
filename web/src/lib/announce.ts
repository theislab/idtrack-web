// One short sentence per outcome, read by screen readers from the one status line of the page
// (components/Announcer.tsx), instead of regions that would read a whole answer aloud.

type Listener = (text: string) => void;
const listeners = new Set<Listener>();

/** Say `text` on the page's status line (polite: after what the reader is saying). */
export function announce(text: string): void {
  for (const listener of listeners) listener(text);
}

export function listen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
