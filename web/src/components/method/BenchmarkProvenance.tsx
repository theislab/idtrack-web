// Whether the benchmarks measured a graph, for an organism's page: the graph of this content digest, the idtrack
// measured (by its role: the code at a release, whose answers are that release's) and the results read, in one short
// paragraph with a link to the rates. It reads only src/generated/benchmarks_meta.json (lib/benchmarksMeta.ts), so an
// organism's page does not load the benchmarks' whole results.
import { BENCHMARK_ORGANISMS, BENCHMARKS_META, measuredGraph } from "../../lib/benchmarksMeta";
import { Link } from "../ui";

export function BenchmarkProvenance({ organism, digest }: { organism: string; digest: string | null }) {
  const same = measuredGraph(organism, digest);
  const asked = BENCHMARK_ORGANISMS.includes(organism);
  const release = BENCHMARKS_META.tree.answers.release;
  return (
    <span className="bench-provenance">
      {same ? (
        <>This graph: the benchmarks asked a graph of this content digest, </>
      ) : asked ? (
        <>Another graph: the benchmarks asked a graph of this organism with another content digest, </>
      ) : (
        <>The benchmarks asked no graph of this organism. They measured </>
      )}
      with IDTrack&apos;s code at its release {release}, whose answers are the release&apos;s; their results are
      published by <a href={`${BENCHMARKS_META.repository}/tree/${BENCHMARKS_META.commit}`}>idtrack-reproducibility</a>.{" "}
      {asked ? <Link to="/method?accuracy=family">How often it agrees with its truth</Link> : null}
    </span>
  );
}
