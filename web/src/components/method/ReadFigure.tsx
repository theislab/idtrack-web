// Stage a on a real answer: how the typed string was read. The steps of a match in idtrack's order (the api's
// vocabulary, `match_steps`), each tried on names, then on synonyms, before the next (idtrack's documentation, "How an
// Identifier Is Read"): the steps before the one that matched found nothing, the one the answer names (`match`) found
// the identifier of the graph (`graph_id`), the later ones were not needed; the prefixes that applied before it; the
// release it was read at, and whether that release was given or inferred; the databases that attach it there.
import type { ConversionResult } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { matchParts, spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { firstSentence, readerText } from "../../lib/method/readerText";
import { Mono, Prose } from "../ui";

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
        <span className="label">Typed</span>
        <q className="read-fig__typed mono">{result.query_id}</q>
        {prefixes.length ? (
          <ul className="read-fig__prefixes" aria-label="Prefixes of the match that applied">
            {prefixes.map((p) => (
              <li key={p.code}>
                <span className="mono">{spaced(p.code)}</span>
                {p.meaning ? (
                  <span className="read-fig__meaning">
                    {" "}
                    <Prose text={p.meaning} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ol className="read-fig__steps" aria-label="The steps of a match, in the order idtrack tries them">
        {steps.map(([code, meaning], i) => {
          const state = at < 0 ? "unknown" : i < at ? "missed" : i === at ? "matched" : "unneeded";
          return (
            <li key={code} className={`read-fig__step read-fig__step--${state}`}>
              <span className="read-fig__n mono" aria-hidden="true">
                {i + 1}
              </span>
              <span className="read-fig__mark" aria-hidden="true" />
              <span className="read-fig__code mono">{spaced(code)}</span>
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
              {meaning ? (
                <span className="read-fig__meaning">
                  <Prose text={state === "matched" ? meaning : readerText(firstSentence(meaning))} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="read-fig__out">
        <p>
          <span className="label">Read at release</span> <Mono strong>{result.from_release ?? "—"}</Mono>{" "}
          <span className="muted">
            {result.from_release_inferred
              ? "(no release given: inferred)"
              : result.from_release_given !== null
                ? "(as given)"
                : ""}
          </span>
        </p>
        {result.from_databases.length ? (
          <p>
            <span className="label">Attached there by</span> {result.from_databases.map(databaseLabel).join(", ")}
          </p>
        ) : null}
        {entries.length ? (
          <p>
            <span className="label">{entries.length === 1 ? "Entry gene" : "Entry genes"}</span>{" "}
            {entries.map((g, i) => (
              <span key={g}>
                <Mono>{g}</Mono>
                {i < entries.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
