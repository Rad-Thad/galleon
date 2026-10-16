"""Unit tests for payloads.py: python3 -m unittest discover -s test/device"""

import contextlib
import hashlib
import io
import json
import os
import tempfile
import unittest

import payloads


class PayloadsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bundle = os.path.join(self.tmp.name, "payloads")
        self.home = os.path.join(self.tmp.name, "home")
        os.mkdir(self.home)
        self.owner = os.path.join(self.tmp.name, "owner")
        os.mkdir(self.owner)

    def tearDown(self):
        self.tmp.cleanup()

    def bundled(self, files, entries=None):
        """The bundle's payloads folder holding `files` (path -> bytes), pinned."""
        listed = []
        for path, data in files.items():
            os.makedirs(os.path.dirname(os.path.join(self.bundle, path)), exist_ok=True)
            with open(os.path.join(self.bundle, path), "wb") as handle:
                handle.write(data)
            listed.append({"path": path, "bytes": len(data),
                           "sha256": hashlib.sha256(data).hexdigest(), "licence": "MIT"})
        os.makedirs(self.bundle, exist_ok=True)
        with open(os.path.join(self.bundle, payloads.MANIFEST), "w", encoding="utf-8") as handle:
            json.dump({"files": listed if entries is None else entries}, handle)

    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = payloads.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def copy(self):
        return self.run_cli("copy", "--bundle", self.bundle, "--home", self.home)

    def test_copies_every_payload_into_the_rom_folder_by_system(self):
        self.bundled({"roms/gba/hello test.gba": b"gba", "roms/snes/two.sfc": b"snes"})
        code, out, err = self.copy()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.splitlines(), ["roms/gba/hello test.gba", "roms/snes/two.sfc"])
        with open(os.path.join(self.home, "roms/gba/hello test.gba"), "rb") as handle:
            self.assertEqual(handle.read(), b"gba")
        # Only the payloads: the manifest and notices stay in the bundle.
        self.assertEqual(sorted(os.listdir(os.path.join(self.home, "roms"))), ["gba", "snes"])
        self.assertEqual(os.stat(os.path.join(self.home, "roms/snes/two.sfc")).st_mode & 0o077, 0)

    def test_a_bundle_without_payloads_copies_nothing(self):
        code, out, _ = self.copy()
        self.assertEqual((code, out), (payloads.NONE_EXIT, ""))
        self.assertEqual(os.listdir(self.home), [])

    def test_a_payload_that_is_not_the_pinned_bytes_is_refused(self):
        self.bundled({"roms/gba/a.gba": b"gba"})
        with open(os.path.join(self.bundle, "roms/gba/a.gba"), "ab") as handle:
            handle.write(b"!")
        code, _, err = self.copy()
        self.assertEqual(code, payloads.ERROR_EXIT)
        self.assertIn("not the bytes the manifest pins", err)
        self.assertFalse(os.path.exists(os.path.join(self.home, "roms/gba/a.gba")))

    def test_a_payload_that_is_a_link_is_refused(self):
        self.bundled({"roms/gba/a.gba": b"gba"})
        secret = os.path.join(self.owner, "secret")
        with open(secret, "wb") as handle:
            handle.write(b"gba")
        os.unlink(os.path.join(self.bundle, "roms/gba/a.gba"))
        os.symlink(secret, os.path.join(self.bundle, "roms/gba/a.gba"))
        code, _, _ = self.copy()
        self.assertEqual(code, payloads.ERROR_EXIT)
        self.assertFalse(os.path.exists(os.path.join(self.home, "roms/gba/a.gba")))

    def test_paths_outside_roms_system_file_are_refused(self):
        for path in ("../escape.gba", "roms/../../x.gba", "roms/x.gba", "/etc/x.gba",
                     "roms/gba/sub/x.gba", "bios/gba/x.gba", "roms//x.gba", None):
            with self.subTest(path=path):
                self.bundled({}, entries=[{"path": path, "bytes": 1, "sha256": "0" * 64}])
                code, _, err = self.copy()
                self.assertEqual(code, payloads.ERROR_EXIT)
                self.assertIn("roms/<system>/<file>", err)

    def test_an_entry_without_its_pins_is_refused(self):
        self.bundled({}, entries=[{"path": "roms/gba/a.gba"}])
        code, _, err = self.copy()
        self.assertEqual(code, payloads.ERROR_EXIT)
        self.assertIn("no pinned size and hash", err)

    def test_a_link_in_the_home_is_never_followed(self):
        self.bundled({"roms/gba/a.gba": b"gba"})
        os.symlink(self.owner, os.path.join(self.home, "roms"))
        code, _, _ = self.copy()
        self.assertEqual(code, payloads.ERROR_EXIT)
        self.assertEqual(os.listdir(self.owner), [])

    def test_a_copy_never_replaces_a_file_already_there(self):
        self.bundled({"roms/gba/a.gba": b"gba"})
        os.makedirs(os.path.join(self.home, "roms/gba"))
        os.symlink(os.path.join(self.owner, "target"), os.path.join(self.home, "roms/gba/a.gba"))
        code, _, _ = self.copy()
        self.assertEqual(code, payloads.ERROR_EXIT)
        self.assertEqual(os.listdir(self.owner), [])

    def test_a_home_that_is_a_link_is_refused(self):
        self.bundled({"roms/gba/a.gba": b"gba"})
        link = os.path.join(self.tmp.name, "linked-home")
        os.symlink(self.owner, link)
        code, _, _ = self.run_cli("copy", "--bundle", self.bundle, "--home", link)
        self.assertEqual(code, payloads.ERROR_EXIT)
        self.assertEqual(os.listdir(self.owner), [])

    def test_remove_takes_payloads_and_downloads_alike(self):
        self.bundled({"roms/gba/a.gba": b"gba"})
        self.copy()
        os.makedirs(os.path.join(self.home, "roms/snes"))
        with open(os.path.join(self.home, "roms/snes/downloaded.sfc"), "wb") as handle:
            handle.write(b"rom")
        code, _, err = self.run_cli("remove", "--home", self.home)
        self.assertEqual(code, 0, err)
        self.assertEqual(os.listdir(self.home), [])

    def test_remove_never_follows_a_link_out_of_the_home(self):
        with open(os.path.join(self.owner, "kept.gba"), "wb") as handle:
            handle.write(b"rom")
        os.makedirs(os.path.join(self.home, "roms"))
        os.symlink(self.owner, os.path.join(self.home, "roms/gba"))
        self.assertEqual(self.run_cli("remove", "--home", self.home)[0], 0)
        self.assertEqual(os.listdir(self.owner), ["kept.gba"])
        # The ROM folder itself a link: the link goes, what it points at stays.
        os.symlink(self.owner, os.path.join(self.home, "roms"))
        self.assertEqual(self.run_cli("remove", "--home", self.home)[0], 0)
        self.assertEqual(os.listdir(self.owner), ["kept.gba"])
        self.assertEqual(os.listdir(self.home), [])

    def test_remove_without_a_home_or_rom_folder_is_done(self):
        self.assertEqual(self.run_cli("remove", "--home", self.home)[0], 0)
        self.assertEqual(self.run_cli("remove", "--home", os.path.join(self.tmp.name, "none"))[0], 0)

    def test_remove_refuses_a_home_that_is_a_link(self):
        os.makedirs(os.path.join(self.owner, "roms"))
        link = os.path.join(self.tmp.name, "linked-home")
        os.symlink(self.owner, link)
        self.assertEqual(self.run_cli("remove", "--home", link)[0], payloads.ERROR_EXIT)
        self.assertEqual(os.listdir(self.owner), ["roms"])


if __name__ == "__main__":
    unittest.main()
