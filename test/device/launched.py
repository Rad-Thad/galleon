#!/usr/bin/env python3
"""Who launch.sh started, kept so a later run.sh --cleanup can stop exactly
those processes and nothing else (docs/PLAN.md section 5.3, step 9).

Steam starts the shortcut, so the app is not in the process group the bridge
stops when run.sh overruns, and may outlive a killed run. A pid alone is not
enough to stop it later: after a reboot, or once the app has gone, the same
number can belong to anyone. `record` writes, beside launch.sh's pid file,
the boot id and the process's start time; `stop` signals a recorded pid only
while both still match.

`run` is where launch.sh hands over: it starts the app, records it, passes a
stop on to it alone, and writes the app's exit. A shell cannot do the last
part reliably: a trapped signal interrupts its `wait`, and a shell that reaps
the app meanwhile may no longer report the app's status, leaving only the
stop's own.

  launched.py record --state DIR --name NAME --pid PID
  launched.py run --state DIR -- APPIMAGE   exit with the app's exit
  launched.py stop --state DIR    exit 0 when nothing recorded is left running
"""

import argparse
import os
import signal
import subprocess
import sys
import time

# What Steam, or run.sh at the end of the budget, stops the shortcut with.
STOP_SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
# The app goes first, since launch.sh passes its own stop on to the app.
NAMES = ("app", "launch")
# How long each signal is given before the next, and how often to look.
STOP_WAIT_SECONDS = 10
POLL_SECONDS = 0.2
BOOT_ID = "/proc/sys/kernel/random/boot_id"


def _read(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def identity(pid):
    """The boot id and the kernel's start time of `pid`, or None once it has gone."""
    boot = _read(BOOT_ID)
    stat = _read(f"/proc/{pid}/stat")
    if boot is None or stat is None:
        return None
    # The command name sits in parentheses and may hold anything, spaces and
    # parentheses included, so the fields are counted from the last one.
    fields = stat.rpartition(")")[2].split()
    # Field 22 of proc(5), the third after the name being field 3.
    if len(fields) < 20 or fields[0] == "Z":
        return None
    return f"{boot.strip()} {fields[19]}"


def _pid(state, name):
    text = _read(os.path.join(state, f"{name}.pid"))
    line = (text or "").split("\n", 1)[0]
    return int(line) if line.isascii() and line.isdigit() and int(line) > 1 else None


def record(state, name, pid):
    found = identity(pid)
    if found is None:
        return 1
    _write(os.path.join(state, f"{name}.id"), f"{pid} {found}\n")
    return 0


def recorded(state, name):
    """The pid launch.sh recorded under `name`, while it is still that process."""
    pid = _pid(state, name)
    kept = _read(os.path.join(state, f"{name}.id"))
    if pid is None or kept is None:
        return None
    now = identity(pid)
    return pid if now is not None and kept.strip() == f"{pid} {now}" else None


def _write(path, text):
    tmp = f"{path}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(tmp, path)


def run(state, argv):
    """Start `argv` as the app and wait for it; its exit as a shell gives it."""
    app = None
    reaped = False
    stopped = []

    # Set before the start, so a stop that arrives while it starts is kept.
    # Until the app is reaped its pid is still its own, even once it has gone.
    def stop_app(signum, frame):
        stopped.append(signum)
        if app is not None and not reaped:
            try:
                os.kill(app.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    for sig in STOP_SIGNALS:
        signal.signal(sig, stop_app)
    try:
        with open(os.path.join(state, "app.log"), "wb") as log:
            app = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log,
                                   stderr=subprocess.STDOUT)
    except OSError as error:
        code = 126 if isinstance(error, PermissionError) else 127
        _write(os.path.join(state, "exit"), f"{code}\n")
        return code
    try:
        record(state, "app", app.pid)
        _write(os.path.join(state, "app.pid"), f"{app.pid}\n")
    except OSError:
        pass
    if stopped:
        stop_app(stopped[0], None)
    # Waited for without reaping, so a stop in the meantime cannot reach a
    # process given the same pid later; a stop's handler does not end the wait
    # (PEP 475). Stops are held off while it is reaped.
    os.waitid(os.P_PID, app.pid, os.WEXITED | os.WNOWAIT)
    signal.pthread_sigmask(signal.SIG_BLOCK, STOP_SIGNALS)
    code = app.wait()
    reaped = True
    code = 128 - code if code < 0 else code
    _write(os.path.join(state, "exit"), f"{code}\n")
    return code


def _gone_by(state, deadline):
    while any(recorded(state, name) for name in NAMES):
        if time.monotonic() >= deadline:
            return False
        time.sleep(POLL_SECONDS)
    return True


def stop(state, wait=STOP_WAIT_SECONDS):
    if not os.path.isdir(state) or os.path.islink(state):
        return 0
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for name in NAMES:
            pid = recorded(state, name)
            if pid is not None:
                print(f"{name}: {sig.name} to {pid}", file=sys.stderr)
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        if _gone_by(state, time.monotonic() + wait):
            return 0
    return 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = parser.add_subparsers(dest="command", required=True)
    rec = sub.add_parser("record")
    rec.add_argument("--state", required=True)
    rec.add_argument("--name", required=True, choices=NAMES)
    rec.add_argument("--pid", required=True, type=int)
    rn = sub.add_parser("run")
    rn.add_argument("--state", required=True)
    rn.add_argument("app", nargs=argparse.REMAINDER)
    stp = sub.add_parser("stop")
    stp.add_argument("--state", required=True)
    args = parser.parse_args(argv)
    if args.command == "record":
        return record(args.state, args.name, args.pid)
    if args.command == "run":
        app = args.app[1:] if args.app[:1] == ["--"] else args.app
        if not app:
            parser.error("run needs the app to start")
        return run(args.state, app)
    return stop(args.state)


if __name__ == "__main__":
    sys.exit(main())
