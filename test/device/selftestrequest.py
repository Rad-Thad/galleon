#!/usr/bin/env python3
"""The self-test request run.sh gives the app (docs/PLAN.md section 5.3, step 7).

The app under test reads `$GALLEON_HOME/self-test-request.json` at start
(src/main/selftest.ts, `takeRequest`; schema in docs/TESTING.md) and runs the
checks it names. This writes it, refusing anything the app would refuse, and
a few things it would take that no sound harness asks for, so a mistake in
run.sh shows up in the harness log rather than as a run the app turned down
or ran wrong. The read-only server, privacy and the abort on input are always
asked for: they are what keep a device run from leaving a trace.

  selftestrequest.py write --home H --sha S [--version V] --budget SECONDS
      [--deadline EPOCH_SECONDS] --results D [--handshake D] --check ID ... [--profile NAME ...]
      [--payload EMULATOR=PATH ...] [--saving EMULATOR ...] [--screenshot NAME ...]
      [--steam-target GAMEID]
  selftestrequest.py remove --home H    the request and the app's taken copy

Exits ERROR_EXIT when the request cannot be written or would be refused.
"""

import argparse
import json
import os
import re
import sys
import time

NAME = "self-test-request.json"
# The app renames the request to this once it has taken it.
TAKEN = "self-test-request.taken.json"
ERROR_EXIT = 3

# The same patterns the app holds the request to (selftest.ts, SHA and VERSION).
SHA = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"[0-9A-Za-z][0-9A-Za-z.+-]{0,63}")


class RequestError(ValueError):
    pass


def request(sha, version, budget, results, handshake, checks, profiles, payloads, saving, screenshots,
            deadline=None, steam_target=None):
    """The request as the app expects it, or RequestError naming what is wrong.

    `deadline` is when the app's run must end, in seconds since the epoch; the
    app writes its summary by whichever comes first of it and the budget.
    """
    if not SHA.fullmatch(sha):
        raise RequestError("the sha is not a full commit")
    if version is not None and not VERSION.fullmatch(version):
        raise RequestError("the version is not a plain version string")
    if budget <= 0:
        raise RequestError("the budget is not positive")
    if deadline is not None and deadline <= 0:
        raise RequestError("the deadline is not a time")
    for name, folder in (("results", results), ("handshake", handshake)):
        if folder is not None and (not os.path.isabs(folder) or "\0" in folder):
            raise RequestError(f"the {name} folder is not an absolute path")
    if not checks:
        raise RequestError("no checks requested")
    # The app puts the game id into a steam:// URL and takes digits only.
    if steam_target is not None and not re.fullmatch(r"[0-9]+", steam_target):
        raise RequestError("the Steam target is not a game id")
    unknown = [emulator for emulator in saving if emulator not in payloads]
    if unknown:
        raise RequestError(f"saving payloads without a payload: {', '.join(unknown)}")
    record = {
        "schema": 1,
        "sha": sha,
        "budgetSeconds": budget,
        "resultsDir": results,
        "handshakeDir": handshake,
        "checks": list(checks),
        "profiles": list(profiles),
        "payloads": dict(payloads),
        "savingPayloads": list(saving),
        "fakeRomm": None,
        "readOnlyServer": True,
        "privacy": True,
        "abortOnInput": True,
        "screenshots": list(screenshots),
    }
    if version is not None:
        record["version"] = version
    if steam_target is not None:
        record["steamTarget"] = steam_target
    if deadline is not None:
        record["deadline"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(deadline))
    return record


def _real_folder(home):
    # The home is the run's own folder; a link there could point the request
    # into the owner's files.
    if os.path.islink(home) or not os.path.isdir(home):
        raise RequestError("the test home is not a folder")


def write(home, record):
    _real_folder(home)
    target = os.path.join(home, NAME)
    tmp = target + ".tmp"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
    os.replace(tmp, target)
    return target


def remove(home):
    if not os.path.lexists(home):
        return
    _real_folder(home)
    for name in (NAME, TAKEN):
        try:
            os.unlink(os.path.join(home, name))
        except FileNotFoundError:
            pass


def _payload(text):
    emulator, sep, path = text.partition("=")
    if not sep or not emulator or not path:
        raise argparse.ArgumentTypeError(f"not EMULATOR=PATH: {text}")
    return emulator, path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    put = commands.add_parser("write")
    put.add_argument("--sha", required=True)
    put.add_argument("--version")
    put.add_argument("--budget", type=int, required=True)
    put.add_argument("--deadline", type=int)
    put.add_argument("--results", required=True)
    put.add_argument("--handshake")
    put.add_argument("--check", action="append", default=[])
    put.add_argument("--profile", action="append", default=[])
    put.add_argument("--payload", action="append", default=[], type=_payload)
    put.add_argument("--saving", action="append", default=[])
    put.add_argument("--screenshot", action="append", default=[])
    put.add_argument("--steam-target")
    for command in (put, commands.add_parser("remove")):
        command.add_argument("--home", required=True)
    args = parser.parse_args(argv)

    try:
        if args.command == "remove":
            remove(args.home)
            return 0
        record = request(args.sha, args.version, args.budget, args.results, args.handshake,
                         args.check, args.profile, dict(args.payload), args.saving, args.screenshot,
                         args.deadline, args.steam_target)
        write(args.home, record)
    except (RequestError, OSError) as error:
        print(f"selftestrequest.py: {error}", file=sys.stderr)
        return ERROR_EXIT
    return 0


if __name__ == "__main__":
    sys.exit(main())
