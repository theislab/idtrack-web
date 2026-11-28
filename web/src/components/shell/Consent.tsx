// The visitor's choice about counting visits, asked once in a calm notice where the server counts visits at all
// (`analytics_id` of `/version`); and, once accepted, each page counted by its path (lib/analytics.ts).
import { useEffect } from "react";
import { countPage, setConsent, startAnalytics, useConsent } from "../../lib/analytics";
import { useOrganisms } from "../../lib/organisms";
import { useLocation } from "../../lib/router";
import { Button } from "../ui";

export function Consent() {
  const { version } = useOrganisms();
  const id = version?.analytics_id ?? null;
  const consent = useConsent();
  const location = useLocation();
  useEffect(() => {
    if (id && consent === "granted") startAnalytics(id);
  }, [id, consent]);
  useEffect(() => {
    if (id && consent === "granted") countPage(location.path);
  }, [id, consent, location.path]);
  if (!id || consent !== null) return null;
  return (
    <section className="consent" aria-label="Counting visits">
      <p className="consent__text">
        May IDTrack count this visit? With your consent, Google Analytics counts the pages seen (their paths, never what
        you convert) so that we learn how the site is used: <a href="/privacy#statistics">what is measured</a>.
      </p>
      <div className="consent__actions">
        <Button
          variant="quiet"
          onClick={() => {
            setConsent("denied");
          }}
        >
          Decline
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            setConsent("granted");
          }}
        >
          Accept
        </Button>
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
        setConsent(null);
      }}
    >
      Cookie settings
    </button>
  );
}
