#!/usr/bin/env python3
"""Sound off for a device run, and back as it was (docs/PLAN.md section 5.3, steps 8 and 11).

A run must leave no trace, and an emulator's sound at night is a trace. run.sh
mutes the default sink before it starts anything, and afterwards puts that
sink's mute and volume back as they were. The sink is recorded by its id, so
headphones plugged in during the run cannot make the restore land on another.

  audio.py mute --state FILE      records the sink, then mutes it
  audio.py restore --state FILE   puts it back and removes FILE; nothing to do without FILE

The record outlives a run that is stopped (`run.sh --cleanup` restores from
it), and a mute that finds a record already there keeps it: that record holds
the owner's settings, and the sink as it is now may be the stopped run's mute.

Exits ERROR_EXIT when WirePlumber cannot be asked or does not answer as
expected, so run.sh can refuse to start anything with the sound on.
"""

import argparse
import json
import os
import re
import subprocess
import sys

DEFAULT_SINK = "@DEFAULT_AUDIO_SINK@"
ERROR_EXIT = 3
# A hung WirePlumber must not hold up the run.
TIMEOUT_SECONDS = 10

VOLUME = re.compile(r"^Volume: ([0-9]+(?:\.[0-9]+)?)( \[MUTED\])?\s*$")
NODE_ID = re.compile(r"^id ([0-9]+),")


class AudioError(RuntimeError):
    pass


def _wpctl(wpctl, *args):
    try:
        done = subprocess.run([wpctl, *args], capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise AudioError(f"wpctl {args[0]}: {error}") from error
    if done.returncode != 0:
        raise AudioError(f"wpctl {args[0]} exited {done.returncode}: {done.stderr.strip()}")
    return done.stdout


def sink_state(wpctl, sink=DEFAULT_SINK):
    """{"sink", "volume", "muted"} for a sink, its id resolved."""
    first = _wpctl(wpctl, "inspect", sink).splitlines()[:1]
    node = NODE_ID.match(first[0]) if first else None
    if not node:
        raise AudioError("wpctl inspect: no node id")
    volume = VOLUME.match(_wpctl(wpctl, "get-volume", node.group(1)).strip())
    if not volume:
        raise AudioError("wpctl get-volume: unexpected answer")
    return {"sink": node.group(1), "volume": volume.group(1), "muted": bool(volume.group(2))}


def _read(state_file):
    with open(state_file, encoding="utf-8") as handle:
        record = json.load(handle)
    if not (
        isinstance(record, dict)
        and isinstance(record.get("sink"), str)
        and record["sink"].isdigit()
        and isinstance(record.get("volume"), str)
        and re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", record["volume"])
        and isinstance(record.get("muted"), bool)
    ):
        raise AudioError("the audio record is not one this wrote")
    return record


def mute(wpctl, state_file):
    """Mute the default sink; the record of how it was, kept or new."""
    if os.path.lexists(state_file):
        record = _read(state_file)
    else:
        record = sink_state(wpctl)
        temporary = f"{state_file}.tmp"
        if os.path.lexists(temporary):
            os.unlink(temporary)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle)
        os.replace(temporary, state_file)
    _wpctl(wpctl, "set-mute", record["sink"], "1")
    return record


def restore(wpctl, state_file):
    """Put the recorded sink back; the record, or None when there was none."""
    if not os.path.lexists(state_file):
        return None
    record = _read(state_file)
    # get-volume rounds, so setting the recorded value back would move a
    # volume the run never touched; it is set only when it differs.
    now = VOLUME.match(_wpctl(wpctl, "get-volume", record["sink"]).strip())
    if not now:
        raise AudioError("wpctl get-volume: unexpected answer")
    if now.group(1) != record["volume"]:
        _wpctl(wpctl, "set-volume", record["sink"], record["volume"])
    _wpctl(wpctl, "set-mute", record["sink"], "1" if record["muted"] else "0")
    os.unlink(state_file)
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--wpctl", default="wpctl")
    parser.add_argument("command", choices=("mute", "restore"))
    parser.add_argument("--state", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "mute":
            record = mute(args.wpctl, args.state)
            print(f"muted sink {record['sink']}")
        else:
            record = restore(args.wpctl, args.state)
            print(f"restored sink {record['sink']}" if record else "nothing to restore")
    except (AudioError, OSError, ValueError) as error:
        print(f"audio.py: {error}", file=sys.stderr)
        return ERROR_EXIT
    return 0


if __name__ == "__main__":
    sys.exit(main())
