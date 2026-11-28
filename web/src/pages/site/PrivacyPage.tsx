// The privacy page, in English (/privacy) and German (/privacy/de): the controller and its data protection officer
// (Helmholtz Munich's own privacy page), then exactly what this site processes, as its code and its deployment do it:
// the server's logs (deploy/Caddyfile: seven days), the api's (no address), the browser's storage (lib/site/storage.ts,
// every key the code uses), visitor statistics only after consent, nothing loaded from other sites; the rights of data
// subjects and the supervisory authority.
import type { ReactNode } from "react";
import { Address, Doc, DocHead, Section, Wide, type DocSection } from "../../components/site/Doc";
import { Link, Mono } from "../../components/ui";
import { AUTHORITY, DATA_PROTECTION_OFFICER, LEGAL_READ, PROVIDER, SOURCES } from "../../lib/site/facts";
import { STORED } from "../../lib/site/storage";

/** The Google Analytics stream the site counts visits with (the property of IDTrack's documentation), and the
 *  cookie it names after it. */
const ANALYTICS_ID = "G-FYKLWNJBVK";
const STREAM_COOKIE = `_ga_${ANALYTICS_ID.slice(2)}`;

const GA = {
  cookies: "https://support.google.com/analytics/answer/11397207",
  ip: "https://support.google.com/analytics/answer/12017362",
  retention: "https://support.google.com/analytics/answer/7667196",
  terms: "https://business.safety.google/adsprocessorterms/",
  dpf: "https://www.dataprivacyframework.gov/participant/5780",
  optout: "https://tools.google.com/dlpage/gaoptout",
} as const;

function StorageTable({ lang }: { lang: "en" | "de" }) {
  const de = lang === "de";
  return (
    <Wide label={de ? "Tabelle der im Browser gespeicherten Schlüssel" : "The table of the keys kept in your browser"}>
      <table className="doc__table">
        <caption>
          {de
            ? "Was die Website in Ihrem Browser speichert (nichts davon wird gesendet)"
            : "What the site keeps in your browser (none of it is sent anywhere)"}
        </caption>
        <thead>
          <tr>
            <th scope="col">{de ? "Schlüssel" : "Key"}</th>
            <th scope="col">{de ? "Speicher" : "Storage"}</th>
            <th scope="col">{de ? "Inhalt" : "What it holds"}</th>
            <th scope="col">{de ? "Wann und wie lange" : "When and how long"}</th>
          </tr>
        </thead>
        <tbody>
          {STORED.map((s) => (
            <tr key={s.key}>
              <th scope="row">
                <Mono>{s.key}</Mono>
              </th>
              <td>{s.where === "local" ? "localStorage" : "sessionStorage"}</td>
              <td>{s[lang].holds}</td>
              <td>{s[lang].when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Wide>
  );
}

function Controller({ lang }: { lang: "en" | "de" }) {
  const country = lang === "de" ? "Deutschland" : "Germany";
  return (
    <Address
      lines={[
        PROVIDER.name,
        PROVIDER.form,
        PROVIDER.street,
        `${PROVIDER.city}, ${country}`,
        `${lang === "de" ? "Telefon" : "Phone"} ${PROVIDER.phone}`,
        `${lang === "de" ? "E-Mail" : "Email"} ${PROVIDER.email}`,
      ]}
    />
  );
}

function Officer({ lang }: { lang: "en" | "de" }) {
  return (
    <Address
      lines={[
        DATA_PROTECTION_OFFICER.name,
        DATA_PROTECTION_OFFICER.street,
        `${DATA_PROTECTION_OFFICER.city}, ${lang === "de" ? "Deutschland" : "Germany"}`,
        `${lang === "de" ? "E-Mail" : "Email"} ${DATA_PROTECTION_OFFICER.email}`,
      ]}
    />
  );
}

function Authority({ lang }: { lang: "en" | "de" }) {
  return (
    <Address
      lines={[
        AUTHORITY[lang],
        AUTHORITY.street,
        `${AUTHORITY.city}, ${lang === "de" ? "Deutschland" : "Germany"}`,
        `${lang === "de" ? "Telefon" : "Phone"} ${AUTHORITY.phone}, ${lang === "de" ? "E-Mail" : "email"} ${AUTHORITY.email}`,
        <a key="web" href={AUTHORITY.website}>
          www.bfdi.bund.de
        </a>,
      ]}
    />
  );
}

const EN = {
  short: { id: "in-short", title: "In short" },
  controller: { id: "controller", title: "Who is responsible" },
  server: { id: "server", title: "The server: what a visit leaves" },
  api: { id: "api", title: "The api: what a request leaves" },
  browser: { id: "browser", title: "Stored in your browser" },
  statistics: { id: "statistics", title: "Visitor statistics, only with your consent" },
  others: { id: "other-sites", title: "Nothing from other sites" },
  rights: { id: "rights", title: "Your rights" },
  changes: { id: "changes", title: "Changes to this page" },
} satisfies Record<string, DocSection>;

function English() {
  return (
    <Doc
      head={
        <DocHead
          title="Privacy"
          lede="What IDTrack's web app processes when you use it, why, for how long, and how to ask about it."
          updated={LEGAL_READ}
          other={{ to: "/privacy/de", lang: "de" }}
        />
      }
      sections={Object.values(EN)}
    >
      <Section section={EN.short}>
        <div className="doc__summary">
          <p>
            The site sets no cookie and asks nothing of any other company unless you accept visitor statistics. Its
            server keeps a log of requests, with your IP address, for seven days at most.
          </p>
          <p>
            What you convert is answered and forgotten: an identifier asked for in an address appears in that log as
            part of the address, and a list you send is logged nowhere.
          </p>
        </div>
      </Section>

      <Section section={EN.controller}>
        <p>The controller under the General Data Protection Regulation (GDPR) is</p>
        <Controller lang="en" />
        <p>Its data protection officer is</p>
        <Officer lang="en" />
        <p>
          Write to the data protection officer to exercise your rights (<a href="#rights">below</a>). Both are named as
          on Helmholtz Munich&apos;s own <a href={SOURCES.privacy}>privacy policy</a>. Questions about the site itself
          go to its repository&apos;s issues (<Link to="/legal">legal notice</Link>).
        </p>
      </Section>

      <Section section={EN.server}>
        <p>
          The site runs on a virtual machine of Helmholtz Munich. In front of IDTrack&apos;s server stands Caddy, a web
          server that holds the site&apos;s certificate and passes each request on. To answer, it reads what every
          browser sends with a request, and writes one line per request to its access log:
        </p>
        <ul>
          <li>the time, your IP address and port, and the protocol;</li>
          <li>
            the method and the address asked for, its query included (where an identifier is converted by address, the
            identifier);
          </li>
          <li>
            the headers your browser sent, such as its name and version, the languages it prefers and the page you came
            from (cookies and credentials are replaced by the word REDACTED);
          </li>
          <li>the status of the answer, its size, the time it took and its headers.</li>
        </ul>
        <p>
          Where Caddy itself fails at a request, it may also write the request, with the same details, to a log of
          errors. Both logs begin a new file every midnight and keep six earlier days: a line is deleted at most seven
          days after it was written. They stay on the machine; nobody outside the people who run it reads them, and they
          are used only to keep the site working and secure.
        </p>
        <p>
          The certificate comes from Let&apos;s Encrypt, which Caddy asks for it and its renewal; no data of visitors is
          sent there.
        </p>
        <p>
          The legal basis is Art. 6(1)(f) GDPR: Helmholtz Munich&apos;s legitimate interest in delivering the site
          securely and reliably.
        </p>
      </Section>

      <Section section={EN.api}>
        <p>
          IDTrack&apos;s server (the api, which also sends the pages) writes one line per request to its own log: the
          method, the address asked for, the status, the time taken and a random request id. It does not write your IP
          address: Caddy&apos;s log above is the one place it is kept. The server&apos;s log is kept on the machine in
          at most five files of 20 MB, the oldest removed as new lines come.
        </p>
        <p>
          To share the server fairly, it counts each client&apos;s recent requests and seconds of search. Your address
          (for IPv6, its first 64 bits) only chooses a counter, through a keyed hash whose key is drawn anew at each
          start; the address itself is not stored, and the counters are lost when the server restarts.
        </p>
        <p>
          The server&apos;s load, shown in the site&apos;s header and in <Mono>GET /api/v1/status</Mono>, is made of
          totals only (processor time, memory, how long requests took, how many are waiting), for the last 15 minutes,
          in memory. Answers are kept in memory for a while, so that the same question is answered again without a new
          search; they are not tied to who asked.
        </p>
        <p>The legal basis is Art. 6(1)(f) GDPR, as above.</p>
      </Section>

      <Section section={EN.browser}>
        <p>
          The site itself sets no cookie. It keeps a few choices and drafts in your browser&apos;s storage, and never
          sends them anywhere:
        </p>
        <StorageTable lang="en" />
        <p>
          Storing them is needed for what you ask the site to do (§ 25(2) no. 2 TDDDG). You can remove them at any time
          by clearing this site&apos;s data in your browser.
        </p>
      </Section>

      <Section section={EN.statistics}>
        <p>
          With your consent, the site counts visits with Google Analytics 4 (the stream <Mono>{ANALYTICS_ID}</Mono>,
          which IDTrack&apos;s documentation also uses), so that we learn which pages are used. A notice at the foot of
          the window asks once; until you accept, no script of Google is loaded and nothing is sent to Google.
        </p>
        <p>After you accept:</p>
        <ul>
          <li>
            Google&apos;s script is loaded from <Mono>www.googletagmanager.com</Mono> and sets two cookies on this site:{" "}
            <Mono>_ga</Mono> (a random id that tells visits apart) and <Mono>{STREAM_COOKIE}</Mono> (the state of the
            visit), each for two years from your last visit, as <a href={GA.cookies}>Google describes them</a>, though
            browsers may delete them sooner.
          </li>
          <li>
            Each page you view is counted by its path and its name, never by its query, which holds what you convert.
            Google Analytics also records when and for how long you were active, your type of device, browser, operating
            system, screen size and language, the site that brought you here, and an approximate location (city and
            country) derived from your IP address, which Google uses for that alone and does not store for visitors from
            the EU (<a href={GA.ip}>Google</a>).
          </li>
          <li>
            Google signals and the use for advertising are turned off; the site sends no name, no user id and nothing
            you type.
          </li>
        </ul>
        <p>
          Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland, processes the data on Helmholtz
          Munich&apos;s behalf (<a href={GA.terms}>Google&apos;s data processing terms</a>). It may be transferred to
          Google LLC in the USA, which is certified under the <a href={GA.dpf}>EU-US Data Privacy Framework</a> (an
          adequacy decision of the European Commission, Art. 45 GDPR). The data of single visits are deleted after the
          retention period set for the property (two months, the default of Google Analytics:{" "}
          <a href={GA.retention}>Google</a>); totals in its reports are kept.
        </p>
        <p>
          The legal basis is your consent: Art. 6(1)(a) GDPR, and § 25(1) TDDDG for the cookies. You can withdraw it at
          any time with “Cookie settings” at the foot of every page, which asks again; the counting already done stays
          lawful (Art. 7(3) GDPR). Google&apos;s <a href={GA.optout}>browser add-on</a> turns Google Analytics off on
          every site.
        </p>
      </Section>

      <Section section={EN.others}>
        <p>
          The fonts, scripts, images and data of every page come from this site itself: before you accept visitor
          statistics, no page asks anything of another site (a test of the site checks every page for it). Links to
          IDTrack&apos;s documentation, to GitHub, to PyPI or to a database are only links: following one is a visit to
          that site, under its own privacy terms.
        </p>
      </Section>

      <Section section={EN.rights}>
        <p>
          You have the right of access to the data about you (Art. 15 GDPR), to rectification (Art. 16), to erasure
          (Art. 17), to restriction of processing (Art. 18), to data portability (Art. 20), to object to processing
          based on a legitimate interest (Art. 21) and to withdraw a consent at any time (Art. 7(3)). To exercise them,
          write to the data protection officer named above. Note that the site cannot tell which lines of its logs are
          yours unless you tell it your IP address and the time of your visit.
        </p>
        <p>
          You also have the right to lodge a complaint with a supervisory authority (Art. 77 GDPR). The authority
          responsible for Helmholtz Munich is
        </p>
        <Authority lang="en" />
      </Section>

      <Section section={EN.changes}>
        <p>
          This page is changed whenever what the site processes changes, and dated above. It describes the site as its
          code and its settings are published in its repository (<Mono>deploy/</Mono> and <Mono>web/</Mono> of{" "}
          <a href="https://github.com/theislab/idtrack-web">idtrack-web</a>).
        </p>
      </Section>
    </Doc>
  );
}

const DE = {
  short: { id: "kurz", title: "In Kürze" },
  controller: { id: "verantwortlicher", title: "Verantwortlicher" },
  server: { id: "server", title: "Der Server: was ein Besuch hinterlässt" },
  api: { id: "api", title: "Die API: was eine Anfrage hinterlässt" },
  browser: { id: "browser", title: "Im Browser gespeichert" },
  statistics: { id: "statistik", title: "Besucherstatistik, nur mit Ihrer Einwilligung" },
  others: { id: "andere-websites", title: "Nichts von anderen Websites" },
  rights: { id: "rechte", title: "Ihre Rechte" },
  changes: { id: "aenderungen", title: "Änderungen dieser Seite" },
} satisfies Record<string, DocSection>;

function German(): ReactNode {
  return (
    <Doc
      lang="de"
      head={
        <DocHead
          title="Datenschutz"
          lede="Was die Web-App von IDTrack bei ihrer Nutzung verarbeitet, warum, wie lange, und wie Sie danach fragen können."
          updated={LEGAL_READ}
          lang="de"
          other={{ to: "/privacy", lang: "en" }}
        />
      }
      sections={Object.values(DE)}
    >
      <Section section={DE.short}>
        <div className="doc__summary">
          <p>
            Die Website setzt kein Cookie und fragt nichts bei anderen Unternehmen an, es sei denn, Sie stimmen der
            Besucherstatistik zu. Ihr Server protokolliert Anfragen mit Ihrer IP-Adresse höchstens sieben Tage lang.
          </p>
          <p>
            Was Sie umwandeln, wird beantwortet und vergessen: Eine in der Adresse angefragte Kennung erscheint als Teil
            der Adresse in diesem Protokoll, und eine gesendete Liste wird nirgends protokolliert.
          </p>
        </div>
      </Section>

      <Section section={DE.controller}>
        <p>Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist</p>
        <Controller lang="de" />
        <p>Der Datenschutzbeauftragte des Verantwortlichen ist</p>
        <Officer lang="de" />
        <p>
          Wenden Sie sich an den Datenschutzbeauftragten, um Ihre Rechte auszuüben (<a href="#rechte">unten</a>). Beide
          sind so genannt wie in der <a href={SOURCES.datenschutz}>Datenschutzerklärung</a> von Helmholtz Munich. Fragen
          zur Website selbst richten Sie an die Issues ihres Repositorys (<Link to="/legal/de">Impressum</Link>
          ).
        </p>
      </Section>

      <Section section={DE.server}>
        <p>
          Die Website läuft auf einer virtuellen Maschine von Helmholtz Munich. Vor dem Server von IDTrack steht Caddy,
          ein Webserver, der das Zertifikat der Website hält und jede Anfrage weitergibt. Um zu antworten, liest er, was
          jeder Browser mit einer Anfrage sendet, und schreibt je Anfrage eine Zeile in sein Zugriffsprotokoll:
        </p>
        <ul>
          <li>die Zeit, Ihre IP-Adresse und Ihren Port sowie das Protokoll;</li>
          <li>
            die Methode und die angefragte Adresse samt Abfrage (wird eine Kennung per Adresse umgewandelt: die
            Kennung);
          </li>
          <li>
            die Kopfzeilen, die Ihr Browser sendet, etwa seinen Namen und seine Version, die bevorzugten Sprachen und
            die Seite, von der Sie kamen (Cookies und Zugangsdaten werden durch das Wort REDACTED ersetzt);
          </li>
          <li>den Status der Antwort, ihre Größe, ihre Dauer und ihre Kopfzeilen.</li>
        </ul>
        <p>
          Scheitert Caddy selbst an einer Anfrage, kann er sie mit denselben Angaben auch in ein Fehlerprotokoll
          schreiben. Beide Protokolle beginnen jede Mitternacht eine neue Datei und behalten sechs frühere Tage: Eine
          Zeile wird spätestens sieben Tage nach ihrem Schreiben gelöscht. Sie bleiben auf der Maschine; nur die
          Personen, die sie betreiben, lesen sie, und nur, um die Website funktionsfähig und sicher zu halten.
        </p>
        <p>
          Das Zertifikat stammt von Let&apos;s Encrypt, wo Caddy es anfordert und erneuert; dabei werden keine Daten von
          Besuchern übermittelt.
        </p>
        <p>
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO: das berechtigte Interesse von Helmholtz Munich, die Website
          sicher und zuverlässig bereitzustellen.
        </p>
      </Section>

      <Section section={DE.api}>
        <p>
          Der Server von IDTrack (die API, die auch die Seiten sendet) schreibt je Anfrage eine Zeile in sein eigenes
          Protokoll: die Methode, die angefragte Adresse, den Status, die Dauer und eine zufällige Anfrage-ID. Ihre
          IP-Adresse schreibt er nicht: Caddys Protokoll oben ist der einzige Ort, an dem sie gespeichert wird. Das
          Protokoll des Servers wird auf der Maschine in höchstens fünf Dateien zu 20 MB gehalten; die älteste wird
          entfernt, wenn neue Zeilen kommen.
        </p>
        <p>
          Um den Server gerecht zu teilen, zählt er die letzten Anfragen und Suchsekunden jedes Clients. Ihre Adresse
          (bei IPv6 ihre ersten 64 Bit) wählt nur einen Zähler, über einen Hash mit einem Schlüssel, der bei jedem Start
          neu gezogen wird; die Adresse selbst wird nicht gespeichert, und die Zähler gehen beim Neustart des Servers
          verloren.
        </p>
        <p>
          Die Last des Servers, angezeigt im Kopf der Website und unter <Mono>GET /api/v1/status</Mono>, besteht nur aus
          Summen (Rechenzeit, Speicher, Dauer der Anfragen, wartende Anfragen) der letzten 15 Minuten, im Speicher.
          Antworten werden eine Weile im Speicher gehalten, damit dieselbe Frage ohne neue Suche erneut beantwortet
          wird; sie sind nicht mit dem Fragenden verknüpft.
        </p>
        <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, wie oben.</p>
      </Section>

      <Section section={DE.browser}>
        <p>
          Die Website selbst setzt kein Cookie. Sie hält einige Einstellungen und Entwürfe im Speicher Ihres Browsers
          und sendet sie nie irgendwohin:
        </p>
        <StorageTable lang="de" />
        <p>
          Ihre Speicherung ist für das erforderlich, worum Sie die Website bitten (§ 25 Abs. 2 Nr. 2 TDDDG). Sie können
          sie jederzeit entfernen, indem Sie die Daten dieser Website in Ihrem Browser löschen.
        </p>
      </Section>

      <Section section={DE.statistics}>
        <p>
          Mit Ihrer Einwilligung zählt die Website Besuche mit Google Analytics 4 (dem Datenstream{" "}
          <Mono>{ANALYTICS_ID}</Mono>, den auch die Dokumentation von IDTrack nutzt), damit wir erfahren, welche Seiten
          genutzt werden. Ein Hinweis am unteren Rand des Fensters fragt einmal; bevor Sie zustimmen, wird kein Skript
          von Google geladen und nichts an Google gesendet.
        </p>
        <p>Nachdem Sie zugestimmt haben:</p>
        <ul>
          <li>
            Das Skript von Google wird von <Mono>www.googletagmanager.com</Mono> geladen und setzt zwei Cookies auf
            dieser Website: <Mono>_ga</Mono> (eine zufällige ID, die Besuche unterscheidet) und{" "}
            <Mono>{STREAM_COOKIE}</Mono> (der Zustand des Besuchs), jeweils für zwei Jahre ab Ihrem letzten Besuch, wie{" "}
            <a href={GA.cookies}>Google sie beschreibt</a>, wobei Browser sie früher löschen können.
          </li>
          <li>
            Jede aufgerufene Seite wird mit ihrem Pfad und ihrem Namen gezählt, nie mit ihrer Abfrage, die enthält, was
            Sie umwandeln. Google Analytics erfasst außerdem, wann und wie lange Sie aktiv waren, Ihren Gerätetyp,
            Browser, Ihr Betriebssystem, Ihre Bildschirmgröße und Sprache, die Website, über die Sie kamen, und einen
            ungefähren Standort (Stadt und Land), abgeleitet aus Ihrer IP-Adresse, die Google nur dafür nutzt und für
            Besucher aus der EU nicht speichert (<a href={GA.ip}>Google</a>).
          </li>
          <li>
            Google-Signale und die Nutzung für Werbung sind ausgeschaltet; die Website sendet keinen Namen, keine
            Nutzer-ID und nichts, was Sie eingeben.
          </li>
        </ul>
        <p>
          Die Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland, verarbeitet die Daten im Auftrag
          von Helmholtz Munich (<a href={GA.terms}>Auftragsverarbeitungsbedingungen von Google</a>). Sie können an die
          Google LLC in den USA übermittelt werden, die unter dem <a href={GA.dpf}>EU-US Data Privacy Framework</a>{" "}
          zertifiziert ist (ein Angemessenheitsbeschluss der Europäischen Kommission, Art. 45 DSGVO). Die Daten
          einzelner Besuche werden nach der für die Property eingestellten Aufbewahrungsdauer gelöscht (zwei Monate, die
          Voreinstellung von Google Analytics: <a href={GA.retention}>Google</a>); Summen in den Berichten bleiben
          erhalten.
        </p>
        <p>
          Rechtsgrundlage ist Ihre Einwilligung: Art. 6 Abs. 1 lit. a DSGVO und für die Cookies § 25 Abs. 1 TDDDG. Sie
          können sie jederzeit über „Cookie settings“ am Fuß jeder Seite widerrufen, das erneut fragt; die bis dahin
          erfolgte Zählung bleibt rechtmäßig (Art. 7 Abs. 3 DSGVO). Das <a href={GA.optout}>Browser-Add-on</a> von
          Google schaltet Google Analytics auf allen Websites ab.
        </p>
      </Section>

      <Section section={DE.others}>
        <p>
          Schriften, Skripte, Bilder und Daten jeder Seite stammen von dieser Website selbst: Bevor Sie der
          Besucherstatistik zustimmen, fragt keine Seite etwas bei einer anderen Website an (ein Test der Website prüft
          das auf jeder Seite). Links zur Dokumentation von IDTrack, zu GitHub, zu PyPI oder zu einer Datenbank sind nur
          Links: Wer einem folgt, besucht diese Website zu ihren eigenen Datenschutzbedingungen.
        </p>
      </Section>

      <Section section={DE.rights}>
        <p>
          Sie haben das Recht auf Auskunft über die Sie betreffenden Daten (Art. 15 DSGVO), auf Berichtigung (Art. 16),
          auf Löschung (Art. 17), auf Einschränkung der Verarbeitung (Art. 18), auf Datenübertragbarkeit (Art. 20), auf
          Widerspruch gegen eine auf ein berechtigtes Interesse gestützte Verarbeitung (Art. 21) und auf jederzeitigen
          Widerruf einer Einwilligung (Art. 7 Abs. 3). Wenden Sie sich dazu an den oben genannten
          Datenschutzbeauftragten. Die Website kann nicht erkennen, welche Zeilen ihrer Protokolle Ihre sind, wenn Sie
          ihr nicht Ihre IP-Adresse und die Zeit Ihres Besuchs nennen.
        </p>
        <p>
          Sie haben außerdem das Recht auf Beschwerde bei einer Aufsichtsbehörde (Art. 77 DSGVO). Zuständig für
          Helmholtz Munich ist
        </p>
        <Authority lang="de" />
      </Section>

      <Section section={DE.changes}>
        <p>
          Diese Seite wird geändert, sobald sich ändert, was die Website verarbeitet, und oben datiert. Sie beschreibt
          die Website so, wie ihr Code und ihre Einstellungen in ihrem Repository veröffentlicht sind (
          <Mono>deploy/</Mono> und <Mono>web/</Mono> von{" "}
          <a href="https://github.com/theislab/idtrack-web">idtrack-web</a>).
        </p>
      </Section>
    </Doc>
  );
}

export function PrivacyPage({ lang = "en" }: { lang?: "en" | "de" }) {
  return lang === "de" ? <German /> : <English />;
}
