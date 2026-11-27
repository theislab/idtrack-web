// A part of the page loaded when first needed (React.lazy), that can be asked for again: React keeps a failed lazy
// component failed for good (so that a render that is retried does not fetch again and again), and the error
// boundary's "Try again" (or the browser coming back online) makes every failed part anew, so that the next render
// fetches it again. A part that fails to arrive is asked for once more at once (a broken connection often holds only
// for a moment), with its failed stylesheets.
import {
  createElement,
  lazy,
  useState,
  type ComponentProps,
  type FunctionComponent,
  type JSXElementConstructor,
} from "react";
import { browserOffline } from "../api/client";
import { isChunkError, refetchStylesheets } from "./chunks";

/** The parts that failed, each with the way to make it anew. */
const failed = new Set<() => void>();

/** Make every part that failed anew: the next render asks for its code again. */
export function retryFailedParts(): void {
  for (const renew of [...failed]) renew();
  failed.clear();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React's lazy and ComponentProps bound a component by JSXElementConstructor<any> and refuse a narrower bound; a part takes whatever props its component takes
export function lazyPart<C extends JSXElementConstructor<any>>(
  load: () => Promise<{ default: C }>,
): FunctionComponent<ComponentProps<C>> & { preload: () => Promise<void> } {
  const renew = () => {
    current = lazy(attempt);
  };
  const attempt = async (): Promise<{ default: C }> => {
    try {
      return await load();
    } catch (error) {
      if (isChunkError(error) && !browserOffline()) {
        await refetchStylesheets();
        try {
          return await load();
        } catch (second) {
          failed.add(renew);
          throw second;
        }
      }
      failed.add(renew);
      throw error;
    }
  };
  let current = lazy(attempt);
  /** The part's component once its code has arrived: a part drawn after that is drawn at once, never suspended. */
  let loaded: C | null = null;
  function Part(props: ComponentProps<C>) {
    // Chosen once per part drawn, so that its component never changes under it (which would draw it anew).
    const [arrived] = useState(() => loaded);
    return createElement(arrived ?? current, props);
  }
  // Fetch the part's code now, before it is drawn; a failure here is left to the render that needs it, which asks
  // again and says so. The promise settles when the code has arrived or failed.
  Part.preload = () =>
    load().then(
      (module) => {
        loaded = module.default;
      },
      () => undefined,
    );
  return Part;
}
