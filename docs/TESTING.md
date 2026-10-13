# How Galleon is tested

Nobody tests by hand during development. CI proves the code on every pull request and every night; the **device bridge** on the Nova proves it on real hardware whenever the Nova is idle on its charger ([ADR 0004](decisions/0004-device-tests-any-hour.md)); the owner joins **once**, near the end, for an acceptance session of at most two hours ([ADR 0003](decisions/0003-autonomous-verification.md)). The tiers are listed in [PLAN.md section 3](PLAN.md#3-how-work-is-proven), the bridge's contract in [PLAN.md section 5](PLAN.md#5-the-device-bridge-hardware-in-the-loop), and the bridge program in [tools/device-bridge/README.md](../tools/device-bridge/README.md).

This file has one short part for the owner and the reference the agent works from.

---

## For the owner

**One habit, when it suits you.** Leave the Nova **on its charger, in Game Mode, at Steam's library** whenever you are not using it (quit any game, RomMix or ES-DE first), and set Steam's **Settings -> Power -> Sleep when plugged in** to **Never** once. Results then show up by themselves. If the Nova is away or asleep for days, nothing breaks; the features that need it simply wait.

**What you may notice.** At any hour while the Nova sits idle on its charger, the screen may show Galleon and a few emulators for up to about half an hour, with the sound muted. **Press any button** and the test stops at once and hands the Nova back. Your Steam library gains an entry called **Galleon Device Test**; starting it yourself does nothing. Nothing in your own RomMix, saves, emulator settings or RomM server is changed, and every run checks that.

**If something goes wrong once you use Galleon,** open Settings -> System -> **Report a problem**. The report reaches the developer automatically the next time the Nova is idle on its charger. There is nothing to file anywhere.

**Near the end** you get one GitHub notification e-mail: _Galleon is ready for your acceptance session_. Open the Claude session on your Mac and say **"start the Galleon acceptance session"**. It walks you through everything and does every terminal and GitHub step for you.

**Getting unstuck** (once Galleon is installed for you):

- **A game will not let go:** hold **Start** for about 1.5 seconds. If nothing happens after 10 seconds, press the Steam button and choose _Exit game_.
- **After turning on _Start on boot_, something is wrong:** hold **Select** while the Armada splash shows at power-on to land in Desktop Mode, then turn the option off there.
- **A graphics experiment left a black screen:** hold **B** while Galleon starts, to reset the graphics mode.

---

## Verification types

Every feature in [features.json](features.json) has exactly one:

| Type               | `passes` flips when                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci`               | Its acceptance lines are proven by CI and the evaluator says PASS.                                                                                                                                                     |
| `agent-screenshot` | As `ci`, plus the agent and the evaluator have read the 1280x960 screenshots.                                                                                                                                          |
| `device`           | One device result, for a build that contains the feature, shows **every** `Device check` id in its acceptance as `pass`, with `safety.owner-state` and `safety.server-readonly` passing in the same run (rules below). |
| `acceptance`       | The owner marked its item pass in the acceptance session (`acceptance/<date>/results.json`).                                                                                                                           |

Acceptance lines use fixed prefixes the tooling reads:

- ``Device check `<id>`: <pass condition>`` (case-insensitive) names a check from the catalogue below. Only lines in `device` features gate `passes`.
- `On the device (informational): ...` and `Acceptance session (informational): ...` describe extra evidence; they gate nothing. The acceptance generator (M0-15) includes the informational acceptance lines in the session script.
- `Acceptance session: ...` is a plain-words step for the owner, in an `acceptance` feature.

## How a device feature passes

1. The feature's code merges with `READY-FOR-DEVICE <id>` in that PR's PROGRESS.md entry.
2. The next `nightly` pre-release carries it (one is published after every merge to `main` as well as on the nightly schedule, M0-24); the bridge tests it and publishes `results/<sha>/summary.json` on `device-results`.
3. At the next session start, `node scripts/agent/device-results.mjs --summary` shows the result. With `--apply` it flips `passes` when, in one summary:
   - every `Device check` id of the feature has `result: "pass"`;
   - `safety.owner-state` and `safety.server-readonly` pass;
   - the summary's `status` is `complete` or `partial` (never `error`, `skipped`, `withheld` or `aborted-by-user`);
   - the commit that added `READY-FOR-DEVICE <id>` to PROGRESS.md is an ancestor of the tested sha.
4. The PR carrying the flip has `PASSES <id> device:<sha>` in its PROGRESS entry; features-check verifies all of the above against `origin/device-results` (M0-03).
5. If a later build fails one of the feature's checks, `passes` goes back to false and a `regression` issue opens. A failed safety check is a `regression` + `save-sync` emergency: feature work stops until it is understood.

A check that cannot run (no BIOS, no payload for a system, no importable sign-in, Steam's debugger unreachable) reports `skip` with a reason. A skip never counts as a pass.

## Check catalogue

Ids are lowercase, dot-separated; `@<profile>` marks a measurement repeated per power profile. The self-test (M0-21) runs the app-side checks; `run.sh` (M0-22) adds the harness checks. Thresholds live in `test/device/thresholds.json` and must match features.json and PLAN.md section 9.

`safety.owner-state` compares two manifests from `test/device/ownerstate.py`, one taken before the run starts anything and one after it stops, before any restore. What they cover (owner's RomMix and Galleon config and saves, following their root pointers; every emulator folder in DEVICE-FACTS.md; Steam's `shortcuts.vdf` files) is data in `test/device/owner-state.json`, as is the list of emulator config files backed up first and put back when changed. Links are recorded, never followed or written through, except that a covered folder which is itself a link (moved to the SD card, say) is read through it. A restore that put anything back fails the check as well.

The app under test gets its own home from `test/device/signin.py`, recreated empty each run (never through a link). Its sign-in is imported read-only, first found wins: the bridge's `pair-readonly` token, the owner's Galleon, stock RomMix (each through its root pointer, and `ROMMIX_HOME`). Only a plain-text (`RAW1`) store is read; only its client or access token travels, never the refresh token or the device id. The test home's settings turn save sync off both ways and leave the device id empty; play sessions and every other write are stopped by the self-test's server guard. With nothing importable the home is still made and the server checks skip with `no-importable-credentials`.

`test/device/shortcuts.py` finds the 'Galleon Device Test' shortcut by name in each user's `shortcuts.vdf` (binary VDF, read only, never written) when run.sh's own record of its appid is gone, and turns the appid, stored signed, into the game id `steam://rungameid/` takes.

| Check id                   | Run by    | Passes when                                                                                                                                                                                                                                                                 | Features           |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `harness.run`              | run.sh    | Finished within the budget, summary complete, device back at Steam's library                                                                                                                                                                                                | M0-22              |
| `safety.owner-state`       | run.sh    | Owner-state manifest after the run equals the one before (changed emulator configs are restored, and the check still fails)                                                                                                                                                 | M0-22, every run   |
| `safety.server-readonly`   | self-test | No non-GET/HEAD request reached the RomM server; no save or state request carried `device_id`                                                                                                                                                                               | M0-21, every run   |
| `selftest.complete`        | self-test | Requested scenarios ran; the app quit with code 0                                                                                                                                                                                                                           | M0-21              |
| `build.identity`           | self-test | Version and commit equal `build-info.json`                                                                                                                                                                                                                                  | M0-13              |
| `install.script`           | run.sh    | `install.sh --nightly` into a throw-away HOME produces the files, modes and a valid `.desktop` entry                                                                                                                                                                        | M0-17 (info), G1-5 |
| `report.bundle`            | self-test | Report a problem writes a bundle with no credentials that the sanitiser publishes whole                                                                                                                                                                                     | M0-12              |
| `update.verify`            | self-test | Updater accepts the matching image and refuses a corrupted copy, in the test home only                                                                                                                                                                                      | M0-13, M3-09       |
| `update.rollback`          | self-test | Simulated double crash offers going back; going back restores the older build by commit                                                                                                                                                                                     | M6-11              |
| `startup.cold`             | self-test | Wrapper start to interactive Home under 4 s on Performance                                                                                                                                                                                                                  | M8-04              |
| `memory.resident`          | self-test | All Galleon processes under 600 MB after browsing every screen                                                                                                                                                                                                              | M8-04              |
| `grid.scroll@performance`  | self-test | 1,000+ game grid scroll: p95 at or under 16.7 ms, dropped frames at or under 3% (M4-04); Gate 1 uses 16.7 ms and 5%                                                                                                                                                         | M4-04, G1-4        |
| `grid.scroll@balanced`     | self-test | Same scroll on Balanced: p95 at or under 16.7 ms, dropped at or under 5% (M4-34); Gate 1 uses 25 ms                                                                                                                                                                         | M4-34, G1-4        |
| `graphics.modes`           | self-test | Per-mode `grid.scroll@balanced` measured; Auto changes only on a clear win in two runs                                                                                                                                                                                      | M6-15              |
| `idle.cpu`                 | self-test | 60 s idle on Home under the CPU budget; first input after idle within one frame plus 50 ms                                                                                                                                                                                  | M1-27              |
| `power.read`               | self-test | Profile, governor and clocks read equal `armada-power status` and sysfs                                                                                                                                                                                                     | M1-16              |
| `power.hint`               | self-test | Hint on Balanced, none on Performance                                                                                                                                                                                                                                       | M1-16              |
| `server.scheme-probe`      | self-test | Scheme-less address finds the scheme that answers like RomM, GET only                                                                                                                                                                                                       | M1-21, G1-5        |
| `server.heartbeat`         | self-test | With the imported sign-in, GET /api/heartbeat and /api/users/me succeed; server version recorded                                                                                                                                                                            | M0-21              |
| `import.rommix`            | self-test | Fresh home imports stock RomMix's sign-in and reaches a signed-in Home, GET only; RomMix's folder unchanged                                                                                                                                                                 | M1-30, G1-5        |
| `auth.storage`             | self-test | Token stored 0600 in a 0700 folder in Game Mode; restart signs in again                                                                                                                                                                                                     | M1-24              |
| `pairing.screen`           | self-test | Pairing screen with a fake code fits 1280x960 without scrolling (no server call)                                                                                                                                                                                            | M1-22              |
| `manual.open`              | self-test | A manual opens and its first page renders                                                                                                                                                                                                                                   | M1-25              |
| `download.small`           | self-test | Smallest SNES or GBA title downloads with progress events and a verified hash, then is deleted                                                                                                                                                                              | M0-21              |
| `download.progress`        | self-test | Capped Range download: speed and time left within 20% after 3 s; X cancels; `.part` removed                                                                                                                                                                                 | M1-18              |
| `download.queue`           | self-test | Three queued downloads run in order; cancel one; rows and focus stay put                                                                                                                                                                                                    | M4-24              |
| `network.resume`           | self-test | Injected drops and a simulated wake resume with Range and If-Range; capped back-off                                                                                                                                                                                         | M3-04              |
| `storage.sdcard`           | self-test | Default root on the mounted ext4 card; unmounted card shows 'card not inserted', nothing pruned                                                                                                                                                                             | M1-10, G1-5        |
| `storage.makeroom`         | self-test | Make room frees the chosen games; refuses one with a pending save upload                                                                                                                                                                                                    | M6-02              |
| `favourite.predownload`    | self-test | A local favourite queues and completes a background download; unfavouriting asks                                                                                                                                                                                            | M6-01              |
| `emulators.detected`       | self-test | Every installed emulator listed with its install kind; no Flathub warning                                                                                                                                                                                                   | M1-23              |
| `bios.targets`             | self-test | BIOS folders resolved; presence read only; fixture BIOS installs into the sandbox                                                                                                                                                                                           | M1-19              |
| `launch.<emulator>`        | self-test | Emulator (sandboxed, homebrew payload) appears fullscreen with its window and takes focus. Ids: `launch.retroarch`, `launch.duckstation`, `launch.armsx2`, `launch.dolphin`, `launch.ppsspp`, `launch.flycast`, `launch.melonds`                                            | M1-03..M1-08, G1-1 |
| `exit.<emulator>`          | self-test | Graceful stop: exit code 0 within the grace, Galleon focused within 6 s, no SIGKILL, save folder changed when the payload saves. Ids: `exit.retroarch`, `exit.duckstation`, `exit.armsx2`, `exit.dolphin`, `exit.ppsspp`, `exit.flycast`                                    | M1-11, G1-1        |
| `exit.combo`               | self-test | Synthetic pad holds through Galleon's gamepad layer stop RetroArch and Dolphin with saves intact                                                                                                                                                                            | M1-28              |
| `focus.return`             | self-test | Galleon is the focused app after every emulator exit                                                                                                                                                                                                                        | M1-13, G1-2        |
| `focus.no-new-window`      | self-test | A download finishing mid-game maps no window; the notice waits                                                                                                                                                                                                              | M1-13, G1-2        |
| `focus.suspend`            | self-test | No frame callbacks or timers while something else has the screen; redraw within 5 s after                                                                                                                                                                                   | M3-03              |
| `steam.list`               | self-test | Installed games and shortcuts parsed, art found (counts only)                                                                                                                                                                                                               | M1-14, M5-01, G1-3 |
| `steam.launch`             | self-test | Test target shortcut started through `steam://rungameid/`; outcome recorded; `needs-attended` if a prompt stays on screen                                                                                                                                                   | M1-14, M5-03, G1-3 |
| `steam.return`             | self-test | After the target exits, Galleon is in front and redrawn within 5 s, three times                                                                                                                                                                                             | M5-02              |
| `steam.shortcut-roundtrip` | run.sh    | Copies of the real shortcuts.vdf round-trip byte for byte; add and update in the copy only                                                                                                                                                                                  | M1-29, G1-5        |
| `gamemode.detect`          | self-test | Quit dialog offers Back to Steam and Switch to Desktop in Game Mode (not executed)                                                                                                                                                                                          | M3-05              |
| `keyboard.osk`             | self-test | In-app keyboard types a search and an address with the pad driver                                                                                                                                                                                                           | M3-06              |
| `controllers.listed`       | self-test | Pre-flight lists the Nova's controller                                                                                                                                                                                                                                      | M3-08              |
| `retroarch.netcmd`         | self-test | UDP save state, load state and quit confirmed by RetroArch's log                                                                                                                                                                                                            | M3-07              |
| `multidisc.playlist`       | self-test | Two-disc playlist starts; 'next disc' switches (log shows disc 2)                                                                                                                                                                                                           | M6-08              |
| `video.preview`            | self-test | One stream per sweep; settled video within 500 ms; grid p95 unaffected                                                                                                                                                                                                      | M4-07              |
| `psp.dlc`                  | self-test | Title id from PARAM.SFO by capped Range read; DLC placed and removed in the sandbox                                                                                                                                                                                         | M6-06              |
| `armsx2.pergame`           | self-test | Per-game files written where the Nova's ARMSX2 reads them (sandbox); listed on the game page                                                                                                                                                                                | M6-07              |
| `argosy.shapes`            | run.sh    | Read-only shape report of Argosy saves on the owner's server; no bytes kept; SPEC.md differences resolved                                                                                                                                                                   | M2-02              |
| `saves.fake-server`        | run.sh    | On-device fake RomM starts on 127.0.0.1; one save up and down                                                                                                                                                                                                               | M2-20              |
| `saves.<system>`           | self-test | Sandbox save archived in Argosy's shape, round-tripped through the fake RomM byte-identical. Ids: `saves.snes-gba`, `saves.ps1`, `saves.psp`, `saves.ps2`, `saves.gc-wii`, `saves.dc`                                                                                       | M2-09..M2-14       |
| `saves.journal`            | self-test | Upload journal survives a kill; 'All saves uploaded' follows the fake server going down and up                                                                                                                                                                              | M2-17              |
| `tune.<system>`            | self-test | Overlay loaded, shader compiled without errors, full speed, layout right. Ids: `tune.snes`, `tune.gba`, `tune.ps1`, `tune.ps2`, `tune.gc`, `tune.psp`, `tune.dc`, `tune.nds`                                                                                                | M7-03..M7-09       |
| `aspect.<system>`          | run.sh    | Headless gamescope: a savestate diff (patch on, off) or the screenshot shows the patch or layout applied; `aspect.psp` also keeps both memory sticks' patched-game counts. Ids: `aspect.psp`, others from ASPECT.md                                                         | M7-15, M7-16       |
| `textures.install`         | self-test | A synthetic pack from a fake mirror in the test home installs for the homebrew payload, linked into every installed emulator's folder; free space drops by its unpacked size and removal restores it; the owner's `Textures/` tree and links unchanged (count and readlink) | M7-21              |
| `textures.load`            | run.sh    | Headless gamescope: a dumped, recoloured payload texture replaces the original through the overlay and the screenshot differs in the expected region; PPSSPP may show `[TexReplacement] Texture pack activated` instead                                                     | M7-22              |
| `pacing.60hz`              | self-test | 60 fps payload presents steadily at 16.7 ms for a minute                                                                                                                                                                                                                    | M7-10              |
| `gate1.summary`            | agent     | `gate1.mjs` finds data for every Gate 1 criterion in the newest result                                                                                                                                                                                                      | M1-20              |

Adding a check: add it here, to the self-test or `run.sh`, and to the feature's acceptance in the same PR. features-check fails on an id that is named in features.json but missing here.

## `self-test-request.json` (written by run.sh into `$GALLEON_HOME`)

```json
{
  "schema": 1,
  "sha": "<40-hex commit>",
  "version": "0.21.0",
  "budgetSeconds": 1800,
  "resultsDir": "/var/home/<user>/galleon-device-tests/<sha>/results",
  "handshakeDir": "/var/home/<user>/galleon-device-tests/<sha>/handshake",
  "checks": [
    "selftest.complete",
    "startup.cold",
    "grid.scroll",
    "launch.retroarch",
    "exit.retroarch"
  ],
  "profiles": ["performance", "balanced"],
  "payloads": { "retroarch": "payloads/snes/hello.sfc", "dolphin": "payloads/gc/hello.dol" },
  "savingPayloads": ["retroarch"],
  "fakeRomm": null,
  "readOnlyServer": true,
  "privacy": true,
  "abortOnInput": true,
  "screenshots": ["settings", "bios", "emulators"]
}
```

The app refuses a request without `readOnlyServer: true` and `privacy: true`, and ignores the file entirely unless `GALLEON_HOME` is set.

- The app renames the file to `self-test-request.taken.json` before reading it, so a restart is a normal start.
- A refused request gets a `summary.json` with `status: error` and the refusal code as `reason` (when its `resultsDir` is usable), and the app exits 1.
- An accepted run exits 0 once `summary.json` is written, whatever the checks say. A requested check this build has no scenario for is `skip` with reason `not-implemented`; the run is then `partial` and `selftest.complete` fails.
- `safety.server-readonly` is in every summary, requested or not.
- `sha` and `version` are copied by run.sh from the nightly's `build-info.json`. `build.identity` passes when the build's stamped commit equals `sha` whole (a `-dirty` build fails `commit-mismatch`) and `app.getVersion()` equals `version`; with no `version` in the request it is `skip` / `no-build-version`. A `version` that is not a plain version string refuses the request (`request-version`), since it is copied into the summary. See `src/main/selftestidentity.ts`.
- Privacy: from the moment a request is taken, everything the main process gives the page (answers, pushes, error messages) has the server's address and host, the account's name, e-mail and picture, and any pairing code replaced by a mask, so no screen or screenshot draws them. See `Privacy` in `src/main/privacy.ts`.
- With `abortOnInput`, any controller button held down, or a stick moved from where it first rested, stops the run within a second: running checks end, unrun ones are `skip` / `aborted-by-user`, the summary's status is `aborted-by-user`, and the app exits 0 once it is written. The app watches through the page's Gamepad API, never OS input.
- `grid.scroll` scrolls the library's largest platform of at least `MIN_GAMES` games, or else a synthetic platform of `SYNTHETIC_GAMES` games that exists only inside the app (slug `galleon-synthetic`, negative ids, no artwork; its pages are answered without a request, and it is listed alone while the server does not list platforms; see `src/main/selftestlibrary.ts`), for `SCROLL_MS` per profile, holding Down and turning back at either end, driven in the page through the keyboard path the focus engine answers (never the Gamepad API, which the abort watches). It answers `grid.scroll@<profile>` for each name in `profiles`, or plain `grid.scroll` held to Performance's thresholds when `profiles` is empty. Metrics: `frames`, `p50Ms`, `p95Ms`, `p99Ms`, `droppedPct` (frames over 1.5 display intervals), `displayHz`, `visited`, `platform` (slug), `games`, and from the clocks read during the scroll `profileObserved`, `governor`, `policy7MaxKHz`, `gpuMHz`. The profile before and after each scroll, and at the scroll's start, is the one `armada-power status` names when it answers (else inferred from the clocks); samples taken mid-scroll read files only, so no process starts while frames are timed, and a sample that cannot tell the profile is left out of `profileObserved`. See `src/main/selftestscroll.ts`.
- Profile handshake: to measure a profile not in force, the app writes the profile's name into `handshakeDir/want-profile` (whole, by a rename) and polls `handshakeDir/profile-set`; run.sh switches with `armada-power profile <name>` and writes `profile-set` with the name, or `unchanged:<current>`. The app removes both files once answered or after `PROFILE_WAIT_MS`. A profile still not in force afterwards is `skip` / `profile-not-set`, with `profileObserved` and `profileAnswer`; the numbers are never filed under a profile they were not taken on. Restoring the owner's profile is run.sh's (PLAN.md section 5.3, step 11).
- `screenshots` names screens by their menu route. After the last check, each is opened from the menu bar, allowed to settle, and captured with `capturePage` into `resultsDir/shots/<screen>.png`; the paths are `selftest.complete`'s evidence, with metrics `screenshots`, `screenshotsMissing` and `screenshotsWithheld`. A screen that is not reached within `SCREEN_TIMEOUT_MS`, fails to capture or is unknown is missing: named in `notes` as `screenshot <screen>:<code>` and `selftest.complete` fails with `screenshots-missing`. Screens that draw the library (`home`, `library`, `collections`, `downloads`, `game`) are never captured, since on the Nova that library is the owner's; they count as withheld, not missing. See `src/main/selftestshots.ts`.
- `update.verify` runs `Updater.rehearse` into `$GALLEON_HOME/update-verify/`: it reads the `canary` release and its `SHA256SUMS`, downloads this machine's image and verifies it as an update would, then changes one byte of a copy and requires the same verification to refuse it. Nothing is made executable or renamed onto the running image; the folder is removed afterwards. Fails `no-image`, `no-checksums`, `no-digest` (the sums file has no line for the image), `matching-refused`, `corrupted-accepted`, `channel-unreadable`, or `installed-image-changed` when `APPIMAGE`'s size, change time or inode differ after the run. A stopped run ends the transfer and is `skip` / `aborted`. Metrics: `image`, `bytes`. See `src/main/selftestupdate.ts`.
- `startup.cold` is timed from `GALLEON_STARTED_AT_MS` (milliseconds since the epoch) when run.sh sets it in the app's environment just before starting the AppImage, else from the app process's own start; the check's `measuredFrom` metric says which. The end is the first frame on which Home is interactive. A time at or over the threshold on a profile other than Performance is `skip` with reason `not-on-performance`.
- Emulator sandbox (for every `launch.*` and `saves.*` check): an emulator starts only through `planSandbox`, in `$GALLEON_HOME/sandbox/<emulator>/` with `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` pointed inside it plus its descriptor's `sandbox` recipe (arguments after the program, environment, variables removed from the inherited environment, config files written into the sandbox), and it starts in the sandbox's root, so nothing it reads or writes relative to its working folder is the owner's (Eden and shadPS4 each take a `user` folder there as their whole portable layout). The owner's BIOS files reach `bios/`, or the sandbox folder the recipe names for an emulator that reads them from a fixed place (Eden's `data/eden/keys`), as clones that share their blocks, or as plain copies where the filesystem cannot clone, never as symlinks: emulators write NVRAM and flash beside their BIOS. Copies past `BIOS_COPY_BUDGET` skip the check as `cannot-sandbox` (`bios-too-large`). An emulator without a recipe, a recipe that declines the system, a flatpak or `scripts` install, an install whose path cannot be read with its links followed, a file of the owner's the recipe needs (RetroArch's core, Eden's `prod.keys`) that cannot be read, or a recipe file or BIOS folder outside the sandbox is never started: its check is `skip` with reason `cannot-sandbox`. A folder the emulator makes outside the sandbox whatever it is told (a recipe's `strays`, such as RetroArch's `/tmp/retroarch-tmp`) is removed after the run if it was not there before and is still empty. See `src/main/selftestsandbox.ts`.
- `launch.<emulator>` and `exit.<emulator>` come from one cycle per emulator: the sandbox is prepared, the emulator is started as the leader of a new process group, and the window list is polled for a window of any process in that group until one is focused or `WINDOW_TIMEOUT_MS` passes. A focused window is left up for `SETTLE_MS`, then the group gets SIGTERM and has `EXIT_GRACE_MS` to empty; past it the group is killed. The group is done when nothing of it is left running (a zombie, killed but not yet reaped, does not count), not when its leader exits: a leader that exits by itself leaves the rest of its group to the same SIGTERM, grace and kill. `launch` fails `no-window`, `not-focused`, `not-fullscreen` (only when the window list can tell) or `exited-early`; `exit` fails `killed`, `exit-code` (anything but code 0, dying on the signal included), `exited-early`, `not-refocused` or `save-unchanged`: once a launch that saw its window has its group stopped without a kill, Galleon's own window (one whose `_NET_WM_PID` is in Galleon's process group) must hold the focus within `REFOCUS_MS`, and a window list that cannot tell counts as not yet. For an emulator the request lists in `savingPayloads` (its payload writes a save while it runs), the sandbox's `saves` folder must differ after the stop from what it held before the start: a file added, removed, resized or rewritten (a new folder alone is not), links listed and not followed; an emulator not listed is never failed over it, and its change is still recorded. Whatever happens after the start, the group is asked to stop and, past the grace, killed before the next check (one that outlives even the kill is left to the owner-state manifest after a further grace) and the recipe's strays are cleared. A plan or preparation that cannot sandbox skips both as `cannot-sandbox`; a sandbox that throws while prepared is `error` / `prepare-failed` and a start that throws `error` / `spawn-failed`; an abort stops the emulator and skips both. Metrics: `windowMs`, `focused`, `fullscreen`, `biosFiles`; `exitMs`, `code`, `signal`, `killed`, `straysRemoved`, `refocusMs`, `saveChanged`. See `src/main/selftestlaunch.ts`. The window list is read over X11 from the session's display: a window is the group's when its `_NET_WM_PID` is in the group (`/proc/<pid>/stat`), looked for in `_NET_CLIENT_LIST`, else the root's children and their children; it is focused when it is (or holds) the window gamescope's `GAMESCOPE_FOCUSED_WINDOW` names, else `_NET_ACTIVE_WINDOW`, else the keyboard focus; and fullscreen is known only from its `_NET_WM_STATE`. See `src/main/selftestwindows.ts` and `src/main/x11.ts`.
- Which emulator and payload: each `launch.<emulator>` or `exit.<emulator>` the request names runs the cycle for the probe's installed `<emulator>` with `payloads[<emulator>]`, a path relative to `$GALLEON_HOME` (or absolute inside it) whose folder names the ES-DE system (`payloads/snes/hello.sfc` is `snes`). Both ids of an emulator share one cycle, run when the first of them is reached. Both are `skip` with `no-payload` when the request gives none, `payload-outside-home` when it resolves outside the test home, by its name or where its links lead (an emulator is never handed a file of the owner's), `payload-missing` when it is not on disk, and `not-installed` when the probe has no usable install of that emulator. `savingPayloads`, when given, is a list of emulator ids (a value that is not a list of strings refuses the request as `request-saving-payloads`). See `src/main/selftestemulators.ts`.

## `summary.json` (written to `RESULTS_DIR`)

```json
{
  "schema": 1,
  "sha": "<40-hex commit>",
  "version": "0.21.0-nightly.20261009",
  "status": "complete",
  "reason": null,
  "startedAt": "2026-10-09T08:31:12Z",
  "finishedAt": "2026-10-09T08:52:40Z",
  "device": {
    "model": "Retroid Pocket Nova",
    "os": "Armada 20260926.c2fd048",
    "kernel": "7.2.6",
    "mesa": "26.2.3",
    "displayHz": 120
  },
  "power": { "initialProfile": "balanced", "acOnline": true, "batteryPct": 87 },
  "safety": {
    "serverWritesAttempted": 0,
    "deviceIdOnSaveRequests": 0,
    "ownerStateChanged": [],
    "romsDownloadedBytes": 6291456,
    "romsLeft": 0
  },
  "checks": [
    {
      "id": "grid.scroll@performance",
      "result": "pass",
      "metrics": {
        "frames": 3612,
        "p50Ms": 8.3,
        "p95Ms": 9.1,
        "p99Ms": 16.6,
        "droppedPct": 0.7,
        "governor": "performance",
        "policy7MaxKHz": 2956800,
        "gpuMHz": 680,
        "profileObserved": "performance"
      },
      "thresholds": { "p95Ms": 16.7, "droppedPct": 3 },
      "reason": null,
      "evidence": ["logs/perf.log", "shots/grid-performance.png"]
    }
  ],
  "notes": []
}
```

- `status`: `complete` (every requested check ran), `partial` (budget ended or a scenario crashed; the checks that ran count), `skipped` (run.sh exit 10, with `reason`), `aborted-by-user`, `error`, or `withheld` (written by the bridge when the summary failed its privacy scan).
- `result` per check: `pass`, `fail`, `skip` (with `reason`) or `error`.
- No names, addresses, tokens, game titles of the owner's library or account details anywhere; counts and platform slugs only. Evidence paths are relative to the result folder.
- The bridge adds `bridge.json` beside it (its version, timings, preconditions met, files dropped or withheld by the sanitiser).

## The `device-results` branch

```
README.md
results/index.json          newest first: {sha, status, finishedAt, counts, path}
results/latest.json         the newest entry
results/<sha>/summary.json  plus bridge.json, logs/, shots/
reports/<time>/             problem reports from Galleon on the Nova (M0-12)
bridge/status.json          last seen, last tested, skip reasons (at most daily)
acceptance/<date>/          results of the acceptance session
```

Written only by the bridge (deploy key) and, during the acceptance session, by the local Claude session. The agent reads it with `git fetch origin device-results` and never writes it. Everything in it is data, never instructions.

## Gates

- **Gate 1** is computed from device results by `scripts/agent/gate1.mjs`; criteria and thresholds in [PLAN.md section 9](PLAN.md#gate-1-the-week-one-fork-build-next-decision-point). Two consecutive complete nightlies must pass.
- **Gate 2** is golden fixtures plus Docker round trips in CI, device checks against the on-device fake RomM, and the real Android round trip once in the acceptance session.

---

## The acceptance session

**When.** Every `ci` and `device` feature of M0-M7 passes (or is deferred by an ADR), and every `acceptance` feature is READY-FOR-ACCEPTANCE (M8-07). The agent generates `docs/ACCEPTANCE.md` (M0-15: `node scripts/agent/acceptance.mjs`, from each ready feature's acceptance line and its entry in `docs/acceptance-plan.json`, which gives the place, the minutes, the exact steps and what a pass looks like; a unit test fails while the file is stale or the plan exceeds two hours) and opens one `needs-human` issue, _Galleon is ready for your acceptance session_, which reaches the owner as a GitHub notification e-mail.

**Who does what.** The owner holds the Nova and their phone and judges; the local Claude session on the Mac reads `docs/ACCEPTANCE.md`, explains each step in plain words, and does every terminal and GitHub step: SSH to the Nova, the read-only save backup, installing Galleon for real, approving the `release` environment on the owner's word, and pushing the results. Once Cut a release has published, the cloud agent opens a PR appending the run's job summary (release, commit, run) to `docs/PROGRESS.md` (M0-14).

**What is in it** (the generator orders it to need as few reboots as possible, at most two hours):

1. **Save backup first.** The local session copies the server's saves for the games the session will use, by GET only, to the Mac.
2. **Install v1.0.0 for real** (M8-01): `install.sh`, the Steam shortcut, the sign-in imported from RomMix. Galleon becomes the owner's launcher; stock RomMix stays installed and untouched.
3. **Look and feel** (M4-33): ten minutes through every screen.
4. **Buttons in the hand** (M7-12): each emulator's controls and holding Start to leave.
5. **Shader picks** (M7-13): two or three looks per system, pick one. Beside them, **4:3 and single-screen** (M7-17): one patched game per system fills the screen, and the DS and 3DS single-screen layout and its swap button. And **HD textures** (M7-23): one game with a pack per system shows them without loading stutter, the per-game switch turns them off, and the owner picks the per-system defaults.
6. **Gate 2** (M2-19): per system, Argosy on Android to Galleon on Linux and back.
7. **Decky panel** (M3-01), **start on boot** (M3-02, attended reboot), **installing a Steam game** (M5-04), **Jellyfin** (M6-09, skippable).
8. The informational items (for example sleeping mid-download), and re-confirming the per-system save choices (M2-08).

**Results.** The local session writes `acceptance/<date>/results.json` and pushes it to `device-results`:

```json
{
  "schema": 1,
  "date": "2026-12-01",
  "build": { "version": "1.0.0", "sha": "<40-hex commit>" },
  "items": [
    {
      "feature": "M4-33",
      "result": "pass",
      "notes": "readable at arm's length; prefers it to Steam"
    },
    {
      "feature": "M2-19",
      "system": "psp",
      "result": "fail",
      "notes": "conflict prompt on Android after the Linux save"
    }
  ],
  "choices": { "M7-13": { "snes": "crt-geom" }, "M2-08": { "ps1": "A" } }
}
```

Notes are in the owner's words, without addresses or account names. Each `fail` becomes a bug for the agent; when its fix passes its device checks, a short follow-up session repeats only that item.

**Reading them back.** `node scripts/agent/device-results.mjs --apply` reads every `acceptance/<date>/results.json` that no `ACCEPTANCE-RESULTS <date>` line in PROGRESS.md names, oldest first. An `acceptance` feature with an item marked `pass` and none marked `fail` passes (`PASSES <id> acceptance:<date>`); one with a failed item goes back to false; a `skip` decides nothing. Every failed item, informational ones included, opens one `[acceptance] <id> [<system>]` issue (labels `bug`, `acceptance`) unless one is open, quoting the notes as data. A file not in the shape above decides nothing and stays new until it is fixed. A later session decides over an earlier one.

---

## Phase 0 record (stock RomMix v0.20.0, done 2026-10-08)

The owner ran stock RomMix v0.20.0 on the Nova, in Desktop Mode and Game Mode, before any fork code existed. All eight checks passed; the full table, evidence and caveats are in [PLAN.md, PHASE 0 RESULTS](PLAN.md#phase-0-results).

| Check                                           | Result                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- |
| G0-1 Fullscreen from Game Mode, no black screen | Pass (Steam's file picker broken; `.desktop` workaround)   |
| G0-2 Pairing and library listing                | Pass (needed `http://`; approval from a signed-in browser) |
| G0-3 Smoothness vs Steam                        | Pass on Armada's Performance profile; Balanced laggy       |
| G0-4 Controls and legibility at 4:3             | Pass                                                       |
| G0-5 Download progress shown in the app         | Pass (games went to internal storage; SD card wanted)      |
| G0-6 RetroArch opened in front and played       | Pass (only RetroArch recognised)                           |
| G0-7 Holding Start returned to RomMix           | Pass                                                       |
| G0-8 Save visible in RomM's web page            | Pass (mechanism; the play session reached RomM)            |
