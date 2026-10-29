#!/usr/bin/env python3
"""The run's one summary: run.sh's checks with the app's (docs/PLAN.md
section 5.3, step 10).

The app writes its own `summary.json` into the folder run.sh gave it
(`RESULTS_DIR/app/`, selftestrequest.py), and the bridge publishes only
`RESULTS_DIR/summary.json`'s checks. This merges the two. The harness's
summary is the base: its checks, its version and its times stand, and the
app's checks follow them with their evidence made relative to the result
folder. Nothing the app wrote is trusted further than the schema in
docs/TESTING.md: an app summary for another commit, one that cannot be
read, or a check that does not keep the schema is left out, and the run is
then `partial` with a note saying why, never `complete`.

The app stopped by the player makes the run `aborted-by-user`, which the
bridge does not publish, unless a harness check failed: the bridge
retries an aborted run later, so a failure found in this one, above all
`safety.owner-state`, would otherwise never reach the results.

  mergesummary.py --harness PATH --app PATH --sha SHA --out PATH

Exits 0 once the merged summary is written, ABORTED_EXIT when it says
`aborted-by-user`, and ERROR_EXIT when nothing could be written.
"""

import argparse
import json
import math
import os
import re
import stat
import sys

ABORTED_EXIT = 20
ERROR_EXIT = 3
# Where the app's results sit inside the result folder; its evidence paths
# are relative to it.
APP_DIR = "app"
# Far beyond what any sound app summary holds; it keeps a runaway file from
# being read whole.
MAX_APP_BYTES = 1 << 20

# The patterns the app holds its own summary to (selftest.ts, summaryErrors).
SHA = re.compile(r"[0-9a-f]{40}")
CHECK_ID = re.compile(r"[a-z0-9-]+(\.[a-z0-9-]+)+(@[a-z0-9-]+)?")
STATUSES = ("complete", "partial", "skipped", "aborted-by-user", "error", "withheld")
RESULTS = ("pass", "fail", "skip", "error")
# What only the app measures, taken from its summary as they stand.
APP_FIELDS = ("device", "power", "safety")


class MergeError(ValueError):
    pass


def read_app(path, sha):
    """The app's summary as a dict, or MergeError saying why it cannot count."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        raise MergeError("wrote no summary") from None
    except OSError as cause:
        raise MergeError(f"summary unreadable ({cause.__class__.__name__})") from None
    with os.fdopen(fd, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise MergeError("summary is not a file")
        raw = handle.read(MAX_APP_BYTES + 1)
    if len(raw) > MAX_APP_BYTES:
        raise MergeError("summary too large")
    try:
        app = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise MergeError("summary is not JSON") from None
    if not isinstance(app, dict):
        raise MergeError("summary is not an object")
    if app.get("sha") != sha:
        raise MergeError("summary is for another commit")
    if app.get("status") not in STATUSES:
        raise MergeError("summary has no status")
    if not isinstance(app.get("checks"), list):
        raise MergeError("summary has no checks")
    return app


def app_path(path):
    """`path` relative to the result folder, or None when it reaches outside the app's."""
    if not isinstance(path, str) or not path or path.startswith(("/", "\\")):
        return None
    parts = re.split(r"[\\/]", path)
    if ".." in parts or "" in parts:
        return None
    return "/".join([APP_DIR, *parts])


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def app_check(check):
    """The check as the run reports it, or None when it does not keep the schema."""
    if not isinstance(check, dict):
        return None
    cid, result, reason = check.get("id"), check.get("result"), check.get("reason")
    metrics, thresholds, evidence = check.get("metrics"), check.get("thresholds"), check.get("evidence")
    if not (isinstance(cid, str) and CHECK_ID.fullmatch(cid) and result in RESULTS):
        return None
    if not (reason is None or isinstance(reason, str)) or (result == "skip" and reason is None):
        return None
    if not (isinstance(metrics, dict) and all(
            m is None or isinstance(m, str) or is_number(m) for m in metrics.values())):
        return None
    if not (isinstance(thresholds, dict) and all(is_number(t) for t in thresholds.values())):
        return None
    if not isinstance(evidence, list):
        return None
    paths = [app_path(p) for p in evidence]
    if None in paths:
        return None
    return {"id": cid, "result": result, "metrics": metrics, "thresholds": thresholds,
            "reason": reason, "evidence": paths}


def merge(harness, app_file, sha):
    """The merged summary: `harness` with the app's checks, status and notes."""
    merged = dict(harness)
    checks = list(harness.get("checks", []))
    notes = list(harness.get("notes", []))
    harness_failed = any(c.get("result") == "fail" for c in checks)
    status = harness.get("status")
    try:
        app = read_app(app_file, sha)
    except MergeError as why:
        notes.append(f"app summary: {why}")
        merged.update(status="partial" if status == "complete" else status, checks=checks, notes=notes)
        return merged

    taken = {c.get("id") for c in checks}
    dropped = 0
    for raw in app["checks"]:
        check = app_check(raw)
        if check is None or check["id"] in taken:
            dropped += 1
            continue
        taken.add(check["id"])
        checks.append(check)
    for field in APP_FIELDS:
        if isinstance(app.get(field), dict):
            merged[field] = app[field]
    app_status = app["status"]
    reason = app.get("reason") if isinstance(app.get("reason"), str) else None
    notes.append(f"app summary: {app_status}" + (f" ({reason})" if reason else ""))
    app_notes = app.get("notes")
    if isinstance(app_notes, list):
        notes.extend(f"app: {n}" for n in app_notes if isinstance(n, str))
    elif app_notes is not None:
        notes.append("app summary: notes left out, not a list")
    if dropped:
        notes.append(f"app summary: {dropped} check(s) left out, not keeping the schema or repeating an id")

    if app_status == "aborted-by-user" and not harness_failed and status == "complete":
        status = "aborted-by-user"
        merged["reason"] = reason or "aborted-by-user"
    elif app_status == "aborted-by-user" and status == "complete":
        status = "partial"
        notes.append("aborted by the player, reported for the harness's failed checks")
    elif status == "complete" and (app_status != "complete" or dropped):
        status = "partial"
    merged.update(status=status, checks=checks, notes=notes)
    return merged


def write_json(path, value):
    tmp = os.path.join(os.path.dirname(path) or ".", f".{os.path.basename(path)}.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--harness", required=True)
    parser.add_argument("--app", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if not SHA.fullmatch(args.sha):
        print("mergesummary: not a full commit sha", file=sys.stderr)
        return ERROR_EXIT
    try:
        with open(args.harness, encoding="utf-8") as handle:
            harness = json.load(handle)
        if not isinstance(harness, dict) or harness.get("sha") != args.sha:
            raise ValueError("not this run's harness summary")
        merged = merge(harness, args.app, args.sha)
        write_json(args.out, merged)
    except (OSError, ValueError) as cause:
        print(f"mergesummary: {cause}", file=sys.stderr)
        return ERROR_EXIT
    return ABORTED_EXIT if merged["status"] == "aborted-by-user" else 0


if __name__ == "__main__":
    sys.exit(main())
