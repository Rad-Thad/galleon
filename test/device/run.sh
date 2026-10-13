#!/bin/sh
# The device test harness the bridge runs on the Nova — see docs/PLAN.md
# section 5.3 for the contract it keeps.
#
# This is the minimal harness that stands in until M0-22: it starts nothing,
# touches nothing outside RESULTS_DIR, and reports one check, `harness.run`,
# so the path from a merge to `device-results` is exercised end to end. It
# already takes the desktop session's variables and repeats the bridge's
# Game Mode, idle and free-space checks (session.py), skipping when one fails.
#
# It also copies the power state the Nova shows into logs/power-facts.txt,
# because the overlay's parsers (src/main/powerstate.ts) need the real format
# of Armada's files and nothing else can see them (M0-10). Every source is
# readable by any user and the harness only reads it: nothing here switches
# a profile or writes outside RESULTS_DIR.
set -u

# Nothing to undo: this harness starts no process and changes no state.
if [ "${1:-}" = --cleanup ]; then
  exit 0
fi

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
: "${RESULTS_DIR:?RESULTS_DIR is set by the bridge}"
: "${GALLEON_SHA:?GALLEON_SHA is set by the bridge}"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
started=$(now)
mkdir -p "$RESULTS_DIR/logs"
log="$RESULTS_DIR/logs/harness.log"
: >"$log"

# A skip leaves a summary with its reason; the bridge publishes it once and
# tries the same build again on a later run.
skip() {
  why=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n')
  echo "skipped: $1" >>"$log"
  tmp="$RESULTS_DIR/.summary.json.tmp"
  cat >"$tmp" <<JSON
{
  "schema": 1,
  "sha": "$GALLEON_SHA",
  "status": "skipped",
  "reason": "$why",
  "startedAt": "$started",
  "finishedAt": "$(now)",
  "checks": [],
  "notes": []
}
JSON
  mv "$tmp" "$RESULTS_DIR/summary.json"
  exit 10
}

# A timer-started run lacks the desktop session's variables, and Steam, the
# compositor and the audio server are reached only through them.
if session_vars=$(python3 "$here/session.py" env 2>>"$log"); then
  eval "$session_vars"
else
  echo "session variables: none imported" >>"$log"
fi
# Someone may have picked the device up while the bridge downloaded the build.
# A check that cannot run is the harness's fault, not the device's, so it
# fails harness.run rather than skipping every build.
session_ok=1
why=$(python3 "$here/session.py" check --test-root "${GALLEON_TEST_ROOT:-$RESULTS_DIR}" 2>>"$log")
case $? in
  0) ;;
  10) skip "$why" ;;
  *) session_ok= ;;
esac

# build-info.json is written by scripts/device-bundle.mjs and holds no quote
# or backslash inside a value, so a line match is enough to read it.
version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)
built=$(sed -n 's/^ *"sha": *"\([0-9a-f]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)

result=pass
reason=null
if [ -z "$session_ok" ]; then
  result=fail
  reason='"the session checks could not run"'
elif [ "$built" != "$GALLEON_SHA" ]; then
  result=fail
  reason='"the bundle was built from another commit"'
elif [ ! -x "${GALLEON_APPIMAGE:-}" ]; then
  result=fail
  reason='"the AppImage is missing or not executable"'
fi
echo "minimal harness: version ${version:-unknown}, harness.run $result" >>"$log"

# Tests point this at a fake root; on the device it is the real one.
root=${GALLEON_FACTS_ROOT:-}
facts="$RESULTS_DIR/logs/power-facts.txt"
# Each source is capped so an unexpected file cannot crowd out the rest of
# the bridge's per-run allowance.
cap=65536
fact_file() {
  echo "== $1"
  if [ -r "$root$1" ]; then
    head -c "$cap" "$root$1"
    echo
  else
    echo "(unreadable)"
  fi
}
# armada-power talks to a D-Bus daemon; a hung daemon must not hold up the run.
fact_command() {
  echo "== armada-power $1"
  if command -v armada-power >/dev/null 2>&1; then
    out=$(timeout 10 armada-power "$1" 2>&1)
    code=$?
    printf '%s\n' "$out" | head -c "$cap"
    echo "(exit $code)"
  else
    echo "(not installed)"
  fi
}
{
  fact_file /run/armada/perf-state.json
  fact_file /etc/armada/power-profiles.conf
  fact_file /usr/share/armada/power-profiles.conf
  for name in scaling_governor scaling_cur_freq scaling_max_freq; do
    fact_file /sys/devices/system/cpu/cpufreq/policy7/$name
  done
  for device in "$root"/sys/class/devfreq/*; do
    [ -d "$device" ] || continue
    for name in governor cur_freq max_freq; do
      fact_file "/sys/class/devfreq/${device##*/}/$name"
    done
  done
  fact_command profile
  fact_command status
} >"$facts" 2>&1

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
      "evidence": ["logs/harness.log", "logs/power-facts.txt"]
    }
  ],
  "notes": ["minimal harness: only harness.run until M0-22"]
}
JSON
mv "$tmp" "$RESULTS_DIR/summary.json"
