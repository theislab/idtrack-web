#!/usr/bin/env bash
# Raise the alert for a failed unit (deploy/vm/idtrack-web-alert@.service; SETUP.md, section 10.10):
#   - the journal, at priority "err": `journalctl -p err -t idtrack-web`;
#   - /etc/motd.d/90-idtrack-web, shown to every administrator at login until a check passes again (check.sh
#     removes it);
#   - mail to IDTRACK_WEB_ALERT_EMAIL of deploy/.env, where it is set and the machine has a sendmail (a mail
#     transfer agent through the institute's relay).
# usage: alert.sh <unit>
set -uo pipefail
unit="${1:?usage: alert.sh <unit>}"
deploy="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
invocation="$(systemctl show -p InvocationID --value "$unit" 2>/dev/null)"
if [[ -n "$invocation" ]]; then
    output="$(journalctl --no-pager -o cat _SYSTEMD_INVOCATION_ID="$invocation" 2>/dev/null | tail -n 40)"
else
    output="$(journalctl --no-pager -o cat -u "$unit" -n 40 2>/dev/null)"
fi
problems="$(grep '^check: \|^refresh: ' <<< "$output")"
summary="idtrack-web on $(hostname): $unit failed at $(date -u '+%Y-%m-%d %H:%M UTC')"
logger -p user.err -t idtrack-web "$summary: ${problems:-see sudo journalctl -u $unit}"
install -d -m 755 /etc/motd.d
{
    echo "*** $summary ***"
    echo "${problems:-$(tail -n 5 <<< "$output")}"
    echo "(sudo journalctl -u $unit; this notice goes once sudo /opt/idtrack-web/deploy/vm/check.sh passes)"
} > /etc/motd.d/90-idtrack-web
address="$(sed -n 's/^IDTRACK_WEB_ALERT_EMAIL=//p' "$deploy/.env" 2>/dev/null | tail -n 1)"
if [[ -n "$address" && -x /usr/sbin/sendmail ]]; then
    printf 'To: %s\nSubject: %s\n\n%s\n' "$address" "$summary" "$output" | /usr/sbin/sendmail -t
fi
