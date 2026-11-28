#!/usr/bin/env bash
# The daily check of the virtual machine (SETUP.md, section 10.10): the service, its workers and memory, the disk,
# updates, reboots and the images' refresh, the certificate, the logs (their bound, and no client named in Caddy's
# own) and security.txt's expiry. Run as root by idtrack-web-check.timer every morning, or by hand:
# `sudo /opt/idtrack-web/deploy/vm/check.sh`. It prints what it read and ends with "check: ok", or with each problem
# found ("check: ...") and exit status 1, which raises the alert (idtrack-web-alert@.service).
set -uo pipefail
deploy="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$deploy" || exit 2
problems=()
setting() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }

echo "== machine: $(uname -r), up since $(uptime -s)"
free -h | sed -n '1,2p'

echo "== service"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
api_health="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null)"
[[ "$api_health" == healthy ]] || problems+=("the api is not healthy: '${api_health:-not running}' (docker compose logs api)")
restarts="$(docker inspect -f '{{.RestartCount}}' "$(docker compose ps -q api)" 2>/dev/null)"
echo "api restarts by its restart policy since it was created: ${restarts:-?}"
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'

echo "== workers and memory"
# The server's own reading (/api/v1/status): a worker ends only when it is killed (the kernel's bound on memory, or
# a crash), and the server's footprint (PSS summed) against the bound it runs under (12 GiB: vm/compose.vm.yaml).
status="$(docker compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/status', timeout=4).read().decode())" 2>/dev/null)"
reading="$(python3 -c '
import json, sys
from datetime import datetime, timezone
s = json.loads(sys.stdin.read())
last = s["last_worker_exit_at"]
hours = (datetime.now(timezone.utc) - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds() / 3600 if last else -1
m = s["memory"]
share = m["pss_bytes"] / m["limit_bytes"] if m["pss_bytes"] and m["limit_bytes"] else -1
print(s["workers_alive"], s["workers_configured"], s["workers_exited"], last or "-", round(hours, 1), m["pss_bytes"] or 0, m["limit_bytes"] or 0, round(share, 3))
' <<< "$status" 2>/dev/null)"
if [[ -z "$reading" ]]; then
    problems+=("/api/v1/status could not be read")
else
    read -r alive configured exited last hours pss limit share <<< "$reading"
    echo "workers: $alive of $configured alive; $exited ended since the server started (the last: $last)"
    echo "memory: the server's footprint $(( pss / 1048576 )) MiB of its bound $(( limit / 1048576 )) MiB ($share)"
    awk -v h="$hours" 'BEGIN { exit !(h >= 0 && h < 24) }' \
        && problems+=("a worker of the api ended at $last, $hours h ago ($exited since the start): docker compose logs api | grep -i 'SIGKILL\\|exited'")
    # Three workers under the sustained load of SETUP.md, 10.7, reach 0.86 with their caches full: 0.9 is more than that.
    awk -v s="$share" 'BEGIN { exit !(s >= 0.9) }' \
        && problems+=("the server uses $share of its memory bound: fewer workers or organisms (SETUP.md, 10.7)")
fi
oom="$(journalctl -k --since -24h --no-pager 2>/dev/null | grep -c 'Memory cgroup out of memory')"
echo "the kernel's stops for want of memory in the last 24 h: $oom"
(( oom == 0 )) || problems+=("the kernel stopped $oom processes at a memory bound in the last 24 h: journalctl -k | grep 'out of memory'")

echo "== disk"
df -h / | tail -n 1
used="$(df --output=pcent / | tail -n 1 | tr -dc 0-9)"
(( used < 80 )) || problems+=("the disk is ${used} % full")
docker system df
journalctl --disk-usage
store="$(setting IDTRACK_WEB_STORE)"
[[ -n "$store" && -d "$store" ]] && du -sh "$store"
du -ch /var/lib/docker/containers/*/*-json.log* 2>/dev/null | tail -n 1 | sed 's/total$/container logs/'

echo "== updates and reboots"
echo "unattended-upgrades, last runs:"
grep -h "All upgrades installed\|No packages found that can be upgraded" /var/log/unattended-upgrades/unattended-upgrades.log 2>/dev/null | tail -n 2
if [[ -f /run/reboot-required ]]; then
    echo "a reboot is pending for: $(tr '\n' ' ' < /run/reboot-required.pkgs 2>/dev/null)"
fi
systemctl list-timers --no-pager apt-daily-upgrade.timer reboot-if-required.timer | head -n 3
systemctl is-enabled --quiet reboot-if-required.timer || problems+=("reboot-if-required.timer is not enabled")
systemctl is-enabled --quiet docker.service || problems+=("docker.service is not enabled at boot")

echo "== images"
# Refreshed weekly (idtrack-web-refresh.timer, deploy/vm/refresh_images.sh): the api's image built again on the newest
# base, Caddy's pulled; a container runs the image its tag names now.
systemctl list-timers --no-pager idtrack-web-refresh.timer idtrack-web-check.timer | head -n 3
for timer in idtrack-web-refresh.timer idtrack-web-check.timer; do
    systemctl is-enabled --quiet "$timer" || problems+=("$timer is not enabled")
done
platform="linux/$(dpkg --print-architecture 2>/dev/null || echo amd64)"
for service in api caddy; do
    container="$(docker compose ps -q "$service")"
    [[ -n "$container" ]] || continue
    configured="$(docker inspect -f '{{.Config.Image}}' "$container")"
    # The image's manifest for this machine: Docker's containerd store names an image by its index, a container by it.
    running="$(docker inspect -f '{{if .ImageManifestDescriptor}}{{.ImageManifestDescriptor.Digest}}{{else}}{{.Image}}{{end}}' "$container")"
    latest="$(docker image inspect --platform "$platform" -f '{{.Id}}' "$configured" 2>/dev/null || docker image inspect -f '{{.Id}}' "$configured")"
    echo "$service: $configured, built $(docker image inspect --platform "$platform" -f '{{.Created}}' "$configured" 2>/dev/null)"
    [[ "$running" == "$latest" ]] || problems+=("$service runs an older image than $configured now names: cd /opt/idtrack-web/deploy && sudo docker compose up -d")
done
refreshed="$(cat /var/lib/idtrack-web/refreshed 2>/dev/null)"
if [[ -z "$refreshed" ]]; then
    problems+=("the images were never refreshed: sudo systemctl start idtrack-web-refresh (SETUP.md, 10.8)")
else
    days=$(( ($(date +%s) - $(date -d "$refreshed" +%s)) / 86400 ))
    echo "the images last refreshed: $refreshed ($days days ago)"
    (( days <= 30 )) || problems+=("the images were last refreshed $days days ago: sudo journalctl -u idtrack-web-refresh")
fi

echo "== certificate"
domain="$(setting IDTRACK_WEB_DOMAIN)"
if [[ "$(setting COMPOSE_FILE)" == *compose.behind-proxy.yaml* ]]; then
    echo "behind the institute's proxy: its certificate is the institute's"
elif [[ -n "$domain" ]]; then
    end="$(openssl s_client -connect 127.0.0.1:443 -servername "$domain" </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    if [[ -z "$end" ]]; then
        problems+=("no certificate is served for $domain on port 443")
    else
        days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
        echo "$domain: valid until $end ($days days)"
        (( days >= 14 )) || problems+=("the certificate of $domain ends in $days days")
    fi
fi

echo "== logs and the site's own files"
# Caddy's access and error logs: a file a day, none older than seven days (the privacy page says so).
docker compose exec -T caddy sh -c 'du -sh /data/logs; ls /data/logs | tail -n 4' 2>/dev/null
old_logs="$(docker compose exec -T caddy find /data/logs -type f -mtime +7 2>/dev/null | tr '\n' ' ')"
[[ -z "$old_logs" ]] || problems+=("Caddy keeps log files older than seven days: $old_logs")
# Caddy's own output (Docker keeps it by size, not by days) must name no client: every message about a request goes
# to the errors file of seven days (the Caddyfile's log default).
named="$(docker compose logs --no-log-prefix caddy 2>/dev/null | grep -cE '"(remote_ip|client_ip|remote_addr)"|handshake error from')"
echo "lines of Caddy's own log that name a client: $named"
(( named == 0 )) || problems+=("Caddy's own log names clients in $named lines: the Caddyfile in use must send them to its errors file")
# security.txt must not expire (RFC 9116): each build writes an Expires a year ahead, so a site not rebuilt for a year
# would serve a stale one.
expires="$(docker compose exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/.well-known/security.txt', timeout=4).read().decode())" 2>/dev/null | sed -n 's/^Expires: //p' | tr -d '\r')"
if [[ -z "$expires" ]]; then
    problems+=("/.well-known/security.txt is not served")
else
    days=$(( ($(date -d "$expires" +%s) - $(date +%s)) / 86400 ))
    echo "security.txt: expires $expires ($days days)"
    (( days >= 30 )) || problems+=("security.txt expires in $days days: build and deploy the current version (10.11)")
fi

if (( ${#problems[@]} )); then
    printf 'check: %s\n' "${problems[@]}"
    exit 1
fi
# A check that passes takes down the notice of an earlier alert (deploy/vm/alert.sh).
rm -f /etc/motd.d/90-idtrack-web
echo "check: ok"
