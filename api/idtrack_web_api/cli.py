"""The command line: ``idtrack-web serve | check-data | publish | openapi``.

- ``serve``: read the configuration, verify and load the graphs (refusing to start on any mismatch), fork the workers
  and serve. Exit status 2 when the configuration or the data cannot be used.
- ``check-data``: what ``serve`` does before forking, then print what was verified and exit (0: usable).
- ``publish``: publish graph files and their manifest to a folder or a bucket.
- ``openapi``: write the OpenAPI document the application serves.
"""

from __future__ import annotations

import argparse
import gc
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

from idtrack_web_api.config import ConfigError, Settings, load_s3_access, load_settings

log = logging.getLogger("idtrack_web_api")


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(process)d %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
        stream=sys.stderr,
        force=True,
    )


def prepare_registry(settings: Settings) -> Any:
    """Verify the published data and load the graphs.

    Args:
        settings: The server's settings.

    Returns:
        idtrack_web_api.graphs.Registry: The loaded graphs.
    """
    from idtrack_web_api.data import default_manifest_key, prepare, store_of
    from idtrack_web_api.graphs import load_registry, resolve_organisms

    store = store_of(settings)
    manifest_key = settings.manifest_key or default_manifest_key()
    log.info("Reading %s from the %s.", manifest_key, store.describe())
    data = prepare(store, manifest_key, resolve_organisms(settings.organisms))
    return load_registry(data, settings.search_states, settings.search_seconds)


def _serve(settings: Settings) -> int:
    from idtrack_web_api.app import asgi_app
    from idtrack_web_api.server import run

    start = time.monotonic()
    registry = prepare_registry(settings)
    application = asgi_app(settings, registry)
    # The graphs are shared with the forked workers page by page; frozen objects are not touched by the collector,
    # so their pages stay shared longer.
    gc.collect()
    gc.freeze()
    log.info("Graphs of %s ready in %.1f s; starting %d workers.", list(registry.graphs), time.monotonic() - start,
             settings.workers)  # fmt: skip
    return run(application, settings)


def _check_data(settings: Settings) -> int:
    registry = prepare_registry(settings)
    report = {
        "manifest": registry.manifest_file.model_dump(mode="json"),
        "graphs": {
            organism: {
                "file": graph.entry.file.model_dump(mode="json"),
                "path": str(graph.path),
                "load_seconds": round(graph.load_seconds, 3),
                "releases": [graph.graph.releases()[0], graph.graph.releases()[-1]],
            }
            for organism, graph in registry.graphs.items()
        },
    }
    print(json.dumps(report, indent=2))
    return 0


def _publish(arguments: argparse.Namespace) -> int:
    from idtrack_web_api.data import s3_client
    from idtrack_web_api.publish import DirectoryTarget, S3Target, Target, publish

    target: Target
    if arguments.directory is not None:
        target = DirectoryTarget(Path(arguments.directory).resolve(), link=arguments.link)
    else:
        if arguments.link:
            raise ConfigError("--link applies to --directory only.")
        access = load_s3_access()
        client = s3_client(access.endpoint, access.region, access.access_key_id, access.secret_access_key)
        target = S3Target(client, access.bucket, access.endpoint)
    manifest, done = publish([Path(p) for p in arguments.graph], target, arguments.manifest_key)
    print(
        json.dumps({"target": target.describe(), "done": done, "manifest": manifest.model_dump(mode="json")}, indent=2)
    )
    return 0


def _openapi(output: str | None) -> int:
    from idtrack_web_api.openapi import openapi_text

    text = openapi_text()
    if output is None:
        sys.stdout.write(text)
    else:
        Path(output).write_text(text, encoding="utf-8")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the command line.

    Args:
        argv: The arguments; ``None``: :py:data:`sys.argv`.

    Returns:
        int: The exit status.
    """
    from idtrack_web_api.data import DataError

    parser = argparse.ArgumentParser(prog="idtrack-web", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("serve", help="Verify and load the graphs, then serve (configuration: IDTRACK_WEB_*).")
    commands.add_parser("check-data", help="Verify and load the graphs, print what was verified, and exit.")
    publish = commands.add_parser("publish", help="Publish graph files and their manifest.")
    publish.add_argument("--graph", action="append", required=True, help="A graph file (repeat, one per organism).")
    where = publish.add_mutually_exclusive_group(required=True)
    where.add_argument("--directory", help="Publish to this folder (the bucket's layout).")
    where.add_argument("--s3", action="store_true", help="Publish to the bucket of IDTRACK_WEB_S3_*.")
    publish.add_argument("--link", action="store_true", help="With --directory: link the graph files (development).")
    publish.add_argument("--manifest-key", help="The current manifest's key (default idtrack/<format>/manifest.json).")
    openapi = commands.add_parser("openapi", help="Write the OpenAPI document.")
    openapi.add_argument("--output", help="The file (default: standard output).")
    arguments = parser.parse_args(argv)

    try:
        if arguments.command == "openapi":
            return _openapi(arguments.output)
        if arguments.command == "publish":
            _configure_logging("INFO")
            return _publish(arguments)
        settings = load_settings()
        _configure_logging(settings.log_level)
        log.info("Settings: %s", settings.public())
        if arguments.command == "check-data":
            return _check_data(settings)
        return _serve(settings)
    except (ConfigError, DataError) as error:
        # The message says what to change; a traceback would add nothing for the operator.
        print(f"idtrack-web: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
