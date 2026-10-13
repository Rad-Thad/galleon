#!/bin/sh
# The device test harness the bridge runs on the Nova — see docs/PLAN.md
# section 5.3 for the contract it keeps.
#
# This is the harness as M0-22 builds it up, reporting `harness.run` and
# `safety.owner-state`. It takes the desktop session's variables and
# repeats the bridge's Game Mode, idle and free-space checks (session.py),
# skipping when one fails; makes sure Steam has the test shortcut
# (steamcef.py), with launch.sh and current.py in $GALLEON_TEST_ROOT; holds
# the owner state (ownerstate.py, in $GALLEON_TEST_DIR/owner-state), reported
# as `safety.owner-state`; and makes the test home with its read-only sign-in
# (signin.py, $GALLEON_TEST_DIR/home) with the app's self-test request
# (selftestrequest.py), removed before it finishes, and an empty handshake
# folder ($GALLEON_TEST_DIR/handshake). Outside RESULTS_DIR and those places it
# writes only an emulator config it restores, Steam's shortcut list through
# Steam itself, the launch request ($GALLEON_TEST_ROOT/current.json),
# removed before it finishes, and the default sink's mute (audio.py), put
# back with its volume from $GALLEON_TEST_ROOT/audio.json. It starts the app
# through the test shortcut, and stops it, signalling only the pids launch.sh
# recorded in $GALLEON_TEST_DIR/home/launch.
#
# It also copies the power state the Nova shows into logs/power-facts.txt,
# because the overlay's parsers (src/main/powerstate.ts) need the real format
# of Armada's files and nothing else can see them (M0-10). Every source is
# readable by any user and the harness only reads it: nothing here switches
# a profile.
set -u

# What there is to undo is the launch request, so the shortcut cannot start
# a build once the run is over, the self-test request, so the app runs no
# checks unless a run asked, the sound a stopped run left muted, and an
# emulator config that changed after the backup, from the backup this run
# left behind.
# Each step is tried whatever became of the other, so one that fails never
# leaves the owner's configs unrestored.
if [ "${1:-}" = --cleanup ]; then
  cleaned=0
  if [ -n "${GALLEON_TEST_ROOT:-}" ]; then
    python3 "$(dirname -- "$0")/current.py" remove --test-root "$GALLEON_TEST_ROOT" || cleaned=1
    python3 "$(dirname -- "$0")/audio.py" restore --state "$GALLEON_TEST_ROOT/audio.json" || cleaned=1
  fi
  if [ -n "${GALLEON_TEST_DIR:-}" ]; then
    python3 "$(dirname -- "$0")/selftestrequest.py" remove --home "$GALLEON_TEST_DIR/home" || cleaned=1
  fi
  if [ -n "${GALLEON_TEST_DIR:-}" ] && [ -d "$GALLEON_TEST_DIR/owner-state/backup" ]; then
    python3 "$(dirname -- "$0")/ownerstate.py" restore "$GALLEON_TEST_DIR/owner-state/backup"
    # 1 means something was put back, which is what cleanup is for.
    if [ $? -le 1 ]; then
      rm -rf -- "$GALLEON_TEST_DIR/owner-state/backup"
    else
      cleaned=1
    fi
  fi
  exit "$cleaned"
fi

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
: "${RESULTS_DIR:?RESULTS_DIR is set by the bridge}"
: "${GALLEON_SHA:?GALLEON_SHA is set by the bridge}"
: "${GALLEON_TEST_DIR:?GALLEON_TEST_DIR is set by the bridge}"
: "${GALLEON_TEST_ROOT:?GALLEON_TEST_ROOT is set by the bridge}"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
started=$(now)
# The budget is the bridge's, counted from here: the launch request expires
# with it however long the steps before the start took.
deadline=$(($(date +%s) + ${DEVICE_TEST_BUDGET_SECONDS:-1800}))
# Kept back from the app's budget for the stop and the collection after it.
STOP_RESERVE_SECONDS=120
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
why=$(python3 "$here/session.py" check --test-root "$GALLEON_TEST_ROOT" 2>>"$log")
case $? in
  0) ;;
  10) skip "$why" ;;
  *) session_ok= ;;
esac

# The shortcut's executable lives in the test root, outside any one build's
# folder, so the path Steam holds stays the same across runs. A copy is
# renamed into place, so a link left there is replaced rather than followed.
shortcut_ok=1
for name in launch.sh current.py; do
  rm -f -- "$GALLEON_TEST_ROOT/.$name.tmp"
  if ! { cp -- "$here/$name" "$GALLEON_TEST_ROOT/.$name.tmp" &&
    chmod 0755 "$GALLEON_TEST_ROOT/.$name.tmp" &&
    mv -f -- "$GALLEON_TEST_ROOT/.$name.tmp" "$GALLEON_TEST_ROOT/$name"; } 2>>"$log"; then
    shortcut_ok=
  fi
done
# The shortcut comes before the owner-state manifest, which covers
# shortcuts.vdf: adding it is the one change the run makes there on purpose,
# and Steam saves that file when it likes, so the manifest waits until the
# shortcut is listed in it (steamcef.py, SHORTCUT_UNSAVED). A run without
# Steam's debugger, or before Steam has saved, is skipped and tried again.
if [ -n "$shortcut_ok" ]; then
  shortcut=$(python3 "$here/steamcef.py" ${GALLEON_STEAM_CEF:+--cef "$GALLEON_STEAM_CEF"} \
    ensure --test-root "$GALLEON_TEST_ROOT" --saved-within 30 2>>"$log")
  code=$?
  echo "shortcut: $shortcut" >>"$log"
  why=$(printf '%s' "$shortcut" | sed -n 's/.*"reason": *"\([a-z-]*\)".*/\1/p')
  case $code in
    0) ;;
    10) skip "${why:-steam-cef-unavailable}" ;;
    *) shortcut_ok= ;;
  esac
fi

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

# The app under test gets a home of its own and, when one can be found, a copy
# of the owner's sign-in (signin.py). Without one the run goes on, and the
# checks that need the server report no-importable-credentials.
home_ok=1
signin=$(python3 "$here/signin.py" prepare --test-dir "$GALLEON_TEST_DIR" \
  ${GALLEON_READONLY_TOKEN_FILE:+--token-file "$GALLEON_READONLY_TOKEN_FILE"} 2>>"$log")
case $? in
  0 | 10) ;;
  *) home_ok= ;;
esac
# Only the source is kept: it is a kind (signin.py), never a value, while the
# rest of the line names paths in the owner's home.
signin_source=$(printf '%s' "$signin" | sed -n 's/.*"source": *"\([a-z-]*\)".*/\1/p')
echo "sign-in: ${signin_source:-none}" >>"$log"
GALLEON_HOME=$GALLEON_TEST_DIR/home
export GALLEON_HOME

# build-info.json is written by scripts/device-bundle.mjs and holds no quote
# or backslash inside a value, so a line match is enough to read it.
version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)
built=$(sed -n 's/^ *"sha": *"\([0-9a-f]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)

# What the app runs once started (selftestrequest.py). Its summary goes to a
# folder of its own, to be merged with the harness's checks, and its budget
# ends before the bridge's so the run keeps time to stop it and collect.
# Payloads come with the bundle's homebrew (M0-07), so no emulator is asked
# for yet.
app_results="$RESULTS_DIR/app"
handshake="$GALLEON_TEST_DIR/handshake"
app_budget=$((deadline - $(date +%s) - STOP_RESERVE_SECONDS))
selftest_ok=
if [ -n "$home_ok" ] && rm -rf -- "$app_results" "$handshake" &&
  mkdir -p -- "$app_results" "$handshake" &&
  python3 "$here/selftestrequest.py" write --home "$GALLEON_HOME" --sha "$GALLEON_SHA" \
    ${version:+--version "$version"} --budget "$app_budget" \
    --results "$app_results" --handshake "$handshake" \
    --check selftest.complete --check build.identity --check startup.cold \
    --check grid.scroll --check server.heartbeat --check download.small \
    --check update.verify --profile performance --profile balanced \
    --screenshot settings --screenshot bios --screenshot emulators 2>>"$log"; then
  selftest_ok=1
fi

# The request launch.sh obeys (current.py): only while it exists, and until
# the budget ends, does starting the shortcut start this build. It is written
# only once the owner state is held and the app's request is in place, so
# nothing can start without either.
request_ok=
if [ -n "$selftest_ok" ] && [ -n "$owner_ok" ] && [ -n "$shortcut_ok" ] && python3 "$here/current.py" write --test-root "$GALLEON_TEST_ROOT" \
  --appimage "${GALLEON_APPIMAGE:-}" --home "$GALLEON_HOME" --results "$RESULTS_DIR" \
  --sha "$GALLEON_SHA" --budget $((deadline - $(date +%s))) 2>>"$log"; then
  request_ok=1
fi

# The sound goes off before anything could start, and stays off until the
# restore below. The record lives in the test root, so a later --cleanup
# finds it whichever build left it. Without the mute nothing is started.
audio_state="$GALLEON_TEST_ROOT/audio.json"
muted=
if [ -n "$request_ok" ] && python3 "$here/audio.py" mute --state "$audio_state" >>"$log" 2>&1; then
  muted=1
fi


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

# The start (PLAN.md section 5.3, steps 8 and 9): only this build, only with
# both requests written and the sound off. Steam starts the shortcut, which
# runs launch.sh; launch.sh marks the start and records the only pids this
# run ever signals. Steam's own route goes first, and RunGame through the
# debugger only when that has not marked a start. Tests shorten the waits.
START_WAIT_SECONDS=${GALLEON_START_WAIT_SECONDS:-60}
STOP_WAIT_SECONDS=${GALLEON_STOP_WAIT_SECONDS:-30}
launched="$GALLEON_HOME/launch"
gameid=$(printf '%s' "$shortcut" | sed -n 's/.*"gameid": *\([0-9][0-9]*\).*/\1/p')
started_by=
app_note='not started'
start_failed=
marked_by() {
  until [ -e "$launched/started" ]; do
    [ "$(date +%s)" -lt "$1" ] || return 1
    sleep 1
  done
}
# A pid launch.sh wrote, digits only, so nothing else can be signalled.
recorded() {
  pid=$(sed -n '1{/^[0-9][0-9]*$/p;}' "$launched/$1" 2>/dev/null)
  [ -n "$pid" ] && printf '%s' "$pid"
}
# launch.sh writes `exit` once the app has gone; a launch.sh that was itself
# stopped writes nothing, so its pid going counts as well.
app_gone() {
  [ -e "$launched/exit" ] && return 0
  pid=$(recorded launch.pid) || return 0
  ! kill -0 "$pid" 2>/dev/null
}
gone_by() {
  until app_gone; do
    [ "$(date +%s)" -lt "$1" ] || return 1
    sleep 1
  done
}
if [ -n "$request_ok" ] && [ -n "$muted" ] && [ -z "$gameid" ]; then
  echo "start: the shortcut has no game id" >>"$log"
  start_failed=1
elif [ -n "$request_ok" ] && [ -n "$muted" ] &&
  [ "$built" = "$GALLEON_SHA" ] && [ -x "${GALLEON_APPIMAGE:-}" ]; then
  # steam hands the URL to the running client and returns; the limit keeps a
  # client that never answers from holding the run.
  timeout "$START_WAIT_SECONDS" steam "steam://rungameid/$gameid" </dev/null >>"$log" 2>&1 &
  if marked_by $(($(date +%s) + START_WAIT_SECONDS)); then
    started_by=steam
  elif python3 "$here/steamcef.py" ${GALLEON_STEAM_CEF:+--cef "$GALLEON_STEAM_CEF"} \
    run "$gameid" >>"$log" 2>&1 && marked_by $(($(date +%s) + START_WAIT_SECONDS)); then
    started_by=cef
  else
    start_failed=1
  fi
fi
if [ -n "$started_by" ]; then
  echo "started through $started_by" >>"$log"
  # The app's own budget ends at STOP_RESERVE_SECONDS before the bridge's;
  # past that it gets one STOP_WAIT_SECONDS to finish its summary, then is
  # asked to stop, then signalled, all inside the reserve.
  if gone_by $((deadline - STOP_RESERVE_SECONDS + STOP_WAIT_SECONDS)); then
    app_note="exited $(cat "$launched/exit" 2>/dev/null || echo unknown)"
  else
    : >"$handshake/stop" 2>>"$log"
    if gone_by $(($(date +%s) + STOP_WAIT_SECONDS)); then
      app_note='stopped when asked'
    else
      # launch.sh passes the signal on to the app alone.
      if pid=$(recorded launch.pid); then kill -TERM "$pid" 2>>"$log"; fi
      if gone_by $(($(date +%s) + STOP_WAIT_SECONDS)); then
        app_note='stopped by a signal'
      else
        for name in app.pid launch.pid; do
          if pid=$(recorded "$name"); then kill -KILL "$pid" 2>>"$log"; fi
        done
        app_note='killed'
      fi
    fi
  fi
fi
echo "app: $app_note" >>"$log"

# The sound is put back before the second manifest, as the run's last
# change. A record that cannot be restored (its sink gone, or WirePlumber not
# answering) is kept and fails harness.run on every run until it can be.
audio_restored=1
python3 "$here/audio.py" restore --state "$audio_state" >>"$log" 2>&1 || audio_restored=

# The second manifest comes before the config restore, so a config the run
# changed fails the check even though it is put back. ownerstate.py exits 1
# for a difference and above that when it could not do its work at all.
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

# Starting the shortcut by hand from now on does nothing.
request_gone=1
python3 "$here/current.py" remove --test-root "$GALLEON_TEST_ROOT" 2>>"$log" || request_gone=
python3 "$here/selftestrequest.py" remove --home "$GALLEON_HOME" 2>>"$log" || request_gone=

result=pass
reason=null
if [ -z "$session_ok" ]; then
  result=fail
  reason='"the session checks could not run"'
elif [ -z "$shortcut_ok" ]; then
  result=fail
  reason='"the test shortcut could not be made"'
elif [ -z "$owner_ok" ]; then
  result=fail
  reason='"the owner-state manifest could not be taken"'
elif [ -z "$home_ok" ]; then
  result=fail
  reason='"the test home could not be made"'
elif [ -z "$selftest_ok" ]; then
  result=fail
  reason='"the self-test request could not be written"'
elif [ -z "$request_ok" ]; then
  result=fail
  reason='"the launch request could not be written"'
elif [ -z "$muted" ]; then
  result=fail
  reason='"the sound could not be muted, so the app was not started"'
elif [ -n "$start_failed" ]; then
  result=fail
  reason='"neither route started the app"'
elif [ -z "$request_gone" ]; then
  result=fail
  reason='"the launch or self-test request could not be removed"'
elif [ -z "$audio_restored" ]; then
  result=fail
  reason='"the sound could not be put back as it was"'
elif [ "$built" != "$GALLEON_SHA" ]; then
  result=fail
  reason='"the bundle was built from another commit"'
elif [ ! -x "${GALLEON_APPIMAGE:-}" ]; then
  result=fail
  reason='"the AppImage is missing or not executable"'
fi
if [ -z "$muted" ]; then
  audio_note='not muted'
elif [ -n "$audio_restored" ]; then
  audio_note='muted and put back'
else
  audio_note='muted, not put back'
fi
echo "audio: $audio_note" >>"$log"
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
  "notes": [
    "minimal harness: harness.run and safety.owner-state only, until M0-22",
    "sign-in: ${signin_source:-no-importable-credentials}",
    "audio: $audio_note",
    "app: $app_note"
  ]
}
JSON
mv "$tmp" "$RESULTS_DIR/summary.json"
