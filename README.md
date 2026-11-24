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
| `deploy/` | The container file, the compose file with Caddy for the Hetzner node, the systemd alternative, the publishing command's wrapper |
| `scripts/` | Development helpers: the endpoint check against a running server, the builder of the tests' small graph |
| `.github/workflows/` | CI: lint, type check and tests of the api (`api.yml`) and of the frontend, with its end-to-end tests against the api (`web.yml`) |

The api and the frontend share nothing but `api/openapi.json`, which the api generates and a test keeps equal to what it serves.

## The api

Every endpoint is under `/api/v1`; the interactive documentation is at `/api/v1/docs`, the document at `/api/v1/openapi.json`. An organism is named by its Ensembl production name (`sus_scrofa`) or a short name idtrack knows (`pig`).

| Method and path | What it answers |
| --- | --- |
| `GET /health` | `{"status": "ok", "organisms": [...]}` once the graphs are loaded (never rate limited) |
| `GET /version` | The api's and idtrack's versions, idtrack's commit, the graph format, the manifest read, and per graph its file (key, SHA-256, size), content digest and build record |
| `GET /vocabulary` | What the codes of the answers mean: idtrack's own tables (`STATUSES`, `REASONS`, `STEP_REASONS`, `CRITERIA`, `MATCH_STEPS`, `MATCH_PREFIXES`, `READING_REASONS`, `PLACE_RELATIONS`, `BRIDGE_RULES`, the texts of the `Candidate` fields, a criterion's meaning being idtrack's text of the field it compares), the api's own words where idtrack gives none (the statuses' meanings, the fields each criterion compares; marked by `source`, and tested against idtrack's codes), and the api's error codes below; the frontend reads every meaning from here |
| `GET /limits` | The bounds this server enforces, as configured (batch size, identifier length, body and answer sizes, time and search budgets, rate) |
| `GET /organisms` | Every loaded organism and what its graph holds (idtrack's `API.describe()`) |
| `GET /organisms/{organism}` | One organism's description: releases, assemblies and the releases each serves, databases, the build |
| `GET /organisms/{organism}/final-databases?to_release=` | The databases a conversion to that release can end in |
| `GET /organisms/{organism}/convert?identifier=&from_release=&to_release=&final_database=&from_database=&explain=&allow_bridges=` | One identifier converted (idtrack's `API.convert`): every candidate ranked, the best marked, the deciding criterion, the reason of a result without answer, and with `explain=true` the path as a graph of nodes and steps |
| `POST /organisms/{organism}/convert/batch?format=json\|tsv` | A batch (`{"identifiers": [...], ...the same arguments}`): one result per identifier in input order, each with its own status, as idtrack's `API.convert_many` answers the whole batch (an item that extends another by a numbered suffix, `INS-1` beside `INS`, can be answered as its copy); `format=tsv` gives a table with one row per candidate |
| `GET /organisms/{organism}/genes-named?name=&fold_case=` | The genes a name of an external database names, per database and release (`API.genes_named`) |
| `GET /organisms/{organism}/names-of?gene=&release=` | The names external databases give a gene, per database and release (`API.names_of`) |

**Results are idtrack's own.** A result is the `to_dict()` of idtrack's result object, written as JSON as it is: no field renamed, no number rounded (a float is written as the shortest text that reads back as the same double, which JavaScript's `JSON.parse` also reads exactly), no value reformatted. idtrack never puts NaN or infinity in a result; a result that held one would be refused (a `500`), never sent. The response schemas in `api/openapi.json` are made from idtrack's result classes and their documentation, so they say what each field means.

**Every input is checked on the server**: by the api before idtrack is called (types, strictly: `"115"` is not a release in a JSON body; lengths; control characters; unknown or repeated query parameters; the organism among those loaded), and by idtrack against the loaded graph (releases, databases at the release, identifiers), whose refusal is answered with idtrack's own message, the argument and the accepted values. One difference from idtrack is deliberate: an identifier or name holding control, surrogate, private-use or unassigned characters is refused at the api, the input boundary, with `invalid_identifier` and a message naming their positions, where idtrack itself would remove the control characters and read the rest (its match prefix `unicode`); an empty string or a spelling of a missing value is idtrack's to answer, as it answers it. Every failure is `{"error": {"code", "message", "argument", "allowed", "details", "request_id"}}` with one of these codes:

| Code | Status | When |
| --- | --- | --- |
| `invalid_request` | 400 | The request does not have the shape the endpoint takes (`details` lists each problem). |
| `unknown_parameter` | 400 | A query parameter the endpoint does not take, or one given twice. |
| `invalid_identifier` | 400 | An identifier or name is too long for this server, or holds control, surrogate, private-use or unassigned characters. |
| `unknown_release` | 400 | A release the graph does not cover. |
| `unknown_database` | 400 | A database the graph does not hold at that release. |
| `unknown_identifier` | 400 | An identifier the call needs to exist in the graph does not (e.g. the gene of names-of). |
| `unknown_assembly` | 400 | An assembly the graph does not hold. |
| `inactive_at_release` | 400 | An Ensembl id at a release where it is not active. |
| `unknown_version` | 400 | An Ensembl id with a version the graph does not hold. |
| `missing_value` | 400 | A value that must be given is empty. |
| `argument_type` | 400 | An argument of the wrong type. |
| `invalid_argument` | 400 | An argument whose value is not accepted. |
| `invalid_input` | 400 | Another input idtrack does not accept. |
| `unknown_organism` | 404 | An organism this server does not hold. |
| `not_found` | 404 | No such endpoint or file. |
| `method_not_allowed` | 405 | The endpoint does not take this method. |
| `request_budget_exceeded` | 408 | The request needed more time than its budget; send fewer identifiers. |
| `payload_too_large` | 413 | The request body is larger than the server accepts. |
| `too_many_identifiers` | 413 | A batch with more identifiers than the server accepts. |
| `unsupported_media_type` | 415 | A request body that is not `application/json`. |
| `search_budget_exceeded` | 422 | One identifier's search needed more than its budget (states or seconds). |
| `response_too_large` | 422 | The answer is larger than the server sends; ask without `explain` or for fewer ids. |
| `rate_limited` | 429 | Too many requests from this client; wait for `Retry-After` seconds. |
| `internal_error` | 500 | A fault of the server; quote the request id when reporting it. |
| `server_busy` | 503 | The server has more waiting work than it accepts; retry after `Retry-After` seconds. |

idtrack's input errors map by class (`UnknownReleaseError` to `unknown_release`, ...); any other error is `internal_error`, whose traceback goes to the server's log with the request id, never to the client. An identifier that is not in the graph is not an error: it is a result with status `not_found` and its reason, as idtrack answers it. In a batch, one identifier's failure (its search over budget) is that item's `status: "error"` with its `error`, and the batch goes on.

**Bounds** (all set by environment variables, SETUP.md; `GET /limits` reports a server's own): a time budget per request (default 20 s) and per identifier's search (10 s, 200,000 states); at most 1,000 identifiers per batch, 256 characters per identifier, 1 MiB of request body and 32 MiB of answer (a larger answer is refused, never cut); 120 requests per minute per client with bursts of 30; at most 64 requests held per worker.

## The frontend

The page at `/` makes idtrack usable from a browser: convert one identifier (with every candidate ranked, the criterion that decided, and the path through the releases), convert a list (pasted or uploaded, exported as TSV or JSON exactly as the api returns them), look up names, read what each graph holds, and how to cite idtrack. Its centre is the path view: the identifier's journey drawn along Ensembl's releases over the genome assemblies that serve them, each step in the hue of its kind (a version change or replacement, a split or merge with its score, a crossing through an external database, an assembly handoff), the chosen answer strong and the alternatives the engine considered light, every element focusable with the exact values the api returned, and the same path in words beside it; on a phone it is a vertical timeline. Its visual direction and how the path view encodes each step: [web/DESIGN.md](web/DESIGN.md); install, tests and end-to-end tests: [SETUP.md](SETUP.md), section 13.

What the page shows is the api's answer unchanged: identifiers, releases and scores as sent (a float written back as Python wrote it), shortened only by cutting digits in the drawing, with the full value on focus; the answer as sent is one click away. Unit tests check on recorded real answers of the pig and human graphs that the drawn path is the api's path step for step; end-to-end tests run every flow in Chromium at 1440 and 390 px in both themes, with axe-core on every state.

## How it runs

- **Processes, not threads.** A search is CPU-bound and holds the interpreter lock; idtrack measured that threads add no throughput. The server is gunicorn with uvicorn's worker: the master verifies and loads every graph once, then forks the workers, which start with the graphs in memory (shared page by page until written to; idtrack's later memory-mapped graph format will keep them shared). Each worker runs one search at a time on a thread beside its event loop, so it keeps answering health checks and refusals during a search.
- **One module calls idtrack:** `api/idtrack_web_api/adapter.py` holds every call into idtrack and every name of it the api uses (arguments, result classes, errors, version); the api applies none of idtrack's rules itself (which releases, databases and identifiers a graph accepts is idtrack's answer, refused with idtrack's own message under a stable code). A change of idtrack's interface is a change of that module and its tests.
- **The rate limit is the server's, not a worker's:** a token bucket per client in shared memory made before the fork.
- **Data.** Graph files are published (`idtrack-web publish`) as immutable objects named by their content, `idtrack/<graph format>/<organism>/<sha256>.npz`, beside a manifest `idtrack/<graph format>/manifest.json` that lists, per organism, the key, SHA-256 and size, the snapshot release, the content digest and the idtrack that built the graph (`data/manifest.schema.json`). The store is a Cloudflare R2 bucket (S3 api) or a folder with the same layout on the Hetzner node. At start the server reads the manifest, fetches what its cache lacks (to a temporary name, renamed only once verified), verifies the size and SHA-256 of every file, loads the graphs, checks that each is the graph the manifest names, and refuses to start on any mismatch. Configuration is by environment variables only; no credential is in the repository, the image or the log.

## License

BSD 3-Clause, as idtrack ([LICENSE](LICENSE)).
