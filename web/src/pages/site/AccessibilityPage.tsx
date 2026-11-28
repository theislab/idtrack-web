// The accessibility statement, in English (/accessibility) and German (/accessibility/de): the standard aimed at, how
// far the site meets it, how it is tested (what the end-to-end suite checks, nothing more), what is known not to meet
// it (lib/site/accessibility.ts, each with its criterion), how to report a barrier, and the arbitration board.
import { Doc, DocHead, Section, type DocSection } from "../../components/site/Doc";
import { Link } from "../../components/ui";
import { SHORTFALLS } from "../../lib/site/accessibility";
import { CONTACT, LEGAL_READ, PROVIDER } from "../../lib/site/facts";

/** The day of the last review of the site's accessibility by people (the lenses of the site's reviews). */
const REVIEWED = { en: "28 November 2026", de: "28. November 2026" } as const;

const EN = {
  standard: { id: "standard", title: "The standard" },
  status: { id: "status", title: "How far the site meets it" },
  tested: { id: "tested", title: "How it is tested" },
  limits: { id: "limits", title: "Known limitations" },
  report: { id: "report", title: "Report a barrier" },
  enforcement: { id: "enforcement", title: "If your report is not answered" },
} satisfies Record<string, DocSection>;

function English() {
  return (
    <Doc
      head={
        <DocHead
          title="Accessibility"
          lede="The standard IDTrack's web app is built to, how that is checked, what is known to fall short, and how to tell us about a barrier."
          updated={LEGAL_READ}
          other={{ to: "/accessibility/de", lang: "de" }}
        />
      }
      sections={Object.values(EN)}
    >
      <Section section={EN.standard}>
        <p>
          The site aims at the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, in the light and the dark
          theme and at every width from 320 px. This includes what the European standard EN 301 549 (V3.2.1) asks of web
          content, which is WCAG 2.1 at level AA.
        </p>
      </Section>

      <Section section={EN.status}>
        <p>
          The site meets the standard in part. On the pages and in the states its tests reach, no failure of a WCAG 2.2
          criterion at level A or AA is known but those listed under <a href="#limits">Known limitations</a>. The site
          has not been audited by an outside body.
        </p>
      </Section>

      <Section section={EN.tested}>
        <ul>
          <li>
            <strong>Automatically, at every change.</strong> The end-to-end tests run every page and every state they
            reach (an answer, a list, a refusal, a page that does not exist, these pages, the notice that asks about
            counting visits) in Chromium, at 1440 and 390 px wide, in both themes, and check each with axe-core against
            the rules of WCAG 2.0, 2.1 and 2.2 at levels A and AA and axe&apos;s best practices. A violation of any
            impact fails the run; no rule is set aside.
          </li>
          <li>
            <strong>By keyboard.</strong> The drawn path of an answer, the tables, the api&apos;s consoles and the
            notice about counting visits are driven by keyboard alone in the tests; focus moves to a new page&apos;s
            heading or a new answer. The notice comes right after “Skip to the content”, Escape leaves it, and no
            focused link of the page&apos;s foot is hidden under it.
          </li>
          <li>
            <strong>Sizes and display settings.</strong> Every page is checked for text cut by its box and for a page
            that scrolls sideways at 320 by 640 px, at 320 by 256 and 720 by 450 px (a zoom of 400 % on a screen 1280 by
            1024 px, and of 200 % on one 1440 by 900 px), and at 768, 1024 and 2560 px wide. The notice about counting
            visits is checked at seven sizes from 320 by 568 to 1440 by 900 px to cover none of the home page&apos;s
            words, its two links and its caption. A focused control of the header keeps its outline in forced colours.
            Under reduced motion every motion takes no time and the home page&apos;s pictures are still; that is seen in
            reviews, not checked by a test.
          </li>
          <li>
            <strong>By people.</strong> Reviews of every page under several lenses, accessibility among them, the last
            on {REVIEWED.en}; what they found is repaired or listed below.
          </li>
        </ul>
      </Section>

      <Section section={EN.limits}>
        <ul>
          {SHORTFALLS.map((s) => (
            <li key={s.criterion}>
              {s.en} (WCAG {s.criterion})
            </li>
          ))}
          <li>
            The figures (an answer&apos;s path through the releases, a graph&apos;s history, the pictures of the home
            page) are drawings. What each shows is also given in words or as a table beside it (the path in words, the
            candidates&apos; table, a text alternative), so every fact is reachable without seeing the drawing, but its
            shape is not.
          </li>
          <li>
            The pages are in English, except the legal notice, the privacy page and this statement, which are also in
            German; each page declares its language, and the parts in another language are marked.
          </li>
          <li>Reporting through GitHub needs an account; the address below needs none.</li>
        </ul>
      </Section>

      <Section section={EN.report}>
        <p>
          A barrier on the site is a fault. Report it at{" "}
          <a href={CONTACT.site}>github.com/theislab/idtrack-web/issues</a>, or write to Helmholtz Munich (
          {PROVIDER.email}, naming IDTrack&apos;s web app), with the page&apos;s address and what you used to reach it
          (browser, screen reader or other aid). The <Link to="/legal">legal notice</Link> names the provider.
        </p>
      </Section>

      <Section section={EN.enforcement}>
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

const DE = {
  standard: { id: "standard", title: "Der Standard" },
  status: { id: "stand", title: "Stand der Vereinbarkeit" },
  tested: { id: "pruefung", title: "Wie geprüft wird" },
  limits: { id: "einschraenkungen", title: "Nicht barrierefreie Inhalte" },
  report: { id: "melden", title: "Eine Barriere melden" },
  enforcement: { id: "schlichtung", title: "Schlichtungsverfahren" },
} satisfies Record<string, DocSection>;

function German() {
  return (
    <Doc
      lang="de"
      head={
        <DocHead
          title="Barrierefreiheit"
          lede="Nach welchem Standard die Web-App von IDTrack gebaut ist, wie das geprüft wird, was ihn bekanntermaßen nicht erfüllt, und wie Sie uns eine Barriere melden."
          updated={LEGAL_READ}
          lang="de"
          other={{ to: "/accessibility", lang: "en" }}
        />
      }
      sections={Object.values(DE)}
    >
      <Section section={DE.standard}>
        <p>
          Die Website zielt auf die Web Content Accessibility Guidelines (WCAG) 2.2 in der Stufe AA, im hellen und im
          dunklen Design und bei jeder Breite ab 320 px. Das schließt ein, was die europäische Norm EN 301 549 (V3.2.1)
          von Webinhalten verlangt, nämlich WCAG 2.1 in der Stufe AA.
        </p>
      </Section>

      <Section section={DE.status}>
        <p>
          Die Website ist mit dem Standard teilweise vereinbar. Auf den Seiten und in den Zuständen, die ihre Tests
          erreichen, ist kein Verstoß gegen ein Kriterium der WCAG 2.2 der Stufen A oder AA bekannt außer denen unter{" "}
          <a href="#einschraenkungen">Nicht barrierefreie Inhalte</a>. Die Website wurde nicht von einer externen Stelle
          geprüft.
        </p>
      </Section>

      <Section section={DE.tested}>
        <ul>
          <li>
            <strong>Automatisch, bei jeder Änderung.</strong> Die End-to-End-Tests rufen jede Seite und jeden Zustand
            auf, den sie erreichen (eine Antwort, eine Liste, eine Ablehnung, eine Seite, die es nicht gibt, diese
            Seiten, den Hinweis, der nach dem Zählen von Besuchen fragt), in Chromium, bei 1440 und 390 px Breite, in
            beiden Designs, und prüfen jeden mit axe-core gegen die Regeln der WCAG 2.0, 2.1 und 2.2 der Stufen A und AA
            und die Best Practices von axe. Ein Verstoß jeder Schwere lässt den Lauf scheitern; keine Regel ist
            ausgenommen.
          </li>
          <li>
            <strong>Mit der Tastatur.</strong> Der gezeichnete Pfad einer Antwort, die Tabellen, die Konsolen der API
            und der Hinweis zum Zählen von Besuchen werden in den Tests allein mit der Tastatur bedient; der Fokus geht
            zur Überschrift einer neuen Seite oder zu einer neuen Antwort. Der Hinweis folgt direkt auf „
            <span lang="en">Skip to the content</span>“, Escape verlässt ihn, und kein fokussierter Link am Fuß der
            Seite liegt unter ihm.
          </li>
          <li>
            <strong>Größen und Anzeigeeinstellungen.</strong> Jede Seite wird auf abgeschnittenen Text und seitliches
            Scrollen geprüft bei 320 × 640 px, bei 320 × 256 und 720 × 450 px (eine Vergrößerung auf 400 % auf einem
            Bildschirm von 1280 × 1024 px und auf 200 % auf einem von 1440 × 900 px) und bei 768, 1024 und 2560 px
            Breite. Der Hinweis zum Zählen von Besuchen wird bei sieben Größen von 320 × 568 bis 1440 × 900 px darauf
            geprüft, dass er nichts von den Worten der Startseite, ihren zwei Links und ihrer Bildunterschrift verdeckt.
            Ein fokussiertes Bedienelement der Kopfzeile behält seinen Rahmen in erzwungenen Farben. Bei reduzierter
            Bewegung dauert jede Bewegung keine Zeit, und die Bilder der Startseite stehen still; das wird in Reviews
            gesehen, nicht von einem Test geprüft.
          </li>
          <li>
            <strong>Durch Menschen.</strong> Reviews jeder Seite unter mehreren Blickwinkeln, darunter Barrierefreiheit,
            zuletzt am {REVIEWED.de}; was sie fanden, ist behoben oder unten genannt.
          </li>
        </ul>
      </Section>

      <Section section={DE.limits}>
        <ul>
          {SHORTFALLS.map((s) => (
            <li key={s.criterion}>
              {s.de} (WCAG <span lang="en">{s.criterion}</span>)
            </li>
          ))}
          <li>
            Die Abbildungen (der Pfad einer Antwort durch die Releases, die Geschichte eines Graphen, die Bilder der
            Startseite) sind Zeichnungen. Was jede zeigt, steht auch in Worten oder als Tabelle daneben (der Pfad in
            Worten, die Tabelle der Kandidaten, ein Textersatz), sodass jede Tatsache ohne die Zeichnung erreichbar ist,
            ihre Gestalt aber nicht.
          </li>
          <li>
            Die Seiten sind auf Englisch, außer dem Impressum, der Datenschutzerklärung und dieser Erklärung, die es
            auch auf Deutsch gibt; jede Seite nennt ihre Sprache, und Teile in einer anderen Sprache sind ausgezeichnet.
          </li>
          <li>Eine Meldung über GitHub braucht ein Konto; die Adresse unten braucht keines.</li>
        </ul>
      </Section>

      <Section section={DE.report}>
        <p>
          Eine Barriere auf der Website ist ein Fehler. Melden Sie sie unter{" "}
          <a href={CONTACT.site}>github.com/theislab/idtrack-web/issues</a> oder schreiben Sie an Helmholtz Munich (
          {PROVIDER.email}, mit dem Hinweis auf die Web-App von IDTrack), mit der Adresse der Seite und womit Sie sie
          aufgerufen haben (Browser, Screenreader oder anderes Hilfsmittel). Das <Link to="/legal/de">Impressum</Link>{" "}
          nennt den Anbieter.
        </p>
      </Section>

      <Section section={DE.enforcement}>
        <p>
          Wird eine Meldung nicht zu Ihrer Zufriedenheit beantwortet, können Sie sich an die Schlichtungsstelle nach dem
          Behindertengleichstellungsgesetz wenden,{" "}
          <a href="https://www.schlichtungsstelle-bgg.de">www.schlichtungsstelle-bgg.de</a>, die kostenfrei zwischen
          Menschen mit Behinderungen und öffentlichen Stellen des Bundes vermittelt.
        </p>
      </Section>
    </Doc>
  );
}

export function AccessibilityPage({ lang = "en" }: { lang?: "en" | "de" }) {
  return lang === "de" ? <German /> : <English />;
}
