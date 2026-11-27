// The page's one status line (role=status, out of sight): each outcome said in one sentence (lib/announce.ts).
import { useEffect, useState } from "react";
import { listen } from "../lib/announce";

export function Announcer() {
  const [said, setSaid] = useState({ text: "", count: 0 });
  useEffect(
    () =>
      listen((text) => {
        // The same sentence twice in a row is said again: the line is emptied first, then written.
        setSaid((s) => ({ text: "", count: s.count + 1 }));
        window.requestAnimationFrame(() => {
          setSaid((s) => ({ ...s, text }));
        });
      }),
    [],
  );
  return (
    <p className="visually-hidden" role="status" data-said={said.count}>
      {said.text}
    </p>
  );
}
