// The hero's one measured line: how often idtrack's history travel agrees with Ensembl's records on the graph in view,
// as idtrack's benchmarks measured it (src/generated/benchmarks.json, made from idtrack-reproducibility's published
// results: family A, the organism's row). Said only where the benchmarks asked the very graph this server holds (the
// same content digest); its numbers are written as the repository writes them, and the line leads to Method's panel
// that states how they are measured. Its own chunk: the measured data load after the page has painted.
import { BENCHMARKS, judged, measuredGraph } from "../../lib/benchmarks";
import { groupedInteger } from "../../lib/numbers";
import { Link } from "../ui";

export function HeroMeasure({ organism, digest }: { organism: string; digest: string | null }) {
  const family = BENCHMARKS.families.find((f) => f.key === "a");
  const row = family?.rows.find((r) => r.organism === organism && r.part === null && r.judge === null);
  if (!family || !row || !measuredGraph(organism, digest)) return null;
  const { judged: n } = judged(row);
  return (
    <p className="hero__measure">
      Benchmark {family.title.split(",")[0]} on this graph: <span className="mono">{row.rate}</span> of{" "}
      <span className="mono">{groupedInteger(n)}</span> judged answers agree with Ensembl&apos;s id history.{" "}
      <Link to="/method#method-evidence">How it is measured</Link>
    </p>
  );
}
