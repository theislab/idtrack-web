// Stage a on a real answer, drawn: the typed string at the left; the steps of a match as a ladder of dots joined by a
// hairline, in IDTrack's order (the api's vocabulary, `match_steps`), each tried on names, then on synonyms, before the
// next (IDTrack's documentation, "How an Identifier Is Read"): the steps before the one that matched found nothing
// (hollow), the one the answer names (`match`) found the identifier of the graph (`graph_id`, filled, the thread turning
// out of the ladder to it), the later ones were not needed (faint); the prefixes that applied before it; at the right,
// the release it was read at, whether that release was given or inferred, the databases that attach it there and its
// entry genes. What each step compares is one hover card over the ladder (one control for the six); the states are
// drawn (the caption's claim keys them) and said in words to assistive technology.
import type { ConversionResult } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { firstSentence, readerText } from "../../lib/method/readerText";
import { matchParts, spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Mono, Prose } from "../ui";
import { HoverCard } from "../v2/HoverCard";
import { Defined } from "./Defined";

export function ReadFigure({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  const parts = result.match ? matchParts(vocabulary, result.match) : [];
  const step = parts.find((p) => p.role === "step")?.code ?? null;
  const prefixes = parts.filter((p) => p.role === "prefix");
  const steps = [...vocabulary.matchSteps.entries()];
  const at = steps.findIndex(([code]) => code === step);
  const entries = [...new Set(result.candidates.map((c) => c.entry_gene))];
  return (
    <div className="read-fig">
      <div className="read-fig__in">
        <span className="read-fig__label">Typed</span>
        <q className="read-fig__typed mono">{result.query_id}</q>
        {prefixes.length ? (
          <ul className="read-fig__prefixes" aria-label="Prefixes of the match that applied">
            {prefixes.map((p) => (
              <li key={p.code}>
                <Defined code={p.code} meaning={p.meaning} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="read-fig__ladder">
        <HoverCard
          className="read-fig__about"
          triggerClassName="read-fig__about-button"
          label="What each step of a match compares"
          trigger={
            <>
              <span className="read-fig__label">Steps of a match</span>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
              </svg>
            </>
          }
        >
          <dl className="read-fig__meanings">
            {steps.map(([code, meaning]) => (
              <div key={code}>
                <dt className="mono">{spaced(code)}</dt>
                <dd>{meaning ? <Prose text={readerText(firstSentence(meaning))} /> : "The api gives no meaning."}</dd>
              </div>
            ))}
          </dl>
        </HoverCard>
        <ol className="read-fig__steps" aria-label="The steps of a match, in the order IDTrack tries them">
          {steps.map(([code], i) => {
            const state = at < 0 ? "unknown" : i < at ? "missed" : i === at ? "matched" : "unneeded";
            return (
              <li key={code} className={`read-fig__step read-fig__step--${state}`}>
                <span className="read-fig__mark" aria-hidden="true" />
                <span className="read-fig__code mono">{spaced(code)}</span>
                <span className="read-fig__state">
                  {state === "matched" ? (
                    <>
                      matched <Mono strong>{result.graph_id ?? "—"}</Mono>
                    </>
                  ) : state === "missed" ? (
                    <span className="visually-hidden">no match</span>
                  ) : state === "unneeded" ? (
                    <span className="visually-hidden">not needed</span>
                  ) : (
                    ""
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <dl className="read-fig__out">
        <div>
          <dt>Read at release</dt>
          <dd>
            <Mono strong>{result.from_release ?? "—"}</Mono>{" "}
            <span className="muted">
              {result.from_release_inferred
                ? "(inferred: none given)"
                : result.from_release_given !== null
                  ? "(as given)"
                  : ""}
            </span>
          </dd>
        </div>
        {result.from_databases.length ? (
          <div>
            <dt>Attached there by</dt>
            <dd>{result.from_databases.map(databaseLabel).join(", ")}</dd>
          </div>
        ) : null}
        {entries.length ? (
          <div>
            <dt>{entries.length === 1 ? "Entry gene" : "Entry genes"}</dt>
            <dd>
              {entries.map((g, i) => (
                <span key={g}>
                  <Mono>{g}</Mono>
                  {i < entries.length - 1 ? ", " : ""}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
