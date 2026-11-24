#!/usr/bin/env bash
# Publish a release of graph files to R2 (or to a folder store): every graph_*.npz under a folder, one per organism.
#
#   deploy/publish_graphs.sh <folder of graph files> s3                 (credentials: IDTRACK_WEB_S3_* in the environment,
#                                                                        e.g. `set -a; . deploy/publisher.env; set +a`)
#   deploy/publish_graphs.sh <folder of graph files> directory <store>  (the node's store)
#
# Each file is loaded with idtrack first (a file that is not a graph of this idtrack's format is refused), uploaded
# under idtrack/<format>/<organism>/<sha256>.npz unless the same bytes are there, and the manifest is written last.
# The publishing credentials need "Object Read & Write" on the bucket; the server's need "Object Read" only.
set -euo pipefail
folder="${1:?usage: publish_graphs.sh <folder> s3 | publish_graphs.sh <folder> directory <store>}"
target="${2:?the target: s3 or directory}"
mapfile -t graphs < <(find "$folder" -name 'graph_*.npz' -type f -o -name 'graph_*.npz' -type l | sort)
if [[ ${#graphs[@]} -eq 0 ]]; then
    echo "No graph_*.npz under $folder" >&2
    exit 2
fi
arguments=()
for graph in "${graphs[@]}"; do
    arguments+=(--graph "$graph")
done
case "$target" in
    s3) exec idtrack-web publish --s3 "${arguments[@]}" ;;
    directory) exec idtrack-web publish --directory "${3:?the store folder}" "${arguments[@]}" ;;
    *) echo "The target is s3 or directory, not $target" >&2; exit 2 ;;
esac
