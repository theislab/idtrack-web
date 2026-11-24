// What the search weighed beside the path drawn: every bridge it considered, taken or refused, with the rule of each
// id the two genes shared and where the genes lie relative to each other, and the history steps it did not follow,
// each with its rule. The values are the api's (`path.bridges`, `path.refused`); the meanings are idtrack's texts.
import type { ExplainedPath } from "../api/types";
import { buildModel, type PathModel } from "../lib/pathModel";
import { stepSentence, type AssemblyNames } from "../lib/pathReading";
import { prose, yesNo } from "../lib/values";
import { spaced } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";
import { Mono, SectionTitle, TableFrame } from "./ui";

function nodeLabel(model: PathModel, id: string): string {
  return model.nodeById.get(id)?.label ?? id;
}

export function BridgesConsidered({ path, model, id }: { path: ExplainedPath; model: PathModel; id: string }) {
  const vocabulary = useVocabulary();
  if (!path.bridges.length) return null;
  return (
    <section className="result__bridges" aria-labelledby={`${id}-bridges`}>
      <SectionTitle id={`${id}-bridges`} aside={<span className="muted">{path.bridges.length} in all</span>}>
        Bridges the search considered
      </SectionTitle>
      <p className="muted">
        Where Ensembl&apos;s history leads to no gene at the target release, the search may leave a gene through an id
        it carries for another gene that carries it. Each pair of genes it considered, with every id they shared and the
        rule that took or refused it.
      </p>
      <TableFrame label="Bridges, one row per pair of genes" className="table-frame--cards">
        <table className="table table--bridges table--cards">
          <caption className="visually-hidden">
            Every bridge the search considered: the gene it would leave, the gene it would enter, where the two lie,
            whether it was taken, and each id the two genes shared with its rule.
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
            {path.bridges.map((bridge) => {
              const places = vocabulary.placeRelations.get(bridge.places);
              return (
                <tr key={`${bridge.source}|${bridge.target}`} className={bridge.taken ? "is-best" : undefined}>
                  <td data-label="Leaves">
                    <Mono>{nodeLabel(model, bridge.source)}</Mono>
                  </td>
                  <td data-label="Enters">
                    <Mono>{nodeLabel(model, bridge.target)}</Mono>
                  </td>
                  <td data-label="Places">
                    <span className="code-quiet" title={places ? prose(places) : undefined}>
                      {spaced(bridge.places)}
                    </span>
                  </td>
                  <td data-label="Taken">{yesNo(bridge.taken)}</td>
                  <td data-label="Through (id: rule)">
                    <ul className="plain-list">
                      {bridge.through.map(([node, rule]) => {
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
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
    <section className="result__refused" aria-labelledby={`${id}-refused`}>
      <SectionTitle id={`${id}-refused`}>History steps not followed</SectionTitle>
      <ul className="plain-list">
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
