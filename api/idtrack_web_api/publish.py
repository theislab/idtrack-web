"""Publishing a release of graph files: upload each by its content, then write the manifest that names them.

Every graph file is first loaded with idtrack (so a file that is not a graph of this idtrack's format is never
published) and its SHA-256 and size are computed. It is stored under ``idtrack/<format>/<organism>/<sha256>.npz``;
a key that exists already must hold the same bytes (keys named by content are never overwritten). The manifest is
written last: first as an immutable copy named by its own SHA-256 (``idtrack/<format>/manifests/<sha256>.json``),
then under the current key that servers read (``idtrack/<format>/manifest.json`` by default). A server that starts
while a release is being published reads either the previous manifest or the new one, and every file of either.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import logging
import shutil
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import idtrack_web_api
from idtrack_web_api.adapter import FORMAT_VERSION, Graph, GraphLoadError, idtrack_version
from idtrack_web_api.data import (
    DataError,
    Manifest,
    ManifestFile,
    ManifestGraph,
    default_manifest_key,
    file_digest,
    manifest_bytes,
    move_into_place,
    object_key,
    temporary_beside,
    verify_file,
)

if TYPE_CHECKING:
    from pathlib import Path

    from mypy_boto3_s3 import S3Client

log = logging.getLogger(__name__)


class Target(Protocol):
    """Where a release is published."""

    def describe(self) -> str:
        """Return the target in words."""
        ...

    def put_file(self, source: Path, file: ManifestFile) -> str:
        """Store a file under its key unless the same bytes are there; return what was done."""
        ...

    def put_bytes(self, key: str, content: bytes) -> None:
        """Store a small object (the manifest), replacing what is there."""
        ...


@dataclass(frozen=True)
class DirectoryTarget:
    """A folder with the bucket's layout (the Hetzner node's store, or a local store for development).

    Attributes:
        root: The folder.
        link: Store graph files as symbolic links to their sources instead of copies (development only: the store
            then depends on the sources staying where they are and unchanged; the server verifies every file at start).
    """

    root: Path
    link: bool = False

    def describe(self) -> str:
        """Return the target in words.

        Returns:
            str: The folder.
        """
        return f"folder {self.root}" + (" (links)" if self.link else "")

    def put_file(self, source: Path, file: ManifestFile) -> str:
        """Store a graph file under its content key.

        Args:
            source: The file.
            file: Its key, SHA-256 and size.

        Returns:
            str: ``kept`` (the same bytes were there), ``copied`` or ``linked``.

        Raises:
            DataError: If the key holds other bytes.
        """
        path = self.root / file.key
        if path.exists() or path.is_symlink():
            try:
                verify_file(path, file)
            except DataError as error:
                msg = (
                    f"{file.key} exists in the {self.describe()} with other bytes; keys named by content "
                    f"are never replaced ({error})."
                )
                raise DataError(msg) from None
            return "kept"
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary_beside(path) as temporary:
            if self.link:
                temporary.symlink_to(source.resolve())
                temporary.replace(path)
            else:
                shutil.copyfile(source, temporary)
                verify_file(temporary, file)
                move_into_place(temporary, path)
        verify_file(path, file)
        return "linked" if self.link else "copied"

    def put_bytes(self, key: str, content: bytes) -> None:
        """Store a small file, replacing it atomically.

        Args:
            key: The key.
            content: The bytes.
        """
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary_beside(path) as temporary:
            temporary.write_bytes(content)
            move_into_place(temporary, path)


class S3Target:
    """An S3-compatible bucket (Cloudflare R2)."""

    def __init__(self, client: S3Client, bucket: str, endpoint: str) -> None:
        """Hold the client.

        Args:
            client: A boto3 S3 client (:py:func:`idtrack_web_api.data.s3_client`).
            bucket: The bucket.
            endpoint: The endpoint URL (for messages).
        """
        self.client = client
        self.bucket = bucket
        self.endpoint = endpoint

    def describe(self) -> str:
        """Return the target in words.

        Returns:
            str: The bucket and endpoint.
        """
        return f"bucket {self.bucket} at {self.endpoint}"

    def _head(self, key: str) -> dict[str, object] | None:
        from botocore.exceptions import ClientError

        try:
            head = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise
        return {"size": head["ContentLength"], "sha256": head.get("Metadata", {}).get("sha256")}

    def put_file(self, source: Path, file: ManifestFile) -> str:
        """Upload a graph file under its content key (one PUT with its MD5, which the store checks on arrival).

        Args:
            source: The file.
            file: Its key, SHA-256 and size.

        Returns:
            str: ``kept`` (an object with the same size and SHA-256 was there) or ``uploaded``.

        Raises:
            DataError: If the key holds another object, or the uploaded object is not what was sent.
        """
        found = self._head(file.key)
        if found is not None:
            if found != {"size": file.size, "sha256": file.sha256}:
                msg = (
                    f"{file.key} exists in the {self.describe()} as {found}; keys named by content are never replaced."
                )
                raise DataError(msg)
            return "kept"
        md5 = hashlib.md5(usedforsecurity=False)
        with source.open("rb") as handle:
            while chunk := handle.read(8 * 1024 * 1024):
                md5.update(chunk)
        with source.open("rb") as handle:
            self.client.put_object(
                Bucket=self.bucket,
                Key=file.key,
                Body=handle,
                ContentLength=file.size,
                ContentMD5=base64.b64encode(md5.digest()).decode(),
                ContentType="application/octet-stream",
                Metadata={"sha256": file.sha256},
            )
        stored = self._head(file.key)
        if stored != {"size": file.size, "sha256": file.sha256}:
            msg = f"{file.key} was uploaded to the {self.describe()} but reads back as {stored}."
            raise DataError(msg)
        return "uploaded"

    def put_bytes(self, key: str, content: bytes) -> None:
        """Upload a small object (the manifest), replacing what is there.

        Args:
            key: The key.
            content: The bytes.
        """
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentMD5=base64.b64encode(hashlib.md5(content, usedforsecurity=False).digest()).decode(),
            ContentType="application/json",
            CacheControl="no-cache",
        )


def graph_entry(path: Path) -> ManifestGraph:
    """Load a graph file with idtrack and return its manifest entry.

    Args:
        path: The graph file.

    Returns:
        ManifestGraph: The entry.

    Raises:
        DataError: If the file is not a graph this idtrack reads.
    """
    try:
        identity = Graph.load(str(path)).identity()
    except GraphLoadError as error:
        msg = f"{path} is not a graph this idtrack reads: {error}"
        raise DataError(msg) from None
    if identity.content_digest is None or identity.format_version != FORMAT_VERSION:
        msg = f"{path} records no content digest or another format; build it with this idtrack."
        raise DataError(msg)
    sha256, size = file_digest(path)
    return ManifestGraph(
        organism=identity.organism,
        snapshot_release=identity.snapshot_release,
        file=ManifestFile(key=object_key(FORMAT_VERSION, identity.organism, sha256), sha256=sha256, size=size),
        content_digest=identity.content_digest,
        idtrack_version=identity.package_version,
        idtrack_commit=identity.package_commit,
        build_date=identity.build_date,
    )


def publish(paths: list[Path], target: Target, manifest_key: str | None = None) -> tuple[Manifest, dict[str, str]]:
    """Publish graph files and their manifest.

    Args:
        paths: The graph files, one per organism.
        target: Where to publish.
        manifest_key: The current manifest's key; ``None``: :py:func:`idtrack_web_api.data.default_manifest_key`.

    Returns:
        tuple[Manifest, dict[str, str]]: The manifest written, and per key what was done.

    Raises:
        DataError: If a file is not a graph, two files are of one organism, or a content key holds other bytes.
    """
    entries = []
    for path in paths:
        entry = graph_entry(path)
        log.info("%s: %s, snapshot %d, sha256 %s", path, entry.organism, entry.snapshot_release, entry.file.sha256)
        entries.append(entry)
    organisms = [e.organism for e in entries]
    if len(set(organisms)) != len(organisms):
        msg = f"Two graph files are of one organism: {organisms}; a release holds one graph per organism."
        raise DataError(msg)
    done: dict[str, str] = {}
    for path, entry in zip(paths, entries, strict=True):
        done[entry.file.key] = target.put_file(path, entry.file)
        log.info("%s: %s", entry.file.key, done[entry.file.key])
    manifest = Manifest(
        schema_version=1,
        format_version=FORMAT_VERSION,
        published=dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        publisher=f"idtrack-web-api {idtrack_web_api.__version__}, idtrack {idtrack_version()}",
        graphs=tuple(sorted(entries, key=lambda e: e.organism)),
    )
    content = manifest_bytes(manifest)
    copy_key = f"idtrack/{FORMAT_VERSION}/manifests/{hashlib.sha256(content).hexdigest()}.json"
    target.put_bytes(copy_key, content)
    current = manifest_key or default_manifest_key()
    target.put_bytes(current, content)
    done[copy_key] = "written"
    done[current] = "written"
    return manifest, done
