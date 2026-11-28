// Everything the site keeps in the visitor's browser, key by key, as the privacy page lists it. A test reads every
// key the code stores under (tests/site.test.ts) and fails while one is missing here.

interface Stored {
  /** The key (a prefix ends in "…"). */
  key: string;
  where: "local" | "session";
  en: { holds: string; when: string };
  de: { holds: string; when: string };
}

export const STORED: Stored[] = [
  {
    key: "idtrack-theme",
    where: "local",
    en: {
      holds: "The theme you chose: dark, or your system's (light, the default, is not kept).",
      when: "Once you choose a theme; until you choose light again.",
    },
    de: {
      holds: "Das gewählte Design: dunkel oder das des Systems (hell, die Voreinstellung, wird nicht gespeichert).",
      when: "Sobald Sie ein Design wählen; bis Sie wieder hell wählen.",
    },
  },
  {
    key: "idtrack-hero",
    where: "local",
    en: {
      holds: "The picture you chose for the home page (the default is not kept).",
      when: "Once you choose a picture; until you choose the default again.",
    },
    de: {
      holds: "Das gewählte Bild der Startseite (die Voreinstellung wird nicht gespeichert).",
      when: "Sobald Sie ein Bild wählen; bis Sie wieder die Voreinstellung wählen.",
    },
  },
  {
    key: "idtrack-visit",
    where: "local",
    en: {
      holds:
        "How many times the home page was opened in this browser, so that its picture follows another of the showcase's journeys at each visit.",
      when: "Each time the home page's picture is drawn; until you clear the site's data.",
    },
    de: {
      holds:
        "Wie oft die Startseite in diesem Browser geöffnet wurde, damit ihr Bild bei jedem Besuch einer anderen Reise des Showcase folgt.",
      when: "Jedes Mal, wenn das Bild der Startseite gezeichnet wird; bis Sie die Daten der Website löschen.",
    },
  },
  {
    key: "idtrack-consent",
    where: "local",
    en: {
      holds: "Your answer to whether IDTrack may count your visit (granted or denied).",
      when: "Once you answer; until you open “Cookie settings”, which removes it and asks again.",
    },
    de: {
      holds: "Ihre Antwort, ob IDTrack Ihren Besuch zählen darf (erteilt oder abgelehnt).",
      when: "Sobald Sie antworten; bis Sie „Cookie settings“ öffnen, das die Antwort löscht und erneut fragt.",
    },
  },
  {
    key: "idtrack-api-language",
    where: "local",
    en: {
      holds: "The language you chose for the code examples of the API page (curl, Python, R or JavaScript).",
      when: "Once you choose one.",
    },
    de: {
      holds: "Die gewählte Sprache der Codebeispiele auf der API-Seite (curl, Python, R oder JavaScript).",
      when: "Sobald Sie eine wählen.",
    },
  },
  {
    key: "idtrack:draft:…",
    where: "session",
    en: {
      holds:
        "What you typed or pasted and have not sent yet (an identifier, a name, a list), a list's settings and its results, so that they survive a reload or a visit to another page.",
      when: "While you work; until the tab is closed.",
    },
    de: {
      holds:
        "Was Sie eingegeben oder eingefügt und noch nicht gesendet haben (eine Kennung, einen Namen, eine Liste), die Einstellungen einer Liste und ihre Ergebnisse, damit sie ein Neuladen oder den Besuch einer anderen Seite überstehen.",
      when: "Während Sie arbeiten; bis der Tab geschlossen wird.",
    },
  },
  {
    key: "idtrack:reloaded-for-code",
    where: "session",
    en: {
      holds:
        "The time and address of a reload the page made once to fetch the site's updated code, so that it never reloads twice in a row.",
      when: "Only after such a reload; until the tab is closed.",
    },
    de: {
      holds:
        "Zeit und Adresse eines einmaligen Neuladens, mit dem die Seite den aktualisierten Code der Website holte, damit sie nie zweimal hintereinander neu lädt.",
      when: "Nur nach einem solchen Neuladen; bis der Tab geschlossen wird.",
    },
  },
];
