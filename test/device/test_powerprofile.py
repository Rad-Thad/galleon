"""Unit tests for powerprofile.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import sys
import tempfile
import textwrap
import unittest
import unittest.mock

import powerprofile as power_profile

# armada-power as far as powerprofile.py asks it: the profile in force lives beside
# it, a switch moves the governor in the fake sysfs unless `lagging`, and
# every call is logged.
FAKE_ARMADA_POWER = textwrap.dedent(
    """\
    #!{python}
    import json, os, sys
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "power.json")) as f:
        world = json.load(f)
    with open(os.path.join(here, "calls.log"), "a") as f:
        f.write(" ".join(sys.argv[1:]) + "\\n")
    if world.get("broken"):
        sys.exit(1)
    labels = {{"performance": "Performance", "balanced": "Balanced", "eco": "Eco"}}
    governors = {{"performance": "performance", "balanced": "conservative", "eco": "conservative"}}
    if sys.argv[1:] == ["profile"]:
        print(labels[world["profile"]])
    elif sys.argv[1] == "profile" and sys.argv[2] in labels:
        world["profile"] = sys.argv[2]
        if not world.get("lagging"):
            with open(world["governor"], "w") as f:
                f.write(governors[sys.argv[2]] + "\\n")
        with open(os.path.join(here, "power.json"), "w") as f:
            json.dump(world, f)
    else:
        sys.exit(2)
    """
)

CONF = textwrap.dedent(
    """\
    [general]
    default_profile=balanced

    [profile.eco]
    label=Eco
    cpu_governor=conservative

    [profile.balanced]
    label=Balanced
    cpu_governor=conservative

    [profile.performance]
    label=Performance
    cpu_governor=performance
    """
)


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bin = os.path.join(self.tmp.name, "bin")
        self.root = os.path.join(self.tmp.name, "root")
        os.makedirs(self.bin)
        self.armada = os.path.join(self.bin, "armada-power")
        with open(self.armada, "w", encoding="utf-8") as handle:
            handle.write(FAKE_ARMADA_POWER.format(python=sys.executable))
        os.chmod(self.armada, 0o755)
        self.put("usr/share/armada/power-profiles.conf", CONF)
        self.governor = self.put("sys/devices/system/cpu/cpufreq/policy7/scaling_governor",
                                 "conservative\n")
        self.set_world(profile="balanced")
        self.state = os.path.join(self.tmp.name, "profile.json")
        self.handshake = os.path.join(self.tmp.name, "handshake")
        os.makedirs(self.handshake)
        self.power = power_profile.Power(self.armada, self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, path, text):
        full = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(text)
        return full

    def set_world(self, **world):
        with open(os.path.join(self.bin, "power.json"), "w", encoding="utf-8") as handle:
            json.dump({"governor": self.governor, **world}, handle)

    def world(self):
        with open(os.path.join(self.bin, "power.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def calls(self):
        try:
            with open(os.path.join(self.bin, "calls.log"), encoding="utf-8") as handle:
                return handle.read().splitlines()
        except FileNotFoundError:
            return []

    def ask(self, text):
        with open(os.path.join(self.handshake, "want-profile"), "w", encoding="utf-8") as handle:
            handle.write(text)

    def said(self):
        with open(os.path.join(self.handshake, "profile-set"), encoding="utf-8") as handle:
            return handle.read()

    def answer(self, allowed=("performance", "balanced")):
        return power_profile.answer(self.power, self.state, self.handshake, set(allowed))

    def test_reads_the_profile_by_its_name_through_the_definitions(self):
        self.assertEqual(self.power.current(), "balanced")
        # A label the definitions do not hold is taken by its own name.
        os.unlink(os.path.join(self.root, "usr/share/armada/power-profiles.conf"))
        self.assertEqual(self.power.current(), "balanced")

    def test_an_edited_copy_in_etc_wins(self):
        self.put("etc/armada/power-profiles.conf", "[profile.quiet]\nlabel=Balanced\n")
        self.assertEqual(self.power.current(), "quiet")

    def test_record_keeps_a_record_already_there(self):
        self.assertEqual(power_profile.record(self.power, self.state), {"profile": "balanced"})
        self.set_world(profile="performance")
        self.assertEqual(power_profile.record(self.power, self.state), {"profile": "balanced"})
        self.assertEqual(os.stat(self.state).st_mode & 0o777, 0o600)

    def test_record_fails_when_no_profile_can_be_read(self):
        self.set_world(profile="balanced", broken=True)
        with self.assertRaises(power_profile.ProfileError):
            power_profile.record(self.power, self.state)
        self.assertFalse(os.path.lexists(self.state))

    def test_answers_a_request_by_switching_and_waiting_for_the_governor(self):
        power_profile.record(self.power, self.state)
        self.ask("performance\n")
        self.assertEqual(self.answer(), "performance")
        self.assertEqual(self.said(), "performance\n")
        self.assertEqual(self.world()["profile"], "performance")
        self.assertIn("profile performance", self.calls())

    def test_a_profile_already_in_force_is_answered_without_a_switch(self):
        power_profile.record(self.power, self.state)
        self.ask("balanced\n")
        self.assertEqual(self.answer(), "balanced")
        self.assertNotIn("profile balanced", self.calls())

    def test_a_switch_the_governor_does_not_follow_is_unchanged(self):
        power_profile.record(self.power, self.state)
        self.set_world(profile="balanced", lagging=True)
        self.ask("performance\n")
        with unittest.mock.patch.object(power_profile, "SETTLE_SECONDS", 0):
            said = power_profile.answer(self.power, self.state, self.handshake, {"performance"})
        # The daemon names it, but the clocks never followed.
        self.assertEqual(said, "unchanged:performance")

    def test_nothing_is_switched_without_a_record(self):
        self.ask("performance\n")
        self.assertEqual(self.answer(), "unchanged:balanced")
        self.assertEqual(self.calls(), ["profile"] * len(self.calls()))
        self.assertEqual(self.world()["profile"], "balanced")

    def test_a_record_that_does_not_read_switches_nothing(self):
        with open(self.state, "w", encoding="utf-8") as handle:
            handle.write("{}")
        self.ask("performance\n")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.answer(), "unchanged:balanced")
        self.assertEqual(self.world()["profile"], "balanced")

    def test_a_name_not_allowed_or_not_a_name_is_unchanged(self):
        power_profile.record(self.power, self.state)
        for request in ("eco\n", "Performance\n", "../x\n", "p" * 80 + "\n", "\xff"):
            with self.subTest(request=request):
                self.ask(request)
                self.assertEqual(self.answer(), "unchanged:balanced")
                os.unlink(os.path.join(self.handshake, "profile-set"))
        self.assertEqual(self.world()["profile"], "balanced")

    def test_a_linked_request_is_not_followed(self):
        power_profile.record(self.power, self.state)
        target = os.path.join(self.tmp.name, "elsewhere")
        with open(target, "w", encoding="utf-8") as handle:
            handle.write("performance\n")
        os.symlink(target, os.path.join(self.handshake, "want-profile"))
        self.assertEqual(self.answer(), "unchanged:balanced")

    def test_no_request_or_one_already_answered_is_left_alone(self):
        power_profile.record(self.power, self.state)
        self.assertIsNone(self.answer())
        self.ask("performance\n")
        with open(os.path.join(self.handshake, "profile-set"), "w", encoding="utf-8") as handle:
            handle.write("balanced\n")
        self.assertIsNone(self.answer())
        self.assertEqual(self.said(), "balanced\n")
        self.assertEqual(self.world()["profile"], "balanced")

    def test_the_answer_never_writes_through_a_link(self):
        power_profile.record(self.power, self.state)
        target = os.path.join(self.tmp.name, "elsewhere")
        with open(target, "w", encoding="utf-8") as handle:
            handle.write("untouched\n")
        os.symlink(target, os.path.join(self.handshake, "profile-set.tmp"))
        self.ask("performance\n")
        self.assertEqual(self.answer(), "performance")
        with open(target, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "untouched\n")

    def test_a_linked_handshake_folder_is_refused(self):
        linked = os.path.join(self.tmp.name, "linked")
        os.symlink(self.handshake, linked)
        with self.assertRaises(power_profile.ProfileError):
            power_profile.answer(self.power, self.state, linked, {"performance"})

    def test_restore_puts_the_recorded_profile_back_and_removes_the_record(self):
        power_profile.record(self.power, self.state)
        self.ask("performance\n")
        self.answer()
        self.assertEqual(power_profile.restore(self.power, self.state), {"profile": "balanced"})
        self.assertEqual(self.world()["profile"], "balanced")
        with open(self.governor, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "conservative\n")
        self.assertFalse(os.path.lexists(self.state))

    def test_restore_switches_nothing_when_the_profile_never_changed(self):
        power_profile.record(self.power, self.state)
        power_profile.restore(self.power, self.state)
        self.assertEqual(self.calls(), ["profile"] * len(self.calls()))

    def test_restore_keeps_the_record_while_it_cannot_switch_back(self):
        power_profile.record(self.power, self.state)
        self.set_world(profile="performance", broken=True)
        with self.assertRaises(power_profile.ProfileError):
            power_profile.restore(self.power, self.state)
        self.assertTrue(os.path.lexists(self.state))

    def test_restore_without_a_record_does_nothing(self):
        self.assertIsNone(power_profile.restore(self.power, self.state))
        self.assertEqual(self.calls(), [])

    def test_command_line(self):
        def run(*args):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = power_profile.main(["--armada-power", self.armada, "--root", self.root, *args])
            return code, out.getvalue(), err.getvalue()

        self.assertEqual(run("record", "--state", self.state)[:2], (0, "recorded profile balanced\n"))
        self.ask("performance\n")
        code, out, _ = run("answer", "--state", self.state, "--handshake", self.handshake,
                           "--allow", "performance")
        self.assertEqual((code, out), (0, "profile request answered performance\n"))
        self.assertEqual(run("restore", "--state", self.state)[:2], (0, "restored profile balanced\n"))
        self.assertEqual(run("restore", "--state", self.state)[:2], (0, "nothing to restore\n"))
        self.set_world(profile="balanced", broken=True)
        code, _, err = run("record", "--state", self.state)
        self.assertEqual(code, power_profile.ERROR_EXIT)
        self.assertIn("armada-power profile exited 1", err)


if __name__ == "__main__":
    unittest.main()
