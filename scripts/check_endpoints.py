"""Call every endpoint of a running idtrack-web server and check every answer against the OpenAPI document.

    python scripts/check_endpoints.py http://127.0.0.1:8000 sus_scrofa [--graph <the same graph file>] [--sample 300]

For one organism it asks: health, the server's load, version, vocabulary, limits, organisms, the organism, final
databases at every release and the release-by-database matrix (each of its columns must be that release's final
databases), conversions of a sample of the graph's own identifiers (plain, with ``explain``, to other releases and
databases; a few into every database at once), the source of the sample as a list, a batch as JSON and as TSV (its
columns those the document lists), a batch whose items extend others by a numbered suffix (IDTrack's copies), names of
genes and genes of names, and a set of wrong requests (wrong types, sizes over the server's limits, unknown organisms,
releases, databases, genes and parameters, and strings of every kind IDTrack refuses: each must answer its error code,
with a message, and the argument where it names one), and strings IDTrack reads and reports what it changed (Unicode,
punctuation, GENCODE's Y copies). Every answer's status must be one the document declares for that endpoint, its body
must be valid against the declared schema, and it must carry ``X-Request-ID`` and a ``Server-Timing`` the script can
read (``app``, and ``queue``, ``search`` and ``write`` for a conversion), and an answer of the organism's graph
``Idtrack-Graph-Digest`` equal to the graph's ``content_digest`` of ``/version``. With ``--graph`` the script also loads
the graph with IDTrack and checks that every conversion and batch answer is exactly IDTrack's ``to_dict()`` (every float
with the same bits), and the database matrix IDTrack's own ``final_databases`` and ``databases_by_assembly``. It prints
a summary as JSON (with the server's load before and after) and exits 1 on any failure, 2 at once when the server limits
the rate of requests (serve with ``IDTRACK_WEB_RATE_PER_MINUTE=0`` for the check). Needs the API's development
environment (jsonschema; IDTrack for ``--graph``).
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import jsonschema
from referencing import Registry
from referencing.jsonschema import DRAFT202012

from idtrack_web_api.adapter import Graph
from idtrack_web_api.cautions import cautions_of
from idtrack_web_api.service import caution_facts

OPENAPI = Path(__file__).resolve().parents[1] / "api" / "openapi.json"
#: One entry of ``Server-Timing``: a name and a duration in milliseconds.
TIMING = re.compile(r"^(?P<name>[a-z]+);dur=(?P<ms>\d+(\.\d+)?)$")
#: The entry of an answer sent again from the server's memory (``hit``) or revalidated (``304``).
CACHED = re.compile(r'^cache;desc="(?P<how>hit|revalidated)"$')


def server_timing(value: str) -> dict[str, float] | None:
    """Return ``{name: milliseconds}`` of a ``Server-Timing`` value, or ``None`` if it cannot be read."""
    found = {}
    for part in value.split(", "):
        cached = CACHED.match(part)
        if cached is not None:
            found["cache_" + cached["how"]] = 0.0
            continue
        match = TIMING.match(part)
        if match is None:
            return None
        found[match["name"]] = float(match["ms"])
    return found


class Checker:
    """Requests, checks, and the tally."""

    def __init__(self, base: str, document: dict[str, Any]) -> None:
        self.base = base.rstrip("/")
        self.document = document
        self.registry: Registry[Any] = Registry().with_resource("urn:openapi", DRAFT202012.create_resource(document))
        self.tally: collections.Counter[str] = collections.Counter()
        self.failures: list[str] = []
        self.seconds: list[float] = []
        self.timings: dict[str, list[float]] = collections.defaultdict(list)
        #: The content digest every answer of the organism's graph names (``Idtrack-Graph-Digest``), once known.
        self.digest: str | None = None

    def request(self, method: str, path: str, query: dict[str, Any] | None = None, body: Any = None,
                content_type: str = "application/json") -> tuple[int, dict[str, str], bytes]:  # fmt: skip
        """Send a request; return its status, headers (lower-case names) and body."""
        url = self.base + path + ("?" + urllib.parse.urlencode(query, doseq=True) if query else "")
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        request = urllib.request.Request(url, data=data, method=method)  # noqa: S310 - the server under test
        if data is not None:
            request.add_header("Content-Type", content_type)
        start = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                result = response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
        except urllib.error.HTTPError as error:
            with error:
                result = error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()
        self.seconds.append(time.monotonic() - start)
        return result

    def check(self, method: str, template: str, path: str, query: dict[str, Any] | None = None, body: Any = None,
              expect: int = 200, code: str | None = None, content_type: str = "application/json") -> Any:  # fmt: skip
        """Send a request and check its answer against the document; record a failure; return the body."""
        status, headers, content = self.request(method, path, query, body, content_type)
        name = f"{method} {template} {status}" + (f" {code}" if code else "")
        self.tally[name] += 1
        problems = []
        if status != expect:
            problems.append(f"status {status}, expected {expect}: {content[:300]!r}")
        declared = self.document["paths"][template][method.lower()]["responses"].get(str(status))
        if declared is not None and "$ref" in declared:  # a refusal written once (components/responses)
            declared = self.document["components"]["responses"][declared["$ref"].rsplit("/", 1)[1]]
        media = headers.get("content-type", "").split(";")[0]
        data: Any = None
        if declared is None:
            problems.append(f"status {status} is not declared")
        elif media not in declared.get("content", {}):
            problems.append(f"content type {media} is not declared for {status}")
        elif media == "application/json":
            data = json.loads(content)
            ref = declared["content"][media]["schema"]["$ref"]
            validator = jsonschema.Draft202012Validator({"$ref": "urn:openapi" + ref}, registry=self.registry)
            errors = list(validator.iter_errors(data))
            if errors:
                problems.append(f"{len(errors)} schema errors: {[e.message for e in errors[:3]]}")
            if code is not None and (data.get("error") or {}).get("code") != code:
                problems.append(f"code {(data.get('error') or {}).get('code')}, expected {code}")
        else:
            data = content.decode("utf-8")
        if not headers.get("x-request-id"):
            problems.append("no X-Request-ID")
        named = headers.get("idtrack-graph-digest")
        if status == 200 and "{organism}" in template and self.digest is not None and named != self.digest:
            problems.append(f"Idtrack-Graph-Digest {named!r}, not the graph's")
        problems += self.timing_problems(template, status, headers.get("server-timing", ""))
        if problems:
            self.failures.append(f"{method} {path} {query or ''}: " + "; ".join(problems))
        return data

    def timing_problems(self, template: str, status: int, value: str) -> list[str]:
        """Read an answer's ``Server-Timing`` into the tally; return what is wrong with it."""
        timing = server_timing(value)
        if timing is None or "app" not in timing:
            return [f"Server-Timing missing or unreadable: {value!r}"]
        for part, ms in timing.items():
            self.timings[part].append(ms)
        searched = template.endswith(("/convert", "/convert/batch")) and status == 200 and "cache_hit" not in timing
        if searched and not {"queue", "search", "write"} <= set(timing):
            return [f"a conversion without the search's Server-Timing: {timing}"]
        return []


def idtracks(data: Any) -> Any:
    """Return an answer as IDTrack's record: every result's ``cautions`` (the API's reading) taken out."""
    if isinstance(data, list):
        return [idtracks(item) for item in data]
    if isinstance(data, dict):
        own = "candidates" in data and "cautions" in data
        return {k: idtracks(v) for k, v in data.items() if not (own and k == "cautions")}
    return data


def floats(value: Any) -> list[str]:
    """Return every float inside a JSON value, as its exact hexadecimal text."""
    if isinstance(value, float):
        return [value.hex()]
    if isinstance(value, dict):
        return [f for v in value.values() for f in floats(v)]
    if isinstance(value, list):
        return [f for v in value for f in floats(v)]
    return []


def main() -> int:  # noqa: PLR0912, PLR0915 - one script, read top to bottom
    """Run the checks; return the exit status."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("base", help="The server's base URL, e.g. http://127.0.0.1:8000")
    parser.add_argument("organism", help="An organism the server holds, e.g. sus_scrofa")
    parser.add_argument("--graph", help="The graph file the server serves for the organism (compare with IDTrack).")
    parser.add_argument("--sample", type=int, default=200, help="Identifiers converted (default 200).")
    arguments = parser.parse_args()
    document = json.loads(OPENAPI.read_text(encoding="utf-8"))
    c = Checker(arguments.base, document)
    p = "/api/v1"
    o = arguments.organism
    org = f"{p}/organisms/{{organism}}"

    c.check("GET", f"{p}/health", f"{p}/health")
    load = c.check("GET", f"{p}/status", f"{p}/status")
    version = c.check("GET", f"{p}/version", f"{p}/version")
    c.check("GET", f"{p}/vocabulary", f"{p}/vocabulary")
    limits = c.check("GET", f"{p}/limits", f"{p}/limits")
    if limits.get("rate_per_minute"):
        print(
            f"The server limits each client to {limits['rate_per_minute']} requests per minute; this check sends about "
            "2,000. Serve with IDTRACK_WEB_RATE_PER_MINUTE=0 for it.",
            file=sys.stderr,
        )
        return 2
    organisms = c.check("GET", f"{p}/organisms", f"{p}/organisms")
    c.digest = next(g["content_digest"] for g in version["graphs"] if g["organism"] == o)
    description = c.check("GET", org, f"{p}/organisms/{o}")
    releases = description["releases"]
    finals: dict[int, list[str]] = {}
    for release in releases:
        data = c.check("GET", f"{org}/final-databases", f"{p}/organisms/{o}/final-databases", {"to_release": release})
        finals[release] = data["final_databases"]
    matrix = c.check("GET", f"{org}/databases", f"{p}/organisms/{o}/databases")
    if matrix["releases"] != releases:
        c.failures.append("databases: its releases are not the organism's")
    for release in releases:
        column = sorted(d["name"] for d in matrix["databases"] if release in d["releases"])
        if column != sorted(finals[release]):
            c.failures.append(f"databases: the column of {release} is not that release's final databases")

    reference = None
    if arguments.graph:
        from idtrack.api import API
        from idtrack.ids import public_name

        reference = API.load(arguments.graph)
        if matrix["by_assembly"] != reference.databases_by_assembly() or any(
            sorted(reference.final_databases(r)) != sorted(finals[r]) for r in releases
        ):
            c.failures.append("databases: not IDTrack's own final_databases and databases_by_assembly")
        names = sorted({public_name(n) for n in reference.graph.nodes if not n.endswith((".Void", ".Retired"))})
        step = max(1, len(names) // arguments.sample)
        identifiers = names[::step][: arguments.sample]
    else:
        identifiers = ["INS", "TP53", "GCG", "PDX1", "SST", "CDX2", "SOX17", "FOXA2", "NKX6-1", "PTF1A"]
    middle = releases[len(releases) // 2]
    variants: list[dict[str, Any]] = [
        {},
        {"explain": True},
        {"to_release": middle, "explain": True},
        {"to_release": releases[0], "final_database": "base_ensembl_gene"},
        {"final_database": description["final_databases"][0], "explain": True},
        {"allow_bridges": False, "from_release": middle},
    ]
    compared = 0
    float_count = 0
    cautions_compared = 0
    adapted = Graph(reference) if reference is not None else None
    statuses: collections.Counter[str] = collections.Counter()
    for variant in variants:
        query = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in variant.items()}
        for identifier in identifiers:
            data = c.check("GET", f"{org}/convert", f"{p}/organisms/{o}/convert", {"identifier": identifier, **query})
            statuses[data["status"]] += 1
            if reference is not None and adapted is not None:
                expected: Any = reference.convert(identifier, **variant).to_dict()
                compared += 1
                float_count += len(floats(expected))
                if idtracks(data) != expected or floats(idtracks(data)) != floats(expected):
                    c.failures.append(f"convert {identifier} {variant}: the answer differs from IDTrack's")
                # The cautions: those of the result with its path, whatever `explain` asked.
                explained = reference.convert(identifier, **{**variant, "explain": True}).to_dict()
                cautions_compared += 1
                asked = variant.get("final_database")
                facts = caution_facts(adapted, asked if isinstance(asked, str) else None, 10.0)
                if data["cautions"] != cautions_of(explained, facts):
                    c.failures.append(f"convert {identifier} {variant}: the cautions differ from the rules' reading")
    batch = identifiers + identifiers[:5]
    for variant in ({}, {"explain": True, "to_release": middle}):
        data = c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None,
                       {"identifiers": batch, **variant})  # fmt: skip
        if reference is not None:
            expected = [r.to_dict() for r in reference.convert_many(batch, **variant)]
            compared += len(batch)
            if idtracks(data["results"]) != expected or floats(idtracks(data["results"])) != floats(expected):
                c.failures.append(f"batch {variant}: the answers differ from IDTrack's")
    # Items that extend others by a numbered suffix: IDTrack answers some as copies of the item they extend.
    copied = [i for i in identifiers if not i.startswith("ENS")][:30]
    batch_copies = [f"{i}-1" for i in copied[:15]] + copied + [f"{i}.2" for i in copied[10:20]] + [f"{copied[0]}-1-1"]
    data = c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None,
                   {"identifiers": batch_copies})  # fmt: skip
    copies_answered = sum(1 for r in data["results"] if (r["match"] or "").startswith("copy:"))
    if reference is not None:
        expected = [r.to_dict() for r in reference.convert_many(batch_copies)]
        compared += len(batch_copies)
        if idtracks(data["results"]) != expected or floats(idtracks(data["results"])) != floats(expected):
            c.failures.append("batch of copies: the answers differ from IDTrack's")
    table = c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", {"format": "tsv"},
                    {"identifiers": batch})  # fmt: skip
    rows = table.splitlines()
    tsv_content = c.document["paths"][f"{org}/convert/batch"]["post"]["responses"]["200"]["content"]
    if rows[0].split("\t") != [c["name"] for c in tsv_content["text/tab-separated-values"]["x-columns"]]:
        c.failures.append("batch as TSV: its columns are not those the document lists")
    # Every database at once, and the source of the sample as a list: each IDTrack's own call.
    for identifier in identifiers[:5]:
        data = c.check("GET", f"{org}/convert/each-database", f"{p}/organisms/{o}/convert/each-database",
                       {"identifier": identifier, "to_release": middle})  # fmt: skip
        if reference is not None:
            expected = [
                {"database": d, "result": reference.convert(identifier, to_release=middle, final_database=d).to_dict()}
                for d in reference.final_databases(middle)
            ]
            compared += len(expected)
            if idtracks(data["conversions"]) != expected or floats(idtracks(data["conversions"])) != floats(expected):
                c.failures.append(f"each database {identifier}: the answers differ from IDTrack's")
    for mode in ("release", "assembly_release"):
        data = c.check("POST", f"{org}/source-inference", f"{p}/organisms/{o}/source-inference", None,
                       {"identifiers": identifiers, "mode": mode})  # fmt: skip
        if reference is not None:
            expected = json.loads(json.dumps(reference.source_inference(identifiers, mode).to_dict()))
            if data["inference"] != expected:
                c.failures.append(f"source inference ({mode}): the answer differs from IDTrack's")
    genes = set()
    for name in identifiers[:40]:
        matches = c.check("GET", f"{org}/genes-named", f"{p}/organisms/{o}/genes-named", {"name": name})
        genes |= {m["gene"] for m in matches["matches"]}
        c.check("GET", f"{org}/genes-named", f"{p}/organisms/{o}/genes-named", {"name": name, "fold_case": "true"})
    for gene in sorted(genes)[:40]:
        c.check("GET", f"{org}/names-of", f"{p}/organisms/{o}/names-of", {"gene": gene})
        c.check("GET", f"{org}/names-of", f"{p}/organisms/{o}/names-of", {"gene": gene, "release": releases[-1]})

    convert_path, batch_path, names_path = (
        f"{p}/organisms/{o}/convert",
        f"{p}/organisms/{o}/convert/batch",
        f"{p}/organisms/{o}/names-of",
    )
    long_text = "A" * (limits["identifier_max_length"] + 1)
    gene = min(genes) if genes else "NOT_A_GENE.1"
    final = f"{org}/final-databases"
    finals_path = f"{p}/organisms/{o}/final-databases"
    named = f"{p}/organisms/{o}/genes-named"
    # (method, template, path, query, body, status, code, argument named or None)
    wrong: list[tuple[str, str, str, dict[str, Any] | None, Any, int, str, str | None]] = [
        # unknown releases, databases, organisms, genes, parameters
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "to_release": 1},
            None,
            400,
            "unknown_release",
            "to_release",
        ),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "from_release": 99999},
            None,
            400,
            "unknown_release",
            "from_release",
        ),
        ("GET", final, finals_path, {"to_release": 1}, None, 400, "unknown_release", "to_release"),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "final_database": "no"},
            None,
            400,
            "unknown_database",
            "final_database",
        ),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "from_database": "no"},
            None,
            400,
            "unknown_database",
            "from_database",
        ),
        (
            "GET",
            f"{org}/convert",
            f"{p}/organisms/no_such/convert",
            {"identifier": "X"},
            None,
            404,
            "unknown_organism",
            "organism",
        ),
        ("GET", org, f"{p}/organisms/cow", None, None, 404, "unknown_organism", "organism"),
        ("GET", f"{org}/names-of", names_path, {"gene": "NOT_A_GENE.1"}, None, 400, "unknown_identifier", None),
        ("GET", f"{org}/names-of", names_path, {"gene": gene, "release": 1}, None, 400, "unknown_release", None),
        ("GET", f"{org}/convert", convert_path, {"identifier": "X", "nope": 1}, None, 400, "unknown_parameter", None),
        ("GET", f"{org}/convert", convert_path, {"identifier": ["X", "Y"]}, None, 400, "unknown_parameter", None),
        # wrong types and shapes
        ("GET", f"{org}/convert", convert_path, {}, None, 400, "invalid_request", None),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "to_release": "abc"},
            None,
            400,
            "invalid_request",
            None,
        ),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "explain": "maybe"},
            None,
            400,
            "invalid_request",
            None,
        ),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "to_release": -5},
            None,
            400,
            "invalid_request",
            None,
        ),
        ("GET", f"{org}/genes-named", named, {"name": "X", "fold_case": "2"}, None, 400, "invalid_request", None),
        ("POST", f"{org}/convert/batch", batch_path, None, {"identifiers": []}, 400, "invalid_request", None),
        ("POST", f"{org}/convert/batch", batch_path, None, {"identifiers": "X"}, 400, "invalid_request", None),
        ("POST", f"{org}/convert/batch", batch_path, None, {"identifiers": [1, 2]}, 400, "invalid_request", None),
        (
            "POST",
            f"{org}/convert/batch",
            batch_path,
            None,
            {"identifiers": ["A"], "to_release": "1"},
            400,
            "invalid_request",
            None,
        ),
        (
            "POST",
            f"{org}/convert/batch",
            batch_path,
            None,
            {"identifiers": ["A"], "explain": 1},
            400,
            "invalid_request",
            None,
        ),
        (
            "POST",
            f"{org}/convert/batch",
            batch_path,
            None,
            {"identifiers": ["A"], "other": 1},
            400,
            "invalid_request",
            None,
        ),
        ("POST", f"{org}/convert/batch", batch_path, None, ["A"], 400, "invalid_request", None),
        (
            "POST",
            f"{org}/convert/batch",
            batch_path,
            {"format": "xml"},
            {"identifiers": ["A"]},
            400,
            "invalid_request",
            None,
        ),
        # sizes over the server's limits
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": long_text},
            None,
            400,
            "invalid_identifier",
            "identifier",
        ),
        ("GET", f"{org}/genes-named", named, {"name": long_text}, None, 400, "invalid_identifier", "name"),
        (
            "POST",
            f"{org}/convert/batch",
            batch_path,
            None,
            {"identifiers": ["A"] * (limits["batch_max"] + 1)},
            413,
            "too_many_identifiers",
            "identifiers",
        ),
        (
            "POST",
            f"{org}/convert/batch",
            batch_path,
            None,
            {"identifiers": ["A", long_text]},
            400,
            "invalid_identifier",
            "identifiers",
        ),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "X", "final_database": "D" * 201},
            None,
            400,
            "invalid_argument",
            "final_database",
        ),
        # strings IDTrack refuses (and the API's own bound on characters)
        ("GET", f"{org}/convert", convert_path, {"identifier": ""}, None, 400, "missing_value", "identifier"),
        ("GET", f"{org}/convert", convert_path, {"identifier": "   "}, None, 400, "missing_value", "identifier"),
        ("GET", f"{org}/convert", convert_path, {"identifier": "NA"}, None, 400, "missing_value", "identifier"),
        ("GET", f"{org}/convert", convert_path, {"identifier": "'nan';"}, None, 400, "missing_value", "identifier"),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "synonym_id::INS"},
            None,
            400,
            "invalid_argument",
            "identifier",
        ),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": "ENSG00000254647.Retired"},
            None,
            400,
            "invalid_argument",
            "identifier",
        ),
        (
            "GET",
            f"{org}/convert",
            convert_path,
            {"identifier": gene.split(".")[0] + ".1234567"},
            None,
            400,
            "invalid_argument",
            "identifier",
        ),
        ("GET", f"{org}/convert", convert_path, {"identifier": "A\x01"}, None, 400, "invalid_identifier", "identifier"),
        (
            "POST",
            f"{org}/convert/batch",
            batch_path,
            None,
            {"identifiers": ["A", "\x07"]},
            400,
            "invalid_identifier",
            "identifiers",
        ),
        # the server's own refusals
        ("GET", f"{org}/convert", f"{p}/organisms/{o}/nothing", None, None, 404, "not_found", None),
        ("DELETE", f"{org}/convert", convert_path, {"identifier": "X"}, None, 405, "method_not_allowed", None),
    ]
    refusals: collections.Counter[str] = collections.Counter()
    for method, template, path, wrong_query, body, expect, code, argument in wrong:
        if method == "DELETE":  # no such operation in the document: check the answer by hand
            status, _, content = c.request(method, path, wrong_query)
            error = json.loads(content).get("error") or {}
            if status != expect or error.get("code") != code or not error.get("message"):
                c.failures.append(f"{method} {path}: {status} {content[:200]!r}")
            refusals[code] += 1
            continue
        data = c.check(method, template, path, wrong_query, body, expect, code)
        error = (data or {}).get("error") or {}
        refusals[code] += 1
        if not error.get("message") or not error.get("request_id"):
            c.failures.append(f"{method} {path} {wrong_query}: the refusal {code} has no message or request id")
        if argument is not None and error.get("argument") != argument:
            c.failures.append(
                f"{method} {path} {wrong_query}: argument {error.get('argument')!r}, expected {argument!r}"
            )
    c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None, b"identifiers", 415,
            "unsupported_media_type", content_type="text/plain")  # fmt: skip
    refusals["unsupported_media_type"] += 1
    c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None,
            b"x" * (limits["body_max_bytes"] + 1), 413, "payload_too_large")  # fmt: skip
    refusals["payload_too_large"] += 1
    c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None, b"{not json", 400,
            "invalid_request")  # fmt: skip
    refusals["invalid_request"] += 1
    # Strings IDTrack reads and reports what it changed (answers, not refusals).
    read_as: dict[str, str | None] = {}
    for text in ("\ufeffINS", "INS\u200b", "\uff29\uff2e\uff33", '"INS"', "INS;", "ENSG00000254647_PAR_Y", "ins"):
        data = c.check("GET", f"{org}/convert", convert_path, {"identifier": text})
        read_as[text] = data["match"]

    load_after = c.check("GET", f"{p}/status", f"{p}/status")
    summary = {
        "base": arguments.base,
        "organism": o,
        "api_version": version["api_version"],
        "idtrack_version": version["idtrack_version"],
        "graphs": [g["organism"] for g in organisms["organisms"]],
        "requests": sum(c.tally.values()),
        "by_endpoint_and_status": dict(sorted(c.tally.items())),
        "conversion_statuses": dict(statuses),
        "compared_with_idtrack": compared,
        "cautions_compared": cautions_compared,
        "floats_compared_bit_for_bit": float_count,
        "tsv_rows": len(rows) - 1,
        "copies_answered": copies_answered,
        "refusals": dict(sorted(refusals.items())),
        "read_as": read_as,
        "seconds_median": sorted(c.seconds)[len(c.seconds) // 2],
        "seconds_max": max(c.seconds),
        "server_timing_ms_median": {k: sorted(v)[len(v) // 2] for k, v in sorted(c.timings.items())},
        "database_matrix": [len(matrix["databases"]), len(matrix["releases"])],
        "status_before": {
            "workers_alive": load["workers_alive"],
            "requests_total": load["requests"]["total"],
            "unavailable": load["unavailable"],
        },
        "status_after": {
            "workers_alive": load_after["workers_alive"],
            "requests_total": load_after["requests"]["total"],
            "latency": load_after["requests"]["latency"],
            "cpu": load_after["cpu"],
            "memory": load_after["memory"],
            "unavailable": load_after["unavailable"],
        },
        "failures": c.failures,
    }
    print(json.dumps(summary, indent=2))
    return 1 if c.failures else 0


if __name__ == "__main__":
    sys.exit(main())
