// A term of a Method figure: its code as IDTrack writes it (monospaced data) with its meaning in a hover card, opened by
// pointing, by the keyboard's focus or by a press (DIRECTION.md, rule 5): the figure reads without its definitions,
// and each is one gesture away. The card says the first sentence of the meaning read for a person; every meaning in
// IDTrack's full words stays in the stage's terms (one press away).
import type { ReactNode } from "react";
import { firstSentence, readerText } from "../../lib/method/readerText";
import { spaced } from "../../lib/vocabulary";
import { Prose } from "../ui";
import { HoverCard } from "../v2/HoverCard";

export function Defined({
  code,
  meaning,
  children,
  className = "",
}: {
  code: string;
  meaning: string | null | undefined;
  /** More of the card, under the meaning (a criterion's fields). */
  children?: ReactNode;
  className?: string;
}) {
  const words = spaced(code);
  if (!meaning) return <span className={`defined defined--plain mono ${className}`}>{words}</span>;
  return (
    <HoverCard
      className={`defined ${className}`}
      triggerClassName="defined__trigger mono"
      trigger={words}
      label={`${words}: what it means`}
    >
      <span className="defined__card">
        <span className="defined__meaning">
          <Prose text={readerText(firstSentence(meaning))} />
        </span>
        {children}
        <code className="defined__code mono">{code}</code>
      </span>
    </HoverCard>
  );
}
