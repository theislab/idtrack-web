// The visitor's choice about counting visits, asked once in a calm notice where the server counts visits at all
// (`analytics_id` of `/version`); once accepted, each page counted by its path and its name (lib/analytics.ts); declined
// or withdrawn, Google's tag stopped and its cookies deleted.
import { useEffect } from "react";
import { countPage, setConsent, startAnalytics, stopAnalytics, useConsent } from "../../lib/analytics";
import { pageNameOf } from "../../lib/title";
import { useOrganisms } from "../../lib/organisms";
import { useLocation } from "../../lib/router";
import { Button } from "../ui";

export function Consent() {
  const { version } = useOrganisms();
  const id = version?.analytics_id ?? null;
  const consent = useConsent();
  const location = useLocation();
  useEffect(() => {
    if (!id) return;
    if (consent === "granted") startAnalytics(id);
    else stopAnalytics(id);
  }, [id, consent]);
  useEffect(() => {
    if (id && consent === "granted") countPage(location.path, pageNameOf(location.path));
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
