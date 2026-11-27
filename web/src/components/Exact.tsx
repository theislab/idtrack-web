// A value converted for reading (bytes to GiB, a share to a percentage) with the exact value it came from: shown on
// hover and focus, kept open by a press (a toggletip), and the value's accessible description.
import { useEffect, useId, useRef, useState } from "react";
import type { Reading } from "../lib/load";

export function Exact({ reading, className = "" }: { reading: Reading; className?: string }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // A tip the panel dismissed (Escape) is no longer pinned either.
  useEffect(() => {
    const element = button.current;
    const unpin = () => {
      setPinned(false);
    };
    element?.addEventListener("exact-dismiss", unpin);
    return () => element?.removeEventListener("exact-dismiss", unpin);
  }, []);
  return (
    <button
      ref={button}
      type="button"
      className={`exact ${pinned ? "exact--pinned" : ""} ${className}`}
      aria-describedby={id}
      onClick={() => {
        setPinned((p) => !p);
      }}
      onBlur={() => {
        setPinned(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && pinned) {
          event.stopPropagation();
          event.preventDefault();
          setPinned(false);
        }
      }}
    >
      <span className="mono">{reading.text}</span>
      <span role="tooltip" id={id} className="exact__tip">
        {reading.exact}
      </span>
    </button>
  );
}
