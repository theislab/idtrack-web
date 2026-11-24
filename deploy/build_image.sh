#!/usr/bin/env bash
# Build the image from the repository: deploy/build_image.sh <tag> [podman|docker]
#
# PODMAN_OPTIONS: options of the container tool before `build` (e.g. a --root on a local disk); BUILD_OPTIONS: options
# of `build` (e.g. --build-arg SINGLE_ID_BUILDER=true, see deploy/Containerfile). idtrack is fetched from GitHub at the
# commit of api/pyproject.toml (SETUP.md, "The idtrack commit").
set -euo pipefail
tag="${1:?usage: deploy/build_image.sh <tag> [podman|docker]}"
tool="${2:-podman}"
read -r -a options <<< "${PODMAN_OPTIONS:-}"
read -r -a build_options <<< "${BUILD_OPTIONS:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$tool" "${options[@]}" build "${build_options[@]}" -f "$root/deploy/Containerfile" -t "idtrack-web:$tag" "$root"
