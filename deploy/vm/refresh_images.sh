#!/usr/bin/env bash
# The weekly refresh of the two images (SETUP.md, section 10.8): Caddy's newest release of its 2.11 line, and the
# api's image built again from the checked-out release on the newest base (Python 3.14 on Debian 13, rebuilt
# upstream for each of their security fixes). A container is recreated only if its image changed (the api then
# starts again: about 2.5 minutes of the maintenance page), so the timer runs it in the Thursday night window, before
# the reboot window. Run as root by idtrack-web-refresh.timer, or by hand: `sudo deploy/vm/refresh_images.sh`.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo/deploy"
image="$(sed -n 's/^IDTRACK_WEB_IMAGE=//p' .env | tail -n 1)"
version="${image#idtrack-web:}"
# The build builds what is checked out: it must be the release the running image was built from.
checked_out="$(git -C "$repo" describe --tags --exact-match HEAD 2>/dev/null || echo "not a release tag")"
if [[ "$image" != idtrack-web:* || "$checked_out" != "v$version" ]]; then
    echo "refresh: deploy/.env runs '$image', but /opt/idtrack-web has '$checked_out' checked out; update as SETUP.md, section 10.11, says" >&2
    exit 1
fi
echo "== Caddy"
docker compose pull --quiet caddy
echo "== the api's image, idtrack-web:$version from v$version"
BUILD_OPTIONS="--pull" "$repo/deploy/build_image.sh" "$version" docker
echo "== the containers whose image changed"
docker compose up -d
docker image prune -f
# The build cache used in the last ten days stays: a refresh whose bases did not change then builds the same image
# from it, and recreates nothing.
docker builder prune -f --filter until=240h
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
# When the images were last refreshed, for deploy/vm/check.sh (which reports a refresh older than 30 days).
install -d -m 755 /var/lib/idtrack-web && date -u '+%Y-%m-%dT%H:%M:%SZ' > /var/lib/idtrack-web/refreshed
