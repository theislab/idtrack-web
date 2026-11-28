// Work done once the page is idle (fetching the code of what a press will open): `requestIdleCallback` where the
// browser has it, else two seconds after the page is drawn. Returns the way to cancel it.

export function whenIdle(work: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const handle = window.requestIdleCallback(work);
    return () => {
      window.cancelIdleCallback(handle);
    };
  }
  const timer = globalThis.setTimeout(work, 2000);
  return () => {
    globalThis.clearTimeout(timer);
  };
}
