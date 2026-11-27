// The home: one screen, a display piece. The headline, one sentence and two calls to action (Convert, the
// documentation) stand over the lineage field: every gene id of a sample of the graph in view drawn over Ensembl's
// releases, from `GET /organisms/{organism}/lineages` (components/hero/HeroField.tsx, its own chunk, asked for once
// the page is idle). Nothing in the field can be focused or pressed; it answers the pointer only as light. The words
// paint first and never wait for the field.
import { Suspense, useEffect, useId, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Link } from "../components/ui";
import { lazyPart } from "../lib/lazyPart";
import { docsPage } from "../lib/links";
import { useOrganisms } from "../lib/organisms";
import { href } from "../lib/router";
import "../styles/hero.css";

const HeroField = lazyPart(() => import("../components/hero/HeroField").then((m) => ({ default: m.HeroField })));

/** True once the page has painted and the browser is idle (the field never competes with the first paint). */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const done = () => {
      setIdle(true);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(done, { timeout: 1200 });
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(done, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  return idle;
}

export function HomePage() {
  const id = useId();
  const { current } = useOrganisms();
  const idle = useIdle();
  return (
    <section className="hero2" aria-labelledby={`${id}-title`}>
      <div className="hero2__stage">
        {current && idle ? (
          <ErrorBoundary part="The lineage field" resetKey={current.organism} size="inline">
            <Suspense fallback={null}>
              <HeroField description={current} />
            </Suspense>
          </ErrorBoundary>
        ) : null}
      </div>
      <div className="hero2__words">
        <p className="hero2__kicker">Gene identifiers, followed through Ensembl&apos;s history</p>
        <h1 id={`${id}-title`} className="hero2__title">
          Every gene id
          <br /> has a history.
        </h1>
        <p className="hero2__lede">
          IDTrack follows an identifier through Ensembl&apos;s releases to the release and database you ask, and answers
          with the path that led there.
        </p>
        <div className="hero2__actions">
          <Link
            to={href("/convert", current ? { organism: current.organism } : {})}
            className="button button--primary hero2__primary"
          >
            Convert an identifier
          </Link>
          <a href={docsPage()} className="hero2__secondary">
            Read the documentation
            <span aria-hidden="true"> ↗</span>
            <span className="visually-hidden"> (IDTrack&apos;s documentation, another site)</span>
          </a>
        </div>
      </div>
    </section>
  );
}
