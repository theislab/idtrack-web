// The home: one screen, a display piece. The headline, one sentence and two calls to action (Convert, the
// documentation) come first; then the picture of the graph in view (components/hero/HeroField.tsx, its own chunk,
// asked for once the page is idle), one of three, drawn in the room the words leave, with its caption at the foot.
// Nothing in the picture can be focused or pressed; it answers the pointer only as light. The words paint first and
// never wait for the picture. Whatever keeps the picture away (the server unreachable, no graph, an organism the
// server does not hold) is said in the caption's line, on the one screen.
import { Suspense, useEffect, useId, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Link } from "../components/ui";
import { HERO_CHOICES, useHeroChoice } from "../lib/hero/choice";
import { failureWords } from "../lib/hero/failure";
import { lazyPart } from "../lib/lazyPart";
import { docsPage } from "../lib/links";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href } from "../lib/router";
import "../styles/hero.css";

const HeroField = lazyPart(() => import("../components/hero/HeroField").then((m) => ({ default: m.HeroField })));

/** True once the page has painted and the browser is idle (the picture never competes with the first paint). */
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

/** The caption's line where there is no picture to draw: what keeps it away, in words (null: nothing to say yet). */
function HomeStatement({ words }: { words: string | null }) {
  return (
    <figure className="hero2__figure">
      <figcaption className="hero2__caption">
        <span className="hero2__state" role="status">
          {words}
        </span>
      </figcaption>
    </figure>
  );
}

export function HomePage() {
  const id = useId();
  const { current, status, error, organisms, unknownRequested } = useOrganisms();
  const choice = useHeroChoice();
  const idle = useIdle();
  const label = HERO_CHOICES.find((c) => c.value === choice)?.label ?? "";
  const note =
    unknownRequested && current
      ? `No graph named “${unknownRequested}” is held here; the picture shows the ${organismName(current.organism)} graph.`
      : null;
  let picture;
  if (status === "failed" && error)
    picture = (
      <HomeStatement words={`The picture could not be drawn: ${failureWords("GET /api/v1/organisms", error, true)}`} />
    );
  else if (status === "done" && !organisms.length)
    picture = (
      <HomeStatement words="This server holds no graph yet: it loads its graphs when it starts. Reload the page in a moment." />
    );
  else if (current && idle)
    picture = (
      <ErrorBoundary part={`The picture “${label}”`} resetKey={`${current.organism}|${choice}`} size="inline">
        <Suspense fallback={<HomeStatement words={null} />}>
          <HeroField key={`${current.organism}|${choice}`} description={current} choice={choice} note={note} />
        </Suspense>
      </ErrorBoundary>
    );
  else picture = <HomeStatement words={null} />;
  return (
    <section className="hero2" aria-labelledby={`${id}-title`}>
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
      <div className="hero2__stage">{picture}</div>
    </section>
  );
}
