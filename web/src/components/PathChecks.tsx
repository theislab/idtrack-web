// What the search weighed beside the path drawn: every bridge it considered, taken or refused, with the rule of each
// id the two genes shared and where the genes lie relative to each other, and the history steps it did not follow,
// each with its rule. The values are the api's (`path.bridges`, `path.refused`); the meanings are idtrack's texts.
import type { ExplainedPath } from "../api/types";
import { buildModel, type PathModel } from "../lib/pathModel";
import { naturalCompare, stepSentence, type AssemblyNames } from "../lib/pathReading";
import { groupedInteger } from "../lib/numbers";
import { prose, yesNo } from "../lib/values";
import { spaced } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";
import { useState } from "react";
import { Button, Mono, TableFrame } from "./ui";

function nodeLabel(model: PathModel, id: string): string {
  return model.nodeById.get(id)?.label ?? id;
}

/** The bridges shown at first, of each verdict; the rest on a press. */
const BRIDGES_SHOWN = 8;
/** The ids a bridge shares shown in its row; the rest on a press. */
const THROUGH_SHOWN = 4;

type Bridge = ExplainedPath["bridges"][number];

function ThroughList({ bridge, model }: { bridge: Bridge; model: PathModel }) {
  const vocabulary = useVocabulary();
  const [all, setAll] = useState(false);
  const shown = all ? bridge.through : bridge.through.slice(0, THROUGH_SHOWN);
  const rest = bridge.through.length - shown.length;
  return (
    <>
      <ul className="plain-list bridge-through">
        {shown.map(([node, rule]) => {
          const meaning = vocabulary.bridgeRules.get(rule)?.meaning;
          return (
            <li key={`${node}|${rule}`}>
              <Mono>{nodeLabel(model, node)}</Mono>:{" "}
              <span className="code-quiet" title={meaning ? prose(meaning) : undefined}>
                {spaced(rule)}
              </span>
            </li>
          );
        })}
      </ul>
      {rest > 0 || all ? (
        <Button variant="quiet" className="bridge-through__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Fewer" : `and ${rest} more`}
        </Button>
      ) : null}
    </>
  );
}

function BridgeTable({
  bridges,
  model,
  label,
  onPath,
}: {
  bridges: Bridge[];
  model: PathModel;
  label: string;
  onPath: (b: Bridge) => boolean;
}) {
  const vocabulary = useVocabulary();
  const [all, setAll] = useState(false);
  const shown = all ? bridges : bridges.slice(0, BRIDGES_SHOWN);
  return (
    <>
      <TableFrame label={label} className="table-frame--cards">
        <table className="table table--bridges table--cards">
          <caption className="visually-hidden">
            {label}: the gene it would leave, the gene it would enter, where the two lie, whether it was taken, and each
            id the two genes shared with its rule.
          </caption>
          <thead>
            <tr>
              <th scope="col">Leaves</th>
              <th scope="col">Enters</th>
              <th scope="col">Places</th>
              <th scope="col">Taken</th>
              <th scope="col">Through (id: rule)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((bridge) => {
              const places = vocabulary.placeRelations.get(bridge.places);
              const chosen = onPath(bridge);
              return (
                <tr
                  key={`${bridge.source}|${bridge.target}`}
                  className={`${bridge.taken ? "is-taken" : "is-refused"} ${chosen ? "is-chosen" : ""}`}
                >
                  <td data-label="Leaves">
                    <Mono>{nodeLabel(model, bridge.source)}</Mono>
                  </td>
                  <td data-label="Enters">
                    <Mono>{nodeLabel(model, bridge.target)}</Mono>
                    {chosen ? <span className="tag tag--best bridge-chosen">on the chosen path</span> : null}
                  </td>
                  <td data-label="Places">
                    <span className="code-quiet" title={places ? prose(places) : undefined}>
                      {spaced(bridge.places)}
                    </span>
                  </td>
                  <td data-label="Taken">
                    <span className={`bridge-verdict bridge-verdict--${bridge.taken ? "taken" : "refused"}`}>
                      {yesNo(bridge.taken)}
                    </span>
                  </td>
                  <td data-label="Through (id: rule)">
                    <ThroughList bridge={bridge} model={model} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      {bridges.length > BRIDGES_SHOWN ? (
        <p className="bridges__more">
          <Button variant="quiet" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? `Show the first ${BRIDGES_SHOWN}` : `Show all ${groupedInteger(bridges.length)}`}
          </Button>
        </p>
      ) : null}
    </>
  );
}

export function BridgesConsidered({ path, model, id }: { path: ExplainedPath; model: PathModel; id: string }) {
  const [refusedOpen, setRefusedOpen] = useState(false);
  if (!path.bridges.length) return null;
  // The bridges of the chosen path: both genes on the path of a best answer.
  const chosenNodes = new Set(
    model.candidates
      .filter((c) => c.best)
      .flatMap((c) => c.steps.flatMap((i) => [model.steps[i]?.api.source, model.steps[i]?.api.target])),
  );
  const onPath = (b: Bridge) => b.taken && chosenNodes.has(b.source) && chosenNodes.has(b.target);
  const order = (a: Bridge, b: Bridge) =>
    Number(onPath(b)) - Number(onPath(a)) ||
    naturalCompare(nodeLabel(model, a.source), nodeLabel(model, b.source)) ||
    naturalCompare(nodeLabel(model, a.target), nodeLabel(model, b.target));
  const taken = path.bridges.filter((b) => b.taken).sort(order);
  const refused = path.bridges.filter((b) => !b.taken).sort(order);
  // The refused by where the two genes lie, the reason a refusal most often has.
  const byPlace = new Map<string, number>();
  for (const b of refused) byPlace.set(b.places, (byPlace.get(b.places) ?? 0) + 1);
  return (
    <section className="result__bridges reading-part" aria-labelledby={`${id}-bridges`}>
      <h3 className="figure-panel__subtitle" id={`${id}-bridges`}>
        Bridges the search considered{" "}
        <span className="muted">
          {path.bridges.length}: {taken.length} taken, {refused.length} refused
        </span>
      </h3>
      <p className="reading-part__lede">
        Where Ensembl&apos;s history leads to no gene at the target release, the search may leave a gene through an id
        it carries for another gene that carries it. Each pair of genes it considered, with every id they shared and the
        rule that took or refused it: the bridges of the chosen path first, the versions of an id in their order.
      </p>
      {taken.length ? (
        <BridgeTable bridges={taken} model={model} label="Bridges taken, one row per pair of genes" onPath={onPath} />
      ) : null}
      {refused.length ? (
        <div className="bridges__refused">
          <p className="bridges__summary">
            <strong>{refused.length} refused</strong>
            {byPlace.size ? (
              <span className="muted"> ({[...byPlace].map(([places, n]) => `${n} ${spaced(places)}`).join(", ")})</span>
            ) : null}{" "}
            <Button variant="quiet" aria-expanded={refusedOpen} onClick={() => setRefusedOpen((v) => !v)}>
              {refusedOpen ? "Hide the refused" : `Show the ${refused.length} refused`}
            </Button>
          </p>
          {refusedOpen ? (
            <BridgeTable
              bridges={refused}
              model={model}
              label="Bridges refused, one row per pair of genes"
              onPath={() => false}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function RefusedSteps({
  path,
  model,
  names,
  id,
}: {
  path: ExplainedPath;
  model: PathModel;
  names: AssemblyNames;
  id: string;
}) {
  const vocabulary = useVocabulary();
  if (!path.refused.length) return null;
  // The refused steps are steps like the path's: read them with the same words, as a path of their own.
  const refused = buildModel({ ...model.result, candidates: [], path: { ...path, steps: path.refused } });
  return (
    <section className="result__refused reading-part" aria-labelledby={`${id}-refused`}>
      <h3 className="figure-panel__subtitle" id={`${id}-refused`}>
        History steps not followed <span className="muted">{path.refused.length}</span>
      </h3>
      <ul className="plain-list refused-list">
        {refused.steps.map((step) => {
          const meaning = vocabulary.stepReasons.get(step.api.reason);
          return (
            <li key={step.index}>
              {stepSentence(step, refused, names)}{" "}
              <span className="muted">
                Refused: {spaced(step.api.reason)}
                {meaning ? ` (${prose(meaning)})` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
