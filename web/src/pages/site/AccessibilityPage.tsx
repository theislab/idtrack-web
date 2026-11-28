// The accessibility statement (/accessibility): the standard aimed at, how the site is tested (the end-to-end suite's
// checks), what is known not to meet it or to be limited, how to report a barrier, and the date.
import { Doc, DocHead, Section, type DocSection } from "../../components/site/Doc";
import { Link } from "../../components/ui";
import { CONTACT, LEGAL_READ, PROVIDER } from "../../lib/site/facts";

const SECTIONS = {
  standard: { id: "standard", title: "The standard" },
  status: { id: "status", title: "How far the site meets it" },
  tested: { id: "tested", title: "How it is tested" },
  limits: { id: "limits", title: "Known limitations" },
  report: { id: "report", title: "Report a barrier" },
  enforcement: { id: "enforcement", title: "If your report is not answered" },
} satisfies Record<string, DocSection>;

export function AccessibilityPage() {
  return (
    <Doc
      head={
        <DocHead
          title="Accessibility"
          lede="The standard IDTrack's web app is built to, how that is checked, what is known to fall short, and how to tell us about a barrier."
          updated={LEGAL_READ}
        />
      }
      sections={Object.values(SECTIONS)}
    >
      <Section section={SECTIONS.standard}>
        <p>
          The site aims at the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, in the light and the dark
          theme and at every width from 320 px. This includes what the European standard EN 301 549 (V3.2.1) asks of web
          content, which is WCAG 2.1 at level AA.
        </p>
      </Section>

      <Section section={SECTIONS.status}>
        <p>
          No failure of a WCAG 2.2 criterion at level A or AA is known on the pages and states the site&apos;s tests
          reach. The site has not been audited by an outside body; what its own tests and reviews cannot prove is said
          below.
        </p>
      </Section>

      <Section section={SECTIONS.tested}>
        <ul>
          <li>
            <strong>Automatically, at every change.</strong> The end-to-end tests run every page and every state they
            reach (an answer, a list, a refusal, a page that does not exist, these pages) in Chromium, at 1440 and 390
            px wide, in both themes, and check each with axe-core against the rules of WCAG 2.0, 2.1 and 2.2 at levels A
            and AA and axe&apos;s best practices. A violation of any impact fails the run; no rule is set aside (the
            list of rules accepted as broken is empty).
          </li>
          <li>
            <strong>By keyboard.</strong> The drawn path of an answer, the tables and the api&apos;s consoles are driven
            by keyboard alone in the tests, and focus moves to a new page&apos;s heading or a new answer.
          </li>
          <li>
            <strong>Display settings.</strong> Focus stays visible in forced colours (Windows&apos; high contrast);
            nothing moves when the system asks for reduced motion; every page is checked at 320, 768, 1024 and 2560 px
            for text cut by its box and for a page that scrolls sideways, which also covers a zoom of 400 % on a screen
            1280 px wide.
          </li>
          <li>
            <strong>By people.</strong> Reviews of every page under several lenses, accessibility among them, the last
            on 27 November 2026; what they found was repaired before this statement.
          </li>
        </ul>
      </Section>

      <Section section={SECTIONS.limits}>
        <ul>
          <li>
            The figures (an answer&apos;s path through the releases, a graph&apos;s history, the pictures of the home
            page) are drawings. What each shows is also given in words or as a table beside it (the path in words, the
            candidates&apos; table, a text alternative), so every fact is reachable without seeing the drawing, but its
            shape is not.
          </li>
          <li>
            The pages are in English, except the legal notice and the privacy page, which are also in German; the
            language of each part is marked for screen readers.
          </li>
          <li>Reporting through GitHub needs an account; the address below needs none.</li>
        </ul>
      </Section>

      <Section section={SECTIONS.report}>
        <p>
          A barrier on the site is a fault. Report it at{" "}
          <a href={CONTACT.site}>github.com/theislab/idtrack-web/issues</a>, or write to Helmholtz Munich (
          {PROVIDER.email}, naming IDTrack&apos;s web app), with the page&apos;s address and what you used to reach it
          (browser, screen reader or other aid). The <Link to="/legal">legal notice</Link> names the provider.
        </p>
      </Section>

      <Section section={SECTIONS.enforcement}>
        <p>
          If a report is not answered to your satisfaction, you can turn to the arbitration board under the German
          Disability Equality Act (Schlichtungsstelle nach dem Behindertengleichstellungsgesetz),{" "}
          <a href="https://www.schlichtungsstelle-bgg.de">www.schlichtungsstelle-bgg.de</a>, which mediates between
          people with disabilities and public bodies of the federation, free of charge.
        </p>
      </Section>
    </Doc>
  );
}
