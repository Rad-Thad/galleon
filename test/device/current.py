#!/usr/bin/env python3
"""The request the test shortcut reads (docs/PLAN.md section 5.3, step 7).

`steam://rungameid/` cannot pass arguments, so the 'Galleon Device Test'
shortcut runs `launch.sh`, which learns what to start from
`$GALLEON_TEST_ROOT/current.json`. run.sh writes it just before the start and
removes it when the run ends; it carries an expiry at the end of the budget,
so a shortcut started by hand, or long after a run that never cleaned up,
starts nothing.

  current.py write --test-root R --appimage A --home H --results D --sha S --budget SECONDS
  current.py check --test-root R    prints the AppImage and the home, one per line, or exits 1
  current.py remove --test-root R

`check` holds the home to a folder inside the test root, so the app it
starts can never be pointed at the owner's own files.
"""

import argparse
import json
import os
import re
import sys
import time

NAME = "current.json"
FIELDS = ("appimage", "home", "results", "sha")


def path(test_root):
    return os.path.join(test_root, NAME)


def write(test_root, appimage, home, results, sha, budget, now=None):
    expires = int((time.time() if now is None else now) + budget)
    record = {"appimage": appimage, "home": home, "results": results, "sha": sha,
              "expires": expires,
              "expiresAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires))}
    target = path(test_root)
    tmp = target + ".tmp"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(record, handle)
    os.replace(tmp, target)
    return record


def _inside(child, parent):
    child, parent = os.path.realpath(child), os.path.realpath(parent)
    return os.path.commonpath([child, parent]) == parent and child != parent


def check(test_root, now=None):
    """(appimage, home) when the request is current and sound, else (None, reason)."""
    target = path(test_root)
    if os.path.islink(target):
        return None, "linked"
    try:
        with open(target, encoding="utf-8") as handle:
            record = json.load(handle)
    except FileNotFoundError:
        return None, "missing"
    except (OSError, ValueError):
        return None, "unreadable"
    if not isinstance(record, dict):
        return None, "unreadable"
    for field in FIELDS:
        value = record.get(field)
        # launch.sh reads the answer line by line.
        if not isinstance(value, str) or not value or "\n" in value or "\r" in value:
            return None, f"bad {field}"
    expires = record.get("expires")
    if not isinstance(expires, int) or isinstance(expires, bool):
        return None, "bad expires"
    if expires <= (time.time() if now is None else now):
        return None, "expired"
    if not re.fullmatch(r"[0-9a-f]{40}", record["sha"]):
        return None, "bad sha"
    appimage, home = record["appimage"], record["home"]
    if not os.path.isabs(appimage) or not os.path.isfile(appimage) or not os.access(appimage, os.X_OK):
        return None, "no appimage"
    if not os.path.isabs(home) or os.path.islink(home) or not os.path.isdir(home):
        return None, "no home"
    if not _inside(home, test_root):
        return None, "home outside the test root"
    return (appimage, home), None


def remove(test_root):
    try:
        os.unlink(path(test_root))
    except FileNotFoundError:
        pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    put = commands.add_parser("write")
    for name in ("--appimage", "--home", "--results", "--sha"):
        put.add_argument(name, required=True)
    put.add_argument("--budget", type=int, required=True)
    for command in (put, commands.add_parser("check"), commands.add_parser("remove")):
        command.add_argument("--test-root", required=True)
    args = parser.parse_args(argv)
    test_root = os.path.abspath(args.test_root)

    if args.command == "write":
        write(test_root, os.path.abspath(args.appimage), os.path.abspath(args.home),
              os.path.abspath(args.results), args.sha, args.budget)
        return 0
    if args.command == "remove":
        remove(test_root)
        return 0
    found, reason = check(test_root)
    if not found:
        print(f"current.json: {reason}", file=sys.stderr)
        return 1
    print("\n".join(found))
    return 0


if __name__ == "__main__":
    sys.exit(main())
