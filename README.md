# idtrack-web

[![api](https://github.com/theislab/idtrack-web/actions/workflows/api.yml/badge.svg?branch=main)](https://github.com/theislab/idtrack-web/actions/workflows/api.yml) [![web](https://github.com/theislab/idtrack-web/actions/workflows/web.yml/badge.svg?branch=main)](https://github.com/theislab/idtrack-web/actions/workflows/web.yml) [![version](https://img.shields.io/github/v/tag/theislab/idtrack-web?label=version&sort=semver)](https://github.com/theislab/idtrack-web/tags) [![idtrack on PyPI](https://img.shields.io/pypi/v/idtrack.svg?label=idtrack)](https://pypi.org/project/idtrack/) [![idtrack's documentation](https://img.shields.io/readthedocs/idtrack/stable.svg?label=idtrack%20docs)](https://idtrack.readthedocs.io/en/stable/) [![license](https://img.shields.io/github/license/theislab/idtrack-web)](LICENSE)

The web application of [idtrack](https://github.com/theislab/idtrack): convert gene identifiers through Ensembl releases, genome assemblies and external databases from a browser or over HTTP, without installing idtrack or building its graphs.

idtrack is the library and holds no web code; this project depends on it as a package and carries its version: idtrack, this repository and idtrack's benchmarks ([idtrack-reproducibility](https://github.com/theislab/idtrack-reproducibility)) have one version number, each release tags all three `v<version>`, and the api of a version is locked to idtrack's tag of that version. What idtrack does, how it answers and what it does not do: its [documentation](https://idtrack.readthedocs.io/en/stable/). Setting the project up, configuring, testing, running and deploying it: [SETUP.md](SETUP.md).

## Layout

| Path | What |
| --- | --- |
| `api/` | The HTTP api, a Python package `idtrack_web_api` (FastAPI), its tests `api/tests/`, its environment (`api/pyproject.toml`, `api/uv.lock`) and its OpenAPI document `api/openapi.json` |
| `web/` | The frontend (TypeScript, React, Vite), its unit tests `web/tests/` and end-to-end tests `web/e2e/`; built against `api/openapi.json` only |
| `data/` | The schema of the data manifest (`manifest.schema.json`) and an example (`manifest.example.json`); never graph files |
| `deploy/` | The container file, the compose file with Caddy, the settings of the Helmholtz virtual machine (`deploy/vm/`: compose overrides, the Caddy files for each way to a certificate, updates, reboots, the journal's bounds, the weekly check), the systemd alternative, the publishing command's wrapper and the store's pruning |
| `scripts/` | Development helpers: `check.sh` (every check of the api and the frontend, in one run and one table: `scripts/check.sh`), the endpoint check against a running server, the builder of the tests' small graph |
| `.github/workflows/` | CI: lint, type check and tests of the api (`api.yml`) and of the frontend, with its end-to-end tests against the api (`web.yml`) |

The api and the frontend share nothing but `api/openapi.json`, which the api generates and a test keeps equal to what it serves.

## The api

Every endpoint is under `/api/v1`, keyless and read-only, callable from any page (CORS). An organism is its Ensembl production name (`homo_sapiens`) or a short name idtrack declares (`human`); the api converts within one organism, never between species.

| Where | What it holds |
| --- | --- |
| `GET /api/v1` | Every endpoint by method, path and summary (about 3 KB): the entry point for a program |
| `/llms.txt`, `/llms-full.txt` | The same for language models: the index, then every rule and example as one Markdown text |
| `/api/v1/openapi.json` | Every endpoint, parameter and field with its meaning, the closed sets of codes as enumerations, each endpoint's error codes, the headers, a recorded answer of each, the batch table's columns |
| `/developers` | The reference for people, with a console per endpoint |

### A first request

The symbol `AGPAT9` as a list of release 80 wrote it, in HGNC symbols of release 115 (the graph's last):

```console
$ curl -s 'https://<server>/api/v1/organisms/human/convert?identifier=AGPAT9&from_release=80&final_database=HGNC%20Symbol'
{"query_id":"AGPAT9","graph_id":"AGPAT9","match":"exact",...,"from_release":80,"from_release_inferred":false,...,
 "to_release":115,"final_database":"HGNC Symbol","candidates":[{"gene":"ENSG00000138678.12","target":"GPAT3",...,"best":true,...}],
 ...,"status":"converted",...}
```

Without `from_release` the same symbol is read at 115, where it is a synonym of two genes: `"status":"tie"`, the best answers `GPAT3` and `LPCAT1`. Which release an identifier is read at is idtrack's rule (the OpenAPI document and `/llms-full.txt` state it); for a whole list, `POST .../source-inference` answers the release it fits best as `from_release`.

### Endpoints

<!-- generated: endpoints -->
| Method and path | What it answers |
| --- | --- |
| `GET /api/v1 (the index)` | Where everything is: the api's documents and every endpoint |
| `GET /health` | The server is up and holds its graphs (no allowance taken) |
| `GET /status` | The server's load: CPU, memory and requests of every worker and the master |
| `GET /version` | The versions of the api, idtrack and every loaded graph |
| `GET /vocabulary` | What the codes of the answers mean: idtrack's own tables, the api's where idtrack has none |
| `GET /limits` | The bounds this server enforces, as configured |
| `GET /organisms` | Every loaded organism and what its graph holds |
| `GET /organisms/{organism}` | What one organism's graph holds: releases, assemblies, databases, its build |
| `GET /organisms/{organism}/final-databases?to_release=` | The databases a conversion to a release can end in |
| `GET /organisms/{organism}/databases` | What a conversion to each release can end in: a release-by-database matrix, and each assembly's |
| `GET /organisms/{organism}/showcase` | Chosen conversions of one graph, answered once when the server started: the home page's figures |
| `GET /organisms/{organism}/showcase/queries` | The showcase's chosen conversions without their answers: each query, and each case's kind |
| `GET /organisms/{organism}/history` | Ensembl's gene id history in the graph: genes active per release, history edges per transition |
| `GET /organisms/{organism}/lineages?limit=` | The lineages of gene ids in the graph: active releases, new versions, edges to other ids |
| `GET /organisms/{organism}/convert?identifier=&from_release=&to_release=&final_database=&from_database=&explain=&allow_bridges=` | Convert one identifier: every candidate ranked, the best marked, optionally its path |
| `GET /organisms/{organism}/convert/each-database?identifier=&from_release=&to_release=&from_database=&allow_bridges=` | Convert one identifier into every database a conversion to the target release can end in |
| `POST /organisms/{organism}/convert/batch?format=&provenance=` | Convert a batch with the same arguments; results in input order, each with its own status |
| `POST /organisms/{organism}/source-inference` | Where a list of identifiers comes from: the releases, assemblies or databases it fits |
| `GET /organisms/{organism}/genes-named?name=&fold_case=&release=` | The genes a name of an external database names, per database and release |
| `GET /organisms/{organism}/names-of?gene=&release=` | The names external databases give a gene, per database and release |
<!-- /generated -->

### What an answer is

- **A result is idtrack's own record**: the `to_dict()` of idtrack's result object written as JSON as it is, no field renamed, no number rounded (a float as the shortest text that reads back as the same double, which JavaScript's `JSON.parse` reads exactly), no value reformatted; idtrack never puts NaN or infinity in a result, and one that held either would be refused, never sent. The response schemas are made from idtrack's result classes and their documentation, so each field says what it means.
- **The api adds only what idtrack's record cannot say:** each result's `cautions`, the api's reading of its evidence by rules stated in `api/idtrack_web_api/cautions.py` and served in `cautions` of `/vocabulary` (a bridge, a gene ranked below that carries the name typed, a gene outside the reference sequence, a bare number read in an old numbering, a synonym, another meaning at other releases, ...: each with its tone, `caution` or `note`, a label and a sentence with the result's values, the section of idtrack's limitations it falls under, and where one answers its doubt, the conversion to ask: the one source of these classes), read from the result with its path whether or not `explain` asks for it (every search is made with its path: measured with idtrack over 1,000 identifiers of the human graph on a shared, busy machine, 1.4 to 2.4 times the search time of the same batch without it, a cost of the rule that every answer is read whole, charged to the client's seconds of search like any other); `error.code` of a batch item whose conversion failed (the stable code the same identifier alone would be answered with); and around the results of a batch, a name lookup, a conversion into every database and a source inference, the organism and the arguments as the server read them (`organism`, `arguments`); a source inference also names its best origin's parts (`best`) and the release to send as `from_release`.
- **Meanings come from one place:** `GET /vocabulary` serves idtrack's own tables of every code an answer carries (statuses, reasons, step reasons, criteria, match steps and prefixes, reading reasons, place relations, bridge rules, the fields of a candidate) and, marked as the api's (`source`), the words idtrack has no table for: what each status means and whether it answers in the database asked (`answers_requested_database`), the error codes, the allowances, the kinds of database, the modes of a source inference.
- **What each database holds** (`GET /organisms/{organism}/databases`, from the graph's own record): its `kind` (`ensembl`, one of idtrack's two gene namespaces, `versioned` or not; `accession`; `label`, symbols and other names), whether it is a name authority's, the database of an accession database's labels (NCBI's gene numbers are `EntrezGene`, their official symbols `NCBI gene (formerly Entrezgene)`), and the names Ensembl gave it before.
- **Answers computed once, at start** (before the workers are forked): `/organisms/{organism}/showcase`, conversions chosen to show the kinds of journey and phenomena of Ensembl's history (`api/idtrack_web_api/showcase_data/`), each answered with `explain=true` as `/convert` answers it and given only for the graph it was checked on (`/organisms/{organism}/showcase/queries` lists the same conversions without their answers, for a page that only needs to know which are cases); and `/organisms/{organism}/history`, Ensembl's gene id history counted per release and per pair of releases from idtrack's public graph interface: plain facts (versions active, ids created, edges by kind, the fan of Ensembl's mapping), never idtrack's reading of a step as a split or a merge.
- **A batch as a table** (`?format=tsv`): one row per candidate, its columns and how each value is written in the OpenAPI document (`x-columns`, each column with its group: result, error or candidate). The file is named after the organism, the target release and the graph's digest; `provenance=true` adds a first line, beginning with `#`, that names the versions, the graph's digest, the arguments and the request.

### Errors

Every failure is `{"error": {"code", "message", "argument", "allowed", "details", "request_id", "retry_after", "allowance"}}`: a stable `code` to branch on, a message in plain words that says what to change, the argument at fault and the values it takes where they can be listed. The codes (written from `api/idtrack_web_api/errors.py` by `idtrack-web docs`; `/vocabulary` serves the same table with a short title per code):

<!-- generated: errors -->
| Code | Status | Retry | When |
| --- | --- | --- | --- |
| `invalid_request` | 400 | no: change the request | The request does not have the shape the endpoint takes: a missing or malformed parameter, a body that is not UTF-8 JSON of the documented shape (`details` lists each problem, `argument` names the parameter when one is at fault). |
| `unknown_parameter` | 400 | no: change the request | A query parameter the endpoint does not take, or one given more than once. |
| `invalid_identifier` | 400 | no: change the request | An identifier or name is longer than this server accepts, or holds control, surrogate, private-use or unassigned characters (in a batch: the whole batch is refused, and `details` gives every such item's index). |
| `unknown_release` | 400 | no: change the request | A release the graph does not cover (`allowed` lists the graph's releases). |
| `unknown_database` | 400 | no: change the request | A database the graph does not hold at that release (`allowed` lists those it holds). |
| `unknown_identifier` | 400 | no: change the request | An identifier the call needs to exist in the graph does not (the gene of names-of). |
| `missing_value` | 400 | no: change the request | An identifier is empty or a spelling of a missing value (idtrack's refusal), or a name to look up is empty. |
| `invalid_argument` | 400 | no: change the request | An argument whose value is not accepted (an empty or over-long database name). |
| `invalid_input` | 400 | no: change the request | Another input idtrack refuses (idtrack's message says which). |
| `unknown_organism` | 404 | no: change the request | An organism this server does not hold (`allowed` lists those it holds). |
| `not_found` | 404 | no: change the request | No such endpoint or file. |
| `method_not_allowed` | 405 | no: change the request | The endpoint does not take this method (the `Allow` header and `allowed` list the methods it takes). |
| `request_timeout` | 408 | yes (after `Retry-After` where it is sent) | The request's head or body did not arrive within the time the server waits for it, or its client closed the connection before its search (which is then not run); send it again. |
| `payload_too_large` | 413 | no: change the request | The request body is larger than the server accepts. |
| `too_many_identifiers` | 413 | no: change the request | A batch with more identifiers than the server accepts (`batch_max` of /limits). |
| `uri_too_long` | 414 | no: change the request | The request's path and query are longer than the server accepts. |
| `unsupported_media_type` | 415 | no: change the request | A request body that is not `application/json` in UTF-8, or that is sent compressed (`Content-Encoding`). |
| `search_budget_exceeded` | 422 | no: change the request | One identifier's search needed more than its budget (states or seconds); the same request fails again. |
| `response_too_large` | 422 | no: change the request | The answer is larger than the server sends (`response_max_bytes` of /limits); it is refused, never cut. |
| `rate_limited` | 429 | yes (after `Retry-After` where it is sent) | This client sent more requests, or used more search time, than its allowance; wait the `Retry-After` header's seconds. |
| `internal_error` | 500 | yes (after `Retry-After` where it is sent) | A fault of the server; quote the request id when reporting it. |
| `server_busy` | 503 | yes (after `Retry-After` where it is sent) | The server has more waiting work than it accepts: its queue of searches is full, the search would wait (or waited) longer for a worker than `queue_seconds` of /limits, or the server is stopping; the request was not searched. Retry after the `Retry-After` header's seconds, unchanged. |
| `request_budget_exceeded` | 503 | yes (after `Retry-After` where it is sent) | The request's search needed more time than its budget (`request_seconds` of /limits, counted from when its search began); send fewer identifiers per request (a batch's message says how many it converted). |
<!-- /generated -->

idtrack's refusals of an input map by class (`UnknownReleaseError` to `unknown_release`, ...) and keep idtrack's message; a refusal the api's own checks make unreachable would be `invalid_input`; any other error is `internal_error`, its traceback in the server's log with the request id, never in the answer. An identifier that is not in the graph is not an error: it is a result with status `not_found`, as idtrack answers it, and an unknown version is the status `unknown_version`. In a batch, one identifier's failure is that item's `status: "error"` with its `error.code`, and the batch goes on.

### Checked at the boundary

- **By the api, before idtrack is called:** a path and query over 16 KiB is `414`; unknown or repeated query parameters are refused in time linear in the query; a query's values must be UTF-8 once percent-decoded; a release is a whole number from 0 to 999,999,999 (digits in the query, a JSON integer in a body), whether the graph covers it being idtrack's to answer; a boolean is `true` or `false`; a body is UTF-8 JSON, uncompressed (`415` for a `Content-Encoding`), read strictly (no key twice, no NaN, no number of more than 4,300 digits, nesting bounded, unknown keys refused before the rest is read, at most 20 problems listed and the rest counted); an empty name to look up is `missing_value`.
- **By idtrack, against the loaded graph** (releases, databases at a release, identifiers): its refusal is answered with its own message, the argument and the accepted values (`allowed`).
- **One difference from idtrack is deliberate:** an identifier holding control, surrogate, private-use or unassigned characters *inside it* is refused with `invalid_identifier` and their positions (in a batch, the whole batch, every such index in `details`), where idtrack would remove them and read the rest. White space at its ends is no part of an identifier: idtrack reads it without, and `query_id` keeps the string as sent.
- Malformed input is a 4xx naming the argument at fault, never a `500`, and in the api's own words; a request the HTTP parser cannot read is answered in the same JSON. A path of the api that ends in `/` is redirected (`308`) to the same path without it, its percent-encoding kept; any other path that is no endpoint is a JSON `404` that names `GET /api/v1`.

### How a search is served

- **A search waits only for a worker free of searches** ("How it runs"). It is admitted by its client's allowances when a worker routes its connection, then kept by that worker if it holds no search, or else handed to a queue the workers share. A search counts in its worker from the moment its whole request has arrived: a body still on its way holds no worker's search, so a client that sends it slowly delays only itself.
- **The wait for a worker is bounded on its own** (`queue_seconds`, 10 s): a search whose wait, estimated from the searches queued before it and the recent searches' mean time, would pass it is refused at once, and one that waited that long anyway is refused without being searched, both `503 server_busy` with `Retry-After`, the client's token given back.
- **The time budget of a request runs from when its search begins** (`request_seconds`, 20 s; 10 s and 200,000 states per identifier's search): a batch out of time is `503 request_budget_exceeded` with the count it converted and `argument` `identifiers`: fewer identifiers per request is the one change that helps (a search reads the path whatever `explain` asks, so dropping `explain` shortens no search).
- **An answer is never cut:** one over 32 MiB is refused as soon as its writing passes the bound, with advice that fits the request and the argument to change first (`explain`, whose paths are most of an answer, else `identifiers`). It is sent in pieces of 64 KiB, each once the connection has room: a client that takes none of it for `send_seconds` (30 s), or takes it more slowly than 64 KiB a second after that, has its connection closed, and a worker holds at most 256 MiB of answers not yet taken (`503 server_busy` beyond).
- **A graceful stop answers every search it took:** on `SIGTERM` the searches running finish, and the searches still in the queue are answered `503 server_busy` with `Retry-After: 5` (by each worker as it stops, and by the master as it exits), so a client retries against the restarted server instead of losing its request.
- A request whose client closes its connection while it waits is not searched, and a batch stops between its groups.

### Each client's allowances

A client is its address (an IPv6 address by its `/64`), as the trusted proxy reports it (`api/idtrack_web_api/limits.py`). Kept in shared memory made before the fork, they hold for the server as a whole; `IDTRACK_WEB_RATE_PER_MINUTE=0` turns them all off, and `/limits` names them (`allowance_fields`) and says whether they apply (`allowances_enforced`).

| Allowance | Default | What it bounds |
| --- | --- | --- |
| searches | 120 a minute, 30 at once (`rate_per_minute`, `rate_burst`) | Searching requests: a token bucket |
| reads | 10 times the searches' (`read_share`) | Every other request of the api (tables, documents, an answer sent again from memory, a `304`); `/health` takes none |
| search seconds | 30 s a minute, a balance of 60 s (`rate_search_seconds`, `rate_search_burst_seconds`) | The time a client's searches took, with the writing of their answers, charged when the answer is written: a stream of large batches is bounded by its work, not its count |
| searches at once | 2 (`rate_concurrent_searches`) | Searching requests in progress, from admission to the end of their answer: each holds a place in a shared ledger that names the worker holding it, so a worker killed in a search gives its clients' places back when the master learns of its end |

A burst from one address is refused at once with `429 rate_limited`, never queued ahead of other clients' searches; the refusal names the allowance used up (`allowance`), says its terms and the wait (`Retry-After`, `retry_after`), and every answer gives the client's standing in `RateLimit-Policy` and `RateLimit` (the IETF draft's fields). A refusal for the server's own capacity (`503 server_busy`) costs the client no token. Many people behind one address (a course, a campus network) share these allowances: SETUP.md, section 6, says how to raise them.

### What every answer says about itself

| Header | What |
| --- | --- |
| `X-Request-ID` | The request's id: the client's own where it sent one of 1 to 64 letters, digits and `._:-`, else one made by the server; also `error.request_id` and in the log line |
| `Server-Timing` | The server's time on the request, in milliseconds, readable by any origin: `app` the whole time until the answer started; for a request that searched, `queue` (waiting for a worker and its search thread), `search` and `write` (writing and compressing its answer); `cache;desc="hit"` (sent again from memory) or `"revalidated"` (a `304`). The meanings are one text, `x-metrics` of the header in the OpenAPI document |
| `Idtrack-Version`, `Idtrack-Graph-Digest` | On every answer of one graph: the idtrack that answered and the graph's content digest, so a stored answer stays tied to its graph without a second request |
| `ETag`, `Cache-Control` | On every `GET` but `/health` and `/status`: `public, max-age=600`, and `If-None-Match` naming the tag is answered `304` at once, without a search |
| `RateLimit-Policy`, `RateLimit` | Where the allowances apply: each allowance as a policy, and the client's standing in the one the request drew on |

Repeated requests are cheap: each worker keeps the answers it sent (up to 64 MiB, `IDTRACK_WEB_ANSWER_CACHE_BYTES`) with their compressed bytes, and sends one again without a search or a second compression. An answer of 1 KiB or more goes compressed with gzip to a client that accepts it (decoded, its bytes are the endpoint's exactly; its `ETag` then ends in `-gzip`). The graph-wide tables idtrack computes lazily on a conversion's path are computed in the master before the fork, so every worker shares them.

### The server's load

`GET /status` reports the whole server, every worker and the master, from a table in shared memory that every worker writes and any worker reads (cached for a second, so polling costs a few milliseconds a second at most; requests to `/status` are counted apart).

- **CPU** of a process: its CPU time over the wall time between two samples (every second; `1.0` is one core kept busy, exact to about 0.01 core); the server's share divides the sum by the cores it may use (its affinity set, or a cgroup v2 `cpu.max` quota where that allows fewer).
- **Memory** of a process every 5 seconds, from the kernel's `smaps_rollup`: RSS (which counts the graphs, shared with the master, in every process), PSS (shared pages divided among the processes sharing them: summed, the server's real footprint) and USS (what the process alone holds); the limit is the smallest cgroup v2 `memory.max` of its cgroup and its ancestors, else the machine's memory.
- **Latency**: nearest-rank p50, p95, p99 and maximum of the most recent 1,000 requests that ended in the last 5 minutes, from the moment a worker took the connection to the last byte sent.
- **Waiting work, in three counts that never hold the same request twice:** connections in the kernel's listen queue no worker has taken yet (`connections_waiting`), searches in the queue the workers share (`searches_queued`), and searches a worker holds that wait for its own search thread (`searches_waiting`).
- **The recent past** (`history`): every 10 seconds one worker (whichever claims it first) writes the server's totals (cores used, PSS, all the work waiting) into a ring of shared memory that keeps the last 90 (15 minutes), whether or not anyone asks; the answer carries them oldest first, so a reader sees the last minutes at once rather than from its first request.
- **Workers that ended**: counted by the master (`workers_exited`, `last_worker_exit_at`), their counts kept in the totals, the requests a killed worker held counted as lost.

Nothing that identifies the machine is in the answer (no host name, path, user, environment, command line or process id); a value that cannot be measured is `null` and named in `unavailable`.

## The frontend

The page at `/` makes idtrack usable from a browser: convert one identifier (with every candidate ranked, the criterion that decided, and the path through the releases), convert a list (pasted or uploaded, exported as TSV or JSON exactly as the api returns them), look up names, read what each graph holds, read the http api's reference with examples that run and a console for every endpoint (`/developers`, with `/llms.txt` for language models), watch the server's load (a quiet reading in the header, every process in its panel), and how to cite idtrack. Its centre is the path view: the identifier's journey drawn along Ensembl's releases over the genome assemblies that serve them, each step in the hue of its kind (a version change or replacement, a split or merge with its score, a crossing through an external database, an assembly handoff), the chosen answer strong and the alternatives the engine considered light, every element focusable with the exact values the api returned, and the same path in words beside it; on a phone it is a vertical timeline. Its visual direction and how the path view encodes each step: [web/DESIGN.md](web/DESIGN.md); install, tests and end-to-end tests: [SETUP.md](SETUP.md), section 14.

What the page shows is the api's answer unchanged: identifiers, releases and scores as sent (a float written back as Python wrote it), shortened only by cutting digits in the drawing, with the full value on focus; the answer as sent is one click away. Unit tests check on recorded real answers of the pig and human graphs that the drawn path is the api's path step for step; end-to-end tests run every flow in Chromium at 1440 and 390 px in both themes, with axe-core on every state.

### Accessibility

The page aims at WCAG 2.2 level AA in both themes. What is checked, and how: every end-to-end flow runs axe-core on every state it reaches (the rules of WCAG 2.0, 2.1 and 2.2, A and AA, and axe's best practices; a violation of any impact fails the run, but a rule accepted with its reason in `web/e2e/helpers.ts`, of which there is none), at 1440 and 390 px in the light and the dark theme; the path view, the tables and the consoles are driven by keyboard alone; focus is checked in forced colours; every page is checked at 320, 768, 1024 and 2560 px for text cut by its box or a page that scrolls sideways (SETUP.md, 14.6); the page's own rules (one focus ring, colour never the only carrier of a meaning, no motion under `prefers-reduced-motion`) are in [web/DESIGN.md](web/DESIGN.md). A barrier found on the site is a bug: report it at [github.com/theislab/idtrack-web/issues](https://github.com/theislab/idtrack-web/issues), with the page's address and what you used to reach it.

## How it runs

- **Where it runs.** First on a Helmholtz virtual machine (Ubuntu 26.04 LTS, 8 vCPU, 16 GB, 50 GB of disk, security updates with a weekly reboot, reached from outside by https only): Docker Engine runs the image and Caddy with `deploy/compose.yaml` and the overrides of `deploy/vm/`, the graphs in a folder store on the machine's disk (SETUP.md, section 10). The Hetzner node (section 11) and the setup without containers, under systemd (section 12), are the alternatives.
- **Processes, not threads.** A search is CPU-bound and holds the interpreter lock; idtrack measured that threads add no throughput. The server is gunicorn with uvicorn's worker: the master verifies and loads every graph once, then forks the workers, which start with the graphs in memory, shared page by page. Each worker runs one search at a time on a thread beside its event loop, so it keeps answering the requests it holds (health checks, refusals) during a search.
- **Every worker takes every connection; a search goes to a worker free of searches** (`api/idtrack_web_api/server.py`). A worker reads the first bytes of each connection it takes without consuming them and routes it by method and path. A request that does not search (a health check, `/status`, a table answered from memory, a file of the page, a refusal) is answered at once by the worker that took it. A search is admitted by its client's allowances, then kept by that worker if it holds no search, or handed on, its request unread, through a queue the workers share (a pair of Unix sockets made before the fork, the connection passed as a file descriptor) to the first worker free of searches, in the order the searches arrived. A search counts in its worker from the moment its whole request has arrived until its answer is written; every answer closes its connection, so each request is routed afresh. A connection that sends no request head within 5 s is closed and holds no worker meanwhile. The price: a connection per request (Caddy opens one to the api per request, while a browser keeps its own to Caddy), and a worker's answers to reads are slower beside its own search, which holds the interpreter lock most of the time. The tests hold the server to it: health checks under half a second while both workers are in long searches and more wait; a search answered when the first worker frees, never behind a longer one; bodies sent a byte a second delaying no one else's search; a stop answering every queued search.
- **One module calls idtrack:** `api/idtrack_web_api/adapter.py` holds every call into idtrack and every name of it the api uses; the api applies none of idtrack's rules itself (which releases, databases and identifiers a graph accepts is idtrack's answer). A change of idtrack's interface is a change of that module and its tests.
- **What the workers share is made before the fork:** the clients' token buckets, balances of search time and ledger of searches in progress, the queue of searches and its count, the mean time of recent searches, and the table of the load (`/status`).
- **The page as sent.** With `IDTRACK_WEB_STATIC_DIR` the server sends the built frontend itself: text files compressed with gzip once at start, or sent in the Brotli form the build wrote beside a file (`<file>.br`, 10 to 15 % smaller) where the browser accepts Brotli; the files named by their content's hash (`/assets/`) cached as immutable, every other file revalidated (`no-cache`, `ETag`, `304`). The page carries the answers every view asks first (`/organisms`, `/version`, `/vocabulary`, `/limits`, each as the api sends it), so its first paint waits for no request of the api, and with the frame of the page its address names (the build's `frames.json`: the masthead and the page's head as HTML in the page's root, and in its head the links that fetch that page's own code beside the entry), so the page's head is drawn before any of its code has run. A path that is no route of the page, or the page of an organism the server does not hold, is answered with the page and `404`; only the build's own files are sent (no hidden file, nothing outside its folder). Every answer carries a strict Content-Security-Policy (the page's admits its own files, its inline scripts by their hashes, and no string into the DOM's script sinks; the api's admits nothing) and the other security headers; the access log escapes every value from the client, one request to a line.
- **Data.** Graph files are published (`idtrack-web publish`) as immutable objects named by their content, `idtrack/<graph format>/<organism>/<sha256>.npz`, beside a manifest that lists each organism's file, SHA-256, size, snapshot release, content digest and the idtrack that built it (`data/manifest.schema.json`). The store is a Cloudflare R2 bucket or a folder with the same layout. At start the server verifies every file's size and SHA-256, loads the graphs, checks each is the graph the manifest names, and refuses to start on any mismatch. Configuration is by environment variables only; no credential is in the repository, the image or the log.

## License

BSD 3-Clause, as idtrack ([LICENSE](LICENSE)).
