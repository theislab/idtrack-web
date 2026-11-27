"""The built frontend as the server sends it: compressed where the client accepts it, with caching headers.

The page's text files (HTML, JavaScript, CSS, SVG, JSON, source maps, ...) are compressed with gzip once, when the
server starts (before the workers are forked, so they share the result), and sent compressed to a client whose
``Accept-Encoding`` takes gzip; files that are compressed already (fonts in WOFF2, images) are sent as they are. Every
answer that could be compressed carries ``Vary: Accept-Encoding``. The files Vite names by their content's hash
(under ``assets/``) never change under their name: they are cached for a year as ``immutable``; every other file
(``index.html`` above all, which names the hashed files of the current build) is ``no-cache``, so the browser asks
again each time and gets ``304 Not Modified`` while it is unchanged (``If-None-Match`` compared weakly, as RFC 9110
asks, so a tag a proxy weakened still matches). A file changed on disk after the start is sent from disk,
uncompressed, until the server restarts; a hashed file of the build the server started with that is no longer on disk
(a new build put in place under a running server) is still sent, from memory, so that a page opened before keeps
loading its lazy parts. The page's Content-Security-Policy names its inline scripts by their hashes
(:py:func:`idtrack_web_api.guard.page_policy`), read from the ``index.html`` that is sent (again whenever the file on
disk changes), so that the policy always fits the page it comes with; a path that is not a route of the page
(:py:data:`PAGE_ROUTES`) is answered with the page and ``404``. Only the build's own files are sent: no hidden file (a
name that begins with ``.``, but ``.well-known``) and nothing outside the build's folder, even through a link.

The page is sent with the answers every view needs first written into it (:py:data:`PRELOAD_ID`: ``/organisms``,
``/version``, ``/vocabulary``, ``/limits``, each its text exactly as the api sends it), so that its first paint waits
for no request of the api; its ``ETag`` is that of the page as sent (file and answers), so a new build or a server with
other graphs is a new tag.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from starlette.responses import FileResponse, Response

from idtrack_web_api.guard import page_policy

if TYPE_CHECKING:
    from starlette.datastructures import Headers

#: The suffixes of the files sent compressed (text; WOFF2 and images are compressed already).
COMPRESSED_SUFFIXES = frozenset(
    {".html", ".js", ".mjs", ".css", ".svg", ".json", ".map", ".txt", ".xml", ".webmanifest", ".ico"}
)
#: Smaller files are sent as they are (compression would save less than its header costs).
MIN_COMPRESSED_BYTES = 512
#: The folder of the files the build names by their content's hash.
HASHED_FOLDER = "assets"
IMMUTABLE = "public, max-age=31536000, immutable"
#: The routes of the page (``web/src/lib/routes.ts``: each page, with or without a trailing slash, and one graph's page
#: ``/organisms/<name>``): any other path without a file extension is answered with the page and ``404``.
PAGE_ROUTES = re.compile(r"^/(batch|names|organisms|developers|method)?/?$|^/organisms/[^/]+/?$")
_INLINE_SCRIPT = re.compile(rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.DOTALL | re.IGNORECASE)
REVALIDATE = "no-cache"
#: The id of the page's block of the answers written into it (``<script type="application/json" id=...>``): a JSON
#: object of each answer's path (``/api/v1/organisms``) and its text as the api sends it.
PRELOAD_ID = "idtrack-preload"
#: Media types of the build's files that Python's table does not know (a source map is JSON).
_MEDIA = {".map": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2"}


def media_type(path: Path) -> str:
    """Return the media type a file of the build is sent as.

    Args:
        path: The file.

    Returns:
        str: The type (``application/octet-stream`` for an unknown one).
    """
    return _MEDIA.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _hidden(parts: tuple[str, ...]) -> bool:
    return any(part.startswith(".") and part != ".well-known" for part in parts)


@dataclass(frozen=True)
class _Compressed:
    """A file's gzip form, and what the file was when it was made."""

    size: int
    mtime_ns: int
    gzip: bytes


def _etag(size: int, mtime_ns: int, coding: str | None) -> str:
    digest = hashlib.blake2b(f"{size}-{mtime_ns}".encode(), digest_size=12).hexdigest()
    return f'"{digest}{"-" + coding if coding else ""}"'


def accepts_gzip(header: str | None) -> bool:
    """Return whether an ``Accept-Encoding`` value takes gzip (``gzip`` or ``*`` with a weight above 0).

    Args:
        header: The header's value (``None``: absent).

    Returns:
        bool: Whether gzip may be sent.
    """
    weights: dict[str, float] = {}
    for item in (header or "").split(","):
        coding, _, parameters = item.strip().partition(";")
        weight = 1.0
        name, _, value = parameters.strip().partition("=")
        if name.strip().lower() == "q":
            try:
                weight = float(value)
            except ValueError:
                weight = 0.0
        if coding.strip():
            weights[coding.strip().lower()] = weight
    if "gzip" in weights:
        return weights["gzip"] > 0
    return weights.get("*", 0.0) > 0


class Frontend:
    """The files of a built frontend, their compressed forms made once, and the answers for them."""

    def __init__(self, root: Path, preload: dict[str, bytes] | None = None) -> None:
        """Compress every text file of the build.

        Args:
            root: The built frontend (``web/dist``).
            preload: The answers written into the page, by path (their bytes exactly as the api sends them).
        """
        self.preload = _preload_block(preload or {})
        self._page_sent: tuple[bytes, bytes, bytes, str] | None = None
        self.root = root.resolve()
        self.index = self.root / "index.html"
        self._policy: tuple[bytes, bytes] | None = None
        self._compressed: dict[Path, _Compressed] = {}
        #: The hashed files of the build at the start, kept to be sent when a later build removed them from disk.
        self._kept: dict[Path, bytes] = {}
        for path in sorted((self.root / HASHED_FOLDER).rglob("*")) if (self.root / HASHED_FOLDER).is_dir() else []:
            if self._own(path):
                self._kept[path] = path.read_bytes()
        for path in sorted(self.root.rglob("*")):
            if self._own(path) and path.suffix.lower() in COMPRESSED_SUFFIXES:
                status = path.stat()
                data = path.read_bytes()
                if len(data) < MIN_COMPRESSED_BYTES:
                    continue
                packed = gzip.compress(data, compresslevel=9, mtime=0)
                if len(packed) < len(data):
                    self._compressed[path] = _Compressed(status.st_size, status.st_mtime_ns, packed)

    def _own(self, path: Path) -> bool:
        """Whether a path is a file of the build that may be sent: not hidden, and inside the build's folder."""
        if not path.is_file() or _hidden(path.relative_to(self.root).parts):
            return False
        try:
            return path.resolve().is_relative_to(self.root)
        except (OSError, ValueError):
            return False

    def _page(self) -> bytes:
        try:
            return self.index.read_bytes()
        except OSError:
            return b""

    def policy(self) -> bytes:
        """Return the page's Content-Security-Policy for the ``index.html`` on disk now (made again when it changes).

        The page is a few kilobytes, read at each use, so the policy fits the very bytes that are sent.

        Returns:
            bytes: The header's value.
        """
        page = self._page()
        if self._policy is None or self._policy[0] != page:
            hashes = (base64.b64encode(hashlib.sha256(s).digest()).decode() for s in _INLINE_SCRIPT.findall(page))
            self._policy = (page, page_policy(hashes))
        return self._policy[1]

    def file(self, path: str) -> Path | None:
        """Return the file a request path names inside the build, or ``None``.

        Args:
            path: The request's path without its leading ``/``.

        Returns:
            Path | None: The file.
        """
        if "\x00" in path or _hidden(Path(path).parts):
            return None
        try:
            target = (self.root / path).resolve()
        except (OSError, ValueError):
            return None
        if not target.is_relative_to(self.root) or _hidden(target.relative_to(self.root).parts):
            return None
        return target if target.is_file() or target in self._kept else None

    @staticmethod
    def is_page(path: str) -> bool:
        """Return whether a path is a route of the page.

        Args:
            path: The request's path.

        Returns:
            bool: ``True`` for a route of :py:data:`PAGE_ROUTES`.
        """
        return PAGE_ROUTES.match(path) is not None

    def _answer_page(self, headers: Headers, status: int) -> Response:
        sent, packed, digest = self.page()
        coding = "gzip" if accepts_gzip(headers.get("accept-encoding")) else None
        etag = f'"{digest}{"-gzip" if coding else ""}"'
        common = {"Cache-Control": REVALIDATE, "ETag": etag, "Vary": "Accept-Encoding"}
        common["Content-Security-Policy"] = self.policy().decode()
        wanted = [t.strip().removeprefix("W/") for t in headers.get("if-none-match", "").split(",")]
        if status == 200 and (etag in wanted or "*" in wanted):
            return Response(status_code=304, headers=common)
        if coding:
            return Response(
                content=packed,
                status_code=status,
                media_type="text/html",
                headers={**common, "Content-Encoding": "gzip"},
            )
        return Response(content=sent, status_code=status, media_type="text/html", headers=common)

    def page(self) -> tuple[bytes, bytes, str]:
        """Return ``index.html`` as it is sent: with the answers written in, compressed, and its tag.

        They are made again when the file on disk changes.

        Returns:
            tuple[bytes, bytes, str]: The page, its gzip form, and its ``ETag`` digest.
        """
        file = self._page()
        if self._page_sent is None or self._page_sent[0] != file:
            head = file.find(b"</head>")
            sent = file[:head] + self.preload + file[head:] if head >= 0 and self.preload else file
            digest = hashlib.blake2b(sent, digest_size=12).hexdigest()
            self._page_sent = (file, sent, gzip.compress(sent, compresslevel=9, mtime=0), digest)
        return self._page_sent[1], self._page_sent[2], self._page_sent[3]

    def answer(self, target: Path, headers: Headers, status: int = 200) -> Response:
        """Return the answer for a file of the build.

        Args:
            target: The file (from :py:meth:`file`, or the index).
            headers: The request's headers.
            status: The status of a full answer (``404`` for the page at a path that is none of its routes).

        Returns:
            Response: The file, compressed when the client accepts it, with ``Cache-Control``, ``ETag`` and
            ``Vary``; ``304`` when the client's ``If-None-Match`` names the version it would get.
        """
        relative = target.relative_to(self.root)
        cache = IMMUTABLE if relative.parts[0] == HASHED_FOLDER and len(relative.parts) > 1 else REVALIDATE
        if target == self.index and target.is_file():
            return self._answer_page(headers, status)
        if not target.is_file():  # a hashed file of the build at the start, since removed from disk
            data = self._kept[target]
            media = media_type(target)
            kept_tag = _etag(len(data), 0, None)
            if kept_tag in [t.strip().removeprefix("W/") for t in headers.get("if-none-match", "").split(",")]:
                return Response(status_code=304, headers={"Cache-Control": cache, "ETag": kept_tag})
            return Response(content=data, media_type=media, headers={"Cache-Control": cache, "ETag": kept_tag})
        found = target.stat()
        compressible = target.suffix.lower() in COMPRESSED_SUFFIXES
        packed = self._compressed.get(target)
        if packed is not None and (packed.size, packed.mtime_ns) != (found.st_size, found.st_mtime_ns):
            packed = None  # changed since the start: sent from disk as it is now
        coding = "gzip" if packed is not None and accepts_gzip(headers.get("accept-encoding")) else None
        etag = _etag(found.st_size, found.st_mtime_ns, coding)
        common = {"Cache-Control": cache, "ETag": etag}
        if compressible:
            common["Vary"] = "Accept-Encoding"
        wanted = [tag.strip().removeprefix("W/") for tag in headers.get("if-none-match", "").split(",")]
        if status == 200 and (etag in wanted or "*" in wanted):
            return Response(status_code=304, headers=common)
        if target == self.index:
            common["Content-Security-Policy"] = self.policy().decode()
        if coding is not None and packed is not None:
            return Response(
                content=packed.gzip,
                status_code=status,
                media_type=media_type(target),
                headers={**common, "Content-Encoding": "gzip"},
            )
        return FileResponse(target, status_code=status, headers=common, media_type=media_type(target))


def _preload_block(answers: dict[str, bytes]) -> bytes:
    r"""Return the page's block of answers: a JSON object of each path and the answer's text.

    Every ``<`` is written ``\u003c`` (the same character for JSON), so that no text of it can end the block.
    """
    if not answers:
        return b""
    text = json.dumps({path: body.decode("utf-8") for path, body in answers.items()}, ensure_ascii=False)
    text = text.replace("<", "\\u003c")
    return f'<script type="application/json" id="{PRELOAD_ID}">{text}</script>'.encode()


__all__ = [
    "COMPRESSED_SUFFIXES",
    "HASHED_FOLDER",
    "IMMUTABLE",
    "PAGE_ROUTES",
    "PRELOAD_ID",
    "REVALIDATE",
    "Frontend",
    "accepts_gzip",
]
