"""Record real answers of a running idtrack-web api as the frontend's test fixtures (the bytes the api sent).

    python record_fixtures.py <base url> <organism> <scan.json> <out dir> [--curated <json file>]...
    python record_fixtures.py <base url> <organism> again <out dir>

For every feature of the scan (scan_features.py) the example with the fewest steps (and, for the step kinds, also the
longest) is asked again of the api with ``explain=true``; then the curated requests; then the organism's description,
final databases, names endpoints, a batch (JSON and TSV) and error answers. Each answer is written as it came
(``<name>.json`` or ``.tsv``) and listed in ``index.json`` with its request and status. With ``again`` in place of the
scan, the requests of ``index.json`` are asked again (when the api's answers change and the choice of requests does
not).
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

parser = argparse.ArgumentParser()
parser.add_argument("base")
parser.add_argument("organism")
parser.add_argument(
    "scan", help="The scan of the graph (scan_features.py); `again`: ask the requests of out/index.json."
)
parser.add_argument("out")
parser.add_argument("--curated", action="append", default=[], help="Curated requests (curated_*.json); repeatable.")
args = parser.parse_args()
#: Ask again the requests recorded before (out/index.json), in their order, under their names: the api's answers
#: changed and the choice of requests did not (a field the api adds, a changed refusal), so no scan of the graph is run.
again = args.scan == "again"

base = args.base.rstrip("/") + "/api/v1"
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
index: list[dict[str, Any]] = []
seen: set[str] = set()


def ask(name: str, method: str, path: str, query: dict[str, Any] | None = None, body: object | None = None) -> bytes:
    """Send a request; write its answer as sent and list it in the index."""
    url = base + path + ("?" + urllib.parse.urlencode(query) if query else "")
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method)  # noqa: S310 - the server being recorded
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310
            status, kind, raw = response.status, response.headers.get("content-type", ""), bytes(response.read())
    except urllib.error.HTTPError as error:
        status, kind, raw = error.code, error.headers.get("content-type", ""), error.read()
    ext = "tsv" if kind.startswith("text/tab-separated-values") else "json"
    file = f"{name}.{ext}"
    (out / file).write_bytes(raw)
    index.append(
        {
            "name": name,
            "method": method,
            "path": path,
            "query": query or {},
            "body": body,
            "status": status,
            "content_type": kind,
            "file": file,
        }
    )
    print(status, name, len(raw))
    return raw


def slug(text: str) -> str:
    """Return a file name part of a feature's name."""
    return re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_").lower()


def convert(name: str, identifier: str, arguments: dict[str, Any]) -> None:
    """Record one conversion with its path, once per distinct query."""
    query = {"identifier": identifier, "explain": "true"}
    query.update({k: (str(v).lower() if isinstance(v, bool) else v) for k, v in arguments.items()})
    key = json.dumps(query, sort_keys=True)
    if key in seen:
        return
    seen.add(key)
    ask(name, "GET", f"/organisms/{args.organism}/convert", query)


recorded = json.loads((out / "index.json").read_text()) if again else []
for entry in recorded:
    ask(entry["name"], entry["method"], entry["path"], entry["query"] or None, entry["body"])
if again:
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    print("recorded", len(index))
    raise SystemExit(0)

scan = json.loads(Path(args.scan).read_text())
for feature, examples in scan["features"].items():
    if feature.startswith("raise:"):
        continue
    shortest = min(
        examples, key=lambda e: (e["steps"] == 0 and not feature.startswith(("status", "reason")), e["steps"])
    )
    convert("convert_" + slug(feature), shortest["identifier"], shortest["arguments"])
    if feature.startswith(("kind:", "step_reason:", "handoff", "splits", "merges")) or feature == "long_path>15":
        longest = max(examples, key=lambda e: e["steps"])
        convert("convert_" + slug(feature) + "_long", longest["identifier"], longest["arguments"])

for curated in args.curated:
    for item in json.loads(Path(curated).read_text()):
        if item["kind"] == "convert":
            convert(item["name"], item["identifier"], item.get("arguments", {}))
        elif item["kind"] == "convert_plain":  # without explain
            query = {"identifier": item["identifier"], **item.get("arguments", {})}
            ask(item["name"], "GET", f"/organisms/{args.organism}/convert", query)
        elif item["kind"] == "get":
            ask(item["name"], "GET", item["path"].replace("{organism}", args.organism), item.get("query"))
        elif item["kind"] == "names_of_best":  # names of the best gene of an earlier recorded conversion
            earlier = json.loads((out / f"{item['source']}.json").read_text())
            gene = earlier["candidates"][0]["gene"]
            ask(item["name"], "GET", f"/organisms/{args.organism}/names-of", {"gene": gene, **item.get("query", {})})
        elif item["kind"] == "post":
            ask(
                item["name"], "POST", item["path"].replace("{organism}", args.organism), item.get("query"), item["body"]
            )

ask("health", "GET", "/health")
ask("version", "GET", "/version")
ask("organism", "GET", f"/organisms/{args.organism}")
ask("final_databases", "GET", f"/organisms/{args.organism}/final-databases")
(out / "index.json").write_text(json.dumps(index, indent=1) + "\n")
print("recorded", len(index))
