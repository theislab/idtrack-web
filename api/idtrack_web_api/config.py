"""The configuration of the server: environment variables only, each checked at start, none ever logged with a secret.

Every variable starts with ``IDTRACK_WEB_``. A secret can also be given as a file: ``<NAME>_FILE`` holds the path of a
file whose content (without the final line break) is the value, for container secrets. A value that cannot be used
stops the server at start with a message naming the variable, the value and what is accepted.
"""

from __future__ import annotations

import ipaddress
import math
import os
import re
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from collections.abc import Mapping

PREFIX = "IDTRACK_WEB_"
#: IDTrack's documentation, where it is published by default (Read the Docs, the stable version).
DOCS_URL = "https://idtrack.readthedocs.io/en/stable/"
#: The ways a deployment serves https (SETUP.md, section 10.5): Caddy holds a certificate of Let's Encrypt
#: (``lets_encrypt``), or one the institute gave (``institute_certificate``); or the institute's reverse proxy holds
#: the certificate and passes each request, with the visitor's address, to Caddy (``behind_proxy``).
HTTPS_ROUTES = ("lets_encrypt", "institute_certificate", "behind_proxy")
SOURCES = ("directory", "s3")
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")


class ConfigError(Exception):
    """A configuration value that cannot be used; the message names the variable and what it accepts."""


@dataclass(frozen=True)
class Settings:
    """The server's settings (see SETUP.md, "Configuration", for each variable and its default).

    Attributes:
        source: Where the published graph files are read from: ``directory`` (a folder with the layout of the
            bucket, e.g. on the Hetzner node) or ``s3`` (Cloudflare R2 or another S3-compatible store).
        directory: For ``directory``: the folder.
        s3_endpoint: For ``s3``: the endpoint URL (R2: ``https://<account id>.r2.cloudflarestorage.com``).
        s3_bucket: For ``s3``: the bucket.
        s3_region: For ``s3``: the region name the client signs with (R2: ``auto``).
        s3_access_key_id: For ``s3``: the access key id (secret).
        s3_secret_access_key: For ``s3``: the secret access key (secret).
        manifest_key: The key of the manifest in the source; ``None``: ``idtrack/<graph format version>/manifest.json``.
        cache_dir: For ``s3``: the folder where fetched files are kept between starts.
        organisms: The organisms to load; empty: every organism of the manifest.
        workers: Worker processes.
        host: The address the server listens on.
        port: The port the server listens on.
        forwarded_allow_ips: Addresses of reverse proxies whose ``X-Forwarded-For`` names the client.
        request_seconds: The time budget of one request's search, from when it begins to its last conversion.
        queue_seconds: The longest a search waits for a worker free of searches before it is answered ``503``.
        search_seconds: The longest time one identifier's search may take (never more than ``request_seconds``).
        search_states: The most search states one identifier's search may expand.
        batch_max: The most identifiers of one batch.
        identifier_max_length: The longest identifier (characters).
        body_max_bytes: The largest request body.
        response_max_bytes: The largest response body; a larger result is refused, never cut.
        rate_per_minute: Searching requests per minute per client (0: no per-client allowance of any kind).
        rate_burst: Searching requests a client may make at once before the rate applies.
        rate_search_seconds: Seconds of search per minute per client (0: search time not limited).
        rate_search_burst_seconds: The most seconds of search a client's balance holds.
        rate_concurrent_searches: Searching requests a client may have in progress at once (0: not limited).
        queue_max: Requests one worker holds, running or waiting for its search thread, before answering 503.
        head_seconds: The longest a taken connection may take to send its request's head before it is closed.
        body_seconds: The longest a request's body may take to arrive (``408 request_timeout`` after).
        send_seconds: The longest a client may leave an answer untaken before its connection is closed (and the
            grace before the slowest rate the server waits for applies: :py:data:`idtrack_web_api.guard.SEND_MIN_RATE`).
        sending_max_bytes: The most bytes of answers one worker holds for clients that have not taken them yet; an
            answer beyond is refused with ``503 server_busy``.
        answer_cache_bytes: The answers each worker keeps in memory to send again (0: none kept).
        static_dir: A folder of the built frontend to serve at ``/``; ``None``: the API alone.
        public_url: The address the site is reached at (``https://<domain>``), for the absolute links of
            ``/llms.txt``; ``None``: the address of each request.
        docs_url: The address of IDTrack's documentation that the site links to (its root, ending in ``/``):
            Read the Docs' stable version unless the documentation is served under another name.
        analytics_id: The Google Analytics measurement id of the site (``G-...``); the page counts visits with it only
            after the visitor's consent. ``None``: no analytics, and the page's policy allows no other host.
        https_route: How visitors reach the site over https, of the ways SETUP.md documents (section 10.5), for the
            privacy page to say who holds the certificate and who sees each visitor's address
            (:py:data:`HTTPS_ROUTES`); ``None``: not stated (a server not deployed so).
        cors_origins: Origins allowed to call the API from a browser: ``*`` (any page: the API is keyless and
            read-only, and sends no credential), or a list.
        log_level: The level of the server's log.
    """

    source: Literal["directory", "s3"]
    directory: Path | None = None
    s3_endpoint: str | None = None
    s3_bucket: str | None = None
    s3_region: str = "auto"
    s3_access_key_id: str | None = field(default=None, repr=False)
    s3_secret_access_key: str | None = field(default=None, repr=False)
    manifest_key: str | None = None
    cache_dir: Path | None = None
    organisms: tuple[str, ...] = ()
    workers: int = 2
    host: str = "0.0.0.0"  # noqa: S104 - a server in a container listens on every address of the container
    port: int = 8000
    forwarded_allow_ips: tuple[str, ...] = ("127.0.0.1",)
    request_seconds: float = 20.0
    queue_seconds: float = 10.0
    search_seconds: float = 10.0
    search_states: int = 200_000
    batch_max: int = 1000
    identifier_max_length: int = 256
    body_max_bytes: int = 1_048_576
    response_max_bytes: int = 33_554_432
    rate_per_minute: int = 120
    rate_burst: int = 30
    rate_search_seconds: float = 30.0
    rate_search_burst_seconds: float = 60.0
    rate_concurrent_searches: int = 2
    queue_max: int = 64
    head_seconds: float = 5.0
    body_seconds: float = 30.0
    send_seconds: float = 30.0
    sending_max_bytes: int = 268_435_456
    answer_cache_bytes: int = 67_108_864
    static_dir: Path | None = None
    public_url: str | None = None
    docs_url: str = DOCS_URL
    analytics_id: str | None = None
    https_route: str | None = None
    cors_origins: tuple[str, ...] = ("*",)
    log_level: str = "INFO"

    def __post_init__(self) -> None:
        """Check what one value alone cannot say."""
        if self.source == "directory" and self.directory is None:
            msg = f"{PREFIX}SOURCE=directory needs {PREFIX}DIRECTORY (the folder of the published files)."
            raise ConfigError(msg)
        if self.source == "s3":
            missing = [
                name
                for name, value in (
                    ("S3_ENDPOINT", self.s3_endpoint),
                    ("S3_BUCKET", self.s3_bucket),
                    ("S3_ACCESS_KEY_ID", self.s3_access_key_id),
                    ("S3_SECRET_ACCESS_KEY", self.s3_secret_access_key),
                    ("CACHE_DIR", self.cache_dir),
                )
                if value is None
            ]
            if missing:
                msg = f"{PREFIX}SOURCE=s3 needs {', '.join(PREFIX + m for m in missing)}."
                raise ConfigError(msg)
        if self.search_seconds > self.request_seconds:
            msg = (
                f"{PREFIX}SEARCH_SECONDS ({self.search_seconds}) is more than {PREFIX}REQUEST_SECONDS "
                f"({self.request_seconds}): one identifier's search cannot take longer than its request."
            )
            raise ConfigError(msg)

    def public(self) -> dict[str, object]:
        """Return the settings without the secrets (for the log).

        Returns:
            dict[str, object]: Every setting by name, secrets replaced by ``"<set>"`` or ``None``.
        """
        shown: dict[str, object] = {}
        for f in fields(self):
            value = getattr(self, f.name)
            if not f.repr:
                value = None if value is None else "<set>"
            elif isinstance(value, Path):
                value = str(value)
            shown[f.name] = value
        return shown


def _raw(environ: Mapping[str, str], name: str, *, secret: bool = False) -> str | None:
    """Return a variable's value (or, for a secret, the content of the file its ``_FILE`` variable names)."""
    value = environ.get(PREFIX + name)
    if secret:
        path = environ.get(PREFIX + name + "_FILE")
        if path is not None:
            if value is not None:
                msg = f"Give {PREFIX}{name} or {PREFIX}{name}_FILE, not both."
                raise ConfigError(msg)
            try:
                value = Path(path).read_text(encoding="utf-8").rstrip("\r\n")
            except OSError as error:
                msg = f"{PREFIX}{name}_FILE={path!r} cannot be read: {error.strerror}."
                raise ConfigError(msg) from None
    if value is None:
        return None
    value = value.strip()
    if not value:
        msg = f"{PREFIX}{name} is set but empty; unset it for the default."
        raise ConfigError(msg)
    return value


def _integer(environ: Mapping[str, str], name: str, default: int, minimum: int, maximum: int) -> int:
    raw = _raw(environ, name)
    if raw is None:
        return default
    try:
        value = int(raw, 10)
    except ValueError:
        msg = f"{PREFIX}{name}={raw!r} is not a whole number."
        raise ConfigError(msg) from None
    if not minimum <= value <= maximum:
        msg = f"{PREFIX}{name}={value} is outside {minimum} to {maximum}."
        raise ConfigError(msg)
    return value


def _seconds(environ: Mapping[str, str], name: str, default: float, maximum: float, *, zero: bool = False) -> float:
    raw = _raw(environ, name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        msg = f"{PREFIX}{name}={raw!r} is not a number of seconds."
        raise ConfigError(msg) from None
    least = "at least 0" if zero else "more than 0"
    if not (math.isfinite(value) and (value >= 0 if zero else value > 0) and value <= maximum):
        msg = f"{PREFIX}{name}={raw!r} must be {least} and at most {maximum} seconds."
        raise ConfigError(msg)
    return value


def _words(environ: Mapping[str, str], name: str) -> tuple[str, ...]:
    raw = _raw(environ, name)
    if raw is None:
        return ()
    words = tuple(w.strip() for w in raw.split(","))
    if any(not w for w in words):
        msg = f"{PREFIX}{name}={raw!r} holds an empty item; separate items by single commas."
        raise ConfigError(msg)
    if len(set(words)) != len(words):
        msg = f"{PREFIX}{name}={raw!r} names an item twice."
        raise ConfigError(msg)
    return words


def _folder(environ: Mapping[str, str], name: str, *, must_exist: bool) -> Path | None:
    raw = _raw(environ, name)
    if raw is None:
        return None
    path = Path(raw)
    if not path.is_absolute():
        msg = f"{PREFIX}{name}={raw!r} must be an absolute path."
        raise ConfigError(msg)
    if must_exist and not path.is_dir():
        msg = f"{PREFIX}{name}={raw!r} is not an existing folder."
        raise ConfigError(msg)
    return path


def _https_url(environ: Mapping[str, str], name: str) -> str | None:
    raw = _raw(environ, name)
    if raw is not None and not raw.startswith(("https://", "http://")):
        msg = f"{PREFIX}{name}={raw!r} must be a URL starting with https:// (or http:// for a local test)."
        raise ConfigError(msg)
    return raw


def _docs_url(environ: Mapping[str, str], name: str) -> str:
    raw = _https_url(environ, name)
    if raw is None:
        return DOCS_URL
    if any(ch in raw for ch in "?#@ "):
        msg = f"{PREFIX}{name}={raw!r} must be the documentation's root: https://<domain>[/<path>]/."
        raise ConfigError(msg)
    return raw.rstrip("/") + "/"


def _analytics_id(environ: Mapping[str, str], name: str) -> str | None:
    raw = environ.get(PREFIX + name, "").strip()
    if not raw:
        return None
    if not re.fullmatch(r"G-[A-Z0-9]{4,20}", raw):
        msg = f"{PREFIX}{name}={raw!r} must be a Google Analytics measurement id: G- and 4 to 20 capitals or digits."
        raise ConfigError(msg)
    return raw


def _https_route(environ: Mapping[str, str], name: str) -> str | None:
    raw = environ.get(PREFIX + name, "").strip()
    if not raw:
        return None
    if raw not in HTTPS_ROUTES:
        msg = f"{PREFIX}{name}={raw!r} must be one of {', '.join(HTTPS_ROUTES)} (SETUP.md, section 10.5)."
        raise ConfigError(msg)
    return raw


def _public_url(environ: Mapping[str, str], name: str) -> str | None:
    raw = _https_url(environ, name)
    if raw is None:
        return None
    rest = raw.split("://", 1)[1]
    if not rest or "/" in rest.rstrip("/") or any(ch in rest for ch in "?#@ "):
        msg = f"{PREFIX}{name}={raw!r} must be an origin only: https://<domain>[:<port>]."
        raise ConfigError(msg)
    return raw.rstrip("/")


def _origins(environ: Mapping[str, str], name: str) -> tuple[str, ...]:
    words = _words(environ, name)
    if not words:
        return ("*",)
    if words == ("none",):
        return ()
    for word in words:
        if word != "*" and not word.startswith(("https://", "http://")):
            msg = f"{PREFIX}{name}: {word!r} is not an origin (https://<domain>), '*' (any page) or 'none' (alone)."
            raise ConfigError(msg)
    if "*" in words and len(words) > 1:
        msg = f"{PREFIX}{name}: '*' already allows every origin; give it alone."
        raise ConfigError(msg)
    return words


def _addresses(environ: Mapping[str, str], name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    words = _words(environ, name) or default
    for word in words:
        if word == "*":
            continue
        try:
            ipaddress.ip_network(word, strict=False)
        except ValueError:
            msg = f"{PREFIX}{name}: {word!r} is not an IP address or network (or '*')."
            raise ConfigError(msg) from None
    return words


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    """Read the settings from the environment, checking every value.

    Args:
        environ: The environment; ``None``: :py:data:`os.environ`.

    Returns:
        Settings: The settings.

    Raises:
        ConfigError: For a value that cannot be used (the message names the variable).
    """
    env = os.environ if environ is None else environ
    known = {PREFIX + f.name.upper() for f in fields(Settings)}
    known |= {PREFIX + "S3_ACCESS_KEY_ID_FILE", PREFIX + "S3_SECRET_ACCESS_KEY_FILE"}
    unknown = sorted(k for k in env if k.startswith(PREFIX) and k not in known)
    if unknown:
        msg = f"Unknown variables (a misspelling?): {', '.join(unknown)}. Known: {', '.join(sorted(known))}."
        raise ConfigError(msg)
    source = _raw(env, "SOURCE")
    if source not in SOURCES:
        msg = f"{PREFIX}SOURCE={source!r}; set it to one of {', '.join(SOURCES)}."
        raise ConfigError(msg)
    log_level = (_raw(env, "LOG_LEVEL") or "INFO").upper()
    if log_level not in LOG_LEVELS:
        msg = f"{PREFIX}LOG_LEVEL={log_level!r}; one of {', '.join(LOG_LEVELS)}."
        raise ConfigError(msg)
    manifest_key = _raw(env, "MANIFEST_KEY")
    if manifest_key is not None and (manifest_key.startswith("/") or ".." in manifest_key.split("/")):
        msg = f"{PREFIX}MANIFEST_KEY={manifest_key!r} must be a relative key without '..'."
        raise ConfigError(msg)
    request_seconds = _seconds(env, "REQUEST_SECONDS", 20.0, 600.0)
    return Settings(
        source=source,  # type: ignore[arg-type]  # checked against SOURCES above
        directory=_folder(env, "DIRECTORY", must_exist=True),
        s3_endpoint=_https_url(env, "S3_ENDPOINT"),
        s3_bucket=_raw(env, "S3_BUCKET"),
        s3_region=_raw(env, "S3_REGION") or "auto",
        s3_access_key_id=_raw(env, "S3_ACCESS_KEY_ID", secret=True),
        s3_secret_access_key=_raw(env, "S3_SECRET_ACCESS_KEY", secret=True),
        manifest_key=manifest_key,
        cache_dir=_folder(env, "CACHE_DIR", must_exist=False),
        organisms=_words(env, "ORGANISMS"),
        workers=_integer(env, "WORKERS", 2, 1, 64),
        host=_raw(env, "HOST") or "0.0.0.0",  # noqa: S104 - see Settings.host
        port=_integer(env, "PORT", 8000, 1, 65535),
        forwarded_allow_ips=_addresses(env, "FORWARDED_ALLOW_IPS", ("127.0.0.1",)),
        request_seconds=request_seconds,
        queue_seconds=_seconds(env, "QUEUE_SECONDS", 10.0, 600.0),
        search_seconds=_seconds(env, "SEARCH_SECONDS", min(10.0, request_seconds), 600.0),
        search_states=_integer(env, "SEARCH_STATES", 200_000, 1_000, 100_000_000),
        batch_max=_integer(env, "BATCH_MAX", 1000, 1, 100_000),
        identifier_max_length=_integer(env, "IDENTIFIER_MAX_LENGTH", 256, 16, 4096),
        body_max_bytes=_integer(env, "BODY_MAX_BYTES", 1_048_576, 1024, 1_073_741_824),
        response_max_bytes=_integer(env, "RESPONSE_MAX_BYTES", 33_554_432, 65_536, 1_073_741_824),
        rate_per_minute=_integer(env, "RATE_PER_MINUTE", 120, 0, 1_000_000),
        rate_burst=_integer(env, "RATE_BURST", 30, 1, 1_000_000),
        rate_search_seconds=_seconds(env, "RATE_SEARCH_SECONDS", 30.0, 3600.0, zero=True),
        rate_search_burst_seconds=_seconds(env, "RATE_SEARCH_BURST_SECONDS", 60.0, 3600.0, zero=True),
        rate_concurrent_searches=_integer(env, "RATE_CONCURRENT_SEARCHES", 2, 0, 1_000_000),
        queue_max=_integer(env, "QUEUE_MAX", 64, 1, 100_000),
        head_seconds=_seconds(env, "HEAD_SECONDS", 5.0, 600.0),
        body_seconds=_seconds(env, "BODY_SECONDS", 30.0, 600.0),
        send_seconds=_seconds(env, "SEND_SECONDS", 30.0, 3600.0),
        sending_max_bytes=_integer(env, "SENDING_MAX_BYTES", 268_435_456, 1_048_576, 17_179_869_184),
        answer_cache_bytes=_integer(env, "ANSWER_CACHE_BYTES", 67_108_864, 0, 17_179_869_184),
        static_dir=_folder(env, "STATIC_DIR", must_exist=True),
        public_url=_public_url(env, "PUBLIC_URL"),
        docs_url=_docs_url(env, "DOCS_URL"),
        analytics_id=_analytics_id(env, "ANALYTICS_ID"),
        https_route=_https_route(env, "HTTPS_ROUTE"),
        cors_origins=_origins(env, "CORS_ORIGINS"),
        log_level=log_level,
    )


@dataclass(frozen=True)
class S3Access:
    """How to reach a bucket, for publishing (the same variables as the server's).

    Attributes:
        endpoint: ``IDTRACK_WEB_S3_ENDPOINT``.
        bucket: ``IDTRACK_WEB_S3_BUCKET``.
        region: ``IDTRACK_WEB_S3_REGION`` (default ``auto``).
        access_key_id: ``IDTRACK_WEB_S3_ACCESS_KEY_ID`` (or ``_FILE``).
        secret_access_key: ``IDTRACK_WEB_S3_SECRET_ACCESS_KEY`` (or ``_FILE``).
    """

    endpoint: str
    bucket: str
    region: str
    access_key_id: str = field(repr=False)
    secret_access_key: str = field(repr=False)


def load_s3_access(environ: Mapping[str, str] | None = None) -> S3Access:
    """Read the variables of a bucket.

    Args:
        environ: The environment; ``None``: :py:data:`os.environ`.

    Returns:
        S3Access: The bucket's access.

    Raises:
        ConfigError: If one is missing or cannot be used.
    """
    env = os.environ if environ is None else environ
    values = {
        "S3_ENDPOINT": _https_url(env, "S3_ENDPOINT"),
        "S3_BUCKET": _raw(env, "S3_BUCKET"),
        "S3_ACCESS_KEY_ID": _raw(env, "S3_ACCESS_KEY_ID", secret=True),
        "S3_SECRET_ACCESS_KEY": _raw(env, "S3_SECRET_ACCESS_KEY", secret=True),
    }
    missing = [PREFIX + k for k, v in values.items() if v is None]
    if missing:
        msg = f"Publishing to a bucket needs {', '.join(missing)}."
        raise ConfigError(msg)
    return S3Access(
        endpoint=str(values["S3_ENDPOINT"]),
        bucket=str(values["S3_BUCKET"]),
        region=_raw(env, "S3_REGION") or "auto",
        access_key_id=str(values["S3_ACCESS_KEY_ID"]),
        secret_access_key=str(values["S3_SECRET_ACCESS_KEY"]),
    )
