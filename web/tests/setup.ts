// The DOM of the unit tests (jsdom) lacks what a browser has for layout: a ResizeObserver that reports a width.
class FixedResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    const entry = { target, contentRect: { width: 1200, height: 600 } } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }
  unobserve() {
    // Nothing is observed beyond the first report.
  }
  disconnect() {
    // Nothing to release.
  }
}

globalThis.ResizeObserver = FixedResizeObserver;
if (typeof HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
}
