#!/bin/sh
# The 'Galleon Device Test' shortcut's executable — see docs/PLAN.md section
# 5.3, steps 6 to 9. run.sh copies it, with target.sh, current.py and launched.py, into
# GALLEON_TEST_ROOT, so the shortcut's path stays the same across runs.
#
# Steam starts it with no arguments, so what to start comes from
# current.json, which run.sh writes just before the start. Without a current,
# unexpired request it starts nothing, which is what a hand on the shortcut
# gets. It marks the start and records the pids run.sh may signal in
# $GALLEON_HOME/launch/, through launched.py beside it, and starts once per
# run however many routes asked.
set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

request=$(python3 -I "$here/current.py" check --test-root "$here") || exit 0
appimage=$(printf '%s\n' "$request" | sed -n 1p)
home=$(printf '%s\n' "$request" | sed -n 2p)

# Both run.sh's steam:// start and its CEF fallback can reach here; mkdir is
# atomic, so only the first starts the app.
state="$home/launch"
mkdir "$state" 2>/dev/null || exit 0

# Each pid goes with its boot id and start time (launched.py), written first,
# so run.sh --cleanup can stop these processes after a run that was killed,
# and never a later process given the same number.
python3 -I "$here/launched.py" record --state "$state" --name launch --pid "$$" 2>/dev/null || :
echo "$$" >"$state/launch.pid"
date -u +%Y-%m-%dT%H:%M:%SZ >"$state/started"

# Steam, or run.sh at the end of the budget, stops the shortcut through this
# process, so launched.py takes it over under the same pid and start time: it
# starts the app, records it, passes a stop on to it alone and writes `exit`
# (launched.run). A stop before it is in place finds nothing started yet.
GALLEON_HOME=$home
export GALLEON_HOME
exec python3 -I "$here/launched.py" run --state "$state" -- "$appimage"
