#!/usr/bin/env python3
"""The shape of the saves Argosy devices left on the owner's server (M2-02).

docs/save-sync/SPEC.md was written from Argosy's and RomM's source; this
reads what the owner's server actually holds, so the spec can be checked
against it (its section 12 lists the questions). It runs with the test
home's imported sign-in and only ever reads:

- every request is a GET, built in one place (`_get`), whose query takes
  only the keys in `QUERY_KEYS`, so it never carries a device id: with one,
  RomM records a sync for that device, which would change what the owner's
  Argosy decides on its next sync;
- a save's bytes are read into memory, measured and dropped; nothing of them
  is written anywhere.

  argosy-shapes.py report --home TEST_HOME --out REPORT.json

The report names systems by RomM's platform slug and keeps, per save, only
its shape: slot, emulator tag, a file-name pattern with the game's own name
replaced, archive entry names with anything that is not an id replaced, sizes,
whether `content_hash` follows RomM's rule, a hardcore trailer, and
updated_at. No title, account name, address or save byte is written. Exit 0
with a report, 10 (`no-importable-credentials`) without a sign-in, 1 when the
server could not be read (the report then says which step, by status code).
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

SCHEMA = 1
EXIT_SKIPPED = 10
NO_CREDENTIALS = "no-importable-credentials"

# Games looked at per system, the first by id among those holding an Argosy
# save: enough to see each system's shape without reading the whole library.
GAMES_PER_SYSTEM = 3
TIMEOUT_SECONDS = 30
# A save past this is reported by size alone and not read.
MAX_SAVE_BYTES = 64 * 1024 * 1024

# Argosy's hardcore trailer, looked for near a save's end (SPEC.md section 12,
# question 9), since what follows the magic is not specified there.
HARDCORE_MAGIC = b"ARGOSY\x01\x00"

# File names Argosy gives a save that are not the game's own (SPEC.md 3.2).
FIXED_NAMES = ("autosave", "argosy-latest")

# An id inside an archive: a PS2 or PSP serial (with its region prefix or save suffix), a GameCube or Wii game id, a
# hex title id, a memory card. Anything else may be a title and is replaced.
ID_PART = re.compile(r"^(?:(?:B[AEI])?[A-Z]{4}[-_]?\d{5}(?:DATA)?\d*|(?=[A-Z0-9]*\d)[A-Z0-9]{6}|[0-9a-fA-F]{8,16}"
                     r"|Mcd\d{3}|card\d*|DATA|SAVEDATA|title|private|wii)$")
# The only query keys a request may carry.
QUERY_KEYS = ("platform_id", "rom_id")
# A serial followed by a suffix the game chose, which may be a word of its
# title: the serial is kept, the suffix replaced.
SERIAL_SUFFIX = re.compile(r"^((?:B[AEI])?[A-Z]{4}[-_]?\d{5}).+$")
TIMESTAMP_TAG = re.compile(r"\s*\[\d{4}-\d{2}-\d{2}[^\]]*\]")


class ReadError(Exception):
    """A step that could not read the server, by its code only."""

    def __init__(self, step, status):
        super().__init__(f"{step}: {status}")
        self.step = step
        self.status = status


def find_signin(home):
    """(base_url, token) from the test home that signin.py made, else (None, None)."""
    config = os.path.join(home, "config")
    try:
        with open(os.path.join(config, "settings.json"), encoding="utf-8") as handle:
            server = json.load(handle).get("server") or {}
        with open(os.path.join(config, "credentials.bin"), "rb") as handle:
            stored = handle.read()
    except (OSError, ValueError, AttributeError):
        return (None, None)
    if stored[:4] != b"RAW1" or not isinstance(server.get("baseUrl"), str):
        return (None, None)
    try:
        credentials = json.loads(stored[4:].decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return (None, None)
    token = credentials.get("clientToken") or credentials.get("accessToken")
    if not isinstance(token, str) or not token:
        return (None, None)
    return (server["baseUrl"].rstrip("/"), token)


def _get(base, token, path, query=None, step="read"):
    """The one request this file makes: a GET, its query only from QUERY_KEYS."""
    query = dict(query or {})
    if not set(query) <= set(QUERY_KEYS):
        raise ValueError("a query key outside QUERY_KEYS")
    url = base + path + ("?" + urllib.parse.urlencode(query) if query else "")
    request = urllib.request.Request(url, method="GET", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.read(MAX_SAVE_BYTES + 1)
    except urllib.error.HTTPError as error:
        raise ReadError(step, error.code) from None
    except (urllib.error.URLError, OSError) as error:
        raise ReadError(step, type(getattr(error, "reason", error)).__name__) from None


def _json(base, token, path, query=None, step="read"):
    try:
        return json.loads(_get(base, token, path, query, step))
    except ValueError:
        raise ReadError(step, "not-json") from None


def argosy_rule_is_zip(data):
    """Argosy's test: `PK`, then 03, 05 or 07, then 04, 06 or 08 (SPEC.md section 4)."""
    return len(data) >= 4 and data[:2] == b"PK" and data[2] in (3, 5, 7) and data[3] in (4, 6, 8)


def romm_hash(data):
    """RomM 5.2.0's content_hash, or None where RomM would give none (SPEC.md section 4)."""
    stream = io.BytesIO(data)
    if zipfile.is_zipfile(stream):
        try:
            with zipfile.ZipFile(stream) as archive:
                lines = sorted(f"{info.filename}:{hashlib.md5(archive.read(info)).hexdigest()}"
                               for info in archive.infolist() if not info.is_dir())
        except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError):
            return None
        return hashlib.md5("\n".join(lines).encode("utf-8")).hexdigest()
    return hashlib.md5(data).hexdigest()


def name_pattern(save, slot):
    """The save's file name with RomM's timestamp tag and the game's own name replaced."""
    name = TIMESTAMP_TAG.sub(" [<timestamp>]", str(save.get("file_name") or ""))
    stem, dot, extension = name.rpartition(".")
    if not dot:
        stem, extension = name, ""
    tagged = stem.endswith(" [<timestamp>]")
    base = stem[: -len(" [<timestamp>]")] if tagged else stem
    if base not in FIXED_NAMES and base != slot:
        base = "<rom>" if base else ""
    return base + (" [<timestamp>]" if tagged else "") + (f".{extension}" if dot else "")


def entry_pattern(name):
    """An archive entry's path with each part that is not an id replaced."""
    parts = []
    for part in name.split("/"):
        stem, dot, extension = part.rpartition(".")
        if not dot or len(extension) > 4:
            stem, dot, extension = part, "", ""
        suffixed = SERIAL_SUFFIX.match(stem)
        if ID_PART.match(stem) or not stem:
            kept = part
        elif suffixed:
            kept = suffixed.group(1) + "<suffix>" + (f".{extension}" if dot else "")
        else:
            kept = "<name>" + (f".{extension}" if dot else "")
        parts.append(kept)
    return "/".join(parts)


def shape_of(save, data):
    """What one save is made of, from its row and, when read, its bytes."""
    slot = save.get("slot")
    shape = {
        "slot": slot,
        "emulator": save.get("emulator"),
        "namePattern": name_pattern(save, slot),
        "extension": save.get("file_extension"),
        "sizeBytes": save.get("file_size_bytes"),
        "updatedAt": save.get("updated_at"),
        "hasContentHash": bool(save.get("content_hash")),
    }
    if data is None:
        shape["read"] = False
        return shape
    stored = save.get("content_hash")
    computed = romm_hash(data)
    is_zip = zipfile.is_zipfile(io.BytesIO(data))
    shape.update({
        "read": True,
        "readBytes": len(data),
        "zipByRomm": is_zip,
        "zipByArgosy": argosy_rule_is_zip(data),
        "contentHashFollowsRomm": None if not stored else stored == computed,
        "hardcoreTrailer": HARDCORE_MAGIC in data[-256:],
    })
    if is_zip:
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                shape["entries"] = [{"name": entry_pattern(info.filename), "sizeBytes": info.file_size,
                                     "dir": info.is_dir()} for info in archive.infolist()]
        except (zipfile.BadZipFile, OSError):
            shape["entries"] = None
    return shape


def report(base, token):
    """The whole report, reading the server through `_get` only."""
    devices = _json(base, token, "/api/devices", step="devices")
    argosy = {d.get("id") for d in devices if isinstance(d, dict)
              and "argosy" in str(d.get("client") or "").lower()}
    platforms = _json(base, token, "/api/platforms", step="platforms")
    systems = []
    for platform in sorted((p for p in platforms if isinstance(p, dict)), key=lambda p: p.get("id") or 0):
        listed = _json(base, token, "/api/saves", {"platform_id": platform.get("id")}, step="saves-by-platform")
        roms = sorted({s.get("rom_id") for s in listed
                       if isinstance(s, dict) and s.get("origin_device_id") in argosy and s.get("rom_id")})
        if not roms:
            continue
        games = []
        for rom in roms[:GAMES_PER_SYSTEM]:
            saves = _json(base, token, "/api/saves", {"rom_id": rom}, step="saves-by-rom")
            shapes = []
            for save in sorted((s for s in saves if isinstance(s, dict)
                                and s.get("origin_device_id") in argosy), key=lambda s: s.get("id") or 0):
                data = None
                if (save.get("file_size_bytes") or 0) <= MAX_SAVE_BYTES:
                    data = _get(base, token, f"/api/saves/{int(save['id'])}/content", step="save-content")
                    if len(data) > MAX_SAVE_BYTES:
                        data = None
                shapes.append(shape_of(save, data))
                data = None
            slots = {}
            for shape in shapes:
                key = "null" if shape["slot"] is None else str(shape["slot"])
                slots[key] = slots.get(key, 0) + 1
            games.append({"game": len(games) + 1, "saves": shapes, "savesPerSlot": slots})
        systems.append({"platform": platform.get("slug"), "gamesWithArgosySaves": len(roms), "games": games})
    return {"schema": SCHEMA, "argosyDevices": len(argosy), "systems": systems}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("report")
    run.add_argument("--home", required=True)
    run.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    base, token = find_signin(args.home)
    if not token:
        print(json.dumps({"reason": NO_CREDENTIALS}))
        return EXIT_SKIPPED
    try:
        document = report(base, token)
        code = 0
    except ReadError as error:
        document = {"schema": SCHEMA, "error": {"step": error.step, "status": error.status}}
        code = 1
    partial = args.out + ".partial"
    with open(partial, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
    os.replace(partial, args.out)
    return code


if __name__ == "__main__":
    sys.exit(main())
