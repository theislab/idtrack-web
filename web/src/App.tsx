// The shell: the header with the organism and the navigation, the page of the address, the footer.
import { useEffect, useState } from "react";
import { ErrorPanel } from "./components/ErrorPanel";
import { Link, Mono, Select, Skeleton } from "./components/ui";
import { commonName, organismName } from "./lib/organismNames";
import { OrganismsProvider, useOrganisms } from "./lib/organisms";
import { href, useLocation } from "./lib/router";
import { AboutPage } from "./pages/AboutPage";
import { BatchPage } from "./pages/BatchPage";
import { ConvertPage } from "./pages/ConvertPage";
import { NamesPage } from "./pages/NamesPage";
import { OrganismPage, OrganismsIndex } from "./pages/OrganismPage";

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    const value = window.localStorage.getItem("idtrack-theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      if (theme === "system") window.localStorage.removeItem("idtrack-theme");
      else window.localStorage.setItem("idtrack-theme", theme);
    } catch {
      // Storage may be off (a private window): the choice then lasts for this page only.
    }
  }, [theme]);
  return (
    <div className="theme">
      <Select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
        <option value="system">Theme: system</option>
        <option value="light">Theme: light</option>
        <option value="dark">Theme: dark</option>
      </Select>
    </div>
  );
}

function Mark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M3 25H29" className="brand__axis" />
      <path d="M7 25V22M13 25V22M19 25V22M25 25V22" className="brand__axis" />
      <path d="M6 15H13C16 15 16 9 19 9H26" className="brand__path" />
      <circle cx="6" cy="15" r="2.6" className="brand__node" />
      <circle cx="19" cy="9" r="2.6" className="brand__node" />
      <rect x="24.2" y="6.4" width="5.2" height="5.2" className="brand__node" />
    </svg>
  );
}

const NAV: [string, string][] = [
  ["/", "Convert"],
  ["/batch", "Batch"],
  ["/names", "Names"],
  ["/organisms", "Organisms"],
  ["/about", "About"],
];

function Header() {
  const { organisms, current, choose, status } = useOrganisms();
  const location = useLocation();
  const onOrganismPage = location.path.startsWith("/organisms");
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <Link to={href("/", current ? { organism: current.organism } : {})} className="brand">
          <Mark />
          <span className="brand__name">idtrack</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map(([path, label]) => {
            const active = path === "/" ? location.path === "/" : location.path.startsWith(path);
            const keep = current && path !== "/organisms" && path !== "/about" ? { organism: current.organism } : {};
            return (
              <Link key={path} to={href(path, keep)} className="nav__link" current={active}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="masthead__tools">
          {status === "done" && !onOrganismPage ? (
            <label className="organism-picker">
              <span className="organism-picker__label">Organism</span>
              <Select value={current?.organism ?? ""} onChange={(e) => choose(e.target.value)} aria-label="Organism">
                {organisms.map((o) => (
                  <option key={o.organism} value={o.organism}>
                    {organismName(o.organism)}
                    {commonName(o.organism) ? ` (${commonName(o.organism)})` : ""}
                  </option>
                ))}
              </Select>
            </label>
          ) : status === "loading" ? (
            <Skeleton width={180} height={32} />
          ) : null}
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { version } = useOrganisms();
  return (
    <footer className="footer">
      <div className="footer__inner">
        <p>
          idtrack {version ? <Mono>{version.idtrack_version}</Mono> : null} · graphs of Ensembl{" "}
          {version ? <Mono>{[...new Set(version.graphs.map((g) => g.snapshot_release))].join(", ")}</Mono> : "…"} ·{" "}
          <a href="/api/v1/docs">api</a> · <a href="https://github.com/theislab/idtrack">source</a>
        </p>
        <p className="muted">Results are idtrack's own, shown as the api returns them: no number is rounded.</p>
      </div>
    </footer>
  );
}

function Page() {
  const location = useLocation();
  const { status, error, retry, unknownRequested, organisms } = useOrganisms();
  const path = location.path;
  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Convert",
      "/batch": "Batch",
      "/names": "Names",
      "/organisms": "Organisms",
      "/about": "About",
    };
    const name = titles[path] ?? (path.startsWith("/organisms/") ? organismName(path.slice(11)) : "Not found");
    document.title = `${name} · idtrack`;
  }, [path]);
  if (path === "/about") return <AboutPage />;
  if (status === "failed" && error) {
    return (
      <div className="page">
        <ErrorPanel error={error} onRetry={retry} context="The list of organisms" />
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div className="page" aria-busy="true">
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
          <p className="notice__title">This server holds no organism</p>
          <p>Its graphs are not loaded. Try again later.</p>
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
  if (path === "/") page = <ConvertPage />;
  else if (path === "/batch") page = <BatchPage />;
  else if (path === "/names") page = <NamesPage />;
  else if (path === "/organisms") page = <OrganismsIndex />;
  else if (path.startsWith("/organisms/")) page = <OrganismPage />;
  else
    page = (
      <div className="page">
        <div className="empty">
          <p className="empty__title">No such page</p>
          <p>
            <Mono>{path}</Mono> is not a page of idtrack. <Link to="/">Convert an identifier</Link>.
          </p>
        </div>
      </div>
    );
  return (
    <>
      {unknown}
      {page}
    </>
  );
}

export function App() {
  return (
    <OrganismsProvider>
      <a className="skip" href="#main">
        Skip to the content
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        <Page />
      </main>
      <Footer />
    </OrganismsProvider>
  );
}
