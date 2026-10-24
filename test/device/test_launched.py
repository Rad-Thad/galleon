"""Unit tests for launched.py: python3 -m unittest discover -s test/device"""

import os
import signal
import subprocess
import tempfile
import time
import unittest

import launched

HERE = os.path.dirname(os.path.abspath(__file__))


class LaunchedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = os.path.join(self.tmp.name, "launch")
        os.mkdir(self.state)
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.wait()
        self.tmp.cleanup()

    def start(self, script="while :; do sleep 0.05; done"):
        child = subprocess.Popen(["/bin/sh", "-c", script])
        self.children.append(child)
        return child

    def keep(self, name, pid, record=True):
        if record:
            self.assertEqual(launched.record(self.state, name, pid), 0)
        with open(os.path.join(self.state, f"{name}.pid"), "w", encoding="utf-8") as handle:
            handle.write(f"{pid}\n")

    def stop(self):
        return launched.stop(self.state, wait=2)

    def test_stops_both_recorded_processes(self):
        app, launch = self.start(), self.start()
        self.keep("app", app.pid)
        self.keep("launch", launch.pid)
        self.assertEqual(self.stop(), 0)
        self.assertIsNotNone(app.wait(timeout=5))
        self.assertIsNotNone(launch.wait(timeout=5))

    def test_kills_a_process_that_ignores_the_stop(self):
        ready = os.path.join(self.tmp.name, "ready")
        app = self.start(f"trap '' TERM; : >'{ready}'; while :; do sleep 0.05; done")
        while not os.path.exists(ready):
            time.sleep(0.02)
        self.keep("app", app.pid)
        self.assertEqual(self.stop(), 0)
        self.assertEqual(app.wait(timeout=5), -9)

    def test_a_pid_now_another_process_is_left_alone(self):
        app = self.start()
        self.keep("app", app.pid)
        # The same number, a different start: what a pid reused after a
        # reboot, or once the app has gone, looks like.
        with open(os.path.join(self.state, "app.id"), encoding="utf-8") as handle:
            pid, boot, start = handle.read().split()
        with open(os.path.join(self.state, "app.id"), "w", encoding="utf-8") as handle:
            handle.write(f"{pid} {boot} {int(start) - 1}\n")
        self.assertEqual(self.stop(), 0)
        time.sleep(0.2)
        self.assertIsNone(app.poll())

    def test_another_boot_is_left_alone(self):
        app = self.start()
        self.keep("app", app.pid)
        with open(os.path.join(self.state, "app.id"), encoding="utf-8") as handle:
            pid, _, start = handle.read().split()
        with open(os.path.join(self.state, "app.id"), "w", encoding="utf-8") as handle:
            handle.write(f"{pid} 00000000-0000-0000-0000-000000000000 {start}\n")
        self.assertEqual(self.stop(), 0)
        time.sleep(0.2)
        self.assertIsNone(app.poll())

    def test_a_pid_without_its_identity_is_never_signalled(self):
        app = self.start()
        self.keep("app", app.pid, record=False)
        self.assertEqual(self.stop(), 0)
        time.sleep(0.2)
        self.assertIsNone(app.poll())

    def test_nothing_recorded_or_no_folder_is_nothing_to_stop(self):
        self.assertEqual(self.stop(), 0)
        self.assertEqual(launched.stop(os.path.join(self.tmp.name, "missing")), 0)

    def test_a_linked_folder_is_not_followed(self):
        app = self.start()
        self.keep("app", app.pid)
        link = os.path.join(self.tmp.name, "linked")
        os.symlink(self.state, link)
        self.assertEqual(launched.stop(link, wait=1), 0)
        time.sleep(0.2)
        self.assertIsNone(app.poll())

    def test_pid_files_that_are_not_plain_numbers_are_ignored(self):
        for text in ("", "1\n", "12x\n", "-5\n", "\u00b2\n"):
            with open(os.path.join(self.state, "app.pid"), "w", encoding="utf-8") as handle:
                handle.write(text)
            self.assertIsNone(launched.recorded(self.state, "app"), text)

    def test_a_process_that_has_gone_cannot_be_recorded(self):
        child = self.start("exit 0")
        child.wait()
        self.assertEqual(launched.record(self.state, "app", child.pid), 1)
        self.assertFalse(os.path.exists(os.path.join(self.state, "app.id")))

    def test_a_name_with_spaces_and_parentheses_is_read_past(self):
        os.symlink("/bin/sleep", os.path.join(self.tmp.name, "a (b) c"))
        child = subprocess.Popen([os.path.join(self.tmp.name, "a (b) c"), "30"])
        self.children.append(child)
        time.sleep(0.1)
        self.keep("app", child.pid)
        self.assertEqual(launched.recorded(self.state, "app"), child.pid)

    def test_cli_record_and_stop(self):
        app = self.start()
        script = os.path.join(HERE, "launched.py")
        subprocess.run(["python3", "-I", script, "record", "--state", self.state, "--name", "app",
                        "--pid", str(app.pid)], check=True)
        with open(os.path.join(self.state, "app.pid"), "w", encoding="utf-8") as handle:
            handle.write(f"{app.pid}\n")
        mode = os.stat(os.path.join(self.state, "app.id")).st_mode & 0o777
        self.assertEqual(mode, 0o600)
        subprocess.run(["python3", "-I", script, "stop", "--state", self.state], check=True,
                       timeout=30)
        self.assertIsNotNone(app.wait(timeout=5))

    def launch(self, script, wait_for=None):
        """launched.py run, started as launch.sh starts it, on `script` as the app."""
        app = os.path.join(self.tmp.name, "app")
        with open(app, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\n" + script)
        os.chmod(app, 0o755)
        child = subprocess.Popen(["python3", "-I", os.path.join(HERE, "launched.py"), "run",
                                  "--state", self.state, "--", app])
        self.children.append(child)
        deadline = time.monotonic() + 10
        while wait_for and not os.path.exists(wait_for) and time.monotonic() < deadline:
            time.sleep(0.02)
        return child

    def written(self, name):
        with open(os.path.join(self.state, name), encoding="utf-8") as handle:
            return handle.read()

    def test_run_records_the_app_and_its_exit(self):
        child = self.launch("echo said\nexit 3\n")
        self.assertEqual(child.wait(timeout=10), 3)
        self.assertEqual(self.written("exit"), "3\n")
        self.assertEqual(self.written("app.log"), "said\n")
        self.assertRegex(self.written("app.pid"), r"^[0-9]+\n$")

    def test_run_passes_a_stop_on_to_the_app(self):
        ready = os.path.join(self.tmp.name, "ready")
        child = self.launch(f"trap 'echo stopped; exit 0' TERM\n: >'{ready}'\n"
                         "while :; do sleep 0.05 & wait $!; done\n", wait_for=ready)
        child.send_signal(signal.SIGHUP)
        self.assertEqual(child.wait(timeout=10), 0)
        self.assertEqual(self.written("exit"), "0\n")
        self.assertEqual(self.written("app.log"), "stopped\n")

    def test_run_gives_an_app_ended_by_a_signal_as_a_shell_does(self):
        child = self.launch("kill -TERM $$\n")
        self.assertEqual(child.wait(timeout=10), 143)
        self.assertEqual(self.written("exit"), "143\n")

    def test_run_of_an_app_that_cannot_start_records_why(self):
        app = os.path.join(self.tmp.name, "app")
        open(app, "w").close()
        code = launched.run(self.state, [app])
        self.assertEqual(code, 126)
        self.assertEqual(self.written("exit"), "126\n")
        self.assertFalse(os.path.exists(os.path.join(self.state, "app.pid")))


if __name__ == "__main__":
    unittest.main()
