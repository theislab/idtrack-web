// Small parts the panels of a result share: the panel of the figure, codes with their meaning on focus, a match read
// into its parts, a criterion's value.
import type { ReactNode } from "react";
import type { Candidate } from "../api/types";
import { MATCH_WORDS } from "../lib/answerLinks";
import { shortScore } from "../lib/resultWords";
import { criterionValue } from "../lib/values";
import { matchParts, spaced, type Criterion } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";
import { Toggletip } from "./Toggletip";
import { Mono, Prose } from "./ui";

/** One panel of the result's figure: its letter, its title, what stands beside the title, its content. */
export function FigurePanel({
  letter,
  title,
  id,
  aside,
  children,
  className = "",
}: {
  /** A panel's letter, where the panels stand as a figure's (a, b, c); none inside a tab. */
  letter?: string;
  title: string;
  id: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`figure-panel ${className}`} id={id} aria-labelledby={`${id}-title`}>
      <header className="figure-panel__head">
        {letter ? (
          <span className="panel-letter" aria-hidden="true">
            {letter}
          </span>
        ) : null}
        <h2 id={`${id}-title`} className="figure-panel__title">
          {title}
        </h2>
        {aside ? <div className="figure-panel__aside">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A code of the api in words (its code spaced, or the words given), opening on a press to idtrack's meaning and the
 *  code itself as the api writes it (for programmers). Without a meaning, the words alone. */
export function Term({
  code,
  meaning,
  words,
  className = "",
}: {
  code: string;
  meaning: string | null | undefined;
  words?: ReactNode;
  className?: string;
}) {
  const shown = words ?? spaced(code);
  if (!meaning) return <span className={`term ${className}`}>{shown}</span>;
  return (
    <Toggletip
      className={`term ${className}`}
      tip={
        <span className="term__card">
          <span className="term__meaning">
            <Prose text={meaning} />
          </span>{" "}
          <code className="term__code mono">{code}</code>
        </span>
      }
    >
      {shown}
    </Toggletip>
  );
}

/** The code of a status or reason, in words, with its meaning and the code on a press. */
function Code({ code, meaning }: { code: string; meaning: string | null | undefined }) {
  return <Term code={code} meaning={meaning} />;
}

/** Every reason of a result, the first (`reason`) first, each with its meaning on focus. */
export function Reasons({ codes }: { codes: readonly string[] }) {
  const vocabulary = useVocabulary();
  return (
    <>
      {codes.map((code) => (
        <span key={code}>
          {" "}
          <Code code={code} meaning={vocabulary.reasons.get(code)} />
        </span>
      ))}
    </>
  );
}

/** A match as idtrack writes it, in words: its prefixes, then its step, each with its meaning and code on a press. */
export function Match({ match }: { match: string }) {
  const vocabulary = useVocabulary();
  const parts = matchParts(vocabulary, match);
  return (
    <span className="match">
      {parts.map((part, i) => (
        <span key={`${part.code}|${i}`}>
          <Term code={part.code} meaning={part.meaning} words={MATCH_WORDS[part.code] ?? spaced(part.code)} />
          {i < parts.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

/** The criterion's value of a candidate, typed, with the sort-key mark where the api gives no reading of its parts. */
export function CriterionValue({ criterion, candidate }: { criterion: Criterion; candidate: Candidate }) {
  const shown = criterionValue(criterion, candidate);
  return <Mono title={shown.title}>{shown.text}</Mono>;
}

/** A score in a table: its first six significant digits and "…" where more follow (`shortScore`); the whole value as
 *  idtrack gave it on hover, read out in place of the shortened text, and in the candidate's record. */
export function ScoreValue({ score, strong = false }: { score: number; strong?: boolean }) {
  const { text, exact } = shortScore(score);
  if (text === exact) return <Mono strong={strong}>{exact}</Mono>;
  return (
    <span className={`score-value mono ${strong ? "mono--strong" : ""}`} title={`As idtrack gave it: ${exact}`}>
      <span aria-hidden="true">{text}</span>
      <span className="visually-hidden">{exact}</span>
    </span>
  );
}
