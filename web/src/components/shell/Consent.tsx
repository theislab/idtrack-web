// The visitor's choice about counting visits, asked once where the server counts visits at all (`analytics_id` of
// `/version`): a slim bar docked at the foot of the window, one sentence and two buttons of one weight, refusing as
// easy as accepting. It comes right after "Skip to the content" in the page, so that a keyboard or a screen reader
// meets it first. While it shows, its height is reserved (`--consent-h`: the home's hero stands above it, every page
// can scroll its last line and a focused link clear of it, styles/consent.css), so it covers nothing. Escape leaves
// it for the page without answering; an answer hands the focus to the page. Once accepted, each page is counted by
// its path and its name (lib/analytics.ts); declined or withdrawn, in this tab or another, Google's tag is stopped and
// its cookies deleted.
import "../../styles/consent.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  countPage,
  setConsent,
  startAnalytics,
  stopAnalytics,
  useConsent,
  type Consent as Choice,
} from "../../lib/analytics";
import { useOrganisms } from "../../lib/organisms";
import { useLocation } from "../../lib/router";
import { Button, Link } from "../ui";

/** Whether the bar takes the focus when it next shows: when the visitor asked for it again ("Cookie settings"), never
 *  when it asks of its own accord. */
let focusWhenShown = false;

/** The page's main region takes the focus without scrolling (an answer leaves the visitor where they were). */
function focusMain(): void {
  document.getElementById("main")?.focus({ preventScroll: true });
}

export function Consent() {
  const { version } = useOrganisms();
  const id = version?.analytics_id ?? null;
  const consent = useConsent();
  const location = useLocation();
  const bar = useRef<HTMLElement>(null);
  const shown = Boolean(id) && consent === null;
  useEffect(() => {
    if (!id) return;
    if (consent === "granted") startAnalytics(id, location.path);
    else stopAnalytics(id);
    // The tag starts with the page shown when consent is given; later pages are counted below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a change of page alone neither starts nor stops the tag.
  }, [id, consent]);
  useEffect(() => {
    if (id && consent === "granted") countPage(location.path);
  }, [id, consent, location.path]);
  // While the bar shows, the page knows its height (it reserves that room); when it goes, the room is given back.
  useLayoutEffect(() => {
    const element = bar.current;
    if (!shown || !element) return;
    const root = document.documentElement;
    const write = () => {
      root.style.setProperty("--consent-h", `${Math.ceil(element.getBoundingClientRect().height)}px`);
    };
    write();
    if (focusWhenShown) {
      focusWhenShown = false;
      element.querySelector("button")?.focus();
    }
    const observer = new ResizeObserver(write);
    observer.observe(element);
    // Escape on any of its controls leaves the bar for the page, answering nothing (the bar itself is no control).
    const leave = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      focusMain();
    };
    element.addEventListener("keydown", leave);
    return () => {
      element.removeEventListener("keydown", leave);
      observer.disconnect();
      root.style.removeProperty("--consent-h");
    };
  }, [shown]);
  if (!shown) return null;
  const answer = (choice: Exclude<Choice, null>) => {
    const inside = bar.current?.contains(document.activeElement) ?? false;
    setConsent(choice);
    if (inside || document.activeElement === document.body) focusMain();
  };
  return (
    <section ref={bar} className="consent" aria-label="Counting visits">
      <div className="consent__inner">
        <p className="consent__text">
          <span className="consent__wide">May IDTrack count</span>
          <span className="consent__narrow">Count</span> this visit with Google Analytics?
          <span className="consent__more">
            {" "}
            Only each page&apos;s path and name are sent, never what you convert.
          </span>{" "}
          <Link to="/privacy#statistics" className="consent__link">
            Details
          </Link>
        </p>
        <div className="consent__actions">
          <Button
            onClick={() => {
              answer("denied");
            }}
          >
            Decline
          </Button>
          <Button
            onClick={() => {
              answer("granted");
            }}
          >
            Accept
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The footer's way back to the choice (shown only where the server counts visits). */
export function ConsentSettings() {
  const { version } = useOrganisms();
  if (!version?.analytics_id) return null;
  return (
    <button
      type="button"
      className="foot__button"
      onClick={() => {
        focusWhenShown = true;
        setConsent(null);
      }}
    >
      Cookie settings
    </button>
  );
}
