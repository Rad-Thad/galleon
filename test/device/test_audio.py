"""Unit tests for audio.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import sys
import tempfile
import textwrap
import unittest

import audio

# WirePlumber as far as audio.py asks it: a default sink that can change, and
# every call logged.
FAKE_WPCTL = textwrap.dedent(
    """\
    #!{python}
    import json, os, sys
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "sinks.json")) as f:
        world = json.load(f)
    with open(os.path.join(here, "calls.log"), "a") as f:
        f.write(" ".join(sys.argv[1:]) + "\\n")
    if world.get("broken"):
        sys.exit(1)
    command, target = sys.argv[1], sys.argv[2]
    sink = world["default"] if target == "@DEFAULT_AUDIO_SINK@" else target
    node = world["sinks"][sink]
    if command == "inspect":
        print("id " + sink + ", type PipeWire:Interface:Node")
        print('  * node.name = "alsa_output"')
    elif command == "get-volume":
        print("Volume: " + node["volume"] + (" [MUTED]" if node["muted"] else ""))
    elif command == "set-mute":
        node["muted"] = sys.argv[3] == "1"
    elif command == "set-volume":
        node["volume"] = sys.argv[3]
    with open(os.path.join(here, "sinks.json"), "w") as f:
        json.dump(world, f)
    """
)


class AudioTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wpctl = os.path.join(self.tmp.name, "wpctl")
        with open(self.wpctl, "w", encoding="utf-8") as handle:
            handle.write(FAKE_WPCTL.format(python=sys.executable))
        os.chmod(self.wpctl, 0o755)
        self.set_world({"default": "52", "sinks": {"52": {"volume": "0.40", "muted": False},
                                                     "77": {"volume": "1.00", "muted": False}}})
        self.state = os.path.join(self.tmp.name, "audio.json")

    def tearDown(self):
        self.tmp.cleanup()

    def set_world(self, world):
        with open(os.path.join(self.tmp.name, "sinks.json"), "w", encoding="utf-8") as handle:
            json.dump(world, handle)

    def world(self):
        with open(os.path.join(self.tmp.name, "sinks.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def calls(self):
        try:
            with open(os.path.join(self.tmp.name, "calls.log"), encoding="utf-8") as handle:
                return handle.read().splitlines()
        except FileNotFoundError:
            return []

    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = audio.main(["--wpctl", self.wpctl, *args, "--state", self.state])
        return code, out.getvalue(), err.getvalue()

    def test_mutes_the_default_sink_and_puts_it_back(self):
        self.assertEqual(self.run_cli("mute")[0], 0)
        self.assertTrue(self.world()["sinks"]["52"]["muted"])
        with open(self.state, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle), {"sink": "52", "volume": "0.40", "muted": False})
        self.assertEqual(os.stat(self.state).st_mode & 0o777, 0o600)

        world = self.world()
        world["sinks"]["52"]["volume"] = "0.90"
        self.set_world(world)
        self.assertEqual(self.run_cli("restore")[0], 0)
        self.assertEqual(self.world()["sinks"]["52"], {"volume": "0.40", "muted": False})
        self.assertFalse(os.path.exists(self.state))

    def test_an_owner_who_had_muted_stays_muted(self):
        world = self.world()
        world["sinks"]["52"]["muted"] = True
        self.set_world(world)
        self.run_cli("mute")
        self.run_cli("restore")
        self.assertTrue(self.world()["sinks"]["52"]["muted"])

    def test_the_restore_reaches_the_recorded_sink_when_the_default_changed(self):
        self.run_cli("mute")
        world = self.world()
        world["default"] = "77"
        self.set_world(world)
        self.run_cli("restore")
        self.assertEqual(self.world()["sinks"]["52"]["muted"], False)
        self.assertEqual(self.world()["sinks"]["77"], {"volume": "1.00", "muted": False})
        self.assertNotIn("@DEFAULT_AUDIO_SINK@", " ".join(c for c in self.calls() if c.startswith("set-")))

    def test_a_record_left_by_a_stopped_run_is_kept_not_overwritten_by_its_mute(self):
        self.run_cli("mute")
        # The stopped run left the sink muted and its record; the next run
        # must not take that mute for the owner's setting.
        self.assertEqual(self.run_cli("mute")[0], 0)
        self.run_cli("restore")
        self.assertFalse(self.world()["sinks"]["52"]["muted"])

    def test_nothing_to_restore_is_not_an_error(self):
        code, out, _ = self.run_cli("restore")
        self.assertEqual((code, out.strip()), (0, "nothing to restore"))
        self.assertEqual(self.calls(), [])

    def test_a_wireplumber_that_fails_is_an_error_and_records_nothing(self):
        world = self.world()
        world["broken"] = True
        self.set_world(world)
        code, _, err = self.run_cli("mute")
        self.assertEqual(code, audio.ERROR_EXIT)
        self.assertIn("wpctl inspect", err)
        self.assertFalse(os.path.exists(self.state))

    def test_no_wpctl_at_all_is_an_error(self):
        os.unlink(self.wpctl)
        self.assertEqual(self.run_cli("mute")[0], audio.ERROR_EXIT)

    def test_an_unexpected_answer_is_an_error(self):
        with open(self.wpctl, "w", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\necho 'something else'\n")
        self.assertEqual(self.run_cli("mute")[0], audio.ERROR_EXIT)
        self.assertFalse(os.path.exists(self.state))

    def test_a_record_it_did_not_write_is_refused_and_kept(self):
        with open(self.state, "w", encoding="utf-8") as handle:
            json.dump({"sink": "52; rm", "volume": "0.4", "muted": False}, handle)
        self.assertEqual(self.run_cli("restore")[0], audio.ERROR_EXIT)
        self.assertEqual(self.calls(), [])
        self.assertTrue(os.path.exists(self.state))

    def test_a_failed_restore_keeps_the_record_for_cleanup(self):
        self.run_cli("mute")
        world = self.world()
        world["broken"] = True
        self.set_world(world)
        self.assertEqual(self.run_cli("restore")[0], audio.ERROR_EXIT)
        self.assertTrue(os.path.exists(self.state))


if __name__ == "__main__":
    unittest.main()
