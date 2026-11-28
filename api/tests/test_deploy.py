"""The deployment's files (deploy/): what Caddy keeps of a visit and for how long, and what a visitor sees while the
api cannot answer (the site's privacy page states the first; SETUP.md, section 10, both); the compose files as compose
reads them, the systemd units, the configuration's examples, and the release SETUP.md deploys."""

from __future__ import annotations

import base64
import configparser
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
from dataclasses import fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
import yaml

from idtrack_web_api.config import PREFIX, Settings
from idtrack_web_api.errors import CODES

if TYPE_CHECKING:
    from collections.abc import Iterator

REPOSITORY = Path(__file__).resolve().parents[2]
DEPLOY = REPOSITORY / "deploy"
CADDYFILES = [
    DEPLOY / "Caddyfile",
    DEPLOY / "vm" / "Caddyfile.behind-proxy",
    DEPLOY / "vm" / "Caddyfile.institute-cert",
]
#: The bound of every log Caddy writes about a request: a file a day, six earlier days kept (a line lives at most seven
#: days).
ROLL = "\t\t\troll_at 00:00\n\t\t\troll_size 100MiB\n\t\t\troll_keep 6\n\t\t\troll_keep_for 144h\n"
#: Caddy's loggers whose messages name a client (its address, its request's headers): a request's error, the
#: handlers' (a download the client broke off), the HTTP server's own (a failed handshake), the TLS handshake's and the
#: events' (the client's greeting, at the debug level). The access log is the site's own `log`.
CLIENT_LOGGERS = "http.log.error http.handlers http.stdlib tls.handshake events"


def block(text: str, opening: str) -> str:
    """Return the block that begins with the line ``opening`` (tabs included), up to its closing brace."""
    start = text.index(opening)
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    msg = f"{opening!r} is not closed"
    raise AssertionError(msg)


@pytest.mark.parametrize("path", CADDYFILES, ids=lambda p: p.name)
def test_every_log_of_a_request_is_kept_seven_days_at_most(path: Path) -> None:
    """The access log and every other message that names a client go to files rolled each midnight, six earlier days
    kept; Caddy's own output (the container's log, bounded by size only; the journal, kept months) holds none of
    them."""
    text = path.read_text(encoding="utf-8")
    access = block(text, "\tlog {\n")
    errors = block(text, "\tlog errors {\n")
    default = block(text, "\tlog default {\n")
    assert "/access.log {\n" + ROLL in access
    assert "/errors.log {\n" + ROLL in errors and f"\t\tinclude {CLIENT_LOGGERS}\n" in errors
    assert f"\t\texclude {CLIENT_LOGGERS}\n" in default and "output file" not in default
    assert text.count("output file") == 2


def test_the_caddy_files_share_their_logs_and_their_maintenance() -> None:
    """The three ways to a certificate differ in their certificate and their proxy, never in what they keep or show."""
    parts = [
        (
            block(t, "\tlog default {\n"),
            block(t, "\tlog errors {\n"),
            block(t, "\tlog {\n"),
            block(t, "\thandle_errors"),
        )
        for t in (p.read_text(encoding="utf-8") for p in CADDYFILES)
    ]
    assert parts[0] == parts[1] == parts[2]


@pytest.mark.parametrize(
    ("compose", "way"),
    [
        ("compose.vm.yaml", "lets_encrypt"),
        ("compose.institute-cert.yaml", "institute_certificate"),
        ("compose.behind-proxy.yaml", "behind_proxy"),
    ],
)
def test_each_way_to_a_certificate_tells_the_api(compose: str, way: str) -> None:
    """The compose file of each way to the certificate (SETUP.md, section 10.5) tells the API which it is, later files
    overriding earlier ones as COMPOSE_FILE lists them, so that the privacy page says who holds the certificate and who
    receives a visitor's address on the deployment as it is set up."""
    text = (DEPLOY / "vm" / compose).read_text(encoding="utf-8")
    assert f"  api:\n    environment:\n      IDTRACK_WEB_HTTPS_ROUTE: {way}\n" in text


def test_the_maintenance_page_is_allowed_its_style_and_nothing_else() -> None:
    """The page Caddy answers while the api cannot is static: no script, no request of its own, no refresh (a page that
    reloads itself fails WCAG 2.2.1); its one style, with the site's faces written in, is allowed by its hash, which the
    Caddy files name, and its faces as data alone."""
    page = (DEPLOY / "maintenance.html").read_text(encoding="utf-8")
    assert "<script" not in page.lower() and " src=" not in page and "<link" not in page
    styles = re.findall(r"<style>(.*?)</style>", page, re.DOTALL)
    assert len(styles) == 1
    digest = base64.b64encode(hashlib.sha256(styles[0].encode()).digest()).decode()
    errors = block((DEPLOY / "Caddyfile").read_text(encoding="utf-8"), "\thandle_errors")
    assert f"style-src 'sha256-{digest}';" in errors
    assert "default-src 'none'" in errors and "rewrite * /maintenance.html" in errors and "status 503" in errors
    assert "font-src data:;" in errors and 'http-equiv="refresh"' not in page
    assert re.findall(r"url\((data:[^;]+);", page) == ["data:font/woff2", "data:font/woff2"]
    compose = (DEPLOY / "compose.yaml").read_text(encoding="utf-8")
    assert "./maintenance.html:/etc/caddy/maintenance.html:ro" in compose


def test_a_program_is_answered_in_the_api_s_own_error() -> None:
    """While the api cannot answer, a program asking it gets the api's error shape: ``503 server_busy`` with the wait,
    every field of an error present."""
    errors = block((DEPLOY / "Caddyfile").read_text(encoding="utf-8"), "\thandle_errors")
    found = re.search(r"respond `(.*?)` (\d{3})", errors)
    assert found is not None
    body = json.loads(found.group(1))["error"]
    assert set(body) == {"code", "message", "argument", "allowed", "details", "request_id", "retry_after", "allowance"}
    assert body["code"] == "server_busy" and CODES["server_busy"][0] == int(found.group(2)) == 503
    assert body["retry_after"] == 60 and "Retry-After 60" in errors


def test_the_maintenance_answer_is_readable_by_any_page() -> None:
    """While the api cannot answer, a page on another origin reads the refusal and its wait as it reads the api's own
    (the api's CORS: any origin, ``Retry-After`` exposed), and no answer is read as another type."""
    for text in (p.read_text(encoding="utf-8") for p in CADDYFILES):
        errors = block(text, "\thandle_errors")
        common = block(errors, "\t\theader {\n")
        assert "X-Content-Type-Options nosniff" in common and "Retry-After 60" in common
        program = block(errors, "\t\thandle @program {")
        assert "Access-Control-Allow-Origin *" in program and "Access-Control-Expose-Headers Retry-After" in program


@pytest.mark.parametrize("path", CADDYFILES, ids=lambda p: p.name)
def test_no_answer_names_the_server_or_the_proxy(path: Path) -> None:
    """The site's headers drop Caddy's ``Server`` and the ``Via`` that its reverse proxy adds."""
    site = block(path.read_text(encoding="utf-8"), "\theader {\n")
    assert "\t\t-Server\n" in site and "\t\t-Via\n" in site


def caddy_binary() -> str | None:
    """Return a Caddy to run the Caddy files with: ``IDTRACK_WEB_TEST_CADDY``, else ``caddy`` on the ``PATH``."""
    return os.environ.get("IDTRACK_WEB_TEST_CADDY") or shutil.which("caddy")


def free_port() -> int:
    """Return a port free on 127.0.0.1 now."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class _Slow(BaseHTTPRequestHandler):
    """An upstream that sends a large answer in pieces, as the api sends a large file."""

    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(64 * 65536))
        self.end_headers()
        try:
            for _ in range(64):
                self.wfile.write(b"x" * 65536)
                time.sleep(0.01)
        except OSError:
            return

    def log_message(self, *_: Any) -> None:
        """Log nothing."""


@pytest.fixture
def upstream() -> Iterator[int]:
    """Serve :class:`_Slow` on a free port of 127.0.0.1; yield the port."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Slow)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield int(server.server_address[1])
    server.shutdown()
    server.server_close()


@pytest.mark.parametrize("path", [CADDYFILES[0], CADDYFILES[1]], ids=lambda p: p.name)
def test_caddy_names_no_client_in_its_own_output(path: Path, upstream: int, tmp_path: Path) -> None:
    """Run with Caddy itself: downloads a client breaks off (as a closed tab does) are written, with the client's
    address, to the errors file, and Caddy's own output (the container's log, the journal) never names the client.
    The client comes from 127.0.0.2, so that any line naming it is the client's and not the upstream's."""
    caddy = caddy_binary()
    if caddy is None:
        pytest.skip("no Caddy to run: set IDTRACK_WEB_TEST_CADDY to a caddy binary (SETUP.md, section 5)")
    port = free_port()
    text = path.read_text(encoding="utf-8").replace(
        "{\n", f"{{\n\tadmin off\n\thttp_port {port}\n\thttps_port {free_port()}\n\tstorage file_system {tmp_path}\n", 1
    )
    config = tmp_path / "Caddyfile"
    config.write_text(text, encoding="utf-8")
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(tmp_path),
        "IDTRACK_WEB_DOMAIN": f"http://127.0.0.1:{port}",
        "IDTRACK_WEB_UPSTREAM": f"127.0.0.1:{upstream}",
        "IDTRACK_WEB_LOG_DIR": str(tmp_path),
        "IDTRACK_WEB_MAINTENANCE_DIR": str(DEPLOY),
        "IDTRACK_WEB_TRUSTED_PROXIES": "127.0.0.0/8",
    }
    stderr = tmp_path / "stderr.log"
    with stderr.open("wb") as out:
        process = subprocess.Popen(
            [caddy, "run", "--config", str(config), "--adapter", "caddyfile"], env=env, stderr=out
        )
        try:
            for _ in range(100):
                try:
                    socket.create_connection(("127.0.0.1", port), timeout=1).close()
                    break
                except OSError:
                    time.sleep(0.1)
            for _ in range(3):
                with socket.create_connection(("127.0.0.1", port), timeout=10, source_address=("127.0.0.2", 0)) as s:
                    s.sendall(b"GET /a-large-file HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
                    s.recv(100)
                time.sleep(0.3)
            time.sleep(1)
        finally:
            process.terminate()
            process.wait(timeout=20)
    output = stderr.read_text(encoding="utf-8")
    assert "server running" in output
    assert "127.0.0.2" not in output
    assert "127.0.0.2" in (tmp_path / "errors.log").read_text(encoding="utf-8")


def test_the_image_takes_only_what_it_needs_and_no_secret() -> None:
    """The api's stage copies the api alone and the web stage the frontend; the build context (Docker and podman read
    .dockerignore) holds no environment file or key in any folder."""
    containerfile = (DEPLOY / "Containerfile").read_text(encoding="utf-8")
    copies = re.findall(r"^COPY (?!--from)(.*)$", containerfile, re.MULTILINE)
    assert copies == [
        "web/package.json web/package-lock.json ./",
        "api/openapi.json /api/openapi.json",
        "web/ ./",
        "api/ /src/api/",
    ]
    ignored = (REPOSITORY / ".dockerignore").read_text(encoding="utf-8").splitlines()
    assert {".git", "**/.env", "**/*.env", "**/secrets", "**/*.pem", "**/*.key"} <= set(ignored)
    assert not (REPOSITORY / ".containerignore").exists()


class _ComposeLoader(yaml.SafeLoader):
    """YAML as compose reads it: ``!override`` and ``!reset`` mark a value that replaces the earlier file's."""


_ComposeLoader.add_constructor("!override", lambda loader, node: loader.construct_sequence(node))  # type: ignore[arg-type]
_ComposeLoader.add_constructor("!reset", lambda _loader, _node: None)


def compose_files() -> list[list[str]]:
    """Return every COMPOSE_FILE that deploy/compose.env.example sets or names (each a list of files of deploy/)."""
    text = (DEPLOY / "compose.env.example").read_text(encoding="utf-8")
    combinations = re.findall(r"^#\s+[^:\n]+:\s+(compose\.yaml(?::vm/[\w.-]+)*)\s*$", text, re.MULTILINE)
    combinations += re.findall(r"^COMPOSE_FILE=(\S+)$", text, re.MULTILINE)
    return [c.split(":") for c in dict.fromkeys(combinations)]


def merged(files: list[str]) -> dict[str, Any]:
    """Merge compose files as compose does for what these use (mappings merged, sequences appended or replaced)."""

    def merge(a: Any, b: Any, *, overriding: bool) -> Any:
        if isinstance(a, dict) and isinstance(b, dict):
            return {
                k: merge(a[k], b[k], overriding=overriding) if k in a and k in b else b.get(k, a.get(k)) for k in a | b
            }
        if isinstance(a, list) and isinstance(b, list) and not overriding:
            return a + [x for x in b if x not in a]
        return b

    result: dict[str, Any] = {}
    for name in files:
        text = (DEPLOY / name).read_text(encoding="utf-8")
        data = yaml.load(text, Loader=_ComposeLoader)  # noqa: S506 (a SafeLoader with two tags)
        assert isinstance(data, dict), name
        result = merge(result, data, overriding=False)
        for service, overrides in re.findall(r"^  (\w+):\n((?:    .*\n)+)", text, re.MULTILINE):
            for key in re.findall(r"^    (\w+): !override", overrides, re.MULTILINE):
                result["services"][service][key] = data["services"][service][key]
    return result


def test_every_combination_of_compose_files_resolves() -> None:
    """Each COMPOSE_FILE of compose.env.example names files that exist, mounts files that exist, and asks only for
    variables compose.env.example sets or names; the virtual machine's combinations bound both containers' memory."""
    combinations = compose_files()
    assert len(combinations) == 4 and ["compose.yaml"] in combinations
    example = (DEPLOY / "compose.env.example").read_text(encoding="utf-8")
    for files in combinations:
        assert all((DEPLOY / f).is_file() for f in files), files
        config = merged(files)
        assert set(config["services"]) == {"api", "caddy"}
        for service in config["services"].values():
            for volume in service.get("volumes", []):
                source = volume.split(":")[0]
                if source.startswith("./"):
                    assert (DEPLOY / source).exists(), (files, volume)
        text = "".join((DEPLOY / f).read_text(encoding="utf-8") for f in files)
        for variable in re.findall(r"\$\{(\w+):\?", text):
            assert re.search(rf"^#? ?{variable}=", example, re.MULTILINE), (files, variable)
        if "vm/compose.vm.yaml" in files:
            assert all("mem_limit" in s for s in config["services"].values()), files
        # The api states the way to https of the Caddy file it runs behind.
        route = config["services"]["api"]["environment"]["IDTRACK_WEB_HTTPS_ROUTE"]
        caddyfile = next(
            v for v in reversed(config["services"]["caddy"]["volumes"]) if v.endswith(":/etc/caddy/Caddyfile:ro")
        )
        expected = {"./Caddyfile": "lets_encrypt", "./vm/Caddyfile.institute-cert": "institute_certificate"}
        assert route == expected.get(caddyfile.split(":")[0], "behind_proxy"), files
    proxy = merged(["compose.yaml", "vm/compose.vm.yaml", "vm/compose.behind-proxy.yaml"])
    assert proxy["services"]["caddy"]["ports"] == ["80:80"]


def test_both_containers_are_hardened_alike() -> None:
    """Caddy, which faces the internet, runs as the api does: a read-only root file system (its state in volumes), no
    capability but binding the ports below 1024, no new privileges; its image follows Caddy's 2.11 line, so the weekly
    refresh takes its security releases."""
    services = merged(["compose.yaml"])["services"]
    for name, service in services.items():
        assert service["read_only"] is True and service["tmpfs"] == ["/tmp"], name  # noqa: S108 (the containers' own)
        assert service["cap_drop"] == ["ALL"] and service["security_opt"] == ["no-new-privileges:true"], name
    assert "cap_add" not in services["api"] and services["caddy"]["cap_add"] == ["NET_BIND_SERVICE"]
    assert services["caddy"]["image"] == "docker.io/library/caddy:2.11"


UNITS = sorted(
    [*(DEPLOY / "vm").glob("*.service"), *(DEPLOY / "vm").glob("*.timer"), DEPLOY / "systemd" / "idtrack-web.service"]
)


@pytest.mark.parametrize("path", UNITS, ids=lambda p: p.name)
def test_every_unit_runs_what_the_repository_holds(path: Path) -> None:
    """Each unit's commands under /opt/idtrack-web are files of the repository (SETUP.md clones it there), executable
    where they are run; each timer starts a service of the repository; each OnFailure= names a unit of it; each
    timer is installed by the command its comment gives."""
    unit = configparser.ConfigParser(strict=False, interpolation=None)
    unit.optionxform = str  # type: ignore[assignment,method-assign]
    unit.read_string(path.read_text(encoding="utf-8"))
    if path.suffix == ".timer":
        assert (path.with_suffix(".service")).is_file()
        assert "OnCalendar" in unit["Timer"] and unit["Install"]["WantedBy"] == "timers.target"
        assert f"deploy/vm/{path.name}" in path.read_text(encoding="utf-8")
        return
    for command in unit["Service"].get("ExecStart", "").split("\n"):
        program = command.split()[0] if command.strip() else ""
        if program.startswith("/opt/idtrack-web/deploy/"):
            script = REPOSITORY / program.removeprefix("/opt/idtrack-web/")
            assert script.is_file() and os.access(script, os.X_OK), program
    failure = unit["Unit"].get("OnFailure") if "Unit" in unit else None
    if failure:
        assert (DEPLOY / "vm" / failure.replace("%n", "")).is_file(), failure


@pytest.mark.skipif(shutil.which("systemd-analyze") is None, reason="no systemd-analyze on this machine")
def test_systemd_reads_every_unit(tmp_path: Path) -> None:
    """``systemd-analyze verify`` finds no fault in the units (their scripts' paths laid out as on the machine, with
    stand-ins for what the machine has besides: Docker's service, the server's environment)."""
    root = tmp_path / "opt" / "idtrack-web"
    shutil.copytree(DEPLOY, root / "deploy")
    server = root / "venv" / "bin" / "idtrack-web"
    server.parent.mkdir(parents=True)
    server.write_text("#!/bin/sh\n", encoding="utf-8")
    server.chmod(0o755)
    units = tmp_path / "units"
    units.mkdir()
    (units / "docker.service").write_text("[Service]\nExecStart=/bin/true\n", encoding="utf-8")
    for path in UNITS:
        text = path.read_text(encoding="utf-8").replace("/opt/idtrack-web", str(root))
        (units / path.name).write_text(text, encoding="utf-8")
    instance = units / "idtrack-web-alert@idtrack-web-check.service.service"
    shutil.copy(units / "idtrack-web-alert@.service", instance)
    names = [str(p) for p in sorted(units.iterdir()) if not p.name.endswith("@.service")]
    done = subprocess.run(
        ["systemd-analyze", "verify", "--man=no", *names],
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "SYSTEMD_UNIT_PATH": f"{units}:"},
    )
    faults = [line for line in done.stderr.splitlines() if str(units) in line or "idtrack" in line]
    assert done.returncode == 0 and not faults, done.stderr


def settings_named(path: Path) -> set[str]:
    """Return the IDTRACK_WEB_ settings an example file sets or shows (commented out), in its lines of assignment."""
    return set(re.findall(rf"^#? ?({PREFIX}\w+)=", path.read_text(encoding="utf-8"), re.MULTILINE))


def test_the_examples_of_the_configuration_name_every_setting() -> None:
    """The server's example names every setting the server reads, but those the image or compose set for it; every
    name in an example is one the server knows (a misspelt one would stop it); the virtual machine's example reads
    the folder store with its three workers."""
    known = {PREFIX + f.name.upper() for f in fields(Settings)}
    containerfile = (DEPLOY / "Containerfile").read_text(encoding="utf-8")
    compose = (DEPLOY / "compose.yaml").read_text(encoding="utf-8")
    set_for_it = {name for name in known if re.search(rf"\b{name}=", containerfile) or f"{name}:" in compose}
    example = settings_named(DEPLOY / "idtrack-web.env.example")
    assert known - set_for_it <= example <= known, (known - set_for_it - example, example - known)
    vm = DEPLOY / "vm" / "idtrack-web.env.example"
    assert settings_named(vm) <= known
    lines = vm.read_text(encoding="utf-8").splitlines()
    assert {"IDTRACK_WEB_SOURCE=directory", "IDTRACK_WEB_DIRECTORY=/srv/store", "IDTRACK_WEB_WORKERS=3"} <= set(lines)


def version_of(text: str) -> tuple[int, ...]:
    """Return a version ``0.1.2`` as ``(0, 1, 2)``."""
    return tuple(int(n) for n in text.split("."))


def test_setup_deploys_a_release_that_holds_its_files() -> None:
    """Sections 10 to 12 of SETUP.md deploy one release, named alike in every command and in compose.env.example's
    image; every file of deploy/ they use is in this tree, and in that release's tag where the tag exists here. The
    release is this tree's version or, before its tag exists, the next one, the release this tree becomes (the
    release's tag is set on the tree whose version it carries)."""
    setup = (REPOSITORY / "SETUP.md").read_text(encoding="utf-8")
    deploying = setup[setup.index("\n## 10. ") : setup.index("\n## 13. ")]
    commands = "\n".join(line for line in deploying.splitlines() if line.lstrip().startswith("$ "))
    named = set(re.findall(r"git checkout v(\d+\.\d+\.\d+)", commands))
    named |= set(re.findall(r"build_image\.sh (\d+\.\d+\.\d+)", commands))
    named |= set(re.findall(r"idtrack-web:(\d+\.\d+\.\d+)", commands))
    example = (DEPLOY / "compose.env.example").read_text(encoding="utf-8")
    named |= set(re.findall(r"^IDTRACK_WEB_IMAGE=idtrack-web:(\S+)$", example, re.MULTILINE))
    assert len(named) == 1, named
    (release,) = named
    # The checkouts of 10.3, 11 and 12.
    assert len(re.findall(r"git checkout v" + re.escape(release), commands)) == 3
    paths = sorted({p.rstrip(".,;:)") for p in re.findall(r"\bdeploy/[\w./@-]*[\w@]", deploying)})
    # The machine's two files of configuration are written from their examples (and kept out of git).
    written = {"deploy/.env": "deploy/compose.env.example", "deploy/idtrack-web.env": "deploy/idtrack-web.env.example"}
    paths = [written.get(p, p) for p in paths]
    assert len(paths) > 20
    assert [p for p in paths if not (REPOSITORY / p).exists()] == []
    tree = re.search(
        r'^version = "(.+)"$', (REPOSITORY / "api" / "pyproject.toml").read_text(encoding="utf-8"), re.MULTILINE
    )
    assert tree is not None
    tag = f"v{release}"
    found = subprocess.run(
        ["git", "-C", str(REPOSITORY), "rev-parse", "--quiet", "--verify", f"refs/tags/{tag}"],
        capture_output=True,
        check=False,
    )
    if found.returncode == 0:
        assert release == tree.group(1), f"SETUP.md deploys {tag}, an earlier release than this tree's {tree.group(1)}"
        listed = subprocess.run(
            ["git", "-C", str(REPOSITORY), "ls-tree", "-r", "--name-only", tag, "deploy/"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()
        assert [p for p in paths if p not in listed and not any(f.startswith(p + "/") for f in listed)] == [], tag
    else:
        assert version_of(release) >= version_of(tree.group(1)), (release, tree.group(1))
