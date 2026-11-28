#!/usr/bin/env bash
# The weekly check of the virtual machine (SETUP.md, section 10.10): the service, the disk, updates and reboots, the
# certificate, the logs' bound and security.txt's expiry. Run from the repository as root: `sudo deploy/vm/check.sh`. It prints what it read and ends with
# "check: ok", or with each problem found and exit status 1.
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
echo "check: ok"
