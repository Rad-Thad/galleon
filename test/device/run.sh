#!/bin/sh
# The device test harness the bridge runs on the Nova — see docs/PLAN.md
# section 5.3 for the contract it keeps.
#
# This is the minimal harness that stands in until M0-22: it starts nothing
# and reports `harness.run`, so the path from a merge to `device-results` is
# exercised end to end. It already takes the desktop session's variables and
# repeats the bridge's Game Mode, idle and free-space checks (session.py),
# skipping when one fails, and holds the owner state (ownerstate.py, in
# $GALLEON_TEST_DIR/owner-state), reported as `safety.owner-state`. Outside
# RESULTS_DIR and that folder it writes only an emulator config it restores.
#
# It also copies the power state the Nova shows into logs/power-facts.txt,
# because the overlay's parsers (src/main/powerstate.ts) need the real format
# of Armada's files and nothing else can see them (M0-10). Every source is
# readable by any user and the harness only reads it: nothing here switches
# a profile.
set -u

# The harness starts no process; the only thing to undo is an emulator config
# that changed after the backup, from the backup this run left behind.
if [ "${1:-}" = --cleanup ]; then
  if [ -n "${GALLEON_TEST_DIR:-}" ] && [ -d "$GALLEON_TEST_DIR/owner-state/backup" ]; then
    python3 "$(dirname -- "$0")/ownerstate.py" restore "$GALLEON_TEST_DIR/owner-state/backup"
    # 1 means something was put back, which is what cleanup is for.
    [ $? -le 1 ] || exit 1
    rm -rf -- "$GALLEON_TEST_DIR/owner-state/backup"
  fi
  exit 0
fi

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
: "${RESULTS_DIR:?RESULTS_DIR is set by the bridge}"
: "${GALLEON_SHA:?GALLEON_SHA is set by the bridge}"
: "${GALLEON_TEST_DIR:?GALLEON_TEST_DIR is set by the bridge}"

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

# Owner state (ownerstate.py): what the run must not change, recorded before
# anything else happens. The manifest and the backup stay on the device, out
# of RESULTS_DIR; only the comparison is published.
owner="$GALLEON_TEST_DIR/owner-state"
owner_log="$RESULTS_DIR/logs/owner-state.txt"
owner_ok=1
rm -rf -- "$owner"
if ! { mkdir -p "$owner" &&
  python3 "$here/ownerstate.py" snapshot "$owner/before.json" 2>>"$log" &&
  python3 "$here/ownerstate.py" backup "$owner/backup" 2>>"$log"; }; then
  owner_ok=
fi

# build-info.json is written by scripts/device-bundle.mjs and holds no quote
# or backslash inside a value, so a line match is enough to read it.
version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)
built=$(sed -n 's/^ *"sha": *"\([0-9a-f]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)


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

# The second manifest comes before the restore, so a config the run changed
# fails the check even though it is put back. ownerstate.py exits 1 for a
# difference and above that when it could not do its work at all.
owner_result=pass
owner_reason=null
if [ -n "$owner_ok" ]; then
  if python3 "$here/ownerstate.py" snapshot "$owner/after.json" 2>>"$log"; then
    python3 "$here/ownerstate.py" compare "$owner/before.json" "$owner/after.json" \
      >"$owner_log" 2>>"$log"
    compared=$?
  else
    compared=2
  fi
  python3 "$here/ownerstate.py" restore "$owner/backup" >>"$owner_log" 2>>"$log"
  restored=$?
  # A backup that has done its work goes, so a later --cleanup cannot put a
  # stale config over one the owner changed since.
  if [ "$restored" -le 1 ]; then
    rm -rf -- "$owner/backup"
  fi
  # Evidence of a change outranks a manifest that is missing: only with no
  # sign of one is the check a skip.
  if [ "$compared" -eq 1 ]; then
    owner_result=fail
    owner_reason='"the owner state changed during the run"'
  elif [ "$restored" -gt 1 ]; then
    owner_result=fail
    owner_reason='"the emulator configs could not be restored"'
  elif [ "$restored" -eq 1 ]; then
    owner_result=fail
    owner_reason='"an emulator config had to be restored"'
  elif [ "$compared" -gt 1 ]; then
    owner_ok=
  fi
fi
if [ -z "$owner_ok" ]; then
  owner_result=skip
  owner_reason='"the owner-state manifest could not be taken"'
fi
echo "owner state: $owner_result" >>"$log"

result=pass
reason=null
if [ -z "$session_ok" ]; then
  result=fail
  reason='"the session checks could not run"'
elif [ -z "$owner_ok" ]; then
  result=fail
  reason='"the owner-state manifest could not be taken"'
elif [ "$built" != "$GALLEON_SHA" ]; then
  result=fail
  reason='"the bundle was built from another commit"'
elif [ ! -x "${GALLEON_APPIMAGE:-}" ]; then
  result=fail
  reason='"the AppImage is missing or not executable"'
fi
echo "minimal harness: version ${version:-unknown}, harness.run $result" >>"$log"

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
    },
    {
      "id": "safety.owner-state",
      "result": "$owner_result",
      "metrics": {},
      "thresholds": {},
      "reason": $owner_reason,
      "evidence": ["logs/owner-state.txt"]
    }
  ],
  "notes": ["minimal harness: harness.run and safety.owner-state only, until M0-22"]
}
JSON
mv "$tmp" "$RESULTS_DIR/summary.json"
