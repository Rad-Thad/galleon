#!/usr/bin/env python3
"""The fake RomM on the Nova (M2-20), started and stopped for run.sh.

The device has no Node, so the fake (`fake-romm/fake-romm.cjs` in the bundle)
runs on the Electron inside the AppImage, in Node mode. `start` extracts the
AppImage into the state folder (`--appimage-extract` writes `squashfs-root`
into the folder it runs in), makes a fresh token, starts the fake on
127.0.0.1 and waits for its ready file, then prints `{"baseUrl": ...}`. The
token goes to `token` in the state folder, readable by the owner alone, and
reaches the fake through its environment, never its command line.

The pid is recorded with the boot id and its start time (launched.identity),
so `stop`, from the run's end or from a later `run.sh --cleanup`, signals it
only while it is still that process. `stop` then removes the state folder,
the extracted AppImage with it.

  fakeromm.py start --dir DIR --appimage PATH --program PATH --rom-ids 1,2
  fakeromm.py stop --dir DIR   exit 0 when nothing recorded is left running
"""

import argparse
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import time

import launched

# The Electron binary at the root of the extracted AppImage, named by
# electron-builder.yml's executableName.
ELECTRON = "galleon"
EXTRACT_SECONDS = 300
READY_SECONDS = 30
STOP_WAIT_SECONDS = 10
POLL_SECONDS = 0.1


def _write(path, text):
    tmp = f"{path}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(tmp, path)


def recorded(state):
    """The fake's pid while it is still the process `start` recorded."""
    try:
        with open(os.path.join(state, "fake-romm.id"), encoding="utf-8") as handle:
            kept = handle.read().strip()
    except OSError:
        return None
    pid = kept.split(" ", 1)[0]
    if not (pid.isascii() and pid.isdigit() and int(pid) > 1):
        return None
    now = launched.identity(int(pid))
    return int(pid) if now is not None and kept == f"{pid} {now}" else None


def _remove(state):
    # A link there could point the removal into the owner's files.
    if os.path.islink(state):
        os.remove(state)
    elif os.path.isdir(state):
        shutil.rmtree(state)


def stop(state, wait=STOP_WAIT_SECONDS):
    if not os.path.lexists(state):
        return 0
    for sig in (signal.SIGTERM, signal.SIGKILL):
        pid = recorded(state)
        if pid is None:
            break
        print(f"fake-romm: {sig.name} to {pid}", file=sys.stderr)
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + wait
        while recorded(state) is not None and time.monotonic() < deadline:
            time.sleep(POLL_SECONDS)
    if recorded(state) is not None:
        return 1
    _remove(state)
    return 0


def start(state, appimage, program, rom_ids, extract_wait=EXTRACT_SECONDS,
          ready_wait=READY_SECONDS):
    """The fake's base URL, or None with the reason on stderr and nothing left running."""
    _remove(state)
    os.makedirs(os.path.join(state, "scratch"))
    try:
        with open(os.path.join(state, "extract.log"), "wb") as log:
            subprocess.run([appimage, "--appimage-extract"], cwd=state, stdin=subprocess.DEVNULL,
                           stdout=log, stderr=subprocess.STDOUT, timeout=extract_wait,
                           check=True)
    except (OSError, subprocess.SubprocessError) as error:
        print(f"fake-romm: the AppImage could not be extracted: {type(error).__name__}",
              file=sys.stderr)
        return None
    electron = os.path.join(state, "squashfs-root", ELECTRON)
    if not os.access(electron, os.X_OK):
        print("fake-romm: the AppImage holds no Electron to run it", file=sys.stderr)
        return None
    token = secrets.token_hex(32)
    _write(os.path.join(state, "token"), f"{token}\n")
    ready = os.path.join(state, "ready.json")
    env = dict(os.environ, ELECTRON_RUN_AS_NODE="1", FAKE_ROMM_TOKEN=token)
    try:
        with open(os.path.join(state, "fake-romm.log"), "wb") as log:
            child = subprocess.Popen(
                [electron, program, "--rom-ids", rom_ids,
                 "--scratch", os.path.join(state, "scratch"), "--ready", ready],
                cwd=state, env=env, stdin=subprocess.DEVNULL, stdout=log,
                stderr=subprocess.STDOUT)
    except OSError as error:
        print(f"fake-romm: it could not be started: {type(error).__name__}", file=sys.stderr)
        return None
    found = launched.identity(child.pid)
    if found is not None:
        _write(os.path.join(state, "fake-romm.id"), f"{child.pid} {found}\n")
    deadline = time.monotonic() + ready_wait
    while not os.path.exists(ready):
        if child.poll() is not None or time.monotonic() >= deadline:
            break
        time.sleep(POLL_SECONDS)
    try:
        with open(ready, encoding="utf-8") as handle:
            said = json.load(handle)
    except (OSError, ValueError):
        said = None
    base_url = said.get("baseUrl") if isinstance(said, dict) else None
    if (found is None or not isinstance(base_url, str)
            or not base_url.startswith("http://127.0.0.1:") or said.get("pid") != child.pid):
        print("fake-romm: it did not say it was listening on 127.0.0.1", file=sys.stderr)
        if child.poll() is None:
            child.kill()
        child.wait()
        return None
    return base_url


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = parser.add_subparsers(dest="command", required=True)
    st = sub.add_parser("start")
    st.add_argument("--dir", required=True)
    st.add_argument("--appimage", required=True)
    st.add_argument("--program", required=True)
    st.add_argument("--rom-ids", required=True)
    sp = sub.add_parser("stop")
    sp.add_argument("--dir", required=True)
    args = parser.parse_args(argv)
    if args.command == "stop":
        return stop(args.dir)
    base_url = start(args.dir, os.path.abspath(args.appimage), os.path.abspath(args.program),
                     args.rom_ids)
    if base_url is None:
        return 1
    print(json.dumps({"baseUrl": base_url}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
