# Setting up the IDTrack web app

This document takes a reader from nothing to a running, tested and deployed `idtrack-web`. Every command was run as written; the outputs shown are what it printed (paths shortened to `...`). Sections 1 to 13 set up the api, its data and its deployment; section 14 the frontend (`web/`), which the image carries.

Contents: 1 What a working setup is · 2 Prerequisites · 3 The IDTrack commit · 4 Install the api · 5 Test · 6 Configuration · 7 Data: graphs, the manifest, R2 and the node · 8 Run locally · 9 Sizing · 10 Deploy on a Helmholtz virtual machine (Ubuntu 26.04, 8 vCPU, 16 GB) · 11 Deploy on the Hetzner node · 12 Deploy without containers · 13 Troubleshooting · 14 The frontend

## 1. What a working setup is

From the repository, with the api's environment of section 4 and the frontend's of section 14:

```console
$ scripts/check.sh
...
Every check passed.
```

`scripts/check.sh` runs every check of the api (ruff format, ruff, mypy, pytest), of the repository's shell scripts (shellcheck) and of the frontend (`npm run check`, the name IDTrack in the pages and the documents among them), each whatever the ones before found, then prints one table of them all with what each counted (tests passed and skipped, files formatted, errors) and how long it took; its exit status is 1 when any failed. The counts are those of the tree checked, so this document quotes none (the tests of the real graphs are skipped unless `IDTRACK_WEB_TEST_GRAPHS` names them: section 5). A running server answers `GET /api/v1/health` with `{"status":"ok","organisms":[...]}` and serves the page at `/`.

## 2. Prerequisites

- Linux or macOS, `git`, `curl`.
- [uv](https://docs.astral.sh/uv/) 0.11.28 (it uses a Python 3.14 it finds, or installs one). Its installer puts `uv` in `~/.local/bin` and adds that folder to the shell's profile files (replacing a `uv` already there); `UV_INSTALL_DIR=<folder>` installs it elsewhere and `UV_NO_MODIFY_PATH=1` leaves the profiles alone (then put `<folder>` on the `PATH` yourself):

  ```console
  $ curl -LsSf https://astral.sh/uv/0.11.28/install.sh | sh
  $ curl -LsSf https://astral.sh/uv/0.11.28/install.sh | env UV_INSTALL_DIR=<folder> UV_NO_MODIFY_PATH=1 sh   # or: touch nothing else
  $ uv --version
  uv 0.11.28 (x86_64-unknown-linux-gnu)
  ```
- For the frontend: Node.js 24.22.3 with npm 11.19.1 (section 14.1).
- For images: podman 5 or Docker 27 with compose. On a server (the Helmholtz virtual machine, section 10; the Hetzner node, section 11): Docker Engine with the compose plugin.
- Network: HTTPS to `github.com` (IDTrack's source) and `raw.githubusercontent.com` (IDTrack's documented limitations, section 14.3), `pypi.org` and `files.pythonhosted.org` (packages), `registry.npmjs.org` (the frontend's packages), Playwright's download host (the browsers of the end-to-end tests), the R2 endpoint (graphs). A running server needs only its graph store.

## 3. The IDTrack commit

The api depends on IDTrack at one release of its GitHub repository, set in **one place**: the sources table of uv in `api/pyproject.toml`, which `api/uv.lock` records with its commit:

```toml
[tool.uv.sources]
idtrack = { git = "https://github.com/theislab/idtrack.git", tag = "v0.1.2" }
```

The api carries IDTrack's version: IDTrack, this repository and IDTrack's benchmark repository ([`idtrack-reproducibility`](https://github.com/theislab/idtrack-reproducibility)) carry one version number, and each release of IDTrack tags all three `v<version>`; version 0.1.2 of the api and the frontend (`api/pyproject.toml`, `web/package.json`) pins IDTrack's tag `v0.1.2`. The lock holds the commit the tag named when it was locked (`7f71b2606a61b7e46b99361406ad403ae21eb5b9` for `v0.1.2`), and `uv sync --locked` installs that commit, whatever the tag names later. To move the api to another IDTrack release (or to a commit: `rev = "<full commit hash>"` in place of `tag`):

```console
$ cd api
$ # edit `tag` of the idtrack line of [tool.uv.sources], and `version` here and in web/package.json for a release
$ uv lock
Resolved 99 packages in 7.51s
Updated idtrack v0.1.0 (b5d4fb41) -> v0.1.2 (7f71b260)
Updated idtrack-web-api v0.1.0 -> v0.1.2
$ uv sync --locked                                             # then section 5: every test must pass
$ uv run --no-sync idtrack-web openapi --output openapi.json   # if idtrack's results changed
$ cd ../web && npm run types                                    # the frontend's types from the new document (section 14.3)
$ npm run limitations                                           # idtrack's documented limitations at the documentation commit (14.3)
$ npm run idtrack-docs                                          # what the pages quote from its documentation at the new commit (14.3)
```

If IDTrack's graph file format changed (the tests then fail with IDTrack's `GraphMismatchError`), rebuild the tests' small graph first (`scripts/make_test_graph.py`, section 5). Then commit `api/pyproject.toml`, `api/uv.lock`, `api/openapi.json`, `web/src/api/schema.ts`, `web/src/api/shapes.ts` and `web/src/generated/limitations.json` and `web/src/generated/idtrack_docs.json` together (and the test graph if it was rebuilt), and record the frontend's fixtures again if IDTrack's answers changed (section 14.7). `/api/v1/version` reports the commit that answers (`idtrack_commit`). All calls into IDTrack are in `api/idtrack_web_api/adapter.py`; if IDTrack renames an argument or a class, that module (and `api/tests/test_adapter.py`) is what changes. The response schemas are made from IDTrack's result classes, so a change of IDTrack's results changes `api/openapi.json` (a test fails until it is regenerated as above), and a change of IDTrack's tables of codes fails `api/tests/test_vocabulary.py` where the api keeps words of its own (the meanings of the statuses, the fields each criterion compares: `api/idtrack_web_api/vocabulary.py`).

## 4. Install the api

The environment can live anywhere; `UV_PROJECT_ENVIRONMENT` names its folder (without it, `api/.venv`):

```console
$ git clone <this repository> idtrack-web && cd idtrack-web/api
$ export UV_PROJECT_ENVIRONMENT=<environment folder>       # optional; without it: api/.venv
$ uv sync --locked
Using CPython 3.14.6                          (a Python 3.14 uv finds, or one it installs)
Creating virtual environment at: <environment folder>
...
 + idtrack==0.1.2 (from git+https://github.com/theislab/idtrack.git@7f71b2606a61b7e46b99361406ad403ae21eb5b9)
 + idtrack-web-api==0.1.2 (from file://<repository>/api)
...
$ uv run --no-sync idtrack-web --help
usage: idtrack-web [-h] {serve,check-data,publish,openapi} ...
$ uv run --no-sync python -c "import idtrack, idtrack_web_api; print('idtrack', idtrack.__version__, '| idtrack-web-api', idtrack_web_api.__version__)"
idtrack 0.1.2 | idtrack-web-api 0.1.2
```

From an empty environment folder and an empty uv cache this took 37 s (95 packages). `--locked` installs exactly `uv.lock` and fails if `pyproject.toml` and the lock disagree. Never install a package by hand: add it to `pyproject.toml` (`dependencies` for the server, `[dependency-groups] dev` for tests and tools) and run `uv lock`.

## 5. Test

From `api/` (all with `uv run --no-sync`, or the environment's `bin/` on the `PATH`):

```console
$ uv run --no-sync pytest -q                        # the tests of the real graphs skipped without them; a few minutes
$ uv run --no-sync ruff format --check . ../scripts ../web/scripts/fixtures
$ uv run --no-sync ruff check . ../scripts ../web/scripts/fixtures
All checks passed!
$ uv run --no-sync mypy
Success: no issues found in ...
$ uv run --no-sync shellcheck --external-sources ../deploy/*.sh ../deploy/vm/*.sh ../scripts/*.sh
$ ../scripts/check.sh api                           # these in one run, then one table of them (without `api`: the frontend's too)
```

The rules (`api/pyproject.toml`): ruff with every rule set (`select = ["ALL"]`), each rule left out named there with why (one docstring style, Google's; trailing commas left to the formatter; the HTTP statuses as numbers; messages written where an error is raised; `Any` for the JSON values that pass through, whose shapes the tests check against the OpenAPI document; a function's size guarded by pylint's counts rather than mccabe's); the package, its tests and the repository's Python scripts (`scripts/`, `web/scripts/fixtures/`). mypy `strict`, with unreachable code, a `type: ignore` without its error code, an expression always true or false, a test of a value that is always truthy and a name that may be unbound as errors, and `Any` written out refused in every module that does without it (the modules that carry JSON values are listed); it checks the package, its tests and the same scripts. shellcheck (from the api's environment, `shellcheck-py`) reads every shell script of `deploy/` and `scripts/`, its findings of every level failing the run. CI runs each as a step of its own (`.github/workflows/api.yml`).

What the tests cover:

- **The contract**: every endpoint against its schema in `api/openapi.json` (the document equal to what the app generates and serves, its enumerations equal to `/vocabulary`'s tables, every endpoint's error codes and headers listed, every refusal any test meets listed for its endpoint, every recorded example valid against its schema, no Python spelling of a JSON value); README.md's generated tables current, `/llms.txt` following the convention and `/llms-full.txt` holding every endpoint, parameter and code.
- **IDTrack's answers, unchanged**: every answer equal to IDTrack's `to_dict()` for the same call (the api's `cautions` aside), every float compared bit for bit; a batch equal to one `API.convert_many` call over the whole batch (copies among them); the source inference, the conversion into every database and the release-by-database matrix equal to IDTrack's own calls; `/vocabulary` equal to IDTrack's tables, and the api's own words of it tied to IDTrack's sets of codes; the batch's table with its documented columns.
- **The cautions**: each answer's equal to those of its result with the path, asked with or without `explain`; each rule on results made for it (a bridge and the id it went through, a bare number read in an old numbering or at the target, every gene outside the reference sequence, a synonym read without letter case, another meaning at other releases, cautions before notes); the vocabulary's table and the table's column.
- **The http layer**: thousands of repeated parameters refused in milliseconds; an over-long address `414`; malformed, mis-encoded, compressed, deeply nested or duplicate-key bodies and many unknown keys a small `4xx` in the api's own words (no validator's wording), never a `500`, the work of many unknown keys counted, not timed; a query that is not UTF-8 refused as a body is; one release rule in query and body; `405` with `Allow`; a JSON `404` under `/api` that names the index; a `308` for a trailing `/` that keeps the path's encoding (a line break or an encoded `?` included) and logs nothing; `HEAD`, CORS, the security headers, `ETag`, `304` and answers sent again from memory, gzip that decodes to the same bytes; IPv6 clients by their `/64`; one log line per request; a client's request id kept; a slow body `408`; a search whose client went away not run.
- **The allowances**: searches, reads, search time and searches in progress, with `RateLimit` headers and refusals that say their terms; a place among a client's searches in progress followed to the worker that takes the search, and given back when its worker ends; a refusal for the server's capacity giving the client's token back.
- **The process model**, against `idtrack-web serve` with two forked workers (one search made to take seconds where needed): every other request answered by the free worker without waiting behind it, from clients that open a connection per request and from one that keeps its connection; health checks within half a second while both workers search and more wait; a search answered when the first worker frees, never behind a longer one; bodies sent a byte a second delaying no one else's search; a search refused at once when its estimated wait passes `queue_seconds`, and one that waited that long refused unsearched, both `server_busy`; a graceful stop answering the queued searches `503` at once while the running ones finish; a worker killed in a search locking no client out; answers never read dropped at the send's deadline; a request the HTTP parser refuses answered in JSON; the listen queue's count read from the kernel; connections that send nothing or half a head holding no worker.
- **The load** (`/status`): against the server (both workers and the master with their counts, CPU and memory, the sums equal to the processes' values, the three counts of waiting work disjoint, a worker killed with `SIGKILL` replaced and its counts kept) and in one process (its counts, its cache, its draw on the reads' allowance, nothing of the machine in it); the readers of `/proc` and of the cgroups on fixture folders, and the answer without `/proc`; `Server-Timing` on every answer, with the search's parts on a search.
- **The deployment** (`api/tests/test_deploy.py`): every Caddy file sends each message that names a client (a request's error, a handler's, the HTTP server's, the TLS handshake's) to its errors file of seven days and none to its own output, which is shown with Caddy itself where one is given (`IDTRACK_WEB_TEST_CADDY=<caddy binary>`, else `caddy` on the `PATH`, else skipped: downloads broken off from 127.0.0.2, no line of Caddy's output naming that address); the maintenance answer readable from any page with its wait; every `COMPOSE_FILE` of `deploy/compose.env.example` resolved as compose reads it (the files and mounts there, every variable it asks for named), both containers hardened alike and bounded on the virtual machine; every unit's command a file of the repository, read by `systemd-analyze verify` where the machine has it; the configuration's examples naming every setting; the image's stages copying only what they need and the build context free of secrets; and the release sections 10 to 12 deploy, the same in every command, holding every file of `deploy/` they use (at its tag, where the tag is in the clone).
- **Data and the page**: the manifest, a checksum refused, the `check-data` and `serve` commands refusing a damaged file; R2 through a local S3-compatible server (moto, on a free port, no credentials); the built frontend sent compressed only where `Accept-Encoding` allows, with its caching headers, `ETag` and `304`, a file changed after the start sent from disk, its policy made from the `index.html` sent, the answers written into the page equal to the api's, the page of an organism not held a `404`, no hidden file and nothing outside the build sent; the texts for programs compressed and revalidated.

The tests use the small pig graph `api/tests/data/graph_sus_scrofa_cut.npz` (0.57 MB, built from IDTrack's own cut Ensembl tables by `scripts/make_test_graph.py`; rebuild it when IDTrack's graph format changes, from a checkout of the IDTrack commit of section 3: `git clone https://github.com/theislab/idtrack.git <folder> && git -C <folder> checkout <commit>`, then `uv run --no-sync python -I ../scripts/make_test_graph.py <folder> tests/data/graph_sus_scrofa_cut.npz`, about 2 minutes).

The tests marked `real` use the real graphs, from a folder that holds them as `<organism>/<graph file>.npz` (a file or a link to it; `sus_scrofa` and `homo_sapiens` for most, the showcase's tests also `mus_musculus`, `macaca_mulatta` and `macaca_fascicularis`, each skipped without its graph): every pig answer of a sample equal to IDTrack's own, every showcase journey answered with a best answer and its path and every case's answer showing its kind (by the rules of `web/src/lib/home/caseKinds.ts`) and equal to `/convert`'s, in each of the five organisms, the OpenAPI document's examples still the human graph's answers, the history counts holding together and one of them recounted by hand. Without a graph its tests are skipped, each with the reason. The graph is built by IDTrack's command line, which the api's environment holds (IDTrack's SETUP.md, section 3, says more; about 30 minutes with the downloads, about 40 MB). IDTrack 0.1.2 writes graph format 6, the format this api reads (`/api/v1/version`, `graph_format_version`):

```console
$ IDTRACK_ENSEMBL_ACCESS=https uv run --no-sync idtrack build pig 115 --repository <idtrack repository>
...
<idtrack repository>/graph_sus_scrofa_assembly111_min56_max115.npz
$ mkdir -p <graphs folder>/sus_scrofa && ln -s <idtrack repository>/graph_sus_scrofa_assembly111_min56_max115.npz <graphs folder>/sus_scrofa/
$ mkdir -p <graphs folder>/homo_sapiens && ln -s <idtrack repository>/graph_homo_sapiens_assembly38_min48_max115.npz <graphs folder>/homo_sapiens/   # built as the pig's, `idtrack build human 115`
$ IDTRACK_WEB_TEST_GRAPHS=<graphs folder> uv run --no-sync pytest -q   # nothing skipped where every graph is there
```

The OpenAPI document after a change of the api: `uv run --no-sync idtrack-web openapi --output openapi.json`.

## 6. Configuration

Environment variables only, all read and checked at start; a misspelt `IDTRACK_WEB_*` variable stops the server with the list of known ones. A secret can be given as a file instead: `<NAME>_FILE` holds the path of a file with the value (for container secrets).

| Variable | Default | Accepted | What |
| --- | --- | --- | --- |
| `IDTRACK_WEB_SOURCE` | (required) | `s3` or `directory` | `s3` (Cloudflare R2 or another S3-compatible store) or `directory` (a folder with the same layout) |
| `IDTRACK_WEB_DIRECTORY` |  | an existing absolute folder | For `directory`: the folder |
| `IDTRACK_WEB_S3_ENDPOINT` |  | `https://` or `http://` URL | For `s3`: `https://<account id>.r2.cloudflarestorage.com` |
| `IDTRACK_WEB_S3_BUCKET` |  |  | For `s3`: the bucket |
| `IDTRACK_WEB_S3_REGION` | `auto` |  | For `s3`: the signing region (`auto` for R2) |
| `IDTRACK_WEB_S3_ACCESS_KEY_ID` (or `_FILE`) |  |  | For `s3`: the access key id (secret; never logged) |
| `IDTRACK_WEB_S3_SECRET_ACCESS_KEY` (or `_FILE`) |  |  | For `s3`: the secret access key (secret; never logged) |
| `IDTRACK_WEB_CACHE_DIR` | (image: `/var/cache/idtrack-web`) | an absolute folder | For `s3`: where fetched files are kept between starts |
| `IDTRACK_WEB_MANIFEST_KEY` | `idtrack/<graph format>/manifest.json` | a relative key without `..` | The manifest to read |
| `IDTRACK_WEB_ORGANISMS` | every organism of the manifest | names IDTrack knows, each once | Comma-separated (`homo_sapiens,pig`) |
| `IDTRACK_WEB_WORKERS` | `2` | 1 to 64 | Worker processes |
| `IDTRACK_WEB_HOST`, `IDTRACK_WEB_PORT` | `0.0.0.0`, `8000` | port 1 to 65535 | Where the server listens |
| `IDTRACK_WEB_FORWARDED_ALLOW_IPS` | `127.0.0.1` | addresses, networks or `*` | Proxies whose `X-Forwarded-For` names the client (for the allowances) and whose `X-Forwarded-Proto` the scheme |
| `IDTRACK_WEB_PUBLIC_URL` | the address of each request (its `Host`, where it is a plain name or address; else links relative to the site) | an origin, `https://<domain>` | The site's address, for the absolute links of `/llms.txt` and `/llms-full.txt`, of `/robots.txt` and `/sitemap.xml`, and of each page's canonical address and link cards; set it wherever the server is reached by its name |
| `IDTRACK_WEB_DOCS_URL` | `https://idtrack.readthedocs.io/en/stable/` | an address, `https://<domain>[/<path>]/` | Where IDTrack's documentation is published: every link of the page to it (the masthead's "Docs", the footer, the pages' references) and of `/llms.txt` goes there, and `/version` reports it as `docs_url`; set it when the documentation moves to a name of its own (a page reloaded reads the new address; nothing is rebuilt) |
| `IDTRACK_WEB_ANALYTICS_ID` | none | a Google Analytics measurement id, `G-` and 4 to 20 capitals or digits | The id the site counts visits with (`deploy/idtrack-web.env.example` sets IDTrack's, `G-FYKLWNJBVK`, the property of its documentation): `/version` reports it as `analytics_id`, the page's policy then allows Google's tag its hosts, and the page loads the tag only after a visitor accepts (a slim bar at the foot of the window at the first visit; "Cookie settings" in the footer changes the choice). Every hit carries the page's path and its name alone, never its query or the tab's title (an identifier converted, an answer), an address that is no page as `/404`, and as the referrer only another site's origin; the tag's cookies stay on the site's host (`cookie_domain: "none"`); Google signals and ad personalisation are off; a consent declined or withdrawn, in any tab, stops the tag and deletes its cookies. The property's web stream must have two automatic measurements of "Enhanced measurement" off, since they read the browser's address themselves and the site counts its pages itself: "Page changes based on browser history events" (under "Page views") and "Form interactions". Unset (development, the tests, Lighthouse runs): nothing is counted |
| `IDTRACK_WEB_HTTPS_ROUTE` | none | `lets_encrypt`, `institute_certificate` or `behind_proxy` | How visitors reach the site over https, of the three ways of section 10.5: Caddy holds a certificate of Let's Encrypt, or one the institute gave, or the institute's reverse proxy holds the certificate and passes each request, with the visitor's address, on to Caddy; `/version` reports it as `https_route`, from which the privacy page says who holds the certificate and who sees a visitor's address. Unset (development, the tests): not stated |
| `IDTRACK_WEB_REQUEST_SECONDS` | `20` | more than 0, at most 600 | Time budget of a request's search, from when it begins to its last conversion (a batch out of it: `503 request_budget_exceeded`) |
| `IDTRACK_WEB_QUEUE_SECONDS` | `10` | more than 0, at most 600 | The longest a search waits for a worker free of searches: one that would wait longer, by the estimate of the searches queued and the recent searches' mean time, is answered `503 server_busy` at once, and one that waited longer is answered so without being searched |
| `IDTRACK_WEB_SEARCH_SECONDS` | `10` | more than 0, at most 600 and at most the request's | Time budget of one identifier's search |
| `IDTRACK_WEB_SEARCH_STATES` | `200000` | 1,000 to 100,000,000 | State budget of one identifier's search |
| `IDTRACK_WEB_BATCH_MAX` | `1000` | 1 to 100,000 | Identifiers per batch |
| `IDTRACK_WEB_IDENTIFIER_MAX_LENGTH` | `256` | 16 to 4,096 | Characters per identifier or name |
| `IDTRACK_WEB_BODY_MAX_BYTES` | `1048576` | 1,024 to 1,073,741,824 | Request body |
| `IDTRACK_WEB_RESPONSE_MAX_BYTES` | `33554432` | 65,536 to 1,073,741,824 | Answer (a larger one is refused with `response_too_large`, never cut) |
| `IDTRACK_WEB_RATE_PER_MINUTE` | `120` | 0 to 1,000,000 | Searching requests per minute per client (other requests of the api: ten times as many); `0`: no per-client allowance of any kind |
| `IDTRACK_WEB_RATE_BURST` | `30` | 1 to 1,000,000 | Searching requests a client may make at once (other requests: ten times as many) |
| `IDTRACK_WEB_RATE_SEARCH_SECONDS` | `30` | 0 to 3,600 | Seconds of search per minute per client, charged after each search (`0`: not limited) |
| `IDTRACK_WEB_RATE_SEARCH_BURST_SECONDS` | `60` | 0 to 3,600 | The most seconds of search a client's balance holds |
| `IDTRACK_WEB_RATE_CONCURRENT_SEARCHES` | `2` | 0 to 1,000,000 | Searching requests a client may have in progress at once, from admission until the answer is sent (`0`: not limited); a worker killed in a search gives its places back |
| `IDTRACK_WEB_QUEUE_MAX` | `64` | 1 to 100,000 | Searches per worker that may wait for a worker free of searches (the queue the workers share holds `QUEUE_MAX` times the workers) before a search is answered `503 server_busy` (README.md, "How it runs") |
| `IDTRACK_WEB_HEAD_SECONDS` | `5` | more than 0, at most 600 | The longest a taken connection may take to send its request's head; it is closed after |
| `IDTRACK_WEB_BODY_SECONDS` | `30` | more than 0, at most 600 | The longest a request's body may take to arrive (`408 request_timeout` after) |
| `IDTRACK_WEB_SEND_SECONDS` | `30` | more than 0, at most 3,600 | The longest a client may take none of an answer before its connection is closed; after it, a client must take answers at 64 KiB a second at least |
| `IDTRACK_WEB_SENDING_MAX_BYTES` | `268435456` | 1,048,576 to 17,179,869,184 | The bytes of answers one worker holds for clients that have not taken them; an answer beyond is refused, `503 server_busy` |
| `IDTRACK_WEB_ANSWER_CACHE_BYTES` | `67108864` | 0 to 17,179,869,184 | The answers each worker keeps in memory to send again without a search (`0`: none) |
| `IDTRACK_WEB_STATIC_DIR` | (image: the built frontend) | an existing absolute folder | Serve the built frontend from this folder at `/` |
| `IDTRACK_WEB_CORS_ORIGINS` | `*` | `*`, origins, or `none` | The pages that may call the api from a browser: `*` any page (the api is keyless, read-only and sends no credential), a list of origins (`https://a.example`), or `none` |
| `IDTRACK_WEB_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` | The level of the log |

**Many people behind one address.** The allowances are per client address (an IPv6 address by its `/64`): a course, a workshop or a campus behind one NAT shares them, and its users then meet `429 rate_limited` sooner. A search takes milliseconds to a few seconds, so the searches at once (2) rarely bind; the 30 searches at once and 120 a minute are what a room meets first. For such an event raise them for the whole server (`IDTRACK_WEB_RATE_BURST=200`, `IDTRACK_WEB_RATE_PER_MINUTE=600`, `IDTRACK_WEB_RATE_SEARCH_SECONDS=120`, then restart), and set them back after; the seconds of search per client still bound the work any one address makes the server do.

The server logs its settings at start with every secret shown as `<set>`. Each request is logged as `method path status seconds request-id`, without the client's address (Caddy keeps that in its own log, deleted after seven days: 10.9), every value from the client escaped (a control character as `\n`, `\x1b`, ...: one request, one line; the path as sent, percent-encoded); an internal error's traceback is logged with the request id that the client was given. A value outside its accepted range stops the server at start with a message naming the variable.

## 7. Data: graphs, the manifest, R2 and the node

**Layout of a store** (a bucket, or a folder on the node):

```
idtrack/<graph format>/manifest.json                     the current release: what servers load
idtrack/<graph format>/manifests/<sha256>.json           every manifest ever published, named by its content
idtrack/<graph format>/<organism>/<sha256>.npz           graph files, named by their content (never replaced)
idtrack/<graph format>/<organism>/<sha256>.lineages.json the lineages of each graph's gene ids, named by their content
```

The manifest (`data/manifest.schema.json`, layout 2; an example, the manifest of the five organisms' graphs in format 6 that IDTrack 0.1.2 reads, as `idtrack-web publish` wrote it: `data/manifest.example.json`) lists per organism the graph file's key, SHA-256 and size, its lineages file's key, SHA-256 and size, the snapshot release, the graph's content digest and the IDTrack version and commit that built it. `<graph format>` is IDTrack's graph file format (6 for IDTrack 0.1.0 to 0.1.2; `/api/v1/version` reports it as `graph_format_version`): an IDTrack that reads another format reads another manifest, so a format change never breaks running servers.

**Where graphs come from.** IDTrack builds them (`idtrack.API.build`, from Ensembl's public data). The graphs of the five organisms of IDTrack's organism table in graph format 6 (Ensembl releases up to 115, the graphs IDTrack 0.1.0 to 0.1.2 is measured on: their conversions are the same in these versions) are: human 156 MB, mouse 101 MB, pig 40 MB, macaque (rhesus) 34 MB, cynomolgus 22 MB (0.35 GB in all).

**Publish a release** (one graph per organism; each file is loaded with IDTrack first, so a file that is not a graph of this IDTrack's format is refused):

```console
$ uv run --no-sync idtrack-web publish --graph <human.npz> --graph <pig.npz> ... --directory /srv/store   # a folder
$ set -a; . ./publisher.env; set +a     # IDTRACK_WEB_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID, _SECRET_ACCESS_KEY
$ uv run --no-sync idtrack-web publish --graph <human.npz> --graph <pig.npz> ... --s3                    # R2
{
  "target": "bucket <bucket> at https://<account>.r2.cloudflarestorage.com",
  "done": {"idtrack/6/homo_sapiens/9d9d7708....npz": "uploaded", ..., "idtrack/6/manifest.json": "written"},
  "manifest": {...}
}
```

**The lineages file.** Publishing also reads, from each loaded graph, the lineages of all its gene ids (the walk of the whole graph that `GET /organisms/{organism}/lineages` answers from: measured, human 35.2 s, mouse 32.3 s, pig 18.5 s, rhesus 14.1 s, cynomolgus 8.4 s; publishing the five took 140 s in all with their loading) and stores them beside the graph as one JSON file named by its content: human 5.9 MB, mouse 5.7 MB, pig 3.4 MB, rhesus 2.8 MB, cynomolgus 2.2 MB (20 MB for the five). The same graph always gives the same bytes (keys sorted, no time recorded), so publishing a graph again keeps its lineages file. Its content (layout 1, `idtrack_web_api/lineages.py`): `layout` (1), `organism`, `content_digest` (the graph's), `releases` and `genes` (the gene ids of the graph's history), then every family of ids joined by history edges, in the order of the SHA-256 digest of each family's smallest id, as the endpoint's body gives families: `ids`, `family_starts`, `active` (per id its runs of consecutive releases of the graph at which a version of it is active, `[first, last]`: a release of the graph at which none is ends a run, so an id active again after a gap has a run on each side of it), `versions` (per id the releases of a new version) and `edges` (`[from index, to index, old release, new release, score or null]`). The server reads it at start (measured: 0.68 s for the five, human 0.28 s) and puts first the families of the genes its showcase's answers name; it never walks a graph for its lineages itself, so a store without the file is refused at start with what to do: a manifest of layout 1 (written before lineages files) with `The manifest ... is of layout 1, which names no lineages file of each graph; this server reads layout 2. Publish the graphs again with idtrack-web publish ...`, a missing or damaged file with `The lineages file of <organism> that the manifest names cannot be used (...)`.

`deploy/publish_graphs.sh <folder> s3` publishes every `graph_*.npz` under a folder. A file already published with the same bytes is `kept`; a content key that holds other bytes stops the publication. The manifest is written last, so a server starting meanwhile reads either the old release or the new one, whole. Older releases stay in the store (their manifests under `manifests/`); to serve one again, point `IDTRACK_WEB_MANIFEST_KEY` at its manifest.

**Cloudflare R2.** In the Cloudflare dashboard: R2, create a bucket (e.g. `idtrack-graphs`, no public access); R2, Manage API tokens: one token with "Object Read & Write" on that bucket for publishing (kept by the publisher), one with "Object Read" for the servers; each gives an access key id and a secret access key, and the endpoint is `https://<account id>.r2.cloudflarestorage.com`. The five graphs are 0.35 GB (353 MB, above), inside R2's free 10 GB; a server start reads one manifest and, for files its cache lacks, one object each. The R2 path of the code (publishing with an MD5 checked on arrival, the cache, the verification, every refusal) is tested against a local S3-compatible server (section 5); it has not been run against R2 itself, which needs the owner's account.

**At start** the server reads the manifest; for `s3` it fetches each file its cache lacks (or holds with other bytes) to a temporary name, verifies size and SHA-256, and renames it; for `directory` it verifies the files in place (the graphs and their lineages files); it then loads each graph and checks that it is the graph the manifest names (organism, snapshot release, content digest, format), and that each lineages file records that graph's content digest. Any mismatch stops it with exit status 2 and a message naming the file. `idtrack-web check-data` does all of this and exits, printing what it verified:

```console
$ IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=/tmp/idtrack-store uv run --no-sync idtrack-web check-data   # the store of section 8
{
  "manifest": {"key": "idtrack/6/manifest.json", "sha256": "db16e188...", "size": 769},
  "graphs": {
    "sus_scrofa": {
      "file": {"key": "idtrack/6/sus_scrofa/8958696c....npz", "sha256": "8958696c...", "size": 569398},
      "path": ".../idtrack-store/idtrack/6/sus_scrofa/8958696c....npz",
      "lineages": {"key": "idtrack/6/sus_scrofa/052d7f60....lineages.json", "sha256": "052d7f60...", "size": 42741},
      "lineages_path": ".../idtrack-store/idtrack/6/sus_scrofa/052d7f60....lineages.json",
      "load_seconds": 0.099,
      "releases": [56, 115]
    }
  }
}
```

## 8. Run locally

With the tests' small graph (no real graph needed). The store's folder is yours to choose; `/tmp/idtrack-store` below is an example, and the same folder serves sections 7, 8 and 13:

```console
$ uv run --no-sync idtrack-web publish --graph tests/data/graph_sus_scrofa_cut.npz --directory /tmp/idtrack-store
$ IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=/tmp/idtrack-store IDTRACK_WEB_HOST=127.0.0.1 \
  IDTRACK_WEB_PORT=8000 uv run --no-sync idtrack-web serve
... [INFO] Listening at: http://127.0.0.1:8000
... [INFO] Booting worker with pid: ...
... [INFO] Booting worker with pid: ...
```

In another shell:

```console
$ curl -s http://127.0.0.1:8000/api/v1/health
{"status":"ok","organisms":["sus_scrofa"]}
$ curl -s "http://127.0.0.1:8000/api/v1/organisms/pig/convert?identifier=ENSSSCG00000040076.1&to_release=80"
{"query_id":"ENSSSCG00000040076.1","graph_id":"ENSSSCG00000040076.1","match":"exact",...,"to_release":80,"final_database":"ensembl_gene","candidates":[{"gene":"ENSSSCG00000026013.1",...,"score":1.0,...}],...,"status":"tie",...}
$ curl -s "http://127.0.0.1:8000/api/v1/organisms/pig/convert?identifier=X&to_release=999"
{"error":{"code":"unknown_release","message":"`to_release`=999 is not a release of this graph, which covers the Ensembl releases 56 to 115.","argument":"to_release","allowed":[56,...,115],"details":null,"request_id":"...","retry_after":null,"allowance":null}}
$ curl -s -X POST -H 'Content-Type: application/json' -d '{"identifiers": ["ENSSSCG00000040076.1", "NOT_A_GENE"]}' \
  "http://127.0.0.1:8000/api/v1/organisms/pig/convert/batch?format=tsv" | cut -f1-6
input_index	query_id	status	reason	reasons	graph_id
0	ENSSSCG00000040076.1	converted			ENSSSCG00000040076.1
1	NOT_A_GENE	not_found	not_in_graph	not_in_graph
```

The api's index is `http://127.0.0.1:8000/api/v1`, its rules as text `http://127.0.0.1:8000/llms-full.txt`. `scripts/check_endpoints.py` calls every endpoint of a running server, checks every answer against `api/openapi.json` and its `X-Request-ID` and `Server-Timing`, checks that each column of the release-by-database matrix is that release's final databases, and with `--graph` compares every conversion and the matrix with IDTrack itself. It sends about 2,000 requests, so the server is started for it without the rate limit (it stops at once, with exit status 2, on a server that limits the rate):

```console
$ IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=/tmp/idtrack-store IDTRACK_WEB_HOST=127.0.0.1 IDTRACK_WEB_PORT=8000 \
  IDTRACK_WEB_RATE_PER_MINUTE=0 uv run --no-sync idtrack-web serve
$ uv run --no-sync python ../scripts/check_endpoints.py http://127.0.0.1:8000 sus_scrofa --graph tests/data/graph_sus_scrofa_cut.npz --sample 300
{ ..., "requests": 2084, "compared_with_idtrack": 2581, "cautions_compared": 1800, "floats_compared_bit_for_bit": 3454, ..., "copies_answered": 20, ..., "server_timing_ms_median": {...}, "database_matrix": [26, 60], "status_before": {...}, "status_after": {...}, "failures": [] }
```

Besides the answers, it sends 43 wrong requests (wrong types, sizes over the server's limits, unknown organisms, releases, databases, genes and parameters, strings IDTrack refuses) and checks that each is refused with its code, a message and the argument, and it converts strings that IDTrack reads after changing them (Unicode, punctuation, GENCODE's Y copies) and reports how they matched. It also compares each conversion's `cautions` with the rules' reading of IDTrack's result with its path (`cautions_compared`). With IDTrack 0.1.2 and the five real graphs of format 6 (a store of links: `idtrack-web publish ... --directory <store> --link`) and `--sample 50`, against one server with two workers holding all five, it gave 503 to 568 requests per organism, 541 to 598 answers compared with IDTrack each (the conversion into every database and the source inference among them), 300 conversions' cautions compared each, and no failure (an answer the server sends again from memory carries `cache;desc="hit"` in `Server-Timing` and is counted as such). The OpenAPI document's examples are real answers of such a server, recorded by `scripts/record_examples.py <server> idtrack_web_api/examples.json --bounded <second server>` (the second server holds the same graphs with the small bounds the script names, so that a rate limit and a slow body can be met on purpose; three refusals no request makes on purpose are written by the api's own code and say so); run it after a change of IDTrack's answers, then `idtrack-web openapi`. Long answers are trimmed to their first items, and say so (`x-recorded`).

What the server is doing meanwhile: `curl -s http://127.0.0.1:8000/api/v1/status` (README.md, "The server's load"). Under a load of 48 clients converting human identifiers at once for 25 seconds (22,967 conversions, five graphs, three workers, each request on its own connection), its readings agreed with readings taken by hand at the same moment: CPU shares of 0.999, 0.990 and 1.000 core for the three workers (all three busy; 46 connections waiting in the listen queue, `requests.connections_waiting`) against 0.999, 0.999 and 0.989 from `/proc/<pid>/stat` over the next second, and the PSS of a worker equal to `smaps_rollup` read by hand two seconds later and the master's within 3 MB of it (the other workers' readings, up to 5 seconds old, differed by what they had allocated since).

## 9. Sizing

The master loads every graph once and forks the workers, which share its memory page by page until they write to it. Measured with the image of section 11 serving the five graphs of format 6 with two workers: right after start 2.85 GB resident in the master and 2.83 GB in each worker (the shared pages counted in each); after 10,321 requests over the five organisms (`scripts/check_endpoints.py` for each, section 8), 4.0 GB resident per worker, and 7.0 GB in all counted proportionally (each shared page split among the processes that share it: master 1.5 GB, workers 2.8 and 2.7 GB). Each worker's private memory grows with what it answers, up to the bounds of IDTrack's per-graph caches. So: a machine of 8 vCPU and 16 GB (the Helmholtz virtual machine, a Hetzner CPX42) for all five organisms with three workers, as measured on such a machine under load (section 10.7: 11.6 GB in use on the machine after 15 minutes); a CPX32 (8 GB) holds all five only just, and suits fewer organisms (`IDTRACK_WEB_ORGANISMS`) or one worker; more workers need more memory, measured on the machine (`/api/v1/status`: `memory.pss_bytes` is the server's footprint, `memory.limit_bytes` what it runs under; or `docker stats`). Start-up, measured on the five graphs with two workers: 15 s to verify and load all five, 38 s to compute the graph-wide tables IDTrack would otherwise compute in each worker on a first search (human 15.0 s, mouse 12.2 s, pig 5.0 s, rhesus 4.2 s, cynomolgus 1.5 s), 0.5 s to answer the showcases, under a second to read the lineages that publishing computed (section 7; 0.68 s for the five, measured on the cluster) and 8.8 s to order their families and write each list of their answers once, so that `/lineages` cuts an answer of any size from them at the cost of copying its bytes (human 2.6 s, mouse 2.4 s; measured on the cluster at a load average of 55) and 71 s to count the history of each graph (human 25.7 s, mouse 19.2 s, pig 11.7 s, rhesus 8.4 s, cynomolgus 5.7 s): 128 s in all before the workers start, measured before the lineages' answers were written at start (their 8.8 s, measured apart, come on top), plus the first fetch from R2; the container's health check allows 300 s. The workers then share these tables: after the start the server's footprint (PSS summed) was 4.9 GB.

## 10. Deploy on a Helmholtz virtual machine (Ubuntu 26.04, 8 vCPU, 16 GB)

The first place IDTrack's web app runs: a production virtual machine at Helmholtz with 16 GB of memory, 8 vCPU, a 50 GB disk and Ubuntu 26.04 LTS, security updates installed automatically with reboots in a weekly window (Thursday night), about 10 GB of disk the service may grow into each month, no backup, and access from outside by https only. Docker Engine runs the image and Caddy with `deploy/compose.yaml` and the overrides of `deploy/vm/`; the graphs are a folder store on the machine's disk (R2, section 7, works as well). This section goes from a fresh machine to a working https site that keeps itself updated and checked; section 11 (the Hetzner node) and section 12 (without containers) are the alternatives.

The release deployed is `v0.1.3`, the version whose tag holds this section's files (`deploy/vm/` and the rest; `api/tests/test_deploy.py` checks that every file of `deploy/` sections 10 to 12 name is in the release they name). Every command was run as written on Ubuntu 26.04.1 LTS (Ubuntu's cloud image of 2026-11-08, kernel 7.0.0-43) in a virtual machine of this size (8 vCPU, 16 GB, a 50 GB disk, under KVM), by an administrator with `sudo`, from a clone of the release's tree in place of GitHub's; the outputs are what it printed. What could not be run there (the institute's DNS, firewall and proxy, a certificate from Let's Encrypt, mail) is said where it applies and listed in 10.12.

### 10.1 What to ask the machine's administrators

- **A name in DNS** for the site (`<domain>`): an `A` record (and `AAAA` for IPv6) pointing at the machine, or at the institute's reverse proxy in way (c) of 10.5.
- **Inbound**: 443 from the internet, and 80 (Let's Encrypt's validation and the redirect to https); in way (c) of 10.5, only 80 from the proxy. SSH for the administrators.
- **Outbound https** to `download.docker.com` (Docker's packages); `registry-1.docker.io`, `auth.docker.io` and `production.cloudflare.docker.com` (the build's base images and Caddy's image, also each week for their security releases, 10.8); `ghcr.io` (uv's image); `registry.npmjs.org` (the frontend's packages); `github.com` and `codeload.github.com` (this repository and IDTrack); `pypi.org` and `files.pythonhosted.org` (the api's packages); `acme-v02.api.letsencrypt.org` (way (a) of 10.5); and Ubuntu's archive or the institute's mirror. Where the build's hosts are closed, build the image on another machine and copy it (10.3); the weekly refresh of 10.8 then cannot run on the machine.
- **The way to the certificate**: Let's Encrypt through Caddy, a certificate the institute gives, or the institute's reverse proxy in front (10.5).
- **Updates and reboots**: whether the administrators run the machine's updates and reboots themselves; if they leave them to the service's owner, 10.8 sets them up.
- **Mail**, for the alert of 10.10: whether the machine may send mail through the institute's relay (then a mail transfer agent such as `msmtp-mta` set up for it, and `IDTRACK_WEB_ALERT_EMAIL` in `deploy/.env`).

### 10.2 Docker Engine

Docker's repository carries Ubuntu 26.04 ("resolute"; [Docker's instructions](https://docs.docker.com/engine/install/ubuntu/) list it), and its instructions work unchanged:

```console
$ sudo apt-get update && sudo apt-get install -y ca-certificates curl git
$ sudo install -m 0755 -d /etc/apt/keyrings
$ sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
$ sudo chmod a+r /etc/apt/keyrings/docker.asc
$ sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
$ sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
$ docker --version && docker compose version
Docker version 29.10.1, build c48360f
Docker Compose version v5.8.1
$ systemctl is-enabled docker.service containerd.service
enabled
enabled
```

Docker starts at boot, and with it every container whose restart policy says so (10.8). Its commands need root: every `docker` command here runs with `sudo` (a user in the `docker` group has root's power on the machine; nothing here needs it). Should Docker's repository be closed to the machine, Ubuntu's own packages serve as well: `sudo apt-get install -y docker.io docker-compose-v2` (Docker 29.1.3 and Compose 2.40.3 in Ubuntu 26.04; the compose files here were checked with Compose 2.40.3 and 5.8.1). Ubuntu 26.04 also has podman 5.7.0 and `podman-compose` 1.5.0; the steps below are written and run for Docker.

### 10.3 The repository, Docker's settings and the image

```console
$ sudo git clone https://github.com/theislab/idtrack-web.git /opt/idtrack-web
$ cd /opt/idtrack-web && sudo git checkout v0.1.3
$ sudo install -m 644 deploy/vm/docker-daemon.json /etc/docker/daemon.json && sudo systemctl restart docker
$ sudo docker info --format 'live-restore={{.LiveRestoreEnabled}} log-driver={{.LoggingDriver}}'
live-restore=true log-driver=json-file
$ sudo deploy/build_image.sh 0.1.3 docker
...
#25 naming to docker.io/library/idtrack-web:0.1.3 done
$ sudo docker images idtrack-web
IMAGE               ID             DISK USAGE   CONTENT SIZE   EXTRA
idtrack-web:0.1.3   22e033128085        537MB          128MB
```

`deploy/vm/docker-daemon.json` sets Docker's `live-restore` (the containers keep running while Docker itself restarts, as an update of its packages makes it: measured, `systemctl restart docker` took 1.2 s, the containers were not restarted, and of health checks sent through Caddy every 0.2 s for 30 s, 4 in a row failed) and a bound on the log of every container (five files of 20 MB). The build took 70 s on the machine, everything fetched from the network. The build context holds no secret (`.dockerignore` leaves out every `.env` and `*.env` file, `secrets` folder, key and certificate, in any folder), and the api's stage copies the api alone. Where the machine cannot reach the build's hosts (10.1), build on another machine with Docker and copy the image: `docker save idtrack-web:0.1.3 | gzip | ssh <machine> 'gunzip | sudo docker load'`.

### 10.4 The graphs and the configuration

The graphs are published into a folder store on the machine. Copy the graph files to the machine (e.g. `scp graph_*.npz <machine>:`), then publish them with the image's own `idtrack-web publish`, as root in the container, so that it reads the copied files and writes the store:

```console
$ sudo install -d -m 755 /srv/idtrack-web/store /srv/idtrack-web/incoming
$ sudo mv ~/graph_*.npz /srv/idtrack-web/incoming/
$ sudo docker run --rm --user 0:0 -v /srv/idtrack-web/incoming:/incoming:ro -v /srv/idtrack-web/store:/srv/store \
    idtrack-web:0.1.3 publish --directory /srv/store $(cd /srv/idtrack-web/incoming && printf -- '--graph /incoming/%s ' graph_*.npz)
{
  "target": "folder /srv/store",
  "done": {
    "idtrack/6/homo_sapiens/9d9d770898828f40197472fd7e9deb1442c9a984e3d82d208dd9e69e57d3ef6b.npz": "copied",
    "idtrack/6/homo_sapiens/9a7349ec450b4a4c27d764a715e1cfe8aac5b6568c52cab8c2fbd49a5317d987.lineages.json": "written",
    ...
$ sudo du -sh /srv/idtrack-web/store
357M	/srv/idtrack-web/store
```

It took 79 s for the five graphs: each is loaded with IDTrack and checked before it is copied, and the lineages of all its gene ids are computed and written beside it (section 7: 20 MB for the five); the store's files are written readable by every user, as the server (uid 10001 in the container) reads them. Run as the image's own user, the publication cannot read files copied with mode 600 (`PermissionError`). The copies in `incoming/` may be removed once published: the store holds each graph file whole (`idtrack/6/<organism>/<sha256>.npz`), and publishing again reads them there (10.11). For R2 instead of a folder: section 7, and `IDTRACK_WEB_SOURCE=s3` in the server's settings.

Two files hold the configuration, on the machine only (`.gitignore` keeps them out of git) and readable by root only:

```console
$ cd /opt/idtrack-web/deploy
$ sudo install -m 600 vm/idtrack-web.env.example idtrack-web.env   # the server's settings on this machine (section 6)
$ sudo install -m 600 compose.env.example .env                     # the compose files' settings
$ sudo nano .env              # IDTRACK_WEB_DOMAIN=<domain>; COMPOSE_FILE for the way to the certificate (10.5)
$ sudo grep -vE '^#|^$' idtrack-web.env .env
idtrack-web.env:IDTRACK_WEB_SOURCE=directory
idtrack-web.env:IDTRACK_WEB_DIRECTORY=/srv/store
idtrack-web.env:IDTRACK_WEB_WORKERS=3
idtrack-web.env:IDTRACK_WEB_ANALYTICS_ID=G-FYKLWNJBVK
.env:IDTRACK_WEB_IMAGE=idtrack-web:0.1.3
.env:IDTRACK_WEB_DOMAIN=<domain>
.env:IDTRACK_WEB_STORE=/srv/idtrack-web/store
.env:COMPOSE_FILE=compose.yaml:vm/compose.vm.yaml:vm/compose.institute-cert.yaml
.env:IDTRACK_WEB_TLS_DIR=/etc/idtrack-web/tls
```

`deploy/vm/idtrack-web.env.example` is this machine's: the folder store mounted at `/srv/store` (`IDTRACK_WEB_STORE` of `.env`), three workers (10.7) and the site's analytics id; every other setting keeps its default (`deploy/idtrack-web.env.example` lists them all, section 6 explains each). Compose reads `deploy/.env` by itself: the image, the domain, the store's folder, and in `COMPOSE_FILE` the override files of `deploy/vm/` added to `compose.yaml`; so every command (`up -d`, `ps`, `logs`, `restart`) is the same short one, run from `deploy/`. `deploy/vm/compose.vm.yaml` bounds the api's container at 12 GiB and Caddy's at 1 GiB (10.7). Each way to the certificate (10.5) also tells the api which it is (`IDTRACK_WEB_HTTPS_ROUTE`, set by `compose.yaml` and the override of the way), so that `/api/v1/version` reports it as `https_route` and the privacy page says who holds the certificate.

### 10.5 The certificate: three ways

The site is reached by https only: http is redirected to https (`308`), and every answer carries `Strict-Transport-Security: max-age=31536000; includeSubDomains` (a browser then uses https only, for a year, for the domain and its subdomains). Choose the way with the institute (10.1). Each way's compose file also tells the API which it is (`IDTRACK_WEB_HTTPS_ROUTE`), so that the privacy page says who holds the certificate and, in way (c), names the institute's proxy as a recipient of visitors' addresses:

**(a) Let's Encrypt, through Caddy**: `COMPOSE_FILE=compose.yaml:vm/compose.vm.yaml`, the default of `compose.env.example`. Caddy obtains the certificate at its first start and renews it by itself. It needs the domain in DNS pointing at the machine, port 80 (or 443) reachable from the internet, since Let's Encrypt validates from outside, and outbound https to `acme-v02.api.letsencrypt.org`. Not rehearsed (no public name).

**(b) A certificate given by the institute**: `COMPOSE_FILE=compose.yaml:vm/compose.vm.yaml:vm/compose.institute-cert.yaml` and `IDTRACK_WEB_TLS_DIR=/etc/idtrack-web/tls` in `.env`. Caddy (`deploy/vm/Caddyfile.institute-cert`, `deploy/Caddyfile` with a `tls` line) reads the certificate followed by its intermediate certificates from `cert.pem` and the key from `key.pem`; inbound 443, and 80 for the redirect:

```console
$ sudo install -d -m 700 /etc/idtrack-web/tls
$ sudo install -m 600 <certificate and chain>.pem /etc/idtrack-web/tls/cert.pem
$ sudo install -m 600 <key>.pem /etc/idtrack-web/tls/key.pem
```

Rehearsed this way, with a certificate for `idtrack.example.org` signed by a test authority (10.6 to 10.10 ran so): the chain verified (`curl --cacert`), HSTS sent, `http://` redirected with `308`. Caddy reads the files at start: when the institute renews the certificate, replace both files and `sudo docker compose restart caddy` (`deploy/vm/check.sh` warns 14 days before the end).

**(c) Behind the institute's reverse proxy**: `COMPOSE_FILE=compose.yaml:vm/compose.vm.yaml:vm/compose.behind-proxy.yaml` and `IDTRACK_WEB_TRUSTED_PROXIES=<address> [<address> ...]` in `.env` (the proxy's addresses or networks, space-separated). The proxy holds the certificate, answers https, redirects http, and passes the requests to this machine on plain http, port 80, the only port Caddy then publishes. Caddy (`deploy/vm/Caddyfile.behind-proxy`) answers only the proxy's addresses (any other gets `403`, so the site is never served on plain http to anyone else), reads the client's address from the proxy's `X-Forwarded-For` right to left (the first address that is not the proxy's; what a client wrote there itself is not believed), and passes the api that address alone, so that the api's allowances count each client by its own address (the api trusts `X-Forwarded-For` from Caddy's network only, as in (a) and (b)). The proxy must send `X-Forwarded-For`, and keep or set the HSTS header. Rehearsed with the machine's host as the proxy: a request carrying `X-Forwarded-For: 198.51.100.99, 203.0.113.7` was logged by the api as from `203.0.113.7`; 45 searching requests in a row from one client got 31 answers and 14 `429` while another client was answered at once, and a client that wrote the other's address at the left of the header was still limited as itself; a request to port 80 from the machine itself got `403`, and 443 was closed. Run again with this release's Caddy files: the same `403` and closed 443, and a request carrying `X-Forwarded-For: 198.51.100.4, 203.0.113.7` was in Caddy's access log as from `203.0.113.7`.

All three Caddy files keep a visit alike: the access log, and every message about a request (a request's error, a download the client broke off, a failed handshake), each naming the client, go to files in Caddy's volume (`/data/logs`) of which none is older than seven days, as the site's privacy page says; Caddy's own output (its start, certificates and renewals, which Docker keeps by size) names no client. While the api cannot answer (stopped, restarting, failing its health checks), Caddy answers a page with `deploy/maintenance.html` and a program (`/api/...`, `/llms.txt`) with the api's own `503 server_busy`, `Retry-After: 60` exposed to any page (`Access-Control-Allow-Origin: *`); no answer names Caddy (`Server`, `Via`).

### 10.6 Start

```console
$ cd /opt/idtrack-web/deploy
$ sudo docker compose up -d
...
 Container idtrack-web-api-1 Healthy
 Container idtrack-web-caddy-1 Started
$ sudo docker compose ps --format 'table {{.Service}}\t{{.Status}}'
SERVICE   STATUS
api       Up 2 minutes (healthy)
caddy     Up Less than a second
$ curl -s https://<domain>/api/v1/health
{"status":"ok","organisms":["homo_sapiens","macaca_fascicularis","macaca_mulatta","mus_musculus","sus_scrofa"]}
$ curl -sI http://<domain>/ | head -n 1
HTTP/1.1 308 Permanent Redirect
```

`up -d` returns once the api is healthy (Caddy waits for it): on the first `up -d`, which also fetches Caddy's image, it returned after 146 s; the container's check, every 5 s until the api is ready (`start_interval`), sees it within 5 s. Both containers run with a read-only root file system, no new privileges and every capability dropped, Caddy keeping only the binding of ports below 1024 (`deploy/compose.yaml`: Caddy is what the internet talks to). Then the daily check (10.10).

Where the domain has an `AAAA` record, check that a visitor who comes over IPv6 reaches the api as itself: the compose network holds IPv6 (`enable_ipv6`, the private network `fd30:80::/64`), so Docker forwards the published ports to Caddy's IPv6 address and Caddy names the visitor's own address in `X-Forwarded-For`; a client's allowances are then those of its own `/64`. From a machine with IPv6:

```console
$ curl -6 -s https://<domain>/api/v1/health                                  # on the visitor's machine
$ sudo docker compose exec caddy tail -n 1 /data/logs/access.log             # on the server: the visitor's IPv6 address as remote_ip
```

If the line names `172.30.80.1` (the network's gateway) instead, IPv6 reaches Caddy through Docker's proxy, and every IPv6 visitor shares one client's allowances: remove the `AAAA` record until it does (Docker Engine 27 or later with its default `ip6tables`, 10.2). Not rehearsed here (10.12): the machine of the rehearsal had no IPv6 route.

### 10.7 Sizing on this machine

Measured on the machine with the five graphs, through Caddy over https (each request on its own connection, as every request reaches the api through Caddy), for each number of workers on a freshly started server: 46 clients converting identifiers one at a time (with their paths, to release 100; nine or ten clients per organism, each over 400 identifiers of its organism) and 2 clients sending batches of 300 identifiers with paths (each the next 300 of a pool of 20,000 identifiers of one organism, the organism changing at each batch, so that most are not answered from memory), for 3 minutes. Memory from `/api/v1/status` every 2 s: "server" is the PSS summed over its processes (each shared page split among the processes that share it: the server's footprint), "machine" the memory in use on the whole machine (`memory.limit_used_bytes`: total less available; the machine has 16.76 GB).

| Workers | Start (s) | Server after start (GB) | Server at peak (GB) | Machine at peak (GB) | Conversions per s | p50 / p95 / p99 (ms) | Batches p50 / p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 166 | 5.32 | 8.98 | 9.46 | 183 | 215 / 559 / 1,261 | 508 / 915 |
| 3 | 141 | 5.17 | 9.87 | 10.37 | 564 | 77 / 110 / 177 | 602 / 1,086 |
| 4 | 163 | 5.31 | 10.97 | 11.47 | 615 | 74 / 94 / 122 | 625 / 1,067 |
| 6 | 163 | 5.38 | 12.40 | 12.88 | 617 | 75 / 92 / 97 | 651 / 1,098 |

Start: from `docker compose up` to the first answer through Caddy (which checks the api every 30 s: up to half a minute of it; 141 to 166 s). With three workers or more every answer was `200` (102,067 to 111,585 per run); with two, the searches queued behind the batches past the server's estimate of 10 s (`IDTRACK_WEB_QUEUE_SECONDS`), and 479 of 33,659 answers were `503 server_busy`. Past three workers the rate stays near 615 conversions a second: the clients, TLS on a new connection per request and Caddy share the machine's eight vCPU with the server, which used 2.1 to 3.1 cores on average. Caddy's container used at most 79 MiB in any run, its bound 1 GiB (`deploy/vm/compose.vm.yaml`). With three workers for 15 minutes under the same load (514,764 conversions, 572 a second, p50 / p95 / p99 79 / 95 / 140 ms; 2,919 batches; 120 of the 517,683 answers `503 server_busy`), the server's memory rose to 10.42 GB at 5 minutes, 10.99 GB at 10 and 11.13 GB at 15, and the machine's to 11.63 GB: the workers' caches near their bounds (each worker's memory grows with what it answers, up to the bounds of IDTrack's caches and of `IDTRACK_WEB_ANSWER_CACHE_BYTES`).

**The default here is three workers** (`IDTRACK_WEB_WORKERS=3`): with two, conversions wait behind the batches (p95 0.56 s, and some refused as above); three answer what the clients send at a p95 of about 0.11 s, with the machine at 11.6 GB after 15 minutes, 70 % of its memory, leaving room for the system, Docker, Caddy and growth; four are faster at the tail (p99 122 ms against 177) but already used 11.5 GB in 3 minutes, near three quarters of the machine before their caches fill, and six pass three quarters. Each worker beyond adds about 1 GB at the peaks measured.

**Past the memory**, the kernel acts inside the api's container only: `deploy/vm/compose.vm.yaml` bounds it at 12 GiB (`mem_limit`, swap included: 12.9 GB, about three quarters of the machine), so a server that needs more has a process of its own stopped, never the system, Docker, Caddy or an administrator's shell. Rehearsed with the bound lowered to 7 GB and three workers under the load above for 4 minutes: the kernel stopped a worker 13 times (`Memory cgroup out of memory: Killed process ... (idtrack-web)` in `dmesg`), the server replaced each within a second (its log: `Worker (pid:...) was sent SIGKILL! Perhaps out of memory?`, then `Booting worker`), the container never restarted, and 9 requests in progress in a stopped worker were lost (Caddy answered them `502`); `/api/v1/status` counts the stopped workers (`workers_exited`) and reports the bound (`memory.limit_bytes`), and the daily check reports both (10.10). Were the server's master process stopped, the container would exit and Docker start it again (`restart: unless-stopped`), answering after the start's 2.5 minutes.

### 10.8 Reboots, updates and the images' refresh

The service comes back by itself after every reboot: Docker is enabled at boot, and both containers have the restart policy `unless-stopped` (started again unless an administrator stopped them with `docker compose stop` or `down`). Measured: after `sudo systemctl reboot`, SSH answered after 20 s and the site (`https://<domain>/api/v1/health` through Caddy) after 167 s; the machine itself boots in 9.2 s (`systemd-analyze`), the rest is the api loading the graphs, with Caddy answering `503` meanwhile; the daily check then passed.

Security updates of the machine (`deploy/vm/52idtrack-web-unattended-upgrades`), the weekly window for the reboot they may need (`deploy/vm/reboot-if-required.service` and `.timer`), and the weekly refresh of the two images (`deploy/vm/idtrack-web-refresh.service` and `.timer`):

```console
$ cd /opt/idtrack-web
$ sudo install -m 644 deploy/vm/52idtrack-web-unattended-upgrades /etc/apt/apt.conf.d/
$ sudo install -m 644 deploy/vm/reboot-if-required.service deploy/vm/reboot-if-required.timer \
    deploy/vm/idtrack-web-refresh.service deploy/vm/idtrack-web-refresh.timer /etc/systemd/system/
$ sudo systemctl daemon-reload && sudo systemctl enable --now reboot-if-required.timer idtrack-web-refresh.timer
$ systemctl list-timers --no-pager reboot-if-required.timer idtrack-web-refresh.timer | head -n 3
NEXT                          LEFT LAST PASSED UNIT                      ACTIVATES
Thu 2026-12-03 01:22:02 UTC 4 days -         - idtrack-web-refresh.timer idtrack-web-refresh.service
Thu 2026-12-03 02:26:44 UTC 4 days -         - reboot-if-required.timer  reboot-if-required.service
$ sudo unattended-upgrade --dry-run --debug 2>&1 | grep 'Allowed origins'
Allowed origins are: o=Ubuntu,a=resolute, o=Ubuntu,a=resolute-security, o=UbuntuESMApps,a=resolute-apps-security, o=UbuntuESM,a=resolute-infra-security, origin=Docker,label=Docker CE,a=resolute
$ sudo systemctl start idtrack-web-refresh.service    # once now, so that the daily check finds a refresh
$ sudo journalctl --no-pager -o cat -u idtrack-web-refresh.service | tail -n 6
== the containers whose image changed
 Container idtrack-web-api-1 Running
 Container idtrack-web-caddy-1 Running
Total reclaimed space: 0B
SERVICE   STATUS
api       Up 3 minutes (healthy)
```

Ubuntu's `unattended-upgrades` (installed and enabled in Ubuntu's server image) installs every day, between 06:00 and 07:00 UTC, the security updates of Ubuntu and, with this file, the updates of Docker's packages; it never reboots by itself (`Automatic-Reboot "false"`). An update that needs a reboot (a new kernel, the C library) writes `/run/reboot-required`, and `reboot-if-required.timer` reboots the machine on Thursday night, between 03:00 and 03:30 Berlin time (the machine's clock runs in UTC; the timer names its zone), if and only if that file is there. Rehearsed on the machine, whole: `sudo unattended-upgrade -v` installed the 43 packages then pending, among them a new kernel, the C library and Docker's compose plugin (`needrestart` then restarted Docker, and with `live-restore` the containers kept running); `/run/reboot-required` appeared; the window's service, started by hand, rebooted the machine into the new kernel (7.0.0-44), and the site answered again 164 s later. Started with no reboot pending, the service does nothing (`ConditionPathExists=/run/reboot-required was not met`). Where the institute runs the updates and reboots itself, install neither file: the service comes back after any reboot all the same.

What faces the internet is in the two images, which the machine's updates do not reach: Caddy (with Go and its TLS) and the api's base (Debian 13 and Python 3.14, with OpenSSL and the C library). `deploy/vm/refresh_images.sh`, started by `idtrack-web-refresh.timer` on Thursday night between 02:00 and 02:30 Berlin time (before the reboot window), pulls Caddy's newest release of its 2.11 line (`docker.io/library/caddy:2.11`), builds the api's image again from the checked-out release on the newest base (`python:3.14-slim-trixie`, which its publisher rebuilds for each security fix of either; `--pull`), and recreates only a container whose image changed: when nothing changed upstream the build is answered from Docker's cache, gives the same image and stops nothing (rehearsed: 3 s, no container recreated); when the api's image changed, the api starts again, about 2.5 minutes of the maintenance page within the window. It refuses to build when the checkout is not the release `deploy/.env` runs (`refresh: deploy/.env runs ..., but /opt/idtrack-web has ... checked out`), and a failure leaves the running containers as they were and raises the alert of 10.10. The packages of the api's environment are those of the release's lock file: their fixes come with a new version (10.11).

### 10.9 Disk

The 50 GB disk is far from full, and every part that grows is bounded, so the 10 GB the machine allows each month are not used: once every bound is reached (in a few weeks), the service holds at most about 10.5 GB and grows no further. Measured on the machine: the fresh system used 2.3 GB of 48 GB, and everything of 10.2 to 10.10 in place 5.8 GB (2.07 GB of it Docker's build cache).

| What | Measured | Bound |
| --- | --- | --- |
| The system, Docker Engine and its packages | 2.7 GB (0.4 GB of it Ubuntu's downloaded packages, `/var/cache/apt`) | Ubuntu's packages cleaned weekly (`AutocleanInterval`), old kernels removed (`Remove-Unused-Kernel-Packages`) |
| The graph store, `/srv/idtrack-web/store` | 357 MB for the five graphs and their lineages files | A release of graphs adds about 0.36 GB (nothing is ever replaced); `sudo python3 deploy/prune_store.py /srv/idtrack-web/store` lists the graph files and manifests of all but the two newest releases, `--delete` removes them: 0.72 GB |
| The images | 537 MB (the api's), 92 MB (Caddy's) | One api image per version: `sudo docker image prune -f` after an update and after each refresh removes the image no container uses; two while an update runs: 1.3 GB |
| Docker's build cache | 2.07 GB after the first build | What the builds of the last ten days used (`docker builder prune -f --filter until=240h`, after each update and each refresh): the cache of two builds, about 3.2 GB |
| Caddy's access and error logs | 2.1 KB per request (one line per request, its headers included) | A file a day in Caddy's volume (`/data/logs`), rolled at 100 MB, six earlier files kept, compressed with gzip: a line is deleted at most seven days after it was written, as the site's privacy page says; at most 0.7 GB for each of the two logs |
| The containers' logs | 200 bytes per request in the api's log (without the client's address); Caddy's own messages | Five files of 20 MB per container (`deploy/compose.yaml`, `logging`; and for every container, `deploy/vm/docker-daemon.json`): 200 MB in all, about 500,000 requests of the api's log |
| The system journal | 16 MB | 1 GB, at least 5 GB left free, 3 months (`deploy/vm/journald.conf`: `sudo install -D -m 644 deploy/vm/journald.conf /etc/systemd/journald.conf.d/idtrack-web.conf && sudo systemctl restart systemd-journald`); 4 GB without it |
| Caddy's certificates and state | 72 KB | |

The worst case, every bound reached at once: the system 2.7 GB, two api images and Caddy's 1.2 GB, the build cache 3.2 GB, the store of two releases 0.72 GB, Caddy's logs 1.4 GB, the containers' logs 0.2 GB, the journal 1 GB: about 10.5 GB of the 48 GB, with 37 GB free.

**No backup: what lives only on this machine.** The machine is not backed up, and all of it can be made again from this section, but for what only it holds:

- `deploy/.env` and `deploy/idtrack-web.env`: written from the examples with the domain, `COMPOSE_FILE` and the certificate's folder (10.4); with R2, the server's read token (keep it in the owner's password store);
- the certificate and its key, `/etc/idtrack-web/tls/` in way (b): the institute's; keep a copy of the key where the owner keeps secrets, or ask for a new certificate;
- Caddy's volume `caddy-data`: in way (a), the Let's Encrypt account and certificates, obtained again by themselves at the first start of a new machine (within Let's Encrypt's limits of five certificates for one name a week); and the logs of the last seven days, which are not kept anywhere else by design;
- the graph store: made again by publishing the graph files (10.4), which are kept where they were built (the benchmark repository's data root, or R2).

### 10.10 The daily check and its alert

`deploy/vm/check.sh` reads the state of the service, its workers and memory, the disk, the updates, the images' refresh, the certificate, Caddy's logs and the site's `security.txt`, and ends with `check: ok`, or with each problem found and exit status 1: the api not healthy; a worker ended in the last 24 hours (a worker ends only when it is killed, by the memory bound or a crash: `workers_exited` and `last_worker_exit_at` of `/api/v1/status`); the server at 90 % of its memory bound or more (three workers under the sustained load of 10.7 reached 86 %, their caches full); a stop by the kernel at a memory bound in the last 24 hours (`Memory cgroup out of memory` in the kernel's log); the disk 80 % full; a timer or Docker not enabled at boot; a container that runs an older image than its tag now names; the images not refreshed for 30 days; a certificate within 14 days of its end; a log file of Caddy older than seven days, or a line of Caddy's own log that names a client; a `security.txt` that is not served or expires within 30 days (each build writes one that expires a year later, and the weekly refresh does not build anew when nothing changed: a site not updated for eleven months needs a new version, 10.11). `idtrack-web-check.timer` runs it every morning at 08:00 Berlin time, and when it fails (or the weekly refresh does), `idtrack-web-alert@.service` raises the alert (`deploy/vm/alert.sh`): the problems in the journal at priority `err`, a notice every administrator sees at login until a check passes again, and a mail to `IDTRACK_WEB_ALERT_EMAIL` of `deploy/.env` where the machine can send mail (10.1).

```console
$ cd /opt/idtrack-web
$ sudo install -m 644 deploy/vm/idtrack-web-check.service deploy/vm/idtrack-web-check.timer \
    'deploy/vm/idtrack-web-alert@.service' /etc/systemd/system/
$ sudo systemctl daemon-reload && sudo systemctl enable --now idtrack-web-check.timer
$ sudo /opt/idtrack-web/deploy/vm/check.sh
== machine: 7.0.0-43-generic, up since 2026-11-28 13:36:10
...
== workers and memory
workers: 3 of 3 alive; 0 ended since the server started (the last: -)
memory: the server's footprint 4925 MiB of its bound 12288 MiB (0.401)
the kernel's stops for want of memory in the last 24 h: 0
== disk
/dev/vda1        48G  5.8G   42G  13% /
...
== images
...
api: idtrack-web:0.1.3, built 2026-11-28T13:37:49.304508319Z
caddy: docker.io/library/caddy:2.11, built 2026-11-05T19:37:08.620385055Z
the images last refreshed: 2026-11-28T13:42:36Z (0 days ago)
== certificate
idtrack.example.org: valid until Feb 26 12:07:12 2027 GMT (89 days)
== logs and the site's own files
...
lines of Caddy's own log that name a client: 0
security.txt: expires 2027-11-27T00:00:00Z (363 days)
check: ok
```

Rehearsed: with the api stopped, the check's service failed and its alert wrote to the journal and the login notice; at the next login over SSH, after Ubuntu's own lines:

```console
*** idtrack-web on idtrack-vm: idtrack-web-check.service failed at 2026-11-28 13:42 UTC ***
check: the api is not healthy: 'not running' (docker compose logs api)
check: /api/v1/status could not be read
check: /.well-known/security.txt is not served
(sudo journalctl -u idtrack-web-check.service; this notice goes once sudo /opt/idtrack-web/deploy/vm/check.sh passes)
```

With the api started again, the check passed and the notice was gone. The same run showed the logs' rule: after five downloads broken off after 100 bytes, a batch whose client went away and a request in plain http to the https port, Caddy's own log held no line naming a client and its errors file five (`http.handlers.reverse_proxy`, `aborting with incomplete response`, each with the client's address). Every compose combination of `compose.env.example` passed `docker compose config`, the three Caddy files `caddy validate`, and the units `systemd-analyze verify`.

### 10.11 Updating

- **A new version of the web app** (a release tag): `cd /opt/idtrack-web && sudo git fetch --tags && sudo git checkout v<version> && sudo deploy/build_image.sh <version> docker`; set `IDTRACK_WEB_IMAGE=idtrack-web:<version>` in `deploy/.env`; compare `deploy/vm/idtrack-web.env.example`, `deploy/idtrack-web.env.example` and `deploy/compose.env.example` with the files on the machine for new settings (the release's changes name them); then, where the release reads a new layout of the store (the release's changes say so; a server started on the old store refuses it with what to do, 10.12), publish the store again before the new image starts (below); `cd deploy && sudo docker compose up -d` (the api restarts: about 2.5 minutes, Caddy answering `503` with its maintenance page meanwhile, and a program with the api's own `503 server_busy`); then `sudo docker image prune -f && sudo docker builder prune -f --filter until=240h`. The weekly refresh builds the release checked out, so the checkout and `IDTRACK_WEB_IMAGE` change together.
- **Publishing the store again** from the graph files it holds, with the image of the new version (its graphs unchanged, their lineages files and manifest written as that version reads them):

  ```console
  $ sudo docker run --rm --user 0:0 -v /srv/idtrack-web/store:/srv/store idtrack-web:<version> publish --directory /srv/store \
      $(python3 -c "import json; print(' '.join('--graph /srv/store/' + g['file']['key'] for g in json.load(open('/srv/idtrack-web/store/idtrack/6/manifest.json'))['graphs']))")
  ```

  Rehearsed with a store of layout 1 (the manifest the version before lineages files wrote): the api refused it at start (10.12) and Docker restarted it; publishing again from the store's own graph files took 81 s; the api then started on it.
- **A new release of graphs**: publish it into the store (10.4), then `sudo docker compose restart api`; once the server runs it, `deploy/prune_store.py` (10.9) frees the files of the releases before the previous one (rehearsed with three releases: it kept the two newest and the files they name, and removed the rest).
- **A setting**: edit `idtrack-web.env` or `.env`, then `sudo docker compose up -d` (it recreates what changed).

### 10.12 Troubleshooting, and what was not rehearsed

| What you see | Why, and what to do |
| --- | --- |
| `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock` | Docker's commands need root: `sudo` |
| `required variable IDTRACK_WEB_DOMAIN is missing a value` | `deploy/.env` is missing, or compose ran outside `deploy/`: `cd /opt/idtrack-web/deploy`, then `sudo docker compose ...` |
| `... is not a graph this idtrack reads: ... PermissionError` when publishing | The publication ran as the image's user: `--user 0:0` (10.4) |
| `sudo docker compose ps` shows the api `Restarting (2)`; its log: `The manifest idtrack/6/manifest.json in the folder /srv/store is of layout 1, which names no lineages file of each graph; this server reads layout 2. Publish the graphs again ...` | The store was published by a version before lineages files: publish it again with the running version's image (10.11), then `sudo docker compose restart api` |
| The api's log: `The lineages file of <organism> that the manifest names cannot be used (...)` | The lineages file is missing or damaged: publish the store again (10.11) |
| Caddy answers `502`, its log says `cannot assign requested address` | Caddy ran out of local ports for its connections to the api (one per request, each held 60 s by TCP afterwards; measured at 560 requests a second without the remedy): `deploy/compose.yaml` sets `net.ipv4.tcp_tw_reuse` and a wider port range in Caddy's container, and `deploy/systemd/60-idtrack-web.conf` on a machine without containers (section 12) |
| Caddy answers `503` (its maintenance page) for about 2.5 minutes after a start, an update, a refresh that changed the api's image, or a reboot | The api is loading the graphs (10.7); `sudo docker compose ps` shows `health: starting` |
| A notice at login, `*** idtrack-web on <machine>: idtrack-web-check.service failed at ... ***`, with the problems | The daily check found them (10.10); `sudo journalctl -u idtrack-web-check` gives the whole check; the notice goes once `sudo /opt/idtrack-web/deploy/vm/check.sh` passes |
| `refresh: deploy/.env runs 'idtrack-web:<version>', but /opt/idtrack-web has '...' checked out` | The checkout and `IDTRACK_WEB_IMAGE` disagree: finish the update (10.11) |
| What a visitor did, from their address and time | Caddy's access log, seven days kept: `sudo docker compose exec caddy sh -c 'cat /data/logs/access.log; zcat /data/logs/access-*.gz'`; the api's line of the same request has its id (`X-Request-ID` in the access line's answer headers); a request Caddy could not finish (the client broke off, the api failed), in `errors.log` beside it |
| Let's Encrypt fails (`sudo docker compose logs caddy`: `challenge failed`, a timeout) | The domain does not point at the machine, or 80 and 443 are closed from outside (10.1) |
| `Forbidden: this server answers the institute's proxy only.` (`403`) | Way (c): the request did not come from an address of `IDTRACK_WEB_TRUSTED_PROXIES` |
| Every client limited as one (`429 rate_limited`) behind the institute's proxy | The proxy's address is missing from `IDTRACK_WEB_TRUSTED_PROXIES`, or the proxy sends no `X-Forwarded-For` |
| Every IPv6 visitor logged as `172.30.80.1`, and limited as one | IPv6 reaches Caddy through Docker's proxy rather than the network's own IPv6 (10.6): a Docker Engine before 27, or `ip6tables` turned off in `/etc/docker/daemon.json`; until fixed, publish no `AAAA` record |
| `dmesg`: `Memory cgroup out of memory: Killed process ... (idtrack-web)` | The server reached its 12 GiB: fewer workers (10.7) or fewer organisms (`IDTRACK_WEB_ORGANISMS`) |

Not rehearsed: the institute's DNS, firewall and reverse proxy themselves (way (c) was run with the machine's host as the proxy), a certificate from Let's Encrypt (no public name), visitors over IPv6 (10.6: how to check it on the machine), the alert's mail (the machine had no mail transfer agent), and a refresh in which Caddy's or the base's publisher had released a new image (the refresh ran when neither had). Everything else in this section ran on a machine of this size from Ubuntu's own image.

## 11. Deploy on the Hetzner node

1. **The node**: Ubuntu 24.04 LTS, Docker Engine with the compose plugin (`https://docs.docker.com/engine/install/ubuntu/`); firewall open on 22, 80 and 443 only; a DNS `A` (and `AAAA`) record of the domain pointing at the node.
2. **The image**, built where the repository is (or in CI) and copied to the node, or built on the node:

   ```console
   $ git checkout v0.1.3 && deploy/build_image.sh 0.1.3 docker          # or podman
   ...
   Successfully tagged localhost/idtrack-web:0.1.3          (podman's words; Docker prints `naming to ...idtrack-web:0.1.3`)
   ```
   The image (368 MB) holds the api and its environment and the built frontend (section 14.8); no graph and no credential. Its default command is `idtrack-web serve`, as user `idtrack-web` (uid 10001), with a health check on `/api/v1/health`.
3. **Configuration** on the node, never in git: `cp deploy/idtrack-web.env.example deploy/idtrack-web.env`, fill in the R2 read token (or `IDTRACK_WEB_SOURCE=directory` with the store mounted from `IDTRACK_WEB_STORE`); `cp deploy/compose.env.example deploy/.env`, set `IDTRACK_WEB_IMAGE`, `IDTRACK_WEB_DOMAIN` and `COMPOSE_FILE=compose.yaml` (the overrides of `deploy/vm/` are the virtual machine's); `chmod 600 deploy/idtrack-web.env deploy/.env`. Docker's settings of section 10.3 (`deploy/vm/docker-daemon.json`) suit the node as well.
4. **Start**:

   ```console
   $ cd deploy && sudo docker compose up -d          # compose reads deploy/.env
   $ sudo docker compose ps                         # api: healthy (after the graphs are loaded), caddy: running
   $ curl -s https://<domain>/api/v1/health
   {"status":"ok","organisms":["homo_sapiens","macaca_fascicularis","macaca_mulatta","mus_musculus","sus_scrofa"]}
   $ curl -s https://<domain>/api/v1/version          # IDTrack's version and commit, every graph's SHA-256 and digest
   ```
   Caddy obtains the TLS certificate from Let's Encrypt on first start (ports 80 and 443 must reach the node) and renews it; it compresses what the api did not, adds HSTS, gives a client 10 s to send a request's head and 30 s for its body, reads a body whole (at most 2 MB) before it passes the request on (so a slow upload holds Caddy's buffer, never an api worker), refuses a head over 64 KB, and passes the client's address and scheme to the api, which trusts them from Caddy's network only; every other header (the Content-Security-Policy and the other security headers, CORS, caching) is the api's. The api closes each connection after its answer, so that every request is routed afresh (README.md, "How it runs"): Caddy opens one connection to the api per request, while a browser keeps its own connection to Caddy (HTTP/2) as with any site. Caddy's health check (`health_uri`, every 30 s, 10 s to answer, the api marked down after 3 failures in a row) and the container's (4 s to answer) are answered at once by whichever worker takes them, even while every worker is in a search (README.md, "How it runs", gives the measured times). A client that stops reading an answer stops Caddy reading it from the api, whose own deadlines then close the connection (README.md, "Bounds"). The api container runs read-only, without capabilities, with the graph cache on a named volume.
5. **A new release of graphs**: publish it (section 7), then `sudo docker compose restart api` in `deploy/`; the server fetches what is new, verifies, loads, and becomes healthy again (Caddy holds requests to a server that is not healthy). **A new version of the api**: build and tag the image, set `IDTRACK_WEB_IMAGE` in `deploy/.env`, `sudo docker compose up -d`, then `sudo docker image prune -f && sudo docker builder prune -f` (section 10.9).

Verified (IDTrack 0.1.0): the image built with rootless podman 5.8 on a machine without subordinate user ids (`PODMAN_OPTIONS="--cgroup-manager cgroupfs --root <local disk> --runroot <local disk> --storage-driver overlay --storage-opt overlay.ignore_chown_errors=true" BUILD_OPTIONS="--build-arg SINGLE_ID_BUILDER=true" deploy/build_image.sh 0.1.0 podman`; run there with `--user 0:0`), and run as compose runs it (read-only, all capabilities dropped, no new privileges):

- **A folder store** (the node's case): all five graphs; `scripts/check_endpoints.py` against it for each organism, 2,003 to 2,088 requests, 2,466 answers compared with IDTrack each, no failure; the end-to-end tests (section 14.6, `E2E_DATA=pig`) against it in Chromium and in Firefox (`E2E_BROWSER=firefox`), 156 passed and 12 skipped each.
- **An S3-compatible store** (the R2 case, a local moto server standing in for R2): pig and human published with `idtrack-web publish --s3`, the credentials given as files (`IDTRACK_WEB_S3_ACCESS_KEY_ID_FILE`, `IDTRACK_WEB_S3_SECRET_ACCESS_KEY_FILE`); the server fetched both, verified and loaded them, and on a restart verified its cached copies without fetching; `scripts/check_endpoints.py` for both organisms, no failure.
- **Behind Caddy** (`docker.io/library/caddy:2.11.9` with `deploy/Caddyfile`, in one pod with the api, `IDTRACK_WEB_DOMAIN=localhost`, for which Caddy issues its own certificate): HTTPS with HSTS and the security headers, `http://` redirected (308), the page compressed (zstd), a body over 2 MB refused by Caddy (413, no body) and one over the api's 1 MiB by the api (413 `payload_too_large`), the client's address passed to the api's log.

Not run there: `docker compose` itself (no Docker daemon and no compose provider for podman; Docker Engine and Compose ran the same files on the virtual machine of section 10), and a certificate from Let's Encrypt (no public domain). On the node, after step 4: `sudo docker compose ps` (api healthy), `curl -sI https://<domain>/` (HTTP/2 200 with `strict-transport-security`), `curl -sI http://<domain>/` (308 to `https://`), and, from a machine with the api's environment, `uv run --no-sync python ../scripts/check_endpoints.py https://<domain> sus_scrofa` (no failure; the default rate limit of 120 requests per minute applies, so run it with `IDTRACK_WEB_RATE_PER_MINUTE=0` set on the node for the check, then remove it).

## 12. Deploy without containers

The server under systemd and Caddy from its own package, on Ubuntu 26.04 (run as written on a fresh machine of section 10's size, as an administrator with `sudo`; 5 to 6 minutes from the first command to the site answering):

```console
$ sudo apt-get update && sudo apt-get install -y git curl ca-certificates xz-utils gnupg debian-keyring debian-archive-keyring apt-transport-https
$ sudo useradd --system --home-dir /opt/idtrack-web --shell /usr/sbin/nologin idtrack-web
$ sudo install -d -m 755 /opt/idtrack-web /srv/idtrack-web/store
$ curl -LsSf https://astral.sh/uv/0.11.28/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
$ sudo git clone https://github.com/theislab/idtrack-web.git /opt/idtrack-web/src && cd /opt/idtrack-web/src && sudo git checkout v0.1.3
$ cd /opt/idtrack-web/src/api && sudo env UV_PROJECT_ENVIRONMENT=/opt/idtrack-web/venv UV_PYTHON_INSTALL_DIR=/opt/idtrack-web/python \
    uv sync --locked --no-dev --no-editable
$ /opt/idtrack-web/venv/bin/python -c "import sys, idtrack, idtrack_web_api; print(sys.version.split()[0], idtrack.__version__, idtrack_web_api.__version__)"
3.14.4 0.1.2 0.1.2
```

uv takes the Python 3.14 of Ubuntu 26.04 (`/usr/bin/python3.14`, which every user can run); `UV_PYTHON_INSTALL_DIR` keeps a Python uv would download in `/opt`, where the service can read it, and not in root's home. The frontend is built once with Node 24.22.3 (section 14.1; Ubuntu's own Node is 22) and copied to the folder the unit serves:

```console
$ curl -fsSL https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.xz | sudo tar -xJ -C /opt/idtrack-web
$ cd /opt/idtrack-web/src/web && sudo env PATH=/opt/idtrack-web/node-v24.22.3-linux-x64/bin:/usr/bin:/bin sh -c 'npm ci --no-audit --no-fund && npm run build'
$ sudo cp -r dist /opt/idtrack-web/web
```

The graphs (section 7, or as in 10.4 with the environment's own command): `sudo /opt/idtrack-web/venv/bin/idtrack-web publish --directory /srv/idtrack-web/store --graph <graph.npz> ...`. The configuration, the service and Caddy:

```console
$ sudo install -d -m 750 /etc/idtrack-web
$ sudo install -m 600 /opt/idtrack-web/src/deploy/idtrack-web.env.example /etc/idtrack-web/idtrack-web.env
$ sudo nano /etc/idtrack-web/idtrack-web.env    # IDTRACK_WEB_SOURCE=directory, IDTRACK_WEB_DIRECTORY=/srv/idtrack-web/store, IDTRACK_WEB_PUBLIC_URL=https://<domain>, IDTRACK_WEB_HTTPS_ROUTE=lets_encrypt; the S3 lines commented out
$ sudo install -m 644 /opt/idtrack-web/src/deploy/systemd/idtrack-web.service /etc/systemd/system/
$ sudo systemctl daemon-reload && sudo systemctl enable --now idtrack-web
$ curl -LsSf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
$ curl -LsSf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
$ sudo apt-get update && sudo apt-get install -y caddy && caddy version
v2.11.9 h1:bhZtcRKQOq0fuLvEgCdPYvUxXyGn9kzjG4lh2332DTE=
$ sudo install -D -m 644 /opt/idtrack-web/src/deploy/systemd/caddy-idtrack-web.conf /etc/systemd/system/caddy.service.d/idtrack-web.conf
$ sudo sed -i 's/<domain>/<the domain>/' /etc/systemd/system/caddy.service.d/idtrack-web.conf
$ sudo install -m 644 /opt/idtrack-web/src/deploy/Caddyfile /opt/idtrack-web/src/deploy/maintenance.html /etc/caddy/
$ sudo install -m 644 /opt/idtrack-web/src/deploy/systemd/60-idtrack-web.conf /etc/sysctl.d/ && sudo sysctl --system
$ sudo systemctl daemon-reload && sudo systemctl restart caddy
$ curl -s https://<domain>/api/v1/health
{"status":"ok","organisms":["homo_sapiens","macaca_fascicularis","macaca_mulatta","mus_musculus","sus_scrofa"]}
```

Caddy comes from Caddy's own repository: Ubuntu 26.04's package (Caddy 2.6.2) refuses `deploy/Caddyfile` (`unrecognized subdirective request_buffers`). The kernel settings of `60-idtrack-web.conf` are those the compose file gives Caddy's container (local ports reused after a closed connection, a wider range of them): without them Caddy answers `502` past about 470 requests a second, since the api closes every connection. The drop-in `caddy-idtrack-web.conf` gives Caddy the domain, the api's address on this machine (`IDTRACK_WEB_UPSTREAM=127.0.0.1:8000`, in place of the compose service `api`) and the folder of its access and error logs (`IDTRACK_WEB_LOG_DIR=/var/log/caddy`, which Caddy's package makes; seven days kept, as in a container); the Caddy files of section 10.5 serve the same way (for (b), with the certificate's paths in their `tls` line). The unit runs the server as `idtrack-web` with a read-only system and a writable cache folder only, the built frontend from `/opt/idtrack-web/web` (`IDTRACK_WEB_STATIC_DIR`), and restarts it after any exit (`Restart=always`); both services are enabled at boot. Measured there: the service answered 130 s after `enable --now` (two workers, five graphs) and the site 167 s after a reboot; a worker stopped with `SIGKILL` (as the kernel stops one for want of memory) was replaced by the server while the service stayed up (`OOMPolicy=continue`), and the server itself stopped so was started again by systemd, answering 154 s later. Bound its memory as section 10.7 does the container's: `sudo systemctl set-property idtrack-web MemoryMax=12G` (12 GiB; applied at once, kept across reboots). Updates, the reboot window and the journal's bounds of section 10 apply unchanged; the images' refresh and the daily check of section 10 read the containers and do not apply: read `systemctl status idtrack-web caddy` instead, and update Caddy, whose repository the unattended upgrades do not name, by hand (`sudo apt-get update && sudo apt-get install --only-upgrade caddy`).

## 13. Troubleshooting

| What you see | Why, and what to do |
| --- | --- |
| `idtrack-web: IDTRACK_WEB_SOURCE=None; set it to one of directory, s3.` (exit 2) | The configuration is missing; section 6 |
| `idtrack-web: Unknown variables (a misspelling?): IDTRACK_WEB_WORKER. Known: ...` | A misspelt variable |
| `idtrack-web: idtrack/6/manifest.json cannot be read from the bucket ...: NoSuchKey (...)` | Nothing published for this graph format; publish (section 7), or set `IDTRACK_WEB_MANIFEST_KEY` |
| `idtrack-web: idtrack/6/<organism>/<sha>.npz: the SHA-256 of <path> is ...; the manifest says ...` | A damaged file: in a folder store, copy it again; in a bucket, the object was replaced behind the publisher's back: publish again |
| `idtrack-web: The manifest ... lists graphs of format version 2; this idtrack reads format version 6.` | Graphs built by another IDTrack; publish graphs built by this one |
| `... is not the graph the manifest names: {...}` | The manifest and the file disagree (organism, snapshot, digest): publish again |
| `The manifest ... is of layout 1, which names no lineages file of each graph; this server reads layout 2. ...` | A store published before lineages files: publish the graphs again (section 7) |
| `The lineages file of <organism> that the manifest names cannot be used (...)` | The lineages file is missing or damaged: publish the graphs again (section 7) |
| `uv sync --locked` fails: `The lockfile ... needs to be updated` | `pyproject.toml` changed without `uv lock` (section 3) |
| A test fails in `test_openapi.py`: `api/openapi.json is not what the app generates` | Regenerate it (section 5), and the frontend's types from it |
| Answers `429 rate_limited` from one address for every user | The proxy's address is not in `IDTRACK_WEB_FORWARDED_ALLOW_IPS`, so every request counts as the proxy's; the message says which allowance was used up (searching requests, other requests, or seconds of search) |
| `503 request_budget_exceeded` | A request needed more than `IDTRACK_WEB_REQUEST_SECONDS`, waiting for a worker or searching: under load, more workers; for one large batch, fewer identifiers per request |
| `503 server_busy` | Every worker was in a search and `IDTRACK_WEB_QUEUE_MAX` times the workers searches already waited for one, or a worker held `IDTRACK_WEB_SENDING_MAX_BYTES` of answers its clients had not taken; more workers, or fewer clients that read slowly |
| `429 rate_limited` with `allowance` `concurrent_searches` | The client already had `IDTRACK_WEB_RATE_CONCURRENT_SEARCHES` searching requests in progress; send the next when one has been answered |

## 14. The frontend

The frontend (`web/`) is a TypeScript and React application built with Vite: its own components (no UI kit), the path view drawn in SVG with d3 for scales and zoom. It talks to the api only at `/api/v1` of its own origin and shares nothing with the api but `api/openapi.json`, from which its types are generated. Its visual direction and the path view: [web/DESIGN.md](web/DESIGN.md).

| Path | What |
| --- | --- |
| `web/src/` | The application: `api/` (the client, the generated types `schema.ts` and the shapes of the answers `shapes.ts`), `lib/` (the path view's model, layout and reading, the words for the api's codes, numbers as the api writes them), `components/`, `pages/`, `styles/` (the design tokens and the page's styles) |
| `web/tests/` | Unit tests (Vitest), with `fixtures/`: real answers of the api recorded from the pig and human graphs |
| `web/e2e/` | End-to-end tests (Playwright, headless Chromium), with `data/<graph>.json`: the identifiers each flow uses on a graph |
| `web/scripts/` | The type generator, the build-size report, and `fixtures/` (the scripts that record the fixtures) |
| `web/package.json`, `web/package-lock.json` | The packages, exact versions; install only with `npm ci` |

### 14.1 The Node toolchain

The version is Node.js 24.22.3 (LTS), with the npm it ships (11.19.1): `web/.nvmrc`, `web/environment.yml` (for mamba or conda), `engines` in `web/package.json` and the image's `NODE_IMAGE` name it. Install it in one of these ways, never with a system package of another version; the first needs nothing but `curl` and `tar` (Linux on x86-64; other systems: the matching file of `https://nodejs.org/dist/v24.22.3/`):

```console
$ curl -fsSL https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.xz | tar -xJ -C <folder> && export PATH=<folder>/node-v24.22.3-linux-x64/bin:$PATH   # the official archive
$ mamba env create -p <env folder> -f web/environment.yml && export PATH=<env folder>/bin:$PATH   # with mamba or conda (conda-forge)
$ cd web && nvm install      # with nvm already installed (https://github.com/nvm-sh/nvm): it reads web/.nvmrc
$ node --version && npm --version
v24.22.3
11.19.1
```
 Network: HTTPS to `registry.npmjs.org` (packages) and, for the end-to-end tests, to Playwright's download host (Chromium).

Notes on the tools' versions (every version is exact in `web/package-lock.json`):

- **ESLint stays at 9** (9.39.5), which npm marks as no longer supported: the accessibility lint, `eslint-plugin-jsx-a11y` 6.10.2, accepts no ESLint after 9, and the page's accessibility rules matter more than the newer ESLint. It is a development tool only; move to ESLint 10 when that plugin accepts it.
- **TypeScript stays at 5.9**: `openapi-typescript` (which generates the api's types) and `typescript-eslint` accept no TypeScript 6 or 7 yet.
- **`npm audit`** reports advisories in `picomatch` and `minimatch`, used by Vite, Vitest and ESLint at build and test time, for which no fixed version exists; nothing of them is in the built page (`npm audit --omit=dev`: found 0 vulnerabilities).

### 14.2 Install

```console
$ cd web
$ npm ci
npm warn deprecated eslint@9.39.5: This version is no longer supported. ...
added 395 packages, and audited 396 packages in 1m
...
7 moderate severity vulnerabilities
$ npm audit --omit=dev
found 0 vulnerabilities
```

From an empty npm cache this took 1.5 minutes. `npm ci` installs exactly `package-lock.json` and fails if it disagrees with `package.json`. Two warnings are known and accepted (14.1): the deprecation notice of ESLint 9, and the advisories `npm audit` reports in development tools; nothing of them reaches the built page (`--omit=dev`: none). A package is added with `npm install --save-exact <package>@<version>` and the lock file committed with it; the versions of this lock were chosen at least two weeks old (`npm install --before=<date>`).

### 14.3 The api's types and IDTrack's limitations

`web/src/api/schema.ts` (the types) and `web/src/api/shapes.ts` (the shape of every answer: its fields and their JSON types) are generated from `api/openapi.json` and never edited. The client checks every JSON answer against its endpoint's shape before a page reads it (`web/src/api/shape.ts`), so that an answer of another form is stated as "an answer the page cannot read", never a page that breaks; enumerations are not part of a shape, so a code the document does not list yet is shown as itself.

```console
$ npm run types:check            # CI runs it: both files must be what the document gives
src/api/schema.ts matches api/openapi.json
src/api/shapes.ts matches api/openapi.json
$ npm run types                  # after a change of api/openapi.json (section 3, 5), then commit them
wrote src/api/schema.ts from api/openapi.json
wrote src/api/shapes.ts from api/openapi.json
```

A change of IDTrack's results changes the document, then the types and the shapes; `npm run typecheck` shows every place the frontend must follow, and the fixtures are recorded again (14.7): every recorded answer must have its endpoint's shape (`web/tests/shell.test.tsx`).

The answer's evidence cites the known limitations of IDTrack in IDTrack's own words: `web/src/generated/limitations.json`, generated from the section "Limitations" of IDTrack's `docs/limitations.rst` at the documentation commit, the same commit as `web/src/generated/idtrack_docs.json` (the Method page's text): the commit of `api/uv.lock`, or a later commit of IDTrack whose changes since it touch only `docs/` and `README.rst`, which the generator checks and otherwise refuses. One item per limitation, the section's subsections: the lead sentence that opens it, which IDTrack writes in bold, its title and anchor, with a link to the section at that commit. The file is never edited; a unit test fails while it names another code commit than `api/uv.lock` or another documentation commit than `idtrack_docs.json`:

```console
$ npm run limitations:check      # CI runs it: the file must be what idtrack's page at the pinned commit gives
src/generated/limitations.json matches idtrack 8ebaaa18491e (26 items)
$ npm run limitations            # after a change of the idtrack commit (section 3), then commit the file
$ npm run limitations -- --from <checkout of idtrack> [--docs-commit <sha>]   # the same from a local checkout, offline
```

The same holds for what the pages quote from IDTrack's documentation (the citation, the data sources, what each database name holds, the assembly changes Ensembl maps, the mapping score, the version events, the limitations, what each count of a build is): `web/src/generated/idtrack_docs.json`, made by `npm run idtrack-docs` (or `-- --from <checkout>`), checked by `npm run idtrack-docs:check` in CI. It is read at the pinned commit or at a later commit of IDTrack whose changes since it are documentation only (`-- --docs-commit <sha>`; the generator verifies that the changes touch only `docs/` and `README.rst`, and keeps the commit until the pin changes), so that the pages quote the documentation IDTrack has written since the release for the same code. The benchmarks' rates on the Method page are `web/src/generated/benchmarks.json`, made from `idtrack-reproducibility`'s published results at one commit (`npm run benchmarks -- --commit <sha>`, or `-- --from <checkout>` for a local clone at its HEAD) and checked by `npm run benchmarks:check` in CI against the files of the commit it names; make it again when that repository publishes new results.

Both read the page from `raw.githubusercontent.com` at the pinned commit (or the file given), and stop on a limitation that does not open with a lead sentence in bold, so the file holds one item per limitation of the page. A unit test fails while the file names another commit than `api/uv.lock`.

### 14.4 Checks and tests

Every check of the frontend, in one run: `npm run check` runs them in order, each whatever the ones before found, prints each one's own report, then a table (the check, its result, what it counted, how long it took), and ends with exit status 1 when any failed (`npm run check -- --only eslint,knip` runs the checks named). `scripts/check.sh` at the repository's root runs the api's checks (section 5) and then this one, with one table of both. CI runs the same checks, each a step of its own (`.github/workflows/web.yml`).

```console
$ npm run check
...
The frontend's checks (web/):
check         result  count                  time
------------  ------  ---------------------  -------
types         pass    current                ...
limitations   pass    current                ...
idtrack-docs  pass    current                ...
benchmarks    pass    current                ...
licences      pass    current                ...
icons         pass    current                ...
prettier      pass    0 files                ...
names         pass    0 bare names           ...
eslint        pass    0 errors, ... warnings of ... allowed ...
stylelint     pass    0 problems             ...
typecheck     pass    0 errors               ...
knip          pass    0 findings             ...
unit tests    pass    ... passed             ...

Every check passed.
```

(The counts and times are the tree's and the machine's: the table states them on each run, so they are not quoted here.)

| Check | What it holds the code to |
| --- | --- |
| `types`, `limitations`, `idtrack-docs`, `benchmarks` | The generated files (`src/api/schema.ts`, `src/api/shapes.ts`, `src/generated/*.json`) are what their sources give (section 14.3); the last three read IDTrack's documentation and the benchmarks' results from GitHub. |
| `licences` | `src/generated/licences.json` and `public/licences/` are the packages of the production bundle and their licence texts: `scripts/licences.ts` builds the site in memory with Vite and lists every package of `node_modules` whose code or fonts the bundle holds, with its version, its licence as it declares it and its licence text as it ships it (the licences page shows them; `npm run licences` writes them after a change of the dependencies). |
| `maintenance` | `deploy/maintenance.html` holds the site's faces (the latin files of Inter and Source Serif 4, written into its one style, since nothing can be fetched while the api is down) and the three Caddy files allow that style by its hash: `npm run maintenance` writes both after a change of the page or of the faces. |
| `icons` | The icons and the card in `public/` (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `social-card.png`) are what `scripts/icons.ts` renders from the mark (`src/components/logoPaths.ts`), Inter (the name, as the masthead sets it) and Source Serif 4: `scripts/icons.lock.json` records the digest of those sources and of each file, so the check needs no browser; `npm run icons` renders them again with Playwright's Chromium after a change of the mark. |
| `prettier` | One format for every file (`.prettierrc.json`). |
| `names` (`scripts/names.ts`) | The name is IDTrack in every text a person reads, `idtrack` only as code: the pages' words (every JSX text of `src/` and the attributes read or heard: `title`, `alt`, `aria-label`, `aria-description`, `placeholder`, outside `<code>`, `<pre>`, `<kbd>`, `<samp>` and `Mono`) and every Markdown file of the repository (outside code spans and blocks, link targets, addresses, tags and quotations); code is also the name joined to a path, an address, a package, a command or a header (`idtrack-web`, `idtrack.API`). The texts the api serves are held to the same rule by `api/tests/test_names.py`. |
| `eslint` (`eslint.config.js`) | typescript-eslint's `strictTypeChecked` and `stylisticTypeChecked` with the type checker; a `switch` over a union names every member (`switch-exhaustiveness-check`); React's rules of hooks and of a pure render (`eslint-plugin-react-hooks`, with the React Compiler's checks) and of JSX (`@eslint-react`'s strict set: keys, props declared and not read, context values made anew each render, default props made anew each render, leaked conditional rendering); accessibility (`jsx-a11y`, strict); imports (`import-x`: no cycle, no module importing itself, no module imported twice); no text set as HTML (`innerHTML`, `insertAdjacentHTML`, `document.write`); a directive that turns a rule off names the rule and says why on its line (`-- reason`), and one that turns off nothing is an error. Every rule is an error, but two guards of size, which are warnings: a function of cyclomatic complexity over 30, or of more than 300 lines. Their number is bounded: the check fails past `ESLINT_MAX_WARNINGS` of `web/scripts/check.ts`, the count the code has, so a new one fails while the old ones are split (the bound is lowered as they are, never raised). Each rule turned off says why in the config. |
| `stylelint` (`stylelint.config.js`) | `stylelint-config-standard` (unknown properties and invalid values, duplicate selectors and properties, empty blocks, deprecated properties, shorthands), with BEM-like class names and the code's own conventions; each rule changed says why in the config. |
| `typecheck` | TypeScript, `strict` with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, unused locals and parameters, no unreachable code or unused labels (`tsconfig.base.json`), for the app (`tsconfig.app.json`), the tests, end-to-end tests and configs (`tsconfig.node.json`, the JavaScript configs with `checkJs`) and the scripts (`tsconfig.scripts.json`). The scripts are TypeScript that Node runs as it is (type stripping: `node scripts/<name>.ts`, `erasableSyntaxOnly`), so the functions the unit tests import from them have one source and no declaration file to keep beside it. |
| `knip` (`knip.json`) | No file, export, type or dependency that nothing uses. |
| `unit tests` | Vitest (below). |

```console
$ npm run build                  # into web/dist
✓ built in ...
$ npm run size
   ...
   ... KiB   ... KiB gzip  all files (..., source maps left out)
   ... KiB   ... KiB gzip  loaded by every page before its own scripts (... files: the page, the files it names, the Latin faces of its fonts)
   ... KiB   ... KiB gzip  scripts loaded when a page needs them (...; the largest ... KiB)
```

`npm run size` lists every file of the build, raw and compressed, then three totals: all files (source maps left out); what every page loads before its own scripts, which is `index.html`, every file it names (its script, the scripts it preloads, its style) and the Latin faces of its three fonts at their normal style (what a page in English draws); and the scripts loaded only when a page needs them (each page's own, the figures). A visit transfers the first total, the scripts of the page visited and the answers of the api it asks (the home: its figure's script and `/showcase`; and a font's italic face where the page sets italic type): measure it in a browser (the network panel, or Lighthouse), on the build being shipped. The largest file stays under Vite's warning of 400 kB.

What the unit tests prove, on 130 recorded conversions of the real pig and human graphs of format 6 (120 with a path, holding every reason of step but a final step through a transcript of another release and a refused step, every place relation of a graph file and every bridge rule but two; web/DESIGN.md, "Accuracy"): each candidate's drawn path is its api path then final path, step for step, a continuous line at the releases the api gives; every score shown is the api's own text (compared with the raw JSON; floats are written as Python writes them, checked on 114 values); the reading lists every step of every candidate in order; the deciding criterion is shown between the pair IDTrack compared, with every field it compares; every bridge considered, refused step, other reading and reason is listed with its values; a field the api's document does not name is kept and shown; the limitations on the Method page are those of the pinned IDTrack commit; every status, reason, step reason, criterion and error code of the answers has its entry in the api's vocabulary, read as served; no value is shown in a programming language's spelling; the four hues of the path view stay apart for colour-blind readers and at contrast in both themes.

### 14.5 Run locally

With the api running (section 8) on `127.0.0.1:8000`, either:

- **Development** (reloads on every change): Vite serves the page and forwards `/api` to the api.

  ```console
  $ IDTRACK_WEB_API=http://127.0.0.1:8000 npm run dev
    VITE v8.3.5  ready in ... ms
    ➜  Local:   http://127.0.0.1:5173/
  ```
- **As in production**: the api serves the built page itself (`IDTRACK_WEB_STATIC_DIR`), at the same address as the api.

  ```console
  $ npm run build
  $ cd ../api && IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=<store> IDTRACK_WEB_HOST=127.0.0.1 IDTRACK_WEB_PORT=8000 \
      IDTRACK_WEB_STATIC_DIR=<repository>/web/dist uv run --no-sync idtrack-web serve
  $ curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8000/
  200 text/html; charset=utf-8
  ```

  Every path that is not a file and not under `/api` answers the page (`/batch`, `/organisms/sus_scrofa`, ...), so each view's address can be linked to and reloaded.

  `npm run build` also writes the frame of every page (`dist/frames.json`, `scripts/prerender.ts`: the masthead and the page's head as HTML, the site's own pages whole, the links that fetch the page's own code beside the entry, and the page's title, description, canonical address and link cards; and the list of the pages, for `/sitemap.xml`), which the server writes into the page it sends for each address, so a page's head is drawn before its code runs; `dist/.well-known/security.txt` (`scripts/site-files.ts`, expiring 364 days after the build); and the Brotli form of every text file beside it (`<file>.br`, `scripts/compress.ts`). The server compresses the page's text files with gzip once at start and sends a browser that accepts Brotli the build's Brotli form, else gzip; the files of `assets/`, named by their content's hash, are cached for a year as immutable, and every other file (the page itself) is revalidated (`no-cache`, with an `ETag`, answered `304` while unchanged). A file rebuilt while the server runs is sent from disk, uncompressed, until the server restarts. README.md, "How it runs", says more.

  ```console
  $ curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip, br' http://127.0.0.1:8000/assets/<script>.js | grep -iE 'content-(encoding|length)|cache-control|vary'
  cache-control: public, max-age=31536000, immutable
  vary: Accept-Encoding
  content-encoding: br
  content-length: 90602
  ```

The page keeps its state in its address (`/convert?organism=sus_scrofa&id=INS&to=80&db=HGNC%20Symbol`); what it keeps in the browser (the theme, the home's picture, the choice about analytics, the api page's language, a draft of a list, a reload for new code) is listed key by key on the privacy page, from `web/src/lib/site/storage.ts`, which a unit test keeps equal to every key the code stores under.

### 14.6 End-to-end tests

The end-to-end tests run headless Chromium (or Firefox or WebKit: `E2E_BROWSER`) against a server that serves the api and the built page, as in production, at four sizes and themes (1440 px and 390 px wide, light and dark): every main flow (convert, the path view with real data, by keyboard alone, zoom and pan, the phone's timeline, a conversion back in time, every state without an answer, the loading state, the api's refusals, the api unreachable, a rate limit, a batch with its exports compared byte for byte with the api's own, a file upload, names, the organism page, the about page, the theme), real paths of every kind of step whose every number the page must state as the api sent it (`web/e2e/cases.spec.ts`, the `cases` of the graph's data: version changes with and without a score, a replacement, a split, a merge, a handoff, bridges with their checks and places, a split whose first-ranked gene has no id in the database asked for, a name read at another release, a tie, an answer in an external database), axe-core on every state (the rules of WCAG 2.0, 2.1 and 2.2, A and AA, and axe's best practices) with no violation of any impact but a rule `web/e2e/helpers.ts` accepts with its reason (none), a check of every screen that no value is cut by its box, that a table wider than its frame says so, that the page never scrolls sideways, that no figure's text runs out of its figure or overlaps another (the figure grammar, `web/DESIGN.md`) and that no value is written in a programming language's spelling; every page again at 320, 768, 1024 and 2560 px, the masthead (opaque, one layout on every page, what scrolls into view stopping below it) and focus in forced colours (`web/e2e/system.spec.ts`); and a full-page screenshot of each flow at each size and theme.

```console
$ npx playwright install chromium            # once; on Linux without the browser's system libraries: npx playwright install --with-deps chromium (as root)
$ npm run build
$ cd ../api && uv run --no-sync idtrack-web publish --graph tests/data/graph_sus_scrofa_cut.npz --directory /tmp/idtrack-store
$ IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=/tmp/idtrack-store IDTRACK_WEB_HOST=127.0.0.1 IDTRACK_WEB_PORT=8000 \
    IDTRACK_WEB_RATE_PER_MINUTE=0 IDTRACK_WEB_STATIC_DIR=<repository>/web/dist uv run --no-sync idtrack-web serve &
$ cd ../web && E2E_BASE_URL=http://127.0.0.1:8000 E2E_DATA=cut npm run e2e
...
  170 skipped
  578 passed (7.6m)
```

- `E2E_DATA` names the graph the server holds: `cut` (the api tests' small pig graph, as CI), `pig` (the real pig graph: publish it instead, section 7) or `human` (the real human graph, which needs a server with more memory, section 9; it adds a very large answer, 368 candidates, and genes on alternative loci). Each is `web/e2e/data/<name>.json`, the identifiers each flow uses (and its `cases`); a new graph needs its own file. Measured with IDTrack 0.1.2 and the graphs of format 6, in Chromium, with four workers: `cut` 578 passed, 170 skipped (7.6 minutes); `human` 674 passed, 118 skipped (10.9 minutes).
- `IDTRACK_WEB_RATE_PER_MINUTE=0`: the tests send several hundred requests from one address, which the default rate limit would refuse.
- The skipped: a test of one size runs at that size only (the zoom and the masthead's tests the wide screens', the timeline the phones'); the sweep of every page at six sizes (from 320 by 256 px, a zoom of 400 %, to 2560 px wide) sets its own sizes and runs once per theme, in the desktop projects; the test of what Google would receive needs `E2E_GTAG` (below); the two flows of `web/e2e/graph.spec.ts` run only where the graph's data names their identifiers (human).
- Screenshots go to `web/test-results/screenshots/<flow>--<desktop|phone>-<light|dark>.png` (or `E2E_SCREENSHOTS`); a report to `web/playwright-report/` (`npx playwright show-report`). CI keeps both as the artefact `e2e-report`.
- `E2E_GTAG` names a copy of Google's tag recorded once for the site's property (the file `https://www.googletagmanager.com/gtag/js?id=<id>` sends): the tests of counting visits (`web/e2e/consent.spec.ts`) then serve it in Google's place, with the two automatic measurements the site requires off (`IDTRACK_WEB_ANALYTICS_ID`, section 6), answer every hit themselves, and check that each carries the page's path and name alone and that the tag's cookies stay on the site's host. Without it, those checks are skipped and the rest of the file runs on the page's own data layer. No request of the tests leaves the machine: every other host is answered by the tests.
- `PLAYWRIGHT_BROWSERS_PATH` sets where the browsers are kept (by default the user's cache).
- `E2E_BROWSER=firefox` (after `npx playwright install firefox`) runs the same tests in Firefox: `pig` 156 passed, 12 skipped. `webkit` needs the browser's system libraries (`npx playwright install --with-deps webkit`, as root) and has not been run.

### 14.7 The recorded answers (fixtures)

`web/tests/fixtures/<organism>/` holds real answers of the api, byte for byte, with `index.json` naming each request. Record them again whenever the api's results change (a new IDTrack), then run the tests: they must pass on the new answers without change to their assertions, or the frontend is not ready for them. With the api's environment (section 4) and a server holding the graph (here pig on port 8000):

```console
$ uv run --no-sync python ../web/scripts/fixtures/scan_features.py <pig graph file> /tmp/scan_pig.json 4000 1500
conversions 28000 features 83
$ uv run --no-sync python ../web/scripts/fixtures/record_fixtures.py http://127.0.0.1:8000 sus_scrofa /tmp/scan_pig.json \
    ../web/tests/fixtures/sus_scrofa --curated ../web/scripts/fixtures/curated_common.json --curated ../web/scripts/fixtures/curated_sus_scrofa.json
...
recorded 85
```

`scan_features.py` converts a sample of the graph's identifiers in several ways and keeps examples of every feature the path view draws; `record_fixtures.py` asks the api for them and for the curated requests. The human graph needs a server with more memory (section 9): the same two commands with `homo_sapiens` and `curated_homo_sapiens.json`. Recording twice from the same graph gives the same files except the request ids of the refusals.

### 14.8 The frontend in the image

The `web` stage of `deploy/Containerfile` installs the packages with `npm ci`, checks the types against `api/openapi.json` and builds (the limitations file is the one committed, 14.3); the runtime stage copies `web/dist` to `/srv/idtrack-web/web`, which the server serves (`IDTRACK_WEB_STATIC_DIR` in the image). The server sends the page compressed and with its caching headers itself (14.5), so the page is served compressed and cached with or without a proxy in front (the image or the server reached directly); Caddy (sections 10 and 11) does not compress an answer that is compressed already. Nothing else is needed to deploy the page: wherever the image runs (section 10 on the Helmholtz virtual machine, section 11 on the Hetzner node, or any server with the graphs in R2 or a folder), the page is at `/` and the api at `/api/v1`. A frontend served from another origin must have that origin in `IDTRACK_WEB_CORS_ORIGINS` and the api's address in front of `/api/v1`; it is not needed and not done here.

Verified with IDTrack 0.1.0: the image (368 MB) run with the five graphs from a folder store; the end-to-end tests with `E2E_DATA=pig` against the container: 156 passed, 12 skipped, in Chromium and in Firefox (section 11).

### 14.9 Troubleshooting

| What you see | Why, and what to do |
| --- | --- |
| `npm ci` fails: `` `npm ci` can only install packages when your package.json and package-lock.json ... are in sync `` | `package.json` changed without the lock; `npm install` and commit both |
| `npm warn EBADENGINE Unsupported engine`, naming `node: '>=24.22.3 <25'` | Another Node; install 24.22.3 (14.1) |
| `src/api/schema.ts (or shapes.ts) is not what api/openapi.json gives` | The api's document changed: `npm run types`, then `npm run typecheck` |
| `browserType.launch: Executable doesn't exist` | Chromium not installed: `npx playwright install chromium` |
| `browserType.launch: ... error while loading shared libraries` | The browser's system libraries are missing: `npx playwright install --with-deps chromium` as root |
| End-to-end tests fail with `rate_limited` | The server's rate limit is on: `IDTRACK_WEB_RATE_PER_MINUTE=0` for the tests |
| End-to-end tests fail on identifiers (`not_found`, an empty table) | `E2E_DATA` does not match the graph the server holds |
| The page shows "The api cannot be reached" | The api is not running, still loading its graphs, or (development) `IDTRACK_WEB_API` names another address |
| `/batch` or another view answers 404 from the server | `IDTRACK_WEB_STATIC_DIR` is not set or not the built `dist` |
