"""Unit tests for session.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import session
from session import bridge

CFG = dict(bridge.DEFAULTS)


def answer(stdout, code=0):
    return subprocess.CompletedProcess([], code, stdout=stdout, stderr="")


class EnvTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.proc = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def fake_proc(self, pid, comm, environ):
        entry = self.proc / str(pid)
        entry.mkdir()
        (entry / "comm").write_text(comm + "\n", encoding="utf-8")
        (entry / "environ").write_bytes(b"\0".join(item.encode() for item in environ) + b"\0")

    def test_takes_the_session_keys_from_the_user_manager(self):
        out = ("DISPLAY=:0\nHOME=/home/deck\nXDG_RUNTIME_DIR=/run/user/1000\n"
               "XAUTHORITY=$'/tmp/odd\\nname'\nDBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus\n")
        with mock.patch.object(bridge, "run_quiet", return_value=answer(out)) as run:
            found = session.from_manager()
        run.assert_called_once_with(["systemctl", "--user", "show-environment"], timeout=10)
        self.assertEqual(found, {"DISPLAY": ":0", "XDG_RUNTIME_DIR": "/run/user/1000",
                                 "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus"})

    def test_no_user_manager_gives_nothing(self):
        for result in (None, answer("DISPLAY=:0\n", code=1)):
            with mock.patch.object(bridge, "run_quiet", return_value=result):
                self.assertEqual(session.from_manager(), {})

    def test_takes_them_from_this_users_steam_found_by_its_exact_name(self):
        self.fake_proc(40, "steamwebhelper", ["DISPLAY=:9"])
        self.fake_proc(41, "steam", ["DISPLAY=:1", "GAMESCOPE_WAYLAND_DISPLAY=gamescope-0", "PATH=/x"])
        self.assertEqual(session.from_steam(self.proc),
                         {"DISPLAY": ":1", "GAMESCOPE_WAYLAND_DISPLAY": "gamescope-0"})

    def test_another_users_steam_is_passed_over(self):
        self.fake_proc(41, "steam", ["DISPLAY=:1"])
        self.assertEqual(session.from_steam(self.proc, uid=os.getuid() + 1), {})

    def test_the_user_manager_wins_and_steam_fills_the_gaps(self):
        self.fake_proc(41, "steam", ["DISPLAY=:1", "XAUTHORITY=/run/user/1000/xauth"])
        with mock.patch.object(bridge, "run_quiet", return_value=answer("DISPLAY=:0\n")):
            self.assertEqual(session.session_env(self.proc),
                             {"DISPLAY": ":0", "XAUTHORITY": "/run/user/1000/xauth"})

    def test_env_prints_assignments_the_shell_reads_back_unchanged(self):
        tricky = "/run/user/1000/it's $(here)"
        with mock.patch.object(session, "session_env", return_value={"XAUTHORITY": tricky}):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(session.main(["env"]), 0)
        self.assertEqual(out.getvalue(), f"export XAUTHORITY={shlex.quote(tricky)}\n")
        shell = subprocess.run(["sh", "-c", out.getvalue() + 'printf %s "$XAUTHORITY"'],
                               capture_output=True, text=True, check=True)
        self.assertEqual(shell.stdout, tricky)


class CheckTest(unittest.TestCase):
    def check(self, active="active", processes=None, idle=None, free=4096):
        with mock.patch.object(bridge, "run_quiet", return_value=answer(active + "\n")):
            return session.check("/unused", CFG, processes or {}, idle or {}, free)

    def test_ready(self):
        self.assertEqual(self.check(), (True, "ready"))

    def test_game_mode_off(self):
        ok, why = self.check(active="inactive")
        self.assertFalse(ok)
        self.assertIn("Game Mode is not running", why)

    def test_someone_playing(self):
        self.assertEqual(self.check(processes={"retroarch": [12], "bash": [13]}),
                         (False, "busy: retroarch running"))

    def test_an_idle_galleon_is_not_playing(self):
        idle = {"idle": True, "steamAppId": "123"}
        self.assertEqual(self.check(processes={"galleon": [12]}, idle=idle), (True, "ready"))
        self.assertEqual(self.check(processes={"galleon": [12]}), (False, "busy: galleon running"))

    def test_too_little_space(self):
        self.assertEqual(self.check(free=session.MIN_FREE_MB - 1),
                         (False, f"only {session.MIN_FREE_MB - 1} MB free"))

    def test_check_exits_with_the_skip_code(self):
        with mock.patch.object(session, "check", return_value=(False, "busy: retroarch running")):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(session.main(["check", "--test-root", "/x"]), session.EXIT_SKIPPED)
        self.assertEqual(out.getvalue(), "busy: retroarch running\n")
        self.assertEqual(session.EXIT_SKIPPED, bridge.EXIT_SKIPPED)


if __name__ == "__main__":
    unittest.main()
