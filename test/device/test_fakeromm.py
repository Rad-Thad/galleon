"""Unit tests for fakeromm.py: python3 -m unittest discover -s test/device"""

import json
import os
import re
import stat
import tempfile
import time
import unittest

import fakeromm

HERE = os.path.dirname(os.path.abspath(__file__))

# Stands in for fake-romm.cjs: it keeps what it was given, says where it
# listens as the real one does, and stops on SIGTERM unless told to hold on.
PROGRAM = """import json, os, signal, sys, time
args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
seen = {"argv": sys.argv[1:], "node": os.environ.get("ELECTRON_RUN_AS_NODE"),
        "token": os.environ.get("FAKE_ROMM_TOKEN"), "cwd": os.getcwd()}
json.dump(seen, open(os.path.join(args["--scratch"], "seen.json"), "w"))
if os.environ.get("FAKE_HOLD") == "1":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
mode = os.environ.get("FAKE_MODE", "ok")
if mode == "exit":
    sys.exit(1)
if mode != "silent":
    url = "http://0.0.0.0:1" if mode == "wide" else "http://127.0.0.1:4567"
    pid = 1 if mode == "otherpid" else os.getpid()
    open(args["--ready"] + ".partial", "w").write(json.dumps({"baseUrl": url, "pid": pid}))
    os.rename(args["--ready"] + ".partial", args["--ready"])
while True:
    time.sleep(0.05)
"""


class FakeRommTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = os.path.join(self.tmp.name, "fake-romm")
        self.program = os.path.join(self.tmp.name, "fake-romm.cjs")
        with open(self.program, "w", encoding="utf-8") as handle:
            handle.write(PROGRAM)
        self.started = []
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.kill_started)

    def kill_started(self):
        for pid in self.started:
            try:
                os.kill(pid, 9)
            except ProcessLookupError:
                pass

    def appimage(self, electron=True):
        # An AppImage whose extraction holds an Electron that runs Python.
        path = os.path.join(self.tmp.name, "Galleon.AppImage")
        body = "#!/bin/sh\n[ \"$1\" = --appimage-extract ] || exit 2\nmkdir -p squashfs-root\n"
        if electron:
            body += ("printf '#!/bin/sh\\nexec python3 \"$@\"\\n' >squashfs-root/galleon\n"
                     "chmod 0755 squashfs-root/galleon\n")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(body)
        os.chmod(path, 0o755)
        return path

    def start(self, mode="ok", hold=False, **kwargs):
        os.environ["FAKE_MODE"] = mode
        os.environ["FAKE_HOLD"] = "1" if hold else "0"
        self.addCleanup(os.environ.pop, "FAKE_MODE", None)
        self.addCleanup(os.environ.pop, "FAKE_HOLD", None)
        url = fakeromm.start(self.state, kwargs.pop("appimage", None) or self.appimage(),
                             self.program, "3,7", ready_wait=kwargs.pop("ready_wait", 5))
        pid = fakeromm.recorded(self.state)
        if pid is not None:
            self.started.append(pid)
        return url, pid

    def seen(self):
        with open(os.path.join(self.state, "scratch", "seen.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def test_starts_on_loopback_with_a_token_kept_from_the_command_line(self):
        url, pid = self.start()
        self.assertEqual(url, "http://127.0.0.1:4567")
        self.assertIsNotNone(pid)
        seen = self.seen()
        with open(os.path.join(self.state, "token"), encoding="utf-8") as handle:
            token = handle.read().strip()
        self.assertRegex(token, r"^[0-9a-f]{64}$")
        self.assertEqual(seen["token"], token)
        self.assertEqual(seen["node"], "1")
        self.assertNotIn(token, " ".join(seen["argv"]))
        self.assertEqual(seen["argv"][:2], ["--rom-ids", "3,7"])
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.state, "token")).st_mode), 0o600)

    def test_a_fresh_token_each_start(self):
        self.start()
        first = self.seen()["token"]
        self.assertEqual(fakeromm.stop(self.state, wait=2), 0)
        self.start()
        self.assertNotEqual(self.seen()["token"], first)

    def test_stop_ends_it_and_removes_the_extracted_appimage(self):
        _, pid = self.start()
        self.assertEqual(fakeromm.stop(self.state, wait=2), 0)
        self.assertFalse(os.path.exists(self.state))
        self.assertIsNone(fakeromm.launched.identity(pid))

    def test_stop_kills_one_that_ignores_sigterm(self):
        _, pid = self.start(hold=True)
        self.assertEqual(fakeromm.stop(self.state, wait=1), 0)
        self.assertIsNone(fakeromm.launched.identity(pid))

    def test_stop_with_nothing_started_is_done(self):
        self.assertEqual(fakeromm.stop(self.state), 0)

    def test_a_pid_now_another_process_is_left_alone(self):
        _, pid = self.start()
        record = os.path.join(self.state, "fake-romm.id")
        with open(record, encoding="utf-8") as handle:
            kept = handle.read()
        with open(record, "w", encoding="utf-8") as handle:
            handle.write(re.sub(r" \d+\n$", " 1\n", kept))
        self.assertEqual(fakeromm.stop(self.state, wait=1), 0)
        self.assertIsNotNone(fakeromm.launched.identity(pid))

    def test_a_linked_state_folder_is_not_followed(self):
        target = os.path.join(self.tmp.name, "owner")
        os.mkdir(target)
        open(os.path.join(target, "keep"), "w").close()
        os.symlink(target, self.state)
        self.assertEqual(fakeromm.stop(self.state), 0)
        self.assertTrue(os.path.exists(os.path.join(target, "keep")))
        self.assertFalse(os.path.lexists(self.state))

    def test_refuses_what_does_not_listen_on_loopback_and_leaves_nothing_running(self):
        for mode in ("wide", "otherpid", "exit", "silent"):
            with self.subTest(mode=mode):
                url, pid = self.start(mode=mode, ready_wait=1)
                self.assertIsNone(url)
                if pid is not None:
                    deadline = time.monotonic() + 2
                    while fakeromm.launched.identity(pid) and time.monotonic() < deadline:
                        time.sleep(0.05)
                    self.assertIsNone(fakeromm.launched.identity(pid))
                self.assertEqual(fakeromm.stop(self.state), 0)

    def test_an_appimage_without_electron_starts_nothing(self):
        url, pid = self.start(appimage=self.appimage(electron=False))
        self.assertIsNone(url)
        self.assertIsNone(pid)

    def test_an_appimage_that_cannot_be_extracted_starts_nothing(self):
        url, pid = self.start(appimage=os.path.join(self.tmp.name, "missing.AppImage"))
        self.assertIsNone(url)
        self.assertIsNone(pid)

    def test_the_electron_name_is_the_one_the_appimage_is_built_with(self):
        with open(os.path.join(HERE, "..", "..", "electron-builder.yml"), encoding="utf-8") as handle:
            names = re.findall(r"^\s*executableName:\s*(\S+)\s*$", handle.read(), re.M)
        self.assertTrue(names)
        self.assertEqual(set(names), {fakeromm.ELECTRON})


if __name__ == "__main__":
    unittest.main()
