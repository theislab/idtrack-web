// The facts of the site's legal pages, each as its source states it, read on the day below: the provider and its
// representatives from Helmholtz Munich's own legal notice, its data protection officer from Helmholtz Munich's own
// privacy page, the supervisory authority's address from the authority's own site. The English and the German pages
// both read them from here, so the two never differ.

/** The day every fact below was read from its source (and the legal pages' "Updated"). */
export const LEGAL_READ = "2026-11-28";

export const SOURCES = {
  legalNotice: "https://www.helmholtz-munich.de/en/legal-notice",
  impressum: "https://www.helmholtz-munich.de/impressum",
  privacy: "https://www.helmholtz-munich.de/en/privacy-policy",
  datenschutz: "https://www.helmholtz-munich.de/datenschutz",
  authority: "https://www.bfdi.bund.de",
} as const;

export const PROVIDER = {
  name: "Helmholtz Zentrum München",
  form: "Deutsches Forschungszentrum für Gesundheit und Umwelt (GmbH)",
  street: "Ingolstädter Landstraße 1",
  city: "85764 Neuherberg",
  phone: "+49 89 3187-0",
  email: "info(at)helmholtz-munich.de",
  website: "https://www.helmholtz-munich.de",
  register: "HRB 6466",
  court: "Amtsgericht München",
  vat: "DE 129521671",
} as const;

/** The representatives, with their roles in each language as Helmholtz Munich's two pages write them. */
export const REPRESENTATIVES: { name: string; en: string; de: string }[] = [
  {
    name: "Prof. Dr. Dr. h.c. mult. Martin Hrabě de Angelis",
    en: "Member and Spokesperson of the Executive Board (acting)",
    de: "Wissenschaftlicher Geschäftsführer und Sprecher der Geschäftsführung (komm.)",
  },
  { name: "Dr. Michael Frieser", en: "Administrative Managing Director", de: "Administrativer Geschäftsführer" },
  { name: "MinDir Thomas Romes", en: "Chairman of the Supervisory Board", de: "Aufsichtsratsvorsitzender" },
];

/** Responsible for the content (§ 18 (2) MStV; Helmholtz Munich's notice: "V.i.S.d.P."). */
export const RESPONSIBLE = {
  name: "Frank Horlbeck",
  en: "Head of Communications and Strategic Relations (acting)",
  de: "Head of Communications and Strategic Relations (komm.)",
} as const;

export const DATA_PROTECTION_OFFICER = {
  name: "Björn Kronfeld",
  street: "Ingolstädter Landstraße 1",
  city: "85764 Neuherberg",
  email: "datenschutz(at)helmholtz-munich.de",
} as const;

/** The supervisory authority Helmholtz Munich names, at the address the authority itself gives. */
export const AUTHORITY = {
  en: "The Federal Commissioner for Data Protection and Freedom of Information (BfDI)",
  de: "Die Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI)",
  street: "Graurheindorfer Straße 153",
  city: "53117 Bonn",
  phone: "+49 228 997799-0",
  email: "poststelle(at)bfdi.bund.de",
  website: "https://www.bfdi.bund.de",
} as const;

/** Where IDTrack is made (its documentation's credits: "Institutional Support"). */
export const MAKER = {
  lab: "Theis Lab",
  institute: "Institute of Computational Biology",
  street: "Ingolstädter Landstraße 1",
  city: "85764 Neuherberg",
} as const;

/** Where questions about this site, and about IDTrack, go (no personal address: the repositories' issues). */
export const CONTACT = {
  site: "https://github.com/theislab/idtrack-web/issues",
  idtrack: "https://github.com/theislab/idtrack/issues",
  security: "https://github.com/theislab/idtrack-web/security/advisories/new",
} as const;
