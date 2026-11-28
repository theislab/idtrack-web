// The shell: the header with the organism and the navigation, the page of the address, the footer. Every part that
// can fail is inside an error boundary (the page, keyed by its address; the load monitor), so that a failure is said
// in its place and never leaves a white page; a route change moves the focus to the new page's heading.
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Announcer } from "./components/Announcer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorPanel } from "./components/ErrorPanel";
import { NotFound } from "./components/NotFound";
import { Consent } from "./components/shell/Consent";
import { ConvertSections, Masthead } from "./components/shell/Masthead";
import { SiteFooter } from "./components/shell/SiteFooter";
import { Button, Mono, Skeleton } from "./components/ui";
import { takeReloadNotice } from "./lib/chunks";
import { focusWhenThere, fragmentTarget } from "./lib/focus";
import { organismName } from "./lib/organismNames";
import { OrganismsProvider, useOrganisms } from "./lib/organisms";
import { routeOf } from "./lib/routes";
import { navigate, useLocation } from "./lib/router";
import { organismLike, pageNameOf, setPageTitle } from "./lib/title";
import { ConvertPage } from "./pages/ConvertPage";
import { HomePage } from "./pages/HomePage";
import {
  AccessibilityPage,
  ApiPage,
  BatchPage,
  LegalPage,
  LicencesPage,
  MethodPage,
  NamesPage,
  OrganismPage,
  OrganismsIndex,
  PrivacyPage,
} from "./lib/pageParts";

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
  const pageName = pageNameOf(path);
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
  if (route.page === "home") {
    // The home paints its words at once; its picture comes when the organisms (and then its data) arrive. Where the
    // organisms cannot be read, the words stand and the failure is said under them.
    return (
      <ErrorBoundary part="This page" resetKey={path} framed>
        <HomePage />
        {status === "failed" && error ? (
          <div className="page">
            <ErrorPanel error={error} onRetry={retry} context="The list of organisms" />
          </div>
        ) : null}
      </ErrorBoundary>
    );
  }
  // The site's own pages need no organism.
  if (route.page === "legal" || route.page === "legal-de")
    return (
      <Part path={path}>
        <LegalPage lang={route.page === "legal" ? "en" : "de"} />
      </Part>
    );
  if (route.page === "privacy" || route.page === "privacy-de")
    return (
      <Part path={path}>
        <PrivacyPage lang={route.page === "privacy" ? "en" : "de"} />
      </Part>
    );
  if (route.page === "licences")
    return (
      <Part path={path}>
        <LicencesPage />
      </Part>
    );
  if (route.page === "accessibility")
    return (
      <Part path={path}>
        <AccessibilityPage />
      </Part>
    );
  if (status === "failed" && error) {
    return (
      <div className="page">
        <ErrorPanel error={error} onRetry={retry} context="The list of organisms" level={1} />
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
  // Text from an address never speaks in the site's voice: it is quoted only when it reads as an organism's name.
  const unknown = unknownRequested ? (
    <div className="notice notice--danger page" role="alert">
      <p className="notice__title">An organism this server does not hold</p>
      <p>
        {organismLike(unknownRequested) ? (
          <>
            The organism named in the address, “<Mono>{unknownRequested}</Mono>”, is not loaded here
          </>
        ) : (
          "The organism named in the address is not one this server holds"
        )}
        ; the page shows {organisms[0] ? organismName(organisms[0].organism) : "another"} instead. Choose one in the
        header.
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
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const first = previous.current === null;
    if (previous.current === path) return;
    previous.current = path;
    const main = () => document.getElementById("main");
    // An address with a fragment (`/method#method-evidence`) is a place on the page: it is brought into view and
    // focused once it is drawn (it may come after the page's head), at the first page of a visit too, where the
    // browser's own scroll to it would find it not drawn yet.
    const target = fragmentTarget();
    if (target) return focusWhenThere(main, target);
    return first ? undefined : focusWhenThere(main, "h1");
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
      <ConvertSections />
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
      <Masthead />
      <Main />
      <SiteFooter />
      <Consent />
      <Announcer />
    </OrganismsProvider>
  );
}
