// Work done once the page is idle (fetching the code of what a press will open): `requestIdleCallback` where the
// browser has it, else two seconds after the page is drawn. Returns the way to cancel it.

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function whenIdle(work: () => void): () => void {
  const w = window as IdleWindow;
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const handle = w.requestIdleCallback(work);
    const cancel = w.cancelIdleCallback;
    return () => {
      cancel(handle);
    };
  }
  const timer = window.setTimeout(work, 2000);
  return () => {
    window.clearTimeout(timer);
  };
}
