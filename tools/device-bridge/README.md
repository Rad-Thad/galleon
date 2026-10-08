# Galleon device bridge

The bridge is how Galleon gets tested on real hardware without the owner. It runs **on the Retroid Pocket Nova itself**, started every hour by a systemd user timer. When the device is idle, charging and in Game Mode inside the night window, it downloads the newest nightly, runs that nightly's own device tests, and pushes the sanitised results to the `device-results` branch of the repository. The cloud agent reads that branch at the start of every session.

No computer has to be awake for any of this. The owner's Mac is used once, by the local Claude session, to install the bridge over SSH and register its deploy key.

The full contract (what `run.sh` must do, the `summary.json` format, the check catalogue) is in [docs/PLAN.md, "The device bridge"](../../docs/PLAN.md#5-the-device-bridge-hardware-in-the-loop) and [docs/TESTING.md](../../docs/TESTING.md). This file covers the bridge program itself.

## Files

| File                                            | Installed to                             | Purpose                                                             |
| ----------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `galleon_device_bridge.py`                      | `~/.local/lib/galleon-device-bridge/`    | The bridge: preconditions, download, run, sanitise, publish         |
| `galleon-device-bridge`                         | `~/.local/bin/`                          | Entry point                                                         |
| `systemd/galleon-device-bridge.{service,timer}` | `~/.config/systemd/user/`                | Hourly oneshot, `Persistent=true`, up to 10 minutes of random delay |
| `config.example`                                | `~/.config/galleon-device-bridge/config` | Settings (created on first install with the repository filled in)   |
| `install.sh`                                    | (run from a copy of this folder)         | Install, update, uninstall                                          |
| `VERSION.json`                                  | beside the Python file                   | Bridge version; must equal `BRIDGE_VERSION` (a unit test checks)    |
| `test_galleon_device_bridge.py`                 | not installed                            | Unit tests: `python3 -m unittest discover -s tools/device-bridge`   |
| `contrib/macos-nudge.plist.template`            | not installed                            | Optional Mac alternative, see the end of this file                  |

Python 3 standard library, POSIX `sh`, `git` and `ssh` only. Nothing is written outside `~/.local`, `~/.config` and `~/galleon-device-tests`; `/usr` is read-only on armadaOS and nothing here needs root.

## Install (done once by the local Claude session)

On the Nova, from a copy of this folder (for example `scp -r tools/device-bridge nova:/tmp/`):

```sh
sh /tmp/device-bridge/install.sh --repo Rad-Thad/galleon
```

It copies the files, writes the config, creates `~/.config/galleon-device-bridge/deploy_key` (ed25519, mode 0600), pins GitHub's published ed25519 host key in `known_hosts`, enables the timer, and prints the public key. On the Mac, register it **with write access**:

```sh
ssh nova cat .config/galleon-device-bridge/deploy_key.pub > /tmp/galleon-bridge.pub
gh repo deploy-key add /tmp/galleon-bridge.pub --repo Rad-Thad/galleon --allow-write --title "Galleon device bridge (Nova)"
rm /tmp/galleon-bridge.pub
```

Then on the Nova: `galleon-device-bridge doctor`. Every line should be `OK`, `INFO` or an understood `WARN` (for example "no nightly release published yet" before the first nightly).

The `main` ruleset must have an **empty bypass list**. Deploy keys are a bypass option in rulesets; never add them. With that, the key can write `device-results` but can never change `main`.

If `doctor` says the sign-in cannot be imported (stock RomMix's credentials are keyring-encrypted, or there is no RomMix sign-in), run `galleon-device-bridge pair-readonly` once and have the owner approve the code it shows in a browser signed in to RomM. That creates a separate, read-only RomM device used only by the tests.

## What one run does

1. Takes a lock, so a timer firing during a long run does nothing.
2. Checks, in order, and stops with a logged reason at the first failure:
   - local time inside `WINDOW` (default `01:00-07:00`; `run --now` skips only this check)
   - Game Mode active: `systemctl --user is-active gamescope-session-plus@steam.service`
   - on the charger (`/sys/class/power_supply/*/online` or a battery status of Charging/Full) and battery at or above `MIN_BATTERY` (default 40%)
   - nothing playing: no process whose exact `comm` is in `BUSY_PROCESSES`. Galleon and Steam's `reaper` for Galleon do not count when Galleon's own `$XDG_RUNTIME_DIR/galleon/state.json` says `"idle": true` and is less than two minutes old.
   - at least `MIN_FREE_MB` free under `~/galleon-device-tests`
   - the network answers, and the `nightly` pre-release (public API, no token) carries `build-info.json`, `Galleon-arm64.AppImage`, `galleon-device-tests.tar.gz` and `SHA256SUMS`
   - its commit differs from the last one tested (`--force` tests it again)
3. Downloads the AppImage and the bundle to `~/galleon-device-tests/<sha>/`, verifies both against `SHA256SUMS`, and unpacks the bundle (refusing links, devices and paths that leave the folder).
4. Checks nothing started playing during the download, then runs `bundle/run.sh` in its own process group with:

   | Variable                      | Value                                                          |
   | ----------------------------- | -------------------------------------------------------------- |
   | `GALLEON_APPIMAGE`            | the verified AppImage                                          |
   | `RESULTS_DIR`                 | `~/galleon-device-tests/<sha>/results` (empty, `logs/` exists) |
   | `DEVICE_TEST_BUDGET_SECONDS`  | `BUDGET_SECONDS` (default 1800)                                |
   | `GALLEON_SHA`                 | the commit                                                     |
   | `GALLEON_TEST_DIR`            | `~/galleon-device-tests/<sha>`                                 |
   | `GALLEON_TEST_ROOT`           | `~/galleon-device-tests`                                       |
   | `GALLEON_BRIDGE_VERSION`      | the bridge version                                             |
   | `GALLEON_READONLY_TOKEN_FILE` | where `pair-readonly` stores its token, if it was ever run     |

   The hard limit is `BUDGET_SECONDS + GRACE_SECONDS`. Past it the bridge sends SIGTERM, then SIGKILL, to the process group it started (never anything else), then runs `run.sh --cleanup`, which knows how to stop Galleon and put everything back.

5. Exit codes from `run.sh`: `0` results written; `10` skipped (published once per build with its reason, not marked tested); `20` someone pressed a button and the test stopped itself (not published, retried later); anything else is published as an error.
6. Sanitises `RESULTS_DIR` into a staging folder (below), adds `bridge.json`, and pushes `results/<sha>/` plus `results/index.json` and `results/latest.json` to `device-results`. Only then is the commit recorded as tested.
7. Publishes any new problem reports the owner saved in Galleon (Settings -> System -> Report a problem) under `reports/<time>/`.
8. Keeps the newest `KEEP_RUNS` (3) test folders and the newest `KEEP_PUBLISHED` (60) result folders on the branch.
9. Once a day at most, even when it did not test anything, writes `bridge/status.json`: when it last ran, the last commit tested, and how often each skip reason happened.

## Sanitising

Everything `run.sh` wrote is treated as unsafe until checked, even though `run.sh` sanitises too:

- Only `.json .log .txt .csv .tsv .md` and `.png` files are published; links and every other type are dropped and listed in `bridge.json`.
- Text is trimmed to its last 1 MB and redacted: RomM tokens (`rmm_...`), bearer and basic credentials, values of token, password, cookie, `user_code` and `device_code` fields, URL hosts other than GitHub, localhost and a short allow-list, IPv4 and IPv6 addresses, MAC addresses, e-mail addresses, `.local`/`.lan`/`.home` names, Wi-Fi network names, Steam account ids in `userdata/<id>`, home-folder user names, and every literal this device knows: its hostname, the RomM host and user name from Galleon's or RomMix's settings, and the lines of `~/.config/galleon-device-bridge/redact`.
- After redaction the text is scanned again. A file that still contains a literal, a token, a non-loopback IPv4 address or an e-mail address is withheld, not published. If `summary.json` itself is withheld, a minimal one with status `withheld` is published instead.
- PNG files keep only their image chunks (`IHDR PLTE IDAT IEND tRNS gAMA cHRM sRGB pHYs sBIT`); text and EXIF chunks are removed. Pixels cannot be checked, so Galleon's self-test runs in privacy mode, which never draws the server address or account name.
- At most 80 files and 25 MB per run.

## Self-update

The bundle carries `bridge/`, a copy of this folder from the same commit. After a run whose `harness.run` and `safety.owner-state` checks passed, if that copy's `VERSION.json` is newer, the bridge runs its `install.sh --update`. The previous copy is kept until the new one has started once, and is put back if it does not. Config, key and state are never touched by an update. `SELF_UPDATE=0` turns this off. Bundle code already runs on the device as this user, so this adds nothing it could not already do.

Whoever changes this folder bumps `BRIDGE_VERSION` and `VERSION.json` together, and raises `minBridge` in the bundle's `bundle.json` only when `run.sh` needs the new bridge. A bundle that needs a newer bridge than the one installed is published once as an error saying so.

## Commands

```sh
galleon-device-bridge run [--now] [--force]   # what the timer runs
galleon-device-bridge doctor                  # check the setup; exit 1 on any FAIL
galleon-device-bridge status                  # last run, last skip reason, next timer
galleon-device-bridge prune                   # keep only the newest test folders
galleon-device-bridge pair-readonly [--server URL]
journalctl --user -u galleon-device-bridge    # its log (also ~/.local/state/galleon-device-bridge/bridge.log)
sh install.sh --uninstall [--purge]
```

Set `PUBLISH=0` in the config to try a run without pushing anything; the staged results stay in `~/.local/state/galleon-device-bridge/staging/<sha>/`.

## For the owner

Whenever you can, leave the Nova **on its charger, in Game Mode, at Steam's library** (quit any game, RomMix or ES-DE first) overnight, with Steam's **Settings -> Power -> Sleep when plugged in** set to **Never**. Results then show up by themselves. If the device is away or asleep for days, nothing breaks; the features that need the device simply wait.

During a test the screen shows Galleon and its emulators for up to about half an hour, with sound muted. Pressing any button stops the test straight away and hands the device back. You will also see a **Galleon Device Test** entry in your Steam library; starting it yourself does nothing.

## Optional: nudging from a Mac

Not part of the default setup. If a Mac is awake anyway, `contrib/macos-nudge.plist.template` is a launchd job that asks the Nova over SSH to run `galleon-device-bridge run --now` at 03:30. The Nova's charger and idle checks still apply, and nothing depends on it.
