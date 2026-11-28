"""The built frontend as the server sends it: compressed where the client accepts it, with caching headers.

The page's text files (HTML, JavaScript, CSS, SVG, JSON, source maps, ...) are compressed with gzip once, when the
server starts (before the workers are forked, so they share the result), and sent compressed to a client whose
``Accept-Encoding`` takes gzip; where the build wrote a file's Brotli form beside it (``<file>.br``, made by the build's
``scripts/compress.ts`` at Brotli's strongest, 10 to 15 % smaller than gzip), it is read at the start too and sent to a
client that takes ``br``, before gzip; files that are compressed already (fonts in WOFF2, images) are sent as they are,
and a ``.br`` file is not sent by its own name. Every
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
(:py:data:`PAGE_ROUTES`) is answered with the page and ``404``, and so is a path that names no file of the build where
the request asks for HTML (a browser's ``Accept`` names ``text/html``: a person who typed a wrong address with a dot
in it, ``/ENSG00000141510.20``, sees the page that says so), and ``/index.html`` itself (the page's template, not one
of its addresses). Only the build's own files are sent: no hidden file (a name that begins with ``.``, but
``.well-known``) and nothing outside the build's folder, even through a link.

The page is sent with the answers every view needs first written into it (:py:data:`PRELOAD_ID`: ``/organisms``,
``/version``, ``/vocabulary``, ``/limits``, each its text exactly as the api sends it), so that its first paint waits
for no request of the api; its ``ETag`` is that of the page as sent (file, answers and frame), so a new build or a
server with other graphs is a new tag.

Each address gets the page with its **frame** (:py:data:`FRAMES_FILE`, written by the build's ``scripts/prerender.ts``):
the masthead and the page's head as HTML inside the page's root, drawn before any code has arrived, in its head the
links that fetch that page's own code beside the entry (:py:func:`frame_of` picks it by the address, as the page's
routes do), and the page's own title, description, canonical address and the cards of its link (Open Graph, Twitter),
into which the server writes the site's address (``public_url``, else the request's) and the page's canonical path.
The server also writes into the frame what only it knows: the address of IDTrack's documentation it is set to
(``docs_url``, in place of the build's default, so that a link drawn before any code runs follows the setting too), a
graph's own title and description on its page (``/organisms/<name>``, from the graph the server holds), and the
page's language on the document (``<html lang="de">`` for a page at ``/<page>/de``). The app replaces the frame when
it first renders. A build without the file is sent without frames.

The build also lists its pages (``pages`` of :py:data:`FRAMES_FILE`, from the page's routes), from which the server
makes ``/sitemap.xml`` with each graph's page added; ``/robots.txt`` allows every page and names the sitemap
(:py:func:`robots_txt`, :py:func:`sitemap_xml`).
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import html
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
PAGE_ROUTES = re.compile(
    r"^/(convert|batch|names|organisms|developers|method|legal|privacy|licences|accessibility)?/?$"
    r"|^/(legal|privacy|accessibility)/de/?$|^/organisms/[^/]+/?$"
)
#: The pages in German: those at ``/<page>/de`` (``web/src/lib/routes.ts``).
GERMAN_PAGE = re.compile(r"^/[a-z]+/de/?$")
#: The build's own default address of IDTrack's documentation, which the server replaces by its setting.
BUILD_DOCS_URL = "https://idtrack.readthedocs.io/en/stable/"
_INLINE_SCRIPT = re.compile(rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.DOTALL | re.IGNORECASE)
#: The page's own title and description, replaced by a frame's.
_TITLE = re.compile(rb"\s*<title>.*?</title>", re.DOTALL)
_DESCRIPTION = re.compile(rb'\s*<meta\s+name="description"[^>]*>', re.DOTALL)
#: The document's language as the page's file declares it.
_LANGUAGE = re.compile(rb"<html\s+lang=\"[^\"]*\"")
#: A frame's own title and description in its ``meta`` (each also its link cards').
_FRAME_TITLE = re.compile(r"<title>(.*?)</title>", re.DOTALL)
_FRAME_DESCRIPTION = re.compile(r'<meta name="description" content="([^"]*)">')
#: The most forms of the page kept in memory (each frame by site address and canonical path).
PAGES_HELD = 64
REVALIDATE = "no-cache"
#: The id of the page's block of the answers written into it (``<script type="application/json" id=...>``): a JSON
#: object of each answer's path (``/api/v1/organisms``) and its text as the api sends it.
PRELOAD_ID = "idtrack-preload"
#: The build's frames of the pages: ``{"frames": {name: {"html": ..., "head": ...}}}``.
FRAMES_FILE = "frames.json"
_ROOT = b'<div id="root"></div>'
#: The frame of each page's path (``web/src/lib/routes.ts``; the Convert page's is "answer" when the address holds an
#: identifier); any other path gets the frame "none" (the masthead alone).
_FRAME_OF_PATH = {
    "": "home",
    "convert": "convert",
    "batch": "batch",
    "names": "names",
    "organisms": "organisms",
    "developers": "developers",
    "method": "method",
    "legal": "legal",
    "legal/de": "legal-de",
    "privacy": "privacy",
    "privacy/de": "privacy-de",
    "licences": "licences",
    "accessibility": "accessibility",
    "accessibility/de": "accessibility-de",
}
#: The places in a frame's ``meta`` the server fills: the site's address and the page's canonical path.
ORIGIN_SLOT = "%ORIGIN%"
PATH_SLOT = "%PATH%"
#: How long a client may keep ``/robots.txt`` and ``/sitemap.xml`` before it asks again (they change with a new build
#: or another set of graphs).
SITE_TEXT_CACHE = "public, max-age=3600"


def frame_of(path: str, *, has_identifier: bool) -> str:
    """Return the name of the frame of a page's address.

    Args:
        path: The request's path.
        has_identifier: Whether its query names an identifier (``id``).

    Returns:
        str: The frame's name in :py:data:`FRAMES_FILE`.
    """
    trimmed = path.strip("/")
    if trimmed.startswith("organisms/") and "/" not in trimmed.removeprefix("organisms/"):
        return "organism"
    name = _FRAME_OF_PATH.get(trimmed, "none")
    return "answer" if name == "convert" and has_identifier else name


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
    """A file's gzip form (and its Brotli form where the build made one), and what the file was when they were made."""

    size: int
    mtime_ns: int
    gzip: bytes
    br: bytes | None = None


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
    return accepts(header, "gzip")


def accepts(header: str | None, wanted: str) -> bool:
    """Return whether an ``Accept-Encoding`` value takes a content coding (it or ``*`` with a weight above 0).

    Args:
        header: The header's value (``None``: absent).
        wanted: The coding (``gzip``, ``br``).

    Returns:
        bool: Whether it may be sent.
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
    if wanted in weights:
        return weights[wanted] > 0
    return weights.get("*", 0.0) > 0


class Frontend:
    """The files of a built frontend, their compressed forms made once, and the answers for them."""

    def __init__(
        self,
        root: Path,
        preload: dict[str, bytes] | None = None,
        *,
        analytics: bool = False,
        docs_url: str = BUILD_DOCS_URL,
    ) -> None:
        """Compress every text file of the build.

        Args:
            root: The built frontend (``web/dist``).
            preload: The answers written into the page, by path (their bytes exactly as the API sends them).
            analytics: Whether the site counts visits with Google Analytics (its hosts are allowed by the policy).
            docs_url: The address of IDTrack's documentation the server is set to (written into the frames).
        """
        self.analytics = analytics
        self.docs_url = docs_url
        self.preload = _preload_block(preload or {})
        self._pages_sent: dict[str, tuple[bytes, bytes, bytes, bytes, str]] = {}
        self._frames: tuple[tuple[int, int], dict[str, dict[str, str]]] | None = None
        self.root = root.resolve()
        self.index = self.root / "index.html"
        self._policy: tuple[bytes, bytes] | None = None
        self._compressed: dict[Path, _Compressed] = {}
        #: The hashed files of the build at the start, kept to be sent when a later build removed them from disk.
        self._kept: dict[Path, bytes] = {}
        for path in sorted((self.root / HASHED_FOLDER).rglob("*")) if (self.root / HASHED_FOLDER).is_dir() else []:
            if self._own(path) and path.suffix != ".br":
                self._kept[path] = path.read_bytes()
        for path in sorted(self.root.rglob("*")):
            if self._own(path) and path.suffix.lower() in COMPRESSED_SUFFIXES:
                status = path.stat()
                data = path.read_bytes()
                if len(data) < MIN_COMPRESSED_BYTES:
                    continue
                packed = gzip.compress(data, compresslevel=9, mtime=0)
                if len(packed) < len(data):
                    brotli = path.with_name(path.name + ".br")
                    br = brotli.read_bytes() if self._own(brotli) else None
                    self._compressed[path] = _Compressed(status.st_size, status.st_mtime_ns, packed, br)

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
            self._policy = (page, page_policy(hashes, analytics=self.analytics))
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
        if target == self.index:
            return None  # the page's template: sent at the page's addresses only, never by its own name
        if target.suffix == ".br" and target.with_suffix("").is_file():
            return None  # a file's Brotli form is sent in the file's place, never by its own name
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

    def _frame(self, name: str) -> bytes:
        """The frame's links for the head and its markup, as one key (read again when the file changes)."""
        path = self.root / FRAMES_FILE
        try:
            found = path.stat()
        except OSError:
            return b""
        stamp = (found.st_size, found.st_mtime_ns)
        if self._frames is None or self._frames[0] != stamp:
            try:
                frames = json.loads(path.read_text(encoding="utf-8")).get("frames", {})
            except (OSError, ValueError, AttributeError):
                frames = {}
            self._frames = (stamp, frames if isinstance(frames, dict) else {})
        frame = self._frames[1].get(name) or {}
        return json.dumps([frame.get("head", ""), frame.get("html", ""), frame.get("meta", "")]).encode()

    def pages(self) -> list[str]:
        """Return the paths of the build's pages (``pages`` of :py:data:`FRAMES_FILE`; none without the file).

        Returns:
            list[str]: The paths, as the build lists them.
        """
        path = self.root / FRAMES_FILE
        try:
            listed = json.loads(path.read_text(encoding="utf-8")).get("pages", [])
        except (OSError, ValueError, AttributeError):
            return []
        return [p for p in listed if isinstance(p, str) and p.startswith("/")] if isinstance(listed, list) else []

    def _answer_page(
        self,
        headers: Headers,
        status: int,
        frame: str | None = None,
        site: str = "",
        canonical: str = "/",
        card: tuple[str, str] | None = None,
    ) -> Response:
        sent, packed, digest = self.page(frame, site, canonical, card)
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

    def page(
        self, frame: str | None = None, site: str = "", canonical: str = "/", card: tuple[str, str] | None = None
    ) -> tuple[bytes, bytes, str]:
        """Return ``index.html`` as it is sent: with the answers and the frame written in, compressed, and its tag.

        They are made again when the file on disk or the build's frames change. A frame's own title and description
        take the place of the page's; its canonical address and link cards get the site's address and the path; its
        links to IDTrack's documentation the server's address of it; a page in German declares its language.

        Args:
            frame: The name of the page's frame (:py:func:`frame_of`); ``None``: none.
            site: The site's address for absolute links (``https://host``; empty: links relative to the site).
            canonical: The page's canonical path.
            card: The page's own title and description in place of the frame's (a graph's page), or ``None``.

        Returns:
            tuple[bytes, bytes, str]: The page, its gzip form, and its ``ETag`` digest.
        """
        file = self._page()
        parts = self._frame(frame) if frame is not None else b""
        key = f"{frame or ''} {site} {canonical}"
        held = self._pages_sent.get(key)
        if held is None or held[0] != file or held[1] != parts:
            links, markup, meta = json.loads(parts) if parts else ("", "", "")
            markup = markup.replace(BUILD_DOCS_URL, html.escape(self.docs_url))
            sent = file
            if frame not in {None, "none"} and GERMAN_PAGE.match(canonical):
                sent = _LANGUAGE.sub(b'<html lang="de"', sent, count=1)
            if markup and _ROOT in sent:
                sent = sent.replace(_ROOT, b'<div id="root">' + markup.encode() + b"</div>", 1)
            if meta:
                sent = _TITLE.sub(b"", sent, count=1)
                sent = _DESCRIPTION.sub(b"", sent, count=1)
                if card is not None:
                    meta = _with_card(meta, *card)
                meta = meta.replace(ORIGIN_SLOT, html.escape(site)).replace(PATH_SLOT, html.escape(canonical))
            head = sent.find(b"</head>")
            if head >= 0:
                sent = sent[:head] + meta.encode() + links.encode() + self.preload + sent[head:]
            digest = hashlib.blake2b(sent, digest_size=12).hexdigest()
            held = (file, parts, sent, gzip.compress(sent, compresslevel=9, mtime=0), digest)
            # A bounded number of forms (frames by site address and path: a few dozen on a server); others are made
            # at each request.
            if len(self._pages_sent) < PAGES_HELD or key in self._pages_sent:
                self._pages_sent[key] = held
        return held[2], held[3], held[4]

    def answer(
        self,
        target: Path,
        headers: Headers,
        status: int = 200,
        frame: str | None = None,
        site: str = "",
        canonical: str = "/",
        card: tuple[str, str] | None = None,
    ) -> Response:
        """Return the answer for a file of the build.

        Args:
            target: The file (from :py:meth:`file`, or the index).
            headers: The request's headers.
            status: The status of a full answer (``404`` for the page at a path that is none of its routes).
            frame: For the page: the name of its frame (:py:func:`frame_of`); ``None``: none.
            site: For the page: the site's address, written into its canonical address and link cards.
            canonical: For the page: its canonical path.
            card: For a graph's page: its own title and description.

        Returns:
            Response: The file, compressed when the client accepts it, with ``Cache-Control``, ``ETag`` and
            ``Vary``; ``304`` when the client's ``If-None-Match`` names the version it would get.
        """
        relative = target.relative_to(self.root)
        cache = IMMUTABLE if relative.parts[0] == HASHED_FOLDER and len(relative.parts) > 1 else REVALIDATE
        if target == self.index and target.is_file():
            return self._answer_page(headers, status, frame, site, canonical, card)
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
        taken = headers.get("accept-encoding")
        coding = None
        if packed is not None and packed.br is not None and accepts(taken, "br"):
            coding = "br"
        elif packed is not None and accepts(taken, "gzip"):
            coding = "gzip"
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
                content=packed.br if coding == "br" and packed.br is not None else packed.gzip,
                status_code=status,
                media_type=media_type(target),
                headers={**common, "Content-Encoding": coding},
            )
        return FileResponse(target, status_code=status, headers=common, media_type=media_type(target))


def _with_card(meta: str, title: str, description: str) -> str:
    """Return a frame's ``meta`` with its own title and description (every tag that repeats them) replaced."""
    found_title = _FRAME_TITLE.search(meta)
    found_description = _FRAME_DESCRIPTION.search(meta)
    if found_title is not None:
        meta = meta.replace(found_title.group(1), html.escape(title, quote=False))
    if found_description is not None:
        meta = meta.replace(f'content="{found_description.group(1)}"', f'content="{html.escape(description)}"')
    return meta


def prefers_html(accept: str | None) -> bool:
    """Return whether a request asks for HTML (its ``Accept`` names ``text/html`` with a weight above 0): a browser.

    Args:
        accept: The ``Accept`` header (``None``: absent; a program's ``*/*`` is no request for HTML).

    Returns:
        bool: Whether the page should answer.
    """
    for item in (accept or "").split(","):
        kind, _, parameters = item.strip().partition(";")
        if kind.strip().lower() != "text/html":
            continue
        name, _, value = parameters.strip().partition("=")
        try:
            return name.strip().lower() != "q" or float(value) > 0
        except ValueError:
            return False
    return False


def robots_txt(site: str) -> str:
    """Return ``/robots.txt``: every page may be fetched; the sitemap's address.

    Args:
        site: The site's address (``https://host``).

    Returns:
        str: The file.
    """
    return (
        "# IDTrack's web app: every page and the api may be fetched (the api's searches are bounded per client:\n"
        "# /api/v1/limits). The pages are listed in the sitemap.\n"
        "User-agent: *\n"
        "Allow: /\n"
        "\n"
        f"Sitemap: {site}/sitemap.xml\n"
    )


def sitemap_xml(site: str, pages: list[str], organisms: list[str]) -> str:
    """Return ``/sitemap.xml``: the build's pages, then each graph's page.

    Args:
        site: The site's address (``https://host``).
        pages: The build's pages (:py:meth:`Frontend.pages`).
        organisms: The production names of the graphs the server holds.

    Returns:
        str: The sitemap (sitemaps.org's protocol 0.9).
    """
    paths = [*pages, *(f"/organisms/{o}" for o in organisms if f"/organisms/{o}" not in pages)]
    urls = "".join(f"<url><loc>{html.escape(site + p, quote=False)}</loc></url>\n" for p in paths)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{urls}"
        "</urlset>\n"
    )


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
    "FRAMES_FILE",
    "HASHED_FOLDER",
    "IMMUTABLE",
    "PAGE_ROUTES",
    "PRELOAD_ID",
    "REVALIDATE",
    "Frontend",
    "accepts",
    "accepts_gzip",
    "frame_of",
    "prefers_html",
    "robots_txt",
    "sitemap_xml",
]
