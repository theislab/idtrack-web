// The replay of a walk on the Method page: a cursor that stands on one step of the walk at a time, lighting the thread
// up to it; started by a press (nothing moves on its own), a step every REPLAY_STEP ms, and under reduced motion it
// does not run by itself: each press of "Next step" moves it.
import { useEffect, useState } from "react";

/** How long a step stays lit while the walk replays (ms). */
const REPLAY_STEP = 900;

/** Whether the person asked for less motion (a test's DOM without matchMedia: no). */
function prefersLessMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface Replay {
  /** The step the replay stands on (0 the first; `total` the answer), or null before it starts. */
  cursor: number | null;
  running: boolean;
  play: () => void;
  back: () => void;
  forward: () => void;
}

/** The state of a replay over `total` steps. */
export function useReplay(total: number): Replay {
  const [cursor, setCursor] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => {
        setCursor((c) => {
          const next = c === null ? 0 : c + 1;
          if (next >= total) setRunning(false);
          return Math.min(next, total);
        });
      },
      cursor === null ? 0 : REPLAY_STEP,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, cursor, total]);
  return {
    cursor,
    running,
    play: () => {
      if (running) {
        setRunning(false);
        return;
      }
      const restart = cursor === null || cursor >= total;
      if (prefersLessMotion()) {
        setCursor(restart ? 0 : cursor);
        return;
      }
      if (restart) setCursor(null);
      setRunning(true);
    },
    back: () => {
      setRunning(false);
      setCursor((c) => (c === null ? null : Math.max(0, c - 1)));
    },
    forward: () => {
      setRunning(false);
      setCursor((c) => (c === null ? 0 : Math.min(total, c + 1)));
    },
  };
}
