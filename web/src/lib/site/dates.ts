// The day a page of the site was last read against its sources, as each language writes a date.

/** A date as the page writes it: "28 November 2026" in English, "28. November 2026" in German. */
export function writtenDate(iso: string, lang: "en" | "de"): string {
  const [year, month, day] = iso.split("-").map(Number);
  const months = {
    en: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
    de: [
      "Januar",
      "Februar",
      "März",
      "April",
      "Mai",
      "Juni",
      "Juli",
      "August",
      "September",
      "Oktober",
      "November",
      "Dezember",
    ],
  }[lang];
  const name = months[(month ?? 1) - 1] ?? "";
  return lang === "de" ? `${String(day)}. ${name} ${String(year)}` : `${String(day)} ${name} ${String(year)}`;
}
