#!/usr/bin/env python3
"""The power profile for a device run, switched only when the app asks and put back after (docs/PLAN.md section 5.3, steps 8, 9 and 11).

The self-test measures the grid on each power profile (`grid.scroll@<profile>`),
but the app may not switch Armada's profile itself: the owner's profile has to
come back afterwards, and only the harness is there to do it. So run.sh
records the profile in force before the start, answers the app's requests
through the handshake folder (docs/TESTING.md, "Profile handshake"), and puts
the recorded profile back once the app has gone.

  powerprofile.py record --state FILE
      records the profile in force; a record already there is kept
  powerprofile.py answer --state FILE --handshake DIR --allow NAME ...
      answers one `want-profile`: switches with `armada-power profile NAME`,
      waits until it is in force, and writes `profile-set` with the name, or
      `unchanged:<current>` when it did not switch
  powerprofile.py restore --state FILE
      puts the recorded profile back and removes FILE; nothing to do without FILE

Nothing is switched without a record to put back, so a run whose record could
not be taken answers every request `unchanged`. The record lives where
`run.sh --cleanup` finds it, so a stopped run's switch is undone too, and a
record found already there is kept: it holds the owner's profile, and the one
in force may be the stopped run's.

The profile in force is the one `armada-power profile` names, matched to its
name through the profile definitions, and, where the definition names a CPU
governor, policy7's governor in sysfs agreeing: the daemon answers before the
clocks have followed, and the app's numbers are taken on the clocks.

Exits ERROR_EXIT when the profile cannot be read or put back.
"""

import argparse
import configparser
import json
import os
import re
import stat
import subprocess
import sys
import time

ERROR_EXIT = 3
# A hung armada-powerd must not hold up the run.
TIMEOUT_SECONDS = 10
# How long a switch has to show in the governor before it counts as not done,
# kept short of the app's own wait (PROFILE_WAIT_MS) while the daemon answers.
# A hung daemon can make an answer late; the app reads the profile in force
# afterwards, so a late answer never files numbers under the wrong profile.
SETTLE_SECONDS = 10
POLL_SECONDS = 0.5

WANT_PROFILE = "want-profile"
PROFILE_SET = "profile-set"
# Larger than any name; a larger request is not one the app wrote.
MAX_REQUEST_BYTES = 64

NAME = re.compile(r"[a-z][a-z0-9_-]{0,31}")
# An edited copy in /etc wins over the factory file, as armada-powerd reads them.
CONF_PATHS = ("/etc/armada/power-profiles.conf", "/usr/share/armada/power-profiles.conf")
GOVERNOR = "/sys/devices/system/cpu/cpufreq/policy7/scaling_governor"


class ProfileError(RuntimeError):
    pass


class Power:
    """Armada's power profiles as the harness sees them; `root` prefixes every file, for tests."""

    def __init__(self, armada_power="armada-power", root=""):
        self.armada_power = armada_power
        self.root = root

    def _run(self, *args):
        try:
            done = subprocess.run([self.armada_power, *args], capture_output=True, text=True,
                                  timeout=TIMEOUT_SECONDS)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ProfileError(f"armada-power {' '.join(args)}: {error}") from error
        if done.returncode != 0:
            raise ProfileError(f"armada-power {' '.join(args)} exited {done.returncode}")
        return done.stdout

    def definitions(self):
        """{name: {"label", "governor"}} from the first profile definitions that read."""
        for path in CONF_PATHS:
            parser = configparser.ConfigParser(interpolation=None, strict=False)
            try:
                with open(self.root + path, encoding="utf-8") as handle:
                    parser.read_file(handle)
            except (OSError, UnicodeDecodeError, configparser.Error):
                continue
            found = {}
            for section in parser.sections():
                if section.startswith("profile."):
                    found[section[len("profile."):]] = {
                        "label": parser.get(section, "label", fallback=""),
                        "governor": parser.get(section, "cpu_governor", fallback=""),
                    }
            if found:
                return found
        return {}

    def current(self):
        """The name of the profile `armada-power profile` names, or None when it names none."""
        label = self._run("profile").strip()
        for name, definition in self.definitions().items():
            if definition["label"] and definition["label"].lower() == label.lower():
                return name
        return label.lower() if NAME.fullmatch(label.lower()) else None

    def governor(self):
        try:
            with open(self.root + GOVERNOR, encoding="utf-8") as handle:
                return handle.read().strip()
        except OSError:
            return None

    def in_force(self, name):
        if self.current() != name:
            return False
        wanted = self.definitions().get(name, {}).get("governor")
        return not wanted or self.governor() in (None, wanted)

    def switch(self, name):
        """Switch to `name`; whether it is in force within SETTLE_SECONDS."""
        self._run("profile", name)
        until = time.monotonic() + SETTLE_SECONDS
        while True:
            if self.in_force(name):
                return True
            if time.monotonic() >= until:
                return False
            time.sleep(POLL_SECONDS)


def _read(state_file):
    with open(state_file, encoding="utf-8") as handle:
        record = json.load(handle)
    if not (isinstance(record, dict) and isinstance(record.get("profile"), str)
            and NAME.fullmatch(record["profile"])):
        raise ProfileError("the profile record is not one this wrote")
    return record


def _write(path, text):
    """`text` into `path` whole, never through a link left there."""
    temporary = f"{path}.tmp"
    if os.path.lexists(temporary):
        os.unlink(temporary)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(temporary, path)


def record(power, state_file):
    """The record of the profile to put back, kept or new."""
    if os.path.lexists(state_file):
        return _read(state_file)
    name = power.current()
    if name is None:
        raise ProfileError("armada-power names no profile")
    kept = {"profile": name}
    _write(state_file, json.dumps(kept))
    return kept


def _request(handshake):
    """The name the app asked for, "" for a request that is not one, or None for none."""
    path = os.path.join(handshake, WANT_PROFILE)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    except OSError:
        return ""
    with os.fdopen(fd, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            return ""
        data = handle.read(MAX_REQUEST_BYTES + 1)
    try:
        name = data.decode("utf-8").strip()
    except UnicodeDecodeError:
        return ""
    return name if len(data) <= MAX_REQUEST_BYTES and NAME.fullmatch(name) else ""


def answer(power, state_file, handshake, allowed):
    """Answer a pending request; what was answered, or None when there was nothing to."""
    if os.path.islink(handshake) or not os.path.isdir(handshake):
        raise ProfileError("the handshake folder is not a folder")
    # The app removes the answer before it asks, and both files once it has
    # read the answer, so an answer still there is to the request still there.
    if os.path.lexists(os.path.join(handshake, PROFILE_SET)):
        return None
    name = _request(handshake)
    if name is None:
        return None
    switched = False
    if name in allowed and os.path.lexists(state_file):
        try:
            # A record that does not read is not one to switch away from.
            _read(state_file)
            switched = power.in_force(name) or power.switch(name)
        except (ProfileError, OSError, ValueError) as error:
            print(f"powerprofile.py: {error}", file=sys.stderr)
    if switched:
        said = name
    else:
        try:
            said = f"unchanged:{power.current() or 'unknown'}"
        except ProfileError:
            said = "unchanged:unknown"
    _write(os.path.join(handshake, PROFILE_SET), said + "\n")
    return said


def restore(power, state_file):
    """Put the recorded profile back; the record, or None when there was none."""
    if not os.path.lexists(state_file):
        return None
    kept = _read(state_file)
    # A run that never switched asks the daemon for nothing that changes it.
    if not power.in_force(kept["profile"]) and not power.switch(kept["profile"]):
        raise ProfileError(f"{kept['profile']} is not in force after the switch back")
    os.unlink(state_file)
    return kept


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--armada-power", default="armada-power")
    parser.add_argument("--root", default=os.environ.get("GALLEON_FACTS_ROOT", ""))
    parser.add_argument("command", choices=("record", "answer", "restore"))
    parser.add_argument("--state", required=True)
    parser.add_argument("--handshake")
    parser.add_argument("--allow", action="append", default=[])
    args = parser.parse_args(argv)
    power = Power(args.armada_power, args.root)
    try:
        if args.command == "record":
            print(f"recorded profile {record(power, args.state)['profile']}")
        elif args.command == "answer":
            if not args.handshake:
                parser.error("answer needs --handshake")
            said = answer(power, args.state, args.handshake, set(args.allow))
            print(f"profile request answered {said}" if said else "no profile request")
        else:
            kept = restore(power, args.state)
            print(f"restored profile {kept['profile']}" if kept else "nothing to restore")
    except (ProfileError, OSError, ValueError) as error:
        print(f"powerprofile.py: {error}", file=sys.stderr)
        return ERROR_EXIT
    return 0


if __name__ == "__main__":
    sys.exit(main())
