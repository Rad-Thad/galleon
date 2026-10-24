"""Unit tests for current.py and launch.sh: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest

import current
import launched

HERE = os.path.dirname(os.path.abspath(__file__))
SHA = "b" * 40

# A stand-in AppImage: it records what it was started with, and stays up
# until told to stop when asked to. Its sleep runs in the background so a
# stop is answered at once, as the app answers one.
FAKE_APP = """#!/bin/sh
echo "GALLEON_HOME=$GALLEON_HOME" >>"$GALLEON_HOME/started-with"
if [ -e "$GALLEON_HOME/stay" ]; then
  trap 'echo terminated >>"$GALLEON_HOME/started-with"; exit 0' TERM
  while :; do sleep 0.05 & wait $!; done
fi
exit 3
"""


class LaunchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "galleon-device-tests")
        self.home = os.path.join(self.root, SHA, "home")
        self.results = os.path.join(self.root, SHA, "results")
        os.makedirs(self.home)
        os.makedirs(self.results)
        # run.sh puts both beside each other in the test root.
        for name in ("launch.sh", "current.py", "launched.py"):
            shutil.copy2(os.path.join(HERE, name), self.root)
        self.appimage = os.path.join(self.root, SHA, "Galleon-arm64.AppImage")
        with open(self.appimage, "w", encoding="utf-8") as handle:
            handle.write(FAKE_APP)
        os.chmod(self.appimage, 0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def request(self, budget=600, **overrides):
        fields = dict(appimage=self.appimage, home=self.home, results=self.results, sha=SHA)
        fields.update(overrides)
        return current.write(self.root, budget=budget, **fields)

    def launch(self):
        return subprocess.run(["/bin/sh", os.path.join(self.root, "launch.sh")], capture_output=True,
                              text=True, timeout=30, env={"PATH": os.environ["PATH"]}, cwd="/")

    def started(self):
        try:
            with open(os.path.join(self.home, "started-with"), encoding="utf-8") as handle:
                return handle.read().splitlines()
        except FileNotFoundError:
            return []

    def test_without_a_request_the_shortcut_starts_nothing(self):
        self.assertEqual(self.launch().returncode, 0)
        self.assertEqual(self.started(), [])
        self.assertFalse(os.path.exists(os.path.join(self.home, "launch")))

    def test_an_expired_request_starts_nothing(self):
        self.request(budget=-1)
        self.assertEqual(self.launch().returncode, 0)
        self.assertEqual(self.started(), [])

    def test_a_current_request_starts_the_app_in_the_test_home(self):
        self.request()
        run = self.launch()
        self.assertEqual(run.returncode, 3)
        self.assertEqual(self.started(), [f"GALLEON_HOME={self.home}"])
        state = os.path.join(self.home, "launch")
        for name in ("launch.pid", "app.pid", "started", "app.log"):
            self.assertTrue(os.path.exists(os.path.join(state, name)), name)
        with open(os.path.join(state, "exit"), encoding="utf-8") as handle:
            self.assertEqual(handle.read().strip(), "3")

    def test_a_second_route_does_not_start_it_again(self):
        self.request()
        self.launch()
        self.assertEqual(self.launch().returncode, 0)
        self.assertEqual(len(self.started()), 1)

    def test_a_home_outside_the_test_root_is_refused(self):
        elsewhere = os.path.join(self.tmp.name, "owner-home")
        os.makedirs(elsewhere)
        self.request(home=elsewhere)
        self.assertEqual(self.launch().returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(elsewhere, "started-with")))
        self.assertFalse(os.path.exists(os.path.join(elsewhere, "launch")))

    def test_a_stop_reaches_the_app(self):
        self.request()
        open(os.path.join(self.home, "stay"), "w").close()
        process = subprocess.Popen(["/bin/sh", os.path.join(self.root, "launch.sh")],
                                   env={"PATH": os.environ["PATH"]}, cwd="/")
        app_pid = os.path.join(self.home, "launch", "app.pid")
        deadline = time.monotonic() + 10
        while not (os.path.exists(app_pid) and self.started()) and time.monotonic() < deadline:
            time.sleep(0.05)
        process.send_signal(signal.SIGTERM)
        self.assertEqual(process.wait(timeout=10), 0)
        self.assertEqual(self.started()[-1], "terminated")
        with open(os.path.join(self.home, "launch", "exit"), encoding="utf-8") as handle:
            self.assertEqual(handle.read().strip(), "0")

    def test_a_stop_sent_to_both_records_the_apps_own_exit(self):
        # run.sh --cleanup signals the app and launch.sh together. Steam runs
        # the shortcut with /bin/sh, which is bash on the device, and the stop
        # to launch.sh can interrupt its wait just as the app goes; the app's
        # exit is still the one recorded.
        for shell in ("/bin/sh", "bash"):
            for attempt in range(10):
                with self.subTest(shell=shell, attempt=attempt):
                    shutil.rmtree(os.path.join(self.home, "launch"), ignore_errors=True)
                    self.request()
                    open(os.path.join(self.home, "stay"), "w").close()
                    process = subprocess.Popen([shell, os.path.join(self.root, "launch.sh")],
                                               env={"PATH": os.environ["PATH"]}, cwd="/")
                    state = os.path.join(self.home, "launch")
                    deadline = time.monotonic() + 10
                    while not (os.path.exists(os.path.join(state, "app.id")) and self.started()) \
                            and time.monotonic() < deadline:
                        time.sleep(0.05)
                    self.assertEqual(launched.stop(state, wait=5), 0)
                    self.assertEqual(process.wait(timeout=10), 0)
                    with open(os.path.join(state, "exit"), encoding="utf-8") as handle:
                        self.assertEqual(handle.read().strip(), "0")


class CurrentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.home = os.path.join(self.root, SHA, "home")
        os.makedirs(self.home)
        self.appimage = os.path.join(self.root, SHA, "Galleon-arm64.AppImage")
        open(self.appimage, "w").close()
        os.chmod(self.appimage, 0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, budget=600, now=None, **overrides):
        fields = dict(appimage=self.appimage, home=self.home, results="/r", sha=SHA)
        fields.update(overrides)
        return current.write(self.root, budget=budget, now=now, **fields)

    def test_written_privately_with_its_expiry(self):
        record = self.write(budget=100, now=1_000_000)
        self.assertEqual(record["expires"], 1_000_100)
        self.assertEqual(record["expiresAt"], "1970-01-12T13:48:20Z")
        mode = stat.S_IMODE(os.stat(current.path(self.root)).st_mode)
        self.assertEqual(mode, 0o600)
        self.assertEqual(current.check(self.root, now=1_000_099), ((self.appimage, self.home), None))
        self.assertEqual(current.check(self.root, now=1_000_100), (None, "expired"))

    def test_refusals(self):
        cases = {
            "bad sha": dict(sha="abc"),
            "bad results": dict(results="a\nb"),
            "no appimage": dict(appimage=os.path.join(self.root, "missing")),
            "no home": dict(home=os.path.join(self.root, "missing")),
            "home outside the test root": dict(home=tempfile.gettempdir()),
        }
        for reason, overrides in cases.items():
            self.write(**overrides)
            self.assertEqual(current.check(self.root), (None, reason), reason)
        os.chmod(self.appimage, 0o644)
        self.write()
        self.assertEqual(current.check(self.root), (None, "no appimage"))

    def test_the_test_root_itself_is_no_home(self):
        self.write(home=self.root)
        self.assertEqual(current.check(self.root), (None, "home outside the test root"))

    def test_a_home_linked_out_of_the_test_root_is_refused(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        link = os.path.join(self.root, "linked-home")
        os.symlink(outside.name, link)
        self.write(home=link)
        self.assertEqual(current.check(self.root), (None, "no home"))

    def test_missing_unreadable_and_linked_records(self):
        self.assertEqual(current.check(self.root), (None, "missing"))
        with open(current.path(self.root), "w", encoding="utf-8") as handle:
            handle.write("{")
        self.assertEqual(current.check(self.root), (None, "unreadable"))
        os.unlink(current.path(self.root))
        target = os.path.join(self.root, "elsewhere.json")
        self.write()
        os.rename(current.path(self.root), target)
        os.symlink(target, current.path(self.root))
        self.assertEqual(current.check(self.root), (None, "linked"))

    def test_a_boolean_expiry_is_refused(self):
        self.write()
        with open(current.path(self.root), encoding="utf-8") as handle:
            record = json.load(handle)
        record["expires"] = True
        with open(current.path(self.root), "w", encoding="utf-8") as handle:
            json.dump(record, handle)
        self.assertEqual(current.check(self.root), (None, "bad expires"))

    def test_cli_write_check_remove(self):
        self.assertEqual(current.main(["write", "--test-root", self.root, "--appimage", self.appimage,
                                       "--home", self.home, "--results", "/r", "--sha", SHA,
                                       "--budget", "60"]), 0)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(current.main(["check", "--test-root", self.root]), 0)
        self.assertEqual(out.getvalue().splitlines(), [self.appimage, self.home])
        self.assertEqual(current.main(["remove", "--test-root", self.root]), 0)
        self.assertEqual(current.main(["remove", "--test-root", self.root]), 0)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(current.main(["check", "--test-root", self.root]), 1)


if __name__ == "__main__":
    unittest.main()
