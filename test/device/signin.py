#!/usr/bin/env python3
"""The test home and its read-only sign-in import (docs/PLAN.md section 5.3, steps 3 and 4).

run.sh gives the app under test a home of its own, recreated empty each run,
and copies into it the one sign-in it can find, without changing where it
came from. In order: the bridge's read-only token (from `pair-readonly`), the
owner's Galleon, stock RomMix. Only an access or client token travels: the
refresh token stays behind, because refreshing would rotate the owner's own
sign-in, and so does the device id, because nothing in a test may act as the
owner's device. Save sync goes off both ways in the test home.

  signin.py prepare --test-dir DIR [--token-file FILE]

prints one JSON line naming the source by kind, never a value, and exits 0
with a sign-in, or 10 with reason `no-importable-credentials`, the code run.sh
uses for a skip. The test home is made either way.

HOME is the owner's home; `--home` overrides it (tests).
"""

import argparse
import json
import os
import shutil
import sys

NO_CREDENTIALS = "no-importable-credentials"
EXIT_SKIPPED = 10

RAW = b"RAW1"
ENCRYPTED = b"ENC1"

# The apps whose stored sign-in can be imported, most specific first. Each
# keeps `config/settings.json` and `config/credentials.bin` under a root found
# through its pointer file or else its default folder (see src/main/root.ts).
APPS = ("galleon", "rommix")

# Only stock RomMix's variable is followed: GALLEON_HOME is the test home's
# own, set by run.sh for the app under test.
ROOT_VARIABLES = {"rommix": "ROMMIX_HOME"}

TOKEN_KEYS = ("clientToken", "accessToken")


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def _app_root(home, app, environ):
    variable = ROOT_VARIABLES.get(app)
    if variable and environ.get(variable, "").strip():
        return environ[variable].strip()
    try:
        with open(os.path.join(home, ".config", app, "root"), encoding="utf-8") as handle:
            pointer = handle.readline().strip()
    except (OSError, UnicodeDecodeError):
        pointer = ""
    return pointer if os.path.isabs(pointer) else os.path.join(home, app)


def _server(settings):
    server = settings.get("server") if isinstance(settings, dict) else None
    if not isinstance(server, dict) or not isinstance(server.get("baseUrl"), str):
        return None
    kept = {"baseUrl": server["baseUrl"], "authMode": server.get("authMode", "token")}
    if isinstance(server.get("username"), str):
        kept["username"] = server["username"]
    return kept


def _tokens(stored):
    if not isinstance(stored, dict):
        return None
    tokens = {key: stored[key] for key in TOKEN_KEYS if isinstance(stored.get(key), str) and stored[key]}
    if not tokens:
        return None
    return {"clientToken": tokens.get("clientToken"), "accessToken": tokens.get("accessToken"),
            "refreshToken": None, "deviceId": None}


def find_signin(home, token_file=None, environ=None):
    """(source, server, credentials) for the first importable sign-in, else (None, None, None).

    `source` names the kind only. An encrypted store is passed over: only the
    owner's keyring could open it.
    """
    environ = os.environ if environ is None else environ
    if token_file:
        paired = _read_json(token_file)
        if isinstance(paired, dict) and isinstance(paired.get("baseUrl"), str) \
                and isinstance(paired.get("token"), str) and paired["token"]:
            return ("bridge-readonly-token",
                    {"baseUrl": paired["baseUrl"], "authMode": "device"},
                    {"clientToken": paired["token"], "accessToken": None,
                     "refreshToken": None, "deviceId": None})
    for app in APPS:
        config = os.path.join(_app_root(home, app, environ), "config")
        server = _server(_read_json(os.path.join(config, "settings.json")))
        try:
            with open(os.path.join(config, "credentials.bin"), "rb") as handle:
                stored = handle.read()
        except OSError:
            continue
        if server is None or stored[:4] != RAW:
            continue
        try:
            credentials = _tokens(json.loads(stored[4:].decode("utf-8")))
        except (UnicodeDecodeError, ValueError):
            continue
        if credentials:
            return (app, server, credentials)
    return (None, None, None)


def fresh_home(test_dir):
    """`<test_dir>/home`, emptied and made again.

    Only that one folder is removed, and never through a link: a test folder
    whose `home` was replaced by a link to anywhere else is refused.
    """
    home = os.path.join(test_dir, "home")
    if os.path.islink(home):
        raise RuntimeError("the test home is a link; refusing to clear it")
    if os.path.exists(home):
        shutil.rmtree(home)
    os.makedirs(os.path.join(home, "config"))
    return home


def write_test_home(test_home, server, credentials):
    """Settings for a test, and the imported sign-in when there is one."""
    config = os.path.join(test_home, "config")
    os.makedirs(config, exist_ok=True)
    document = {
        "settings": {
            "syncSavesDown": False,
            "syncSavesUp": False,
            # Empty rather than absent: an absent id is generated afresh, and a
            # test has no device of its own to name.
            "deviceId": "",
            "setupComplete": True,
        }
    }
    if server:
        document["server"] = server
    with open(os.path.join(config, "settings.json"), "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
    if credentials:
        path = os.path.join(config, "credentials.bin")
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(RAW + json.dumps(credentials).encode("utf-8"))


def main(argv=None, environ=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--home", default=os.path.expanduser("~"))
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--test-dir", required=True)
    prepare.add_argument("--token-file")
    args = parser.parse_args(argv)

    source, server, credentials = find_signin(os.path.abspath(args.home), args.token_file, environ)
    test_home = fresh_home(os.path.abspath(args.test_dir))
    write_test_home(test_home, server, credentials)
    print(json.dumps({"home": test_home, "source": source,
                      "reason": None if source else NO_CREDENTIALS}))
    return 0 if source else EXIT_SKIPPED


if __name__ == "__main__":
    sys.exit(main())
