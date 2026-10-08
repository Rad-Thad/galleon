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
- Result: see the PR linked from #12.
- Evidence: ADR 0004 records the any-hour window and the per-merge `nightly` publish. PLAN.md section 4 (release.yml's per-merge publish step under the `nightly` concurrency group; nightly.yml's early-exit reference), section 5 (shape, window, risks), TESTING.md and the bridge README no longer say testing happens overnight. New bridge unit test `test_equal_ends_mean_any_hour` pins that `00:00-00:00` is the whole day; the bridge program itself is unchanged, so no version bump. `scripts/agent/check.sh` green; `python3 -m unittest discover -s tools/device-bridge` 21/21.
- CI wall time: see the PR.
- Evaluator: see the PR.
- Device / acceptance: none.
- Next: M0-03 (lowest eligible id). M0-24 must include the per-merge publish (ADR 0004) when it is built.
- Notes: Docker's daemon was not running on this VM; `dockerd` started by hand before `init.sh` passed.
