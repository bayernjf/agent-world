#!/usr/bin/env bash
# Reports whether a GitHub Actions runner labelled "production" is registered
# and idle. Read-only: one API GET (or a local JSON fixture), no deployment
# side effects.
#
# Usage:
#   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo ./scripts/check-production-runner.sh
#   ./scripts/check-production-runner.sh --require-idle
#   ./scripts/check-production-runner.sh --from-file path/to/runners.json
#
# --require-idle  exit 1 unless at least one online runner is also idle.
# Default         exit 1 unless at least one production runner is online.
# --from-file     read a saved runners API response (offline tests, no network).
#
# Exit codes: 0 usable runner found, 1 no usable runner, 2 usage/API error.

set -euo pipefail

REQUIRE_IDLE=false
FROM_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --require-idle) REQUIRE_IDLE=true ;;
    --from-file)
      [ "$#" -ge 2 ] || { echo "missing value for --from-file" >&2; exit 2; }
      FROM_FILE="$2"
      shift
      ;;
    -h | --help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ -n "$FROM_FILE" ]; then
  [ -r "$FROM_FILE" ] || { echo "cannot read fixture: $FROM_FILE" >&2; exit 2; }
  payload="$(cat "$FROM_FILE")"
else
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
  payload="$(curl -fsS \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runners?per_page=100")" ||
    { echo "failed to query the Actions runners API" >&2; exit 2; }
fi

summary="$(printf '%s' "$payload" | python3 -c '
import json, sys

data = json.load(sys.stdin)
rows = []
for runner in data.get("runners", []):
    labels = {label.get("name", "") for label in runner.get("labels", [])}
    if "production" not in labels:
        continue
    rows.append({
        "name": runner.get("name", "?"),
        "status": runner.get("status", "?"),
        "busy": bool(runner.get("busy", False)),
    })
print(json.dumps(rows))
')" || { echo "could not parse the runners response" >&2; exit 2; }

python3 - "$summary" "$REQUIRE_IDLE" <<'PY'
import json
import sys

runners = json.loads(sys.argv[1])
require_idle = sys.argv[2] == "true"
idle = [r for r in runners if r["status"] == "online" and not r["busy"]]
online = [r for r in runners if r["status"] == "online"]

if not runners:
    print("FAIL: no runner with label 'production' is registered.")
    print("Start the Hasee runner, or dispatch Deploy with target=hosted (build-only fallback).")
    sys.exit(1)

for runner in runners:
    if runner["status"] != "online":
        state = runner["status"]
    elif runner["busy"]:
        state = "busy"
    else:
        state = "idle"
    print(f"production runner: {runner['name']} -> {state}")

if require_idle and not idle:
    print(f"FAIL: {len(online)} online production runner(s), none idle; the deploy job would queue.")
    print("Free the runner, or dispatch Deploy with target=hosted (build-only fallback).")
    sys.exit(1)

if not online:
    print("FAIL: production runner(s) are registered but none is online.")
    sys.exit(1)

print(f"OK: {len(idle)} idle / {len(online)} online production runner(s).")
PY
