// Stage a on a real answer, drawn: the typed string at the left; the steps of a match as a ladder of dots joined by a
// hairline, in IDTrack's order (the api's vocabulary, `match_steps`), each tried on names, then on synonyms, before the
// next (IDTrack's documentation, "How an Identifier Is Read"): the steps before the one that matched found nothing
// (hollow), the one the answer names (`match`) found the identifier of the graph (`graph_id`, filled, the thread turning
// out of the ladder to it), the later ones were not needed (faint); the prefixes that applied before it; at the right,
// the release it was read at, whether that release was given or inferred, the databases that attach it there and its
// entry genes. Each step's name opens what it compares (a hover card); its order is the ladder's.
import type { ConversionResult } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { matchParts } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Mono } from "../ui";
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
      <ol className="read-fig__steps" aria-label="The steps of a match, in the order IDTrack tries them">
        {steps.map(([code, meaning], i) => {
          const state = at < 0 ? "unknown" : i < at ? "missed" : i === at ? "matched" : "unneeded";
          return (
            <li key={code} className={`read-fig__step read-fig__step--${state}`}>
              <span className="read-fig__mark" aria-hidden="true" />
              <Defined className="read-fig__code" code={code} meaning={meaning} />
              <span className="read-fig__state">
                {state === "matched" ? (
                  <>
                    matched <Mono strong>{result.graph_id ?? "—"}</Mono>
                  </>
                ) : state === "missed" ? (
                  "no match"
                ) : state === "unneeded" ? (
                  "not needed"
                ) : (
                  ""
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <dl className="read-fig__out">
        <div>
          <dt>Read at release</dt>
          <dd>
            <Mono strong>{result.from_release ?? "—"}</Mono>{" "}
            <span className="muted">
              {result.from_release_inferred
                ? "(no release given: inferred)"
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
