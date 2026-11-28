"""The configuration: every variable read and checked, misspellings refused, secrets never shown."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from idtrack_web_api.config import ConfigError, Settings, load_s3_access, load_settings

if TYPE_CHECKING:
    from pathlib import Path


def test_defaults(tmp_path: Path) -> None:
    settings = load_settings({"IDTRACK_WEB_SOURCE": "directory", "IDTRACK_WEB_DIRECTORY": str(tmp_path)})
    assert settings == Settings(source="directory", directory=tmp_path)
    assert settings.search_seconds <= settings.request_seconds


def test_every_variable(tmp_path: Path) -> None:
    secret = tmp_path / "secret"
    secret.write_text("s3cr3t\n")
    environ = {
        "IDTRACK_WEB_SOURCE": "s3",
        "IDTRACK_WEB_S3_ENDPOINT": "https://example.r2.cloudflarestorage.com",
        "IDTRACK_WEB_S3_BUCKET": "graphs",
        "IDTRACK_WEB_S3_REGION": "auto",
        "IDTRACK_WEB_S3_ACCESS_KEY_ID": "key",
        "IDTRACK_WEB_S3_SECRET_ACCESS_KEY_FILE": str(secret),
        "IDTRACK_WEB_CACHE_DIR": str(tmp_path / "cache"),
        "IDTRACK_WEB_MANIFEST_KEY": "idtrack/2/manifest.json",
        "IDTRACK_WEB_ORGANISMS": "pig, human",
        "IDTRACK_WEB_WORKERS": "3",
        "IDTRACK_WEB_HOST": "127.0.0.1",
        "IDTRACK_WEB_PORT": "9000",
        "IDTRACK_WEB_FORWARDED_ALLOW_IPS": "127.0.0.1,10.0.0.0/8",
        "IDTRACK_WEB_REQUEST_SECONDS": "30",
        "IDTRACK_WEB_SEARCH_SECONDS": "12.5",
        "IDTRACK_WEB_SEARCH_STATES": "100000",
        "IDTRACK_WEB_BATCH_MAX": "50",
        "IDTRACK_WEB_IDENTIFIER_MAX_LENGTH": "100",
        "IDTRACK_WEB_BODY_MAX_BYTES": "65536",
        "IDTRACK_WEB_RESPONSE_MAX_BYTES": "1000000",
        "IDTRACK_WEB_RATE_PER_MINUTE": "0",
        "IDTRACK_WEB_RATE_BURST": "5",
        "IDTRACK_WEB_QUEUE_MAX": "8",
        "IDTRACK_WEB_STATIC_DIR": str(tmp_path),
        "IDTRACK_WEB_CORS_ORIGINS": "http://localhost:5173",
        "IDTRACK_WEB_LOG_LEVEL": "debug",
    }
    s = load_settings(environ)
    assert (s.source, s.s3_bucket, s.s3_secret_access_key, s.organisms, s.workers) == (
        "s3",
        "graphs",
        "s3cr3t",
        ("pig", "human"),
        3,
    )
    assert (s.search_seconds, s.request_seconds, s.queue_max, s.log_level) == (12.5, 30.0, 8, "DEBUG")
    shown = s.public()
    assert shown["s3_secret_access_key"] == "<set>" and shown["s3_access_key_id"] == "<set>"
    assert "s3cr3t" not in repr(s) and "s3cr3t" not in str(shown)
    access = load_s3_access(environ)
    assert access.secret_access_key == "s3cr3t" and "s3cr3t" not in repr(access)


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"IDTRACK_WEB_SOURCE": None}, "SOURCE=None"),
        ({"IDTRACK_WEB_SOURCE": "ftp"}, "one of directory, s3"),
        ({"IDTRACK_WEB_DIRECTORY": None}, "needs IDTRACK_WEB_DIRECTORY"),
        ({"IDTRACK_WEB_DIRECTORY": "relative/path"}, "absolute path"),
        ({"IDTRACK_WEB_DIRECTORY": "/no/such/folder"}, "not an existing folder"),
        ({"IDTRACK_WEB_WORKERS": "0"}, "outside 1 to 64"),
        ({"IDTRACK_WEB_WORKERS": "two"}, "not a whole number"),
        ({"IDTRACK_WEB_REQUEST_SECONDS": "nan"}, "more than 0"),
        ({"IDTRACK_WEB_REQUEST_SECONDS": "-1"}, "more than 0"),
        ({"IDTRACK_WEB_REQUEST_SECONDS": "5", "IDTRACK_WEB_SEARCH_SECONDS": "6"}, "cannot take longer"),
        ({"IDTRACK_WEB_ORGANISMS": "pig,,human"}, "empty item"),
        ({"IDTRACK_WEB_ORGANISMS": "pig,pig"}, "twice"),
        ({"IDTRACK_WEB_FORWARDED_ALLOW_IPS": "proxy.local"}, "not an IP address"),
        ({"IDTRACK_WEB_LOG_LEVEL": "LOUD"}, "LOG_LEVEL"),
        ({"IDTRACK_WEB_MANIFEST_KEY": "../manifest.json"}, "without '..'"),
        ({"IDTRACK_WEB_WORKER": "2"}, "Unknown variables"),
        ({"IDTRACK_WEB_PORT": ""}, "set but empty"),
    ],
)
def test_refusals(tmp_path: Path, changes: dict[str, str | None], message: str) -> None:
    environ: dict[str, str] = {"IDTRACK_WEB_SOURCE": "directory", "IDTRACK_WEB_DIRECTORY": str(tmp_path)}
    for key, value in changes.items():
        if value is None:
            environ.pop(key, None)
        else:
            environ[key] = value
    with pytest.raises(ConfigError, match=message):
        load_settings(environ)


def test_s3_needs_everything(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="IDTRACK_WEB_S3_ENDPOINT, IDTRACK_WEB_S3_BUCKET"):
        load_settings({"IDTRACK_WEB_SOURCE": "s3"})
    with pytest.raises(ConfigError, match="https://"):
        load_settings({"IDTRACK_WEB_SOURCE": "s3", "IDTRACK_WEB_S3_ENDPOINT": "r2.example"})
    with pytest.raises(ConfigError, match="not both"):
        load_s3_access({"IDTRACK_WEB_S3_ACCESS_KEY_ID": "a", "IDTRACK_WEB_S3_ACCESS_KEY_ID_FILE": "/x"})
    with pytest.raises(ConfigError, match="cannot be read"):
        load_s3_access({"IDTRACK_WEB_S3_ACCESS_KEY_ID_FILE": str(tmp_path / "missing")})
    with pytest.raises(ConfigError, match="needs IDTRACK_WEB_S3_ENDPOINT"):
        load_s3_access({})


def test_docs_url(tmp_path: Path) -> None:
    base = {"IDTRACK_WEB_SOURCE": "directory", "IDTRACK_WEB_DIRECTORY": str(tmp_path)}
    assert load_settings(base).docs_url == "https://idtrack.readthedocs.io/en/stable/"
    # The documentation's own name, written with or without the closing slash: one root ending in "/".
    assert load_settings({**base, "IDTRACK_WEB_DOCS_URL": "https://docs.example.org"}).docs_url == (
        "https://docs.example.org/"
    )
    assert load_settings({**base, "IDTRACK_WEB_DOCS_URL": "https://example.org/idtrack/"}).docs_url == (
        "https://example.org/idtrack/"
    )
    for wrong in ("docs.example.org", "https://docs.example.org/?v=1", "ftp://docs.example.org/"):
        with pytest.raises(ConfigError, match="DOCS_URL"):
            load_settings({**base, "IDTRACK_WEB_DOCS_URL": wrong})


def test_analytics_id(tmp_path: Path) -> None:
    """The site counts visits only where a measurement id is set; the page's policy allows Google's hosts only then."""
    from idtrack_web_api.guard import page_policy

    base = {"IDTRACK_WEB_SOURCE": "directory", "IDTRACK_WEB_DIRECTORY": str(tmp_path)}
    assert load_settings(base).analytics_id is None
    assert load_settings({**base, "IDTRACK_WEB_ANALYTICS_ID": "G-FYKLWNJBVK"}).analytics_id == "G-FYKLWNJBVK"
    assert load_settings({**base, "IDTRACK_WEB_ANALYTICS_ID": " "}).analytics_id is None
    for wrong in ("UA-12345-1", "G-abc", "G-FYK LWN", "https://example.org"):
        with pytest.raises(ConfigError, match="ANALYTICS_ID"):
            load_settings({**base, "IDTRACK_WEB_ANALYTICS_ID": wrong})
    plain = page_policy(["abc"]).decode()
    counted = page_policy(["abc"], analytics=True).decode()
    assert "google" not in plain and "trusted-types idtrack-worker" in plain
    assert "script-src 'self' 'sha256-abc' https://www.googletagmanager.com/gtag/;" in counted
    assert "connect-src 'self' https://*.google-analytics.com" in counted
    assert "trusted-types idtrack-worker idtrack-analytics goog#html" in counted


def test_https_route(tmp_path: Path, make_client: Any) -> None:
    """The way a deployment serves https is stated where it is set, and `/version` reports it for the privacy page."""
    base = {"IDTRACK_WEB_SOURCE": "directory", "IDTRACK_WEB_DIRECTORY": str(tmp_path)}
    assert load_settings(base).https_route is None
    for route in ("lets_encrypt", "institute_certificate", "behind_proxy"):
        assert load_settings({**base, "IDTRACK_WEB_HTTPS_ROUTE": route}).https_route == route
    with pytest.raises(ConfigError, match="HTTPS_ROUTE"):
        load_settings({**base, "IDTRACK_WEB_HTTPS_ROUTE": "caddy"})
    assert make_client(rate_per_minute=0).get("/api/v1/version").json()["https_route"] is None
    stated = make_client(rate_per_minute=0, https_route="behind_proxy").get("/api/v1/version").json()
    assert stated["https_route"] == "behind_proxy"
