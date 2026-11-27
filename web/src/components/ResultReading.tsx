// Panel c (the path in words: the steps of one candidate at a time as an aligned table, every history step written
// in Ensembl's direction with a mark where the walk went back in time; the whole reading of every candidate copied as
// text; the drawing's accessible description) and panel e (how the identifier was read: the reading, its other
// readings).
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import type { ConversionResult, GenePlace } from "../api/types";
import { databaseLabel } from "../lib/databases";
import type { Highlight } from "../lib/highlight";
import { groupedInteger, pythonFloat } from "../lib/numbers";
import { ensemblPair, type ModelCandidate, type ModelStep, type PathModel } from "../lib/pathModel";
import { api } from "../api/client";
import { useRequest } from "../lib/useRequest";
import {
  readingOrder,
  readingText,
  stableId,
  stepParts,
  unscoredUncounted,
  type AssemblyNames,
  assemblyText,
} from "../lib/pathReading";
import { scoreFloor } from "./figure/score";
import { StepGlyph } from "./figure/glyphs";
import { glyphOf, isEvent } from "./figure/glyph";
import { ABSENT } from "../lib/values";
import { useVocabulary } from "../lib/vocabularyContext";
import { IdMenu, type IdContext } from "./IdMenu";
import { FigurePanel, Match, Reasons, Term } from "./ResultParts";
import { usePhone } from "../lib/usePhone";
import { Button, CopyButton, Mono, Readout, Select, TableFrame } from "./ui";
import { useWidth } from "./figure/useWidth";
import { placeLayout, type PlaceRow } from "../lib/places";
import { textWidth } from "./figure/labels";

/** An id beside another of the same stable id: the shared part muted, the version strong (`ENSG00000141510` `.6`). */
function IdPair({ id, other, strong }: { id: string; other: string | null; strong?: boolean }) {
  const stable = stableId(id);
  if (other !== null && stable !== null && stable !== id && stableId(other) === stable) {
    return (
      <span className={`mono reading__id ${strong ? "mono--strong" : ""}`}>
        <span className="reading__id-stem">{stable}</span>
        {id.slice(stable.length)}
      </span>
    );
  }
  return <span className={`mono reading__id ${strong ? "mono--strong" : ""}`}>{id}</span>;
}

/** The kind of a step in a few words, for its column (its sentence, copied, says it whole). */
function kindWords(step: ModelStep, what: string): string {
  switch (step.api.kind) {
    case "entry":
      return "read as";
    case "bridge_near":
      return "leaves through";
    case "bridge_far":
      return "enters";
    case "final":
      return step.api.release === null ? "id at another release" : "id in the database";
    case "identity":
      return "its own answer";
    default:
      return what;
  }
}

/** How many of a candidate's first steps are those of another candidate (a tie and its alternatives share most). */
function sharedPrefix(a: ModelCandidate, b: ModelCandidate): number {
  let n = 0;
  while (n < a.steps.length && n < b.steps.length && a.steps[n] === b.steps[n]) n += 1;
  return n;
}

/** Ensembl's score of a step on the figures' one encoding (DESIGN.md, "One score encoding"), turned along the line:
 *  1.0 at the left, the path's floor at the right (0.9, or the tenth under its lowest score), a stem from 1.0 to the
 *  score with a dot at the score, in the hue of the step's kind. The digits beside it are the value. */
function ScoreMark({ weight, floor }: { weight: number; floor: number }) {
  const w = Math.max(floor, Math.min(1, weight));
  const x = 2 + ((1 - w) / (1 - floor || 1)) * 38;
  return (
    <svg className="steps__mark" width="44" height="10" viewBox="0 0 44 10" aria-hidden="true">
      <line className="steps__mark-track" x1="2" x2="40" y1="5" y2="5" />
      <line className="steps__mark-one" x1="2" x2="2" y1="2" y2="8" />
      <line className="steps__mark-stem" x1="2" x2={x} y1="5" y2="5" />
      <circle className="steps__mark-dot" cx={x} cy="5" r="2.4" />
    </svg>
  );
}

/** The kinds of step a reader meets rarely (an event of Ensembl's history, a crossing between assemblies, a bridge):
 *  their words stand out; the routine ones (a new version, a re-mapping, a reading) are plain. */
function whatClass(step: ModelStep): string {
  const rare = isEvent(step.api) || step.handoff !== null || step.kind === "bridge_near" || step.kind === "bridge_far";
  return `steps__what ${rare ? "steps__what--rare" : ""}`;
}

/** The step's glyph of the figure grammar, small, so that the table and the drawing name a kind one way. */
function StepMark({ step, model }: { step: ModelStep; model: PathModel }) {
  const source = step.api.source === null ? undefined : model.nodeById.get(step.api.source);
  const glyph = glyphOf(step.api, source?.api.kind);
  return (
    <svg className="steps__glyph" width="18" height="16" viewBox="0 0 18 16" aria-hidden="true" focusable="false">
      <StepGlyph
        glyph={glyph}
        x={9}
        y={glyph === "loop" ? 12 : 8}
        size="thin"
        event={glyph === "handoff" && isEvent(step.api)}
      />
    </svg>
  );
}

function StepRow({
  step,
  number,
  model,
  names,
  strong,
  highlight,
  context,
  floor,
  standing,
  nameEvents,
  firstKind,
  firstPlace,
}: {
  step: ModelStep;
  number: number;
  model: PathModel;
  names: AssemblyNames;
  strong: boolean;
  highlight: Highlight;
  context: IdContext;
  /** The floor of the candidate's scores, as its figure draws them. */
  floor: number;
  /** The release the walk stood at before this step (null: the first step). */
  standing: number | null;
  /** A split's or merge's other ids are named at once (a path of few such events), else on a press. */
  nameEvents: boolean;
  /** The first row of its kind of step (its words open idtrack's meaning; later rows of the kind say them plainly). */
  firstKind: boolean;
  /** The first row of its relation of places (likewise). */
  firstPlace: boolean;
}) {
  const vocabulary = useVocabulary();
  const parts = stepParts(step, model, names);
  const lit = useSyncExternalStore(highlight.subscribe, () => highlight.step() === step.index);
  const score = parts.facts.find((f) => f.kind === "score");
  // The id the walk arrives at is set strong (in a step walked backward, the earlier one).
  const targetName = model.nodeById.get(step.api.target)?.label ?? step.api.target;
  const others = parts.facts.filter((f) => f.kind !== "score");
  const history = step.api.kind === "history" || step.api.kind === "self_loop";
  const fromRelease = history ? step.api.old_release : step.api.release;
  const toRelease = history ? step.api.new_release : step.api.release;
  // A step that is not a history step but starts at an earlier release than the walk stood at (a bridge that leaves a
  // gene at a release before the one it was read at): the walk went back in time here, and the row says so.
  const back = !history && standing !== null && step.sourceRelease < standing ? step.sourceRelease : null;
  return (
    <tr
      className={`steps__row steps__row--${step.hue} ${lit ? "is-highlighted" : ""}`}
      onPointerEnter={() => highlight.setStep(step.index)}
      onPointerLeave={() => highlight.setStep(null)}
    >
      <td className="steps__n mono" data-label="Step">
        {number}
      </td>
      <td className="steps__when mono" data-label="Releases">
        {parts.when}
      </td>
      <td className="steps__ids" data-label={history ? "Ensembl's record" : "From, to"}>
        {parts.from !== null ? (
          <>
            <IdMenu id={parts.from} release={fromRelease ?? null} context={context}>
              <IdPair id={parts.from} other={null} strong={strong && parts.from === targetName} />
            </IdMenu>
            <span className="steps__arrow" aria-hidden="true">
              {" "}
              →{" "}
            </span>
            <span className="visually-hidden"> to </span>
          </>
        ) : null}
        <IdMenu id={parts.to} release={toRelease ?? null} context={context}>
          <IdPair id={parts.to} other={parts.from} strong={strong && parts.to === targetName} />
        </IdMenu>
      </td>
      <td className="steps__kind" data-label="Step">
        <StepMark step={step} model={model} />
        {firstKind ? (
          <Term
            code={step.api.reason}
            meaning={vocabulary.stepReasons.get(step.api.reason)}
            words={<span className={whatClass(step)}>{kindWords(step, parts.what)}</span>}
          />
        ) : (
          <span className={whatClass(step)}>{kindWords(step, parts.what)}</span>
        )}
        {parts.backward ? (
          <span className="steps__walk" title="The walk took this step from its later id to its earlier one">
            <span aria-hidden="true">← </span>walked backward
          </span>
        ) : null}
        {back !== null && standing !== null ? (
          <span className="steps__walk">
            <span aria-hidden="true">← </span>back from release {standing} to {back}
          </span>
        ) : null}
      </td>
      <td className="steps__score mono" data-label="Score">
        {score ? (
          <>
            {typeof score.weight === "number" ? <ScoreMark weight={score.weight} floor={floor} /> : null}
            {score.weight === null ? (
              <span className={unscoredUncounted(step) ? "muted" : "steps__unscored"}>{score.text}</span>
            ) : (
              score.text.replace(/^score /, "")
            )}
          </>
        ) : (
          <span className="muted">{ABSENT}</span>
        )}
      </td>
      <td className="steps__facts" data-label="Place, assembly, databases">
        {others.length ? (
          others.map((fact, i) => (
            <span key={fact.kind} className={`steps__fact steps__fact--${fact.kind}`}>
              {i ? <span className="visually-hidden">, </span> : null}
              {fact.kind === "places" && step.api.places ? (
                firstPlace || step.api.places === "places_apart" ? (
                  <Term
                    code={step.api.places}
                    meaning={vocabulary.placeRelations.get(step.api.places)}
                    className={step.api.places === "places_apart" ? "steps__place--apart" : ""}
                  />
                ) : (
                  <span className="steps__place--again">{fact.text}</span>
                )
              ) : fact.kind === "counts" ? (
                <EventPeers step={step} model={model} context={context} text={fact.text} named={nameEvents} />
              ) : (
                fact.text
              )}
            </span>
          ))
        ) : (
          <span className="muted">{ABSENT}</span>
        )}
      </td>
    </tr>
  );
}

/** The steps of a path shown at first on a phone, where each is a card. */
const STEPS_PHONE = 6;

/** The splits and merges of a path whose other ids are named without a press (one request each), at most. */
const EVENTS_NAMED = 3;

/** The other ids of a split or a merge, named on a press. The api counts them (`splits`, `merges`) without naming them;
 *  they are the answer of the same history transition asked of the api: the earlier id converted from the event's old
 *  release to its new one names every id it passed to (a split), the later id converted back names every id that
 *  passed to it (a merge), Ensembl's history alone (no bridges). Each with Ensembl's score of its step. */
function EventPeers({
  step,
  model,
  context,
  text,
  named,
}: {
  step: ModelStep;
  model: PathModel;
  context: IdContext;
  text: string;
  /** Named at once, without a press. */
  named: boolean;
}) {
  const [open, setOpen] = useState(named);
  const { earlier, later } = ensemblPair(step.api, step.direction);
  const a = step.api;
  const asks: { side: "split" | "merge"; id: string; from: number; to: number; self: string }[] = [];
  if (open && a.old_release !== null && a.new_release !== null && earlier !== null && later !== null) {
    if (a.splits) asks.push({ side: "split", id: earlier, from: a.old_release, to: a.new_release, self: later });
    if (a.merges) asks.push({ side: "merge", id: later, from: a.new_release, to: a.old_release, self: earlier });
  }
  return (
    <>
      {text}{" "}
      <Button
        variant="quiet"
        className="steps__peers-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? "Hide" : "Name them"}
      </Button>
      {asks.map((ask) => (
        <PeerList key={ask.side} ask={ask} model={model} context={context} />
      ))}
    </>
  );
}

function PeerList({
  ask,
  model,
  context,
}: {
  ask: { side: "split" | "merge"; id: string; from: number; to: number; self: string };
  model: PathModel;
  context: IdContext;
}) {
  const label = (id: string) => model.nodeById.get(id)?.label ?? id;
  const answer = useRequest(`peers:${context.organism}:${ask.id}:${ask.from}:${ask.to}`, (signal, fresh) =>
    api.convert(
      context.organism,
      { identifier: label(ask.id), from_release: ask.from, to_release: ask.to, explain: false, allow_bridges: false },
      { signal, fresh },
    ),
  );
  if (answer.state === "loading" || answer.state === "idle") return <span className="steps__peers muted">asking…</span>;
  if (answer.state === "failed")
    return <span className="steps__peers muted">The api did not answer ({answer.error.message}).</span>;
  const others = answer.answer.data.candidates.filter((c) => c.gene !== label(ask.self));
  return (
    <span className="steps__peers">
      {ask.side === "split" ? "Passed to also: " : "Passed to it also: "}
      {others.length
        ? others.map((c, i) => (
            <span key={c.gene}>
              {i ? ", " : ""}
              <IdMenu id={c.gene} release={ask.to} context={context} />{" "}
              <span className="muted">score {pythonFloat(c.score)}</span>
            </span>
          ))
        : "none named"}
      <span className="steps__peers-source muted">
        {" "}
        (the api&apos;s conversion of {label(ask.id)} from release {ask.from} to {ask.to}, without bridges)
      </span>
    </span>
  );
}

export const ReadingPanel = memo(function ReadingPanel({
  model,
  names,
  id,
  letter,
  highlight,
  context,
}: {
  model: PathModel;
  names: AssemblyNames;
  id: string;
  letter?: string;
  highlight: Highlight;
  context: IdContext;
}) {
  const firstBest = model.candidates.find((c) => c.best) ?? model.candidates[0];
  const [chosen, setChosen] = useState(firstBest?.index ?? 0);
  const phone = usePhone();
  const [everyStep, setEveryStep] = useState(false);
  const candidate = model.candidates[chosen] ?? firstBest;
  // The whole reading, every step of every candidate, is written only when it is copied.
  const text = useMemo(() => () => readingText(model, names), [model, names]);
  if (!candidate) return null;
  const shared = firstBest && candidate !== firstBest ? sharedPrefix(candidate, firstBest) : 0;
  const many = model.candidates.length > 1;
  const order = readingOrder(candidate, model);
  // On a phone each step is a card: the first few, the rest on a press.
  const rowsShown = phone && !everyStep ? Math.min(order.length, STEPS_PHONE) : order.length;
  // The splits and merges of this path whose other ids the api counts: named at once where they are few.
  const scored = order.some((i) => typeof model.steps[i]?.api.weight === "number");
  const events = order.filter((i) => {
    const a = model.steps[i]?.api;
    return a ? a.splits > 0 || a.merges > 0 : false;
  }).length;
  const floor = scoreFloor(
    order
      .map((i) => model.steps[i])
      .filter((s) => s?.api.kind === "history" || s?.api.kind === "self_loop")
      .map((s) => s?.api.weight ?? null),
  );
  return (
    <FigurePanel
      {...(letter ? { letter } : {})}
      title="The path in words"
      id={id}
      className="reading"
      aside={
        <>
          <span className="muted">
            {candidate.steps.length} step{candidate.steps.length === 1 ? "" : "s"} of candidate {candidate.index + 1}
            {many ? ` (of ${groupedInteger(model.candidates.length)})` : ""}
          </span>
          <CopyButton
            text={text}
            label="Copy"
            what={`the path in words${many ? `, every step of all ${model.candidates.length} candidates` : ""}`}
          />
        </>
      }
    >
      {many ? (
        <div className="reading__choose">
          <label className="field__label" htmlFor={`${id}-candidate`}>
            Candidate
          </label>
          <Select
            id={`${id}-candidate`}
            value={String(candidate.index)}
            onChange={(e) => {
              setChosen(Number(e.target.value));
            }}
          >
            {model.candidates.map((c) => (
              <option key={c.index} value={c.index}>
                {`${c.index + 1}. ${c.best ? "best" : "alternative"}: ${c.api.target}${c.api.target !== c.api.gene ? ` (gene ${c.api.gene})` : ""}`}
              </option>
            ))}
          </Select>
          <p className="reading__note muted">
            {shared > 0 && firstBest
              ? `Its first ${shared} step${shared === 1 ? " is" : "s are"} those of candidate ${firstBest.index + 1}. `
              : ""}
            Copy writes every step of every candidate.
          </p>
        </div>
      ) : null}
      <p className="reading__title">
        <span className="eyebrow">Candidate {candidate.index + 1}</span>{" "}
        <span className={candidate.best ? "tag tag--best" : "tag"}>{candidate.best ? "best" : "alternative"}</span>{" "}
        <Mono strong={candidate.best}>{candidate.api.target}</Mono>
        {candidate.api.target !== candidate.api.gene ? (
          <span className="muted">
            {" "}
            gene <Mono>{candidate.api.gene}</Mono>
          </span>
        ) : null}
      </p>
      {candidate.steps.length ? (
        <TableFrame label={`The steps of candidate ${candidate.index + 1}, in words`} className="steps-frame">
          <table className="table steps">
            <caption className="visually-hidden">
              Every step of candidate {candidate.index + 1}, in the walk&apos;s order: the releases, the two ids (a step
              of Ensembl&apos;s history in Ensembl&apos;s direction, the earlier id first, marked where the walk went
              back in time), the kind of step, Ensembl&apos;s score, and the place, assembly or databases.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="steps__n">
                  #
                </th>
                <th scope="col">Releases</th>
                <th scope="col">From → to</th>
                <th scope="col">Step</th>
                <th scope="col">Score</th>
                <th scope="col">Place, assembly, databases</th>
              </tr>
            </thead>
            <tbody>
              {order.slice(0, rowsShown).map((index, i) => {
                const step = model.steps[index];
                if (!step) return null;
                const before = i > 0 ? model.steps[order[i - 1] ?? -1] : undefined;
                const earlier = order.slice(0, i).map((j) => model.steps[j]?.api);
                return (
                  <StepRow
                    key={index}
                    step={step}
                    number={i + 1}
                    model={model}
                    names={names}
                    strong={candidate.best}
                    highlight={highlight}
                    context={context}
                    floor={floor}
                    standing={before ? before.targetRelease : null}
                    nameEvents={events <= EVENTS_NAMED}
                    firstKind={!earlier.some((a) => a?.reason === step.api.reason)}
                    firstPlace={!earlier.some((a) => a?.places === step.api.places)}
                  />
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      ) : (
        <p className="muted">No path: asked without the path.</p>
      )}
      {order.length > STEPS_PHONE && phone ? (
        <p className="reading__more">
          {rowsShown < order.length ? (
            <span className="muted">
              The first {rowsShown} of {order.length} steps.{" "}
            </span>
          ) : null}
          <Button variant="quiet" aria-expanded={rowsShown >= order.length} onClick={() => setEveryStep((v) => !v)}>
            {rowsShown < order.length ? `Show all ${order.length} steps` : `Show the first ${STEPS_PHONE}`}
          </Button>
        </p>
      ) : null}
      <p className="reading__key muted">
        A step of Ensembl&apos;s history is written as Ensembl recorded it: the earlier id at its last release, then the
        later id at its first, whichever way the walk went; <span aria-hidden="true">←</span> walked backward marks a
        step the walk took from the later id to the earlier one (a conversion to an earlier release). A step without
        Ensembl&apos;s score between two versions of one stable id is not counted among a path&apos;s steps without a
        score.
        {scored ? (
          <>
            {" "}
            Ensembl&apos;s score is drawn as in the figure: 1.0 at the left, the floor at{" "}
            <span className="mono">{pythonFloat(floor)}</span> at the right, the dot at the score.
          </>
        ) : null}{" "}
        A kind of step or a relation of places opens idtrack&apos;s meaning where the table first names it.
      </p>
    </FigurePanel>
  );
});

/** The other nodes the identifier was read as, with what they would answer and why each is reported. */
export function OtherReadings({ result, context }: { result: ConversionResult; context: IdContext }) {
  const vocabulary = useVocabulary();
  if (!result.other_readings.length) return null;
  return (
    <div className="reading-part">
      <h3 className="figure-panel__subtitle">
        Other readings of the identifier <span className="muted">{result.other_readings.length}</span>
      </h3>
      <TableFrame label="Other readings of the identifier" className="table-frame--cards">
        <table className="table table--readings table--cards">
          <caption className="visually-hidden">
            The other nodes of the graph the identifier was read as: how it matched each, why it is reported, the genes
            a conversion of it gives, and the releases at which the string has that meaning.
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
            {result.other_readings.map((reading) => (
              <tr key={`${reading.graph_id}|${reading.reason}`}>
                <td data-label="Read as">
                  <Mono>{reading.graph_id}</Mono>
                </td>
                <td data-label="Match">
                  <Match match={reading.match} />
                </td>
                <td data-label="Why reported" className="cell-wrap">
                  <Term code={reading.reason} meaning={vocabulary.readingReasons.get(reading.reason)} />
                </td>
                <td data-label="Its answer">
                  {reading.genes.length
                    ? reading.genes.map((gene, i) => (
                        <span key={gene}>
                          {i ? ", " : ""}
                          <IdMenu id={gene} release={result.to_release} context={context} />
                        </span>
                      ))
                    : "no gene"}
                </td>
                <td data-label="At releases">
                  {reading.releases.length ? <Mono>{reading.releases.join(", ")}</Mono> : ABSENT}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}

/** The copies the identifier also leads to, by their kind where the identifier scheme says it (`LRG_`). */
function copyKind(id: string): string {
  return /^LRG_\d+/.test(id) ? "LRG record" : "copy";
}

export function Details({ result }: { result: ConversionResult }) {
  const answers = new Set(result.candidates.filter((c) => c.best).map((c) => c.gene));
  return (
    <dl className="readouts">
      <Readout label="Read as">
        {result.graph_id === null ? "not in the graph" : <Mono>{result.graph_id}</Mono>}
      </Readout>
      <Readout label="Match">{result.match ? <Match match={result.match} /> : ABSENT}</Readout>
      <Readout label="From release">
        {result.from_release === null ? ABSENT : <Mono>{result.from_release}</Mono>}{" "}
        <span className="muted">
          {result.from_release === null
            ? "not read"
            : result.from_release_inferred
              ? "inferred by idtrack"
              : "as given"}
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
        <Readout
          label={`Copies set apart (patches, haplotypes, alternative loci, LRG records)${result.alternative_locus_genes.some((g) => answers.has(g)) ? "" : "; not candidates"}`}
          wide
        >
          <ul className="plain-list copies-list">
            {result.alternative_locus_genes.map((id) => (
              <li key={id}>
                <Mono>{id}</Mono>{" "}
                {answers.has(id) ? (
                  <span className="copies-list__answer">
                    the answer itself, also listed here by idtrack (a known limitation: the answer is right)
                  </span>
                ) : (
                  <span className="muted">{copyKind(id)}</span>
                )}
              </li>
            ))}
          </ul>
        </Readout>
      ) : null}
      {result.no_target_genes.length ? (
        <Readout label="Reached without an id in the database (not candidates)" wide>
          <Mono>{result.no_target_genes.join(", ")}</Mono>
        </Readout>
      ) : null}
      <Readout label="Reasons" wide>
        {result.reasons.length ? <Reasons codes={result.reasons} /> : "none apply"}
      </Readout>
    </dl>
  );
}

/** A part folded behind a one-line summary, laid out only once it is opened (a long table costs nothing until read). */
function Folded({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="disclosure reading-fold"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="disclosure__summary">{summary}</summary>
      <div className="disclosure__body">{open ? children : null}</div>
    </details>
  );
}

/** Where the genes of the best answer's path lie: each gene's places (assembly, region, first and last base, strand,
 *  releases) as the api sent them, so that "same place" and "places apart" can be read on the genome. */
function placeRows(genes: string[], model: PathModel): PlaceRow[] {
  const rows: PlaceRow[] = [];
  for (const id of genes) {
    for (const place of model.nodeById.get(id)?.api.places ?? []) {
      let row = rows.find((r) => r.assembly === place.assembly && r.region === place.region);
      if (!row) {
        row = { assembly: place.assembly, region: place.region, reference: place.reference, spans: [] };
        rows.push(row);
      }
      const label = model.nodeById.get(id)?.label ?? id;
      const same = row.spans.find(
        (sp) => sp.start === place.start && sp.end === place.end && sp.strand === place.strand,
      );
      if (same) {
        if (!same.genes.includes(label)) same.genes.push(label);
      } else row.spans.push({ start: place.start, end: place.end, strand: place.strand, genes: [label] });
    }
  }
  return rows;
}

/** The genes named by their versions where they share one stable id ("ENSG00000141510 .5–.11"), else in full. */
function versionsText(genes: string[]): string {
  const stems = new Set(genes.map((g) => stableId(g)));
  if (stems.size !== 1 || genes.length === 1) return genes.join(", ");
  const versions = genes.map((g) => Number(/\.(\d+)$/.exec(g)?.[1] ?? NaN));
  if (versions.some((v) => Number.isNaN(v))) return genes.join(", ");
  const sorted = [...versions].sort((a, b) => a - b);
  const contiguous = sorted.every((v, i) => i === 0 || v === (sorted[i - 1] ?? v) + 1);
  const list = contiguous ? `.${sorted[0]}–.${sorted[sorted.length - 1]}` : sorted.map((v) => `.${v}`).join(", ");
  return `${[...stems][0] ?? ""} ${list}`;
}

/** Where the genes of the chosen path lie, drawn: one row per assembly and region (on its own axis of bases, its first
 *  and last base written under it), each distinct span a bar with an arrow of its strand and its versions over it, so
 *  that "same place", a gene that moved and the change of assembly are seen at once. The table holds every value. */
function PlacesFigure({ rows, names }: { rows: PlaceRow[]; names: AssemblyNames }) {
  const { ref, width } = useWidth<HTMLDivElement>(0);
  const rowName = (row: PlaceRow) =>
    `${assemblyText(row.assembly, names)} · ${row.region}${row.reference ? "" : " (outside the reference)"}`;
  // The rows' names stand in a gutter as wide as the longest (measured), where it takes at most a third of the
  // figure; else each name stands above its row.
  const shown = rows.slice(0, 8);
  const longest = Math.max(0, ...shown.map((r) => textWidth(rowName(r))));
  const gutter = width >= 640 && longest + 24 <= width / 3 ? Math.ceil(longest) + 12 : 0;
  const layout = placeLayout(shown, gutter === 0);
  // Bases per pixel, shared by the rows: the widest row's range (with a margin) fills the plot.
  const widest = Math.max(
    1,
    ...shown.map((r) => Math.max(...r.spans.map((sp) => sp.end)) - Math.min(...r.spans.map((sp) => sp.start))),
  );
  const x0 = gutter + 12;
  const x1 = width - 12;
  const perPixel = (widest * 1.08) / Math.max(40, x1 - x0);
  return (
    <div className="places-fig fig" ref={ref}>
      {width > 0 ? (
        <svg
          width={width}
          height={layout.height}
          role="img"
          aria-label={`Where the genes of the chosen path lie: ${shown
            .map(
              (r) =>
                `${assemblyText(r.assembly, names)} ${r.region}: ${r.spans
                  .map((sp) => `${versionsText(sp.genes)} ${groupedInteger(sp.start)}–${groupedInteger(sp.end)}`)
                  .join("; ")}`,
            )
            .join(". ")}`}
        >
          {layout.rows.map(({ row, top, bars, axis, bases }) => {
            const lo = Math.min(...row.spans.map((sp) => sp.start));
            const hi = Math.max(...row.spans.map((sp) => sp.end));
            // One scale of bases for every row (a short gene is short beside a long one), each row centred on its own
            // range.
            const centre = (lo + hi) / 2;
            const x = (base: number) => (x0 + x1) / 2 + (base - centre) / perPixel;
            const range = `${groupedInteger(lo)}–${groupedInteger(hi)}`;
            const apart = x(hi) - x(lo) > textWidth(groupedInteger(lo)) + textWidth(groupedInteger(hi)) + 24;
            return (
              <g key={`${row.assembly}|${row.region}`}>
                {gutter ? (
                  <text className="fig-text places-fig__row" x={gutter} y={(bars[0] ?? top) + 4} textAnchor="end">
                    {rowName(row)}
                  </text>
                ) : (
                  // Above its row on a narrow figure, the assembly and region on one line and whether it is outside
                  // the reference on the next.
                  <text className="fig-text places-fig__row" x={x0} y={top + 11}>
                    {`${assemblyText(row.assembly, names)} · ${row.region}`}
                    {row.reference ? null : (
                      <tspan x={x0} dy={12}>
                        outside the reference
                      </tspan>
                    )}
                  </text>
                )}
                {row.spans.map((sp, i) => {
                  const by = bars[i] ?? top;
                  const a = x(sp.start);
                  const b = Math.max(a + 2, x(sp.end));
                  const label = versionsText(sp.genes);
                  // The span's versions over its bar, from its start where they fit before the plot's end.
                  const lx = Math.min(a, x1 - textWidth(label, 10));
                  return (
                    <g key={`${sp.start}|${sp.end}|${sp.strand}`} className="places-fig__span">
                      <title>{`${label}: ${groupedInteger(sp.start)}–${groupedInteger(sp.end)} (${sp.strand > 0 ? "+" : sp.strand < 0 ? "−" : String(sp.strand)} strand)`}</title>
                      <text className="fig-text places-fig__versions" x={Math.max(x0, lx)} y={by - 6}>
                        {label}
                      </text>
                      <rect className="places-fig__bar" x={a} y={by - 3} width={b - a} height={6} rx={1.5} />
                      {sp.strand !== 0 ? (
                        <path
                          className="places-fig__strand"
                          d={
                            sp.strand > 0
                              ? `M${b + 1},${by - 4}L${b + 5},${by}L${b + 1},${by + 4}`
                              : `M${a - 1},${by - 4}L${a - 5},${by}L${a - 1},${by + 4}`
                          }
                        />
                      ) : null}
                    </g>
                  );
                })}
                <line className="places-fig__axis" x1={x(lo)} x2={x(hi)} y1={axis} y2={axis} />
                <line className="places-fig__axis" x1={x(lo)} x2={x(lo)} y1={axis - 3} y2={axis + 3} />
                <line className="places-fig__axis" x1={x(hi)} x2={x(hi)} y1={axis - 3} y2={axis + 3} />
                {apart ? (
                  <>
                    <text className="fig-text places-fig__tick" x={x(lo)} y={bases} textAnchor="start">
                      {groupedInteger(lo)}
                    </text>
                    <text className="fig-text places-fig__tick" x={x(hi)} y={bases} textAnchor="end">
                      {groupedInteger(hi)}
                    </text>
                  </>
                ) : (
                  <text className="fig-text places-fig__tick" x={(x(lo) + x(hi)) / 2} y={bases} textAnchor="middle">
                    {range}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}

export function GenePlaces({ model, names }: { model: PathModel; names: AssemblyNames }) {
  const best = model.candidates.find((c) => c.best);
  if (!best) return null;
  const genes: string[] = [];
  for (const index of best.steps) {
    const step = model.steps[index];
    if (!step) continue;
    for (const id of [step.api.source, step.api.target]) {
      const node = id === null ? undefined : model.nodeById.get(id);
      if (node?.api.kind === "ensembl_gene" && node.api.places.length && !genes.includes(node.id)) genes.push(node.id);
    }
  }
  if (!genes.length) return null;
  const rows = genes.flatMap((id) =>
    (model.nodeById.get(id)?.api.places ?? []).map((place: GenePlace) => ({ id, place })),
  );
  const drawn = placeRows(genes, model);
  return (
    <div className="reading-part">
      <h3 className="figure-panel__subtitle">
        Where the genes of the chosen path lie{" "}
        <span className="muted">
          {genes.length} gene{genes.length === 1 ? "" : "s"}, {rows.length} place{rows.length === 1 ? "" : "s"}
        </span>
      </h3>
      <PlacesFigure rows={drawn} names={names} />
      <p className="fig-caption places-fig__caption">
        <strong className="fig-caption__lead">Each row is a sequence region of one assembly.</strong> Every row is on
        one scale of bases (a short gene is short beside a long one) and centred on its own first and last base, written
        under its axis; each bar is a span where genes of the path lie, drawn once for the versions written over it, its
        arrow the strand{drawn.length > 8 ? `; the first 8 of ${drawn.length} rows are drawn` : ""}.
      </p>
      <Folded summary={`Every place, as a table (${rows.length})`}>
        <TableFrame label="Where the genes of the chosen path lie" className="table-frame--cards">
          <table className="table table--places table--cards">
            <caption className="visually-hidden">
              Each gene of the best answer's path, in the order of the path, with every place the graph holds for it:
              the assembly, the sequence region, the first and the last base, the strand and the releases.
            </caption>
            <thead>
              <tr>
                <th scope="col">Gene</th>
                <th scope="col">Assembly</th>
                <th scope="col">Region</th>
                <th scope="col" className="num">
                  First base
                </th>
                <th scope="col" className="num">
                  Last base
                </th>
                <th scope="col">Strand</th>
                <th scope="col">Releases</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, place }, i) => (
                <tr key={`${id}|${i}`}>
                  <td data-label="Gene">
                    <Mono>{model.nodeById.get(id)?.label ?? id}</Mono>
                  </td>
                  <td data-label="Assembly">{names.get(place.assembly) ?? String(place.assembly)}</td>
                  <td data-label="Region">
                    <Mono>{place.region}</Mono>
                    {place.reference ? null : <span className="muted"> outside the reference</span>}
                  </td>
                  <td className="num" data-label="First base">
                    <Mono title={String(place.start)}>{groupedInteger(place.start)}</Mono>
                  </td>
                  <td className="num" data-label="Last base">
                    <Mono title={String(place.end)}>{groupedInteger(place.end)}</Mono>
                  </td>
                  <td data-label="Strand">
                    <Mono>{place.strand > 0 ? "+" : place.strand < 0 ? "−" : String(place.strand)}</Mono>
                  </td>
                  <td data-label="Releases">
                    <Mono>{place.releases.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ")}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </Folded>
    </div>
  );
}
