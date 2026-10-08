# Verified device and environment facts

Everything here was observed directly on the owner's hardware on 2026-10-08, during the session that installed armadaOS and built the `romm-es` prototype, unless a section says otherwise. The cloud agent cannot reach this device or the RomM server. Treat these facts as ground truth. Anything marked _(assumed)_ is confirmed or corrected by the device bridge (its `doctor` command and its device checks), never by asking the owner.

## Hardware

| Item             | Value                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device           | Retroid Pocket Nova, 8 GB RAM variant                                                                                                                                              |
| SoC              | Qualcomm QCS8550 (`/sys/devices/soc0/machine`; soc_id 603), the SM8550 / Snapdragon 8 Gen 2 class                                                                                  |
| GPU              | Adreno 740 (Mesa Turnip for Vulkan, Freedreno for GL)                                                                                                                              |
| Display          | 4.5" AMOLED, 1280×960 (4:3), 120 Hz                                                                                                                                                |
| Internal storage | about 115 GB UFS, split between Android and Linux (Armada's root btrfs is 91 GB)                                                                                                   |
| SD card          | 256 GB, genuine (f3probe passed), ext4 with casefold, label `NovaSD`, mounted at `/run/media/armada/NovaSD` (symlink `/run/media/NovaSD`), owned by `armada:armada`, 234 GB usable |

### CPU frequency (Armada vs Android)

- The driver is `qcom-cpufreq-hw`, in three clusters: policy0 (max 2016 MHz), policy3 (max 2803 MHz) and policy7, the prime core.
- policy7 `cpuinfo_max_freq` is **2956.8 MHz**. The device-tree OPP table tops out there.
- The firmware LUT also exposes **3187.2 MHz** as a boost frequency (`scaling_boost_frequencies`), but cpufreq `boost` is **0**. Upstream issue: armada-os/armada#173.
- Android reportedly reaches about 3.36 GHz. This is not verified on the Nova.
- The default Armada power profile ran the `conservative` governor and capped the prime core at about 2.09 GHz. The "Performance" profile in Armada Control lifts that cap.

## OS: armadaOS

| Item             | Value                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Release          | `Armada 20260926.c2fd048` (Fedora 44 bootc base, device support from ROCKNIX)                                                                 |
| Kernel           | 7.2.6                                                                                                                                         |
| Mesa             | 26.2.3                                                                                                                                        |
| User             | `armada` (uid 1000), groups `wheel video audio input render gamemode seat`; home `/var/home/armada`                                           |
| Default password | `armada`, set in `build_files/50-create-user.sh` and public. **Password SSH login has been disabled** on the owner's device; key-only access. |
| sudo             | Requires the password, except NOPASSWD for sddm control, poweroff, reboot and `/usr/libexec/armada/armada-installer *`                        |
| Writable paths   | `/etc` and `/var` persist across updates (bootc). `/usr` is read-only. Install to `$HOME` or `/var`.                                          |
| Python           | 3.14 with PyGObject; GTK 4.22 and GTK3 bindings available; `tkinter` **not** available                                                        |
| Tools present    | zenity 4.2.2, kdialog, konsole, notify-send, curl, sqlite _(assumed)_, flatpak, parted, mkfs.ext4/exfat/btrfs, udisksctl                      |
| Tools absent     | `strings` (binutils), `xterm`, `yad`                                                                                                          |

### Sessions and display

- Boots into **Steam Game Mode** through `gamescope-session-plus@steam`. KDE Plasma (and Plasma Mobile) are available as Desktop Mode.
- Environment of an app launched from Game Mode (seen on ES-DE):
  - `DISPLAY=:1`, `XDG_SESSION_TYPE=x11`, `XDG_SESSION_DESKTOP=gamescope`, `GAMESCOPE_WAYLAND_DISPLAY=gamescope-0`
  - `SteamAppId`/`SteamGameId` set (non-Steam shortcut IDs)
  - `LD_PRELOAD` includes Steam's `gameoverlayrenderer.so`
  - `GAMESCOPE_INTERNAL_DEVICE_ID=retroid-pocket-nova`
  - `GAMESCOPE_FORCE_VULKAN_REALTIME=1`
  - `GAMESCOPE_LIMITER_FILE=/tmp/gamescope-limiter.*`
- **A GTK window (zenity) spawned by a child process of the Game Mode app appeared on screen.** Windows from descendant processes are shown.
- Known Armada issues that affect the UX:
  - White flash on boot and when entering sleep (Nova-specific).
  - Controls can freeze when opening the QAM under heavy GPU load.
  - Decky Loader can break after Steam client updates.

### Armada tooling

- `armada-tools` CLI (`/usr/bin/armada-tools`): `ssh {status,enable,disable}`, `steam {status,repair}`, `update {status,channel,install,rollback}`.
- SD card hwsupport (SteamOS-style):
  - `/usr/lib/hwsupport/format-sdcard.sh` and `format-device.sh` run f3probe, then GPT plus ext4 `-O casefold`, then automount.
  - `/usr/lib/hwsupport/steamos-automount.sh` only automounts **ext4** and registers the card with Steam via `steam://addlibraryfolder`.
- Decky Loader is preinstalled with the Armada Control and Armada Store plugins (`/usr/share/decky-plugins/armada-store`).

## Bootloader / dual boot

- ROCKNIX ABL is flashed to `abl_a`/`abl_b`; the owner holds stock backups.
- Holding VOL- at power-on opens the ABL menu: boot mode Linux/Android, and boot source Internal/SDCard.
- Android is still installed (factory-reset during Armada's internal install).

## Installed software (from the Armada Store)

| App              | Form             | Location / ID                                                                                                                                                   |
| ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ES-DE            | AppImage         | `~/Applications/ES-DE.AppImage`; config `~/ES-DE/`                                                                                                              |
| RetroArch 1.22.2 | flatpak (system) | `org.libretro.RetroArch`; cores dir `~/.var/app/org.libretro.RetroArch/config/retroarch/cores` (snes9x + mgba installed manually from buildbot `linux/aarch64`) |
| DuckStation      | AppImage         | `~/Applications/DuckStation.AppImage`                                                                                                                           |
| ARMSX2           | AppImage         | `~/Applications/ARMSX2.AppImage`                                                                                                                                |
| melonDS          | AppImage         | `~/Applications/melonDS.AppImage`                                                                                                                               |
| Dolphin          | flatpak          | `org.DolphinEmu.dolphin-emu`                                                                                                                                    |
| PPSSPP           | flatpak          | `org.ppsspp.PPSSPP`                                                                                                                                             |
| Flycast          | flatpak          | `org.flycast.Flycast`                                                                                                                                           |

### Emulator paths (armadaos.dev docs plus observation)

| Emulator        | BIOS                                                                          | Saves                                 | Notes                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DuckStation     | `~/.local/share/duckstation/bios`                                             | `~/.local/share/duckstation/memcards` | states in `.../savestates`; settings `.../settings.ini`; shows a first-run setup wizard                                                         |
| ARMSX2          | `~/.config/ARMSX2/bios`                                                       | `~/.config/ARMSX2/memcards`           | states `.../sstates`; ini `.../inis/PCSX2.ini`; Armada's ES-DE command is `%EMULATOR_ARMSX2% %ROM%` (no `-batch`)                               |
| Flycast         | `~/.var/app/org.flycast.Flycast/data/flycast` (`dc_boot.bin`, `dc_flash.bin`) | same dir                              | config `~/.var/app/org.flycast.Flycast/config/flycast/emu.cfg`                                                                                  |
| RetroArch       | `~/.var/app/org.libretro.RetroArch/config/retroarch/system`                   | _(assumed)_ `.../retroarch/saves`     | **no gamepad hotkeys configured**: `input_menu_toggle_gamepad_combo = "0"`, `input_quit_gamepad_combo = "0"`, `input_exit_emulator_btn = "nul"` |
| Dolphin, PPSSPP | n/a                                                                           | flatpak data dirs _(assumed)_         |                                                                                                                                                 |

### ES-DE facts learned the hard way

- **No plugin or UI API.** Custom event scripts (`~/ES-DE/scripts/<event>/`) are the only hook. `game-start` scripts **block** ES-DE until they exit, and they get the ROM path **with shell backslash escapes** (`Legend\ of\ Zelda`).
- ES-DE resolves the emulator and core **before** firing `game-start`. If the emulator is missing, the hook never runs.
- `gamelist.xml` is **not single-rooted**: `<alternativeEmulator><label>…</label></alternativeEmulator>` sits beside `<gameList>`. A naive XML parser destroys it.
- "Directories interpreted as files": a directory named `Game.m3u/` containing `Game.m3u` shows as one game and launches the inner file.
- Armada's `~/ES-DE/custom_systems/es_systems.xml` overrides `pico8 ps2 psvita scummvm wiiu xbox360`. Its **ps2 entry does not accept `.cue`**. Bundled system definitions are at `AppDir/usr/share/es-de/resources/systems/linuxarm/es_systems.xml` inside the AppImage. These are a useful data source for emulator commands and find rules.
- Settings keys verified: `ROMDirectory`, `MediaDirectory`, `CustomEventScripts`, `ShowHiddenFiles`, `ParseGamelistOnly`, `RunInBackground`.

## RomM server (owner's)

| Item               | Value                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version            | **5.2.0** (`GET /api/heartbeat` → `SYSTEM.VERSION`)                                                                                                                                                                            |
| Reachability       | LAN only. The cloud agent **cannot** reach it, so all server work must be testable against a local RomM in Docker or mocks.                                                                                                    |
| Auth in use        | Device pairing → non-expiring client token, scopes `assets.read assets.write collections.read devices.read devices.write firmware.read me.read platforms.read roms.read roms.user.read roms.user.write`. The user is an admin. |
| Metadata providers | IGDB, ScreenScraper, RetroAchievements, LaunchBox, Hasheous, HLTB, libretro enabled                                                                                                                                            |
| OpenAPI spec       | `reference/romm-api/openapi-5.2.0.json` (captured from the server)                                                                                                                                                             |

### Library shape (drives edge cases)

| RomM slug (fs_slug) | ROMs      | Size       | Notable                                                                                                                        |
| ------------------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| dc (`dc`)           | 380       | 165 GB     | `.chd` 343, `.cdi` 37                                                                                                          |
| gba (`gba`)         | 1,112     | 9 GB       |                                                                                                                                |
| ngc (`ngc`)         | 66        | 105 GB     | 6 multi-disc folders (two `.iso` discs)                                                                                        |
| psx (`ps1`)         | 64        | 32 GB      | 16 multi-disc folders (`.chd` per disc)                                                                                        |
| ps2 (`ps2`)         | 289       | 928 GB     | `.iso` 261; **14 cue/bin pairs listed as separate ROMs**                                                                       |
| psp (`psp`)         | 1,292     | 863 GB     | 117 folders, mostly `has_nested_single_file` with extras (`.EDAT` DLC/keys, patches, images); 1 entry without an extension     |
| snes (`SNES`)       | 1,003     | 2 GB       |                                                                                                                                |
| **Total**           | **4,206** | **2.1 TB** | Wii and Wii U platforms exist on disk but are empty. 49 firmware files (dc 2, gba 1, psx 4, ps2 42 of which 5 are unverified). |

The library is about 9× the SD card, so **on-demand download is mandatory**.

### API behaviour verified against 5.2.0

- **Pairing:**
  - `POST /api/auth/device/init` with `{client_device_identifier, name, client, platform, client_version, requested_scopes[]}` returns 201 with `{device_code, user_code, verification_path, verification_path_complete, expires_in, interval}`.
  - The user approves in the browser at `/pair/device?user_code=XXXX`.
  - Poll `POST /api/auth/device/token {device_code}` until it returns `{access_token, device_id, scopes, expires_at:null}`.
- **Auth:** `Authorization: Bearer <token>`.
- **ROM list:**
  - `GET /api/roms?platform_ids=N&limit=500&offset=K&with_files=true` returns `{items, total}`.
  - Per-ROM fields used: `id, fs_name, fs_name_no_ext, fs_extension, fs_size_bytes, has_multiple_files, has_nested_single_file, missing_from_fs, files[{id,file_name,is_top_level,category,file_size_bytes}], name, summary, metadatum{genres,companies,player_count,first_release_date(ms),average_rating(0-100)}, path_cover_large, merged_screenshots[]`.
- **Downloads:**
  - Single file: `GET /api/roms/{id}/content/{fs_name}` returns `application/octet-stream` with Content-Length.
  - One file of a multi-file ROM: `GET /api/roms/{id}/content/{name}?file_ids={file_id}`.
  - A **HEAD** request to `/api/roms/{fileId}/files/content/{name}` returned 405. Only HEAD was tested; Argosy uses this per-file endpoint with **GET**, so verify GET before relying on it.
- **Covers:** `path_cover_large` such as `/assets/romm/resources/roms/1/4588/cover/big.png?ts=...` downloads with or without auth. Screenshots use `/assets/romm/resources/roms/<p>/<r>/screenshots/N.jpg`.
- **Firmware:** `GET /api/platforms` → `platform.firmware[]{id,file_name,file_size_bytes,is_verified}`. Download with `GET /api/firmware/{id}/content/{file_name}`.
- **Performance:** a full listing with files, for 4,206 ROMs plus 8,375 media files over Wi-Fi, took about 140 s on the first run and about 75 s on later runs. A 1.14 GB three-disc PS1 game downloaded at about 29 MB/s.

## Prototype (`reference/romm-es-prototype/`)

A working proof of concept, superseded by this project and **not** to be extended. What it proves:

- 0-byte placeholders plus merged ES-DE gamelists and media let ES-DE browse a 2.1 TB library.
- Download on first launch works, using an ES-DE `game-start` hook and a zenity progress dialog.
- Multi-disc games become generated `.m3u` files, and cue/bin pairs become directory-as-file entries.
- Firmware is copied into each emulator's BIOS directory.
- A systemd user timer re-syncs every 6 hours.

Its bugs and limits, which are the motivation for this project:

1. The progress bar jumped because a multi-line zenity status was parsed as a percentage. Never put newlines in zenity `#` lines.
2. The progress UI can't live inside ES-DE.
3. There's no universal "exit game" controller combo.
4. There's no save sync.
5. Steam games aren't in the same UI.
6. `pgrep -f` with a pattern contained in the caller's own command line killed the SSH session. Match on exact process names (`pgrep -x`) or PIDs.

## Learned during Phase 0 (stock RomMix v0.20.0, 2026-10-08)

- **Steam's "Add a Non-Steam Game -> Browse" file picker does not open** under KDE on this device. Apps appear in that dialog's program list only if a `.desktop` file exists in `~/.local/share/applications/`.
- **Game Mode session:**
  - `XDG_SESSION_TYPE=x11`, desktop `gamescope`, `DISPLAY=:1`.
  - RomMix's launcher script fell back to `--ozone-platform=x11` (XWayland).
  - Desktop Mode is KDE Plasma on native Wayland.
- **Chromium is hardware-accelerated under gamescope:** the GPU process opened `/dev/dri/renderD128` and used Mesa `libgallium` 26.2.3 through GLX (not SwiftShader or llvmpipe), at about 20% CPU while browsing.
- **Power profiles drive UI smoothness:**
  - Armada applies **Balanced** by default in Game Mode: governor `conservative`, medium underclock, prime core (policy7) capped at 2092 MHz and idling near 595 MHz, GPU devfreq `simple_ondemand` 220-680 MHz. RomMix felt considerably laggier there than in Desktop Mode.
  - **Performance** (performance governor, no underclock, `gpu_min=1.0`) made it as smooth as Desktop Mode.
  - Profiles (eco, balanced, performance: `cpu_governor`, `cpu_max`, `cpu_underclock`, `gpu_max`, `gpu_min`, `fan_curve`) are defined in `/usr/share/armada/power-profiles.conf` with `default_profile=balanced`.
  - Per-game overrides, keyed by Steam appid, are in `/run/armada/perf-state.json` and are set from Quick Access -> Armada Control.
- **Holding Start (about 1.5 s) in RomMix reaches the app under Steam Input and InputPlumber** while an emulator has focus. RetroArch (flatpak) quit gracefully, exit code 0, in about 300 ms, and focus returned.
- **Flatpaks are system installs:** RomMix's pre-flight wrongly reported "Flathub is not set up for your user".
- **No OS keyring is reachable from the Game Mode session:** Electron's `safeStorage` is unavailable, so RomMix stored credentials in a mode-0600 file.
- **RomM 5.2.0 specifics:**
  - The server is plain http on a non-default port; RomMix's default `https://` failed.
  - Platform icons `systematic/{gc,wii-u}.svg` and `{gc,wii-u}.svg` return 404.
  - Manuals have `path_manual` like `roms/<platform>/<rom>/manual/<id>.pdf`.
  - Device-flow approval works best at `/pair/device?user_code=...` in an already signed-in browser.
- **Wi-Fi throughput:** a 1.46 GB GameCube ISO downloaded in 32 s (about 46 MB/s).
- **Stock RomMix's files on the device:**
  - `~/Applications/rommix/` (AppImage and `rommix-steam.sh`)
  - `~/rommix/` (`config/settings.json`, `logs/app.log`, `logs/launcher.log`, `roms/`)
  - `~/.config/rommix/` (Electron profile)

  The fork must not reuse these.

## For the device bridge (read from source on 2026-10-08; `galleon-device-bridge doctor` confirms on the device)

These come from Armada's repository at `816091ecff7bebf78d4005175a4e5c3e237e91ab` and RomMix at v0.20.0, not from the device: the Nova was asleep while they were gathered. Treat them as _(assumed)_ until the bridge's first `doctor` run and first device result confirm them.

- **Switching the power profile needs no root.** `/usr/bin/armada-power` talks to the system D-Bus service `org.armada.Power` (`/org/armada/Power`, interface `org.armada.Power1`; the daemon is `armada-powerd`). Its D-Bus policy lets the `wheel` group send to it, and `armada` is in `wheel`. So `armada-power profile` prints the active profile, `armada-power profile performance` (or `balanced`, `eco`) switches it, and `armada-power status` prints profile, CPU caps, GPU level and limits, fan and temperature. The daemon keeps its state in `/var/lib/armada/powerd.state`; edited profile definitions go to `/etc/armada/power-profiles.conf`, over the factory `/usr/share/armada/power-profiles.conf`.
- The daemon also implements SteamOS Manager's `com.steampowered.SteamOSManager1.PerformanceProfile1`, so Steam's own per-game performance settings may switch the profile when focus changes _(assumed)_. The self-test therefore samples the governor and clocks during each measurement and labels it with the profile it observed, not the one it asked for.
- **Correction to the Phase 0 note:** `/run/armada/perf-state.json` is the Armada Control and `armada-powerd` _perf_ contract (cores, nice, gamescope nice, scheduler, in `global` and `override` layers), not a store of per-game power profiles.
- The udev rule `60-armada-perf-acls.rules` gives `wheel` write access to `/sys/devices/system/cpu/cpufreq/policy*/scaling_{governor,min_freq,max_freq}` and to the GPU devfreq `governor`, `min_freq` and `max_freq`; all are readable by anyone.
- Factory profiles: eco is `conservative`, `cpu_max=0.65`, large underclock, `gpu_max=0.80`; balanced is `conservative`, `cpu_max=1.0`, medium underclock, GPU 0 to 1.0; performance is the `performance` governor, no underclock, `gpu_min=1.0`. On SM8550 the medium underclock caps policy7 at 2092800 kHz, which is the 2092 MHz cap Phase 0 saw on Balanced.
- `armada-game-launch` takes the app id from `STEAM_COMPAT_APP_ID`, then `SteamAppId`, then `SteamGameId`, and tells a session daemon on `/run/armada/session.sock` (`game_launched`).
- **Steam's CEF debugger listens on 127.0.0.1:8080:** Armada's `launch-steam` creates `~/.local/share/Steam/.cef-enable-remote-debugging` (Decky relies on it). Through it, `SteamClient.Apps.AddShortcut(name, exe, startDir, launchOptions)` adds a non-Steam shortcut while Steam runs and returns its appid, and `SteamClient.Apps.RunGame(gameid, "", -1, 100)` starts one; that is how Armada Store does both. `steam://rungameid/<gameid>` cannot pass arguments, so the test shortcut runs a wrapper that reads a request file.
- **Stock RomMix's sign-in, as stored:** `~/rommix/config/settings.json` is `{"settings": {...}, "server": {"baseUrl", "authMode", "username"?}}` (`ROMMIX_HOME` or the pointer `~/.config/rommix/root` can move the folder). `config/credentials.bin` is a 4-byte magic, `RAW1` (plain text) or `ENC1` (Electron safeStorage), followed by JSON `{accessToken, refreshToken, clientToken, deviceId}`, written with mode 0600. Phase 0's "no OS keyring available, credentials are stored in plain text" means the Nova's copy is `RAW1`.
- **Everything RomMix's client can write to RomM**, which the self-test guard must block: `POST /api/devices`, `PUT /api/roms/{id}/props` (status, now playing), the favourites collection (`POST`/`DELETE /api/collections/{id}/roms`, creating it), save and state uploads (`POST /api/saves`, `/api/states`) and deletions (`/api/saves/delete`, `/api/states/delete`), `POST /api/play-sessions`, `POST /api/users/{id}/ra/refresh`, and token exchange or refresh (`POST /api/token`). Refreshing would also rotate the owner's own refresh token.
- **Reaching the Nova from the Mac:** key-only SSH through the alias `nova`, which resolves by mDNS. It is unreachable while the Nova sleeps, which is why the bridge runs on the Nova and nothing depends on the Mac.
