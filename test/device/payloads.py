#!/usr/bin/env python3
"""The homebrew payloads in the test home (docs/PLAN.md section 5.3, steps 5 and 11).

The bundle carries the payloads the M0-07 manifest pins in `payloads/`, laid
out as `roms/<system>/<file>` with their manifest entries (scripts/
device-bundle.mjs). Copied into the test home in that layout, a payload's
folder names its system, as the app's self-test expects (selftestemulators.ts,
`payloadFor`), and they sit in the app's own ROM folder, where anything the
app downloads lands too. Their licence notices stay in the bundle beside them.

  payloads.py copy --bundle DIR --home H    copies every payload DIR's manifest
      names into H, each checked against its pinned size and hash, and prints
      the copied paths, relative to H, one per line
  payloads.py remove --home H               removes H's ROM folder, payload
      copies and downloads alike

Exits NONE_EXIT when the bundle has no payloads, ERROR_EXIT when a payload
cannot be copied or the folder cannot be removed.
"""

import argparse
import hashlib
import json
import os
import shutil
import sys

MANIFEST = "manifest.json"
# The app's ROM folder inside its home (src/main/root.ts).
ROMS = "roms"
NONE_EXIT = 10
ERROR_EXIT = 3


class PayloadError(ValueError):
    pass


def _entries(bundle):
    with open(os.path.join(bundle, MANIFEST), encoding="utf-8") as handle:
        files = json.load(handle).get("files")
    if not isinstance(files, list):
        raise PayloadError("the payload manifest lists no files")
    entries = []
    for entry in files:
        path = entry.get("path") if isinstance(entry, dict) else None
        parts = path.split("/") if isinstance(path, str) else []
        # Only roms/<system>/<file>, so nothing is written outside the ROM
        # folder and every payload has a system.
        if (len(parts) != 3 or parts[0] != ROMS
                or any(part in ("", ".", "..") or "\0" in part for part in parts)):
            raise PayloadError(f"a payload path is not roms/<system>/<file>: {path!r}")
        if not isinstance(entry.get("bytes"), int) or not isinstance(entry.get("sha256"), str):
            raise PayloadError(f"the payload {path} has no pinned size and hash")
        entries.append((path, entry["bytes"], entry["sha256"]))
    return entries


def _real_folder(path, what):
    if os.path.islink(path) or not os.path.isdir(path):
        raise PayloadError(f"{what} is not a folder")


def copy(bundle, home):
    """Copies the bundle's payloads into `home`, returning their paths in it."""
    if not os.path.isdir(bundle):
        return []
    _real_folder(home, "the test home")
    copied = []
    for path, size, digest in _entries(bundle):
        source = os.path.join(bundle, path)
        fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as handle:
            data = handle.read(size + 1)
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            raise PayloadError(f"the payload {path} is not the bytes the manifest pins")
        folder = home
        for part in path.split("/")[:-1]:
            folder = os.path.join(folder, part)
            if not os.path.lexists(folder):
                os.mkdir(folder, 0o700)
            # A link in the home could send a copy into the owner's files.
            _real_folder(folder, f"{os.path.relpath(folder, home)} in the test home")
        target = os.path.join(home, path)
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        copied.append(path)
    return copied


def remove(home):
    """Removes the ROM folder from `home`, never following a link out of it."""
    roms = os.path.join(home, ROMS)
    if os.path.islink(roms) or os.path.isfile(roms):
        os.unlink(roms)
    elif os.path.isdir(roms):
        # rmtree removes links inside without following them.
        shutil.rmtree(roms)
    if os.path.lexists(roms):
        raise PayloadError("the ROM folder is still there")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    put = commands.add_parser("copy")
    put.add_argument("--bundle", required=True)
    for command in (put, commands.add_parser("remove")):
        command.add_argument("--home", required=True)
    args = parser.parse_args(argv)

    try:
        if args.command == "remove":
            if os.path.lexists(args.home):
                _real_folder(args.home, "the test home")
                remove(args.home)
            return 0
        copied = copy(args.bundle, args.home)
    except (PayloadError, OSError, ValueError) as error:
        print(f"payloads.py: {error}", file=sys.stderr)
        return ERROR_EXIT
    for path in copied:
        print(path)
    return 0 if copied else NONE_EXIT


if __name__ == "__main__":
    sys.exit(main())
