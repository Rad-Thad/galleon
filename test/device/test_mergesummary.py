"""Unit tests for mergesummary.py: python3 -m unittest discover -s test/device"""

import contextlib
import io
import json
import os
import tempfile
import unittest

import mergesummary

SHA = "a" * 40


def check(cid, result="pass", reason=None, evidence=()):
    return {"id": cid, "result": result, "metrics": {}, "thresholds": {},
            "reason": reason, "evidence": list(evidence)}


class MergeSummaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.harness = os.path.join(self.dir, ".harness-summary.json")
        self.app = os.path.join(self.dir, "app", "summary.json")
        os.mkdir(os.path.dirname(self.app))
        self.out = os.path.join(self.dir, "summary.json")
        self.write_harness()

    def tearDown(self):
        self.tmp.cleanup()

    def write_harness(self, status="complete", owner="pass", extra=()):
        with open(self.harness, "w", encoding="utf-8") as handle:
            json.dump({"schema": 1, "sha": SHA, "version": "0.21.0", "status": status,
                       "reason": None, "startedAt": "2026-10-13T10:00:00Z",
                       "finishedAt": "2026-10-13T10:20:00Z",
                       "checks": [check("harness.run"), check("safety.owner-state", owner), *extra],
                       "notes": ["app: exited 0"]}, handle)

    def write_app(self, **fields):
        summary = {"schema": 1, "sha": SHA, "version": "0.21.0", "status": "complete",
                   "reason": None, "device": {"model": "Retroid Pocket Nova"},
                   "power": {"acOnline": True},
                   "safety": {"serverWritesAttempted": 0, "deviceIdOnSaveRequests": 0,
                              "ownerStateChanged": [], "romsDownloadedBytes": 0, "romsLeft": 0},
                   "checks": [check("selftest.complete", evidence=["logs/selftest.log"]),
                              check("grid.scroll@performance", "fail", "p95 over",
                                    ["shots/grid.png"])],
                   "notes": ["one note"]}
        summary.update(fields)
        with open(self.app, "w", encoding="utf-8") as handle:
            json.dump(summary, handle)

    def write_raw(self, text):
        with open(self.app, "w", encoding="utf-8") as handle:
            handle.write(text)

    def run_cli(self, sha=SHA):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = mergesummary.main(["--harness", self.harness, "--app", self.app,
                                      "--sha", sha, "--out", self.out])
        return code, err.getvalue()

    def merged(self):
        with open(self.out, encoding="utf-8") as handle:
            return json.load(handle)

    def test_the_app_checks_follow_the_harness_with_evidence_in_the_app_folder(self):
        self.write_app()
        self.assertEqual(self.run_cli(), (0, ""))
        merged = self.merged()
        self.assertEqual(merged["status"], "complete")
        self.assertEqual([c["id"] for c in merged["checks"]],
                         ["harness.run", "safety.owner-state", "selftest.complete",
                          "grid.scroll@performance"])
        self.assertEqual(merged["checks"][2]["evidence"], ["app/logs/selftest.log"])
        self.assertEqual(merged["checks"][3]["reason"], "p95 over")
        self.assertEqual(merged["device"], {"model": "Retroid Pocket Nova"})
        self.assertEqual(merged["safety"]["serverWritesAttempted"], 0)
        self.assertEqual(merged["startedAt"], "2026-10-13T10:00:00Z")
        self.assertEqual(merged["notes"],
                         ["app: exited 0", "app summary: complete", "app: one note"])
        self.assertFalse(os.path.exists(os.path.join(self.dir, ".summary.json.tmp")))

    def test_no_summary_from_the_app_makes_the_run_partial(self):
        self.assertEqual(self.run_cli(), (0, ""))
        merged = self.merged()
        self.assertEqual(merged["status"], "partial")
        self.assertEqual(len(merged["checks"]), 2)
        self.assertIn("app summary: wrote no summary", merged["notes"])

    def test_a_summary_it_cannot_trust_is_left_out(self):
        cases = {
            "another commit": lambda: self.write_app(sha="b" * 40),
            "not JSON": lambda: self.write_raw("{"),
            "not an object": lambda: self.write_raw("[]"),
            "no status": lambda: self.write_app(status="fine"),
            "no checks": lambda: self.write_app(checks={}),
            "too large": lambda: self.write_raw(" " * (mergesummary.MAX_APP_BYTES + 1)),
        }
        for why, make in cases.items():
            with self.subTest(why):
                make()
                self.assertEqual(self.run_cli()[0], 0)
                merged = self.merged()
                self.assertEqual(merged["status"], "partial")
                self.assertEqual([c["id"] for c in merged["checks"]],
                                 ["harness.run", "safety.owner-state"])
                self.assertTrue(any(n.startswith("app summary: ") for n in merged["notes"]))
                os.remove(self.app)

    def test_a_linked_summary_is_not_followed(self):
        real = os.path.join(self.dir, "elsewhere.json")
        self.write_app()
        os.rename(self.app, real)
        os.symlink(real, self.app)
        self.run_cli()
        self.assertEqual(self.merged()["status"], "partial")
        self.assertEqual(len(self.merged()["checks"]), 2)

    def test_a_check_that_does_not_keep_the_schema_is_left_out_and_the_run_is_partial(self):
        bad = [
            check("Not An Id"),
            check("a.b", "maybe"),
            check("a.c", "skip"),
            dict(check("a.d"), metrics={"x": [1]}),
            dict(check("a.e"), thresholds={"x": "1"}),
            check("a.f", evidence=["../owner/secret.txt"]),
            check("a.g", evidence=["/etc/passwd"]),
            check("harness.run", "fail", "the app says so"),
            "not a check",
        ]
        self.write_app(checks=[check("selftest.complete"), *bad])
        self.run_cli()
        merged = self.merged()
        self.assertEqual(merged["status"], "partial")
        self.assertEqual([c["id"] for c in merged["checks"]],
                         ["harness.run", "safety.owner-state", "selftest.complete"])
        self.assertEqual(merged["checks"][0]["result"], "pass")
        self.assertIn(f"app summary: {len(bad)} check(s) left out, not keeping the schema"
                      " or repeating an id", merged["notes"])

    def test_notes_that_are_not_a_list_are_left_out_and_the_checks_kept(self):
        for notes in (5, "abc"):
            with self.subTest(notes=notes):
                self.write_app(notes=notes)
                self.assertEqual(self.run_cli(), (0, ""))
                merged = self.merged()
                self.assertEqual(merged["status"], "complete")
                self.assertEqual(len(merged["checks"]), 4)
                self.assertIn("app summary: notes left out, not a list", merged["notes"])
                self.assertFalse(any(n in ("app: a", "app: b") for n in merged["notes"]))

    def test_the_app_status_and_reason_carry_into_the_run(self):
        for app_status, harness_status, expected in [
            ("partial", "complete", "partial"),
            ("error", "complete", "partial"),
            ("complete", "partial", "partial"),
        ]:
            with self.subTest(app_status=app_status, harness_status=harness_status):
                self.write_harness(harness_status)
                self.write_app(status=app_status, reason="budget")
                self.assertEqual(self.run_cli()[0], 0)
                self.assertEqual(self.merged()["status"], expected)
                self.assertIn(f"app summary: {app_status} (budget)", self.merged()["notes"])

    def test_an_abort_by_the_player_exits_20(self):
        self.write_app(status="aborted-by-user", reason="aborted-by-user")
        self.assertEqual(self.run_cli()[0], mergesummary.ABORTED_EXIT)
        merged = self.merged()
        self.assertEqual((merged["status"], merged["reason"]), ("aborted-by-user", "aborted-by-user"))

    def test_an_abort_with_a_failed_harness_check_is_published_as_partial(self):
        self.write_harness(owner="fail")
        self.write_app(status="aborted-by-user")
        self.assertEqual(self.run_cli()[0], 0)
        merged = self.merged()
        self.assertEqual(merged["status"], "partial")
        self.assertIn("aborted by the player, reported for the harness's failed checks",
                      merged["notes"])

    def test_an_abort_with_a_skipped_harness_check_is_still_an_abort(self):
        # A skip found nothing wrong, so the retry the abort brings loses nothing.
        self.write_harness(extra=[check("argosy.shapes", "skip", "no-importable-credentials")])
        self.write_app(status="aborted-by-user", reason="aborted-by-user")
        self.assertEqual(self.run_cli()[0], mergesummary.ABORTED_EXIT)
        self.assertEqual(self.merged()["status"], "aborted-by-user")

    def test_an_abort_with_a_failed_argosy_report_is_published_as_partial(self):
        self.write_harness(extra=[check("argosy.shapes", "fail", "the server could not be read")])
        self.write_app(status="aborted-by-user")
        self.assertEqual(self.run_cli()[0], 0)
        self.assertEqual(self.merged()["status"], "partial")

    def test_it_refuses_a_short_sha_or_another_run_s_harness_summary(self):
        self.write_app()
        self.assertEqual(self.run_cli("abc")[0], mergesummary.ERROR_EXIT)
        self.assertEqual(self.run_cli("b" * 40)[0], mergesummary.ERROR_EXIT)
        self.assertFalse(os.path.exists(self.out))


if __name__ == "__main__":
    unittest.main()
