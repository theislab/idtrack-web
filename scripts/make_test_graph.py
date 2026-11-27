"""Build the small graph of the api's tests (``api/tests/data/graph_sus_scrofa_cut.npz``) from idtrack's own test data.

idtrack's repository holds real Ensembl tables of the pig cut down to a few hundred genes
(``tests/data/real/sus_scrofa.tables.json.xz``) and the code that replays them to idtrack's builder without the
network (``tests/_real_tables.py``). This script builds the pig graph from them with that code, in a temporary
folder, and copies the graph file to the given path. Run it when idtrack's graph format changes (the tests then fail
with idtrack's ``GraphMismatchError``), with the idtrack checkout of the commit the api depends on:

    git clone https://github.com/theislab/idtrack.git /tmp/idtrack && git -C /tmp/idtrack checkout <commit>
    python -I scripts/make_test_graph.py /tmp/idtrack api/tests/data/graph_sus_scrofa_cut.npz

It needs the api's environment (idtrack with pandas, h5py and pytest). It takes about 90 s.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path


def main() -> int:
    """Build the graph and copy it.

    Returns:
        int: The exit status.
    """
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("idtrack_source", help="A checkout of idtrack's repository (with its tests/ folder).")
    parser.add_argument("output", help="Where to write the graph file.")
    arguments = parser.parse_args()
    source = Path(arguments.idtrack_source).absolute()
    if not (source / "tests" / "_real_tables.py").is_file():
        parser.error(f"{source} is not a checkout of idtrack's repository (no tests/_real_tables.py).")
    sys.path.insert(0, str(source))
    # idtrack's test helper, which replays the cut tables: a module of idtrack's checkout, outside any package.
    from tests._real_tables import RealWorld  # type: ignore[import-untyped]

    with tempfile.TemporaryDirectory() as folder:
        RealWorld("sus_scrofa", folder)
        [graph] = Path(folder).glob("graph_sus_scrofa_*.npz")
        shutil.copyfile(graph, arguments.output)
    print(arguments.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
