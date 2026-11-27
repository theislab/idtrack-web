"""Find identifiers whose conversions show each feature the path view draws, on a real graph.

The features: every step kind and reason, handoffs, splits, merges, scores (measured, unscored), bridges and every
rule and place relation of the bridges considered, the place relation of history steps, refused history steps,
gene places, external entries and finals, statuses, every reason, match kinds, other readings, and the ranking
fields (display name, authority).

    python scan_features.py <graph.npz> <out.json> <sample> [seconds]

Writes, per feature, up to 4 examples (identifier and arguments, path length). The fixtures are then recorded from
the running api with these arguments (record_fixtures.py), so they are the api's own answers. Needs the api's
environment (idtrack).
"""

from __future__ import annotations

import collections
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

from idtrack.api import API
from idtrack.ids import public_name

graph_path, out_path, sample = sys.argv[1], sys.argv[2], int(sys.argv[3])
limit_seconds = float(sys.argv[4]) if len(sys.argv) > 4 else 1800.0
api = API.load(graph_path)
d = api.describe()
releases = list(d.releases)
first, last = releases[0], releases[-1]
nodes = sorted({public_name(n) for n in api.graph.nodes if not str(n).endswith((".Void", ".Retired"))})
rng = random.Random(7)  # noqa: S311 - a fixed sample, not a secret
rng.shuffle(nodes)
nodes = nodes[:sample]

features: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
counts: collections.Counter[str] = collections.Counter()
mid = releases[len(releases) // 2]
variants: list[dict[str, Any]] = [
    {},
    {"to_release": first},
    {"from_release": first},
    {"to_release": mid},
    {"final_database": "HGNC Symbol"},
    {"final_database": "RefSeq_mRNA"},
    {"allow_bridges": False},
]


def note(name: str, ident: str, args: dict[str, Any], size: int) -> None:
    """Count a feature and keep up to four examples (the shortest paths, and one long)."""
    counts[name] += 1
    bucket = features[name]
    entry = {"identifier": ident, "arguments": args, "steps": size}
    if len(bucket) < 4:
        bucket.append(entry)
    else:  # keep short examples and one long one
        bucket.sort(key=lambda e: e["steps"])
        if size < bucket[0]["steps"]:
            bucket[0] = entry
        elif size > bucket[-1]["steps"]:
            bucket[-1] = entry


start = time.monotonic()
done = 0
for ident in nodes:
    if time.monotonic() - start > limit_seconds:
        break
    for args in variants:
        try:
            r = api.convert(str(ident), explain=True, **args).to_dict()
        except Exception as error:  # noqa: BLE001 - a scan: note the class
            note("raise:" + type(error).__name__, str(ident), args, 0)
            continue
        done += 1
        steps = r["path"]["steps"] if r["path"] else []
        size = len(steps)
        note("status:" + r["status"], str(ident), args, size)
        for reason in r["reasons"]:
            note("reason:" + reason, str(ident), args, size)
        if len(r["reasons"]) > 1:
            note("reasons>1", str(ident), args, size)
        for reading in r["other_readings"]:
            note("other_reading:" + reading["reason"], str(ident), args, size)
        if r["decided_by"]:
            note("decided_by:" + r["decided_by"], str(ident), args, size)
        if r["match"]:
            note("match:" + r["match"], str(ident), args, size)
        if r["from_release_fallback"]:
            note("from_release_fallback", str(ident), args, size)
        if r["known_versions"]:
            note("known_versions", str(ident), args, size)
        if r["no_target_genes"]:
            note("no_target_genes", str(ident), args, size)
        if r["alternative_locus_genes"]:
            note("alternative_locus_genes", str(ident), args, size)
        if len(r["candidates"]) > 1:
            note("candidates>1", str(ident), args, size)
        if len(r["candidates"]) > 5:
            note("candidates>5", str(ident), args, size)
        if r["tie"]:
            note("tie", str(ident), args, size)
        for s in steps:
            note("kind:" + s["kind"], str(ident), args, size)
            note("step_reason:" + s["reason"], str(ident), args, size)
            if s["kind"] == "history" and s["old_assembly"] is not None and s["assembly"] != s["old_assembly"]:
                note("handoff", str(ident), args, size)
            if s["weight"] is not None and s["weight"] != 1.0:
                note("weight<1", str(ident), args, size)
            if s["kind"] == "history" and s["weight"] is None:
                note("weight_none", str(ident), args, size)
            if s["splits"]:
                note("splits>0", str(ident), args, size)
            if s["merges"]:
                note("merges>0", str(ident), args, size)
            if any(db.startswith("synonym_id::") for db in s["databases"]):
                note("synonym_database_step", str(ident), args, size)
            if s["kind"] == "final" and s["release"] is None:
                note("final_release_none", str(ident), args, size)
            if s["places"] is not None:
                note("step_places:" + s["places"], str(ident), args, size)
        if r["path"]:
            for b in r["path"]["bridges"]:
                note("bridge_check:" + ("taken" if b["taken"] else "refused"), str(ident), args, size)
                note("bridge_places:" + b["places"], str(ident), args, size)
                for _, rule in b["through"]:
                    note("bridge_rule:" + rule, str(ident), args, size)
            for s in r["path"]["refused"]:
                note("refused:" + s["reason"], str(ident), args, size)
        for n in r["path"]["nodes"] if r["path"] else []:
            note("node:" + n["kind"], str(ident), args, size)
            if n["non_reference"]:
                note("node_non_reference", str(ident), args, size)
            if len(n["active"]) > 1:
                note("node_active_ranges>1", str(ident), args, size)
            if len(n["places"]) > 1:
                note("node_places>1", str(ident), args, size)
            if any(not place["reference"] for place in n["places"]):
                note("node_place_outside_reference", str(ident), args, size)
            if n["active"] and all(end is not None for _, end in n["active"]):
                note("node_ended", str(ident), args, size)
        for c in r["candidates"]:
            if c["bridges"]:
                note("candidate_bridges", str(ident), args, size)
            if c["final_confidence"] == 1:
                note("final_confidence_1", str(ident), args, size)
            if c["annotation"] is not None:
                note("annotation", str(ident), args, size)
            if c["score"] != 1.0:
                note("candidate_score<1", str(ident), args, size)
            if c["unscored_steps"]:
                note("candidate_unscored_steps", str(ident), args, size)
            if c["authority"]:
                note("candidate_authority", str(ident), args, size)
            if c["display_rank"] == 1:
                note("candidate_display_rank_1", str(ident), args, size)
        if size > 15:
            note("long_path>15", str(ident), args, size)

Path(out_path).write_text(
    json.dumps(
        {
            "graph": graph_path,
            "sampled": len(nodes),
            "conversions": done,
            "seconds": round(time.monotonic() - start, 1),
            "counts": dict(sorted(counts.items())),
            "features": dict(sorted(features.items())),
        },
        indent=1,
    )
)
print("conversions", done, "features", len(features))
