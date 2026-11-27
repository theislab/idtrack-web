// Names of organisms for people.

/** A readable name of an Ensembl production name: `sus_scrofa` -> `Sus scrofa`. */
export function organismName(organism: string): string {
  const text = organism.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const COMMON: Record<string, string> = {
  homo_sapiens: "human",
  mus_musculus: "mouse",
  sus_scrofa: "pig",
  macaca_mulatta: "rhesus macaque",
  macaca_fascicularis: "crab-eating macaque",
  rattus_norvegicus: "rat",
  danio_rerio: "zebrafish",
};

export function commonName(organism: string): string | null {
  return COMMON[organism] ?? null;
}
