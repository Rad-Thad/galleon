"""Unit tests for steamlaunch.py and target.sh: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import current
import steamlaunch

HERE = os.path.dirname(os.path.abspath(__file__))
SHA = "c" * 40


class SettleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.handshake = os.path.join(self.tmp.name, "handshake")
        os.mkdir(self.handshake)
        self.summary = os.path.join(self.tmp.name, "summary.json")
        self.record = os.path.join(self.tmp.name, "steam-attended.json")

    def tearDown(self):
        self.tmp.cleanup()

    def write_summary(self, checks, status="complete"):
        with open(self.summary, "w", encoding="utf-8") as handle:
            json.dump({"schema": 1, "sha": SHA, "status": status, "checks": checks, "notes": []}, handle)

    def read_summary(self):
        with open(self.summary, encoding="utf-8") as handle:
            return json.load(handle)

    def mark(self, name, text=""):
        with open(os.path.join(self.handshake, name), "w", encoding="utf-8") as handle:
            handle.write(text)

    def check(self, reason=None, prompt="none", result="pass"):
        return {"id": "steam.launch", "result": result, "metrics": {"prompt": prompt},
                "thresholds": {}, "reason": reason, "evidence": []}

    def test_a_reported_check_is_left_as_it_is(self):
        self.write_summary([self.check()])
        self.mark("steam-launched")
        self.assertEqual(steamlaunch.settle(self.summary, self.handshake, self.record), (False, False))
        self.assertEqual(self.read_summary()["checks"], [self.check()])
        self.assertFalse(os.path.exists(self.record))

    def test_a_galleon_steam_closed_is_recorded_as_a_fail(self):
        self.write_summary([{"id": "harness.run", "result": "pass"}])
        for name, text in (("steam-launched", "1\n"), ("steam-prompt", "shown\n"), ("target-started", "")):
            self.mark(name, text)
        self.assertEqual(steamlaunch.settle(self.summary, self.handshake, self.record), (True, False))
        summary = self.read_summary()
        self.assertEqual(summary["status"], "partial")
        added = summary["checks"][-1]
        self.assertEqual((added["id"], added["result"], added["reason"]),
                         ("steam.launch", "fail", "galleon-closed"))
        self.assertEqual(added["metrics"], {"started": 1, "prompt": "shown", "targetEnded": 0,
                                            "galleonSurvived": 0})
        self.assertIn("Steam closed it", summary["notes"][-1])

    def test_an_unreadable_answer_is_no_answer(self):
        self.write_summary([], status="partial")
        self.mark("steam-launched")
        self.mark("steam-prompt", "maybe")
        steamlaunch.settle(self.summary, self.handshake, self.record)
        self.assertEqual(self.read_summary()["checks"][-1]["metrics"]["prompt"], "no-answer")
        self.assertEqual(self.read_summary()["status"], "partial")

    def test_without_the_launch_mark_nothing_is_added(self):
        self.write_summary([])
        self.assertEqual(steamlaunch.settle(self.summary, self.handshake, self.record), (False, False))
        self.assertEqual(self.read_summary()["checks"], [])

    def test_a_prompt_left_up_is_recorded_for_every_later_run(self):
        self.write_summary([self.check("needs-attended", "left", "skip")])
        self.assertEqual(steamlaunch.settle(self.summary, self.handshake, self.record, now=0), (False, True))
        with open(self.record, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle), {"check": "steam.launch", "sha": SHA,
                                                 "at": "1970-01-01T00:00:00Z"})
        self.assertEqual(steamlaunch.main(["attended", "--record", self.record]), 0)

    def test_a_prompt_left_up_behind_a_closed_galleon_is_recorded_too(self):
        self.write_summary([])
        self.mark("steam-launched")
        self.mark("steam-prompt", "left\n")
        self.assertEqual(steamlaunch.settle(self.summary, self.handshake, self.record), (True, True))

    def test_attended_is_false_without_a_record(self):
        self.assertEqual(steamlaunch.main(["attended", "--record", self.record]), 1)

    def test_a_broken_summary_is_an_error_and_left_alone(self):
        with open(self.summary, "w", encoding="utf-8") as handle:
            handle.write("[]")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = steamlaunch.main(["settle", "--summary", self.summary, "--handshake", self.handshake,
                                     "--record", self.record])
        self.assertEqual(code, 1)
        with open(self.summary, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "[]")


class TargetTest(unittest.TestCase):
    """target.sh, the 'Galleon Device Test Target' shortcut's executable."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "galleon-device-tests")
        self.test_dir = os.path.join(self.root, SHA)
        self.home = os.path.join(self.test_dir, "home")
        self.handshake = os.path.join(self.test_dir, "handshake")
        os.makedirs(self.home)
        os.makedirs(self.handshake)
        for name in ("current.py",):
            shutil.copy2(os.path.join(HERE, name), self.root)
        # The hold is cut short so the test does not wait it out.
        with open(os.path.join(HERE, "target.sh"), encoding="utf-8") as handle:
            script = handle.read().replace("HOLD_SECONDS=5", "HOLD_SECONDS=0")
        self.assertIn("HOLD_SECONDS=0", script)
        with open(os.path.join(self.root, "target.sh"), "w", encoding="utf-8") as handle:
            handle.write(script)
        self.appimage = os.path.join(self.test_dir, "Galleon-arm64.AppImage")
        with open(self.appimage, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\necho started >\"$GALLEON_HOME/app-ran\"\n")
        os.chmod(self.appimage, 0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def run_target(self):
        return subprocess.run(["/bin/sh", os.path.join(self.root, "target.sh")], capture_output=True,
                              text=True, timeout=30, env={"PATH": os.environ["PATH"]}, cwd="/")

    def request(self, budget=600):
        current.write(self.root, appimage=self.appimage, home=self.home,
                      results=os.path.join(self.test_dir, "results"), sha=SHA, budget=budget)

    def test_marks_its_start_and_end_and_starts_nothing(self):
        self.request()
        self.assertEqual(self.run_target().returncode, 0)
        self.assertEqual(sorted(os.listdir(self.handshake)), ["target-ended", "target-started"])
        self.assertFalse(os.path.exists(os.path.join(self.home, "app-ran")))

    def test_without_a_current_request_it_marks_nothing(self):
        self.assertEqual(self.run_target().returncode, 0)
        self.request(budget=-1)
        self.assertEqual(self.run_target().returncode, 0)
        self.assertEqual(os.listdir(self.handshake), [])

    def test_a_linked_handshake_folder_is_never_written_through(self):
        self.request()
        elsewhere = os.path.join(self.tmp.name, "elsewhere")
        os.mkdir(elsewhere)
        os.rmdir(self.handshake)
        os.symlink(elsewhere, self.handshake)
        self.assertEqual(self.run_target().returncode, 0)
        self.assertEqual(os.listdir(elsewhere), [])


if __name__ == "__main__":
    unittest.main()
