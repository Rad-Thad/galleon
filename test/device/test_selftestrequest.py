"""Unit tests for selftestrequest.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import tempfile
import unittest

import selftestrequest

SHA = "a" * 40


class SelfTestRequestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        os.mkdir(self.home)
        self.results = os.path.join(self.tmp.name, "results")

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = selftestrequest.main(list(args))
        return code, err.getvalue()

    def write(self, *extra):
        return self.run_cli("write", "--home", self.home, "--sha", SHA, "--budget", "600",
                            "--results", self.results, "--check", "selftest.complete", *extra)

    def read(self):
        with open(os.path.join(self.home, selftestrequest.NAME), encoding="utf-8") as handle:
            return json.load(handle)

    def test_writes_a_private_request_that_always_asks_for_the_safeguards(self):
        code, err = self.write("--version", "0.21.0", "--check", "startup.cold",
                               "--profile", "performance", "--payload", "retroarch=payloads/snes/hello.sfc",
                               "--saving", "retroarch", "--handshake", os.path.join(self.tmp.name, "hs"))
        self.assertEqual(code, 0, err)
        record = self.read()
        self.assertEqual(record["checks"], ["selftest.complete", "startup.cold"])
        self.assertEqual(record["payloads"], {"retroarch": "payloads/snes/hello.sfc"})
        self.assertEqual(record["savingPayloads"], ["retroarch"])
        self.assertEqual(record["version"], "0.21.0")
        self.assertEqual((record["readOnlyServer"], record["privacy"], record["abortOnInput"]),
                         (True, True, True))
        self.assertIsNone(record["fakeRomm"])
        self.assertEqual(os.stat(os.path.join(self.home, selftestrequest.NAME)).st_mode & 0o777, 0o600)

    def test_no_version_leaves_the_field_out(self):
        self.assertEqual(self.write()[0], 0)
        self.assertNotIn("version", self.read())

    def test_refuses_what_the_app_would_refuse_and_writes_nothing(self):
        cases = [
            ("--sha", "abc"),
            ("--version", "0.21.0; rm"),
            ("--budget", "0"),
            ("--results", "relative/results"),
            ("--handshake", "relative/hs"),
            ("--saving", "dolphin"),
        ]
        for flag, value in cases:
            with self.subTest(flag=flag):
                args = ["write", "--home", self.home, "--sha", SHA, "--budget", "600",
                        "--results", self.results, "--check", "selftest.complete"]
                if flag in args:
                    args[args.index(flag) + 1] = value
                else:
                    args += [flag, value]
                code, _ = self.run_cli(*args)
                self.assertEqual(code, selftestrequest.ERROR_EXIT)
                self.assertFalse(os.path.exists(os.path.join(self.home, selftestrequest.NAME)))

    def test_no_check_is_refused(self):
        code, _ = self.run_cli("write", "--home", self.home, "--sha", SHA, "--budget", "600",
                               "--results", self.results)
        self.assertEqual(code, selftestrequest.ERROR_EXIT)

    def test_a_home_that_is_a_link_is_never_written_through(self):
        os.rmdir(self.home)
        elsewhere = os.path.join(self.tmp.name, "owner")
        os.mkdir(elsewhere)
        os.symlink(elsewhere, self.home)
        self.assertEqual(self.write()[0], selftestrequest.ERROR_EXIT)
        self.assertEqual(os.listdir(elsewhere), [])

    def test_remove_never_reaches_through_a_linked_home(self):
        os.rmdir(self.home)
        elsewhere = os.path.join(self.tmp.name, "owner")
        os.mkdir(elsewhere)
        with open(os.path.join(elsewhere, selftestrequest.NAME), "w", encoding="utf-8") as handle:
            handle.write("{}")
        os.symlink(elsewhere, self.home)
        self.assertEqual(self.run_cli("remove", "--home", self.home)[0], selftestrequest.ERROR_EXIT)
        self.assertEqual(os.listdir(elsewhere), [selftestrequest.NAME])

    def test_a_link_where_the_request_goes_is_replaced_not_followed(self):
        owner = os.path.join(self.tmp.name, "owner.json")
        with open(owner, "w", encoding="utf-8") as handle:
            handle.write("{}")
        os.symlink(owner, os.path.join(self.home, selftestrequest.NAME))
        self.assertEqual(self.write()[0], 0)
        self.assertFalse(os.path.islink(os.path.join(self.home, selftestrequest.NAME)))
        with open(owner, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "{}")

    def test_remove_takes_the_request_and_the_taken_copy(self):
        self.write()
        os.rename(os.path.join(self.home, selftestrequest.NAME),
                  os.path.join(self.home, selftestrequest.TAKEN))
        self.write()
        self.assertEqual(self.run_cli("remove", "--home", self.home)[0], 0)
        self.assertEqual(os.listdir(self.home), [])
        self.assertEqual(self.run_cli("remove", "--home", self.home)[0], 0)


if __name__ == "__main__":
    unittest.main()
