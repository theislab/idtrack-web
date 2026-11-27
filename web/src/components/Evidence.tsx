// The evidence of an answer a reader should weigh, where the answer is: one short mark per class (`lib/evidence.ts`),
// each opening on a press to what the result says, idtrack's meaning of the code it is read from, the code itself, and
// the limitation of idtrack's documentation it falls under. A caution is marked by a small triangle, a note by a dot
// (shape and words, never colour alone). `compact` draws the marks small, at most `max` of them and "+ N more", for a
// table's cell.
import { useMemo } from "react";
import type { ConversionResult } from "../api/types";
import { evidenceOf, type EvidenceMark } from "../lib/evidence";
import { useVocabulary } from "../lib/vocabularyContext";
import { Toggletip } from "./Toggletip";
import { Link, Prose } from "./ui";
import "../styles/evidence.css";

function Glyph({ tone }: { tone: EvidenceMark["tone"] }) {
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

function Card({ mark, readAtHref }: { mark: EvidenceMark; readAtHref?: ((release: number) => string) | undefined }) {
  return (
    <span className="evidence__card">
      <span className="evidence__card-kind">{mark.tone === "caution" ? "Caution" : "Note"}</span>
      <span className="evidence__card-detail">
        <Prose text={mark.detail} />
      </span>
      {mark.meaning ? (
        <span className="evidence__card-meaning">
          <span className="evidence__card-source">idtrack:</span> <Prose text={mark.meaning} />
        </span>
      ) : null}
      {mark.readAt !== undefined && readAtHref ? (
        <span className="evidence__card-action">
          <Link to={readAtHref(mark.readAt)}>Read it at release {mark.readAt} →</Link>
        </span>
      ) : null}
      {mark.limitation ? (
        <span className="evidence__card-limitation">
          <span className="evidence__card-source">A known limitation of idtrack:</span> {mark.limitation.lead}{" "}
          <a href={mark.limitation.href} target="_blank" rel="noreferrer">
            {mark.limitation.title}
            <span className="visually-hidden"> (idtrack&apos;s documentation, opens in a new tab)</span>
            <span aria-hidden="true"> ↗</span>
          </a>
        </span>
      ) : null}
      <span className="evidence__card-code mono">{mark.code}</span>
    </span>
  );
}

function Mark({ mark, readAtHref }: { mark: EvidenceMark; readAtHref?: ((release: number) => string) | undefined }) {
  const words = mark.label.replace(/`/g, "");
  return (
    <li className={`evidence__mark evidence__mark--${mark.tone}`}>
      <Toggletip
        tip={<Card mark={mark} readAtHref={readAtHref} />}
        label={`${mark.tone === "caution" ? "Caution" : "Note"}: ${words}`}
      >
        <Glyph tone={mark.tone} />
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
        <Mark key={`${mark.kind}|${mark.label}`} mark={mark} readAtHref={readAtHref} />
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
                    <Glyph tone={m.tone} /> <Prose text={m.label} />
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
