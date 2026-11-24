"""Call every endpoint of a running idtrack-web server and check every answer against the OpenAPI document.

    python scripts/check_endpoints.py http://127.0.0.1:8000 sus_scrofa [--graph <the same graph file>] [--sample 300]

For one organism it asks: health, version, vocabulary, limits, organisms, the organism, final databases at every
release, conversions of a sample of the graph's own identifiers (plain, with ``explain``, to other releases and
databases), a batch as JSON and as TSV, a batch whose items extend others by a numbered suffix (idtrack's copies),
names of genes and genes of names, and a set of wrong requests (wrong types, sizes over the server's limits, unknown
organisms, releases, databases, genes and parameters, and strings of every kind idtrack refuses: each must answer its
error code, with a message, and the argument where it names one), and strings idtrack reads and reports what it
changed (Unicode, punctuation, GENCODE's Y copies). Every answer's status must be one the document declares for that
endpoint, and its body must be valid against the declared schema. With ``--graph`` the script also loads the graph
with idtrack and checks that every conversion and batch answer is exactly idtrack's ``to_dict()`` (every float with
the same bits). It prints a summary as JSON and exits 1 on any failure, 2 at once when the server limits the rate of
requests (serve with ``IDTRACK_WEB_RATE_PER_MINUTE=0`` for the check). Needs the api's development environment
(jsonschema; idtrack for ``--graph``).
"""

from __future__ import annotations

import argparse
import collections
import json
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

OPENAPI = Path(__file__).resolve().parents[1] / "api" / "openapi.json"


class Checker:
    """Requests, checks, and the tally."""

    def __init__(self, base: str, document: dict[str, Any]) -> None:
        self.base = base.rstrip("/")
        self.document = document
        self.registry: Registry[Any] = Registry().with_resource("urn:openapi", DRAFT202012.create_resource(document))
        self.tally: collections.Counter[str] = collections.Counter()
        self.failures: list[str] = []
        self.seconds: list[float] = []

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
        if problems:
            self.failures.append(f"{method} {path} {query or ''}: " + "; ".join(problems))
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
    parser.add_argument("--graph", help="The graph file the server serves for the organism (compare with idtrack).")
    parser.add_argument("--sample", type=int, default=200, help="Identifiers converted (default 200).")
    arguments = parser.parse_args()
    document = json.loads(OPENAPI.read_text(encoding="utf-8"))
    c = Checker(arguments.base, document)
    p = "/api/v1"
    o = arguments.organism
    org = f"{p}/organisms/{{organism}}"

    c.check("GET", f"{p}/health", f"{p}/health")
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
    description = c.check("GET", org, f"{p}/organisms/{o}")
    releases = description["releases"]
    for release in releases:
        c.check("GET", f"{org}/final-databases", f"{p}/organisms/{o}/final-databases", {"to_release": release})

    reference = None
    if arguments.graph:
        from idtrack.api import API
        from idtrack.ids import public_name

        reference = API.load(arguments.graph)
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
    statuses: collections.Counter[str] = collections.Counter()
    for variant in variants:
        query = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in variant.items()}
        for identifier in identifiers:
            data = c.check("GET", f"{org}/convert", f"{p}/organisms/{o}/convert", {"identifier": identifier, **query})
            statuses[data["status"]] += 1
            if reference is not None:
                expected = reference.convert(identifier, **variant).to_dict()
                compared += 1
                float_count += len(floats(expected))
                if data != expected or floats(data) != floats(expected):
                    c.failures.append(f"convert {identifier} {variant}: the answer differs from idtrack's")
    batch = identifiers + identifiers[:5]
    for variant in ({}, {"explain": True, "to_release": middle}):
        data = c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None,
                       {"identifiers": batch, **variant})  # fmt: skip
        if reference is not None:
            expected = [r.to_dict() for r in reference.convert_many(batch, **variant)]
            compared += len(batch)
            if data["results"] != expected or floats(data["results"]) != floats(expected):
                c.failures.append(f"batch {variant}: the answers differ from idtrack's")
    # Items that extend others by a numbered suffix: idtrack answers some as copies of the item they extend.
    copied = [i for i in identifiers if not i.startswith("ENS")][:30]
    batch_copies = [f"{i}-1" for i in copied[:15]] + copied + [f"{i}.2" for i in copied[10:20]] + [f"{copied[0]}-1-1"]
    data = c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None,
                   {"identifiers": batch_copies})  # fmt: skip
    copies_answered = sum(1 for r in data["results"] if (r["match"] or "").startswith("copy:"))
    if reference is not None:
        expected = [r.to_dict() for r in reference.convert_many(batch_copies)]
        compared += len(batch_copies)
        if data["results"] != expected or floats(data["results"]) != floats(expected):
            c.failures.append("batch of copies: the answers differ from idtrack's")
    table = c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", {"format": "tsv"},
                    {"identifiers": batch})  # fmt: skip
    rows = table.splitlines()
    genes = set()
    for name in identifiers[:40]:
        matches = c.check("GET", f"{org}/genes-named", f"{p}/organisms/{o}/genes-named", {"name": name})
        genes |= {m["gene"] for m in matches["matches"]}
        c.check("GET", f"{org}/genes-named", f"{p}/organisms/{o}/genes-named", {"name": name, "fold_case": "true"})
    for gene in sorted(genes)[:40]:
        c.check("GET", f"{org}/names-of", f"{p}/organisms/{o}/names-of", {"gene": gene})
        c.check("GET", f"{org}/names-of", f"{p}/organisms/{o}/names-of", {"gene": gene, "release": releases[-1]})

    convert, batch, names = (
        f"{p}/organisms/{o}/convert",
        f"{p}/organisms/{o}/convert/batch",
        f"{p}/organisms/{o}/names-of",
    )
    long_text = "A" * (limits["identifier_max_length"] + 1)
    gene = sorted(genes)[0] if genes else "NOT_A_GENE.1"
    final = f"{org}/final-databases"
    finals = f"{p}/organisms/{o}/final-databases"
    named = f"{p}/organisms/{o}/genes-named"
    # (method, template, path, query, body, status, code, argument named or None)
    wrong: list[tuple[str, str, str, dict[str, Any] | None, Any, int, str, str | None]] = [
        # unknown releases, databases, organisms, genes, parameters
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": "X", "to_release": 1},
            None,
            400,
            "unknown_release",
            "to_release",
        ),
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": "X", "from_release": 99999},
            None,
            400,
            "unknown_release",
            "from_release",
        ),
        ("GET", final, finals, {"to_release": 1}, None, 400, "unknown_release", "to_release"),
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": "X", "final_database": "no"},
            None,
            400,
            "unknown_database",
            "final_database",
        ),
        (
            "GET",
            f"{org}/convert",
            convert,
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
        ("GET", f"{org}/names-of", names, {"gene": "NOT_A_GENE.1"}, None, 400, "unknown_identifier", None),
        ("GET", f"{org}/names-of", names, {"gene": gene, "release": 1}, None, 400, "unknown_release", None),
        ("GET", f"{org}/convert", convert, {"identifier": "X", "nope": 1}, None, 400, "unknown_parameter", None),
        ("GET", f"{org}/convert", convert, {"identifier": ["X", "Y"]}, None, 400, "unknown_parameter", None),
        # wrong types and shapes
        ("GET", f"{org}/convert", convert, {}, None, 400, "invalid_request", None),
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": "X", "to_release": "abc"},
            None,
            400,
            "invalid_request",
            None,
        ),
        ("GET", f"{org}/convert", convert, {"identifier": "X", "explain": "maybe"}, None, 400, "invalid_request", None),
        ("GET", f"{org}/convert", convert, {"identifier": "X", "to_release": -5}, None, 400, "invalid_request", None),
        ("GET", f"{org}/genes-named", named, {"name": "X", "fold_case": "2"}, None, 400, "invalid_request", None),
        ("POST", f"{org}/convert/batch", batch, None, {"identifiers": []}, 400, "invalid_request", None),
        ("POST", f"{org}/convert/batch", batch, None, {"identifiers": "X"}, 400, "invalid_request", None),
        ("POST", f"{org}/convert/batch", batch, None, {"identifiers": [1, 2]}, 400, "invalid_request", None),
        (
            "POST",
            f"{org}/convert/batch",
            batch,
            None,
            {"identifiers": ["A"], "to_release": "1"},
            400,
            "invalid_request",
            None,
        ),
        (
            "POST",
            f"{org}/convert/batch",
            batch,
            None,
            {"identifiers": ["A"], "explain": 1},
            400,
            "invalid_request",
            None,
        ),
        ("POST", f"{org}/convert/batch", batch, None, {"identifiers": ["A"], "other": 1}, 400, "invalid_request", None),
        ("POST", f"{org}/convert/batch", batch, None, ["A"], 400, "invalid_request", None),
        (
            "POST",
            f"{org}/convert/batch",
            batch,
            {"format": "xml"},
            {"identifiers": ["A"]},
            400,
            "invalid_request",
            None,
        ),
        # sizes over the server's limits
        ("GET", f"{org}/convert", convert, {"identifier": long_text}, None, 400, "invalid_identifier", "identifier"),
        ("GET", f"{org}/genes-named", named, {"name": long_text}, None, 400, "invalid_identifier", "name"),
        (
            "POST",
            f"{org}/convert/batch",
            batch,
            None,
            {"identifiers": ["A"] * (limits["batch_max"] + 1)},
            413,
            "too_many_identifiers",
            "identifiers",
        ),
        (
            "POST",
            f"{org}/convert/batch",
            batch,
            None,
            {"identifiers": ["A", long_text]},
            400,
            "invalid_identifier",
            "identifiers",
        ),
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": "X", "final_database": "D" * 201},
            None,
            400,
            "invalid_argument",
            "final_database",
        ),
        # strings idtrack refuses (and the api's own bound on characters)
        ("GET", f"{org}/convert", convert, {"identifier": ""}, None, 400, "missing_value", "identifier"),
        ("GET", f"{org}/convert", convert, {"identifier": "   "}, None, 400, "missing_value", "identifier"),
        ("GET", f"{org}/convert", convert, {"identifier": "NA"}, None, 400, "missing_value", "identifier"),
        ("GET", f"{org}/convert", convert, {"identifier": "'nan';"}, None, 400, "missing_value", "identifier"),
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": "synonym_id::INS"},
            None,
            400,
            "invalid_argument",
            "identifier",
        ),
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": "ENSG00000254647.Retired"},
            None,
            400,
            "invalid_argument",
            "identifier",
        ),
        (
            "GET",
            f"{org}/convert",
            convert,
            {"identifier": gene.split(".")[0] + ".1234567"},
            None,
            400,
            "invalid_argument",
            "identifier",
        ),
        ("GET", f"{org}/convert", convert, {"identifier": "A\x01"}, None, 400, "invalid_identifier", "identifier"),
        (
            "POST",
            f"{org}/convert/batch",
            batch,
            None,
            {"identifiers": ["A", "\x07"]},
            400,
            "invalid_identifier",
            "identifiers",
        ),
        # the server's own refusals
        ("GET", f"{org}/convert", f"{p}/organisms/{o}/nothing", None, None, 404, "not_found", None),
        ("DELETE", f"{org}/convert", convert, {"identifier": "X"}, None, 405, "method_not_allowed", None),
    ]
    refusals: collections.Counter[str] = collections.Counter()
    for method, template, path, query, body, expect, code, argument in wrong:
        if method == "DELETE":  # no such operation in the document: check the answer by hand
            status, _, content = c.request(method, path, query)
            error = json.loads(content).get("error") or {}
            if status != expect or error.get("code") != code or not error.get("message"):
                c.failures.append(f"{method} {path}: {status} {content[:200]!r}")
            refusals[code] += 1
            continue
        data = c.check(method, template, path, query, body, expect, code)
        error = (data or {}).get("error") or {}
        refusals[code] += 1
        if not error.get("message") or not error.get("request_id"):
            c.failures.append(f"{method} {path} {query}: the refusal {code} has no message or request id")
        if argument is not None and error.get("argument") != argument:
            c.failures.append(f"{method} {path} {query}: argument {error.get('argument')!r}, expected {argument!r}")
    c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None, b"identifiers", 415,
            "unsupported_media_type", content_type="text/plain")  # fmt: skip
    refusals["unsupported_media_type"] += 1
    c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None,
            b"x" * (limits["body_max_bytes"] + 1), 413, "payload_too_large")  # fmt: skip
    refusals["payload_too_large"] += 1
    c.check("POST", f"{org}/convert/batch", f"{p}/organisms/{o}/convert/batch", None, b"{not json", 400,
            "invalid_request")  # fmt: skip
    refusals["invalid_request"] += 1
    # Strings idtrack reads and reports what it changed (answers, not refusals).
    read_as: dict[str, str | None] = {}
    for text in ("\ufeffINS", "INS\u200b", "\uff29\uff2e\uff33", '"INS"', "INS;", "ENSG00000254647_PAR_Y", "ins"):
        data = c.check("GET", f"{org}/convert", convert, {"identifier": text})
        read_as[text] = data["match"]

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
        "floats_compared_bit_for_bit": float_count,
        "tsv_rows": len(rows) - 1,
        "copies_answered": copies_answered,
        "refusals": dict(sorted(refusals.items())),
        "read_as": read_as,
        "seconds_median": sorted(c.seconds)[len(c.seconds) // 2],
        "seconds_max": max(c.seconds),
        "failures": c.failures,
    }
    print(json.dumps(summary, indent=2))
    return 1 if c.failures else 0


if __name__ == "__main__":
    sys.exit(main())
