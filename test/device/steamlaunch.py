#!/usr/bin/env python3
"""What run.sh keeps of the app's `steam.launch` (docs/TESTING.md).

The app records the check while it runs (src/main/selfteststeam.ts). Two
things it cannot do are done here, once the run's summary is merged:

- A Galleon that Steam closed writes no summary, so when the handshake shows
  it asked Steam (`steam-launched`) and the summary has no `steam.launch`,
  the check is added as a fail with `galleonSurvived` 0, from the marks the
  handshake kept.
- A 'Launch Multiple Games' prompt left on screen needs a person to answer
  it, so the check is never run unattended again: the record in the test
  root, outside any one build, says so to every later run.

  steamlaunch.py settle --summary S --handshake H --record R
  steamlaunch.py attended --record R    exits 0 when a run left the prompt up
"""

import argparse
import json
import os
import sys
import time

CHECK = "steam.launch"
NEEDS_ATTENDED = "needs-attended"
# The handshake files, as selfteststeam.ts names them.
STEAM_LAUNCHED = "steam-launched"
STEAM_PROMPT = "steam-prompt"
TARGET_STARTED = "target-started"
TARGET_ENDED = "target-ended"
PROMPTS = ("none", "shown", "left")


def _there(handshake, name):
    return os.path.isfile(os.path.join(handshake, name))


def _prompt(handshake):
    try:
        with open(os.path.join(handshake, STEAM_PROMPT), encoding="utf-8") as handle:
            said = handle.read(64).strip()
    except OSError:
        return "no-answer"
    return said if said in PROMPTS else "no-answer"


def closed_check(handshake):
    """The check for a Galleon that asked Steam and never reported."""
    prompt = _prompt(handshake)
    return {
        "id": CHECK,
        "result": "fail",
        "metrics": {
            "started": 1 if _there(handshake, TARGET_STARTED) else 0,
            "prompt": prompt,
            "targetEnded": 1 if _there(handshake, TARGET_ENDED) else 0,
            "galleonSurvived": 0,
        },
        "thresholds": {},
        "reason": "galleon-closed",
        "evidence": [],
    }


def _write_json(path, record, mode=0o644):
    tmp = os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".tmp")
    if os.path.lexists(tmp):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
    os.replace(tmp, path)


def settle(summary_path, handshake, record_path, now=None):
    """(added, attended): whether the check was added, and whether the record was written."""
    with open(summary_path, encoding="utf-8") as handle:
        summary = json.load(handle)
    if not isinstance(summary, dict) or not isinstance(summary.get("checks"), list):
        raise ValueError("not a summary")
    checks = summary["checks"]
    found = next((c for c in checks if isinstance(c, dict) and c.get("id") == CHECK), None)
    added = False
    if found is None and _there(handshake, STEAM_LAUNCHED):
        found = closed_check(handshake)
        checks.append(found)
        notes = summary.setdefault("notes", [])
        if isinstance(notes, list):
            notes.append("steam.launch: Galleon asked Steam and never reported, so Steam closed it")
        if summary.get("status") == "complete":
            summary["status"] = "partial"
        _write_json(summary_path, summary)
        added = True
    attended = found is not None and (
        found.get("reason") == NEEDS_ATTENDED
        or (isinstance(found.get("metrics"), dict) and found["metrics"].get("prompt") == "left"))
    if attended:
        stamp = time.gmtime(time.time() if now is None else now)
        _write_json(record_path, {"check": CHECK, "sha": summary.get("sha"),
                                  "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", stamp)})
    return added, attended


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    put = commands.add_parser("settle")
    put.add_argument("--summary", required=True)
    put.add_argument("--handshake", required=True)
    for command in (put, commands.add_parser("attended")):
        command.add_argument("--record", required=True)
    args = parser.parse_args(argv)

    if args.command == "attended":
        return 0 if os.path.lexists(args.record) else 1
    try:
        added, attended = settle(args.summary, args.handshake, args.record)
    except (OSError, ValueError) as error:
        print(f"steamlaunch.py: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"added": added, "needsAttended": attended}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
