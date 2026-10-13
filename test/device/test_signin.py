"""Unit tests for signin.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import stat
import tempfile
import unittest

import ownerstate
import signin

SERVER = {"baseUrl": "http://romm.test:8080", "authMode": "password", "username": "player"}


def write_app(root, credentials, magic=b"RAW1", server=SERVER):
    config = os.path.join(root, "config")
    os.makedirs(config, exist_ok=True)
    with open(os.path.join(config, "settings.json"), "w", encoding="utf-8") as handle:
        json.dump({"settings": {"syncSavesUp": True}, "server": server}, handle)
    with open(os.path.join(config, "credentials.bin"), "wb") as handle:
        handle.write(magic + json.dumps(credentials).encode("utf-8"))


OWNER_TOKENS = {"accessToken": "acc", "refreshToken": "ref", "clientToken": None, "deviceId": "dev-1"}


class SigninTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "owner")
        self.test_dir = os.path.join(self.tmp.name, "tests", "abc")
        os.makedirs(self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def find(self, token_file=None, environ=None):
        return signin.find_signin(self.home, token_file, environ or {})

    def test_stock_rommix_in_plain_text_is_imported_without_refresh_token_or_device_id(self):
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS)
        source, server, credentials = self.find()
        self.assertEqual(source, "rommix")
        self.assertEqual(server, SERVER)
        self.assertEqual(
            credentials, {"clientToken": None, "accessToken": "acc", "refreshToken": None, "deviceId": None}
        )

    def test_the_bridge_token_comes_first(self):
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS)
        token_file = os.path.join(self.tmp.name, "romm-readonly.json")
        with open(token_file, "w", encoding="utf-8") as handle:
            json.dump({"baseUrl": "http://romm.test", "token": "ro", "scopes": ["roms.read"]}, handle)
        source, server, credentials = self.find(token_file)
        self.assertEqual(source, "bridge-readonly-token")
        self.assertEqual(server, {"baseUrl": "http://romm.test", "authMode": "device"})
        self.assertEqual(credentials["clientToken"], "ro")
        self.assertIsNone(credentials["deviceId"])

    def test_a_missing_or_broken_bridge_token_falls_through(self):
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS)
        broken = os.path.join(self.tmp.name, "broken.json")
        with open(broken, "w", encoding="utf-8") as handle:
            handle.write("{not json")
        self.assertEqual(self.find(broken)[0], "rommix")
        self.assertEqual(self.find(os.path.join(self.tmp.name, "absent.json"))[0], "rommix")

    def test_the_owners_galleon_comes_before_rommix(self):
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS)
        write_app(os.path.join(self.home, "galleon"), {"clientToken": "rmm_x", "deviceId": "dev-2"})
        source, _, credentials = self.find()
        self.assertEqual(source, "galleon")
        self.assertEqual(credentials["clientToken"], "rmm_x")
        self.assertIsNone(credentials["deviceId"])

    def test_root_pointers_and_rommix_home_are_followed(self):
        moved = os.path.join(self.tmp.name, "sd", "rommix")
        write_app(moved, OWNER_TOKENS)
        os.makedirs(os.path.join(self.home, ".config", "rommix"))
        with open(os.path.join(self.home, ".config", "rommix", "root"), "w", encoding="utf-8") as handle:
            handle.write(moved + "\n")
        self.assertEqual(self.find()[0], "rommix")
        elsewhere = os.path.join(self.tmp.name, "env", "rommix")
        write_app(elsewhere, {"accessToken": "env"})
        self.assertEqual(self.find(environ={"ROMMIX_HOME": elsewhere})[2]["accessToken"], "env")

    def test_galleon_home_in_the_environment_is_not_the_owners(self):
        test_home = os.path.join(self.tmp.name, "test-home")
        write_app(test_home, {"accessToken": "self"})
        self.assertEqual(self.find(environ={"GALLEON_HOME": test_home}), (None, None, None))

    def test_encrypted_missing_or_unusable_stores_are_passed_over(self):
        write_app(os.path.join(self.home, "galleon"), OWNER_TOKENS, magic=b"ENC1")
        self.assertEqual(self.find(), (None, None, None))
        write_app(os.path.join(self.home, "rommix"), {"refreshToken": "only"})
        self.assertEqual(self.find(), (None, None, None))
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS, server={"authMode": "token"})
        self.assertEqual(self.find(), (None, None, None))

    def test_a_server_without_an_auth_mode_gets_one_the_app_accepts(self):
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS, server={"baseUrl": "http://romm.test"})
        self.assertEqual(self.find()[1], {"baseUrl": "http://romm.test", "authMode": "token"})

    def test_the_test_home_is_made_empty_each_time(self):
        home = signin.fresh_home(self.test_dir)
        with open(os.path.join(home, "left-over"), "w", encoding="utf-8") as handle:
            handle.write("x")
        self.assertEqual(signin.fresh_home(self.test_dir), home)
        self.assertEqual(os.listdir(home), ["config"])

    def test_a_test_home_that_is_a_link_is_refused(self):
        target = os.path.join(self.tmp.name, "precious")
        os.makedirs(target)
        with open(os.path.join(target, "keep"), "w", encoding="utf-8") as handle:
            handle.write("x")
        os.makedirs(self.test_dir)
        os.symlink(target, os.path.join(self.test_dir, "home"))
        with self.assertRaises(RuntimeError):
            signin.fresh_home(self.test_dir)
        self.assertEqual(os.listdir(target), ["keep"])

    def test_the_written_home_has_sync_off_no_device_id_and_a_private_credentials_file(self):
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = signin.main(["--home", self.home, "prepare", "--test-dir", self.test_dir], environ={})
        self.assertEqual(code, 0)
        report = json.loads(out.getvalue())
        self.assertEqual(report["source"], "rommix")
        self.assertNotIn("acc", out.getvalue())
        self.assertNotIn("romm.test", out.getvalue())
        config = os.path.join(report["home"], "config")
        with open(os.path.join(config, "settings.json"), encoding="utf-8") as handle:
            settings = json.load(handle)
        self.assertEqual(settings["server"], SERVER)
        self.assertFalse(settings["settings"]["syncSavesUp"])
        self.assertFalse(settings["settings"]["syncSavesDown"])
        self.assertEqual(settings["settings"]["deviceId"], "")
        credentials_path = os.path.join(config, "credentials.bin")
        self.assertEqual(stat.S_IMODE(os.stat(credentials_path).st_mode), 0o600)
        with open(credentials_path, "rb") as handle:
            stored = handle.read()
        self.assertEqual(stored[:4], b"RAW1")
        written = json.loads(stored[4:])
        self.assertIsNone(written["refreshToken"])
        self.assertIsNone(written["deviceId"])

    def test_nothing_importable_skips_with_its_reason_and_still_makes_the_home(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = signin.main(["--home", self.home, "prepare", "--test-dir", self.test_dir], environ={})
        self.assertEqual(code, signin.EXIT_SKIPPED)
        report = json.loads(out.getvalue())
        self.assertEqual(report["reason"], "no-importable-credentials")
        config = os.path.join(report["home"], "config")
        self.assertEqual(os.listdir(config), ["settings.json"])
        with open(os.path.join(config, "settings.json"), encoding="utf-8") as handle:
            self.assertNotIn("server", json.load(handle))

    def test_the_import_changes_nothing_of_the_owners(self):
        write_app(os.path.join(self.home, "rommix"), OWNER_TOKENS)
        write_app(os.path.join(self.home, "galleon"), OWNER_TOKENS, magic=b"ENC1")
        spec = {"folders": ["rommix", "galleon"]}
        before = ownerstate.snapshot(self.home, spec)
        with contextlib.redirect_stdout(io.StringIO()):
            signin.main(["--home", self.home, "prepare", "--test-dir", self.test_dir], environ={})
        self.assertEqual(ownerstate.compare(before, ownerstate.snapshot(self.home, spec)), [])


if __name__ == "__main__":
    unittest.main()
