# Development plan

This is the plan for building **Galleon** (the final name, decided by the owner; see [ADR 0001](decisions/0001-fork-rommix.md)), an Argosy-like RomM launcher for armadaOS on the Retroid Pocket Nova, by hard-forking RomMix. The cloud agent builds it, and the **device bridge** on the Nova tests every nightly on real hardware. The owner takes part once, near the end, in a single acceptance session ([ADR 0003](decisions/0003-autonomous-verification.md)).

How the documents fit together:

- **This file** says what to build in which order, how each piece is proven, and where the decision points are.
- [features.json](features.json) is the machine-readable list of 158 features with acceptance criteria. The agent only ever flips `passes`.
- [PROGRESS.md](PROGRESS.md) is the append-only session log.
- [decisions/](decisions/) holds the ADRs: 0001 forking RomMix, 0002 save-sync compatibility, 0003 autonomous verification (the device bridge and the acceptance session).
- [TESTING.md](TESTING.md) is how everything is tested: the tiers, the device check catalogue, `summary.json`, and the acceptance session.
- [tools/device-bridge/README.md](../tools/device-bridge/README.md) documents the bridge program that runs on the Nova.
- [research/](research/README.md) explains why things are the way they are.
- [DEVICE-FACTS.md](DEVICE-FACTS.md) and [REQUIREMENTS-FROM-TESTER.md](REQUIREMENTS-FROM-TESTER.md) are ground truth about the device and the owner's 15 requirements (REQ-1..15 in features.json).

Feature ids (M1-11 and so on) are used throughout. When this file and features.json disagree about acceptance, features.json wins. When they disagree about order or approach, this file wins.

---

## 1. Where things stand

| Decision point                                                     | Status                                       | Result                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Gate 0**: stock RomMix v0.20.0 on the Nova, no agent code        | **PASSED** 2026-10-08                        | Proceed with the RomMix hard fork. The Godot fallback is not needed. See PHASE 0 RESULTS below. |
| **Gate 1**: the week-one fork build, measured by the device bridge | **Next decision point** (end of M1)          | Pending. Automated thresholds in section 9.                                                     |
| **Gate 2**: saves travel between Argosy (Android) and Linux        | Device checks after M2; real trip at the end | Pending. The real round trip is part of the acceptance session. Never triggers a stack change.  |
| **Final acceptance session** with the owner                        | Near the end (M8-07)                         | The owner's only part in development.                                                           |
| Stable 1.0                                                         | In the acceptance session                    | Defined in M8-01.                                                                               |

**Repository.** `github.com/Rad-Thad/galleon` exists: public, `main` is RomMix v0.20.0 (`ea787b98`), RomMix's tags not pushed. Its first CI runs were green in 3.5 min (x64) and 3.3 min (arm64) but flaky on the same commit, so **M0-00 (a reliably green baseline) is the first unit of work**. Dependabot has opened PRs #1 (electron 44.4.5 to 44.5.1, CI red), #2 (tooling group, CI red) and #3 (lucide-react, CI green); triage them after M0-00 merges, under CLAUDE.md rule 7 (an Electron update also needs a clean device run).

---

## PHASE 0 RESULTS

> The placeholder was filled in at handoff from the owner's run and the RomMix v0.20.0 logs on 2026-10-08. The agent records later Gate 0 traceability in a `gate` issue (M1-01). Do not edit the measured results; append below them if something is re-tested.

**Setup used.** Stock RomMix v0.20.0 arm64 AppImage and `rommix-steam.sh` in `~/Applications/rommix/`. RomM 5.2.0 over plain http on a non-default port on the LAN (the address is deliberately not recorded here). Two runs:

- **Desktop Mode:** KDE Plasma, native Wayland session.
- **Game Mode:** gamescope, X11 session on display `:1`. RomMix's launcher script fell back to `--ozone-platform=x11` through XWayland.

| Criterion                                                                | Result                              | Evidence and notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G0-1** Runs fullscreen at 1280x960 from Game Mode, no black screen     | **PASS**                            | Ran under gamescope via XWayland (ozone x11 fallback). **Caveat:** Steam's "Add a Non-Steam Game -> Browse" file picker never opened under KDE. The owner worked around it with a hand-written `~/.local/share/applications/rommix.desktop` (Exec = the Steam script), which then appeared in Steam's program list.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **G0-2** Pairing and listing against 5.2.0                               | **PASS with workarounds**           | (a) An address typed without a scheme was turned into `https://` and failed with "fetch failed". Typing `http://` worked. (b) Approving through the login redirect (`/login?next=/pair/device?user_code=...`) was confusing. Approving at `/pair/device?user_code=...` in a browser already signed in to RomM worked. The library listed.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **G0-3** Scrolling large platforms at least as smooth as Steam's library | **PASS on the Performance profile** | Desktop Mode: smooth. Game Mode on Armada's default **Balanced** profile: "considerably laggier". Balanced means conservative governor, prime core capped at 2092 MHz (idle about 595 MHz), GPU `simple_ondemand` 220-680 MHz. Chromium's GPU process was hardware-accelerated (`/dev/dri/renderD128`, Mesa `libgallium` 26.2.3 through GLX, not SwiftShader or llvmpipe) at about 20% CPU. With **Performance** (performance governor, no underclock, `gpu_min=1.0`) it felt on par with Desktop Mode. Root cause: governor ramp and underclock, not Electron or Turnip. Profiles are defined in `/usr/share/armada/power-profiles.conf` (default `balanced`); the per-app override state is in `/run/armada/perf-state.json`, keyed by Steam appid. |
| **G0-4** Controls usable and text legible at 4:3                         | **PASS**                            | Navigated with the Nova's controls under Steam Input in Game Mode, and in Desktop Mode, where it "looks and runs fine". RomMix is laid out for 1080p, so the 4:3 redesign is still required (M1-15, M4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **G0-5** A download shows progress in the app                            | **PASS**                            | A 1.46 GB GameCube ISO downloaded in 32 s (about 46 MB/s over Wi-Fi) to `~/rommix/roms/gc/` on internal storage. **Caveat:** the owner wants games on the ext4 SD card at `/run/media/armada/NovaSD`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **G0-6** RetroArch opens in front and plays                              | **PASS**                            | An SNES game launched through the RetroArch flatpak (`org.libretro.RetroArch`) and was playable. The emulator window took focus under gamescope. The pre-launch save pull ran (nothing on the server yet).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **G0-7** Holding Start returns to the launcher                           | **PASS**                            | Held about 1.5 s. RomMix asked the flatpak to quit (`stopFlatpakApp`, a SIGTERM to the sandbox's processes), RetroArch exited with code 0 about 300 ms later, and focus returned to RomMix. No force kill. Works through Steam Input and InputPlumber.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **G0-8** The save reaches RomM                                           | **PASS (mechanism)**                | The session's save was found and held for confirmation ("session saves awaiting confirmation {files:1}"), because RomMix asks before sending saves by default. The play session (16 s) was reported to RomM. The upload itself was not exercised (`uploadedSaves: 0`); M2 covers it with the test account.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Other observations:**

- Only RetroArch was detected. RetroDECK, EmuDeck, Eden and shadPS4 were listed as missing.
- DuckStation and ARMSX2 (AppImages in `~/Applications`) and Dolphin, PPSSPP and Flycast (system flatpaks) were not recognised.
- The pre-flight warned "Flathub is not set up for your user", although Armada's flatpaks are system installs.
- RomMix logged "no OS keyring available, credentials are stored in plain text". The file is written with mode 0600.
- Platform icons `/assets/platforms/systematic/{gc,wii-u}.svg` and `/assets/platforms/{gc,wii-u}.svg` returned 404 on RomM 5.2.0.
- Manuals failed: "refused an image request that is not an asset path {path: roms/<p>/<r>/manual/<id>.pdf}".
- RomMix data on the device: `~/rommix` (`config/settings.json`, `logs/app.log`, `logs/launcher.log`, `roms/`) and Electron profile `~/.config/rommix`. The fork must leave these alone.

**Gate 0 decision: PASS. Proceed with the RomMix hard fork.** The next decision point is **Gate 1**.

**Revision, 2026-10-08 (ADR 0003).** Development no longer uses the owner for testing. Where G0-8 says M2 "covers it with the test account", read: device tests never write to the server, save checks run against a fake RomM on the device (M2-20), and the real round trip happens once, in the final acceptance session (M2-19). Stock RomMix's sign-in on the Nova is reused, read-only, by the device tests and by Galleon's first-run import (M1-30).

**Phase 0 caveats and the features that address them** (M1-01 checks every id exists):

| Caveat                                                                                | Feature(s)                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Steam's file picker broken; adding the launcher to Steam must be automatic            | M0-17, M1-29, M3-01                                           |
| Only RetroArch detected; Armada's standalone emulators unknown; false Flathub warning | M1-02, M1-03, M1-04, M1-05, M1-06, M1-07, M1-08, M1-09, M1-23 |
| ROMs on internal storage; SD card wanted; card may be absent                          | M1-10                                                         |
| Address without a scheme forced to https                                              | M1-21                                                         |
| Pairing approval through the login redirect is confusing                              | M1-22                                                         |
| Credentials in plain text without a keyring                                           | M1-24                                                         |
| Platform icons 404 on 5.2.0                                                           | M1-26                                                         |
| Manual PDF paths refused                                                              | M1-25                                                         |
| Lag on the Balanced profile                                                           | M1-16, M1-27, M4-34, M6-15                                    |
| Exit works with Start held; the owner first asked for Select+Start                    | M1-11, M1-28                                                  |
| Fork must not collide with stock RomMix's folders on the device                       | M0-04                                                         |
| Stock RomMix is signed in on the Nova; pairing again should not be needed             | M1-30, M0-22                                                  |

---

## 2. Architecture of the fork

### What stays from RomMix (v0.20.0)

| Area                                                              | Where                                                                                                                                                                                                                                                                                       | Kept as is                                                                                  | Changed by this plan                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Electron main process: RomM client, transfers, checksums, devices | `src/main/romm/` (`client.ts`, `transfer.ts`, `checksums.ts`, `devices.ts`, `version.ts`)                                                                                                                                                                                                   | Typed hand-written client, schema conformance tests against `schema/romm-*.json`            | Scheme probing (M1-21), pairing UX (M1-22), save transfer semantics (M2-06), If-Range (M3-04)        |
| Downloads and install                                             | `src/main/downloads.ts`, `install.ts`, `zip.ts`, `disk.ts`                                                                                                                                                                                                                                  | Serial queue, `.part` files, Range resume, hash verify, multi-disc unpack                   | Speed/ETA/cancel (M1-18), SD card (M1-10), per-file resume (M6-05), multi-disc assembly (M6-04)      |
| Launching                                                         | `src/main/launcher.ts`, `host.ts`, `emulatorexit.ts`, `emulators.ts`                                                                                                                                                                                                                        | Spawn as a descendant (`detached` process group), graceful flatpak stop, exit reading       | Clean environment (M1-12), escalation and save flush (M1-11), focus rules (M1-13)                    |
| Emulator registry                                                 | `src/config/emulators/` (descriptor types in `types.ts`, worked example in `example/index.ts`, `savepaths.ts`)                                                                                                                                                                              | Emulators as compiler-checked data; nothing outside `src/config/` names one                 | Seven Armada descriptors (M1-02..M1-08), ordering and arch filter (M1-23)                            |
| Systems                                                           | `src/config/systems.ts`                                                                                                                                                                                                                                                                     | ES-DE system names as platform keys; RomM slug mapping                                      | Icon mapping (M1-26)                                                                                 |
| Save sync                                                         | `src/main/saves.ts`, `savefiles.ts`, `savepairing.ts`, `saveenv.ts`                                                                                                                                                                                                                         | `autosave` slot, backups, per-game serialisation, Saves tab                                 | Argosy-compatible engine (M2, ADR 0002)                                                              |
| Renderer                                                          | `src/renderer/src/` (screens in `screens/<Name>/index.tsx`, focus engine in `input/`, themes in `styles/themes/`)                                                                                                                                                                           | React 19, pad-first focus engine, `data-*` test handles                                     | 4:3 design system and new screens (M4)                                                               |
| Strings                                                           | `src/shared/i18n/{en,fr,de,es}.ts`                                                                                                                                                                                                                                                          | Four catalogues, all keys required                                                          | New strings in all four                                                                              |
| Updater and channels                                              | `src/main/update.ts`, `release.yml` canary job                                                                                                                                                                                                                                              | Automatic updates; rolling `canary` pre-release from `main`; `ROMMIX_CANARY` and `--canary` | Repointed to this repo (M0-04), checksums (M0-13)                                                    |
| Tests                                                             | `npm test` (node:test, `scripts/test-resolve.mjs`), `npm run test:coverage` (floor lines 96, branches 88, functions 89), `npm run test:app` (`test/app/` fake RomM in `server.ts`, pad driver in `driver.ts`, Xvfb via `scripts/headless.sh`), `npm run preview:app`, `npm run screenshots` | All of it                                                                                   | Coverage floor enforced in CI (it currently is not), Docker RomM (M0-06..08), 1280x960 shots (M0-09) |
| Packaging                                                         | `electron-builder.yml`, `packaging/rommix-steam.sh`, `packaging/rommix-launcher.sh` (ozone X11 fallback)                                                                                                                                                                                    | AppImage per arch, Steam script                                                             | Renamed (M0-04), `.desktop` entry and Steam registration (M0-17, M1-29)                              |

### What this fork adds

```
             Steam Game Mode (gamescope, Steam client, QAM, Steam Input, Decky)
                │ non-Steam shortcut: armada-game-launch %command% -> galleon-steam.sh
                ▼
 ┌──────────────── Galleon AppImage (Electron) ───────────────────────────────┐
 │ Renderer (React): 4:3 "Nova" design system (M4) - Now playing, Browse,     │
 │   panel, details, Series, Collections, drawer, L3/R3 menus, Downloads,     │
 │   Saves, Apps, screensaver - frame-time overlay (M0-10)                    │
 │──────────────────────── preload bridge (IPC) ──────────────────────────────│
 │ Main process                                                               │
 │   RomM client (+ scheme probe, pairing UX)    Library index (M4-01)        │
 │   Download queue (+ ETA, SD card, sleep-safe)  Save engine: Argosy-compat  │
 │   Launcher (+ clean env, exit escalation)        (negotiate, slots, 409,   │
 │   Steam provider (VDF/ACF, rungameid) (M1-14)     archive adapters) (M2)   │
 │   Power-state reader (M1-16)                  Config overlays (M7-02)      │
 │   Diagnostics bundle (M0-11), reports via the device bridge (M0-12)        │
 │   Self-test mode (M0-21): read-only guard, sandboxes, summary.json         │
 │   Core socket $XDG_RUNTIME_DIR/galleon/core.sock (M1-17) ◄──┐              │
 └──────────────────────────────────────────────────────────────┼─────────────┘
        │ spawns as descendants (focus by appID inheritance)    │
        ▼                                                       │
  DuckStation, ARMSX2, melonDS (AppImages) / RetroArch, Dolphin,│
  PPSSPP, Flycast (system flatpaks) / steam://rungameid/<id>    │
                                                                │
  Decky companion (decky/, M3-01): QAM status, quit, install ───┘
```

Rules the architecture depends on, from [armada_integration.md](research/armada_integration.md):

- **Focus.** Emulators are direct descendants of the launcher, which Steam started. gamescope gives them the launcher's appID, and the newest mapped window wins focus. Never double-fork, never `systemd-run`, never set `STEAM_GAME`, and **never map a new window while a game runs** (M1-13).
- **Exit.** Holding Start, read through Chromium's Gamepad API, already works in Game Mode (Phase 0). The stop policy is one SIGTERM per process, a grace period, then SIGKILL. Flatpaks get SIGTERM to the sandbox's processes before `flatpak kill`, which SIGKILLs. _Contingency:_ if a future Steam or InputPlumber change hides pads from an unfocused Chromium, add a small C helper that polls key state with `EVIOCGKEY` on `/dev/input/event*` nodes exposing BTN_SELECT/BTN_START. That reads through InputPlumber's grab, as Armada's own `armada-boot-hotkeys` does, and the `armada` user is in the `input` group. Not built unless needed.
- **Power.** Armada keys per-game power profiles by Steam appid, so emulators inherit the launcher's profile. The launcher reads the profile but never changes it (M1-16).
- **Packaging.** One AppImage in `~/Applications`. Never write `/usr` or `/etc`. Flathub is ruled out (launchers and AI-generated submissions are refused). Distribution is GitHub Releases, later the Armada Store catalog (M8-02).
- **Sleep.** s2idle freezes the user slice and drops Wi-Fi. Downloads resume with Range and If-Range after connectivity returns (M3-04).

### Code placement rules (inherited from RomMix CONTRIBUTING.md, plus fork rules)

- Emulator facts live only in `src/config/emulators/<id>/index.ts`, and nothing in `src/config/` imports `node:`. Machine probing (find rules, power state, Steam files) lives in `src/main/`.
- New main-process subjects get a folder: `src/main/steam/`, `src/main/power/`, `src/main/core-socket/`, `src/main/saves-compat/`. New IPC goes in `src/main/ipc/<subject>.ts`.
- New screens go in `src/renderer/src/screens/<Name>/index.tsx`, with rules lifted into plain `.ts` modules so `npm test` reaches them.
- Native code (only if the EVIOCGKEY contingency is triggered) goes in `native/<name>/`, built from source in CI per architecture.
- The Decky companion lives in `decky/` with its own package.json, built in CI.
- Agent tooling lives in `scripts/agent/`; the device test bundle in `test/device/`; the device bridge in `tools/device-bridge/`; Docker RomM in `test/romm/`; golden save fixtures in `test/fixtures/saves/`.

---

## 3. How work is proven

| Tier        | Where                                                                                                                                   | What it proves                                                                                                                      | Who looks                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Unit        | `npm test` on the cloud VM; CI on x64 for pull requests, both architectures nightly                                                     | Rules: descriptors, parsers, state machines, redaction, hashing                                                                     | CI                                            |
| Coverage    | `npm run test:coverage`                                                                                                                 | Floor: lines 96%, branches 88%, functions 89% (package.json). Upstream CI never ran this; the fork's CI does (M0-05)                | CI                                            |
| App         | `npm run test:app` under Xvfb against `test/app/server.ts`                                                                              | Renderer, IPC and preload together; pad navigation; launch with a stand-in emulator                                                 | CI                                            |
| Real server | `npm run test:romm`, `npm run test:saves` against Docker RomM 5.2.0 and 5.3.1 (MariaDB on tmpfs, provisioned like Grout)                | API behaviour, pairing, downloads, Argosy-compatible save round trips                                                               | CI                                            |
| Screens     | `npm run shots:nova` at 1280x960 under Xvfb, contact sheet `artifacts/shots/index.html`                                                 | Layout at 4:3, nothing clipped, design applied                                                                                      | Agent (reads PNGs) and evaluator; CI artifact |
| Package     | electron-builder on `ubuntu-24.04` and `ubuntu-24.04-arm`, plus `npm run smoke:app` on arm64                                            | The aarch64 AppImage builds and starts natively on arm64                                                                            | CI                                            |
| **Device**  | The **device bridge** on the Nova, whenever it is idle on its charger (section 5): Galleon's self-test plus the bundle's harness checks | Focus, exit, rendering on Turnip, frame times under both power profiles, real emulator launches in sandboxes, Steam, read-only RomM | Bridge, then the agent from `device-results`  |
| Acceptance  | The owner, once, with the local Claude session (M8-07)                                                                                  | Only what needs a person: look and feel, the Argosy round trip on Android, button feel, shader picks, Decky, start on boot          | Owner                                         |

The cloud VM is x86_64 Ubuntu 24.04 with Docker. It has no LAN, cannot push tags, and `gh issue`/`gh pr` are blocked (GraphQL). Everything aarch64 runs on GitHub's free `ubuntu-24.04-arm` runners. Node 24 comes from the environment setup script (`docs/cloud-environment-setup.sh`). Nothing in the cloud reaches into the Nova: the bridge on the device pulls the nightly and pushes its results.

---

## 4. CI and release specification (built in M0)

Required status checks (set in the ruleset): **`build (ubuntu-24.04, x64)`** and **`build (ubuntu-24.04-arm, arm64)`**. They come from `.github/workflows/release.yml`'s `build` matrix job. **Never rename the workflow, the job or the matrix keys, and add every new gate as a step inside `build`.** A required check that is skipped counts as passing, so gates in separate jobs that `build` waits on are not safe, and `build` itself never gets a job-level `if:`.

### CI time budget

| What                               | Budget                                                                                 | Enforced by                              |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Each `build` leg on a pull request | Target at most 10 minutes (median of the last 10 PRs); hard `timeout-minutes: 20`      | M0-05, `node scripts/agent/ci-times.mjs` |
| `nightly.yml`                      | At most 30 minutes; `timeout-minutes: 30` on every job                                 | M0-24                                    |
| Device run on the Nova             | `DEVICE_TEST_BUDGET_SECONDS` (default 1800), plus the bridge's grace, then a hard stop | The bridge                               |

Measured baseline (RomMix v0.20.0, the first runs on the new repository): `npm ci` about 10 s, `format:check` 7 s, `npm test` 16 s, `npm run build` 4 s, packaging 29 s; green legs took 3.5 minutes on x64 and 3.3 on arm64.

1. **Expensive work once.** `format:check`, `lint`, `typecheck`, `test:coverage`, features-check, the bridge unit tests, `test:app` and the pull-request screenshot subset run only on x64, through step-level `if: matrix.arch == 'x64'` inside the one `build` job, so the required check names never change. arm64 runs build, package and `npm run smoke:app` (the packaged app starts under Xvfb, reaches Home and quits). Nightly runs the full suites on both architectures.
2. **Step-level path filters only.** One `changes` step (an inline `git diff --name-only <base>...HEAD`, or dorny/paths-filter pinned by SHA) sets `romm` (client, save, sync or fixture code: `src/main/romm/**`, `src/main/saves*.ts`, `src/main/saves-compat/**`, `test/romm/**`, `test/fixtures/**`, `schema/**`) and `docs_only` (only Markdown, `docs/**` and issue templates changed). Docker RomM steps run when `romm` is true; packaging is skipped only on docs-only pull requests. Pushes to `main` always package on both legs, because `canary` needs the images.
3. **Caches.** npm through setup-node; `~/.cache/electron` and `~/.cache/electron-builder` through actions/cache keyed on `package-lock.json`; RomM and MariaDB images pulled once per job by digest. A warm-up step fetches missing Electron assets with at most 3 attempts and back-off (the arm64 `EAI_AGAIN` flake); the build and the tests are never retried.
4. **Heavy suites nightly only.** Every `shots:nova` screen, the device test bundle, the full Docker matrix (5.2.0 and 5.3.1, `test:romm` and `test:saves`), and coverage and `test:app` on arm64 run in `nightly.yml`. Pull requests run a representative subset: Docker 5.2.0 when `romm` is true, and the screenshot subset.
5. **Concurrency.** Superseded pull-request runs are cancelled (as upstream does). `nightly.yml` uses `group: nightly` with `cancel-in-progress: false`, so nightlies never stack.
6. **Agent habits.** Run `scripts/agent/check.sh` on the VM before every push, so CI rarely fails and reruns; put up to three tightly related features in one PR; record each PR's CI wall time per leg in its PROGRESS.md entry. When a pull-request leg takes longer than 10 minutes, making CI fast again is the next unit of work, before new features.
7. **Flaky tests.** A test that fails and then passes on a rerun gets a `flaky` issue and a root-cause fix within the next two units of work. It is never retried, skipped or quarantined to get green, and raising a timeout is never the whole fix. M0-00 is the first case.

The repository is public, so GitHub-hosted runner minutes (including `ubuntu-24.04-arm`) cost nothing. The budget is about speed, not money.

### `.github/workflows/release.yml` (extend the existing file)

- Triggers stay: `push` to `main`, `pull_request`, `workflow_dispatch`. Drop the `tags: v*` trigger once `cut-release.yml` exists.
- `build` matrix job (M0-05), `timeout-minutes: 20`:
  - **x64:** checkout (with the base commit for the diff); setup-node 24 with npm cache; Electron caches; `npm ci`; `changes`; `npm run format:check`, `npm run lint`, `npm run typecheck`; `npm run test:coverage`; `node scripts/agent/features-check.mjs` (reads `GITHUB_TOKEN` and `origin/device-results` read-only; pull requests compare against `github.base_ref`); `python3 -m unittest discover -s tools/device-bridge`; PR-body check (`Feature:` line, pull requests only, M0-18); licence and dependency guard (M0-20); when `romm`: Docker RomM 5.2.0 up, provision, `npm run test:romm` and, from M2, `npm run test:saves`; `npm run build`; `npm run package -- --x64` (unless docs-only); `npx install-electron`, the chrome-sandbox setuid fix (as upstream), `npm run test:app`; `npm run shots:nova -- --subset pr`; upload `appimage-x64`, `shots-x64` and, on failure, `app-test-failures-x64`.
  - **arm64:** checkout; setup-node 24; Electron caches; `npm ci`; `changes`; `npm run build`; warm-up fetch; `npm run package -- --arm64` (unless docs-only); `npm run smoke:app`; upload `appimage-arm64`.
- `canary` job (existing): the tip of `main` becomes the rolling `canary` pre-release, the in-app update channel. Add `SHA256SUMS` and, from M3, the Decky zip. The job moves the tag with the workflow token, which Actions may do and the agent may not.
- `nightly` publish after every merge (M0-24, [ADR 0004](decisions/0004-device-tests-any-hour.md)): on `push` to `main`, the `build` legs also build the device test bundle, and a publish step in the `canary` job (under `concurrency: {group: nightly, cancel-in-progress: false}`, the group `nightly.yml` uses, so publishes never stack) refreshes the rolling `nightly` pre-release with the same asset names, moving the tag last. It is a step of the existing pipeline, not a new required check, and pull requests never run it.
- The tester-checklist job of the earlier plan is not built.

### New workflows the agent writes

| File                 | Trigger                                                           | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stress.yml`         | `workflow_dispatch` (inputs suite, runs, arch)                    | Runs `npm test` or `npm run test:app` back to back to prove a flaky test is fixed (M0-00).                                                                                                                                                                                                                                                                                                                                                                                      |
| `nightly.yml`        | daily schedule at an off-hour UTC time, `workflow_dispatch`       | Ends early when `main` has not moved since the last scheduled nightly (the per-merge publish in `release.yml` moves the `nightly` tag in between, so the tag is not the reference). Full suites on both architectures, builds the device test bundle, publishes the rolling `nightly` pre-release (both AppImages, `galleon-device-tests.tar.gz`, `build-info.json`, `SHA256SUMS`) and moves the `nightly` tag last (M0-24). This is what the bridge tests.                     |
| `cut-release.yml`    | `workflow_dispatch` (input `version`), environment `release`      | Verifies package.json and CHANGELOG, runs the build matrix through a reusable workflow (`workflow_call`), then creates the tag and release in the same run (softprops/action-gh-release pinned by SHA, `tag_name: v<version>`, `target_commitish: <sha>`). One run, because tags created with the workflow token start no other workflow. The `release` environment is approved by the owner, or by the local Claude session on the owner's word during the acceptance session. |
| `labels.yml`         | push to `main` touching `.github/labels.yml`, `workflow_dispatch` | Creates or updates labels (crazy-max/ghaction-github-labeler pinned by SHA, `skip-delete: true`).                                                                                                                                                                                                                                                                                                                                                                               |
| `upstream-watch.yml` | weekly schedule                                                   | Opens or updates `upstream: N new commits` (M0-19).                                                                                                                                                                                                                                                                                                                                                                                                                             |

There is no `agent-dispatch.yml` and no repository secret: nothing needs to wake the agent, because the Project and the hourly heartbeat Routine read owner issues and `device-results` at every session start. Every third-party action is pinned by commit SHA (upstream already does this for the release action). Jobs request the narrowest `permissions`.

### Branches, pull requests, merging

- The agent works on `claude/<feature-id>-<slug>` branches, opening one pull request per feature (or up to three tightly related ones) through REST: `gh api repos/$REPO/pulls -f title=... -f head=... -f base=main -F body=@body.md`.
- It merges its own pull request when both required checks are green **and** the evaluator subagent said PASS: `gh api -X PUT repos/$REPO/pulls/<n>/merge -f merge_method=squash`. Enabling auto-merge is GraphQL-only, so the agent polls `gh api repos/$REPO/commits/<sha>/check-runs` instead.
- **`device-results` is written only by the bridge** (with its deploy key) and, during the acceptance session, by the local Claude session. The agent reads it and never pushes to it.
- **Dependabot.** Triage after M0-00. Merge when CI is green and the evaluator agrees. An Electron update (any version) also needs the next nightly's device run to show no newly failing check; if one fails, revert the update first thing.
- Stable releases are owner-gated (environment approval). The agent prepares the release PR (version bump plus a CHANGELOG section written by hand in RomMix's style) for the acceptance session.

---

## 5. The device bridge (hardware in the loop)

This replaces the tester loop of the earlier plan ([ADR 0003](decisions/0003-autonomous-verification.md)). During development the owner files no issues, runs no checklists and judges no gates. Every device fact Galleon needs is measured by the bridge while the Nova sits idle on its charger, at any hour ([ADR 0004](decisions/0004-device-tests-any-hour.md)).

### 5.1 Shape

```
 cloud agent ──PR──▶ main ──every merge and nightly.yml──▶ `nightly` pre-release (public)
                                            Galleon-arm64.AppImage, galleon-device-tests.tar.gz,
                                            build-info.json, SHA256SUMS
                                                   │ HTTPS download, no token
 Nova: systemd user timer (hourly) ──▶ galleon-device-bridge ──▶ bundle/run.sh
                                                   │                  └─▶ Galleon, started by Steam,
                                                   │                      in self-test mode (M0-21)
                                                   ▼
                                 sanitise ──git push, deploy key──▶ `device-results` branch
 cloud agent, every session start ◀──────── git fetch ─────────────┘
```

| Part                                                  | Runs                         | Written by                      | Changes by                                      |
| ----------------------------------------------------- | ---------------------------- | ------------------------------- | ----------------------------------------------- |
| Bridge (`tools/device-bridge/`)                       | On the Nova, hourly timer    | The handoff kit; then the agent | Self-update from a nightly whose harness passed |
| Test bundle (`test/device/`, M0-22)                   | On the Nova, from the bridge | The agent                       | Every nightly                                   |
| Self-test mode (M0-21)                                | Inside Galleon               | The agent                       | Every nightly                                   |
| Ingestion (`scripts/agent/device-results.mjs`, M0-23) | Cloud, session start         | The agent                       | Pull requests                                   |

A `nightly` pre-release is published after every merge to `main` (release.yml) and by the scheduled `nightly.yml`, with the same tag and asset names, so the bridge needs no configuration change to pick up each new commit. The Nova runs the bridge with `WINDOW=00:00-00:00` (any hour), so a merged device feature normally gets results within about an hour when the Nova is idle on its charger ([ADR 0004](decisions/0004-device-tests-any-hour.md)).

The owner's Mac is not in this loop. The local Claude session on the Mac installs the bridge once over SSH (HANDOFF.md, Appendix A) and is otherwise unused until the acceptance session.

### 5.2 The bridge, on the Nova

The program and its operation are documented in [tools/device-bridge/README.md](../tools/device-bridge/README.md). The contract it keeps:

- **Where and how.** Installed under `~/.local` and `~/.config` only (`/usr` is read-only, nothing needs root), as the desktop user. A systemd user timer (`OnCalendar=hourly`, `Persistent=true`, `RandomizedDelaySec=10min`) starts a oneshot service. One run at a time (file lock). Python 3 standard library and POSIX sh; `git` and `ssh` for publishing.
- **Configuration.** `~/.config/galleon-device-bridge/config` (`KEY=VALUE`; created at install with `REPO=Rad-Thad/galleon`). It lives only on the device; no host, address or credential is ever committed.
- **Preconditions,** checked in this order; the first that fails ends the run with a logged reason:
  1. local time inside `WINDOW` (default `01:00-07:00`; the Nova's config sets `00:00-00:00`, any hour, per [ADR 0004](decisions/0004-device-tests-any-hour.md)); `galleon-device-bridge run --now` skips only this check;
  2. Game Mode active (`systemctl --user is-active gamescope-session-plus@steam.service`);
  3. on the charger and battery at or above 40% (`/sys/class/power_supply/*`);
  4. nothing playing: no process whose exact `comm` (from `/proc`, never `pgrep -f`) is a game, an emulator, a front end or Steam's `reaper`; an idle Galleon is not "playing" when its own `$XDG_RUNTIME_DIR/galleon/state.json` says `"idle": true` and is fresh;
  5. enough free space (3 GB);
  6. the network answers, the public `nightly` release carries all four assets, and its commit differs from the last one tested.
- **Run.** Download the AppImage and the bundle to `~/galleon-device-tests/<sha>/`, verify both against `SHA256SUMS`, unpack the bundle safely, check again that nothing started playing, then run `bundle/run.sh` (section 5.3) in its own process group. Past `DEVICE_TEST_BUDGET_SECONDS` plus a grace period, stop that group (SIGTERM, then SIGKILL; nothing it did not start) and run `run.sh --cleanup`.
- **Publish.** Sanitise everything in `RESULTS_DIR` (only `.json .log .txt .csv .tsv .md .png`; tokens, addresses, host names, account and network names redacted; a second scan withholds any file that still leaks; PNG text and EXIF chunks stripped; at most 80 files and 25 MB), add `bridge.json`, and push `results/<sha>/` with `results/index.json` and `results/latest.json` to `device-results` using a **repository deploy key with write access** (`~/.config/galleon-device-bridge/deploy_key`, mode 0600, `core.sshCommand` with `IdentitiesOnly=yes` and GitHub's pinned ed25519 host key). Never a force push. Only after a successful push is the commit recorded as tested.
- **Also published:** problem reports the owner saved in Galleon (`reports/<time>/`, M0-12), and once a day at most `bridge/status.json` (last seen, last commit tested, skip reasons), so the agent can tell "nothing to test" from "device away".
- **Retention.** The newest 3 test folders on the device; the newest 60 result folders on the branch.
- **Self-update.** The bundle carries `bridge/`, a copy of `tools/device-bridge/` from the same commit. After a run whose `harness.run` and `safety.owner-state` passed, a newer bridge version is installed with `install.sh --update`, which keeps the previous copy and restores it if the new one does not start. Bundle code already runs as this user, so this adds no trust it did not have.

### 5.3 `run.sh`: the contract (the agent's code, M0-22)

**Inputs** (environment, set by the bridge): `GALLEON_APPIMAGE` (verified AppImage), `RESULTS_DIR` (empty; `logs/` exists), `DEVICE_TEST_BUDGET_SECONDS` (default 1800), `GALLEON_SHA`, `GALLEON_TEST_DIR` (`~/galleon-device-tests/<sha>`), `GALLEON_TEST_ROOT` (`~/galleon-device-tests`), `GALLEON_BRIDGE_VERSION`, `GALLEON_READONLY_TOKEN_FILE`. `run.sh --cleanup` restores everything from its own state files and is safe to run at any time.

**Exit codes:** `0` results written (whatever they say); `10` skipped, with `summary.json` giving the reason (for example `no-importable-credentials` or `steam-cef-unavailable`); `20` stopped because someone used the controller; anything else is a harness error.

**Steps:**

1. `set -u`; a trap on exit runs the restore steps (9 to 11). Import the session's `DISPLAY`, `XAUTHORITY`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR` and `GAMESCOPE_WAYLAND_DISPLAY` from `systemctl --user show-environment`, or from `/proc/<pid>/environ` of the exact-named `steam` process owned by this user. Re-check Game Mode, idle and free space; exit 10 with a reason if any fails.
2. **Owner-state snapshot.** Write a manifest (path, size, mtime, SHA-256 for files under 64 MB) of everything the run must not change: stock RomMix's `~/rommix/config` and `~/.config/rommix`, the owner's Galleon config and credentials if installed, every emulator save, memory-card and config folder in DEVICE-FACTS.md, and `~/.local/share/Steam/userdata/*/config/shortcuts.vdf`. Back up the emulator config files. The manifest stays on the device; only the comparison is published.
3. **Separate home.** `GALLEON_HOME=$GALLEON_TEST_DIR/home`, recreated empty each run, with `sandbox/<emulator>/` folders whose BIOS files are links to the owner's BIOS folders (read-only use).
4. **Sign-in, read-only import,** in order: the bridge's read-only token file (from `galleon-device-bridge pair-readonly`, if it was ever needed); the owner's Galleon config; stock RomMix (`~/.config/rommix/root` pointer or `~/rommix`; `config/settings.json`, whose `server` holds `baseUrl`, `authMode` and maybe `username`; `config/credentials.bin`, a 4-byte magic `RAW1` then JSON `{accessToken, refreshToken, clientToken, deviceId}`, or `ENC1` when keyring-encrypted). Write into the test home: the base URL, the token, save sync up and down **off**, play sessions **off**, and **no device id**. `ENC1` or nothing found: run only the checks that need no server and report `no-importable-credentials` for the rest. Never upload a save, never write anything to the server.
5. **Payloads.** Copy the bundle's homebrew payloads (from the M0-07 manifest, each with its licence) into the test home. Download only small ROMs (the smallest SNES and GBA titles, at most 16 MB each), only into the test home; anything larger only as a capped Range read. From M2, start the fake RomM (M2-20) on 127.0.0.1.
6. **Test shortcut.** Make sure Steam has a non-Steam shortcut **Galleon Device Test** whose executable is `$GALLEON_TEST_ROOT/launch.sh` (and, for the Steam checks, **Galleon Device Test Target**, a script that shows a small window for a few seconds). While Steam runs, add it the way Armada Store does: `SteamClient.Apps.AddShortcut(name, exe, startDir, launchOptions)` through Steam's CEF debugger on 127.0.0.1:8080 (enabled by Armada's `launch-steam`), with `/usr/libexec/armada/armada-game-launch %command%` as launch options when that file exists. Keep the returned appid in `$GALLEON_TEST_ROOT/shortcut.json`. When that file is missing, look for the entry by name in `~/.local/share/Steam/userdata/*/config/shortcuts.vdf` (binary VDF, `appid` stored as a signed int32) before adding a new one. The game id is `(appid << 32) | 0x02000000` with appid unsigned. Never write `shortcuts.vdf` while Steam runs.
7. **Request.** Write `$GALLEON_TEST_ROOT/current.json` (AppImage, home, results folder, sha, an expiry at the end of the budget) for `launch.sh`, which refuses to start anything when it is missing or expired (so starting the shortcut by hand does nothing). Write `$GALLEON_HOME/self-test-request.json` (schema in TESTING.md): the scenarios and check ids, the power profiles to measure (`performance`, `balanced`), the payloads, the fake RomM address, and the handshake folder.
8. **Run.** Record the current power profile (`armada-power profile`), mute the default audio sink (`wpctl set-mute @DEFAULT_AUDIO_SINK@ 1`), and, if the owner's own Galleon is open and idle, ask it to quit through its core socket (M1-17). Start the shortcut with `steam steam://rungameid/<gameid>`; if `launch.sh` has not marked the start within 60 s, use the CEF route `SteamClient.Apps.RunGame(gameid, "", -1, 100)`. Then serve the self-test's handshake requests until it writes `summary.json`, quits, or the budget ends:
   - **profile:** the app writes `want-profile` with a name; run.sh runs `armada-power profile <name>` (allowed for the `wheel` group over D-Bus), waits for the governor in sysfs to match, and answers `profile-set` with the name, or `unchanged:<current>` when it cannot;
   - **screenshot:** `gamescopectl screenshot` into `RESULTS_DIR/shots/` when available;
   - **sampling:** governor, clocks, GPU frequency and battery every 5 s into `logs/power.csv`.
9. **Stop.** At the end of the budget write `stop` into the handshake folder and wait 30 s; then SIGTERM, and after a grace SIGKILL, only the pids `launch.sh` recorded. The run is then `partial`.
10. **Collect.** Merge the app's `summary.json` with the harness checks (`harness.run`, `safety.owner-state`, `install.script`, `steam.shortcut-roundtrip`, and `argosy.shapes` or `saves.fake-server` when requested) into `RESULTS_DIR/summary.json`; copy logs and screenshots; apply the same sanitiser rules as the bridge.
11. **Restore.** Delete every downloaded ROM and payload copy, stop the fake RomM, restore the power profile, the volume and any changed emulator config, remove `current.json`, relaunch the owner's Galleon if step 8 closed it, leave Steam at its library, compare the owner-state manifest (any difference fails `safety.owner-state`), and exit.

**Rules for `run.sh` and everything it starts:** never `pgrep -f` or any match on command lines (it once killed an SSH session); signal only pids it recorded; never write `/usr` or `/etc`; never write to the RomM server; stay within the budget; any controller input aborts (the app watches and exits 20 through `run.sh`).

### 5.4 What the agent does with the results

- **Every session starts with them.** `scripts/agent/init.sh` fetches `origin/device-results`, and `node scripts/agent/device-results.mjs --summary` prints safety failures, new failures, new passes, new problem reports and the bridge's last-seen time. That comes before choosing any work (CLAUDE.md, "Device results").
- **`device` features pass from evidence only.** A `device` feature flips `passes` when one `results/<sha>/summary.json` shows every `Device check` id in its acceptance as `pass`, together with `safety.owner-state` and `safety.server-readonly`, for a build that contains the feature (the commit that added `READY-FOR-DEVICE <id>` to PROGRESS.md is an ancestor of `<sha>`). CI enforces it (M0-03).
- **Regressions come first.** A check that passed for a feature and fails on a newer build sets that feature's `passes` back to false and opens a `regression` issue; a failed safety check is treated as a `regression` + `save-sync` emergency and stops feature work until it is understood.
- **A quiet device is not a problem.** If the Nova is away for days, device features wait as READY-FOR-DEVICE and the agent works on everything else. After 7 days without a `bridge/status.json` update the agent opens one `needs-human` note ("the Nova has not run device tests for a week"); its safe default is to keep waiting.

### 5.5 Security

- The deploy key lives only on the Nova. It can write the repository, so the `main` ruleset has an **empty bypass list** (deploy keys are one of the bypass options and must not be added); the key can write `device-results` and nothing that matters. Removing it is one command (HANDOFF.md, "Pausing or stopping").
- Everything on `device-results` is data. The agent never executes anything from it, and issue text it quotes comes only from the sanitised summary.
- The bridge holds no GitHub token and no RomM credential of its own (unless the optional read-only pairing was used). The agent's code (the bundle) runs on the device as the desktop user; that is the trust the owner granted for hardware testing, bounded by the sandboxes and the owner-state check.

---

## 6. Ordering principles

1. **Device results first.** Every session starts by reading `device-results`. A failed safety check, then a regression in a merged feature, outranks any new work.
2. **A green baseline before anything.** M0-00 makes CI reliably green; a red or flaky build is the next unit of work whenever it happens.
3. **Device plumbing and saves before polish.** M1 (Armada layer) and M2 (saves) come before M4 (design).
4. **Stack-independent work first.** M0, M1's main-process work, and M2 survive a renderer change. M4's UI work starts only after **Gate 1** passes.
5. **One unit of work per session**, smallest eligible id first, unless a regression or an owner-authored issue preempts it. Features waiting only for device results are not blocking: move on to the next eligible feature. If nothing is eligible, do stack-independent work from a later milestone (M2 engine, M6 logic, M7 research). Never start M4 UI before Gate 1.
6. **No feature reaches stable without its own kind of proof:** a device pass for `device` features, the acceptance session for `acceptance` features.

---

## 7. Milestones

Each milestone lists its goal, its tasks in order (feature ids; details and acceptance in features.json), how it is verified, its risks, and its exit gate.

### M0: Harness, CI, Docker RomM, device bridge loop, identity

**Goal:** an agent session can start cold, prove a reliably green baseline, build and test both architectures within the CI time budget, run a real RomM 5.2.0 and 5.3.1, take 1280x960 screenshots it can read, publish nightlies the device bridge tests, and read the results.

**Tasks, in order:**

1. **M0-00** A reliably green baseline: fix the flaky download-queue tests (unit and app) and the arm64 packaging fetch at the root, proven by `stress.yml`. Then triage Dependabot PRs #1-#3.
2. **M0-01** Overlay check: placeholders, removed upstream skills, `docs/UPSTREAM.md` (base `ea787b98`, studied `990e55e3`).
3. **M0-02** `scripts/agent/{init.sh,check.sh,next.mjs}`, `.claude/settings.json` Stop and SessionStart hooks; init.sh shows the newest device results.
4. **M0-03** `scripts/agent/features-check.mjs`, including the device and acceptance evidence rules.
5. **M0-04** Rebrand: `package.json`, `electron-builder.yml`, `packaging/rommix-steam.sh` -> `galleon-steam.sh`, `packaging/rommix-launcher.sh`, `src/main/root.ts` (`DEFAULT_DIR_NAME`, XDG pointer, `GALLEON_HOME`), `src/main/update.ts` (`RELEASE_API`, `RELEASE_LIST_API`, `CANARY_API`, `CANARY_COMMIT_API`, `RELEASES_PAGE`), `src/shared/i18n/*.ts`, README.
6. **M0-06** `test/romm/compose.yml` and `provision.mjs` (port of Grout's `test/e2e/romm/provision.py`, MIT). **M0-07** fixture library and homebrew manifest. **M0-08** `npm run test:romm`.
7. **M0-09** `npm run shots:nova` (adapt `scripts/screenshots.mjs` and `test/app/driver.ts` to 1280x960 against the fake server), with a pull-request subset.
8. **M0-05** Extend `release.yml` as in section 4, within the CI time budget. **M0-23** Device results ingestion (it needs only M0-03, so it can come early).
9. **M0-10** Frame-time and power overlay. **M0-11** Diagnostics bundle (reuse `zipDirectory` in `src/main/zip.ts`, log redaction in `src/main/log.ts`).
10. **M0-13** Update channels with checksums. **M0-24** `nightly.yml` and the `nightly` pre-release, first with a minimal bundle, so the bridge on the Nova starts reporting as early as possible.
11. **M0-21** Self-test mode. **M0-22** The device test bundle and `run.sh`. **M0-12** Problem reports through the bridge.
12. **M0-17** `install.sh` with the `.desktop` entry. **M0-15** Acceptance backlog generator. **M0-14** `cut-release.yml`. **M0-16** Labels.
13. **M0-18** Evaluator and PR discipline (the evaluator file already exists at `.claude/agents/evaluator.md`; use it from the first PR). **M0-19** Upstream watch. **M0-20** Licence guard.

**Verified by:** CI (19 features), agent screenshots (2), the device bridge (4: M0-12, M0-13, M0-21, M0-22).

**Risks:**

- A flaky baseline (seen on the first runs). M0-00 fixes the causes before anything else; the flaky-test rule keeps it that way.
- Node 24 not on the VM. The setup script installs it, and init.sh refuses otherwise.
- Docker RomM provisioning breaks on a CSRF change. Pin images by digest, and follow Grout's comment on 5.3 CSRF binding: writes go with Basic auth and without cookies.
- `uinput` unavailable on runners. Tests report skipped, never pass.
- Required check names drifting. Rule above.
- The Nova is rarely idle on its charger. Device features wait; everything else continues (section 5.4).

**Exit gate:** both required checks green on `main` with every gate step and within the budget; a `nightly` pre-release with the bundle; at least one complete `device-results` entry from the Nova with `harness.run`, `safety.owner-state` and `safety.server-readonly` passing.

### M1: The Armada layer, and the week-one build (Gate 1)

**Goal:** the fork runs every Armada Store emulator from the SD card, exits cleanly from all of them, launches Steam games, fits 1280x960, fixes every Phase 0 caveat, signs in with the Nova's existing RomMix sign-in, and passes Gate 1 on the device bridge's measurements.

**Tasks, in order:**

1. **M1-01** Close Gate 0 on the record.
2. Descriptors, each a folder under `src/config/emulators/` copied from `example/index.ts`, registered in `index.ts`, tested in `registry.test.ts` and `savepaths.test.ts`, and given a homebrew payload and a sandbox recipe for the self-test:
   - **M1-02** DuckStation (`-batch -fullscreen -nogui -- <rom>`)
   - **M1-03** ARMSX2 (`-batch -fullscreen -nogui -- <iso>`, `.bin` for cue/bin)
   - **M1-04** Dolphin (`-b -e <rom>`, fullscreen through `-C`, key verified; `-u` for the sandbox)
   - **M1-05** PPSSPP (`--fullscreen --pause-menu-exit`)
   - **M1-06** Flycast (`<rom>`)
   - **M1-07** melonDS (`-f <rom>`)
   - **M1-08** RetroArch for Armada (`--appendconfig` with `quit_on_close_content = "2"`, launch variants for Android-matching cores)
   - **M1-09** `src/main/findrules.ts` with a vendored ES-DE `linuxarm` copy and Armada's `~/ES-DE/custom_systems/` overrides
   - **M1-23** ordering, the aarch64 filter, and system-flatpak pre-flight
   - **M1-19** BIOS targets
3. **M1-12** Clean child environment (in `launcher.ts`). **M1-11** Exit hardening and per-emulator save flush. **M1-13** No new windows during play.
4. **M1-10** SD card by default. **M1-21** Scheme probe. **M1-22** Pairing screen. **M1-24** Token storage. **M1-30** Import stock RomMix's sign-in.
5. **M1-25** Manual paths. **M1-26** Platform icons. **M1-15** Usable at 1280x960. **M1-18** Speed, ETA and cancel.
6. **M1-16** Power-profile awareness. **M1-27** Cheap when idle.
7. **M1-14** Steam games: list and launch. **M1-29** Automatic Steam registration. **M1-17** Core socket (also the idle state file the bridge reads).
8. **M1-28** Exit-combo decision (`needs-human`, safe default after 72 hours: allow both).
9. **M1-20** Gate 1, evaluated from device results.

**Verified by:** the device bridge for everything device-facing (23 features); CI and screenshots for the rest.

**Risks:**

- An emulator does not save on SIGTERM. M1-11 logs whether its save folder changed during the grace period. If it did not save, raise its grace or use its own quit route (PPSSPP `--pause-menu-exit`, RetroArch's network `QUIT`) and document it in the descriptor.
- Steam's "Launch Multiple Games" prompt kills the launcher, or waits for a click. The `steam.launch` check records what happens and is never repeated unattended if it leaves a prompt on screen; M5-03 handles it.
- A test changes the owner's emulator settings or saves. Every emulator the self-test starts runs in a sandbox, and the owner-state manifest fails the run and restores the files (M0-21, M0-22).
- No PS2 BIOS, or no homebrew that boots on a system. The check is skipped with its reason, never counted as a pass; the feature waits.
- Flatpak emulators cannot read the SD card. Armada grants `/run/media`; pre-flight checks it.
- The Steam shortcut writer corrupts `shortcuts.vdf`. Back up first, round-trip tests on copies, refuse while Steam runs.

**Exit gate: Gate 1** (section 9). Until it passes, M4 UI work does not start.

### M2: Saves that travel between Argosy and Linux

**Goal:** a save made in Argosy on Android continues on Linux and back, per system, with no spurious conflicts, on RomM 5.2.0. ADR 0002 is the design. Nothing is written to the owner's server before the acceptance session.

**Tasks, in order:**

1. **M2-01** `docs/save-sync/SPEC.md` from Argosy's code: legacy handlers in `app/src/main/kotlin/com/nendo/argosy/data/sync/platform/` (`PlatformSaveHandlerRegistry.kt`, `RetroArchSaveHandler.kt`, `FolderSaveHandler.kt`, `PrefixBundleFolderHandler.kt` (PSP), `GciSaveHandler.kt`, `DreamcastSaveHandler.kt`, `Ps2FolderCardSuperblock.kt`), `data/sync/SaveArchiver.kt`, `NegotiateInventory.kt`, `SyncCoordinator.kt`, `data/repository/SaveUploader.kt`, `SaveDownloader.kt`, `docs/save-sync-flow.md`, `docs/save-id-to-path.md`. Clone `rommapp/argosy-launcher` at `2714d5453b6bbef790987071ab0e82068009532b` in the session; never copy code.
2. **M2-08** Per-system decision (`needs-human`, safe default after 72 hours). **M2-02** Argosy's save shapes read from the owner's server by the bridge, GET only, no bytes kept.
3. **M2-03** Golden fixtures built from SPEC.md and `npm run test:saves`. **M2-04** Hash. **M2-07** Single writer.
4. **M2-05** Decision engine (in `src/main/saves-compat/`, behind `SaveSync`'s interface). **M2-06** Transfer semantics (`uploadSave` and `downloadSave` in `src/main/romm/client.ts`). **M2-20** The fake RomM that runs on the Nova.
5. Per system, each with a device check against the on-device fake RomM:
   - **M2-09** SNES/GBA, first
   - **M2-10** PS1
   - **M2-11** PSP
   - **M2-12** PS2
   - **M2-13** GC/Wii
   - **M2-14** Dreamcast
6. **M2-15** States. **M2-16** Conflict UI (adapt `screens/Game/SaveTransfer.tsx`, `tabs/SavesTab.tsx`; the fake server gains 409 and `device_syncs`). **M2-17** Session lifecycle and "All saves uploaded". **M2-18** Play time.
7. **M2-19** Gate 2: the real round trip, in the final acceptance session.

**Verified by:** golden round trips in CI on both architectures; device checks of the Linux side against the on-device fake RomM; the real Android round trip once, in the acceptance session.

**Risks:**

- Argosy's saves don't match its docs. The shape report read from the owner's server (M2-02) is the truth, not the docs.
- No interoperable path for a system. The safe default in M2-08 says so plainly in the app, or picks the Android core in RetroArch.
- Clock skew between Android and Linux. RomM decides on per-device sync records and hashes, not on client clocks.
- Writing to the owner's server before the acceptance session. Never: device tests are read-only (the guard in M0-21), save checks use the on-device fake RomM, and a save download never carries a `device_id`.

**Exit gate:** every M2 device feature passes; M2-19 is READY-FOR-ACCEPTANCE.

### M3: Game Mode integration

**Goal:** the launcher lives comfortably inside Steam Game Mode: QAM panel, autostart, background suspension, sleep-safe downloads, sensible exits, a keyboard, an in-game menu that does not steal the screen.

**Tasks, in order:**

1. **M3-01** Decky companion (`decky/`): status, quit, install and shortcut from Game Mode.
2. **M3-03** Suspend in the background. **M3-04** Sleep-safe downloads (`src/main/romm/transfer.ts` If-Range; wake detector; `systemd-inhibit --mode=delay`; NetworkManager connectivity wait).
3. **M3-02** Start on boot (`~/.config/gamescope-session-plus/sessions.d/steam`, one marked `CLIENTCMD+=` line).
4. **M3-05** Game Mode exits (`src/main/power.ts`). **M3-06** In-app keyboard. **M3-07** In-game menu through QAM and RetroArch network commands. **M3-08** Controller check (port upstream 68697e0 and 990e55e3 once fixed). **M3-09** Updates on the device.

**Verified by:** the device bridge (7); the acceptance session for the Decky panel (M3-01) and start on boot (M3-02), which need hands and an attended reboot.

**Risks:**

- Decky breaks after Steam updates (known Armada issue). The launcher never depends on the plugin.
- The `sessions.d` append is untested on Armada. It is opt-in, attended in the acceptance session, and Armada's own escape is to hold Select at boot.
- `SteamClient` APIs are undocumented. Mirror Armada Store's usage at the pinned commit.

**Exit gate:** every M3 device feature passes; M3-01 and M3-02 are READY-FOR-ACCEPTANCE.

### M4: Argosy-fork parity UI at 4:3

**Starts only after Gate 1 passes.**

**Goal:** the fork looks and behaves like the owner's Argosy fork ([argosy-fork-design-spec.md](research/argosy-fork-design-spec.md)), smooth at 1280x960, ideally on the Balanced profile.

**Tasks, in order:**

1. **M4-01** Local library index (ADR first; RomMix's TODO.md argues against a local copy, and this fork needs one for Series, genres and offline).
2. **M4-02** Nova theme. **M4-03** Selection look and motion. **M4-04** Windowed grids (replace `src/renderer/src/paging.ts` growth). **M4-05** File-state dot.
3. **M4-07** Preview video (protocol with Range for `path_video`). **M4-08** Preview audio. **M4-06** Now playing.
4. **M4-09** Browse grid and bar. **M4-10** Panel. **M4-11** Title-aware crop and reveal. **M4-12** Flight. **M4-13** Details. **M4-31** Per-game emulator, disc and memory-card pickers.
5. **M4-14** Genre filter and ON DEVICE. **M4-15** Series. **M4-16** Collections. **M4-17** Drawer. **M4-18** L3 menu. **M4-19** R3 settings. **M4-20** Settings hub. **M4-21** Notices (`Toasts.tsx`). **M4-22** Screensaver. **M4-23** Achievements.
6. **M4-24** Downloads screen. **M4-25** Saves screen. **M4-26** Apps. **M4-27** Pad coverage and footer. **M4-28** Restyle everything inherited. **M4-29** Folding and filters. **M4-30** Favourites, hide, ratings. **M4-32** Wizard.
7. **M4-34** Smooth on Balanced. **M4-33** UI acceptance (look and feel, in the acceptance session).

**Verified by:** agent screenshots (25); the device bridge for measured smoothness, preview video and the Downloads screen (4); the acceptance session for look and feel (M4-33).

**Risks:**

- Video decoding cost on Turnip. It is software decode, so keep previews small, debounce, and offer light browse (M4-34).
- Reflow stutter. Never animate size or position.
- Scope creep from the design canvas. The extract in `research/` is the spec; anything not in it needs an owner request.

**Exit gate:** every M4 device feature passes; M4-33 is READY-FOR-ACCEPTANCE.

### M5: Steam library integration

**Goal:** Steam games sit beside RomM games, start and return cleanly, and survive Steam's quirks.

**Tasks:**

- **M5-05** Read non-Steam shortcuts.
- **M5-01** Steam as a platform with art.
- **M5-02** Coming back from a Steam game.
- **M5-03** "Launch Multiple Games" mitigation (ADR from the `steam.launch` results).
- **M5-04** Install hand-off.

**Verified by:** the device bridge (3), using the "Galleon Device Test Target" shortcut instead of the owner's games; the acceptance session for installing a real game (M5-04).

**Risks:** the multiple-games prompt; focus after a Steam game exits; `librarycache` layout changes. Glob both layouts.

**Exit gate:** every M5 device feature passes; M5-04 is READY-FOR-ACCEPTANCE.

### M6: Beyond parity

**Goal:** the owner's wishes beyond the Argosy fork, and the data-handling improvements Argosy lacks.

**Tasks:**

- Owner requirements first: **M6-01** Favourite = pre-download (REQ-8), **M6-02** On device and Make room (REQ-9).
- Data handling: **M6-03** `missing_from_fs` and folding. **M6-04** Multi-disc assembly. **M6-05** Per-file resume. **M6-12** Offline browse.
- Emulators: **M6-06** PSP DLC. **M6-07** Per-game PS2. **M6-08** Multi-disc PS1 end to end.
- Updates: **M6-11** Undoable updates.
- Extras: **M6-09** Jellyfin Watch. **M6-10** RomM music. **M6-13** Graphics page. **M6-15** Graphics backend experiments (low priority since Phase 0).
- **M6-14** Upstream patch series (submitting them is a `needs-human` decision; the safe default is not to).

**Verified by:** mixed; see features.json.

**Exit gate:** M6-01 and M6-02 pass. The rest may continue alongside M7.

### M7: Emulator tuning and per-system CRT shaders (later phase, as the owner asked)

**Goal:** every emulator tuned for the Nova's 4:3 1280x960 120 Hz OLED and controls (REQ-11), with high-quality CRT shaders per system, modern systems included (REQ-12).

**Tasks:**

1. **M7-01** Research `docs/emulator-tuning/SHADERS.md`:
   - candidates per system and emulator: RetroArch slang (crt-royale, crt-guest-advanced and the fast variants, crt-geom, zfast_crt, crt-lottes), Dolphin post-processing, PPSSPP post-shaders, DuckStation chains, ARMSX2 TV shaders, Flycast and melonDS options
   - the look at 4:3 1280x960 on OLED, cost on the Adreno 740 under Turnip at 120 Hz in the Balanced and Performance profiles, and licences
   - an A/B plan per system for the acceptance session, and the defaults until then
   - start from the Argosy fork's prior choices, which the owner now overrides for modern systems
2. **M7-02** Launcher-owned config overlays (`--appendconfig`, Dolphin `-C`, Flycast `-config`, ini journals).
3. Per system, each with a device check (shader loaded, full speed, layout):
   - **M7-03** SNES and GBA (RetroArch; covers PARITY-36 built-in emulation features)
   - **M7-04** PS1
   - **M7-05** PS2
   - **M7-06** GC/Wii (correct speed and clean audio at 120 Hz)
   - **M7-07** PSP
   - **M7-08** Dreamcast
   - **M7-09** DS
4. **M7-10** 60 fps pacing on 120 Hz. **M7-11** Truthful settings and shader errors. **M7-12** Controls (feel, in the acceptance session). **M7-13** Shader picks (in the acceptance session).

**Verified by:** config snapshot tests in CI; device checks for what can be measured (shader compiled, speed, pacing, layout); the owner's eyes and hands for the final shader picks and button feel.

**Risks:**

- Shader cost under Balanced. Measure with the device bridge, and offer lighter variants.
- GPL shader licences. Never bundle them.
- Editing users' configs. Use overlays and journals only; on the device, sandboxes.

**Exit gate:** every M7 device feature passes; M7-12 and M7-13 are READY-FOR-ACCEPTANCE.

### M8: Polish, the acceptance session, stable release, distribution

**Tasks:**

- **M8-04** Start-up and memory.
- **M8-05** Player docs.
- **M8-07** The final acceptance session: one invitation, one session, the local Claude session does the typing.
- **M8-01** 1.0 criteria and the release, inside the acceptance session.
- **M8-02** Armada Store catalog entry (submitting is a `needs-human` decision; the safe default is not to).
- **M8-03** Decky distribution.
- **M8-06** Maintenance procedures.

**Exit gate:** the acceptance session is recorded; v1.0.0 is published through `cut-release.yml` and installed on the Nova.

---

## 8. Milestone summary

| Milestone                                       | Features | ci     | agent-screenshot | device | acceptance |
| ----------------------------------------------- | -------- | ------ | ---------------- | ------ | ---------- |
| M0 Harness, CI, Docker RomM, device bridge loop | 25       | 19     | 2                | 4      | 0          |
| M1 Armada layer and Gate 1                      | 30       | 5      | 2                | 23     | 0          |
| M2 Argosy-compatible saves and Gate 2           | 20       | 9      | 1                | 9      | 1          |
| M3 Game Mode integration                        | 9        | 0      | 0                | 7      | 2          |
| M4 Argosy-fork parity UI                        | 34       | 4      | 25               | 4      | 1          |
| M5 Steam library                                | 5        | 1      | 0                | 3      | 1          |
| M6 Beyond parity                                | 15       | 6      | 1                | 7      | 1          |
| M7 Emulator tuning and CRT shaders              | 13       | 3      | 0                | 8      | 2          |
| M8 Polish, acceptance and release               | 7        | 4      | 0                | 1      | 2          |
| **Total**                                       | **158**  | **51** | **31**           | **66** | **10**     |

Coverage: all 15 owner requirements, all 48 parity items and all 18 Beyond items appear in `source` fields (checked by M0-03).

Verification types: `ci` (CI proves it), `agent-screenshot` (the agent and the evaluator read the 1280x960 screenshots), `device` (a device-bridge result for a build containing the feature shows every named check passing), `acceptance` (the owner, once, in the final session).

---

## 9. Gates and the fallback

### Gate 1: the week-one fork build (next decision point)

Decided by the device bridge, never by a person (M1-20). `node scripts/agent/gate1.mjs` reads the newest complete nightly results; the numbers live in `test/device/thresholds.json` and must match this table. A criterion with missing data is not a pass.

| Id   | Pass if (device checks)                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1-1 | `launch.retroarch` and `exit.retroarch` pass, and so do the launch and exit checks of **at least two** of DuckStation, ARMSX2, Dolphin, PPSSPP and Flycast: each emulator appears fullscreen with its window, exits with code 0 within the grace period, and Galleon has focus again within 6 s. |
| G1-2 | `focus.return` passes for every emulator exit in the run, and `focus.no-new-window` passes.                                                                                                                                                                                                      |
| G1-3 | `steam.list` passes, and `steam.launch` recorded an outcome (started, prompt shown, or launcher killed). The outcome feeds M5-03; it does not have to be "started".                                                                                                                              |
| G1-4 | Grid scroll over a 1,000+ game platform (`grid.scroll@*`): on the **Performance** profile p95 frame time at or under **16.7 ms** and dropped frames at or under 5%; on **Balanced** p95 at or under **25 ms**. The profile counted is the one sampled during the scroll, not the one requested.  |
| G1-5 | `import.rommix` or `server.scheme-probe` passes (signed in without pairing, scheme-less address works), `storage.sdcard` passes, `steam.shortcut-roundtrip` passes, and `install.script` passes.                                                                                                 |

Gate 1 passes when **two consecutive complete nightly results** each pass every criterion. The agent records the result links here and closes the `gate` issue.

**Decision rule:**

- All pass: M4 may start.
- G1-1, G1-3 or G1-5 fail: these are fork bugs. Fix them; there is no stack implication.
- G1-2 or G1-4 fail: the agent runs **at least two documented optimisation rounds** (power and idle cost, windowed grids early, compositing and layer changes, the graphics-backend experiments of M6-15, focus rules), each a merged PR with before-and-after device numbers in PROGRESS.md. If the thresholds still fail after that, it opens a `gate` issue labelled `needs-human` proposing the pivot below, with the measurements and the **safe default: keep Electron and keep optimising**, which it adopts in an ADR after 72 hours without an answer. The agent never pivots without an explicit `pivot` reply.

### Gate 2: saves

1. **Golden fixtures** built from SPEC.md, which is written from Argosy's code as a specification only (Argosy is GPL; nothing is copied), cross-checked with the read-only shape report from the owner's server (M2-02).
2. **Docker RomM round trips** in CI on both architectures, 5.2.0 and 5.3.1 (`npm run test:saves`): an Argosy-shaped device and the fork's engine, both directions, with no spurious conflicts and one `autosave` head per game.
3. **Device filesystem checks** on the Nova (`saves.*`): real emulators in sandboxes, Galleon's real engine, the on-device fake RomM. They never touch the owner's real saves or write to the owner's server.
4. **The real Android-to-Linux-to-Android round trip** (M2-19) is part of the final acceptance session, after the local Claude session has kept a read-only copy of the saves involved. A system marked "do not travel" in SYSTEM-CHOICES.md counts as passed when the app says so plainly.

**A Gate 2 failure never changes the stack**; it reopens that system's M2 feature.

### Godot 4.7 fallback (summary; not expected, since Gate 0 passed)

**Trigger:** the Gate 1 smoothness or focus thresholds still fail after the documented optimisation rounds, **and** the owner replies `pivot` to the `needs-human` issue (the safe default is to keep Electron).

**Shape:** keep the tested core and replace only the renderer.

1. **Core stays.** The Electron main-process code runs headless as `ELECTRON_RUN_AS_NODE=1` (or the bundled Node), exposing the core socket (M1-17) extended to cover everything the UI needs: library pages, search, game detail, download, launch, save state, settings. All of M0-M3's main-process work and tests carry over unchanged.
2. **New UI.** A Godot 4.7 project in `ui-godot/`:
   - GL Compatibility renderer, one fullscreen X11 window, SDL3 controllers, built-in Control focus navigation
   - GDScript with static typing (lint with gdtoolkit), and a "Godot 4 syntax" checklist in CLAUDE.md, because models drift into Godot 3
3. **Spike first (one week).** A 4,000-tile virtualized grid at 1280x960, controller focus, one emulator launch and return, a frame-time overlay, a self-test mode that writes the same `summary.json`, and MP4 preview playback (Godot's built-in player is Theora-only; check a GDExtension or drop previews). The device bridge judges the spike with the Gate 1 checks.
4. **Testing:** gdUnit4 or GUT under `xvfb-run` with llvmpipe; screenshots via `--write-movie` PNG frames with `--fixed-fps`. These tests are slow, so keep most rules in the core's TypeScript tests.
5. **Licence:** Godot is MIT, so the fork stays MIT. Do not copy OpenGamepadUI's gamescope modules (GPL-3.0); the launcher needs none of them, because focus comes from process ancestry.
6. **Packaging:** the Godot export template for linux arm64 inside the same AppImage, launched by the same Steam script.
7. **features.json** stays. UI features keep their acceptance; their implementation notes change in a new ADR (0004-pivot-to-godot).
8. **Tie-breaker:** Flutter 3.47 only if Godot also fails on the device (the Impeller Linux renderer is new; no handheld or gamescope deployments were found).

---

## 10. RomM server

The owner's server stays on **5.2.0**, and nothing in this plan requires an upgrade. CI tests 5.2.0 and 5.3.1. ADR 0002 explains when an upgrade becomes worthwhile: after Gate 2 passes, never to a version reporting `SAVE_SYNC.SNAPSHOTS` until the launcher supports it, and always with a database backup. It is the owner's decision through a `needs-human` issue whose safe default is "do not upgrade".

The agent never touches the owner's server and cannot reach it. Device tests only **read** it, through the self-test's guard (M0-21): GET and HEAD only, no `device_id` on save or state requests, no device registration, no token refresh, no play sessions, no now-playing or favourite changes. Save checks run against a fake RomM on the device (M2-20). The first writes Galleon ever makes to the owner's server come after the acceptance session, in the owner's own use, with Gate 2's backup taken first.

---

## 11. Risk register

| Risk                                                  | Likelihood  | Impact | Mitigation                                                                                                                                                                                     | Owner                |
| ----------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| A save is lost or overwritten silently                | Medium      | Severe | ADR 0002: spec first, golden fixtures, `overwrite=false`, single writer, backups; no writes to the owner's server before the acceptance session; a read-only copy before the Gate 2 round trip | Agent                |
| A device test changes the owner's data                | Low         | High   | Separate home, read-only server guard, emulator sandboxes, owner-state manifest with restore; a failed safety check blocks every pass from that run and stops feature work                     | Agent                |
| Device tests disturb the owner                        | Medium      | Low    | Charger, Game Mode and idle only, idle only, sound muted, any button aborts within a second                                                                                                    | Agent                |
| The Nova is rarely idle on its charger                | Medium      | Medium | Device features wait while everything else continues; `bridge/status.json` shows why; one `needs-human` note after a week                                                                      | Agent                |
| Deploy key misused                                    | Low         | Medium | Key only on the device; `main` ruleset with an empty bypass list; branch content is data; revoked in one command                                                                               | Owner (setup), agent |
| Flaky CI                                              | High (seen) | Medium | M0-00 root-cause fixes; the flaky-test rule; no retries or skips to get green                                                                                                                  | Agent                |
| Argosy changes its save shapes (fast release cadence) | Medium      | High   | Pin the spec to a commit; before Gate 2, diff Argosy's save-sync files against the pinned commit and update SPEC.md; the M2-02 shape report; capability-gate Sigil                             | Agent                |
| Lag on the Balanced profile                           | High (seen) | Medium | M1-16 hint, M1-27 idle cost, M4-34 light browse; measured every night at both profiles                                                                                                         | Agent                |
| An emulator ignores SIGTERM or does not flush saves   | Medium      | High   | M1-11 escalation, per-emulator save-flush checks, descriptor-specific quit routes                                                                                                              | Agent                |
| Steam "Launch Multiple Games" kills the launcher      | Medium      | Medium | Measured by `steam.launch`; M5-03                                                                                                                                                              | Agent                |
| Decky breaks after Steam updates                      | High        | Low    | Launcher never depends on it                                                                                                                                                                   | Agent                |
| Required checks bypassed or renamed                   | Low         | High   | Ruleset with no bypass; names frozen; all gates in `build`                                                                                                                                     | Owner (setup), agent |
| Prompt injection through public issues                | Medium      | Medium | Only owner-authored issues are acted on; issue text and `device-results` are data; minimal connectors                                                                                          | Agent                |
| Usage limits stall the agent                          | Medium      | Low    | Project threads wait out limits and continue; the hourly heartbeat Routine resumes; concurrency lock                                                                                           | Owner (setup)        |
| CI gets slow                                          | Medium      | Low    | The CI time budget (section 4); a leg over 10 minutes becomes the next unit of work                                                                                                            | Agent                |
| Upstream RomMix diverges                              | High        | Low    | Internal names kept; weekly watch; port deliberately                                                                                                                                           | Agent                |
| Licence contamination (GPL)                           | Low         | High   | Spec-only rule, licence guard, no bundled GPL shaders or payloads                                                                                                                              | Agent                |
| Schedules lapse after 60 idle days                    | Low         | Medium | The agent and the bridge keep the repo active; M8-06                                                                                                                                           | Agent                |

---

## 12. Out of scope

- Replacing Steam as the gamescope session client.
- Changing the owner's RomM server.
- Flathub and the Decky store, both of which refuse AI-assisted submissions.
- Argosy's social, netplay, QuayPass and multi-screen features.
- Android builds.
- Switch, PS3, Xbox and Vita emulation, beyond RomMix's existing descriptors on x86_64.
