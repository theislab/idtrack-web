# Setting up idtrack-web

This document takes a reader from nothing to a running, tested and deployed idtrack-web. Every command was run as written; the outputs shown are what it printed (paths shortened to `...`). Sections 1 to 12 set up the api, its data and its deployment; section 13 the frontend (`web/`), which the image carries.

Contents: 1 What a working setup is · 2 Prerequisites · 3 The idtrack commit · 4 Install the api · 5 Test · 6 Configuration · 7 Data: graphs, the manifest, R2 and the node · 8 Run locally · 9 Sizing · 10 Deploy on the Hetzner node · 11 Deploy without containers · 12 Troubleshooting · 13 The frontend

## 1. What a working setup is

From `api/`, with the environment of section 4:

```console
$ uv run --no-sync pytest -q
129 passed, 12 skipped in about a minute
```

(12 skipped: the tests of the real graphs, which run when `IDTRACK_WEB_TEST_GRAPHS` names them: section 5.) From `web/`, with the Node toolchain of section 13:

```console
$ npm ci && npm run types:check && npm test
...
      Tests  1173 passed (1173)
```

A running server answers `GET /api/v1/health` with `{"status":"ok","organisms":[...]}` and serves the page at `/`.

## 2. Prerequisites

- Linux or macOS, `git`, `curl`.
- [uv](https://docs.astral.sh/uv/) 0.11.28 (it uses a Python 3.14 it finds, or installs one). Its installer puts `uv` in `~/.local/bin` and adds that folder to the shell's profile files (replacing a `uv` already there); `UV_INSTALL_DIR=<folder>` installs it elsewhere and `UV_NO_MODIFY_PATH=1` leaves the profiles alone (then put `<folder>` on the `PATH` yourself):

  ```console
  $ curl -LsSf https://astral.sh/uv/0.11.28/install.sh | sh
  $ curl -LsSf https://astral.sh/uv/0.11.28/install.sh | env UV_INSTALL_DIR=<folder> UV_NO_MODIFY_PATH=1 sh   # or: touch nothing else
  $ uv --version
  uv 0.11.28 (x86_64-unknown-linux-gnu)
  ```
- For the frontend: Node.js 24.22.3 with npm 11.19.1 (section 13.1).
- For images: podman 5 or Docker 27 with compose. On the Hetzner node: Docker Engine with the compose plugin (section 10).
- Network: HTTPS to `github.com` (idtrack's source) and `raw.githubusercontent.com` (idtrack's documented limitations, section 13.3), `pypi.org` and `files.pythonhosted.org` (packages), `registry.npmjs.org` (the frontend's packages), Playwright's download host (the browsers of the end-to-end tests), the R2 endpoint (graphs). A running server needs only its graph store.

## 3. The idtrack commit

The api depends on idtrack at one release of its GitHub repository, set in **one place**: the sources table of uv in `api/pyproject.toml`, which `api/uv.lock` records with its commit:

```toml
[tool.uv.sources]
idtrack = { git = "https://github.com/theislab/idtrack.git", tag = "v0.1.2" }
```

The api carries idtrack's version: idtrack, this repository and idtrack's benchmark repository ([idtrack-reproducibility](https://github.com/theislab/idtrack-reproducibility)) carry one version number, and each release of idtrack tags all three `v<version>`; version 0.1.2 of the api and the frontend (`api/pyproject.toml`, `web/package.json`) pins idtrack's tag `v0.1.2`. The lock holds the commit the tag named when it was locked (`7f71b2606a61b7e46b99361406ad403ae21eb5b9` for `v0.1.2`), and `uv sync --locked` installs that commit, whatever the tag names later. To move the api to another idtrack release (or to a commit: `rev = "<full commit hash>"` in place of `tag`):

```console
$ cd api
$ # edit `tag` of the idtrack line of [tool.uv.sources], and `version` here and in web/package.json for a release
$ uv lock
Resolved 99 packages in 7.51s
Updated idtrack v0.1.0 (b5d4fb41) -> v0.1.2 (7f71b260)
Updated idtrack-web-api v0.1.0 -> v0.1.2
$ uv sync --locked                                             # then section 5: every test must pass
$ uv run --no-sync idtrack-web openapi --output openapi.json   # if idtrack's results changed
$ cd ../web && npm run types                                    # the frontend's types from the new document (section 13.3)
$ npm run limitations                                           # idtrack's documented limitations at the new commit (13.3)
```

If idtrack's graph file format changed (the tests then fail with idtrack's `GraphMismatchError`), rebuild the tests' small graph first (`scripts/make_test_graph.py`, section 5). Then commit `api/pyproject.toml`, `api/uv.lock`, `api/openapi.json`, `web/src/api/schema.ts` and `web/src/generated/limitations.json` together (and the test graph if it was rebuilt), and record the frontend's fixtures again if idtrack's answers changed (section 13.7). `/api/v1/version` reports the commit that answers (`idtrack_commit`). All calls into idtrack are in `api/idtrack_web_api/adapter.py`; if idtrack renames an argument or a class, that module (and `api/tests/test_adapter.py`) is what changes. The response schemas are made from idtrack's result classes, so a change of idtrack's results changes `api/openapi.json` (a test fails until it is regenerated as above), and a change of idtrack's tables of codes fails `api/tests/test_vocabulary.py` where the api keeps words of its own (the meanings of the statuses, the fields each criterion compares: `api/idtrack_web_api/vocabulary.py`).

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
$ uv run --no-sync pytest -q                        # 129 passed, 12 skipped, about a minute
$ uv run --no-sync ruff format --check . ../scripts && uv run --no-sync ruff check . ../scripts
30 files already formatted
All checks passed!
$ uv run --no-sync mypy
Success: no issues found in 29 source files
```

What the tests cover: every endpoint against its schema in `api/openapi.json` (and `api/openapi.json` equal to what the app generates and serves); every answer equal to idtrack's `to_dict()` for the same call, with every float compared bit for bit, a batch equal to one `API.convert_many` call over the whole batch (items that extend another item by a numbered suffix, which idtrack can answer as copies, among them); `/vocabulary` equal to idtrack's tables, and the api's own words of it tied to idtrack's sets of codes; every validation and error path with its status and code; the data layer (manifest, checksum refusal, the `check-data` and `serve` commands refusing a damaged file); R2 through a local S3-compatible server (moto, started by the tests on a free port; no credentials); concurrent requests in one process and against `idtrack-web serve` with two forked workers, and the rate limit shared by the workers. The tests use the small pig graph `api/tests/data/graph_sus_scrofa_cut.npz` (0.57 MB, built from idtrack's own cut Ensembl tables by `scripts/make_test_graph.py`; rebuild it when idtrack's graph format changes, from a checkout of the idtrack commit of section 3: `git clone https://github.com/theislab/idtrack.git <folder> && git -C <folder> checkout <commit>`, then `uv run --no-sync python -I ../scripts/make_test_graph.py <folder> tests/data/graph_sus_scrofa_cut.npz`, about 2 minutes).

The 12 tests marked `real` use the real pig graph, from a folder that holds it as `sus_scrofa/<graph file>.npz` (a file or a link to it; other organisms' folders beside it are ignored). Without that file they are skipped, each with the reason. The graph is built by idtrack's command line, which the api's environment holds (idtrack's SETUP.md, section 3, says more; about 30 minutes with the downloads, about 40 MB). idtrack 0.1.2 writes graph format 6, the format this api reads (`/api/v1/version`, `graph_format_version`):

```console
$ IDTRACK_ENSEMBL_ACCESS=https uv run --no-sync idtrack build pig 115 --repository <idtrack repository>
...
<idtrack repository>/graph_sus_scrofa_assembly111_min56_max115.npz
$ mkdir -p <graphs folder>/sus_scrofa && ln -s <idtrack repository>/graph_sus_scrofa_assembly111_min56_max115.npz <graphs folder>/sus_scrofa/
$ IDTRACK_WEB_TEST_GRAPHS=<graphs folder> uv run --no-sync pytest -q
141 passed in about a minute
```

The OpenAPI document after a change of the api: `uv run --no-sync idtrack-web openapi --output openapi.json`.

## 6. Configuration

Environment variables only, all read and checked at start; a misspelt `IDTRACK_WEB_*` variable stops the server with the list of known ones. A secret can be given as a file instead: `<NAME>_FILE` holds the path of a file with the value (for container secrets).

| Variable | Default | What |
| --- | --- | --- |
| `IDTRACK_WEB_SOURCE` | (required) | `s3` (Cloudflare R2 or another S3-compatible store) or `directory` (a folder with the same layout) |
| `IDTRACK_WEB_DIRECTORY` | | For `directory`: the folder (absolute) |
| `IDTRACK_WEB_S3_ENDPOINT` | | For `s3`: `https://<account id>.r2.cloudflarestorage.com` |
| `IDTRACK_WEB_S3_BUCKET` | | For `s3`: the bucket |
| `IDTRACK_WEB_S3_REGION` | `auto` | For `s3`: the signing region (`auto` for R2) |
| `IDTRACK_WEB_S3_ACCESS_KEY_ID` (or `_FILE`) | | For `s3`: the access key id (secret; never logged) |
| `IDTRACK_WEB_S3_SECRET_ACCESS_KEY` (or `_FILE`) | | For `s3`: the secret access key (secret; never logged) |
| `IDTRACK_WEB_CACHE_DIR` | (image: `/var/cache/idtrack-web`) | For `s3`: where fetched files are kept between starts |
| `IDTRACK_WEB_MANIFEST_KEY` | `idtrack/<graph format>/manifest.json` | The manifest to read |
| `IDTRACK_WEB_ORGANISMS` | every organism of the manifest | Comma-separated (`homo_sapiens,pig`) |
| `IDTRACK_WEB_WORKERS` | `2` | Worker processes |
| `IDTRACK_WEB_HOST`, `IDTRACK_WEB_PORT` | `0.0.0.0`, `8000` | Where the server listens |
| `IDTRACK_WEB_FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies (addresses or networks) whose `X-Forwarded-For` names the client (for the rate limit and the log) |
| `IDTRACK_WEB_REQUEST_SECONDS` | `20` | Time budget of a request, from arrival to its last search |
| `IDTRACK_WEB_SEARCH_SECONDS` | `10` | Time budget of one identifier's search (at most the request's) |
| `IDTRACK_WEB_SEARCH_STATES` | `200000` | State budget of one identifier's search |
| `IDTRACK_WEB_BATCH_MAX` | `1000` | Identifiers per batch |
| `IDTRACK_WEB_IDENTIFIER_MAX_LENGTH` | `256` | Characters per identifier or name |
| `IDTRACK_WEB_BODY_MAX_BYTES` | `1048576` | Request body |
| `IDTRACK_WEB_RESPONSE_MAX_BYTES` | `33554432` | Answer (a larger one is refused with `response_too_large`, never cut) |
| `IDTRACK_WEB_RATE_PER_MINUTE` | `120` | Requests per minute per client (`0`: no limit) |
| `IDTRACK_WEB_RATE_BURST` | `30` | Requests a client may make at once |
| `IDTRACK_WEB_QUEUE_MAX` | `64` | Requests one worker holds (running or waiting) before answering `503 server_busy` |
| `IDTRACK_WEB_STATIC_DIR` | (image: the built frontend) | Serve the built frontend from this folder at `/` |
| `IDTRACK_WEB_CORS_ORIGINS` | none | Origins allowed to call the api from a browser (a frontend served elsewhere, e.g. `http://localhost:5173`) |
| `IDTRACK_WEB_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

The server logs its settings at start with every secret shown as `<set>`. Each request is logged as `client method path status seconds request-id`; an internal error's traceback is logged with the request id that the client was given.

## 7. Data: graphs, the manifest, R2 and the node

**Layout of a store** (a bucket, or a folder on the node):

```
idtrack/<graph format>/manifest.json                     the current release: what servers load
idtrack/<graph format>/manifests/<sha256>.json           every manifest ever published, named by its content
idtrack/<graph format>/<organism>/<sha256>.npz           graph files, named by their content (never replaced)
```

The manifest (`data/manifest.schema.json`; an example, the manifest of the five organisms' graphs in format 6 that idtrack 0.1.2 reads, as `idtrack-web publish` wrote it: `data/manifest.example.json`) lists per organism the file's key, SHA-256 and size, the snapshot release, the graph's content digest and the idtrack version and commit that built it. `<graph format>` is idtrack's graph file format (6 for idtrack 0.1.0 to 0.1.2; `/api/v1/version` reports it as `graph_format_version`): an idtrack that reads another format reads another manifest, so a format change never breaks running servers.

**Where graphs come from.** idtrack builds them (`idtrack.API.build`, from Ensembl's public data). The graphs of the five organisms of idtrack's organism table in graph format 6 (Ensembl releases up to 115, the graphs idtrack 0.1.0 to 0.1.2 is measured on: their conversions are the same in these versions) are: human 156 MB, mouse 101 MB, pig 40 MB, macaque (rhesus) 34 MB, cynomolgus 22 MB (0.35 GB in all).

**Publish a release** (one graph per organism; each file is loaded with idtrack first, so a file that is not a graph of this idtrack's format is refused):

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

`deploy/publish_graphs.sh <folder> s3` publishes every `graph_*.npz` under a folder. A file already published with the same bytes is `kept`; a content key that holds other bytes stops the publication. The manifest is written last, so a server starting meanwhile reads either the old release or the new one, whole. Older releases stay in the store (their manifests under `manifests/`); to serve one again, point `IDTRACK_WEB_MANIFEST_KEY` at its manifest.

**Cloudflare R2.** In the Cloudflare dashboard: R2, create a bucket (e.g. `idtrack-graphs`, no public access); R2, Manage API tokens: one token with "Object Read & Write" on that bucket for publishing (kept by the publisher), one with "Object Read" for the servers; each gives an access key id and a secret access key, and the endpoint is `https://<account id>.r2.cloudflarestorage.com`. The five graphs are 0.35 GB (353 MB, above), inside R2's free 10 GB; a server start reads one manifest and, for files its cache lacks, one object each. The R2 path of the code (publishing with an MD5 checked on arrival, the cache, the verification, every refusal) is tested against a local S3-compatible server (section 5); it has not been run against R2 itself, which needs the owner's account.

**At start** the server reads the manifest; for `s3` it fetches each file its cache lacks (or holds with other bytes) to a temporary name, verifies size and SHA-256, and renames it; for `directory` it verifies the files in place; it then loads each graph and checks that it is the graph the manifest names (organism, snapshot release, content digest, format). Any mismatch stops it with exit status 2 and a message naming the file. `idtrack-web check-data` does all of this and exits, printing what it verified:

```console
$ IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=/tmp/idtrack-store uv run --no-sync idtrack-web check-data   # the store of section 8
{
  "manifest": {"key": "idtrack/6/manifest.json", "sha256": "db16e188...", "size": 769},
  "graphs": {
    "sus_scrofa": {
      "file": {"key": "idtrack/6/sus_scrofa/8958696c....npz", "sha256": "8958696c...", "size": 569398},
      "path": ".../idtrack-store/idtrack/6/sus_scrofa/8958696c....npz",
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
{"error":{"code":"unknown_release","message":"`to_release`=999 is not a release of this graph, which covers the Ensembl releases 56 to 115.","argument":"to_release","allowed":[56,...,115],"details":null,"request_id":"..."}}
$ curl -s -X POST -H 'Content-Type: application/json' -d '{"identifiers": ["ENSSSCG00000040076.1", "NOT_A_GENE"]}' \
  "http://127.0.0.1:8000/api/v1/organisms/pig/convert/batch?format=tsv" | cut -f1-6
input_index	query_id	status	reason	reasons	graph_id
0	ENSSSCG00000040076.1	converted			ENSSSCG00000040076.1
1	NOT_A_GENE	not_found	not_in_graph	not_in_graph
```

The interactive documentation is at `http://127.0.0.1:8000/api/v1/docs`. `scripts/check_endpoints.py` calls every endpoint of a running server, checks every answer against `api/openapi.json`, and with `--graph` compares every conversion with idtrack itself. It sends about 2,000 requests, so the server is started for it without the rate limit (it stops at once, with exit status 2, on a server that limits the rate):

```console
$ IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=/tmp/idtrack-store IDTRACK_WEB_HOST=127.0.0.1 IDTRACK_WEB_PORT=8000 \
  IDTRACK_WEB_RATE_PER_MINUTE=0 uv run --no-sync idtrack-web serve
$ uv run --no-sync python ../scripts/check_endpoints.py http://127.0.0.1:8000 sus_scrofa --graph tests/data/graph_sus_scrofa_cut.npz --sample 300
{ ..., "requests": 2073, "compared_with_idtrack": 2466, "floats_compared_bit_for_bit": 3454, ..., "copies_answered": 20, ..., "failures": [] }
```

Besides the answers, it sends 43 wrong requests (wrong types, sizes over the server's limits, unknown organisms, releases, databases, genes and parameters, strings idtrack refuses) and checks that each is refused with its code, a message and the argument, and it converts strings that idtrack reads after changing them (Unicode, punctuation, GENCODE's Y copies) and reports how they matched. With idtrack 0.1.2 and the five real graphs of format 6 (a store of links: `idtrack-web publish ... --directory <store> --link`) and `--sample 300`, it gave 2,002 to 2,087 requests per organism, 2,466 answers compared with idtrack each (17 to 25 of them answered as copies in a batch), and no failure.

## 9. Sizing

The master loads every graph once and forks the workers, which share its memory page by page until they write to it. Measured with the image of section 10 serving the five graphs of format 6 with two workers: right after start 2.85 GB resident in the master and 2.83 GB in each worker (the shared pages counted in each); after 10,321 requests over the five organisms (`scripts/check_endpoints.py` for each, section 8), 4.0 GB resident per worker, and 7.0 GB in all counted proportionally (each shared page split among the processes that share it: master 1.5 GB, workers 2.8 and 2.7 GB). Each worker's private memory grows with what it answers, up to the bounds of idtrack's per-graph caches. So: a Hetzner CPX42 (8 vCPU, 16 GB) for all five organisms with two workers; a CPX32 (8 GB) holds all five only just, and suits fewer organisms (`IDTRACK_WEB_ORGANISMS`) or one worker; more workers need more memory, measured on the node (`docker stats`). Start-up: 11 s to verify and load all five (measured), plus the first fetch from R2.

## 10. Deploy on the Hetzner node

1. **The node**: Ubuntu 24.04 LTS, Docker Engine with the compose plugin (`https://docs.docker.com/engine/install/ubuntu/`); firewall open on 22, 80 and 443 only; a DNS `A` (and `AAAA`) record of the domain pointing at the node.
2. **The image**, built where the repository is (or in CI) and copied to the node, or built on the node:

   ```console
   $ deploy/build_image.sh 0.1.2 docker          # or podman
   ...
   Successfully tagged localhost/idtrack-web:0.1.2          (podman's words; Docker prints `naming to ...idtrack-web:0.1.2`)
   ```
   The image (368 MB) holds the api and its environment and the built frontend (section 13.8); no graph and no credential. Its default command is `idtrack-web serve`, as user `idtrack-web` (uid 10001), with a health check on `/api/v1/health`.
3. **Configuration** on the node, never in git: `cp deploy/idtrack-web.env.example deploy/idtrack-web.env`, fill in the R2 read token (or `IDTRACK_WEB_SOURCE=directory` with the store mounted from `IDTRACK_WEB_STORE`), `chmod 600 deploy/idtrack-web.env`.
4. **Start**:

   ```console
   $ IDTRACK_WEB_IMAGE=idtrack-web:0.1.2 IDTRACK_WEB_DOMAIN=<domain> docker compose -f deploy/compose.yaml up -d
   $ docker compose -f deploy/compose.yaml ps        # api: healthy (after the graphs are loaded), caddy: running
   $ curl -s https://<domain>/api/v1/health
   {"status":"ok","organisms":["homo_sapiens","macaca_fascicularis","macaca_mulatta","mus_musculus","sus_scrofa"]}
   $ curl -s https://<domain>/api/v1/version          # idtrack's version and commit, every graph's SHA-256 and digest
   ```
   Caddy obtains the TLS certificate from Let's Encrypt on first start (ports 80 and 443 must reach the node) and renews it; it compresses, adds HSTS and the security headers, bounds request bodies at 2 MB, and passes the client's address to the api, which trusts it from Caddy's network only. The api container runs read-only, without capabilities, with the graph cache on a named volume.
5. **A new release of graphs**: publish it (section 7), then `docker compose -f deploy/compose.yaml restart api`; the server fetches what is new, verifies, loads, and becomes healthy again (Caddy holds requests to a server that is not healthy). **A new version of the api**: build and tag the image, set `IDTRACK_WEB_IMAGE`, `up -d`.

Verified (idtrack 0.1.0): the image built with rootless podman 5.8 on a machine without subordinate user ids (`PODMAN_OPTIONS="--cgroup-manager cgroupfs --root <local disk> --runroot <local disk> --storage-driver overlay --storage-opt overlay.ignore_chown_errors=true" BUILD_OPTIONS="--build-arg SINGLE_ID_BUILDER=true" deploy/build_image.sh 0.1.0 podman`; run there with `--user 0:0`), and run as compose runs it (read-only, all capabilities dropped, no new privileges):

- **A folder store** (the node's case): all five graphs; `scripts/check_endpoints.py` against it for each organism, 2,003 to 2,088 requests, 2,466 answers compared with idtrack each, no failure; the end-to-end tests (section 13.6, `E2E_DATA=pig`) against it in Chromium and in Firefox (`E2E_BROWSER=firefox`), 156 passed and 12 skipped each.
- **An S3-compatible store** (the R2 case, a local moto server standing in for R2): pig and human published with `idtrack-web publish --s3`, the credentials given as files (`IDTRACK_WEB_S3_ACCESS_KEY_ID_FILE`, `IDTRACK_WEB_S3_SECRET_ACCESS_KEY_FILE`); the server fetched both, verified and loaded them, and on a restart verified its cached copies without fetching; `scripts/check_endpoints.py` for both organisms, no failure.
- **Behind Caddy** (`docker.io/library/caddy:2.11.9` with `deploy/Caddyfile`, in one pod with the api, `IDTRACK_WEB_DOMAIN=localhost`, for which Caddy issues its own certificate): HTTPS with HSTS and the security headers, `http://` redirected (308), the page compressed (zstd), a body over 2 MB refused by Caddy (413, no body) and one over the api's 1 MiB by the api (413 `payload_too_large`), the client's address passed to the api's log.

Not run there: `docker compose` itself (no Docker daemon and no compose provider for podman), and a certificate from Let's Encrypt (no public domain). On the node, after step 4: `docker compose -f deploy/compose.yaml ps` (api healthy), `curl -sI https://<domain>/` (HTTP/2 200 with `strict-transport-security`), `curl -sI http://<domain>/` (308 to `https://`), and, from a machine with the api's environment, `uv run --no-sync python ../scripts/check_endpoints.py https://<domain> sus_scrofa` (no failure; the default rate limit of 120 requests per minute applies, so run it with `IDTRACK_WEB_RATE_PER_MINUTE=0` set on the node for the check, then remove it).

## 11. Deploy without containers

On the node, as root: create the user (`useradd --system --home-dir /opt/idtrack-web idtrack-web`), install uv (section 2), clone the repository to `/opt/idtrack-web/src`, build the environment with `UV_PROJECT_ENVIRONMENT=/opt/idtrack-web/venv uv sync --locked --no-dev --no-editable` in `src/api`, put the configuration in `/etc/idtrack-web/idtrack-web.env` (mode 600), install `deploy/systemd/idtrack-web.service` into `/etc/systemd/system/`, `systemctl enable --now idtrack-web`, and install Caddy from its package with `deploy/Caddyfile`, its `reverse_proxy` pointed at `127.0.0.1:8000`. The unit runs the server as `idtrack-web` with a read-only system and a writable cache folder only.

## 12. Troubleshooting

| What you see | Why, and what to do |
| --- | --- |
| `idtrack-web: IDTRACK_WEB_SOURCE=None; set it to one of directory, s3.` (exit 2) | The configuration is missing; section 6 |
| `idtrack-web: Unknown variables (a misspelling?): IDTRACK_WEB_WORKER. Known: ...` | A misspelt variable |
| `idtrack-web: idtrack/6/manifest.json cannot be read from the bucket ...: NoSuchKey (...)` | Nothing published for this graph format; publish (section 7), or set `IDTRACK_WEB_MANIFEST_KEY` |
| `idtrack-web: idtrack/6/<organism>/<sha>.npz: the SHA-256 of <path> is ...; the manifest says ...` | A damaged file: in a folder store, copy it again; in a bucket, the object was replaced behind the publisher's back: publish again |
| `idtrack-web: The manifest ... lists graphs of format version 2; this idtrack reads format version 6.` | Graphs built by another idtrack; publish graphs built by this one |
| `... is not the graph the manifest names: {...}` | The manifest and the file disagree (organism, snapshot, digest): publish again |
| `uv sync --locked` fails: `The lockfile ... needs to be updated` | `pyproject.toml` changed without `uv lock` (section 3) |
| A test fails in `test_openapi.py`: `api/openapi.json is not what the app generates` | Regenerate it (section 5), and the frontend's types from it |
| Answers `429 rate_limited` from one address for every user | The proxy's address is not in `IDTRACK_WEB_FORWARDED_ALLOW_IPS`, so every request counts as the proxy's |
| `503 server_busy` | More work waiting than `IDTRACK_WEB_QUEUE_MAX` per worker; more workers or a smaller batch size |

## 13. The frontend

The frontend (`web/`) is a TypeScript and React application built with Vite: its own components (no UI kit), the path view drawn in SVG with d3 for scales and zoom. It talks to the api only at `/api/v1` of its own origin and shares nothing with the api but `api/openapi.json`, from which its types are generated. Its visual direction and the path view: [web/DESIGN.md](web/DESIGN.md).

| Path | What |
| --- | --- |
| `web/src/` | The application: `api/` (the client and the generated types `schema.ts`), `lib/` (the path view's model, layout and reading, the words for the api's codes, numbers as the api writes them), `components/`, `pages/`, `styles/` (the design tokens and the page's styles) |
| `web/tests/` | Unit tests (Vitest), with `fixtures/`: real answers of the api recorded from the pig and human graphs |
| `web/e2e/` | End-to-end tests (Playwright, headless Chromium), with `data/<graph>.json`: the identifiers each flow uses on a graph |
| `web/scripts/` | The type generator, the build-size report, and `fixtures/` (the scripts that record the fixtures) |
| `web/package.json`, `web/package-lock.json` | The packages, exact versions; install only with `npm ci` |

### 13.1 The Node toolchain

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

### 13.2 Install

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

From an empty npm cache this took 1.5 minutes. `npm ci` installs exactly `package-lock.json` and fails if it disagrees with `package.json`. Two warnings are known and accepted (13.1): the deprecation notice of ESLint 9, and the advisories `npm audit` reports in development tools; nothing of them reaches the built page (`--omit=dev`: none). A package is added with `npm install --save-exact <package>@<version>` and the lock file committed with it; the versions of this lock were chosen at least two weeks old (`npm install --before=<date>`).

### 13.3 The api's types and idtrack's limitations

`web/src/api/schema.ts` is generated from `api/openapi.json` and never edited:

```console
$ npm run types:check            # CI runs it: the file must be what the document gives
src/api/schema.ts matches api/openapi.json
$ npm run types                  # after a change of api/openapi.json (section 3, 5), then commit both
wrote src/api/schema.ts from api/openapi.json
```

A change of idtrack's results changes the document, then the types; `npm run typecheck` shows every place the frontend must follow, and the fixtures are recorded again (13.7).

The About page lists the known limitations of idtrack in idtrack's own words: `web/src/generated/limitations.json`, generated from the section "Limitations" of idtrack's `docs/limitations.rst` at the commit of `api/uv.lock` (one item per limitation, the section's subsections: the lead sentence that opens it, which idtrack writes in bold; with a link to the section at that commit, `#limitations`), and never edited:

```console
$ npm run limitations:check      # CI runs it: the file must be what idtrack's page at the pinned commit gives
src/generated/limitations.json matches idtrack 7f71b2606a61 (22 items)
$ npm run limitations            # after a change of the idtrack commit (section 3), then commit the file
$ npm run limitations -- --from <checkout of the commit>/docs/limitations.rst      # the same from a local copy, offline
```

Both read the page from `raw.githubusercontent.com` at the pinned commit (or the file given), and stop on a limitation that does not open with a lead sentence in bold, so the file holds one item per limitation of the page. A unit test fails while the file names another commit than `api/uv.lock`.

### 13.4 Checks and tests

```console
$ npm run lint                   # ESLint (type-checked rules, React hooks, jsx-a11y strict) and Prettier
All matched files use Prettier code style!
$ npm run typecheck              # TypeScript, strict
$ npm test                       # Vitest: the path view's model against the recorded answers, numbers, the client, the views, the palette
 Test Files  11 passed (11)
      Tests  1173 passed (1173)
$ npm run build                  # into web/dist
(!) Some chunks are larger than 400 kB after minification. Consider: ...
✓ built in ...
$ npm run size
   ...
   about 810 KiB    about 510 KiB gzip  all files (24, source maps left out)
   about 495 KiB    about 195 KiB gzip  a first visit (page, script, style, Latin fonts)
```

The build's warning about chunks larger than 400 kB is expected: the page is one script (about 390 KiB before compression, 120 KiB compressed) that holds the whole application, and the figures of `npm run size` grow a little with each change.

What the unit tests prove, on 130 recorded conversions of the real pig and human graphs of format 6 (120 with a path, holding every reason of step but a final step through a transcript of another release and a refused step, every place relation of a graph file and every bridge rule but two; web/DESIGN.md, "Accuracy"): each candidate's drawn path is its api path then final path, step for step, a continuous line at the releases the api gives; every score shown is the api's own text (compared with the raw JSON; floats are written as Python writes them, checked on 114 values); the reading lists every step of every candidate in order; the deciding criterion is shown between the pair idtrack compared, with every field it compares; every bridge considered, refused step, other reading and reason is listed with its values; a field the api's document does not name is kept and shown; the limitations on the About page are those of the pinned idtrack commit; every status, reason, step reason, criterion and error code of the answers has its entry in the api's vocabulary, read as served; no value is shown in a programming language's spelling; the four hues of the path view stay apart for colour-blind readers and at contrast in both themes.

### 13.5 Run locally

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

The page keeps its state in its address (`/?organism=sus_scrofa&id=INS&to=80&db=HGNC%20Symbol`); the only thing it stores in the browser is the chosen theme.

### 13.6 End-to-end tests

The end-to-end tests run headless Chromium (or Firefox or WebKit: `E2E_BROWSER`) against a server that serves the api and the built page, as in production, at four sizes and themes (1440 px and 390 px wide, light and dark): every main flow (convert, the path view with real data, by keyboard alone, zoom and pan, the phone's timeline, a conversion back in time, every state without an answer, the loading state, the api's refusals, the api unreachable, a rate limit, a batch with its exports compared byte for byte with the api's own, a file upload, names, the organism page, the about page, the theme), real paths of every kind of step whose every number the page must state as the api sent it (`web/e2e/cases.spec.ts`, the `cases` of the graph's data: version changes with and without a score, a replacement, a split, a merge, a handoff, bridges with their checks and places, a split whose first-ranked gene has no id in the database asked for, a name read at another release, a tie, an answer in an external database), axe-core on every state with no violation of serious or critical impact, a check of every screen that no value is cut by its box, that a table wider than its frame says so, that the page never scrolls sideways and that no value is written in a programming language's spelling, and a full-page screenshot of each flow at each size and theme.

```console
$ npx playwright install chromium            # once; on Linux without the browser's system libraries: npx playwright install --with-deps chromium (as root)
$ npm run build
$ cd ../api && uv run --no-sync idtrack-web publish --graph tests/data/graph_sus_scrofa_cut.npz --directory /tmp/idtrack-store
$ IDTRACK_WEB_SOURCE=directory IDTRACK_WEB_DIRECTORY=/tmp/idtrack-store IDTRACK_WEB_HOST=127.0.0.1 IDTRACK_WEB_PORT=8000 \
    IDTRACK_WEB_RATE_PER_MINUTE=0 IDTRACK_WEB_STATIC_DIR=<repository>/web/dist uv run --no-sync idtrack-web serve &
$ cd ../web && E2E_BASE_URL=http://127.0.0.1:8000 E2E_DATA=cut npm run e2e
...
  12 skipped
  112 passed (1.1m)
```

- `E2E_DATA` names the graph the server holds: `cut` (the api tests' small pig graph, as CI), `pig` (the real pig graph: publish it instead, section 7) or `human` (the real human graph, which needs a server with more memory, section 9; it adds a very large answer, 368 candidates, and genes on alternative loci). Each is `web/e2e/data/<name>.json`, the identifiers each flow uses (and its `cases`); a new graph needs its own file. Measured with idtrack 0.1.2 and the graphs of format 6: `cut` 112 passed, 12 skipped; `pig` 156 passed, 12 skipped; `human` 164 passed, 4 skipped.
- `IDTRACK_WEB_RATE_PER_MINUTE=0`: the tests send several hundred requests from one address, which the default rate limit would refuse.
- The skipped: the zoom test is the wide screens' and the timeline test the phones' (4); the two flows of `web/e2e/graph.spec.ts` run only where the graph's data names their identifiers (human).
- Screenshots go to `web/test-results/screenshots/<flow>--<desktop|phone>-<light|dark>.png` (or `E2E_SCREENSHOTS`); a report to `web/playwright-report/` (`npx playwright show-report`). CI keeps both as the artefact `e2e-report`.
- `PLAYWRIGHT_BROWSERS_PATH` sets where the browsers are kept (by default the user's cache).
- `E2E_BROWSER=firefox` (after `npx playwright install firefox`) runs the same tests in Firefox: `pig` 156 passed, 12 skipped. `webkit` needs the browser's system libraries (`npx playwright install --with-deps webkit`, as root) and has not been run.

### 13.7 The recorded answers (fixtures)

`web/tests/fixtures/<organism>/` holds real answers of the api, byte for byte, with `index.json` naming each request. Record them again whenever the api's results change (a new idtrack), then run the tests: they must pass on the new answers without change to their assertions, or the frontend is not ready for them. With the api's environment (section 4) and a server holding the graph (here pig on port 8000):

```console
$ uv run --no-sync python ../web/scripts/fixtures/scan_features.py <pig graph file> /tmp/scan_pig.json 4000 1500
conversions 28000 features 83
$ uv run --no-sync python ../web/scripts/fixtures/record_fixtures.py http://127.0.0.1:8000 sus_scrofa /tmp/scan_pig.json \
    ../web/tests/fixtures/sus_scrofa --curated ../web/scripts/fixtures/curated_common.json --curated ../web/scripts/fixtures/curated_sus_scrofa.json
...
recorded 85
```

`scan_features.py` converts a sample of the graph's identifiers in several ways and keeps examples of every feature the path view draws; `record_fixtures.py` asks the api for them and for the curated requests. The human graph needs a server with more memory (section 9): the same two commands with `homo_sapiens` and `curated_homo_sapiens.json`. Recording twice from the same graph gives the same files except the request ids of the refusals.

### 13.8 The frontend in the image

The `web` stage of `deploy/Containerfile` installs the packages with `npm ci`, checks the types against `api/openapi.json` and builds (the limitations file is the one committed, 13.3); the runtime stage copies `web/dist` to `/srv/idtrack-web/web`, which the server serves (`IDTRACK_WEB_STATIC_DIR` in the image). Nothing else is needed to deploy the page: wherever the image runs (section 10 on the Hetzner node, or any server with the graphs in R2), the page is at `/` and the api at `/api/v1`. A frontend served from another origin must have that origin in `IDTRACK_WEB_CORS_ORIGINS` and the api's address in front of `/api/v1`; it is not needed and not done here.

Verified with idtrack 0.1.0: the image (368 MB) run with the five graphs from a folder store; the end-to-end tests with `E2E_DATA=pig` against the container: 156 passed, 12 skipped, in Chromium and in Firefox (section 10).

### 13.9 Troubleshooting

| What you see | Why, and what to do |
| --- | --- |
| `npm ci` fails: `` `npm ci` can only install packages when your package.json and package-lock.json ... are in sync `` | `package.json` changed without the lock; `npm install` and commit both |
| `npm warn EBADENGINE Unsupported engine`, naming `node: '>=24.22.3 <25'` | Another Node; install 24.22.3 (13.1) |
| `src/api/schema.ts is not what api/openapi.json gives` | The api's document changed: `npm run types`, then `npm run typecheck` |
| `browserType.launch: Executable doesn't exist` | Chromium not installed: `npx playwright install chromium` |
| `browserType.launch: ... error while loading shared libraries` | The browser's system libraries are missing: `npx playwright install --with-deps chromium` as root |
| End-to-end tests fail with `rate_limited` | The server's rate limit is on: `IDTRACK_WEB_RATE_PER_MINUTE=0` for the tests |
| End-to-end tests fail on identifiers (`not_found`, an empty table) | `E2E_DATA` does not match the graph the server holds |
| The page shows "The api cannot be reached" | The api is not running, still loading its graphs, or (development) `IDTRACK_WEB_API` names another address |
| `/batch` or another view answers 404 from the server | `IDTRACK_WEB_STATIC_DIR` is not set or not the built `dist` |
