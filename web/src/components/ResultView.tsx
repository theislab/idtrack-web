// One conversion's answer: what it is, why, the path, the ranked candidates, and the api's answer as sent.
import { useId, useMemo, useState } from "react";
import type { Candidate, ConversionResult, GraphDescription } from "../api/types";
import { assemblyBands } from "../lib/bands";
import { convertHref, plainConversion } from "../lib/convertParameters";
import { databaseLabel } from "../lib/databases";
import { bestWords, noTargetOf } from "../lib/noTarget";
import { buildModel, type Decision, type PathModel } from "../lib/pathModel";
import { assemblyNames, readingText, stepSentence, candidateTitle, type AssemblyNames } from "../lib/pathReading";
import { ABSENT, criterionValue, firstWords, prose } from "../lib/values";
import { criterionOf, matchParts, spaced, statusTitle, type Criterion } from "../lib/vocabulary";
import { href } from "../lib/router";
import { useVocabulary } from "../lib/vocabularyContext";
import { BridgesConsidered, RefusedSteps } from "./PathChecks";
import { PathView } from "./PathView";
import {
  CopyButton,
  Disclosure,
  Link,
  Mono,
  Prose,
  Readout,
  SectionTitle,
  Skeleton,
  StatusBadge,
  TableFrame,
} from "./ui";

/** The ranking record of a candidate, in idtrack's order of the criteria, where the api's vocabulary is not at hand. */
const RECORD: Criterion[] = [
  "own_version",
  "final_confidence",
  "bridges",
  "bridge_gap",
  "display_name",
  "entry_support",
  "score",
  "same_as_query",
  "annotation",
].map((code) => ({ code, meaning: null, fields: [] }));

/** The criterion's value of a candidate, typed, with the sort-key mark where the api gives no reading of its parts. */
function CriterionValue({ criterion, candidate }: { criterion: Criterion; candidate: Candidate }) {
  const shown = criterionValue(criterion, candidate);
  return <Mono title={shown.title}>{shown.text}</Mono>;
}

export function DecisionText({ decision }: { decision: Decision }) {
  const vocabulary = useVocabulary();
  const criterion: Criterion = criterionOf(vocabulary, decision.key) ?? {
    code: decision.key,
    meaning: null,
    fields: [],
  };
  const meaning = criterion.meaning;
  const best = decision.best.api;
  const runner = decision.runnerUp.api;
  const sortKey = criterionValue(criterion, best).sortKey === true;
  return (
    <div className="decision">
      <p className="decision__head">
        <span className="eyebrow">Decided by</span> <strong>{spaced(decision.key)}</strong>
      </p>
      {meaning ? (
        <p className="decision__meaning">
          <Prose text={meaning} />
        </p>
      ) : (
        <p className="decision__meaning muted">The api gives no text for this criterion.</p>
      )}
      <p>
        The best answer <Mono strong>{best.target}</Mono>: <CriterionValue criterion={criterion} candidate={best} />;
        the runner-up <Mono>{runner.target}</Mono> (rank {decision.runnerUp.index + 1}):{" "}
        <CriterionValue criterion={criterion} candidate={runner} />.
      </p>
      {criterion.fields.length ? (
        <p className="decision__rule muted">{criterion.fields.map(firstWords).join("; ")}.</p>
      ) : null}
      {sortKey ? (
        <p className="decision__fallback">
          <span className="tag">as given</span> idtrack gives this value as its sort key; the text above names its
          parts, and the api gives no reading of each part. The values are shown as idtrack wrote them.
        </p>
      ) : null}
      {vocabulary.criteria.length ? (
        <p className="decision__order">
          The criteria decide in this order, the first that differs wins:{" "}
          {vocabulary.criteria.map((c, i) => (
            <span
              key={c.code}
              className={
                c.code === decision.key ? "decision__criterion decision__criterion--on" : "decision__criterion"
              }
            >
              {spaced(c.code)}
              {i < vocabulary.criteria.length - 1 ? " › " : ""}
            </span>
          ))}
          .
        </p>
      ) : null}
    </div>
  );
}

/** The quiet code of a status or reason, with its meaning on focus. */
function Code({ code, meaning }: { code: string; meaning: string | null | undefined }) {
  return (
    <span className="code-quiet" title={meaning ? prose(meaning) : undefined}>
      {code}
    </span>
  );
}

/** Every reason of a result, the first (`reason`) first, each with its meaning on focus. */
function Reasons({ codes }: { codes: readonly string[] }) {
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

/** For a result with targets: what else the reasons say (read at another release, a version not judged). */
function ReasonNotes({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  if (!result.reasons.length) return null;
  return (
    <ul className="answer__notes">
      {result.reasons.map((code) => {
        const meaning = vocabulary.reasons.get(code);
        return (
          <li key={code}>
            <Code code={code} meaning={meaning} />
            {meaning ? (
              <>
                {": "}
                <Prose text={meaning} />
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Answer({
  result,
  requestedDatabase,
  organism,
}: {
  result: ConversionResult;
  requestedDatabase: string | null;
  organism: string;
}) {
  const vocabulary = useVocabulary();
  const bests = result.candidates.filter((c) => c.best);
  const reason = result.reason;
  const reasonMeaning = reason ? vocabulary.reasons.get(reason) : null;
  const asked = requestedDatabase ?? "ensembl_gene";
  const head = (
    <p className="answer__query">
      <Mono strong>{result.query_id}</Mono>
      <span className="answer__arrow" aria-hidden="true">
        →
      </span>
      <span className="answer__release">
        release <Mono>{result.to_release}</Mono> · {databaseLabel(asked)}
      </span>
    </p>
  );

  const absent = noTargetOf(result);
  if (absent) {
    // The absence is the best answer's only: idtrack takes the target from the genes of the best answer, and does not
    // look the other genes reached up in the database (they may have an id there).
    return (
      <div className="answer answer--none">
        {head}
        <p className="answer__headline">
          No {databaseLabel(asked)} for {bestWords(absent.best)} at release {result.to_release}
        </p>
        <p className="answer__reached">
          <span className="answer__reached-label">Best answer</span>{" "}
          {absent.best.map((gene, i) => (
            <span key={gene}>
              <Mono>{gene}</Mono>
              {i < absent.best.length - 1 ? ", " : ""}
            </span>
          ))}{" "}
          <span className="muted">(Ensembl gene)</span>
        </p>
        {absent.others.length ? (
          <div className="answer__others">
            <p>
              {absent.others.length === 1 ? "One other gene was" : `${absent.others.length} other genes were`} reached,
              ranked below; idtrack takes the target from the best answer only, so{" "}
              {absent.others.length === 1 ? "its id" : "their ids"} in {databaseLabel(asked)} were not looked up. To
              have them, convert each to {databaseLabel(asked)}:
            </p>
            <ul className="answer__other-genes">
              {absent.others.map((gene) => (
                <li key={gene}>
                  <Link
                    to={convertHref(organism, {
                      ...plainConversion(gene),
                      toRelease: result.to_release,
                      finalDatabase: requestedDatabase,
                    })}
                  >
                    <Mono>{gene}</Mono>
                    <span className="visually-hidden"> converted to {databaseLabel(asked)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {absent.limitation ? (
              <p className="answer__limitation">
                A known limitation of idtrack: <Prose text={absent.limitation} />{" "}
                <Link to={href("/about")}>idtrack&apos;s limitations</Link>
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="answer__codes">
          <StatusBadge status={result.status} />
          <Reasons codes={result.reasons.length ? result.reasons : reason ? [reason] : []} />
        </p>
      </div>
    );
  }

  if (!bests.length) {
    return (
      <div className="answer answer--none">
        {head}
        <p className="answer__headline">
          {reasonMeaning ? <Prose text={reasonMeaning} /> : `${statusTitle(result.status)}.`}
        </p>
        {result.known_versions.length ? (
          <p>
            Versions the graph holds:{" "}
            {result.known_versions.map((v, i) => (
              <span key={v}>
                <Mono>{v}</Mono>
                {i < result.known_versions.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        ) : null}
        {result.error ? (
          <p className="answer__error">
            <Mono>{result.error.type}</Mono>: {result.error.message}
          </p>
        ) : null}
        <p className="answer__codes">
          <StatusBadge status={result.status} />
          <Reasons codes={result.reasons.length ? result.reasons : reason ? [reason] : []} />
        </p>
      </div>
    );
  }

  return (
    <div className="answer">
      {head}
      <p className="answer__targets">
        {bests.map((c) => (
          <span key={`${c.gene}|${c.target}`} className="answer__target">
            <Mono strong>{c.target}</Mono>
            {c.target !== c.gene ? (
              <span className="answer__gene">
                gene <Mono>{c.gene}</Mono>
              </span>
            ) : null}
            <CopyButton text={c.target} what={c.target} />
          </span>
        ))}
      </p>
      <p className="answer__codes">
        <StatusBadge status={result.status} />
        {result.tie ? <span className="muted"> {bests.length} answers equal in every criterion</span> : null}
      </p>
      <ReasonNotes result={result} />
    </div>
  );
}

function Reading({ model, names, id }: { model: PathModel; names: AssemblyNames; id: string }) {
  const text = useMemo(() => readingText(model, names), [model, names]);
  return (
    <div className="reading" id={id}>
      <div className="reading__head">
        <h3>The path in words</h3>
        <CopyButton text={text} what="the path in words" />
      </div>
      <ol className="reading__candidates">
        {model.candidates.map((candidate) => (
          <li
            key={candidate.index}
            className={candidate.best ? "reading__candidate reading__candidate--best" : "reading__candidate"}
          >
            <p className="reading__title">{candidateTitle(candidate)}</p>
            {candidate.steps.length ? (
              <ol className="reading__steps">
                {candidate.steps.map((index) => {
                  const step = model.steps[index];
                  return step ? (
                    <li key={index} className={`reading__step reading__step--${step.hue}`}>
                      {stepSentence(step, model, names)}
                    </li>
                  ) : null;
                })}
              </ol>
            ) : (
              <p className="muted">No path: asked without the path.</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Candidates({
  result,
  decided,
  onHighlight,
  highlight,
}: {
  result: ConversionResult;
  decided: string | null;
  onHighlight: (index: number | null) => void;
  highlight: number | null;
}) {
  const vocabulary = useVocabulary();
  // The criteria in the order in which they decide, as the api gives them (the record of every candidate).
  const criteria = vocabulary.criteria.length ? vocabulary.criteria : RECORD;
  const fieldText = (field: string) => {
    const meaning = vocabulary.candidateFields.get(field);
    return meaning ? prose(meaning) : undefined;
  };
  // The gene column only where a target is not the gene itself (a database other than Ensembl's).
  const geneColumn = result.candidates.some((c) => c.target !== c.gene);
  return (
    <TableFrame label="Candidates, ranked" className="table-frame--cards">
      <table className="table table--candidates table--cards">
        <caption className="visually-hidden">
          Every target the search reached, ranked, with the evidence idtrack compared, in the order in which the
          criteria decide. The column of the deciding criterion is marked.
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Target</th>
            {geneColumn ? <th scope="col">Gene</th> : null}
            <th scope="col">Entry gene</th>
            <th scope="col" title={fieldText("entry_databases")}>
              Read through
            </th>
            {criteria.map((c) => (
              <th
                key={c.code}
                scope="col"
                className={c.code === decided ? "is-decided" : undefined}
                title={c.meaning ? prose(c.meaning) : undefined}
              >
                {spaced(c.code)}
              </th>
            ))}
            <th scope="col">Steps external, history</th>
          </tr>
        </thead>
        <tbody>
          {result.candidates.map((c, i) => (
            <tr
              key={`${c.gene}|${c.target}|${i}`}
              className={`${c.best ? "is-best" : ""} ${highlight === i ? "is-highlighted" : ""}`}
              onMouseEnter={() => onHighlight(i)}
              onMouseLeave={() => onHighlight(null)}
            >
              <td className="num" data-label="Rank">
                {i + 1}
                {c.best ? <span className="tag">best</span> : null}
              </td>
              <td data-label="Target">
                <Mono strong={c.best}>{c.target}</Mono>
              </td>
              {geneColumn ? (
                <td data-label="Gene">
                  <Mono>{c.gene}</Mono>
                </td>
              ) : null}
              <td data-label="Entry gene">
                <Mono>{c.entry_gene}</Mono>
              </td>
              <td data-label="Read through">
                {c.entry_databases.length ? c.entry_databases.map(databaseLabel).join(", ") : ABSENT}
                {c.authority ? (
                  <span className="tag" title={fieldText("authority")}>
                    authority
                  </span>
                ) : null}
              </td>
              {criteria.map((col) => (
                <td
                  key={col.code}
                  className={`num ${col.code === decided ? "is-decided" : ""}`}
                  data-label={spaced(col.code)}
                >
                  <CriterionValue criterion={col} candidate={c} />
                </td>
              ))}
              <td className="num" data-label="Steps external, history">
                <Mono>
                  {c.external_steps}, {c.history_steps}
                </Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** A match as idtrack writes it, each part with its meaning on focus. */
function Match({ match }: { match: string }) {
  const vocabulary = useVocabulary();
  const parts = matchParts(vocabulary, match);
  return (
    <span className="match">
      {parts.map((part, i) => (
        <span key={`${part.code}|${i}`}>
          <span className="code-quiet" title={part.meaning ? prose(part.meaning) : undefined}>
            {part.code}
          </span>
          {i < parts.length - 1 ? ":" : ""}
        </span>
      ))}
    </span>
  );
}

/** The other nodes the identifier was read as, with what they would answer and why each is reported. */
function OtherReadings({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  if (!result.other_readings.length) return null;
  return (
    <TableFrame label="Other readings of the identifier" className="table-frame--cards">
      <table className="table table--readings table--cards">
        <caption className="visually-hidden">
          The other nodes of the graph the identifier was read as: how it matched each, why it is reported, the genes a
          conversion of it gives, and the releases at which the string has that meaning.
        </caption>
        <thead>
          <tr>
            <th scope="col">Read as</th>
            <th scope="col">Match</th>
            <th scope="col">Why reported</th>
            <th scope="col">Its answer</th>
            <th scope="col">At releases</th>
          </tr>
        </thead>
        <tbody>
          {result.other_readings.map((reading) => {
            const why = vocabulary.readingReasons.get(reading.reason);
            return (
              <tr key={`${reading.graph_id}|${reading.reason}`}>
                <td data-label="Read as">
                  <Mono>{reading.graph_id}</Mono>
                </td>
                <td data-label="Match">
                  <Match match={reading.match} />
                </td>
                <td data-label="Why reported">
                  <span className="code-quiet" title={why ? prose(why) : undefined}>
                    {spaced(reading.reason)}
                  </span>
                </td>
                <td data-label="Its answer">
                  {reading.genes.length ? <Mono>{reading.genes.join(", ")}</Mono> : "no gene"}
                </td>
                <td data-label="At releases">
                  {reading.releases.length ? <Mono>{reading.releases.join(", ")}</Mono> : ABSENT}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}

function Details({ result }: { result: ConversionResult }) {
  return (
    <dl className="readouts">
      <Readout label="Read as">
        {result.graph_id === null ? "not in the graph" : <Mono>{result.graph_id}</Mono>}
      </Readout>
      <Readout label="Match">{result.match ? <Match match={result.match} /> : ABSENT}</Readout>
      <Readout label="From release">
        {result.from_release === null ? ABSENT : <Mono>{result.from_release}</Mono>}{" "}
        <span className="muted">
          {result.from_release_inferred ? "inferred by idtrack" : "as given"}
          {result.from_release_fallback
            ? `; ${result.from_release_given ?? ""} was given, where the graph does not hold the identifier`
            : ""}
        </span>
      </Readout>
      <Readout label="To release">
        <Mono>{result.to_release}</Mono>
      </Readout>
      <Readout label="Read through" wide>
        {result.from_databases.length ? result.from_databases.map(databaseLabel).join(", ") : ABSENT}
      </Readout>
      {result.known_versions.length ? (
        <Readout label="Versions the graph holds" wide>
          <Mono>{result.known_versions.join(", ")}</Mono>
        </Readout>
      ) : null}
      {result.alternative_locus_genes.length ? (
        <Readout label="Also on alternative loci (not candidates)" wide>
          <Mono>{result.alternative_locus_genes.join(", ")}</Mono>
        </Readout>
      ) : null}
      {result.no_target_genes.length ? (
        <Readout label="Reached without an id in the database (not candidates)" wide>
          <Mono>{result.no_target_genes.join(", ")}</Mono>
        </Readout>
      ) : null}
      <Readout label="Reasons" wide>
        {result.reasons.length ? <Reasons codes={result.reasons} /> : "none: targets read as asked"}
      </Readout>
    </dl>
  );
}

export function ResultView({
  result,
  raw,
  description,
  requestedDatabase,
}: {
  result: ConversionResult;
  raw: string;
  description: GraphDescription;
  /** The database the conversion asked for (`null`: Ensembl genes), named when the best answer has no id in it. */
  requestedDatabase: string | null;
}) {
  const model = useMemo(() => buildModel(result), [result]);
  const names = useMemo(() => assemblyNames(description.assemblies), [description]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const readingId = useId();
  const hasPath = model.steps.length > 0;
  return (
    <article className="result" aria-label={`The conversion of ${result.query_id}`}>
      <Answer result={result} requestedDatabase={requestedDatabase} organism={description.organism} />
      {model.decision ? <DecisionText decision={model.decision} /> : null}
      {model.problems.length ? (
        <div className="notice notice--danger" role="alert">
          <p className="notice__title">The path the api sent is not consistent</p>
          <ul>
            {model.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasPath ? (
        <section aria-labelledby={`${readingId}-title`} className="result__path">
          <SectionTitle id={`${readingId}-title`}>The path through the releases</SectionTitle>
          <PathView
            model={model}
            description={description}
            names={names}
            highlight={highlight}
            readingId={readingId}
            requestedDatabase={requestedDatabase}
          />
          <Reading model={model} names={names} id={readingId} />
        </section>
      ) : result.candidates.length ? (
        <p className="muted">The path was not asked for (Show the path is off).</p>
      ) : null}
      {result.candidates.length ? (
        <section className="result__candidates" aria-labelledby={`${readingId}-candidates`}>
          <SectionTitle
            id={`${readingId}-candidates`}
            aside={<span className="muted">{result.candidates.length} in all, ranked</span>}
          >
            {result.no_target
              ? `Genes reached, ranked (no ${databaseLabel(requestedDatabase ?? "ensembl_gene")} for the best answer; the others not looked up)`
              : "Candidates"}
          </SectionTitle>
          <Candidates result={result} decided={result.decided_by} highlight={highlight} onHighlight={setHighlight} />
        </section>
      ) : null}
      {result.path ? <BridgesConsidered path={result.path} model={model} id={readingId} /> : null}
      {result.path ? <RefusedSteps path={result.path} model={model} names={names} id={readingId} /> : null}
      <section className="result__details" aria-label="How the identifier was read">
        <SectionTitle>How the identifier was read</SectionTitle>
        <Details result={result} />
        <OtherReadings result={result} />
      </section>
      <Disclosure summary="The api's answer, as sent">
        <div className="raw__head">
          <CopyButton text={raw} what="the api's answer" />
        </div>
        <pre className="raw" role="region" aria-label="The api's answer" tabIndex={0}>
          {raw}
        </pre>
      </Disclosure>
    </article>
  );
}

/** The layout of a result while it loads: the answer line, the release axis with its assembly bands, a table. */
export function ResultSkeleton({ description }: { description: GraphDescription }) {
  const bands = assemblyBands(description);
  const total = description.releases.length || 1;
  return (
    <div className="result result--loading" aria-label="Converting">
      <p className="visually-hidden">Converting…</p>
      <div className="answer">
        <Skeleton width="40%" height={22} />
        <Skeleton width="62%" height={34} className="skeleton--gap" />
      </div>
      <div className="skeleton-axis" aria-hidden="true">
        {bands.map((band) => (
          <div
            key={band.assembly}
            className="skeleton-axis__band"
            style={{
              flexGrow: band.last - band.first + 1,
              flexBasis: `${((band.last - band.first + 1) / total) * 100}%`,
            }}
          >
            <span className="skeleton-axis__name">{band.name}</span>
          </div>
        ))}
        <div className="skeleton-axis__track">
          <Skeleton width="55%" height={3} />
          <Skeleton width="35%" height={3} />
        </div>
      </div>
      <Skeleton width="100%" height={120} />
    </div>
  );
}
