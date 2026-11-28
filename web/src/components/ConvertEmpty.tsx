// The Convert page before a conversion (`/convert`): its title, one sentence and the form (the identifier, examples
// from the graph's showcase, the organism, the releases and the database folded in one line that says them, Convert).
// The journeys of the graph are Explore's first figure (components/explore/Journeys.tsx).
import { useId, type ReactNode } from "react";
import type { GraphDescription } from "../api/types";
import "../styles/home.css";

export function ConvertEmpty({ form }: { description: GraphDescription | null; form: ReactNode }) {
  const id = useId();
  return (
    <>
      <div className="convert-landing">
        <h1 id={`${id}-title`} className="convert-landing__title">
          Convert an identifier
        </h1>
        <p className="convert-landing__lede">
          A gene id, symbol or accession of any release, to the release and database you ask, with the path that led
          there.
        </p>
        <div className="convert-landing__form">{form}</div>
      </div>
    </>
  );
}
