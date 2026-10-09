#!/bin/sh
# The device test harness the bridge runs on the Nova — see docs/PLAN.md
# section 5.3 for the contract it keeps.
#
# This is the minimal harness that stands in until M0-22: it starts nothing,
# touches nothing outside RESULTS_DIR, and reports one check, `harness.run`,
# so the path from a merge to `device-results` is exercised end to end.
set -u

# Nothing to undo: this harness starts no process and changes no state.
if [ "${1:-}" = --cleanup ]; then
  exit 0
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${RESULTS_DIR:?RESULTS_DIR is set by the bridge}"
: "${GALLEON_SHA:?GALLEON_SHA is set by the bridge}"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
started=$(now)
mkdir -p "$RESULTS_DIR/logs"
log="$RESULTS_DIR/logs/harness.log"

# build-info.json is written by scripts/device-bundle.mjs and holds no quote
# or backslash inside a value, so a line match is enough to read it.
version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)
built=$(sed -n 's/^ *"sha": *"\([0-9a-f]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)

result=pass
reason=null
if [ "$built" != "$GALLEON_SHA" ]; then
  result=fail
  reason='"the bundle was built from another commit"'
elif [ ! -x "${GALLEON_APPIMAGE:-}" ]; then
  result=fail
  reason='"the AppImage is missing or not executable"'
fi
echo "minimal harness: version ${version:-unknown}, harness.run $result" >"$log"

tmp="$RESULTS_DIR/.summary.json.tmp"
cat >"$tmp" <<JSON
{
  "schema": 1,
  "sha": "$GALLEON_SHA",
  "version": "${version:-unknown}",
  "status": "complete",
  "reason": null,
  "startedAt": "$started",
  "finishedAt": "$(now)",
  "checks": [
    {
      "id": "harness.run",
      "result": "$result",
      "metrics": {},
      "thresholds": {},
      "reason": $reason,
      "evidence": ["logs/harness.log"]
    }
  ],
  "notes": ["minimal harness: only harness.run until M0-22"]
}
JSON
mv "$tmp" "$RESULTS_DIR/summary.json"
