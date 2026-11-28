// The legal notice (Impressum), in English (/legal) and German (/legal/de): the provider per § 5 DDG, its
// representatives, register and tax number, the person responsible for the content per § 18 (2) MStV, every fact as
// Helmholtz Munich's own legal notice states it (lib/site/facts.ts); then where IDTrack is made, where questions go,
// and on which terms the answers are given (after the disclaimer of Helmholtz Munich's own notice).
import { Address, Doc, DocHead, Facts, Section, type DocSection } from "../../components/site/Doc";
import { Link } from "../../components/ui";
import { CONTACT, LEGAL_READ, MAKER, PROVIDER, REPRESENTATIVES, RESPONSIBLE, SOURCES } from "../../lib/site/facts";

const PROVIDER_LINES = [PROVIDER.name, PROVIDER.form, PROVIDER.street, PROVIDER.city];

const EN = {
  provider: { id: "provider", title: "Provider" },
  represented: { id: "represented-by", title: "Represented by" },
  register: { id: "register", title: "Register and tax number" },
  content: { id: "responsible", title: "Responsible for the content" },
  made: { id: "made-by", title: "Where IDTrack is made" },
  questions: { id: "questions", title: "Questions about this site" },
  disputes: { id: "disputes", title: "Consumer disputes" },
  answers: { id: "using-the-answers", title: "Using the answers" },
  reuse: { id: "reuse", title: "Reusing what is here" },
} satisfies Record<string, DocSection>;

function English() {
  return (
    <Doc
      head={
        <DocHead
          title="Legal notice"
          lede="Who provides IDTrack's web app, who represents the provider, and who is responsible for what it says."
          updated={LEGAL_READ}
          other={{ to: "/legal/de", lang: "de" }}
        />
      }
      sections={Object.values(EN)}
    >
      <Section section={EN.provider}>
        <p>Information according to § 5 Digitale-Dienste-Gesetz (DDG):</p>
        <Address lines={[...PROVIDER_LINES.slice(0, 3), `${PROVIDER.city}, Germany`]} />
        <Facts
          items={[
            ["Phone", PROVIDER.phone],
            ["Email", PROVIDER.email],
            [
              "Website",
              <a key="website" href={PROVIDER.website}>
                www.helmholtz-munich.de
              </a>,
            ],
          ]}
        />
      </Section>
      <Section section={EN.represented}>
        <Facts items={REPRESENTATIVES.map((r) => [r.en, r.name])} />
      </Section>
      <Section section={EN.register}>
        <Facts
          items={[
            ["Commercial register", PROVIDER.register],
            ["Register court", PROVIDER.court],
            ["VAT identification number (§ 27a Umsatzsteuergesetz)", PROVIDER.vat],
          ]}
        />
      </Section>
      <Section section={EN.content}>
        <p>Responsible for the content according to § 18 (2) Medienstaatsvertrag (MStV):</p>
        <Address
          lines={[
            `${RESPONSIBLE.name}, ${RESPONSIBLE.en}`,
            "Helmholtz Munich",
            PROVIDER.street,
            `${PROVIDER.city}, Germany`,
          ]}
        />
      </Section>
      <Section section={EN.made}>
        <p>
          IDTrack and this web app are developed at the {MAKER.lab} of Helmholtz Munich&apos;s {MAKER.institute}:
        </p>
        <Address
          lines={[`${MAKER.lab}, ${MAKER.institute}`, "Helmholtz Munich", MAKER.street, `${MAKER.city}, Germany`]}
        />
      </Section>
      <Section section={EN.questions}>
        <p>
          Questions about this site, corrections and reports of faults go to the issues of its repository,{" "}
          <a href={CONTACT.site}>github.com/theislab/idtrack-web/issues</a>; questions about IDTrack itself to{" "}
          <a href={CONTACT.idtrack}>github.com/theislab/idtrack/issues</a>. A security problem is reported privately,
          through the repository&apos;s <a href={CONTACT.security}>security advisories</a>.
        </p>
      </Section>
      <Section section={EN.disputes}>
        <p>
          Helmholtz Munich does not take part in dispute resolution proceedings before a consumer arbitration board and
          is not obliged to.
        </p>
      </Section>
      <Section section={EN.answers}>
        <p>
          The answers of this site are computed by IDTrack from Ensembl&apos;s releases and the databases Ensembl
          cross-references, and are given for research, as they are. Helmholtz Munich gives no warranty that an answer
          is current, correct or complete, or fit for a particular use: read an answer with its cautions and the path
          that led to it, and check what you rely on against its sources. Claims for damages arising from the use of the
          answers are excluded, unless Helmholtz Munich is shown to have acted with intent or gross negligence.
        </p>
        <p>
          Links to other sites (IDTrack&apos;s documentation, the databases, GitHub, PyPI) lead to content for which
          their providers alone are responsible.
        </p>
      </Section>
      <Section section={EN.reuse}>
        <p>
          The terms on which the site&apos;s code, texts, fonts and data may be reused are on the{" "}
          <Link to="/licences">licences</Link> page; what the site processes when you visit it, on the{" "}
          <Link to="/privacy">privacy</Link> page.
        </p>
        <p className="doc__meta">
          Every fact of this notice is as Helmholtz Munich&apos;s own <a href={SOURCES.legalNotice}>legal notice</a>{" "}
          states it, read on the day of the update above.
        </p>
      </Section>
    </Doc>
  );
}

const DE = {
  provider: { id: "anbieter", title: "Anbieter" },
  represented: { id: "vertreten-durch", title: "Vertreten durch" },
  register: { id: "register", title: "Register und Umsatzsteuer" },
  content: { id: "verantwortlich", title: "Verantwortlich für den Inhalt" },
  made: { id: "entwicklung", title: "Wo IDTrack entwickelt wird" },
  questions: { id: "fragen", title: "Fragen zu dieser Website" },
  disputes: { id: "streitbeilegung", title: "Verbraucherstreitbeilegung" },
  answers: { id: "nutzung-der-antworten", title: "Nutzung der Antworten" },
  reuse: { id: "nachnutzung", title: "Nachnutzung" },
} satisfies Record<string, DocSection>;

function German() {
  return (
    <Doc
      lang="de"
      head={
        <DocHead
          title="Impressum"
          lede="Wer die Web-App von IDTrack anbietet, wer den Anbieter vertritt und wer für ihren Inhalt verantwortlich ist."
          updated={LEGAL_READ}
          lang="de"
          other={{ to: "/legal", lang: "en" }}
        />
      }
      sections={Object.values(DE)}
    >
      <Section section={DE.provider}>
        <p>Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG):</p>
        <Address lines={PROVIDER_LINES} />
        <Facts
          items={[
            ["Telefon", PROVIDER.phone],
            ["E-Mail", PROVIDER.email],
            [
              "Website",
              <a key="website" href={PROVIDER.website}>
                www.helmholtz-munich.de
              </a>,
            ],
          ]}
        />
      </Section>
      <Section section={DE.represented}>
        <Facts items={REPRESENTATIVES.map((r) => [r.de, r.name])} />
      </Section>
      <Section section={DE.register}>
        <Facts
          items={[
            ["Handelsregister", PROVIDER.register],
            ["Registergericht", PROVIDER.court],
            ["Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz", PROVIDER.vat],
          ]}
        />
      </Section>
      <Section section={DE.content}>
        <p>Verantwortlich für den Inhalt gemäß § 18 Abs. 2 Medienstaatsvertrag (MStV):</p>
        <Address
          lines={[`${RESPONSIBLE.name}, ${RESPONSIBLE.de}`, "Helmholtz Munich", PROVIDER.street, PROVIDER.city]}
        />
      </Section>
      <Section section={DE.made}>
        <p>
          IDTrack und diese Web-App werden im {MAKER.lab} des {MAKER.institute} von Helmholtz Munich entwickelt:
        </p>
        <Address lines={[`${MAKER.lab}, ${MAKER.institute}`, "Helmholtz Munich", MAKER.street, MAKER.city]} />
      </Section>
      <Section section={DE.questions}>
        <p>
          Fragen zu dieser Website, Korrekturen und Fehlermeldungen richten Sie bitte an die Issues ihres Repositorys,{" "}
          <a href={CONTACT.site}>github.com/theislab/idtrack-web/issues</a>; Fragen zu IDTrack selbst an{" "}
          <a href={CONTACT.idtrack}>github.com/theislab/idtrack/issues</a>. Sicherheitsprobleme melden Sie bitte
          vertraulich über die <a href={CONTACT.security}>Security Advisories</a> des Repositorys.
        </p>
      </Section>
      <Section section={DE.disputes}>
        <p>
          Helmholtz Munich nimmt an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle nicht teil
          und ist dazu auch nicht verpflichtet.
        </p>
      </Section>
      <Section section={DE.answers}>
        <p>
          Die Antworten dieser Website berechnet IDTrack aus den Releases von Ensembl und den Datenbanken, auf die
          Ensembl verweist; sie werden für die Forschung bereitgestellt, so wie sie sind. Helmholtz Munich übernimmt
          keine Gewähr dafür, dass eine Antwort aktuell, richtig oder vollständig oder für einen bestimmten Zweck
          geeignet ist: Lesen Sie eine Antwort mit ihren Hinweisen und dem Pfad, der zu ihr führte, und prüfen Sie,
          worauf Sie sich stützen, an seinen Quellen. Haftungsansprüche aus der Nutzung der Antworten sind
          ausgeschlossen, sofern Helmholtz Munich kein nachweislich vorsätzliches oder grob fahrlässiges Verschulden
          trifft.
        </p>
        <p>
          Links zu anderen Websites (die Dokumentation von IDTrack, die Datenbanken, GitHub, PyPI) führen zu Inhalten,
          für die allein deren Anbieter verantwortlich sind.
        </p>
      </Section>
      <Section section={DE.reuse}>
        <p>
          Unter welchen Bedingungen Code, Texte, Schriften und Daten der Website nachgenutzt werden dürfen, steht auf
          der Seite <Link to="/licences">Licences</Link> (englisch); was die Website bei Ihrem Besuch verarbeitet, in
          der <Link to="/privacy/de">Datenschutzerklärung</Link>.
        </p>
        <p className="doc__meta">
          Alle Angaben dieses Impressums entsprechen dem <a href={SOURCES.impressum}>Impressum</a> von Helmholtz Munich,
          gelesen am oben genannten Stand.
        </p>
      </Section>
    </Doc>
  );
}

export function LegalPage({ lang = "en" }: { lang?: "en" | "de" }) {
  return lang === "de" ? <German /> : <English />;
}
