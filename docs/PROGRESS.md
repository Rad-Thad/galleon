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
- Evaluator: see the PR.
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
- Evaluator: see the PR.
- Device / acceptance: none (`ci`).
- Next: M0-09 (screenshot harness), then M0-11.
- Notes:
  - The fetcher is not in CI's `Docker RomM` step: the suites there need only the synthetic files, and a download would add a network dependency to the required check. The device bundle (PLAN.md section 5, step 5) is its consumer.

## 2026-10-09 00:45 UTC session cloud (routine run, second unit)

- Device results: none new (as above).
- Worked on: flaky issue #31: `test/app/setup.test.ts` "it comes up asking for a server rather than showing a library" failed on PR #30's x64 leg with `undefined !== ''` and passed on its one re-run.
- Result: PR (this one). M0-07's PR #30 merged at 726216c; its CI wall time was arm64 3:25, x64 4:26 (the re-run; the first x64 run, 4:20, hit this flake).
- Evidence:
  - Cause: the scenario waited for `[data-screen="setup"]` and read `.field__input` once. `SetupScreen` renders an empty content area under that marker until the settings arrive and choose a page, so a slow first render had no field to read. The test now waits for the field, and still asserts it starts empty.
  - Reproduction: not forced locally. The unfixed test passed 3/3 on the VM as an unprivileged user with twelve busy loops on four CPUs; the race is shown by the code path above and by the CI failure.
  - `setup.test.ts` with the fix: 13/13 on the VM. Stress run (`stress.yml`, app suite, x64, 10 runs) on ec5ef11: see the PR.
  - `scripts/agent/check.sh` green.
- CI wall time: recorded in the next entry (this entry rides the PR).
- Evaluator: see the PR.
- Device / acceptance: none (`ci`).
- Next: M0-09 (screenshot harness).
