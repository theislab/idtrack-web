// The masthead (DIRECTION.md, "The shell"): the mark and IDTrack; four sections and the documentation; at the right
// the organism in view (a chip opening the organisms; on the home, Convert, A list and Names, the pages that work in
// one graph), the server's state (a dot, with its readings at rest on a wide screen and its word whenever it is not
// ok; the load panel on a press), the command palette (⌘K / Ctrl K) and the theme. Glass over the page. On a phone:
// the mark, the organism, the state, the palette and a menu button opening the sections in a drawer (with the home's
// picture below 360 px); the organisms open as a sheet from the bottom; the masthead slides back in when the page is
// scrolled up. Every link carries the organism in view.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { announce } from "../../lib/announce";
import { chooseHero, HERO_CHOICES, useHeroChoice } from "../../lib/hero/choice";
import { whenIdle } from "../../lib/idle";
import { lazyPart } from "../../lib/lazyPart";
import { preloadRoute } from "../../lib/pageParts";
import { docsPage } from "../../lib/links";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { useRecentConversions } from "../../lib/recent";
import { routeOf } from "../../lib/routes";
import { href, useLocation } from "../../lib/router";
import { usePhone } from "../../lib/usePhone";
import { ErrorBoundary } from "../ErrorBoundary";
import { LoadMonitor } from "../LoadMonitor";
import { LogoMark } from "../Logo";
import { ThemeSwitch } from "../ThemeSwitch";
import { Link } from "../ui";
import { Drawer } from "../v2/Drawer";
import { HoverCard } from "../v2/HoverCard";
import { HeroMenu } from "./HeroMenu";
import "../../styles/masthead.css";

const CommandPalette = lazyPart(() => import("../v2/CommandPalette").then((m) => ({ default: m.CommandPalette })));

/** The sections of the site; Convert holds one identifier, a list and names (their own tabs under the masthead). */
const SECTIONS: { path: string; label: string; holds: string[] }[] = [
  { path: "/convert", label: "Convert", holds: ["/convert", "/batch", "/names"] },
  { path: "/organisms", label: "Explore", holds: ["/organisms"] },
  { path: "/method", label: "Method", holds: ["/method"] },
  { path: "/developers", label: "API", holds: ["/developers"] },
];

/** The pages that work in one graph: they show the organism in view and let another be chosen in the masthead. */
const IN_ONE_GRAPH = new Set(["home", "convert", "batch", "names"]);

const inSection = (holds: string[], path: string) =>
  routeOf(path).page !== "none" && holds.some((h) => path === h || path.startsWith(`${h}/`));

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The organisms, each its binomial and common name; the one in view marked. */
function OrganismOptions({ onChoose, current }: { onChoose: (organism: string) => void; current: string }) {
  const { organisms } = useOrganisms();
  return (
    <ul className="org-chip__list" aria-label="Organisms">
      {organisms.map((o) => (
        <li key={o.organism}>
          <button
            type="button"
            className="org-chip__option"
            aria-current={o.organism === current ? "true" : undefined}
            onClick={() => {
              onChoose(o.organism);
            }}
          >
            <span className="org-chip__binomial">{organismName(o.organism)}</span>
            {commonName(o.organism) ? (
              <span className="org-chip__common">{capital(commonName(o.organism) ?? "")}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function OrganismChip() {
  const { organisms, current, choose, status } = useOrganisms();
  const phone = usePhone();
  const [sheet, setSheet] = useState(false);
  // While the organisms come, the chip's room is held, so nothing beside it moves.
  if (status === "loading") return <span className="org-chip org-chip--waiting" aria-hidden="true" />;
  if (!current || organisms.length === 0) return null;
  const short = capital(commonName(current.organism) ?? organismName(current.organism));
  const name = `${short}: the organism in view (${organismName(current.organism)}); choose another`;
  const pick = (organism: string) => {
    choose(organism);
    const common = commonName(organism);
    announce(`Organism: ${common ? `${capital(common)} (${organismName(organism)})` : organismName(organism)}.`);
  };
  const face = (
    <>
      <span className="org-chip__name">{short}</span>
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
        <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </>
  );
  // On a phone the organisms open as a sheet from the bottom, a finger's row each.
  if (phone)
    return (
      <span className="org-chip">
        <button
          type="button"
          className="org-chip__button"
          aria-haspopup="dialog"
          aria-expanded={sheet}
          aria-label={name}
          onClick={() => {
            setSheet(true);
          }}
        >
          {face}
        </button>
        <Drawer
          open={sheet}
          onClose={() => {
            setSheet(false);
          }}
          title="Organism in view"
          className="drawer--organisms"
          closeLabel="Close the organisms"
        >
          <OrganismOptions
            current={current.organism}
            onChoose={(organism) => {
              setSheet(false);
              pick(organism);
            }}
          />
        </Drawer>
      </span>
    );
  return (
    <HoverCard hover={false} className="org-chip" triggerClassName="org-chip__button" label={name} trigger={face}>
      {(close) => (
        <OrganismOptions
          current={current.organism}
          onChoose={(organism) => {
            close();
            pick(organism);
          }}
        />
      )}
    </HoverCard>
  );
}

/** The home's picture as a group of radios in the phone's drawer (below 360 px, where the masthead has no room for
 *  its button). */
function PictureChoice() {
  const choice = useHeroChoice();
  return (
    <fieldset className="mast__pictures">
      <legend className="mast__pictures-title">Home page picture</legend>
      {HERO_CHOICES.map((c) => (
        <label key={c.value} className="mast__picture">
          <input
            type="radio"
            name="home-picture"
            value={c.value}
            checked={c.value === choice}
            onChange={() => {
              chooseHero(c.value);
            }}
          />
          {c.label}
        </label>
      ))}
    </fieldset>
  );
}

/** A page's code is asked for when a link to it is pointed at or focused, so that its press draws it at once. */
function preloadPointed(event: Event): void {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  const to = link?.getAttribute("href");
  if (to?.startsWith("/")) void preloadRoute(new URL(to, window.location.href).pathname);
}

/** Where the masthead scrolls with the page (a phone, a short window), it slides back in when the page is scrolled
 *  up, and away again when it is scrolled down. */
function useHeadroom(): boolean {
  const [away, setAway] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const matchMedia = (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
    const fixed =
      typeof matchMedia === "function" ? matchMedia.call(window, "(min-width: 641px) and (min-height: 600px)") : null;
    last.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const step = y - last.current;
      if (fixed?.matches || y < 64) setAway(false);
      else if (step > 4) setAway(true);
      else if (step < -4) setAway(false);
      if (Math.abs(step) > 4) last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return away;
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
  const away = useHeadroom();
  // A page's code is asked for when its link is pointed at or focused.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    element.addEventListener("pointerover", preloadPointed);
    element.addEventListener("focusin", preloadPointed);
    return () => {
      element.removeEventListener("pointerover", preloadPointed);
      element.removeEventListener("focusin", preloadPointed);
    };
  }, []);
  useRecentConversions(current?.organism ?? null);
  const openPalette = useCallback(() => {
    setPalette(true);
  }, []);
  usePaletteKey(openPalette);
  // What a press will open is fetched once the page is idle, and again on pointing or focus: the first press answers
  // at once.
  useEffect(() => {
    return whenIdle(() => {
      void CommandPalette.preload();
    });
  }, []);
  // A new page closes the phone's menu.
  const [shownPath, setShownPath] = useState(location.path);
  if (shownPath !== location.path) {
    setShownPath(location.path);
    if (menu) setMenu(false);
  }
  const page = routeOf(location.path).page;
  const keep = current ? { organism: current.organism } : {};
  const links = (
    <>
      {SECTIONS.map((s) => (
        <Link key={s.path} to={href(s.path, keep)} className="mast__link" current={inSection(s.holds, location.path)}>
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
    <header className={`mast${away ? " mast--away" : ""}`}>
      <div className="mast__inner">
        <Link to={href("/", keep)} className="mast__brand" label="IDTrack, home">
          <LogoMark className="mast__mark" />
          <span className="mast__name" aria-hidden="true">
            IDTrack
          </span>
        </Link>
        <nav className="mast__nav" aria-label="Main" ref={nav}>
          {links}
        </nav>
        <div className="mast__tools">
          {IN_ONE_GRAPH.has(page) ? <OrganismChip /> : null}
          <ErrorBoundary part="The load monitor" size="inline">
            <LoadMonitor />
          </ErrorBoundary>
          <button
            type="button"
            className="mast__palette"
            onClick={openPalette}
            onPointerEnter={() => {
              void CommandPalette.preload();
            }}
            onFocus={() => {
              void CommandPalette.preload();
            }}
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
          {page === "home" ? <HeroMenu /> : null}
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
        {page === "home" ? <PictureChoice /> : null}
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
