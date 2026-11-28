// What the page adds to `window`, and what the browser gives that TypeScript's DOM types do not name yet: declared once
// here, so that no file reaches them through a cast.
export {};

declare global {
  /** A script's address a Trusted Types policy let through (the browser's own type; the Worker constructor takes it). */
  interface TrustedScriptURL {
    toString(): string;
  }

  interface TrustedTypePolicy {
    createScriptURL(url: string): TrustedScriptURL;
  }

  interface Window {
    /** The browser's Trusted Types, where it enforces them (the server's Content-Security-Policy asks for them). */
    trustedTypes?: {
      createPolicy(name: string, rules: { createScriptURL(url: string): string }): TrustedTypePolicy;
    };
    /** Google's data layer, which its tag reads (lib/analytics.ts; only after a visitor's consent): the arguments of
     *  each call of `gtag`, in order. */
    dataLayer?: IArguments[];
    /** Google's call that queues a command for its tag (lib/analytics.ts). */
    gtag?: (...args: unknown[]) => void;
    /** Development only (components/hero/canvas.ts, `?hero-frames`): draw the home's picture at a moment, in seconds. */
    __heroTime?: (seconds: number) => void;
    /** Development only: the GPU work of the picture's last frame. */
    __heroWork?: () => unknown;
  }
}
