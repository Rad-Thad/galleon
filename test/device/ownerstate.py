#!/usr/bin/env python3
"""The owner-state manifest a device run is held to (docs/PLAN.md section 5.3).

run.sh takes a snapshot of everything the run must not change before it starts
anything and another after, and `safety.owner-state` passes only when the two
are equal. It also backs up the emulator config files first and puts back any
that changed; a restored file still fails the check, so run.sh takes the
second snapshot before restoring, and treats a non-empty restore as a failure
too.

What is covered is data, in owner-state.json beside this file, so that
nothing here names an emulator. Every walk is by lstat: a link is recorded as
its target and never followed, so a link inside a covered folder cannot make
the manifest read, or the restore write, anything outside it. A covered root
that is itself a link is the exception: it is read through, never written.

  ownerstate.py snapshot OUT
  ownerstate.py compare BEFORE AFTER     exit 1 when they differ
  ownerstate.py backup DEST
  ownerstate.py restore DEST             exit 1 when anything was restored

HOME is the owner's home; `--home` overrides it (tests).
"""

import argparse
import glob
import hashlib
import json
import os
import shutil
import stat
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC_PATH = os.path.join(HERE, "owner-state.json")

# Larger files are compared by size and modification time only, so a big
# memory card or disc image in a covered folder cannot eat the run's budget.
HASH_LIMIT = 64 * 1024 * 1024

BACKUP_INDEX = "index.json"


def load_spec(path=SPEC_PATH):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _pointer_target(path):
    """The folder a one-line root pointer names, or None."""
    try:
        with open(path, encoding="utf-8") as handle:
            target = handle.readline().strip()
    except (OSError, UnicodeDecodeError):
        return None
    return target if os.path.isabs(target) else None


def covered_roots(home, spec):
    """Every absolute path the manifest walks, sorted and without repeats."""
    roots = {os.path.join(home, rel) for rel in spec.get("folders", [])}
    for pointer in spec.get("pointers", []):
        target = _pointer_target(os.path.join(home, pointer["file"]))
        if target:
            roots.update(os.path.join(target, sub) for sub in pointer["folders"])
    for pattern in spec.get("globs", []):
        # A glob stays inside the home: its pattern is relative to it, and a
        # match is walked, never followed, like any other root.
        roots.update(glob.glob(os.path.join(glob.escape(home), pattern)))
    return sorted(os.path.normpath(root) for root in roots)


def _key(home, path):
    rel = os.path.relpath(path, home)
    return path if rel == os.pardir or rel.startswith(os.pardir + os.sep) else rel


def _entry(path, info):
    if stat.S_ISLNK(info.st_mode):
        try:
            return {"type": "link", "target": os.readlink(path)}
        except OSError:
            return {"type": "unreadable"}
    if stat.S_ISDIR(info.st_mode):
        return {"type": "dir"}
    if not stat.S_ISREG(info.st_mode):
        return {"type": "other"}
    entry = {"type": "file", "size": info.st_size, "mtime": info.st_mtime_ns}
    if info.st_size <= HASH_LIMIT:
        try:
            entry["sha256"] = _sha256(path)
        except OSError:
            entry["sha256"] = None
    return entry


def _walk(home, path, out, root=False):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    except OSError:
        out[_key(home, path)] = {"type": "unreadable"}
        return
    out[_key(home, path)] = _entry(path, info)
    # A covered root that is itself a link (a saves folder moved to the SD
    # card) is the owner's data all the same: its contents are walked through
    # it. Links below a root are never followed.
    if root and stat.S_ISLNK(info.st_mode):
        if not os.path.isdir(path):
            return
    elif not stat.S_ISDIR(info.st_mode):
        return
    try:
        names = sorted(os.listdir(path))
    except OSError:
        out[_key(home, path)] = {"type": "unreadable"}
        return
    for name in names:
        _walk(home, os.path.join(path, name), out)


def snapshot(home, spec):
    """{key: entry} for every path under the covered roots that exists now."""
    files = {}
    for root in covered_roots(home, spec):
        _walk(home, root, files, root=True)
    return {"schema": 1, "files": files}


def compare(before, after):
    """The paths that differ, each with how: added, removed or changed."""
    old, new = before["files"], after["files"]
    changes = []
    for key in sorted(set(old) | set(new)):
        if key not in new:
            changes.append({"path": key, "change": "removed"})
        elif key not in old:
            changes.append({"path": key, "change": "added"})
        elif old[key] != new[key]:
            changes.append({"path": key, "change": "changed"})
    return changes


def _regular_file(path):
    try:
        return stat.S_ISREG(os.lstat(path).st_mode)
    except OSError:
        return False


def _no_links_below(home, path):
    """True when no part of path below home, itself included, is a link."""
    current = home
    for part in os.path.relpath(path, home).split(os.sep):
        current = os.path.join(current, part)
        if os.path.islink(current):
            return False
    return True


def backup(home, spec, dest):
    """Copy each emulator config file that exists into dest, with an index."""
    os.makedirs(dest, exist_ok=True)
    index = {}
    for number, rel in enumerate(spec.get("configs", [])):
        source = os.path.join(home, rel)
        if not _regular_file(source):
            continue
        name = f"{number}.bak"
        shutil.copy2(source, os.path.join(dest, name))
        index[rel] = {"name": name, "sha256": _sha256(source)}
    _write_json(os.path.join(dest, BACKUP_INDEX), index)
    return sorted(index)


def restore(home, dest):
    """Put back every backed-up config that changed or went; the paths restored.

    A config that is now a link, or sits below one, is left alone and
    reported: writing through it could reach a file outside the covered
    folders.
    """
    try:
        with open(os.path.join(dest, BACKUP_INDEX), encoding="utf-8") as handle:
            index = json.load(handle)
    except FileNotFoundError:
        return []
    restored = []
    for rel, saved in sorted(index.items()):
        # The index sits in the test folder; a key it could not have written
        # is never a path to write to.
        if os.path.isabs(rel) or os.pardir in rel.split(os.sep):
            continue
        target = os.path.join(home, rel)
        if _regular_file(target) and _sha256(target) == saved["sha256"]:
            continue
        restored.append(rel)
        if not _no_links_below(home, target):
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=os.path.dirname(target), prefix=".ownerstate-")
        os.close(handle)
        try:
            shutil.copy2(os.path.join(dest, saved["name"]), temporary)
            os.replace(temporary, target)
        except BaseException:
            if os.path.exists(temporary):
                os.unlink(temporary)
            raise
    return restored


def _write_json(path, value):
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=1, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--home", default=os.path.expanduser("~"))
    parser.add_argument("--spec", default=SPEC_PATH)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("snapshot").add_argument("out")
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("before")
    compare_parser.add_argument("after")
    compare_parser.add_argument("--out")
    commands.add_parser("backup").add_argument("dest")
    commands.add_parser("restore").add_argument("dest")
    args = parser.parse_args(argv)
    home = os.path.abspath(args.home)

    if args.command == "snapshot":
        _write_json(args.out, snapshot(home, load_spec(args.spec)))
        return 0
    if args.command == "compare":
        with open(args.before, encoding="utf-8") as handle:
            before = json.load(handle)
        with open(args.after, encoding="utf-8") as handle:
            after = json.load(handle)
        changes = compare(before, after)
        if args.out:
            _write_json(args.out, {"changes": changes})
        for change in changes:
            print(f"{change['change']}: {change['path']}")
        return 1 if changes else 0
    if args.command == "backup":
        backup(home, load_spec(args.spec), args.dest)
        return 0
    restored = restore(home, args.dest)
    for rel in restored:
        print(f"restored: {rel}")
    return 1 if restored else 0


if __name__ == "__main__":
    sys.exit(main())
