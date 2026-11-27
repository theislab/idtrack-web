// Stage c's check on a real answer: every bridge the search considered (`path.bridges`), taken or refused, with where
// the two genes lie relative to each other (a place relation) and, for each id they shared, the rule that took or
// refused it, by their codes in words; their meanings (the api's vocabulary) are the terms of the panel, beside. A few
// at display size, the rest on request.
import type { ConversionResult } from "../../api/types";
import { spaced } from "../../lib/vocabulary";
import { Disclosure, Mono } from "../ui";

const SHOWN = 3;

type Bridge = NonNullable<ConversionResult["path"]>["bridges"][number];

function Check({ b }: { b: Bridge }) {
  return (
    <li className={b.taken ? "bridge-checks__taken" : "bridge-checks__refused"}>
      <p className="bridge-checks__pair">
        <Mono>{b.source}</Mono> <span aria-hidden="true">→</span>
        <span className="visually-hidden"> to </span> <Mono>{b.target}</Mono>{" "}
        <strong className="bridge-checks__verdict">{b.taken ? "taken" : "refused"}</strong>
      </p>
      <p className="bridge-checks__places">
        places: <span className="mono">{spaced(b.places)}</span>
        {b.through.map(([id, rule]) => (
          <span key={`${id}-${rule}`}>
            {" "}
            · through <Mono>{id}</Mono>, rule <span className="mono">{spaced(rule)}</span>
          </span>
        ))}
      </p>
    </li>
  );
}

export function BridgeChecks({ result }: { result: ConversionResult }) {
  const bridges = result.path?.bridges ?? [];
  if (!bridges.length) return null;
  const key = (b: Bridge) => `${b.source}>${b.target}`;
  return (
    <div className="bridge-checks">
      <h3 className="label">The bridges the search considered ({bridges.length})</h3>
      <ul>
        {bridges.slice(0, SHOWN).map((b) => (
          <Check key={key(b)} b={b} />
        ))}
      </ul>
      {bridges.length > SHOWN ? (
        <Disclosure summary={`and ${bridges.length - SHOWN} more`}>
          <ul>
            {bridges.slice(SHOWN).map((b) => (
              <Check key={key(b)} b={b} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
      <p className="small muted">The place relations and the rules are defined in this panel&apos;s terms.</p>
    </div>
  );
}
