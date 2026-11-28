# ruff: noqa: E501 - the Markdown texts are written one paragraph per line (Markdown is never hard-wrapped)
"""The API's texts, written from one source: the OpenAPI document and the API's tables.

- ``/llms.txt`` (:py:func:`llms_txt`): the index for language models, as the llms.txt convention asks (an H1, a
  quotation that says what the API is, a short orientation, then H2 sections that are lists of links, with absolute
  addresses, to resources that read as text);
- ``/llms-full.txt`` (:py:func:`llms_full_txt`): every rule of the API as one Markdown text: the endpoints with each
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

from idtrack_web_api import limitations
from idtrack_web_api.cautions import CAUTIONS
from idtrack_web_api.contract import ENDPOINT_ERRORS, _examples, index
from idtrack_web_api.errors import CODES, RETRYABLE, retry_words
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


def _named(method: str, path: str) -> str:
    """Return an endpoint as the texts write it: its method and whole path as code, the index named outside it."""
    return f"`{method} {path}`" + (" (the index)" if path == "/api/v1" else "")


def _answer_fields(operation: dict[str, Any], document: dict[str, Any]) -> list[str]:
    """Return the top-level fields of an operation's ``200`` JSON answer, as its schema names them (none: [])."""
    content = (operation.get("responses", {}).get("200", {}).get("content") or {}).get("application/json") or {}
    ref = _REF.search(json.dumps(content.get("schema", {})))
    if ref is None:
        return []
    return list(document["components"]["schemas"].get(ref.group(1), {}).get("properties", {}))


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
    listing = json.dumps(index(document, page=True), ensure_ascii=False, separators=(",", ":"))
    organism, example = _example_of(held or [])
    query = urlencode(example, quote_via=quote)
    lines = [
        "# IDTrack web API",
        "",
        "> " + _summary_line(document["info"]["description"]),
        "",
        f"This server holds: {held_line(held or [])}. One organism at a time: there is no mapping between species.",
        "",
        (
            f"The API is under `{base}/api/v1`: JSON in, JSON out (a batch also as TSV); keyless and read-only, callable "
            'from any page (CORS); every failure is `{"error": {"code", ...}}` with a stable `code`, and a client '
            "keeps within its allowances where the server sets them (`allowances_enforced` of `GET /api/v1/limits`). "
            f"Start with `GET {base}/api/v1` (every endpoint, {_kilobytes(listing)}) and `llms-full.txt` (the rules, "
            f"{_kilobytes(full)}); the OpenAPI document ({_kilobytes(openapi)}) has every field of every answer."
        ),
        "",
        (
            f"One identifier: `GET {base}/api/v1/organisms/{organism}/convert?{query}`. A list from a paper or a "
            "dataset, in three steps:"
        ),
        "",
        (
            f'1. `POST {base}/api/v1/organisms/{organism}/source-inference` with `{{"identifiers": [...]}}`, unless '
            "the release of the list's annotation is known. Use its `from_release` only where `inference.margin` is "
            "not `null` and the band (`inference.band`, the origins the list cannot tell apart from the best) is "
            "narrow; where the band holds every release (`margin` `null`) the list does not date itself: convert it "
            "without `from_release` (each identifier read at its own release), and keep the band beside the results."
        ),
        (
            f'2. `POST {base}/api/v1/organisms/{organism}/convert/batch` with `{{"identifiers": [...], '
            '"from_release": <that release, or none>, "read_copies": false}`, at most `batch_max` per request '
            "(`read_copies` `false` reads every item alone, so that no answer depends on where the list is cut; "
            "`true`, the default, reads a name with `-1`, `.1` or `_1` appended as the copy of another item of the "
            "same batch)."
        ),
        (
            '3. Per result, the answer is the `target` of the candidates with `"best": true`, and only where `status` '
            "is `converted` or `tie`; review every answer whose `cautions` hold an item of `tone` `caution` (each names "
            "its class and the limitation of IDTrack it falls under), and keep the `Idtrack-Graph-Digest` header with the "
            "results."
        ),
        "",
        "## Docs",
        "",
        (
            f"- [The API's rules and examples]({base}/llms-full.txt): every endpoint and parameter, how to read an answer, "
            f"every error code, bounds, a client that follows the rules, real examples (Markdown, {_kilobytes(full)})"
        ),
        (
            f"- [OpenAPI document]({base}/api/v1/openapi.json): every endpoint, parameter, field, enumeration, error code "
            f"and example (JSON, {_kilobytes(openapi)})"
        ),
        f"- [Vocabulary]({base}/api/v1/vocabulary): the meaning of every code an answer carries (JSON)",
        f"- [Bounds]({base}/api/v1/limits): this server's limits and each client's allowances (JSON)",
        f"- [Organisms]({base}/api/v1/organisms): the graphs this server holds, their releases and databases (JSON)",
        f"- [Versions]({base}/api/v1/version): the API, IDTrack and every graph's digest, to quote with results (JSON)",
        "",
        "## Optional",
        "",
        (
            f"- [The API page]({base}/developers): the reference for people, with a console per endpoint (needs "
            "JavaScript)"
        ),
        (
            "- [IDTrack's documentation](https://idtrack.readthedocs.io/en/stable/): how IDTrack answers, and its known "
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
        lines.append(f"- {_named(method, path)}: {_summary_line(operation.get('description', ''))}")
        lines += _parameters(operation, document)
        fields = _answer_fields(operation, document)
        if fields:
            lines.append("  - answers (`200`): an object of " + ", ".join(f"`{f}`" for f in fields))
        codes = ENDPOINT_ERRORS.get(operation["operationId"], ())
        if codes:
            lines.append("  - error codes: " + ", ".join(f"`{c}` ({CODES[c][0]})" for c in codes))
    return lines


def error_lines() -> list[str]:
    """Return the error codes as a Markdown table: code, status, how to retry (``errors.RETRY``), when.

    Returns:
        list[str]: The lines.
    """
    lines = ["| Code | Status | Retry | When |", "| --- | --- | --- | --- |"]
    for code, (status, text) in CODES.items():
        retry = f"{'yes' if code in RETRYABLE else 'no'}: {retry_words(code)}"
        lines.append(f"| `{code}` | {status} | {retry} | {text} |")
    return lines


def _example_of(held: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    """Return the organism of the texts' examples and one identifier's query in it, drawn from what the server holds.

    The organism is the human graph where the server holds it, else the first it holds; the query is the first of
    its showcase's journeys (``example`` of the organism held), without its releases.
    """
    chosen = next((o for o in held if o["organism"] == "homo_sapiens"), held[0] if held else None)
    if chosen is None:
        return "homo_sapiens", {"identifier": "TP53"}
    shown = chosen.get("example") or {}
    query: dict[str, Any] = {"identifier": shown.get("identifier") or "TP53"}
    if shown.get("final_database"):
        query["final_database"] = shown["final_database"]
    return str(chosen["organism"]), query


def _signs() -> str:
    """The limitations a caution says (each linked once), and those whose answers carry no sign of their own."""
    said = list(dict.fromkeys(anchor for _, _, anchor in CAUTIONS.values() if anchor is not None))
    silent = [anchor for anchor in limitations.SECTIONS if anchor not in said]
    return (
        "- **A converted answer can still be the wrong gene where IDTrack documents a limitation**, and the answer "
        "often carries its sign: treat an answer with a caution as one to review, and read the limitation it names. "
        "The cautions say these: "
        + "; ".join(limitations.link(a) for a in said)
        + ". These the answer cannot show, so read them before relying on answers of their kind: "
        + "; ".join(limitations.link(a) for a in silent)
        + f". Every limitation: [IDTrack's limitations]({limitations.EVERY})."
    )


_READING_TEXT = """## Reading an answer

- A conversion's `status` is one of `converted`, `tie`, `no_target`, `not_found`, `unknown_version`, `no_conversion`, `error` (meanings: `statuses` of `GET /api/v1/vocabulary`, where `answers_requested_database` says which answer in the database asked). An identifier that is not in the graph is not an error: it is a result with status `not_found` and its `reason`.
- **The release an identifier is read at.** With `from_release`, it is read at that release (where the graph does not hold it there, at another release: `reasons` holds `read_at_another_release`, `from_release_fallback` is `true`, and `from_release_given` keeps the one sent). {FROM_RELEASE_RULE} `from_release_inferred` is `true` whenever the release read was chosen by the engine: no release was given, or the one given was replaced.
- **Only `converted` and `tie` answer in the requested database.** Read the answer from `candidates`: each candidate with `"best": true` holds an answer in `target` (a `tie` has several). For `no_target`, `final_database` becomes `ensembl_gene` and the best candidates are the genes reached, standing in for the missing id: check `status` (or `final_database`) before reading `target`. `unknown_version` answers no gene (the versions that exist are in `known_versions`); `no_conversion` has none (`reasons` says why).
- **How the string was read** is in `match` (a step after its prefixes, each followed by `:`; meanings: `match_steps`, `match_prefixes` of the vocabulary). A `match` that holds `synonym:` was read as a synonym; `copy:` (a batch only) as the copy of another item; `version_newer_than_graph` means an Ensembl version newer than any the graph holds was read as the latest version (its `reasons` may be empty: check `match`). `other_readings`, when not empty, lists what the same string means elsewhere (another release, another gene). `from_databases` (and a candidate's `entry_databases`) names the databases that read the string; it is empty for a versioned Ensembl gene id, which is read as the gene itself.
- **A `from_database` the identifier is not an id of** answers as if the string were absent from that database (`no_conversion` with `no_gene_at_start`, or `not_found`), not as a retired id: send it without `from_database` to read it in every database. Some databases come in two forms, a database of accessions and one of their labels (`RefSeq_peptide` and `RefSeq peptide`; `kind` and `labels` of `GET /api/v1/organisms/{organism}/databases` say which is which).
- **The strength of the evidence** is in each candidate's ranking record (meanings: `candidate_fields`): `bridges` above 0 means the answer crossed between genes through an id two genes carried, which is IDTrack's inference, not Ensembl's history; with `explain=true`, a step's `places` of `places_apart` means Ensembl's history moved the gene to another place, and a node's `non_reference` that the gene lies outside the reference sequence (a haplotype, a patch). `score` is the product of Ensembl's mapping scores along the history of the path (1.0 without a scored event), as sent: one of the criteria that rank the candidates (`criteria` of the vocabulary), in their order. `decided_by` names the criterion that separated the best answer from the runner-up.
- **Every result carries `cautions`**: the API's reading of its evidence by stated rules (`cautions` of the vocabulary: each code's meaning, whether it reads the path, and the section of IDTrack's limitations it falls under), the same with or without `explain`. An item of `tone` `caution` makes the answer one to review before relying on it (a bridge, a gene that lies outside the reference sequence, a bare number read in an old numbering, a synonym, another meaning at other releases, ...); a `note` is an exact fact that is no fault. A pipeline that keeps `converted` and `tie` should keep the cautions beside each answer (the table's `cautions` column holds their codes) rather than trust the status alone.
{SIGNS}
- **A batch's answer depends on the batch** while `read_copies` is `true` (the default): an item that is another item of the same batch with `-1`, `.1` or `_1` appended, and is itself no exact name, is answered as that item's copy (`match` begins with `copy:`). Keep such names in one batch, or send `"read_copies": false` to convert every item alone, as `GET .../convert` does.
- **What the graph does not hold answers nothing** ({DATABASES_NOT_HELD}): the name authorities' own ids (HGNC, MGI and VGNC ids such as `HGNC:11998`), UniProt's secondary accessions, entry names and isoforms (`Q9Y6K9-2`), RNAcentral, and microarray probe sets (Affymetrix, Illumina and Agilent probes such as `201746_at`, which Ensembl maps but the graphs do not select): each is `not_found`; map them elsewhere, or ask by the symbol, the primary accession or the Ensembl id. The databases a graph holds: `external_databases` of `GET /api/v1/organisms/{organism}`; the values `final_database` takes at a release: `GET .../final-databases?to_release=`. Database names are matched as IDTrack matches them; send them as these lists write them. What each holds: `kind` of `GET /api/v1/organisms/{organism}/databases` (`ensembl`: an Ensembl gene id, `versioned` or not; `accession`; `label`: symbols and other names). For NCBI Gene ids ask `EntrezGene`; `NCBI gene (formerly Entrezgene)` holds NCBI's official symbols (its `labels_of` is `EntrezGene`).
- One organism at a time: IDTrack converts within the organism's own graph; it does not map between species.
"""
_READING = (
    _READING_TEXT.replace("{FROM_RELEASE_RULE}", FROM_RELEASE_RULE)
    .replace("{SIGNS}", _signs())
    .replace("{DATABASES_NOT_HELD}", limitations.link("databases-the-graph-does-not-hold"))
)

_RULES = """## How to use it from a program

- Send `Accept: application/json`; send a body as `Content-Type: application/json` in UTF-8, typed strictly (a release is a number, never `"115"`); a query's release is digits only, a query's boolean `true` or `false`. A query parameter an endpoint does not take, or one given twice, is refused with `unknown_parameter`.
- Branch on `error.code`, which is stable; `message` is for people. `argument` names the parameter at fault, `allowed` lists the accepted values (releases, databases, organisms, parameters, methods), `details` each problem of a request of the wrong shape. A batch item with `status: "error"` carries `error.code` too.
- For many identifiers send `POST .../convert/batch` in pieces of at most `batch_max` (`GET /api/v1/limits`) rather than one request each. One item's failure is that item's `error`; an identifier the API refuses at its boundary (over `identifier_max_length` characters, control characters inside it) refuses the whole batch (`400 invalid_identifier`, every such index in `details`): remove or correct it and send the batch again. White space at the ends of an identifier (a space, a tab, a line break) is no part of it: it is read without, and `query_id` keeps it as sent. `format=tsv` answers a table: its columns are listed in the OpenAPI document (`x-columns` and the description of the `200` answer's `text/tab-separated-values`), one row per candidate, `error_code` the stable code of an item's error.
- For a list from a paper or an old table whose release is not known, ask `POST .../source-inference` with the list first, and read its answer as IDTrack documents it: `inference.band` holds the origins the list cannot tell apart from the best one, and `inference.margin` how far the best stands above the first origin outside the band (`null`: none lies outside). Send the best release as `from_release` only where `margin` is not `null` and the band is narrow; where the band holds every release the list does not date itself: convert without `from_release` (each identifier read at its own release), and keep the band with the results. For one identifier in every database at a release, `GET .../convert/each-database`.
- Retry exactly the codes whose `retryable` is `true` in the vocabulary's `errors` (`request_timeout` 408, `rate_limited` 429, `internal_error` 500, `server_busy` and `request_budget_exceeded` 503), as each one's `retry` says: wait the `Retry-After` header's seconds (also `retry_after` of the error) where it is sent (`retry_after` of the vocabulary's entry is `true`), then send again, waiting longer each time it repeats; a `request_budget_exceeded` refused again is sent in smaller pieces (its `progress` says how far it went). Every other code answers the same request the same way until it is changed. A searching request refused for what it holds (a `4xx` other than `408`, `422` and `429`) is charged as a read, not as a search. A client's allowances (when `allowances_enforced` of `GET /api/v1/limits` is `true`) count its searching requests (`rate_per_minute`, `rate_burst`), its other requests (`read_share` times as many), the seconds its searches took (`rate_search_seconds` per minute) and its searches in progress at once (`rate_concurrent_searches`): a `429` names the one used up in `allowance`, and every answer gives the client's standing in `RateLimit-Policy` and `RateLimit`.
- Ask `explain=true` only when you read the path; it makes answers much larger.
- Keep `/api/v1/vocabulary`, `/organisms` and `/version` between runs (they change only with the server's graphs and versions), and record the graph beside the results you publish: every answer of one graph carries `Idtrack-Graph-Digest` (the graph's `content_digest`) and `Idtrack-Version`. Every `GET` of the API has an `ETag`: send it back as `If-None-Match` and an unchanged answer is `304`, without a search.
- Any page may call the API from a browser (CORS: `Access-Control-Allow-Origin: *`, the headers above exposed, `Timing-Allow-Origin: *`); no key, no cookie.
- Every answer carries `X-Request-ID` (send your own, 1 to 64 letters, digits and `._:-`, to have it used; quote it when reporting an `internal_error`) and `Server-Timing`: `app;dur=` the server's whole time until its answer started, containing `queue;dur=` (waiting for a worker and its search thread), `search;dur=` (the search) and `write;dur=` (writing the answer) where it searched, in milliseconds.
- Take an answer as it comes: a client that reads nothing of an answer for `send_seconds`, or reads it more slowly than `send_min_bytes_per_second` after that, has its connection closed.

A client that follows these rules (Python, with `requests`):

```python
import time, requests

BASE = "{BASE}/api/v1"
RETRYABLE = {e["code"] for e in requests.get(BASE + "/vocabulary", timeout=60).json()["errors"] if e["retryable"]}

class Smaller(Exception):
    pass  # the request needed more time than one request may take, twice: send it in smaller pieces

def call(method, path, **kwargs):
    for attempt in range(8):
        answer = requests.request(method, BASE + path, timeout=60, **kwargs)
        if answer.status_code < 400:
            return answer.json()
        error = answer.json()["error"]
        if error["code"] not in RETRYABLE:
            raise RuntimeError(f"{error['code']}: {error['message']} (request {error['request_id']})")
        if error["code"] == "request_budget_exceeded" and attempt:
            raise Smaller(error["progress"])
        time.sleep((error["retry_after"] or 1) * 2 ** min(attempt, 4))
    raise RuntimeError(f"{path}: still refused after 8 attempts")

def convert_list(organism, identifiers, arguments):
    # Every item read alone (as GET .../convert reads it), so no answer depends on where the list is cut.
    body = {"identifiers": identifiers, "read_copies": False, **arguments}
    try:
        return call("POST", f"/organisms/{organism}/convert/batch", json=body)["results"]
    except Smaller:
        if len(identifiers) == 1:
            raise
        half = len(identifiers) // 2
        return convert_list(organism, identifiers[:half], arguments) + convert_list(organism, identifiers[half:], arguments)

def convert_all(organism, identifiers, **arguments):
    size = call("GET", "/limits")["batch_max"]
    results = []
    for start in range(0, len(identifiers), size):
        results += convert_list(organism, identifiers[start:start + size], arguments)
    return results, call("GET", "/version")

results, version = convert_all("{ORGANISM}", {IDENTIFIERS}{ARGUMENTS})
for result in results:
    best = [c["target"] for c in result["candidates"] if c["best"]] if result["status"] in ("converted", "tie") else []
    print(result["query_id"], result["status"], result["match"], best)
```
"""


def _rules(base: str, held: list[dict[str, Any]]) -> str:
    """Return the rules for programs, the client's example drawn from an organism the server holds."""
    organism, example = _example_of(held)
    arguments = "".join(f", {k}={json.dumps(v)}" for k, v in example.items() if k != "identifier")
    return (
        _RULES.replace("{BASE}", base or "https://<this server>")
        .replace("{ORGANISM}", organism)
        .replace("{IDENTIFIERS}", json.dumps([example["identifier"], "NOT_A_GENE"]))
        .replace("{ARGUMENTS}", arguments)
    )


def _bounds(document: dict[str, Any]) -> list[str]:
    schema = document["components"]["schemas"]["LimitsResponse"]
    return [f"- `{name}`: {_summary_line(prop.get('description', ''))}" for name, prop in schema["properties"].items()]


#: The operations whose recorded answers the text shows, with their titles (the paths are the document's).
_SHOWN = (
    ("convert", "One identifier"),
    ("convert_batch", "A batch"),
    ("source_inference", "Where a list comes from"),
    ("convert_each_database", "One identifier in every database"),
    ("genes_named", "The genes a name names"),
    ("names_of", "The names of a gene"),
)
#: The most items of each list of a recorded answer the text shows (the document holds the answer as recorded).
_SHOWN_ITEMS = 2


def _shortened(value: Any) -> Any:
    """Return a recorded answer with each list cut to its first items (the items left out are counted)."""
    if isinstance(value, dict):
        return {k: _shortened(v) for k, v in value.items()}
    if isinstance(value, list):
        kept = [_shortened(v) for v in value[:_SHOWN_ITEMS]]
        return [*kept, f"... {len(value) - _SHOWN_ITEMS} more"] if len(value) > _SHOWN_ITEMS else kept
    return value


def _example_section(document: dict[str, Any]) -> list[str]:
    examples = _examples().get("operations", {})
    paths = {op["operationId"]: (m.upper(), p) for p, ops in document["paths"].items() for m, op in ops.items()}
    lines: list[str] = [
        "## Examples",
        "",
        (
            "Real answers of this API over the graphs of Ensembl 115, as the OpenAPI document holds them (its "
            f"`x-recorded` says how they were recorded); here each list of the last four is cut to its first "
            f"{_SHOWN_ITEMS} items."
        ),
    ]
    for op, title in _SHOWN:
        sample = examples.get(op)
        if sample is None or op not in paths:
            continue
        method, template = paths[op]
        given = dict(sample.get("parameters", {}))
        path = template
        for name in re.findall(r"{(\w+)}", template):
            path = path.replace(f"{{{name}}}", quote(str(given.pop(name, name)), safe=""))
        query = urlencode(given, quote_via=quote)  # every space as %20, which a request line holds as written
        lines += ["", f"### {title}", "", "```", f"{method} {path}{'?' + query if query else ''}"]
        if "body" in sample:
            lines += ["Content-Type: application/json", "", json.dumps(sample["body"])]
        answer = sample["responses"]["application/json"]
        shown = answer if op in {"convert", "convert_batch"} else _shortened(answer)
        lines += ["```", "", "Answer (`200`):", "", "```json", json.dumps(shown, ensure_ascii=False), "```"]
    return lines


def llms_full_txt(base: str, document: dict[str, Any], held: list[dict[str, Any]] | None = None) -> str:
    """Return ``/llms-full.txt``: every rule and example of the API as one Markdown text.

    Args:
        base: The site's address.
        document: The OpenAPI document.
        held: The organisms this server holds (:py:func:`held_line`).

    Returns:
        str: The text.
    """
    lines = [
        "# IDTrack web API: the rules and examples",
        "",
        "> " + _summary_line(document["info"]["description"]),
        "",
        (
            f"The API is under `{base}/api/v1`, and every path below is written whole (`GET /api/v1`, the index, is "
            "that address itself; `.../convert` abbreviates `/api/v1/organisms/{organism}/convert`). `{organism}` is "
            "an organism's Ensembl production name (`homo_sapiens`) or a short name IDTrack knows (`human`); this "
            f"server holds: {held_line(held or [])}. The OpenAPI document (`/api/v1/openapi.json`) holds the same, "
            "with every field of every answer."
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
        _rules(base, held or []),
        *_example_section(document),
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
        shown = path + (f"?{'&'.join(p + '=' for p in params)}" if params else "")
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
