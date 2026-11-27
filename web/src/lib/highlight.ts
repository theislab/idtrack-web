// What the reader points at in one answer, shared by its views without re-rendering the others: a candidate (a row of
// the candidates' table draws it strongly in the path view) and a step (a row of the path in words, or the step
// focused in the drawing). Views subscribe with `useSyncExternalStore`; only those whose part changes draw again.
export interface Highlight {
  candidate: () => number | null;
  step: () => number | null;
  setCandidate: (index: number | null) => void;
  setStep: (index: number | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createHighlight(): Highlight {
  let candidate: number | null = null;
  let step: number | null = null;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };
  return {
    candidate: () => candidate,
    step: () => step,
    setCandidate: (index) => {
      if (index === candidate) return;
      candidate = index;
      tell();
    },
    setStep: (index) => {
      if (index === step) return;
      step = index;
      tell();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
