// The evidence of an answer a reader should weigh, where the answer is: one short mark per class (`lib/evidence.ts`),
// each opening on a press to what the result says, IDTrack's meaning of the code it is read from, the code itself, and
// the limitation of IDTrack's documentation it falls under. A caution is marked by a small triangle, a note by a dot
// (shape and words, never colour alone). `compact` draws the marks small, at most `max` of them and "+ N more", for a
// table's cell.
import { useMemo } from "react";
import type { ConversionResult } from "../api/types";
import { evidenceOf, type EvidenceAsk, type EvidenceMark } from "../lib/evidence";
import { useVocabulary } from "../lib/vocabularyContext";
import { Toggletip } from "./Toggletip";
import { Link, Prose } from "./ui";
import "../styles/evidence.css";

/** A mark's glyph: a caution's triangle, a note's dot (a shape, never colour alone). */
export function EvidenceGlyph({ tone }: { tone: EvidenceMark["tone"] }) {
  return tone === "caution" ? (
    <svg
      className="evidence__glyph evidence__glyph--caution"
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
    >
      <path d="M5 0.8 L9.4 9 L0.6 9 Z" />
    </svg>
  ) : (
    <svg
      className="evidence__glyph evidence__glyph--note"
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
    >
      <circle cx="5" cy="5" r="2.6" />
    </svg>
  );
}

/** The addresses a mark's ways on lead to: the identifier read at another release, a conversion that answers what the
 *  mark doubts. */
interface EvidenceLinks {
  readAtHref?: ((release: number) => string) | undefined;
  askHref?: ((ask: EvidenceAsk) => string) | undefined;
}

/** A label as the head of a line: its first letter in capitals (an identifier in backticks is left as written). */
export function sentenceCase(text: string): string {
  return text.startsWith("`") ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** A sentence continued after a colon: its first letter small, unless it begins with an identifier or a name. */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) && !/^(IDTrack|Ensembl)\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** The sentences of a text (split after a full stop followed by a space and a capital or an identifier). */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z`])/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The standing claim of a mark's class where the answer's own text closes with it: the last sentence of the class's
 *  meaning, when the answer's text ends with the same sentence (a bridge: "That is idtrack's inference; no record of
 *  Ensembl states it."). Null where the answer's text says only what is particular to it. */
export function standingClaim(mark: EvidenceMark): string | null {
  if (!mark.meaning) return null;
  const own = sentencesOf(mark.detail);
  const general = sentencesOf(mark.meaning);
  const last = own[own.length - 1];
  if (own.length < 2 || general.length < 2 || last === undefined) return null;
  return last === general[general.length - 1] ? last : null;
}

/** The words of a text that carry meaning (lower case, four letters or more). */
function wordsOf(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(Boolean));
}

/** Whether the class's meaning adds to what the answer's own text says: less than three in five of its words are the
 *  answer's text's already. */
export function meaningAdds(mark: EvidenceMark): boolean {
  if (!mark.meaning) return false;
  const general = wordsOf(mark.meaning);
  if (!general.size) return false;
  const own = wordsOf(mark.detail);
  const shared = [...general].filter((w) => own.has(w)).length;
  return shared / general.size < 0.6;
}

/** The marks in the verdict's order: those that say another gene may be meant, then the other cautions, then notes. */
export function verdictOrder(marks: readonly EvidenceMark[]): EvidenceMark[] {
  return [
    ...marks.filter((m) => m.tone === "caution" && m.alert),
    ...marks.filter((m) => m.tone === "caution" && !m.alert),
    ...marks.filter((m) => m.tone !== "caution"),
  ];
}

/** Whose words a class's meaning is, as the api's vocabulary marks it. */
function sourceLabel(source: string | null): string {
  return source === "idtrack" ? "IDTrack" : "This site's reading";
}

/** A mark's title, as the verdict writes its line ("Another gene may be the one meant: …" where another gene may be). */
export function MarkTitle({ mark }: { mark: EvidenceMark }) {
  return mark.alert ? (
    <>
      Another gene may be the one meant: <Prose text={mark.label} />
    </>
  ) : (
    <Prose text={sentenceCase(mark.label)} />
  );
}

/** What a mark rests on: what the result says (the answer's own sentence), its ways on, the limitation of IDTrack's
 *  documentation it falls under (one linked line), and, folded under "Why this is flagged", the class's meaning (where
 *  it adds to the answer's sentence, labelled by whose reading it is) and the code it is read from. Said once each. */
export function EvidenceCard({ mark, links }: { mark: EvidenceMark; links: EvidenceLinks }) {
  const { readAtHref, askHref } = links;
  const adds = meaningAdds(mark);
  return (
    <span className="evidence__card">
      <span className="evidence__card-detail">
        <Prose text={mark.detail} />
      </span>
      {mark.readAt !== undefined && readAtHref ? (
        <span className="evidence__card-action">
          <Link to={readAtHref(mark.readAt)}>Read it at release {mark.readAt} →</Link>
        </span>
      ) : null}
      {mark.ask && askHref ? (
        <span className="evidence__card-action">
          <Link to={askHref(mark.ask)}>{mark.ask.words} →</Link>
        </span>
      ) : null}
      {mark.limitation ? (
        <span className="evidence__card-limitation">
          <span className="evidence__card-source">Known limitation of IDTrack:</span>{" "}
          <a href={mark.limitation.href} target="_blank" rel="noreferrer">
            {mark.limitation.title}
            <span className="visually-hidden"> (IDTrack&apos;s documentation, opens in a new tab)</span>
            <span aria-hidden="true"> ↗</span>
          </a>
        </span>
      ) : null}
      <details className="evidence__card-why">
        <summary>Why this is flagged</summary>
        {adds && mark.meaning ? (
          <span className="evidence__card-meaning">
            <span className="evidence__card-source">{sourceLabel(mark.source)}:</span> <Prose text={mark.meaning} />
          </span>
        ) : null}
        <span className="evidence__card-code">
          <span className="evidence__card-source">Read from the api&apos;s answer:</span>{" "}
          <span className="mono">{mark.code}</span>
        </span>
      </details>
    </span>
  );
}

function Mark({ mark, links }: { mark: EvidenceMark; links: EvidenceLinks }) {
  const words = mark.label.replace(/`/g, "");
  return (
    <li className={`evidence__mark evidence__mark--${mark.tone}`}>
      <Toggletip
        tip={<EvidenceCard mark={mark} links={links} />}
        label={`${mark.tone === "caution" ? "Caution" : "Note"}: ${words}`}
      >
        <EvidenceGlyph tone={mark.tone} />
        <span className="evidence__label">
          <Prose text={mark.label} />
        </span>
      </Toggletip>
    </li>
  );
}

/** The evidence marks of a result (none: nothing is drawn). */
export function Evidence({
  result,
  marks: given,
  compact = false,
  max = 3,
  readAtHref,
  askHref,
  label = "Evidence to weigh",
}: {
  result: ConversionResult;
  /** The marks, where the caller has them already (else read from the result). */
  marks?: EvidenceMark[];
  compact?: boolean;
  /** In compact form, the marks drawn before "+ N more". */
  max?: number;
  /** The address that reads the identifier at another release (a mark of another meaning offers it). */
  readAtHref?: (release: number) => string;
  /** The address of a conversion a mark offers as the way on. */
  askHref?: (ask: EvidenceAsk) => string;
  /** The list's accessible name. */
  label?: string;
}) {
  const vocabulary = useVocabulary();
  const marks = useMemo(() => given ?? evidenceOf(result, vocabulary), [given, result, vocabulary]);
  if (!marks.length) return null;
  const shown = compact ? marks.slice(0, max) : marks;
  const rest = marks.length - shown.length;
  return (
    <ul className={`evidence ${compact ? "evidence--compact" : ""}`} aria-label={label}>
      {shown.map((mark) => (
        <Mark key={`${mark.kind}|${mark.label}`} mark={mark} links={{ readAtHref, askHref }} />
      ))}
      {rest > 0 ? (
        <li className="evidence__mark evidence__mark--more">
          <Toggletip
            label={`${rest} more: ${marks
              .slice(shown.length)
              .map((m) => m.label.replace(/`/g, ""))
              .join("; ")}`}
            tip={
              <span className="evidence__card">
                {marks.slice(shown.length).map((m) => (
                  <span key={`${m.kind}|${m.label}`} className="evidence__card-detail">
                    <EvidenceGlyph tone={m.tone} /> <Prose text={m.label} />
                  </span>
                ))}
              </span>
            }
          >
            + {rest} more
          </Toggletip>
        </li>
      ) : null}
    </ul>
  );
}
