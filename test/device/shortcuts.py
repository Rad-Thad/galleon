#!/usr/bin/env python3
"""Finding the test shortcut in Steam's shortcuts.vdf (docs/PLAN.md section 5.3, step 6).

run.sh adds the 'Galleon Device Test' shortcut through Steam's own client
while Steam runs, and keeps the appid it gets back. When that record is gone
it looks for the entry by name in each user's shortcuts.vdf before adding
another, so the owner's library never collects copies. This only reads the
file: writing it while Steam runs would be overwritten, or worse, by Steam.

shortcuts.vdf is binary VDF: a map is a 0x00 byte, a NUL-terminated name and
its fields up to a 0x08 byte; a string field is 0x01, an int32 0x02. The
appid is stored signed, and the game id `steam://rungameid/` takes is the
unsigned appid in the high 32 bits with the non-Steam flag in the low ones.

  shortcuts.py find NAME     prints {"appid", "gameid", "file"} or exits 1
  shortcuts.py gameid APPID  prints the game id for an appid

HOME is the owner's home; `--home` overrides it (tests).
"""

import argparse
import glob
import json
import os
import struct
import sys

TEST_SHORTCUT = "Galleon Device Test"
SHORTCUTS_GLOB = ".local/share/Steam/userdata/*/config/shortcuts.vdf"

MAP, STRING, INT32, FLOAT32, POINTER, WIDESTRING, COLOR, UINT64, END = 0, 1, 2, 3, 4, 5, 6, 7, 8
# Fixed-size field types and their widths; a reader that meets any other type
# cannot know where the next field starts, so it stops.
FIXED = {INT32: 4, FLOAT32: 4, POINTER: 4, COLOR: 4, UINT64: 8}

NON_STEAM_FLAG = 0x02000000


class VdfError(ValueError):
    pass


def _cstring(data, at):
    end = data.find(b"\0", at)
    if end < 0:
        raise VdfError("unterminated string")
    return data[at:end].decode("utf-8", "replace"), end + 1


def _map(data, at, depth):
    if depth > 16:
        raise VdfError("nested too deeply")
    fields = {}
    while True:
        if at >= len(data):
            raise VdfError("truncated")
        kind = data[at]
        at += 1
        if kind == END:
            return fields, at
        name, at = _cstring(data, at)
        if kind == MAP:
            fields[name], at = _map(data, at, depth + 1)
        elif kind == STRING:
            fields[name], at = _cstring(data, at)
        elif kind in FIXED:
            width = FIXED[kind]
            if at + width > len(data):
                raise VdfError("truncated")
            raw = data[at : at + width]
            fields[name] = struct.unpack("<i", raw)[0] if kind == INT32 else raw
            at += width
        else:
            raise VdfError(f"unknown field type {kind}")


def parse(data):
    """The top-level maps of a binary VDF file, as nested dicts."""
    fields, _ = _map(data, 0, 0)
    return fields


def gameid(appid):
    """The id `steam://rungameid/` takes for a non-Steam shortcut's appid."""
    return ((appid & 0xFFFFFFFF) << 32) | NON_STEAM_FLAG


def _name(entry):
    # Steam has written the key in both cases over the years.
    for key in ("AppName", "appname"):
        if isinstance(entry.get(key), str):
            return entry[key]
    return None


def find(home, name):
    """(appid unsigned, file) of the first shortcut called `name`, else None.

    A file that cannot be read or parsed is passed over: it may be mid-write
    by Steam, and is no reason to stop looking in the others.
    """
    for path in sorted(glob.glob(os.path.join(glob.escape(home), SHORTCUTS_GLOB))):
        try:
            with open(path, "rb") as handle:
                shortcuts = parse(handle.read()).get("shortcuts")
        except (OSError, VdfError):
            continue
        if not isinstance(shortcuts, dict):
            continue
        for entry in shortcuts.values():
            if isinstance(entry, dict) and _name(entry) == name and isinstance(entry.get("appid"), int):
                return entry["appid"] & 0xFFFFFFFF, path
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--home", default=os.path.expanduser("~"))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("find").add_argument("name", nargs="?", default=TEST_SHORTCUT)
    commands.add_parser("gameid").add_argument("appid", type=int)
    args = parser.parse_args(argv)

    if args.command == "gameid":
        print(gameid(args.appid))
        return 0
    found = find(os.path.abspath(args.home), args.name)
    if not found:
        return 1
    appid, path = found
    print(json.dumps({"appid": appid, "gameid": gameid(appid), "file": path}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
