#!/usr/bin/env bash
# Every check of the repository, each run whatever the ones before found, then one table of them all (the check, its
# result, what it counted, how long it took); the exit status is 1 when any check failed (SETUP.md, "Test" and "Checks
# and tests").
#
#   scripts/check.sh          the api's checks (ruff format, ruff, mypy, pytest), then the frontend's (npm run check)
#   scripts/check.sh api      the api's only
#   scripts/check.sh web      the frontend's only
#
# The api's environment is uv's (api/uv.lock, `uv sync --locked` once); the frontend's is npm's (`npm ci` once).
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
which="${1:-all}"
rows="$(mktemp)"
trap 'rm -f "$rows" "$rows.web" "$rows.out"' EXIT
failed=0
# Seconds since the epoch, to the microsecond where the shell tells them (bash 5), else to the second.
now() { if [ -n "${EPOCHREALTIME:-}" ]; then echo "$EPOCHREALTIME"; else date +%s; fi; }

# check <name> <counting command, reading the output on stdin> <folder> <command...>
check() {
  local name="$1" count="$2" folder="$3"
  shift 3
  printf '\n=== %s: %s\n' "$name" "$*"
  local started status
  started="$(now)"
  (cd "$folder" && "$@") 2>&1 | tee "$rows.out"
  status="${PIPESTATUS[0]}"
  local seconds result counted
  seconds="$(awk -v a="$started" -v b="$(now)" 'BEGIN { print b - a }')"
  if [ "$status" -eq 0 ]; then result=pass; else result=FAIL; failed=1; fi
  counted="$(bash -c "$count" < "$rows.out")"
  printf '%s\t%s\t%s\t%.1f s\n' "$name" "$result" "$counted" "$seconds" >> "$rows"
}

if [ "$which" = all ] || [ "$which" = api ]; then
  py=(uv run --no-sync)
  targets=(. ../scripts ../web/scripts/fixtures)
  check "ruff format" "awk '/would be reformatted/ { n = \$1 } END { print (n ? n : 0) \" files to format\" }'" \
    "$root/api" "${py[@]}" ruff format --check "${targets[@]}"
  check "ruff" "awk '/^Found [0-9]+ error/ { n = \$2 } END { print (n ? n : 0) \" errors\" }'" \
    "$root/api" "${py[@]}" ruff check "${targets[@]}"
  check "mypy" "awk '/^Found [0-9]+ error/ { n = \$2 } END { print (n ? n : 0) \" errors\" }'" \
    "$root/api" "${py[@]}" mypy
  check "pytest" "tail -n 1 | grep -oE '[0-9]+ (passed|failed|skipped|errors?)' | paste -sd, - | sed 's/,/, /g'" \
    "$root/api" "${py[@]}" pytest -q -rs
fi

if [ "$which" = all ] || [ "$which" = web ]; then
  printf '\n=== the frontend: npm run check\n'
  (cd "$root/web" && npm run --silent check -- --rows "$rows.web") || failed=1
  if [ -s "$rows.web" ]; then sed 's/^/web: /' "$rows.web" >> "$rows"; else printf 'web: npm run check\tFAIL\tno table\t-\n' >> "$rows"; failed=1; fi
fi

printf '\nThe checks of the repository:\n'
{ printf 'check\tresult\tcount\ttime\n'; cat "$rows"; } | column -t -s $'\t'
if [ "$failed" -ne 0 ]; then printf '\nSome checks failed.\n'; exit 1; fi
printf '\nEvery check passed.\n'
