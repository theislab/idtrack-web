"""The data layer: the manifest of published graph files, the stores they are read from, and their verification.

A release of graphs is published (:py:mod:`idtrack_web_api.publish`) as immutable objects named by their content,
``idtrack/<graph format version>/<organism>/<sha256>.npz`` (the graph) and
``idtrack/<graph format version>/<organism>/<sha256>.lineages.json`` (the lineages of its gene ids, computed by the
publisher: :py:mod:`idtrack_web_api.lineages`), beside a small manifest (``idtrack/<format>/manifest.json`` by default)
that lists, per organism, each file's key, SHA-256 and size and what the graph is (snapshot release, content digest,
the IDTrack that built it). A store is either a folder with that layout (the owner's Hetzner node) or an
S3-compatible bucket (Cloudflare R2).

At start the server reads the manifest, makes every file it needs local (a folder store: in place; a bucket: in the
cache folder, fetched to a temporary name and renamed only after its SHA-256 and size are verified), verifies the
SHA-256 and size of every local file before loading it, and refuses to start on any mismatch.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Final, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from idtrack_web_api.adapter import FORMAT_VERSION

if TYPE_CHECKING:
    from collections.abc import Iterator

    from mypy_boto3_s3 import S3Client

    from idtrack_web_api.config import Settings

log = logging.getLogger(__name__)

#: The version of the manifest's own layout (not IDTrack's graph format): 2 names each graph's lineages file.
MANIFEST_SCHEMA_VERSION: Final = 2
#: The largest manifest read (a manifest of five organisms is about 3 kB).
MANIFEST_MAX_BYTES = 1_048_576
_CHUNK = 8 * 1024 * 1024
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_ORGANISM = re.compile(r"^[a-z][a-z0-9_]*$")


class DataError(Exception):
    """The published data cannot be used: missing, unreadable, or not what the manifest says. The server stops."""


def default_manifest_key(format_version: int = FORMAT_VERSION) -> str:
    """Return the key of the current manifest of a graph format.

    Args:
        format_version: The graph format version.

    Returns:
        str: ``idtrack/<format_version>/manifest.json``.
    """
    return f"idtrack/{format_version}/manifest.json"


def object_key(format_version: int, organism: str, sha256: str) -> str:
    """Return the key of a graph file, named by its content.

    Args:
        format_version: The graph format version.
        organism: The organism.
        sha256: The SHA-256 of the file's bytes (lowercase hex).

    Returns:
        str: ``idtrack/<format_version>/<organism>/<sha256>.npz``.
    """
    return f"idtrack/{format_version}/{organism}/{sha256}.npz"


def lineages_key(format_version: int, organism: str, sha256: str) -> str:
    """Return the key of a graph's lineages file, named by its content.

    Args:
        format_version: The graph format version.
        organism: The organism.
        sha256: The SHA-256 of the file's bytes (lowercase hex).

    Returns:
        str: ``idtrack/<format_version>/<organism>/<sha256>.lineages.json``.
    """
    return f"idtrack/{format_version}/{organism}/{sha256}.lineages.json"


# ------------------------------------------------------------------------------------------------------------------
# The manifest

_STRICT = ConfigDict(extra="forbid", strict=True, frozen=True)


class ManifestFile(BaseModel):
    """A published file: where it is and what its bytes are."""

    model_config = _STRICT
    key: str = Field(
        ...,
        description=(
            "The key in the store: `idtrack/<format>/<organism>/<sha256>.npz` (a graph) or "
            "`idtrack/<format>/<organism>/<sha256>.lineages.json` (its lineages)."
        ),
    )
    sha256: str = Field(..., pattern=_SHA256.pattern, description="The SHA-256 of the file's bytes (lowercase hex).")
    size: int = Field(..., gt=0, description="The size of the file in bytes.")


class ManifestGraph(BaseModel):
    """One organism's graph in a manifest."""

    model_config = _STRICT
    organism: str = Field(..., pattern=_ORGANISM.pattern, description="The organism (Ensembl production name).")
    snapshot_release: int = Field(..., gt=0, description="The last Ensembl release of the graph.")
    file: ManifestFile
    lineages: ManifestFile = Field(
        ...,
        description=(
            "The lineages of the graph's gene ids, computed from the graph by the publisher and read by the server at "
            "start (`GET /api/v1/organisms/{organism}/lineages`)."
        ),
    )
    content_digest: str = Field(..., pattern=_SHA256.pattern, description="The graph's content digest (its build's).")
    idtrack_version: str | None = Field(..., description="The IDTrack version that built the graph.")
    idtrack_commit: str | None = Field(..., description="The IDTrack commit that built the graph, where known.")
    build_date: str | None = Field(..., description="When the graph was built.")


class Manifest(BaseModel):
    """A release of published graphs: what a server loads."""

    model_config = _STRICT
    schema_version: Literal[2] = Field(..., description="The version of this manifest's layout.")
    format_version: int = Field(..., gt=0, description="The graph file format of every graph listed.")
    published: str = Field(..., description="When the manifest was written (UTC, ISO 8601).")
    publisher: str = Field(..., description="The idtrack-web-api and IDTrack versions that wrote the manifest.")
    graphs: tuple[ManifestGraph, ...] = Field(..., min_length=1, description="One graph per organism.")

    @model_validator(mode="after")
    def _consistent(self) -> Manifest:
        organisms = [g.organism for g in self.graphs]
        if len(set(organisms)) != len(organisms):
            msg = f"an organism is listed twice: {sorted(organisms)}"
            raise ValueError(msg)
        for graph in self.graphs:
            expected = object_key(self.format_version, graph.organism, graph.file.sha256)
            if graph.file.key != expected:
                msg = f"the key of {graph.organism} is {graph.file.key!r}; a content key is {expected!r}"
                raise ValueError(msg)
            expected = lineages_key(self.format_version, graph.organism, graph.lineages.sha256)
            if graph.lineages.key != expected:
                msg = f"the lineages key of {graph.organism} is {graph.lineages.key!r}; a content key is {expected!r}"
                raise ValueError(msg)
        return self

    def graph(self, organism: str) -> ManifestGraph:
        """Return the entry of an organism.

        Args:
            organism: The organism.

        Returns:
            ManifestGraph: Its entry.

        Raises:
            DataError: If the manifest does not list it.
        """
        for graph in self.graphs:
            if graph.organism == organism:
                return graph
        msg = f"The manifest lists no graph of {organism!r}; it lists {[g.organism for g in self.graphs]}."
        raise DataError(msg)


def parse_manifest(content: bytes, where: str) -> Manifest:
    """Read a manifest's bytes, refusing anything that is not a manifest of this layout.

    Args:
        content: The bytes.
        where: Where they were read (for messages).

    Returns:
        Manifest: The manifest.

    Raises:
        DataError: If it is not one.
    """
    if len(content) > MANIFEST_MAX_BYTES:
        msg = f"The manifest {where} is {len(content)} bytes; a manifest is at most {MANIFEST_MAX_BYTES}."
        raise DataError(msg)
    try:
        layout = json.loads(content).get("schema_version")
    except (ValueError, AttributeError):
        layout = None
    if isinstance(layout, int) and layout < MANIFEST_SCHEMA_VERSION:
        msg = (
            f"The manifest {where} is of layout {layout}, which names no lineages file of each graph; this server "
            f"reads layout {MANIFEST_SCHEMA_VERSION}. Publish the graphs again with `idtrack-web publish` (SETUP.md, "
            f"section 7), which computes each graph's lineages and writes a manifest of layout "
            f"{MANIFEST_SCHEMA_VERSION}."
        )
        raise DataError(msg)
    try:
        return Manifest.model_validate_json(content, strict=True)
    except ValidationError as error:
        msg = f"The manifest {where} is not a valid manifest: {error}"
        raise DataError(msg) from None


def manifest_bytes(manifest: Manifest) -> bytes:
    """Return a manifest as the bytes that are published (sorted keys, two-space indentation, a final line break).

    Args:
        manifest: The manifest.

    Returns:
        bytes: The JSON document.
    """
    return (json.dumps(manifest.model_dump(mode="json"), indent=2, sort_keys=True, allow_nan=False) + "\n").encode()


# ------------------------------------------------------------------------------------------------------------------
# Files


def file_digest(path: Path) -> tuple[str, int]:
    """Return the SHA-256 (lowercase hex) and the size of a file, read in chunks.

    Args:
        path: The file.

    Returns:
        tuple[str, int]: The digest and the number of bytes read.
    """
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def verify_file(path: Path, expected: ManifestFile) -> None:
    """Check that a local file is the published file: its size, then its SHA-256.

    Args:
        path: The local file.
        expected: The manifest's record of it.

    Raises:
        DataError: If it is missing, or its size or SHA-256 differ.
    """
    try:
        size = path.stat().st_size
    except OSError as error:
        msg = f"{expected.key}: the file {path} cannot be read ({error.strerror})."
        raise DataError(msg) from None
    if size != expected.size:
        msg = f"{expected.key}: {path} has {size} bytes; the manifest says {expected.size}."
        raise DataError(msg)
    sha256, read = file_digest(path)
    if read != expected.size or sha256 != expected.sha256:
        msg = f"{expected.key}: the SHA-256 of {path} is {sha256}; the manifest says {expected.sha256}."
        raise DataError(msg)


@contextmanager
def temporary_beside(path: Path) -> Iterator[Path]:
    """Yield a temporary name beside *path*; remove it afterwards if it still exists (renamed or not).

    Args:
        path: The final path.

    Yields:
        Path: A name in the same folder that no other writer uses.
    """
    temporary = path.with_name(f".{path.name}.part-{os.getpid()}-{secrets.token_hex(4)}")
    try:
        yield temporary
    finally:
        temporary.unlink(missing_ok=True)


def move_into_place(temporary: Path, path: Path) -> None:
    """Make a written temporary file durable and give it its final name."""
    with temporary.open("rb") as handle:
        os.fsync(handle.fileno())
    temporary.replace(path)


# ------------------------------------------------------------------------------------------------------------------
# Stores


class Store(Protocol):
    """Where published files are read from."""

    def describe(self) -> str:
        """Return the store in words (no secret)."""
        ...

    def read_bytes(self, key: str, limit: int) -> bytes:
        """Return a small object's bytes (at most *limit*)."""
        ...

    def local_file(self, file: ManifestFile) -> Path:
        """Return a local path of a published file whose size and SHA-256 were verified."""
        ...


@dataclass(frozen=True)
class DirectoryStore:
    """A folder with the layout of the bucket (``<root>/idtrack/<format>/...``). Files are verified in place."""

    root: Path

    def describe(self) -> str:
        """Return the store in words.

        Returns:
            str: The folder.
        """
        return f"folder {self.root}"

    def _path(self, key: str) -> Path:
        path = self.root / key
        if ".." in Path(key).parts or Path(key).is_absolute():
            msg = f"The key {key!r} leaves the store."
            raise DataError(msg)
        return path

    def read_bytes(self, key: str, limit: int) -> bytes:
        """Return a small file's bytes.

        Args:
            key: The key.
            limit: The most bytes accepted.

        Returns:
            bytes: The content.

        Raises:
            DataError: If it is missing or larger than *limit*.
        """
        path = self._path(key)
        try:
            with path.open("rb") as handle:
                content = handle.read(limit + 1)
        except OSError as error:
            msg = f"{key} cannot be read from the {self.describe()}: {error.strerror}."
            raise DataError(msg) from None
        if len(content) > limit:
            msg = f"{key} in the {self.describe()} is larger than {limit} bytes."
            raise DataError(msg)
        return content

    def local_file(self, file: ManifestFile) -> Path:
        """Return the file's path after verifying it.

        Args:
            file: The manifest's record.

        Returns:
            Path: The path.
        """
        path = self._path(file.key)
        verify_file(path, file)
        return path


class S3Store:
    """An S3-compatible bucket (Cloudflare R2), with a local cache folder of verified files."""

    def __init__(self, client: S3Client, bucket: str, cache_dir: Path, endpoint: str) -> None:
        """Hold the client and where fetched files are kept.

        Args:
            client: A boto3 S3 client.
            bucket: The bucket.
            cache_dir: The cache folder (made if missing).
            endpoint: The endpoint URL (for messages).
        """
        self.client = client
        self.bucket = bucket
        self.cache_dir = cache_dir
        self.endpoint = endpoint

    def describe(self) -> str:
        """Return the store in words.

        Returns:
            str: The bucket and endpoint.
        """
        return f"bucket {self.bucket} at {self.endpoint}"

    def read_bytes(self, key: str, limit: int) -> bytes:
        """Return a small object's bytes.

        Args:
            key: The key.
            limit: The most bytes accepted.

        Returns:
            bytes: The content.

        Raises:
            DataError: If it cannot be read or is larger than *limit*.
        """
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            content = response["Body"].read(limit + 1)
        except (BotoCoreError, ClientError) as error:
            msg = f"{key} cannot be read from the {self.describe()}: {_s3_message(error)}"
            raise DataError(msg) from None
        if len(content) > limit:
            msg = f"{key} in the {self.describe()} is larger than {limit} bytes."
            raise DataError(msg)
        return content

    def local_file(self, file: ManifestFile) -> Path:
        """Return the cached copy of a published file, fetching it when the cache lacks it or holds another file.

        Args:
            file: The manifest's record.

        Returns:
            Path: The verified local file.

        Raises:
            DataError: If the object cannot be fetched, or the fetched bytes are not the published file.
        """
        path = self.cache_dir / file.key
        if path.is_file():
            try:
                verify_file(path, file)
            except DataError as error:
                log.warning("The cached copy is not the published file (%s); fetching it again.", error)
            else:
                log.info("%s: the cached copy is verified.", file.key)
                return path
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary_beside(path) as temporary:
            self._fetch(file, temporary)
            verify_file(temporary, file)
            move_into_place(temporary, path)
        log.info("%s: fetched from the %s and verified (%d bytes).", file.key, self.describe(), file.size)
        return path

    def _fetch(self, file: ManifestFile, target: Path) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            response = self.client.get_object(Bucket=self.bucket, Key=file.key)
            body = response["Body"]
            with target.open("wb") as handle:
                while chunk := body.read(_CHUNK):
                    handle.write(chunk)
        except (BotoCoreError, ClientError) as error:
            msg = f"{file.key} cannot be fetched from the {self.describe()}: {_s3_message(error)}"
            raise DataError(msg) from None


def _s3_message(error: Exception) -> str:
    """Return an S3 error in words, without anything of the request's signature."""
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        details = response.get("Error", {})
        return f"{details.get('Code', type(error).__name__)} ({details.get('Message', 'no message')})"
    return f"{type(error).__name__}: {error}"


def s3_client(endpoint: str, region: str, access_key_id: str, secret_access_key: str) -> S3Client:
    """Return a boto3 S3 client for an S3-compatible endpoint (path-style addressing, bounded retries and timeouts).

    Args:
        endpoint: The endpoint URL.
        region: The region the requests are signed for (R2: ``auto``).
        access_key_id: The access key id.
        secret_access_key: The secret access key.

    Returns:
        S3Client: The client.
    """
    import boto3
    from botocore.config import Config

    config = Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        retries={"max_attempts": 5, "mode": "standard"},
        connect_timeout=15,
        read_timeout=120,
        # R2 and older S3-compatible servers do not take the checksums newer clients add by default.
        request_checksum_calculation="when_required",
        response_checksum_validation="when_required",
    )
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=config,
    )


def store_of(settings: Settings) -> Store:
    """Return the store the settings name.

    Args:
        settings: The server's settings.

    Returns:
        Store: The store.
    """
    if settings.source == "directory":
        if settings.directory is None:
            msg = "The folder store needs IDTRACK_WEB_DIRECTORY."
            raise DataError(msg)
        return DirectoryStore(settings.directory)
    needed = (settings.s3_endpoint, settings.s3_bucket, settings.cache_dir, settings.s3_access_key_id)
    if any(v is None for v in needed) or settings.s3_secret_access_key is None:
        msg = (
            "The bucket store needs IDTRACK_WEB_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID, _SECRET_ACCESS_KEY and CACHE_DIR."
        )
        raise DataError(msg)
    assert settings.s3_endpoint is not None and settings.s3_bucket is not None  # noqa: S101, PT018 - checked above
    assert settings.cache_dir is not None and settings.s3_access_key_id is not None  # noqa: S101, PT018 - checked above
    client = s3_client(
        settings.s3_endpoint, settings.s3_region, settings.s3_access_key_id, settings.s3_secret_access_key
    )
    return S3Store(client, settings.s3_bucket, settings.cache_dir, settings.s3_endpoint)


@dataclass(frozen=True)
class VerifiedData:
    """The manifest and the verified local files of the organisms to load.

    Attributes:
        manifest: The manifest.
        manifest_file: The manifest's own key, SHA-256 and size.
        files: Organism to its verified local graph file.
        lineages: Organism to its verified local lineages file.
    """

    manifest: Manifest
    manifest_file: ManifestFile
    files: dict[str, Path]
    lineages: dict[str, Path]


def prepare(store: Store, manifest_key: str, organisms: tuple[str, ...]) -> VerifiedData:
    """Read the manifest, make the files of the organisms local and verify them.

    Args:
        store: The store.
        manifest_key: The manifest's key.
        organisms: The organisms to load; empty: every organism of the manifest.

    Returns:
        VerifiedData: The manifest and the verified files.

    Raises:
        DataError: If the manifest or a file cannot be used, an organism asked for is not listed, or the manifest is of
            a graph format this IDTrack does not read.
    """
    content = store.read_bytes(manifest_key, MANIFEST_MAX_BYTES)
    manifest = parse_manifest(content, f"{manifest_key} in the {store.describe()}")
    if manifest.format_version != FORMAT_VERSION:
        msg = (
            f"The manifest {manifest_key} lists graphs of format version {manifest.format_version}; this IDTrack reads "
            f"format version {FORMAT_VERSION}. Publish graphs built by this IDTrack, or point the server at the "
            f"manifest of format {FORMAT_VERSION} ({default_manifest_key()})."
        )
        raise DataError(msg)
    wanted = organisms or tuple(g.organism for g in manifest.graphs)
    files: dict[str, Path] = {}
    lineages: dict[str, Path] = {}
    for organism in wanted:
        entry = manifest.graph(organism)
        files[organism] = store.local_file(entry.file)
        log.info("%s: %s verified (sha256 %s).", organism, entry.file.key, entry.file.sha256)
        try:
            lineages[organism] = store.local_file(entry.lineages)
        except DataError as error:
            msg = (
                f"The lineages file of {organism} that the manifest names cannot be used ({error}). `idtrack-web "
                "publish` computes it beside each graph: publish the graphs again (SETUP.md, section 7)."
            )
            raise DataError(msg) from None
        log.info("%s: %s verified (sha256 %s).", organism, entry.lineages.key, entry.lineages.sha256)
    manifest_file = ManifestFile(key=manifest_key, sha256=hashlib.sha256(content).hexdigest(), size=len(content))
    return VerifiedData(manifest=manifest, manifest_file=manifest_file, files=files, lineages=lineages)
