#!/bin/sh
# The device test harness the bridge runs on the Nova — see docs/PLAN.md
# section 5.3 for the contract it keeps.
#
# This is the harness as M0-22 builds it up, reporting `harness.run` and
# `safety.owner-state`. It takes the desktop session's variables and
# repeats the bridge's Game Mode, idle and free-space checks (session.py),
# skipping when one fails, at the start and again just before the app is
# started; makes sure Steam has the test shortcut and, for steam.launch, the
# target shortcut (steamcef.py), with launch.sh, target.sh, current.py and
# launched.py in $GALLEON_TEST_ROOT; holds
# the owner state (ownerstate.py, in $GALLEON_TEST_DIR/owner-state), reported
# as `safety.owner-state`; and makes the test home with its read-only sign-in
# (signin.py, $GALLEON_TEST_DIR/home) with the app's self-test request
# (selftestrequest.py), removed before it finishes, the bundle's homebrew
# payloads in its ROM folder (payloads.py), removed with anything the app
# downloaded, and an empty handshake folder ($GALLEON_TEST_DIR/handshake).
# Outside RESULTS_DIR and those places it writes only an emulator config it
# restores, Steam's shortcut list through
# Steam itself, the record that steam.launch waits for an attended run
# ($GALLEON_TEST_ROOT/steam-attended.json, steamlaunch.py), the launch request ($GALLEON_TEST_ROOT/current.json),
# removed before it finishes, and the default sink's mute (audio.py), put
# back with its volume from $GALLEON_TEST_ROOT/audio.json. It starts the app
# through the test shortcut, and stops it, signalling only the pids launch.sh
# recorded in $GALLEON_TEST_DIR/home/launch; the app's summary, from
# $RESULTS_DIR/app, joins the harness's checks (mergesummary.py). The power
# profile changes only when the app asks through the handshake folder
# (powerprofile.py), and the profile recorded in $GALLEON_TEST_ROOT/profile.json
# before the start is put back after the stop, and Steam, left on the test
# shortcut's page by the app's exit, is sent back to its library.
#
# It also copies the power state the Nova shows into logs/power-facts.txt,
# because the overlay's parsers (src/main/powerstate.ts) need the real format
# of Armada's files and nothing else can see them (M0-10). Every source is
# readable by any user and the harness only reads it.
set -u

# What there is to undo is the launch request, so the shortcut cannot start
# a build once the run is over, an app a killed run left running, the
# self-test request, so the app runs no checks unless a run asked, the ROMs
# in the test home, payloads and downloads alike, the power
# profile and the sound a stopped run left changed, and an emulator config
# that changed after the backup, from the backup this run left behind.
# Each step is tried whatever became of the other, so one that fails never
# leaves the owner's configs unrestored.
if [ "${1:-}" = --cleanup ]; then
  cleaned=0
  if [ -n "${GALLEON_TEST_ROOT:-}" ]; then
    python3 "$(dirname -- "$0")/current.py" remove --test-root "$GALLEON_TEST_ROOT" || cleaned=1
  fi
  # Steam started the app, outside the process group the bridge stops, so an
  # app a killed run left is stopped here, before the sound comes back, and
  # only while it is still the process launch.sh recorded (launched.py).
  if [ -n "${GALLEON_TEST_DIR:-}" ]; then
    python3 "$(dirname -- "$0")/launched.py" stop --state "$GALLEON_TEST_DIR/home/launch" || cleaned=1
  fi
  if [ -n "${GALLEON_TEST_ROOT:-}" ]; then
    python3 "$(dirname -- "$0")/powerprofile.py" restore --state "$GALLEON_TEST_ROOT/profile.json" || cleaned=1
    python3 "$(dirname -- "$0")/audio.py" restore --state "$GALLEON_TEST_ROOT/audio.json" || cleaned=1
  fi
  if [ -n "${GALLEON_TEST_DIR:-}" ]; then
    python3 "$(dirname -- "$0")/selftestrequest.py" remove --home "$GALLEON_TEST_DIR/home" || cleaned=1
    python3 "$(dirname -- "$0")/payloads.py" remove --home "$GALLEON_TEST_DIR/home" || cleaned=1
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

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n')"
}

# A skip leaves a summary with its reason; the bridge publishes it once and
# tries the same build again on a later run.
skip() {
  echo "skipped: $1" >>"$log"
  tmp="$RESULTS_DIR/.summary.json.tmp"
  cat >"$tmp" <<JSON
{
  "schema": 1,
  "sha": "$GALLEON_SHA",
  "status": "skipped",
  "reason": $(json_string "$1"),
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
for name in launch.sh target.sh current.py launched.py; do
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
# steam.launch starts a second shortcut while the app, itself one, runs
# (target.sh). It is added the same way and for the same reason before the
# manifest. A 'Launch Multiple Games' prompt an earlier run left on screen
# needs a person, so after one the check is never asked for again
# unattended (steamlaunch.py), and Steam is not asked for the target.
attended_record="$GALLEON_TEST_ROOT/steam-attended.json"
target=
if [ -n "$shortcut_ok" ] && python3 "$here/steamlaunch.py" attended --record "$attended_record"; then
  echo "steam.launch: a prompt was left up before, so it waits for an attended run" >>"$log"
elif [ -n "$shortcut_ok" ]; then
  target=$(python3 "$here/steamcef.py" ${GALLEON_STEAM_CEF:+--cef "$GALLEON_STEAM_CEF"} \
    ensure --test-root "$GALLEON_TEST_ROOT" --name 'Galleon Device Test Target' \
    --exe "$GALLEON_TEST_ROOT/target.sh" --record target.json --saved-within 30 2>>"$log")
  code=$?
  echo "target shortcut: $target" >>"$log"
  why=$(printf '%s' "$target" | sed -n 's/.*"reason": *"\([a-z-]*\)".*/\1/p')
  case $code in
    0) ;;
    10) skip "${why:-steam-cef-unavailable}" ;;
    *) shortcut_ok= ;;
  esac
fi
target_gameid=$(printf '%s' "$target" | sed -n 's/.*"gameid": *\([0-9][0-9]*\).*/\1/p')

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

# The bundle's homebrew (payloads.py), checked against its pins and copied
# into the app's ROM folder, where a payload's folder names its system. A
# bundle built without them runs the checks that need none.
payloads_ok=1
payload_list=
if [ -n "$home_ok" ]; then
  payload_list=$(python3 "$here/payloads.py" copy --bundle "$here/payloads" --home "$GALLEON_HOME" 2>>"$log")
  case $? in
    0) ;;
    10) echo "payloads: none in the bundle" >>"$log" ;;
    *) payloads_ok= ;;
  esac
fi

# build-info.json is written by scripts/device-bundle.mjs and holds no quote
# or backslash inside a value, so a line match is enough to read it.
version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)
built=$(sed -n 's/^ *"sha": *"\([0-9a-f]*\)".*/\1/p' "$here/build-info.json" 2>/dev/null)

# What the app runs once started (selftestrequest.py). Its summary goes to a
# folder of its own, to be merged with the harness's checks, and its budget
# ends before the bridge's so the run keeps time to stop it and collect. The
# app counts that budget from its own start, which can come a fallback's wait
# later, so it is also given the time the run stops it by (see stop_app).
app_results="$RESULTS_DIR/app"
handshake="$GALLEON_TEST_DIR/handshake"
# The profiles the app measures, and the only ones it may have switched to.
profiles="performance balanced"
set --
for name in $profiles; do set -- "$@" --profile "$name"; done
# Each emulator is started with the payload of a system it plays, once
# that payload was copied: a cycle without one is only a skip.
# RetroArch's SNES cartridge writes its battery SRAM, so its exit must leave a
# changed save folder.
snes_payload='roms/snes/galleon-snes-save.sfc'
if [ -n "$payloads_ok" ] && printf '%s\n' "$payload_list" | grep -qxF "$snes_payload"; then
  set -- "$@" --payload "retroarch=$snes_payload" --saving retroarch \
    --check launch.retroarch --check exit.retroarch
fi
ps2_payload='roms/ps2/galleon-ps2-hello.iso'
if [ -n "$payloads_ok" ] && printf '%s\n' "$payload_list" | grep -qxF "$ps2_payload"; then
  set -- "$@" --payload "armsx2=$ps2_payload" --check launch.armsx2 --check exit.armsx2
fi
gc_payload='roms/gc/galleon-gc-hello.dol'
if [ -n "$payloads_ok" ] && printf '%s\n' "$payload_list" | grep -qxF "$gc_payload"; then
  set -- "$@" --payload "dolphin=$gc_payload" --check launch.dolphin --check exit.dolphin
fi
psp_payload='roms/psp/galleon-psp-hello.pbp'
if [ -n "$payloads_ok" ] && printf '%s\n' "$payload_list" | grep -qxF "$psp_payload"; then
  set -- "$@" --payload "ppsspp=$psp_payload" --check launch.ppsspp --check exit.ppsspp
fi
dc_payload='roms/dreamcast/galleon-dc-hello.elf'
if [ -n "$payloads_ok" ] && printf '%s\n' "$payload_list" | grep -qxF "$dc_payload"; then
  set -- "$@" --payload "flycast=$dc_payload" --check launch.flycast --check exit.flycast
fi
nds_payload='roms/nds/galleon-nds-hello.nds'
if [ -n "$payloads_ok" ] && printf '%s\n' "$payload_list" | grep -qxF "$nds_payload"; then
  set -- "$@" --payload "melonds=$nds_payload" --check launch.melonds --check exit.melonds
fi
if [ -n "$target_gameid" ]; then
  set -- "$@" --check steam.launch --steam-target "$target_gameid"
fi
app_budget=$((deadline - $(date +%s) - STOP_RESERVE_SECONDS))
selftest_ok=
if [ -n "$home_ok" ] && rm -rf -- "$app_results" "$handshake" &&
  mkdir -p -- "$app_results" "$handshake" &&
  python3 "$here/selftestrequest.py" write --home "$GALLEON_HOME" --sha "$GALLEON_SHA" \
    ${version:+--version "$version"} --budget "$app_budget" \
    --deadline $((deadline - STOP_RESERVE_SECONDS)) \
    --results "$app_results" --handshake "$handshake" \
    --check selftest.complete --check build.identity --check startup.cold \
    --check grid.scroll --check server.heartbeat --check download.small \
    --check update.verify --check report.bundle --check storage.sdcard \
    --check focus.return --check focus.no-new-window --check steam.list \
    --check power.read "$@" \
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

# The owner's power profile, recorded before anything could ask to switch it
# and kept in the test root for a later --cleanup. Without a record every
# request is answered unchanged, and the app reports those profiles not set.
profile_state="$GALLEON_TEST_ROOT/profile.json"
if [ -n "$muted" ]; then
  python3 "$here/powerprofile.py" record --state "$profile_state" >>"$log" 2>&1 ||
    echo "power profile: not recorded, so not switched" >>"$log"
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
LIBRARY_WAIT_SECONDS=${GALLEON_LIBRARY_WAIT_SECONDS:-60}
READY_WAIT_SECONDS=${GALLEON_READY_WAIT_SECONDS:-30}
# How often the waits below look again; tests look more often.
POLL_SECONDS=${GALLEON_POLL_SECONDS:-1}
launched="$GALLEON_HOME/launch"
gameid=$(printf '%s' "$shortcut" | sed -n 's/.*"gameid": *\([0-9][0-9]*\).*/\1/p')
started_by=
app_ran=
app_note='not started'
start_failed=
stopped=
marked_by() {
  until [ -e "$launched/started" ]; do
    [ "$(date +%s)" -lt "$1" ] || return 1
    sleep "$POLL_SECONDS"
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
# The app asks for a profile while it runs (PLAN.md 5.3 step 8) and waits
# for the answer, so requests are served for as long as the run waits on it.
serve_profile() {
  [ -e "$handshake/want-profile" ] && [ ! -e "$handshake/profile-set" ] || return 0
  set --
  for name in $profiles; do set -- "$@" --allow "$name"; done
  python3 "$here/powerprofile.py" answer --state "$profile_state" --handshake "$handshake" \
    "$@" >>"$log" 2>&1 || :
}
# Once the app has asked Steam for the target (steam.launch), Steam's windows
# are watched for the 'Launch Multiple Games' prompt and the app is told what
# was seen (steamcef.py prompt), once a run. The watch ends inside the app's
# wait for the answer (selfteststeam.ts, PROMPT_WAIT_MS).
PROMPT_WATCH_SECONDS=${GALLEON_PROMPT_WATCH_SECONDS:-45}
prompt_watched=
serve_prompt() {
  [ -z "$prompt_watched" ] && [ -e "$handshake/steam-launched" ] || return 0
  prompt_watched=1
  python3 "$here/steamcef.py" ${GALLEON_STEAM_CEF:+--cef "$GALLEON_STEAM_CEF"} \
    prompt --handshake "$handshake" --wait "$PROMPT_WATCH_SECONDS" >>"$log" 2>&1 || :
}
gone_by() {
  until app_gone; do
    [ "$(date +%s)" -lt "$1" ] || return 1
    serve_profile
    serve_prompt
    sleep "$POLL_SECONDS"
  done
}
# The owner may have picked the device up since the first check. Nothing has
# started, so the run stands down as a skip and tries the build again later;
# what it set up is still undone below, and its checks still reported.
ready=
late_skip=
if [ -n "$request_ok" ] && [ -n "$muted" ]; then
  why=$(python3 "$here/session.py" check --test-root "$GALLEON_TEST_ROOT" 2>>"$log")
  case $? in
    0) ready=1 ;;
    10)
      late_skip=$why
      echo "skipped before the start: $why" >>"$log"
      ;;
    *) session_ok= ;;
  esac
fi
# Both routes go through Steam's client, and a shortcut reused from its
# record asked it nothing, so its debugger must answer before the start: a
# client that does not cannot start the app either way, and the run is
# skipped and tried again rather than failed (docs/DEVICE-FACTS.md).
if [ -n "$ready" ]; then
  why=$(python3 "$here/steamcef.py" ${GALLEON_STEAM_CEF:+--cef "$GALLEON_STEAM_CEF"} \
    ready --wait "$READY_WAIT_SECONDS" 2>>"$log")
  case $? in
    0) ;;
    10)
      ready=
      late_skip=steam-cef-unavailable
      echo "skipped before the start: $why" >>"$log"
      ;;
    *)
      ready=
      start_failed=1
      echo "start: Steam's debugger could not be asked" >>"$log"
      ;;
  esac
fi
if [ -n "$ready" ] && [ -z "$gameid" ]; then
  echo "start: the shortcut has no game id" >>"$log"
  start_failed=1
elif [ -n "$ready" ] &&
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
# Past the wait the app is asked to stop, then launch.sh is signalled (it
# passes the signal on to the app alone), then both recorded pids are killed.
stop_app() {
  : >"$handshake/stop" 2>>"$log"
  if gone_by $(($(date +%s) + STOP_WAIT_SECONDS)); then
    app_note='stopped when asked'
    return
  fi
  if pid=$(recorded launch.pid); then kill -TERM "$pid" 2>>"$log"; fi
  if gone_by $(($(date +%s) + STOP_WAIT_SECONDS)); then
    app_note='stopped by a signal'
    return
  fi
  for name in app.pid launch.pid; do
    if pid=$(recorded "$name"); then kill -KILL "$pid" 2>>"$log"; fi
  done
  app_note='killed'
}
if [ -n "$started_by" ]; then
  app_ran=1
  echo "started through $started_by" >>"$log"
  # The app's own budget ends at STOP_RESERVE_SECONDS before the bridge's;
  # past that it gets one STOP_WAIT_SECONDS to finish its summary before it
  # is stopped, all inside the reserve.
  if gone_by $((deadline - STOP_RESERVE_SECONDS + STOP_WAIT_SECONDS)); then
    app_note="exited $(cat "$launched/exit" 2>/dev/null || echo unknown)"
  else
    stop_app
    # The budget ran out with the app's checks unfinished (PLAN.md 5.3 step 9).
    stopped=1
  fi
fi

# The request is withdrawn before the sound comes back, so a start Steam
# acts on late finds nothing to start. Making launch.sh's own start mark
# shuts out one already past its check; when the mark is taken, a start
# this run gave up on happened anyway and is stopped at once.
request_gone=1
python3 "$here/current.py" remove --test-root "$GALLEON_TEST_ROOT" 2>>"$log" || request_gone=
if [ -n "$home_ok" ] && ! mkdir -- "$launched" 2>/dev/null && [ -z "$started_by" ]; then
  echo "a start given up on happened late" >>"$log"
  app_ran=1
  # launch.sh records its pid before it marks the start.
  marked_by $(($(date +%s) + STOP_WAIT_SECONDS)) || :
  stop_app
  app_note="started late, $app_note"
fi
echo "app: $app_note" >>"$log"

# A game that quits leaves Steam on its page, so once the app has run Steam
# is sent back to its library (PLAN.md 5.3 step 11), the screen the bridge
# leaves the device at. Where Steam is comes from its debugger's window
# list, which only looks.
steam_library() {
  python3 "$here/steamcef.py" ${GALLEON_STEAM_CEF:+--cef "$GALLEON_STEAM_CEF"} \
    library --wait "$1" >>"$log" 2>&1
}
at_library=1
if [ -n "$app_ran" ] && ! steam_library 0; then
  timeout "$START_WAIT_SECONDS" steam "steam://open/games" </dev/null >>"$log" 2>&1
  steam_library "$LIBRARY_WAIT_SECONDS" || at_library=
fi

# The profile, then the sound, are put back before the second manifest. A
# record that cannot be restored (the daemon not answering, or the sink gone)
# is kept and fails harness.run on every run until it can be.
profile_restored=1
python3 "$here/powerprofile.py" restore --state "$profile_state" >>"$log" 2>&1 || profile_restored=
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

python3 "$here/selftestrequest.py" remove --home "$GALLEON_HOME" 2>>"$log" || request_gone=
# The payload copies and every ROM the app downloaded go once it has quit
# (PLAN.md 5.3 step 11); nothing of them is left in the test home.
roms_gone=1
python3 "$here/payloads.py" remove --home "$GALLEON_HOME" 2>>"$log" || roms_gone=

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
elif [ -z "$payloads_ok" ]; then
  result=fail
  reason='"the payloads could not be copied into the test home"'
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
elif [ -z "$roms_gone" ]; then
  result=fail
  reason='"the payloads and downloaded ROMs could not be removed"'
elif [ -z "$profile_restored" ]; then
  result=fail
  reason='"the power profile could not be put back as it was"'
elif [ -z "$audio_restored" ]; then
  result=fail
  reason='"the sound could not be put back as it was"'
elif [ -z "$at_library" ]; then
  result=fail
  reason='"Steam was not left at its library"'
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

# The bridge publishes a skip only once per build and reason, so a late skip
# whose checks did not all pass is reported as a run that ended early: a
# failure found before the start, safety.owner-state above all, always
# reaches the results.
status=complete
status_reason=null
late_note=
if [ -n "$late_skip" ] && [ "$result" = pass ] && [ "$owner_result" = pass ]; then
  status=skipped
  status_reason=$(json_string "$late_skip")
elif [ -n "$late_skip" ]; then
  status=partial
  late_note="skipped before the start, reported for its failed checks: $late_skip"
  late_skip=
elif [ -n "$stopped" ]; then
  status=partial
fi

tmp="$RESULTS_DIR/.summary.json.tmp"
cat >"$tmp" <<JSON
{
  "schema": 1,
  "sha": "$GALLEON_SHA",
  "version": "${version:-unknown}",
  "status": "$status",
  "reason": $status_reason,
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
    "harness checks: harness.run and safety.owner-state; the app's follow once it has started",
    "sign-in: ${signin_source:-no-importable-credentials}",
    "audio: $audio_note",
    "app: $app_note"${late_note:+,
    $(json_string "$late_note")}
  ]
}
JSON
# A started app's checks join the harness's (mergesummary.py), from a
# summary written outside the results so only the merged one is published.
# A merge that cannot run still publishes the harness's checks, as a run
# that is missing the app's.
if [ -z "$started_by" ]; then
  mv "$tmp" "$RESULTS_DIR/summary.json"
else
  harness_summary="$GALLEON_TEST_DIR/harness-summary.json"
  mv "$tmp" "$harness_summary"
  python3 "$here/mergesummary.py" --harness "$harness_summary" --app "$app_results/summary.json" \
    --sha "$GALLEON_SHA" --out "$RESULTS_DIR/summary.json" 2>>"$log"
  merged=$?
  if [ "$merged" -ne 0 ] && [ "$merged" -ne 20 ]; then
    echo "the app's summary could not be merged" >>"$log"
    sed 's/^  "status": "complete",$/  "status": "partial",/' "$harness_summary" >"$tmp" &&
      mv "$tmp" "$RESULTS_DIR/summary.json"
  fi
  rm -f -- "$harness_summary"
  # A Galleon Steam closed reports no steam.launch, and a prompt left up
  # keeps the check from later unattended runs (steamlaunch.py).
  python3 "$here/steamlaunch.py" settle --summary "$RESULTS_DIR/summary.json" \
    --handshake "$handshake" --record "$attended_record" >>"$log" 2>&1 ||
    echo "steam.launch: the summary could not be settled" >>"$log"
  [ "$merged" -ne 20 ] || exit 20
fi
[ -z "$late_skip" ] || exit 10
exit 0
