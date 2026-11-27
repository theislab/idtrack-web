#!/usr/bin/env python3
"""Remove from a folder store the graph files that no recent release names (SETUP.md, section 10.9).

    sudo python3 deploy/prune_store.py /srv/idtrack-web/store             # lists what it would remove
    sudo python3 deploy/prune_store.py /srv/idtrack-web/store --delete    # removes it

A store keeps every release ever published (idtrack-web publish never removes a file). This keeps, for each graph
format, the releases named by its manifest.json and by the newest manifests under manifests/ (``--keep``, 2 by
default: the current release and the one before it, to go back to with IDTRACK_WEB_MANIFEST_KEY), with every graph
file they name, and removes the older manifests and every graph file that none of the kept ones names. Only the
standard library: Ubuntu's python3 runs it, or the image (`docker run ... --entrypoint python idtrack-web:<tag>`).
"""

import argparse
import json
import pathlib
import sys


def main() -> int:
    """List, or remove, what the kept releases do not name; return the exit status."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("store", type=pathlib.Path, help="the store's folder (it holds idtrack/<format>/manifest.json)")
    parser.add_argument("--keep", type=int, default=2, help="the newest releases to keep per format (at least 1)")
    parser.add_argument("--delete", action="store_true", help="remove; without it, only list")
    arguments = parser.parse_args()
    if arguments.keep < 1:
        parser.error("--keep is at least 1")
    formats = sorted(p.parent for p in (arguments.store / "idtrack").glob("*/manifest.json"))
    if not formats:
        print(f"No idtrack/<format>/manifest.json under {arguments.store}", file=sys.stderr)
        return 2
    freed = 0
    for folder in formats:
        current = json.loads((folder / "manifest.json").read_text())
        published = sorted(
            ((json.loads(path.read_text())["published"], path) for path in (folder / "manifests").glob("*.json")),
            reverse=True,
        )
        kept_manifests = [path for _, path in published[: arguments.keep]]
        kept_keys = {graph["file"]["key"] for graph in current["graphs"]}
        for path in kept_manifests:
            kept_keys |= {graph["file"]["key"] for graph in json.loads(path.read_text())["graphs"]}
        if not {graph["file"]["key"] for graph in current["graphs"]} <= kept_keys:
            raise AssertionError("the current manifest's graphs must be kept")
        old = [path for _, path in published[arguments.keep :]]
        graphs = [path for path in folder.glob("*/*.npz") if str(path.relative_to(arguments.store)) not in kept_keys]
        kept = f"keeping {len(kept_manifests)} releases and {len(kept_keys)} graph files"
        print(f"{folder.relative_to(arguments.store)}: {kept}")
        for path in sorted(graphs) + old:
            size = path.stat().st_size
            freed += size
            verb = "removing" if arguments.delete else "would remove"
            print(f"  {verb} {path.relative_to(arguments.store)} ({size / 1e6:.1f} MB)")
            if arguments.delete:
                path.unlink()
    print(f"{'freed' if arguments.delete else 'would free'} {freed / 1e9:.2f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
