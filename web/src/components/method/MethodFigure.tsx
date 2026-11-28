// How IDTrack answers, as a stepper of five stages, one at a time: read the identifier, walk Ensembl's history, bridge
// through an id two genes carried, rank the candidates, answer in the database asked. Each stage draws itself on a
// real answer of this server (StageCase: asked when the panel comes into view, linked to its answer),
// with the figure grammar of every page, and beside it the terms of the stage, every word of meaning IDTrack's: the
// api's vocabulary (`GET /api/v1/vocabulary`, IDTrack's own tables) or IDTrack's documentation at the pinned commit
// (src/generated/idtrack_docs.json), linked.
import { docsPage } from "../../lib/links";
import docs from "../../generated/idtrack_docs.json";
import type { ConversionResult } from "../../api/types";
import type { Stage } from "../../lib/method/cases";
import { firstSentence, readerText } from "../../lib/method/readerText";
import { firstWords } from "../../lib/values";
import { spaced, type Vocabulary } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Term } from "../ResultParts";
import type { ReactNode } from "react";
import { navigate } from "../../lib/router";
import { Expandable } from "../v2/Expandable";
import { Tabs } from "../v2/Tabs";
import { Button, Disclosure, Prose, StatusBadge } from "../ui";
import { AnswerFigure } from "./AnswerFigure";
import { BridgeChecks } from "./BridgeChecks";
import { HistoryKinds } from "./HistoryKinds";
import { RankFigure } from "./RankFigure";
import { ReadFigure } from "./ReadFigure";
import { StageCase } from "./StageCase";
import { StageFigure, StageLegend } from "./StageFigure";
import "../../styles/evidence.css";

function Meaning({ text }: { text: string | null | undefined }) {
  if (!text) return <span className="muted">The api gives no meaning for this code.</span>;
  return <Prose text={text} />;
}

/** How a stage works, in a paragraph folded behind one line under the stage's head: the stage's sentence above the
 *  tabs' panel says it in brief. */
function StageAbout({ children, docs }: { children: ReactNode; docs: string }) {
  return (
    <Expandable className="method-panel__about" summary="How this stage works">
      <p className="method-panel__about-text">{children}</p>
      <a className="method-panel__docs" href={docs}>
        This stage in IDTrack&apos;s documentation
      </a>
    </Expandable>
  );
}

/** Every term of a list with its meaning in IDTrack's full words, the code as IDTrack writes it: one press away. */
function FullWords({
  entries,
  summary = "In IDTrack's full words",
}: {
  entries: [string, string | null | undefined][];
  summary?: string;
}) {
  return (
    <Disclosure summary={summary}>
      <dl className="method-terms method-terms--full">
        {entries.map(([code, meaning]) => (
          <div key={code}>
            <dt>
              {spaced(code)} <code className="mono">{code}</code>
            </dt>
            <dd>
              <Meaning text={meaning} />
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

/** A list of terms, each a code in words (IDTrack's meaning and the code on a press) and the first sentence of its
 *  meaning read for a person (lib/method/readerText.ts); the list flows in balanced columns, and every meaning in
 *  IDTrack's full words is one press away. */
function TermList({
  title,
  entries,
  status = false,
}: {
  title: string;
  entries: [string, string | null | undefined][];
  status?: boolean;
}) {
  return (
    <div className="method-termlist">
      <h3 className="method-sub">{title}</h3>
      <dl className="method-terms">
        {entries.map(([code, meaning]) => (
          <div key={code}>
            <dt>{status ? <StatusBadge status={code} /> : <Term code={code} meaning={meaning} />}</dt>
            <dd>{meaning ? <Prose text={readerText(firstSentence(meaning))} /> : <Meaning text={meaning} />}</dd>
          </div>
        ))}
      </dl>
      <FullWords entries={entries} />
    </div>
  );
}

/** The terms of a stage, folded behind one line that names them and how many each list holds: the figure and its two
 *  sentences stay open, the glossary is one press away. */
function Glossary({ lists, children }: { lists: [string, number][]; children: ReactNode }) {
  const words = lists.map(([what, n]) => (n ? `${what} (${n})` : what)).join(", ");
  return (
    <Expandable className="method-glossary" summary="The terms of this stage" meta={words}>
      {children}
      <p className="method-source">
        Meanings: <span className="mono">GET /api/v1/vocabulary</span> (IDTrack&apos;s own tables; the statuses in the
        api&apos;s words, marked by it as such), and IDTrack&apos;s documentation,{" "}
        <a href={docsPage("concepts.html")}>How IDTrack Answers</a> and{" "}
        <a href={docsPage("reading.html")}>How an Identifier Is Read</a>.
      </p>
    </Expandable>
  );
}

/** A stage's head: its title and its one claim, the link to IDTrack's documentation of it at the right. */
function StageHead({ id, stage }: { id: string; stage: StageInfo }) {
  return (
    <div className="method-panel__head">
      <div className="method-panel__titles">
        <h3 id={id}>{stage.heading}</h3>
        <p className="method-panel__claim">{stage.claim}</p>
      </div>
    </div>
  );
}

/** What stays one press away under a stage's figure: how it works, its terms, and what else it holds. */
function StageMore({ children }: { children: ReactNode }) {
  return <div className="method-panel__more">{children}</div>;
}

function ReadPanel({ v }: { v: Vocabulary }) {
  const stage = STAGE_INFO.read;
  return (
    <section className="method-panel" aria-labelledby="method-read">
      <StageHead id="method-read" stage={stage} />
      <StageCase
        stage="read"
        claim="The steps of a match in IDTrack's order, as this answer took them: hollow found nothing, filled matched, faint were not needed."
        caption={
          <>
            The step that matched names the identifier of the graph; beside the ladder, the release the string was read
            at and the databases that attach it there. What each step compares opens from the ladder&apos;s label.
          </>
        }
      >
        {({ result }) => <ReadFigure result={result} />}
      </StageCase>
      <StageMore>
        <StageAbout docs={stage.docs}>
          Before anything is looked up, the typed string is read as a person who pasted it meant it: where it is read
          (the starting release), what is cleaned from it, how it is matched against the identifiers of the graph. The
          steps of a match are tried in IDTrack&apos;s order, each on names, then on synonyms, before the next; the
          match a result names is the step that matched, after the prefixes that applied.
        </StageAbout>
        <Glossary
          lists={[
            ["the steps of a match", v.matchSteps.size],
            ["its prefixes", v.matchPrefixes.size],
            ["the other readings beside an answer", v.readingReasons.size],
          ]}
        >
          <FullWords entries={[...v.matchSteps.entries()]} summary="The steps of a match, in IDTrack's full words" />
          <div className="method-columns">
            <TermList title="Prefixes of a match" entries={[...v.matchPrefixes.entries()]} />
            <TermList title="Other readings, reported beside the answer" entries={[...v.readingReasons.entries()]} />
          </div>
        </Glossary>
      </StageMore>
    </section>
  );
}

function WalkPanel({ v }: { v: Vocabulary }) {
  const stage = STAGE_INFO.walk;
  return (
    <section className="method-panel" aria-labelledby="method-walk">
      <StageHead id="method-walk" stage={stage} />
      <StageCase
        stage="walk"
        claim="The best answer's path through Ensembl's history: one lane per stable id, one bar per version, each step where one version ends and the next begins."
        caption={
          <>
            It is drawn over the releases the path spans and two on each side (the strip above places them on the
            graph&apos;s whole axis), over the bands of the assemblies that serve each release; the thread is the walk,
            in the order it was taken, and Replay walks it step by step; below, Ensembl&apos;s mapping score of each
            history step. Focus the figure and use the arrow keys for each element&apos;s exact values. The case is the
            answer of this graph&apos;s showcase whose best path walks through a split and passes the most ids and steps
            (bridges are the next stage).
          </>
        }
      >
        {({ result, graph }) => (
          <>
            <StageFigure result={result} graph={graph} replay />
            <StageLegend result={result} graph={graph} replay />
          </>
        )}
      </StageCase>
      <StageMore>
        <StageAbout docs={stage.docs}>
          From the gene an identifier names at the starting release (its entry gene), the search follows Ensembl&apos;s
          history forward or backward to the target release. Each history step is a version event of Ensembl. In
          IDTrack&apos;s words: <Prose text={docs.mappingScore.text} />{" "}
          <a href={docs.mappingScore.source}>IDTrack&apos;s documentation</a>
        </StageAbout>
        <Expandable className="method-kinds-row" summary="The kinds of history step" meta="what Ensembl recorded">
          <HistoryKinds v={v} />
        </Expandable>
        <Glossary
          lists={[
            ["each kind of step in IDTrack's full words", 0],
            ["where the later gene lies", v.placeRelations.size],
          ]}
        >
          <FullWords
            entries={[
              "new_version",
              "replaced",
              "split",
              "merge",
              "split_and_merge",
              "self_loop",
              "mitochondrial_genome",
            ].map((code) => [code, v.stepReasons.get(code)])}
            summary="Each kind of step in IDTrack's full words"
          />
          <TermList
            title="Where the later gene lies, for a step between two genes"
            entries={[...v.placeRelations.entries()]}
          />
        </Glossary>
      </StageMore>
    </section>
  );
}

/** Where the bridge of an answer's path joins two genes whose places IDTrack cannot compare (their assemblies have no
 *  published mapping), the answer rests on the shared id and the chromosomes' names alone: said under the figure, in
 *  IDTrack's words, with its limitation. */
function BridgePlaces({ result }: { result: ConversionResult }) {
  const steps = result.path?.steps ?? [];
  const near = steps.find((s) => s.kind === "bridge_near");
  const far = steps.find((s) => s.kind === "bridge_far");
  const bridge = (result.path?.bridges ?? []).find(
    (b) => b.taken && b.source === near?.source && b.target === far?.target,
  );
  const limitation = docs.limitations.items.find((l) => l.anchor === PLACES_LIMITATION);
  if (!bridge || bridge.places === "same_place" || !limitation) return null;
  return (
    <p className="method-caveat" role="note">
      <strong>Places not compared.</strong> This bridge joins genes on two assemblies ({spaced(bridge.places)}), so
      their places are not compared; in IDTrack&apos;s words: <Prose text={limitation.sentence} />{" "}
      {limitation.next ? <Prose text={limitation.next} /> : null}{" "}
      <a href={`${docs.limitations.source.replace(/#.*$/, "")}#${limitation.anchor}`}>{limitation.title}</a>
    </p>
  );
}

/** IDTrack's limitation on places across an assembly change (its section's anchor in the documentation). */
const PLACES_LIMITATION = "places-across-an-assembly-change";

function BridgePanel({ v }: { v: Vocabulary }) {
  const stage = STAGE_INFO.bridge;
  const rules = [...v.bridgeRules.entries()];
  return (
    <section className="method-panel" aria-labelledby="method-bridge">
      <StageHead id="method-bridge" stage={stage} />
      <StageCase
        stage="bridge"
        claim="The best answer's path: where one gene's history ends, a bridge through the id it carried to the gene that carried it next."
        caption={
          <>
            Drawn over the releases the path spans and two on each side: each lane one stable id, each bar one version
            of it; the identifier read as its gene (through its transcript or translation where it names one); below,
            Ensembl&apos;s mapping score of each history step. Under it, every bridge the search considered, with where
            the two genes lie and the rule of each id they shared.
          </>
        }
      >
        {({ result, graph }) => (
          <>
            <StageFigure result={result} graph={graph} />
            <StageLegend result={result} graph={graph} />
            <BridgePlaces result={result} />
            <BridgeChecks result={result} />
          </>
        )}
      </StageCase>
      <StageMore>
        <StageAbout docs={stage.docs}>
          No record of Ensembl states a bridge: it is IDTrack&apos;s inference that one gene became the other, so it is
          taken only where the identifier is evidence of that. With the path, a result lists every bridge the search
          considered, taken or refused, with its rule.
        </StageAbout>
        <Glossary
          lists={[
            ["the two steps of a bridge", 2],
            ["the rules it is taken by", rules.filter(([, r]) => r.taken).length],
            ["the rules it is refused by", rules.filter(([, r]) => !r.taken).length],
          ]}
        >
          <div className="method-columns">
            <TermList
              title="The two steps of a bridge"
              entries={["bridge_near", "bridge_far"].map((code) => [code, v.stepReasons.get(code)])}
            />
            <TermList
              title="Taken when"
              entries={rules.filter(([, r]) => r.taken).map(([code, r]) => [code, r.meaning])}
            />
            <TermList
              title="Refused when"
              entries={rules.filter(([, r]) => !r.taken).map(([code, r]) => [code, r.meaning])}
            />
          </div>
        </Glossary>
      </StageMore>
    </section>
  );
}

function RankPanel({ v }: { v: Vocabulary }) {
  const stage = STAGE_INFO.rank;
  return (
    <section className="method-panel" aria-labelledby="method-rank">
      <StageHead id="method-rank" stage={stage} />
      <StageCase
        stage="rank"
        claim="The best answer and the runner-up on each of IDTrack's criteria, in the order they decide."
        caption={
          <>
            Equal above the criterion that decides, different on it, not compared below it: the thread runs as one while
            the two are equal and parts where the criterion decides. A criterion&apos;s name opens what it compares. The
            first five after the gene&apos;s own version compare the lineage (which entry gene the identifier stands
            for); the rest compare successors of one entry gene.
          </>
        }
      >
        {({ result }) => <RankFigure result={result} />}
      </StageCase>
      <StageMore>
        <StageAbout docs={stage.docs}>
          The search returns every candidate it reached: a gene at the target release and its target. The candidates are
          ranked by the criteria in this order; the first criterion in which two candidates differ decides between them,
          and a result names the one that put the best answer before the runner-up. Nothing is chosen by position or by
          hash order.
        </StageAbout>
        <Expandable summary="The criteria, in IDTrack's full words" meta={`${v.criteria.length} criteria`}>
          <ol
            className="method-terms method-terms--full method-criteria"
            aria-label="The criteria, in the order they decide"
          >
            {v.criteria.map((c) => (
              <li key={c.code}>
                <code className="mono method-criteria__code">{c.code}</code>
                <span className="method-criteria__meaning">
                  <Meaning text={c.meaning} />
                </span>
                {c.fields.length ? (
                  <span className="method-criteria__fields">
                    Compares {c.fields.map((f) => firstWords(f)).join("; then ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </Expandable>
      </StageMore>
    </section>
  );
}

function AnswerPanel({ v }: { v: Vocabulary }) {
  const stage = STAGE_INFO.answer;
  return (
    <section className="method-panel" aria-labelledby="method-answer">
      <StageHead id="method-answer" stage={stage} />
      <StageCase
        stage="answer"
        claim="The last steps of the answer at the target release: the number read as its gene, then every id of the database asked attached to that gene."
        caption={
          <>
            The number is read as its gene through the database that attaches it; each id of the database asked that
            IDTrack attaches to that gene there stands with the transcript and translation that carry it.
          </>
        }
      >
        {({ result }) => <AnswerFigure result={result} />}
      </StageCase>
      <StageMore>
        <StageAbout docs={stage.docs}>
          With a target database the answer is first a gene: the genes are ranked as Ensembl genes, and a target is an
          id that the database attaches at the target release to a gene of that best answer, through the gene itself or
          its transcripts and translations. Where no gene of the best answer has one, the result is the genes
          themselves, never an id of a lower-ranked gene.
        </StageAbout>
        <Glossary
          lists={[
            ["the last step of a path", 3],
            ["the statuses of a result", v.statuses.size],
          ]}
        >
          <div className="method-columns">
            <TermList
              title="The last step of a path"
              entries={["identity", "final", "final_other_release"].map((code) => [code, v.stepReasons.get(code)])}
            />
            <TermList title="Every result has one status" entries={[...v.statuses.entries()]} status />
          </div>
        </Glossary>
      </StageMore>
    </section>
  );
}

interface StageInfo {
  /** The tab's word. */
  title: string;
  /** The stage's title in its panel. */
  heading: string;
  /** The stage's one claim. */
  claim: string;
  docs: string;
}

/** Each stage's words: the tab, the title and the one claim of its panel, its section of IDTrack's documentation. */
const STAGE_INFO: Record<Stage, StageInfo> = {
  read: {
    title: "Read",
    heading: "Read the identifier",
    claim: "The typed string is matched to an identifier of the graph at the release it is read at.",
    docs: docsPage("reading.html#reading-matching"),
  },
  walk: {
    title: "Walk",
    heading: "Walk Ensembl's history",
    claim: "From the entry gene, Ensembl's version events lead forward or backward to the target release.",
    docs: docsPage("concepts.html#concept-history"),
  },
  bridge: {
    title: "Bridge",
    heading: "Bridge through an id two genes carried",
    claim: "Where the history reaches no gene, an id two genes carried leads on, where a rule allows it.",
    docs: docsPage("concepts.html#concept-bridges"),
  },
  rank: {
    title: "Rank",
    heading: "Rank the candidates",
    claim: "Every candidate reached is ranked by IDTrack's criteria in order: the first that differs decides.",
    docs: docsPage("concepts.html#concept-ranking"),
  },
  answer: {
    title: "Answer",
    heading: "Answer in the database asked",
    claim: "The best answer's gene, or its id in the database asked; a tie, not a guess, where the evidence is equal.",
    docs: docsPage("concepts.html#concept-statuses"),
  },
};

/** The five stages, in order: each a tab of the stepper, kept in the address (`?stage=`). */
const STAGES: { id: Stage; panel: (v: Vocabulary) => ReactNode }[] = [
  { id: "read", panel: (v) => <ReadPanel v={v} /> },
  { id: "walk", panel: (v) => <WalkPanel v={v} /> },
  { id: "bridge", panel: (v) => <BridgePanel v={v} /> },
  { id: "rank", panel: (v) => <RankPanel v={v} /> },
  { id: "answer", panel: (v) => <AnswerPanel v={v} /> },
];

/** The way on from a stage: the previous and the next, each a button that chooses its tab, brings the stepper's
 *  top into view and moves the focus to the chosen tab (the arrow keys of the tab list do the same). */
function StageSteps({ at }: { at: number }) {
  const go = (i: number) => {
    const search = new URLSearchParams(window.location.search);
    if (i === 0) search.delete("stage");
    else search.set("stage", STAGES[i]?.id ?? "");
    const text = search.toString();
    navigate(`${window.location.pathname}${text ? `?${text}` : ""}`, { replace: true });
    window.setTimeout(() => {
      const stepper = document.querySelector(".method-stepper");
      stepper?.scrollIntoView({ block: "start" });
      stepper?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    }, 0);
  };
  const previous = STAGES[at - 1];
  const next = STAGES[at + 1];
  return (
    <div className="method-steps">
      {previous ? (
        <Button
          variant="quiet"
          onClick={() => {
            go(at - 1);
          }}
        >
          <span aria-hidden="true">← </span>
          {at}. {STAGE_INFO[previous.id].title}
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button
          variant="secondary"
          onClick={() => {
            go(at + 1);
          }}
        >
          Next: {at + 2}. {STAGE_INFO[next.id].title}
          <span aria-hidden="true"> →</span>
        </Button>
      ) : null}
    </div>
  );
}

/** The notice that the api's vocabulary could not be read: said only when the request failed, never while it is read
 *  (the page then shows the codes without their meanings). */
export function VocabularyFailure() {
  const v = useVocabulary();
  if (v.state !== "failed") return null;
  return (
    <p className="notice" role="status">
      The api&apos;s vocabulary could not be read: the codes below are shown without their meanings.
    </p>
  );
}

/** How IDTrack answers, as a stepper of five stages, one shown at a time, each drawn on a real answer of this
 *  server. On a phone the stepper is five numbered dots, the stage's name under them as its panel's title. */
export function MethodStages() {
  const v = useVocabulary();
  return (
    <div className="method-figure">
      <VocabularyFailure />
      <Tabs
        label="The stages of an answer"
        param="stage"
        className="method-stepper"
        items={STAGES.map((stage, i) => ({
          id: stage.id,
          label: (
            <>
              <span className="method-stepper__n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="method-stepper__name">{STAGE_INFO[stage.id].title}</span>
            </>
          ),
          panel: () => (
            <>
              {stage.panel(v)}
              <StageSteps at={i} />
            </>
          ),
        }))}
      />
    </div>
  );
}
