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
    criterion: "2.4.7 Focus Visible",
    en: "In forced colours (Windows' high contrast), the chosen tab, segmented option and organism look like the others, and a focused tab's ring is drawn only at its sides.",
    de: "In erzwungenen Farben (Kontrastmodus von Windows) sehen der gewählte Tab, die gewählte Option und der gewählte Organismus wie die anderen aus, und der Fokusrahmen eines Tabs ist nur an seinen Seiten zu sehen.",
  },
];
