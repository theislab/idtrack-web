"""IDTrack's web API: identifier conversion through Ensembl releases over HTTP, on graphs loaded once per worker."""

from importlib import metadata

__version__: str = metadata.version("idtrack-web-api")
