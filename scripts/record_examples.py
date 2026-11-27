"""Record the OpenAPI document's examples: real answers of running servers over the five graphs of Ensembl 115.

    uv run --no-sync python ../scripts/record_examples.py http://127.0.0.1:8000 idtrack_web_api/examples.json \
        --bounded http://127.0.0.1:8001

Every example is an answer a server sent, unchanged, for the request recorded beside it (``parameters``, ``body``);
an answer too long to read in a document is trimmed to its first items, and says so (``recorded``). One error example
per error code: refusals of the first server (its rate limit off: ``IDTRACK_WEB_RATE_PER_MINUTE=0``), and of a
second server with small bounds (:py:data:`BOUNDED`, ``--bounded``) the refusals of its bounds; the two refusals no
request can make on purpose (a fault of the server, a full queue of searches) are written by the api's own code, and
say so. Then regenerate the document (``idtrack-web openapi``). The tests check every example against its schema, and
with the real human graph that the examples of conversions are still the answers (``tests/test_real.py``).
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HUMAN = "homo_sapiens"
#: The tests' small pig graph (for the one refusal answered by the api's own code over a graph).
CUT_GRAPH = Path(__file__).resolve().parents[1] / "api" / "tests" / "data" / "graph_sus_scrofa_cut.npz"
#: The requests whose answers are the examples, by operationId: (path, query, body).
OPERATIONS: dict[str, tuple[str, dict[str, str], Any]] = {
    "index": ("/api/v1", {}, None),
    "health": ("/api/v1/health", {}, None),
    "status": ("/api/v1/status", {}, None),
    "version": ("/api/v1/version", {}, None),
    "limits": ("/api/v1/limits", {}, None),
    "list_organisms": ("/api/v1/organisms", {}, None),
    "describe_organism": (f"/api/v1/organisms/{HUMAN}", {}, None),
    "final_databases": (f"/api/v1/organisms/{HUMAN}/final-databases", {"to_release": "100"}, None),
    "history": (f"/api/v1/organisms/{HUMAN}/history", {}, None),
    "vocabulary": ("/api/v1/vocabulary", {}, None),
    "databases_by_release": (f"/api/v1/organisms/{HUMAN}/databases", {}, None),
    "showcase": (f"/api/v1/organisms/{HUMAN}/showcase", {}, None),
    "convert_each_database": (
        f"/api/v1/organisms/{HUMAN}/convert/each-database",
        {"identifier": "TP53", "to_release": "115"},
        None,
    ),
    "source_inference": (
        f"/api/v1/organisms/{HUMAN}/source-inference",
        {},
        {"identifiers": ["TP53", "BRCA1", "AGPAT9", "C1orf112", "HIST1H2BC", "FAM46A", "KIAA0100"], "mode": "release"},
    ),
    "convert": (
        f"/api/v1/organisms/{HUMAN}/convert",
        {"identifier": "ENSG00000141510", "from_release": "100", "final_database": "HGNC Symbol"},
        None,
    ),
    "convert_batch": (
        f"/api/v1/organisms/{HUMAN}/convert/batch",
        {},
        {"identifiers": ["TP53", "ENSG00000139618", "NOT_A_GENE"]},
    ),
    "genes_named": (f"/api/v1/organisms/{HUMAN}/genes-named", {"name": "NOV"}, None),
    "names_of": (f"/api/v1/organisms/{HUMAN}/names-of", {"gene": "ENSG00000141510.20", "release": "115"}, None),
}
#: Long answers, trimmed to their first items in the document: the operation, the list (by its path of keys) and how
#: many items stay.
TRIMMED: dict[str, list[tuple[tuple[str, ...], int]]] = {
    "list_organisms": [(("organisms",), 1), (("names",), 1)],
    "databases_by_release": [(("databases",), 4)],
    "showcase": [(("journeys",), 1), (("cases",), 1)],
    "convert_each_database": [(("conversions",), 2)],
    "history": [(("transitions",), 6)],
    "vocabulary": [
        ((table,), 2)
        for table in (
            "statuses",
            "reasons",
            "step_reasons",
            "criteria",
            "candidate_fields",
            "match_steps",
            "match_prefixes",
            "reading_reasons",
            "place_relations",
            "bridge_rules",
            "errors",
            "database_kinds",
            "allowances",
            "source_modes",
            "cautions",
        )
    ],
}
#: The settings of the second server, whose bounds are small enough to be met on purpose.
BOUNDED = "IDTRACK_WEB_RATE_PER_MINUTE=60 IDTRACK_WEB_RATE_BURST=30 IDTRACK_WEB_BODY_SECONDS=1"
#: Requests that the server refuses, one per error code: (method, path, query, body, headers).
ERRORS: dict[str, tuple[str, str, dict[str, str], Any, dict[str, str]]] = {
    "invalid_request": (
        "GET",
        f"/api/v1/organisms/{HUMAN}/convert",
        {"identifier": "TP53", "to_release": "115.0"},
        None,
        {},
    ),
    "unknown_parameter": (
        "GET",
        f"/api/v1/organisms/{HUMAN}/convert",
        {"identifier": "TP53", "to_releas": "115"},
        None,
        {},
    ),
    "invalid_identifier": ("GET", f"/api/v1/organisms/{HUMAN}/convert", {"identifier": "TP\x0753"}, None, {}),
    "unknown_release": (
        "GET",
        f"/api/v1/organisms/{HUMAN}/convert",
        {"identifier": "TP53", "to_release": "999"},
        None,
        {},
    ),
    "unknown_database": (
        "GET",
        f"/api/v1/organisms/{HUMAN}/convert",
        {"identifier": "TP53", "final_database": "HGNC"},
        None,
        {},
    ),
    "unknown_identifier": ("GET", f"/api/v1/organisms/{HUMAN}/names-of", {"gene": "ENSG00000000000.1"}, None, {}),
    "missing_value": ("GET", f"/api/v1/organisms/{HUMAN}/convert", {"identifier": "NA"}, None, {}),
    "invalid_argument": (
        "GET",
        f"/api/v1/organisms/{HUMAN}/convert",
        {"identifier": "TP53", "final_database": " "},
        None,
        {},
    ),
    "unknown_organism": ("GET", "/api/v1/organisms/cow", {}, None, {}),
    "method_not_allowed": ("GET", f"/api/v1/organisms/{HUMAN}/convert/batch", {}, None, {}),
    "too_many_identifiers": (
        "POST",
        f"/api/v1/organisms/{HUMAN}/convert/batch",
        {},
        {"identifiers": ["TP53"] * 1001},
        {},
    ),
    "unsupported_media_type": (
        "POST",
        f"/api/v1/organisms/{HUMAN}/convert/batch",
        {},
        None,
        {"Content-Type": "text/plain"},
    ),
    "uri_too_long": ("GET", f"/api/v1/organisms/{HUMAN}/convert", {"identifier": "A" * 17000}, None, {}),
    "not_found": ("GET", "/api/v1/organism", {}, None, {}),
    # A batch of six identifiers, each repeated (every item is answered), with paths: over 32 MiB.
    "response_too_large": (
        "POST",
        f"/api/v1/organisms/{HUMAN}/convert/batch",
        {},
        {
            "identifiers": ["BRCA1", "ENSG00000141510.5", "ENST00000346315.2", "INS", "NOT_A_GENE", "TP53"] * 166,
            "explain": True,
            "from_release": 60,
            "final_database": "RefSeq_mRNA",
        },
        {},
    ),
}
#: Requests the second server (:py:data:`BOUNDED`) refuses for its bounds, in this order (the rate limit last).
BOUNDED_ERRORS: dict[str, tuple[str, str, dict[str, str], Any, dict[str, str]]] = {}


def call(base: str, method: str, path: str, query: dict[str, str], body: Any, headers: dict[str, str]) -> Any:
    """Send one request; return its answer's JSON, whatever its status."""
    url = base + path + ("?" + urllib.parse.urlencode(query) if query else "")
    data = None
    sent = {"Accept": "application/json", **headers}
    if body is not None:
        data = json.dumps(body).encode()
        sent.setdefault("Content-Type", "application/json")
    elif method == "POST":
        data = b'{"identifiers": ["TP53"]}'
    request = urllib.request.Request(url, data=data, method=method, headers=sent)  # noqa: S310 - the server given
    try:
        with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - the server's own URL
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        return json.loads(error.read())


def raw_post(base: str, length: int) -> Any:
    """Send the head of a batch whose body declares *length* bytes and sends one; return the answer.

    The second server waits one second for a body (``408``); any server refuses a declared body over its bound before
    reading it (``413``).
    """
    host, port = base.removeprefix("http://").rsplit(":", 1)
    with socket.create_connection((host, int(port))) as sock:
        sock.sendall(
            f"POST /api/v1/organisms/{HUMAN}/convert/batch HTTP/1.1\r\nHost: {host}\r\n"
            f"Content-Type: application/json\r\nContent-Length: {length}\r\n\r\n{{".encode()
        )
        sock.settimeout(30)
        data = b""
        while chunk := sock.recv(65536):
            data += chunk
    return json.loads(data.partition(b"\r\n\r\n")[2])


def constructed() -> dict[str, Any]:
    """The refusals no request makes on purpose, as the api's own code writes them (marked ``constructed``).

    A fault of the server and a full queue of searches cannot be asked for; a request over its time budget depends on
    the machine's speed, so it is written by the function that writes it, for a batch of 1,000 identifiers of which
    the first 640 were converted within the default budget; a search over its budget is answered by the api's own
    code over the tests' small pig graph loaded with a budget of one state (a server's budget is at least 1,000).
    """
    from idtrack_web_api import service
    from idtrack_web_api.adapter import ConversionArguments
    from idtrack_web_api.config import Settings
    from idtrack_web_api.data import default_manifest_key, prepare, store_of
    from idtrack_web_api.errors import ApiError, error_json
    from idtrack_web_api.graphs import load_graph, load_registry
    from idtrack_web_api.publish import DirectoryTarget, publish

    request_id = "0123456789abcdef0123456789abcdef"
    found = {
        "internal_error": ApiError(
            "internal_error",
            f"The server failed to answer this request; quote the request id {request_id} when reporting it.",
        ),
        "server_busy": ApiError(
            "server_busy",
            "Every worker is in a search and as many searches as the server queues already wait for one; retry in a "
            "few seconds.",
            headers={"Retry-After": "2"},
        ),
        "request_budget_exceeded": service.out_of_time(  # the function that writes it
            Settings(source="directory", directory=Path()), 640, 1000, explain=False
        ),
    }
    with tempfile.TemporaryDirectory() as folder:
        publish([CUT_GRAPH], DirectoryTarget(Path(folder)))
        settings = Settings(source="directory", directory=Path(folder))
        loaded = load_registry(prepare(store_of(settings), default_manifest_key(), ()), 1000, 10.0)
        held = next(iter(loaded.graphs.values()))
        cut = load_graph(held.path, held.entry, budget_states=1, budget_seconds=10.0)
        arguments = ConversionArguments(
            from_release=None,
            to_release=56,
            final_database=None,
            from_database=None,
            explain=False,
            allow_bridges=True,
        )
        try:
            service.convert_one(cut, "ENSSSCG00000040076.1", arguments, settings, time.monotonic() + 20)
        except ApiError as error:
            found["search_budget_exceeded"] = error
    return {
        code: {"constructed": "written by the api's own code: no request makes it on purpose", "answer": answer}
        for code, error in found.items()
        if (answer := json.loads(error_json(error, request_id)))
    }


def trimmed(op: str, answer: Any) -> tuple[Any, str | None]:
    """Return an answer trimmed for the document (:py:data:`TRIMMED`), and the note that says so."""
    if op not in TRIMMED:
        return answer, None
    data = json.loads(json.dumps(answer))
    notes = []
    for keys, keep in TRIMMED[op]:
        holder = data
        for key in keys[:-1]:
            holder = holder[key]
        total = len(holder[keys[-1]])
        if total > keep:
            holder[keys[-1]] = holder[keys[-1]][:keep]
            notes.append(f"`{'.'.join(keys)}` to its first {keep} of {total} items")
    return data, ("trimmed: " + ", ".join(notes)) if notes else None


def main(base: str, output: str, bounded: str | None = None) -> int:
    """Record every example; return the exit status."""
    operations: dict[str, Any] = {}
    note = "a real answer of a server holding the five graphs of Ensembl 115 (human, mouse, pig, rhesus, cynomolgus)"
    for op, (path, query, body) in OPERATIONS.items():
        answer, cut = trimmed(op, call(base, "POST" if body else "GET", path, query, body, {}))
        sample: dict[str, Any] = {"responses": {"application/json": answer}}
        sample["recorded"] = note + (f"; {cut}" if cut else "")
        parameters = {"organism": HUMAN} if "{organism}" not in path and HUMAN in path else {}
        sample["parameters"] = {**parameters, **query}
        if body is not None:
            sample["body"] = body
        operations[op] = sample
    path, query, body = OPERATIONS["convert_batch"]
    table = urllib.request.Request(  # noqa: S310 - the server given
        base + path + "?format=tsv",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(table, timeout=120) as response:  # noqa: S310 - the server given
        operations["convert_batch"]["responses"]["text/tab-separated-values"] = response.read().decode()
    errors: dict[str, Any] = {code: call(base, *request) for code, request in ERRORS.items()}
    errors["payload_too_large"] = raw_post(base, 2_000_000)
    if bounded is not None:
        errors["request_timeout"] = raw_post(bounded, 100)
        errors |= {code: call(bounded, *request) for code, request in BOUNDED_ERRORS.items()}
        for release in range(76, 116):  # the rate limit: 30 searches at once, then refused (distinct: none from memory)
            query = {"identifier": "TP53", "to_release": str(release)}
            answer = call(bounded, "GET", f"/api/v1/organisms/{HUMAN}/convert", query, None, {})
            if (answer.get("error") or {}).get("code") == "rate_limited":
                errors["rate_limited"] = answer
                break
            time.sleep(0.01)
    for code, answer in errors.items():
        if (answer.get("error") or {}).get("code") != code:
            msg = f"{code}: the server answered {answer}"
            raise SystemExit(msg)
    errors |= constructed()
    Path(output).write_text(
        json.dumps({"operations": operations, "errors": errors}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("server", help="The server with the five graphs, its rate limit off.")
    parser.add_argument("output", help="The examples' file (idtrack_web_api/examples.json).")
    parser.add_argument("--bounded", help="The second server, with the settings of BOUNDED.")
    arguments = parser.parse_args()
    sys.exit(main(arguments.server, arguments.output, arguments.bounded))
