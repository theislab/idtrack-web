// The masthead (DIRECTION.md, "The shell"): the mark and IDTrack; four sections and the documentation; at the right
// the organism in view (a chip opening the organisms), the server's state (a dot; its readings open on pointing or
// focus, the load panel on a press), the command palette (⌘K / Ctrl K) and the theme. Glass over the page. On a phone:
// the mark, the organism, the state, the palette and a menu button opening the sections in a drawer.
import { Suspense, useCallback, useEffect, useState } from "react";
import { lazyPart } from "../../lib/lazyPart";
import { docsPage } from "../../lib/links";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { routeOf } from "../../lib/routes";
import { href, useLocation } from "../../lib/router";
import { ErrorBoundary } from "../ErrorBoundary";
import { LoadMonitor } from "../LoadMonitor";
import { LogoMark } from "../Logo";
import { ThemeSwitch } from "../ThemeSwitch";
import { Link } from "../ui";
import { Drawer } from "../v2/Drawer";
import { HeroMenu } from "./HeroMenu";
import { HoverCard } from "../v2/HoverCard";
import "../../styles/masthead.css";

const CommandPalette = lazyPart(() => import("../v2/CommandPalette").then((m) => ({ default: m.CommandPalette })));

/** The sections of the site; Convert holds one identifier, a list and names (their own tabs under the masthead). */
const SECTIONS: { path: string; label: string; holds: string[] }[] = [
  { path: "/convert", label: "Convert", holds: ["/convert", "/batch", "/names"] },
  { path: "/organisms", label: "Explore", holds: ["/organisms"] },
  { path: "/method", label: "Method", holds: ["/method"] },
  { path: "/developers", label: "API", holds: ["/developers"] },
];

/** Pages whose address carries no organism (the organism is chosen on the page or does not apply). */
const WITHOUT_ORGANISM = new Set(["/organisms", "/developers", "/method"]);

const inSection = (holds: string[], path: string) =>
  routeOf(path).page !== "none" && holds.some((h) => path === h || path.startsWith(`${h}/`));

function OrganismChip() {
  const { organisms, current, choose, status } = useOrganisms();
  // While the organisms come, the chip's room is held, so nothing beside it moves.
  if (status === "loading") return <span className="org-chip org-chip--waiting" aria-hidden="true" />;
  if (!current || organisms.length === 0) return null;
  const short = commonName(current.organism) ?? organismName(current.organism);
  return (
    <HoverCard
      hover={false}
      className="org-chip"
      triggerClassName="org-chip__button"
      label={`${short.charAt(0).toUpperCase() + short.slice(1)}: the organism in view (${organismName(current.organism)}); choose another`}
      trigger={
        <>
          <span className="org-chip__name">{short.charAt(0).toUpperCase() + short.slice(1)}</span>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
            <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </>
      }
    >
      {(close) => (
        <ul className="org-chip__list" aria-label="Organisms">
          {organisms.map((o) => (
            <li key={o.organism}>
              <button
                type="button"
                className="org-chip__option"
                aria-current={o.organism === current.organism ? "true" : undefined}
                onClick={() => {
                  close();
                  choose(o.organism);
                }}
              >
                <span className="org-chip__binomial">{organismName(o.organism)}</span>
                {commonName(o.organism) ? <span className="org-chip__common">{commonName(o.organism)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </HoverCard>
  );
}

/** ⌘K on a Mac, Ctrl K elsewhere. */
function usePaletteKey(open: () => void) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  }, [open]);
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function Masthead() {
  const { current } = useOrganisms();
  const location = useLocation();
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const openPalette = useCallback(() => {
    setPalette(true);
  }, []);
  usePaletteKey(openPalette);
  // A new page closes the phone's menu.
  const [shownPath, setShownPath] = useState(location.path);
  if (shownPath !== location.path) {
    setShownPath(location.path);
    if (menu) setMenu(false);
  }
  const showsOrganism = !location.path.startsWith("/organisms") && !WITHOUT_ORGANISM.has(location.path);
  const keep = (path: string) => (current && !WITHOUT_ORGANISM.has(path) ? { organism: current.organism } : {});
  const links = (
    <>
      {SECTIONS.map((s) => (
        <Link
          key={s.path}
          to={href(s.path, keep(s.path))}
          className="mast__link"
          current={inSection(s.holds, location.path)}
        >
          {s.label}
        </Link>
      ))}
      <a href={docsPage()} className="mast__link mast__link--out">
        Docs
        <span className="mast__out" aria-hidden="true">
          ↗
        </span>
        <span className="visually-hidden"> (IDTrack&apos;s documentation, another site)</span>
      </a>
    </>
  );
  return (
    <header className="mast">
      <div className="mast__inner">
        <Link
          to={href("/", current ? { organism: current.organism } : {})}
          className="mast__brand"
          label="IDTrack, home"
        >
          <LogoMark className="mast__mark" />
          <span className="mast__name" aria-hidden="true">
            IDTrack
          </span>
        </Link>
        <nav className="mast__nav" aria-label="Main">
          {links}
        </nav>
        <div className="mast__tools">
          {showsOrganism ? <OrganismChip /> : null}
          <ErrorBoundary part="The load monitor" size="inline">
            <LoadMonitor />
          </ErrorBoundary>
          <button
            type="button"
            className="mast__palette"
            onClick={openPalette}
            aria-label={`Search, ${MAC ? "⌘" : "Ctrl"} K`}
            title="Search: pages, organisms, the showcase's cases, or what to convert"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
              <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <kbd className="mast__kbd" aria-hidden="true">
              {MAC ? "⌘" : "Ctrl"} K
            </kbd>
          </button>
          {location.path === "/" ? <HeroMenu /> : null}
          <ThemeSwitch />
          <button
            type="button"
            className="mast__menu"
            aria-expanded={menu}
            aria-label="Sections"
            onClick={() => {
              setMenu(true);
            }}
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M2.5 5h11M2.5 11h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <Drawer
        open={menu}
        onClose={() => {
          setMenu(false);
        }}
        title="IDTrack"
        className="drawer--menu"
      >
        <nav className="mast__drawer-nav" aria-label="Sections">
          {links}
        </nav>
      </Drawer>
      {palette ? (
        <ErrorBoundary part="The command palette" size="inline">
          <Suspense fallback={null}>
            <CommandPalette
              onClose={() => {
                setPalette(false);
              }}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </header>
  );
}

/** Convert's own tabs: one identifier, a list, names (each its page and address). */
export function ConvertSections() {
  const { current } = useOrganisms();
  const location = useLocation();
  const keep = current ? { organism: current.organism } : {};
  const tabs: [string, string][] = [
    ["/convert", "One identifier"],
    ["/batch", "A list"],
    ["/names", "Names"],
  ];
  if (!tabs.some(([p]) => p === location.path)) return null;
  return (
    <nav className="sections" aria-label="Convert">
      <div className="sections__inner">
        {tabs.map(([path, label]) => (
          <Link key={path} to={href(path, keep)} className="sections__link" current={location.path === path}>
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
