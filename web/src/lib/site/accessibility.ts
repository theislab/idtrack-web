// What the accessibility statement (/accessibility, /accessibility/de) says the site does not yet meet, each with the
// criterion of WCAG 2.2 it fails and where, in both languages from one entry: measured on the site as it is, and
// removed in the same change that repairs it (the statement names nothing that is not true of the site it is part of).

export interface Shortfall {
  /** The criterion of WCAG 2.2 (its number and name). */
  criterion: string;
  en: string;
  de: string;
}

export const SHORTFALLS: Shortfall[] = [
  {
    criterion: "1.4.3 Contrast (Minimum)",
    en: "On the home page at a zoom of 200 % and 400 % (720 by 450 and 320 by 256 px), the picture runs behind the sentence under the headline and the link to the documentation, where parts of their letters fall below a contrast of 4.5:1.",
    de: "Auf der Startseite läuft das Bild bei einer Vergrößerung auf 200 % und 400 % (720 × 450 und 320 × 256 px) hinter dem Satz unter der Überschrift und dem Link zur Dokumentation, wo Teile ihrer Buchstaben einen Kontrast von 4,5:1 unterschreiten.",
  },
  {
    criterion: "1.4.10 Reflow",
    en: "On the home page at 320 and 340 px wide, the header is wider than the window when the organism's name is long (Human), so that the page scrolls sideways.",
    de: "Auf der Startseite ist die Kopfzeile bei 320 und 340 px Breite breiter als das Fenster, wenn der Name des Organismus lang ist (Human), sodass die Seite seitlich scrollt.",
  },
  {
    criterion: "2.4.3 Focus Order",
    en: "Escape in a menu or a card that opened over the page, or choosing an organism, leaves the keyboard's focus on the page as a whole rather than on the control that opened it.",
    de: "Escape in einem Menü oder einer Karte über der Seite, oder die Wahl eines Organismus, lässt den Fokus der Tastatur auf der Seite als Ganzer statt auf dem Bedienelement, das sie geöffnet hat.",
  },
  {
    criterion: "2.4.7 Focus Visible",
    en: "In forced colours (Windows' high contrast), the chosen tab, segmented option and organism look like the others, and a focused tab's ring is drawn only at its sides.",
    de: "In erzwungenen Farben (Kontrastmodus von Windows) sehen der gewählte Tab, die gewählte Option und der gewählte Organismus wie die anderen aus, und der Fokusrahmen eines Tabs ist nur an seinen Seiten zu sehen.",
  },
  {
    criterion: "2.5.7 Dragging Movements",
    en: "On a graph's page, the History tab's field of lineages moves along the releases only by dragging or by the arrow keys; its buttons zoom about its middle only.",
    de: "Auf der Seite eines Graphen bewegt sich das Feld der Linien im Tab „History“ nur durch Ziehen oder mit den Pfeiltasten entlang der Releases; seine Schaltflächen zoomen nur um seine Mitte.",
  },
];
