// How IDTrack answers, as a stepper of five stages, one at a time: read the identifier, walk Ensembl's history, bridge
// through an id two genes carried, rank the candidates, answer in the database asked. Each stage draws itself on a
// real answer of this server (StageCase: asked when the panel comes into view, linked to its answer),
// with the figure grammar of every page, and beside it the terms of the stage, every word of meaning IDTrack's: the
// api's vocabulary (`GET /api/v1/vocabulary`, IDTrack's own tables) or IDTrack's documentation at the pinned commit
// (src/generated/idtrack_docs.json), linked.
import { docsPage } from "../../lib/links";
import docs from "../../generated/idtrack_docs.json";
import type { ConversionResult } from "../../api/types";
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

function PanelHead({ id, title, docs }: { id: string; title: string; docs: string }) {
  return (
    <div className="method-panel__head">
      <h3 id={id}>{title}</h3>
      <a className="method-panel__docs" href={docs}>
        IDTrack&apos;s documentation
      </a>
    </div>
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
    </Expandable>
  );
}

function ReadPanel({ v }: { v: Vocabulary }) {
  return (
    <section className="method-panel" aria-labelledby="method-read">
      <PanelHead id="method-read" title="Read the identifier" docs={docsPage("reading.html#reading-matching")} />
      <p className="method-panel__lede">
        Before anything is looked up, the typed string is read as a person who pasted it meant it: where it is read (the
        starting release), what is cleaned from it, how it is matched against the identifiers of the graph. The steps of
        a match are tried in IDTrack&apos;s order, each on names, then on synonyms, before the next; the match a result
        names is the step that matched, after the prefixes that applied.
      </p>
      <StageCase
        stage="read"
        title="a string matched past its exact form"
        reserve={340}
        caption={
          <>
            The steps of a match in IDTrack&apos;s order, each with what it compares, as this answer took them: those
            above the step that matched found nothing, the one that matched names the identifier of the graph, those
            below were not needed; beside them, the release the string was read at and the databases that attach it
            there.
          </>
        }
      >
        {({ result }) => <ReadFigure result={result} />}
      </StageCase>
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
    </section>
  );
}

function WalkPanel({ v }: { v: Vocabulary }) {
  return (
    <section className="method-panel" aria-labelledby="method-walk">
      <PanelHead id="method-walk" title="Walk Ensembl's history" docs={docsPage("concepts.html#concept-history")} />
      <p className="method-panel__lede">
        From the gene an identifier names at the starting release (its entry gene), the search follows Ensembl&apos;s
        history forward or backward to the target release. Each history step is a version event of Ensembl. In
        IDTrack&apos;s words: <Prose text={docs.mappingScore.text} />{" "}
        <a href={docs.mappingScore.source}>IDTrack&apos;s documentation</a>
      </p>
      <StageCase
        stage="walk"
        title="a walk backward through a split"
        reserve={300}
        caption={
          <>
            The best answer&apos;s path, drawn over the releases it spans and two on each side (the strip above places
            them on the graph&apos;s whole axis): each lane one stable id, named at its left, each bar one version of it
            over the releases the path holds it, each step drawn where the old version ends and the new one begins, over
            the bands of the assemblies that serve each release; below, Ensembl&apos;s mapping score of each history
            step. Focus the figure and use the arrow keys for each element&apos;s exact values.
          </>
        }
      >
        {({ result, graph }) => (
          <>
            <StageFigure result={result} graph={graph} />
            <StageLegend result={result} graph={graph} />
          </>
        )}
      </StageCase>
      <h3 className="method-sub">The kinds of history step</h3>
      <HistoryKinds v={v} />
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
  const rules = [...v.bridgeRules.entries()];
  return (
    <section className="method-panel" aria-labelledby="method-bridge">
      <PanelHead
        id="method-bridge"
        title="Bridge through an id two genes carried"
        docs={docsPage("concepts.html#concept-bridges")}
      />
      <p className="method-panel__lede">
        No record of Ensembl states a bridge: it is IDTrack&apos;s inference that one gene became the other, so it is
        taken only where the identifier is evidence of that. With the path, a result lists every bridge the search
        considered, taken or refused, with its rule.
      </p>
      <StageCase
        stage="bridge"
        title="a walk that leaves its gene through an id it carried"
        reserve={330}
        caption={
          <>
            The best answer&apos;s path, drawn over the releases it spans and two on each side: each lane one stable id,
            each bar one version of it; the identifier read as its gene (through its transcript or translation where it
            names one); the bridge from the gene whose history ends to the other gene, through the id they carried one
            after the other; below, Ensembl&apos;s mapping score of each history step. Under it, every bridge the search
            considered, with where the two genes lie and the rule of each id they shared.
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
    </section>
  );
}

function RankPanel({ v }: { v: Vocabulary }) {
  return (
    <section className="method-panel" aria-labelledby="method-rank">
      <PanelHead id="method-rank" title="Rank the candidates" docs={docsPage("concepts.html#concept-ranking")} />
      <p className="method-panel__lede">
        The search returns every candidate it reached: a gene at the target release and its target. The candidates are
        ranked by the criteria in this order; the first criterion in which two candidates differ decides between them,
        and a result names the one that put the best answer before the runner-up. The first five after the gene&apos;s
        own version compare the lineage (which entry gene the identifier stands for); the rest compare successors of one
        entry gene. Nothing is chosen by position or by hash order.
      </p>
      <StageCase
        stage="rank"
        title="two candidates told apart by a criterion"
        reserve={380}
        caption={
          <>
            The best answer and the runner-up on each of IDTrack&apos;s criteria, in the order they decide: equal above
            the criterion that decides, different on it, not compared below it.
          </>
        }
      >
        {({ result }) => <RankFigure result={result} />}
      </StageCase>
      <h3 className="method-sub">The criteria, in the order they decide</h3>
      <ol className="method-ladder" aria-label="The criteria, in the order they decide">
        {v.criteria.map((c, i) => {
          const group = i === 0 ? "own" : i <= 5 ? "lineage" : "successors";
          return (
            <li key={c.code} className={`method-ladder__step method-ladder__step--${group}`}>
              <span className="method-ladder__n mono">{i + 1}</span>
              <div className="method-ladder__body">
                <span className="method-code mono">{spaced(c.code)}</span>
                <p>{c.meaning ? <Prose text={readerText(firstSentence(c.meaning))} /> : <Meaning text={null} />}</p>
                {c.fields.length ? (
                  <p className="method-ladder__first">{c.fields.map((f) => firstWords(f)).join("; then ")}</p>
                ) : null}
              </div>
              {i === 1 || i === 6 ? (
                <span className="method-ladder__group">
                  {i === 1 ? "lineage: which entry gene" : "successors of one entry gene"}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Expandable summary="Each criterion in IDTrack's full words" meta={`${v.criteria.length} criteria`}>
        <dl className="method-terms method-terms--full">
          {v.criteria.map((c) => (
            <div key={c.code}>
              <dt>
                <code className="mono">{c.code}</code>
              </dt>
              <dd>
                <Meaning text={c.meaning} />
              </dd>
            </div>
          ))}
        </dl>
      </Expandable>
    </section>
  );
}

function AnswerPanel({ v }: { v: Vocabulary }) {
  return (
    <section className="method-panel" aria-labelledby="method-answer">
      <PanelHead
        id="method-answer"
        title="Answer in the database asked"
        docs={docsPage("concepts.html#concept-statuses")}
      />
      <p className="method-panel__lede">
        With a target database the answer is first a gene: the genes are ranked as Ensembl genes, and a target is an id
        that the database attaches at the target release to a gene of that best answer, through the gene itself or its
        transcripts and translations. Where no gene of the best answer has one, the result is the genes themselves,
        never an id of a lower-ranked gene.
      </p>
      <StageCase
        stage="answer"
        title="a number read as a gene, answered in another database"
        reserve={220}
        caption={
          <>
            The last steps of the answer, at the target release: the number read as its gene through the database that
            attaches it, then every id of the database asked that IDTrack attaches to that gene there, each through the
            transcript and translation that carries it.
          </>
        }
      >
        {({ result }) => <AnswerFigure result={result} />}
      </StageCase>
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
    </section>
  );
}

/** The five stages, in order: each a tab of the stepper (its words the tab's hint), kept in the address (`?stage=`). */
const STAGES: { id: string; title: string; words: string; panel: (v: Vocabulary) => ReactNode }[] = [
  {
    id: "read",
    title: "Read",
    words: "The typed string, matched to an identifier of the graph at the release it is read at",
    panel: (v) => <ReadPanel v={v} />,
  },
  {
    id: "walk",
    title: "Walk",
    words: "Ensembl's version events, forward or backward, from the entry gene to the target release",
    panel: (v) => <WalkPanel v={v} />,
  },
  {
    id: "bridge",
    title: "Bridge",
    words: "Where the history reaches no gene: through an id two genes carried, where a rule allows it",
    panel: (v) => <BridgePanel v={v} />,
  },
  {
    id: "rank",
    title: "Rank",
    words: "Every candidate reached, by IDTrack's criteria in order: the first that differs decides",
    panel: (v) => <RankPanel v={v} />,
  },
  {
    id: "answer",
    title: "Answer",
    words: "The best answer's gene, or its id in the database asked; a tie, not a guess, where the evidence is equal",
    panel: (v) => <AnswerPanel v={v} />,
  },
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
          {at}. {previous.title}
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
          Next: {at + 2}. {next.title}
          <span aria-hidden="true"> →</span>
        </Button>
      ) : null}
    </div>
  );
}

/** How IDTrack answers, as a stepper of five stages, one shown at a time, each drawn on a real answer of this
 *  server. */
export function MethodStages() {
  const v = useVocabulary();
  return (
    <div className="method-figure">
      {v.available ? null : (
        <p className="notice" role="status">
          The api&apos;s vocabulary could not be read: the codes below are shown without their meanings.
        </p>
      )}
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
              {stage.title}
            </>
          ),
          panel: () => (
            <>
              <p className="method-stepper__words">{stage.words}.</p>
              {stage.panel(v)}
              <StageSteps at={i} />
            </>
          ),
        }))}
      />
      <p className="method-source">
        Meanings: <span className="mono">GET /api/v1/vocabulary</span> (IDTrack&apos;s own tables; the statuses in the
        api&apos;s words, marked by it as such), and IDTrack&apos;s documentation,{" "}
        <a href={docsPage("concepts.html")}>How IDTrack Answers</a> and{" "}
        <a href={docsPage("reading.html")}>How an Identifier Is Read</a>.
      </p>
    </div>
  );
}
