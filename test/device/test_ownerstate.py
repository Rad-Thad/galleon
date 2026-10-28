"""Unit tests for ownerstate.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import ownerstate
from test_shortcuts import GAME, TEST, shortcuts_file

SPEC = {
    "folders": ["emu/data", ".config/app"],
    "pointers": [{"file": ".config/app/root", "folders": ["config", "saves"]}],
    "globs": ["steam/userdata/*/config/shortcuts.vdf"],
    "configs": ["emu/data/settings.ini", ".config/app/app.cfg", "emu/data/absent.ini"],
}


def write(path, text="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


class OwnerStateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.outside = os.path.join(self.tmp.name, "outside")
        write(os.path.join(self.home, "emu/data/settings.ini"), "volume=1\n")
        write(os.path.join(self.home, "emu/data/memcards/card1.mcd"), "card")
        write(os.path.join(self.home, ".config/app/app.cfg"), "a=1\n")
        write(os.path.join(self.home, "steam/userdata/123/config/shortcuts.vdf"), "vdf")
        write(os.path.join(self.home, "unrelated/file"), "not covered")
        write(os.path.join(self.outside, "secret"), "owner's file")

    def tearDown(self):
        self.tmp.cleanup()

    def snap(self):
        return ownerstate.snapshot(self.home, SPEC)

    def write_shortcuts(self, entries):
        path = os.path.join(self.home, "steam/userdata/123/config/shortcuts.vdf")
        with open(path, "wb") as handle:
            handle.write(shortcuts_file(entries))
        return path

    def test_the_target_shortcuts_play_time_is_left_out_too(self):
        spec = dict(SPEC, shortcutLists=["steam/userdata/*/config/shortcuts.vdf"])
        target = dict(TEST, AppName="Galleon Device Test Target")
        self.write_shortcuts([GAME, dict(TEST, LastPlayTime=0), dict(target, LastPlayTime=0)])
        before = ownerstate.snapshot(self.home, spec)
        key = os.path.join("steam", "userdata", "123", "config", "shortcuts.vdf")
        self.assertEqual(before["files"][key]["playTimeMasked"], 2)
        self.write_shortcuts([GAME, dict(TEST, LastPlayTime=7), dict(target, LastPlayTime=1760000000)])
        self.assertEqual(ownerstate.compare(before, ownerstate.snapshot(self.home, spec)), [])
        self.write_shortcuts([GAME, dict(TEST, LastPlayTime=7), dict(target, LastPlayTime=8, Exe='"/elsewhere"')])
        self.assertEqual(ownerstate.compare(before, ownerstate.snapshot(self.home, spec)),
                         [{"path": key, "change": "changed"}])

    def test_the_test_shortcuts_play_time_is_the_one_change_left_out(self):
        spec = dict(SPEC, shortcutLists=["steam/userdata/*/config/shortcuts.vdf"])
        game = dict(GAME, LastPlayTime=5)
        path = self.write_shortcuts([game, dict(TEST, LastPlayTime=0)])
        before = ownerstate.snapshot(self.home, spec)
        key = os.path.join("steam", "userdata", "123", "config", "shortcuts.vdf")
        self.assertEqual(before["files"][key]["playTimeMasked"], 1)

        # Steam started the test shortcut and saved the list later.
        self.write_shortcuts([game, dict(TEST, LastPlayTime=1760000000)])
        os.utime(path, ns=(1, 1))
        self.assertEqual(ownerstate.compare(before, ownerstate.snapshot(self.home, spec)), [])

        for changed in (
            [dict(game, LastPlayTime=6), dict(TEST, LastPlayTime=1760000000)],
            [game, dict(TEST, LastPlayTime=1760000000, Exe='"/elsewhere"')],
            [game, dict(TEST, LastPlayTime=1760000000), dict(GAME, AppName="Another")],
            [dict(TEST, LastPlayTime=1760000000)],
        ):
            self.write_shortcuts(changed)
            self.assertEqual(
                ownerstate.compare(before, ownerstate.snapshot(self.home, spec)),
                [{"path": key, "change": "changed"}],
            )

    def test_the_real_spec_masks_only_shortcut_lists_it_covers(self):
        spec = ownerstate.load_spec()
        self.assertTrue(spec["shortcutLists"])
        self.assertTrue(set(spec["shortcutLists"]) <= set(spec["globs"]))
        self.assertTrue(all(p.endswith("/shortcuts.vdf") for p in spec["shortcutLists"]))

    def test_a_shortcut_list_that_is_not_vdf_is_compared_strictly(self):
        spec = dict(SPEC, shortcutLists=["steam/userdata/*/config/shortcuts.vdf"])
        before = ownerstate.snapshot(self.home, spec)
        key = os.path.join("steam", "userdata", "123", "config", "shortcuts.vdf")
        self.assertNotIn("playTimeMasked", before["files"][key])
        os.utime(os.path.join(self.home, key), ns=(1, 1))
        self.assertEqual(
            ownerstate.compare(before, ownerstate.snapshot(self.home, spec)),
            [{"path": key, "change": "changed"}],
        )

    def test_a_shortcut_list_that_is_a_link_is_never_read_through(self):
        spec = dict(SPEC, shortcutLists=["steam/userdata/*/config/shortcuts.vdf"])
        path = os.path.join(self.home, "steam/userdata/123/config/shortcuts.vdf")
        target = os.path.join(self.outside, "shortcuts.vdf")
        with open(target, "wb") as handle:
            handle.write(shortcuts_file([TEST]))
        os.unlink(path)
        os.symlink(target, path)
        entry = ownerstate.snapshot(self.home, spec)["files"][os.path.join("steam", "userdata", "123", "config", "shortcuts.vdf")]
        self.assertEqual(entry, {"type": "link", "target": target})

    def test_equal_snapshots_have_no_changes(self):
        self.assertEqual(ownerstate.compare(self.snap(), self.snap()), [])

    def test_covers_folders_and_globs_but_nothing_else(self):
        files = self.snap()["files"]
        self.assertIn(os.path.join("emu", "data", "memcards", "card1.mcd"), files)
        self.assertIn(os.path.join("steam", "userdata", "123", "config", "shortcuts.vdf"), files)
        self.assertNotIn(os.path.join("unrelated", "file"), files)
        entry = files[os.path.join("emu", "data", "settings.ini")]
        self.assertEqual(entry["type"], "file")
        self.assertEqual(entry["size"], 9)
        self.assertEqual(len(entry["sha256"]), 64)

    def test_a_missing_folder_is_not_an_error(self):
        spec = dict(SPEC, folders=SPEC["folders"] + ["never/made"])
        self.assertNotIn(os.path.join("never", "made"), ownerstate.snapshot(self.home, spec)["files"])

    def test_added_removed_and_changed_files(self):
        before = self.snap()
        write(os.path.join(self.home, "emu/data/memcards/card2.mcd"), "new")
        os.unlink(os.path.join(self.home, ".config/app/app.cfg"))
        write(os.path.join(self.home, "emu/data/settings.ini"), "volume=0\n")
        changes = ownerstate.compare(before, self.snap())
        self.assertEqual(
            changes,
            [
                {"path": os.path.join(".config", "app", "app.cfg"), "change": "removed"},
                {"path": os.path.join("emu", "data", "memcards", "card2.mcd"), "change": "added"},
                {"path": os.path.join("emu", "data", "settings.ini"), "change": "changed"},
            ],
        )

    def test_a_touched_file_with_the_same_content_is_changed(self):
        path = os.path.join(self.home, "emu/data/settings.ini")
        before = self.snap()
        info = os.stat(path)
        os.utime(path, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
        self.assertEqual(
            ownerstate.compare(before, self.snap()),
            [{"path": os.path.join("emu", "data", "settings.ini"), "change": "changed"}],
        )

    def test_a_new_file_in_the_steam_glob_is_seen(self):
        before = self.snap()
        write(os.path.join(self.home, "steam/userdata/456/config/shortcuts.vdf"), "vdf")
        changes = ownerstate.compare(before, self.snap())
        self.assertEqual([change["change"] for change in changes], ["added"])

    def test_links_are_recorded_not_followed(self):
        os.symlink(self.outside, os.path.join(self.home, "emu/data/linked"))
        files = self.snap()["files"]
        self.assertEqual(files[os.path.join("emu", "data", "linked")], {"type": "link", "target": self.outside})
        self.assertFalse(any(key.endswith("secret") for key in files))

    def test_a_covered_folder_that_is_a_link_is_read_through(self):
        card = os.path.join(self.outside, "sd", "settings")
        write(card, "a=1\n")
        folder = os.path.join(self.home, ".config/app")
        os.rename(folder, os.path.join(self.tmp.name, "moved"))
        os.symlink(os.path.join(self.outside, "sd"), folder)
        before = self.snap()
        self.assertEqual(before["files"][os.path.join(".config", "app")]["type"], "link")
        self.assertIn(os.path.join(".config", "app", "settings"), before["files"])
        write(card, "a=2\n")
        self.assertEqual(
            ownerstate.compare(before, self.snap()),
            [{"path": os.path.join(".config", "app", "settings"), "change": "changed"}],
        )

    def test_large_files_are_compared_without_a_hash(self):
        with mock.patch.object(ownerstate, "HASH_LIMIT", 3):
            entry = self.snap()["files"][os.path.join("emu", "data", "settings.ini")]
        self.assertNotIn("sha256", entry)
        self.assertEqual(entry["size"], 9)

    def test_a_pointer_adds_its_root_folders_outside_the_home(self):
        relocated = os.path.join(self.tmp.name, "elsewhere")
        write(os.path.join(relocated, "config/settings.json"), "{}")
        write(os.path.join(relocated, "saves/game.srm"), "save")
        write(os.path.join(relocated, "roms/big.iso"), "rom")
        write(os.path.join(self.home, ".config/app/root"), relocated + "\n")
        files = self.snap()["files"]
        self.assertIn(os.path.join(relocated, "config", "settings.json"), files)
        self.assertIn(os.path.join(relocated, "saves", "game.srm"), files)
        self.assertNotIn(os.path.join(relocated, "roms", "big.iso"), files)

    def test_a_relative_or_unreadable_pointer_adds_nothing(self):
        write(os.path.join(self.home, ".config/app/root"), "relative/path\n")
        roots = ownerstate.covered_roots(self.home, SPEC)
        self.assertEqual(len(roots), 3)
        with open(os.path.join(self.home, ".config/app/root"), "wb") as handle:
            handle.write(b"\xff\xfe")
        self.assertEqual(len(ownerstate.covered_roots(self.home, SPEC)), 3)

    def test_backup_then_restore_puts_back_changed_and_removed_configs(self):
        dest = os.path.join(self.tmp.name, "backup")
        self.assertEqual(
            ownerstate.backup(self.home, SPEC, dest),
            [os.path.join(".config", "app", "app.cfg"), os.path.join("emu", "data", "settings.ini")],
        )
        self.assertEqual(ownerstate.restore(self.home, dest), [])
        write(os.path.join(self.home, "emu/data/settings.ini"), "volume=0\n")
        os.unlink(os.path.join(self.home, ".config/app/app.cfg"))
        restored = ownerstate.restore(self.home, dest)
        self.assertEqual(
            restored, [os.path.join(".config", "app", "app.cfg"), os.path.join("emu", "data", "settings.ini")]
        )
        self.assertEqual(read(os.path.join(self.home, "emu/data/settings.ini")), "volume=1\n")
        self.assertEqual(read(os.path.join(self.home, ".config/app/app.cfg")), "a=1\n")
        self.assertEqual(ownerstate.restore(self.home, dest), [])

    def test_a_restored_config_still_fails_the_comparison_taken_before_it(self):
        dest = os.path.join(self.tmp.name, "backup")
        before = self.snap()
        ownerstate.backup(self.home, SPEC, dest)
        write(os.path.join(self.home, "emu/data/settings.ini"), "volume=0\n")
        after = self.snap()
        self.assertTrue(ownerstate.restore(self.home, dest))
        self.assertTrue(ownerstate.compare(before, after))

    def test_restore_never_writes_through_a_link(self):
        dest = os.path.join(self.tmp.name, "backup")
        ownerstate.backup(self.home, SPEC, dest)
        config = os.path.join(self.home, ".config/app/app.cfg")
        os.unlink(config)
        os.symlink(os.path.join(self.outside, "secret"), config)
        self.assertEqual(ownerstate.restore(self.home, dest), [os.path.join(".config", "app", "app.cfg")])
        self.assertEqual(read(os.path.join(self.outside, "secret")), "owner's file")
        self.assertTrue(os.path.islink(config))

    def test_restore_never_writes_below_a_linked_folder(self):
        dest = os.path.join(self.tmp.name, "backup")
        ownerstate.backup(self.home, SPEC, dest)
        folder = os.path.join(self.home, ".config/app")
        os.rename(folder, os.path.join(self.tmp.name, "moved"))
        os.symlink(self.outside, folder)
        self.assertEqual(ownerstate.restore(self.home, dest), [os.path.join(".config", "app", "app.cfg")])
        self.assertFalse(os.path.exists(os.path.join(self.outside, "app.cfg")))

    def test_restore_ignores_index_keys_outside_the_home(self):
        dest = os.path.join(self.tmp.name, "backup")
        ownerstate.backup(self.home, SPEC, dest)
        with open(os.path.join(dest, "index.json"), encoding="utf-8") as handle:
            index = json.load(handle)
        saved = next(iter(index.values()))
        escaping = os.path.join("..", "outside", "secret")
        with open(os.path.join(dest, "index.json"), "w", encoding="utf-8") as handle:
            json.dump({escaping: saved, os.path.join(self.outside, "secret"): saved}, handle)
        self.assertEqual(ownerstate.restore(self.home, dest), [])
        self.assertEqual(read(os.path.join(self.outside, "secret")), "owner's file")

    def test_restore_without_a_backup_restores_nothing(self):
        self.assertEqual(ownerstate.restore(self.home, os.path.join(self.tmp.name, "none")), [])

    def test_the_command_line_round_trip(self):
        before = os.path.join(self.tmp.name, "before.json")
        after = os.path.join(self.tmp.name, "after.json")
        diff = os.path.join(self.tmp.name, "diff.json")
        dest = os.path.join(self.tmp.name, "backup")
        spec = os.path.join(self.tmp.name, "spec.json")
        with open(spec, "w", encoding="utf-8") as handle:
            json.dump(SPEC, handle)
        common = ["--home", self.home, "--spec", spec]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(ownerstate.main(common + ["snapshot", before]), 0)
            self.assertEqual(ownerstate.main(common + ["backup", dest]), 0)
            write(os.path.join(self.home, "emu/data/settings.ini"), "volume=0\n")
            self.assertEqual(ownerstate.main(common + ["snapshot", after]), 0)
            self.assertEqual(ownerstate.main(common + ["compare", before, after, "--out", diff]), 1)
            self.assertEqual(ownerstate.main(common + ["restore", dest]), 1)
            self.assertEqual(ownerstate.main(common + ["compare", before, before]), 0)
        with open(diff, encoding="utf-8") as handle:
            self.assertEqual(len(json.load(handle)["changes"]), 1)
        self.assertIn("restored: " + os.path.join("emu", "data", "settings.ini"), out.getvalue())

    def test_a_failure_is_told_apart_from_a_difference(self):
        missing = os.path.join(self.tmp.name, "missing.json")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = ownerstate.run(["--home", self.home, "compare", missing, missing])
        self.assertEqual(code, ownerstate.ERROR_EXIT)
        self.assertGreater(ownerstate.ERROR_EXIT, 1)
        self.assertIn("FileNotFoundError", err.getvalue())

    def test_the_shipped_spec_is_relative_to_the_home(self):
        spec = ownerstate.load_spec()
        for rel in spec["folders"] + spec["configs"] + spec["globs"]:
            self.assertFalse(os.path.isabs(rel), rel)
            self.assertNotIn("..", rel.split("/"), rel)
        for rel in spec["configs"]:
            self.assertTrue(any(rel.startswith(folder + "/") for folder in spec["folders"]), rel)


if __name__ == "__main__":
    unittest.main()
