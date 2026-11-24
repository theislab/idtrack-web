// Database names as the api gives them, read for display: Ensembl's own relations in words, every other database by
// its name. idtrack's results name a synonym's database by its own name (a synonym is told by its node's kind,
// `synonym`, by its match, `synonym:...`, and by a name's `synonym` field), so a name is shown as it is sent.

/** A database for a person: Ensembl's relations in words ("Ensembl gene (with version)"), any other by its name. */
export function databaseLabel(raw: string): string {
  if (raw === "ensembl_gene") return "Ensembl gene (with version)";
  if (raw === "base_ensembl_gene") return "Ensembl gene (without version)";
  if (raw === "ensembl_transcript") return "Ensembl transcript";
  if (raw === "ensembl_translation") return "Ensembl translation";
  return raw;
}

/** Ensembl's own databases, first in a list; the others in the api's order. */
export function sortDatabases(databases: readonly string[]): string[] {
  const own = ["ensembl_gene", "base_ensembl_gene"];
  return [...own.filter((d) => databases.includes(d)), ...databases.filter((d) => !own.includes(d))];
}
