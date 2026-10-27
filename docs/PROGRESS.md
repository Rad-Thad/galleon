# Progress log

Append-only. Newest entry at the bottom. Never edit or delete an earlier entry: if one was wrong, add a new entry that says so.

## Entry template

```
## <YYYY-MM-DD HH:MM UTC> session <CLAUDE_CODE_REMOTE_SESSION_ID or "local"> (<project thread | routine run | interactive>)

- Device results: <DEVICE-RESULTS <sha> <status> lines ingested | none new | bridge last seen <time>>
- Worked on: <feature id(s) or issue #n>
- Result: <merged PR #n | PR #n open, waiting on <what> | blocked: <why>>
- Evidence: <commands run and outcome; screenshot paths; CI run links>
- CI wall time: <x64 m:ss, arm64 m:ss per PR>
- Evaluator: <PASS/FAIL summary>
- Device / acceptance: <READY-FOR-DEVICE <id> | READY-FOR-ACCEPTANCE <id> | PASSES <id> device:<sha> | PASSES <id> acceptance:<date> | none>
- Next: <the next eligible feature, or what is blocking>
- Notes: <surprises, decisions taken, safe defaults adopted, anything a cold session must know>
```

Lines the tooling reads (exact forms):

- `READY-FOR-DEVICE <id>`: the feature's code and its device checks are merged; the next nightly carries them. Written in the PR that merges the feature, so its commit marks the first build that contains it.
- `READY-FOR-ACCEPTANCE <id>`: the feature is implemented and its `Acceptance session:` steps are written; `scripts/agent/acceptance.mjs` includes it.
- `PASSES <id> device:<sha>`: `passes` was flipped on the evidence of `results/<sha>/summary.json` on `device-results`.
- `PASSES <id> acceptance:<date>`: `passes` was flipped on the evidence of `acceptance/<date>/results.json`.
- `DEVICE-RESULTS <sha> <status>`: a device result was ingested; the next session starts after it.
- `DEVICE-REPORT <time>/<report>`: a problem report on `device-results` was ingested and its bug opened; it is not opened again.
- `ACCEPTANCE-RESULTS <date>`: `acceptance/<date>/results.json` was ingested; its passes flipped and its fails became `[acceptance]` bugs.

---

## 2026-10-08 handoff (written by the local research session, before the repository existed)

- **State:** the handoff kit was prepared on top of RomMix. The cloud agent has done no work yet.
- **Upstream:**
  - The plan was written against upstream's tip on 2026-10-08, commit `990e55e3855db5ef0c92324283664b71f14fd37d`. Its CI is red: `npm run test:app` fails on x64 and arm64 after commits 68697e0 and 990e55e, which change controller listing.
  - The fork's base is the **v0.20.0** tag, commit `ea787b98c32ce6efcd0c0448c0dac5aed074f3af`. Its CI is green, and it is exactly what the tester ran in Phase 0.
- **Phase 0:** done on 2026-10-08. All checks passed in Desktop Mode and in Game Mode. **Gate 0 = PASS: proceed with the RomMix fork.** The results and their caveats are in docs/PLAN.md, PHASE 0 RESULTS; each caveat is mapped to a feature. Main findings:
  - Lag happens only on Armada's Balanced power profile; Performance is smooth and hardware-accelerated.
  - Holding Start already quits RetroArch gracefully.
  - Only RetroArch was detected.
  - Games went to internal storage.
  - An address without `http://` failed.
  - The Steam file picker is broken; a `.desktop` entry is the workaround.
  - Credentials are stored in plain text (mode 0600).
  - Platform icons return 404 on 5.2.0.
  - Manual paths are refused.
- **Kit contents:**
  - CLAUDE.md
  - docs/PLAN.md
  - docs/features.json (150 features: M0 20, M1 29, M2 19, M3 9, M4 34, M5 5, M6 15, M7 13, M8 6; all `passes: false`)
  - this log
  - ADRs 0001 and 0002
  - docs/TESTING.md
  - docs/KICKOFF-PROMPT.md
  - `.github/ISSUE_TEMPLATE/` (bug, tester-result, feature-request, config) and `.github/labels.yml`
  - `.claude/agents/evaluator.md`
  - `.prettierignore` (upstream's file plus `docs/research` and `reference`)
  - docs/research/ (the report and seven notes, local paths scrubbed, plus an extract of the tester's Argosy-fork design spec)
  - reference/ (the RomM 5.2.0 OpenAPI spec captured from the tester's server, and the superseded prototype)
- **Removed from upstream in the overlay commit:**
  - `.claude/skills/` (its `update` skill commits straight to main)
  - `.agents/`, `skills-lock.json`
  - `.github/FUNDING.yml`
  - `.github/workflows/pages.yml`
  - `.github/ISSUE_TEMPLATE/emulator.yml`
- **Next:** M0-01, then M0-02 (docs/KICKOFF-PROMPT.md, section 1). The next device decision point is **Gate 1**.
- **Owner setup still needed:** HANDOFF.md steps 3-8 (ruleset with the two `build (...)` checks, `release` environment, Claude GitHub App, cloud environment, Routine and its secrets).

## 2026-10-08 revision: autonomous verification (written by the local research session, before the kit was pushed)

- **Decision:** the owner will not report bugs or test during development (REQUIREMENTS-FROM-TESTER.md, item 15). ADR 0003 replaces the tester loop with the device bridge on the Nova and one final acceptance session. The name **Galleon** is final.
- **Repository:** `github.com/Rad-Thad/galleon` exists, public, `main` = RomMix v0.20.0 (`ea787b98`), RomMix's tags not pushed. First CI run 37748807485 plus a rerun: green legs took x64 3.5 min and arm64 3.3 min, but the same commit was flaky:
  - x64 `npm test`: "a transfer that cannot be resumed is not interrupted" and "changing the order of the queue" (ENOENT on per-test temporary log and download folders during teardown);
  - x64 `npm run test:app`: 15 s timeouts in "pausing one stops it where it is, and it picks up from there", "and cancelling throws it away rather than pausing it" and "driving the queue from the activity tab";
  - arm64 `npm run package -- --arm64`: `getaddrinfo EAI_AGAIN github.com` while electron-builder fetched its assets.
    That is now **M0-00, the first unit of work**.
- **Dependabot:** PRs #1 (electron 44.4.5 to 44.5.1, CI red), #2 (tooling group, CI red), #3 (lucide-react, CI green) are open. Triage after M0-00 merges; an Electron update also needs a clean device run after it (CLAUDE.md rule 8).
- **Kit changes:**
  - features.json now has 158 features (M0 25, M1 30, M2 20, M3 9, M4 34, M5 5, M6 15, M7 13, M8 7), with verification types ci 51, agent-screenshot 31, device 66, acceptance 10 and no `tester`. New: M0-00 (green baseline), M0-21 (self-test mode), M0-22 (device test bundle), M0-23 (device results ingestion), M0-24 (nightly), M1-30 (import stock RomMix's sign-in), M2-20 (fake RomM on the device), M8-07 (acceptance session). Repurposed: M0-12 (reports through the bridge), M0-15 (acceptance backlog), M0-16 (labels, no secrets), M1-20 (Gate 1 from device metrics), M2-02 (read-only Argosy save shapes), M2-08 and M1-28 (decisions with safe defaults), M2-19 (Gate 2 in the acceptance session).
  - New: ADR 0003, `tools/device-bridge/` (the bridge, its tests and systemd units), `docs/cloud-environment-setup.sh`. Rewritten: HANDOFF.md, CLAUDE.md, TESTING.md, KICKOFF-PROMPT.md (Project instructions, kickoff, heartbeat Routine), the evaluator, PLAN.md sections 1 and 3 to 12 (CI time budget in section 4, the bridge contract in section 5). Removed: the tester-result issue form and the tester labels.
- **Superseded in the handoff entry above:** the feature count (now 158, all still `passes: false`), the removed upstream file list (unchanged), and "Owner setup still needed: HANDOFF.md steps 3-8", which the new HANDOFF.md replaces (Claude GitHub App, cloud environment, Project, heartbeat Routine; the local session does the rest, including the bridge install and its deploy key).
- **Next:** M0-00 (docs/KICKOFF-PROMPT.md, section 2).

## 2026-10-08 15:40 UTC session cloud (project thread)

- Device results: none yet (`origin/device-results` does not exist; the bridge waits for the first `nightly`, M0-24).
- Worked on: M0-00 (tracking issue #4).
- Result: PR #6. Both `build` legs green on the first push.
- Evidence: flaky tests, root causes and fixes (none skipped, retried, quarantined or given a longer timeout):
  - `src/main/downloads.test.ts` teardown ENOTEMPTY/ENOENT (CI: "a promoted transfer takes the place of the one on the wire"). Root cause: tests ended while the queue's drain still wrote into the scratch root, so `rmSync` raced it. Fix: `DownloadManager.whenIdle()`; the teardown releases held transfers, awaits every queue, closes the log, then restores `ROMMIX_HOME` and removes folders.
  - `logging to file stopped: ENOENT .../logs/app.log` in every suite that sets `ROMMIX_HOME`. Root cause: the logger caches its path into the first test's root for the whole process. Fix: `log.close()`, called before a suite removes a root.
  - "a transfer that cannot be resumed is not interrupted" (`'done' !== 'downloading'`) and four siblings. Root cause: the fake transfer finished within a few turns, so "on the wire" was a race. Fix: `heldWire` holds the fake until released; tests wait for the `downloading` update.
  - "a transfer stopped by the user keeps what it had" (`never settled`, found under load). Root cause: `settled` polled with a one-second deadline, and two tests slept 20 ms. Fix: event-driven waits with a backstop deadline; the sleeps became signals from the fakes.
  - "what is already on disk counts" (`'paused' !== 'done'`, found under load). Root cause: `/tmp` free space was read once and relied on with a 4 MiB margin while other files wrote to the same disk. Fix: gigabyte margins on a sparse file.
  - `src/main/connection.test.ts` "a server that never answers…" (cancelled the rest of the file), "it keeps asking…", "it asks far less often…" (found under load). Root cause: 2 ms timers paced by real sleeps, and an unref'd bound the process could outlive. Fix: `node:test` mock timers.
  - `test:app` "pausing one stops it where it is…" and "and cancelling throws it away…" (15 s timeouts). Root cause: the slow game is a two-second timer that could resume and finish between two polls. Fix: `FakeRomm.slowGame.allow/flow` meters it, so the states waited on hold still; the promote scenario asserts what persists.
  - `test/app/device.test.ts` "and asks RomM to record it when a save first needs a name" and the two after it (found by the first CI stress run, x64 run 11; the screenshot shows the game never downloaded). Root cause: the helper decided whether to download by looking for the Download button the moment the game screen appeared, before the screen knew the install state. Fix: ask the library (`window.rommix.library.installed()`), then wait for the button.
  - arm64 `npm run package` `getaddrinfo EAI_AGAIN github.com`. Root cause: electron-builder fetches Electron (and re-fetches `SHASUMS256.txt` even on a cache hit) inside the package step. Fix: `actions/cache` for `~/.cache/electron` and `~/.cache/electron-builder` keyed on `package-lock.json`; a warm-up step (`scripts/warm-package-cache.mjs`, 3 attempts with back-off); the package step gets the checked archive as `electronDist` and makes no network request. Packaging is never retried.
  - Local proof, before → after: `downloads.test.ts` 8-way parallel, 6/24 → 0/48 failing; `connection.test.ts` 10-way parallel, 2/50 → 0/50; `games.test.ts` beside six busy loops, 2/4 → 0/8; full `npm test` 12/12 green (9 at load average 15); `test:app` 191/191; packaging with a dead proxy succeeded.
  - Stress runs (`.github/workflows/stress.yml`) on `ed99844`: [x64, 20 consecutive green runs of `npm test` + `npm run test:app`](https://github.com/Rad-Thad/galleon/actions/runs/37803616591/job/113402688744) (45 min), [arm64, 10](https://github.com/Rad-Thad/galleon/actions/runs/37803616591/job/113402688318) (22 min). The first stress run, on `54d7b46` ([run 37799454932](https://github.com/Rad-Thad/galleon/actions/runs/37799454932)), passed arm64 10/10 and failed x64 run 11 in `device.test.ts`, which is how that flake was found.
- CI wall time: x64 3:34, arm64 3:53 on the final head `ed99844` (first push: x64 3:09, arm64 3:17).
- Evaluator: first pass FAIL (this entry was missing; three comments stated durations; one comment in `release.yml` was stale). Fixed. Final verdict in PR #6.
- Device / acceptance: none (M0-00 is `ci`).
- Next: triage Dependabot #1-#3 (CLAUDE.md rule 8), then M0-01, then M0-02.
- Notes:
  - `npm run test:app` cannot run as root on the VM (Electron refuses root without `--no-sandbox`). Run it as an unprivileged user on a copy of the tree, with `chrome-sandbox` owned by root and mode 4755.
  - `npm run test:coverage` fails its 96% line floor on untouched v0.20.0 (95.44%). CI doesn't run it yet; M0-05 has to meet the floor with tests.
  - `npx install-electron` in the app-suite steps still downloads from github.com; M0-05's caching should cover it.
  - `scripts/warm-package-cache.mjs` imports electron-builder's internal `app-builder-lib/out/toolsets/linux.js`. An electron-builder update that moves it fails the warm-up loudly; adjust the import then.

## 2026-10-08 16:55 UTC session cloud (project thread)

- Device results: none yet (`origin/device-results` does not exist).
- Worked on: M0-01 (tracking issue #7). Dependabot triage started: asked for rebases of #2 and #3 onto the green baseline; #1 (Electron) held until the first device run on 44.4.5 exists, with a comment saying why (CLAUDE.md rule 8 needs a device baseline to compare against, and there is no nightly before M0-24).
- Result: PR #8.
- Evidence: on a fresh clone, the placeholder grep prints nothing, `.claude/skills/`, `.agents/` and `skills-lock.json` are absent, and `npm ci && npm run format:check && npm run lint && npm run typecheck && npm test` exits 0 with Node 24.21.0 (1237/1237). New `docs/UPSTREAM.md` records the upstream repo, the base `ea787b98…`, the studied commit `990e55e3…` and the porting rule (one port per PR, `Upstream:` trailer, never merged wholesale).
- CI wall time: x64 3:39, arm64 3:17.
- Evaluator: PASS.
- Device / acceptance: none (`ci`).
- Next: M0-02 (agent scripts). Merge #2 and #3 once Dependabot has rebased them and CI is green on the new baseline.
- Notes: M0-00 merged as #6 (8894542). `main`'s first push build was green, including `canary`.

## 2026-10-08 17:20 UTC session cloud (project thread)

- Device results: none yet (`origin/device-results` does not exist).
- Worked on: the prerequisite of M0-02 (tracking issue #9). `scripts/agent/check.sh` runs `npm run test:coverage`, and coverage failed its 96% line floor on untouched v0.20.0. Dependabot: #3 (lucide-react 1.52.0, ISC) merged after evaluator PASS and green CI; #2 (oxlint 1.86.0, @types/node 24.19.1) evaluator PASS, branch updated onto main after #3, merged once green.
- Result: PR #10.
- Evidence:
  - Line coverage 95.44% → 96.13% (branches 93.67, functions 95.64; floors 96/88/89 unchanged). New tests: `gamecontext.ts` 60% → 100% (cache fallback, never on 401/403; save and launch contexts and their errors), `gamepad.ts` 48% → 100% (repeat delay, dead zone, unmapped pads, suspended mode; a mutation check fails 3 tests), `scroll.ts` 71% → 100%, `sound.ts` 58% → 100% (the no-audio case in its own file, so its own process).
  - `transfer.ts`: no transfer returns while its file is still open. `pipeline()` settles before the write stream closes, and after an abort the open can still be in flight, so the partial appeared after the transfer had rejected (`romm.test.ts` "a cancelled transfer is not picked up again", ENOTEMPTY). New test "a transfer that has returned has stopped touching the disk" slows `fs.open`: it failed 3 of 3 before the fix (checked by the evaluator too) and passes after. `romm.test.ts` 10-way parallel: 1/40 → 0/60 failing.
  - The note in the 15:40 entry that coverage fails its floor is superseded: it passes now. CI does not run coverage yet (M0-05).
- CI wall time: x64 3:38, arm64 3:16.
- Evaluator: first pass FAIL (this entry was missing). Final verdict in PR #10.
- Device / acceptance: none.
- Next: M0-02's scripts (init, check, next, the Stop and SessionStart hooks), drafted and waiting for this to merge.
- Notes:
  - `src/main/fetchfile.ts` and `src/main/zip.ts` also pipe into `createWriteStream` without waiting for `close`. No flake points there yet; if one does, the fix is the same.
  - The line floor has little margin (96.13 against 96). New code needs its tests in the same PR.
  - Dependabot `@dependabot` commands cannot be posted from this environment (the mention arrives mangled). Use `PUT /pulls/{n}/update-branch` instead.

## 2026-10-08 17:35 UTC session cloud (project thread)

- Device results: none ingested. `origin/device-results` now exists: `bridge/status.json` says bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet (M0-24). No `results/` yet.
- Worked on: M0-02 (tracking issue #9).
- Result: PR #11.
- Evidence: `scripts/agent/init.sh` twice on the cloud VM, exit 0 in 20 s then 1 s; its failure messages (wrong Node, no Docker, a stopped daemon, RomM never healthy) are tested as processes in `scripts/agent/agent.test.ts`, as are `next.mjs`'s order and Gate 1 marking, the Stop hook (in a throwaway repository) and the SessionStart hook. `scripts/agent/check.sh` green in 39 s; shellcheck clean. `passes: true` for M0-00 (#6) and M0-01 (#8).
- CI wall time: x64 3:26, arm64 3:21.
- Evaluator: PASS.
- Device / acceptance: none (`ci`).
- Next: M0-24 (the first `nightly` the bridge is waiting for) needs M0-21/M0-22 per its depends_on; `node scripts/agent/next.mjs` lists M0-03, M0-04, M0-06, M0-16, M0-19 and M0-20 as eligible. M0-03 (features guard) is the lowest id.
- Notes:
  - `.claude/settings.json` now registers a Stop hook: a turn that changed `src/`, `test/`, `packaging/`, `scripts/` or `native/` does not end while `check.sh` fails.
  - `init.sh`'s RomM step assumes M0-06's layout (`test/romm/compose.yml`, `--profile v520`, `test/romm/provision.mjs`, heartbeat on `GALLEON_ROMM_URL`, default `http://127.0.0.1:3000`). M0-06 matches it or changes it.
  - Dependabot #1 (Electron 44.5.1) stays held until the first device run on 44.4.5.

## 2026-10-08 18:10 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json`: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: owner issue #5, the parts that do not wait for M0-24 (tracking issue #12).
- Result: PR #13.
- Evidence: ADR 0004 records the any-hour window and the per-merge `nightly` publish. PLAN.md section 4 (release.yml's per-merge publish step under the `nightly` concurrency group; nightly.yml's early-exit reference), section 5 (shape, window, risks), TESTING.md, HANDOFF.md and the bridge README no longer say testing happens overnight. New bridge unit test `test_equal_ends_mean_any_hour` pins that `00:00-00:00` is the whole day; the bridge program itself is unchanged, so no version bump. `scripts/agent/check.sh` green; `python3 -m unittest discover -s tools/device-bridge` 21/21.
- CI wall time: x64 3:10, arm64 3:35 (on 536feb1).
- Evaluator: first pass FAIL (HANDOFF.md still said overnight). Fixed. Second pass PASS.
- Device / acceptance: none.
- Next: M0-03 (lowest eligible id). M0-24 must include the per-merge publish (ADR 0004) when it is built.
- Notes: Docker's daemon was not running on this VM; `dockerd` started by hand before `init.sh` passed.
  - `scripts/agent/agent.test.ts` runs `git` in a throwaway repository with the caller's whole environment. Under the pre-commit hook that includes `GIT_INDEX_FILE`, so the test wrote its `docs/notes.md` into this repository's index and `git commit -a` (an absolute temporary index) fails every time with "invalid object … for 'docs/notes.md'"; `git add` then `git commit` works. Issue #15. Fix: drop `GIT_*` variables from those spawns, starting with a test that fails under a set `GIT_INDEX_FILE`.
  - `downloads.test.ts` "a transfer still waiting its turn pauses without ever starting" failed once in the pre-commit hook (the first, held transfer was already in `store.pending`). Issue #14 (`flaky`); root-cause fix due within two units of work.
  - For M0-24: GitHub keeps only one pending run per concurrency group, so a per-merge publish queued behind a running job can replace a pending scheduled nightly and skip that day's heavy suites. Give the heavy suites their own group, or have the scheduled run re-check after the publish.

## 2026-10-08 19:35 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json`: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: flaky issue #14 (claimed with `agent-working`).
- Result: PR #16.
- Evidence:
  - Root cause confirmed: the queue writes the first transfer's pending record before its first byte (`DownloadManager`'s `setPending` before the transfer), after some awaits, so whether it was on disk when the test read `store.pending` depended on timing. The assertion was about the queued second item but compared the whole list.
  - Reproduction: making the test wait until the first transfer is on the wire turned the old assertion into a failure every time (`actual: [ { romId: 1, … } ]`, the exact output from the issue).
  - Fix (test only): wait for the first transfer to reach `downloadRom`, then assert the records hold the first ROM and nothing of the second. `downloads.test.ts` 12 parallel runs: 12/12 green (65/65 each). `scripts/agent/check.sh` green.
- CI wall time: x64 3:30, arm64 3:10 (on 3c68ff3).
- Evaluator: PASS (its mutation check, a record written for the queued item, fails the test with `[1, 2]`).
- Device / acceptance: none.
- Next: issue #15 (agent.test.ts leaking into the index under `git commit -a`), then M0-03.

## 2026-10-08 20:40 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json`: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: issue #15 (agent.test.ts leaking into the repository's index under `git commit -a`), claimed with `agent-working`.
- Result: PR #17 (fixes #15).
- Evidence:
  - Reproduced: running `agent.test.ts` with `GIT_INDEX_FILE` set to a copy of `.git/index` put `docs/notes.md` into that copy.
  - New test "touches only its own repository when git's variables point elsewhere" sets `GIT_INDEX_FILE` to a scratch path: failed before the fix ("the caller's index was written to"), passes after. Fix (test only): `outsideGit()` drops `GIT_*` from the throwaway repository's `git` and Stop-hook spawns. 17/17, also under a set `GIT_INDEX_FILE`. `scripts/agent/check.sh` green (30 s). This commit was made with `git commit -a`.
- CI wall time: x64 3:12, arm64 3:16 (on be32a25).
- Evaluator: PASS (reverting only the fix fails the new test).
- Device / acceptance: none.
- Next: M0-03 (features guard), the lowest eligible id.

## 2026-10-08 21:27 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json`: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: M0-03 (tracking issue #18).
- Result: PR #19.
- Evidence:
  - `scripts/agent/features-check.mjs`: schema (the nine fields, the four verification types), unique ids, known `depends_on` and no cycle, every REQ-1..15, PARITY-1..48 and BEYOND-1..18 in some `source`, every `Device check` id in TESTING.md's catalogue (placeholders such as `launch.<emulator>` match one segment), every `device` feature naming one; with `--base`, only `passes` may change on an existing feature, none may disappear, and each flip needs its evidence (`device`: `PASSES <id> device:<sha>`, a `complete` or `partial` summary with every named check and both safety checks `pass`, and the `READY-FOR-DEVICE <id>` commit an ancestor of the sha; `acceptance`: `PASSES <id> acceptance:<date>` and a pass in that session's results; `ci` and `agent-screenshot`: the id named in the added PROGRESS lines).
  - `scripts/agent/features-check.test.ts`: one fixture per rule in `scripts/agent/fixtures/features-check/` (25), plus the catalogue reader, the real list, and the command in a throwaway repository with a base branch, a `device-results` ref and a `READY-FOR-DEVICE` commit (a valid device flip exits 0; a changed title and an unknown sha exit 1). 30/30. A line may name several checks (M1-11 names six, M7-03 two); every one is read.
  - CI: a `Check the feature list` step in `build` on x64, with the base branch fetched on a pull request; `scripts/agent/check.sh` runs it against `origin/main`. Before this entry existed, check.sh failed with "M0-02: flipped without being named in the PROGRESS entry".
  - `passes: true` for M0-02 (merged in #11, evaluator PASS there).
- CI wall time: x64 3:36, arm64 2:52 (on 3c6f8d0); x64 3:30, arm64 3:12 on the first commit.
- Evaluator: first pass FAIL (only the first check on a line was read, so M1-11 could flip with `exit.duckstation` failing). Fixed with fixtures for a second check on a line, plus `skipped`/`error`/`aborted-by-user` runs, and the command test now covers an unreadable base (exit 1). Second pass PASS (the earlier probe is now rejected; reading only the first check, counting `skipped` or `error` runs are each caught by a fixture).
- Device / acceptance: none (`ci`).
- Next: M0-04 (rebrand), M0-06, M0-16, M0-19 or M0-20; flip M0-03 in the next PR.
- Notes:
  - This run first pushed the work to `claude/M0-03-features-guard` by mistake; the PR is from the session branch. That stray branch cannot be deleted from here and holds nothing unmerged.
  - features.json's other features-check duties (the `.github/` secrets grep, the PROGRESS-per-session rule, PLAN.md's caveat list) belong to those features and extend this script when they land.

## 2026-10-08 21:55 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-16 (tracking issue #20).
- Result: PR #21.
- Evidence:
  - `.github/workflows/labels.yml`: on a push to `main` touching `.github/labels.yml` (or the workflow) and on `workflow_dispatch`, `crazy-max/ghaction-github-labeler` pinned to `548a7c3603594ec17c819e1239f281a3b801ab4d` (v6.0.0, MIT) with `skip-delete: true`; `issues: write` on that job only. Listed in the new `docs/DEPENDENCIES.md`. It first runs when this merges.
  - features-check now fails on `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` or `TESTER_LOGIN` in any file under `.github/` (`forbiddenNames`, unit-tested; a scratch `.github/zz.tmp` naming one made the command exit 1).
  - CLAUDE.md's session ritual step 5 already limits candidates to owner-authored issues and the agent's own `needs-human` issues past their date; unchanged.
  - `passes: true` for M0-03 (merged in #19, evaluator PASS there).
- CI wall time: x64 3:08, arm64 3:20 (on 44e9bb5).
- Evaluator: PASS (a nested `.github/zz/t.yml` and a line added to labels.yml, each naming a forbidden variable, both failed features-check; the pin verified as v6.0.0, MIT).
- Device / acceptance: none (`ci`).
- Next: M0-04, M0-06, M0-09, M0-18, M0-19 or M0-20 (`node scripts/agent/next.mjs`); flip M0-16 in the next PR once the labels workflow has run green on `main`.
- Notes:
  - The session branch still held #19's pre-squash commits, so the first push of this unit was rejected; it was force-pushed with a lease (only merged history was replaced).
  - Stopped after this unit: the run passed 35 minutes.

## 2026-10-08 22:26 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json`: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: M0-04 part 1 of 3 (tracking issue #22): the home folder, its pointer, the Electron profile and `GALLEON_HOME`.
- Result: PR #23.
- Evidence:
  - `src/main/root.ts`: the root resolves from `GALLEON_HOME`, then `~/.config/galleon/root`, then `~/galleon`; `ROMMIX_HOME` is never read (`homeFromEnvironment`). `src/main/index.ts` sets Electron's userData to `~/.config/Galleon` (`profilePath`) before the single-instance lock. `packaging/rommix-launcher.sh` resolves the same root; `--home=` in the Steam script sets `GALLEON_HOME`. Every suite that sandboxed itself with `ROMMIX_HOME` now uses `GALLEON_HOME`. Suites that never set it (the RomM and connection tests) still write `logs/app.log` into the default root, as they did into `~/rommix` before; now `~/galleon`, never stock RomMix's folder. A follow-up should sandbox them.
  - `root.test.ts` "beside stock RomMix": a machine holding `~/rommix`, `~/.config/rommix/root` and a `~/.config/rommix` profile keeps every one of those files byte for byte through `ensureRoot` and `relocateRoot`; `ROMMIX_HOME` is ignored; the profile is `~/.config/Galleon`. Pointing the pointer back at `rommix` fails four tests. The launcher's "never stock RomMix's" test finds nothing written under `ROMMIX_HOME` or RomMix's pointer. `scripts/agent/check.sh` green.
  - `passes: true` for M0-16: the Labels workflow ran green on `main` at 9b6792d (run 37851541086).
- CI wall time: pending.
- Evaluator: PASS (the stock-RomMix machine test, the launcher's matching resolution and every sandboxed suite checked; notes: the unsandboxed log above, and a comment in `index.ts` reworded so it no longer reads as contradicting the profile).
- Device / acceptance: none (`ci`).
- Next: M0-04 part 2 (packaging names, appId, `galleon-steam.sh`, updater endpoints from one repository constant), then part 3 (user-facing strings, README).

## 2026-10-08 22:47 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-04 part 2 of 3 (tracking issue #22): packaging names, appId, the Steam script, the updater's repository.
- Result: PR #24. Part 1, PR #23, merged at 6e706a0; its CI wall time was x64 3:16, arm64 3:28 (on e938bb0).
- Evidence:
  - `electron-builder.yml`: appId `io.github.Rad-Thad.Galleon`, product `Galleon`, executable `galleon`, images `Galleon-<arch>.AppImage`, Steam script shipped as `galleon-steam.sh` (source file name kept, ADR 0001). `package.json` `desktopName` and `scripts/after-pack.mjs` follow.
  - The Steam script starts only a `Galleon-*.AppImage` beside it ("and stock RomMix's image beside it is not one to start": exit 1, nothing run).
  - `src/main/update.ts`: one `REPOSITORY` constant builds every release, canary and page address; `updater.test.ts` asserts the exact `Rad-Thad/galleon` addresses. `grep -rn 'leclercb/rommix' src packaging scripts` finds only the attribution comment on `REPOSITORY`.
  - `release.yml` publishes `galleon-steam.sh` and names releases Galleon; workflow name, `build` job and matrix keys unchanged. `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (endpoints, after-pack, desktop name and the release steps traced; notes: two comments still named the old image and executable, fixed in this PR; `scripts/build-landing.mjs` still names upstream's site, for part 3).
- Device / acceptance: none (`ci`).
- Next: M0-04 part 3 (user-facing strings in all four catalogues, README, the landing script's site), then flip M0-04.

## 2026-10-08 22:56 UTC session cloud (routine run, third unit)

- Device results: none new (as above).
- Worked on: M0-04 part 3 of 3 (tracking issue #22): the product name the user reads, and the README.
- Result: PR #25. Part 2, PR #24, merged at 2c05b3b; its CI wall time was x64 3:33, arm64 3:26 (on 6103317), and its package step built `dist/Galleon-x86_64.AppImage`.
- Evidence:
  - All four catalogues: every user-facing "RomMix" reads "Galleon"; keys keep upstream's names (ADR 0001). The Support entry names RomMix and Benjamin Leclerc, since its link is his. Window title, logo label, the shared ROM folder's name in the pre-flight check, the default device name and the updater's User-Agent follow. Log lines and comments keep "RomMix".
  - README.md: Galleon is introduced as a fork of RomMix (linked) by Benjamin Leclerc under the kept MIT notice; install, folder and Steam-script instructions use the new names.
  - `npm test` 1341/1341 (catalogue placeholder checks included); `scripts/agent/check.sh` green.
  - With #23, #24 and this PR every M0-04 acceptance line is met (the evaluator checked lines 1-3 and 6 on `main`); `passes` flips in the next PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: first pass FAIL only for this missing entry (lines 4 and 5 met; fr/de/es read correctly; the default device name is a fresh-install label and touches no save-sync rule). Its note that the Support text now implied donations go to Galleon is fixed here.
- Device / acceptance: none (`ci`).
- Next: flip M0-04; then M0-06 (Docker RomM), M0-09 (screenshot harness) on the way to M0-05, M0-13 and M0-24 (owner issue #5).
- Notes:
  - The unit suites that never set `GALLEON_HOME` still write `logs/app.log` into `~/galleon`; worth sandboxing.
  - `src/renderer/src/dev/bridge.ts` still names preview devices `RomMix @ …`; they may appear in screenshots once `shots:nova` exists.

## 2026-10-08 23:45 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json`: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: M0-06 (tracking issue #26): Docker RomM 5.2.0 and 5.3.1, provisioned without a person, and the headless pairing test. Flips M0-04 and M0-06.
- Result: PR (this one).
- Evidence:
  - `test/romm/compose.yml`: MariaDB on tmpfs and `rommapp/romm:5.2.0` / `:5.3.1`, all pinned by multi-architecture index digest, one profile each, published on loopback only (18520, 18531). Every metadata provider is unconfigured; the scan sends `apis: []`. `IPV4_ONLY` because RomM's nginx will not start where containers have no IPv6 (the cloud VM).
  - `test/romm/provision.mjs` (Grout's `provision.py`, MIT, credited in the new THIRD_PARTY.md with its licence): waits for the heartbeat and checks `SYSTEM.VERSION`, creates the first admin while `SHOW_SETUP_WIZARD` is on (CSRF cookie echoed), signs in and runs a quick scan over socket.io (Engine.IO long-polling over `fetch`, no new dependency), mints a client token and registers a device with Basic auth and no cookies (Grout's note on 5.3 CSRF binding), and writes `test/romm/.state/<profile>.json` (git-ignored). A re-run reuses the user, a still-valid token and the device found by name.
  - On the VM from cold (`down -v`, `.state` removed): v520 up + provision 41 s, v531 52 s; both report the right version and scan `gba`, `snes`. Re-runs take 3-8 s and keep the same device id.
  - `test/romm/pairing.real.ts` (`npm run test:romm-pairing`): `device/init` (201), no token before approval, `device/approve` as the admin, `device/token` returns an access token, the approved device id and exactly `REQUIRED_SCOPES`; the token reads `/api/users/me` and the device. Passed on v520 and v531.
  - `test/romm/lib.mjs` holds the server-free half (profiles, scopes, Engine.IO packets, cookies, arguments, heartbeat wait); `lib.test.ts` (11 tests, in `npm test`) covers it 100% and checks the provisioned token covers the app's `REQUIRED_SCOPES`.
  - `release.yml`: a `changes` step (first-parent diff) and a `Docker RomM` step inside `build`: 5.2.0 on x64 when client, save or fixture paths change; both versions on both architectures on `workflow_dispatch`, which is how the arm64 line is proven. `init.sh`'s RomM step now waits on port 18520.
  - `workflow_dispatch` run 37861148543 on ed3f3dc, both legs green: the `Docker RomM` step brought up, provisioned and paired v520 and v531 from cold on ubuntu-24.04-arm (v520 44 s, v531 51 s; step 1:35) and on x64 (40 s, 50 s; step 1:30).
  - `passes: true` for M0-04: every acceptance line met by #23, #24 and #25 (evaluator PASS on each). `passes: true` for M0-06: every line met, the arm64 line by the dispatch run above.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (all five lines checked, both profiles re-provisioned and paired; the arm64 line conditional on the dispatch run, since green; its note on two doc comments left above the wrong symbols by the split is fixed in this PR).
- Device / acceptance: none (`ci`).
- Next: M0-07 (fixture library), M0-09 (screenshot harness).
- Notes:
  - Docker Hub rate-limited a manifest HEAD on the VM (429); the images were already cached. CI pulls by digest.

## 2026-10-09 00:02 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-07 part 1 of 2 (tracking issue #28): the synthetic library in the owner's shapes, and a real-server check of how RomM scans it.
- Result: PR (this one). M0-06's PR #27 merged at ded7d69; its CI wall time was x64 4:06 (Docker RomM 5.2.0 included), arm64 3:16 (on 2a5c97a).
- Evidence:
  - `test/romm/make-library.mjs` rebuilds `test/romm/library/` (now git-ignored, the placeholder files removed) from scratch: SNES and GBA files, a ps1 and an ngc multi-disc folder, a ps2 cue/bin pair at the top level, a PSP folder with its image on top and `.EDAT` and an image in subfolders, a PSP entry with no extension, Dreamcast `.chd` and `.cdi`, and zero-filled 1 KiB firmware stubs (`scph5501.bin`, `scph1001.bin`, `dc_boot.bin`, `dc_flash.bin`, `gba_bios.bin`, a ps2 BIOS name). Each ROM is a line saying it is not a game plus filler hashed from its path. Folder names are the owner's fs_slugs (`ps1`, `SNES`).
  - `make-library.test.ts` (in `npm test`): two builds hash identically and a stale file does not survive; every ROM distinct and under 4 KiB; the cue names its bin; every stub all zeros.
  - `library.real.ts` (`npm run test:romm-real`, which now runs every `*.real.ts`): on fresh v520 and v531 servers the platforms are dc, gba, ngc, ps1, ps2, psp and SNES; the multi-disc folders have `has_multiple_files` with two top-level discs; the cue and the bin are two single-file ROMs; the PSP folder has `has_nested_single_file`, one top-level file and the `.EDAT` below; the extensionless entry is a plain single file; firmware lists the six stubs at 1 KiB. 7/7 on each. RomM's rule (from its model): nested single file means one top-level file in a multi-file folder, so extras must sit in subfolders.
  - CI's `Docker RomM` step and `init.sh` build the library before compose starts.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-07 part 2 (`test/fixtures/roms/manifest.json` of redistributable homebrew with SHA-256 and licence, `scripts/agent/fetch-fixtures.mjs` refusing a mismatched hash), then flip M0-07; M0-09.
- Notes:
  - A quick scan does not rewrite rows from an earlier library; after changing `make-library.mjs`, `down -v` before re-provisioning.

## 2026-10-09 00:26 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json` unchanged: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: M0-07 part 2 of 2 (tracking issue #28): the homebrew manifest and its hash-checked fetcher. Flips M0-07.
- Result: PR (this one). Part 1, PR #29, merged at 17afafb; its CI wall time was x64 3:56, arm64 3:12 (on 120101e).
- Evidence:
  - `test/fixtures/roms/manifest.json`: two MIT homebrew GBA programs from jsmolka/gba-tests (`ppu/hello.gba`, `save/sram.gba`), each with a commit-pinned raw URL, SHA-256, size, licence and attribution. Credited with the licence text in THIRD_PARTY.md under "Test payloads". No ROM bytes in the repository. No SNES homebrew with a permissive licence ships a prebuilt ROM at a stable file URL (gilyon/snes-tests only as a release zip; PeterLemon/SNES has no licence), so SNES stays synthetic for now.
  - `scripts/agent/fetch-fixtures.mjs` validates the manifest (relative path under `roms/`, https URL, 64-hex SHA-256, size within `MAX_BYTES`, licence and attribution present), keeps a file already holding the pinned hash, and otherwise downloads, checks hash and size, and writes through a `.partial` name; a mismatch is refused with both hashes and nothing is written.
  - `fetch-fixtures.test.ts` (10 tests, in `npm test`, against a loopback HTTP server): written on a match; refused on a hash mismatch with no file or `.partial` left; a refusal stops later entries; size mismatch refused; HTTP 404 refused; kept without a request; wrong bytes replaced; manifest validation; the committed manifest's URLs are commit-pinned; arguments.
  - On the VM: `make-library.mjs` then `fetch-fixtures.mjs` fetched both files into `test/romm/library/roms/gba/` with the pinned hashes; a second run kept both; a copy of the manifest with one hash altered exited 1 with `refused, … gave sha256 38aed48b… the manifest pins 00000000…` and wrote nothing.
  - `passes: true` for M0-07: lines 1, 3 and 4 met by #29 (`make-library.test.ts`, `library.real.ts` on v520 and v531), line 2 by this PR.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-09 (screenshot harness), then M0-11.
- Notes:
  - The fetcher is not in CI's `Docker RomM` step: the suites there need only the synthetic files, and a download would add a network dependency to the required check. The device bundle (PLAN.md section 5, step 5) is its consumer.

## 2026-10-09 00:45 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: flaky issue #31: `test/app/setup.test.ts` "it comes up asking for a server rather than showing a library" failed on PR #30's x64 leg with `undefined !== ''` and passed on its one re-run.
- Result: PR (this one). M0-07's PR #30 merged at 726216c; its CI wall time was arm64 3:25, x64 4:26 (the re-run; the first x64 run, 4:20, hit this flake).
- Evidence:
  - Cause: the scenario waited for `[data-screen="setup"]` and read `.field__input` once. `SetupScreen` renders an empty content area under that marker until its effect chooses a page, so a slow first render had no field to read. The test now waits for the field, and still asserts it starts empty.
  - Reproduction: CPU load did not force it (the unfixed test passed 3/3 on the VM with twelve busy loops on four CPUs). The evaluator forced it in a throwaway copy by delaying `SetupScreen`'s page choice: the unfixed test failed with the CI's `undefined !== ''`, the fixed test passed 13/13.
  - `setup.test.ts` with the fix: 13/13 on the VM. Stress run (`stress.yml`, app suite, x64, 10 runs) on ec5ef11: see the PR.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (cause fixed rather than the test weakened; the empty-value assertion kept; no timeout raised; the reproduction above is its).
- Device / acceptance: none (`ci`).
- Next: M0-09 (screenshot harness).

## 2026-10-09 01:26 UTC session cloud (routine run)

- Device results: none new. `bridge/status.json` unchanged: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: M0-08 part 1 of 2 (tracking issue #33): `npm run test:romm`, and RomMix's client against Docker RomM for listing and downloads. Owner issue #5 waits on M0-24 (its depends_on, M0-05 and M0-13, do not pass yet); M0-08 is the first feature `next.mjs` names. The flaky fix, PR #32, merged at 138eebf.
- Result: PR (this one).
- Evidence:
  - `npm run test:romm` (`test/romm/run.mjs`) builds the library, then for each profile in turn (5.2.0, then 5.3.1, or each `--profile` named) brings the server up, provisions it and runs every `*.real.ts`; a failing version does not stop the next, and the exit code is 1 if any failed (seen on the VM: `test:romm failed on v520, v531` before the fixes below). CI's `Docker RomM` step now calls it.
  - `client.real.ts` (7 tests) drives `RommClient` with the provisioned token: heartbeat names the version; platforms are the library folder names; paging by 3 covers the whole listing in order with files on every row; `with_files=false` lists the same ids with no files; a single-file ROM whose body ends at 50% (declaring the full length) is picked up with `Range: bytes=170-` and the file's md5 equals `files[].md5_hash`; one disc of a multi-file game downloads through `/api/roms/{file id}/files/content/` and resumes the same way; `GET` on that endpoint serves the file with the right md5, with the HEAD answer in the test name (`HEAD answers 405` on 5.2.0 and on 5.3.1).
  - `npm run test:romm` on the VM: v520 14/14, v531 14/14, from `down -v` and again on the running servers.
  - Fixed on the way: `make-library.mjs` removed and re-made the library folder, so a server already running kept a bind mount to the deleted folder and answered 404 for every file. It now empties the folder. `make-library.test.ts` holds a directory handle across a rebuild (fails on the old code, passes on the new).
  - `profilesFrom` (lib.mjs) tested in `lib.test.ts`.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-08 part 2: firmware, the multi-file download, save and state upload and download, device registration, play sessions, request bodies against `schema/` (needs a 5.3.1 snapshot), then flip M0-08.

## 2026-10-09 01:47 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-08 part 2 of 2 (tracking issue #33): the calls that write, and every recorded request held to `schema/`. Flips M0-08.
- Result: PR (this one). Part 1, PR #34, merged at 0ca527a; its CI wall time was x64 5:08, arm64 3:48 (on 9aaf9cd).
- Evidence:
  - `schema/romm-5.3.1.json` fetched from Docker RomM 5.3.1 with `scripts/fetch-openapi.mjs` (272 schemas); 5.2.0 re-fetched from Docker and identical to the committed file. `src/shared/types/romm.test.ts` and the client tests pass with it.
  - `test/romm/schema.mjs` holds a request to its version's document: the operation exists for the method and path template, every query name is declared and required ones are sent, a JSON body fits its schema (`$ref`, `anyOf`/`oneOf`/`allOf`, enums, arrays, required and undeclared fields), a form's field names fit its schema. `schema.test.ts` (7 tests, in `npm test`) covers each problem and that every committed 5.2+ document has the four write operations.
  - `test/romm/server.ts` is what the real suites share (state, client, the request recorder now keeping bodies, `assertFitsSchema`). `client.real.ts` now uses it and checks the requests in every test it records.
  - `pairing.real.ts` now drives the client's own `startDevicePairing` and `pollDevicePairing` (false before approval, true after, the device id stored is the one approved, the stored token reads `me` and the device list); the admin's approval stays a raw call, and every request on both sides is held to the document. The evaluator's first pass failed the flip on this: the old test sent its own bodies, unchecked, and never ran the client's pairing code.
  - `sync.real.ts` (6 tests): firmware listed and `scph5501.bin` downloaded with its md5 checked; a multi-file game downloaded whole is a zip naming both discs; a machine registers once however often it asks (one `POST /api/devices` over two asks) and is listed; a save uploads with this device's `device_id`, is listed and downloads byte for byte; a state the same; a 90-second play session raises `playTime` by 90. Every test asserts all its requests fit the version's document.
  - `npm run test:romm`: v520 20/20, v531 20/20 on running servers; v520 20/20 again from `down -v`.
  - `passes: true` for M0-08: line 1 (`run.mjs`), lines 2 and 3 by #34, line 4 by this PR.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: FAIL, then see the PR.
- Device / acceptance: none (`ci`).
- Next: M0-09 (screenshot harness).
- Notes:
  - The inherited `uploadSave` sends `overwrite=true` on every upload. Only Docker RomM sees it here, and the save engine (M2, ADR 0002) replaces that path; nothing in this PR relies on it.
  - Electron's stub refuses `app.getVersion`, which device registration asks for; `server.ts` answers it, as `romm.test.ts` does. Without that, registration failed quietly and uploads named no device.

## 2026-10-09 06:28 UTC session cloud (routine run)

- Device results: none. `bridge/status.json` unchanged: bridge version 1, last seen 2026-10-08T15:06:00Z, skipping because no `nightly` release is published yet. No `results/` yet.
- Worked on: owner issue #36 (4:3 and single-screen patches), tracking issue #37. #37 had been claimed at 02:27 UTC by a run that left no branch or PR; the claim was over three hours old, so this run took it over and said so on #37. M0-08's PR #35 merged at 1057988; both `build` legs green on it.
- Result: PR (this one), docs and the feature guard only. No research or implementation, as #36 asks.
- Evidence:
  - `docs/features.json`: M7-14..M7-17 appended after M7-13, from #36's JSON, `ISSUE-36` in each `source`. One change to the owner's text: M7-16's second acceptance line was "A device check per system where a payload exists, ..."; the guard refuses a device feature that names no `Device check`, so the line now reads "Device check `aspect.<system>` for each system where a payload exists: ..." with the same meaning.
  - `docs/TESTING.md`: catalogue row `aspect.<system>` (run.sh; M7-15, M7-16), and M7-17 beside the shader picks in the acceptance session's contents.
  - `scripts/agent/features-check.mjs`: REQ-16 is owed a feature like REQ-1..15; a check named by the catalogue's own placeholder id (`aspect.<system>`) counts as in the catalogue, since its concrete ids come from M7-14's research. Fixtures `check-placeholder.json` (passes) and `check-placeholder-unknown.json` (an uncatalogued placeholder fails); the coverage fixture and the REQUIRED_SOURCES count now include REQ-16. 33/33.
  - `docs/REQUIREMENTS-FROM-TESTER.md` item 16 (the owner's words, the hand-made PSP setup, where it is scheduled); `docs/PLAN.md` M7 lists M7-14..M7-17 and the exit gate names M7-17.
  - `scripts/agent/check.sh` green (`features-check: 162 features, all rules hold`).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: owner issue #5 still waits on M0-05 and M0-13 through M0-24's depends_on; M0-09 (screenshot harness) is next by `next.mjs`.
- Notes:
  - M8-07's acceptance line "ACCEPTANCE.md covers every acceptance feature (...)" does not name M7-17, and its acceptance is frozen. When M0-15's generator is built it should take every `acceptance` feature from features.json rather than that list.

## 2026-10-09 06:55 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-09, the 1280x960 screenshot harness (tracking issue #39). The #36 plan PR, #38, merged at e81587a; its CI wall time was x64 3:07, arm64 3:29.
- Result: PR (this one). Flips M0-09 (`agent-screenshot`).
- Evidence:
  - `npm run shots:nova` (`scripts/shots-nova.sh`, `test/app/shots.ts`) builds, starts the app under Xvfb against `test/app/server.ts`, walks with the driver's presses and writes `artifacts/shots/<screen>.png` at 1280x960. Full set, 14 files: `home`, `library`, `game-details`, `game-saves`, `game-files`, `game-screenshots`, `downloads`, `bios`, `emulators`, `settings-general`, `settings-games`, `settings-system`, `running` (the stand-in emulator holding the screen) and `setup` (the wizard's first page). `identify` gives 1280x960 for each. Full run on the VM: 14 s.
  - `artifacts/shots/index.html` shows every picture with its name, and gives a failed screen's name and reason in their place. With the game's selector broken on purpose, the run printed `game: gave up waiting for [data-rom="99"] to be reachable` and `1 failed: game`, and exited 1.
  - Size: Xvfb has no window manager to make the window full screen, which left it at 1288x804. The driver's new `viewport` option lays the page out at 1280x960 through `Emulation.setDeviceMetricsOverride`, and `headless.sh` takes the screen size from `ROMMIX_SCREEN`.
  - Repeatability: two runs on one commit differ by at most 0.07% of pixels (`compare -metric AE`; `settings-general` 0.07%, the rest 0.03-0.05%, the port number printed in the top bar). Before the fixes, `home` was 1.57% (the hero's focus ring mid-transition) and `settings-games` 0.72% (the tab underline sliding, and the random temporary folder it prints). Shots now wait for every animation that ends, and the harness gives each app a fixed folder (`StartOptions.home`).
  - `-- --subset pr`: `home`, `library`, `game-details`, `downloads`, `settings-general`, `setup`, in 11 s on the VM. CI runs it on x64 after `test:app` and uploads `shots-x64` even when a screen fails. The full set's nightly run belongs to M0-24 (`nightly.yml` does not exist yet).
  - Looked at all 14 PNGs. Every screen fills 4:3 with nothing clipped at the edges. Lists continue below the fold where they are longer than the screen (home's second shelf, emulators' platforms, settings). The running overlay is centred over the dimmed game page. The top bar's wordmark still reads "RomMix". It is text in `App.tsx` (`topbar__wordmark`), outside the i18n catalogues that M0-04's acceptance covers, so M0-04 missed it. It is a separate small fix (see Next).
  - `npm run test:app` with the driver changes: 191/191 on the VM. `scripts/agent/check.sh` green.
  - Flaky issue #41: PR #40's first arm64 leg failed in `npm test` on `test/romm/lib.test.ts` "the heartbeat wait names the last failure when it gives up" (`(no answer)` where `(down)` was expected). Cause: `waitForHeartbeat` checked its deadline before the first attempt, so with a 1 ms timeout it could give up without asking. It now asks first. The new test "the heartbeat wait asks at least once, however little time it is given" fails on the old code and passes on the new one; the old test passed 40/40 after the fix.
- CI wall time: first run on 23cc9c2: x64 4:04 (the shots step 9 s); arm64 failed at 0:40 (the flake above). Final run: recorded in the next entry.
- Evaluator: PASS (all five acceptance lines met; it opened 8 PNGs; two full runs differed by at most 0.09%; flipping now is justified because M0-24's description owns the nightly full set).
- Device / acceptance: none (`agent-screenshot`).
- Next: the wordmark fix above, then M0-11 (diagnostics bundle).
- Notes:
  - On the VM, Electron refuses to run as root without `--no-sandbox`, and creating an unprivileged user was not allowed this session. Local runs used `ELECTRON_EXEC_PATH` pointing at a wrapper outside the repository that adds `--no-sandbox`. CI keeps the sandbox.

## 2026-10-09 07:27 UTC session cloud (routine run)

- Device results: none. `bridge/status.json` unchanged (bridge 1, last seen 2026-10-08T15:06:00Z, no `nightly` release yet); no `results/`.
- Worked on: the top bar's wordmark, which still read "RomMix" after M0-04 (tracking issue #42, found by M0-09's screenshots). M0-09's PR #40 merged at 7b12bbb; both `build` legs green on it.
- Result: PR (this one).
- Evidence:
  - New test:app check "the top bar names the product it is" (`test/app/interface.test.ts`, the home screen): the wordmark's text and the mark's `aria-label` are both `Galleon`. On the old code it failed with `actual: 'RomMix'`; with the fix it passes.
  - `src/renderer/src/App.tsx`: the wordmark is `Gal<span>leon</span>`, keeping the two-tone design.
  - `npm run test:app` 192/192 on the VM; `npm run shots:nova -- --subset pr` 6 screens. Looked at `home.png` and a crop of its top bar: "Galleon" beside the mark, the menu still centred, nothing clipped.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M0-11 (diagnostics bundle).

## 2026-10-09 07:44 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: flaky issue #44, `test:app` "driving it with a mouse instead > and a click opens what it is on", which failed once in three runs during PR #43's evaluation. The wordmark PR #43 merged at 49c7808; its CI wall time was x64 3:39, arm64 3:12.
- Result: PR (this one).
- Evidence:
  - Cause: `data-screen="game"` is set as soon as the route changes, but the game screen draws a placeholder until the ROM arrives over IPC (`setRom(null)`, then `setRom(fetched)` in `screens/Game/index.tsx`). The test read `.game-hero__title` in between. "the home screen > and it opens that game rather than being a picture of one" had the same race.
  - Reproduced deterministically with a scratch (uncommitted) 400 ms delay on the fake server's `GET /api/roms/<id>`. Both tests failed (`actual: undefined`, expected 'Tobu Tobu Girl'). With the fix, both pass under the delay.
  - Fix: both tests wait for `.game-hero__title` before reading it. The game screen resets to null on every open, so the title that appears belongs to the game just opened.
  - Without the delay: `npm run test:app` 192/192; `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M0-11 (diagnostics bundle).
- Notes:
  - Under the same artificial delay, `games.test.ts` "saves either side of a session" lost two tests ("cancelling the question sends nothing at all", "so the next push goes without a word"). The highlight stayed on the Manual tab and never reached `push-saves`. That is a different mechanism, never seen without the delay, and it is recorded on #44 rather than fixed here.

## 2026-10-09 08:26 UTC session cloud (routine run)

- Device results: none. `bridge/status.json` unchanged (bridge 1, last seen 2026-10-08T15:06:00Z, no `nightly` release yet); no `results/`.
- Worked on: M0-05 part 1 of 2 (tracking issue #46), on the way to owner issue #5 (which waits on M0-24, which waits on M0-05). The flaky fix PR #45 merged at ba24930; its CI wall time was x64 3:31, arm64 3:25.
- Result: PR (this one). M0-05 stays false until part 2.
- Evidence:
  - `release.yml`'s `build` has `timeout-minutes: 20`. format:check, lint, typecheck and `npm run test:coverage` (in place of `npm test`) run on x64 only, before features-check; the bridge unit tests are a new x64 step after it. arm64 still type-checks through `npm run build`.
  - The `changes` step runs right after `npm ci` and also writes `docs_only` (every changed path is Markdown, under `docs/` or an issue template) and `package` (false only on a docs-only pull request). The warm-up, package, `galleon-steam.sh` copy and `appimage-*` upload steps take `package`. Checked the shell against four lists: prose only → true; prose plus `src/` → false; an issue template → true; nothing → false.
  - `node scripts/agent/ci-times.mjs` (new, unit-tested in `scripts/agent/ci-times.test.ts`) prints the median per required leg over the last 10 merged pull requests, timing only successful legs. Today: x64 4:01, arm64 3:25, both under the 10-minute target.
  - `scripts/agent/check.sh` green (1423 tests, lines 96.15%).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-05 part 2: `npm run smoke:app` on arm64 in place of `test:app`, RomM and MariaDB images pulled by digest, and the scratch-branch red check; then flip M0-05.

## 2026-10-09 08:40 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-20, the licence and dependency guard (tracking issue #48). M0-05 needs its CI step. M0-05 part 1, PR #47, merged at 711cf1d; its CI wall time was x64 3:58, arm64 3:13.
- Result: PR (this one). Flips M0-20 (`ci`).
- Evidence:
  - `node scripts/agent/licence-guard.mjs` is a new x64 step in `build` after the bridge tests, and a step in `scripts/agent/check.sh`. It lists the 7 production packages with their licences (all MIT or ISC) and fails on any of three problems. First, a runtime dependency beyond RomMix's fork-point three without a row under the new `## Runtime` table in `docs/DEPENDENCIES.md`, or a row with a range instead of an exact version, a licence outside MIT, BSD, ISC, Apache-2.0 and MPL-2.0, or no reason. Second, such a licence anywhere in `npm ls --omit=dev --all`. Third, Argosy's package id or a GNU GPL, LGPL or AGPL licence header in code outside `docs/` and licence files.
  - Proved end to end on the VM. With `pend` added to `dependencies` as `^1.2.0`, the guard printed `pend: a runtime dependency with no row under "## Runtime" in docs/DEPENDENCIES.md` and exited 1. With a scratch `src/main/zz-scratch.ts` carrying a GPL header, it exited 1 and named the file. With both removed, it exits 0. Unit tests: `scripts/agent/licence-guard.test.ts`, 9 tests.
  - `THIRD_PARTY.md` lists Grout, and now the two OFL fonts shipped in the AppImage. It also says no ES-DE data has been ported yet, and that the change porting the first ES-DE file adds it there.
  - `scripts/agent/check.sh` green (1432 tests, lines 96.10%).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-18 (PR template, the `Feature:` body check in `build`, `ci-times.mjs <pr>`), then M0-05 part 2 (`smoke:app` on arm64, image digests, the red-check proof). M0-05 flips only after both.

## 2026-10-09 08:47 UTC session cloud (routine run, third unit)

- Device results: none new (as above).
- Worked on: M0-18 part 1 of 2 (tracking issue #50). M0-05 needs its PR-body step. M0-20's PR #49 merged at 8860441, flipping M0-20; its CI wall time was x64 3:43, arm64 3:05 (`node scripts/agent/ci-times.mjs 49`).
- Result: PR (this one). M0-18 stays false until part 2.
- Evidence:
  - `.github/pull_request_template.md`: feature ids, what, evidence, device checks, CI wall time per leg, risk, and the evaluator's verdict.
  - New x64 step "Check the pull-request body", on pull requests only. It runs `scripts/agent/pr-body.mjs`, which fails when the body has no `Feature:` line, names an id missing from features.json, or says `none` without a reason in brackets. Dependabot is exempt because its bodies are generated. The body and author reach it through the environment. Unit and process tests: `scripts/agent/pr-body.test.ts`, 5 tests, including exit 1 with the reason on a body without the line.
  - `node scripts/agent/ci-times.mjs <pr>` prints one pull request's legs: `#47` x64 3:58, arm64 3:13; `#49` x64 3:43, arm64 3:05.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-18 part 2 (features-check holds a pull request to a PROGRESS.md entry dated within its lifetime), then M0-05 part 2. A later change could have the licence guard (M0-20) also refuse `SPDX-License-Identifier: GPL-…` lines; the evaluator noted it as optional on #49.

## 2026-10-09 08:54 UTC session cloud (routine run, fourth unit)

- Device results: none new (as above).
- Worked on: M0-18 part 2 of 2 (tracking issue #52). Part 1, PR #51, merged at a7a455d; its CI wall time was x64 3:49, arm64 2:57.
- Result: PR (this one). Flips M0-18 (`ci`).
- Evidence:
  - Line 1 (every merged PR carries `Evaluator: PASS` and `Feature:`): #47, #49 and #51 do, and the body step from #51 now enforces `Feature:` on every PR after them.
  - Line 2 (the template, and CI failing a body without `Feature:`): #51.
  - Line 3 (one PROGRESS.md entry per session): features-check's new `progressEntryErrors`. On pull requests CI passes `--opened <created_at> --author <login>`, and features-check fails unless the PR adds a `## YYYY-MM-DD HH:MM UTC session` heading dated from `PROGRESS_GRACE_HOURS` before the PR opened up to the check. The entry is written in the session that opens the PR, just before opening it. Dependabot is exempt. Tests in `scripts/agent/features-check.test.ts`: an entry minutes before opening passes; none, one from too early, and one dated after the check each fail; the template heading and a date-like bullet do not count; the CLI run with `--opened` on a repo whose entries carry no heading exits 1.
  - Line 4 (CI wall time per leg from `ci-times.mjs <pr>`): #51, and this entry's figures came from it.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-05 part 2 (`smoke:app` on arm64, image digests, the red-check proof), then flip M0-05.

## 2026-10-09 09:46 UTC session cloud (routine run)

- Device results: none. `bridge/status.json` unchanged (bridge 1, last seen 2026-10-08T15:06:00Z, no `nightly` release yet); no `results/`.
- Worked on: M0-05 part 2 of 2 (tracking issue #54). M0-18 part 2, PR #53, merged at 670d4a4, flipping M0-18; its CI wall time was x64 3:50, arm64 2:58.
- Result: PR (this one). Flips M0-05 (`ci`).
- Evidence:
  - `npm run smoke:app` (new, `scripts/smoke-app.sh` and `test/app/smoke.ts`): the AppImage for this machine's architecture, or `GALLEON_APPIMAGE`, starts under Xvfb against the fake RomM, reaches Home, quits through `window.rommix.system.quit()` and must be gone within the quit allowance, the whole round trip within 60 s. The driver's `startApp` takes `executable` (run extracted, as `galleon-steam.sh` does on the device, in a process group of its own so a stop ends Electron and not only the AppImage runtime) and `App.quit`.
  - On the VM, as an unprivileged user, against `dist/Galleon-x86_64.AppImage` from `npm run appimage`: pass in 1.3 s; and against its extracted `AppRun` with `chrome-sandbox` made setuid root, the way the workflow runs it: pass in 1.1 s. No `rommix.bin` left running after either. The first try called a quit that does not exist; it failed after the quit allowance, and the stop then left Electron orphaned with the pipes open, which is why the stop now signals the group.
  - `release.yml`: `test:app` runs on x64 only; arm64 runs the new step "Smoke-test the package" when `package` is true (every push to `main`, every pull request but a docs-only one). It extracts the AppImage and makes its `chrome-sandbox` setuid root, the same fix the job already applies to the development Electron for `test:app`.
  - RomM and MariaDB images: `test/romm/compose.yml` already pins all three by digest, and the Docker step pulls them once per job.
  - Red-check proof: scratch PR #55 (`claude/M0-05-red-proof`) added one failing unit test; `build (ubuntu-24.04, x64)` failed at `npm run test:coverage` naming `a deliberately failing test` (actions run 37913343676). #55 was closed unmerged.
  - `scripts/agent/check.sh` green; `npm run test:app` 192/192 on the VM.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-23 (device results ingestion) or the next from `node scripts/agent/next.mjs`.

## 2026-10-09 10:33 UTC session cloud (routine run)

- Device results: none. `bridge/status.json` unchanged (bridge 1, last seen 2026-10-08T15:06:00Z, no `nightly` release yet); no `results/`.
- Worked on: M0-13 part 1 of 2 (tracking issue #57), on the way to owner issue #5 through M0-24. M0-05 part 2, PR #56, merged at 4111f79, flipping M0-05; its CI wall time was x64 3:53, arm64 0:58 (arm64 no longer runs `test:app`). `main` is green, canary published.
- Result: PR (this one). M0-13 stays false: it is a `device` feature.
- Evidence:
  - `release.yml`: the canary and release jobs write `SHA256SUMS` (`sha256sum *.AppImage galleon-steam.sh`) beside the images and publish it with them; the canary tag still moves last.
  - `src/main/integrity.ts` `digestFromChecksums` reads `sha256sum`'s format (text or binary mode, whole-name match, two different digests for one name is no answer). `src/main/update.ts` `Updater.publishedDigest` fetches the release's `SHA256SUMS` before the image and holds the image to it; a release without one falls back to GitHub's asset digest. No line for the image refuses the update; a sums file that disagrees with GitHub's digest refuses it before the image is fetched; a mismatch deletes the part-file, logs expected and actual, and keeps the running image.
  - Tests: `src/main/updater.test.ts` "checking it against SHA256SUMS" (4: vouched image installed; mismatch refused with the running image unchanged and state `error`; no line refused; disagreement refused with no image request), `src/main/integrity.test.ts` "reading a SHA256SUMS file" (4).
  - README "Builds from the tip of `main`" says how to check a download by hand.
  - `scripts/agent/check.sh` green (1450 tests, lines 96.08%).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet.
- Next: M0-13 part 2: version, short commit and channel in the footer and Settings -> About. Its device checks `build.identity` and `update.verify` are self-test scenarios and need M0-21's self-test mode, whose depends_on (M0-10, M0-11) do not pass. M0-24 depends on M0-13 passing, which needs a nightly to test it: a cycle through device results. Once M0-13's CI parts are in, M0-24 waits only on device results and, per CLAUDE.md ("a feature waiting only for device results blocks nothing"), is taken next for owner issue #5.

## 2026-10-09 10:47 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-13 part 2 of 3 (tracking issue #57): acceptance line 3. Part 1, PR #58, merged at 4127ee6; its CI wall time was x64 3:02, arm64 1:00.
- Result: PR (this one). M0-13 stays false.
- Evidence:
  - `UpdateStatus.channel` (`releases`, `candidates`, `canary`), from `Updater.channel`: `ROMMIX_CANARY` first, then `Settings.updatePrereleases`. Set in the constructor and re-reported from `schedule`, which a change of the setting reaches.
  - The footer reads `v{version} · {commit} · {channel}` and Settings → System → Updates has a `Channel` row under `Installed` (Settings has no About tab; this block is where version and commit already live). New keys in all four catalogues.
  - Tests: `src/main/updater.test.ts` "the channel it reports" (2); `test/app/interface.test.ts` checks the row and the footer name version and channel, and that the row follows the release-candidates toggle. `npm run test:app` 192/192 on the VM (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
  - Shots: `npm run shots:nova` full set; looked at `home.png` (footer "v0.20.0 · 4127ee6-dirty · releases", one line, no overlap with the hints) and `settings-system.png` (Installed, Channel "releases", Newest published, Last checked aligned).
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet. Part 3 is the `build.identity` and `update.verify` self-test scenarios, which need M0-21's self-test mode.
- Next: with M0-13's CI-testable lines in, M0-24 waits only on M0-13's device checks; owner issue #5 makes it next.

## 2026-10-09 11:27 UTC session cloud (routine run)

- Device results: none. `bridge/status.json` unchanged (bridge 1, last seen 2026-10-08T15:06:00Z, no `nightly` release yet); no `results/`.
- Worked on: M0-24 part 1 of 2 (tracking issue #60), for owner issue #5 (ADR 0004). M0-13 part 2, PR #59, merged at 16483f6. M0-24's `depends_on` names M0-13, which can pass only through a device run on a `nightly` that M0-24 publishes; it is taken now because it waits on nothing else.
- Result: PR (this one). M0-24 stays false until part 2 (`nightly.yml`).
- Evidence:
  - `test/device/`: `bundle.json` (`contract` 1, `minBridge` 1) and the minimal `run.sh` (acceptance line 4): it starts nothing, writes `summary.json` with one check, `harness.run`, passing when the bundle's `build-info.json` names `GALLEON_SHA` and the AppImage is executable; `--cleanup` is a no-op.
  - `scripts/device-bundle.mjs --sha <sha> --out <dir>` writes `galleon-device-tests.tar.gz` (`test/device/`, `build-info.json`, and `bridge/`, the bridge files `install.sh --update` installs) and `build-info.json` `{sha, version, builtAt, bundleContract}`. Packed with fixed owner, times and order, so a commit packs to the same bytes.
  - `release.yml`: x64 builds the bundle on every leg and uploads it as `device-bundle` from `main`. The `canary` job, now in `concurrency: {group: nightly, cancel-in-progress: false}`, after moving the canary tag gathers both AppImages, `galleon-steam.sh`, the bundle and `build-info.json`, writes `SHA256SUMS` over all of them, publishes the rolling `nightly` pre-release (`make_latest: false`, a body saying it is for the device bridge) and moves the `nightly` tag last. Pull requests never publish.
  - Tests: `scripts/device-bundle.test.ts` (8): build-info refuses a short or upper-case sha; names commit, version and contract; same bytes twice; the bridge's own `safe_extract` unpacks it and finds `run.sh`, `bundle.json`, `build-info.json` and `bridge/` without its tests; `run.sh` passes `harness.run` for its own commit, fails it for another commit or a missing AppImage; `--cleanup` exits 0; the CLI writes both files and exits 1 on a short sha.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: the first merge after this publishes the first `nightly`; the bridge should then report `harness.run`.
- Next: M0-24 part 2: `nightly.yml` (schedule plus dispatch, early exit when `main` has not moved since the last scheduled run, full suites on both architectures, the same publish), then flip M0-24.

## 2026-10-09 11:38 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: M0-24 part 2 of 2 (tracking issue #60). Part 1, PR #61, merged at 65777b9; its CI wall time was x64 3:15, arm64 1:10.
- Result: PR (this one). Flips M0-24 (`ci`) once a dispatched nightly on `main` publishes.
- Evidence:
  - `.github/workflows/nightly.yml`: daily schedule (`23 3 * * *`) and `workflow_dispatch`; workflow-level `concurrency: {group: nightly, cancel-in-progress: false}`; every job `timeout-minutes: 30`. Job `moved` ends a scheduled run early when the last completed scheduled nightly tested the same `main` commit (the `nightly` tag is not the reference, since every merge moves it). Job `suites`, on x64 and arm64: `test:coverage`, Docker RomM 5.2.0 and 5.3.1, build, package, full `test:app`, every `shots:nova` screen, the device bundle (x64). Job `publish` needs `suites`, so a failing suite publishes nothing, and runs only from `main`.
  - `.github/actions/publish-nightly`: the gather, `SHA256SUMS`, publish (`make_latest: false`, body for the device bridge) and tag-moved-last steps, shared by `nightly.yml` and release.yml's `canary` job, so both write the same assets.
  - `actionlint` (1.7.7) reports nothing on `nightly.yml`; on release.yml only the four shellcheck notes already on `main`.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).

## 2026-10-09 11:53 UTC session cloud (routine run, third unit)

- Device results: none yet. The first `nightly` (65777b9) was published at 11:40 UTC and the Nova has not reported on it.
- Worked on: flipping M0-24 (tracking issue #60). Part 2, PR #62, merged at 2f8a1b1; its CI wall time was x64 3:48, arm64 0:51.
- Result: PR (this one). Flips M0-24 (`ci`).
- Evidence:
  - Line 1 (timeouts and concurrency, a typical run within 30 minutes): nightly.yml dispatched on `main` at 2f8a1b1, actions run 37925800111, success in 5:44 (`moved` 0:04; `suites` x64 5:01, arm64 5:12; `publish` 0:16).
  - Line 2 (`build-info.json` names the commit, `SHA256SUMS` covers every asset, tag moved last): the `nightly` release carries `build-info.json` (`sha` 2f8a1b1…), both AppImages, `galleon-steam.sh`, `galleon-device-tests.tar.gz` and `SHA256SUMS` over all five; `refs/tags/nightly` moved by the last step. The per-merge publish did the same for 65777b9 (actions run 37924780473).
  - Line 3 (a failing suite publishes nothing): `publish` needs `suites` (#62). CLAUDE.md already puts a red nightly on `main` first in line.
  - Line 4 (minimal run.sh with only `harness.run`): #61, `scripts/device-bundle.test.ts`.
  - Line 5 (never latest, body for the bridge): `prerelease: true`, `make_latest: false`, body in `.github/actions/publish-nightly`.
  - Docker RomM 5.2.0 and 5.3.1 on both architectures: release.yml dispatched on the #62 branch, run 37925135054, success.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: the bridge should now report `harness.run` on the next idle hour on the charger.
- Next: M0-23 (device results ingestion), so the first results can be read through `device-results.mjs --summary`.

## 2026-10-09 12:28 UTC session cse_013Evf4H1hJ63Gcq8q1118dc (routine run)

- Device results: none. `bridge/status.json` unchanged (bridge 1, last seen 2026-10-08T15:06:00Z, last skip "no 'nightly' release published yet"); no `results/`. The first `nightly` went out at 11:40 UTC and has not been tested yet.
- Worked on: M0-23 (tracking issue #64). The flip of M0-24, PR #63, merged at 6c4223c; its CI wall time was x64 2:46, arm64 0:27.
- Result: PR (this one). Flips M0-23 (`ci`).
- Evidence:
  - `scripts/agent/device-results.mjs`: a pure `analyse` over `results/index.json`, every `summary.json`, `bridge/status.json`, `reports/` and `acceptance/`. A result is new when no `DEVICE-RESULTS <sha>` line in PROGRESS.md names it. New results are handled oldest first, each checked against the counting run before it. `--summary` prints safety failures, newly failing checks (with the features that name them, and features going back to false), newly passing checks (with features that now pass, as `PASSES <id> device:<sha>`), new problem reports and acceptance results, then the bridge's age. `--apply` also sets `passes` in features.json (one word changes per flip), opens one `[regression] <id>` issue per feature that went back to false and per failed `safety.*` check (labels `regression`, plus `save-sync` for safety) unless one is already open, and prints the PROGRESS lines to record. The flip rules (`SAFETY_CHECKS`, `COUNTING_STATUSES`, `deviceChecks`, the READY-FOR-DEVICE ancestry) are the ones features-check enforces, now exported from it so both use one definition.
  - Line 1: `scripts/agent/device-results.test.ts` (17). Against data: flip on all checks plus both safety checks; no flip when READY-FOR-DEVICE is not an ancestor; a missing, skipped or failing check flips nothing; "a safety failure blocks every flip from that run and is reported first"; "a withheld, error, skipped or aborted summary flips nothing and reverts nothing"; "a later failure reverts the flip and opens exactly one regression issue" (two failing runs, one issue, none while one is open). Against fixture branches in a scratch repository through the CLI: a result for the commit before `READY-FOR-DEVICE` flips nothing, one after it flips; `--summary` writes nothing; `--apply` leaves `device-results` where it was.
  - Line 2: "the script has no way to write the device-results branch" greps the source for `push`, `commit`, `update-ref`, `hash-object` and `write-tree` as git arguments. Git is only asked for `fetch`, `ls-tree`, `cat-file`, `log`, `merge-base`.
  - Line 3: "a 60-result branch is read and summarised in under 10 seconds": 0.9 s on the VM (one `ls-tree` and one `cat-file --batch` for every file).
  - Line 4: CLAUDE.md's ritual step 2 names `--summary` with no pre-M0-23 fallback, and `scripts/agent/init.sh`'s last step runs it (it fetches the branch itself).
  - On the real branch: `node scripts/agent/device-results.mjs --summary` prints 0 new results and the bridge last seen 21.5 h ago, in 0.7 s.
  - `scripts/agent/check.sh` green: 1477 tests, coverage 96.13 / 93.58 / 95.71.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: whatever `next.mjs` lists first (M0-10), unless device results arrive.

## 2026-10-09 12:49 UTC session cse_013Evf4H1hJ63Gcq8q1118dc (routine run, second unit)

- Device results: none new (`device-results.mjs --summary`: 0 new results, bridge last seen 2026-10-08T15:06:00Z).
- Worked on: M0-10 part 1 of 3 (tracking issue #66): acceptance line 2. M0-23, PR #65, merged at 7f0c2ec; its CI wall time was x64 4:02, arm64 0:56.
- Result: PR (this one). M0-10 stays false.
- Evidence:
  - `src/renderer/src/perf/frames.ts`: `jankyThresholdMs(hz)` (`JANK_FACTOR` display intervals), nearest-rank `percentile`, `frameStats(intervals, hz)` giving `{frames, p50, p90, p99, jankyPct}` or null, and `FrameWindow`, which turns rAF timestamps into the most recent intervals and can be reset on a screen change. No DOM, no React.
  - `src/renderer/src/perf/frames.test.ts` (11 tests): the threshold is 25 ms at 60 Hz and 12.5 ms at 120 Hz; a frame exactly on it is not janky and one just over is; the same frames are smooth at 60 Hz and janky at 120 Hz; percentiles land on measured frames; one stall shows in p99 but not p50; empty or nonsense input gives null; the window's capacity, its non-advancing timestamps and its reset.
  - `scripts/agent/check.sh` green: 1488 tests, coverage 96.14 / 93.60 / 95.72.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet.
- Next: M0-10 part 2, the power-state parser (line 4) with fixtures from DEVICE-FACTS.md; then part 3, the overlay, the log line and the test:app scenarios.

## 2026-10-09 13:00 UTC session cse_013Evf4H1hJ63Gcq8q1118dc (routine run, third unit)

- Device results: none new.
- Worked on: M0-10 part 2 of 3 (tracking issue #66): the sysfs and power-profiles.conf half of acceptance line 4. Part 1, PR #67, merged at 59a09d4; its CI wall time was x64 3:49, arm64 1:00.
- Result: PR (this one). M0-10 stays false.
- Evidence:
  - `src/main/powerstate.ts`: pure parsers (`parseWord`, `parseNumber`, `parseDefaultProfile`, `gpuDevice`, `powerState`) and `readPowerState(root)`, which reads only files anyone can read: policy7 `scaling_governor`, `scaling_cur_freq` and `scaling_max_freq`; the devfreq device named for the GPU (`governor`, `cur_freq`, `max_freq`); and `default_profile=` from `power-profiles.conf` (`/etc/armada/` over `/usr/share/armada/`). Anything unreadable is `unknown` or null.
  - Not done: line 4's perf-state.json half. DEVICE-FACTS.md says that file is the perf contract (cores, nice, scheduler in `global`/`override` layers), not a profile store, and gives no field for a profile. A first draft looked for a `profile` key there; the evaluator rejected it as invented, and it was removed. What to show from it needs its real format, from the bridge's `doctor` output or a device result's evidence. `defaultProfile` is where Armada starts, not the profile in force; part 3 must not label it as current.
  - `src/main/powerstate.test.ts` (9 tests): fixture trees for the Nova on Balanced and on Performance (values from DEVICE-FACTS.md); `/etc` wins over the factory conf; a desktop with no such files gives every value unknown; no prime cluster still reports the GPU; the parsers' edge cases (a commented line, quoting, the memory-bus devfreq device that is not the GPU). `powerstate.ts` coverage is 100/100/100.
  - `scripts/agent/check.sh` green: 1497 tests, coverage 96.16 / 93.67 / 95.77.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet.
- Next: M0-10 part 3: the overlay (Settings → System toggle and the L3+R3 chord) showing frame stats and this power state over IPC, the `perf summary` log line per screen, the test:app cost and 30 s scroll scenarios, and screenshots.

## 2026-10-09 13:28 UTC session 01WT2MPH2EFfpihL1P1ftBtr (routine run)

- Device results: none new (`device-results.mjs --summary`: 0 new results, bridge last seen 2026-10-08T15:06:00Z, last skip "no 'nightly' release published yet").
- Worked on: M0-10 part 3a of 3 (tracking issue #66): the overlay, its two switches and the per-screen log line. Part 2, PR #68, merged at 4c5b675; its CI wall time was x64 3:45, arm64 0:53.
- Result: PR (this one). M0-10 stays false.
- Evidence:
  - `src/renderer/src/perf/PerfOverlay.tsx`: a fixed, pointer-blind `aside` in the bottom-left corner (the toasts own the top right) with the screen, p50/p90/p99, the janky share at the display's rate, CPU and GPU governor and current/max MHz, and "Armada starts in" for `defaultProfile` (never called the current profile). Frames are counted only while it is mounted; numbers redraw on a timer, power state is re-read on another.
  - Switches: Settings → System `Performance overlay` (`perfOverlay` setting, off by default, shape-checked in the store) and L3+R3 held for `PERF_CHORD_MS` (a new `perfOverlay` action, answered on any focus layer so it works over a dialog). The chord is ignored while a game has the pad and on unmapped pads.
  - IPC: `system:perfState` (`displayHz` from Electron's display, 60 when none is reported, plus `readPowerState()`), `system:perfSummary` writing `perf summary {screen, frames, p50, p90, p99, jankyPct, power}` to app.log when a screen is left, the overlay is turned off, or the window is hidden. `PowerState` moved to `@shared/types`.
  - i18n: 11 keys in all four catalogues, translated (the switch sits under its own `Performance` heading at the end of the System tab).
  - Focus engine fix, found by the new test:app scenario (it failed 3 runs in 3 before): a press from a highlight that is itself off screen (the last row of a long page, reached before the smooth scroll catches up) preferred on-screen candidates, so Right off the row's `On` jumped to a button far up the page. `pick` in `src/renderer/src/input/focus.tsx` now prefers on-screen candidates only while the highlight's own rect is in the viewport. Measured from the rect, not the IntersectionObserver: a first draft read the observer, and "and leaving the screen forgets it" then failed 2 runs in 9 (main: 0 in 4).
  - test:app driver fix (`test/app/driver.ts` `choose`): with the target off screen it pressed only up or down, even when the target was on the highlight's own row. It now presses across in that case.
  - `test/app/interface.test.ts` 4 runs in 4 green after both fixes; full `npm run test:app` 195/195. `check.sh` once hit an unrelated `romm.test.ts` flake (issue #70, 5 reruns green), then green: 1502 tests, coverage 96.17 / 93.67 / 95.77.
  - Tests: `gamepad.test.tsx` "L3 and R3 held together" (5: once per hold and only after it, one stick is nothing, letting go restarts, ignored while a game runs, ignored unmapped). `test/app/interface.test.ts` "the performance overlay" (3: off until switched on in Settings → System, `position: fixed`; a `perf summary` line for `library` with numeric fields in app.log; switched off again).
  - `npm run shots:nova`: 15 screens. Looked at `perf-overlay.png` (overlay bottom-left over the library, nothing moved, all power values "unknown" under Xvfb, p50 16.7 ms at 60 Hz), `settings-system.png` (the tab's top, unchanged; the switch is further down), `running.png` (overlay off again).
- Not done (part 3b): line 1's cost scenario (overlay on vs off under 0.3 ms per frame) and line 3's 30 s scripted scroll of a 1,300-game platform; line 4's perf-state.json half (format still unknown).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet.
- Next: M0-10 part 3b, the two test:app measurement scenarios.

## 2026-10-09 15:26 UTC session 6d123f95 (routine run)

- Device results: DEVICE-RESULTS 4c5b675a2df2f21a7a27e94ba97a12699762d222 complete; DEVICE-RESULTS 9390ac87198d706a64e7a96ea2792118406b1e7f complete. Both are the minimal harness ("only harness.run until M0-22"): `harness.run` passed on each, no `safety.*` check ran, so nothing flips (`--apply` printed no PASSES line and changed nothing). `bridge/status.json` still says last seen 2026-10-08T15:06Z: the bridge writes it only when it skips (`maybe_heartbeat`), so a bridge that tests every night looks silent to `--summary`.
- Worked on: M0-10 part 3b of 3 (tracking issue #66): acceptance lines 1 and 3. Part 3a, PR #69, merged at 9390ac8; its CI wall time was x64 3:41, arm64 1:05.
- Result: PR (this one). M0-10 stays false: line 4's `/run/armada/perf-state.json` half still waits for that file's real format.
- Evidence:
  - `test/app/server.ts`: `startFakeRomm({ bulk })` adds platform `BULK_PLATFORM` (NES) with that many generated games (ids from 10001, with covers), beside the hand-written ones every other scenario names. `startScenario({ server })` passes it through. `test/app/driver.ts`: `app.metrics()` returns Chromium's `Performance.getMetrics` from outside the page.
  - `test/app/perf.test.ts` "the performance overlay on a 1300-game platform", its own application and server:
    - Line 1, "costs under 0.3 ms of main-thread work per frame": the library narrowed to the 1,300 games, a frame-counting rAF loop running on both sides, `TaskDuration` per frame over 5 s with the overlay off, then on (L3+R3 held on a pad). Three runs on the VM: off 0.383 / on 0.420, 0.369 / 0.378, 0.351 / 0.383 ms per frame, so the overlay adds 0.01 to 0.04 ms.
    - Line 3, "a 30 s scroll down the grid logs its summary": D-pad Down held for 30 s on the 1,300-game platform with the overlay on; the grid paged past its first page (asserted from the server's requests); leaving the screen writes `perf summary {"screen":"library","frames":1781,"p50":16.7,"p90":16.7,"p99":33.4,"jankyPct":4.0,...}` to app.log (1787 and 1787 frames on the other two runs).
  - The whole file takes about 50 s.
  - `scripts/agent/check.sh` green: coverage 96.17 / 93.67 / 95.77 (no unit code changed). Full `npm run test:app` 197/197 (3:22).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: `device-results.mjs --summary` should count a published result as the bridge being seen, or the 7-day silence rule fires on a bridge that is testing every night. Then whatever `next.mjs` lists first.

## 2026-10-09 15:52 UTC session 6d123f95 (routine run, second unit)

- Device results: none new (the two above, already ingested).
- Worked on: issue #72, a fix to `scripts/agent/device-results.mjs` (M0-23's tool). M0-10 part 3b, PR #71, merged at 00bc1df; its CI wall time was x64 4:34, arm64 0:59.
- Result: PR (this one).
- Evidence:
  - Cause: `--summary` took the bridge's last sighting from `bridge/status.json` alone. The bridge writes that file only when it skips (`maybe_heartbeat`), so on 2026-10-09 it said "last seen 24.4 h ago" an hour after the bridge published a result. Left alone, a bridge testing every night would trip CLAUDE.md's 7-day silence rule.
  - Fix: `analyse` takes the newest of `status.lastSeen` and every result's `finishedAt`; a branch with results and no status is seen too. Last skip and version still come from the status.
  - Test first: `scripts/agent/device-results.test.ts` "a published result is the bridge being seen, since only a skip writes its status" failed before the fix and passes after: results newer than the status win, a later skip wins, and results with no status still render a sighting. 18/18 in the file.
  - On the real branch: `--summary` now prints `Bridge: last seen 0.7 h ago (2026-10-09T15:05:03Z)`.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci` tooling).
- Next: whatever `next.mjs` lists first (M0-10 is left only with line 4's perf-state.json half, which waits for the file's real format; then M0-11).

## 2026-10-09 15:59 UTC session 6d123f95 (routine run, third unit)

- Device results: none new.
- Worked on: flaky issue #70, `romm.test.ts` "a transfer that keeps breaking is a failure, and leaves what arrived" reading an empty `.part`. #72's fix, PR #73, merged at cc5e0c1; its CI wall time was x64 4:33, arm64 0:49.
- Result: PR (this one).
- Evidence:
  - Root cause, in `src/main/romm/transfer.ts`: `fetchToFile` piped the body into a write stream that had not opened its file yet. A write stream holds chunks until its file is open and discards them when destroyed first, so a connection lost before the open (under load, the test's 20 ms break) took bytes that had already arrived with it, and the last attempt left an empty `.part`. Resuming was never corrupted by it, since a retry re-reads the `.part` size from disk; the bytes were only fetched again.
  - Fix: `await once(sink, 'open')` before the body is wrapped with `Readable.fromWeb` and piped; a failed open cancels the body. The first draft wrapped the body before the wait, and the evaluator found that an abort during the wait then errored a Node stream nothing listened to (an uncaught exception). "a transfer cancelled while its part-file opens fails quietly" reproduces that (failed 2 in 2 on the first draft, passes now).
  - Test first: "bytes that arrive before the part-file is open still reach it" breaks the connection from `onProgress`, the moment the transfer has counted the bytes. Without the fix it failed 3 runs in 3 (`'' !== '01'`), with it it passed 3 in 3. A first draft broke on the very next read instead; that loses the chunk inside `Readable.fromWeb` before the transfer sees it, so it failed with the fix too and was replaced.
  - `src/main/romm.test.ts` 111/111. `fetchfile.ts` was left alone: it does not resume, and a failed fetch there is discarded whole.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M0-10 waits only on line 4's perf-state.json format; then M0-11 (`next.mjs`).

## 2026-10-09 16:27 UTC session 4199a15f (routine run)

- Device results: DEVICE-RESULTS cc5e0c1ca9669ad0441af04d3fbce129b162798d complete. Minimal harness again: no `safety.*` check, nothing flips. Bridge last seen 0.3 h before the run.
- Worked on: M0-11 part 1 of 2 (tracking issue #75): acceptance lines 1 to 3. #70's fix, PR #74, merged at c5c67ad before this run.
- Result: PR (this one). M0-11 stays false until part 2.
- Evidence:
  - `src/main/redact.ts` `redact(text, { serverUrl })`, pure: the RomM host becomes `<server>`; `rmm_` tokens, bearer and basic credentials, `Authorization`/`Cookie`/`Set-Cookie` header values, the user and password in `https://user:password@host`, and the value of any key containing password, token, secret, cookie, authorization or a pairing code (`ROMM_PASSWORD`, `csrf_token`, `deviceCode` as well as the bare words) in JSON, `key=value` and `key: value` form, and a pairing code named in prose, become `<removed>`; IPv4 and IPv6 (full form, or with `::`) become `<ip>`. `src/main/redact.test.ts` "nothing the acceptance names survives a log that holds all of it" feeds one of each and asserts none survives; clock times, `std::vector`, `4:3` and three-part versions are left alone.
  - `src/main/report.ts` `writeReport` writes `<root>/reports/<UTC stamp>.zip` with the existing `zipDirectory`, from a staging folder it removes whatever happens: `logs/app.log` and `logs/launcher.log` (each its last `LOG_TAIL_BYTES`, cut at a whole line), `launches.log` (the last `LAUNCHES` launch starts with the launch and emulator lines after each), `perf.log` (the last perf summaries), `settings.json`, `versions.json`, `system.json` (os-release, kernel), `environment.json` (an allow-list of names and prefixes, minus any whose name says secret), and one `<name>.json` per caller section (a throwing section records its error). Every file passes through `redact`, with the caller's server and the one `config/settings.json` names, so a report written signed out still hides it.
  - `src/main/report.test.ts`: "the report carries its parts, and nothing from config/ but redacted settings" asserts the exact file list against a root holding `config/credentials.bin` and `config/keyring/`, and that neither their contents nor the host nor an address survive; "logs far past the limit are cut to their tail and the report stays under it" (two 30 MB logs: the zip and its unpacked contents both under `REPORT_LIMIT`).
  - `scripts/agent/check.sh` green: coverage 96.21 / 93.70 / 95.76.
- The evaluator's first pass failed it on URL userinfo and prefixed keys (`ROMM_PASSWORD=`, `"romm_password":`) surviving; both, a camelCase `deviceCode` and a JSON `Authorization` of any scheme are now in the "nothing survives" test. Its second pass found the widened key pattern quadratic (200 KB of `a-a-a...` took 45 s); the key is now bounded and anchored at a key's start (7 ms), and "a long run with no space in it is redacted in linear time, not hung on" guards it.
- Not done (part 2): the IPC call, the Settings → System entry and the quit-dialog entry, the live sections (pre-flight, emulator probes, power state, Mesa and gamescope versions), and line 4's test:app scenario.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M0-11 part 2.

## 2026-10-09 16:52 UTC session 4199a15f (routine run, second unit)

- Device results: none new.
- Worked on: M0-11 part 2a (tracking issue #75): the main-process side of Report a problem. Part 1, PR #76, merged at e99093e; its CI wall time was x64 4:37, arm64 0:52.
- Result: PR (this one). M0-11 stays false: the pad-driven test:app scenario (line 4) needs the Settings and quit-dialog entries, which are part 2b.
- Evidence:
  - Part 1 bug, test first: `perfSummaries` looked for `perf summary`, but `system:perfSummary` writes area `perf`, message `summary`, padded into columns, so no summary would ever have reached a report. `report.test.ts` now writes the line in the log's real shape; with the old matcher it failed 2 tests ("the report carries its parts…", "perf summaries are picked from the log in the shape the log writes them"), with the fix 9/9.
  - `src/main/ipc/system.ts`: the pre-flight check is a function `preflight` shared by `system:diagnostics` and the new `system:report`, which calls `writeReport` with versions (app, commit, channel from the updater's status; Electron, Chromium, Node), the stored server for redaction, and sections `preflight` (carries the emulator probes), `power` (`readPowerState`) and `graphics` (Chromium's basic GPU info, which names the Mesa driver, and `gamescope --version`). `src/shared/api.ts` and the preload expose `system.report()`; the preview bridge answers with a path.
  - `src/main/host.ts` `commandVersion`: the first line a command prints on either stream, null when it is missing, silent or fails. `host.test.ts` "a version is read from whichever stream the command prints it on".
  - `test/app/interface.test.ts` "a problem report carries that summary, the probes and no server address": in the built app, `system.report()` returns a `reports/<stamp>.zip` path; the zip holds graphics, app log, perf, power, pre-flight and versions, nothing from `config/`; `perf.log` has the library's summary; `preflight.json` has the emulator list; the fake RomM's host:port appears nowhere. Passed under Xvfb (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
  - `scripts/agent/check.sh` green: coverage 96.22 / 93.71 / 95.77.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M0-11 part 2b: Settings → System "Report a problem" and the quit-dialog entry (four catalogues), the pad-driven test:app scenario, `npm run shots:nova`.

## 2026-10-09 17:30 UTC session a85849a6 (routine run)

- Device results: DEVICE-RESULTS 32e6fd3 complete. Minimal harness again: no `safety.*` check, nothing flips. Bridge last seen 0.3 h before the run.
- Worked on: owner issue #78 (HD texture packs from a private mirror), claimed on #78 itself. Part 2a of M0-11, PR #77, merged at 32e6fd3 before this run; its CI wall time was x64 4:30, arm64 0:54.
- Result: PR (this one), docs and the feature guard only. No research or implementation, as #78 asks.
- Evidence:
  - `docs/features.json`: M7-18..M7-23 appended after M7-17, exactly #78's JSON, `ISSUE-78` in each `source`. The owner's text needed no change: both device features name catalogued checks.
  - `docs/emulator-tuning/textures-seed.json`: #78's seed catalog, 48 packs, upstream links only.
  - `docs/TESTING.md`: catalogue rows `textures.install` (self-test; M7-21) and `textures.load` (run.sh; M7-22), and M7-23 beside the shader and aspect rounds in the acceptance session's contents.
  - `scripts/agent/features-check.mjs`: REQ-17 is owed a feature like REQ-1..16; the coverage fixture and the REQUIRED_SOURCES count include it. 37/37.
  - `docs/REQUIREMENTS-FROM-TESTER.md` item 17 (the owner's words, the hand-installed packs, where it is scheduled); `docs/PLAN.md` M7 lists M7-18..M7-23, a risk line on pack licences, and the exit gate names M7-23.
  - `scripts/agent/check.sh` green (`features-check: 168 features, all rules hold`).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-11 part 2b (Settings → System "Report a problem", the quit-dialog entry, the pad-driven test:app scenario).
- Notes:
  - #78's hand install is owner state on the device: `Textures/` on the SD card, its links in eight emulator folders, and the texture settings it lists (each backed up to `<file>.bak-texpacks`). Device tests must leave them as they are; M7-21's device check snapshots them.
  - RetroArch's dolphin core shipped without `system/dolphin-emu/Sys` until the owner's side installed it on 2026-10-09. M1-23's emulator check should notice missing core system files (#78).

## 2026-10-09 17:53 UTC session a85849a6 (routine run, second unit)

- Device results: none new.
- Worked on: M0-11 part 2b (tracking issue #75): Report a problem in Settings → System and in the quit dialog, and acceptance line 4. Owner issue #78's plan, PR #79, merged at 25ca68c; its CI wall time was x64 4:34, arm64 0:53.
- Result: PR (this one). PASSES M0-11 (ci): all four acceptance lines are met (lines 1 to 3 by #76, line 4 here).
- Evidence:
  - `ReportProblemButton` (`src/renderer/src/components/overlay.tsx`): calls `system.report()` and names the zip in a toast; it is disabled while the report is written. It sits in its own "Report a problem" section on the System tab, with a line saying what goes in and what is removed, and at the end of the quit dialog's second row. Strings `system.reportTitle`, `reportExplainer`, `reportProblem`, `reportWriting` and `reportWritten` are in all four catalogues, translated.
  - Bug, test first: a report named by the second it was written replaced an earlier report from the same second. The first pad scenario found it: the zip the previous scenario had just written was overwritten, so no new file appeared. `report.test.ts` "a second report in the same second is kept beside the first, not over it" failed before the fix and passes after (10/10). `writeReport` now claims the first free name with an exclusive create (`-2`, `-3` and so on) and removes the claim if zipping fails.
  - `test/app/interface.test.ts` "reporting a problem with the controller":
    - "A on Settings -> System -> Report a problem writes the zip and names it" scrolls to the button, puts the highlight on it, presses the test pad's A, and finds a new zip in `reports/` and a toast naming it.
    - "and from the quit dialog, which then stays open" reaches the dialog with B, presses A on the entry, finds a new zip, and closes the dialog with B.
    - The existing report scenario now also asserts `<server>` in the report's `settings.json`. That proves the host rule ran, whatever the address rule hides of 127.0.0.1.
    - The file passed 101/101 under Xvfb (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
  - `npm run shots:nova`: new nightly-only shots `report` and `quit`, 17 screens. I looked at:
    - `report.png`: the section under Re-run check, and the toast with the zip path, both readable at 1280x960.
    - `quit.png`: Stay and Quit Galleon alone on the first row; Sleep, Restart, Turn off and Report a problem after the rule.
    - `settings-system.png`: the top of the tab, unchanged.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: `next.mjs`'s first feature. M0-12 must ignore a stray `reports/.staging-*` (see #75).

## 2026-10-09 18:27 UTC session fe0b4bc0 (routine run)

- Device results: DEVICE-RESULTS 32e6fd3c2490e5637a7a6961f1e506eb3c73d8ca complete; DEVICE-RESULTS 25ca68c80a0813c31cd24e345c86f86f4c12dbf1 complete. Minimal harness: no `safety.*` check, `--apply` flipped nothing. (The previous entry recorded 32e6fd3 by its short sha, which `device-results.mjs` does not recognise, so it is recorded here in full.) Bridge last seen 0.3 h before the run.
- Worked on: M0-15 part 1 (tracking issue #81): the acceptance-session generator, acceptance lines 1, 2 and 4. M0-11 part 2b, PR #80, merged at 1d71b66 before this run; its CI wall time was x64 4:45, arm64 0:57.
- Result: PR (this one). M0-15 stays false: line 3 (`acceptance/<date>/results.json` read back by `device-results.mjs`, passes flipped, a bug per fail) is part 2.
- Evidence:
  - `scripts/agent/acceptance.mjs` writes `docs/ACCEPTANCE.md` from features.json, PROGRESS.md and the new `docs/acceptance-plan.json`. An `acceptance` feature joins on `READY-FOR-ACCEPTANCE <id>`; an `Acceptance session (informational):` line joins once its feature passes or is READY for the device or the session. M8-07 is the session itself, not an item. Items are grouped by place (the Mac, the Nova in Game Mode, Android with Argosy, a browser) with minutes per group; the save backup comes first and recording the results last; the results table has a row per item.
  - Each item names the build (`--build`, the package version otherwise), its numbered steps, what a pass looks like (`passWhen`) or, for an informational line, what to notice, and the feature it decides. A ready item without steps in the plan stops the generator.
  - `planErrors`: every feature with an acceptance-session line has exactly one item, every item names such a feature, a known place and positive minutes, and the sum over the whole plan (ready or not) is at most `SESSION_LIMIT_MINUTES`. The real plan totals 118 minutes.
  - `scripts/agent/acceptance.test.ts`, 14 tests, including "a plan over the session limit is refused, counting items not ready yet", "each item names the build, its steps, what a pass looks like and the feature it decides", "the same inputs write the same script", and "docs/ACCEPTANCE.md is what the generator writes now" (`--check`), so a PR that adds a READY-FOR-ACCEPTANCE line without regenerating the script fails.
  - `docs/ACCEPTANCE.md` today holds the backup, the results step and "No feature is ready for the session yet". It is in `.prettierignore`: the test holds it to the generator byte for byte.
  - `docs/TESTING.md` names the generator and the plan file.
  - `scripts/agent/check.sh` green: coverage 96.23 / 93.69 / 95.83.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M0-15 part 2 (results.json read-back in `device-results.mjs`).

## 2026-10-09 18:44 UTC session fe0b4bc0 (routine run, second unit)

- Device results: none new.
- Worked on: M0-15 part 2 (tracking issue #81): acceptance line 3. Part 1, PR #82, merged at 447022e; its CI wall time was x64 4:42, arm64 1:01.
- Result: PR (this one). PASSES M0-15 (ci): lines 1, 2 and 4 by #82, line 3 here.
- Evidence:
  - `scripts/agent/device-results.mjs`: `readBranch` reads every `acceptance/<date>/results.json`; `analyse` takes the sessions no `ACCEPTANCE-RESULTS <date>` line names, oldest first. An `acceptance` feature with a pass and no fail flips to true; a failed item sets it back to false; a skip decides nothing; a later session decides over an earlier one. A file not in TESTING.md's shape (schema 1, items with feature and pass/fail/skip) decides nothing and stays new. `issuesToOpen` adds one `[acceptance] <id> [<system>]` issue per failed item (labels `bug`, `acceptance`), informational items included, quoting the notes as data and skipping titles already open. `progressLines` prints `ACCEPTANCE-RESULTS <date>` and `PASSES <id> acceptance:<date>`, which `features-check` already demands for an acceptance flip.
  - Session newness moved from "dated on or after the last device result" to the `ACCEPTANCE-RESULTS` marker: a date compared with a device result's time would skip a session results.json pushed late, or read one twice. The PROGRESS.md legend names the new line.
  - `scripts/agent/device-results.test.ts` 23/23, new: "an acceptance item marked pass flips its feature and is recorded with its date", "one failed item keeps the feature false, reverts a passed one, and each fail is a bug", "skipped items decide nothing, and a later session decides over an earlier one", "a session without a valid results.json decides nothing and stays new", and, on a scratch repository through the command, "an acceptance session on the branch flips its passes with --apply".
  - `docs/TESTING.md` "Reading them back" states the rules.
  - `scripts/agent/check.sh` green: coverage 96.26 / 93.75 / 95.86.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: PASSES M0-15 (ci).
- Next: `next.mjs`'s first feature (M0-19 or M1-01).

## 2026-10-09 18:53 UTC session fe0b4bc0 (routine run, third unit)

- Device results: none new.
- Worked on: M1-01 (tracking issue #85): Gate 0 on the record. M0-15 part 2, PR #83, merged at 2cf29a1; its CI wall time was x64 4:48, arm64 0:56. M0-15 passes; #81 closed.
- Result: PR (this one). PASSES M1-01 (ci).
- Evidence:
  - Line 1: `gate` issue #84, "Gate 0: PASS, proceed with the RomMix fork", quotes the PHASE 0 RESULTS table and the caveat table from docs/PLAN.md, states "Gate 0: PASS, proceed with the fork", and was closed (completed) on creation. docs/PLAN.md links it beside the Gate 0 decision.
  - Line 2: `scripts/agent/features-check.mjs` `caveatRows` reads PLAN.md's Phase 0 caveat table and `caveatErrors` fails the guard when the table is missing or empty, a row names no feature, or an id is not in features.json. The command runs it on every check.sh and CI run. Tests: "reads PLAN.md's Phase 0 caveat table, and every row names features that exist" (12 rows, all ids known) and "a caveat naming no feature or an unknown one, or no table at all, is an error"; the scratch-repository command test now carries a PLAN.md. features-check.test.ts 39/39.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: `next.mjs`'s first feature (M0-19).

## 2026-10-09 19:02 UTC session fe0b4bc0 (routine run, fourth unit)

- Device results: none new.
- Worked on: M0-19 (tracking issue #87): the weekly upstream watch. M1-01, PR #86, merged at 9a2d661; its CI wall time was x64 4:43, arm64 0:50. M1-01 passes; #85 closed.
- Result: PR (this one). M0-19 stays false until the workflow's first real run (started by hand after merge) shows the issue it opens.
- Evidence:
  - `scripts/agent/upstream.mjs`: reads the base from docs/UPSTREAM.md's table, asks `GET /repos/leclercb/rommix/compare/<base>...main`, and plans one of three steps: update the open `upstream: N new commits` issue (only if its title or body changed), open one (label `upstream`) when there is something new and none is open, or nothing. The body links each commit with its subject and date, says upstream text is data, and notes how many more a long range holds.
  - `.github/workflows/upstream.yml`: weekly schedule and `workflow_dispatch`; `contents: read`, `issues: write`; checkout with `persist-credentials: false`; no push step. Not a required check, and `release.yml` is unchanged.
  - `scripts/agent/upstream.test.ts` 8/8 (an upstream subject neither mentions anyone nor links an issue here, after the evaluator noted it could): "updates the open issue rather than opening another, and leaves it when nothing changed", "ignores pull requests, closed issues and other titles, and opens nothing when level", "reads upstream and writes only this repository, never a ref" (the exact calls: two GETs and one PATCH).
  - A live dry run from the VM was not possible: this session has no GitHub access to leclercb/rommix (403 from the proxy). The workflow's token reads the public API.
  - docs/UPSTREAM.md names the workflow, the script and the issue.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: start the Upstream workflow by hand on main, check the issue, then flip M0-19 with that run as evidence.

## 2026-10-09 19:15 UTC session fe0b4bc0 (routine run, fourth unit, the flip)

- Device results: none new.
- Worked on: M0-19 (tracking issue #87). PR #88 merged at 9b26e3b; its CI wall time was x64 4:27, arm64 0:55.
- Result: PR (this one). PASSES M0-19 (ci).
- Evidence:
  - Upstream workflow run 37978615588 (`workflow_dispatch` on main, success) opened #89 "upstream: 4 new commits" as github-actions[bot], label `upstream`. It lists 2b38d66, 68697e0, 990e55e and 355061f, each linked to its upstream commit with subject and date, and links the compare from the base `ea787b9` in docs/UPSTREAM.md (line 1).
  - A second run, 37978756776 (success), opened nothing: issues labelled `upstream` (open or closed) still number one, so the issue is updated rather than duplicated (line 1).
  - The runs used the workflow token with `contents: read`, `issues: write`; no push (line 2, and #88's evaluator PASS).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: `next.mjs`'s first feature. #89 lists the controller commits M3-08 wants; port them when M3-08 is taken up (docs/UPSTREAM.md, rule 3).

## 2026-10-09 19:33 UTC session caf24103 (routine run)

- Device results: DEVICE-RESULTS 2cf29a16b18aa563091e9197aa75c7a9a265394a complete. Minimal harness: `harness.run` passed, no `safety.*` check ran, `--apply` flipped nothing. Bridge last seen 0.5 h before the run.
- Worked on: M0-14 (tracking issue #91): `cut-release.yml`. M0-19's flip, PR #90, merged at 17fa7ed.
- Result: PR (this one). M0-14 stays false until the workflow's first run on main shows it refusing a version before tagging.
- Evidence:
  - `scripts/release-check.mjs` `releaseErrors`: refuses a version that is not plain or suffixed semver (no `v`, no build metadata), that package.json does not carry, or that has no `## <version>` CHANGELOG.md heading (matched as release-notes.mjs finds it). The command prints one `::error::` per reason and exits 1 (line 2).
  - `.github/workflows/cut-release.yml`: `workflow_dispatch` with `version`, main only. `verify` refuses a `release` environment without required reviewers (a job naming a missing environment would create it unprotected and run), then the version (`release-check.mjs`), then a tag already taken (only a 404 counts as free). `build` calls `release.yml` (`workflow_call`), the same matrix in full. `release` needs both, runs in `environment: release` (line 1), and is the only job that tags or publishes: softprops pinned by SHA with `tag_name: v<version>`, `target_commitish: github.sha`, both images, the Steam script and SHA256SUMS, and writes the release, commit and run to the job summary for the PROGRESS entry (lines 3 and 4).
  - `release.yml`: the `tags: v*` trigger, its tag check and its `release` job are gone (PLAN.md section 4); `workflow_call` added; the canary skips a release's build (`!inputs.version`); a release's build gets its own concurrency group. The `build` job, its name and matrix keys are unchanged.
  - `.release-it.js` commits the bump and changelog on the current branch without tagging or pushing; README "Releasing", CONTRIBUTING and PLAN.md describe the new path.
  - `scripts/release-check.test.ts` 9/9, among them "only the job behind the release environment tags or publishes, after the build" and "no tag push publishes anything, and a release build publishes no canary". actionlint 1.7.7 clean on both workflows.
  - `scripts/agent/check.sh` green: coverage 96.22 / 93.62 / 95.88.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: after merge, dispatch Cut a release on main with a version package.json does not carry; a red `verify` with no tag is line 2's run evidence and shows the environment check reads the protection. Then flip M0-14.

## 2026-10-09 19:47 UTC session caf24103 (routine run, the flip)

- Device results: none new.
- Worked on: M0-14 (tracking issue #91). PR #92 merged at e76fcf9; its CI wall time was x64 4:34, arm64 1:00.
- Result: PR (this one). PASSES M0-14 (ci).
- Evidence:
  - Cut a release run 37982261554 (`workflow_dispatch` on main, version `9.9.9`): `verify` failed with "package.json says 0.20.0, not 9.9.9" and "CHANGELOG.md has no '## 9.9.9' section"; `build` and `release` skipped; `v9.9.9` does not exist (404) and the releases are still only `nightly` and `canary` (line 2).
  - The same run's "Check that the release environment needs an approval" step passed: the `release` environment exists with required reviewers, and the `release` job is the only one that tags or publishes (line 1, #92's tests and evaluator PASS).
  - Build, tag and publish are one run, with release.yml called through `workflow_call` and no tag-push trigger left (line 3).
  - The run's job summary carries the release, commit and run for the PROGRESS entry (line 4).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: after any real release, open a PR appending its job summary (release, commit, run) to this file, as M0-14 line 4 asks (docs/TESTING.md, the acceptance session, says so too). Then `next.mjs`'s first feature (M1-02).

## 2026-10-09 20:02 UTC session caf24103 (routine run, second unit)

- Device results: none new.
- Worked on: M1-02 (tracking issue #94): the DuckStation descriptor. M0-14's flip, PR #93, merged at d4c2d35; its CI wall time was x64 4:02, arm64 0:28. M0-14 passes; #91 closed.
- Result: PR (this one). PASSES M1-02 (ci).
- Evidence:
  - `src/config/emulators/duckstation/index.ts`, registered last in `EMULATORS`: AppImage `duckstation*.appimage` first (the catalog's `~/Applications/DuckStation-<arch>.AppImage`; release source stenzek/duckstation, Linux AppImages only), flatpak `org.duckstation.DuckStation` second, `duckstation-qt` on PATH last; system `psx`; argv `-batch -fullscreen -nogui -- <rom>`; BIOS `data/duckstation/bios`, saves `data/duckstation/memcards` matched by ROM stem (per-game `<title>_<slot>.mcd`); `flatLibrary: false`, so a multi-file game keeps its own folder (the evaluator's first pass caught `true`, which would have unpacked disc sets loose into `psx/`); no states, since DuckStation names them by serial. The comments cite qthost.cpp at the pinned commit in docs/research/armada_integration.md (line 3).
  - Line 1: `registry.test.ts` "DuckStation is found as the catalog AppImage first, then on Flathub" (install order, flatpak id, and `findMatchingFile` finding `DuckStation-arm64.AppImage` in a scratch folder and nothing beside it), "DuckStation downloads only its Linux AppImages", "DuckStation runs PlayStation games only", "DuckStation boots a .chd or an .m3u fullscreen, exits with the game, and ends options first" (AppImage and flatpak exec), "DuckStation's BIOS and memory cards are its own XDG folders"; `savepaths.test.ts` "DuckStation's per-game memory cards are matched to the ROM, and nothing is said of states". `stemMatches('Final Fantasy VII_1', 'Final Fantasy VII (USA) (Disc 1)', '.mcd')` is true.
  - Line 2: `grep -rn -i duckstation src --include=*.ts | grep -v src/config` is empty apart from i18n. Two comments (savefiles.ts, saves.test.ts) and a test tag (romm.test.ts, now `swanstation`) named it before; they are reworded.
  - `scripts/agent/check.sh` green (coverage 96.23 / 93.61 / 95.87); `npm run test:app` 200/200 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root; CI keeps the sandbox). `npm run shots:nova`: looked at `emulators.png`: DuckStation is the last row, "Not installed", "1 platform", Install, its down arrow disabled; nothing clipped.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: `next.mjs`'s first feature (M1-12).

## 2026-10-09 20:27 UTC session b698cc4a (routine run)

- Device results: DEVICE-RESULTS d4c2d3543101873b04c5f1d1ceca9f299ab9d93e complete. No `safety.*` failure, no regression, `--apply` flipped nothing.
- Worked on: M1-09 part 1 of 2 (tracking issue #96): acceptance lines 1 and 2. M1-02, PR #95, merged at 4e0f65f.
- Result: PR (this one). M1-09 stays false until the pre-flight check names the rule (line 3).
- Evidence:
  - ES-DE's `linuxarm` `es_find_rules.xml` and `es_systems.xml` vendored unchanged at a8cf738d in `packaging/es-de/linuxarm/`, credited with ES-DE's MIT licence in THIRD_PARTY.md.
  - `src/main/findrules.ts`: `parseXml` returns every top-level element (a forest), skipping declarations and comments, and null for anything not well-formed; `addFindRules` / `addSystems` take `<emulator>`, `<core>` and `<system>` from every top-level list and loose at the top level, an entry replacing the earlier one of the same name whole and in place; `loadFindRules(bundled, custom)` leaves out a custom file that does not parse and names it; `findEmulator` / `resolveRuleSet` expand `~` and `*` (any path component, case-sensitive) and return the first existing match in file order with the emulator, source, rule type and entry that found it.
  - Line 1: `findrules.test.ts` "the parser keeps every top-level element, not only the first", "a custom rule replaces the bundled one by name, whole, and keeps its place", "a custom system replaces the bundled one by name", "loading layers the custom folder on the bundled one and names a broken file", "the vendored linuxarm files parse whole" (195 systems).
  - Line 2: `registry.test.ts` "ES-DE's find rules resolve DuckStation from the catalog's AppImage in a fake home" (`DUCKSTATION`, staticpath `~/Applications/DuckStation*.AppImage`), and `findrules.test.ts` "a glob expands `*` in any component …" and "resolution takes the first rule and entry that find something, and names it".
  - `scripts/agent/check.sh` green: 1579 tests, coverage 96.27 / 93.67 / 95.93.
- CI wall time: recorded in the next entry (this entry rides the PR). The first x64 run failed only at the pull-request body check: the body opened without `Feature: M1-09`. The body was corrected and this line pushed, since a re-run reads the old body.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: M1-09 part 2: ship `packaging/es-de/` in the image (`extraResources`), load it with `~/ES-DE/custom_systems/` at start, and have the pre-flight check name the rule that found each emulator (line 3).

## 2026-10-09 20:46 UTC session b698cc4a (routine run, second unit)

- Device results: none new.
- Worked on: M1-09 part 2 of 2 (tracking issue #96): acceptance line 3. Part 1, PR #97, merged at a80e028; its CI wall time was x64 4:50, arm64 0:59.
- Result: PR (this one). PASSES M1-09 (ci).
- Evidence:
  - Descriptors carry `findRule` (ES-DE's `<emulator>` name: `DUCKSTATION`, `RETROARCH`, `EDEN`; `undefined` where ES-DE has none). `resolveInstall` tries the rule after a settings path and a Galleon-managed copy and before the descriptor's own routes; a rule reaching a flatpak's exported command becomes that flatpak (only if `flatpak info` still knows it). The install records `foundBy` (rule, type, entry, bundled or custom).
  - `RomMixApp.findRules` reads the bundled copy (`process.resourcesPath/es-de/linuxarm` in the image, shipped by `extraResources`; `packaging/` from a checkout) with `~/ES-DE/custom_systems/` on top for every probe, and logs a file that did not parse.
  - Line 3: the pre-flight check's log line carries `foundBy` per emulator, and Settings → System → Pre-flight check has a "Found by" row naming, per installed emulator, the ES-DE rule and entry (or the path, when no rule found it). `test/app/findrules.test.ts` "the pre-flight check names the rule and entry that found an emulator": the built app with HOME holding `~/Applications/DuckStation-arm64.AppImage` returns `foundBy` `DUCKSTATION` / staticpath / `~/Applications/DuckStation*.AppImage` / bundled from `system.diagnostics()`, and Settings → System shows "DuckStation: ES-DE's DUCKSTATION rule, ~/Applications/DuckStation*.AppImage". `emulators.test.ts` "the catalog's AppImage is found by the bundled rule, and the probe says which", "a rule reaching a flatpak's exported command is that flatpak", "a systempath rule finds a program on PATH as a binary".
  - Intended: with a rule tried first, a machine holding both a native `retroarch` on PATH and the RetroArch flatpak now gets the native one, as ES-DE's RETROARCH rule (systempath first) would launch; with one install nothing changes. A settings path or a Galleon-managed copy still wins over any rule.
  - Lines 1 and 2: part 1 (#97).
  - `scripts/agent/check.sh` green: 1583 tests, coverage 96.24 / 93.69 / 95.94. `npm run test:app` 201/201 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). `npm run shots:nova`: `settings-system.png` unchanged above the fold; a temporary scrolled shot (not committed) shows the Pre-flight list with "Found by — Eden: <stand-in path>" between Free space and Controller, aligned, nothing clipped.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: `next.mjs`'s first feature (M1-12).

## 2026-10-09 21:33 UTC session 4e493a14 (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (no new nightly).
- Worked on: M1-12 (tracking issue #99): emulators start with a clean environment, inside Steam's tree. M1-09's part 2, PR #98, merged at eaed1a5.
- Result: PR (this one). PASSES M1-12 (ci).
- Evidence:
  - `src/main/childenv.ts`: `childEnvironment(parentEnv, descriptorEnv)` drops `APPDIR`, `APPIMAGE`, `ARGV0` and `OWD`, drops `LD_LIBRARY_PATH` and `PATH` entries inside the mounted image (`APPDIR`), drops Steam's `gameoverlayrenderer.so` from `LD_PRELOAD` (colon- or space-separated) and keeps any other preload, puts `/usr/bin:/usr/local/bin:/bin` first on PATH with the rest in order, keeps everything else (display, session, Steam), and applies the descriptor's variables last. `spawnEmulator` builds it, logs the differences, and spawns with `detached` (setsid) and no double fork; both launch paths in `launcher.ts` (a game session and an emulator opened on its own) use it.
  - Line 1: `childenv.test.ts`, one test per rule: "the AppImage runtime's own variables are dropped", "library path entries inside the image are dropped, and the session's own kept", "outside an AppImage the library path is left alone", "Steam's overlay preload is dropped, and any other preload kept", "the system directories come first on PATH …", "display, session and Steam variables are kept unchanged", "the descriptor's variables apply last …", "the parent environment is not modified".
  - Line 2: "the emulator is a direct child of the launcher in a session of its own, and the differences are logged once": `/proc/<pid>/stat` gives the test process as the parent and the child as its own session leader; `/proc/<pid>/environ` carries the built environment. Only the recorded pid is signalled.
  - Line 3: the same test finds exactly one `DEBUG emulator child environment {"removed":[…],"set":{…}}` line per launch; "the differences name every variable dropped and every value set" checks its content.
  - `scripts/agent/check.sh` green: 1593 tests, coverage 96.29 / 93.76 / 95.96 (childenv.ts 100%). `npm run test:app` 201/201 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`ci`).
- Next: `next.mjs`'s first feature after M1-12 (M1-15 or M1-26 need screenshots; M2-01 is the save-sync spec).

## 2026-10-09 21:58 UTC session 4e493a14 (routine run, second unit)

- Device results: none new.
- Worked on: M1-26 (tracking issue #101): platform icons never show as broken. M1-12, PR #100, merged at 0a33021; its CI wall time was x64 4:34, arm64 0:59. M1-12 passes; #99 closed.
- Result: PR (this one). PASSES M1-26 (agent-screenshot).
- Evidence:
  - Cause: RomM 5.2.0 serves `ngc.svg` and `wiiu.svg` under both icon folders (checked in the pinned image's `/var/www/html/assets/platforms/`). The 404s Phase 0 saw are for the slugs RomM keeps for library folders it matched to nothing (`gc`, `wii-u`). `gc` already resolved to its system (icon `ngc`); `wii-u` resolved to nothing, so its only candidate was the missing one. The Library platform filter and the Home hero passed only the slug, never the table's icon.
  - `src/config/systems.ts`: Wii U also answers to `wii-u`; `PLATFORM_ICON_ROOT` names the icon folder. The Library filter and the Home hero pass the resolved system to `PlatformIcon`, as the other screens do.
  - `RommClient.asset` remembers a platform icon's 404 per server for the process and answers it from memory after that; a server error or a request that never reached the server is not remembered. `romm.test.ts` "platform icons": asked once and then 404 from memory, with or without the leading slash; a hit is asked every time; a 503 or a refused connection is not remembered; a cover's 404 is not remembered; a miss on one server is not a miss on another.
  - Line 1: `test/romm/icons.real.ts` against Docker RomM 5.2.0 (`npm run test:romm -- --profile v520`, 21/21): every fixture platform walks `PlatformIcon`'s candidates twice; each answers 200 or falls back to a short code (dc, gba, ngc, ps2, psp found under `systematic/`; `ps1` and `SNES` fall back to PS1 and SNES), and every path that was a 404 reached the server exactly once.
  - Line 2: the fallback is the existing `PlatformBadge`, the system's short code in the app's type, with no artwork.
  - Line 3: `shots:nova` gains `library-iconless` (fake RomM option `iconless`: GameCube as `gc`, Wii U as `wii-u`, no icons served). The shot fails on any `img` that loaded with no width and needs `GC` and `WIIU` badges. Looked at `library-iconless.png`: the filter row shows GC "Nintendo GameCube (1)" and WIIU "Nintendo Wii U (1)" badges, and the Cube Homebrew card shows GC. Nothing broken or clipped. `home.png` is unchanged. The first run showed WII-U on the filter chip (the chip did not resolve the slug), which is fixed above.
  - `systems.test.ts` "a GameCube or Wii U folder RomM matched to nothing still resolves, and to its icon", "every icon path is under the icon root".
  - `scripts/agent/check.sh` green: 1600 tests, coverage 96.29 / 93.78 / 95.95. `npm run test:app` 201/201.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`agent-screenshot`).
- Next: `next.mjs`'s first feature (M1-15, or M2-01 the save-sync spec).

## 2026-10-09 22:26 UTC session 47b946e9 (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (no new nightly).
- Worked on: flaky issue #103, `test/app/perf.test.ts` "costs under 0.3 ms of main-thread work per frame". M1-26, PR #102, merged at e83709e; its CI wall time was x64 5:35, arm64 1:00. M1-26 passes; #101 closed.
- Result: PR (this one). Root-cause fix for #103; no feature flag changes.
- Evidence:
  - Cause: the test took one 5 s window with the overlay off, then one with it on, and compared the two. Load from another process during one window and not the other moves that single difference by more than the budget. On the VM, with no other load, single windows on the same setting differ by up to 0.25 ms (off 0.585 next to off 0.33). Under bursty load (8 busy loops on 4 cores, on and off), one round's off-to-on difference moved by 0.475 ms.
  - Fix: `COST_ROUNDS` rounds, each an off window followed by an on window (`COST_WINDOW_MS` each), with the overlay toggled by the real L3+R3 chord between them (`toggleOverlay`). The test compares the median of the per-round differences with the unchanged `COST_BUDGET_MS`. The rounds end with the overlay on, which the scroll test after it needs for its summary.
  - Runs: under the bursty load, the median was -0.024 ms (rounds: off 0.401 on 0.376; off 0.491 on 0.369; off 0.315 on 0.464; off 0.836 on 0.361; off 0.399 on 0.403), so the round that load spoiled did not decide the result. Unloaded, the median was 0.036 ms. The cost test takes 44.6 s, up from about 13 s; the x64 leg stays well inside 10 minutes.
  - `scripts/agent/check.sh` green: 1600 tests, coverage 96.29 / 93.77 / 95.98.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: `next.mjs`'s first feature that does not wait on the device (M1-15, or M2-01 the save-sync spec).

## 2026-10-09 23:27 UTC session ac37955f (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (no nightly published yet).
- Worked on: M1-15 part 1 of 2 (tracking issue #105): the bounding-box check. Flaky #103's fix, PR #104, merged at 7edf0ba before this run.
- Result: PR (this one). M1-15 stays false until part 2 (the d-pad walk, line 2) lands.
- Evidence:
  - `test/app/layout.ts`: `MEASURE_LAYOUT` (renderer source) reads the box of every visible focusable (`data-focused`) on the screen, or in the topmost `.overlay` when one is open, with each ancestor whose overflow is not visible; `layoutOffenders` names, by `data-*` handle (state attributes such as `data-active` left out), each control outside the window, cut off by an ancestor that does not scroll, larger than its scroller, or overlapping another control it is not nested in. A control inside a scroller is judged where the focus engine's scroll would put it (`auto`/`scroll` and overflowing, as `scrollParentsOf`).
  - `test/app/shots.ts`: `shoot` measures every screen after writing its PNG and fails it with the list of offenders, so `shots:nova` (and the PR subset in CI) exits non-zero on any.
  - Line 1: `test/app/layout.test.ts`, 10 unit tests of `layoutOffenders` (window edges, scrollers, non-scrolling clips, one-axis overflow, overlap, nesting, on-screen parts only), and in the built app at 1280x960: "the home screen as it is has no offenders", and "planted controls past the edge, cut off and overlapping are named by handle" (`[data-action="planted-edge"]: outside the window (right 1330)`, `… cut off by [data-planted-shelf]`, `… overlaps button "nameless"`; a hidden one is not reported).
  - `npm run shots:nova`: all 18 screens measured (6 to 35 controls each), no offenders. Looked at home, library, game-details, downloads, emulators, settings-general, setup and quit: nothing clipped or overlapping. At rest, the lowest rows of home, emulators and settings scroll under the hint bar (92% opaque); reached with the pad, the last Settings → General control (Quit Galleon) sits fully above it (checked with a scratch walk of 30 Down presses, not committed). Not a defect.
  - `scripts/agent/check.sh` green: coverage 96.29 / 93.78 / 95.98. `npm run test:app` 213/213 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`agent-screenshot`).
- Next: M1-15 part 2, a test:app walk of every screen with the d-pad visiting every `data-action` (line 2).

## 2026-10-09 23:50 UTC session ac37955f (routine run, second unit)

- Device results: none new.
- Worked on: M1-15 part 2 of 2 (tracking issue #105): every control reachable with the d-pad. Part 1, PR #106, merged at a1607d4; its CI wall time was x64 5:14, arm64 0:55.
- Result: PR (this one). PASSES M1-15 (agent-screenshot).
- Evidence:
  - `test/app/driver.ts`: `reach(selector)` is `choose`'s homing walk without the select press; `choose` is now `reach` then Enter.
  - Line 2: `test/app/reach.test.ts`, at 1280x960. On home, library, collections, downloads, bios, emulators, every tab of the game page and of Settings, the quit dialog and setup's first page, it tags every enabled focusable (every `data-action` among them) on the screen, or in the topmost overlay, and walks onto each with direction presses alone. Each must then settle fully inside the window and above the hint bar. The navigation bar is left out: it is entered with Back, and `goTo` walks it. Every screen must have at least one control (the evaluator's note on part 1). "a control the pad cannot reach fails the walk, naming it" plants an unregistered button and expects "the highlight never reached". The running overlay is not walked: the pad belongs to the game while one runs, and `running.test.ts` reaches force-close.
  - Found by the walk: the game summary's read-more button and the current row of the Versions tab are focusables the engine disables (`enabled: false`), but they did not say so in the DOM. Both now carry `data-disabled` the way `FocusButton` does; neither has a `.btn` style, so nothing looks different (`game-details.png` unchanged).
  - Line 1: part 1 (#106). Collections, missed by part 1, is now photographed and measured as well (the evaluator's first verdict on this PR was FAIL for that gap). Line 3: `npm run shots:nova` 19/19 with no offenders; looked at `collections.png` (one card, two section headers, nothing clipped) and `game-details.png` (unchanged).
  - `scripts/agent/check.sh` green: coverage 96.29 / 93.79 / 95.98. `npm run test:app` 224/224 (`reach.test.ts` 11/11).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none (`agent-screenshot`).
- Next: `next.mjs`'s first feature that does not wait on the device (M2-01 the save-sync spec, M6-04, M6-05).

## 2026-10-10 00:26 UTC session fa6308b1 (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC; a nightly was published at 00:16 UTC, after it.
- Worked on: M2-01 (tracking issue #108), the save-sync spec. M1-15's part 2, PR #107, merged at df0c42f before this run.
- Result: PR (this one). PASSES M2-01 (ci).
- Evidence:
  - `docs/save-sync/SPEC.md`, written from Argosy at 2714d54 and RomM at tag 5.2.0 (both cloned into the scratchpad, read as specification only, nothing copied).
  - Line 1: every Argosy statement cites `A:`/`Adoc:` file and line; every RomM statement cites `R:` source at 5.2.0 or an `S:` pointer into `openapi-5.2.0.json`.
  - Line 2: section 10, one table per system (SNES, GBA, PS1, PSP, PS2, GameCube, Wii, Dreamcast) with Android emulator/core, handler, archive shape, tag, Linux emulator and verdict.
  - Line 3: section 11, the differences from `src/main/saves.ts` and `src/main/romm/client.ts`, with line citations; also RomMix's `autocleanup=true`.
  - Line 4: the evaluator's verdict is in the PR; section 12 lists the questions for M2-02.
  - Findings worth knowing: Argosy uses negotiate on 5.2.0 (its gate is version 4.9.0, not the heartbeat); RomM 5.2.0 ignores `rom_ids`; a slotted upload gets a timestamp-tagged name; a first upload into an occupied slot is a 409; `autocleanup` deletes server saves, so Galleon never sends it; Argosy has two automatic `overwrite=true` paths that Galleon must not copy (section 8).
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-08 (per-system decision, needs-human) and M2-02 (shape report), per PLAN.md's M2 order; or `next.mjs`'s first feature.

## 2026-10-10 00:55 UTC session fa6308b1 (routine run, second unit)

- Device results: none new.
- Worked on: M2-08 part 1 (tracking issue #111). M2-01, PR #109, merged at 4b30182; its CI wall time was x64 4:35, arm64 0:25 (docs only). PASSES M2-01 (ci); #108 closed.
- Result: PR (this one). M2-08 stays false.
- Evidence:
  - Decision issue #110 (`needs-human`): one question, which emulator per system. A plain-language table cites SPEC.md section 10's verdicts. Safe default: (A) RetroArch with Argosy's core for SNES, GBA and PS1; (B) PPSSPP, ARMSX2 with a folder card, Dolphin in GCI folder mode, Dolphin, and Flycast with a per-game VMU for PSP, PS2, GameCube, Wii and Dreamcast. It applies on 2026-10-13 01:00 UTC.
  - `docs/save-sync/SYSTEM-CHOICES.md` records the decision as pending, with the recommended default per system.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-03 (golden fixtures from SPEC.md, Docker 5.2.0). On or after 2026-10-13 01:00 UTC: M2-08 part 2 (adopt the answer or the default, ADR, settings defaults, the per-system Settings choice).

## 2026-10-10 01:26 UTC session ace44daf (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC.
- Worked on: M2-03 part 1 of 2 (tracking issue #113): the golden fixtures. M2-08's part 1, PR #112, merged at 186ac06; M2-08 waits for decision #110 (its default applies on 2026-10-13 01:00 UTC).
- Result: PR (this one). M2-03 stays false until part 2 (the round trips on Docker 5.2.0, lines 1, 2 and 4).
- Evidence:
  - `test/saves/fixtures.mjs` builds 11 fixtures for the eight systems in SPEC.md section 10, committed under `test/fixtures/saves/<system>/`: raw `.srm` (SNES `snes9x`, GBA `mgba`, PS1 `pcsx_rearmed`), DuckStation's `.mcd`, a single GameCube `.gci`, a Dreamcast VMU `.bin`, and zips of PSP save folders (with PARAM.SFO `CATEGORY=MS`), PS2 folder-card game folders (game-rooted and card-rooted, SPEC.md section 12 question 3), two GCIs, and a Wii title folder. Synthetic bytes only: format headers the spec names, and filler from a hash of the fixture's path. Stored zips with a fixed date, so the bytes never drift with zlib.
  - `test/fixtures/saves/manifest.json`: per fixture, the SPEC.md sections it follows (line 5), its Docker library ROM, Argosy's `emulator` tag, slot `autosave`, upload name and the expected `content_hash` (section 4).
  - `test/saves/fixtures.test.ts`, 12 tests in `npm test`: "the committed fixtures are what fixtures.mjs builds, byte for byte"; "every fixture names SPEC.md sections that exist, its system among them" (line 5); "every fixture is a save Argosy would upload, named and tagged as the spec says"; "a zip fixture unpacks with the app's own reader to the entries the manifest lists" (and its hash recomputed from the unpacked files); "no fixture carries personal data" with "the personal-data scan finds each kind it looks for" (line 3: IPv4, IPv6, e-mail, URL, `rmm_` tokens, bearer, JWT, secret keys, LAN hosts, home folders, and the sanitiser's `<server>`/`<host>` placeholders).
  - The Wii fixture's ROM joins the Docker library in part 2, which needs it; the test lists it as pending by name.
  - `scripts/agent/check.sh` green: 1612 tests, coverage 96.31 / 93.85 / 96.04.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-03 part 2, `npm run test:saves`: seed Docker 5.2.0 as an Argosy device with these fixtures, negotiate to `no_op` twice, the fork's upload after Argosy's, in the CI build job on both architectures.

## 2026-10-10 02:26 UTC session 2ca8171f (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC.
- Worked on: M2-03 part 2 of 2 (tracking issue #113): `npm run test:saves`. Part 1, PR #114, merged at e68a653; its CI wall time was x64 6:21, arm64 0:50.
- Result: PR (this one). PASSES M2-03 (ci).
- Evidence:
  - `test/saves/roundtrip.real.ts`, 33 tests on Docker RomM 5.2.0, three per fixture. An Argosy stand-in written from SPEC.md (device `client: argosy-launcher`; upload to `autosave` with its tag, `overwrite=false`; negotiate; download with `optimistic=false` then `/downloaded`) and the fork's `RommClient` as the second device.
  - Line 1: "Argosy's save is stored as sent, and identical bytes on both devices negotiate to no_op twice", for all 11 fixtures (eight systems): RomM's stored tag, size, stamped name and `content_hash` equal the manifest's; Argosy and the fork each get `no_op` twice in a row; the fork downloads the bytes back unchanged.
  - Line 2: "the fork's upload over Argosy's is refused until the player keeps it, and Argosy then downloads it": `overwrite=false` gets a 409 and leaves the slot as it was; the explicit keep (`overwrite=true`) stores it beside Argosy's (nothing deleted); Argosy's next negotiate answers `download` with the kept save's id. The reverse: "the fork's save reaches a new Argosy device, which then negotiates to no_op twice".
  - `RommClient.uploadSave` takes `{ overwrite, autocleanup }`; its defaults are unchanged, so the app sends what it did (M2-06 changes them). `romm.test.ts`: "a save sent without overwrite or cleanup says both, slot and all".
  - Line 4: `release.yml`'s `changes` step sets `saves` for save, client, fixture or Docker RomM changes (and every manual dispatch); the new `Save round trips` step runs `npm run test:saves` on both legs. Lines 3 and 5: part 1.
  - The Wii ROM joined the Docker library (`make-library.mjs`), so every fixture's game is scanned (8 platforms).
  - Found on the way: RomM 5.2.0 keeps times to the second and compares them strictly, so a save made within the same second as a device's sync record is not "newer"; the harness waits for the next second before the keep, and M2-05 must expect it.
  - `npm run test:saves` 33/33 (39 s, run twice against the same server); `ROMM_PROFILE=v520 npm run test:romm-real` 21/21; `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-04 (`content_hash` exactly as RomM computes it), then M2-07.

## 2026-10-10 02:52 UTC session 2ca8171f (routine run, second unit)

- Device results: none new.
- Worked on: M2-04 (tracking issue #116). M2-03's part 2, PR #115, merged at 5f37d5b; its CI wall time was x64 6:14, arm64 2:10 (both legs ran `Save round trips`, 33/33). PASSES M2-03 (ci); #113 closed.
- Result: PR (this one). PASSES M2-04 (ci).
- Evidence:
  - `src/main/savehash.ts` `localContentHash`, written from RomM 5.2.0's `compute_content_hash` and Python 3.13's `zipfile` as the Docker image runs them: a zip is what `is_zipfile` finds an end record for (not a leading `PK`), hashed as the sorted `name:md5` lines with directories left out, names decoded as Python does (UTF-8 flag or code page 437, then an Info-ZIP Unicode Path field whose checksum matches, cut at NUL) and sorted by code point; a repeated name hashes its last entry; bytes before the zip, after it, or a comment change nothing; a damaged, encrypted or unreadable zip gives null, as RomM stores none. Entries are read with yauzl (already a dependency) through a reader that shifts past any prefix the way Python does.
  - Line 1: `savehash.test.ts` "whose entries come in another order hashes the same", "ignores directory entries", and 20 more; `test/saves/hashcases.mjs` builds the 17 edge cases. Before writing the tests, each case was hashed by the RomM container's own Python: all 17 agreed with the app. The evaluator's first verdict was FAIL: names carried in a Unicode Path field (0x7075, as WinRAR writes them) were not read. Fixed, with three cases for it.
  - Line 2: `test/saves/hash.real.ts` uploads every edge case and every golden fixture to Docker 5.2.0 and requires the stored `content_hash` to equal `localContentHash`'s: `npm run test:saves` 35/35 (with the round trips).
  - Line 3: files are streamed in `READ_CHUNK_BYTES` reads; the end-record search reads at most 64 KiB and 22 bytes. "a large plain save is read in chunks, never more than 8 MB at once" (24 MB) and "so is a zip holding a large entry" (20 MB) record every read.
  - `sameContent` (the app's local-against-server comparison) now uses `localContentHash`, so a zip save compares by what is inside it; `savefiles.test.ts` "a zip save is the same as RomM's when what is inside it is, in any order".
  - `scripts/agent/check.sh` green: coverage 96.36 / 93.91 / 96.14.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-07 (one safe writer), then M2-05 (decision engine), which must allow for RomM keeping times to the second.
- Notes: `restoreFile` in `src/main/saves.ts` still checks a pulled save's plain md5 against `content_hash`, which fails for any zip save; the safe writer (M2-07) or transfers (M2-06) should check with `localContentHash` instead. (The evaluator's note; outside this diff.)

## 2026-10-10 03:26 UTC session 65247cc3 (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (no nightly published yet).
- Worked on: M2-07 (tracking issue #118). M2-04's PR #117 merged at 3e4ae04.
- Result: PR (this one). PASSES M2-07 (ci).
- Evidence:
  - `src/main/savewriter.ts` is the one module that changes anything in an emulator's save tree: `replaceSave` (staged beside the save by `stageBeside`, refused when a folder is at the destination, copy kept with `keepBackup`, fsync, rename, fsync of the folder), `unpackSave` (a folder save's archive is unpacked into a staging folder beside it; every entry is checked before anything moves, so an entry that would land on a folder refuses the whole archive), `removeSave` (the Saves tab's delete-here now keeps a copy first), `discardStaged` (only `.part` names or the temp folder). Every write is serialised per resolved path by `exclusive`. The backup chain moved from `savefiles.ts` unchanged except `BACKUP_COPIES`, now 5. `saves.ts` imports no writing call from `node:fs` and no `extractZip`.
  - Line 1: `savewriter.allowlist.test.ts` (in `npm test`, so in CI's build job): every module importing a writing call from `node:fs` must be on an allow-list naming where it writes; no save module but the writer is on it; no save module unpacks an archive itself; the list has no stale entries; the scan sees named, renamed and whole-module imports.
  - Line 2: `savewriter.test.ts` "a folder at the destination is refused, logged, and left as it was" (a Dolphin GCI card folder), "a normal overwrite still works, and keeps a copy of what it replaced", "a create still works, into a folder that did not exist yet", "two writers to one save are serialised, each backing up the one before", "work on one path waits for the work before it, even work that failed", "an entry that would land on a folder refuses the whole archive first".
  - Line 3: backups go to `<root>/saves/<romId>/` (`SaveSync.backupDir`, root `~/galleon`), "per game, under the saves folder of the app root, the last five by default"; the existing rotation tests now run against five.
  - New string `error.saveIsFolder` in all four catalogues (translated).
  - `scripts/agent/check.sh` green; `npm run test:saves` 35/35 on Docker 5.2.0.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-05 (decision engine; RomM keeps times to the second). Still open from M2-04: `restoreFile` checks a pulled zip save's plain md5 against `content_hash`; M2-06 should check with `localContentHash`.

## 2026-10-10 03:50 UTC session 65247cc3 (routine run, second unit)

- Device results: none new.
- Worked on: M2-05 part 1 (tracking issue #120): capability gating, acceptance line 1. M2-07's PR #119 merged at fb5b858; its CI wall time was x64 7:02, arm64 2:27. PASSES M2-07 (ci); #118 closed. (The evaluator's first verdict was FAIL because features.json had not been flipped; it PASSED once the flip was committed.)
- Result: PR (this one). M2-05 stays false until lines 2 to 4 (the engine, its equivalence test on Docker 5.2.0 and 5.3.1, per-game safety, session completion).
- Evidence:
  - `src/main/romm/version.ts` `negotiatesByGame(version)`: `atLeast(version, SCOPED_NEGOTIATE_SINCE)` with `SCOPED_NEGOTIATE_SINCE = '5.3.0'`, false for a version that cannot be compared (`development`, none), since the unscoped path is correct on every server.
  - `romm.test.ts` "a pre-launch negotiate names its game only on a RomM that reads the name": 5.0, 5.0.0, 5.2.0 false; 5.3.0, 5.3.1, 5.4.0 true; `development`, null and undefined false. "the first version that scopes is the first schema/ document with rom_ids": every committed RomM document (5.0.0, 5.1.0, 5.2.0, 5.3.1) has `rom_ids` in `SyncNegotiatePayload` exactly when the gate says so.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-05 part 2, the engine: negotiate with the full local inventory on 5.2.0 (or `rom_ids` on 5.3+), drop other games' operations, complete sessions with counts, and the equivalence test on Docker 5.2.0 and 5.3.1.
- Notes: under `git commit -a` the pre-commit hook's tests write into the caller's temporary index (`error: invalid object ... for 'docs/PROGRESS.md'`), as `agent.test.ts` warns; commit with `git add` and no `-a` until the test that leaks is found.

## 2026-10-10 04:37 UTC session b6e76d7a (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC; the first nightly was published at 03:59 UTC, after its last visit.
- Worked on: M2-05 part 2 (tracking issue #120): acceptance lines 3 and 4. Part 1's PR #121 merged at 1009026; its CI wall time was x64 6:50, arm64 2:10.
- Result: PR (this one). M2-05 stays false until line 2 (the equivalence test).
- Evidence:
  - Written from RomM's own `endpoints/sync.py` and `handler/sync/comparison.py`, read out of the pinned 5.2.0 and 5.3.1 images. 5.3.1 widens a `rom_ids` scope with the games of the saves sent and still answers per save; 5.2.0 answers for the whole library. A second negotiate cancels the device's open sessions, and completing a cancelled or completed session is a 400 ("Session is already ...").
  - `RommClient.negotiate` and `completeSyncSession`; types `RommSyncSave`, `RommSyncNegotiatePayload`, `RommSyncOperation`, `RommSyncNegotiateResponse`, `RommSyncCompletePayload` checked against every committed schema document. `rom_ids` lives on the alias `RommSyncScopedNegotiatePayload`, held to `schema/` by the existing `negotiatesByGame` test.
  - `src/main/savenegotiate.ts` `negotiateForGame`: on 5.2.0 the whole inventory and no `rom_ids`; on 5.3+ this game's saves and `rom_ids: [romId]`; every operation for another game dropped and counted; null without a device id. `finishSession`: completes with `operations_completed`/`operations_failed`; a 400 or 404 is `superseded`; an outage, a 5xx or a refusal is thrown.
  - Line 3: `savenegotiate.test.ts` "a pre-launch check never acts on another game's save, though 5.2.0 answers for the library"; `test/saves/negotiate.real.ts` "a pre-launch negotiate never acts on another game's save" (another device's save for a second game is in 5.2.0's answer and is dropped).
  - Line 4: "a session a newer negotiate cancelled is finished, not an error" (unit) and "a session a newer negotiate superseded is finished, not an error" (real: two negotiates, the first completes as `superseded`, the second as `completed`, then `superseded`).
  - `npm run test:saves` 37/37 on Docker 5.2.0. Both new real tests also pass on 5.3.1 (`node test/romm/run.mjs --suite saves --profile v531`); `romm.test.ts` 121/121; `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-05 line 2: a local decider written from `compare_save_state` and the endpoint's pairing rules, and an equivalence test feeding the same scenarios to it and to the real negotiate on Docker 5.2.0 and 5.3.1 (CI's `test:saves` runs only v520 today).
- Found on the way: the first CI run failed both legs in `Save round trips`: node runs the real test files side by side against one server, and the new test's slotted save on the SNES game showed up in the round trips' negotiates (and every `client()` there is one RomM device, so the "other device" was not other). The test now uploads with no device, for a game no golden fixture uses (`Galleon Test Plain`), and deletes it afterwards. The evaluator's first verdict was FAIL on the same two points, and on a race: every `client()` is one RomM device, so a round trip's negotiate could cancel the line-4 test's session before it completed. Both tests now negotiate as a device registered for them alone. `npm run test:saves` 37/37 three times in a row, the first on a fresh server; both tests pass on 5.3.1.
- Notes: on 5.3.1, `hash.real.ts` fails one edge case: `endInRawSave` (a raw save holding a zip end record) gets a content hash where 5.2.0 stores none. CI runs 5.2.0 only, so it is not red; the owner's server is 5.2.0 (DEVICE-FACTS), but M2-04's hash must follow 5.3.1 too before line 2 runs there.

## 2026-10-10 05:26 UTC session 014QRqgn (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (9.4 h ago); its last skip was "no 'nightly' release published yet".
- Worked on: M2-05 part 3 (tracking issue #120): acceptance line 2. Part 2's PR #122 merged at 8cf5b8d.
- Result: PR (this one). PASSES M2-05 (ci).
- Evidence:
  - `src/main/savedecide.ts` `decideForGame`: negotiate's decision for one game taken from `GET /api/saves?rom_id&device_id` (a read; new `RommClient.savesForDevice`), so a pre-launch check can decide without opening a session. Written step for step from `endpoints/sync.py` and `handler/sync/comparison.py`, read out of the pinned 5.2.0 and 5.3.1 images, which decide identically (only 5.3.1's `rom_ids` scope differs). `recordOf` tells RomM's stand-in entry (not current, stamped with the save's own time) from a real record; `instant` compares to the microsecond and reads an unzoned time as UTC, as `to_utc` does.
  - `savedecide.test.ts`: every branch of `compare_save_state`, newest-row pairing, null slots, untracked saves both ways, a save the device deleted, the stand-in, another device's record, another game.
  - Line 2: `test/saves/decide.real.ts` "the local decision answers every rule of negotiate the way the server does": 17 slots on one game (no server save, no slot, equal hashes, either side newer, a tie with and without a hash, records the client, the server or both moved past, untracked, deleted, superseded row), the same local saves to `negotiateForGame` and to `decideForGame`; identical action, save id and reason for every slot, and each slot's action as written out. `npm run test:saves` 38/38 on Docker 5.2.0; on 5.3.1 (`ROMM_PROFILE=v531`, provisioned) `decide.real.ts` and `negotiate.real.ts` 3/3, twice.
  - New string `error.saveBadTime` in all four catalogues (translated).
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-06 (transfers). Wiring `negotiateForGame` / `decideForGame` into the pre-launch flow in `saves.ts` goes with it.
- Found on the way: RomM tags an uploaded name with the second it arrived, and an upload whose tagged name matches an existing row takes over that row, slot and all; and an upload's reply carries microseconds RomM 5.2.0 does not store, so a time taken from it is later than the stored one. The test gives each upload its own name and makes ties against the listed time.
- Notes: CI's `test:saves` runs 5.2.0 only; `hash.real.ts` still fails one case on 5.3.1 (`endInRawSave`), which keeps 5.3.1 out of CI's saves suite.

## 2026-10-10 06:27 UTC session 01RtDaof2sqMLZnGpXpjGrUh (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (10.4 h ago); its last skip was "no 'nightly' release published yet".
- Worked on: M2-06 part 1 (tracking issue #124): acceptance line 1. M2-05's PR #123 merged at ce8f116.
- Result: PR (this one). M2-06 stays false until lines 2 to 4.
- Evidence:
  - `RommClient.uploadSave` sends `overwrite=false` unless `UploadSaveOptions.keepThisDevice`, and never sends `autocleanup` (SPEC.md section 8: it has RomM delete a slot's older saves because of an upload nobody chose, a rail 2 breach the inherited client made on every slotted upload). The old `overwrite` and `autocleanup` options are gone.
  - No production caller sets `keepThisDevice` yet: `push`, `pushNow`, `drain` and `pushSelected` (the routine "ask before sending" dialog) all send false. The choice belongs to the conflict view (a 409's three choices), which does not exist yet; `roundtrip.real.ts` exercises it against Docker RomM.
  - Line 1: `savesync.test.ts` "no push keeps this device's save over the server's, approved or not". `overwrite.allowlist.test.ts` reads every source file: no module sets `keepThisDevice` to anything but `false` or names `overwrite=true`, and the client's only `overwrite` is `String(keepThisDevice)`. `romm.test.ts`: the default is `overwrite=false` with or without a slot and no `autocleanup`; keepThisDevice sends `true`.
  - `scripts/agent/check.sh` green; `npm run test:saves` 38/38 and `npm run test:romm` 21/21 on Docker 5.2.0.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: see the PR. The first verdict was FAIL: `pushSelected` had been made the keep-this-device choice, so every confirmed push would have overwritten; it now sends false.
- Device / acceptance: none.
- Next: M2-06 part 2 (line 2): downloads with `device_id` and `optimistic=false` through the safe writer, then `POST /api/saves/{id}/downloaded`, with fault injection. Part 3: lines 3 and 4, and a 409 shown to the player as a conflict (today a refused upload is counted as failed and logged).

## 2026-10-10 06:52 UTC session 01RtDaof2sqMLZnGpXpjGrUh (routine run, second unit)

- Device results: none new.
- Worked on: M2-06 part 2 (tracking issue #124): acceptance line 2; and a rail 2 bug in M2-07's writer found on the way. Part 1's PR #125 merged at 00f9641; its CI wall time was x64 6:50, arm64 2:08.
- Result: PR (this one). M2-06 stays false until lines 3 and 4.
- Evidence:
  - `RommClient.downloadSave` asks for `/api/saves/{id}/content?device_id&optimistic=false` when this device has an id, so the GET records nothing; new `confirmSaveDownloaded` posts `{device_id}` to `/api/saves/{id}/downloaded`. `SaveSync.pullKind` confirms a save only after `restoreFile`/`restoreArchive` returned; states are never confirmed (RomM keeps no records for them); a refused confirmation is logged and the save still counts as pulled.
  - Line 2: `savesync.test.ts` "telling RomM a save arrived": confirmed once by id after a write; never after a download that breaks off, a download whose md5 is not RomM's, or a save the writer could not put in place (backups folder blocked); never for a state; a refused confirmation leaves the save pulled. `romm.test.ts`: the download URL carries `device_id` and `optimistic=false`; the confirmation's method, path and body; a refusal throws.
  - Bug (separate commit, `fix(saves)`): `keepBackup` swallowed a failed copy, so `replaceSave`, `unpackSave` and `removeSave` overwrote or deleted a save with no backup (the log said "could not be copied aside" and the pull went on). It now checks the first slot holds the save's own bytes and throws `SaveNotBackedUp`; nothing is written. `savewriter.test.ts` "a save that cannot be copied aside is left as it was" (pull, folder unpack, delete). New string `error.saveNotBackedUp` in all four catalogues (translated).
  - `scripts/agent/check.sh` green; `npm run test:saves` 38/38 and `npm run test:romm` 21/21 on Docker 5.2.0; `npm run test:app` 224/224 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). `games.test.ts` "the server's copy is brought down before the game starts" now also asserts `optimistic=false` and the `/downloaded` POST, which `test/app/server.ts` answers.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-06 part 3: line 3 (an identical retry adds no slot row, test:saves on 5.2.0 and 5.3.1), line 4 (`play_sessions` with the session's completion), and a 409 shown to the player as a conflict.
- Found on the way: the first CI run failed x64 `test:app`, whose check matched the content path exactly and so missed the new query; it was not run before the push because only main-process code changed. A change to what goes over the wire to RomM needs `test:app` too.
- Notes: a confirmation that fails is not retried yet (Argosy retries before the next sync); a save whose bytes already match is stamped without a download and so never confirmed. Both leave RomM offering the same download again, which costs a transfer, not a save.

## 2026-10-10 07:26 UTC session 01VHu3ou65VGVzAjuWse2yrQ (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (11.4 h ago); its last skip was "no 'nightly' release published yet". The scheduled nightly (`23 3 * * *`) has not run once yet; only the hand-started run of 2026-10-09 exists, and release.yml publishes `nightly` after every merge anyway.
- Worked on: M2-06 part 3a (tracking issue #124): acceptance line 3. Part 2's PR #126 merged at 94ce36e; its CI wall time was x64 5:46, arm64 2:16.
- Result: PR (this one). M2-06 stays false until line 4.
- Evidence:
  - Found first, by the new real test: RomM recognises identical bytes in a slot only when `overwrite=false` (`endpoints/saves.py` `add_save`, `get_save_by_content_hash` under `not overwrite`, same in 5.2.0 and 5.3.1). The player's "keep this device's save" (`overwrite=true`) retried after a lost reply was filed as a new row each time (the test failed on 5.2.0: `4 !== 3`).
  - `RommClient.uploadSave` with `keepThisDevice` and a slot now asks `keptAlready` first: when the slot's newest copy (by `updated_at`, to the microsecond via `savedecide.instant`) has this file's `localContentHash`, that copy is returned and this device confirmed as holding it (`POST /api/saves/{id}/downloaded`); nothing is uploaded. Identical bytes further back in the slot's history do not count. An ordinary upload is unchanged (RomM dedupes it).
  - Line 3: `test/saves/transfer.real.ts` "an upload retried with identical bytes adds no row to the slot", "the player's 'keep this device's save' retried with identical bytes adds no row to the slot", "a changed save after a retried one is the slot's second row, not a third": 3/3 on Docker 5.2.0 and 3/3 on 5.3.1 (`ROMM_PROFILE=v531`, provisioned).
  - `romm.test.ts` "keeping this device's save when the slot already holds it": the newest identical copy is returned and confirmed, an older identical copy still uploads, an ordinary upload and an unslotted one never list the slot; a copy with no stored hash and a file the client cannot hash both upload. 130/130.
  - `scripts/agent/check.sh` green; `npm run test:saves` 41/41 and `npm run test:romm` 21/21 on Docker 5.2.0. `test:app` not run: no production caller sets `keepThisDevice`, so nothing the app sends changes.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-06 part 3b: line 4 (`play_sessions` with the session's completion), and a 409 shown to the player as a conflict.

## 2026-10-10 08:27 UTC session 01CsS75gbjkD2bHYi3wXLkK1 (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (12.4 h ago); its last skip was still "no 'nightly' release published yet".
- Worked on: M2-06 part 3b (tracking issue #124): acceptance line 4. Part 3a's PR #127 merged at d9c9ab7; its CI wall time was x64 6:54, arm64 2:16.
- Result: PR (this one). PASSES M2-06 (all four lines; verification `ci`).
- Evidence:
  - `finishSession(client, id, counts, played)` sends the play recorded while the session was open as the completion's `play_sessions` (RomM's `SyncPlaySessionEntry`, read out of the 5.2.0 image: `endpoints/sync.py` `complete_sync_session` ingests them under the session's device and stamps `sync_session_id`). Spans shorter than the new `MIN_PLAY_SECONDS` (shared with `reportPlaySession`) are left out: RomM refuses the whole completion (422) over an entry whose end is not after its start once the fraction is dropped, and the session would never close. A span RomM answers `error` for is logged, not thrown; a superseded session took none of its play, which the doc comment hands to `POST /api/play-sessions`.
  - `completeSyncSession` now returns the reply; new types `RommSyncPlaySessionEntry`, `RommSyncCompleteResponse`, `RommPlaySessionIngest`, `RommPlaySessionIngestResult`, held to schema/ 5.0.0 to 5.3.1 by `romm.test.ts` in shared/types.
  - Line 4: `test/saves/negotiate.real.ts` "play recorded during a session is sent with the session's completion": the span appears in `GET /api/play-sessions?rom_id&device_id` once, with this session's `sync_session_id`, start and duration; sent again with the next session it is still one row. `npm run test:saves` 42/42 on Docker 5.2.0. 5.3.1 not run (image not on this VM); its `SyncCompletePayload` and `SyncPlaySessionEntry` are identical in schema/romm-5.3.1.json.
  - `savenegotiate.test.ts`: the payload as sent, short and backwards spans dropped (no list at all when none is left), an `error` result does not fail the completion, a superseded session.
  - `scripts/agent/check.sh` green. `test:app` not run: nothing in the app calls `finishSession` yet.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Found on the way: the PR body was opened without its `Feature:` line, which `scripts/agent/pr-body.mjs` fails on; a re-run reads the body from the original event, so a corrected body needs the next push to be checked.
- Next: the launch flow still decides with RomMix's own comparison and reports play through `POST /api/play-sessions`; wiring negotiate and its completion around a launch is M2-17 (with M2-18 for play time). A 409 shown to the player as a conflict is M2-16.

## 2026-10-10 08:55 UTC session 01CsS75gbjkD2bHYi3wXLkK1 (routine run, second unit)

- Device results: none new.
- Worked on: M2-18 (tracking issue #129). M2-06 part 3b, PR #128, merged at b62355e; its CI wall time was x64 6:45, arm64 2:14. M2-06 passes; issue #124 closed.
- Result: PR (this one). PASSES M2-18 (verification `ci`).
- Evidence:
  - New `PlayReporter` (`src/main/playtime.ts`): every session the launcher ends is written to `unsent_play.json` (Store `notePlay`/`unsentPlay`/`forgetPlay`) before it is sent, and forgotten only after RomM answers 2xx. Sent through `POST /api/play-sessions` in batches of `PLAY_BATCH` (RomM's own `MAX_BATCH_SIZE` in `endpoints/play_sessions.py`), oldest first; the first batch that fails keeps itself and everything after it. The catch-up (`App.catchUp`, at start-up and whenever RomM comes back) sends what is left. Resending is safe: RomM keeps one span per device, game and start. The completion route for play is `finishSession` (M2-06), used once negotiate wraps a launch (M2-17).
  - `RommClient.reportPlaySession` (best effort, a refusal swallowed and the session lost) is replaced by `sendPlaySessions`, which throws so the caller keeps the spans. `MIN_PLAY_SECONDS` is the one threshold for both routes.
  - Line 1: `playtime.test.ts` (9): short, zero and backwards spans dropped and never kept; an offline session kept and sent when the server is back; kept across a restart; a refusal keeps it; a 201-span backlog goes up as 100, 100, 1, oldest first; a failing second batch keeps itself and the rest; a span kept twice is one; two sends at once are one pass.
  - Line 2: `test/romm/sync.real.ts` "play sessions are accepted, listed and counted in the play time": a session recorded while unreachable (and a 3 s one, dropped) is sent by the next `send()`, appears once in `GET /api/play-sessions?rom_id=` with its start and duration, and `playTime` grows by it. `npm run test:romm` 21/21 on Docker 5.2.0.
  - `scripts/agent/check.sh` green; `npm run test:app` 224/224 (games.test.ts "the session is accounted for" still sees the POST).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: Steam games (M1-14, M5) are not launched by the app yet; their launch calls `launcher.play.record` the same way when they are. Then `next.mjs`: M2-15 (states only where they can load).
- Notes: `unsent_play.json` is new state under the config folder; nothing in the self-test guard (M0-21, not built yet) stops play being sent, which that feature's acceptance already requires.

## 2026-10-10 09:49 UTC session 01WdAZSXo1in3HtxtSzd186z (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (13.4 h ago); its last skip was still "no 'nightly' release published yet".
- Worked on: M2-15 (tracking issue #131). M2-18's PR #130 merged at 714b4a0; its CI wall time was x64 6:13, arm64 2:07.
- Result: PR (this one). PASSES M2-15 (both lines; verification `ci`).
- Evidence:
  - Line 1: new `src/config/emulators/states.ts`, `STATE_SYNC` (system, tag) rows and `statesSync`: states travel only where this device runs the libretro core SPEC.md section 10 found Argosy running for that system (SNES family `snes9x`, GBA `mgba`, PS1 `pcsx_rearmed`/`swanstation`/`mednafen_psx`); every standalone and every other system keeps its states. `states.test.ts` (3): rules name known systems once; RetroArch's own core for each listed system syncs; standalones, Genesis, a cross-system core and the bare `retroarch` tag do not.
  - `SaveSync.syncLocationFor` is the one gate: `pullKind`, `previewPush`, `sendChosen` and `pendingUploads` ask it, so no pull, push, drain or chosen push moves a state that stays. `STATE_PULL_LIMIT` is untouched and its test ("only the newest few states are pulled") now runs on a syncing system. `savesync.test.ts` "states only where they can load" (5): never pulled; not in the preview, not sent by `pushNow` or `pushSelected` while the save still goes; the same state goes up on PS1; the Saves tab marks local and remote states and no save; nothing marked where states sync or the game is not on this device. Each fails with `statesSync` forced true. Seven older state tests take `system: 'psx'` (their assertions unchanged).
  - Line 2: `SaveAsset.staysOnDevice`; the Saves tab draws a grey "Not synced" badge with a hint (`saves.stateNotSynced`, `saves.stateNotSyncedHint`, translated in all four catalogues). New shot `game-saves-states` in `shots:nova` (Cave Story under RetroArch, a local and a RomM state beside a save): both states read "Not synced", the save "Not on this device"; checked the PNG at 1280x960, no overlap, toasts gone.
  - `test:app`: three Cave Story steps in `games.test.ts` moved state transfers on Genesis, whose states now stay. Their save half is unchanged; their state half now asserts the rule end to end: no `/api/states/` download, no file in the states folder, the row `staysOnDevice` with the badge; the push dialog lists only the save; neither the dialog nor a push of everything sends the state. 224/224. State transfer itself is covered by the unit tests on PS1.
  - `scripts/agent/check.sh` green; `npm run shots:nova` 20/20.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none. Which systems sync states is worth a look in the acceptance session once #110's choices land (M2-08): a system moved to a standalone keeps its states local by this table.
- Next: `next.mjs`: M2-16 (conflicts decided by the player), M6-04, M6-05.

## 2026-10-10 10:26 UTC session 01WJLMHgmSaGbgp24PVLDoTf (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (14.4 h ago); its last skip was still "no 'nightly' release published yet" (the Nightly workflow itself ran green at 09:59 UTC).
- Worked on: M2-16 part 1 of 2 (tracking issue #133). M2-15's PR #132 merged at 139a09a. M0-10, M0-13 and M2-08 wait on the device, M0-21 or #110's date.
- Result: PR (this one). M2-16 stays false: its three acceptance lines are the dialog, test:app and the shot, all part 2.
- Evidence:
  - New `ConflictChoice` (shared/types/saves.ts) and `SaveSync.resolve`, the one caller of `keepThisDevice: true`: "keep this device's" sends that one path through `sendChosen` (intersected with a fresh scan, as an approved push is); "keep RomM's" pulls that one copy by id through `pullKind(…, chosen)`, past the newer-wins check only. The tag rule, the same-bytes check, `keepBackup` and the download confirmation still apply. A chosen copy that is gone, not loadable here, or in another client's named slot (which pairs with no file here) is counted `failed`. Skip is renderer-only. IPC `saves:resolve` rechecks the game's unsent saves afterwards, as `saves:pushSelected` does.
  - `overwrite.allowlist.test.ts` now names `main/saves.ts` (`SaveSync.resolve`) as the only module allowed to ask for an overwrite.
  - `savesync.test.ts` "settling a conflict the way the player said to" (6): keep-device uploads only that file with `keepThisDevice`; an invented path uploads nothing; keep-RomM writes RomM's bytes over a newer local save that `pullNow` leaves alone, with the backup and `/downloaded` confirmation; it moves no other copy and uploads nothing; a vanished id fails and leaves the local save untouched; so does a copy in another client's slot (found by the evaluator).
  - `scripts/agent/check.sh` green; `npm run test:saves` 42/42 on Docker 5.2.0 (the client's overwrite and download-confirm calls `resolve` uses are the ones `roundtrip.real.ts` and `transfer.real.ts` hold to RomM); `npm run test:app` 224/224.
  - Flaky (#134): `test/app/reach.test.ts` walked the BIOS screen and the game page before their data loaded (2 failures in 13 isolated runs on main). It now waits for `[data-bios-platform]` and the first `[data-tab]`; 15/15 isolated runs after.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Found on the way: the VM image ships a stale `/var/run/docker.pid`, so `dockerd` refuses to start until it is removed.
- Next: M2-16 part 2: the conflict dialog (two columns, three choices, focus held on its choice), `test/app/server.ts` 409 and device_syncs, test:app per choice, and the `shots:nova` shot.

## 2026-10-10 11:55 UTC session 01GArgoSV73fZG156nCcACVa (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (15.8 h ago); its last skip was still "no 'nightly' release published yet".
- Worked on: M2-16 part 2 of 2 (tracking issue #133). Part 1, PR #135, merged at 9e7aa30 (CI x64 6:00, arm64 2:23).
- Result: PR (this one). PASSES M2-16 (verification `agent-screenshot`; all three lines).
- Evidence:
  - New `ConflictDialog` (screens/Game): the pair side by side, this device (its RomM name, local time, size) and RomM (`originName` from `origin_device_id`, or "another device"; time; size), and three answers: keep this device's (`saves:resolve` `{keep:'device', path}`, the one overwrite), keep RomM's (`{keep:'romm', kind, id}`: by id, backup, `/downloaded`), Skip (focused on arrival, moves nothing). B closes it and moves nothing. Opened after a push with refused files when any pair is a conflict, and from a "Settle conflicts" button on the waiting notice. `useGameSaves.answerConflict` is the only renderer caller of `saves.resolve`; a keep counts as done only when something moved (keep-device's `failed 0, saves 0` reads as not settled). The pairs are `conflictsIn` (shared/saveassets.ts), the drain's own rule; `PendingSave.replaces` now carries RomM's `id`. 13 new strings, translated in all four catalogues.
  - Line 1: `test/app/server.ts` answers like SPEC.md section 7: a 409 for a slot upload this device has no current record for, or a same-named one it holds an older record of; `device_syncs` on a listing that names a device; `/downloaded` records the device; `overwrite=true` uploads are kept (a slot takes a new copy, a slot-less save is replaced in place); `holdSave({ staleFor })` and `devices` options. Ordinary uploads are still answered and not listed back (kept, their arrival time put a re-written save within the sync tolerance and broke three push tests in `games.test.ts`). `test/app/conflicts.test.ts` (5): a push refused twice opens the dialog with both columns and Skip focused; moving the highlight over the answers sends nothing; keep RomM's fetches that id's content and posts `/downloaded`, sends nothing, writes RomM's bytes; keep this device's sends exactly that file with `overwrite=true`; Skip sends nothing and leaves the file.
  - Line 2: the dialog's buttons stay mounted and enabled between conflicts (a disabled button drops the highlight to a neighbour); `conflicts.test.ts` asserts `conflict-keep-romm` is still focused after the list moves from "1 of 2" to "2 of 2".
  - Line 3: `shots:nova` 21/21 with the new `game-conflict`; looked at it at 1280x960: two equal columns, names, times and sizes legible, three buttons on one row, accent only on the focused Skip, nothing clipped.
  - `scripts/agent/check.sh` green; `npm run test:app` 229/229 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none. How the dialog reads from the sofa belongs in the acceptance session's look-and-feel pass.
- Next: `next.mjs`: M6-04, M6-05 (M0-10, M0-13 and M2-08 wait on the device, M0-21 or #110's date).

## 2026-10-10 12:38 UTC session 012udxzCZk5g1tJicTEicpMr (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (16.3 h ago); its last skip was still "no 'nightly' release published yet".
- Worked on: M6-04 (tracking issue #137). M2-16 part 2, PR #136, merged at 73c7193.
- Result: PR (this one). PASSES M6-04 (verification `ci`; both lines).
- Evidence:
  - A multi-file game fetched file by file wrote each file under its leaf name, so a folder-per-disc set (every Dreamcast disc has a `track01.bin`) had disc 2 overwrite disc 1. New `pathInGame` (shared/gamefiles.ts): the file's path below the game's folder, from `file_path` minus the ROM's `fs_path` and folder; the leaf where they do not line up. `fetchFileByFile` and the pending record use it; `safeJoin` still refuses a name that climbs out.
  - A server `.m3u` is never fetched (`filesToFetch`) or launched. `discsOf` reads the discs from the game's own files (each folder's `.cue`/`.gdi`, else its whole images, number order); `playlistFor` writes one only for 2+ discs on `PLAYLIST_SYSTEMS` (src/config/romfiles.ts, beside the new `DISC_IMAGE_EXTENSIONS`). `writePlaylist` (install.ts) puts `<folder>.m3u` at the top of the game folder and it becomes the launch path, on the per-file and the archive path alike. `gameFolderName` strips `.m3u` from the folder Galleon makes (plan, adopt, staging).
  - Line 1: `downloads.test.ts` "a game of several discs" (5): the synthetic library's PS1 Saga folder (discs 1, 2, 10 in order) and GameCube Two Discs folder (a server `.m3u` beside them is not fetched: 30 bytes arrive, not 129) each launch Galleon's playlist; a two-disc GDI set with generic track names keeps each disc's own bytes; a one-disc cue/bin writes none. `install.test.ts`: an archive with RomM's `.m3u` and folder-per-disc GDIs launches Galleon's. `gamefiles.test.ts` (4). `library.real.ts`: on Docker RomM 5.2.0 the PS1 and GameCube folders' files sit where `pathInGame` says and get a playlist; the PSP folder keeps `PSP/GAME/GTST00001/DLC.EDAT`.
  - Line 2: "the playlist path never has .m3u in a folder name" (a RomM folder named `… (USA).m3u`), plus `gameFolderName` units.
  - 4 of the 5 download tests and the install test fail on 73c7193 (checked by the evaluator).
  - `scripts/agent/check.sh` green; `npm run test:romm` 22/22; `npm run test:app` 229/229.
  - Flaky (#139): the PR's x64 leg failed `test/app/conflicts.test.ts` (keep this device's never closed the dialog). A real bug from M2-16: `answerConflict` held its `answering` guard through the Saves-tab `reload()` after the next conflict was on screen, so a press in that window was dropped. New `FakeRomm.slowSaveListings` makes the scenario press in that window: fails every time before, 3/3 after the guard is released before the refresh.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: `next.mjs`: M6-05 (resumable per-file downloads).
- Notes: a game already installed under a folder named with `.m3u` is no longer adopted at that path (none are installed yet). A multi-disc game on a flat-library emulator (only Eden, Switch) could leave empty subfolders on cancel; not a shape that exists today.

## 2026-10-10 13:26 UTC session 01S7cup9hCmp6nFZBBCJKAWa (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (17.3 h ago); its last skip was still "no 'nightly' release published yet".
- Worked on: M6-05 (tracking issue #140). M6-04's PR #138 merged at 5a54955 (CI x64 6:28, arm64 2:12).
- Result: PR (this one). PASSES M6-05 (verification `ci`; both lines).
- Evidence:
  - Per-file fetching, each file held to its own `md5_hash`/`sha1_hash` and resumed on its own, was already in place (`fetchFileByFile`, `downloadRomFile`, `fileAlreadyHere`); the archive is only for a game of one file or a server that cannot serve files singly. Two gaps closed:
  - A bug found by the new suite: after a file's hash check the row stayed `checking` for the rest of the game, so the screen read "Checking" over every later file and Pause (which only stops a row that is downloading) did nothing. The row is `downloading` again as each file starts. `downloads.test.ts` "the row is downloading again once the file before was checked" fails without the fix.
  - Line 2: a file refused for its hash is fetched once more, alone and from its first byte, with one warning naming it; a second refusal pauses the game with the reason on the row, once. `downloads.test.ts` "a file refused for its hash is fetched again on its own" and "a file refused twice pauses the game, and the row says so once" (both fail on 5a54955); the old "refused … pauses" test became the second.
  - Line 1: new `test/romm/downloads.real.ts`, the app's own queue, library and store over a scratch `GALLEON_HOME` against Docker RomM: "a multi-file game paused mid-file resumes that file by range and refetches none it finished" (half of disc 2 on disk, Pause, resume: disc 1 fetched once, disc 2 `[null, bytes=<half>-]`, every file matches its md5, playlist written) and "a file whose bytes do not match its hash is fetched again alone, and said once" (disc 2's first copy has a flipped byte: fetched `[null, null]`, disc 1 once, one warning, md5s match).
  - `scripts/agent/check.sh` green; `npm run test:romm` 24/24 on 5.2.0 and 5.3.1.
  - Flaky (#141): 5.3.1's provisioning was refused once on a cold start ("Invalid session", socket.io polling across four RomM workers) and passed when run again. Not a test assertion; root cause to fix within two units.
- CI wall time: recorded in the next entry (this entry rides the PR). The first x64 run failed only `pr-body.mjs`: the PR was opened without the template's `Feature:` line; the body was fixed and this note is the push that re-runs it.
- Evaluator: PASS (quoted in the PR).
- Device / acceptance: none.
- Next: #141 (test:romm provisioning on 5.3.1), then `next.mjs`: M8-06.

## 2026-10-10 13:55 UTC session 01S7cup9hCmp6nFZBBCJKAWa (routine run, unit 2)

- Worked on: flaky #141 (test:romm provisioning on RomM 5.3.1 refused with "Invalid session"). M6-05's PR #142 merged at eb58893 (CI x64 7:06, arm64 2:08; the first x64 run failed only the PR-body check, see the entry above).
- Result: PR (this one). Feature: none (CI flake, #141).
- Evidence:
  - Root cause: RomM 5.3.1's image starts four web workers (`--workers "${WEB_SERVER_CONCURRENCY:-4}"` in its `/init`; 5.2.0's defaults to 1). A socket.io polling session lives in the process that opened it, and `provision.mjs` starts the scan over that transport, so a request on a new connection that lands on another worker is refused. Node's fetch usually reuses one keep-alive connection, which is why it failed only now and then on a cold start.
  - Reproduced with a scratch script opening a polling session and sending the connect packet on fresh connections: 3 of 30 refused on 5.3.1, 0 of 30 on 5.2.0. With `WEB_SERVER_CONCURRENCY: '1'` in `compose.yml`'s shared RomM environment: 0 of 100 on 5.3.1.
  - `test/romm/lib.test.ts` "every Docker RomM runs one web worker, which the scan handshake needs" fails without the setting.
  - `npm run test:romm -- --profile v531` from a removed volume: 24/24, 69 s.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: `next.mjs`: M8-06.

## 2026-10-10 14:38 UTC session 01D4wbSbJU6yiTdNuXuVCU33 (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (18.4 h ago); its last skip was still "no 'nightly' release published yet".
- Worked on: M8-06, part 1 (tracking issue #144). #143 (flaky #141) merged at 915a833 before this run.
- Result: PR (this one). M8-06 line 1 met; `passes` stays false until line 2 can be proved.
- Evidence:
  - Line 1: new `docs/MAINTENANCE.md`, numbered steps for upstream ports (M0-19's weekly issue), adding a RomM version to the matrix, Electron updates gated on the next nightly's device run (revert first thing on a newly failing check), other Dependabot updates and pinned actions/digests, and scheduled workflows. Linked from CLAUDE.md's list of deeper docs.
  - Automation: `upstream.yml` gains "Keep scheduled workflows enabled" (`actions: write`): every workflow with a `schedule:` that is `active` or `disabled_inactivity` is re-enabled weekly, which resets GitHub's 60-day inactivity clock; one a person disabled is left alone. Proved by a `workflow_dispatch` run of the branch (link in the PR).
  - Line 2 cannot be proved today: Docker Hub's newest stable RomM is 5.3.1 (2026-09-23), already in the matrix; 5.4.0 is at beta.1 (2026-10-09). The procedure was rehearsed against `rommapp/romm:5.4.0-beta.1@sha256:8823a21f…` following steps 2 to 7 and then reverted (nothing committed): the index has `linux/amd64` and `linux/arm64`; provisioning passed (8 platforms, 52 s); `schema:fetch` wrote 329 schemas and `romm.test.ts` passed 251/251 with it; `test:romm-real` 24/24; `test:saves` 39/42. The rehearsal added step 7's "compare with the previous profile" after `hash.real.ts` failed on both 5.3.1 and the beta.
  - What 5.4 will need, from that rehearsal: `sync.real.ts`-style session tests in `test/saves/` fail on the beta: "a session a newer negotiate superseded is finished, not an error" (the older session reads `completed`, not `superseded`) and "play recorded during a session is sent with the session's completion" (the play session is not there: `undefined` where 97 was expected). Both touch save sync (rail 2); investigate when 5.4.0 is stable, with its own golden tests.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M8-06 line 2 once RomM 5.4.0 (or a newer stable) is published: follow `docs/MAINTENANCE.md` "RomM versions". Otherwise `next.mjs` has nothing eligible (M0-10, M0-13 and M2-08 wait on the device or #110's date).
- Notes: init.sh stops before `npm ci` when Docker's daemon is down; start `dockerd` and run it again.

## 2026-10-10 14:47 UTC session 01D4wbSbJU6yiTdNuXuVCU33 (routine run, stop)

- Stopped: nothing eligible. M8-06 part 1 merged in #145 at bbc4182 (CI x64 5:35, arm64 0:53); its line 2 waits for a stable RomM 5.4.0 (#144 stays open). M0-10 and M0-13 wait on the device (bridge last seen 18.7 h ago), M2-08 on #110's safe default (2026-10-13 01:00 UTC), M4 on Gate 1, Dependabot #1 on a device baseline.

## 2026-10-10 15:27 UTC session 01128vAgxbdPsR2MHe8eY3Gw (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (19.4 h ago); its last skip was still "no 'nightly' release published yet".
- Worked on: red required check on `main` (flaky #147). `build (ubuntu-24.04, x64)` failed at 34ba1b9, a docs-only commit, in `test/app/perf.test.ts` "a 30 s scroll down the grid logs its summary": "gave up waiting for the chips", with the screenshot showing the Cave Story MD game page.
- Result: PR (this one). Feature: none (CI flake, #147).
- Evidence:
  - Root cause: `goTo('home')` returned as soon as it pressed Enter, while home still showed its spinner. The next `goTo('library')` walked the bar, and the hero's `autoFocus` took the highlight between the "arrived" check and the Enter, which then opened the hero's game. This is the race `atHome` describes at startup, but on a later visit to home. `interface.test.ts` (search "and leaving the screen forgets it") and the emulators scenario have the same `goTo('home')`/`goTo(...)` pair.
  - Fix: `goTo('home')` waits until home has settled: its shelves have answered, and the hero holds the highlight if there is one. It skips the wait when home was already settled before the press (choosing home from home redraws nothing; `reach.test.ts` found that case in the first version of the fix).
  - New `FakeRomm.slowRomListings`. `interface.test.ts` "going home waits for it to settle, so the next walk is not taken from under it" fails on 34ba1b9 (the hero does not hold the highlight when `goTo` returns) and passes with the fix.
  - `scripts/agent/check.sh` green; `npm run test:app` 230/230 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: the bridge's "no 'nightly' release published yet" while a `nightly` prerelease exists (published 2026-10-09 11:40 UTC); otherwise nothing eligible (see the 14:47 stop entry).
- Notes: a stale `/var/run/docker.pid` stopped `dockerd` from starting on this VM; remove it if the pid it names is not running.

## 2026-10-10 15:53 UTC session 01128vAgxbdPsR2MHe8eY3Gw (routine run, stop)

- Stopped: nothing eligible. Flaky #147 (`main` red at 34ba1b9) fixed in #148, merged at 0f6807c (CI x64 5:43, arm64 0:48; evaluator PASS). Everything else is as in the 14:47 stop entry: M8-06 line 2 waits for a stable RomM 5.4.0, M0-10 and M0-13 wait on the device (the bridge was last seen 19.8 h ago), M2-08 waits for #110's safe default (2026-10-13 01:00 UTC), M4 waits for Gate 1, and Dependabot #1 waits for a device baseline.

## 2026-10-10 16:26 UTC session 01TYyFtCNVzURkA21XSQxo3a (routine run, stop)

- Stopped: nothing eligible, as in the 15:53 stop entry. The bridge's "no 'nightly' release published yet" is not a bridge bug: it comes from `bridge/status.json`, which the bridge writes only when it skips (see the DEVICE-RESULTS note after 9390ac8), and that file is still the one from 2026-10-08. The bridge tested a nightly every hour on 2026-10-09 up to d4c2d35 (20:06 UTC) and has been silent since, while `nightly` is current (assets from 8a5c0f9, 16:05 UTC). That silence is on the device side; the 7-day `needs-human` note is not due before 2026-10-16.

## 2026-10-10 17:44 UTC session 011jEpBMC6dNybVMQkJqnRiR (routine run)

- Device results: none new. The bridge last checked in at 20:06 UTC (21.4 h ago), as in the 16:26 stop entry.
- Worked on: M8-06 line 2 (tracking issue #144). RomM 5.4.0 went stable on Docker Hub at 15:19 UTC today.
- Result: PR (this one). PASSES M8-06 (verification `ci`; line 1 met in #145).
- Evidence (followed `docs/MAINTENANCE.md` "RomM versions", steps 1 to 9):
  - Pinned `rommapp/romm:5.4.0@sha256:03295f95a6290e752641f9553ac4198b0e5b71b879d57f7b2371b98f608feb54` (index lists `linux/amd64` and `linux/arm64`); profile `v540` on `127.0.0.1:18540` in `compose.yml`, `lib.mjs` and `lib.test.ts`.
  - Provisioning: 8 platforms, 43 s. `schema:fetch` wrote `schema/romm-5.4.0.json` (329 schemas). Against 5.3.1 no path is removed; `PlaySessionSchema.sync_session_id` and `PermissionGroupSchema.is_system` are removed (the client reads neither); the newly required fields are ones the client does not send. The heartbeat reports no `SAVE_SYNC`, so ADR 0002's snapshot warning does not apply to 5.4.0.
  - `romm.test.ts` 251/251; `test:romm-real` 24/24 on v540 and on v531.
  - Saves on v540 first: 39/42. `hash.real.ts` fails on v531 too (the known raw save holding a zip end record). The other two are 5.4's: negotiate no longer cancels a device's open sessions (the endpoint no longer calls `cancel_active_sessions`), so an earlier session completes instead of being refused; and a play row no longer carries `sync_session_id`. `finishSession` handles both answers unchanged (it returns `completed` and the play is taken; a span sent twice is still one row). `negotiate.real.ts` now holds each version to its own answer (`negotiateEndsOpenSessions`): 5.2.0 and 5.3.1 keep every assertion they had, 5.4.0 must answer `completed`, must not report the field, and the row must be this device's. No client change; the comments in `savenegotiate.ts` and `savedecide.ts` now say which versions supersede (the evaluator found the second).
  - After the change: saves v540 41/42, v531 41/42 (both only `hash.real.ts`), v520 42/42.
  - Step 8: `nightly.yml` and `release.yml`'s `workflow_dispatch` profiles, `test/romm/README.md`, `run.mjs`, `test/saves/README.md`, PLAN.md's matrix lines. Pull requests still test only 5.2.0.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none. The owner's server stays on 5.2.0 (step 10).
- Next: nothing eligible unless the device reports; see the 15:53 stop entry.

## 2026-10-10 18:04 UTC session 011jEpBMC6dNybVMQkJqnRiR (routine run, stop)

- Stopped: the run's time is up. M8-06 is done: #151 merged at 75e5bc2 (CI x64 7:37, arm64 2:16; evaluator PASS); `passes` true, #144 closed. The first x64 run failed only features-check, because the PROGRESS entry carried a time later than the run; fixed by re-dating it. Otherwise nothing eligible, as in the 15:53 stop entry: M0-10 and M0-13 wait on the device (bridge last seen 22 h ago), M2-08 on #110's safe default (2026-10-13 01:00 UTC), M4 on Gate 1, Dependabot #1 on a device baseline.
- Notes: on this VM, `git commit -a` with the pre-commit hook failed with "Error building trees"; `git add` then `git commit` works.

## 2026-10-12 01:20 UTC session 01EHqpGGic98WcbWMnSMyxnP (owner asked to push work forward now the Nova is reachable)

- Device results: DEVICE-RESULTS d729a7a1f85a595212377c87bb1e0324693d78de complete. The bridge is back (first result since 2026-10-09 20:06 UTC). As before, it was only the minimal harness: `harness.run` passed, no `safety.*` check ran, nothing flips.
- Worked on: M0-10 line 4 (tracking issue #66). The device runs only the minimal harness until M0-22, and M0-22 needs M0-21, which needs M0-10. M0-10 waits only on the real format of `/run/armada/perf-state.json`, and the minimal harness was the only thing that could read it. Without that file, nothing could move.
- Result: PR (this one). M0-10 stays false.
- Evidence:
  - `test/device/run.sh` now also writes `logs/power-facts.txt` and lists it in `harness.run`'s evidence. The file holds `/run/armada/perf-state.json`, both `power-profiles.conf` files, policy7's governor and current and max frequency, each devfreq device's governor and frequencies, and the output of `armada-power profile` and `armada-power status`. Each file is capped and each command has a timeout. It is read-only: it calls `profile` without an argument, which only asks, and writes nothing outside `RESULTS_DIR`. The bridge's existing sanitiser publishes `.txt`. No bridge change is needed.
  - `scripts/device-bundle.test.ts` 10/10. New: "run.sh copies the power state the device shows, and only reads it" (fake root and a fake `armada-power` that records its arguments: exactly `profile` then `status`) and "run.sh still passes where none of the power files or armada-power exist".
  - `shellcheck test/device/run.sh`: clean apart from the existing SC1007 on `CDPATH= cd`.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: the next nightly after the merge publishes `power-facts.txt`. From it: parse perf-state.json in `src/main/powerstate.ts` with fixture tests, which finishes M0-10, and correct DEVICE-FACTS.md's _(assumed)_ power lines. Then M0-21 and M0-22.

## 2026-10-12 02:10 UTC session 01EHqpGGic98WcbWMnSMyxnP (owner asked to push work forward)

- Device results: DEVICE-RESULTS e6bb3bd6f790c76c7863647971bfc260570acd29 complete. Still the minimal harness (`harness.run` passed, nothing flips), now with `logs/power-facts.txt`. The sanitiser withheld and dropped nothing.
- Worked on: M0-10 line 4 (tracking issue #66). #153 merged at e6bb3bd; its CI wall time was x64 5:46, arm64 0:51.
- Result: PR (this one). PASSES M0-10 (verification `agent-screenshot`). Lines 1 to 3 were met in #69 and #71. Line 5 is informational and comes from M0-21's device checks.
- Evidence:
  - The device's files are now fixtures (`src/main/fixtures/armada/`). `perf-state.json` is `{"global": {"gamescopeNice": -20}}`. `power-profiles.conf` is INI, with `[profile.*]` and per-SoC `[underclock.*]` sections. Neither names the profile in force (DEVICE-FACTS.md, "Confirmed on the Nova").
  - `src/main/powerstate.ts`:
    - `parseIni` reads the conf's sections.
    - `profileInForce` names the profile whose governor matches the prime cluster's and whose underclock level's policy7 cap is the cluster's current maximum. For a profile with no underclock, it names it when no level's cap is the current maximum. It names a profile only when exactly one fits; otherwise it returns `unknown`.
    - `parsePerfState` lists every scalar as `layer.key=value`, without picking any by name, and cuts the list short for the corner. It returns `unknown` when the file is missing, malformed or empty.
    - `PowerState` gains `profile` and `perf`.
  - The overlay shows "Armada profile: {profile} (starts in {start})" and "Armada perf: {state}", in all four catalogues, translated.
  - `src/main/powerstate.test.ts` 15/15. Against the device's files: Performance (2956800), Balanced (2092800, the Phase 0 cap), Eco (1843200), and another SoC's medium cap. `unknown` for a cap set by hand, two profiles that fit, an unknown governor, and missing inputs. The perf contract is checked for layers, truncation, malformed and empty input.
  - `npm run test:app` 230/230. `npm run shots:nova` 21 screens. I opened `perf-overlay.png`: the two new lines are in the bottom-left corner below the CPU and GPU lines, inside the overlay's box, and the library layout is unchanged. On the VM they read "unknown", which is correct there.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none for M0-10. Next: M0-21 (self-test mode), now unblocked. `next.mjs` should list it.

## 2026-10-12 02:45 UTC session 01EHqpGGic98WcbWMnSMyxnP (owner asked to push work forward)

- Device results: none new since e6bb3bd.
- Worked on: M0-21 part 1 (tracking issue #155): acceptance line 1. M0-10's PR #154 merged at 048efc2; its CI wall time was x64 5:40, arm64 0:57. #66 closed.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `profilePath()` (`src/main/root.ts`) is `$GALLEON_HOME/profile` when `GALLEON_HOME` is set, so Electron's userData moves inside the test home. Chromium's profile, its caches and the single-instance lock all live in userData. Without the variable, nothing changes. `index.ts` already sets userData from `profilePath()` before taking the lock. Moving the root (`system:setRoot`) was already refused under `GALLEON_HOME`.
  - `src/main/root.test.ts` 16/16. New:
    - "with GALLEON_HOME the profile, its caches and its lock live inside that home".
    - "a GALLEON_HOME reads and writes nothing of the default home, its pointer or RomMix". On a fake home with stock RomMix's files and a default Galleon pointer, a spy on `readFileSync` shows that nothing outside the test home is read, the pointer included. `ensureRoot` and a lock written into the profile add nothing outside the test home and change nothing else. A mutation that reads the pointer before the `GALLEON_HOME` check fails the test.
  - `npm run test:app` 230/230 (the driver already sets `GALLEON_HOME`). `scripts/agent/check.sh` green.
  - Not proven here: files Chromium itself might write outside userData. The device's `safety.owner-state` (M0-22) covers that on the Nova.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet. Next: M0-21 part 2, the read-only server guard (line 2).

## 2026-10-12 03:05 UTC session 01EHqpGGic98WcbWMnSMyxnP (owner asked to push work forward)

- Device results: none new.
- Worked on: M0-21 part 2 (tracking issue #155): acceptance line 2, the read-only server guard. Part 1, PR #156, merged at ab3b9ff; its CI wall time was x64 5:40, arm64 0:53.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/romm/guard.ts`, `ReadOnlyGuard`. `admit(method, path)` lets only GET and HEAD through. Any other method throws `ReadOnlyError` (new in `errors.ts`, with no status: nothing was sent, so it is neither an outage nor a refusal) and adds one to `serverWritesAttempted`. Every path that passes loses any `device_id` in its query (`withoutDeviceId`).
  - `RommClient.readOnly(guard)` switches it on. `request()` admits each request before it is logged or sent. Every client call goes through `request()`, and `devices.ts` reaches the server only through the client's `json`, so call sites added later are covered too. Under the guard:
    - a 401 is not followed by a token refresh;
    - `deviceId()` answers null without asking the registry, so no device is looked up or registered and none is named in a save, state or play-session request.
  - Nothing switches the guard on yet. The self-test runner (part 3) will.
  - New string `error.readOnly` in all four catalogues, translated.
  - `src/main/romm.test.ts` 136/136. New suite "the read-only guard":
    - every write call site (login, pairing start and poll, favourite, status, now playing, collection add and remove, save and state deletes, negotiate, sync completion, save and state uploads, RetroAchievements refresh, play sessions) is refused with nothing but reads sent, and the count equals the number of calls;
    - `deviceId()` sends nothing even with a stored device id;
    - `savesForDevice` goes out without `device_id`;
    - a 401 is not refreshed and the sign-in is kept;
    - lifting the guard lets writes out again;
    - `withoutDeviceId` unit cases.
  - Removing the guard line from `request()` fails 3 of these tests.
  - `scripts/agent/check.sh` green; `npm run test:romm` 24/24 on v520, v531 and v540.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet. Next: M0-21 part 3, the self-test request, runner and summary.json, which switches the guard on.

## 2026-10-12 03:38 UTC session 01NaksJzKTFT4F1atU7bphfg (hourly heartbeat)

- Device results: DEVICE-RESULTS ab3b9ffaba6409b4173df85d7ede429a539869b1 complete. Still the minimal harness; nothing flips.
- Worked on: M0-21 part 3 (tracking issue #155): acceptance line 6 and the request half of the description. Part 2, PR #157, merged at 74af71f; its CI wall time was x64 6:34, arm64 2:14.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/selftest.ts`:
    - `takeRequest` looks only in a `GALLEON_HOME`. It renames `self-test-request.json` to `self-test-request.taken.json` before reading it, so a restart is a normal start.
    - `parseRequest` refuses, with a reason code, a request without `readOnlyServer: true` or `privacy: true`, and a malformed one. `reportRefusal` writes an `error` summary when the results folder is usable, and the app exits 1.
    - `runSelfTest` runs each requested check's scenario. A thrown scenario is that check's `error` and the run goes on as `partial`; the error's message stays in the log only. A check with no scenario yet is `skip` / `not-implemented`, and the run is `partial`. The budget skips the rest as `partial`, and an abort signal gives `aborted-by-user`.
    - `safety.server-readonly` is in every summary and fails on any refused write. `selftest.complete` fails when any requested check did not run.
    - `runAndReport` writes `summary.json` atomically and returns 0, or writes an error summary and returns 1. `summaryErrors` checks the TESTING.md schema.
  - `ReadOnlyGuard` counts the `device_id`s it removes (`deviceIdsRemoved`, a metric of `safety.server-readonly`).
  - `index.ts`: the request is taken before `RomMixApp` exists, and `rommix.readOnly(guard)` is switched on before any request. A self-test start skips the update check, the Steam launcher refresh, the connection watch and the catch-up. `RomMixApp.readOnly` holds the catch-up, so refused saves and play sessions are not re-queued on every reconnect (the evaluator's note from part 2). No scenarios are registered yet.
  - TESTING.md's request section now states the taken file name, the exit codes, `not-implemented`, and that `safety.server-readonly` is always present.
  - Tests:
    - `src/main/selftest.test.ts` 19/19. The schema test parses the `summary.json` and request examples straight out of TESTING.md. The rest cover the refusals, the rename, throw, budget, abort, a refused write, and a runner fault that still leaves an error summary.
    - `src/main/app.test.ts`: the held catch-up.
    - `test/app/selftest.test.ts` 2/2: the built app takes a request, writes a valid summary, exits 0. A request without privacy exits 1 with an error summary.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet. Next: M0-21 part 4, the real scenarios (start-up, grid scroll per profile, screenshots, heartbeat, small download), privacy mode and abort on input. run.sh must then write the request.

## 2026-10-12 03:52 UTC session 01NaksJzKTFT4F1atU7bphfg (hourly heartbeat)

- Device results: none new since ab3b9ff.
- Worked on: M0-21 part 4a (tracking issue #155): acceptance line 9, the `server.heartbeat` scenario. Part 3, PR #158, merged at aff285b; its CI wall time was x64 6:00, arm64 2:07.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/selftestserver.ts`, `heartbeatScenario(client)`:
    - It calls `client.heartbeat()`, then `client.me()`, and passes when both answer.
    - Metrics: `serverVersion`, `heartbeatMs`, `meMs`. The version is kept only if it looks like one; otherwise it reads `unrecognised`, since the summary is published. Nothing about the account is kept.
    - A failure is a code (`heartbeat-unreachable`, `heartbeat-unsupported`, `users-me-http-401`, ...). The error's message goes to the log only.
  - `index.ts` registers it as the first real scenario.
  - Tests:
    - `src/main/selftestserver.test.ts` 5/5.
    - `test/app/selftest.test.ts` 3/3. New: the built app, signed in to the fake RomM, runs `server.heartbeat`, which passes. `selftest.complete` and `safety.server-readonly` pass and the status is `complete`. The fake server saw `/api/heartbeat` and `/api/users/me` and no method other than GET or HEAD. The summary does not contain the server's host.
    - `seed` in `test/app/driver.ts` is now exported for that test.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not write a request yet. Next: the remaining part 4 pieces (start-up, grid scroll, screenshots, small download, privacy mode, abort on input, sandbox, run.sh's request).

## 2026-10-12 04:26 UTC session 01RGSMShKzBQaeNLAXc7CMRy (hourly heartbeat)

- Device results: DEVICE-RESULTS aff285b5c2de4b6b4e0b59769cdb68d9a0e17098 complete. Still the minimal harness; nothing flips.
- Worked on: M0-21 part 4b (tracking issue #155): acceptance line 10, the `download.small` scenario. Part 4a, PR #159, merged at c864cba; its CI wall time was x64 5:52, arm64 0:58.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/selftestdownload.ts`, `downloadScenario`:
    - It picks the smallest game on the SNES and GBA platforms (every page) that RomM publishes a digest for. None is a `skip` (`no-hashed-snes-or-gba-title`); a game already installed is a `skip` and is left alone.
    - The real download queue fetches it into the test home. The scenario counts the queue's updates that carry bytes (the 0-byte announcement every transfer starts with does not count, which the evaluator caught), then hashes the kept file itself against RomM's digest.
    - Failures are codes: `download-<state>`, `outside-test-home`, `installed-as-folder`, `no-progress-events`, `hash-mismatch`, `not-deleted`.
    - Whatever the outcome, the game is uninstalled; a transfer that did not finish is cancelled so no part-file stays. An abort cancels the transfer; a run already aborted fetches nothing (`skip`, `aborted`). `safety.romsDownloadedBytes` and `safety.romsLeft` are filled in.
    - Metrics: platform slug, bytes, `downloadMs`, `progressEvents`, hash algorithm. No game name.
  - `index.ts` registers it beside `server.heartbeat`.
  - `test/app/server.ts`: a `gba` option adds a Game Boy Advance platform and one game.
  - Tests: `src/main/selftestdownload.test.ts` 12/12; `test/app/selftest.test.ts` 4/4, `npm run test:app` 234/234 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). The new app test runs `download.small` in the built app against the fake RomM: pass, progress events counted, the content endpoint asked, only GET and HEAD sent, no file of the game left under the home.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR). The first x64 run failed only `pr-body.mjs`: the PR opened without the template's `Feature:` line. The body was fixed, and this note is the push that re-runs the check, since a re-run reads the original body.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not write a request yet. Next: `startup.cold`, `grid.scroll` per profile, screenshots, privacy mode, abort on input, the sandbox, run.sh's request.

## 2026-10-12 05:32 UTC session 01QNMBBfGA8UpKNKTXremHYM (hourly heartbeat)

- Device results: DEVICE-RESULTS 8e03ec7f complete. Still the minimal harness; nothing flips.
- Worked on: M0-21 part 4c (tracking issue #155): the `startup.cold` scenario, one of the three `selftest.complete` needs (acceptance line 7). Part 4b, PR #160, merged at 8e03ec7.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/selfteststartup.ts`:
    - `watchHome` starts as soon as the self-test's window exists. A probe in the page resolves with the time of the first animation frame on which Home is up, has no spinner and holds the highlight (the marks test:app's `atHome` waits on), or null after `HOME_TIMEOUT_MS`. So the time does not depend on where the request lists the check.
    - `startupStart`: from `GALLEON_STARTED_AT_MS` when run.sh sets it (wrapper start, AppImage mount included), else from the process's own start. A value that is not a time before the process started is ignored. `measuredFrom` says which.
    - `startupScenario`: pass under `STARTUP_MS`, else `over-threshold`. At or over it on a known profile other than Performance is `skip` / `not-on-performance`, since the threshold is stated for Performance. Home never reached is `home-not-reached`. Metrics: `startupMs`, `measuredFrom`, `profileObserved`, `cpuGovernor`. An abort ends the wait. `watchHome` also gives up from the main side after `HOME_TIMEOUT_MS`, so a page that never draws cannot hang the run (evaluator note).
  - `RomMixApp.createWindow` returns the window; `index.ts` registers the scenario.
  - TESTING.md's request section documents `GALLEON_STARTED_AT_MS` and the skip.
  - Tests: `src/main/selfteststartup.test.ts` 12/12. `test/app/selftest.test.ts` 5/5; new: signed in to the fake RomM, the built app answers `startup.cold` (625 ms on the VM, `measuredFrom: process`) and the run is `complete`. The not-implemented example is now `grid.scroll`.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not write a request yet. Next: `grid.scroll` per profile, screenshots, privacy mode, abort on input, the sandbox, run.sh's request (which should set `GALLEON_STARTED_AT_MS`).

## 2026-10-12 05:53 UTC session 01QNMBBfGA8UpKNKTXremHYM (hourly heartbeat, unit 2)

- Device results: none new since 8e03ec7.
- Worked on: M0-21 part 4d (tracking issue #155): acceptance line 5, abort on input. Part 4c, PR #161, merged at 0999c29; its CI wall time was x64 5:41, arm64 0:54. The evaluator's two notes on it (a page that never draws could hang the wait for Home; "under" the threshold) were fixed in the PR before merging.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/selftestinput.ts`:
    - `watchInput` runs a probe in the page through the Gamepad API the interface reads (never OS input). It polls every `INPUT_POLL_MS`. Any button down counts, even at the first look: Chromium reveals a pad only once a button is pressed, and a button held as the run starts is still a person. A stick counts when it moves more than `AXIS_MOVED` from its first reading, so drift and triggers resting at one end do not.
    - On input it aborts the run's signal. The runner already ends running checks and writes `aborted-by-user`. A page that goes away is not input.
  - `index.ts` watches only when the request's `abortOnInput` is set.
  - `test/app/driver.ts`: `StartOptions.files` writes files into the home after seeding (the request).
  - TESTING.md's request section describes the abort.
  - Tests:
    - `src/main/selftestinput.test.ts` 8/8: the probe run under `node:vm` against a scripted `navigator`.
    - `test/app/selftest.test.ts` 6/6. New: signed out, so `startup.cold` is still waiting. A simulated pad presses A, and the summary is on disk within a second, with status `aborted-by-user` and `startup.cold` `skip` / `aborted-by-user`. The first version ignored a button already down at the probe's first look. The app test caught that: the probe started after the press. It was the wrong rule anyway.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not write a request yet. Next: `grid.scroll` per profile, screenshots, privacy mode, the sandbox, run.sh's request.

## 2026-10-12 06:47 UTC session 01KMyqfmFiWMjLUMxcgqYAnk (hourly heartbeat)

- Device results: DEVICE-RESULTS 8e03ec7 complete; DEVICE-RESULTS 0999c29 complete. Still the minimal harness; nothing flips, no safety failures.
- Worked on: M0-21 part 4e (tracking issue #155): acceptance line 3, privacy mode. Part 4d, PR #162, merged at d9804bc; its CI wall time was x64 5:41, arm64 0:55.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/privacy.ts`, `Privacy`. It masks values on their way to the page, not in each screen, so a screen added later, or an error message that quotes the address, is covered too. It hides:
    - the stored server's address, host and hostname, and the stored account name;
    - any value met in a `username`, `email`, `ra_username`, `user_code`, `device_code` or `verification_path(_complete)` field, wherever the same value appears again;
    - the account picture (`avatar_path` emptied).
  - Secrets shorter than three characters are masked only as whole values.
  - `RomMixApp.hideIdentity` turns it on. `index.ts` calls it right after `readOnly(guard)`, before the window exists. `RomMixApp.send` and the IPC `handler` (answers and error messages) pass everything through `RomMixApp.shown`.
  - `test/app/server.ts`: `FakeRomm.holdContent` holds a game's content until released.
  - TESTING.md's request section describes privacy.
  - Tests:
    - `src/main/privacy.test.ts` 9/9.
    - `test/app/selftest.test.ts` 7/7. The new test holds the GBA download so the `download.small` run stays up. It then visits Home, Library, Collections, Downloads, BIOS, Emulators, Settings and a game screen, searching the markup, the field values and the title for the address, the host and the account name. With `hideIdentity()` disabled it fails ("the top bar on home names 127.0.0.1:…").
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not write a request yet. Next: `grid.scroll` per profile, screenshots (now safe to take under privacy), the sandbox, run.sh's request.

## 2026-10-12 07:43 UTC session 016eMKUxtJxpe8K1xqKKvkXV (hourly heartbeat)

- Device results: DEVICE-RESULTS 730da98 complete. Still the minimal harness; nothing flips, no safety failures. The bridge still skips for want of a `nightly` release.
- Worked on: M0-21 part 4f (tracking issue #155): `grid.scroll` per profile, one of the three `selftest.complete` needs (acceptance line 7). Part 4e, PR #163, merged at 730da98; its CI wall time was x64 5:47, arm64 1:07.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/renderer/src/perf/frames.ts` (and its test) moved to `src/shared/frames.ts`, so the self-test computes p95 and dropped frames with the overlay's own arithmetic.
  - New `src/main/selftestscroll.ts`:
    - `largestPlatform`: the platform with the most games, at least `MIN_GAMES`; none is `skip` / `no-large-platform` (the synthetic platform without a server is still to come).
    - `scrollProbe` / `runScroll`: in the page, the library menu and the platform chip are clicked (their own `onSelect`), a pointer move puts the highlight on the first game, then ArrowDown keydowns at the pad's repeat rate for `SCROLL_MS`, turning back when the highlight has stood still for `TURN_MS`. Frame intervals from `requestAnimationFrame`. Never the Gamepad API, which `watchInput` watches. A page that stops drawing or an abort ends the wait from the main side.
    - `askForProfile`: the `want-profile` / `profile-set` handshake with run.sh (PLAN.md 5.3 step 8), files written whole and removed once answered.
    - `scrollScenario`: `grid.scroll@<profile>` per requested profile, switching only when needed; a profile still not in force is `skip` / `profile-not-set`. Clocks are sampled every `SAMPLE_MS` (`profileObserved`, `governor`, `policy7MaxKHz`, `gpuMHz`). Thresholds per the catalogue; no profiles means plain `grid.scroll` held to Performance's.
  - `index.ts` registers it; TESTING.md's request section documents the scenario and the handshake. The save-writer allow-list names the handshake files.
  - Tests: `src/main/selftestscroll.test.ts` 21/21. `test/app/selftest.test.ts` 8/8; new: signed in to a fake RomM with a 1,300-game platform, the built app scrolls it (VM: 1571 frames, 167 games visited, p95 33.4 ms at 60 Hz under Xvfb) and the run is `complete`. The not-implemented example is now `power.read`. `test/app/perf.test.ts` 2/2 after the move.
  - CI x64 failed once on 29ffac1: the abort test saw no press (60 s, not about 1 s). Cause: `startApp` returns once a page target exists, so the test could plant its pad in a document the app's own page then replaced. Under CPU load on the VM the press arrives while `index.html` is still `loading` with nothing mounted. Fix: the test waits for `[data-screen]` before `plugInPad`. Passes 3/3 under load and 8/8 for the file.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not write a request or answer the handshake yet. Next: screenshots, the synthetic platform, the sandbox (line 4), run.sh's request and handshake.

## 2026-10-12 08:26 UTC session 01LuBxq5s78Luq5JRhhZhgam (hourly heartbeat)

- Device results: none new since 730da98 (ingested last session). Nothing flips, no safety failures. The bridge still skips for want of a `nightly` release.
- Worked on: M0-21 part 4g (tracking issue #155): the screenshot scenario, the last of the three `selftest.complete` needs (acceptance line 7). Part 4f, PR #164, merged at 9ea2d67; its CI wall time was x64 6:03, arm64 1:02.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - New `src/main/selftestshots.ts`, `takeScreenshots`: after the last check, each requested screen is opened from the menu bar (its own `onSelect`, as `scrollProbe` does), allowed to settle (finite animations finished, then two frames), captured with `capturePage` and written whole to `resultsDir/shots/<screen>.png`. Only screens in `SCREENS` are opened, so a request's name never reaches the page or a file name unchecked.
  - Screens that draw the library (`LIBRARY_SCREENS`: home, library, collections, downloads, game) are never captured: on the Nova that library is the owner's, and nothing published may carry its titles. They count as withheld, not missing. The synthetic platform, when it lands, may lift this for runs without a server.
  - `runSelfTest` takes the shots after the checks (not when aborted or over budget). The paths are `selftest.complete`'s evidence; metrics `screenshots`, `screenshotsMissing`, `screenshotsWithheld`. A missing screen is named in `notes` and fails `selftest.complete` with `screenshots-missing`; screens this build cannot take, or a capture that throws, leave the run `partial`.
  - TESTING.md's request example now asks for settings, bios and emulators, and the request section documents the scenario.
  - Tests: `src/main/selftestshots.test.ts` 8/8; `src/main/selftest.test.ts` 23/23 (4 new); `test/app/selftest.test.ts` 9/9 (new: signed in, settings, bios and emulators captured, home withheld). I opened the three PNGs: privacy masks the address and account on Settings; the first BIOS shot caught the menu mark mid-slide, which is why the probe waits for animations; after that fix the mark sits under the screen's own item and the platform badges are drawn.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not write a request yet. Next: the synthetic platform, the sandbox (line 4), `armada-power status` in `readPowerState`, run.sh's request and handshake.

## 2026-10-12 08:49 UTC session 01LuBxq5s78Luq5JRhhZhgam (hourly heartbeat, second unit)

- Device results: unchanged since the entry above.
- Worked on: M0-21 part 4h (tracking issue #155): `armada-power status` in the power state the self-test reads, named in M0-21's description and in #155's notes as due before `selftest.complete` is READY-FOR-DEVICE. Part 4g, PR #165, merged at 3e5c672; its CI wall time was x64 6:27, arm64 1:03.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/powerstate.ts`: `readArmadaStatus` runs `armada-power status` (no shell, `STATUS_TIMEOUT_MS`, null on any failure). `parseArmadaStatus` takes the `profile=` line's value when it is a plain word. `readPowerState(root, { status })` lets that name win over `profileInForce`'s inference. The overlay and the problem report still read files only: no process per sample.
  - `src/main/selftestscroll.ts`: the new `sample` dependency is the read taken mid-scroll. `index.ts` gives the self-test `power` with the status and `sample` without it, so no process starts while frames are timed. The scroll's first sample, and the profile checks before and after it, use `power`. `powerMetrics` leaves a sample that could not tell the profile out of `profileObserved`.
  - TESTING.md (grid.scroll), DEVICE-FACTS.md (power profiles) and the `PowerState.profile` doc say so.
  - Tests: `src/main/powerstate.test.ts` 19/19 (4 new: parsing, plain words only, status wins and the clocks stand when it fails, null without `armada-power` on PATH). `src/main/selftestscroll.test.ts` 23/23 (new: `power` never read mid-scroll, and an unknown sample is not "mixed").
  - `test/app/selftest.test.ts`: 9/9 twice. One earlier full-file run failed the privacy test ("gave up waiting for the library screen"). It passed 4/4 alone, on `main` and on this branch. Filed as #166 (flaky), to root-cause within two units.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet. Next: #166, the synthetic platform, the sandbox (line 4), run.sh's request and handshake.

## 2026-10-12 09:42 UTC session 01TWYP54GLiRNuHy52ig2n2g (hourly heartbeat)

- Device results: DEVICE-RESULTS b049a23 complete. Still the minimal harness; nothing flips, no safety failures. The bridge still skips for want of a `nightly` release. Part 4h, PR #167, merged at b049a23.
- Worked on: flaky #166, the self-test privacy app test that once gave up waiting for the library screen.
- Result: PR (this one).
- Evidence:
  - Root cause: the test began walking the menu once the top bar was signed in, without `atHome`. Home's hero takes the highlight when the shelves answer, and that can come after the top bar. A press of Enter meant for the Library item then opens the hero's game, and the library screen never comes. `driver.ts` documents this race at `atHome`, and every other signed-in scenario waits there first.
  - Shown on the VM: in 1 of 3 instrumented runs the hero was not yet drawn when the top bar was signed in, so the walk started inside that window. The failure itself did not reproduce in 10 runs alone under CPU load, 4 full-file runs under load, or 18 runs with `slowRomListings` swept from 50 to 700 ms: the window between `goTo`'s last check and its Enter is a few milliseconds.
  - Fix: `test/app/selftest.test.ts` waits `atHome` after the signed-in top bar check, before the first `goTo`. Nothing is retried or skipped.
  - After the fix: the test passes 6/6 under CPU load, and the file passes 9/9. `scripts/agent/check.sh` is green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M0-21 continues (the synthetic platform, the sandbox, run.sh's request and handshake). #110's safe default applies 2026-10-13 01:00 UTC.

## 2026-10-12 10:35 UTC session 019YTjCVcH4zVLC76deCJNbC (hourly heartbeat)

- Device results: DEVICE-RESULTS 094b317 complete. Still the minimal harness; nothing flips, no safety failures. The bridge still skips for want of a `nightly` release. Flaky #166's fix, PR #168, merged at 094b317; its CI wall time was x64 6:04, arm64 0:51.
- Worked on: M0-21 part 5a (tracking issue #155): the emulator sandbox's descriptor hook and planner, the first step of acceptance line 4.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/config/emulators/types.ts`: a required `sandbox` field, `((ctx: SandboxContext) => SandboxRecipe | null) | undefined`. A recipe names arguments placed right after the program, environment, and config files written into the sandbox. Every descriptor spells it `undefined` for now; `example/index.ts` documents it.
  - New `src/main/selftestsandbox.ts`:
    - `sandboxFolders`: `$GALLEON_HOME/sandbox/<emulator>/` with config, data, saves, states and bios.
    - `planSandbox`: the XDG config, data, state and cache roots point inside the sandbox and are set last, so no recipe or descriptor env can point one back out. Never starts an emulator without a recipe, a recipe that declines the context, a flatpak or `scripts` install, or a recipe file outside the sandbox: `skip` / `cannot-sandbox` with a detail.
    - `prepareSandbox`: makes the folders, writes the recipe's files whole, links the owner's BIOS files (nested, bounded depth, never copied, idempotent).
  - TESTING.md's request section documents the sandbox. The save-writer allow-list names the new module.
  - Tests: `src/main/selftestsandbox.test.ts` 19/19, including every registered emulator either planning inside its sandbox or skipping as `cannot-sandbox`. `registry.test.ts` knows the new field.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; nothing starts an emulator in the self-test yet. Next: RetroArch's recipe (`--config` plus an appended config), then Dolphin, DuckStation and the XDG-only emulators, then flatpaks.

## 2026-10-12 10:52 UTC session 019YTjCVcH4zVLC76deCJNbC (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 5a, PR #169, merged at f49339c; its CI wall time was x64 6:32, arm64 0:59.
- Worked on: M0-21 part 5b (tracking issue #155): RetroArch's sandbox recipe (acceptance line 4, "RetroArch `--config` plus an appended config naming the sandbox's folders").
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `SandboxContext` gains `owner` (home, config root, file reader), which a recipe reads and never writes. `planSandbox` takes it from its caller.
  - `src/config/emulators/retroarch/index.ts`:
    - `requiredCore` is the old `core` body, shared by `core` and the recipe.
    - `sandboxRecipe`: `--config <sandbox>/config/retroarch/retroarch.cfg --appendconfig <sandbox>/retroarch-sandbox.cfg`, placed right after the program. The appended config:
      - names the save, state, system, core-options, history, playlist, screenshot, cache and log folders, all inside the sandbox;
      - keeps saves, states, system files and screenshots out of the game's folder;
      - sets `config_save_on_exit = "false"`;
      - loads cores from the owner's `libretro_directory`.
    - A system with no core is null, so it is `cannot-sandbox`. A flatpak RetroArch is still skipped until the flatpak part.
  - Tests: `src/main/selftestsandbox.test.ts` 23/23 (4 new for RetroArch). Every folder in the appended config except the owner's cores is checked to be inside the sandbox.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; nothing starts an emulator in the self-test yet, and the Nova's RetroArch is a flatpak (G0-7). Next: Dolphin, DuckStation and the XDG-only emulators, then flatpaks.

## 2026-10-12 11:30 UTC session 01JYonW2Y3SeXmqbCVr1BU3J (hourly heartbeat)

- Device results: still the minimal harness; nothing flips, no safety failures. The bridge still skips for want of a `nightly` release. Part 5b, PR #170, merged at a0d7c3c; its CI wall time was x64 6:00, arm64 0:52. Recorded with full shas, which `device-results.mjs` needs to count them as read:
  - DEVICE-RESULTS 8e03ec7a52bdc220a193f52dd7fe1a22a040577f complete
  - DEVICE-RESULTS 0999c2927558ea5bf85742971754ab0b3bb1ec8f complete
  - DEVICE-RESULTS 730da98825f828dfb68d7a1eafd93c68c792efda complete
  - DEVICE-RESULTS b049a238cc395ad1bfa7c2f388e1fec9a1a128a4 complete
  - DEVICE-RESULTS 094b31768c6b16b65325101ac61aa6bd98dc4e5e complete
  - DEVICE-RESULTS f49339ccc8955c8e012ffe2b109b696368619ae8 complete
- Worked on: M0-21 part 5c (tracking issue #155): DuckStation's sandbox recipe (acceptance line 4).
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - Read from DuckStation's source at the pinned commit `df805975` (`core.cpp` `SetDataRoot`, `settings.cpp` `EmuFolders::LoadConfig`, `qthost.cpp`):
    - With `XDG_CONFIG_HOME` set, the data root is `$XDG_CONFIG_HOME/duckstation`, so the sandbox's XDG roots already hold it.
    - A `portable.txt` or `settings.ini` beside the AppImage roots it there instead, whatever the environment says.
    - A fresh settings file opens the setup wizard, and an AppImage asks once about a launcher shortcut.
  - `SandboxContext` gains `installRef`, the install's path.
  - `src/config/emulators/duckstation/index.ts` `sandboxRecipe`:
    - writes `config/duckstation/settings.ini` naming the sandbox's BIOS, memory card and save state folders, with `SetupWizardIncomplete = false` and `NoDesktopFile = true`;
    - declines (`cannot-sandbox`) when a portable marker sits beside the AppImage, and for a binary install, where DuckStation looks beside the resolved link.
  - Tests: `src/main/selftestsandbox.test.ts` 28/28 (5 new for DuckStation).
  - `scripts/agent/check.sh` green.
- Found, not fixed (outside this unit): the descriptor's `dirs` say `~/.local/share/duckstation`, which is right only while `XDG_CONFIG_HOME` is unset; with it set, DuckStation uses `$XDG_CONFIG_HOME/duckstation`. Noted on #155 for the save-sync work.
- CI: the first two x64 runs failed on this PR's paperwork, not its code: this entry first carried a time later than the run (`features-check`), then the body had no `Feature:` line (`pr-body`). Both fixed; the wall time is recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; nothing starts an emulator in the self-test yet. Next: flatpaks (5d), then Eden and shadPS4 (portable `user` folders to rule out first).

## 2026-10-12 11:52 UTC session 01JYonW2Y3SeXmqbCVr1BU3J (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 5c, PR #171, merged at 2bbc78c; its CI wall time was x64 6:17, arm64 1:03.
- Worked on: M0-21 part 5d (tracking issue #155): flatpak installs in the sandbox.
- Result: parked. No code lands; this PR carries only this entry. M0-21 stays false, and flatpaks are still skipped as `cannot-sandbox`.
- What was tried: `flatpak run --filesystem=<sandbox> --filesystem=<game folder>:ro --env=<XDG roots>…`, with the spawn env left alone. Tests and `check.sh` were green.
- Evaluator: FAIL, on three blocking points, all confirmed against flatpak's source (`common/flatpak-run.c`, `common/flatpak-context.c`):
  - `--env` is applied before `flatpak_context_apply_env_appid`, which then overwrites `XDG_{DATA,CONFIG,CACHE,STATE}_HOME` with `~/.var/app/<id>/…`. The sandbox's XDG roots never reach the app.
  - `--filesystem` only adds access. Flathub's RetroArch has `--filesystem=host`, so the app can still reach the owner's home.
  - `flatpak run` always mounts, and creates folders in, the owner's `~/.var/app/<id>/`.
- Next (exact steps on #155):
  - start the `flatpak` process with `HOME=<sandbox>`, keeping the owner's `XDG_DATA_HOME` so per-user installs are still found;
  - pass `--nofilesystem=host` and `--nofilesystem=home`, and drop the other host grants;
  - expose the owner's cores, BIOS folder and payload folder `:ro`;
  - test the argv for all of the above.
- Process note: on this VM, `git commit -a` under the husky pre-commit hook fails with "invalid object … Error building trees". `git add` then `git commit` works.

## 2026-10-12 12:32 UTC session 01SEPBgzYPhDLgKBBmqwLbFn (hourly heartbeat)

- Device results: one new, the minimal harness again; nothing flips, no safety failures. Part 5d (PR #172) merged at c704135.
  - DEVICE-RESULTS 2bbc78cc280d3edd2027b4baaf424adb8ee17baf complete
- Worked on: M0-13 part 3a (tracking issue #57): the `build.identity` self-test scenario (acceptance line 4).
- Result: PR (this one). M0-13 stays false.
- Evidence:
  - The request gains an optional `version`, copied by run.sh from `build-info.json` beside `sha`. A version that is not a plain version string refuses the request (`request-version`), since it is published in the summary.
  - `src/main/selftestidentity.ts`: `build.identity` passes when the build's stamped commit (`buildStamp`, now exported from `update.ts`) equals the request's `sha` whole and `app.getVersion()` equals its `version`. Fails `commit-unstamped`, `commit-mismatch` (a `-dirty` build included) or `version-mismatch`; no `version` is `skip` / `no-build-version`. Wired into `index.ts` beside the other scenarios.
  - Tests: `src/main/selftestidentity.test.ts` 7/7; `src/main/selftest.test.ts` gains the `version` parse and two refusals.
  - `docs/TESTING.md`: the request schema shows `version`; a bullet says how `build.identity` judges.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none yet; run.sh does not start the app until M0-22, which will write `version` into the request. Next: `update.verify` (part 3b).

## 2026-10-12 12:43 UTC session 01SEPBgzYPhDLgKBBmqwLbFn (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 3a, PR #173, merged at 763ea72; its CI wall time was x64 6:23, arm64 0:59.
- Worked on: M0-13 part 3b (tracking issue #57): the `update.verify` self-test scenario (acceptance line 5).
- Result: PR (this one). M0-13 stays false.
- Evidence:
  - `Updater.rehearse(dir)` (`src/main/update.ts`): reads the `canary` release, picks this machine's image, takes its digest from `SHA256SUMS` through `publishedDigest`, fetches it into `dir` and verifies it as `download` does; then a copy with its middle byte flipped must be refused by the same verification. Nothing is made executable or renamed; both files are removed. The release's asset parsing moved into `assetsOf` and `imageOf`, shared with `check`.
  - `src/main/selftestupdate.ts`: `update.verify` runs the rehearsal in `$GALLEON_HOME/update-verify/`, removes the folder, and fails `installed-image-changed` when `APPIMAGE`'s size, change time or inode differ afterwards. Other reasons: `no-image`, `no-checksums`, `no-digest`, `matching-refused`, `corrupted-accepted`, `channel-unreadable` (the error's words stay in the log). The run's abort signal reaches every request and the transfer, so a button press ends it as `skip` / `aborted` with the folder removed.
  - Tests: `src/main/updater.test.ts` 5 new (canary read, sums fetched, folder empty, running image untouched; a mismatch reported; no line in the sums file is `no-digest` and fetches no image; an abort mid-run leaves the folder empty; no image or no sums named); `src/main/selftestupdate.test.ts` 7/7 (abort during and before the rehearsal included). `savewriter.allowlist.test.ts` lists the new writer.
  - `docs/TESTING.md`: how `update.verify` judges.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: FAIL first (the abort button did not stop the download, against rail 3); fixed, then see the PR.
- Device / acceptance: both of M0-13's device checks now exist as self-test scenarios; they run on the Nova once run.sh starts the app (M0-22). Not READY-FOR-DEVICE until then.

## 2026-10-12 13:32 UTC session 01XZpRLRqcufL6c6tgU8X2nk (hourly heartbeat)

- Device results: none new; bridge last seen 2026-10-12T12:03Z (no new nightly). Part 3b of M0-13, PR #174, merged at 969d0fc; its CI wall time was x64 6:20, arm64 0:58.
- Worked on: M2-08 part 2a (tracking issue #111): the owner answered decision #110 on 2026-10-12, before its safe default's date.
- Result: PR (this one). M2-08 stays false: the defaults in settings and the per-system choice in Settings are part 2b.
- Evidence:
  - `docs/decisions/0005-emulator-per-system.md`: the owner's answer, all as recommended: SNES `snes9x`, GBA `mgba`, PS1 `swanstation` in RetroArch; PPSSPP; ARMSX2 with a folder card; Dolphin with slot A a GCI folder; Dolphin for Wii; Flycast with one VMU per game.
  - The same ADR records the owner's rule: where a choice needs an emulator setting, change only that key in the Nova's existing settings file, after a backup; never write a fresh or Galleon-only settings file; leave existing memory cards and RetroArch's `config/SwanStation/` files alone.
  - `docs/save-sync/SYSTEM-CHOICES.md` records the answer per row (acceptance line 2, docs half).
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: M2-08 part 2b: per-system default emulators in `src/config/` from SYSTEM-CHOICES.md, and the per-system choice in Settings. Issue #110 is closed with this PR.
- Notes: for M0-21, a device-test sandbox for ARMSX2, Dolphin or Flycast must start from a copy of the owner's settings, never an empty one (ADR 0005, consequences).

## 2026-10-12 13:48 UTC session 01XZpRLRqcufL6c6tgU8X2nk (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 2a, PR #175, merged at 7f8e113; its CI wall time was x64 5:50, arm64 0:33. Issue #110 closed as adopted.
- Worked on: M2-08 part 2b-1 (tracking issue #111): the default emulator per system follows ADR 0005, for the systems whose chosen emulator Galleon can already drive.
- Result: PR (this one). M2-08 stays false.
- Evidence:
  - `src/config/emulators/index.ts`: `SYSTEM_DEFAULTS` names RetroArch for `snes`, `snesna`, `gba` and `psx` (whose core is already `swanstation` in `systems.ts`). `emulatorsForSystem` lists it first, so `defaultEmulatorFor`, Settings' platform list and the install wizard show it. `resolveEmulator` prefers it, when installed, over the ranking whenever nothing is chosen for the system. A recorded choice still wins, so each system stays changeable in Settings' platform list.
  - Tests: `src/config/emulators/registry.test.ts` 63/63. New: the default listed first with or without a ranking; the defaults are the ADR's and each emulator runs its system; the default beats the ranking but not a choice; an uninstalled default falls back to the ranking. RomMix's ranking tests now use `nes`, which has no default.
  - `scripts/agent/check.sh` green; `npm run test:app` 239/239 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none.
- Next: PSP, PS2, GameCube, Wii and Dreamcast join `SYSTEM_DEFAULTS` with their descriptors (M1-03 to M1-06, after M0-22). The ARMSX2, Dolphin and Flycast setting changes go with them (ADR 0005, decision 2). Then M2-08 can pass.

## 2026-10-12 14:33 UTC session 01LwGckt1Kz8qHK8zoRirWxz (hourly heartbeat)

- Device results: one new, the minimal harness again; nothing flips, no safety failures. Part 2b-1 of M2-08, PR #176, merged at 47042b9.
  - DEVICE-RESULTS 7f8e113 complete
- Worked on: M0-21 part 5e (tracking issue #155): DuckStation's portable-marker check when the AppImage is reached through a link (open note from part 5c).
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `SandboxContext` gains `installTarget`, the install's path with every link followed. `planSandbox` takes it from a `realPath` parameter (`resolveLinks`, `realpathSync` that answers null, for a real start) and skips an install it cannot resolve as `cannot-sandbox` / `install-unreadable`.
  - DuckStation's recipe declines when a portable marker sits beside the link or beside the AppImage it leads to.
  - Tests: `src/main/selftestsandbox.test.ts` 34/34; new: a marker beside the link's target, a marker beside the link, a link with neither runs through the link, an unreadable install, and `resolveLinks` on a link chain, a dangling link and a missing file.
  - `docs/TESTING.md`: the sandbox bullet names the unreadable install.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS.
- Device / acceptance: none; no launch scenario calls `planSandbox` yet.
- Notes: open the PR with its `Feature:` line and date the entry before the push. CI reads the body from the push that triggered it, and editing the body does not re-run `build`, so a missing line costs a commit.

## 2026-10-12 14:52 UTC session 01LwGckt1Kz8qHK8zoRirWxz (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 5e, PR #177, merged at 9f95aca; its CI wall time was x64 6:23, arm64 1:02.
- Worked on: M0-21 part 5f (tracking issue #155): the evaluator's note from part 5b, that RetroArch must not inherit `LIBRETRO_DIRECTORY`.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - RetroArch's `configuration.c` reads eight `LIBRETRO_*_DIRECTORY` variables after its config and lets each replace a folder the config named; `LIBRETRO_SYSTEM_DIRECTORY` would put system files in the owner's folder whatever the appended config says.
  - `SandboxRecipe.unset`: variables removed from the inherited environment (never an XDG root). RetroArch's recipe lists the eight. `planSandbox` carries them in the plan and drops them from the descriptor's own env; `sandboxEnvironment(plan, parentEnv)` builds the child's environment (`childEnvironment`, minus `unset`, plus the plan's env) for the launch check that will start emulators.
  - Tests: `src/main/selftestsandbox.test.ts` 36/36; new: unset variables leave the plan and the inherited environment but XDG roots stay; RetroArch inherits no `LIBRETRO_*` variable from a session that sets all eight.
  - `docs/TESTING.md`: the sandbox bullet names the removed variables.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none; no launch scenario calls `planSandbox` yet.

## 2026-10-12 15:30 UTC session 01GHqwaL39bhoXCitQmtPQfJ (hourly heartbeat)

- Device results: two new, the minimal harness again; nothing flips, no safety failures. Part 5f of M0-21, PR #178, merged at 75021a9; its CI wall time was x64 6:27, arm64 0:59.
  - DEVICE-RESULTS 9f95aca complete
- Worked on: M0-21 part 5g (tracking issue #155): the BIOS files in a sandbox are no longer symlinks to the owner's (evaluator note on acceptance line 4).
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `prepareSandbox` gives `bios/` the sandbox's own copy of each of the owner's BIOS files: a copy-on-write clone (`COPYFILE_FICLONE_FORCE`, free on the Nova's btrfs) or, where the filesystem cannot clone, a plain copy within `BIOS_COPY_BUDGET`. Past the budget it answers `cannot-sandbox` / `bios-too-large`. A symlink left by an earlier build is replaced; a copy the emulator wrote to is kept.
  - Why: emulators keep NVRAM and flash beside their BIOS (PCSX2-family `.nvm`, Flycast `dc_nvmem.bin`), and a write through a symlink lands in the owner's file.
  - Tests: `src/main/selftestsandbox.test.ts` 40/40; new: a write to the sandbox's copy leaves the owner's file alone, a clone costs no budget, copies past the budget skip the launch, a second start keeps a written copy, an old link is replaced by a copy.
  - `docs/TESTING.md` and `docs/PLAN.md` describe copies instead of links.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS.
- Notes: the first push failed `pr-body.mjs`: `Feature:` must start its own line in the PR body.
- Device / acceptance: none; no launch scenario calls `prepareSandbox` yet.

## 2026-10-12 15:44 UTC session 01GHqwaL39bhoXCitQmtPQfJ (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 5g of M0-21, PR #179, merged; its CI wall time was x64 6:24, arm64 1:03.
- Worked on: M0-21 part 5h (tracking issue #155): RetroArch is not started when the owner's core file is missing (evaluator note from part 5b).
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `SandboxRecipe.needs`: files of the owner's an emulator cannot start without. `planSandbox` looks each up through `realPath` and skips as `cannot-sandbox` / `needed-file-missing` when one cannot be read. RetroArch's recipe needs `<libretro_directory>/<core>_libretro.so`.
  - Tests: `src/main/selftestsandbox.test.ts` 42/42; new: a recipe's missing needed file skips the start and a readable one does not; RetroArch is skipped when the owner's core file is missing.
  - `docs/TESTING.md`: the sandbox bullet names the missing needed file.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none; no launch scenario calls `planSandbox` yet.

## 2026-10-12 15:53 UTC session 01GHqwaL39bhoXCitQmtPQfJ (hourly heartbeat, third unit)

- Device results: unchanged since the entry above. Part 5h of M0-21, PR #180, merged at dffeebe; its CI wall time was x64 6:37, arm64 1:00.
- Worked on: M0-21 part 5i (tracking issue #155): RetroArch makes `/tmp/retroarch-tmp` on every start (evaluator note from part 5b).
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - RetroArch's `frontend/drivers/platform_unix.c` (read as specification) makes `/tmp/retroarch-tmp` for its default cache folder before any config is read, so neither `cache_directory` nor a variable can move it.
  - `SandboxRecipe.strays`: folders outside the sandbox an emulator makes whatever it is told. The plan carries the absolute ones; `straysToClear` (read just before the start) keeps only those not there yet; `clearStrays` (after exit) removes each one that is still empty and answers what it removed. A non-empty folder stays for the owner-state manifest to report.
  - Tests: `src/main/selftestsandbox.test.ts` 46/46; new: only absolute strays are planned, one already there is never the run's, only an empty one is removed, and RetroArch's plan names `/tmp/retroarch-tmp`.
  - `docs/TESTING.md`: the sandbox bullet names the stray folders.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- Device / acceptance: none; no launch scenario calls `planSandbox` yet.
- Next: open for M0-21 line 4: flatpaks (5d), the portable `user` folders of Eden and shadPS4; then the synthetic 1,300-game platform.

## 2026-10-12 16:35 UTC session 01CZXRhAceMMinhpATALtvqG (hourly heartbeat)

- Device results: three new, the minimal harness again; nothing flips, no safety failures. Part 5i of M0-21, PR #181, merged at d142eb3; its CI wall time was x64 6:08, arm64 0:57.
  - DEVICE-RESULTS 7f8e113 complete
  - DEVICE-RESULTS 9f95aca complete
  - DEVICE-RESULTS dffeebe complete
- Worked on: M0-21 part 5j (tracking issue #155): a sandbox recipe for Eden.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - Eden's `src/common/fs/path_util.cpp` (read as specification): on Linux a `user` folder in the **working folder** is the whole portable layout; otherwise `$XDG_DATA_HOME/eden`, `$XDG_CONFIG_HOME/eden` and `$XDG_CACHE_HOME/eden`. So every sandbox plan now carries `cwd`, the sandbox's root, for the launch check to start in.
  - `SandboxRecipe.bios`: the sandbox folder the owner's BIOS copies go to, for an emulator that reads them from a fixed place (null for `folders.bios`). A folder outside the sandbox skips the start as `cannot-sandbox` / `bios-outside-sandbox`. `SandboxContext.owner` gains `dataDir`.
  - Eden's recipe: AppImage only; needs the owner's `<data>/eden/keys/prod.keys`, because Eden opens a warning at start-up without it (`OnCheckFirmwareDecryption`); keys are copied to the sandbox's `data/eden/keys`; `config/eden/qt-config.ini` sets `[UI] confirmStop=2` (Ask_Never, so a SIGTERM closes it without a question) and `check_for_updates=false` (the update dialog).
  - Tests: `src/main/selftestsandbox.test.ts` 56/56; new: the start folder is the sandbox root; the BIOS folder is the default, the recipe's, or refused outside the sandbox; `prepareSandbox` copies into the recipe's folder; Eden's plan, keys folder, settings file, and skips without `prod.keys` or as a binary or flatpak.
  - `docs/TESTING.md`: the sandbox bullet names the start folder and the recipe's BIOS folder.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS. Notes for the launch check: pass the emulator's own `paths.bios` as `ownerBios`; Eden's "Wayland detected" box (`OnCheckGraphicsBackend`) would wait for a person under native Wayland, which Game Mode is not (DEVICE-FACTS: X11 on `:1`).
- Device / acceptance: none; no launch scenario calls `planSandbox` yet.
- Next: shadPS4's recipe (rule out its portable `user` folder first), then the launch scenario itself.

## 2026-10-12 16:51 UTC session 01CZXRhAceMMinhpATALtvqG (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 5j of M0-21, PR #182, merged at 471fdcf; its CI wall time was x64 6:35, arm64 0:58.
- Worked on: M0-21 part 5k (tracking issue #155): a sandbox recipe for shadPS4.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - shadPS4's `src/common/path_util.cpp` (read as specification): a `user` folder in the working folder is its whole layout, otherwise `$XDG_DATA_HOME/shadPS4` holds settings, saves, logs and caches. `src/main.cpp`: its only message box is for a start with no arguments. So the recipe is empty: the plan's `cwd` (the sandbox root) and the XDG roots keep it inside. AppImage only.
  - Tests: `src/main/selftestsandbox.test.ts` 58/58; new: shadPS4 starts in the sandbox root with its data below the sandbox's `XDG_DATA_HOME`, writes no files, and is skipped as a binary or flatpak.
  - `docs/TESTING.md`: the sandbox bullet names shadPS4 beside Eden.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS.
- Device / acceptance: none; no launch scenario calls `planSandbox` yet.
- Next: open for M0-21 line 4: flatpaks (5d, parked); then the synthetic 1,300-game platform and the launch scenario.

## 2026-10-12 17:27 UTC session 01UJtxTd83kpAeiL5yGyn5ve (hourly heartbeat)

- Device results: one more since the entry above, the minimal harness again; nothing flips, no safety failures. Part 5k of M0-21, PR #183, merged at 791c314; its CI wall time was x64 6:20, arm64 0:55.
  - DEVICE-RESULTS 791c314 complete
- Worked on: M0-21 part 6a (tracking issue #155): the built-in synthetic 1,300-game platform for `grid.scroll`.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/selftestlibrary.ts`: a platform of `SYNTHETIC_GAMES` games with negative ids (RomM's are never below zero), no artwork, answered by page, search, order, count and id. `RommClient.offerSynthetic` lists it beside the server's platforms (alone when the server does not list them) and answers its pages, counts and games without a request. Only the self-test's `grid.scroll` calls it, and only when no real platform reaches `MIN_GAMES` or the platform list fails.
  - Tests: `src/main/selftestlibrary.test.ts` 7/7 (new); `src/main/selftestscroll.test.ts` 26/26 (new: the synthetic platform is scrolled only when no real one qualifies or the list fails); `src/main/romm.test.ts` 139/139 (new: nothing synthetic until offered; its games answered with no request; the only platform when the server is away).
  - `test/app/selftest.test.ts`: new case, a library with no large platform; the built app scrolls `galleon-synthetic` (1,300 games, 188 visited on the VM) and no synthetic id reaches the fake RomM.
  - `docs/TESTING.md`: the `grid.scroll` bullet names the synthetic platform.
  - `scripts/agent/check.sh` green; `npm run test:app` 240/240 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS. Note: once offered, the synthetic platform hides a failing platform list for the rest of the run, so `download.small` would then skip rather than error (a skip never passes; `server.heartbeat` still fails).
- Device / acceptance: none until run.sh starts the app (M0-22).
- Next: the launch scenario (M0-21 line 4 and the description's launch and graceful exit); flatpaks stay parked (5d).

## 2026-10-12 18:26 UTC session 014G8BN9326ZrLUk8Ay2Rwkt (hourly heartbeat)

- Device results: nothing new since the entry above (newest 791c314, complete, the minimal harness); no safety failures, no regressions. Part 6a of M0-21, PR #184, merged at 58d29a5; its CI wall time was x64 8:06, arm64 2:10.
- Worked on: M0-21 part 6b (tracking issue #155): the launch-and-exit cycle behind `launch.<emulator>` and `exit.<emulator>`.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/selftestlaunch.ts`: `launchCycle` prepares the sandbox, starts the plan as a new process group, polls the window list for a window of that group until one is focused (`WINDOW_TIMEOUT_MS`), lets it settle (`SETTLE_MS`), sends SIGTERM to the group and waits up to `EXIT_GRACE_MS` for the group (not just its leader) to empty, killing it past that. A leader that exits by itself with its group still alive gets the group stopped the same way. The group is always emptied and the recipe's strays cleared, whatever happened after the start; an abort is answered in poll steps. The process, window list, signals and clock are injected.
  - Tests: `src/main/selftestlaunch.test.ts` 21/21 (new): both pass on a focused window and a clean exit; settle before the stop; `no-window`, `not-focused`, `not-fullscreen` (only when known), `exited-early` unsignalled, `exit-code` (including death by the signal), `killed` after the grace, a group that survives SIGKILL does not hold the run; a leader gone early with helpers left gets them stopped; a clean leader exit with the group left running is killed and fails; `prepare-failed`; abort mid-launch and mid-settle; nothing started for an abort, a skip plan, a skip preparation; `spawn-failed` still clears strays.
  - `docs/TESTING.md`: a bullet for the cycle, its failure reasons and metrics.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: FAIL, then PASS. The first pass found the group left running when its leader exits (fixed: `groupAlive`). Notes for the wiring: an abort waits for the stop (up to two graces), so check the run-level one-second abort line; `exit.<emulator>`'s focus return and save-folder change are still to come.
- Device / acceptance: none; no scenario calls `launchCycle` yet.
- Next: the real window list (gamescope's focus and window-list atoms, else the X11 list, matched to the group), then wiring `launch.*` / `exit.*` into the scenario map with each installed emulator's payload from the request.

## 2026-10-12 19:45 UTC session 01Y2Gq46ojpEwrMX1FdibYcd (hourly heartbeat)

- Device results: nothing new since the entry above (newest 791c314, complete, the minimal harness); no safety failures, no regressions. Part 6b of M0-21, PR #185, merged at f1b536d; its CI wall time was x64 6:57, arm64 0:51.
- Worked on: M0-21 part 7a (tracking issue #155): a small X11 client for the window list behind `launch.<emulator>`.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/x11.ts`: opens the unix socket `DISPLAY` names (local displays only) with the MIT-MAGIC-COOKIE-1 from `XAUTHORITY` or `~/.Xauthority` (none when there is no entry, as gamescope's XWayland may need), reads the first screen's root, and offers `internAtom`, `getProperty` (any type, in its own format) and `queryTree`. The Nova has no `xprop` or `xdotool`, and four requests do not justify a dependency. Nothing throws: an unreachable or refusing display opens as null; an X error, an unanswered request (`REQUEST_TIMEOUT_MS`) or a closed connection answers null. Events and GenericEvents between replies are passed over.
  - Tests: `src/main/x11.test.ts` 21/21 (new), against a fake display on a unix socket that parses each request and builds each reply as the protocol lays them out: the setup with and without a cookie, refused, unanswered and with no server; the setup reply split across reads; atoms existing or made; 32- and 8-bit properties and a missing one; children, including a count past the reply's data; an X error then a working request; events between replies; a request timeout; requests after close and when the server goes away; Xauthority parsing (host and display match, wildcard family, empty display number, no match, truncated file); the `DISPLAY` forms taken and refused.
  - `scripts/agent/check.sh` green; `x11.ts` 100% lines.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: FAIL, then PASS. The first pass found this entry missing; its note (a child count past the reply's data would reject) is fixed by capping the count.
- Device / acceptance: none; nothing calls `openDisplay` yet.
- Next: part 7b, `findWindow` over it: gamescope's root atoms (focused window, window list) else the X11 tree, matched to the started group through `_NET_WM_PID` and `/proc/<pid>/stat`; then wiring `launch.*` / `exit.*` into the scenario map.

## 2026-10-12 19:58 UTC session 01Y2Gq46ojpEwrMX1FdibYcd (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. Part 7a of M0-21, PR #186, merged at f222e50; its CI wall time was x64 6:04, arm64 1:04.
- Worked on: M0-21 part 7b (tracking issue #155): `findWindow` for the launch cycle, over the X11 client.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/selftestwindows.ts`: `windowFinder(x11)` interns its atoms once (only those that exist), takes the windows from `_NET_CLIENT_LIST`, else the root's children and theirs (a reparenting manager puts the client a level below its frame), and keeps those whose `_NET_WM_PID` is in the started group (`processGroup`, from `/proc/<pid>/stat`, counted past the last `)` of the command name). Focused: the group's window is, or holds, the one `GAMESCOPE_FOCUSED_WINDOW` names, else `_NET_ACTIVE_WINDOW`, else the keyboard focus. Fullscreen: from that window's `_NET_WM_STATE`, null when it has none.
  - `src/main/x11.ts`: `inputFocus` (GetInputFocus) for that last fallback.
  - Tests: `src/main/selftestwindows.test.ts` 14/14 (new): gamescope focus and fullscreen; a group window gamescope does not focus; a desktop's client list and active window; no window manager (the tree a level down, the keyboard focus); focus inside the group's window; no or other focus; no group window; no `_NET_WM_PID`; no fullscreen atom; atoms interned once; `processGroup` with brackets and spaces in the command name, the path, a gone process, garbage, its own process. `src/main/x11.test.ts` 22/22 (new: the input focus, and null on an X error).
  - `docs/TESTING.md`: the launch bullet says how the window list is read.
  - `scripts/agent/check.sh` green; `selftestwindows.ts` 100% lines.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS. Notes for the wiring: a finder caches atoms that did not exist yet, so make one per launch cycle; against a display that stops answering one poll can take candidates × `REQUEST_TIMEOUT_MS`; a window under gamescope that states `_NET_WM_STATE` without the fullscreen atom reads `fullscreen: false`, so watch the first device run for false `not-fullscreen`.
- Device / acceptance: none; no scenario calls `launchCycle` yet.
- Next: wiring `launch.*` / `exit.*` into the scenario map (the real `start`, `signalGroup`, `groupAlive`, `openDisplay` + `windowFinder`, and each installed emulator's payload from the request).

## 2026-10-12 20:46 UTC session 01XznMz2FrKLgWuAxXwnGzb2 (hourly heartbeat)

- Device results: nothing new since the entry above (newest 791c314, complete, the minimal harness); no safety failures, no regressions. Part 7b of M0-21, PR #187, merged at 2d001c4; its CI wall time was x64 6:56, arm64 1:10.
- Worked on: M0-21 part 8 (tracking issue #155): `launch.<emulator>` and `exit.<emulator>` wired into the self-test.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/selftestemulators.ts`: `emulatorScenarios` gives every launch or exit id in the request a scenario; both ids of an emulator share one cycle, run when the first is reached. `payloadFor` resolves `payloads[<emulator>]` against `$GALLEON_HOME`, refuses one outside it by name or where its links lead, and takes the system from the payload's folder. Skips: `no-payload`, `payload-outside-home`, `payload-missing`, `not-installed`. The device parts: `devicePlan` (planSandbox over the probe's install with the owner's folders read-only), `startPlan` (spawned detached, so its own group, with `sandboxEnvironment`, in the sandbox root, no stdio), `signalGroup` and `groupAlive` (only the recorded group; ESRCH is gone; a zombie member, killed but not yet reaped by whatever adopted it, does not count as running, from `/proc/<pid>/stat`), and `deviceCycle` (the display opened on the first look and closed after, one `windowFinder` per cycle, BIOS from the probe's `paths.bios`).
  - `src/main/index.ts`: the scenarios join the self-test's map.
  - Tests: `src/main/selftestemulators.test.ts` 25/25 (new), including a payload linking out of the home and real child processes: started in its folder with its environment as its own group; a missing program throws; a group alive until SIGTERM empties it; a skip plan opens no display; a cycle opens the display once and closes it. `test/app/selftest.test.ts`: new case, the built app answers `launch.retroarch` / `exit.retroarch` with `payload-outside-home` and `launch.duckstation` with `no-payload`, status complete, no sandbox made.
  - `docs/TESTING.md`: a bullet for the emulator and payload choice and its skip reasons.
  - `scripts/agent/check.sh` green; `npm run test:app` 241/241 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- The first check.sh after the PR opened failed the new SIGTERM test once under the full suite's load: the group still read as alive a second after the signal. Not reproduced alone; the cause taken is a killed member left a zombie until reaped, which `kill(-group, 0)` still counts, and which would read as `killed` on the device too. Fixed in `groupAlive`, with the test's wait for the group lengthened alongside.
- Evaluator: PASS. Its note (a link inside the home could lead to the owner's files) is fixed: containment is checked again on the path with links followed.
- Device / acceptance: none until run.sh sends payloads (M0-22's bundle).
- Next: `exit.<emulator>`'s remaining lines (Galleon focused again within 6 s, the save folder changed when the payload saves), then the payloads in the device bundle.

## 2026-10-12 22:27 UTC session 01CwtmZJVwJK3bmESpPhT6CX (hourly heartbeat)

- Device results: DEVICE-RESULTS 2d001c4 complete (the minimal harness); no safety failures, no regressions, nothing newly passing. Part 8 of M0-21, PR #188, merged at 2a3dd91; its CI wall time is recorded on the PR's checks (median over the last ten PRs: x64 6:36, arm64 0:59).
- Worked on: M0-21 part 9 (tracking issue #155): `exit.<emulator>` checks that Galleon holds the focus again after the emulator is gone.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/selftestlaunch.ts`: once a launch that saw its window has its group stopped without a kill, `watchForRefocus` polls `LaunchDeps.ownFocused` until it says true or `REFOCUS_MS` passes; a list that cannot tell, or throws, is not yet. `exit` fails `not-refocused` after `killed` and `exit-code`; metric `refocusMs`, threshold `REFOCUS_MS`. An abort while waiting skips both, as elsewhere in the cycle.
  - `src/main/selftestemulators.ts`: `ownFocused` asks the cycle's window finder about Galleon's own process group (the emulator never shares it: `startPlan` makes it a group leader); wired into `deviceCycle`.
  - Tests: `src/main/selftestlaunch.test.ts` 26/26 (new: refocus within the limit with its time, never refocused, a list that cannot tell or throws, not looked for after a kill / early exit / no window, abort while waiting). `src/main/selftestemulators.test.ts` 28/28 (new: `ownFocused` asks Galleon's group, cannot tell without a window or a group, defaults to this process).
  - `docs/TESTING.md`: the cycle's bullet names `not-refocused` and `refocusMs`.
  - `scripts/agent/check.sh` green; `npm run test:app` 241/241 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- CI: the first x64 leg failed the pull-request body check (the body had no `Feature:` line); the body was fixed and this entry's push re-ran it.
- Evaluator: PASS. Its note (the `deviceCycle` comment left above `ownFocused`) is fixed.
- Device / acceptance: none until run.sh sends payloads (M0-22's bundle). Watch the first device run for Galleon's own window: under gamescope the self-test's window must be one gamescope will focus again.

## 2026-10-12 23:44 UTC session 01SrH8rmHvjsYBaKiBeFkaih (hourly heartbeat)

- Device results: nothing new since the entry above (newest 2d001c4, complete, the minimal harness); no safety failures, no regressions. Part 9 of M0-21, PR #189, merged at 00e6dea; its CI wall time is on the PR's checks.
- First unit: Dependabot #1 (Electron), held for a device baseline, which 2d001c4 now is. Branch brought onto `main`; `scripts/agent/check.sh` green and `npm run test:app` 241/241 on it locally; CI x64 6:04, arm64 0:58; evaluator PASS. ELECTRON 44.4.5 -> 44.6.0 merged at 472b1ac, waiting for device.
- Worked on: M0-21 part 10 (tracking issue #155): `exit.<emulator>` checks the save folder changed when the payload saves.
- Result: PR (this one). M0-21 stays false.
- Evidence:
  - `src/main/selftestlaunch.ts`: `launchCycle` takes `expectSave`; `LaunchDeps.saveFingerprint` is read of the sandbox's `saves` folder before the start and after the stop. `exit` fails `save-unchanged` (after `killed`, `exit-code`, `exited-early` and `not-refocused`) when the payload saves and nothing changed; metric `saveChanged` always, threshold only when a save is expected.
  - `src/main/selftestemulators.ts`: `saveFingerprint` walks the folder by hand (a recursive readdir follows links to folders, which could reach the owner's files), listing each file's size and modification time (folders are not listed: an emulator can make one per core or game, and a folder alone is no save) and never throwing; `savingPayloads` decides `expectSave` per emulator. `src/main/selftest.ts`: the request's optional `savingPayloads` (a list of emulator ids, else `request-saving-payloads`).
  - Tests: `src/main/selftestlaunch.test.ts` 31/31 (new: a save written passes with its metric and threshold; none written fails `save-unchanged`; a folder already changed before the start does not count; a payload that does not save is not held to it; a kill is reported before an unchanged save). `src/main/selftestemulators.test.ts` 32/32 (new: only listed emulators expect a save; the fingerprint unchanged by a new folder, changed by a new file, a rewrite and a removal; links to a file and to a folder listed and not followed). `src/main/selftest.test.ts`: the refusal.
  - `docs/TESTING.md`: the request example and the cycle and payload bullets.
  - `scripts/agent/check.sh` green; `npm run test:app` 241/241 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS. Its notes are fixed: a new empty folder counted as a save, TESTING.md said unknown ids refuse the request, and a folder made empty during the run counted as a change.
- Device / acceptance: none until run.sh sends payloads (M0-22's bundle), which must list in `savingPayloads` only payloads that write a save into the sandbox's `saves` folder.
- Next: the payloads and `savingPayloads` in the device bundle; flatpaks (5d, parked).

## 2026-10-13 00:27 UTC session 01H3vg7VG7BqxFWzp227K8Yj (hourly heartbeat)

- Device results: DEVICE-RESULTS 7f8e113 complete; DEVICE-RESULTS 9f95aca complete; DEVICE-RESULTS dffeebe complete; DEVICE-RESULTS 791c314 complete; DEVICE-RESULTS 2d001c4 complete (all the minimal harness). No safety failures, no regressions, nothing newly passing. Part 10 of M0-21, PR #190, merged at 104ae31; CI x64 7:08, arm64 0:56.
- Worked on: M0-22 part 1 (tracking issue #191): the owner-state manifest. M0-22's `depends_on` names M0-21, but M0-21's device checks run only once run.sh starts the app, which is M0-22; the parts that start the app are done now as M0-21's remaining run.sh step, and M0-22 passes only after M0-21.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/ownerstate.py` (Python standard library): `snapshot` walks every covered root by lstat (path, type, size, mtime, SHA-256 up to `HASH_LIMIT`; links recorded with their target, never followed), `compare` lists added, removed and changed paths, `backup` copies the emulator config files with an index, `restore` puts back any that changed or went, never through a link, and reports them. CLI `snapshot`, `compare` (exit 1 on a difference), `backup`, `restore` (exit 1 when anything was restored).
  - `test/device/owner-state.json`: what is covered (stock RomMix's and the owner's Galleon config and saves, with their root pointers; every emulator folder in DEVICE-FACTS.md; Steam's `shortcuts.vdf` files) and the config files backed up.
  - Tests: `test/device/test_ownerstate.py` 19/19: equal snapshots; covered and uncovered paths; added, removed, changed, touched-only; a new `shortcuts.vdf`; links not followed, except a covered folder that is itself a link, which is read through; large files unhashed; a relocated root through its pointer, a relative or unreadable pointer; backup and restore of a changed and a removed config; a restored config still fails the comparison taken before it; no write through a linked file or folder, nor to an index key outside the home; the CLI round trip; the shipped spec stays relative to the home.
  - `scripts/device-bundle.mjs` leaves the helpers' tests out of the bundle; `scripts/device-bundle.test.ts` checks `ownerstate.py` and `owner-state.json` are in it and no `test_` file is.
  - CI: `Device bundle helper tests` step in `build` (x64), and in `scripts/agent/check.sh`. `docs/TESTING.md` and CLAUDE.md's command table updated.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: FAIL, then fixed: a covered folder that was itself a link (an SD-card move) hid changes behind it; restore now also ignores index keys outside the home. Its notes for run.sh: Steam rewrites `shortcuts.vdf` when the test shortcut is added or launched, and relaunching the owner's Galleon touches its profile, so the step order must keep both out of the comparison's way; `ROMMIX_HOME` is not followed (only the pointer file).
- Device / acceptance: none until run.sh calls it (the run part of M0-22).
- Next: M0-22 part 2, the read-only sign-in import and the test home.

## 2026-10-13 00:50 UTC session 01H3vg7VG7BqxFWzp227K8Yj (hourly heartbeat, second unit)

- Device results: nothing new since the entry above. Part 1 of M0-22, PR #192, merged at d83f7dd; CI x64 6:54, arm64 0:50.
- Worked on: M0-22 part 2 (tracking issue #191): the test home and its read-only sign-in import.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/signin.py` (Python standard library): `find_signin` takes, first found, the bridge's `pair-readonly` token, the owner's Galleon, stock RomMix (root pointer, `ROMMIX_HOME`, else the default folder; never `GALLEON_HOME`, which is the test home's). Only a `RAW1` store with a server is used; only its client or access token is kept, the refresh token and device id are dropped. `fresh_home` empties and remakes `<test dir>/home`, refusing a `home` that is a link. `write_test_home` writes `config/settings.json` (save sync off both ways, empty device id, setup done, the server) and `config/credentials.bin` (`RAW1`, mode 0600). CLI `prepare --test-dir DIR [--token-file FILE]` prints the source by kind only and exits 0, or 10 with `no-importable-credentials` (the home still made, with no server).
  - Tests: `test/device/test_signin.py` 15/15: RomMix imported without refresh token or device id; the bridge token first; a broken or missing token file falls through; Galleon before RomMix; pointer and `ROMMIX_HOME` followed; `GALLEON_HOME` not; encrypted, token-less and server-less stores passed over; a missing auth mode; the home emptied each time; a linked home refused with its target untouched; the written settings and private credentials, with no token or address in the printed line; the skip; the owner's files unchanged (by `ownerstate` snapshot). All helper tests 32/32.
  - `scripts/device-bundle.test.ts`: `signin.py` is in the bundle. `docs/TESTING.md`: a paragraph on the test home and the import.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none until run.sh calls it.
- Next: M0-22 part 3, the Steam test shortcut, `launch.sh` and `current.json`.

## 2026-10-13 00:57 UTC session 01H3vg7VG7BqxFWzp227K8Yj (hourly heartbeat, third unit)

- Device results: nothing new. Part 2 of M0-22, PR #193, merged at fe448a6; CI x64 6:46, arm64 1:05. Its evaluator: PASS, with notes for run.sh: an authMode present but invalid is copied as is; a password-mode token cannot refresh under the guard, so long server checks may meet 401s; "play sessions off, the guard on" come from the self-test request and guard; run.sh should check the test dir lies under `GALLEON_TEST_ROOT`.
- Worked on: M0-22 part 3a (tracking issue #191): finding the test shortcut in `shortcuts.vdf`.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/shortcuts.py` (Python standard library): a binary VDF reader (maps, strings, int32 and the fixed-width types; anything else, truncation or deep nesting raises `VdfError`), `find` (the first shortcut with the name, `AppName` or `appname`, in any user's file; an unreadable file is passed over; appid returned unsigned), `gameid` (unsigned appid high, `0x02000000` low). CLI `find [NAME]`, `gameid APPID`. Read only.
  - Tests: `test/device/test_shortcuts.py` 9/9: field types; a negative stored appid; the lowercase key; several users with a broken file; nothing found or no appid; malformed data refused; game id arithmetic; the file unchanged; the CLI. All helper tests 41/41.
  - `scripts/device-bundle.test.ts`: `shortcuts.py` is in the bundle. `docs/TESTING.md`: a paragraph.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none until run.sh calls it.
- Next: M0-22 part 3b, adding the shortcut through Steam's CEF debugger, `launch.sh` and `current.json`.

## 2026-10-13 01:26 UTC session 01FEpH9AZJTA5nwBaJmeYwoT (hourly heartbeat)

- Device results: nothing new since 2d001c4 (complete, the minimal harness); no safety failures, no regressions; bridge last skip "no new nightly". Part 3a of M0-22, PR #194, merged at 8e80a37; CI x64 6:57, arm64 0:54.
- Worked on: M0-22 part 3b (tracking issue #191): the Steam CEF client that adds the test shortcut and starts it.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/steamcef.py` (Python standard library): finds Steam's shared JavaScript context in the debugger's page list (either of its titles), speaks just enough WebSocket for one `Runtime.evaluate` (masked text frames, fragments, pings answered, events skipped, a reply size cap), loopback addresses only and no proxy. `add_shortcut` (`SteamClient.Apps.AddShortcut` with JSON-quoted arguments, then `SetShortcutName` and `SetShortcutLaunchOptions` when present; appid unsigned), `run_game` (`SteamClient.Apps.RunGame(gameid, "", -1, 100)`), `ensure` (the `shortcut.json` record, unless Steam has saved `shortcuts.vdf` since and left its appid out; else the entry by name in `shortcuts.vdf`; else added through Steam; Armada's game launcher as launch options when present; the record written atomically, never through a link). CLI `ensure --test-root DIR`, `run GAMEID`; both exit 10 with `steam-cef-unavailable`. `shortcuts.vdf` is only read.
  - Tests: `test/device/test_steamcef.py` 19/19 against a fake CEF endpoint (page list over HTTP, an event, a ping and a fragmented reply over the WebSocket): added and recorded; Armada's launcher; a quoting-hostile name stays one string; record reused without Steam; found by name in `shortcuts.vdf`; a record Steam has dropped replaced; a record newer than the file, or listed in it, trusted; broken or foreign records ignored; no write through a link; `shortcuts.vdf` unchanged; the newer context title; no debugger or no shared context unavailable; non-loopback refused; a call that throws or returns no appid; RunGame's arguments; the CLI and its skip. All helper tests 60/60.
  - `scripts/device-bundle.test.ts`: `steamcef.py` is in the bundle. `docs/TESTING.md`: a paragraph.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR). The first x64 run failed only the PR-body check (no `Feature:` line in the body); the body was fixed and this line pushed to run it again.
- Evaluator: PASS. Its notes for run.sh: the owner-state snapshot covers `shortcuts.vdf`, so on a device without the shortcut `ensure` must run before the snapshot (or the docs must settle that one entry), never by weakening the check; a record is trusted while Steam has not saved the file since, so a start that neither `steam://` nor RunGame marks must fail `harness.run` with a clear reason; an AddShortcut reply that times out reads as `steam-cef-unavailable` though the shortcut may exist (the next run finds it by name).
- Device / acceptance: none until run.sh calls it.
- Next: M0-22 part 3c, `launch.sh` and `current.json`; then run.sh itself.

## 2026-10-13 01:52 UTC session 01FEpH9AZJTA5nwBaJmeYwoT (hourly heartbeat, second unit)

- Device results: nothing new. Part 3b of M0-22, PR #195, merged at 23316f9; CI x64 7:02, arm64 0:52 (on the second push; the first failed only the PR-body check, fixed by adding the `Feature:` line).
- Worked on: M0-22 part 3c (tracking issue #191): `launch.sh`, the test shortcut's executable, and its request `current.json`.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/current.py` (Python standard library): `write` (AppImage, home, results, sha, an expiry at the end of the budget; mode 0600, atomic, never through a link), `check` (refuses a missing, linked, unreadable or expired record, a bad field or sha, an AppImage that is not an executable file, and a home that is missing, a link, or not strictly inside the test root), `remove`. CLI `write`, `check` (prints the AppImage and the home, one per line), `remove`.
  - `test/device/launch.sh` (POSIX sh): copied by run.sh with `current.py` into `$GALLEON_TEST_ROOT`; starts nothing without a sound, current request (exit 0); takes `$GALLEON_HOME/launch/` with an atomic `mkdir` so the `steam://` start and the CEF fallback start the app once; records `launch.pid`, `started`, `app.pid`, `app.log` and `exit`; starts the AppImage with `GALLEON_HOME`; passes TERM, INT and HUP on to the app's pid only, and exits with its code.
  - Tests: `test/device/test_launch.py` 13/13: launch.sh against a fake AppImage (no request, expired, current: started in the test home with its state and exit code; a second route does not start it again; a home outside the test root refused; a stop reaches the app) and `current.py` (private with its expiry; each refusal; the test root itself no home; a home linked outside; missing, unreadable, linked records; a boolean expiry; the CLI). All helper tests 73/73.
  - CI: `Device shell scripts (shellcheck)` step in `build` (x64) and in `scripts/agent/check.sh`; run.sh's one warning (SC1007) fixed. `scripts/device-bundle.test.ts`: `launch.sh` and `current.py` are in the bundle. `docs/TESTING.md`: a paragraph.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: PASS. Its note is fixed: the stop trap is set before the app starts, so a stop arriving in between is passed on once the pid is known.
- Device / acceptance: none until run.sh calls it.
- Next: M0-22 part 4, run.sh itself (in pieces): the session environment and preconditions, the snapshot after the shortcut is ensured, the request, the start and the handshake, the restore.

## 2026-10-13 02:26 UTC session 01UVchUjrUmCzj4sAryMHNNE (hourly heartbeat)

- Device results: five results since 7f8e113, newest 2d001c4 (complete, the minimal harness); no safety failures, no regressions, nothing newly passing; bridge last skip "no new nightly". Part 3c of M0-22, PR #196, merged at 94522ad; CI x64 6:24, arm64 0:57.
- Worked on: M0-22 part 4a (tracking issue #191): run.sh takes the desktop session's variables and repeats the preconditions.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/session.py` (Python standard library): `env` prints `export KEY='value'` for `DISPLAY`, `XAUTHORITY`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR` and `GAMESCOPE_WAYLAND_DISPLAY` from `systemctl --user show-environment`, gaps filled from this user's exact-named `steam` process (`/proc/<pid>/environ`, never a command-line match); escaped values are not trusted. `check` uses the bridge's own `session_active`, `busy_names` and `galleon_idle_state` (imported from the bundle's `bridge/`, or `tools/device-bridge/` in the repo) and a free-space floor for the test home; prints `ready`, or the reason and exits 10.
  - `test/device/run.sh`: evaluates `session.py env`, then runs `session.py check`; a failed check writes a `skipped` summary with the reason and exits 10; a check that cannot run fails `harness.run`. The minimal harness is otherwise unchanged.
  - Tests: `test/device/test_session.py` 13/13 (manager keys and escaped values; no manager; exact-named `steam` only, this user's only; manager wins, steam fills gaps; the printed assignments read back unchanged by the shell; ready, Game Mode off, playing, idle Galleon, low space, the skip exit code equals the bridge's). `scripts/device-bundle.test.ts`: every run.sh test runs with a fake user manager; new test "run.sh skips, with the reason, when Game Mode is not running"; `session.py` is in the bundle. All helper tests 85/85. `docs/TESTING.md`: a paragraph.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly exercises the import and the checks; a skip there would show as a `skipped` result with its reason.
- Next: M0-22 part 4b: the owner-state snapshot after the shortcut is ensured, and the restore and comparison (`safety.owner-state`).

## 2026-10-13 02:43 UTC session 01UVchUjrUmCzj4sAryMHNNE (hourly heartbeat, second unit)

- Device results: nothing new. Part 4a of M0-22, PR #197, merged at d0d23e0; CI x64 6:54, arm64 1:02.
- Worked on: M0-22 part 4b (tracking issue #191): run.sh holds the owner state and reports `safety.owner-state`.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/run.sh`: after the session checks, `ownerstate.py snapshot` and `backup` into `$GALLEON_TEST_DIR/owner-state/` (now required from the bridge); at the end the second snapshot, the comparison, then the restore; `safety.owner-state` passes only with no difference and nothing restored. A manifest that cannot be taken makes the check `skip` and fails `harness.run`. Only `logs/owner-state.txt` (the changes and restores) is published. `--cleanup` restores from a backup a stopped run left.
  - `test/device/ownerstate.py`: any failure other than a difference exits `ERROR_EXIT` (3), so run.sh never reads a crash as a change; test `test_a_failure_is_told_apart_from_a_difference`.
  - Evaluator: FAIL, then fixed. A detected change followed by a failed restore read as `skip` / "could not be taken". Now a change is `fail` whatever the restore did, a failed restore is `fail` ("could not be restored"), and `skip` is kept for a missing manifest. Both branches now have tests. Its second round found the same masking when the second manifest fails after a config was put back; a restore now outranks a missing manifest, with a test. The backup is deleted once restored, so a late `--cleanup` cannot put back a stale config. `--cleanup` exits 1 when its restore fails. The header comments are updated.
  - The run.sh tests read processes from the fake facts root (`GALLEON_FACTS_ROOT/proc`), so a process with a busy name elsewhere on the machine cannot make them skip. A check.sh run during evaluation failed that way.
  - `scripts/device-bundle.test.ts` (17/17): "run.sh holds the owner state, and keeps the manifest off the results"; "run.sh fails safety.owner-state when an emulator rewrites its config, and puts it back" (the fake `armada-power` rewrites a config from `owner-state.json` in the fake HOME mid-run: the check fails, the file is back, the log names it changed and restored); "run.sh fails safety.owner-state when the run changed a config it then cannot restore"; "... when a config was put back though the second manifest failed"; "run.sh skips safety.owner-state and fails harness.run when no manifest can be taken"; "run.sh --cleanup puts back a config from the backup a stopped run left". All helper tests 86/86. `docs/TESTING.md` updated.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly reports `safety.owner-state` for the first time; with the minimal harness nothing it starts can touch the covered files, so a failure there would point at the owner's own processes (Steam rewriting `shortcuts.vdf`, say) and is to be understood before more feature work.
- Next: M0-22 part 4c: the test home, sign-in import and the shortcut ensure wired into run.sh (the shortcut before the first snapshot, per the evaluator's note on #195).

## 2026-10-13 03:27 UTC session 018MoGn8eG92WfjEcpYG7Mtm (hourly heartbeat)

- Device results: nothing new since 2d001c4 (complete, the minimal harness); no safety failures, no regressions; bridge last skip "no new nightly". Part 4b of M0-22, PR #198, merged at 1003a8e.
- Worked on: M0-22 part 4c (tracking issue #191): run.sh ensures the test shortcut before the owner-state manifest, and makes the test home with its read-only sign-in.
- Result: PR #199. M0-22 stays false.
- Evidence:
  - `test/device/run.sh`: copies `launch.sh` and `current.py` into `$GALLEON_TEST_ROOT` (renamed into place, never written through a link); `steamcef.py ensure --saved-within` before the first manifest, skipping with `steam-cef-unavailable` or `steam-shortcut-unsaved`, other failures failing `harness.run`; after the manifest `signin.py prepare` makes `$GALLEON_TEST_DIR/home`, exported as `GALLEON_HOME`; the notes say `sign-in: <kind>` or `sign-in: no-importable-credentials`, and the log keeps only the kind. `GALLEON_TEST_ROOT` is required.
  - `test/device/steamcef.py`: `listed`, `wait_listed`, `ensure --saved-within`: the manifest is taken only once Steam lists the shortcut with its name (and, when this run added it, its launch options), so a later save of the run's own shortcut cannot land inside the run.
  - Tests: `test_steamcef.py` 23/23 (the wait, an entry saved before its rename or launch options, an unreadable listing, the CLI skip); `scripts/device-bundle.test.ts` 21/21 (executable copied over a link, shortcut found in `shortcuts.vdf`, the skip before any manifest or home, a test home without sync, stock RomMix's sign-in copied without its refresh token or device id and left unchanged). All helper tests 90/90.
  - `docs/PLAN.md` 5.3 (steps 2 and 6) and `docs/TESTING.md`: the shortcut comes before the snapshot, and why.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: FAIL, then fixed: no PROGRESS entry, PLAN.md 5.3 still put the snapshot before the shortcut; its notes (a rename saved after the first listing; the test-home path in the log) are fixed too.
- Device / acceptance: the next nightly adds the shortcut through Steam, or finds it; a first run may skip with `steam-shortcut-unsaved` and the next one goes on. Known for the start piece: starting the shortcut makes Steam rewrite its `LastPlayTime` in `shortcuts.vdf`, so `safety.owner-state` must then tell the test shortcut's own entry apart from the owner's, without weakening the check for any other entry.
- Next: M0-22 part 4d: `current.json`, the start through `steam://rungameid/` with the RunGame fallback, and the failing `harness.run` when neither marks the start.

## 2026-10-13 03:50 UTC session 018MoGn8eG92WfjEcpYG7Mtm (hourly heartbeat, second unit)

- Device results: nothing new. Part 4c of M0-22, PR #199, merged at c1fd7ec; CI x64 6:35, arm64 0:53 (on the second push; the first failed only the PROGRESS check, fixed with the entry).
- Worked on: M0-22 part 4d-1 (tracking issue #191): run.sh writes the launch request and removes it.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/run.sh`: the budget's deadline is counted from run.sh's start (`DEVICE_TEST_BUDGET_SECONDS`); after the test home, `current.py write` names the AppImage, the test home, the results folder and the sha, expiring at that deadline; after the owner-state comparison and restore, `current.py remove`. A request that cannot be written or removed fails `harness.run`. `--cleanup` removes a request a stopped run left.
  - `scripts/device-bundle.test.ts` 25/25; new: "run.sh writes the launch request for this build while it runs, and removes it" (seen mid-run through the fake `armada-power`: this build, the test home, private, expiring with the budget; gone afterwards, and `launch.sh` started by hand then starts nothing), "run.sh --cleanup removes the launch request a stopped run left", "run.sh --cleanup still puts back a config when the launch request cannot be removed", "run.sh writes no launch request and fails harness.run when it cannot be written".
  - Evaluator: FAIL, then fixed: `--cleanup` exited on a failed request removal before restoring the emulator configs. Both steps now run every time, and it exits 1 if either failed. As it also suggested, the request is now written only once the shortcut and the owner state are held.
  - `docs/TESTING.md`: a sentence.
  - `scripts/agent/check.sh` green.
- Evaluator note carried from #199: if the owner renamed the test shortcut, each run would skip with `steam-shortcut-unsaved`; watch for repeated skips with that reason.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly writes and removes the request; nothing starts it yet.
- Next: M0-22 part 4d-2: the start through `steam://rungameid/` with the RunGame fallback, `harness.run` failing when neither marks the start, and the test shortcut's own `LastPlayTime` told apart in `safety.owner-state` without weakening the check for any other entry.

## 2026-10-13 04:27 UTC session 01SrbwrtKnx3nZrebANiPQ6H (hourly heartbeat)

- Device results: nothing new since 2d001c4 (complete, the minimal harness); no safety failures, no regressions; bridge last skip "no new nightly". Part 4d-1 of M0-22, PR #200, merged at fffcec4; CI x64 6:55, arm64 1:03.
- Worked on: M0-22 part 4d-2 (tracking issue #191): `safety.owner-state` leaves out the test shortcut's own `LastPlayTime`, so the start through Steam (next part) cannot fail it by itself.
- Result: PR #201. M0-22 stays false.
- Evidence:
  - `test/device/shortcuts.py`: `play_time_spans` gives the offset of the `LastPlayTime` int32 of each shortcut named 'Galleon Device Test' (the VDF reader records fixed fields' offsets when asked).
  - `test/device/ownerstate.py`: for the files in the spec's new `shortcutLists` (Steam's `shortcuts.vdf`), the entry drops the modification time and hashes the file with only those bytes zeroed. A file that is not binary VDF, too large, or a link keeps the strict entry.
  - Tests: `test_ownerstate.py` "the test shortcut's play time is the one change left out" (a later save with a new play time compares equal; the owner's play time, the test shortcut's Exe, an added shortcut and a removed one each still differ), "a shortcut list that is not VDF is compared strictly", "a shortcut list that is a link is never read through", "the real spec masks only shortcut lists it covers"; `test_shortcuts.py` "play time spans point at the test shortcut's play time only". All helper tests 95/95. `docs/TESTING.md`: a paragraph.
  - Started on its own rather than with the start: starting the app needs the mute, the self-test request and the stop (PLAN.md 5.3 steps 7 to 9) in the same PR, so it is not wired in yet.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly's `safety.owner-state` uses the masked entry; nothing starts the shortcut yet, so it should still pass.
- Next: M0-22 part 4d-3: the start through `steam://rungameid/` with the RunGame fallback, with the audio muted and restored, the self-test request, and the stop at the budget's end; `harness.run` fails when neither route marks the start.

## 2026-10-13 04:55 UTC session 01SrbwrtKnx3nZrebANiPQ6H (hourly heartbeat, second unit)

- Device results: nothing new. Part 4d-2 of M0-22, PR #201, merged at de0722a; CI x64 7:24, arm64 1:00. That PR's first x64 leg failed only the PR-body check (no `Feature:` line); the body was fixed and a docs commit pushed, since a re-run reuses the old body.
- Worked on: M0-22 part 4d-3a (tracking issue #191): `audio.py`, the mute before a run and the restore after it (PLAN.md 5.3 steps 8 and 11; acceptance line 5's audio half).
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/audio.py` (Python standard library): `mute --state FILE` resolves `@DEFAULT_AUDIO_SINK@` to its node id (`wpctl inspect`), records id, volume and mute (`wpctl get-volume`) in a private file, then mutes that id; a record already there is kept. `restore` sets the recorded id's volume and mute back and removes the record. Failures exit 3 and keep the record.
  - Tests: `test/device/test_audio.py` 10/10 against a fake `wpctl` (mute and put back, including a volume changed during the run; an owner who had muted stays muted; the restore reaches the recorded sink after the default changed; a stopped run's record kept; nothing to restore; WirePlumber failing, missing or answering unexpectedly; a record it did not write refused and kept; a failed restore keeps the record). `docs/TESTING.md`: a paragraph.
  - Not wired into run.sh yet: the mute belongs with the start (part 4d-3b), and nothing starts yet.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: nothing changes on the device until run.sh calls it.
- Next: M0-22 part 4d-3b: run.sh mutes (refusing to start when it cannot), starts the shortcut through `steam://rungameid/` with the RunGame fallback, stops at the budget's end, and restores the sound in the run and in `--cleanup`.

## 2026-10-13 05:27 UTC session 01UJF4noK6S1hm1oCFg1RK56 (hourly heartbeat)

- Device results: the earlier entries named these by short commit, which `device-results.mjs` does not match, so they are recorded here in full:
  - DEVICE-RESULTS 7f8e11382c5977e01755a145daac336ee41164bc complete
  - DEVICE-RESULTS 9f95acac4c6335c890e1057f01a080082c2c6f58 complete
  - DEVICE-RESULTS dffeebe1288cea2931dca16b9be24c8fe16dcbbf complete
  - DEVICE-RESULTS 791c3147fd80b14589d10aaa226ec7e45eaa5834 complete
  - DEVICE-RESULTS 2d001c46632e5aad9324c051dbf362cef84c496e complete
  - DEVICE-RESULTS fffcec42fb51eaac69dfa2603f1e167d1e7679c2 complete
  - DEVICE-RESULTS de0722a332d9678bf92ccf3fb16525aa8904a7ff complete
  - No safety failures, no regressions, no reports. fffcec4 and de0722a are the first runs with the test shortcut held (found by record) and the read-only sign-in (`rommix`); `safety.owner-state` passed on both, de0722a with the masked play time. Part 4d-3a of M0-22, PR #202, merged at 30d9fee.
- Worked on: M0-22 part 4d-3b (tracking issue #191): run.sh mutes the default sink once the launch request is written and puts it back before the second owner-state manifest; `--cleanup` puts back what a stopped run left muted.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/run.sh`: `audio.py mute --state $GALLEON_TEST_ROOT/audio.json` after the request; `audio.py restore` before the second manifest and in `--cleanup` (exit 1 when it fails, the other cleanup steps still run). A failed restore fails `harness.run` ("the sound could not be put back as it was") and keeps the record; the summary notes `audio: muted and put back`, `not muted` or `muted, not put back`. Nothing starts yet, so a failed mute is only a note; the start (next part) waits on it.
  - `test/device/audio.py`: `restore` sets the volume only when it differs from the record, since `get-volume` rounds (the evaluator's note on #202).
  - Tests: `test_audio.py` 12/12 (new: "a volume the run left alone is not set again", "a record for a sink that has gone fails and is kept"); `scripts/device-bundle.test.ts` 30/30 against a fake `wpctl` (new: "run.sh mutes the sound while it runs and puts it back", "run.sh fails harness.run and keeps the record when the sound cannot be put back", "run.sh notes a mute that fails, with nothing started to play sound", "run.sh --cleanup puts back the sound a stopped run left muted", "run.sh --cleanup fails while the sound cannot be put back, and keeps the record"). `docs/TESTING.md`: the wiring.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly mutes and restores the Nova's sound for a few seconds; its notes say whether `wpctl` answered (DEVICE-FACTS.md does not yet confirm it is there).
- Next: M0-22 part 4d-3c: the self-test request, the start through `steam://rungameid/` with the RunGame fallback (only when muted), and the stop at the budget's end.

## 2026-10-13 05:50 UTC session 01UJF4noK6S1hm1oCFg1RK56 (hourly heartbeat, second unit)

- Device results: nothing new. Part 4d-3b of M0-22, PR #203, merged at 0adfb2d; CI x64 7:00, arm64 0:52.
- Worked on: M0-22 part 4d-3c-1 (tracking issue #191): `selftestrequest.py`, which writes the self-test request into the test home (PLAN.md 5.3 step 7, second half).
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/selftestrequest.py` (Python standard library): `write` builds the request in TESTING.md's schema, always with `readOnlyServer`, `privacy` and `abortOnInput` true and `fakeRomm` null. It refuses what the app's `parseRequest` would refuse (exit 3, nothing written), and writes privately, renamed into place, only into a home that is a real folder. `remove` takes the request and the app's taken copy.
  - Tests: `test/device/test_selftestrequest.py` 8/8 (the safeguards always asked for; no version leaves the field out; each refusal writes nothing; no check refused; a linked home never written through; a link at the request's path replaced, not followed; remove, never through a linked home). `scripts/device-bundle.test.ts` 31/31; new: "the self-test request the bundle writes is one the app takes as written" (the bundle's copy, through the app's own `parseRequest`, field for field). `docs/TESTING.md`: a paragraph.
  - Not wired into run.sh yet: which checks and payloads the first run asks for goes with the start.
  - Evaluator: PASS, with two notes, both addressed: TESTING.md now tells the refusals the app shares from the harness's own stricter ones (an empty check list, a saving payload without a payload, a handshake folder that is not absolute), and `remove` keeps to a home that is a real folder.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: nothing changes on the device until run.sh calls it.
- Next: M0-22 part 4d-3c-2: run.sh writes the request (the app's results in a folder of their own, merged in step 10), starts the shortcut through `steam://rungameid/` with the RunGame fallback only once muted, and stops at the budget's end. Evaluator notes from #203 still to do: reword the comment on the second manifest's ordering so it plainly means the config restore.

## 2026-10-13 10:26 UTC session 01EZtgjfEKBDMWAq1tkX1cxJ (hourly heartbeat)

- Device results: two new, no safety failures, no regressions, no reports. Part 4d-3c-1 of M0-22, PR #204, merged at ebf5100; CI x64 6:15, arm64 1:01.
  - DEVICE-RESULTS 0adfb2d332fd7c0bc4fb3f80f26be07b0d7cf8c4 complete
  - DEVICE-RESULTS ebf5100d9ca302579f49147690f4491e3b2245d5 complete
- Worked on: M0-22 part 4d-3c-2a (tracking issue #191): run.sh writes the app's self-test request into the test home before the launch request, and removes it after the run and in `--cleanup`.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/run.sh`: `selftestrequest.py write` once the home is made, with results in `RESULTS_DIR/app/`, the handshake folder `$GALLEON_TEST_DIR/handshake/` (made empty), sha and version from `build-info.json`, a budget of what is left less `STOP_RESERVE_SECONDS`, the checks the app has scenarios for that need no payload (`selftest.complete`, `build.identity`, `startup.cold`, `grid.scroll`, `server.heartbeat`, `download.small`, `update.verify`), both profiles and the three screenshots. The launch request is written only after it. A request that cannot be written fails `harness.run` ("the self-test request could not be written"); one that cannot be removed fails it with the launch request's reason. The comment on the second manifest now says "config restore" (the evaluator's note on #203).
  - Tests: `scripts/device-bundle.test.ts` new: "run.sh gives the app a self-test request it takes, and removes it" (the copy seen mid-run, through the app's own `parseRequest`), "run.sh writes no launch request and fails harness.run without a self-test request", "run.sh --cleanup removes the self-test request a stopped run left"; the bundle listing now names `audio.py` and `selftestrequest.py`. `docs/TESTING.md`: the wiring.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly writes and removes the request in the test home; nothing starts it yet.
- Next: M0-22 part 4d-3c-2b: start the shortcut through `steam://rungameid/` with the RunGame fallback only once muted, wait for launch.sh's mark, serve until the app's summary, its exit or the budget's end, then stop only the recorded pids.

## 2026-10-13 10:50 UTC session 01EZtgjfEKBDMWAq1tkX1cxJ (hourly heartbeat, second unit)

- Device results: nothing new. Part 4d-3c-2a of M0-22, PR #205, merged at 32c7607; CI x64 7:09, arm64 0:53.
- Worked on: M0-22 part 4d-3c-2b (tracking issue #191): run.sh starts the app through the test shortcut and stops it.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/run.sh`: only for this build, with both requests written and the sound muted, it runs `steam steam://rungameid/<gameid>` and waits `START_WAIT_SECONDS` for launch.sh's `started` mark, then tries `steamcef.py run` (RunGame) and waits again. Neither → `harness.run` fails "neither route started the app". A failed mute now starts nothing and fails `harness.run`; the Nova's runs show `wpctl` answering ("audio: muted and put back" on ebf5100). It waits for the app to quit until the app's budget plus one `STOP_WAIT_SECONDS`. Past that it writes `stop` into the handshake folder, then SIGTERMs the recorded `launch.pid`, which passes it on to the app, then SIGKILLs the recorded `app.pid` and `launch.pid`. No other process is signalled. Notes: `app: not started`, `exited <code>`, `stopped when asked`, `stopped by a signal` or `killed`. Header comments no longer say it starts nothing.
  - Evaluator round 1: FAIL. A start that run.sh had given up on could still happen late, with the request still valid and the sound already back on. Fixed: run.sh now withdraws `current.json` before restoring the sound. It then creates launch.sh's start folder itself, which shuts out any later start. If that folder already exists although no start was marked in time, run.sh stops the late start at once (`app: started late, ...`). New tests: "run.sh stops a start it gave up on that happens before the request is withdrawn" (it fails against the first version), and "a start Steam acts on after the run withdrew its request starts nothing". TESTING.md line 66 (the stale note about a failed mute) is fixed.
  - Tests (`scripts/device-bundle.test.ts`, 38/38, with a fake `steam` that runs launch.sh): "run.sh starts the app through steam://, muted, and waits for it to quit" (the game id, the sound off while the app runs, the test home), "run.sh fails harness.run when neither route starts the app", "run.sh asks an app past its budget to stop, then signals only the pids launch.sh recorded", "run.sh kills an app that ignores the stop, by its recorded pid", "run.sh fails harness.run and starts nothing when the sound cannot be muted". `docs/TESTING.md`: the start and the stop.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly is the first to start the app on the Nova, with the sound muted, through Steam. The app's results stay in `RESULTS_DIR/app/` until they are merged. Profile requests go unanswered, so the app records those profiles as `profile-not-set`.
- Next: M0-22 part 4d-3c-3. Set `status: partial` after a stop. Give the app an absolute deadline: the app counts its budget from its own start, so a start through the fallback shifts it later. Re-check the session just before the start. `--cleanup` should stop an app a killed run left running; until it does, `tools/device-bridge/README.md` claims more than run.sh does. That needs a guard against a pid reused after a reboot (record the boot id and the process start time in launch.sh), so it was left out of this part. Then serve the profile handshake, merge `RESULTS_DIR/app/summary.json` into the summary (exit 20 on `aborted-by-user`), and leave Steam at its library.

## 2026-10-13 11:26 UTC session 01CNArnLoJVfYU8wsowEi6UU (hourly heartbeat)

- Device results: nothing new. Part 4d-3c-2b of M0-22, PR #206, merged at 96a109c. The 10:26 entry recorded 0adfb2d's result under a mistyped sha; the result is:
  - DEVICE-RESULTS 0adfb2d367fb51530021141330d2826290e1625e complete
- Worked on: M0-22 part 4d-3c-3a (tracking issue #191): run.sh repeats the session check just before the start, and a run whose app was stopped at its budget's end is `partial` (PLAN.md 5.3 step 9).
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/run.sh`: `session.py check` again once both requests are written and the sound is muted. On a skip reason nothing starts, the setup is undone as after any run, and the summary is `skipped` with the reason (exit 10), carrying `harness.run` and `safety.owner-state`; a check that cannot run fails `harness.run`. When those checks did not all pass, the run is `partial` (exit 0) with the note `skipped before the start, reported for its failed checks: <reason>`, because the bridge publishes a skip only once per build and reason. An app stopped past its budget makes the run `partial`. `json_string` escapes both skip reasons.
  - Evaluator round 1: FAIL. A late skip's failed `safety.owner-state` could be lost to the bridge's once-per-reason skip publishing. Fixed as above; new test "a late skip whose owner-state check failed is published as partial, not as a skip" fails against the round-1 run.sh.
  - Tests: `scripts/device-bundle.test.ts` 42/42; new: "run.sh skips before the start when Game Mode ends after the setup, and undoes it" and the test above; the stop tests assert `partial`, the start test `complete`. `docs/TESTING.md`: the re-check and the statuses.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly re-checks the session just before starting the app; a stopped app now shows as `partial`.
- Next: M0-22 part 4d-3c-3b: an absolute deadline for the app (its budget counts from its own start, so a fallback start shifts it), `--cleanup` stopping an app a killed run left (guarded against a reused pid by the boot id and process start time recorded in launch.sh), the profile handshake, merging `RESULTS_DIR/app/summary.json` (exit 20 on `aborted-by-user`), and leaving Steam at its library.

## 2026-10-13 11:58 UTC session 01CNArnLoJVfYU8wsowEi6UU (hourly heartbeat, second unit)

- Device results: nothing new. Part 4d-3c-3a of M0-22, PR #207, merged at 4d5a1ce; CI x64 7:46, arm64 1:00.
- Worked on: M0-22 part 4d-3c-3b-1 (tracking issue #191): `run.sh --cleanup` stops an app that a killed run left running, signalling only processes launch.sh recorded on this boot.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/launched.py` (Python standard library). `record` writes `<name>.id` (pid, boot id, `/proc/<pid>/stat` start time) privately, before launch.sh writes each pid file. `stop` sends SIGTERM and then SIGKILL to the recorded app and launch.sh, each only while its boot id and start time still match. A pid with no record, a linked folder, or a zombie is left alone. It exits 1 while a recorded process survives both signals.
  - `test/device/launch.sh` records both pids, and run.sh copies `launched.py` into the test root beside it. `run.sh --cleanup` runs `launched.py stop` after withdrawing the launch request and before the sound comes back. `tools/device-bridge/README.md`'s claim that cleanup "knows how to stop Galleon" now holds.
  - Tests: `test/device/test_launched.py` 11/11, three runs each:
    - stops both
    - kills one that ignores TERM
    - leaves alone a pid with a different start time, a pid from another boot, a pid without its record, and a linked folder
    - reads past a name with spaces and parentheses
    - checks the record's mode through the CLI
  - `scripts/device-bundle.test.ts` new tests:
    - "run.sh --cleanup stops an app a killed run left running, before the sound comes back"
    - "run.sh --cleanup leaves alone a pid recorded on another boot"
    - the bundle listing and the test-root copies now include `launched.py`.
  - `docs/TESTING.md`: the record and the stop.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: from the next nightly, launch.sh writes `launch.id` and `app.id` beside its pid files.
- Next: M0-22 part 4d-3c-3b-2: give the app an absolute deadline (it counts its budget from its own start, so a fallback start shifts it), then the profile handshake, merging `RESULTS_DIR/app/summary.json` (exit 20 on `aborted-by-user`), and leaving Steam at its library.

## 2026-10-13 12:27 UTC session 01J1ecDscdibWphvBS3VMsSD (hourly heartbeat)

- Device results: nothing new (bridge last seen 08:03 UTC, "no new nightly"). Part 4d-3c-3b-1 of M0-22, PR #208, merged at 5701a17; CI x64 7:21, arm64 0:59.
- Worked on: M0-22 part 4d-3c-3b-2 (tracking issue #191): the app's self-test run ends by an absolute time run.sh gives it, so an app started late through the RunGame fallback still writes its summary before run.sh stops it.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `src/main/selftest.ts`: the request takes an optional `deadline` (ISO UTC); the run ends at whichever of it and `budgetSeconds` after the app's start comes first; a malformed one refuses the request as `request-deadline`.
  - `test/device/selftestrequest.py` `--deadline EPOCH_SECONDS`, written as a UTC time; `test/device/run.sh` passes the time it stops the app by (`deadline - STOP_RESERVE_SECONDS`).
  - Tests: `src/main/selftest.test.ts` "the deadline ends the run when it comes before the budget does", "a deadline after the budget ends changes nothing", four refused deadlines (one a 30 February, which `Date.parse` alone rolls into March); `test/device/test_selftestrequest.py` (written as UTC, left out when not given, `0` refused); `scripts/device-bundle.test.ts` (run.sh's request ends 400–600 s ahead; the writer's output parses through `parseRequest`). `docs/TESTING.md`: the field and the rule.
  - `scripts/agent/check.sh` green; `npm run test:app` 241/241 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
  - Evaluator round 1: FAIL only for this missing entry; noted that `Date.parse` takes a day past the month's end; `isIsoTime` now refuses one that does not read back the same.
- Notes: a stale `/var/run/docker.pid` again stopped `dockerd`; removed after checking its pid was not running.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: from the next nightly the request carries `deadline`.
- Next: M0-22 part 4d-3c-3b-3: serve the profile handshake, merge `RESULTS_DIR/app/summary.json` (exit 20 on `aborted-by-user`), and leave Steam at its library.

## 2026-10-13 13:28 UTC session 01BWGZuxDZ9MDnK743PyboSs (hourly heartbeat)

- Device results: nothing new (bridge last seen 08:03 UTC, "no new nightly"). Part 4d-3c-3b-2 of M0-22, PR #209, merged at 2c93b3b; CI x64 7:59, arm64 1:01.
- Worked on: M0-22 part 4d-3c-3b-3a (tracking issue #191): run.sh merges the app's `summary.json` into the run's (PLAN.md 5.3 step 10) and exits 20 when the player stopped the app.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/mergesummary.py` (Python standard library). The harness's summary is the base. The app's checks follow it, each held to the schema, with evidence moved under `app/`. An app summary that is missing, linked, too large, not JSON or for another commit is left out, and so is a check that breaks the schema or repeats a harness id; either makes the run `partial` with a note. The app's `aborted-by-user` makes the run `aborted-by-user` (exit 20) only while every harness check passed; otherwise the run is `partial`, so a failed `safety.owner-state` is never dropped by the bridge's retry of an aborted run.
  - `test/device/run.sh` writes its own summary to `$GALLEON_TEST_DIR/harness-summary.json` when the app started and merges it into `RESULTS_DIR/summary.json`; a merge that cannot run leaves the harness's summary as `partial`.
  - Tests: `test/device/test_mergesummary.py` 10/10; `scripts/device-bundle.test.ts` 46/46, new: "run.sh exits 20 when the player stopped the app, with the harness checks passing", "run.sh leaves out an app summary for another commit, and the run is partial"; the first summary test now carries the app's `selftest.complete` with `app/` evidence, and an app that writes no summary makes the run `partial`. `docs/TESTING.md`: the merge rules.
  - Evaluator: PASS with notes. The comment on the app's fields read backwards, and app `notes` that are not a list crashed the merge into its fallback, losing the app's checks. Both are fixed; new test "notes that are not a list are left out and the checks kept".
  - `scripts/agent/check.sh` green.
- Notes: the stale `/var/run/docker.pid` again stopped `dockerd`; removed after checking its pid was not running.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: from the next nightly, the app's checks appear in the published summary. Until the profile handshake is served, the app records its profiles as `profile-not-set`.
- Next: M0-22 part 4d-3c-3b-3b: serve the profile handshake through `armada-power` and restore the profile, then leave Steam at its library.

## 2026-10-13 14:26 UTC session 0129mDm6wWNQLZGc9sD57WvK (hourly heartbeat)

- Device results: nothing new (bridge last seen 08:03 UTC, "no new nightly"). Part 4d-3c-3b-3a of M0-22, PR #210, merged at 13d2075; CI x64 8:19, arm64 0:50.
- Worked on: M0-22 part 4d-3c-3b-3b (tracking issue #191): run.sh serves the app's profile handshake (PLAN.md 5.3 step 8) and puts the owner's power profile back (step 11).
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/powerprofile.py` (Python standard library). `record` keeps the profile in force (`armada-power profile`, its label matched to a name through the profile definitions) in `$GALLEON_TEST_ROOT/profile.json`, keeping a record already there. `answer` switches only to a profile the request names, only with a record to put back, and answers the name once `armada-power` names it and policy7's governor matches; anything else is `unchanged:<current>`. `restore` switches back when another profile is in force and keeps the record when it cannot.
  - `test/device/run.sh` records after the mute, serves requests while it waits on the app, and restores just before the sound; a failed restore fails `harness.run`. `run.sh --cleanup` restores a record a stopped run left.
  - Tests: `test/device/test_powerprofile.py` 19/19. `scripts/device-bundle.test.ts` new tests:
    - "run.sh switches to the profiles the app asks for, and only those"
    - "run.sh puts the owner's profile back after the app has quit on another"
    - "run.sh answers unchanged, and switches nothing, without armada-power"
    - "run.sh fails harness.run and keeps the record when the profile cannot be put back"
    - "run.sh --cleanup puts back the profile a stopped run left, and keeps it while it cannot"
  - `docs/TESTING.md`: the helper and the handshake's harness side.
  - Evaluator: PASS, with two notes. A hung daemon can make an answer later than the app's wait; the comment now says so, and the app checks the profile in force regardless. A label matching no definition is taken by its lowercased name, which the next nightly will show.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: from the next nightly, `grid.scroll@balanced` and `@performance` can be measured on the profile they name, and the owner's profile is put back after the run.
- Next: M0-22 part 4d-3c-3b-3c: leave Steam at its library after the run (PLAN.md 5.3 step 11).

## 2026-10-13 15:26 UTC session 01AkcoRrSXgxphjh3GbmVnH4 (hourly heartbeat)

- Device results: nothing new (bridge last seen 08:03 UTC, "no new nightly"). Part 4d-3c-3b-3b of M0-22, PR #211, merged at 0a61c3c; CI x64 8:17, arm64 1:00.
- Worked on: M0-22 part 4d-3c-3b-3c (tracking issue #191): once the app has run, run.sh leaves Steam at its library (PLAN.md 5.3 step 11), part of `harness.run`.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/steamcef.py library [--wait SECONDS]`: reads the route of Steam's Game Mode window (`Steam Big Picture Mode` or `SP`, address under `/routes`) from the debugger's page list, evaluating nothing; any `/library` screen but a game's page counts. Exit 0 at the library, 1 elsewhere, 10 with the windows it saw when there is none.
  - `test/device/run.sh`: after the app has run (a late start included), checks the screen; when not at the library, runs `steam steam://open/games` and waits `LIBRARY_WAIT_SECONDS`. Still elsewhere, or unreadable: `harness.run` fails with "Steam was not left at its library".
  - Tests: `test/device/test_steamcef.py` 29/29, new: "the screen is read from the game mode window's address", "no game mode window is unavailable and says what there was", "the library is its own screens not a game's page", "waits for steam to show its library", "a window list that comes back in time is waited for", "cli library". `scripts/device-bundle.test.ts` 52/52: every run now has a fake debugger window list driven by the fake Steam client (a started game puts it on the game's page); the steam:// start test asserts the run sent Steam back; new "run.sh fails harness.run when Steam stays on the game it started".
  - `docs/TESTING.md`: the step and its failure.
  - `scripts/agent/check.sh` green.
  - Evaluator round 1: FAIL. The failure detail listed every page's title and path, and the debugger's list also holds web pages whose addresses name the account (a SteamID64, a vanity name), which would reach the public results. It now names only the first two path parts of Steam's own UI pages (`steamloopback.host`), and a route outside `/library` only by its first part; the fake list carries a community profile page that a test keeps out. Notes left as they are: the step's worst case is not counted in `STOP_RESERVE_SECONDS` (the bridge's grace and `--cleanup` cover the restore), and a run where neither route started the app does not check the screen (it already fails `harness.run`).
- Notes: a stale `/run/docker/containerd/containerd.pid` (pid not running) stopped `dockerd`; removed.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the route and `steam://open/games` are unverified on the Nova; the next nightly's `logs/harness.log` shows the route Steam reports, or the paths its own windows show.
- Next: M0-22 part 4d-3c-3b-3d: stop an idle owner's Galleon through its core socket before the start and relaunch it after (PLAN.md 5.3 steps 8 and 11), once M1-17's socket exists; otherwise the remaining steps (payloads, `install.script`, `steam.shortcut-roundtrip`).

## 2026-10-13 16:26 UTC session 01FpAHTYe4k2qCA6rRYcJnmY (hourly heartbeat)

- Device results: nothing new (bridge last seen 08:03 UTC, "no new nightly"). Part 4d-3c-3b-3c of M0-22, PR #212, merged at 08ef102; CI x64 8:35, arm64 0:59.
- Worked on: M0-22 part 4e-1 (tracking issue #191): the device bundle carries the homebrew payloads (PLAN.md 5.3 step 5), so run.sh can copy them into the test home.
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `scripts/device-bundle.mjs --payloads <dir>`: copies every file `test/fixtures/roms/manifest.json` pins from the folder `fetch-fixtures.mjs` filled into `payloads/`, with the manifest's entries (`payloads/manifest.json`) and THIRD_PARTY.md's "Test payloads" part, licence text included (`payloads/THIRD_PARTY.md`). A payload that is missing, a link, or not the pinned bytes and size stops the build.
  - `release.yml` (x64 leg) and `nightly.yml` fetch the payloads by their pinned hashes before building the bundle. Locally: both gba-tests programs fetched and bundled; the notice holds the MIT text.
  - Tests in `scripts/device-bundle.test.ts`, new: "the bundle carries the pinned payloads, their manifest entries and licences" (unpacked with the bridge's `safe_extract`), "a payload that is missing, linked or not the pinned bytes builds no bundle", "the payload notices are THIRD_PARTY.md's test payloads part, licence text and all", "the real manifest's payloads all have their notice in THIRD_PARTY.md".
  - `scripts/agent/check.sh` green.
  - Evaluator: PASS with notes. The notices read to the end of THIRD_PARTY.md, taking in the fonts and ES-DE parts after it; "Test payloads" is now the file's last part and a test holds the notices to the payloads' own projects. `/device-payloads/` is ignored. Left as it is: the PR leg now fetches two small files from GitHub without a retry; a failed fetch is a `flaky` issue to root-cause, not a retry wrapper.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: from the next nightly the bundle holds `payloads/`; nothing on the device uses it yet.
- Next: M0-22 part 4e-2: run.sh copies `payloads/` into the test home, names them in the self-test request, and deletes them, with any downloaded ROM, before exit (test asserts the folder is empty).

## 2026-10-16 02:28 UTC session 01B3z1YWit6yDYhVB9bqoECW (hourly heartbeat)

- Device results: none new; bridge last seen 2026-10-13 08:03 UTC ("no new nightly"), although the nightlies of 10-14 and 10-15 succeeded.
- Worked on: Dependabot triage (CLAUDE.md rule 8, docs/MAINTENANCE.md).
- Result: merged #216 (lucide-react 1.52.0 -> 1.55.0, ISC) at d5997da, #217 (happy-dom 20.14.5 -> 21.0.1) at 723188b, #215 (tooling: @types/node 24.19.2, oxlint 1.87.0, prettier 3.9.10, release-it 21.1.1, vite 7.3.7) at 0899679. #214 (Electron 44.6.0 -> 44.7.0) held with one comment.
- Evidence: all four merged together locally onto 3e62b7c without conflicts; `scripts/agent/check.sh` green (coverage 96.96/94.61/96.39, licence guard: 7 production packages, all permitted); `npm run test:app` 241/241 (Electron through a `--no-sandbox` wrapper, as root). Lockfiles change only the named packages and release-it's own dev dependencies, all from registry.npmjs.org with matching integrity. happy-dom 21: the three DOM test files pass 44/44 under both versions with identical test names. docs/DEPENDENCIES.md records none of these versions.
- CI wall time: #214 x64 8:34, arm64 1:13; #215 8:43, 0:55; #216 8:54, 1:08; #217 8:42, 0:55.
- Evaluator: PASS for #215, #216, #217. FAIL for #214 on timing only: every device run so far checks only the minimal harness (`harness.run`, `safety.owner-state`), so 44.6.0 has no baseline that starts the app and MAINTENANCE.md step 6 could not catch a regression. #214 waits for a `complete` or `partial` run from a nightly built from 3e62b7c or later that carries the app's checks.
- Device / acceptance: none.
- Next: M0-22 part 4e-2 (run.sh copies `payloads/` into the test home, names them in the request, deletes them before exit). Then #214 once the first app-starting device run is in.
- Notes: the VM's `npx install-electron` failed once with an undici assertion; a retry fetched it. `test:app` without `ELECTRON_EXEC_PATH` tries to borrow Electron from nixpkgs as root, which is slow; use the `--no-sandbox` wrapper.

## 2026-10-16 02:49 UTC session 01FdFhjmLvPnWidC6Tawet9s (hourly heartbeat)

- Device results: nothing new (bridge last seen 2026-10-13 08:03 UTC, "no new nightly"); no safety failures, no regressions. Dependabot #215, #216 and #217 were merged and #214 (Electron) held by a concurrent session (PR #218), which took no `agent-working` claim; this run claimed #191 before it went on.
- Worked on: M0-22 part 4e-2 (tracking issue #191): run.sh copies the bundle's payloads into the test home, names RetroArch the GBA payload, and removes the ROM folder before exit (PLAN.md 5.3 steps 5 and 11; acceptance line 4's "deleted before exit").
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `test/device/payloads.py` (Python standard library): `copy --bundle DIR --home H` copies each `roms/<system>/<file>` entry of the bundle's `payloads/manifest.json` into the app's ROM folder, checked against its pinned size and hash, never through a link and never over an existing file; `remove --home H` takes the whole ROM folder (copies and downloads), never following a link.
  - `test/device/run.sh`: copies after the home is made; with `roms/gba/gba-tests hello.gba` copied, the request gets `retroarch` in `payloads` plus `launch.retroarch` and `exit.retroarch` (no save expected); a failed copy names none and fails `harness.run`; after the app has quit the ROM folder is removed, and `harness.run` fails if it remains; `--cleanup` removes one a stopped run left.
  - Tests: `test/device/test_payloads.py` 13/13. `scripts/device-bundle.test.ts` 61/61, new: "every payload run.sh names is one the real manifest pins", "run.sh copies the payloads into the test home, names RetroArch its own, and empties the ROM folder" (the folder held exactly the pinned hashes while the app ran; the app's downloaded ROM and the folder are gone after), "run.sh names no payload, and fails harness.run, when a payload is not the pinned bytes", "run.sh asks for no emulator check from a bundle without payloads", "run.sh --cleanup removes the ROMs a stopped run left in the test home". Not tested: a ROM folder that cannot be removed (the VM runs as root).
  - `docs/TESTING.md`: the helper and the request's emulator checks.
  - Evaluator: PASS. Its style note (an unwrapped header comment line in run.sh) is fixed.
  - `scripts/agent/check.sh` green.
- Notes: stale `/var/run/docker.pid` and `containerd.pid` (pids not running) stopped `dockerd` again; removed.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: on the Nova RetroArch is a flatpak, which the self-test's sandbox refuses, so `launch.retroarch` and `exit.retroarch` are expected as `skip` / `cannot-sandbox` until a sandboxable install exists.
- Next: M0-22 part 4e-3: the small-ROM download rule (smallest SNES and GBA titles, at most 16 MB, else a capped Range read), or `install.script` and `steam.shortcut-roundtrip`.

## 2026-10-16 04:27 UTC session 017XZLNA3MF8LELsDa9zW4ES (hourly heartbeat)

- Device results: nothing new (bridge last seen 2026-10-13 08:03 UTC, "no new nightly"); no safety failures, no regressions. Part 4e-2 of M0-22, PR #219, merged at 39afcb6; CI x64 8:20, arm64 0:57.
- Worked on: M0-22 part 4e-3 (tracking issue #191): the self-test's `download.small` fetches a whole title only up to `SMALL_GAME_MAX_BYTES` (PLAN.md 5.3 step 5; acceptance line 4's "at most 16 MB").
- Result: PR (this one). M0-22 stays false.
- Evidence:
  - `src/main/selftestdownload.ts`: the smallest hashed SNES or GBA title is judged by the size RomM lists before anything is queued; over the cap it is a `skip` (`smallest-title-too-large`, with its platform and size), and the check's `thresholds` carry `maxBytes`.
  - Tests in `src/main/selftestdownload.test.ts` 14/14, new: "a smallest title over the cap is a skip, and nothing is fetched" (empty queue, `romsDownloadedBytes` 0), "a title of exactly the cap is fetched".
  - `docs/TESTING.md`: the catalogue row says what happens over the cap.
  - `scripts/agent/check.sh` green; `npm run test:app` 241/241 (`--no-sandbox` wrapper).
- Notes: stale `/var/run/docker.pid` and `containerd.pid` stopped `dockerd` again; removed.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: on the Nova the check now either passes on a title of at most 16 MB or skips; the owner's library decides which.
- Next: M0-22 `install.script` and `steam.shortcut-roundtrip`, or stopping an idle owner's Galleon through its core socket once M1-17 exists.

## 2026-10-16 05:40 UTC session 01WNa5QTYzFctPzrXTKXtwUf (hourly heartbeat)

- Device results: nothing new (bridge last seen 2026-10-13 08:03 UTC, "no new nightly"); no safety failures, no regressions. Part 4e-3 of M0-22, PR #220, merged at ba4f7f1; CI x64 8:49, arm64 0:52.
- Worked on: M0-13 (tracking issue #57): its device checks reach the Nova. Every CI line was merged in #58, #59, #173 and #174; the remaining gap was run.sh starting the app with `build.identity`, `update.verify` and the nightly's `version` in its request, which M0-22's parts #205 to #220 closed. M0-22's own remaining lines (the owner's Galleon through M1-17's socket, `install.script` through M0-17) do not touch these checks.
- Result: PR (this one).
- Evidence:
  - Acceptance line 1: `release.yml` publishes `canary` with both AppImages, the Steam script and `SHA256SUMS`, tag last (#58). Line 2: `src/main/update.ts` refuses a mismatched image and keeps the running one (#58's unit tests). Line 3: footer and Settings -> About (#59). Lines 4 and 5: the `build.identity` and `update.verify` scenarios (#173, #174).
  - `scripts/device-bundle.test.ts` "run.sh gives the app a self-test request it takes, and removes it" now also requires `build.identity` and `update.verify` in the request run.sh writes; it already held `version` to the bundle's `build-info.json`.
  - `scripts/agent/check.sh` green.
- Evaluator: PASS. It checked all five acceptance lines against main, run.sh's version and both checks in the request, and this entry's PR numbers and CI times.
- Device / acceptance: READY-FOR-DEVICE M0-13. `update.verify` reads the live `canary` release from GitHub; `build.identity` compares against the nightly's `build-info.json`. Both need a `complete` or `partial` run with both safety checks passing.
- Next: Dependabot #214 (Electron) still waits for the first app-starting device run; M0-22's remaining lines wait on M1-17 and M0-17.
- Notes: the first x64 run failed `pr-body`: the PR body had no `Feature:` line. The body was fixed and this entry's evaluator line rode the next push, since a re-run reads the old body.

## 2026-10-16 06:27 UTC session 01UixAvXphFxZYY3MzZ8aiBX (hourly heartbeat)

- Device results: nothing new (bridge last seen 2026-10-13 08:03 UTC, "no new nightly"); no safety failures, no regressions. M0-13, PR #221, merged at 8b5b524 (CI times in its PR).
- Worked on: M1-17 part 1 (tracking issue #222), ahead of M1-11: nothing on `next.mjs`'s list can move without device results, and M0-22's last CI line (run.sh stops an idle owner's Galleon through its socket) waits on this socket. The core also outlives a UI fallback (PLAN.md section 9).
- Result: PR (this one). M1-17 stays false.
- Evidence:
  - `src/shared/types/coresocket.ts`: the socket's commands (`status`, `quit-emulator`, `pause-downloads`, `resume-downloads`, `quit-app`), request and response, the refusal reasons, and the schema-1 state file the bridge reads (`idle`, `steamAppId`, `updatedAt`).
  - `src/main/core-socket/protocol.ts`: `parseCoreRequest` never throws; a line is a request or `malformed`, `too-long` (over `MAX_LINE_BYTES`, in bytes) or `unknown-command`, with a readable id echoed. `src/main/core-socket/idlestate.ts`: `busyReason` (game, then download, then pending upload), `idleState`, `runtimeDir` (none without an absolute `XDG_RUNTIME_DIR`, no shared fallback) and `writeIdleState` (whole file through a rename, 0600 in a 0700 folder).
  - Tests: `protocol.test.ts` 11/11 (every command, ids, non-JSON, non-objects, bad ids, unknown commands, the byte cap), `idlestate.test.ts` 12/12 (one per idle and busy state, the reason's order, the file's modes, including over an existing folder and a leftover temporary file, replacement and path). `idlestate.ts` is on the save-tree allow-list.
  - `scripts/agent/check.sh` green.
- Evaluator: PASS. Its two notes are fixed: the `updatedAt` comment no longer claims the bridge reads it (the bridge reads the mtime), and the modes are set again over an existing folder or temporary file.
- Not yet: nothing serves the socket or writes the file; part 2 (socket, peer check, `status`, `quit-app`, the main process keeping the file current and never in self-test, `docs/core-socket.md`) and part 3 (`quit-emulator`, pause and resume).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: M1-17 part 2.

## 2026-10-16 07:01 UTC session 01UixAvXphFxZYY3MzZ8aiBX (hourly heartbeat, second unit)

- Device results: as at 06:27, nothing new. M1-17 part 1, PR #223, merged at 7492ed3; CI x64 8:36, arm64 0:51.
- Worked on: M1-17 part 2a (tracking issue #222): the socket listener, still not started by the app.
- Result: PR (this one). M1-17 stays false.
- Evidence:
  - `src/main/core-socket/server.ts`: `startCoreSocket(dir, handle)` listens on `core.sock` in `dir`, the socket 0600 and the folder 0700. It reads one request per line (split across writes or several per write; CR and blank lines tolerated) and answers in the order asked. A line longer than `MAX_LINE_BYTES` with no newline is answered `too-long` and the connection is closed. A handler that throws, or a result JSON cannot carry, is `failed` (new in `CoreRequestError`), and later requests on the connection are still answered. `close()` drops clients and the socket file goes. A dead socket file (connecting is refused: its listener was killed) is replaced; a live one, or one that fails to connect any other way, or anything that is not a socket, is left alone and refused with `CoreSocketInUseError`.
  - Tests: `server.test.ts` 12/12 over a real Unix socket, the dead socket from a child process killed with SIGKILL. `server.ts` is on the save-tree allow-list (it removes only a dead socket file).
  - `scripts/agent/check.sh` green.
- Evaluator: FAIL, then PASS (see the PR). Blocking: a result `JSON.stringify` throws on (a BigInt) rejected the client's answer chain, leaving that request and every later one unanswered, plus an unhandled rejection. Fixed by encoding inside the handler's try and catching on the chain, with a test that failed before the fix. Its note on the stale check is taken too: only ECONNREFUSED counts as dead.
- Not yet: the peer check (line 2's SO_PEERCRED), `status` and `quit-app` handlers, the app starting the socket and keeping `state.json` current (never in self-test), `docs/core-socket.md`; then part 3.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: M1-17 part 2b.

## 2026-10-16 07:27 UTC session 01WebgG47ESJSPjNTKSzausT (hourly heartbeat)

- Device results: nothing new (bridge last seen 2026-10-13 08:03 UTC, "no new nightly"); no safety failures, no regressions. M1-17 part 2a, PR #224, merged at ea8513b; CI x64 8:40, arm64 1:09.
- Worked on: M1-17 part 2b (tracking issue #222): `status` and `quit-app`, and the app starting the socket and keeping `state.json` current. The SO_PEERCRED check is split out: Node exposes no peer credentials, so it needs its own part.
- Result: PR (this one). M1-17 stays false.
- Evidence:
  - `src/main/core-socket/service.ts`: `coreHandler` answers `status` (connection, the game being played, the queue with progress, saves owed, `idle`, `busy`) and `quit-app` (refused with the `busyReason`, otherwise answered and then quit). `startCoreService` starts the socket first, so a second Galleon with another home gives up before touching the state file; it writes `state.json` at once, on a timer (`STATE_REFRESH_MS`, held under 30 s by a test) and when a download flips `idle`; `close()` removes the socket and the file (`removeIdleState`).
  - `RomMixApp.coreObservation()`; `src/main/index.ts` starts the service only on a normal start (never in self-test) and closes it after the shutdown.
  - `docs/core-socket.md`: the protocol, the errors, the idle rule and the state file.
  - Tests: `service.test.ts` 17/17 (each idle and busy state, `quit-app` refused for each reason and quitting only after the answer, the timer, refresh only on a flip, both commands over a real socket, removal on close, nothing written after it, a second instance), `app.test.ts` "the core socket sees the game, the live queue and the saves owed".
  - `scripts/agent/check.sh` green; `npm run test:app` 241/241 (`--no-sandbox` wrapper).
- Evaluator: PASS. Two of its notes are fixed: a closed service never writes again (a download finishing after the close could have left a fresh "idle" file), and a service that finishes starting after a quit began is closed at once. Its other notes stand as written: a game starting or a save being queued reaches the file on the next tick, and `quit-app` judges live; unsent saves do not hold Galleon busy with sending up switched off.
- Not yet: the peer check, `quit-emulator` through the same path as holding Start, pause and resume downloads.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: M1-17 part 3 (`quit-emulator`, pause and resume), then the peer check.

## 2026-10-21 17:15 UTC session 018eV6B3jCZaam87iG2XY4LE (hourly heartbeat)

- Device results: nothing new. The bridge was last seen 2026-10-21 08:42 UTC, skipping with "not on the charger" (12 such skips since the last run on 2026-10-13). The nightly waiting for it is fe32741. No safety failures, no regressions. M1-17 part 2b, PR #225, merged at fe32741.
- Worked on: M1-17 part 3 (tracking issue #222): `quit-emulator`, `pause-downloads` and `resume-downloads`.
- Result: PR (this one). M1-17 stays false: the SO_PEERCRED check is still to come.
- Evidence:
  - Acceptance line 3: `quit-emulator` calls `Launcher.stop()`, the same method the running screen's close button and held Start reach through `running:stop`. It is never forced and answers `{ stopping }`. `test/app/running.test.ts` "the core socket asks it to quit the way holding Start does, never by force": with a stand-in emulator that ignores being asked, the socket answers `stopping: true`, the app log says "stopping the running game" and never "forcing", and the overlay stays up. Passed under Xvfb, 5/5 in the file (`--no-sandbox` wrapper, as root).
  - `DownloadManager.pauseAll` pauses every queued or downloading row through `pause`. `resumePaused` re-enqueues paused rows in queue order, leaves stalled rows to `resumeAfterOutage`, and keeps a row the server no longer answers for paused. `downloads.test.ts` 75/75, three of them new.
  - `service.test.ts` 18/18: each command reaches its dependency and answers its count. `docs/core-socket.md` documents all three.
  - `scripts/agent/check.sh` green.
- Evaluator: PASS. Its one note (a transfer still stopping after `pause-downloads` is left out of an immediate `resume-downloads`) is documented in `docs/core-socket.md` rather than changed; the Downloads screen's buttons have the same window.
- Not yet: the peer check (SO_PEERCRED) on line 2.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: the M1-17 peer check.

## 2026-10-21 18:26 UTC session 01Ld2wR124kqNbb9VcHsWdj2 (hourly heartbeat)

- Device results: nothing new (bridge last seen 2026-10-21 08:42 UTC, "not on the charger"); no safety failures, no regressions. M1-17 part 3, PR #226, merged at f1a6a04.
- Worked on: M1-17's last acceptance line (tracking issue #222): the SO_PEERCRED peer check.
- Result: PR (this one). PASSES M1-17 (ci): lines 1, 3, 4 and 5 by #223-#226, line 2 here.
- Evidence:
  - `docs/decisions/0006-core-socket-peer-check.md`: Node has no getsockopt, so each accepted connection is paused and lent to the system `python3 -I -S` as a descriptor, which reads SO_PEERCRED and prints the user id. Nothing is bundled.
  - `src/main/core-socket/peercred.ts`: `peerUid` never throws; no Python, a failing, hanging (`PEER_CHECK_TIMEOUT_MS`) or garbled helper, or a socket already gone is `null`. The helper runs with `childEnvironment`.
  - `server.ts`: a connection is served only when its user is Galleon's own; anything else (root included, unknown, a check that throws) is closed before a byte is read, and a connection still being checked is dropped by `close()`.
  - Tests: `peercred.test.ts` 5/5 over a real socket (the kernel's answer, the connection usable after it, each failure); `server.test.ts` 17/17 (five new under "who may connect"); `service.test.ts` 18/18. `npm run test:app` 242/242 (`--no-sandbox` wrapper), the socket's own scenario included.
  - `docs/core-socket.md` says who may connect.
- Evaluator: PASS. Its note that a synchronous `spawn` failure reached the timer before it existed (so `peerUid` could reject) is fixed, with a test that failed first.
- Notes: Docker Hub answered 429 to init.sh's image pull; nothing in this unit needed RomM. `npx install-electron` hit the undici assertion once more; a retry fetched it.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: `next.mjs`; M1-17 is done.

## 2026-10-21 18:52 UTC session 01Ld2wR124kqNbb9VcHsWdj2 (hourly heartbeat, stop)

- M1-17 part 4, PR #227, merged at a784d51; CI x64 9:01, arm64 0:57. M1-17 passes (ci); #222 closed.
- Stopped: nothing eligible. M0-13 and M0-21 wait on device results (the bridge skips with "not on the charger"); M2-08 waits on M1-03 to M1-06, which wait on M0-22's device run; M4 waits on Gate 1; Electron #214 waits on a nightly device run. No `needs-human` issue is open.

## 2026-10-21 23:27 UTC session 01N9Y1Pkw2RtybHGspnsr9HP (hourly heartbeat)

- Device results: the bridge ran nightly 641fa89 (status complete).
  - DEVICE-RESULTS 641fa89dc2655b4830cb795b0217cf7441c74c46 complete
  - PASSES M0-13 device:641fa89dc2655b4830cb795b0217cf7441c74c46
  - Passing for the first time: `build.identity`, `update.verify`, `server.heartbeat`, `download.small`, `safety.server-readonly`, `safety.owner-state`. No safety failures.
  - Failing: `harness.run` ("Steam was not left at its library", M0-22), `startup.cold` (`home-not-reached`), `grid.scroll@performance` and `@balanced` (error, `grid-did-not-scroll`) and so `selftest.complete` (`checks-not-run`, M0-21). `launch.retroarch` and `exit.retroarch` skip with `cannot-sandbox`.
- Worked on: M0-22's `harness.run` failure (tracking issue #191).
- Cause: the harness log shows Steam's windows at `/routes/apprunning` and then, after `steam://open/games`, at `/routes/library`, but `steamcef.py screen` only read a window titled "Steam Big Picture Mode" or "SP", and the Nova's Game Mode window is titled neither. So Steam was at its library and the check could not see it.
- Result: PR (this one). `screen` still prefers the known titles; otherwise it reads the windows of Steam's UI host under `/routes` when they all show one route, and stays unavailable when they disagree. `docs/DEVICE-FACTS.md` records the title fact. M0-22 stays false until two consecutive nightlies pass both checks.
- Evaluator: PASS. Its note that the log proves every UI-host window showed one route, not that there was only one, is taken in DEVICE-FACTS.md.
- Evidence: `test_steamcef.py` "a game mode window under another title is read when it is the only one" (the device's case, `/apprunning` then `/library/home`, through `wait_library`) and "windows under another title that disagree leave the screen unknown"; both failed before the fix. `python3 -B -m unittest discover -s test/device` 178/178.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M0-22 (the next nightly reruns `harness.run`).
- Next: M0-21's `startup.cold` `home-not-reached` and the grid scroll that did not scroll.

## 2026-10-22 00:00 UTC session 01N9Y1Pkw2RtybHGspnsr9HP (hourly heartbeat, second unit)

- M0-22 `harness.run` fix, PR #229, merged at e24bb00. CI x64 8:03, arm64 0:52.
- Worked on: M0-21's failing device checks from run 641fa89 (tracking issue #155): `startup.cold` (`home-not-reached`), both `grid.scroll` checks (`grid-did-not-scroll`) and so `selftest.complete`.
- Cause: every screenshot of the run shows the one-off "Galleon has themes now" notice over the app, holding the focus. `signin.py` writes the test home with setup done and no notices dismissed, which looks like an installation from before themes. The `announce-themes` migration leaves such a folder alone, and it runs inside the catch-up, which the self-test holds back anyway. `test/app/driver.ts` `seed` always pre-dismisses the notice, so CI never saw it.
- Result: PR (this one). `RomMixApp.dismissNotices()` marks every key in `NOTICES` as seen. `index.ts` calls it in self-test mode beside `hideIdentity()`, before the window exists. The self-test home is always a separate GALLEON_HOME (`takeRequest` requires one).
- Evidence:
  - `test/app/selftest.test.ts` "a test home with no notices dismissed, as run.sh makes it, still reaches Home". With `index.ts` reverted the run never quit within 60 s; with the fix the file is 12/12.
  - `app.test.ts` "a self-test home has every notice dismissed, keeping what was already there".
  - `npm run test:app` 243/243 (`--no-sandbox` wrapper, as root). `scripts/agent/check.sh` green.
- Evaluator: PASS. Its note that the new app test's assertion was loose is taken: the test now requires a timed start and no error. The grid scroll's recovery is inferred from the same cause; the next nightly confirms it.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M0-21 (the next nightly reruns `startup.cold`, `grid.scroll@*` and `selftest.complete`).
- Next: the next nightly's results; `next.mjs`.

## 2026-10-22 00:30 UTC session 01Xxs9sG6hzrMqZuAYMiNzPr (hourly heartbeat)

- Device results: nothing new since 641fa89 (bridge last seen 2026-10-21 23:01 UTC, "not on the charger"); no safety failures, no regressions. PR #230 (M0-21 notices) merged at 9a35e1c before this run.
- Worked on: M0-17, one-line install and update (tracking issue #231). Eligible now that M0-13 passes.
- Result: PR (this one). PASSES M0-17 (ci).
  - `install.sh` at the root: `--stable` (default, `releases/latest/download/`) or `--nightly` (`releases/download/nightly/`), the direct download URLs, so no JSON parser is needed. Refuses a non-aarch64 machine without `--arch x86_64`, and any file whose sum is wrong or missing from `SHA256SUMS`. Downloads are staged in a temporary folder inside `~/Applications` and moved into place only after both verify, so a failed run leaves the installed copy untouched and nothing is written outside the two allowed folders. Writes `io.github.Rad-Thad.Galleon.desktop` (Exec = `galleon-steam.sh`, `Categories=Game;`) and its icon, `packaging/icon.svg` carried inside the script, beside it. The printed steps tick Galleon in Steam's list and never use Browse.
  - The whole script is one `main "$@"` call at the end, so a download cut short while piped into bash runs nothing.
- Evidence:
  - `test/install/install.test.ts` (`npm run test:install`) 9/9: run as `curl … | bash -s --` against a local fake of the release download URLs (with GitHub's `latest` redirect), a throw-away HOME, an empty TMPDIR that stays empty, a recording `sudo` that is never called, and a PATH of only bash, curl and coreutils. Files and modes, `desktop-file-validate`, an idempotent second run, the stable redirect, no stable release yet, the arch refusal, a tampered file, an unlisted file, a HOME holding `"$\`%\` characters.
  - That last test found a real bug first: `sha256sum` escapes its output line for a path with a backslash; the sum is now read from standard input.
  - `shellcheck install.sh` clean. CI: a new "Install script" step inside `build` (x64), after `desktop-file-utils` is installed with Xvfb. `scripts/agent/check.sh` runs the same two lines.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none here. The informational `install.script` device check is M0-22's run.sh step, now unblocked.
- Next: M0-22's `install.script` step, or `next.mjs`.

## 2026-10-22 01:27 UTC session 01XzS2BVW4PwXTAZvQKYcLAW (hourly heartbeat)

- Device results: the bridge ran nightly 4b4346b (status complete). No safety failures, no regressions.
  - DEVICE-RESULTS 4b4346b8ff522d746776761061ad3f163863900f complete
  - PASSES M0-21 device:4b4346b8ff522d746776761061ad3f163863900f
  - Passing for the first time: `startup.cold`, `selftest.complete` (the notices fix, #230, worked).
  - Failing: `harness.run` ("Steam was not left at its library", M0-22); `grid.scroll@performance` (p95 33.3 ms, 54.2% dropped, 120 Hz display) and `@balanced` (p95 50.2 ms, 86.1% dropped), both `over-threshold`: the scroll now runs and measures, and misses G1-4 / M4-04 / M4-34. `launch.retroarch` and `exit.retroarch` skip with `cannot-sandbox`.
- Worked on: M0-22's `harness.run` failure (tracking issue #191).
- Cause: the harness log shows the debugger answering `/apprunning` before `steam://open/games`, then `steam-cef-unavailable`, "no debugger: timed out". The page-list request after the command went unanswered for its whole 15 s timeout, which was longer than the 10 s library wait, so the wait ended on its first request and never asked again.
- Result: PR (this one). `steamcef.wait_library` gives each request at most what is left of the wait (at least `ANSWER_SECONDS`) and asks again on a new connection while time is left; when it gives up, the log says how many tries over how long. run.sh's library wait now covers a stalled request and a retry. DEVICE-FACTS.md records the stall; TESTING.md describes both the lone-window rule (from #229) and the retry.
- Evidence: `test_steamcef.py` "a debugger that stalls is asked again within the wait" and "no request outlasts the wait" (before the fix: a 1 s wait held 15.0 s by one stalled request, and no `timeout` to bound it); `python3 -B -m unittest discover -s test/device` 180/180; `scripts/agent/check.sh` green.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M0-22 (the next nightly reruns `harness.run`).
- Next: the grid scroll misses its frame-time thresholds on the device; Gate 1 (G1-4) depends on it.

## 2026-10-22 02:27 UTC session 01R9haBqnxPvNRScyDbqkdMt (hourly heartbeat)

- Device results: nothing new since 4b4346b (bridge last seen 2026-10-22 01:05 UTC, "not on the charger"); no safety failures, no regressions. PR #233 (M0-22 library wait) merged at 085436e; CI x64 8:52, arm64 1:13.
- Worked on: G1-4, the grid scroll that misses its thresholds on the Nova (tracking issue #234). Run 4b4346b: Performance p50 16.6 ms, p95 33.3 ms, 54.2% dropped at 120 Hz; Balanced p95 50.2 ms, 86.1%. The highlight visited only 40 and 60 of 1,292 games in 30 s, where CI visits about 200. The numbers cannot yet say whether the page is held to every other refresh by how its frames are paced (p50 16.6 ms is two refreshes at 120 Hz) or by what each move costs, nor how far the grid paged, so no optimisation round can be chosen on evidence.
- Result: PR (this one), diagnostics only; thresholds and verdicts are unchanged. Before the first key the probe times the page at rest for `IDLE_MS` (`idleFrames`, `idleP50Ms`, `idleP95Ms`, `idleDroppedPct`, reported, never judged), and reports `moves` (keys that moved the highlight), `turns` (times it turned back at an end) and `cards` (covers held at the end). `frameStats` is the shared arithmetic. TESTING.md lists the new metrics.
- Evidence: `selftestscroll.test.ts` 30/30, new: "the page at rest is reported beside the scroll, and never judged" (idle at every other refresh, scroll passing), "no frames at rest: the idle numbers are unknown", `frameStats` at 60 Hz and 120 Hz, and an answer without `idle` refused. `test/app/selftest.test.ts` 12/12 (`--no-sandbox` wrapper, as root): Xvfb 60 Hz, `visited` 194, `moves` 193, `turns` 0, `cards` 1200, idle p50 16.7 ms, 0% dropped at rest. `scripts/agent/check.sh` green.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly's `grid.scroll@*` carry the new metrics. If idle frames already come every other refresh, the first optimisation round is pacing (frame-rate cap under gamescope, M6-15's backends); if idle is clean and `moves` is low, it is the cost of a move (windowed grid, PLAN.md section 9).
- Next: read the next nightly's scroll metrics and run the first documented optimisation round.

## 2026-10-22 03:27 UTC session 01GNAmieoM32bimGF8fE9a5w (hourly heartbeat)

- Device results: the bridge ran nightly 085436e (the #233 library-wait build). No safety failures, no regressions.
  - DEVICE-RESULTS 085436e194f9a4f9d9b34f69ebd0b9d47988e078 complete
  - `harness.run` failed "neither route started the app"; `safety.owner-state` passed; the app never started, so none of its checks ran (M0-21 stays passed on 4b4346b).
- Worked on: M0-22, that start failure (tracking issue #191).
- Cause: `steam steam://rungameid/` was forwarded and started nothing in the start wait, and `steamcef.py run` then exited `steam-cef-unavailable` without a detail. The shortcut came from its record, so nothing in the run had reached Steam's client before the start, and the skip run.sh means to take when the debugger does not answer (the shortcut step's rule) never applied. Whether the client stalled or its debugger was gone cannot be told from this log.
- Result: PR (this one). `steamcef.py ready [--wait]` reads the page list, asking again on a new connection while its wait lasts (`wait_pages`). run.sh runs it after the late session check, up to `READY_WAIT_SECONDS`; a debugger that does not answer skips the run with `steam-cef-unavailable` before anything is started, a `ready` that cannot run fails `harness.run`. Every `steam-cef-unavailable` line now carries its `detail`. DEVICE-FACTS.md records the run; TESTING.md describes `ready` and the skip.
- Evidence:
  - `test_steamcef.py` "a debugger that answers is ready and one that stalls is asked again", "... never answers is not ready within the wait", `test_cli_ready`, and the CLI skip test now requires the detail; the four fail against the old `steamcef.py`. `python3 -B -m unittest discover -s test/device` 183/183.
  - `scripts/device-bundle.test.ts` 62/62, new: "run.sh skips before the start when Steam's debugger does not answer, and starts nothing" (fails against the old run.sh: it tried both routes). The neither-route and late-start tests now use a debugger that answers the check (the default fake, or one that answers once then stalls).
  - `scripts/agent/check.sh` green.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M0-22 (the next nightly either starts the app or skips with the debugger's detail in its log).
- Next: the next nightly's results; the grid scroll's metrics (G1-4).

## 2026-10-22 05:10 UTC session 01NXWukU282uKT274ZLuU3aW (hourly heartbeat)

- Device results: nothing new since 085436e (bridge last seen 2026-10-22 03:05 UTC, "not on the charger"); no safety failures, no regressions. PR #240 (M0-22 debugger check) merged at c6c14e5; CI x64 8:52, arm64 1:03.
- Worked on: Dependabot triage (CLAUDE.md rule 8, docs/MAINTENANCE.md; tracking issue #241).
- Result: merged #239 (happy-dom 21.0.1 -> 21.0.3) at 04edeed and #236 (tooling: oxlint 1.87.0 -> 1.88.0) after its head was brought onto `main`. #238 (runtime: lucide-react 1.59.0, react and react-dom 19.3.1) and #237 (Electron 44.6.0 -> 44.9.0, electron-vite 5.0.0 -> 6.0.0) are parked: each needs `update-branch` and fresh green legs after the merges before it, which did not fit this run.
- Evidence: CI on the original heads, x64 / arm64: #236 8:56 / 1:08, #237 7:55 / 1:01, #238 9:22 / 1:14, #239 9:20 / 1:11; `test:app` 243/243 on each x64 leg, and on #237 with Electron 44.9.0 (electron-builder logged `electron=44.9.0` on both legs). Every new or changed package is MIT or ISC; the production tree changes only in #238 (lucide-react ISC, react MIT), licence guard exit 0. electron-vite 6 needs no config change (it maps `rollupOptions` to `rolldownOptions`; the build output matched `main`'s byte sizes and hashed renderer assets). `docs/DEPENDENCIES.md` records none of these versions.
- Evaluator: PASS for #236, #237, #238, #239. For #237 on the diff; the Electron device baseline exists (run 4b4346b, complete, built on 44.6.0, which already fails `harness.run` and both `grid.scroll` checks and skips launch/exit.retroarch, so step 6 compares against those).
- CI wall time: as in Evidence.
- Device / acceptance: none.
- Next: #238, then #237 (`update-branch`, both legs green, merge; write `ELECTRON 44.6.0 -> 44.9.0 merged at <sha>, waiting for device`). Then the next nightly's results (M0-22, G1-4).
- Notes: `dockerd` was not running at session start; started by hand. The evaluator saw the `shots:nova` setup screen show "No RomM server configured" on #238 and on `main` 085436e alike: an existing race, worth a look if it recurs.

## 2026-10-22 05:27 UTC session 01UKGCQ9Pi9N8JkFUqANnFqQ (hourly heartbeat)

- Device results: nothing new since 085436e (bridge last seen 2026-10-22 03:05 UTC, "not on the charger"); no safety failures, no regressions.
- Worked on: the rest of the Dependabot triage (tracking issue #241).
- Result: merged #238 (runtime: lucide-react 1.59.0, react and react-dom 19.3.1) at ac8a9a1, then brought #237 onto `main` and merged it at eb54f36. ELECTRON 44.6.0 -> 44.9.0 merged at eb54f36, waiting for device (baseline run 4b4346b; any check that passed there and fails on the next nightly means revert #237 first thing).
- Evidence: CI x64 / arm64 on the merged heads: #238 782d55e 9:21 / 1:03; #237 dc1ea29 9:02 / 1:09. Evaluator re-run on #237's final head: lockfile keeps #238's runtime versions, no production package changed, no GPL/AGPL/LGPL package added, `scripts/agent/check.sh` green (2283/2283), `electron-vite build` clean with the unchanged config.
- Evaluator: PASS (#237 final diff; #238 passed in the previous run on the same diff).
- CI wall time: as in Evidence.
- Device / acceptance: the next nightly is the Electron 44.9.0 check, beside M0-22's `harness.run` and G1-4's scroll metrics.
- Stopped: nothing else eligible. M0-22, M2-02, M2-20 and M6-08 wait on M0-22's device run; M2-08 waits on M1-03 to M1-06; M4 and M6 wait on Gate 1; M7 waits on M1 descriptors. No `needs-human` issue is open.
- Notes: open a pull request with its final body. `pr-body` reads the body from the event, and editing a body does not re-run CI (`release.yml` takes the default `pull_request` types), so #243's first x64 leg failed on a placeholder body and passed only with the next commit. The commit hook runs the checks, so a commit takes minutes.

## 2026-10-23 03:27 UTC session 017uWkNVNJmRpK9hBEhqppvg (hourly heartbeat)

- Device results: nothing new since 085436e. The bridge was last seen 2026-10-23 03:09 UTC. Its last skip was "busy: reaper running": Steam's `reaper` was running for something other than an idle Galleon. The log cannot say whether that was a game, another shortcut, or a Galleon that was not idle. Since it last published (2026-10-21 08:42 UTC) it has skipped that way nine times, so nightly 7d0e22b (Electron 44.9.0, M0-22's debugger check, G1-4's scroll metrics) has not run. No safety failures, no regressions; Nightly on 7d0e22b green.
- Worked on: reading the upstream issue #89 (15 commits since the base; docs/MAINTENANCE.md, "Upstream ports"). Nothing is ported now, because no feature in progress needs any of them:
  - 68697e0, 990e55e (controllers): for M3-08, as docs/UPSTREAM.md says. 355061f follows them in the same gamepad code.
  - 15c0930 (a PS2 cue/bin launches the .bin): for M1-03. 3eacaa5 and e6cf36e (Dreamcast VMU saves): for M1-06 and M2-14. All three wait on M0-22's device run.
  - 2bbd93d (highlight returns to its card): M4 UI work, after Gate 1.
  - 481f2ab (save folders of niche cores), b3c8cf7 (EmuDeck), f5b25b7, 7d2bf49, a82542c (Xbox), 2b38d66 (upstream's bug form), cf56f66 (dependencies, Dependabot's job), c1725b5 (a test helper; no flaky issue here): no feature or bug names them.
- Evaluator: PASS on the second pass. The first failed on two wording points (15c0930's feature; what a `reaper` skip says), both fixed.
- Stopped: nothing else eligible, for the reasons in the 2026-10-22 05:27 entry. No `needs-human` issue is open.
- Notes: `npx install-electron` died once on a cut-off download (undici `assert(!this.paused)`); a retry worked. `dockerd` again had to be started by hand.

## 2026-10-24 00:26 UTC session 01Xjmugq3qfx94K2oJt6R5Tz (hourly heartbeat)

- Device results: the bridge ran nightly b63deb9 (Electron 44.9.0, M0-22's debugger check, G1-4's scroll metrics). No safety failures, no regressions.
  - DEVICE-RESULTS b63deb9f6d6a126735bdce64751d6bcf1a59e16d complete
  - `harness.run` passed: the app started, ran its self-test and exited 0. `startup.cold` 3966 ms (threshold 4000, Eco profile).
  - Electron 44.9.0 (#237): every check that passed on the baseline 4b4346b passes again, so the update stays.
  - `grid.scroll@performance`: p50 16.6 ms, p95 33.3 ms, 56.2% dropped; at rest p50 8.3 ms, 1.3% dropped; `moves` 190, `turns` 7, `visited` 40, `cards` 300. `@balanced`: p95 50.2 ms, 88.5% dropped; at rest p95 41.6 ms, 17% dropped; `moves` 248, `turns` 4, `visited` 60. `launch/exit.retroarch` skip `cannot-sandbox`.
- Worked on: ingesting b63deb9 (tracking issue #191).
- Result: PR (this one), PROGRESS only. `device-results.mjs --apply` would flip M0-22, and its one-summary rule is met, but M0-22's last acceptance line asks for both checks passing in two consecutive nightly runs, and b63deb9 is the first (085436e failed `harness.run`). `passes` stays false until the next nightly with c6c14e5 in it passes `harness.run` and `safety.owner-state` too. "The shortcut does nothing when started by hand" is shown only against fakes (`scripts/device-bundle.test.ts`); the entry that flips M0-22 should say so.
- Evidence: `node scripts/agent/device-results.mjs --summary`; `results/b63deb9.../summary.json` and `results/085436e.../summary.json` on `device-results`.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none new.
- Next: the next nightly (M0-22's second run); once M0-22 passes, M0-12 and the M1 descriptors are eligible. The scroll: at rest the page holds 120 Hz under Performance, so frames are not paced to every other refresh; the cost is in the move. The highlight moved 190 times but visited only 40 games and turned 7 times, so it is bouncing between ends that are 40 games apart, not paging through 1,292: worth reading in the probe before any optimisation round.

## 2026-10-24 00:53 UTC session 01Xjmugq3qfx94K2oJt6R5Tz (hourly heartbeat, continued)

- Device results: nothing new since b63deb9. #245 (the b63deb9 ingestion) merged at ef36fb7; CI x64 8:36, arm64 0:34. Evaluator PASS on its second pass (the first failed a flip of M0-22 that its two-consecutive-nightlies line does not yet allow).
- Worked on: reading b63deb9's `grid.scroll` metrics against `scrollProbe` (no code changed).
- Finding, for the next scroll unit: Down moves one card per row, so `visited` counts rows. Balanced's 420 cards over 60 rows give 7 columns, and Performance's 300 cards over 40 rows about that: the deepest downward legs reached (or neared) the last row of the cards already loaded, then turned back, with seven turns while only 300 of 1,292 games had loaded. The grid fetches `PAGE_SIZE` games at a time when its sentinel comes within `LOOKAHEAD` (`usePagedRoms`, src/renderer/src/paging.ts), and on the Nova, with the owner's server over the network, the next page did not arrive within `TURN_MS`. So the probe's turn rule takes a page still loading for the end of the grid (its comment assumes the page arrives well within `TURN_MS`, which holds against CI's local server, not on the Nova). Two things follow. The measured frames are mostly of the first few hundred cards, plus the stall at the loading edge, so they say little about a long scroll. And a player holding Down on the Nova also stops at each page edge, which is a real problem, separate from frame times.
- Next: G1-4's next unit. Write a probe test where a page arrives after `TURN_MS` and the probe keeps going while cards are fewer than `games`. Decide from that test whether the grid should fetch further ahead on the Nova (a larger `LOOKAHEAD`, or more than one page in flight). Then read the frame times again on the next nightly. M0-22 still needs its second passing nightly.
- Stopped: the run's time window ended.

## 2026-10-24 01:27 UTC session 016cUsdG7m8y686aPeZ8B2LD (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions.
- Worked on: G1-4, the scroll probe at the loading edge (tracking issue #247).
- Result: the library marks its end-of-grid line (`data-grid-end`, `GRID_END` in `src/main/selftestscroll.ts`). The probe turns at the bottom only under that marker. Short of it, it holds Down for up to `GRID_TIMEOUT_MS` and reports the time stood there as `waitedMs`, a new `grid.scroll` metric (docs/TESTING.md).
- Evidence: `src/main/selftestscroll.test.ts` "scrollProbe in a page" runs the probe in happy-dom against a fake grid: "holds Down through a page slower than TURN_MS, and turns at the end the grid draws" and "a page that never comes is turned from once the grid has had its time". Both fail on the old probe (it turned at 10 of 20 cards) and pass now. `scripts/agent/check.sh` green; `npm run test:app` 243/243 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- Finding: in test:app the 1,300-game scroll reports `waitedMs` 12252 of 30,000 ms on the fake server (`cards` 1140, `visited` 190, `turns` 0) and 11346 on the synthetic platform, whose pages are answered inside the app. So the grid itself stands still at every page edge, about 600 ms a page, with no network in the way. That is the next scroll unit, before any frame-time work: `usePagedRoms` (src/renderer/src/paging.ts) asks for a page only when the sentinel crosses `LOOKAHEAD`, which a held Down outruns.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly reports `waitedMs` on the Nova.
- Next: a unit test for the paging stall (a held Down outrunning `LOOKAHEAD`), then fetch further ahead. M0-22 still needs its second passing nightly.

## 2026-10-24 02:27 UTC session 01LLmuXFuv1M9sCvB99wTRUS (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions.
- Worked on: G1-4, the library grid's paging lookahead (tracking issue #249).
- Result: PR (this one). `usePagedRoms` watched its sentinel against the viewport. The grid scrolls inside the screen's `.content` box, and an observer clips its target by every scrolling ancestor before `rootMargin` applies, so `LOOKAHEAD` did nothing: a page was asked for only once the sentinel was on screen. The sentinel is now watched against its nearest scrolling ancestor (`scrollingAncestor` in src/renderer/src/paging.ts), as Home's rows already watch theirs against the row.
- Evidence: in Electron's Chromium (this VM, Xvfb), a sentinel 300 px below the fold of a 600 px scroll box, observed with `rootMargin: '600px 0px'`, reads `isIntersecting` false against the viewport and true against the box. `src/renderer/src/paging.test.tsx` "what the sentinel is watched against": "the grid's observer is given it, so the lookahead reaches below the fold" fails on the old observer and passes now. `scripts/agent/check.sh` green.
- Finding: the fix does not measurably shorten the probe's wait in test:app. `grid.scroll` `waitedMs`, nes / synthetic, on this VM: old code 7475 / 5422; fix 9419 / 7391; fix with `LOOKAHEAD` `200%` 8218 / 5730 and `400%` 8035 / 5244. Every run reached all 1,300 cards and the last row, with `p95Ms` 16.8. The 12252 / 11346 in the 01:27 entry came from another VM, so run-to-run spread is wider than any of these differences. A wait that holds when the lookahead is four screens is not the lookahead. It is pages arriving one at a time, about 21 of them in 30 s, slower than a held Down crosses one. So the 01:27 entry's "a held Down outruns `LOOKAHEAD`" was wrong about the cause. `LOOKAHEAD` stays as it is.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none new. The next nightly's `waitedMs` is the first on the Nova with the lookahead in effect.
- Next: time one page from request to drawn cards (main-process fetch versus render of 60 more cards into a grid that is never windowed) before any change to paging; that decides between more than one page in flight, larger pages, or a windowed grid (a G1-4 optimisation round, PLAN.md section 9). M0-22 still needs its second passing nightly.

## 2026-10-24 03:27 UTC session 011fpq78FEkaucTz8dwha7et (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions. #251 (the grid's sentinel against its scroll box) merged at cbb2c58.
- Worked on: the flaky `run.sh --cleanup stops an app a killed run left running` (issue #250).
- Root cause: the test waited for `app.pid` to exist and then read it. launch.sh writes it with `echo >`, which creates the file before the number is in it, so a read in between gave `Number('')`, pid 0, and `process.kill(0, 0)` signals the test's own process group and succeeds: "Missing expected exception". The issue's zombie guess does not hold: `launched.py stop` returns 0 only once launch.sh is gone (or a zombie), and launch.sh reaps the app before it writes `exit` and exits. run.sh's cleanup was never affected: `launched.py stop` (`_pid`) takes only a first line of digits.
- Result: PR (this one), test only. `writtenPid` in scripts/device-bundle.test.ts waits for a whole pid line, and the cleanup test reads the pid through it.
- Evidence: the old read on an empty `app.pid` gives pid 0 and `kill(0, 0)` does not throw (shown on this VM). New test "a pid file launch.sh has created but not yet written is waited out" passes. The cleanup test passed 15 of 15 runs started at once. `scripts/agent/check.sh` green.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: G1-4, timing one page from request to drawn cards (02:27 entry). M0-22 still needs its second passing nightly.

## 2026-10-24 04:26 UTC session 019ekwrVZxhM7Ttn6rhusvfj (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions. #252 merged at f15096e.
- Worked on: G1-4, timing one page of the grid scroll (tracking issue #253).
- Result: PR (this one). The scroll probe watches the library's spinner with a MutationObserver and reports `pages`, `pageP50Ms`, `pageMaxMs` (spinner up to covers drawn: the answer and the spinner going away are one render) and `gapP50Ms` (one page drawn to the next asked for) as `grid.scroll` metrics (docs/TESTING.md). Reported, never judged.
- Evidence: `src/main/selftestscroll.test.ts` "holds Down through a page slower than TURN_MS…" now also asserts the one page is timed (≥ 250 ms for a 300 ms page) and "the pages asked for during the scroll are counted and timed, never judged". test:app's two grid.scroll tests on this VM: nes `pages` 21, `pageP50Ms` 89, `pageMaxMs` 151, `gapP50Ms` 1244, `waitedMs` 8587; synthetic `pages` 21, `pageP50Ms` 9, `gapP50Ms` 1274, `waitedMs` 7186. A throwaway timer in the `library:roms` handler (not committed) put the fake server's fetch at 2-11 ms and `library.adopt` at 45-99 ms per page. `scripts/agent/check.sh` green.
- Finding: the 02:27 entry's "pages arriving one at a time, slower than a held Down crosses one" is not the answer either. A page takes under 100 ms at the median (151 at most) from request to drawn; the grid then goes about 1.25 s before it asks for the next, while the highlight crosses the page and stands at its end (`waitedMs` about 400 ms a page). So the sentinel calls late, despite `LOOKAHEAD` and `scrollingAncestor`: that is the next unit, before more than one page in flight, larger pages or windowing.
- Noticed: in one test:app run (with the throwaway timer in), the nes grid.scroll test failed `idleP50Ms` on `idleFrames` 0, then passed on the next run: issue #254 (`flaky`).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly reports `pageP50Ms` and `gapP50Ms` on the Nova.
- Next: why the sentinel asks about 1.25 s after a page lands. First lead: every press starts a smooth scroll (`scrollBehavior`, src/renderer/src/input/scroll.ts) and a held Down restarts it every `REPEAT_MS`, so the scroll box may trail the highlight and bring the sentinel into the lookahead late. Measure the box's lag behind the highlight in Electron's Chromium, as in #251, before changing anything. M0-22 still needs its second passing nightly.

## 2026-10-24 05:26 UTC session 01QVPReS2ftE5aAehNpbf6rX (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions. #255 (page timing) merged at 1b27ecd.
- Worked on: G1-4, why the grid asks for its next page late (tracking issue #256).
- Root cause: the scroll box trails the highlight. Every focus move started a smooth scroll (`scrollBehavior`, src/renderer/src/input/scroll.ts). A held direction repeats faster than a slide finishes, and each new slide starts slowly from where the last one was cut off, so the box fell further behind on every repeat. Throwaway instrumentation in test:app (not committed) put the highlighted card up to about 2,800 px (11 rows) below the bottom of the box. The sentinel is measured against the box, so even a 3000 px `LOOKAHEAD` reported nothing until the highlight stood at the last loaded row and the box caught up, 2 or 3 repeats later. The page itself then arrived within one repeat. So the 04:26 lead was right, and `LOOKAHEAD` and paging are not the cause.
- Result: PR (this one). A move now says whether it is a repeat of a held direction (`useGamepad` from its repeat, `useKeyboard` from `event.repeat`, through `move` and `applyFocus` to `revealElement` and `scrollToEnd`). A repeat scrolls instantly; a single press still slides. The scroll probe sends a held Down as a held key does (each key after the first in one direction is a repeat) and reports `trailMaxPx`, the furthest the highlight sat below the box (docs/TESTING.md).
- Evidence: test:app `grid.scroll`, nes / synthetic, on this VM. Old renderer, same probe: `trailMaxPx` 2747 / 2725, `waitedMs` 10002 / 7299, `gapP50Ms` 1265 / 1287. Fix: `trailMaxPx` 0 / 0, `waitedMs` 0 / 0, `gapP50Ms` 824 / 906, all 1,300 cards reached with a turn at the end, `p95Ms` 16.8. New tests: scroll.test.ts "on a held direction arrives, so the page keeps up with the highlight" and "on a held direction arrives there" (both failed before the fix); "on a single press still slides"; gamepad.test.tsx "says which moves are its repeats…" (failed before); selftestscroll.test.ts "holds Down as a held key does, and reports how far the highlight trails the box". `scripts/agent/check.sh` green; `npm run test:app` 243/243 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). No shots: nothing a still frame shows changed.
- Noticed: the first test:app run of this session (old renderer) failed the nes grid.scroll test on `idleFrames` 0 again, issue #254 (`flaky`). Its two-unit window ends after this unit.
- Evaluator: PASS (callers complete; the probe is more faithful to a held key, not less; `trailMaxPx` sound).
- CI: the first x64 run failed the PR-body check: G1-4 is a gate criterion, not a feature id, and the body now says `Feature: none (…)`. Its one re-run failed `run.sh --cleanup stops an app a killed run left running` (exit 143 recorded for an app that exited 0), in device code this PR does not touch: issue #258 (`flaky`), with a likely race in launch.sh's `wait` loop. arm64 green. CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly reports `trailMaxPx` and `waitedMs` on the Nova with the fix in. Whether an instant scroll per repeat looks right is the owner's call in the acceptance session.
- Next: merge #257 once both legs are green. Then #258 (launch.sh records the wrong exit on an interrupted `wait`) and #254 (idleFrames 0); both flaky windows are now due. M0-22 still needs its second passing nightly.
- Stopped: the run's time window ended.

## 2026-10-24 06:27 UTC session 01WSMcsmLeJdj5QE8N6FowYM (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions. #257 (instant scroll on a held direction) merged at b3e6f1f, both legs green.
- Worked on: the flaky `run.sh --cleanup stops an app a killed run left running` (issue #258).
- Root cause: a real launch.sh defect, not only a test race. `launched.py stop` signals the app and launch.sh within microseconds; the TERM interrupts launch.sh's `wait "$app"` (status 143), and when the shell has reaped the app meanwhile, `kill -0` fails and 143 is written as the app's exit. Under bash, which is `/bin/sh` on the device, a second `wait` then gives -1, so no shell-only re-wait is portable.
- Result: PR (this one). launch.sh execs `launched.py run` past its start mark (same pid and start time, so `launch.id` still matches). `run` starts the app, records it, passes a stop on to it alone, waits without reaping (`waitid` with `WNOWAIT`, so a stop never reaches a reaped pid), reaps with stops blocked and writes `exit` (docs/TESTING.md).
- Evidence: test_launch.py "a stop sent to both records the app's own exit" (`launched.stop` against launch.sh, ten times each under /bin/sh and bash) failed 6 of 10 under bash on the old launch.sh and passes now; four new `run` tests in test_launched.py. A stress loop sending TERM to both on this VM: old launch.sh 34 of 60 wrong under bash, 4 of 800 under dash with CPU load; new 0 of 640. The new test passed 15 of 15 runs of test_launch.py, and fails 3 of 3 against the old launch.sh. `scripts/agent/check.sh` green.
- Evaluator: the first round FAILed the new test as flaky (it kept `started-with` across attempts, so it could stop the fake app before its trap was set); fixed, see the PR for the second round.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly's `app: exited <code>` note comes from `launched.py run`.
- Next: #254 (idleFrames 0 in test:app), whose flaky window is due. M0-22 still needs its second passing nightly.

## 2026-10-24 07:26 UTC session 01F1hkYMB8pwgxaPXjHRqbA7 (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions. #259 (`launched.py run`) merged at 33ea71a.
- Worked on: the flaky `grid.scroll` test:app run with `idleFrames` 0 (issue #254).
- Root cause: the rest window began when the highlight landed and ended on its `IDLE_MS` clock as well as on frames. `idleFrames` 0 means not two frames in that whole window, so the page was not drawing when it opened, and the clock closed it with nothing timed: a page that has not drawn yet is not at rest. Why that VM held its frames back for 2 s is not shown. Four runs here did not bring it back: plain, every core busy, the window shown 8 s late, and the window shown in the middle of the rest. In each the page drew within milliseconds and was visible before `show()`.
- Result: PR (this one). The rest is timed from the first frame drawn after the highlight lands, not from the highlight itself. That wait is bounded by the probe's `GRID_TIMEOUT_MS`, and a page that draws no frame at all is a failed scroll (`no-frames`). The time to that first frame is reported as `idleWaitMs`, never judged (docs/TESTING.md), so a recurrence on the Nova or CI says how late the page drew.
- Evidence: new selftestscroll.test.ts tests: "the page at rest is timed from its first frame, however late that comes" (frames held back past a whole rest) and "a page that draws no frame at all is a failed scroll". Both fail on the old probe and pass now. `test/app/selftest.test.ts` 12/12: nes `idleFrames` 120, `idleWaitMs` 5; synthetic 120, 3. `scripts/agent/check.sh` green.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly reports `idleWaitMs` on the Nova.
- Next: M0-22 still needs its second passing nightly; nothing else open is eligible.

## 2026-10-24 09:26 UTC session 01KAve711QyooBvfV9giSmMr (hourly heartbeat)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions. #260 (grid rest timed from its first frame) merged at 4e99187; CI x64 8:59, arm64 1:13.
- Stopped: nothing eligible. M0-22 waits on its second passing nightly; M2-08 waits on M1-03 to M1-06, which wait on M0-22; M4 waits on Gate 1. No `needs-human` issue is open.

## 2026-10-25 11:35 UTC session 011nm8casZvGgshrvK5D7c1r (interactive)

- Device results: nothing new since b63deb9 (bridge last seen 2026-10-24 00:10 UTC, "busy: reaper running"); no safety failures, no regressions.
- Worked on: the owner's request to be told when progress can't be made without the device.
- Result: PR (this one). ADR 0007 and a CLAUDE.md rule under Decisions: a run that stops because everything left waits on the device sends the owner one push notification (what waits, the bridge's last skip reason and last-seen time), once per reason, and records it as `Notified: <reason>` in its stop line.
- Evidence: docs only. `scripts/agent/check.sh` green.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: M0-22 still needs its second passing nightly. The next heartbeat that stops for that reason sends the first notification.

## 2026-10-25 13:27 UTC session 01A4cx7dsUvyaEmYpHtAeCD6 (hourly heartbeat)

- Device results: DEVICE-RESULTS 1ac4cb4aaa08b016305ea8f995e9d34eec610cfd complete. No safety failures, no regressions. PASSES M0-22 device:1ac4cb4aaa08b016305ea8f995e9d34eec610cfd (its second passing nightly), which makes M1-03 to M1-08 and M0-12 eligible.
- Grid scroll on the Nova with #257 and #260 in: `grid.scroll@performance` dropped 7.2% (56.2% at b63deb9), p95 16.7 ms, `trailMaxPx` 66; `@balanced` dropped 24.8% (88.5%), p95 33.1 ms. Both still fail G1-4. The scroll now waits on pages: `pageP50Ms` 2160 / 2100, `waitedMs` 19744 / 12467, `gapP50Ms` 662 / 708, `turns` 0 (it never reached the end of 1,292 games). The 04:26 entry's "under 100 ms a page" was the VM's synthetic platform, not the Nova. A held Down eats a page of `PAGE_SIZE` in about a second, so one page in flight at 2 s cannot keep up whatever the lookahead.
- Worked on: G1-4, where the Nova's 2 s per page goes (tracking issue #263).
- Result: PR (this one). The main process times each `library:roms` answer it serves while the scroll runs, split into its wait on RomM and `Library.adopt` (src/main/pagetimes.ts, kept only between the scroll's start and end), and the scroll reports `serverP50Ms` and `adoptP50Ms` (docs/TESTING.md).
- Evidence: selftestscroll.test.ts "the main process's share of each page is split into RomM's answer and the disk" and "without a page timer the split is left out rather than reported as unknown". `scripts/agent/check.sh` green; `npm run test:app` (see the PR). init.sh could not bring the RomM stack up (Docker Hub answered 429 to the mariadb pull); nothing here touches the client.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly reports `serverP50Ms` and `adoptP50Ms` on the Nova.
- Next: with the split, either more than one page in flight (RomM's answer) or a cheaper adoption. M1-03 (ARMSX2 descriptor) is the next feature from `next.mjs` after M0-12.

## 2026-10-25 13:58 UTC session 01A4cx7dsUvyaEmYpHtAeCD6 (hourly heartbeat)

- Device results: none new since 1ac4cb4. #264 (page time split) merged at 2ec3648; CI x64 8:07, arm64 1:17.
- Worked on: M0-12, its second acceptance line only (tracking issue #265).
- Result: PR (this one). `device-results.mjs --apply` opens one issue per problem report in a `reports/<time>/` folder newer than the last ingested result (`[device-report] <time>/<report>`, labels `bug` and `device-report`) and prints a `DEVICE-REPORT <time>/<report>` line for the PROGRESS entry so a closed one is not opened again, quoting only the report's sanitised summary: its `versions.json` with backticks dropped, and its file list. `readBranch` finds each report the bridge publishes in a folder of its own under the time (`reportsIn`). docs/PLAN.md section 5 says so.
- Evidence: device-results.test.ts "each problem report the bridge published is found, with its versions", "one bug per new problem report, quoting only its summary, and not again while open", "a report recorded in PROGRESS.md is not opened again once its bug is closed" (the evaluator's first round found that a closed report bug came back until a newer result was ingested), and readBranch's test now checks `reportContents`. `scripts/agent/check.sh` green.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. M0-12 still needs the dialog text (all four catalogues) and the `report.bundle` self-test check before READY-FOR-DEVICE.
- Next: M0-12's dialog text and `report.bundle`; then M1-03.

## 2026-10-25 15:27 UTC session 01MkPuRUHMEisj2GHHwuG9Sz (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #266 (one bug per problem report) merged at 8458c03.
- Worked on: M0-12, its first acceptance line (tracking issue #265).
- Result: PR (this one). Report a problem says, in all four catalogues, that the zip goes to the `reports` folder inside the Galleon folder and is picked up automatically the next night the device is charging in Game Mode, with nothing to send (`system.reportExplainer`); the toast after writing names the path and says the same (`system.reportWritten`). No link or code is shown.
- Evidence: i18n.test.ts "Report a problem says where the zip goes and that nothing has to be sent" (fails on the old strings, passes now). `scripts/agent/check.sh` green. `npm run shots:nova` 21 screens (Electron through a `--no-sandbox` wrapper in the scratchpad, as root): looked at `report.png`: the System tab's explainer wraps to two lines under "Report a problem", and the toast top right shows the zip's path and the pick-up sentence on four lines inside its box, nothing clipped; `settings-system.png` unchanged above the fold.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. M0-12 still needs the `report.bundle` self-test check before READY-FOR-DEVICE.
- Next: M0-12's `report.bundle`.
- Notes: `dockerd` was not running at session start; started by hand.

## 2026-10-25 15:58 UTC session 01MkPuRUHMEisj2GHHwuG9Sz (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4. #267 (Report a problem text) merged at 9f41e5c; CI x64 9:06, arm64 1:04.
- Worked on: M0-12, the app half of `report.bundle` (tracking issue #265).
- Result: PR (this one). A `report.bundle` scenario (src/main/selftestreport.ts) opens Settings, moves to the System tab and Report a problem and presses A through the page's keyboard path, waits for the toast naming the zip, unpacks the one new zip from the test home's `reports/` into `report.bundle/` in the results folder for the bridge's sanitiser, and fails when a file is under `config/`, named for a secret, or holds a RomM token, an auth header or an unreplaced secret value (then nothing is left in the results). run.sh asks for it. docs/TESTING.md describes it.
- Evidence: selftestreport.test.ts (10 tests: a clean bundle passes and lands in the results; a credential fails, names the file and leaves nothing; button not reached; no bundle; unreadable bundle; stopped run is a skip; what counts as a credential by name and by content; the page probe). test/app/selftest.test.ts "signed in, report.bundle presses Report a problem and copies a clean bundle": passes in the built app against the fake RomM, and no copied file carries the fake server's host or token. `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). `scripts/agent/check.sh` green.
- Evaluator: PASS; its notes taken: an unreadable bundle now leaves nothing in the results either, and the docs name the `app/report.bundle/` prefix the gate must match. Not taken: `pressReport` ignores the abort signal (a stop waits out the probe's timeout, then is a skip), and the toast can show on the `settings` shot that follows (appearance only).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: the next nightly runs `report.bundle`. Not READY-FOR-DEVICE yet: `device-results.mjs` must first hold the check to nothing under `app/report.bundle/` in `bridge.json`'s `sanitizer.withheld`.
- Next: that sanitiser gate in `device-results.mjs`, then READY-FOR-DEVICE M0-12.

## 2026-10-25 17:27 UTC session 01NevEPaUCP1YsyQSBqqK5Ni (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #268 (`report.bundle` in the app) merged at a69e593; CI x64 and arm64 green (median over the last 10 PRs: x64 8:52, arm64 1:06).
- Worked on: M0-12, the sanitiser half of `report.bundle` (tracking issue #265).
- Result: PR (this one). `countedResults` in scripts/agent/features-check.mjs is the one place a check's result is counted: a pass of a check in `PUBLISHED_WHOLE` (`report.bundle` → `app/report.bundle/`) is a `fail` with `sanitiser:<files>` when `bridge.json`'s `sanitizer.withheld` or `sanitizer.dropped` names a file in that folder, and a `skip` when no `bridge.json` says what the sanitiser kept. `device-results.mjs` reads every `results/<sha>/bridge.json` and judges flips, reverts, regressions and new passes through it; features-check's flip guard does the same against `origin/device-results`. docs/TESTING.md says so under "How a device feature passes" and in the check's description.
- Evidence: device-results.test.ts "report.bundle counts only when the sanitiser published its bundle whole" (whole, withheld, dropped, no bridge.json, half a sanitiser report, and a revert naming the file) and readBranch's test now checks `bridges`; features-check fixtures `device-flip-report-bundle-withheld`, `-no-bridge` and `-whole`. The new tests fail on the old scripts and pass now. `scripts/agent/check.sh` green.
- Evaluator: PASS. Its note, not acted on here: nothing in CI runs the bridge's real sanitiser over a bundle the app produced, so a first-night `report.bundle` fail with a `sanitiser:` reason points there.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M0-12. The next nightly runs `report.bundle`; it passes once the bridge publishes the bundle whole.
- Notes: CI's pull-request body check wants a `Feature: <id>` line; a job re-run reads the body the PR was opened with, so a fixed body needs the next push.
- Next: M1-03 (ARMSX2 descriptor) from `next.mjs`.

## 2026-10-25 18:27 UTC session 01CaVX6KtqxMGnbn8Hbz7a21 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #269 (M0-12's sanitiser gate) merged at 796e34a.
- Worked on: M1-03, its first two acceptance lines (tracking issue #270).
- Result: PR (this one). `src/config/emulators/armsx2/index.ts`: the catalog's `~/Applications/ARMSX2*.AppImage` (then `armsx2-qt`/`armsx2` on PATH), system `ps2`, `-batch -fullscreen -nogui -- <rom>` (flags read in ARMSX2's `pcsx2-qt/QtHost.cpp` at b1f3196b), BIOS `~/.config/ARMSX2/bios`, memory cards `~/.config/ARMSX2/memcards` declared `shared` with `saves.armsx2` (all four catalogues) as the reason the Saves tab gives; no states, since ARMSX2 names them `<serial> (<crc>).<slot>.p2s` (`VMManager::GetSaveStateFileName`). A `.cue` launches the `.bin` beside it.
- Evidence: registry.test.ts "ARMSX2 boots an .iso or a .chd fullscreen…", "ARMSX2 boots a cue/bin pair from its .bin", the AppImage and ES-DE find-rule tests, "ARMSX2 downloads only its Linux AppImages"; savepaths.test.ts "ARMSX2's shared memory card is not synced, and the Saves tab is told why". `scripts/agent/check.sh` green; `npm run test:app` 244/244; `npm run shots:nova` 21 screens: looked at `emulators.png` (ARMSX2 the last row, Not installed, 1 platform, Install, its down arrow disabled, nothing clipped) and `bios.png` (unchanged).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.armsx2` needs a sandbox recipe (`PCSX2.ini` in the sandbox, a portable marker declining it), the `missing-bios` skip, a redistributable PS2 payload in the M0-07 manifest and run.sh asking for the check.
- Next: M1-03 part 2, those four.

## 2026-10-25 18:56 UTC session 01CaVX6KtqxMGnbn8Hbz7a21 (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4. #271 (ARMSX2 descriptor) merged at 0d547c1; CI x64 8:18, arm64 1:12.
- Worked on: M1-03, the sandbox recipe behind `launch.armsx2` (tracking issue #270).
- Result: PR (this one). ARMSX2's recipe starts only the AppImage with `-datapath <sandbox config>`, which roots its data in `<config>/ARMSX2` as `XDG_CONFIG_HOME` already does, and writes `ARMSX2/inis/PCSX2.ini` there naming the sandbox's BIOS, memory card and state folders, with `SettingsVersion = 1` (without it ARMSX2 resets the file and opens its setup wizard) and `SetupWizardIncomplete = false`. Read in ARMSX2 at b1f3196b: `EmuFolders::SetDataDirectory` and `ShouldUsePortableMode` (pcsx2/Pcsx2Config.cpp; the portable marker is read beside the program inside the mounted AppImage), `QtHost::InitializeConfig` and `-datapath` (pcsx2-qt/QtHost.cpp), `CheckSettingsVersion` (pcsx2/VMManager.cpp).
- Evidence: selftestsandbox.test.ts "ARMSX2's recipe": its argv and XDG root, the settings file's keys, and a binary install not started. `scripts/agent/check.sh` green; `npm run test:app` 243/244: `report.bundle` failed once `not-opened:no-report-button` and then passed 3 of 3 alone, so flaky issue #272 is open (root-cause fix due within two units of work).
- Evaluator: PASS. Its notes, not acted on: an ARMSX2 build shipping a portable marker inside its own AppImage would fall back to `~/Applications/ARMSX2`, which only the owner-state manifest would catch; and for an existing file without the version ARMSX2 first asks whether to reset, then opens the wizard (a window either way).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. Still to do for READY-FOR-DEVICE M1-03: the `missing-bios` skip, a redistributable PS2 payload in the M0-07 manifest, and run.sh asking for `launch.armsx2`.
- Next: those three.

## 2026-10-25 19:26 UTC session 01RmaoJCHLC8BcdHdnxBuEZc (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #273 (ARMSX2's sandbox recipe) merged at d4db10b.
- Worked on: M1-03, the `missing-bios` skip of `launch.armsx2` (tracking issue #270).
- Result: PR (this one). A sandbox recipe says whether the emulator needs a BIOS dump to start (`SandboxRecipe.needsBios`: ARMSX2 and DuckStation yes, the rest no). `prepareSandbox` skips launch and exit as `missing-bios` (`no-bios-files`) when such an emulator's sandbox BIOS folder holds no file of its own after the owner's are copied (links do not count; a copy kept from an earlier start does). docs/TESTING.md says so under the emulator sandbox.
- Evidence: selftestsandbox.test.ts "an emulator that needs a BIOS is skipped as missing-bios when none reached the sandbox", "… starts with a dump of the owner, or the copy it kept", "an emulator that needs no BIOS starts without one", ARMSX2's "needs a BIOS dump to start"; selftestlaunch.test.ts "an emulator missing its BIOS skips both as missing-bios and starts nothing". `scripts/agent/check.sh` green; `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. Still to do for READY-FOR-DEVICE M1-03: a redistributable PS2 homebrew payload in the M0-07 manifest (`test/fixtures/roms/manifest.json` holds only GBA so far), and run.sh asking for `launch.armsx2` with it.
- Next: those two. No prebuilt PS2 homebrew under a permissive licence turned up in a first search; the likely route is a tiny ELF of our own built with the ps2dev toolchain's container image, its source MIT in the repo and the ELF pinned by hash.

## 2026-10-25 20:26 UTC session 015EjWSXk1H9dreEMUBJeFLy (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #274 (`missing-bios` skip) merged at bdb9427. `main`'s push run on d4db10b was red: x64 `test:app` failed `report.bundle` with `not-opened:no-report-button`, the flake of #272.
- Worked on: #272, the root cause of that flake (CI red on `main`, then a `flaky` issue past due).
- Result: PR (this one). `useFocusable` registers an element from an effect after the render, and `applyFocus` drops an id it does not know, so the `report.bundle` probe could hover the System tab after it was drawn but before it was registered: the hover was dropped, Enter went to whatever had the highlight, the tab never opened and the probe waited out its timeout for the Report a problem button. The probe now repeats the hover (a pixel apart, since the engine ignores a move to where the pointer already is) until the element shows `data-focused="true"`, and only then presses Enter; a highlight that never arrives fails as `system-tab-not-highlighted` or `report-button-not-highlighted`.
- Evidence: selftestreport.test.ts "presses only what the focus engine has taken, so a page still registering is waited for" runs the probe in a fake page whose elements register 150 ms after they are drawn: it failed `no-report-button` on the old probe (the CI failure) and passes now. `scripts/agent/check.sh` green; `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none. M0-12's `report.bundle` uses the same probe on the Nova.
- Next: M1-03's PS2 payload and `launch.armsx2` in run.sh.

## 2026-10-25 21:26 UTC session 01BJHVJD5cvQpyeAbNSENtHs (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #275 (`report.bundle` waits for the highlight) merged at 7f6d833; `main`'s push run on it green (x64 9:19, arm64 1:00), and #272 is closed.
- Worked on: M1-03, the PS2 payload of `launch.armsx2` (tracking issue #270).
- Result: PR #276. `test/fixtures/homebrew/ps2-hello/`: `main.c` draws one line with ps2sdk's debug screen and sleeps; `build.sh` builds it in `ghcr.io/ps2dev/ps2dev` pinned by digest (Docker Hub answered 429; GHCR serves the same image) and writes `galleon-ps2-hello.iso`, a disc whose `SYSTEM.CNF` boots `GALLEON.ELF`, its dates from `SOURCE_DATE_EPOCH`. The ISO is committed beside its source. ADR 0008: our own homebrew lives in the repository and the manifest pins it by its raw URL at the merged commit.
- Evidence: two builds give sha256 `3fcccf406bb0466e256ab18a8d016091a5b05bd43ff639a6c580fd44dffced33` (532480 bytes); the first try differed only in the disc folder's own date, now set too. `scripts/agent/check.sh` green. Not booted on the VM (no PCSX2 here).
- Evaluator: PASS (SYSTEM.CNF and the ISO layout parsed, licences clean). Its note taken: the image's apk packages are unpinned, so README, ADR and build.sh no longer promise the same bytes on a rebuild; the committed ISO is the payload.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Notes: inside the container the proxy needs `--network host` plus the CA bundle mounted, or `apk add` cannot reach its mirror; build.sh does both when they exist.
- Next: M1-03's last part: the manifest entry at #276's merge commit (`roms/ps2/…`), its THIRD_PARTY.md notice (heading must appear in the URL, see device-bundle.test.ts), and run.sh asking for `launch.armsx2`/`exit.armsx2` with it; then READY-FOR-DEVICE M1-03.

## 2026-10-25 22:27 UTC session 01AuHPkRH6XWYwPN87wpup2F (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #276 (the PS2 disc) merged at 585653d; CI x64 9:12, arm64 1:11.
- Worked on: M1-03, its last part (tracking issue #270).
- Result: PR (this one). `test/fixtures/roms/manifest.json` pins `roms/ps2/galleon-ps2-hello.iso` by its raw URL at 585653d with its hash and size (ADR 0008); THIRD_PARTY.md's test payloads part has its `ps2-hello` notice, naming what is linked into it; run.sh names ARMSX2 that payload and asks for `launch.armsx2` and `exit.armsx2` whenever it was copied, as for RetroArch's GBA payload. docs/TESTING.md says so.
- Evidence: device-bundle.test.ts "run.sh copies the payloads into the test home, names each emulator its own, and empties the ROM folder" failed on the old run.sh and passes now; "the real manifest's payloads all have their notice in THIRD_PARTY.md" and "every payload run.sh names is one the real manifest pins" pass. `node scripts/agent/fetch-fixtures.mjs` fetched the ISO at the pinned URL, sha256 3fcccf40… as pinned. `scripts/agent/check.sh` green; `python3 -B -m unittest discover -s test/device` 188 OK. `test:app` not run: no renderer, IPC or launch code changed.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M1-03. The next nightly asks for `launch.armsx2` and `exit.armsx2`; they skip as `missing-bios` if the Nova has no PS2 BIOS, or as missing if ARMSX2 is not installed.
- Next: `node scripts/agent/next.mjs`.

## 2026-10-25 23:01 UTC session 01AuHPkRH6XWYwPN87wpup2F (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4. #277 (M1-03's last part) merged at 9f33312; CI x64 10:17, arm64 1:02 (x64 over the 10-minute target, under the 20-minute limit).
- Worked on: M1-04, its first two acceptance lines (tracking issue #278).
- Result: PR (this one). `src/config/emulators/dolphin/index.ts`: flatpak `org.DolphinEmu.dolphin-emu` (then `dolphin-emu` on PATH), ES-DE rule `DOLPHIN`, systems `gc` and `wii`, `-b -C Dolphin.Display.Fullscreen=True -e <rom>`; Dolphin reads a `.m3u` itself. GameCube memory cards `dolphin-emu/GC` (XDG data, inside the flatpak's tree for the flatpak) declared `shared`, with `saves.dolphinStandalone` (all four catalogues) as the Saves tab's reason; no states (named after the game's ID), no BIOS, no sandbox recipe yet. The `-C` syntax and key were read in Dolphin at e6f3ae17 (the research pin) and are the same at master 3eb30c76: `CommandLineConfigLayerLoader` in `UICommon/CommandLineParse.cpp`, `System::Main` named `Dolphin` in `Common/Config/Config.cpp`, `MAIN_FULLSCREEN` = `Display`/`Fullscreen` in `Core/Config/MainSettings.cpp`, `.m3u` in `Core/Boot/Boot.cpp`.
- Evidence: registry.test.ts "Dolphin boots an .iso, an .rvz or a two-disc .m3u fullscreen without its main window", "Dolphin is found as the catalog flatpak first, then on PATH", "Dolphin runs GameCube and Wii games only", the dirs test; savepaths.test.ts "Dolphin's shared memory cards are not synced, and the Saves tab is told why". `scripts/agent/check.sh` green; `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root); `npm run shots:nova` 21 screens: looked at `emulators.png` (Dolphin the last row, Not installed, 2 platforms, Install, its down arrow disabled).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.dolphin` needs a sandbox recipe (`-u <sandbox user folder>`), a GameCube homebrew `.dol` in the M0-07 manifest, and run.sh asking for it.
- Next: M1-04 part 2, the sandbox recipe.

## 2026-10-26 00:30 UTC session 01GUrAuV9efftewhHNN3vDe2 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #279 (Dolphin's descriptor) merged at 4cb5d23.
- Worked on: M1-04 part 2, Dolphin's sandbox recipe (tracking issue #278).
- Result: PR (this one). `-u <sandbox>/data/dolphin-emu` names Dolphin's user folder, which `UICommon::SetUserDirectory` takes before a `portable.txt`, `DOLPHIN_EMU_USERPATH` or the XDG roots; `Config/Dolphin.ini` there answers the usage-statistics question, which `DolphinQt/Main.cpp` asks on a first start even in batch mode (both read at e6f3ae17). Only the program on PATH is started; the flatpak, armadaOS's install, stays `cannot-sandbox` (`flatpak-install`) until the parked flatpak sandbox (#155) lands. No BIOS needed. docs/TESTING.md says so under the emulator sandbox.
- Evidence: selftestsandbox.test.ts "gives Dolphin a user folder in the sandbox, where XDG_DATA_HOME would lead it", "answers the usage-statistics question in the user folder, so no window asks it", "is not started as the flatpak". `scripts/agent/check.sh` green. `test:app` not run: no renderer, IPC or launch argv changed (`npx install-electron` also failed on this VM).
- Evaluator: PASS (`-u` outranks the other lookups, the analytics prompt ignores batch mode, nothing escapes the sandbox). Its note: even after part 3, `launch.dolphin` skips on the Nova until flatpaks can be sandboxed, so READY-FOR-DEVICE alone will not get M1-04 to a device pass.
- CI: the first x64 run failed `features-check`, because this entry first carried a time later than the run.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. On the Nova `launch.dolphin` will skip as `cannot-sandbox` while Dolphin is the flatpak.
- Next: M1-04 part 3, a GameCube homebrew `.dol` of our own (ADR 0008) in the M0-07 manifest and run.sh asking for `launch.dolphin`.

## 2026-10-26 00:53 UTC session 01GUrAuV9efftewhHNN3vDe2 (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4. #280 (Dolphin's sandbox recipe) merged at 39a6410; CI x64 9:18, arm64 1:08.
- Worked on: M1-04 part 3a, the GameCube payload of `launch.dolphin` (tracking issue #278).
- Result: PR (this one). `test/fixtures/homebrew/gc-hello/`: `main.c` draws one line with libogc's console and waits on vertical sync; `build.sh` builds it in `devkitpro/devkitppc` pinned by digest and writes `galleon-gc-hello.dol`, committed beside its source (ADR 0008). README names what is linked in (libogc zlib/BSD, newlib, libgcc with the runtime exception).
- Evidence: two builds give sha256 `030ca8b7f60442fd02198f5fdaf08c1ef6a4be06c19648d9cd7f25f2b0744991` (96512 bytes); the DOL header has text0 at 0x80003100 and the same entry point, and the text is in it. `scripts/agent/check.sh` green. Not booted on the VM (no Dolphin here).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-04 part 3b: the manifest entry at this PR's merge commit (`roms/gc/…`), its THIRD_PARTY.md notice, and run.sh asking for `launch.dolphin`/`exit.dolphin` with it; then READY-FOR-DEVICE M1-04, noting that on the Nova it skips as `cannot-sandbox` while Dolphin is the flatpak.

## 2026-10-26 01:34 UTC session 016MNpC8BmKqhA6XiCP8yYYk (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #281 (the GameCube `.dol`) merged at 2faac06; CI x64 9:44, arm64 1:06.
- Worked on: M1-04 part 3b, the last part (tracking issue #278).
- Result: PR (this one). `test/fixtures/roms/manifest.json` pins `roms/gc/galleon-gc-hello.dol` by its raw URL at 2faac06 with its hash and size (ADR 0008); THIRD_PARTY.md's test payloads part has its `gc-hello` notice, naming what is linked in; run.sh names Dolphin that payload and asks for `launch.dolphin` and `exit.dolphin` whenever it was copied, as for ARMSX2's disc. docs/TESTING.md says so, and that both checks skip as `cannot-sandbox` while Dolphin is the flatpak.
- Evidence: device-bundle.test.ts "run.sh copies the payloads into the test home, names each emulator its own, and empties the ROM folder" failed before the run.sh change and passes now (file 63/63); `node scripts/agent/fetch-fixtures.mjs` fetched the `.dol` at the pinned URL, hash as pinned. `scripts/agent/check.sh` green; `python3 -B -m unittest discover -s test/device` 188 OK. `test:app` not run: no renderer, IPC or launch code changed.
- Evaluator: PASS (pinned URL fetched and hashed, `gc` folder resolves to Dolphin, the `cannot-sandbox` skip matches `planSandbox`).
- CI: the first x64 run failed `pr-body`, because the PR body had no `Feature:` line.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M1-04. On the Nova `launch.dolphin` and `exit.dolphin` skip as `cannot-sandbox` while Dolphin is armadaOS's flatpak; a device pass needs the parked flatpak sandbox (#155).
- Next: `node scripts/agent/next.mjs`.

## 2026-10-26 01:58 UTC session 016MNpC8BmKqhA6XiCP8yYYk (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4. #282 (M1-04's last part) merged at d8b15ba; CI x64 10:00, arm64 1:07 (x64 at the 10-minute target, under the 20-minute limit). #278 left open for device results.
- Worked on: M1-05 part 1, PPSSPP's descriptor (tracking issue #283).
- Result: PR (this one). `src/config/emulators/ppsspp/index.ts`: flatpak `org.ppsspp.PPSSPP` (then `PPSSPPSDL` or `ppsspp` on PATH), ES-DE rule `PPSSPP`, system `psp`, `--fullscreen --pause-menu-exit <rom>`. Saves `ppsspp/PSP/SAVEDATA` in the config folder (inside the flatpak's tree for the flatpak) declared `shared` with the existing `saves.ppsspp` reason, since the folders and states are named after the game id inside the image; no states, no BIOS, no sandbox recipe yet. Flags and the boot-file rule read in PPSSPP at 13c1773b (the research pin): `Core/CmdLine.cpp` (`--fullscreen` kept out of the saved settings, `--pause-menu-exit`, the first argument not beginning with a dash is the file), `UI/NativeApp.cpp` (`NativeInit` boots it).
- Evidence: registry.test.ts "PPSSPP boots an .iso or a .cso fullscreen, and its pause menu exits", "PPSSPP is handed the image inside a PSP game kept in a folder of its own" (`chooseLaunchFile` picks the inner `.cso` or `EBOOT.PBP`, the launch passes it), "PPSSPP is found as the catalog flatpak first, then on PATH", "PPSSPP runs PSP games only", the dirs test; savepaths.test.ts "PPSSPP's saves, named after the game id, are not synced, and the Saves tab is told why". `scripts/agent/check.sh` green; `npm run test:app` 244/244 (Electron through `ELECTRON_OVERRIDE_DIST_PATH` and a `--no-sandbox` wrapper in the scratchpad, as root); `npm run shots:nova` 21 screens: looked at `emulators.png` (Dolphin's down arrow now enabled, the PPSSPP row below the fold).
- Evaluator: PASS (comments match `CmdLine.cpp`/`NativeApp.cpp` at 13c1773b, the nested-folder test runs the production `chooseLaunchFile`). Its note for part 2: `--pause-menu-exit` is not kept out of the saved settings as `--fullscreen` is, so confirm in `Config.cpp` whether it lands in `ppsspp.ini`; inside the sandbox it would not reach the owner's.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.ppsspp` needs a sandbox recipe, a PSP homebrew payload in the M0-07 manifest, and run.sh asking for it.
- Next: M1-05 part 2, PPSSPP's sandbox recipe.

## 2026-10-26 02:30 UTC session 01YQHgaaGniWGgW5heN23pQb (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #284 (PPSSPP's descriptor) merged at faff518; CI x64 9:12, arm64 1:10.
- Worked on: M1-05 part 2, PPSSPP's sandbox recipe (tracking issue #283).
- Result: PR (this one). PPSSPP needs nothing beyond the sandbox's XDG roots: on Linux `NativeInit` (`UI/NativeApp.cpp` at 13c1773b) puts the whole memory stick, settings, saves, states and caches, in `ppsspp` under `XDG_CONFIG_HOME`, with no portable marker or `HOME` lookup ahead of it, and a first start shows only an on-screen hint, no window. So the recipe adds no arguments and no files; only the program on PATH is started, the flatpak stays `cannot-sandbox` (`flatpak-install`) until the parked flatpak sandbox (#155) lands. The evaluator's question from part 1 is answered: `PauseMenuExitsEmulator` is `CfgFlag::DONT_SAVE` in `Core/Config.cpp`, so `--pause-menu-exit` never reaches `ppsspp.ini`, like `--fullscreen` (`DoNotSaveSetting` in `Core/CmdLine.cpp`); the launch comment says so. docs/TESTING.md names it under the emulator sandbox.
- Evidence: selftestsandbox.test.ts "keeps the memory stick in the sandbox, where XDG_CONFIG_HOME leads PPSSPP", "is not started as the flatpak". `scripts/agent/check.sh` green. `test:app` not run: no renderer, IPC or launch argv changed.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.ppsspp` needs a PSP homebrew payload of our own in the M0-07 manifest and run.sh asking for it; on the Nova it will skip as `cannot-sandbox` while PPSSPP is the flatpak.
- Next: M1-05 part 3a, a PSP homebrew `EBOOT.PBP` of our own (ADR 0008).

## 2026-10-26 02:47 UTC session 01YQHgaaGniWGgW5heN23pQb (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4. #285 (PPSSPP's sandbox recipe) merged at 6cf2694; CI x64 8:43, arm64 1:09.
- Worked on: M1-05 part 3a, the PSP payload of `launch.ppsspp` (tracking issue #283).
- Result: PR (this one). `test/fixtures/homebrew/psp-hello/`: `main.c` draws one line with PSPSDK's debug screen and waits on vertical blank; `build.sh` builds it with PSPSDK's own `build.mak` in `pspdev/pspdev` pinned by digest and writes `galleon-psp-hello.pbp` (an EBOOT.PBP), committed beside its source (ADR 0008). README names what the compiler links in (PSPSDK BSD, newlib, pthread-embedded LGPL-2.1 with its MIT PSP port, libgcc with the runtime exception) and how the LGPL's relinking condition is met (the source, build script and pinned image).
- Evidence: two builds give sha256 `6dc85e791811cf4cb38b2a2cfa218bcef3c849dc2ef827c1ff09f6ca73e7d97c` (129920 bytes); the module name and the text are in it. `scripts/agent/check.sh` green. Not booted on the VM (no PPSSPP here).
- Evaluator: FAIL first, because the README left out pthread-embedded (LGPL-2.1), which psp-gcc's default link line adds to every program; then see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-05 part 3b: the manifest entry at this PR's merge commit (`roms/psp/…`), its THIRD_PARTY.md notice (pthread-embedded's LGPL included), and run.sh asking for `launch.ppsspp`/`exit.ppsspp` with it; then READY-FOR-DEVICE M1-05, noting that on the Nova it skips as `cannot-sandbox` while PPSSPP is the flatpak.

## 2026-10-26 03:27 UTC session 01YUwCCa7k17hSPfHmcwyWof (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #286 (the PSP `EBOOT.PBP`) merged at aa67b95; CI x64 10:36, arm64 1:10; `ci-times.mjs` median x64 9:39, arm64 1:09, under the target.
- Worked on: M1-05 part 3b, the last part (tracking issue #283).
- Result: PR (this one). `test/fixtures/roms/manifest.json` pins `roms/psp/galleon-psp-hello.pbp` by its raw URL at aa67b95 with its hash and size (ADR 0008). THIRD_PARTY.md's test payloads part has its `psp-hello` notice: PSPSDK, newlib, pthread-embedded and libgcc, how pthread-embedded's relinking condition is met, and the LGPL-2.1 text, which travels in the bundle beside the payload. run.sh names PPSSPP that payload and asks for `launch.ppsspp` and `exit.ppsspp` whenever it was copied, as for Dolphin's `.dol`. docs/TESTING.md says so, and that both checks skip as `cannot-sandbox` while PPSSPP is the flatpak.
- Evidence: device-bundle.test.ts "run.sh copies the payloads into the test home, names each emulator its own, and empties the ROM folder" failed before the run.sh change and passes now (file 63/63); `node scripts/agent/fetch-fixtures.mjs` fetched the `.pbp` at the pinned URL, hash as pinned; `payloadNotices` keeps the LGPL text whole. `scripts/agent/check.sh` green; `python3 -B -m unittest discover -s test/device` 188 OK. `test:app` not run: no renderer, IPC or launch code changed.
- Evaluator: FAIL first: the notice met the LGPL's relinking condition but offered no source of pthread-embedded at the version linked, and called a Vita port's MIT file the PSP port's. Now the notice and README name the commit the pinned image builds (97fe4ce, from its `build.txt`), `test/fixtures/homebrew/psp-hello/pthread-embedded-97fe4ce.tar.gz` (`git archive` of it, `gzip -n`, two runs same sha256 `8a0055ca…`) is offered beside the program, and the MIT claim is gone; then see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M1-05. On the Nova `launch.ppsspp` and `exit.ppsspp` skip as `cannot-sandbox` while PPSSPP is armadaOS's flatpak; a device pass needs the parked flatpak sandbox (#155).
- Next: `node scripts/agent/next.mjs`.

## 2026-10-26 07:51 UTC session 01NTbrScwiaG4Lr23Vr3gU6g (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #287 (M1-05's last part), green and evaluator PASS but left open by the previous run, merged at 59e3128; CI x64 9:42, arm64 1:03. READY-FOR-DEVICE M1-05 stands; #283's claim released, left open for device results.
- Worked on: M1-06 part 1, Flycast's descriptor (tracking issue #288).
- Result: PR (this one). `src/config/emulators/flycast/index.ts`: flatpak `org.flycast.Flycast` (then `flycast` on PATH), ES-DE rule `FLYCAST`, system `dreamcast`, launch `<rom>` alone. VMUs and BIOS in the data folder (`flycast` under the flatpak's data); VMUs declared `shared` with a new `saves.flycastStandalone` reason in all four catalogues (the RetroArch-core reason says states are synced, which is not so here); no states. Read in Flycast at 0d9853df (the research pin): `core/cfg/cl.cpp` (first non-dash argument is the content, `.chd`/`.cdi`/`.gdi`/`.cue`; no `--`), `core/ui/gui.cpp` (content from the command line starts at once and the menu's "Exit" calls `dc_exit`), `core/oslib/oslib.cpp` (`findFlash` falls back to the data folder). No fullscreen flag: `sdl_window_destroy` (`core/sdl/sdl.cpp`) writes the window's fullscreen state back into `emu.cfg` with `saveBool`, so a transient `-config window:fullscreen=yes` would end up in the user's settings; gamescope shows the window full screen in Game Mode. Found: Flycast reads the flash as `dc_nvmem.bin` (`core/hw/flashrom/nvmem.cpp`), so a `dc_flash.bin` from RomM is placed but not read; without it Flycast makes a fresh flash.
- Evidence: registry.test.ts "Flycast is handed a .chd, a .cdi or a .gdi alone, and nothing that would outlive the game", "Flycast is found as the catalog flatpak first, then on PATH", "Flycast runs Dreamcast games only", the dirs test; bios.test.ts "Flycast takes the Dreamcast boot ROM and flash into its data folder"; savepaths.test.ts "Flycast's shared VMUs are not synced, and the Saves tab is told why". `scripts/agent/check.sh` green; `npm run shots:nova` 21 screens: looked at `emulators.png` (unchanged above the fold; the Flycast row is below Dolphin and PPSSPP).
- Evaluator: PASS (each Flycast source claim confirmed at 0d9853df; note: `data/flycast` also holds states and BIOS, which matters if VMU sync is ever turned on). `test:app` 243/244 on the VM: `perf.test.ts` "a 30 s scroll down the grid logs its summary" (768 frames, too few) while the commit hook's build ran beside it; no renderer code changed, CI's x64 leg is the judge.
- CI: the first x64 run failed `features-check`, because this entry first carried a time later than the run.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.flycast` needs a sandbox recipe, a Dreamcast homebrew payload in the M0-07 manifest, and run.sh asking for it.
- Next: M1-06 part 2, Flycast's sandbox recipe (XDG roots should suffice, per `core/linux-dist/main.cpp`; check the first-start windows).

## 2026-10-26 08:36 UTC session 01DSCaRLYevreq3RyPzDmE66 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #289 (Flycast's descriptor) merged at 902387b; CI x64 8:23, arm64 1:06.
- Worked on: M1-06 part 2, Flycast's sandbox recipe (tracking issue #288).
- Result: PR (this one). Read in Flycast at 0d9853df: saves (`emu.cfg`, VMUs, `dc_nvmem.bin`, states) go under `XDG_CONFIG_HOME/flycast` or `XDG_DATA_HOME/flycast` (`core/linux-dist/main.cpp`, `getFlashSavePath`/`getVmuPath` in `core/oslib/oslib.cpp`), but a VMU missing there is looked for in the `XDG_DATA_DIRS`/`XDG_CONFIG_DIRS` folders, and one found is moved into the sandbox and the original deleted (`maple_sega_vmu` in `core/hw/maple/maple_devs.cpp`), and `emu.cfg` is read from the first config folder holding one, and the system folders (`/etc/flycast`, `/etc/xdg/flycast`, `XDG_CONFIG_DIRS`) follow the user's (`get_readonly_config_path` in `core/stdclass.cpp`); such a file could name save or VMU paths outside the sandbox. So the recipe writes the sandbox's own `config/flycast/emu.cfg` (`[window] fullscreen = yes`, which Flycast writes back only into that file), removes `XDG_DATA_DIRS`, `XDG_CONFIG_DIRS` (leaving the XDG defaults in `/usr` and `/etc`, which the owner cannot write to) and `FLYCAST_BIOS_PATH`, and puts the owner's BIOS copies in `data/flycast`, where Flycast looks first; `needsBios` false (HLE BIOS without `dc_boot.bin`). The onboarding window opens only when the config folder is unset, never on Linux (`flycast_init` in `core/nullDC.cpp`). The flatpak stays `cannot-sandbox` (`flatpak-install`) until #155's flatpak sandbox. docs/TESTING.md names it under the emulator sandbox.
- Evidence: selftestsandbox.test.ts "Flycast's recipe": "writes its own emu.cfg where Flycast reads it first, with the window fullscreen", "takes copies of the owner BIOS into its data folder and no BIOS folder of the owner", "searches no inherited data or config folder, where a VMU found would be moved away" (failed before the variables were removed), "is not started as the flatpak" (file 74/74). `scripts/agent/check.sh` green. `test:app` not run: no renderer, IPC or launch argv changed.
- Evaluator: FAIL first: a VMU found in an inherited `XDG_DATA_DIRS` folder (flatpak's exports under `HOME` in a Steam session) would be moved into the sandbox and deleted; now both variables are removed; then see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.flycast` needs a Dreamcast homebrew payload of our own in the M0-07 manifest and run.sh asking for it.
- Next: M1-06 part 3a, a Dreamcast homebrew of our own (ADR 0008).

## 2026-10-26 09:35 UTC session 01Typ7m8nodVAyPTMhZBx9zW (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #290 (Flycast's sandbox recipe) merged at 804f5c1.
- Worked on: M1-06 part 3a, the Dreamcast payload of `launch.flycast` (tracking issue #288).
- Result: PR (this one). `test/fixtures/homebrew/dc-hello/`: `main.c` clears the screen, draws one line in the BIOS font and waits on vertical blank; `build.sh` builds it with KallistiOS's `kos-cc` in `kazade/dreamcast-sdk` pinned by digest (KallistiOS at 5e89c26a) and writes `galleon-dc-hello.elf`, committed beside its source (ADR 0008). An ELF needs no disc image: Flycast at 0d9853df loads an `.elf` itself and boots it through its HLE BIOS (`loadGame` in `core/emulator.cpp`, `reios_loadElf`, `reios_setup_state(0x8C010000)` in `core/reios/`), whose `reios_sys_font` serves the BIOS font from its own `fonts/biosfont.bin`. README names what `kos-cc` links in (KallistiOS under the KOS License, BSD-3-Clause; newlib; libgcc with the runtime exception) and carries the KOS notice its binary-form clause asks for; no GPL or LGPL file is in KallistiOS's kernel.
- Evidence: two builds give sha256 `6d8f7f4a235390b7870be604f6dd3f2ae3a23bddb1041201e965d76cebccee75` (201140 bytes), SH ELF, entry and first load segment at 0x8c010000, where reios starts it; the text is in it. `scripts/agent/check.sh` green. Not booted on the VM (no Flycast here).
- Evaluator: PASS (rebuilt twice to the same sha256; Flycast's ELF path and HLE font confirmed at 0d9853df; a link map shows only libkallisti, libc, libm and libgcc members, no GPL or LGPL). Note: the ELF carries the image's own KOS build date and path, fixed by the digest.
- CI: the first x64 run failed `pr-body`, because the body had no `Feature:` line; the body is fixed and this push proves it.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-06 part 3b: the manifest entry at this PR's merge commit (`roms/dreamcast/…`), its THIRD_PARTY.md notice, and run.sh asking for `launch.flycast`/`exit.flycast` with it (check the descriptor accepts `.elf`, or how run.sh names the payload); then READY-FOR-DEVICE M1-06 (skips as `cannot-sandbox` while Flycast is the flatpak).

## 2026-10-26 10:27 UTC session 0112v3sFvJyC4FpR9m9VLhRp (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #291 (the Dreamcast ELF) merged at c587caf; both `build` legs green on `main`.
- Worked on: M1-06 part 3b, the last part (tracking issue #288).
- Result: PR (this one). `test/fixtures/roms/manifest.json` pins `roms/dreamcast/galleon-dc-hello.elf` by its raw URL at c587caf with its hash and size (ADR 0008); the folder is the system id `dreamcast`, which `payloadFor` hands to Flycast's plan, and the descriptor takes the path as given whatever its extension. THIRD_PARTY.md's test payloads part has its `dc-hello` notice: KallistiOS at 5e89c26a with the KOS License text its binary-form clause asks for, newlib and libgcc. run.sh names Flycast that payload and asks for `launch.flycast` and `exit.flycast` whenever it was copied, as for PPSSPP's `.pbp`. docs/TESTING.md says so, and that both skip as `cannot-sandbox` while Flycast is the flatpak.
- Evidence: device-bundle.test.ts "run.sh copies the payloads into the test home, names each emulator its own, and empties the ROM folder" failed before the run.sh change (62/1) and passes now (63/63); `node scripts/agent/fetch-fixtures.mjs` fetched the `.elf` at the pinned URL, hash as pinned. `scripts/agent/check.sh` (see the PR). `test:app` not run: no renderer, IPC or launch code changed.
- Notes: `dockerd` was not running at session start (a stale pid file); started by hand.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M1-06. On the Nova `launch.flycast` and `exit.flycast` skip as `cannot-sandbox` while Flycast is armadaOS's flatpak; a device pass needs the parked flatpak sandbox (#155).
- Next: `node scripts/agent/next.mjs`.

## 2026-10-26 11:29 UTC session 019jWwoZNmkYdKc1GsxATXcr (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #292 (M1-06's last part) merged at 20af7df; READY-FOR-DEVICE M1-06 stands.
- Worked on: M1-07 part 1, melonDS's descriptor (tracking issue #293).
- Result: PR (this one). `src/config/emulators/melonds/index.ts`: the catalog's AppImage `~/Applications/melonDS*.AppImage` (downloads from the `virtudude/melonDS` releases the catalog installs from, AppImages only), then `melonDS` on PATH; ES-DE rule `MELONDS`, system `nds`, launch `-f <rom>`. Read at the catalog's `drm-leasing` commit 12891b6: `src/frontend/qt_sdl/CLI.cpp` (`-f` is `--fullscreen`; the first positional is the DS ROM, booted at once) and `EmuInstance.cpp` (`getAssetPath`: with an empty `SaveFilePath`, as Armada's template leaves it, the save is `<rom dir>/<rom stem>.sav`). Saves are `perRom` in the ROM's own folder; states (`.mlN`, also beside the ROM) stay on the device; Armada's template sets `ExternalBIOSEnable = false`, so no BIOS folder. No sandbox recipe yet, so the self-test never starts it.
- Evidence: registry.test.ts melonDS tests (install order, ES-DE find rule in a fake home, release assets, systems, argv, dirs); savepaths.test.ts "melonDS's saves are looked for beside the ROM, named after it"; savesync.test.ts "saves kept beside the ROM": a push preview with the ROM, its `.sav`, a `.ml1` state and another game's `.sav` in one folder offers only the `.sav`, and a pull writes the `.sav` beside the ROM. `scripts/agent/check.sh` green; `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root); `npm run shots:nova` 21 screens: looked at `emulators.png` (unchanged above the fold; the melonDS row is below Flycast).
- Evaluator: FAIL first, only for this entry missing; PASS otherwise (each source claim confirmed at 12891b6 and Armada 816091ec). Note kept: in a flat ROM folder `looseStem` lets `Game (Europe).sav` match `Game (USA).nds`, as in every shared per-ROM folder already.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.melonds` needs a sandbox recipe, an NDS homebrew payload of our own, and run.sh asking for it.
- Next: M1-07 part 2, melonDS's sandbox recipe (its config folder is `QStandardPaths::ConfigLocation`/melonDS unless a `portable` folder sits beside the program, `main.cpp`; check first-start dialogs and that `SaveFilePath` stays empty in the sandbox's `melonDS.toml`).

## 2026-10-26 12:34 UTC session 015PiXrJ4qQhxq2hRj3FPz49 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #294 (melonDS's descriptor) merged at 293664b; CI x64 10:44, arm64 2:34.
- Worked on: M1-07 part 2, melonDS's sandbox recipe (tracking issue #293).
- Result: PR (this one). Read at the catalog's `drm-leasing` commit 12891b6: melonDS keeps `melonDS.toml` (and a legacy `melonDS.ini`, read the same way) and its other files in `melonDS` under Qt's config location, `XDG_CONFIG_HOME` (`pathInit` in `src/frontend/qt_sdl/main.cpp`, `GetLocalFilePath` in `Platform.cpp`); an empty folder is its defaults: `SaveFilePath`/`SavestatePath` empty (saves and states beside the ROM it is handed), external BIOS off (no dump, no dialog before the game; `Config.cpp`). So the recipe adds nothing and is the AppImage's only: a `portable` folder beside the program outranks the config location, and inside the mounted image none of the owner's can sit there. Found by the evaluator and fixed for every AppImage: the AppImage type2 runtime makes a writable `<file>.home` or `<file>.config` folder beside the AppImage the program's `HOME` or `XDG_CONFIG_HOME` over the sandbox's (`set_portable_home_and_config`), so `planSandbox` now skips such an install as `cannot-sandbox` / `appimage-portable-folder`, looking beside the path as given and as its links lead. docs/TESTING.md says both.
- Evidence: selftestsandbox.test.ts "melonDS's recipe" (3 tests; 2 failed before the descriptor change), planSandbox "starts no AppImage whose runtime would give it a HOME or config folder of its own" (failed before the `planSandbox` change); the other recipe tests take a `present` `realPath` with no such folders; `src/main/selftest*.test.ts` 299/299. `scripts/agent/check.sh` (see the PR). `test:app` not run: no renderer, IPC or launch argv changed.
- Notes: Docker Hub answered 429 to `init.sh`'s mariadb pull, so the Docker RomM was not up; nothing here touches the client.
- Evaluator: FAIL first (the AppImage runtime's `.home`/`.config` folders; and the comment said the self-test copies the ROM, while it hands melonDS the payload's own path); then see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.melonds` needs an NDS homebrew payload of our own in the M0-07 manifest and run.sh asking for it; the save half of its acceptance needs the save found beside the payload.
- Next: M1-07 part 3a, an NDS homebrew of our own (ADR 0008, as the Dreamcast ELF).

## 2026-10-26 13:02 UTC session 015PiXrJ4qQhxq2hRj3FPz49 (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #295 (melonDS's sandbox recipe) merged at 3b9d7ab; CI x64 9:02, arm64 0:59.
- Worked on: M1-07 part 3a, the NDS payload of `launch.melonds` (tracking issue #293).
- Result: PR (this one). `test/fixtures/homebrew/nds-hello/`: `main.c` prints one line with libnds's `consoleDemoInit` and waits on vertical blank; `Makefile` sets the banner, an icon of our own (`icon.bmp`, a plain frame, since BlocksDS's `sys/icon.bmp` states no licence) and BlocksDS's `arm7_minimal.elf` (libnds alone, no dswifi or maxmod), then includes BlocksDS's ARM9 ROM makefile; `build.sh` builds it in `skylyrac/blocksds` pinned by digest (BlocksDS 1.13.1, core at 245a25c3) and writes `galleon-nds-hello.nds`, committed beside its source (ADR 0008). README names what is linked in: libnds (zlib), BlocksDS's `sys/crts` start-up code and linker scripts (zlib and MPL-2.0, source at github.com/blocksds/sdk), picolibc (BSD-style) and libgcc (runtime exception); FatFs is not linked.
- Evidence: two builds give sha256 `664c24a346a48584d62e0809edf0d37c9f4f32b954f4b817d1d49fff90b52ee6` (66560 bytes); the text is in it; the link map lists only `libnds9.a`, `ds_arm9_crt0.o`, picolibc's `libc.a`, `libgcc.a` and GCC's `crtend.o`/`crtn.o`. `scripts/agent/check.sh` (see the PR). Not booted on the VM (no melonDS here).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-07 part 3b: the manifest entry at this PR's merge commit (`roms/nds/galleon-nds-hello.nds`), its THIRD_PARTY.md notice, and run.sh asking for `launch.melonds`/`exit.melonds` with it; the save half of `launch.melonds` (a save beside the ROM found by save discovery) needs a payload that writes cartridge save memory, or a check that places one, still to be decided.

## 2026-10-26 13:46 UTC session 01HpJi2JLryiY3kNJ8EqPff6 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #296 (the NDS ROM) merged at cef92ca.
- Worked on: M1-07 part 3b (tracking issue #293).
- Result: PR (this one). `test/fixtures/roms/manifest.json` pins `roms/nds/galleon-nds-hello.nds` by its raw URL at cef92ca with its hash and size (ADR 0008); the folder is melonDS's system id `nds`. THIRD_PARTY.md's test payloads part has its `nds-hello` notice: libnds (zlib), BlocksDS's `sys/crts` (zlib and MPL-2.0, with where its source form is), picolibc and libgcc. run.sh names melonDS that payload and asks for `launch.melonds` and `exit.melonds` whenever it was copied, as for Flycast's `.elf`; docs/TESTING.md says so.
- Evidence: device-bundle.test.ts "run.sh copies the payloads into the test home, names each emulator its own, and empties the ROM folder" failed before the run.sh change and passes now (63/63); `node scripts/agent/fetch-fixtures.mjs` fetched the `.nds` at the pinned URL, hash as pinned. `scripts/agent/check.sh` green (3:33). `test:app` not run: no renderer, IPC or launch code changed.
- Notes: Docker Hub answered 429 to `init.sh`'s mariadb pull again, so the Docker RomM was not up; nothing here touches the client.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `launch.melonds`'s save half (a save beside the ROM in the sandbox found by save discovery) is not asked for yet; until it is, M1-07 is not READY-FOR-DEVICE.
- Next: M1-07 part 3c, the save half of `launch.melonds`: read how `savingPayloads` and the self-test's save check work for RetroArch, then either a payload that writes cartridge save memory or the check placing a `.sav` beside the payload in the sandbox; then READY-FOR-DEVICE M1-07.

## 2026-10-26 14:36 UTC session 01TrUuuo1jB1rFDbbxjrTDGM (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #297 (M1-07 part 3b) merged at b6c88e3; both `build` legs green on `main`.
- Worked on: M1-07 part 3c, the save half of `launch.melonds` (tracking issue #293).
- Result: PR (this one). melonDS gives a homebrew ROM no save memory (catalog fork 12891b6, `src/NDSCart.cpp`: `header.IsHomebrew()` sets `SaveMemType = 0` and makes a `CartHomebrew`), so our payload cannot write a `.sav`. Instead `placeSaveBeside` (`src/main/selftestemulators.ts`) asks the descriptor where the payload's saves are, in its sandbox; when that is the payload's own folder, named after the ROM (only melonDS today), it writes `<stem>.sav` there before the cycle (never over a file already there), and after the stop `launch.<emulator>` must have save discovery find it, else `save-not-found` (metric `saveFound`, threshold 1); a save that cannot be placed (a file already there, a failed write, a descriptor that throws) fails it as `save-not-placed` rather than leave the save half unasked. The placed save is removed after the cycle whatever happened. Save discovery is the sync's own: `SaveSync.findLocal`'s body moved, unchanged, into the exported `findLocalAssets` in `src/main/saves.ts`, and the method delegates to it. `savewriter.allowlist.test.ts` names `selftestemulators.ts` and what it writes. docs/TESTING.md says all of it.
- Evidence: selftestemulators.test.ts "a save placed beside the payload" (7 tests: found passes with the metric; not placed fails `save-not-placed`; not found fails `save-not-found` and the save is still removed; another failure keeps its reason; skip/error left as is; a throwing cycle still removes; nothing placed for a skipped plan) and "placeSaveBeside" (5 tests against the real melonDS and DuckStation descriptors in a scratch home: placed beside the ROM, found by `findLocalAssets`, removed; a removed save is not found; an existing `.sav` is neither overwritten nor removed, and is reported not placed; DuckStation and an unknown emulator get none); 44/44. savesync.test.ts and saves.test.ts 150/150 after the move. `scripts/agent/check.sh` green before each push (2383 unit tests and the coverage floors). The first CI run failed only the PR-body gate (no `Feature:` line), fixed in the body. `test:saves` not run here: Docker Hub answered 429 to the mariadb pull again; CI runs it. `test:app` not run: no renderer, IPC or launch argv changed.
- Evaluator: FAIL first (a save that could not be placed left `launch` passing with its save half unasked; now `save-not-placed`); then see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M1-07. On the Nova `launch.melonds` and `exit.melonds` run when the catalog's melonDS AppImage is installed (no `.home`/`.config` folder beside it); otherwise they skip `not-installed` or `cannot-sandbox`.
- Next: `node scripts/agent/next.mjs`.

## 2026-10-26 16:27 UTC session 01NRpKWyAncrau2YBP689x5h (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #298 (M1-07 part 3c) merged at d1f9aac; READY-FOR-DEVICE M1-07 stands.
- Worked on: M1-08 part 1, RetroArch's core variants (tracking issue #299).
- Result: PR (this one). `src/config/emulators/retroarch/index.ts`: `CORE_CHOICES` gives RetroArch launch variants for the systems the owner plays in Argosy's cores on Android: SNES `snes9x`, GBA `mgba`, PlayStation `swanstation` (the mapped default, first), `pcsx_rearmed` and `mednafen_psx_hw`, PSP `ppsspp`, GameCube/Wii `dolphin`, Dreamcast/NAOMI/Atomiswave `flycast`; one entry asks nothing, so only PlayStation offers a choice. The chosen variant is the core `launch` names, `core` installs (`CoreContext` now carries `variant`, `missingCore` takes it from the launch) and `saves` sorts into (`PCSX-ReARMed` and `Beetle PSX HW` added to `CORE_LIBRARY_NAMES`, read from each core's `retro_get_system_info` at pcsx_rearmed c8816799 and beetle-psx-libretro 7fea57a5); a recorded core that is not one of the system's runs nothing. Fixed on the way: with no `retroarch.cfg` yet, an arm64 machine fetched cores from the buildbot's `linux/arm64/`, which does not exist (404); it is `linux/aarch64/`.
- Evidence: registry.test.ts "RetroArch offers the Android-matching cores, and launches the one chosen" and "every RetroArch variant is a core the buildbot publishes for Linux on aarch64" (against `test/fixtures/buildbot/linux-aarch64-cores.txt`, 235 cores read from the buildbot's index on 2026-10-26; its README says how to refresh it); savepaths.test.ts "sorted by core, the folder is the chosen variant core"; cores.test.ts "the core named is the chosen variant, not the system default", and "and one it does publish for falls back to the buildbot on its own" now asks for `linux/aarch64/` (failed before the fix). `scripts/agent/check.sh` green; `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root).
- Notes: Docker's daemon was not answering, so `init.sh` stopped before the Docker RomM; nothing here touches the client.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-08 part 2, the launcher-owned appended config (`--appendconfig` from the launcher's home with `quit_on_close_content = "2"`, a snapshot test, `retroarch.cfg` never edited); then the flatpak core folder, and `launch.retroarch` on a SNES homebrew leaving an `.srm`.

## 2026-10-26 16:55 UTC session 01NRpKWyAncrau2YBP689x5h (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #300 (M1-08 part 1) merged at 83518ab; CI x64 9:09, arm64 1:04.
- Worked on: M1-08 part 2, the launcher-owned appended config (tracking issue #299).
- Result: PR (this one). Descriptors gain `launchFiles` (files of the app's own a launch reads, written fresh before every launch into `LaunchContext.launcherDir`, `<root>/config/launch/<emulator>`; `src/main/launchfiles.ts` writes each whole through a rename and refuses a name that is not a plain file name). RetroArch's is `retroarch-append.cfg`, which `launch` names with `--appendconfig`: `quit_on_close_content = "2"` (Close Content quits a RetroArch started with content, back to Galleon) and `config_save_on_exit = "false"`, because RetroArch's `config_save_file` (`configuration.c` at e49b6298) writes every setting in force, the appended ones too, into `retroarch.cfg` on exit; with it off a launch never edits the player's file. The flatpak reads it: Flathub's manifest (78aaa8d6) grants `--filesystem=host`. The self-test gives `launch` the sandbox's root as `launcherDir`, and RetroArch's recipe writes its appended file there under the same name, carrying the launch settings and the sandbox folders, since RetroArch keeps only the last `--appendconfig` and a second one would have dropped the sandbox's folders. The launcher writes the files before the save pull, so a launch that cannot have them fails before saves move.
- Evidence: registry.test.ts "RetroArch's appended config is RomMix's own file, and never its retroarch.cfg" (the snapshot `test/fixtures/snapshots/retroarch-append.cfg`; the argv names it and no `retroarch.cfg`), "no other emulator has launch files yet", the field-order test with `launchFiles`; selftestsandbox.test.ts "starts on a config of its own, with the sandbox folders in the one config the launch appends" (exactly one `--appendconfig`, the sandbox's) and "carries every launch's appended settings, so Close Content quits as in play"; launchfiles.test.ts (3: written whole and replaced, a path or hidden name refused with nothing written, no files no folder). savewriter.allowlist names `launchfiles.ts`. `scripts/agent/check.sh` green; `npm run test:app` 244/244. New string `launch.badLaunchFile` in all four catalogues, English in fr/de/es marked `// TODO(i18n)`.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-08 part 3, the flatpak core folder (`~/.var/app/org.libretro.RetroArch/config/retroarch/cores`) and `launch.retroarch` on a SNES homebrew leaving an `.srm` (a SNES payload of our own with battery-backed SRAM, `savingPayloads`); the self-test still skips flatpaks as `cannot-sandbox` (#155).

## 2026-10-26 18:26 UTC session 01Vkz7fDjjpqSPy19EqnQqFK (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #301 (M1-08 part 2) merged at fd6e703.
- Worked on: M1-08 part 3a, the flatpak core folder (tracking issue #299).
- Result: PR (this one), a test only. The probe gives the RetroArch flatpak its own tree as `configDir` (`~/.var/app/org.libretro.RetroArch/config`), and `requiredCore` already falls back to `retroarch/cores` under it, or takes `libretro_directory` from the flatpak's `retroarch.cfg`; nothing pinned that the two meet. emulators.test.ts "RetroArch's flatpak gets its cores in its own tree, with or without a config yet" probes RetroArch through a fake `flatpak` and asks `missingCore` for a SNES core: the folder is `~/.var/app/org.libretro.RetroArch/config/retroarch/cores` with no config, and again with a config naming it from `~`. `fakeFlatpak` takes the app id it answers for.
- Evidence: the test passes, and fails when the expected folder is changed; `scripts/agent/check.sh` green (3:34). `test:app` not run: no renderer, IPC or launch code changed.
- Notes: Docker's daemon was not answering, so `init.sh` stopped before `npm ci`; ran `npm ci` by hand.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-08 part 3b, a SNES homebrew of our own with battery SRAM for `launch.retroarch` leaving an `.srm` (ADR 0008, as the NDS ROM); `launch.retroarch` on the Nova still skips while RetroArch is the flatpak (#155, flatpak sandbox parked).

## 2026-10-26 18:47 UTC session 01Vkz7fDjjpqSPy19EqnQqFK (hourly heartbeat, second unit)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #302 (M1-08 part 3a) merged at 1b648c3; CI x64 9:09, arm64 1:09.
- Worked on: M1-08 part 3b, the SNES payload of `launch.retroarch` (tracking issue #299).
- Result: PR (this one). `test/fixtures/homebrew/snes-save/`: `build.py` writes `galleon-snes-save.sfc`, a 128 KiB LoROM cartridge with battery-backed SRAM (header type `$02`, 2 KiB), committed beside it (ADR 0008). On reset the program copies `GALLEON SAVE TEST` into SRAM, shows a green backdrop and waits. The 65816 is assembled by hand in `build.py`, each instruction beside its assembly, so no toolchain and no third-party code is in it; the README says so. 128 KiB because snes9x labels a smaller header size corrupt.
- Evidence: two builds give sha256 `45420c79e55b1764e5ed389e8364554d4b137bc6a89e22dc44eedcdb67ef998e` (131072 bytes). In Ubuntu's RetroArch 1.18.0 with its snes9x core 1.61, under Xvfb with a config of the scratchpad's own: snes9x reports `"GALLEON SAVE TEST" [checksum ok] LoROM, 1Mbits, ROM+RAM+BAT, NTSC, SRAM:16Kbits`, and after RetroArch is stopped its save folder holds `galleon-snes-save.srm`, 2048 bytes, starting with the text. `scripts/agent/check.sh` (see the PR).
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-08 part 3c: the manifest entry at this PR's merge commit (`roms/snes/galleon-snes-save.sfc`), its THIRD_PARTY.md notice, and run.sh naming RetroArch this payload with the `.srm` expected in `savingPayloads`; then READY-FOR-DEVICE M1-08 (on the Nova it skips `cannot-sandbox` while RetroArch is the flatpak, #155).

## 2026-10-26 19:26 UTC session 01WDF1DHnyVif1Cs4MZHZLys (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #303 (M1-08 part 3b) merged at 5422806; CI x64 9:32, arm64 1:01.
- Worked on: M1-08 part 3c, the SNES payload in the bundle (tracking issue #299).
- Result: PR (this one). `test/fixtures/roms/manifest.json` pins `roms/snes/galleon-snes-save.sfc` by its raw URL at 5422806, sha256 `45420c79…` and 131072 bytes (ADR 0008); THIRD_PARTY.md has its `snes-save` notice. run.sh names RetroArch that cartridge in place of the GBA `hello.gba`, with `--saving retroarch`, so `exit.retroarch` fails `save-unchanged` unless the sandbox's save folder changed (the `.srm`). docs/TESTING.md says so, and that RetroArch's checks skip `cannot-sandbox` while it is armadaOS's flatpak.
- Evidence: device-bundle.test.ts "run.sh copies the payloads into the test home, names each emulator its own, and empties the ROM folder" asks for the SNES payload and `savingPayloads: ["retroarch"]`; it fails on the old run.sh and passes now (63/63 in the file); "run.sh names no payload ... not the pinned bytes" corrupts the SNES cartridge, the payload RetroArch is given, so its "no `launch.retroarch`" holds only through the copy check (it failed with the `payloads_ok` guard dropped). The pinned URL fetched gives sha256 `45420c79e55b1764e5ed389e8364554d4b137bc6a89e22dc44eedcdb67ef998e`. `scripts/agent/check.sh` green (3:31); `python3 -B -m unittest discover -s test/device` 188/188.
- Notes: Docker's daemon was not answering, so `init.sh` stopped; ran `npm ci` and `npx install-electron` by hand.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: READY-FOR-DEVICE M1-08. On the Nova `launch.retroarch` and `exit.retroarch` skip `cannot-sandbox` while RetroArch is the flatpak (#155, M0-21's flatpak sandbox); they count once a sandboxed run passes them.
- Next: `node scripts/agent/next.mjs`.

## 2026-10-26 20:50 UTC session 01DxjHuUfKAT61kS17f9hiHq (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #304 (M1-08 part 3c) merged at c94d197.
- Worked on: M2-08 part 2b-2a (tracking issue #111): the remaining per-system defaults of ADR 0005, now that PPSSPP, ARMSX2, Dolphin and Flycast have descriptors (M1-03 to M1-06).
- Result: PR (this one). `SYSTEM_DEFAULTS` names PPSSPP for `psp`, ARMSX2 for `ps2`, Dolphin for `gc` and `wii`, and Flycast for `dreamcast`, so these systems no longer go to RetroDECK, EmuDeck or RetroArch by registry order. A choice recorded for the system still wins, and an uninstalled default still falls back to the ranking. M2-08 stays false.
- Evidence: registry.test.ts "the defaults are the save choices ADR 0005 records" asks for each standalone default with and without a ranking that puts RetroArch, RetroDECK and EmuDeck first; it failed before the change (`psp`: `retrodeck`, expected `ppsspp`) and passes now (93/93 in the file). `scripts/agent/check.sh` green (3:18); `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root); `npm run shots:nova` 21 screens, looked at `emulators.png` and `settings-games.png`: unchanged.
- Evaluator: PASS (the new test fails with the old defaults swapped back in; callers only reorder candidates; a recorded choice still wins).
- CI wall time: recorded in the next entry (this entry rides the PR). The first x64 run failed only the PR-body check: the body had no `Feature:` line.
- Device / acceptance: none.
- Next: M2-08 part 2b-2b, ADR 0005 decision 2: change only ARMSX2's folder-card key, Dolphin's slot A GCI-folder key and Flycast's per-game VMU key in the Nova's existing settings files, backup first, every other byte kept (unit tests on copies of complete files). Then M2-08 can pass.

## 2026-10-26 21:26 UTC session 012qQmYawE3Rha1doR9ZaEX3 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #305 (M2-08 part 2b-2a) merged at 0f07d5c.
- Worked on: M2-08 part 2b-2b-1, ADR 0005 decision 2 for Dolphin (tracking issue #111).
- Result: PR (this one). Descriptors gain `settingsEdits`: keys of the emulator's own settings file a launch needs, each a section, key, value and `whenAbsent` (`leave` when the emulator's default already is the value, `add` otherwise). `editSetting` (`src/config/emulators/settingsedit.ts`) changes only that value, every other line, comment and line end kept. Before a launch, beside the launch files, `applySettingsEdits` (`src/main/settingsedits.ts`) sets each key through `replaceSave`, so the file is copied to `<root>/saves/settings/<emulator>` first and lands whole; a missing file stays missing (never started fresh), a file already set is not written. Dolphin, for GameCube games only, sets `[Core] SlotA` to `8` (`EXIDeviceType::MemoryCardFolder`, Dolphin's own default at e6f3ae17, so a file without the key is left alone). The existing card file stays where it is. The self-test sandbox launches through `descriptor.launch`, not the Launcher, so it never edits the owner's file. New string `launch.badSettingsFile` in all four catalogues, English in fr/de/es marked `// TODO(i18n)`.
- Evidence: settingsedits.test.ts (6) on `test/fixtures/settings/Dolphin.ini`, a complete file with slot A a card file: the only changed line is `SlotA = 1` to `SlotA = 8`, the backup equals the original byte for byte, a second run writes nothing and keeps one backup, a missing file is not created, a path outside the config folder is refused, a Wii game has no edit. settingsedit.test.ts (7): spacing, case, CRLF, first key only, add after the section's last setting or as a new section. registry.test.ts "only Dolphin edits its own settings so far, and only the one key". `scripts/agent/check.sh` green (2:46); `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). No UI change, so no shots.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: M2-08 part 2b-2b-2, Flycast's per-game VMU in its `emu.cfg`; then part 2b-2b-3, ARMSX2's folder card (which needs a folder card to name, so read SPEC.md's PS2 rows first). Then M2-08 can pass.

## 2026-10-26 22:26 UTC session 01Wd7QyAHPqDKsvf88chu9UF (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #306 (M2-08 part 2b-2b-1) merged at f063715; CI x64 10:09, arm64 1:00 (over the target, #307).
- Worked on: #307, the x64 pull-request leg over the 10-minute budget.
- Result: PR (this one). In #306's x64 leg, `test:coverage` took 118 s and 114 s of it was `scripts/device-bundle.test.ts` alone: one file runs its tests one after another, and most run.sh tests waited a whole second at least twice because run.sh's start and stop waits poll once a second. run.sh's poll interval is now `GALLEON_POLL_SECONDS` (default unchanged, so the Nova polls as before; tests poll more often, as they already shorten the waits). The four tests that wait out one of run.sh's own timeouts (late start, withdrawn start, past-budget stop, kill) move to `scripts/device-bundle-stops.test.ts`, with the shared fakes in `scripts/device-bundle-harness.ts`, so the runner runs the two files side by side. No test dropped: 63 tests before and after; one assertion changed in three tests (below).
- Found on the way: run.sh's kill tests asserted with `kill -0` that the app is gone, but a SIGKILLed app stays a zombie until its new parent (pid 1) reaps it. With the two files side by side under coverage that happened after run.sh returned: reproduced once in two concurrent `test:coverage` runs, `/proc/<pid>/stat` state `Z`, ppid 1. The race existed before; the tests now ask `running(pid)` (harness), which counts a zombie as not running. Three concurrent `test:coverage` runs green after.
- Evidence: the device-bundle tests took 117 s on the VM before; 86 s with the poll alone; 50 s for both files together after the split (63/63). `scripts/agent/check.sh` green in 1:33 (3:18 in the previous entry). `npm run test:app` (292 s of the leg, the rest) is untouched here.
- Evaluator: FAIL on c4cb8ff (the kill test red in 2 of 4 `test:coverage` runs, the zombie above), then PASS on aca31e6.
- CI wall time: c4cb8ff x64 7:57, arm64 1:12; aca31e6 x64 8:32, arm64 1:02 (10:09 on #306). The last push's times are in the next entry.
- Flaky: `selftestscroll.test.ts` "holds Down through a page slower than TURN_MS" failed once in `check.sh` while the evaluator ran other suites on the VM; it is untouched here and has its own issue, #309.
- Device / acceptance: none; run.sh's behaviour on the Nova is unchanged.
- Next: if the x64 leg is still near 10 minutes, `test:app` (perf overlay 76 s, two 33 s grid.scroll runs); otherwise M2-08 part 2b-2b-2, Flycast's per-game VMU.

## 2026-10-26 23:27 UTC session 015vJV48feABk2qew5yAYx4g (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #308 (#307, the x64 leg) merged at cdb8c32; x64 median 9:21 over 10 PRs, under the target, so `test:app` waits.
- Worked on: M2-08 part 2b-2b-2, ADR 0005 decision 2 for Flycast (tracking issue #111).
- Result: PR (this one). Flycast's descriptor gains `settingsEdits`: `[config] PerGameVmu = yes` in `flycast/emu.cfg` under its config folder, `whenAbsent: 'leave'`, because at the pinned 0d9853df `PerGameVmu` is on by Flycast's own default (`core/cfg/option.cpp`) and Flycast writes booleans as `yes`/`no` (`core/cfg/ini.h`). A file where a user turned it off is set back through `applySettingsEdits` (backup, atomic replace); a file without the key, or no file, is left alone. The descriptor's doc comment said VMUs were shared unless the user turned per-game on; per game is the default for port A1, the other ports' VMUs are shared. Saves stay unsynced until the Dreamcast adapter (SPEC.md: convertible from Argosy's `<product>.A1.bin`).
- Evidence: settingsedits.test.ts (9) on `test/fixtures/settings/emu.cfg`, a complete emu.cfg in Flycast's own shape: the only changed line is `PerGameVmu = no` to `PerGameVmu = yes` and the backup equals the original; without the key nothing is written and no backup kept; a missing file stays missing. registry.test.ts "only Dolphin and Flycast edit their own settings so far, each only the one key". Both fail with Flycast's `settingsEdits` undefined. `scripts/agent/check.sh` green (1:55); `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). No UI change, so no shots.
- Notes: Docker's daemon was not running (started `dockerd` by hand) and Docker Hub answered 429 for mariadb, so init.sh's RomM stack did not come up; this unit needs no RomM. `npx install-electron` needed a retry.
- Evaluator: PASS (both Flycast claims checked against its source at 0d9853df; the new tests fail with the edit removed; only the one key, backup first, no fresh file). Noted: a per-game `[<gameId>]` override of `config.PerGameVmu` is left alone, as ADR 0005's one-key rule asks.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: M2-08 part 2b-2b-3, ARMSX2's folder card (read SPEC.md's PS2 rows first). Then M2-08 can pass.

## 2026-10-27 00:27 UTC session 013ovGtsW8Tqy6cuk5pwbxY9 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #310 (M2-08 part 2b-2b-2) merged at b7b922f; CI x64 8:13, arm64 1:07.
- Worked on: #309, the flaky `selftestscroll.test.ts` "holds Down through a page slower than TURN_MS" (its second unit of work, so due now).
- Result: PR (this one). Root cause: the `scrollProbe in a page` tests ran the probe on wall time (`Date.now`, `setTimeout`, `performance`, happy-dom's frames), so a starved test process ran out of scroll time before the fake page's second page arrived. The test page now runs the probe on a `virtualClock` (test file only), passed in as the script's `Date`, `setTimeout`, `performance` and `requestAnimationFrame`; it advances to the next timer only after the event loop has drained, so load changes how long the tests take, not what the probe sees. The page's late page and late frames use the same clock. No assertion changed; `selftestscroll.ts` is untouched.
- Evidence: with a preload blocking the event loop 40 ms of every 45 ms, the old file fails exactly as #309 reported (`10 !== 20` on `scroll.cards`) and the new one passes 5/5. The five page tests take about 100 ms in all; before, each waited out its scroll time on the wall clock. Turning the probe at the loading edge (patience always `turnMs`) fails two of them. `scripts/agent/check.sh` green (2:03, 2412 unit tests). No renderer, IPC or launch code changed, so no `test:app`; no UI change, so no shots.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none.
- Next: M2-08 part 2b-2b-3, ARMSX2's folder card (read SPEC.md's PS2 rows first). Then M2-08 can pass.

## 2026-10-27 01:26 UTC session 014yYJ38en29M3WiS8YoTYyy (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #311 (#309, the flaky scroll probe test) merged at 11c7fb0.
- Worked on: M2-08 part 2b-2b-3, ADR 0005 decision 2 for ARMSX2 (tracking issue #111), the last part.
- Result: PR (this one). PASSES M2-08 (ci). Read at ARMSX2 b1f3196b: PCSX2 has no key for a card's type; `FileMcd_SetType` (`pcsx2/SIO/Memcard/MemoryCardFile.cpp`) makes a card a folder card when its name is a folder under the memory card folder, and a card file of that name otherwise, created on first use. So `SettingsEdit` gains `folder`: a folder, relative to the config folder, made before the key is set (with the empty files the emulator itself makes), left as it is when it is already a folder, and when something else holds the name the key is not set. ARMSX2's descriptor sets `[MemoryCards] Slot1_Filename = Shared.ps2` (`whenAbsent: 'add'`, since the default `Mcd001.ps2` is a file), making `ARMSX2/memcards/Shared.ps2/_pcsx2_superblock` empty as `FileMcd_CreateNewCard` does; the game formats it on first use. `Shared.ps2` is the card Argosy restores into when a device has none (SPEC.md section 10, PS2). `Mcd001.ps2` stays where it is (ADR 0005 decision 3), out of slot 1, as Dolphin's card file is out of slot A. M2-08's lines: #110 explained the choices; SYSTEM-CHOICES.md records the answer and now names the three keys; the defaults follow it and each system's choice stays changeable in Settings' platform list; the re-confirmation is item 8 of TESTING.md's acceptance session.
- Evidence: settingsedits.test.ts (15) on `test/fixtures/settings/PCSX2.ini`, a complete PCSX2.ini in ARMSX2's shape: the only changed line is `Slot1_Filename = Mcd001.ps2` to `Slot1_Filename = Shared.ps2`, the backup equals the original, the card folder holds only an empty `_pcsx2_superblock` and `Mcd001.ps2` is unchanged; a file without the key gets it in `[MemoryCards]`; an existing folder card and its saves are left alone; a card file named `Shared.ps2` leaves the ini untouched with no backup; an ARMSX2 that never ran gets neither ini nor card; a folder outside the config folder is refused. With the folder step removed two fail; with ARMSX2's edit removed four fail. registry.test.ts "only ARMSX2, Dolphin and Flycast edit their own settings so far, each only the one key". `scripts/agent/check.sh` green (2418 unit tests); `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). No UI change, so no shots.
- Evaluator: PASS (every ARMSX2 claim checked at b1f3196b; one key, backup first, no fresh file, cards untouched). Noted: a `[Folders] MemoryCards` moved away from `memcards` fails safe (ARMSX2 makes a `Shared.ps2` card file, nothing lost).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none new; M2-08's per-system re-confirmation is already in the acceptance session (TESTING.md).
- Next: `node scripts/agent/next.mjs`.

## 2026-10-27 01:59 UTC session 014yYJ38en29M3WiS8YoTYyy (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. #312 (M2-08 part 2b-2b-3) merged at d70f54f; CI x64 9:19, arm64 1:07. #111 closed.
- Worked on: M1-10 part 1 (tracking issue #313): acceptance line 1, the pure module that picks the default library volume.
- Result: PR (this one). `chooseLibraryVolume` (`src/shared/librarycard.ts`) takes a list of mounted volumes and the user name. It returns the card the library goes on, or internal storage with the reason (`no-card`, `not-ext4`, `read-only`, `nearly-full`, the nearest miss of the cards passed over). A card is a mount at `/run/media/<user>/<label>`, or straight under `/run/media` as older SteamOS mounted it. Only ext4 counts, since SteamOS's automount mounts only ext4. A read-only card, or one with less than `CARD_MIN_FREE_BYTES` left, is passed over. Of several cards, `NovaSD` wins, then the one with most room, then the mount point, so the order of the mount list does not matter. Nothing calls it yet. M1-10 stays false.
- Evidence: librarycard.test.ts (11): ext4 card present, card absent, card read-only, card nearly full (one byte under and exactly at the floor), card not ext4 (exfat, vfat, btrfs, fuseblk), two cards (label beats room both ways round, room then mount point without the label, a usable card beats one passed over, the nearest miss as the reason), the older mount shape and another user's card, and paths that are not cards. `scripts/agent/check.sh` green. No renderer, IPC or launch code changed, so no `test:app`; no UI change, so no shots.
- Evaluator: PASS (every case line 1 names is tested; mount recognition matches DEVICE-FACTS; pure, order-independent).
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `storage.sdcard` comes with the setting.
- Next: M1-10 part 2: read the mounted volumes in main (`/proc/self/mounts`, `statfs`, labels from `/dev/disk/by-label`), make the card the default ROM folder of a fresh install, and show the volume, file system and free space in pre-flight (line 4).

## 2026-10-27 02:27 UTC session 0178hDCD48ihrfRWWpsb7ZyE (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #314 (M1-10 part 1) merged at 9a83094; CI x64 8:21, arm64 1:12.
- Worked on: M1-10 part 2a (tracking issue #313): reading the mounted volumes `chooseLibraryVolume` picks from.
- Result: PR (this one). `readVolumes` (`src/main/volumes.ts`) reads the kernel's mount table (`/proc/self/mounts`, octal escapes undone, a mount point mounted over listed once as the later mount, read-only from the `ro` option alone), labels from udev's `/dev/disk/by-label` links (`\xHH` escapes undone, matched to the mount by resolved device, so a device named through another link still finds its label) and room from `statfs` (`bavail`, as `spaceOf`). Only mounts under `/run/media` are measured, so no network share or FUSE mount is asked. A mount that cannot be measured is left out; nothing throws. Nothing calls it yet. M1-10 stays false.
- Evidence: volumes.test.ts (13) against fixtures in a scratch folder (devices as files, label links, mount points as folders), including a read-only card read and handed to `chooseLibraryVolume`. `scripts/agent/check.sh` green (2442 unit tests; volumes.ts 98.8% lines). No renderer, IPC or launch code changed, so no `test:app`; no UI change, so no shots.
- Evaluator: PASS (8 hand mutations of volumes.ts, 7 killed; the survivor, the unescape on the device field, matters only for a `/dev` path with a space, which device nodes do not have). Noted: a label with a byte udev escapes but that is not ASCII decodes as Latin-1; harmless to the choice, which compares with `NovaSD` only.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `storage.sdcard` comes with the setting.
- Next: M1-10 part 2b: a library-root setting whose default on a fresh install is the chosen card (`readVolumes` then `chooseLibraryVolume`), and the volume, file system and free space in pre-flight (line 4).

## 2026-10-27 03:27 UTC session 0178hDCC1nZKMG7KsUDJefcN (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #315 (M1-10 part 2a) merged at cc6bc64.
- Worked on: M1-10 part 2b-1 (tracking issue #313): a library-folder setting, and a fresh installation's default on the SD card.
- Result: PR (this one). `Settings.libraryRoot` is the folder the game library is kept in, '' for the root's own `roms` folder (`libraryFolder` in `root.ts`). Every place a game is written or looked for asks it: the shared library's plan, pre-flight's writable check and shared-folder note, and the emulators' ROM folders, through a `library` dir base that replaces `rommix` (every descriptor that used `rommix` used it only as `rommix/roms`). `Store.fresh` is true when there was no settings file. `RomMixApp.chooseDefaultLibrary`, before the start-up prune and the first probe, runs `chooseDefaultLibrary` (`src/main/librarydefault.ts`: `readVolumes`, `chooseLibraryVolume`, then makes `<card>/galleon/roms` and checks it can be written) only on a fresh installation and only without `GALLEON_HOME`, so an existing library never moves and a self-test home or sandbox leaves nothing on the card. Existing settings files get '' and keep their games where they are. M1-10 stays false.
- Evidence: librarydefault.test.ts (6): a card that qualifies gets `/run/media/armada/NovaSD/galleon/roms`, made; no card, a read-only card, another user's card and a card that will not take the folder leave '' with the reason and make nothing; `prepareFolder` reports rather than throws. app.test.ts: fresh plus card writes the setting, not fresh or no card writes nothing, `GALLEON_HOME` set does not even read the mounts. store.test.ts: only a directory without a settings file is fresh; an older file gets ''. emulators.test.ts: Eden's ROM folder follows `libraryRoot`, saves and BIOS do not. library.test.ts: a shared library on the card plans games there. With `libraryFolder` ignoring the setting, two fail; without the `GALLEON_HOME` condition, one fails. `scripts/agent/check.sh` green (2:14); `npm run test:app` 244/244 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). No UI change, so no shots.
- Evaluator: PASS (existing libraries cannot move: `fresh` is read before the defaults are written back; a `GALLEON_HOME` run never reads the mounts; nothing else reads `rootPaths().roms`). Taken from its notes: `userInfo` can throw for a uid with no passwd entry, so the user falls back to `$USER`. Left for later parts: `storage.sdcard` needs an explicit self-test opt-in that removes `<card>/galleon/roms` and is covered by the owner-state comparison; `libraryRoot` is checked as a string only, and an absolute path check belongs with line 3's folder picker.
- Notes: the first x64 run failed `pr-body.mjs`: the body had no `Feature: M1-10` line. A re-run reads the body from the original event, so after the body was fixed only a new push could re-check it.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. A card removed after the library went on it is line 2 (part 3): until then `Store.pruneInstalled` already keeps games whose whole folder is gone.
- Next: M1-10 part 2b-2: the volume, file system and free space in pre-flight (line 4). Then line 2 (card not inserted, downloads wait), line 3 (moving the library), and `storage.sdcard`.

## 2026-10-27 04:27 UTC session 0178hDCCnkFfUtySXbLF1Za7 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #316 (M1-10 part 2b-1) merged at 02f5663; CI x64 8:15, arm64 1:02.
- Worked on: M1-10 part 2b-2 (tracking issue #313): acceptance line 4, the volume, file system and free space in pre-flight.
- Result: PR (this one). Free space was already shown per drive. `drivesOf` now names each drive's volume: `volumeNamer` (`src/main/volumes.ts`) reads the kernel's mount table and udev's label links once, resolves the folder (its nearest existing folder, as `drivesOf` already measures) and takes the deepest mount point at or above it (`mountOf`: `/` covers everything, a mount point that only starts the folder's name does not). Settings -> System's pre-flight shows "On NovaSD (/run/media/deck/NovaSD), ext4" (or "On /, ext4" without a label) under each "free of" line, dim. No mount table, or a folder on no listed mount: the room alone, as before. The Downloads screen gets the same field and does not show it yet. M1-10 stays false.
- Evidence: volumes.test.ts (+4): deepest mount, `/home` over `/`, a `NovaSDX` folder not on `NovaSD`, no covering mount; a folder on a labelled card and one on an unlabelled root named with mount point, type and label; a link onto the card named by the card; no table gives null. disk.test.ts (+3): a not-yet-made folder is named by the volume it would be made on; a drive on no known mount is still measured, without a volume; on the suite's machine a drive's volume comes from the real mount table. interface.test.ts "and the pre-flight check names the volume and file system games go to" (the line's mount point equals `system.diagnostics()`'s). `scripts/agent/check.sh` green (2461 unit tests; volumes.ts 99.1% lines); `npm run test:app` 245/245 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). `npm run shots:nova`: report.png shows the pre-flight with "On /, ext4" under "27 GB free of 252 GB in /tmp/galleon-shots/signed-in/roms", inside 1280x960, no overflow.
- Evaluator: PASS on re-check (first pass FAIL only for this missing entry; 4 hand mutations of volumes.ts and disk.ts, all killed: no `volume` attached, shallowest mount, no symlink resolution, no trailing `/` in the prefix check). Noted: the shot was taken from the working tree before the commit (footer `-dirty`), content identical.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet. `storage.sdcard` comes with lines 2 and 3.
- Next: M1-10 line 2: games on an unmounted card show 'card not inserted', are never pruned (`Store.pruneInstalled` skips unmounted roots) or offered for re-download, and queued downloads wait with a message. Then line 3 (moving the library) and `storage.sdcard`.

## 2026-10-27 05:00 UTC session 0178hDCCnkFfUtySXbLF1Za7 (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. #317 (M1-10 part 2b-2) merged at efa7ac0; CI x64 8:10, arm64 0:57.
- Worked on: M1-10 part 3a (tracking issue #313): the part of line 2 that says `Store.pruneInstalled` skips unmounted roots.
- Result: PR (this one). `isOnMissingCard` (`src/main/volumes.ts`): a path under `/run/media` whose deepest mount is not itself on removable media is on a card that has gone. `pruneInstalled` reads the mount table once (`missingCardTest`) and never looks at such a game. The existing rule (a game whose whole folder is gone is kept) did not cover an unmount that leaves the mount point behind as a folder on internal storage with the game's folder made under it. A mount table that cannot be read counts every card as missing, so its games are kept. Internal storage is unaffected. The rest of line 2 ('card not inserted' instead of 'not downloaded', no re-download offer, downloads that wait) is still to do. M1-10 stays false.
- Evidence: store.test.ts "a game on a card that is not mounted is kept, whatever is left at its mount point" failed before the change (pruned 1) and passes now; the same game with its card mounted is pruned as before. volumes.test.ts (+2): a mounted card, another card, a `NovaSDX` prefix, internal storage, no table. `scripts/agent/check.sh` green (2464 unit tests; volumes.ts 99.2% lines). No renderer, IPC or launch code changed, so no `test:app`; no UI change, so no shots.
- Evaluator: PASS (5 hand mutations, 4 killed; the survivor is `pruneInstalled`'s default no longer reading the mount table, wiring that `storage.sdcard`'s "nothing is pruned" step must go through with a `/run/media` path). Noted: `isOnMissingCard` does not resolve links, so a library root picked by hand through `/run/media/NovaSD` (DEVICE-FACTS' symlink) counts as a missing card and its games are kept rather than pruned; the default root is the mount point. Revisit with the rest of line 2.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: the rest of M1-10 line 2 ('card not inserted' instead of 'not downloaded', no re-download offer, queued downloads wait with a message), then line 3 and `storage.sdcard`.

## 2026-10-27 05:26 UTC session 0178hDCCuxLu8WxP75gas2Kj (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #318 (M1-10 part 3a) merged at b8895a9; CI x64 7:50, arm64 1:04.
- Worked on: M1-10 part 3b (tracking issue #313): line 2's "games on [the unmounted card] show 'card not inserted' instead of 'not downloaded', are never offered for re-download".
- Result: PR (this one). `Library.installed` and `installedNow` mark a copy on a card that is not mounted `cardMissing` (`isOnMissingCard` through `missingCardTest`, read on each call, never written to the index). The game page shows a disabled "Card not inserted" in place of Play or Download, an unlit "Card not inserted" chip in place of the lit "Downloaded" one, and none of Run with, the save buttons or Uninstall; it no longer asks for the launch variants, which would be refused and surface as an error toast. The Downloads list says "Card not inserted" on the row and offers no removal. `launchContext` and `saveContext` refuse with `error.cardNotInserted`; save catch-up keeps its records until the card is back. `downloads:start` answers "done" for such a game, so nothing is fetched to where the card was mounted. Still to do in line 2: queued downloads wait with a message when the library's card is out. M1-10 stays false.
- Evidence: library.test.ts (+3: marked and unmarked, the index never carries the mark, unmarked once the card is back; mutating `marked` fails 3); gamecontext.test.ts (+2: launch and save refusals); test/app/card.test.ts (5, a new scenario seeded with an index entry under `/run/media` that nothing is mounted on): still listed after start-up, the page's button and offered actions, no toast on opening (failed with the error toast before `useGameLaunch` skipped the variants), launch refused with the reason, download answered as done with nothing queued, the Downloads row. `scripts/agent/check.sh` green; `npm run test:app` 249/250 on the first run, the one failure `perf.test.ts`'s frame count while the pre-commit check was loading the machine, 2/2 when run alone. `npm run shots:nova` gains `game-card-missing.png`: title, chips, the disabled button beside the favourite, collection and status buttons, inside 1280x960. With the primary button disabled, focus starts in the top bar, as it already does for the disabled "Installing" button.
- Evaluator: see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: the rest of M1-10 line 2 (queued downloads wait with a message when the library's card is out), then line 3 and `storage.sdcard`.

## 2026-10-27 06:26 UTC session 0178hDCV4qs1ht (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #319 (M1-10 part 3b) merged at b51215a; CI x64 8:16, arm64 0:59.
- Worked on: M1-10 part 3c (tracking issue #313): the last part of line 2, "queued downloads wait with a clear message instead of falling back to internal storage silently".
- Result: PR (this one). `DownloadManager.runOne` asks `Library.isOnMissingCard` about the game's folder right after planning it, before anything is measured or made: without the card its mount point is a folder on internal storage, which has room and can be written. Such a transfer stops with `CardNotInsertedError`; the row is paused (not an error) and says "Waiting for the card: insert it, then resume this download" (`error.downloadWaitsForCard`, in all four catalogues), and every game queued behind it for the card does the same. Resumed with the card back, it downloads onto the card. A game whose folder is not on the card (an emulator's own ROM folder) is not affected. Line 2 is now complete in CI. M1-10 stays false.
- Evidence: downloads.test.ts "a library on a card that is not inserted" (3): waits with the message, nothing made under the library folder, nothing indexed; a second queued game waits too; resumed with the card back it is done and on the card. All 3 fail with the check removed. `npm run test:app` 251/251; test/app/card.test.ts (+1, the scenario's `libraryRoot` now on the absent card; `startScenario` passes `settings` through): a new download pauses with the reason, nothing is made under `/run/media/galleon-app-test`, and the Downloads activity row shows the reason. `scripts/agent/check.sh` green (2472 unit tests; downloads.ts 99.3% lines). No renderer code changed (the paused row already shows `item.error`), so no shots.
- Evaluator: PASS (2 hand mutations, both killed: the check removed, and `cardOut` dropped from the paused branch; the catch path keeps the message, calls no `keepPartial` and makes no pending record). Taken from its notes: the German string uses "Sie" like the rest of the catalogue. Noted: only a card already out when a transfer starts is handled; one pulled mid-transfer fails through the ordinary write error.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: `isOnMissingCard` resolving links (a root picked by hand through `/run/media/NovaSD`) before line 3's folder picker can choose one; then line 3 (moving the library) and `storage.sdcard`.

## 2026-10-27 06:53 UTC session 0178hDCV4qs1ht (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. #320 (M1-10 part 3c) merged at 451aabd; CI x64 8:10, arm64 1:17.
- Worked on: M1-10 part 3d (tracking issue #313): the evaluator's note from part 3a, `isOnMissingCard` not following links.
- Result: PR (this one). `missingCardTest` resolves each path before asking `isOnMissingCard`. It uses `resolveExisting` (`src/main/volumes.ts`), which follows links through the nearest folder that exists and keeps the not-yet-made rest as written. So a library reached through DEVICE-FACTS' `/run/media/NovaSD` link counts as on the card while the card is mounted. Once the unmount leaves the link dangling, the card counts as gone. Before this, such a library's games read "Card not inserted" and its downloads waited even with the card in. Every caller (the prune, the game page and Downloads marks, the launch and save refusals, the download wait) goes through `missingCardTest`, so all of them follow links now. M1-10 stays false.
- Evidence: volumes.test.ts (+2): through the link onto a mounted card it is not missing, another card is, and a dangling link is; `resolveExisting` on scratch fixtures (an existing folder through a link, a not-yet-made folder under it, a dangling link, `/`). With the resolution removed, the link test fails. `scripts/agent/check.sh` green (2474 unit tests; volumes.ts 99.3% lines). No renderer, IPC or launch code changed, so no `test:app`; no UI change, so no shots.
- Evaluator: PASS (3 hand mutations, 2 killed; the survivor is `missingCardTest`'s default resolver set to identity, wiring that only a `/run/media` path exercises, so `storage.sdcard` covers it). Noted: a hand-picked root outside `/run/media` linking onto the card is not marked once the link dangles, as before; prune still keeps those games (`Store.hasGone`). This matters for line 3's folder picker.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-10 line 3 (changing the ROM folder offers to move existing games with sizes first; Phase 0's `~/rommix/roms` adopted or moved), then `storage.sdcard`.

## 2026-10-27 07:26 UTC session 0178hDCE2E9DNMXDgMEeNLeS (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #321 (M1-10 part 3d) merged at a04b5b4; CI x64 7:47, arm64 1:04.
- Worked on: M1-10 part 4a (tracking issue #313): line 3's "shows sizes first", the plan a library move is confirmed from.
- Result: PR (this one). `planLibraryMove` (`src/main/librarymove.ts`) lists the shared library's games under the current folder with each one's size measured off the disk now, the place each would go, the total, the room in the new folder and whether both folders are on one drive (then the games are renamed and always fit). It names games whose files are gone (`missing`) and games whose new place is already occupied (`taken`), and refuses the same folder and a folder inside the library. Paths are compared resolved, so a library reached through `/run/media/NovaSD` plans from the card. Games in an emulator's own folder are not carried. The plan type (`LibraryMovePlan`) is in `@shared/types` for the IPC that comes next. Nothing calls it yet; M1-10 stays false.
- Evidence: librarymove.test.ts (7): sizes off the disk (not the recorded size) and new places for a file and a disc folder; an emulator's own game and games outside the library not carried; missing and taken; same folder through a link, a folder inside the library, a `roms-sd` sibling and a `..roms` folder not counted as inside, the parent folder allowed; on one drive a sparse game bigger than the room still fits; a library through a link; another drive (`/proc`) with no room does not fit. `scripts/agent/check.sh` green (librarymove.ts 100% lines). No renderer, IPC or launch code changed, so no `test:app`; no UI change, so no shots.
- Evaluator: PASS (16 hand mutations, 12 killed; the 3 survivors were test gaps: the same-drive fit, the parent folder, a `..` name; all three are killed now by the added assertions). Noted for 4b: a new folder above the current one is allowed, so a target can be an ancestor of the source; `taken` games are still listed and counted, and 4b/4c decide what happens to them before anything moves.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-10 part 4b: carrying out the plan (rename on one drive; copy, verify, then remove on another; the index rewritten; nothing removed until its copy is whole), then 4c the Settings folder picker with the confirmation, and 4d adopting or moving Phase 0's `~/rommix/roms`. Then `storage.sdcard`.

## 2026-10-27 07:49 UTC session 0178hDCE2E9DNMXDgMEeNLeS (hourly heartbeat, second unit)

- Device results: unchanged since the entry above. #322 (M1-10 part 4a) merged at cd3c01f; CI x64 8:16, arm64 1:04.
- Worked on: M1-10 part 4b (tracking issue #313): carrying out the plan of line 3's library move.
- Result: PR (this one). `moveLibrary` (`src/main/librarymove.ts`) moves the plan's games one at a time. On one drive each part is renamed. On another, each part is copied under a `.galleon-moving` name (links copied as links), its size checked against the original, and only then given its name. A game is recorded in the index (path and launch path) once every part is in place, and only then are the originals removed; one that cannot be removed is reported as a leftover, never as an unmoved game. A game that fails, or that the index will not take, is put back whole (renamed parts renamed back, copies removed) and stops the move; the size check's message is `error.libraryMoveIncomplete` (all four catalogues). A game whose new place is occupied, even if that happened after the plan, is skipped and nothing is replaced; one the index has somewhere else since the plan is left alone. The plan now carries each game's `parts`: a loose game's companion files (named in `files`, beside its path in the system folder) move and count with it, which 4a missed. Nothing calls it yet. `librarymove.ts` is on the write allow-list. `Store.addInstalledMany` keeps its cache as it was when the index file cannot be written. M1-10 stays false.
- Evidence: librarymove.test.ts (+14, 21 total): a loose game's companions planned and sized with it; renamed on one drive and copied to "another" (the plan's `sameDrive` turned off), all three kinds of game end up in the new folder, nothing is left behind and the index has the new paths and launch paths; a place taken after the plan is skipped and its occupant kept; a copy that fails part-way removes its copies, keeps the originals and the index entry, and moves nothing after it; a copy that comes out short (an injected copier) is never named and the original kept; on one drive a game whose second part has gone is renamed back; a game re-indexed elsewhere since the plan is not moved; a relative link in a game folder still reads after a copy; a copied game is indexed while its original is still there; an index that cannot be written leaves the game where it was, on one drive renamed back and on another with its copy removed, and against the real `Store` both the files and the index (in memory, on disk, and through a prune) stay on the old place; store.test.ts (+1): an entry the index file would not take is not kept in memory either; a refused plan moves nothing. `scripts/agent/check.sh` green (librarymove.ts 98% lines; the uncovered lines are the leftover branch, a removal that fails, which cannot be made to fail as root). No renderer, IPC or launch code changed, so no `test:app`; no UI change, so no shots.
- Evaluator: first pass FAIL (the index was written only after the originals went, so an interrupted removal left it pointing at nothing; a same-drive failure part-way split a game; the size check had no test). All three fixed as above, with its notes on links and a game re-indexed since the plan. Second pass FAIL: indexing after the removal still survived the tests, and this entry overstated coverage; both tests added (the mutation now fails 2) and this entry corrected. Third pass FAIL: on one drive an index that would not take the new place left the game renamed and the index on the old path, which a later prune would forget. `place` now hands back its undoing, run when the index write throws (on one drive the renames go back, on another the copies go); both cases tested, and the mutation dropping the undo fails 2. Fourth pass FAIL: the real `Store` put the entry in its cache before the write that threw, so after the undo the in-memory index pointed at the new place and a prune would forget the game. `Store.addInstalledMany` now restores its cache when the write fails; the mutation removing that fails one test in each file. Fifth pass PASS (4 hand mutations of the restore, all killed; no caller of `addInstalled` relied on the cache outliving a failed write). Noted for 4c: `moveLibrary` throws when the index cannot be written; on one drive a process killed between the renames and the index write can leave a game split, with no file lost.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-10 part 4c: the Settings folder picker, the confirmation listing the plan's games and sizes (and what is skipped), and the IPC that plans, moves and then sets `libraryRoot`. Then 4d (Phase 0's `~/rommix/roms`) and `storage.sdcard`.

## 2026-10-27 09:26 UTC session 0178hDCD3iR2GbsKjdDtwE82 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #323 (M1-10 part 4b) merged at f49730e; CI x64 8:20, arm64 1:11.
- Worked on: M1-10 part 4c-i (tracking issue #313): the main-process half of line 3's folder change. 4c is split in two to keep each PR small: this part is the IPC, and 4c-ii is the Settings folder list and its confirmation.
- Result: PR (this one). `library:folders` (`libraryFolderChoices`, `src/main/librarydefault.ts`) offers the root's own folder, `galleon/roms` on each card that can be written to (`cardVolumes`, `src/shared/librarycard.ts`), and the folder in use when it is neither, with the one in use marked (compared resolved, so a library set through a link to the card is that card's). `library:planMove` returns `planLibraryMove`'s plan. `library:move` (`changeLibraryFolder`, `src/main/librarymove.ts`) plans again and refuses, with nothing made or moved, while any download is in progress (`isInProgress`, every stage up to the index entry), for a folder inside the library, without room, or without write access (four new `error.*` keys, all four catalogues). It moves with `moveLibrary` and sets `libraryRoot` only when every game is there. A move that stops part-way keeps the old setting, with the games already moved indexed at their new place, and asking again carries on. The same folder by another name changes only the setting. After the move the emulators are probed again and the renderer gets the new index. `LibraryMoveResult` moved to `@shared/types`. The dev bridge has stubs. M1-10 stays false.
- Evidence: librarymove.test.ts (+7): a change moves every game and then sets the folder; the same folder through a link moves nothing and takes the link's name; four refusals (downloading, inside, no room, not writable) leave files, index and setting alone and make no folder; a move that stops part-way keeps the setting, and a second call finishes. librarydefault.test.ts (+3): the offered folders (a read-only card and a non-card mount left out, the one in use marked either way); a folder in use that is neither, appended; one through a link. app.test.ts (+5): no move while a download is queued, downloading, checking, extracting or installing (the last three failed before `isInProgress`). test/app/librarymove.test.ts (3, through the real channels): the folders, the plan with the game's size and nothing moved, the move with the file, index and setting checked. `scripts/agent/check.sh` green; `npm run test:app` 254/254 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). No renderer screen changed, so no shots.
- Evaluator: first pass FAIL: the busy check counted only queued and downloading, so a transfer in checking, extracting or installing could land in the old folder after a move had set the new one. It now uses `isInProgress`, with tests. Also from its notes: the same-folder test now uses a link. Before, `join(from, '.')` normalised away and the `plan.to` mutation survived; it is killed now. Second pass: see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Notes: the PR's first CI run failed only the PR-body gate, because the body was not yet in the template's shape (no `Feature:` line). The workflow does not run on an edited body, and a re-run replays the old one, so the corrected body is checked by the run on this entry's commit.
- Next: M1-10 part 4c-ii: the Settings list of folders, the confirmation with the plan's games and sizes (missing and taken named), the move kept modal while it runs. Evaluator notes for it: a paused download's `.part` stays in the old folder and restarts in the new one, and nothing stops a second move or a new download during a move. Then 4d (Phase 0's `~/rommix/roms`) and `storage.sdcard`.

## 2026-10-27 10:27 UTC session 0178hDCCyZdm5naeHj8NsA32 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #324 (M1-10 part 4c-i) merged at 9d63767; CI x64 7:13, arm64 1:08.
- Worked on: M1-10 part 4c-ii (tracking issue #313): the Settings half of line 3's folder change.
- Result: PR (this one). Settings → Games (shared library) lists the folders `library:folders` offers, each with its free space; the one in use is marked, the others carry "Move here" (`LibraryFolder`, `src/renderer/src/screens/Settings/LibraryFolder.tsx`). Choosing one opens a confirmation that measures first (`library:planMove`), then names the biggest games with their sizes (`listed`, a cap so the buttons stay on screen), the total, renamed or copied, the room there, and which games stay (place taken) or have nothing to carry. Move is offered only where `changeLibraryFolder` would carry it out (`moveVerdict`, `src/renderer/src/screens/Settings/librarymove.ts`): not inside the library, not without room; a plan with nothing to carry offers "Use this folder". Keep is focused. While the move runs the panel has no way out; a move that stops part-way names the game and the reason and says asking again carries on; one that finishes closes with a toast, and any leftovers are named in a warning. Settings are reread afterwards (`reloadSettings` in `state.tsx`). The shared-folder note now names the library folder, not the root's `roms`. 35 new keys in all four catalogues, translated. M1-10 stays false.
- Evidence: librarymove.test.ts (renderer, 7): verdicts for move, inside, no room, same folder, nothing to carry, every place taken; taken games not counted; the biggest named and the rest counted. test/app/librarymove.test.ts (+3, driven with the pad through Settings): the folder in use is not offered; choosing a folder lists the game with its size, and Keep leaves the file and `libraryRoot` alone; Move carries the game to the root's own folder, sets `libraryRoot` and the list marks it. `npm run test:app` 257/257. `scripts/agent/check.sh` green. `npm run shots:nova` (new scenario `settings-library-move`): looked at settings-library-move.png (title, "2 games, 7 MB, move from … to …", renamed on one drive, free space, both games with sizes, Keep focused, nothing clipped) and settings-games.png (the note names the library folder; "This device" with path and free space, marked In use).
- Evaluator: PASS. Taken from its notes: the measuring stage can now be put away with B (only the moving stage is held); the catch comment no longer claims nothing moved (an index write that fails part-way also lands there; the setting is unchanged either way); settings are reread and the panel released even when the move throws or the reread fails. Left as noted: a custom current folder reads "This device" like the default (the path line tells them apart); a stopped move's reason is the main process's message, which can be a raw errno string.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-10 part 4d: Phase 0's games in `~/rommix/roms` adopted or moved. Then `storage.sdcard` (line 5) and READY-FOR-DEVICE.

## 2026-10-27 11:27 UTC session 0178hDCB5QpEU2h1z816kkxz (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #325 (M1-10 part 4c-ii) merged at dc8e216; CI x64 8:00, arm64 1:24.
- Worked on: M1-10 part 4d-i (tracking issue #313): line 3's "Phase 0's games in `~/rommix/roms` can be adopted or moved", the main-process half.
- Result: PR (this one).
  - `readStockLibrary` (`src/main/stocklibrary.ts`) finds stock RomMix's home (its pointer `~/.config/rommix/root`, else `~/rommix`) and reads its index. It takes the shared-library entries inside stock's game folder that are at least a system folder deep, still on the disk, and not yet in Galleon's index. It does this only when stock was signed in to the same server as Galleon.
  - Each entry is read as untrusted. Its file names are kept only where they stay inside the game's folder, or for a loose game beside it in its system folder, since an uninstall removes each one.
  - Nothing is offered under `GALLEON_HOME`, and there stock's pointer is not even read.
  - Adopt records the games where they are. Move adopts them and then carries them into the library with `moveLibrary`. It is refused, with nothing adopted, for the reasons a library move is; those checks are now `refuseUnmovable`, shared with `changeLibraryFolder`.
  - Stock's own files are only read.
  - Channels `library:stock`, `library:adoptStock` and `library:moveStock`, with dev-bridge stubs. M1-10 stays false.
- Evidence:
  - `stocklibrary.test.ts` (13, one entry more since the second pass):
    - the pointer or `~/rommix`
    - the same server found, ignoring a trailing slash and case
    - nothing for another server, before sign-in, or under `GALLEON_HOME`
    - untrusted entries refused, and hostile file names dropped
    - a system folder never taken for a game
    - adopting leaves stock's index byte-identical
    - the plan's sizes include games adopted earlier
    - a move carries the files and the index
    - three refusals adopt nothing and never reach the mover
    - a stopped move finishes on the second ask
  - `app.test.ts` (+1): the offer before and after sign-in, and adopting announces the index.
  - `scripts/agent/check.sh` green (2532 tests; `stocklibrary.ts` 100% lines). `npm run test:app` 257/257. No UI change, so no shots.
- Evaluator:
  - First pass FAIL: stock's `files` names were adopted unchecked, so an uninstall could delete a file outside both folders. Fixed as above, along with two of its notes (depth, and the pointer not read under `GALLEON_HOME`).
  - Its mutation dropping the refusal hung the test run, because Node's recursive mkdir loops forever under `/proc`. The refusal tests now hand in a recording mover and fail fast.
  - Second pass PASS (21 hand mutations, each under a timeout, none hung; every one asked for killed). Five survivors, all redundant guards. One of them, a game path outside the folder with its launch path inside, is now a fixture. Noted: a corrupt entry could still name a sibling game's file in the same system folder, as Galleon's own entries could.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-10 part 4d-ii: Settings offers stock RomMix's games (count, sizes, Adopt / Move into the library), then `storage.sdcard` (line 5) and READY-FOR-DEVICE.

## 2026-10-27 12:38 UTC session 0178hDCBRKde2atUWBqBxWT6 (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #326 (M1-10 part 4d-i) merged at 363c721.
- Worked on: M1-10 part 4d-ii (tracking issue #313): the Settings half of line 3's "Phase 0's games in `~/rommix/roms` can be adopted or moved".
- Result: PR (this one). Settings → Games shows "Games from RomMix" when `library:stock` offers any (`StockLibrary`, `src/renderer/src/screens/Settings/StockLibrary.tsx`). It names the count, stock's folder and the size a move would carry. "Use them where they are" adopts. "Move into the library" opens the library move's own confirmation, which measures first and lists each game with its size, with Keep focused. `LibraryMoveNotice` now takes a `MoveRequest`, so the folder change and the stock move share it. What is offered comes from `stockChoices` (`librarymove.ts`): no move when nothing would be carried, or when stock's folder is the library or inside it. The offer is read again after the library folder changes. 13 new keys in all four catalogues, translated. M1-10 stays false.
- Evidence: `librarymove.test.ts` (+4, `stockChoices`). `test/app/stocklibrary.test.ts` (3, with the pad): both games offered with their size; adopting records them at stock's paths and leaves stock's index byte-identical; moving lists both games with sizes before anything moves, then carries the files and the index. This scenario alone runs without `GALLEON_HOME`, under which stock is never offered: `HOME` and `XDG_CONFIG_HOME` are a scratch folder, with Galleon's root named by its pointer there. `scripts/agent/check.sh` green; `npm run test:app` 259/260: the perf scroll test counted 738 frames while the evaluator ran `check.sh` on the same VM; alone, `perf.test.ts` 2/2 (1472 frames). Not a test fault: two suites competed for one machine. `npm run shots:nova` (new `settings-stock`, `settings-stock-move`): looked at both. The section shows the count, path, "7 MB to move" and both buttons. The confirmation shows "Move RomMix’s games?", the folders, renamed on one drive, the free space, both games with sizes, and Keep focused; nothing is clipped.
- Evaluator: PASS (isolation of the scratch-home scenario traced; the library-move refactor unchanged in behaviour). Notes left as they are: the stock confirmation reuses "Keep it where it is"; a row with nothing to adopt or move shows information only; a stock folder that vanishes before measuring closes the panel without an `app:error` message.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-10 line 5, device check `storage.sdcard` (self-test or run.sh step, TESTING.md catalogue), then READY-FOR-DEVICE M1-10.

## 2026-10-27 13:30 UTC session 0178hDCCh99xJBictcya6hnQ (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #327 (M1-10 part 4d-ii) merged at a682ec3; CI x64 8:30, arm64 1:08.
- Worked on: M1-10 line 5, device check `storage.sdcard` (tracking issue #313).
- Result: PR (this one). `sdCardScenario` (`src/main/selftestsdcard.ts`), wired in `index.ts` and requested by `test/device/run.sh`, has three parts:
  - The default: `chooseDefaultLibrary` asked directly, since the app's own call never runs under `GALLEON_HOME`. It must pick an ext4 card under `/run/media/<user>`. A card passed over (none, full, read-only, not ext4, not writable) is a skip.
  - The landing: `download.small` runs with the library in a `.galleon-selftest-*` folder of the run's own on that card, never the card's `galleon/roms`, which may hold the owner's games. The folder is removed afterwards and checked gone. Folders an earlier, killed run left are swept first, by that prefix only.
  - The card that is out: the library points at `/run/media/<user>/GalleonSelfTestAbsent-<pid>/galleon/roms`. A made-up index entry (id `ABSENT_GAME_ID`) there must survive `pruneInstalled` and be marked `cardMissing` (the screens' "card not inserted"). Nothing is made where the card would be.
  - The setting and the entry are put back whatever happens.
- Evidence: `selftestsdcard.test.ts` (19): pass with the card; skip without a card, full or vfat, not writable; fail outside the user's media folder; a download that fails, throws or skips, each with the setting and folder restored; fail beats error beats skip; pruned or unmarked game fails; the made-up card mounted or the id taken skips; an entry or setting left behind fails; abort; unreadable volumes; the sweep removes only prefixed folders. `test/app/selftest.test.ts` "storage.sdcard in the real app" (no card in CI: `skip card-no-card`, `cardMissing` 1, `pruned` 0, index empty, `libraryRoot` unchanged, GET/HEAD only); that file 14/14. `scripts/agent/check.sh` green. No UI change, so no shots.
- Evaluator: first pass FAIL only for this entry missing; acceptance line 5 met, rails clean. Its note that a hard-killed run could leave its folder on the card (outside the owner-state manifest) is closed by the sweep. Second pass: see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- READY-FOR-DEVICE M1-10
- Next: the next feature from `next.mjs`; M1-10 passes once a device run shows `storage.sdcard` passing.

## 2026-10-27 14:28 UTC session 0178hDCCfEKa4shai8LVS3FD (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #328 (M1-10 line 5) merged at ee34b76; CI x64 8:44, arm64 1:07.
- Worked on: M1-13 part 1 (tracking issue #329): line 3, renderer frame callbacks drop to zero while an emulator has the screen.
- Result: PR (this one).
  - While a game has the screen, `useGamepad` (`src/renderer/src/input/gamepad.ts`) reads the pad on a `SUSPENDED_POLL_MS` timer instead of every animation frame. The Start hold, the way back from a hung emulator, is still found.
  - The perf overlay is taken down while anything covers RomMix (`App.tsx`). Its unmount reports the screen's summary and stops its frame loop and its timers.
  - Nothing else in the renderer asks for frames.
  - M1-13 stays false.
- Evidence:
  - `gamepad.test.tsx` (+3, harness now steps timers on the test's clock): no frame waiting and one read on the timer while suspended; back on every frame once the game has gone; nothing left waiting on unmount. Two existing tests now let go of Start, or wait after the game ends, for a timer period rather than one frame.
  - `test/app/running.test.ts`: every `requestAnimationFrame` callback the page runs is counted at the global, with the perf overlay on. Frames are drawn at the game page; zero over 2 s while the stubborn stand-in has the screen and the overlay is down; drawn again and the overlay back after it is forced closed. Without the source change it fails (overlay still up). The file passes 3/3 in a row.
  - `scripts/agent/check.sh` green; `npm run test:app` 262/262. No screen changed, so no shots.
- Evaluator: PASS (two of three hand mutations caught; the third, the frame cancel on unmount, is now caught by the unmount test, checked by hand). Its note on a stale "sixty times a second" comment in `edge` is fixed.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-13 part 2: notices raised during play are queued and shown after the game ends.

## 2026-10-27 15:00 UTC session 0178hDCCfEKa4shai8LVS3FD (hourly heartbeat, second unit)

- Device results: none new (as above). #330 (M1-13 part 1) merged at 46b0c2e; CI x64 8:30, arm64 0:57.
- Worked on: M1-13 part 2 (tracking issue #329): line 2, "Notifications raised during play are queued and shown after the game ends".
- Result: PR (this one).
  - `NoticeGate` (`src/renderer/src/notices.ts`, pure) holds every notice offered while something covers RomMix, in order, and shows them when nothing does.
  - `notify` in `state.tsx` offers each toast to the gate. A toast's time on screen starts when it is shown.
  - The gate is told about cover in the `running:state` handler itself, not from a later render, so nothing raised in between slips out in front of the game.
  - M1-13 stays false.
- Evidence: `notices.test.ts` (4): shown at once with nothing in front; two raised during play wait and come out in order after; shown once only across later launches; a repeated "covered" keeps them waiting. `scripts/agent/check.sh` green; `npm run test:app` 262/262. No screen changed, so no shots.
- Evaluator: PASS (three hand mutations of the gate, each caught). Its note: nothing yet tests the wiring in `state.tsx`, so dropping `setCovered` would pass today. Part 3's app scenario must assert the download's toast is absent while the game runs and present after it exits.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-13 part 3: test:app counts BrowserWindow instances through a launch with a download finishing mid-game, and its notice appears after the exit; refocus and redraw once after exit. Then part 4, the device checks.

## 2026-10-27 15:28 UTC session 0178hDCAGCRcFTXZb4xHXe6r (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #331 (M1-13 part 2) merged at ec85177; CI x64 8:31, arm64 1:02.
- Worked on: M1-13 part 3 (tracking issue #329): line 1, "A test:app scenario counts BrowserWindow instances and asserts no new window appears during a launch, including when a download finishes mid-game".
- Result: PR (this one). Test-only.
  - `App.windows()` (`test/app/driver.ts`) counts the page targets the debugger lists: one per BrowserWindow, and one per DevTools window.
  - `test/app/running.test.ts`: a second game's download is held in flight (`holdContent`) while the stubborn stand-in is launched. One window before the launch. The download is let through during play: still one window, and no "Download complete" toast for that game while the game has the screen. After the game is forced closed, the toast is shown and there is still one window. This also tests the `NoticeGate` wiring in `state.tsx` that part 2's evaluator noted as untested.
  - M1-13 stays false.
- Evidence: `running.test.ts` 7/7. With `notices.setCovered(...)` removed from `state.tsx` by hand, "a download finishing during play opens no window, and its notice waits" fails ("its notice should wait"); restored. `scripts/agent/check.sh` green; `npm run test:app` 263/263 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root; CI keeps the sandbox). No screen changed, so no shots.
- Evaluator: PASS (its own mutation, a hidden `BrowserWindow` opened when a second game is installed, is caught: 2 windows, expected 1). First CI run red only on the PR-body check (no `Feature:` line); fixed in the body.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-13 part 4: device checks `focus.no-new-window` and `focus.return` (self-test scenario or run.sh step, TESTING.md catalogue), then READY-FOR-DEVICE M1-13. Refocus and redraw once after exit goes with `focus.return`.

## 2026-10-27 16:26 UTC session 0178hDCAtZx71yLBTnm5xNCE (hourly heartbeat)

- Device results: none new since 1ac4cb4 (bridge last seen 2026-10-25 14:02 UTC, "not on the charger"); no safety failures, no regressions. #332 (M1-13 part 3) merged at 986d38e; CI x64 8:29, arm64 1:06.
- Worked on: M1-13 part 4a (tracking issue #329): line 5, device check `focus.return`, and the description's "re-focus and redraw the launcher window once" after an exit.
- Result: PR (this one).
  - `reclaimScreen` (`src/main/reclaim.ts`): the window restored if minimised, focused, and drawn once (`webContents.invalidate`). `RomMix.reclaimScreen` calls it when a game launch ends (`ipc/game.ts`) and when an emulator started on its own exits (`ipc/emulators.ts`).
  - `launchCycle` calls the same reclaim (`LaunchDeps.reclaim`, wired in `index.ts`) once the group is gone and before it looks for the focus, so `refocusMs` measures what a player gets back. Each exit check now carries `refocused` (1, 0, or null when the cycle could not ask).
  - `focus.return` (`focusReturn`, `emulatorScenarios`): reads every emulator cycle the request names, running any not yet run (each still once). Fails `not-refocused` naming the emulators in `missed`; skips `no-exit-measured` when no exit could ask. run.sh always asks for it. TESTING.md describes it.
  - M1-13 stays false.
- Evidence: `selftestlaunch.test.ts` 35/35 (+3: reclaim after the group is gone and before the focus is asked; a reclaim that throws is still measured; `refocused` 1/0/null, no reclaim after a kill). `selftestemulators.test.ts` (+7 `focus.return`: pass with the slowest return; fail naming the emulator; unasked exits count neither way; none measured skips; asked first it runs each cycle once; absent when not asked; skips with no emulator). `reclaim.test.ts` (3). `test/app/selftest.test.ts`: `focus.return` in the real app skips `no-exit-measured`. `scripts/agent/check.sh` green; `npm run test:app` 263/263 (Electron through a `--no-sandbox` wrapper in the scratchpad, as root). No screen changed, so no shots.
- Evaluator: see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-13 part 4b: device check `focus.no-new-window` (a download finishing while the sandboxed emulator has the screen maps no window; its notice appears after the exit), then READY-FOR-DEVICE M1-13.

## 2026-10-27 16:51 UTC session 0178hDCAtZx71yLBTnm5xNCE (hourly heartbeat, second unit)

- Device results: none new (as above). #333 (M1-13 part 4a) merged at 68c9011; CI x64 8:00, arm64 1:07.
- Worked on: M1-13 part 4b-i (tracking issue #329): the two pieces `focus.no-new-window` stands on, both tested against fakes. Part 4b-ii wires them into the scenario.
- Result: PR (this one).
  - `WindowFinder.windowsOf(group)` (`selftestwindows.ts`) lists every window of a process group by id, in ascending order. Two readings compare equal exactly when nothing was mapped or taken away between them. It returns null on a display that cannot tie a window to a process.
  - `LaunchDeps.whileShown` (`selftestlaunch.ts`) is work started once the emulator's focused window is seen, such as the download that must finish behind the game. The window stays up until the work has settled as well as for the settle, up to `WHILE_SHOWN_MS`. The work's signal is aborted before the stop is asked, and on the player's abort. Work that throws has settled. With no window, or after an early exit, it is never started.
  - Nothing calls either yet. M1-13 stays false.
- Evidence: `selftestwindows.test.ts` +3: the group's windows in order, nested and from the tree; the client list, deduplicated; empty versus unknown. `selftestlaunch.test.ts` 41/41, +6: started on the focused window and kept up until done; a quick task still gets the settle; a task that never ends is stopped past the limit; a task that throws or rejects; none without a window or after an early exit; the player's abort. `scripts/agent/check.sh` green. No app code path changed, so no `test:app`; no shots.
- Evaluator: see the PR.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Device / acceptance: none yet.
- Next: M1-13 part 4b-ii, the `focus.no-new-window` scenario:
  - tell the renderer a game covers it;
  - run the sandboxed cycle with a small download as `whileShown`;
  - compare Galleon's `windowsOf` before, during and after;
  - read the toast after the exit;
  - then READY-FOR-DEVICE M1-13.
