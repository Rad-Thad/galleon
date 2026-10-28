#!/bin/sh
# The 'Galleon Device Test Target' shortcut's executable — see docs/TESTING.md
# (`steam.launch`). Galleon starts it through steam://rungameid/ while it is
# itself a running shortcut, to see what Steam does when a second game starts.
# It stands in for that game: it marks its start and its end in the run's
# handshake folder and stays up a moment between them. It starts nothing.
#
# Steam passes no arguments, so it acts only while run.sh's launch request
# (current.json, through current.py beside it) is current, as launch.sh
# does: a hand on the shortcut gets a target that exits at once.
set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# Long enough for Steam to count it as running, short enough to stay well
# inside the app's wait for its end (selfteststeam.ts, TARGET_END_MS).
HOLD_SECONDS=5

request=$(python3 -I "$here/current.py" check --test-root "$here") || exit 0
home=$(printf '%s\n' "$request" | sed -n 2p)
# run.sh makes the handshake folder beside the test home, which current.py
# holds inside the test root.
handshake=$(dirname -- "$home")/handshake
if [ ! -d "$handshake" ] || [ -L "$handshake" ]; then
  exit 0
fi

mark() {
  rm -f -- "$handshake/.$1.tmp"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$handshake/.$1.tmp" && mv -f -- "$handshake/.$1.tmp" "$handshake/$1"
}
mark target-started
sleep "$HOLD_SECONDS"
mark target-ended
