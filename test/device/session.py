#!/usr/bin/env python3
"""The desktop session run.sh works in, and the checks it repeats before
touching anything (docs/PLAN.md section 5.3, step 1).

The bridge runs from a systemd user timer, so run.sh starts without the
variables that reach Steam, the compositor and the audio server. `env` finds
them in the user manager's environment, or else in the environment of this
user's own `steam` process, and prints them as shell assignments for run.sh
to evaluate. `check` repeats the bridge's Game Mode, idle and free-space
checks, because the owner may pick the device up while the build downloads.

  session.py env                  prints `export KEY='value'` lines
  session.py check --test-root R  prints `ready`, or a reason and exits 10

Tests point GALLEON_FACTS_ROOT at a fake root whose proc/ stands in for
/proc, as run.sh does for the power files. The rules for "Game Mode" and
"playing" are the bridge's own, imported from
its copy in the bundle, so the two can never disagree.
"""

import argparse
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
# The bundle carries the bridge in bridge/; the repository keeps it in tools/.
for candidate in (os.path.join(HERE, "bridge"),
                  os.path.join(HERE, "..", "..", "tools", "device-bridge")):
    if os.path.isfile(os.path.join(candidate, "galleon_device_bridge.py")):
        sys.path.insert(0, os.path.abspath(candidate))
        break
import galleon_device_bridge as bridge  # noqa: E402

KEYS = ("DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR",
        "GAMESCOPE_WAYLAND_DISPLAY")
STEAM_COMM = "steam"
EXIT_SKIPPED = 10
# Less than the bridge asks for before it downloads: by now the AppImage and
# the bundle are on disk, and what is left only has to hold the test home.
MIN_FREE_MB = 1024


def _parse(lines):
    found = {}
    for line in lines:
        key, sep, value = line.partition("=")
        # systemd writes values it had to escape as $'...'; none of these
        # variables needs that, so such a value is not trusted.
        if sep and key in KEYS and value and not value.startswith("$'") and "\n" not in value:
            found[key] = value
    return found


def from_manager():
    result = bridge.run_quiet(["systemctl", "--user", "show-environment"], timeout=10)
    if result is None or result.returncode != 0:
        return {}
    return _parse(result.stdout.splitlines())


def from_steam(proc=Path("/proc"), uid=None):
    """The environment of this user's `steam` process, found by its exact name."""
    uid = os.getuid() if uid is None else uid
    pids = bridge.running_processes(proc).get(STEAM_COMM, [])
    for pid in sorted(pids):
        entry = proc / str(pid)
        try:
            if entry.stat().st_uid != uid:
                continue
            raw = (entry / "environ").read_bytes()
        except OSError:
            continue
        found = _parse(raw.decode("utf-8", "replace").split("\0"))
        if found:
            return found
    return {}


def session_env(proc=Path("/proc"), uid=None):
    found = from_steam(proc, uid)
    found.update(from_manager())
    return {key: found[key] for key in KEYS if key in found}


def check(test_root, cfg=None, processes=None, idle=None, free=None):
    """(True, 'ready') or (False, reason), in the bridge's order."""
    cfg = bridge.load_config() if cfg is None else cfg
    proc = Path(os.environ.get("GALLEON_FACTS_ROOT", "") + "/proc")
    processes = bridge.running_processes(proc) if processes is None else processes
    ok, why = bridge.session_active(cfg["SESSION_UNIT"], cfg["SESSION_PROCESSES"].split(),
                                    processes)
    if not ok:
        return False, why
    idle = bridge.galleon_idle_state() if idle is None else idle
    busy = bridge.busy_names(cfg["BUSY_PROCESSES"].split(), processes, idle or None, proc)
    if busy:
        return False, f"busy: {', '.join(busy)} running"
    if free is None:
        free = shutil.disk_usage(test_root).free // (1024 * 1024)
    if free < MIN_FREE_MB:
        return False, f"only {free} MB free"
    return True, "ready"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("env")
    checking = sub.add_parser("check")
    checking.add_argument("--test-root", required=True)
    args = parser.parse_args(argv)
    if args.command == "env":
        for key, value in session_env().items():
            print(f"export {key}={shlex.quote(value)}")
        return 0
    ok, why = check(args.test_root)
    print(why)
    return 0 if ok else EXIT_SKIPPED


if __name__ == "__main__":
    sys.exit(main())
