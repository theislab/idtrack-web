"""The data layer: the manifest, the folder store, the bucket store (through a local S3 server), and every refusal."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from idtrack.graph import GRAPH_FORMAT_VERSION

from idtrack_web_api.data import (
    DataError,
    DirectoryStore,
    Manifest,
    ManifestFile,
    S3Store,
    default_manifest_key,
    file_digest,
    manifest_bytes,
    parse_manifest,
    prepare,
    s3_client,
)
from idtrack_web_api.graphs import load_registry
from idtrack_web_api.publish import DirectoryTarget, S3Target, graph_entry, publish
from tests.conftest import API_ROOT, CUT_GRAPH, registry_of, settings_of

if TYPE_CHECKING:
    from collections.abc import Iterator

ACCESS = {"access_key_id": "testing-key", "secret_access_key": "testing-secret"}


def published(tmp_path: Path, *, link: bool = False) -> tuple[Path, Manifest]:
    root = tmp_path / "store"
    manifest, _ = publish([CUT_GRAPH], DirectoryTarget(root, link=link))
    return root, manifest


# ------------------------------------------------------------------------------------------------------------------
# The manifest


def test_manifest_round_trip_and_example(tmp_path: Path) -> None:
    root, manifest = published(tmp_path)
    content = (root / default_manifest_key()).read_bytes()
    assert content == manifest_bytes(manifest)
    assert parse_manifest(content, "here") == manifest
    [graph] = manifest.graphs
    sha256, size = file_digest(CUT_GRAPH)
    assert graph.file == ManifestFile(
        key=f"idtrack/{GRAPH_FORMAT_VERSION}/sus_scrofa/{sha256}.npz", sha256=sha256, size=size
    )
    # The immutable copy is named by its own content.
    copies = list((root / f"idtrack/{GRAPH_FORMAT_VERSION}/manifests").iterdir())
    assert [c.read_bytes() for c in copies] == [content]
    # The example of data/ is a valid manifest, and the schema of data/ is the model's.
    example = API_ROOT.parent / "data" / "manifest.example.json"
    parse_manifest(example.read_bytes(), str(example))
    schema = json.loads((API_ROOT.parent / "data" / "manifest.schema.json").read_text())
    assert schema == Manifest.model_json_schema()


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.update(schema_version=2),
        lambda d: d.update(format_version="2"),
        lambda d: d.update(extra=1),
        lambda d: d["graphs"][0].update(organism="Sus Scrofa"),
        lambda d: d["graphs"][0]["file"].update(sha256="A" * 64),
        lambda d: d["graphs"][0]["file"].update(size=0),
        lambda d: d["graphs"][0]["file"].update(key="idtrack/2/sus_scrofa/other.npz"),
        lambda d: d["graphs"].append(dict(d["graphs"][0])),
        lambda d: d.update(graphs=[]),
    ],
)
def test_manifest_refusals(tmp_path: Path, change: Any) -> None:
    _, manifest = published(tmp_path)
    data = json.loads(manifest_bytes(manifest))
    change(data)
    with pytest.raises(DataError, match="not a valid manifest"):
        parse_manifest(json.dumps(data).encode(), "test")
    with pytest.raises(DataError, match="not a valid manifest"):
        parse_manifest(b"{not json", "test")
    with pytest.raises(DataError, match="at most"):
        parse_manifest(b" " * 2_000_000, "test")


# ------------------------------------------------------------------------------------------------------------------
# The folder store: verification and refusals


def test_directory_store_verifies(tmp_path: Path) -> None:
    root, manifest = published(tmp_path)
    data = prepare(DirectoryStore(root), default_manifest_key(), ())
    assert data.files == {"sus_scrofa": root / manifest.graphs[0].file.key}
    registry = load_registry(data)
    assert registry.graphs["sus_scrofa"].graph.releases()[0] == 56


def test_checksum_refusal(tmp_path: Path) -> None:
    """A file whose bytes differ from the manifest's SHA-256 is never loaded; the size is checked first."""
    root, manifest = published(tmp_path)
    path = root / manifest.graphs[0].file.key
    content = bytearray(path.read_bytes())
    content[len(content) // 2] ^= 0x01  # one bit, same size
    path.write_bytes(bytes(content))
    with pytest.raises(DataError, match="SHA-256"):
        prepare(DirectoryStore(root), default_manifest_key(), ())
    path.write_bytes(bytes(content[:-1]))
    with pytest.raises(DataError, match="bytes; the manifest says"):
        prepare(DirectoryStore(root), default_manifest_key(), ())
    path.unlink()
    with pytest.raises(DataError, match="cannot be read"):
        prepare(DirectoryStore(root), default_manifest_key(), ())


def test_other_refusals(tmp_path: Path) -> None:
    root, manifest = published(tmp_path)
    with pytest.raises(DataError, match="cannot be read"):
        prepare(DirectoryStore(tmp_path / "empty"), default_manifest_key(), ())
    with pytest.raises(DataError, match="lists no graph of 'homo_sapiens'"):
        prepare(DirectoryStore(root), default_manifest_key(), ("homo_sapiens",))
    with pytest.raises(DataError, match="leaves the store"):
        DirectoryStore(root).read_bytes("../outside.json", 100)
    # A manifest of another graph format.
    other = json.loads(manifest_bytes(manifest))
    other["format_version"] = GRAPH_FORMAT_VERSION + 1
    other["graphs"][0]["file"]["key"] = other["graphs"][0]["file"]["key"].replace(
        f"idtrack/{GRAPH_FORMAT_VERSION}/", f"idtrack/{GRAPH_FORMAT_VERSION + 1}/"
    )
    (root / "other.json").write_text(json.dumps(other))
    with pytest.raises(DataError, match="this idtrack reads"):
        prepare(DirectoryStore(root), "other.json", ())


def test_a_graph_that_is_not_the_manifests(tmp_path: Path) -> None:
    """The file's bytes match, but the graph inside is not what the manifest says (digest, snapshot): refused."""
    root, manifest = published(tmp_path)
    for field, value in (("content_digest", "0" * 64), ("snapshot_release", 114)):
        changed = json.loads(manifest_bytes(manifest))
        changed["graphs"][0][field] = value
        (root / "changed.json").write_text(json.dumps(changed))
        with pytest.raises(DataError, match="is not the graph the manifest names"):
            registry_of(settings_of(root, manifest_key="changed.json"))


def test_check_data_command_refuses_a_damaged_file(tmp_path: Path) -> None:
    """``idtrack-web check-data`` (what ``serve`` does before forking) exits 2 with the reason, and 0 when sound."""
    root, manifest = published(tmp_path)
    environment = {
        **{k: v for k, v in os.environ.items() if not k.startswith("IDTRACK_WEB_")},
        "IDTRACK_WEB_SOURCE": "directory",
        "IDTRACK_WEB_DIRECTORY": str(root),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    command = [sys.executable, "-m", "idtrack_web_api.cli", "check-data"]
    sound = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=300, check=False)
    assert sound.returncode == 0, sound.stderr
    assert json.loads(sound.stdout)["graphs"]["sus_scrofa"]["file"]["sha256"] == manifest.graphs[0].file.sha256
    path = root / manifest.graphs[0].file.key
    content = bytearray(path.read_bytes())
    content[100] ^= 0xFF
    path.write_bytes(bytes(content))
    damaged = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=300, check=False)
    assert damaged.returncode == 2
    assert "the SHA-256 of" in damaged.stderr
    for serve in ([sys.executable, "-m", "idtrack_web_api.cli", "serve"],):
        refused = subprocess.run(serve, env=environment, capture_output=True, text=True, timeout=300, check=False)
        assert refused.returncode == 2
        assert "the SHA-256 of" in refused.stderr


# ------------------------------------------------------------------------------------------------------------------
# Publishing to a folder


def test_publish_directory(tmp_path: Path) -> None:
    target = DirectoryTarget(tmp_path / "store")
    manifest, done = publish([CUT_GRAPH], target)
    key = manifest.graphs[0].file.key
    assert done[key] == "copied"
    again, done = publish([CUT_GRAPH], target)
    assert done[key] == "kept"
    assert again.graphs == manifest.graphs
    # A content key that holds other bytes is never replaced.
    (tmp_path / "store" / key).write_bytes(b"other")
    with pytest.raises(DataError, match="never replaced"):
        publish([CUT_GRAPH], target)
    # Links (development): the store refers to the source file.
    linked, done = publish([CUT_GRAPH], DirectoryTarget(tmp_path / "linked", link=True))
    path = tmp_path / "linked" / linked.graphs[0].file.key
    assert path.is_symlink() and path.resolve() == CUT_GRAPH.resolve()
    assert done[linked.graphs[0].file.key] == "linked"


def test_publish_refuses_what_is_not_a_graph(tmp_path: Path) -> None:
    junk = tmp_path / "junk.npz"
    junk.write_bytes(b"not a graph")
    with pytest.raises(DataError, match="not a graph this idtrack reads"):
        publish([junk], DirectoryTarget(tmp_path / "store"))
    copy = tmp_path / "copy.npz"
    shutil.copyfile(CUT_GRAPH, copy)
    with pytest.raises(DataError, match="one organism"):
        publish([CUT_GRAPH, copy], DirectoryTarget(tmp_path / "store"))
    assert not (tmp_path / "store").exists()


def test_graph_entry() -> None:
    entry = graph_entry(CUT_GRAPH)
    assert entry.organism == "sus_scrofa"
    assert entry.snapshot_release == 115


# ------------------------------------------------------------------------------------------------------------------
# A bucket, through a local S3-compatible server (moto)


@pytest.fixture(scope="module")
def s3_endpoint() -> Iterator[str]:
    from moto.server import ThreadedMotoServer

    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
    server.start()
    host, port = server.get_host_and_port()
    try:
        yield f"http://{host}:{port}"
    finally:
        server.stop()


def bucket(endpoint: str, name: str) -> Any:
    """Make a bucket (in the local server's default region) and return a client that signs as R2 does (``auto``)."""
    s3_client(endpoint, "us-east-1", **ACCESS).create_bucket(Bucket=name)
    return s3_client(endpoint, "auto", **ACCESS)


def test_s3_publish_fetch_and_verify(s3_endpoint: str, tmp_path: Path) -> None:
    client = bucket(s3_endpoint, "graphs-a")
    manifest, done = publish([CUT_GRAPH], S3Target(client, "graphs-a", s3_endpoint))
    key = manifest.graphs[0].file.key
    assert done[key] == "uploaded"
    head = client.head_object(Bucket="graphs-a", Key=key)
    assert head["ContentLength"] == manifest.graphs[0].file.size
    assert head["Metadata"]["sha256"] == manifest.graphs[0].file.sha256
    assert publish([CUT_GRAPH], S3Target(client, "graphs-a", s3_endpoint))[1][key] == "kept"
    keys = {o["Key"] for o in client.list_objects_v2(Bucket="graphs-a")["Contents"]}
    assert key in keys and default_manifest_key() in keys
    assert any(k.startswith(f"idtrack/{GRAPH_FORMAT_VERSION}/manifests/") for k in keys)

    cache = tmp_path / "cache"
    store = S3Store(client, "graphs-a", cache, s3_endpoint)
    data = prepare(store, default_manifest_key(), ())
    path = data.files["sus_scrofa"]
    assert path == cache / key
    assert file_digest(path) == (manifest.graphs[0].file.sha256, manifest.graphs[0].file.size)
    assert not [p for p in path.parent.iterdir() if ".part-" in p.name]

    # The served app over the bucket, through the server's own configuration.
    settings = replace(
        settings_of(tmp_path),
        source="s3",
        directory=None,
        s3_endpoint=s3_endpoint,
        s3_bucket="graphs-a",
        s3_access_key_id=ACCESS["access_key_id"],
        s3_secret_access_key=ACCESS["secret_access_key"],
        cache_dir=tmp_path / "cache2",
    )
    registry = registry_of(settings)
    assert registry.graphs["sus_scrofa"].path == tmp_path / "cache2" / key

    # A damaged cached copy is fetched again.
    content = bytearray(path.read_bytes())
    content[10] ^= 0x01
    path.write_bytes(bytes(content))
    again = prepare(store, default_manifest_key(), ())
    assert file_digest(again.files["sus_scrofa"])[0] == manifest.graphs[0].file.sha256


def test_s3_refuses_a_damaged_object(s3_endpoint: str, tmp_path: Path) -> None:
    client = bucket(s3_endpoint, "graphs-b")
    manifest, _ = publish([CUT_GRAPH], S3Target(client, "graphs-b", s3_endpoint))
    key = manifest.graphs[0].file.key
    content = bytearray(CUT_GRAPH.read_bytes())
    content[1000] ^= 0x01
    client.put_object(Bucket="graphs-b", Key=key, Body=bytes(content))  # replaced behind the publisher's back
    store = S3Store(client, "graphs-b", tmp_path / "cache", s3_endpoint)
    with pytest.raises(DataError, match="SHA-256"):
        prepare(store, default_manifest_key(), ())
    # Nothing unverified is left in the cache.
    folder = tmp_path / "cache" / Path(key).parent
    assert not any(folder.iterdir())
    # A publisher never replaces a content key that holds another object.
    with pytest.raises(DataError, match="never replaced"):
        publish([CUT_GRAPH], S3Target(client, "graphs-b", s3_endpoint))


def test_s3_errors_say_what(s3_endpoint: str, tmp_path: Path) -> None:
    client = s3_client(s3_endpoint, "auto", **ACCESS)
    store = S3Store(client, "no-such-bucket", tmp_path, s3_endpoint)
    with pytest.raises(DataError, match="NoSuchBucket"):
        prepare(store, default_manifest_key(), ())
    client = bucket(s3_endpoint, "graphs-c")
    with pytest.raises(DataError, match="NoSuchKey"):
        prepare(S3Store(client, "graphs-c", tmp_path, s3_endpoint), default_manifest_key(), ())
