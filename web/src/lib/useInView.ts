// Whether an element has come near the viewport: a part of a page that asks the server is asked only when a reader
// comes to it (or nears it: the margin asks a little before, so a reader scrolling past never finds it still waiting).
import { useCallback, useRef, useState } from "react";

/** True once the element has come near the viewport (and from then on); at once where the browser cannot tell.
 *  The ref is a callback: the element is watched from the moment it is mounted, whenever that is (a part that renders
 *  nothing until its data comes still starts to be watched when it appears). */
export function useInView(margin = "600px") {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback(
    (element: Element | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!element || typeof IntersectionObserver === "undefined") return;
      const watching = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setSeen(true);
            watching.disconnect();
          }
        },
        { rootMargin: margin },
      );
      watching.observe(element);
      observer.current = watching;
    },
    [margin],
  );
  return { ref, seen };
}
