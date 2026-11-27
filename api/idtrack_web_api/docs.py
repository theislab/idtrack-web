# ruff: noqa: E501 - the Markdown texts are written one paragraph per line (Markdown is never hard-wrapped)
"""The api's texts, written from one source: the OpenAPI document and the api's tables.

- ``/llms.txt`` (:py:func:`llms_txt`): the index for language models, as the llms.txt convention asks (an H1, a
  quotation that says what the api is, a short orientation, then H2 sections that are lists of links, with absolute
  addresses, to resources that read as text);
- ``/llms-full.txt`` (:py:func:`llms_full_txt`): every rule of the api as one Markdown text: the endpoints with each
  parameter (from the document), how to read an answer, the error codes (from :py:data:`idtrack_web_api.errors.CODES`)
  and which endpoint answers each, the headers, the bounds, a client that follows the rules, and real examples;
- README.md's tables of endpoints and error codes (:py:func:`readme_tables`, between the markers
  ``<!-- generated: ... -->`` and ``<!-- /generated -->``), written by ``idtrack-web docs --write`` and compared by
  ``tests/test_docs.py``.
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, urlencode

from idtrack_web_api.contract import ENDPOINT_ERRORS, _examples
from idtrack_web_api.errors import CODES, RETRYABLE
from idtrack_web_api.schemas import FROM_RELEASE_RULE

if TYPE_CHECKING:
    from pathlib import Path

_REF = re.compile(r"#/components/schemas/(\w+)")


def _summary_line(text: str) -> str:
    return " ".join(text.split())


def _type_of(schema: dict[str, Any]) -> str:
    if "anyOf" in schema:
        kinds = [_type_of(s) for s in schema["anyOf"] if s.get("type") != "null"]
        return " or ".join(kinds) or "null"
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    if "enum" in schema:
        return " | ".join(f"`{v}`" for v in schema["enum"])
    return str(schema.get("type", "any"))


def _endpoints(document: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    return [
        (method.upper(), path, operation)
        for path, operations in document["paths"].items()
        for method, operation in operations.items()
    ]


def _short(path: str) -> str:
    """Return an endpoint's path as the texts write it: the whole path for the index, else from ``/api/v1`` on."""
    return path.removeprefix("/api/v1") or "/api/v1 (the index)"


def _kilobytes(text: str) -> str:
    return f"about {max(1, round(len(text.encode('utf-8')) / 1000))} KB"


def held_line(held: list[dict[str, Any]]) -> str:
    """Return the organisms a server holds, in one line: each with its short names and its releases.

    Args:
        held: Per organism ``organism``, ``aliases`` and ``releases`` (ascending).

    Returns:
        str: The line (``none`` for a server that holds no graph).
    """
    if not held:
        return "none"
    parts = []
    for o in held:
        aliases = f" ({', '.join(f'`{a}`' for a in o['aliases'])})" if o["aliases"] else ""
        releases = o["releases"]
        span = f"releases {releases[0]} to {releases[-1]}" if releases else "no release"
        parts.append(f"`{o['organism']}`{aliases}: {span}")
    return "; ".join(parts)


def llms_txt(base: str, document: dict[str, Any], held: list[dict[str, Any]] | None = None) -> str:
    """Return ``/llms.txt``.

    Args:
        base: The site's address (``https://<domain>``).
        document: The OpenAPI document.
        held: The organisms this server holds (:py:func:`held_line`).

    Returns:
        str: The text.
    """
    full = llms_full_txt(base, document, held)
    openapi = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    lines = [
        "# idtrack web api",
        "",
        "> " + _summary_line(document["info"]["description"]),
        "",
        f"This server holds: {held_line(held or [])}. One organism at a time: there is no mapping between species.",
        "",
        (
            f"The api is under `{base}/api/v1`: JSON in, JSON out (a batch also as TSV); keyless and read-only, callable "
            'from any page (CORS); every failure is `{"error": {"code", ...}}` with a stable `code`, and a client '
            "keeps within its allowances where the server sets them (`allowances_enforced` of `GET /api/v1/limits`). "
            f"Start with `GET {base}/api/v1` (every endpoint, about 3 KB) and `llms-full.txt` (the rules, "
            f"{_kilobytes(full)}); the OpenAPI document ({_kilobytes(openapi)}) has every field of every answer."
        ),
        "",
        (
            f"One identifier: `GET {base}/api/v1/organisms/homo_sapiens/convert?identifier=TP53&final_database=HGNC%20Symbol`. "
            "A list from a paper or a dataset, in three steps:"
        ),
        "",
        (
            f'1. `POST {base}/api/v1/organisms/homo_sapiens/source-inference` with `{{"identifiers": [...]}}`: the '
            "release the list fits best is `from_release` of the answer."
        ),
        (
            f'2. `POST {base}/api/v1/organisms/homo_sapiens/convert/batch` with `{{"identifiers": [...], '
            '"from_release": <that release>, "final_database": "HGNC Symbol"}`, at most `batch_max` per request.'
        ),
        (
            '3. Per result, the answer is the `target` of the candidates with `"best": true`, and only where `status` '
            "is `converted` or `tie`; review every answer whose `cautions` hold an item of `tone` `caution` (each names "
            "its class and the limitation of idtrack it falls under), and keep the `Idtrack-Graph-Digest` header with the "
            "results."
        ),
        "",
        "## Docs",
        "",
        (
            f"- [The api's rules and examples]({base}/llms-full.txt): every endpoint and parameter, how to read an answer, "
            f"every error code, bounds, a client that follows the rules, real examples (Markdown, {_kilobytes(full)})"
        ),
        (
            f"- [OpenAPI document]({base}/api/v1/openapi.json): every endpoint, parameter, field, enumeration, error code "
            f"and example (JSON, {_kilobytes(openapi)})"
        ),
        f"- [Vocabulary]({base}/api/v1/vocabulary): the meaning of every code an answer carries (JSON)",
        f"- [Bounds]({base}/api/v1/limits): this server's limits and each client's allowances (JSON)",
        f"- [Organisms]({base}/api/v1/organisms): the graphs this server holds, their releases and databases (JSON)",
        f"- [Versions]({base}/api/v1/version): the api, idtrack and every graph's digest, to quote with results (JSON)",
        "",
        "## Optional",
        "",
        (
            f"- [The api page]({base}/developers): the reference for people, with a console per endpoint (needs "
            "JavaScript)"
        ),
        (
            "- [idtrack's documentation](https://idtrack.readthedocs.io/en/stable/): how idtrack answers, and its known "
            "limitations; `pip install idtrack` answers the same offline"
        ),
        "- [Source of the web app](https://github.com/theislab/idtrack-web)",
        "",
    ]
    return "\n".join(lines)


def _parameters(operation: dict[str, Any], document: dict[str, Any]) -> list[str]:
    found = []
    for parameter in operation.get("parameters", []):
        schema = parameter.get("schema", {})
        required = "required" if parameter.get("required") else f"default `{json.dumps(schema.get('default'))}`"
        if not parameter.get("required") and schema.get("default") is None:
            required = "optional"
        found.append(
            f"  - `{parameter['name']}` ({parameter['in']}, {_type_of(schema)}, {required}): "
            f"{_summary_line(parameter.get('description', ''))}"
        )
    body = operation.get("requestBody")
    if body is not None:
        ref = body["content"]["application/json"]["schema"]["$ref"].rsplit("/", 1)[-1]
        schema = document["components"]["schemas"][ref]
        found.append("  - a JSON body (`Content-Type: application/json`, UTF-8), an object of the keys:")
        for name, prop in schema["properties"].items():
            required = (
                "required" if name in schema.get("required", []) else f"default `{json.dumps(prop.get('default'))}`"
            )
            found.append(f"    - `{name}` ({_type_of(prop)}, {required}): {_summary_line(prop.get('description', ''))}")
    return found


def endpoint_lines(document: dict[str, Any]) -> list[str]:
    """Return the endpoints of the document as Markdown list items, with every parameter and the error codes.

    Args:
        document: The OpenAPI document.

    Returns:
        list[str]: The lines.
    """
    lines: list[str] = []
    for method, path, operation in _endpoints(document):
        lines.append(f"- `{method} {_short(path)}`: {_summary_line(operation.get('description', ''))}")
        lines += _parameters(operation, document)
        codes = ENDPOINT_ERRORS.get(operation["operationId"], ())
        if codes:
            lines.append("  - error codes: " + ", ".join(f"`{c}` ({CODES[c][0]})" for c in codes))
    return lines


def error_lines() -> list[str]:
    """Return the error codes as a Markdown table: code, status, retry, when.

    Returns:
        list[str]: The lines.
    """
    lines = ["| Code | Status | Retry | When |", "| --- | --- | --- | --- |"]
    for code, (status, text) in CODES.items():
        retry = "yes (after `Retry-After` where it is sent)" if code in RETRYABLE else "no: change the request"
        lines.append(f"| `{code}` | {status} | {retry} | {text} |")
    return lines


_READING_TEXT = """## Reading an answer

- A conversion's `status` is one of `converted`, `tie`, `no_target`, `not_found`, `unknown_version`, `no_conversion`, `error` (meanings: `statuses` of `GET /api/v1/vocabulary`, where `answers_requested_database` says which answer in the database asked). An identifier that is not in the graph is not an error: it is a result with status `not_found` and its `reason`.
- **The release an identifier is read at.** With `from_release`, it is read at that release (where the graph does not hold it there, at another release: `reasons` holds `read_at_another_release`, `from_release_fallback` is `true`, and `from_release_given` keeps the one sent). {FROM_RELEASE_RULE} `from_release_inferred` is `true` whenever the release read was chosen by the engine: no release was given, or the one given was replaced.
- **Only `converted` and `tie` answer in the requested database.** Read the answer from `candidates`: each candidate with `"best": true` holds an answer in `target` (a `tie` has several). For `no_target`, `final_database` becomes `ensembl_gene` and the best candidates are the genes reached, standing in for the missing id: check `status` (or `final_database`) before reading `target`. `unknown_version` answers no gene (the versions that exist are in `known_versions`); `no_conversion` has none (`reasons` says why).
- **How the string was read** is in `match` (a step after its prefixes, each followed by `:`; meanings: `match_steps`, `match_prefixes` of the vocabulary). A `match` that holds `synonym:` was read as a synonym; `copy:` (a batch only) as the copy of another item; `version_newer_than_graph` means an Ensembl version newer than any the graph holds was read as the latest version (its `reasons` may be empty: check `match`). `other_readings`, when not empty, lists what the same string means elsewhere (another release, another gene). `from_databases` (and a candidate's `entry_databases`) names the databases that read the string; it is empty for a versioned Ensembl gene id, which is read as the gene itself.
- **A `from_database` the identifier is not an id of** answers as if the string were absent from that database (`no_conversion` with `no_gene_at_start`, or `not_found`), not as a retired id: send it without `from_database` to read it in every database. Some databases come in two forms, a database of accessions and one of their labels (`RefSeq_peptide` and `RefSeq peptide`; `kind` and `labels` of `GET /api/v1/organisms/{organism}/databases` say which is which).
- **The strength of the evidence** is in each candidate's ranking record (meanings: `candidate_fields`): `bridges` above 0 means the answer crossed between genes through an id two genes carried, which is idtrack's inference, not Ensembl's history; with `explain=true`, a step's `places` of `places_apart` means Ensembl's history moved the gene to another place, and a node's `non_reference` that the gene lies outside the reference sequence (a haplotype, a patch). `score` is the product of Ensembl's mapping scores along the history of the path (1.0 without a scored event), as sent: one of the criteria that rank the candidates (`criteria` of the vocabulary), in their order. `decided_by` names the criterion that separated the best answer from the runner-up.
- **Every result carries `cautions`**: the api's reading of its evidence by stated rules (`cautions` of the vocabulary: each code's meaning, whether it reads the path, and the section of idtrack's limitations it falls under), the same with or without `explain`. An item of `tone` `caution` makes the answer one to review before relying on it (a bridge, a gene that lies outside the reference sequence, a bare number read in an old numbering, a synonym, another meaning at other releases, ...); a `note` is an exact fact that is no fault. A pipeline that keeps `converted` and `tie` should keep the cautions beside each answer (the table's `cautions` column holds their codes) rather than trust the status alone.
- **A converted answer can still be the wrong gene where idtrack documents a limitation**, and the answer then carries its sign: treat such an answer as one to review, and read the limitation: bridges ([Answers that only a bridge reaches](https://idtrack.readthedocs.io/en/stable/limitations.html#answers-that-only-a-bridge-reaches)), a bare number read in several numbering schemes ([Numbers that several numbering schemes share](https://idtrack.readthedocs.io/en/stable/limitations.html#numbers-that-several-numbering-schemes-share)), a symbol read without a release ([Without a release, a string is what it means today](https://idtrack.readthedocs.io/en/stable/limitations.html#without-a-release-a-string-is-what-it-means-today)), an answer on a patch or haplotype ([Copies on patches and alternative loci](https://idtrack.readthedocs.io/en/stable/limitations.html#copies-on-patches-and-alternative-loci)), a gene Ensembl moved ([An id that Ensembl moves to another place](https://idtrack.readthedocs.io/en/stable/limitations.html#an-id-that-ensembl-moves-to-another-place)), the successors of a split ([Among the successors of a split, the best answer does not look at the old place](https://idtrack.readthedocs.io/en/stable/limitations.html#among-the-successors-of-a-split-the-best-answer-does-not-look-at-the-old-place)); every limitation: [idtrack's limitations](https://idtrack.readthedocs.io/en/stable/limitations.html).
- **A batch's answer depends on the batch** while `read_copies` is `true` (the default): an item that is another item of the same batch with `-1`, `.1` or `_1` appended, and is itself no exact name, is answered as that item's copy (`match` begins with `copy:`). Keep such names in one batch, or send `"read_copies": false` to convert every item alone, as `GET .../convert` does.
- **What the graph does not hold answers nothing** ([Databases the graph does not hold](https://idtrack.readthedocs.io/en/stable/limitations.html#databases-the-graph-does-not-hold)): the name authorities' own ids (HGNC, MGI and VGNC ids such as `HGNC:11998`), UniProt's secondary accessions, entry names and isoforms (`Q9Y6K9-2`), RNAcentral, and microarray probe sets (Affymetrix, Illumina and Agilent probes such as `201746_at`, which Ensembl maps but the graphs do not select): each is `not_found`; map them elsewhere, or ask by the symbol, the primary accession or the Ensembl id. The databases a graph holds: `external_databases` of `GET /api/v1/organisms/{organism}`; the values `final_database` takes at a release: `GET .../final-databases?to_release=`. Database names are matched as idtrack matches them; send them as these lists write them. What each holds: `kind` of `GET /api/v1/organisms/{organism}/databases` (`ensembl`: an Ensembl gene id, `versioned` or not; `accession`; `label`: symbols and other names). For NCBI Gene ids ask `EntrezGene`; `NCBI gene (formerly Entrezgene)` holds NCBI's official symbols (its `labels_of` is `EntrezGene`).
- One organism at a time: idtrack converts within the organism's own graph; it does not map between species.
"""
_READING = _READING_TEXT.replace("{FROM_RELEASE_RULE}", FROM_RELEASE_RULE)

_RULES = """## How to use it from a program

- Send `Accept: application/json`; send a body as `Content-Type: application/json` in UTF-8, typed strictly (a release is a number, never `"115"`); a query's release is digits only, a query's boolean `true` or `false`. A query parameter an endpoint does not take, or one given twice, is refused with `unknown_parameter`.
- Branch on `error.code`, which is stable; `message` is for people. `argument` names the parameter at fault, `allowed` lists the accepted values (releases, databases, organisms, parameters, methods), `details` each problem of a request of the wrong shape. A batch item with `status: "error"` carries `error.code` too.
- For many identifiers send `POST .../convert/batch` in pieces of at most `batch_max` (`GET /api/v1/limits`) rather than one request each. One item's failure is that item's `error`; an identifier the api refuses at its boundary (over `identifier_max_length` characters, control characters inside it) refuses the whole batch (`400 invalid_identifier`, every such index in `details`): remove or correct it and send the batch again. White space at the ends of an identifier (a space, a tab, a line break) is no part of it: it is read without, and `query_id` keeps it as sent. `format=tsv` answers a table: its columns are listed in the OpenAPI document (`x-columns` and the description of the `200` answer's `text/tab-separated-values`), one row per candidate, `error_code` the stable code of an item's error.
- For a list from a paper or an old table, ask `POST .../source-inference` with the list first, then send the band's best release as `from_release`; for one identifier in every database at a release, `GET .../convert/each-database`.
- Retry exactly the codes whose `retryable` is `true` in the vocabulary's `errors` (`request_timeout` 408, `rate_limited` 429, `internal_error` 500, `server_busy` and `request_budget_exceeded` 503): wait the `Retry-After` header's seconds (also `retry_after` of the error) where it is sent, then send again, waiting longer each time it repeats; every other code answers the same request the same way until it is changed. A client's allowances (when `allowances_enforced` of `GET /api/v1/limits` is `true`) count its searching requests (`rate_per_minute`, `rate_burst`), its other requests (`read_share` times as many), the seconds its searches took (`rate_search_seconds` per minute) and its searches in progress at once (`rate_concurrent_searches`): a `429` names the one used up in `allowance`, and every answer gives the client's standing in `RateLimit-Policy` and `RateLimit`.
- Ask `explain=true` only when you read the path; it makes answers much larger.
- Keep `/api/v1/vocabulary`, `/organisms` and `/version` between runs (they change only with the server's graphs and versions), and record the graph beside the results you publish: every answer of one graph carries `Idtrack-Graph-Digest` (the graph's `content_digest`) and `Idtrack-Version`. Every `GET` of the api has an `ETag`: send it back as `If-None-Match` and an unchanged answer is `304`, without a search.
- Any page may call the api from a browser (CORS: `Access-Control-Allow-Origin: *`, the headers above exposed, `Timing-Allow-Origin: *`); no key, no cookie.
- Every answer carries `X-Request-ID` (send your own, 1 to 64 letters, digits and `._:-`, to have it used; quote it when reporting an `internal_error`) and `Server-Timing`: `app;dur=` the server's whole time until its answer started, containing `queue;dur=` (waiting for a worker and its search thread), `search;dur=` (the search) and `write;dur=` (writing the answer) where it searched, in milliseconds.
- Take an answer as it comes: a client that reads nothing of an answer for `send_seconds`, or reads it more slowly than `send_min_bytes_per_second` after that, has its connection closed.

A client that follows these rules (Python, with `requests`):

```python
import time, requests

BASE = "{BASE}/api/v1"
RETRYABLE = {e["code"] for e in requests.get(BASE + "/vocabulary", timeout=60).json()["errors"] if e["retryable"]}

def call(method, path, **kwargs):
    for attempt in range(8):
        answer = requests.request(method, BASE + path, timeout=60, **kwargs)
        if answer.status_code < 400:
            return answer.json()
        error = answer.json()["error"]
        if error["code"] not in RETRYABLE:
            raise RuntimeError(f"{error['code']}: {error['message']} (request {error['request_id']})")
        time.sleep((error["retry_after"] or 1) * 2 ** min(attempt, 4))
    raise RuntimeError(f"{path}: still refused after 8 attempts")

def convert_all(organism, identifiers, **arguments):
    size = call("GET", "/limits")["batch_max"]
    results = []
    for start in range(0, len(identifiers), size):
        # Every item read alone (as GET .../convert reads it), so no answer depends on where the list is cut.
        body = {"identifiers": identifiers[start:start + size], "read_copies": False, **arguments}
        results += call("POST", f"/organisms/{organism}/convert/batch", json=body)["results"]
    return results, call("GET", "/version")

results, version = convert_all("homo_sapiens", ["TP53", "BRCA1", "NOT_A_GENE"], final_database="HGNC Symbol")
for result in results:
    best = [c["target"] for c in result["candidates"] if c["best"]] if result["status"] in ("converted", "tie") else []
    print(result["query_id"], result["status"], result["match"], best)
```
"""


def _bounds(document: dict[str, Any]) -> list[str]:
    schema = document["components"]["schemas"]["LimitsResponse"]
    return [f"- `{name}`: {_summary_line(prop.get('description', ''))}" for name, prop in schema["properties"].items()]


def _example_section() -> list[str]:
    examples = _examples().get("operations", {})
    lines: list[str] = ["## Examples", "", "Real answers of this api over the human graph of Ensembl 115."]
    for op, title in (("convert", "One identifier"), ("convert_batch", "A batch")):
        sample = examples.get(op)
        if sample is None:
            continue
        query = urlencode(
            {k: v for k, v in sample.get("parameters", {}).items() if k != "organism"},
            quote_via=quote,  # every space as %20, which a request line holds as written
        )
        method = "POST" if op == "convert_batch" else "GET"
        path = "/api/v1/organisms/homo_sapiens/" + ("convert/batch" if op == "convert_batch" else "convert")
        lines += ["", f"### {title}", "", "```", f"{method} {path}{'?' + query if query else ''}"]
        if "body" in sample:
            lines += ["Content-Type: application/json", "", json.dumps(sample["body"])]
        lines += ["```", "", "Answer (`200`):", "", "```json"]
        lines.append(json.dumps(sample["responses"]["application/json"], ensure_ascii=False))
        lines += ["```"]
    return lines


def llms_full_txt(base: str, document: dict[str, Any], held: list[dict[str, Any]] | None = None) -> str:
    """Return ``/llms-full.txt``: every rule and example of the api as one Markdown text.

    Args:
        base: The site's address.
        document: The OpenAPI document.
        held: The organisms this server holds (:py:func:`held_line`).

    Returns:
        str: The text.
    """
    lines = [
        "# idtrack web api: the rules and examples",
        "",
        "> " + _summary_line(document["info"]["description"]),
        "",
        (
            f"The api is under `{base}/api/v1`; the paths below are relative to it (`GET /api/v1 (the index)` is that "
            "address itself). `{organism}` is an organism's Ensembl production name (`homo_sapiens`) or a short name "
            f"idtrack knows (`human`); this server holds: {held_line(held or [])}. The OpenAPI document "
            "(`/api/v1/openapi.json`) holds the same, with every field of every answer."
        ),
        "",
        "## Endpoints",
        "",
        *endpoint_lines(document),
        "",
        _READING,
        "## Errors",
        "",
        (
            'Every answer that is not a success is `{"error": {"code", "message", "argument", "allowed", '
            '"details", "request_id", "retry_after", "allowance"}}`. The codes:'
        ),
        "",
        *error_lines(),
        "",
        "## Bounds",
        "",
        "`GET /api/v1/limits` gives this server's own:",
        "",
        *_bounds(document),
        "",
        _RULES.replace("{BASE}", base or "https://<this server>"),
        *_example_section(),
        "",
    ]
    return "\n".join(lines)


def readme_tables(document: dict[str, Any]) -> dict[str, str]:
    """Return README.md's generated parts, by marker name.

    Args:
        document: The OpenAPI document.

    Returns:
        dict[str, str]: ``endpoints`` and ``errors``, each a Markdown table.
    """
    endpoints = ["| Method and path | What it answers |", "| --- | --- |"]
    for method, path, operation in _endpoints(document):
        params = [p["name"] for p in operation.get("parameters", []) if p["in"] == "query"]
        shown = _short(path) + (f"?{'&'.join(p + '=' for p in params)}" if params else "")
        endpoints.append(f"| `{method} {shown}` | {operation.get('summary', '')} |")
    return {"endpoints": "\n".join(endpoints), "errors": "\n".join(error_lines())}


_MARKER = re.compile(r"(<!-- generated: (\w+) -->\n)(.*?)(<!-- /generated -->)", re.DOTALL)


def update_readme(path: Path, document: dict[str, Any]) -> str:
    """Return README.md with its generated parts written from the document.

    Args:
        path: README.md.
        document: The OpenAPI document.

    Returns:
        str: The text (unchanged where it is current).
    """
    parts = readme_tables(document)
    text = path.read_text(encoding="utf-8")
    return _MARKER.sub(lambda m: m.group(1) + parts[m.group(2)] + "\n" + m.group(4), text)


__all__ = ["endpoint_lines", "error_lines", "llms_full_txt", "llms_txt", "readme_tables", "update_readme"]
