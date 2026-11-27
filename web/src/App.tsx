// The shell: the header with the organism and the navigation, the page of the address, the footer. Every part that
// can fail is inside an error boundary (the page, keyed by its address; the load monitor), so that a failure is said
// in its place and never leaves a white page; a route change moves the focus to the new page's heading.
import { BENCHMARKS_SOURCE, docsPage, IDTRACK_PACKAGE, IDTRACK_SOURCE, SITE_SOURCE } from "./lib/links";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Announcer } from "./components/Announcer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorPanel } from "./components/ErrorPanel";
import { LoadMonitor } from "./components/LoadMonitor";
import { Logo, LogoMark } from "./components/Logo";
import { NotFound } from "./components/NotFound";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { Button, Link, Mono, Select, Skeleton } from "./components/ui";
import { takeReloadNotice } from "./lib/chunks";
import { focusWhenThere } from "./lib/focus";
import { lazyPart } from "./lib/lazyPart";
import { commonName, organismName, shortOrganismName } from "./lib/organismNames";
import { OrganismsProvider, useOrganisms } from "./lib/organisms";
import { routeOf } from "./lib/routes";
import { href, navigate, useLocation } from "./lib/router";
import { setPageTitle } from "./lib/title";
import { ConvertPage } from "./pages/ConvertPage";

// Pages other than Convert are loaded when first visited, so that the first page loads small.
const BatchPage = lazyPart(() => import("./pages/BatchPage").then((m) => ({ default: m.BatchPage })));
const NamesPage = lazyPart(() => import("./pages/NamesPage").then((m) => ({ default: m.NamesPage })));
const MethodPage = lazyPart(() => import("./pages/MethodPage").then((m) => ({ default: m.MethodPage })));
const OrganismsIndex = lazyPart(() => import("./pages/OrganismPage").then((m) => ({ default: m.OrganismsIndex })));
const OrganismPage = lazyPart(() => import("./pages/OrganismPage").then((m) => ({ default: m.OrganismPage })));

/** While a page's code loads: the page's frame, as tall as a screen, so the footer does not jump. */
function PageLoading() {
  return (
    <div className="page page--loading" aria-busy="true">
      <p className="visually-hidden">Loading the page…</p>
      <Skeleton width="20%" height={12} />
      <Skeleton width="55%" height={40} className="skeleton--gap" />
      <Skeleton width="100%" height={320} className="skeleton--gap" />
    </div>
  );
}

// The api page is loaded on its first visit (its reference and console are not needed for a conversion).
const ApiPage = lazyPart(() => import("./pages/ApiPage").then((m) => ({ default: m.ApiPage })));

/** The code of the page of an address, fetched at once (beside the entry's own requests of the organisms), so that a
 *  page's code never waits for the organisms to arrive before it is asked for; an address that holds an identifier
 *  also fetches the answer's view beside its conversion. */
function preloadRoute(path: string, search: string): void {
  const route = routeOf(path);
  const part = {
    batch: BatchPage,
    names: NamesPage,
    method: MethodPage,
    organisms: OrganismsIndex,
    organism: OrganismPage,
    developers: ApiPage,
  }[route.page as string];
  part?.preload();
  if (route.page === "convert" && new URLSearchParams(search).has("id"))
    import("./components/ResultView").catch(() => undefined);
}

if (typeof window !== "undefined") preloadRoute(window.location.pathname, window.location.search);

const NAV: [string, string][] = [
  ["/", "Convert"],
  ["/batch", "Batch"],
  ["/names", "Names"],
  ["/organisms", "Explore"],
  ["/developers", "API"],
  ["/method", "Method"],
];

/** Pages whose address carries no organism (the organism is chosen on the page or does not apply). */
const WITHOUT_ORGANISM = new Set(["/organisms", "/developers", "/method"]);

function isActive(path: string, current: string): boolean {
  // An address that is no page is no section of the navigation.
  if (routeOf(current).page === "none") return false;
  if (path === "/") return current === "/";
  return current === path || current.startsWith(`${path}/`);
}

/** Whether a media query matches now, kept current. */
function useMedia(query: string): boolean {
  const media = useMemo(
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null),
    [query],
  );
  const [matches, setMatches] = useState(() => media?.matches ?? false);
  useEffect(() => {
    if (!media) return;
    const change = () => {
      setMatches(media.matches);
    };
    change();
    media.addEventListener("change", change);
    return () => {
      media.removeEventListener("change", change);
    };
  }, [media]);
  return matches;
}

/** Whether a row that scrolls sideways holds more to its left or right (for the fade on that side), kept current as
 *  it scrolls or is resized; no layout is read but in a frame after a scroll or a resize. When `shown` changes (the
 *  page shown), its current link is brought into the row (the row only: the page itself never scrolls for it). */
function useScrollEdges<T extends HTMLElement>(shown: string) {
  const ref = useRef<T>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const row = ref.current;
    const link = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    const start = link.offsetLeft - row.offsetLeft;
    if (start < row.scrollLeft || start + link.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollLeft = Math.max(0, start - 16);
  }, [shown]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const left = element.scrollLeft > 1;
      const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    later();
    element.addEventListener("scroll", later, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", later);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return { ref, more };
}

function Header() {
  const { organisms, current, choose, status } = useOrganisms();
  const location = useLocation();
  // A phone's first row holds the brand, the organism, the load and the theme: the organism's name is abbreviated.
  const narrow = useMedia("(max-width: 480px)");
  const { ref: nav, more } = useScrollEdges<HTMLElement>(location.path);
  const showsOrganism = !location.path.startsWith("/organisms") && !WITHOUT_ORGANISM.has(location.path);
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <Link to={href("/", current ? { organism: current.organism } : {})} className="brand" label="idtrack, home">
          <Logo className="brand__logo" title="idtrack" />
          {/* On a narrow phone the mark alone, so the first row keeps the organism's name whole. */}
          <LogoMark className="brand__mark" />
        </Link>
        <nav
          className={`nav${more.left ? " nav--more-left" : ""}${more.right ? " nav--more-right" : ""}`}
          aria-label="Main"
          ref={nav}
        >
          {NAV.map(([path, label]) => {
            const keep = current && !WITHOUT_ORGANISM.has(path) ? { organism: current.organism } : {};
            return (
              <Link key={path} to={href(path, keep)} className="nav__link" current={isActive(path, location.path)}>
                {label}
              </Link>
            );
          })}
          {/* idtrack's documentation: the reference of the package this site runs, on its own site. */}
          <a href={docsPage()} className="nav__link nav__link--out">
            Docs
            <span className="nav__out" aria-hidden="true">
              ↗
            </span>
            <span className="visually-hidden"> (idtrack&apos;s documentation, another site)</span>
          </a>
        </nav>
        <div className="masthead__tools">
          {status === "done" && showsOrganism && organisms.length > 0 ? (
            <label className="organism-picker">
              <span className="visually-hidden">Organism</span>
              <Select
                value={current?.organism ?? ""}
                onChange={(e) => choose(e.target.value)}
                aria-label="Organism"
                className="organism-picker__select"
              >
                {organisms.map((o) => (
                  <option key={o.organism} value={o.organism}>
                    {narrow ? shortOrganismName(o.organism) : organismName(o.organism)}
                    {!narrow && commonName(o.organism) ? ` (${commonName(o.organism)})` : ""}
                  </option>
                ))}
              </Select>
            </label>
          ) : status === "loading" && showsOrganism ? (
            <Skeleton width={232} height={34} />
          ) : !showsOrganism ? (
            <p className="organism-picker">
              <span className="organism-picker__all">All organisms</span>
            </p>
          ) : (
            <span className="organism-picker" aria-hidden="true" />
          )}
          <ErrorBoundary part="The load monitor" size="inline">
            <LoadMonitor />
          </ErrorBoundary>
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { version, facts } = useOrganisms();
  const releases = version ? [...new Set(version.graphs.map((g) => g.snapshot_release))].join(", ") : null;
  // While /version is on its way, a placeholder; when it failed, said so (never a placeholder for good).
  const pending =
    facts.version === "failed" ? (
      <span className="muted" title="The request of /api/v1/version failed.">
        not read
      </span>
    ) : (
      "…"
    );
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <Logo className="footer__logo" title="idtrack" />
          <p className="footer__claim">
            Gene identifiers followed through Ensembl&apos;s releases, genome assemblies and external databases, with
            the evidence for every step.
          </p>
          <p className="footer__note">
            Conversions and names are idtrack&apos;s own results, shown as the api returns them: no number of a result
            is rounded. The benchmarks&apos; rates on Method are their repository&apos;s, as it writes them.
          </p>
        </div>
        <nav className="footer__col" aria-label="idtrack">
          <p className="footer__head">idtrack</p>
          <a href={docsPage()} className="footer__lead">
            Documentation
          </a>
          <a href={IDTRACK_SOURCE}>Source code on GitHub</a>
          <a href={IDTRACK_PACKAGE}>Python package on PyPI</a>
          <Link to="/method">Method and citation</Link>
        </nav>
        <nav className="footer__col" aria-label="This server">
          <p className="footer__head">This server</p>
          <Link to="/developers">The http api</Link>
          <a href="/llms.txt">For programs: llms.txt</a>
          <a href="/api/v1/openapi.json">OpenAPI document</a>
          <p className="footer__refs">
            Sources, for reference: <a href={SITE_SOURCE}>this site</a> and{" "}
            <a href={BENCHMARKS_SOURCE}>idtrack&apos;s benchmarks</a>.
          </p>
        </nav>
        <dl className="footer__facts">
          <div>
            <dt>idtrack</dt>
            <dd>
              {version ? <Mono>{version.idtrack_version}</Mono> : pending}
              {version?.idtrack_commit ? (
                <span className="footer__commit">
                  {" "}
                  <Mono>{version.idtrack_commit.slice(0, 7)}</Mono>
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Ensembl</dt>
            <dd>{releases ? <Mono>{releases}</Mono> : pending}</dd>
          </div>
          <div>
            <dt>api</dt>
            <dd>{version ? <Mono>{version.api_version}</Mono> : pending}</dd>
          </div>
          <div>
            <dt>Licence</dt>
            <dd>BSD 3-Clause</dd>
          </div>
        </dl>
      </div>
    </footer>
  );
}

/** A lazily loaded page, inside its boundary (started again at another address) and its loading frame. */
function Part({ path, children }: { path: string; children: ReactNode }) {
  return (
    <ErrorBoundary part="This page" resetKey={path} framed>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function Page() {
  const location = useLocation();
  const { status, error, retry, unknownRequested, organisms } = useOrganisms();
  const path = location.path;
  const route = routeOf(path);
  const pageName = route.page === "organism" ? organismName(route.organism) : route.title;
  const redirectTo = route.page === "redirect" ? route.to : null;
  useEffect(() => {
    setPageTitle(pageName);
  }, [pageName]);
  useEffect(() => {
    if (redirectTo !== null) navigate(redirectTo + window.location.search, { replace: true });
  }, [redirectTo]);
  if (route.page === "none") return <NotFound path={path} />;
  if (route.page === "redirect") return <PageLoading />;
  if (route.page === "method")
    return (
      <Part path={path}>
        <MethodPage />
      </Part>
    );
  if (route.page === "developers")
    return (
      <Part path={path}>
        <ApiPage />
      </Part>
    );
  if (status === "failed" && error) {
    return (
      <div className="page">
        <ErrorPanel error={error} onRetry={retry} context="The list of organisms" />
      </div>
    );
  }
  if (status === "loading" && route.page === "convert") {
    // The Convert page's head names no organism: it is drawn at once, its form and figures when the organisms arrive.
    return (
      <>
        {null}
        <ErrorBoundary part="This page" resetKey={path} framed>
          <ConvertPage />
        </ErrorBoundary>
      </>
    );
  }
  if (status === "loading") {
    return (
      <div className="page page--loading" aria-busy="true">
        <p className="visually-hidden">Loading the organisms…</p>
        <Skeleton width="30%" height={14} />
        <Skeleton width="60%" height={40} className="skeleton--gap" />
        <Skeleton width="100%" height={180} className="skeleton--gap" />
      </div>
    );
  }
  if (!organisms.length) {
    return (
      <div className="page">
        <div className="notice" role="status">
          <h1 className="notice__title">This server holds no organism</h1>
          <p>Its graphs are not loaded yet, or none is configured. Ask again in a moment.</p>
          <div className="notice__actions">
            <Button onClick={retry}>Ask again</Button>
          </div>
        </div>
      </div>
    );
  }
  const unknown = unknownRequested ? (
    <div className="notice notice--danger page" role="alert">
      <p className="notice__title">An organism this server does not hold</p>
      <p>
        <Mono>{unknownRequested}</Mono> is not loaded here; the page shows{" "}
        {organisms[0] ? organismName(organisms[0].organism) : "another"} instead. Choose one in the header.
      </p>
    </div>
  ) : null;
  let page;
  if (route.page === "convert")
    page = (
      <ErrorBoundary part="This page" resetKey={path} framed>
        <ConvertPage />
      </ErrorBoundary>
    );
  else if (route.page === "batch")
    page = (
      <Part path={path}>
        <BatchPage />
      </Part>
    );
  else if (route.page === "names")
    page = (
      <Part path={path}>
        <NamesPage />
      </Part>
    );
  else if (route.page === "organisms")
    page = (
      <Part path={path}>
        <OrganismsIndex />
      </Part>
    );
  else
    page = (
      <Part path={path}>
        <OrganismPage />
      </Part>
    );
  return (
    <>
      {unknown}
      {page}
    </>
  );
}

/** A route change (another path, not another query of the same page) moves the focus to the new page's heading, as
 *  a page load would put a reader at the top; the first page of a visit is left as the browser opens it. */
function useRouteFocus(path: string): void {
  const previous = useRef(path);
  useEffect(() => {
    if (previous.current === path) return;
    previous.current = path;
    const main = () => document.getElementById("main");
    return focusWhenThere(main, "h1");
  }, [path]);
}

/** After the page was reloaded to fetch the site's current code (lib/chunks.ts): said once. */
function ReloadNotice() {
  const [shown, setShown] = useState(takeReloadNotice);
  if (!shown) return null;
  return (
    <div className="notice page reload-notice" role="status">
      <p>
        A part of this page&apos;s code could not be fetched (the site may have been updated since the page was opened),
        so the page was reloaded once to fetch the site&apos;s current code. What you had typed is kept.
      </p>
      <div className="notice__actions">
        <Button
          variant="quiet"
          onClick={() => {
            setShown(false);
          }}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function Main() {
  const location = useLocation();
  useRouteFocus(location.path);
  return (
    <main id="main" tabIndex={-1}>
      <ReloadNotice />
      <Page />
    </main>
  );
}

export function App() {
  return (
    <OrganismsProvider>
      <a className="skip" href="#main">
        Skip to the content
      </a>
      <Header />
      <Main />
      <Footer />
      <Announcer />
    </OrganismsProvider>
  );
}
