// The verdict of a result: what IDTrack answered, how sure it is and why, in the result's own words; its actions (copy
// the answer or its link, cite it in a drawer, and under "More" the answer as a file, its provenance, the api's
// request); and, for the answer's Record tab, the facts and the anatomy (read, walked, ranked, answered).
//
// The verdict keeps its shape whatever the answer's size: the query, the arrow of releases, the answer and the status
// stand together on the first screen. An answer of many targets reads as the genes they are ids of (each gene at
// display size with its symbol, its first targets in small type, "and N more" on request), never as a wall of ids.
// Under the status, the cautions a reader must weigh (`Evidence`; the notes are on the Evidence tab), then what the
// string meant at other releases with a way to read it there.
import { memo, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { api } from "../api/client";
import type { Candidate, ConversionResult, GraphDescription } from "../api/types";
import type { Anatomy } from "../lib/anatomy";
import { convertHref, plainConversion } from "../lib/convertParameters";
import { databaseLabel } from "../lib/databases";
import {
  cautionCount,
  evidenceHrefs,
  limitationAt,
  LIMITATION_OF,
  type EvidenceAsk,
  type EvidenceMark,
} from "../lib/evidence";
import { docsPage } from "../lib/links";
import { bestWords, noTargetOf, NOT_HELD_WORDS, notHeldScheme, type NoTarget } from "../lib/noTarget";
import { looksLikeSpreadsheetDate } from "../lib/batchList";
import { groupedInteger, releaseRanges } from "../lib/numbers";
import { commonName, organismName } from "../lib/organismNames";
import type { PathModel } from "../lib/pathModel";
import { assemblyText, stableId, type AssemblyNames } from "../lib/pathReading";
import { href } from "../lib/router";
import { parseServerTiming } from "../lib/serverTiming";
import { spaced, statusTitle, criterionOf } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";
import { readerText, statusTone } from "../lib/resultWords";
import { EvidenceCard } from "./Evidence";
import { IdMenu, SymbolOf, type IdContext } from "./IdMenu";
import { Reasons, Term } from "./ResultParts";
import { Drawer } from "./v2/Drawer";
import { HoverCard } from "./v2/HoverCard";
import { usePhone } from "../lib/usePhone";
import { answerFileName, kindsText, MATCH_WORDS, pinnedLink, shortDigest } from "../lib/answerLinks";
import { answerProvenance, citationOf, methodsSentence } from "../lib/answerProvenance";
import { saveText } from "../lib/save";
import { useRequest } from "../lib/useRequest";
import { criterionValue } from "../lib/values";
import { RetiredLife } from "./ResultLife";
import { Button, CopyButton, Link, Mono, Prose, StatusBadge } from "./ui";

/** The targets of one gene shown at once in the answer, before "and N more" (the rest on request). */
export const TARGETS_SHOWN = 6;
/** The genes of a best answer shown at display size, before "and N more genes". */
const GENES_SHOWN = 3;

/** The reasons a result gives that its evidence marks do not already say, each in words first. */
const SAID_BY_EVIDENCE = new Set(["read_at_another_release"]);

function ReasonNotes({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  const codes = result.reasons.filter((code) => !SAID_BY_EVIDENCE.has(code));
  if (!codes.length) return null;
  return (
    <ul className="answer__notes">
      {codes.map((code) => {
        const meaning = vocabulary.reasons.get(code);
        return (
          <li key={code}>
            {meaning ? <Prose text={meaning} /> : spaced(code)} <code className="answer__note-code mono">{code}</code>
          </li>
        );
      })}
    </ul>
  );
}

/** The decision in one sentence, where a criterion decided: from `decided_by` and the pair IDTrack compared (the
 *  criterion's place in IDTrack's order is said once, by the comparison under it). */
export function DecisionSentence({ model, context }: { model: PathModel; context: IdContext }) {
  const vocabulary = useVocabulary();
  const decision = model.decision;
  if (!decision) return null;
  const criterion = criterionOf(vocabulary, decision.key);
  // The values the deciding criterion compared, as the api sent them (never judged: no threshold of the page's own).
  const best = criterion ? criterionValue(criterion, decision.best.api) : null;
  const runner = criterion ? criterionValue(criterion, decision.runnerUp.api) : null;
  return (
    <p className="answer__decision">
      <Mono strong>{decision.best.api.target}</Mono> ranks before the runner-up{" "}
      <IdMenu id={decision.runnerUp.api.target} release={context.toRelease} context={context} />
      <SymbolOf
        gene={decision.runnerUp.api.gene}
        context={context}
        except={decision.runnerUp.api.target}
        lead=" "
      />{" "}
      (rank {decision.runnerUp.index + 1}) by <strong>{spaced(decision.key)}</strong>
      {best && runner ? (
        <>
          {" "}
          (<Mono title={best.title}>{best.text}</Mono> against <Mono title={runner.title}>{runner.text}</Mono>)
        </>
      ) : null}
      .
    </p>
  );
}

/** The deciding criterion in words that fit the result: a criterion, a tie, one candidate or none. */
function decidedText(result: ConversionResult): string {
  if (result.decided_by) return spaced(result.decided_by);
  if (result.tie) return "none: a tie";
  if (result.candidates.length === 1) return "— (one candidate)";
  if (!result.candidates.length) return "— (no candidate)";
  return "—";
}

function Facts({
  result,
  description,
  asked,
  serverTiming,
  context,
}: {
  result: ConversionResult;
  description: GraphDescription;
  asked: string;
  serverTiming: string | null;
  context: IdContext;
}) {
  const common = commonName(description.organism);
  // The server's own timing of this answer: the `Server-Timing` header of its response, each duration as sent.
  const timing = parseServerTiming(serverTiming);
  const app = timing.find((t) => t.name === "app" && t.dur !== null);
  const search = timing.find((t) => t.name === "search" && t.dur !== null);
  // An answer sent again from the server's memory (`cache;desc=hit`) or confirmed unchanged (`revalidated`, a 304)
  // ran no search: its time is that of sending, said so.
  const cache = timing.find((t) => t.name === "cache")?.desc?.replace(/^"|"$/g, "") ?? null;
  return (
    <dl className="answer__facts">
      <div>
        <dt>Organism</dt>
        <dd>
          <em>{organismName(description.organism)}</em>
          {common ? <span className="muted"> ({common})</span> : null}
        </dd>
      </div>
      <div>
        <dt>Read at release</dt>
        <dd>
          {result.from_release === null ? "—" : <Mono>{result.from_release}</Mono>}{" "}
          <span className="muted">
            {result.from_release === null
              ? "not read"
              : result.from_release_fallback
                ? `(${result.from_release_given ?? ""} given)`
                : result.from_release_inferred
                  ? "inferred"
                  : "as given"}
          </span>
        </dd>
      </div>
      <div>
        <dt>To release</dt>
        <dd>
          <Mono>{result.to_release}</Mono>
        </dd>
      </div>
      <div>
        <dt>Target database</dt>
        <dd>{databaseLabel(asked)}</dd>
      </div>
      <div>
        <dt>Candidates</dt>
        <dd>
          <Mono>{groupedInteger(result.candidates.length)}</Mono>
          {result.candidates.length ? (
            <span className="muted"> ({groupedInteger(result.candidates.filter((c) => c.best).length)} best)</span>
          ) : null}
        </dd>
      </div>
      <div>
        <dt>Decided by</dt>
        <dd>{decidedText(result)}</dd>
      </div>
      {context.symbols ? (
        <div>
          <dt>Symbols</dt>
          <dd>
            {context.symbols.database} <span className="muted">at {context.symbols.release}, by IDTrack</span>
          </dd>
        </div>
      ) : null}
      {description.content_digest ? (
        <div>
          <dt>Graph</dt>
          <dd>
            <Mono title={`The graph's content digest: ${description.content_digest}`}>{shortDigest(description)}</Mono>{" "}
            <span className="muted">digest</span>
          </dd>
        </div>
      ) : null}
      {app ? (
        <div>
          <dt>Server time</dt>
          <dd
            title={`Measured by the server and sent with its answer (Server-Timing): ${timing
              .map((t) => (t.dur !== null ? `${t.name} ${t.dur} ms` : `${t.name} ${t.desc ?? ""}`))
              .join(
                ", ",
              )}${cache === "hit" ? ". The answer was sent again from the server's memory: no search ran, and the time is that of sending it." : cache === "revalidated" ? ". The server confirmed the browser's copy unchanged (304): no search ran." : ""}`}
          >
            <Mono>{app.dur}</Mono> ms
            {search ? (
              <span className="muted">
                {" "}
                (search <Mono>{search.dur}</Mono> ms)
              </span>
            ) : cache === "hit" ? (
              <span className="muted"> (from memory, no search)</span>
            ) : cache === "revalidated" ? (
              <span className="muted"> (304, no search)</span>
            ) : null}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function Actions({
  result,
  apiUrl,
  description,
  raw,
  requestId,
  serverTiming,
  receivedAt,
  citing,
  onCite,
}: {
  result: ConversionResult;
  apiUrl: string | null;
  description: GraphDescription;
  raw: string;
  requestId: string | null;
  serverTiming: string | null;
  receivedAt: string;
  /** The citation is open (in its drawer). */
  citing: boolean;
  onCite: () => void;
}) {
  const targets = [...new Set(result.candidates.filter((c) => c.best).map((c) => c.target))];
  const version = useRequest("version", (signal, fresh) => api.version({ signal, fresh }));
  const file = answerFileName(result, description.organism);
  const saveProvenance = () => {
    const provenance = answerProvenance({
      result,
      description,
      version: version.state === "done" ? version.answer.data : null,
      apiUrl,
      requestId,
      serverTiming,
      receivedAt,
      file,
    });
    saveText(
      `${JSON.stringify(provenance, null, 2)}\n`,
      file.replace(/\.json$/, "_provenance.json"),
      "application/json",
    );
  };
  return (
    <div className="answer__actions">
      {targets.length && !result.no_target ? (
        <CopyButton
          text={targets.join("\n")}
          label={targets.length > 1 ? `Copy ${groupedInteger(targets.length)} answers` : "Copy answer"}
          what={targets.length > 3 ? `the ${targets.length} best targets, one a line` : targets.join(", ")}
        />
      ) : null}
      <CopyButton
        text={() => pinnedLink(result, description, window.location.href)}
        label="Copy link"
        what="to this conversion, with its target release and graph"
      />
      <Button variant="quiet" aria-haspopup="dialog" aria-expanded={citing} onClick={onCite}>
        Cite<span className="visually-hidden"> IDTrack and this conversion</span>
      </Button>
      <HoverCard
        hover={false}
        className="answer__more"
        triggerClassName="button button--quiet"
        label="More: the answer as a file, its provenance, the api's request"
        trigger={
          <>
            More
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
              <circle cx="8" cy="8" r="1.3" fill="currentColor" />
              <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
            </svg>
          </>
        }
      >
        {(close) => (
          <div className="answer__more-list">
            <button
              type="button"
              className="answer__more-item"
              onClick={() => {
                saveText(raw, file, "application/json");
                close();
              }}
            >
              Download JSON<span className="answer__more-note">the api&apos;s answer as sent</span>
            </button>
            <button
              type="button"
              className="answer__more-item"
              onClick={() => {
                saveProvenance();
                close();
              }}
            >
              Provenance<span className="answer__more-note">the server, the graph and the request, as JSON</span>
            </button>
            {apiUrl ? (
              <a className="answer__more-item" href={apiUrl} target="_blank" rel="noreferrer">
                The api&apos;s answer ↗<span className="answer__more-note">its request, in a new tab</span>
              </a>
            ) : null}
          </div>
        )}
      </HoverCard>
    </div>
  );
}

interface GeneGroup {
  gene: string;
  targets: string[];
}

/** The best candidates by gene, in the api's order (the targets of one gene together). */
function groupsOf(bests: readonly Candidate[]): GeneGroup[] {
  const groups: GeneGroup[] = [];
  const byGene = new Map<string, GeneGroup>();
  for (const c of bests) {
    let group = byGene.get(c.gene);
    if (!group) {
      group = { gene: c.gene, targets: [] };
      byGene.set(c.gene, group);
      groups.push(group);
    }
    if (!group.targets.includes(c.target)) group.targets.push(c.target);
  }
  return groups;
}

/** The targets of one gene: the first few in small type, the rest on request (and copied whole). */
function TargetList({ group, database, context }: { group: GeneGroup; database: string; context: IdContext }) {
  const [all, setAll] = useState(false);
  // Hundreds of ids are drawn in a transition: the press is answered at once, the list follows.
  const [pending, startShowing] = useTransition();
  const shown = all ? group.targets : group.targets.slice(0, TARGETS_SHOWN);
  const rest = group.targets.length - TARGETS_SHOWN;
  return (
    <div className="answer__list">
      <ul className={`answer__list-ids ${all && group.targets.length > 40 ? "answer__list-ids--scroll" : ""}`}>
        {shown.map((target) => (
          <li key={target}>
            <IdMenu id={target} release={context.toRelease} context={context} answer />
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className="answer__list-more">
          {all ? null : (
            <span className="muted">
              and {groupedInteger(rest)} more {database} id{rest === 1 ? "" : "s"}{" "}
            </span>
          )}
          <Button
            variant="quiet"
            aria-expanded={all}
            onClick={() => {
              startShowing(() => {
                setAll((v) => !v);
              });
            }}
          >
            {pending
              ? "Showing…"
              : all
                ? `Show the first ${TARGETS_SHOWN}`
                : `Show all ${groupedInteger(group.targets.length)}`}
          </Button>
        </p>
      ) : null}
    </div>
  );
}

/** The best answer: one target at display size, or the genes of many targets, each with its first targets. */
function AnswerTargets({
  result,
  database,
  context,
}: {
  result: ConversionResult;
  database: string;
  context: IdContext;
}) {
  const bests = result.candidates.filter((c) => c.best);
  const groups = groupsOf(bests);
  const targets = new Set(bests.map((c) => c.target)).size;
  const own = (group: GeneGroup) => group.targets.length === 1 && group.targets[0] === group.gene;
  // One target per gene (a tie of genes, or one answer): each target at display size, its gene under it.
  const oneEach = groups.every((g) => g.targets.length === 1);
  if (oneEach && (groups.length === 1 || !groups.every(own))) {
    const shown = groups.slice(0, GENES_SHOWN);
    return (
      <div className={`answer__targets ${groups.length > 1 ? "answer__targets--many" : ""}`}>
        {groups.length > 1 ? (
          <p className="answer__count">
            {groupedInteger(groups.length)} {database} ids of {groupedInteger(groups.length)} genes
            {result.tie ? ", equal best: a tie" : ", all part of the best answer"}
          </p>
        ) : null}
        {shown.map((group) => {
          const target = group.targets[0] ?? group.gene;
          return (
            <div key={group.gene} className={groups.length > 1 ? "answer__group" : undefined}>
              <h3 className="answer__target">
                <IdMenu
                  id={target}
                  release={context.toRelease}
                  context={context}
                  strong
                  className="answer__id"
                  answer
                />
              </h3>
              <p className="answer__gene">
                {target !== group.gene ? (
                  <>
                    gene <IdMenu id={group.gene} release={context.toRelease} context={context} />{" "}
                  </>
                ) : null}
                <SymbolOf gene={group.gene} context={context} except={target} />
              </p>
            </div>
          );
        })}
        {groups.length > shown.length ? (
          <p className="answer__list-more muted">
            and {groupedInteger(groups.length - shown.length)} more: every one is listed on the Decision tab.
          </p>
        ) : null}
      </div>
    );
  }
  const shownGroups = groups.slice(0, GENES_SHOWN);
  const moreGenes = groups.length - shownGroups.length;
  const allOwn = groups.every(own);
  return (
    <div className="answer__targets answer__targets--many">
      <p className="answer__count">
        {allOwn
          ? `${groupedInteger(groups.length)} genes`
          : `${groupedInteger(targets)} ${database} ids of ${groups.length === 1 ? "one gene" : `${groupedInteger(groups.length)} genes`}`}
        {result.tie && groups.length > 1 ? ", equal best: a tie" : ", all part of the best answer"}
      </p>
      {shownGroups.map((group) => (
        <div key={group.gene} className="answer__group">
          <h3 className="answer__target">
            <IdMenu id={group.gene} release={context.toRelease} context={context} strong className="answer__id" />{" "}
            <SymbolOf gene={group.gene} context={context} />
          </h3>
          {own(group) ? null : <TargetList group={group} database={database} context={context} />}
        </div>
      ))}
      {moreGenes > 0 ? (
        <p className="answer__list-more muted">
          and {groupedInteger(moreGenes)} more gene{moreGenes === 1 ? "" : "s"}: every one is listed on the Decision
          tab.
        </p>
      ) : null}
    </div>
  );
}

/** What the string meant at other releases, with a way to read it there (a list of that time means that gene). */
function OtherMeanings({
  result,
  readAtHref,
  context,
}: {
  result: ConversionResult;
  readAtHref: (release: number) => string;
  context: IdContext;
}) {
  const others = result.other_readings.filter((r) => r.reason === "other_release" && r.releases.length);
  if (!others.length) return null;
  return (
    <ul className="answer__meanings">
      {others.map((reading) => {
        const at = reading.releases[reading.releases.length - 1];
        return (
          <li key={`${reading.graph_id}|${reading.releases.join(",")}`}>
            At releases <Mono>{releaseRanges(reading.releases)}</Mono>, <Mono>{result.query_id}</Mono>{" "}
            {reading.graph_id === result.query_id ? (
              "named another gene"
            ) : (
              <>
                was read as <Mono>{reading.graph_id}</Mono>
              </>
            )}
            ; read there, it answers{" "}
            {reading.genes.length
              ? reading.genes.map((gene, i) => (
                  <span key={gene}>
                    {i ? ", " : ""}
                    <IdMenu id={gene} release={result.to_release} context={context} strong />{" "}
                    <SymbolOf gene={gene} context={context} />
                  </span>
                ))
              : "no gene"}{" "}
            at release <Mono>{result.to_release}</Mono>. A list made at that time means that gene.{" "}
            {at !== undefined ? <Link to={readAtHref(at)}>Read it at release {at} →</Link> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The status in a sentence that fits the answer: one gene's every id, the best of several candidates (with Ensembl's
 *  split or merge on its path), or idtrack's meaning of the status. */
function StatusSentence({
  result,
  model,
  database,
  context,
}: {
  result: ConversionResult;
  model: PathModel;
  database: string;
  context: IdContext;
}) {
  const vocabulary = useVocabulary();
  const bests = result.candidates.filter((c) => c.best);
  const genes = [...new Set(bests.map((c) => c.gene))];
  const targets = new Set(bests.map((c) => c.target)).size;
  if (genes.length === 1 && targets > 1 && !result.no_target) {
    const gene = genes[0] ?? "";
    return (
      <span className="answer__status-text">
        Every best target is an id of one gene, <IdMenu id={gene} release={result.to_release} context={context} />{" "}
        <SymbolOf gene={gene} context={context} />: IDTrack converts at the level of the gene, so the answer in{" "}
        {database} is every id that gene carries at release <Mono>{result.to_release}</Mono>, not the counterpart of{" "}
        <Mono>{result.query_id}</Mono> alone.
      </span>
    );
  }
  if (result.status === "converted" && bests.length === 1 && result.candidates.length > 1) {
    const best = model.candidates.find((c) => c.best);
    const event = best?.steps.map((i) => model.steps[i]).find((s) => s?.kind === "split_merge");
    return (
      <span className="answer__status-text">
        One best answer, ranked first of <Mono>{groupedInteger(result.candidates.length)}</Mono> candidates
        {event ? (
          <>
            ; its path holds Ensembl&apos;s {spaced(event.api.reason)} at{" "}
            <Mono>
              {event.api.old_release ?? "—"} → {event.api.new_release ?? "—"}
            </Mono>
          </>
        ) : null}
        . Every candidate is on the Decision tab.
      </span>
    );
  }
  const meaning = vocabulary.statuses.get(result.status);
  return meaning ? (
    <span className="answer__status-text">
      <Prose text={readerText(meaning)} />
    </span>
  ) : null;
}

/** The cautions of the answer, each on one line of the verdict (a caution changes how the answer may be used: it never
 *  folds). Its triangle opens what it rests on (what the result says, IDTrack's meaning, the limitation of IDTrack's
 *  documentation it falls under, the code it is read from) as a hover card; where another gene than the best answer
 *  may be the gene meant, its line says so first, with the conversion that answers the doubt. */
function CautionLines({
  marks,
  askHref,
  readAtHref,
}: {
  marks: readonly EvidenceMark[];
  askHref: (ask: EvidenceAsk) => string;
  readAtHref: (release: number) => string;
}) {
  if (!marks.length) return null;
  // Another gene may be meant: said first.
  const ordered = [...marks.filter((m) => m.alert), ...marks.filter((m) => !m.alert)];
  return (
    <ul className="answer__cautions" aria-label="Cautions to weigh">
      {ordered.map((mark) => {
        const words = mark.label.replace(/`/g, "");
        return (
          <li
            key={`${mark.kind}|${mark.label}`}
            className={`answer__caution${mark.alert ? " answer__caution--alert" : ""}`}
          >
            <HoverCard
              className="answer__caution-card"
              triggerClassName="answer__caution-mark"
              label={`Caution: ${words}. What it rests on`}
              trigger={<CautionGlyph />}
            >
              <EvidenceCard mark={mark} links={{ readAtHref, askHref }} />
            </HoverCard>
            <span className="answer__caution-words">
              {mark.alert ? <strong>Another gene may be the one meant: </strong> : null}
              <Prose text={mark.label} />.
              {mark.ask ? (
                <>
                  {" "}
                  <Link to={askHref(mark.ask)}>{mark.ask.words} →</Link>
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What a tie of genes means for a list or a count matrix, in IDTrack's documented terms, a press or a pointing away
 *  from the status: IDTrack returns a tie rather than a guess; where the release or the source database is known,
 *  giving it decides; else every gene is kept (its harmonizer leaves such a feature unconverted, as ambiguous). */
function TieGuidance({ result }: { result: ConversionResult }) {
  const genes = new Set(result.candidates.filter((c) => c.best).map((c) => c.gene));
  if (!result.tie || genes.size < 2) return null;
  return (
    <HoverCard
      className="answer__guidance"
      triggerClassName="answer__guidance-trigger"
      trigger="For a list or a count matrix"
    >
      <p className="answer__guidance-text">
        IDTrack returns the tie rather than a guess: give the release the list was made with, or the database it comes
        from, where you know them; else keep every gene. Harmonizing a matrix leaves such a feature unconverted, as
        ambiguous.{" "}
        <a href={docsPage("concepts.html#concept-ties")} target="_blank" rel="noreferrer">
          The best answer and ties
          <span className="visually-hidden"> (IDTrack&apos;s documentation, opens in a new tab)</span>
          <span aria-hidden="true"> ↗</span>
        </a>{" "}
        <a href={docsPage("harmonization.html")} target="_blank" rel="noreferrer">
          Harmonizing<span className="visually-hidden"> (IDTrack&apos;s documentation, opens in a new tab)</span>
          <span aria-hidden="true"> ↗</span>
        </a>
      </p>
    </HoverCard>
  );
}

/** idtrack's citation with the version that answered, and a sentence for a methods section that states this run. */
function CiteBlock({
  id,
  result,
  description,
  database,
  apiUrl,
}: {
  id: string;
  result: ConversionResult;
  description: GraphDescription;
  database: string;
  apiUrl: string | null;
}) {
  const version = useRequest("version", (signal, fresh) => api.version({ signal, fresh }));
  const known = version.state === "done" ? version.answer.data : null;
  // idtrack's citation is read from its documentation's generated file only when asked for (a chunk of its own).
  const [citation, setCitation] = useState<{ bibtex: string; source: string } | null>(null);
  useEffect(() => {
    let live = true;
    void import("../generated/idtrack_docs.json").then((m) => {
      if (live) setCitation(m.default.citation);
    });
    return () => {
      live = false;
    };
  }, []);
  // Opened, the citation is brought into view and its first copy takes the focus (the press is answered where the eye is).
  const ref = useRef<HTMLElement>(null);
  const shown = citation !== null;
  useEffect(() => {
    const section = ref.current;
    if (!shown || !section) return;
    const matchMedia = (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
    const reduced =
      typeof matchMedia === "function" && matchMedia.call(window, "(prefers-reduced-motion: reduce)").matches;
    // A document without layout (a test's DOM) has no scrolling.
    if (typeof section.scrollIntoView === "function")
      section.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    section.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [shown]);
  const bibtex = citation ? citationOf(citation.bibtex, known) : "";
  const bridges = new URL(apiUrl ?? "/", "http://page.invalid").searchParams.get("allow_bridges") !== "false";
  const sentence = known
    ? methodsSentence({
        result,
        description,
        version: known,
        database,
        bridges,
        date: new Date().toISOString().slice(0, 10),
      })
    : null;
  return (
    <section className="answer__cite" id={id} aria-label="How to cite this conversion" ref={ref}>
      {citation ? (
        <>
          <p className="answer__cite-head">
            Cite IDTrack{" "}
            <a href={citation.source} target="_blank" rel="noreferrer">
              as its documentation gives it<span className="visually-hidden"> (opens in a new tab)</span>
              <span aria-hidden="true"> ↗</span>
            </a>
            , with the version that answered here <CopyButton text={bibtex} what="the citation" />
          </p>
          <pre className="raw raw--cite" role="region" aria-label="Citation in BibTeX" tabIndex={0}>
            {bibtex}
          </pre>
        </>
      ) : (
        <p className="muted">Reading IDTrack&apos;s citation…</p>
      )}
      {sentence ? (
        <>
          <p className="answer__cite-head">
            For a methods section, this conversion{" "}
            <CopyButton text={sentence} what="the sentence for a methods section" />
          </p>
          <p className="answer__cite-sentence">{sentence}</p>
          <p className="muted small">
            Written from this answer, the graph&apos;s description and <span className="mono">GET /api/v1/version</span>
            , with today&apos;s date; the digest names the graph exactly. A batch, or a whole study, is cited from the
            Method page.
          </p>
        </>
      ) : null}
    </section>
  );
}

/** The caution's glyph, as the evidence marks draw it (a small triangle: a shape, never colour alone). */
function CautionGlyph() {
  return (
    <svg
      className="evidence__glyph evidence__glyph--caution"
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
    >
      <path d="M5 0.8 L9.4 9 L0.6 9 Z" />
    </svg>
  );
}

/** The way on from a link of idtrack's documentation on limitations. */
function LimitationLink({ anchors }: { anchors: readonly string[] }) {
  const limitation = limitationAt(anchors);
  if (!limitation) return null;
  return (
    <>
      {" "}
      <a href={limitation.href} target="_blank" rel="noreferrer">
        {limitation.title}
        <span className="visually-hidden"> (IDTrack&apos;s documentation, opens in a new tab)</span>
        <span aria-hidden="true"> ↗</span>
      </a>
    </>
  );
}

/** What an identifier that is not found may be, judged by its form alone, never by a guess of the gene: a name
 *  authority's own id (`HGNC:11998`: a prefix that is the first word of one of the organism's symbol databases, served
 *  by `/databases`), an id of a scheme idtrack's graphs do not hold (`lib/noTarget.ts`), or a date a spreadsheet made of
 *  a symbol. */
function NotFoundHints({ result, organism }: { result: ConversionResult; organism: string }) {
  const authorityForm = /^([A-Za-z]+):\d+$/.exec(result.query_id);
  const databases = useRequest(authorityForm ? `databases:${organism}` : null, (signal, fresh) =>
    api.databases(organism, { signal, fresh }),
  );
  const prefix = (authorityForm?.[1] ?? "").toUpperCase();
  const authority =
    authorityForm && databases.state === "done"
      ? databases.answer.data.symbol_databases.find((d) => d.split(" ")[0]?.toUpperCase() === prefix)
      : undefined;
  const scheme = notHeldScheme(result.query_id);
  const date = looksLikeSpreadsheetDate(result.query_id);
  return (
    <>
      {authority ? (
        <p className="answer__next answer__hint">
          <Mono>{result.query_id}</Mono> has the form of {prefix}&apos;s own id of a gene. IDTrack&apos;s graphs hold
          the names and ids Ensembl attaches to genes, and not the name authorities&apos; own ids: ask by the
          gene&apos;s {authority} or its Ensembl id.
          <LimitationLink anchors={LIMITATION_OF.not_held} />
        </p>
      ) : null}
      {scheme ? (
        <p className="answer__next answer__hint">
          <Mono>{result.query_id}</Mono> has the form of {NOT_HELD_WORDS[scheme].what}. {NOT_HELD_WORDS[scheme].instead}
          <LimitationLink anchors={LIMITATION_OF.not_held} />
        </p>
      ) : null}
      {date ? (
        <p className="answer__next answer__hint">
          <Mono>{result.query_id}</Mono> has the form of a date a spreadsheet makes of a cell: a symbol such as MARCH1
          or SEPT2 opened in a spreadsheet becomes one. Export the column as text and convert it again.
        </p>
      ) : null}
      <OtherGraphs result={result} organism={organism} />
    </>
  );
}

/** An identifier not found here, asked of the server's other graphs (one conversion each, the identifier as written):
 *  where another graph holds it, the page says so and links the conversion there. idtrack converts within one organism;
 *  this is the same string in another organism's graph, never a counterpart. */
function OtherGraphs({ result, organism }: { result: ConversionResult; organism: string }) {
  // The graphs the server holds (the answer the page read at its start, held for the session).
  const held = useRequest("organisms", (signal, fresh) => api.organisms({ signal, fresh }));
  const others =
    held.state === "done" ? held.answer.data.organisms.map((o) => o.organism).filter((o) => o !== organism) : [];
  const key = `${organism}|${result.query_id}|${others.join(",")}`;
  const [found, setFound] = useState<{ key: string; organisms: string[] } | null>(null);
  useEffect(() => {
    if (!others.length) return;
    const controller = new AbortController();
    void Promise.all(
      others.map((other) =>
        api
          .convert(other, { identifier: result.query_id, explain: false }, { signal: controller.signal })
          .then((a) => (a.data.status === "not_found" ? null : other))
          .catch(() => null),
      ),
    ).then((list) => {
      if (!controller.signal.aborted) setFound({ key, organisms: list.filter((o) => o !== null) });
    });
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the organisms and the identifier are named by the key
  }, [key]);
  const holding = found?.key === key ? found.organisms : [];
  if (!holding.length) return null;
  return (
    <p className="answer__next answer__hint answer__elsewhere">
      <Mono>{result.query_id}</Mono> is an identifier of {holding.length === 1 ? "another graph" : "other graphs"} this
      server holds:{" "}
      {holding.map((other, i) => (
        <span key={other}>
          {i ? ", " : ""}
          <Link to={convertHref(other, plainConversion(result.query_id))}>
            convert it in <em>{organismName(other)}</em>
            {commonName(other) ? ` (${commonName(other) ?? ""})` : ""} →
          </Link>
        </span>
      ))}
      . IDTrack converts within one organism, never across species: the answer there is that organism&apos;s gene.
    </p>
  );
}

/** The other genes a result without an id in the database asked for reached, ranked below: idtrack takes the target
 *  from the best answer only, so their ids were not looked up; each is a link that converts it to that database. */
function OtherGenesReached({
  absent,
  organism,
  result,
  requestedDatabase,
  context,
}: {
  absent: NoTarget;
  organism: string;
  result: ConversionResult;
  requestedDatabase: string | null;
  context: IdContext;
}) {
  if (!absent.others.length) return null;
  const asked = requestedDatabase ?? "ensembl_gene";
  return (
    <div className="answer__others">
      <p>
        {absent.others.length === 1 ? "One other gene was" : `${absent.others.length} other genes were`} reached, ranked
        below; IDTrack takes the target from the best answer only, so{" "}
        {absent.others.length === 1 ? "its id" : "their ids"} in {databaseLabel(asked)} were not looked up. To have
        them, convert each to {databaseLabel(asked)}:
      </p>
      <ul className="answer__other-genes">
        {absent.others.slice(0, 12).map((gene) => (
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
            </Link>{" "}
            <SymbolOf gene={gene} context={context} />
          </li>
        ))}
      </ul>
      {absent.others.length > 12 ? (
        <p className="muted">and {absent.others.length - 12} more, listed on the Decision tab.</p>
      ) : null}
      {absent.limitation ? (
        <p className="answer__limitation">
          A known limitation of IDTrack: <Prose text={absent.limitation} />{" "}
          <Link to={href("/method")}>IDTrack&apos;s limitations</Link>
        </p>
      ) : null}
    </div>
  );
}

/** The versions of an id the graph holds listed as links at first (the rest named after them). */
const VERSIONS_SHOWN = 12;

/** The ways on from a result without an answer: the id without its version, the versions the graph holds, what a
 *  string not found may be, the life of a retired id, the names of the graph, and the api's error. */
function NoAnswerWaysOn({
  result,
  organism,
  description,
  requestedDatabase,
}: {
  result: ConversionResult;
  organism: string;
  description: GraphDescription;
  requestedDatabase: string | null;
}) {
  const base = result.status === "unknown_version" ? stableId(result.query_id) : null;
  const given = result.from_release_given ?? result.from_release;
  return (
    <>
      {base && base !== result.query_id ? (
        <p className="answer__next">
          <Link
            to={convertHref(organism, {
              ...plainConversion(base),
              fromRelease: given,
              toRelease: result.to_release,
              finalDatabase: requestedDatabase,
            })}
          >
            Convert <Mono>{base}</Mono> without its version
            {given !== null ? ` (read at release ${given}: the version of that release)` : ""}
          </Link>
        </p>
      ) : null}
      {result.known_versions.length ? (
        <div className="answer__versions">
          <p>
            The {result.known_versions.length} versions the graph holds, each converted on a press
            {given !== null ? ` (from the release each is read at, to ${result.to_release})` : ""}:
          </p>
          <ul className="answer__other-genes">
            {result.known_versions.slice(0, VERSIONS_SHOWN).map((v) => (
              <li key={v}>
                <Link
                  to={convertHref(organism, {
                    ...plainConversion(v),
                    toRelease: result.to_release,
                    finalDatabase: requestedDatabase,
                  })}
                >
                  <Mono>{v}</Mono>
                </Link>
              </li>
            ))}
          </ul>
          {result.known_versions.length > VERSIONS_SHOWN ? (
            <p className="muted">
              and {result.known_versions.length - VERSIONS_SHOWN} more:{" "}
              {result.known_versions.slice(VERSIONS_SHOWN).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {result.status === "not_found" ? <NotFoundHints result={result} organism={organism} /> : null}
      {result.status === "no_conversion" ? <RetiredLife result={result} description={description} /> : null}
      {result.status === "not_found" ? (
        <p className="answer__next">
          <Link to={href("/names", { organism, name: result.query_id, fold_case: true })}>
            Look <Mono>{result.query_id}</Mono> up among the names of the graph
          </Link>{" "}
          <span className="muted">(without letter case)</span>
        </p>
      ) : null}
      {result.error ? (
        <p className="answer__error">
          <Term code={result.error.type} meaning={null} />: {result.error.message}
        </p>
      ) : null}
    </>
  );
}

export const AnswerPanel = memo(function AnswerPanel({
  result,
  model,
  description,
  requestedDatabase,
  apiUrl,
  serverTiming,
  raw,
  marks,
  context,
  id,
  requestId,
  receivedAt,
}: {
  result: ConversionResult;
  model: PathModel;
  description: GraphDescription;
  requestedDatabase: string | null;
  apiUrl: string | null;
  /** The answer's `Server-Timing` header as sent. */
  serverTiming: string | null;
  raw: string;
  marks: EvidenceMark[];
  context: IdContext;
  id: string;
  /** The answer's request id (`X-Request-ID`), for its provenance. */
  requestId: string | null;
  /** When the page received the answer (ISO 8601), for its provenance. */
  receivedAt: string;
}) {
  const vocabulary = useVocabulary();
  const organism = description.organism;
  const bests = result.candidates.filter((c) => c.best);
  const reason = result.reason;
  const reasonMeaning = reason ? vocabulary.reasons.get(reason) : null;
  const asked = requestedDatabase ?? "ensembl_gene";
  const cautions = cautionCount(marks);
  // A tie of the ids of one gene is no doubt about the gene (idtrack calls it a tie: one gene, several targets): it
  // is not drawn in the colour of a tie between genes.
  const oneGene = result.tie && new Set(bests.map((c) => c.gene)).size === 1;
  const tone = oneGene ? "ok" : statusTone(result.status);
  const shownTone = tone === "ok" && cautions ? "caution" : tone;
  const [citing, setCiting] = useState(false);
  // On a phone the actions follow the answer and its evidence; on a wider screen they stand beside the title.
  const phone = usePhone();
  const citeId = `${answerFileName(result, organism)}-cite`;
  const absent = noTargetOf(result);
  const codes = result.reasons.length ? result.reasons : reason ? [reason] : [];
  const { askHref, readAtHref } = evidenceHrefs(organism, result, requestedDatabase);

  const query = (
    <div className="answer__from">
      <p className="answer__label">Query</p>
      <p className={`answer__query-id ${result.query_id.length > 40 ? "answer__query-id--long" : ""}`}>
        <Mono strong>{result.query_id}</Mono>
      </p>
    </div>
  );
  const arrow = (
    <div className="answer__arrow" aria-hidden="true">
      <span className="answer__arrow-line" />
      <span className="answer__arrow-text mono">
        {result.from_release ?? "—"} → {result.to_release}
      </span>
    </div>
  );
  const label = (word: string) => (
    <p className="answer__label">
      {word} · {databaseLabel(asked)} at release <span className="mono">{result.to_release}</span>
    </p>
  );
  const status = (
    <div className={`answer__codes answer__codes--${shownTone} ${oneGene ? "answer__codes--one-gene" : ""}`}>
      <StatusBadge status={result.status} said />
      {tone === "ok" || (cautions > 0 && bests.length > 0 && !result.no_target) ? (
        <span className="answer__caution-count">
          {cautions ? (
            <>
              <CautionGlyph /> with {cautions} caution{cautions === 1 ? "" : "s"} to weigh
            </>
          ) : (
            "no caution"
          )}
        </span>
      ) : null}
      {codes.length && (!bests.length || result.no_target) ? <Reasons codes={codes} /> : null}
      <StatusSentence result={result} model={model} database={databaseLabel(asked)} context={context} />
      <TieGuidance result={result} />
    </div>
  );
  // Only the cautions stand with the verdict, each on its line (a caution changes how the answer may be used); the
  // notes are on the answer's Evidence tab.
  const cautionLines = (
    <CautionLines marks={marks.filter((m) => m.tone === "caution")} askHref={askHref} readAtHref={readAtHref} />
  );
  const actions = (
    <Actions
      result={result}
      apiUrl={apiUrl}
      description={description}
      raw={raw}
      requestId={requestId}
      serverTiming={serverTiming}
      receivedAt={receivedAt}
      citing={citing}
      onCite={() => {
        setCiting((v) => !v);
      }}
    />
  );
  // The query, the arrow and the answer on one line, the actions at its right end (on a phone they follow the answer).
  const head = (to: ReactNode) => (
    <div className="answer__head">
      <div className="answer__flow">
        {query}
        {arrow}
        <div className="answer__to">{to}</div>
      </div>
      {phone ? null : actions}
    </div>
  );

  let body;
  if (absent) {
    // The absence is the best answer's only: IDTrack takes the target from the genes of the best answer, and does not
    // look the other genes reached up in the database (they may have an id there).
    body = (
      <>
        {head(
          <>
            {label("Reached")}
            <p className="answer__headline">
              No {databaseLabel(asked)} for {bestWords(absent.best)} at release {result.to_release}
            </p>
            <p className="answer__reached">
              <span className="answer__reached-label">Best answer</span>{" "}
              {absent.best.map((gene, i) => (
                <span key={gene}>
                  <IdMenu id={gene} release={result.to_release} context={context} strong />{" "}
                  <span className="muted">(Ensembl gene; no {databaseLabel(asked)})</span>
                  {i < absent.best.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          </>,
        )}
        {status}
        {cautionLines}
        <OtherGenesReached
          absent={absent}
          organism={organism}
          result={result}
          requestedDatabase={requestedDatabase}
          context={context}
        />
      </>
    );
  } else if (!bests.length) {
    body = (
      <>
        {head(
          <>
            {label("Asked for")}
            <p className="answer__headline answer__headline--none">
              No answer:{" "}
              {reasonMeaning ? (
                <Prose text={readerText(reasonMeaning).replace(/^The identifier/, "the identifier")} />
              ) : (
                `${statusTitle(result.status).toLowerCase()}.`
              )}
            </p>
          </>,
        )}
        {status}
        {cautionLines}
        <NoAnswerWaysOn
          result={result}
          organism={organism}
          description={description}
          requestedDatabase={requestedDatabase}
        />
      </>
    );
  } else {
    body = (
      <>
        {head(
          <>
            {label("Answer")}
            <AnswerTargets result={result} database={databaseLabel(asked)} context={context} />
          </>,
        )}
        {status}
        {cautionLines}
        <OtherMeanings result={result} readAtHref={readAtHref} context={context} />
        <ReasonNotes result={result} />
      </>
    );
  }

  return (
    <section className={`figure-panel answer-panel answer-panel--${shownTone}`} id={id} aria-labelledby={`${id}-title`}>
      {/* The verdict's heading is for the document's outline and a screen reader: the answer itself is its title. */}
      <h2 id={`${id}-title`} className="visually-hidden">
        The answer
      </h2>
      <div className="answer">{body}</div>
      {phone ? actions : null}
      <Drawer
        open={citing}
        onClose={() => {
          setCiting(false);
        }}
        title="Cite this conversion"
        subtitle="IDTrack's citation, and a sentence for a methods section"
      >
        <CiteBlock
          id={citeId}
          result={result}
          description={description}
          database={databaseLabel(asked)}
          apiUrl={apiUrl}
        />
      </Drawer>
    </section>
  );
});

/** A small strip of the chosen path's steps, one mark per step in its kind's hue. */
function StepStrip({ hues }: { hues: string[] }) {
  if (!hues.length) return null;
  const w = Math.max(3, Math.min(10, Math.floor(150 / hues.length) - 2));
  return (
    <svg className="anatomy__strip" width={hues.length * (w + 2)} height={10} aria-hidden="true">
      {hues.map((hue, i) => (
        <rect
          key={i}
          className={`anatomy__mark anatomy__mark--${hue}`}
          x={i * (w + 2)}
          y={0}
          width={w}
          height={10}
          rx={1}
        />
      ))}
    </svg>
  );
}

function Stage({
  number,
  name,
  to,
  children,
}: {
  number: number;
  name: string;
  to: string | null;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <span className="anatomy__name">
        <span className="anatomy__number mono">{number}</span> {name}
      </span>
      {children}
      {to ? (
        <span className="anatomy__go" aria-hidden="true">
          ↓
        </span>
      ) : null}
    </>
  );
  return (
    <li className="anatomy__stage">
      {to ? (
        <a className="anatomy__link" href={`#${to}`}>
          {content}
        </a>
      ) : (
        <div className="anatomy__link anatomy__link--static">{content}</div>
      )}
    </li>
  );
}

/** The Walked card: the best path's steps and releases, its kinds of step, assemblies and the bridges considered. */
function WalkedStage({
  walked,
  names,
  result,
}: {
  walked: Anatomy["walked"];
  names: AssemblyNames;
  result: ConversionResult;
}) {
  const history = walked.byReason.filter((r) => ["history", "event"].includes(r.hue)).length > 0;
  const span = walked.releases ? [...walked.releases].sort((a, b) => a - b) : null;
  const noAnswer = !result.candidates.some((c) => c.best);
  return (
    <>
      {walked.explained && walked.steps ? (
        <>
          <span className="anatomy__main">
            <Mono>{walked.steps}</Mono> step{walked.steps === 1 ? "" : "s"}
            <span className="anatomy__aside">
              {" "}
              of the best path
              {span && span[0] !== span[1] ? (
                <>
                  , releases{" "}
                  <span className="mono anatomy__range">
                    {span[0]}–{span[1]}
                  </span>
                </>
              ) : null}
            </span>
          </span>
          <StepStrip hues={walked.hues} />
          <span className="anatomy__line">
            {history
              ? kindsText(walked.byReason)
              : `no history step: read through databases at release ${span?.[0] ?? result.to_release}`}
          </span>
          {walked.backward ? (
            <span className="anatomy__line">
              <span aria-hidden="true">← </span>walked backward, to an earlier release
            </span>
          ) : null}
          {walked.assemblies.length > 1 ? (
            <span className="anatomy__line">
              {walked.assemblies.map((a) => assemblyText(a, names)).join(walked.backward ? " ← " : " → ")}
              {walked.handoffs ? ` (${walked.handoffs} handoff${walked.handoffs === 1 ? "" : "s"})` : ""}
            </span>
          ) : null}
          <span className="anatomy__line anatomy__line--quiet">
            {walked.bridgesTaken + walked.bridgesRefused
              ? noAnswer && walked.bridgesTaken
                ? `bridges considered: ${walked.bridgesTaken} allowed, none leading to a gene at release ${result.to_release}; ${walked.bridgesRefused} refused`
                : `bridges considered: ${walked.bridgesTaken} allowed, ${walked.bridgesRefused} refused`
              : "no bridge considered"}
            {walked.refused ? ` · ${walked.refused} history step${walked.refused === 1 ? "" : "s"} refused` : ""}
          </span>
        </>
      ) : (
        <span className="anatomy__main">{walked.explained ? "no path" : "path not asked for"}</span>
      )}
    </>
  );
}

function AnatomyStrip({
  anatomy,
  names,
  links,
  database,
  result,
}: {
  anatomy: Anatomy;
  names: AssemblyNames;
  links: Record<keyof Anatomy, string | null>;
  database: string;
  result: ConversionResult;
}) {
  const { read, walked, ranked, answered } = anatomy;
  const shownDatabases = read.databases.slice(0, 2).map(databaseLabel);
  const more = read.databases.length - shownDatabases.length;
  return (
    <nav className="anatomy" aria-label="How the answer was reached">
      <ol className="anatomy__stages">
        <Stage number={1} name="Read" to={links.read}>
          {read.found && read.match ? (
            <>
              <span className="anatomy__main">
                <ReadMatch match={read.match} />
              </span>
              <span className="anatomy__line">
                as <Mono>{read.graphId}</Mono>
              </span>
              {read.databases.length ? (
                <span className="anatomy__line">
                  through {shownDatabases.join(", ")}
                  {more > 0 ? ` and ${more} more` : ""}
                </span>
              ) : null}
              <span className="anatomy__line">
                at release <Mono>{read.release ?? "—"}</Mono>
                {read.fallback ? ` (${read.given ?? ""} given)` : read.inferred ? ", inferred" : ", as given"}
              </span>
            </>
          ) : (
            <>
              <span className="anatomy__main">
                {read.knownVersions.length ? "version unknown" : "not in the graph"}
              </span>
              {read.knownVersions.length ? (
                <span className="anatomy__line">
                  {read.knownVersions.length} other version{read.knownVersions.length === 1 ? "" : "s"} held
                </span>
              ) : null}
            </>
          )}
        </Stage>
        <Stage number={2} name="Walked" to={links.walked}>
          <WalkedStage walked={walked} names={names} result={result} />
        </Stage>
        <Stage number={3} name="Ranked" to={links.ranked}>
          <span className="anatomy__main">
            <Mono>{groupedInteger(ranked.candidates)}</Mono> candidate{ranked.candidates === 1 ? "" : "s"}
          </span>
          {ranked.decidedBy ? (
            <span className="anatomy__line">
              decided by <strong>{spaced(ranked.decidedBy)}</strong>
              {ranked.position ? `, criterion ${ranked.position} of ${ranked.criteria}` : ""}
            </span>
          ) : ranked.candidates === 1 ? (
            <span className="anatomy__line">one candidate: nothing to decide</span>
          ) : null}
          {ranked.tie ? (
            <span className="anatomy__line">
              {ranked.bestGenes > 1
                ? `${groupedInteger(ranked.best)} equal best: a tie of ${groupedInteger(ranked.bestGenes)} genes`
                : `${groupedInteger(ranked.best)} equal best, all ids of one gene`}
            </span>
          ) : null}
          {ranked.position && ranked.position > 1 ? (
            <span className="anatomy__line anatomy__line--quiet">
              {ranked.position - 1} criteri{ranked.position - 1 === 1 ? "on" : "a"} compared equal before it
            </span>
          ) : null}
        </Stage>
        <Stage number={4} name="Answered" to={links.answered}>
          {answered.targets.length && !answered.noTarget ? (
            <span className="anatomy__main anatomy__target">
              <Mono strong>{answered.targets[0]}</Mono>
              {answered.targets.length > 1 ? (
                <span className="anatomy__aside"> and {groupedInteger(answered.targets.length - 1)} more</span>
              ) : null}
            </span>
          ) : (
            <span className="anatomy__main">
              {answered.noTarget ? `no ${databaseLabel(database)} id` : "no answer"}
            </span>
          )}
          <span className="anatomy__line">in {databaseLabel(database)}</span>
          <span className={`anatomy__status anatomy__status--${statusTone(answered.status)}`}>
            {statusTitle(answered.status)}
          </span>
        </Stage>
      </ol>
    </nav>
  );
}

/** The match in the Read card in words (the card is a link: no control inside it). */
function ReadMatch({ match }: { match: string }) {
  return (
    <>
      {match
        .split(":")
        .map((p) => MATCH_WORDS[p] ?? spaced(p))
        .join(", ")}
    </>
  );
}

/** The answer's record (its Record tab): the facts it was asked and answered with, the server's time on it, and how
 *  it was reached, stage by stage. */
export function AnswerRecord({
  result,
  description,
  requestedDatabase,
  serverTiming,
  context,
  anatomy,
  names,
}: {
  result: ConversionResult;
  description: GraphDescription;
  requestedDatabase: string | null;
  serverTiming: string | null;
  context: IdContext;
  anatomy: Anatomy;
  names: AssemblyNames;
}) {
  const asked = requestedDatabase ?? "ensembl_gene";
  const links = { read: null, walked: null, ranked: null, answered: null };
  return (
    <>
      <Facts result={result} description={description} asked={asked} serverTiming={serverTiming} context={context} />
      <AnatomyStrip anatomy={anatomy} names={names} links={links} database={asked} result={result} />
    </>
  );
}
