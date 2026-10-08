> Research note copied into the repository at handoff (2026-10-08). Links to `~/Documents/argosy-fork/...` point at the tester's private local Argosy fork, which is not in this repository; see [argosy-fork-design-spec.md](argosy-fork-design-spec.md) for the extracted design.

# armadaOS and Steam Game Mode integration for a gamepad-first RomM launcher (aarch64 handhelds)

Research date: 2026-10-08. Unless a finding says otherwise, it comes from source code I read at these pinned revisions:

- armada-os/armada `816091ec` (2026-10-07). Below, "A/" is short for `https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/`.
- ValveSoftware/gamescope `36848c2f` (2026-10-05). Armada actually ships terra-gamescope (`packages/gamescope/build.sh`, Terra commit 23ec8c9a) plus 27 Armada patches.
- ES-DE `a8cf738d` (2026-10-05). The current release is ES-DE 3.5.0, released 2026-09-30.
- OpenGamingCollective/gamescope-session `08e65a62` (2026-10-02).
- InputPlumber `ea60d873` (0.81.0), the base Armada builds from.
- decky-loader `75563316` (2026-09-25).
- Steam ROM Manager `bd66e5f4` (2026-08-27).
- ROCKNIX/distribution `2d342567` (2026-10-08).
- Emulators: DuckStation `df805975`, PCSX2 `a9bd239f`, ARMSX2 `b1f3196b`, Dolphin `e6f3ae17`, PPSSPP `13c1773b`, Flycast `0d9853df`, RetroArch `e49b6298`.
- flatpak `f2df7b09`.

Findings tagged "(source code)" come from reading those files. Findings tagged "(docs)" or "(community)" come from web pages. Everything under "Inferences" is my own reasoning.

---

## Q1. How do non-Steam apps get added and launched inside Game Mode (shortcuts.vdf, Steam ROM Manager, steam://addnonsteamgame, Armada Store)?

### Takeaway
On armadaOS, the supported way to add a shortcut while Game Mode is running is the Steam client's own JavaScript API, `SteamClient.Apps.AddShortcut`, called from inside Steam's UI by a Decky plugin. That is how the Armada Store registers ES-DE. Editing `shortcuts.vdf` on disk, or using Steam ROM Manager, only works with Steam closed, which means Desktop Mode, because Steam rewrites the file when it exits. Shortcuts launch through a 64-bit gameid, `(appid << 32) | 0x02000000`, passed to `steam://rungameid/` or `SteamClient.Apps.RunGame`.

### Cited Findings

**How the Armada Store adds a shortcut** (source code)
- `addToSteam()` calls `window.SteamClient.Apps.AddShortcut(name, exe, startDir, launchOptions)` and gets back a numeric appid. It then calls `SetShortcutName`, because "New shortcuts come up named after the executable; apply the real name after." It also calls `SetShortcutLaunchOptions`, and optionally `SpecifyCompatTool` and a controller template. — [A/decky/armada-store/src/lib/shortcuts.ts](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/src/lib/shortcuts.ts)
- Controller templates are applied with `SteamClient.Input.SetSelectedConfigForApp(appid, index, "template://controller_neptune_<template>.vdf", ...)` across the 16 Steam Input slots, for Deck-type controllers (`nControllerType` 4 or 100). The code comment says: "Steam's layout browser lists nothing for the built-in controls, which take the Steam Deck's templates." — same file
- Launching uses the code comment "Non-Steam shortcuts launch by 64-bit gameid: (appid << 32) | 0x02000000". It calls `SteamClient.Apps.RunGame(gameid, "", -1, 100)` and falls back to `SteamClient.URL.ExecuteSteamURL("steam://rungameid/" + gameid)`. — same file
- Launch specs come from the catalog:
  - Flatpak: exe `/usr/bin/flatpak`, launch options `run <ref>`.
  - AppImage: exe `~/Applications/<filename>`, startDir `~/Applications`.
  - System app: exe is the app's path.
  - Every launch option is wrapped as `/usr/libexec/armada/armada-game-launch %command%`.
  - Source: `catalog.py`, `wrap_launch_options()` and `_launch_command()`. — [A/decky/armada-store/py_modules/armada_store/catalog.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/catalog.py)
- What `armada-game-launch` does before it execs the game. — [A/system_files/usr/libexec/armada/armada-game-launch](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/armada-game-launch)
  - Applies per-game FEX settings and CPU affinity and nice values.
  - Notifies the Armada session daemon with `game_launched`.
  - Applies optional Turnip driver overrides.
  - If the target is an AppImage (ELF header `AI` magic), puts `/usr/bin:/usr/local/bin:/bin` at the front of PATH (`prepare_appimage_path`).
- Steam ROM Manager appears in the Armada catalog with `"desktopOnly": true` and the note "Needs Steam closed; run it from desktop mode". — [A/decky/armada-store/catalog.json](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/catalog.json)
- Armada's code says: "Steam rewrites shortcuts.vdf on exit, so tools that edit it have to run with Steam closed. Switching sessions is the only way to get there from game mode." It then calls `/usr/libexec/armada/session-control switch-desktop`. — [A/decky/armada-store/py_modules/armada_store/session.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/session.py)
- The Armada Store docs say that for an installed application, "clicking on its entry will allow you to directly add the application to Steam", and that installing an app creates a non-Steam shortcut. (docs) — [armadaos.dev Armada Store](https://armadaos.dev/using-armada/armada-store/)

**shortcuts.vdf format**
- It is binary VDF. Armada's reader parses these type bytes: `0x00` nested object, `0x01` C string, `0x02` little-endian uint32, `0x08` end of object. Shortcuts live at `~/.local/share/Steam/userdata/*/config/shortcuts.vdf` under the `shortcuts` key, with the `appid` and `AppName` fields. (source code) — [A/decky/armada-control/py_modules/armada_control/steam.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-control/py_modules/armada_control/steam.py)
- Steam ROM Manager's ID algorithm. (source code) — [SRM generate-app-id.ts](https://github.com/SteamGridDB/steam-rom-manager/blob/bd66e5f4ef1eb0b4855bbd216063f547f1468368/src/lib/helpers/steam/generate-app-id.ts)
  - `top = crc32(exe + appname) | 0x80000000`, and the 64-bit "AppId" is `(top << 32) | 0x02000000`. Big Picture grids use that 64-bit value.
  - The "ShortAppId" is `top`, the unsigned 32-bit value, and is used for all other grid images.
  - `shortcuts.vdf` stores `appid` as `top - 0x100000000`, a signed int32.
- SRM preserves the remaining shortcut keys, with the comment "all other keys (IsHidden, AllowOverlay, LastPlayTime, etc.) untouched". The fields it manages include `appid`, `StartDir`, `LaunchOptions`, `icon` and `tags`. (source code) — [SRM vdf-shortcuts-file.ts](https://github.com/SteamGridDB/steam-rom-manager/blob/bd66e5f4ef1eb0b4855bbd216063f547f1468368/src/lib/vdf-shortcuts-file.ts)
- A 2022 Steam Community thread reports that the ID Steam generated for a shortcut added through the GUI did not match CRC32 of Exe plus AppName. The CRC formula is reliable for SRM-created entries but not guaranteed for Steam-created ones. (community) — [Steam Community thread](https://steamcommunity.com/discussions/forum/1/3361398061434096995)
- Valve's protocol page describes `steam://rungameid/<id>` as "Same as run, but with support for mods and non-Steam shortcuts". It also lists `steam://AddNonSteamGame`, which opens the add-a-non-Steam-game picker. (docs) — [Valve: Steam browser protocol](https://developer.valvesoftware.com/wiki/Steam_browser_protocol)
- Community guides say you can't reach "Add a Non-Steam Game" from Game Mode, only from Desktop Mode. (community) — [Dexerto guide](https://www.dexerto.com/tech/how-to-add-non-steam-games-to-steam-deck-2082992/)
- A Steam feature request notes that `steam://rungameid` cannot pass arguments to a non-Steam game. (community) — [Steam Community](https://steamcommunity.com/discussions/forum/10/3130543025014933967)
- Grid art lives in `userdata/<id>/config/grid/` as `<id>.png` (horizontal), `<id>p.png` (portrait), `<id>_hero.png` and `<id>_logo.png`. (community) — [Steam Community thread](https://steamcommunity.com/discussions/forum/1/3361398061434096995)

**What ES-DE looks like when launched from Game Mode** (verified on the device this session)
- ES-DE's environment contains `SteamAppId` and `SteamGameId`, Steam's overlay in `LD_PRELOAD`, `DISPLAY=:1` and `XDG_SESSION_TYPE=x11`.
- Armada's session sets `STEAM_MULTIPLE_XWAYLANDS=1`, so each game gets its own Xwayland. — [A/system_files/usr/share/gamescope-session-plus/sessions.d/steam](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/share/gamescope-session-plus/sessions.d/steam)

### Inferences
- **Registering the launcher itself.** Do it the Armada Store way: call `SteamClient.Apps.AddShortcut` from a Decky plugin in Game Mode, then read back the appid it returns. Do not compute the CRC. Keep the `armada-game-launch %command%` wrapper, so the launcher gets Armada's PATH fix and the per-game perf hooks. The simplest route for users is getting the launcher into Armada's catalog (Q7), which gives one-tap "Add to Steam".
- **Writing shortcuts.vdf directly** is only safe as a Desktop Mode step with Steam closed. If the launcher does this, it must detect a running Steam (for example the `steam.pipe` or the CEF port) and refuse.
- **Per-ROM Steam shortcuts are unnecessary.** The launcher is a single shortcut and starts the emulators as child processes (Q3). That avoids SRM-style churn.

### Gaps
- I did not test whether `steam://AddNonSteamGame` does anything in Game Mode on current Steam. The Valve wiki notes some commands are no longer functional.
- `SteamClient.Apps.AddShortcut` is an internal, undocumented Steam API. Its signature comes only from Armada's usage, so it can break with Steam client updates.

---

## Q2. How can the launcher start automatically on boot as the "home" screen, and what are the risks?

### Takeaway
Keep Steam as the gamescope session client, since QAM, the on-screen keyboard, Steam Input and Steam games all depend on it. Then auto-launch the launcher's shortcut once Steam is up. Armada's `gamescope-session-plus` sources a per-user `~/.config/gamescope-session-plus/sessions.d/steam` after Armada's own file, so `CLIENTCMD` can be appended with `steam://rungameid/<gameid>`. This is the Armada equivalent of RetroDECK's `devkit-steam` autoboot hack. A Decky companion plugin calling `RunGame` is the alternative that touches no files. Replacing Steam as the base layer, as OpenGamepadUI does, is high-risk on Armada.

### Cited Findings

**How the session starts on Armada** (source code)
- SDDM autologin picks the session. `session-control` writes `/etc/sddm.conf.d/zz-holo-autologin.conf` with `Session=gamescope-session-steam.desktop` for Game Mode, or `armada-plasma(.mobile).desktop` for Desktop Mode, then restarts SDDM or logs Plasma out. — [A/system_files/usr/libexec/armada/session-control](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/session-control)
- `armada-steam-default-session.service` is a user oneshot that runs after `steamos-manager.service`. It only sets steamos-manager's default desktop session to Armada's Plasma wrapper (`steamosctl set-default-desktop-session armada-plasma.desktop`), so that "Switch to Desktop" lands correctly. It does not choose the Game Mode client. — [A/.../armada-steam-default-session.service](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/systemd/user/armada-steam-default-session.service), [A/.../steam-default-session](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/steam-default-session)
- Steam's own "Switch to Desktop" or "Game Mode" requests go through `/usr/libexec/os-session-select`, which runs `steamosctl switch-to-desktop-mode` or `switch-to-game-mode`. — [A/system_files/usr/libexec/os-session-select](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/os-session-select)
- Armada's Steam session file sets:
  - `CLIENTCMD='/usr/libexec/armada/launch-steam -gamepadui -steamos3 -steampal -steamdeck'`, plus `-noverifyfiles` when not running from internal storage.
  - A splash wrapper `armada-splash-run`, unless `/etc/armada/splash-disabled` exists.
  - `GAMESCOPE_FALLBACK_APPID=0x41524d41`.
  - A `short_session_recover` that runs `steamos-session-select desktop`.
  - Source: [A/system_files/usr/share/gamescope-session-plus/sessions.d/steam](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/share/gamescope-session-plus/sessions.d/steam)
- `launch-steam` passes `"$@"` straight to the native ARM Steam binary. It also touches `~/.local/share/Steam/.cef-enable-remote-debugging`, which enables Steam's CEF debug port that Decky uses. — [A/system_files/usr/libexec/armada/launch-steam](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/launch-steam)

**gamescope-session-plus override mechanics** (source code)
- Session files are sourced in this order: `/usr/share/gamescope-session-plus/sessions.d/<client>`, then `/etc/gamescope-session-plus/sessions.d/<client>`, then `${XDG_CONFIG_HOME:-~/.config}/gamescope-session-plus/sessions.d/<client>`.
- After that, `/etc/environment.d/*.conf` and `~/.config/environment.d/*.conf` are sourced, and finally `$CLIENTCMD` runs.
- Armada's patch keeps the same loop.
- If the client dies within 60 s five times running, `short_session_recover` runs. On Armada that switches to Desktop Mode.
- Sources: [gamescope-session-plus script](https://github.com/OpenGamingCollective/gamescope-session/blob/08e65a62ed3d7acc6ae17db637091d402a55ae2a/usr/share/gamescope-session-plus/gamescope-session-plus), [A/packages/gamescope-session/patches/0004-source-armada-specific-quirks.patch](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/packages/gamescope-session/patches/0004-source-armada-specific-quirks.patch)
- The README documents `CLIENTCMD` and `GAMESCOPECMD` overrides through `~/.config/environment.d/gamescope-session-plus.conf`. It says custom sessions are created at `/usr/share/gamescope-session-plus/sessions.d/<name>` plus `/usr/share/wayland-sessions/gamescope-session-<name>.desktop`. (docs) — [gamescope-session README](https://github.com/OpenGamingCollective/gamescope-session/blob/08e65a62ed3d7acc6ae17db637091d402a55ae2a/README.md)
- The README also describes the project as "part of the ChimeraOS project"; it "only provides the common files needed by actual sessions such as ... gamescope-session-steam or ... OpenGamepadUI-session". (docs) — same README

**Prior art**
- RetroDECK's autoboot hack for SteamOS: create `~/devkit-game/devkit-steam` containing `#!/bin/bash` and `steam "$@" steam://rungameid/<RetroDECK_gameid>`. RetroDECK calls it "extremely dangerous", says it "could damage your Game Mode / SteamOS", and warns of possible bootloops. (docs) — [RetroDECK: Autoboot into RetroDECK](https://retrodeck.readthedocs.io/en/latest/wiki_experiments/retrodeck-gamemode-boot/retrodeck-gamemode-boot/)
- In that setup, an invalid rungameid only produces a popup saying the game doesn't exist. Changing the rest of the command line is what can brick. (community, via RetroDECK wiki commits) — [repo.retrodeck.net commit](https://repo.retrodeck.net/Xargon/Wiki/commit/388e12ff7038ff91eb167f10178e4cdccea85068)
- OpenGamepadUI runs as its own gamescope session client, `OpenGamepadUI-session`. Universal Blue forum replies note it "had to reimplement some system features that depend on Steam", and that no on-screen keyboard is available. (community) — [Universal Blue forum](https://universal-blue.discourse.group/t/is-it-possible-to-start-lutris-instead-of-steam-in-game-mode/9084)
- Armada's Terra build avoids `gamescope-session-ogui-steam` because "Terra's aarch64 deps are broken". (source code) — [A/build_files/30-install-steam-session.sh](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/build_files/30-install-steam-session.sh)

**Recovery path on Armada** (source code)
- `armada-boot-hotkeys` polls during the boot splash. Holding Select (code 314, `BTN_SELECT`) for about 1 s triggers `session-control switch-desktop` or `default-desktop`, so Armada has a built-in escape from a broken Game Mode. — [A/system_files/usr/libexec/armada/armada-boot-hotkeys](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/armada-boot-hotkeys)

### Inferences
- **Recommended recipe (Option A1).** Write `~/.config/gamescope-session-plus/sessions.d/steam` containing only `CLIENTCMD+=" steam://rungameid/<64-bit gameid>"`.
  - The file is sourced after Armada's, so it keeps Armada's `launch-steam` flags and splash wrapper.
  - Never replace `CLIENTCMD` wholesale.
  - Do not put `CLIENTCMD` in `~/.config/environment.d/`. systemd's user manager also reads environment.d, so the variable would leak into every user unit.
  - Offer an "Autostart on boot" toggle that writes or removes this file.
  - If Armada adds its own user-level override later, this file could conflict, so re-check `sessions.d` on Armada updates.
- **Option A2: Decky companion plugin.** On load, wait until the Steam UI is ready, then call `SteamClient.Apps.RunGame(gameid, "", -1, 100)`, the same call Armada Store uses. Nothing is written to session files. It fails silently if Decky is broken after a Steam update, which is a known Armada issue (Q8).
- **Option A3: user systemd unit.** Wait for Steam's CEF port `127.0.0.1:8080`, which `armada-boot-hotkeys` already treats as the "Steam is up" signal, then run `steam steam://rungameid/<id>`. On Armada, `/usr/bin/steam` and the `x-scheme-handler/steam` desktop entry both route to `launch-steam --desktop`.
- **Risks of autostart.**
  - A launcher that crashes on start just leaves the user in Steam. That is benign compared with replacing the session client.
  - If Steam drops the shortcut or its ID changes, the user gets a "game does not exist" popup.
  - Steam's "Launch Multiple Games" dialog may interact with later launches (Q4).
  - Steam updates on boot may race the auto-launch.
- **Do not replace Steam as the base layer.** That would need a custom `.desktop` session. On bootc, `/usr/share/wayland-sessions` is read-only, and Armada's `session-control` hardcodes `gamescope-session-steam.desktop`. You would also lose QAM, the keyboard, Steam Input and Steam game launching. Treat it as out of scope.

### Gaps
- I did not test on device that Steam honors a `steam://rungameid` URL appended to `CLIENTCMD` at Armada startup. The RetroDECK SteamOS precedent suggests it does.
- I found no documentation that a Steam-client-side "launch on startup" setting exists.
- Bazzite was suggested as a source, but I found no Bazzite-specific "boot into launcher" pattern beyond its general gamescope docs.

---

## Q3. How do child emulator windows get focus and visibility in gamescope, and how does focus return when the emulator exits?

### Takeaway
gamescope gives every X11 window an appID.
- It uses the `STEAM_GAME` window property if one is set.
- Otherwise it derives the appID from the window's PID: first from a cgroup scope named `app-steam-app<appid>-<pid>.scope`, then by walking ancestor processes for Steam's `reaper` launched with `SteamLaunch AppId=<n>`.

Every child process of the launcher, including `flatpak run` sandboxes, inherits the launcher's appID. Its windows are therefore part of the focused app and become visible. Among windows with the same appID, the most recently mapped one wins, so the emulator takes focus when it opens and the launcher's window regains focus when the emulator's window unmaps.

### Cited Findings

**How gamescope assigns appIDs** (source code)
- When `steamMode` is on, new X11 windows get `appID = gamescope::Process::GetAppIdFromPid(pid)`. — [gamescope steamcompmgr.cpp L6027-6045](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/steamcompmgr.cpp#L6027-L6045)
- A non-zero `STEAM_GAME` property is authoritative ("Let the appID property be authoritative for now"). Windows with `STEAM_BIGPICTURE` get appID 769, which is Steam itself. External overlays get appID 0. — [steamcompmgr.cpp L5791-5823](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/steamcompmgr.cpp#L5791-L5823)
- `GetAppIdFromPid` reads `/proc/<pid>/cgroup` and matches `app-steam-app%u-%d.scope`. If that fails, it walks `/proc/<pid>/stat` parents looking for a process named `reaper` whose cmdline contains `SteamLaunch` and `AppId=<n>`. — [gamescope src/Utils/Process.cpp L666-804](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/Utils/Process.cpp#L666-L804)

**How gamescope picks focus** (source code)
- Steam steers focus by setting the `GAMESCOPECTRL_BASELAYER_APPID` and `GAMESCOPECTRL_BASELAYER_WINDOW` root properties. gamescope publishes `GAMESCOPE_FOCUSABLE_APPS` and `GAMESCOPE_FOCUSED_APP`. — [steamcompmgr.cpp L6960-6967, L9084-9090](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/steamcompmgr.cpp#L6960-L6967)
- Focus priority (`is_focus_priority_greater`) prefers windows in this order:
  1. Windows that have a game ID.
  2. Non-override-redirect windows.
  3. Windows that aren't 1x1.
  4. Windows that aren't dropdowns or disabled.
  5. Normal windows over dialogs.
  6. For game windows, the higher `map_sequence` (newest mapped).
  7. Then the higher `damage_sequence` (most recently drawn).
  - Source: [steamcompmgr.cpp L4134-4186](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/steamcompmgr.cpp#L4134-L4186)

**Armada's gamescope patches** (source code)
- Patch 0001: when nothing is focusable, show a window whose appID equals `$GAMESCOPE_FALLBACK_APPID`. Armada uses this for its boot splash, set to `0x41524d41`. — [A/packages/gamescope/patches/0001-steamcompmgr-fallback-appid-focus.patch](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/packages/gamescope/patches/0001-steamcompmgr-fallback-appid-focus.patch)
- Patch 0024 reports native Wayland (xdg-shell) windows that have an appID to Steam in `GAMESCOPE_FOCUSABLE_APPS` and `GAMESCOPE_FOCUSABLE_WINDOWS`. Upstream builds those lists from Xwayland windows only, so a Wayland-only game "never leaves the launch spinner". — [A/packages/gamescope/patches/0024-steamcompmgr-report-wayland-windows-to-steam.patch](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/packages/gamescope/patches/0024-steamcompmgr-report-wayland-windows-to-steam.patch)
- The session forces `QT_QPA_PLATFORM=xcb` and `SDL_VIDEO_MINIMIZE_ON_FOCUS_LOSS=0`. — [gamescope-session-plus](https://github.com/OpenGamingCollective/gamescope-session/blob/08e65a62ed3d7acc6ae17db637091d402a55ae2a/usr/share/gamescope-session-plus/gamescope-session-plus)

**Other reports and observations**
- Steam needs both `-steamos3` and `-steamdeck` for non-Steam games to gain focus in a gamescope session (steam-for-linux issue 8513). Armada passes both. (community) — [ValveSoftware/steam-for-linux#8513](https://github.com/ValveSoftware/steam-for-linux/issues/8513)
- Armada's ES-DE docs: "If an emulator opens a dialog that isn't visible or has no exit shortcut, open the Steam menu to switch windows or close them." (docs) — [armadaos.dev ES-DE](https://armadaos.dev/emulation/es-de/)
- A February 2024 report says switching between multiple windows of one app through the Steam overlay stopped working. (community) — [Steam Community thread](https://steamcommunity.com/app/1675200/discussions/0/3270187589543532489)
- Verified on the device this session: a zenity window spawned by a child of ES-DE did appear in Game Mode.

### Inferences
- **Recipe.**
  - Spawn emulators as descendants of the launcher process. Never double-fork away or reparent them to systemd with `systemd-run --user` (a service, not a scope), because the reaper-ancestry fallback would break.
  - Steam already puts the launcher in `app-steam-app<id>-<pid>.scope`.
  - `flatpak run` moves the sandboxed app into its own `app-flatpak-*.scope`. The cgroup check then fails, but the reaper-ancestry walk still works, which is consistent with the zenity observation and ES-DE launching flatpak RetroArch.
- **Don't map new windows during play.** While an emulator runs, the launcher should not map any new top-level X11 window, such as a toast or download popup. A newly mapped window with the same appID outranks the emulator on `map_sequence` and would steal focus. Show notifications only after the emulator exits, or not at all.
- **Return of focus is automatic.** When the emulator exits, its windows unmap and the launcher's still-mapped window is the only game-ID window left. To be safe, the launcher can also re-raise and redraw itself once it reaps the child.
- **Prefer X11/Xwayland for the launcher's own window.** Use `SDL_VIDEODRIVER=x11`, Qt xcb, or the Electron and Flutter X11 backends. Native Wayland windows only work as focusable apps because of Armada's patch 0024, not upstream gamescope.
- **Don't set `STEAM_GAME` by hand on child windows.** The inherited appID is enough, and a different value would make Steam treat the window as a separate app.
- **Steam Input is per appID.** Every emulator launched by the launcher therefore receives the launcher shortcut's controller layout. Choose a plain gamepad template, which is what Armada's store helper does for its apps.

### Gaps
- I did not verify whether Steam itself adds `STEAM_GAME` to windows of children of non-Steam shortcuts, or relies only on gamescope's PID derivation, on the current Steam client.
- Multi-window emulators were not tested on device. Examples are Dolphin's render window plus its main window when `-b` is missing, and melonDS dual screens.

---

## Q4. How should the launcher start Steam games with steam://rungameid, read the installed library, and what are the Game Mode caveats?

### Takeaway
Read the installed library the way Armada Control does: parse `libraryfolders.vdf` for library paths, then `appmanifest_*.acf` for `appid` and `name`. Launch with `steam steam://rungameid/<appid>` or `xdg-open`, both of which route to Armada's `launch-steam --desktop`. Steam starts the game in its own reaper scope with its own appID and moves focus to it, while the launcher keeps running behind it. Focus return after the game exits, and Steam's "Launch Multiple Games" dialog, both need testing on the device.

### Cited Findings

**Reading the library** (source code)
- Armada Control reads `/var/home/armada/.local/share/Steam/steamapps/libraryfolders.vdf` and `config/libraryfolders.vdf`, collects each `"path"`, globs `<path>/steamapps/appmanifest_*.acf`, and extracts `appid` and `name`. It also merges non-Steam shortcuts from `userdata/*/config/shortcuts.vdf`. — [A/decky/armada-control/py_modules/armada_control/steam.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-control/py_modules/armada_control/steam.py)

**How launches are routed on Armada** (source code)
- `/usr/bin/steam` is a wrapper: `exec /usr/libexec/armada/launch-steam --desktop "$@"`, with the comment "Steam's generated game shortcuts and steam:// handlers hardcode `steam`". — [A/system_files/usr/bin/steam](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/bin/steam)
- `steam.desktop` declares `MimeType=x-scheme-handler/steam;` with `Exec=/usr/libexec/armada/launch-steam --desktop %U`. — [A/system_files/usr/share/applications/steam.desktop](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/share/applications/steam.desktop)
- The Game Mode session sets `SRT_URLOPEN_PREFER_STEAM=1`, which sends http and https URLs to Steam. — [A/.../sessions.d/steam](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/share/gamescope-session-plus/sessions.d/steam)
- gamescope assigns a Steam game's windows its own appID via the `app-steam-app<appid>-<pid>.scope` cgroup or the reaper `AppId=`. (source code) — [gamescope Process.cpp](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/Utils/Process.cpp#L666-L804)

**Known caveats from other projects**
- ES-DE keeps running in the background while a Steam game runs. Its commits note Steam may start together with the game, and ES-DE treats any input it receives as proof that you're back. ES-DE's guidance for Steam titles is per-game scripts calling `steam://rungameid/<id>`. It warns about thin scraper media and Steam wanting to update games on launch. (community, ES-DE commits mirrored by RetroDECK) — [ES-DE commit](https://repo.retrodeck.net/Xargon/ES-DE/commit/c8661e5186d44bbe50991a891a449d5f9e91aab9)
- A March 2025 Steam client update "Replaced the 'Switch to previous game' option in the 'Launch Multiple Games' dialog with 'Close previous game'" (as reported by GamingOnLinux). (news) — [GamingOnLinux, March 2025](https://www.gamingonlinux.com/2025/03/steam-update-adds-game-notes-to-the-web-demo-installs-on-profile-game-list-8bitdo-micro-support/)
- Steam's March 2023 beta fixed "Steam was not focused properly after exiting a game". (news) — [SteamDeckHQ](https://steamdeckhq.com/news/steam-deck-beta-client-update-3-10-23/)

**Artwork**
- Community docs describe flat `appcache/librarycache/<appid>_library_600x900.jpg`, `_header`, `_library_hero` and `_logo` files. One report says the file named 600x900 actually measures 300x450. Custom art lives in `userdata/<id>/config/grid/<id>p.png`. (community) — [Steam Community](https://steamcommunity.com/discussions/forum/1/5330625727573086272), [Steam Client Beta group](https://steamcommunity.com/groups/SteamClientBeta/discussions/0/6273017912362352231)

### Inferences
- **Launch command.** Launch Steam games with `steam steam://rungameid/<appid>`, using the plain appid for Steam titles. The launcher runs inside the Steam runtime environment, so call `/usr/bin/steam` by absolute path and reset PATH, as `armada-game-launch` does.
- **The multiple-games prompt can kill the launcher.** The launcher counts as a running "game", since it is a shortcut. Steam may show the "Launch Multiple Games" prompt, and its "Close previous game" option would kill the launcher. Test this first on the device. If the prompt appears, consider handing off: tell the user, and let the launcher autostart again after the Steam game exits, through the Decky plugin or the next launch.
- **Pause while in the background.** The launcher should stop rendering and polling while a Steam game is focused, to save battery on the handheld. It can watch `GAMESCOPE_FOCUSED_APP` on the Xwayland root window. Its own appID is known from the `SteamAppId` environment variable.
- **Installed check.** Also parse `StateFlags` from the appmanifest, where 4 means fully installed, so updating or partial installs can be filtered out. This is standard ACF knowledge, not verified here.
- **SD card libraries.** These are listed in `libraryfolders.vdf` with paths such as `/run/media/armada/<label>`, so they need no special handling.
- **Artwork strategy.** Prefer the user's `config/grid` custom art, then any `librarycache` file matching `<appid>*` or `<appid>/`, then the Steam CDN.

### Gaps
- I could not verify the current `librarycache` layout, flat files versus per-appid subfolders, for the 2026 Steam client. The launcher should glob both, or the user should run `ls ~/.local/share/Steam/appcache/librarycache | head`.
- Untested: what Steam focuses after a Steam game exits when a non-Steam launcher is still running (the launcher or the Steam library page).
- Untested: whether Steam shows the multiple-games dialog when the second launch comes from the CLI or a URL.

---

## Q5. How do other distros implement a universal "hold Select+Start to quit" hotkey, how do you read input under Steam Input and InputPlumber, and how do you terminate flatpak trees gracefully?

### Takeaway
ROCKNIX is the best reference design.
- An evdev listener (`evtest` on every `/dev/input/event*`) watches for the chord.
- It sends one SIGTERM to the registered emulator, because "a second SIGTERM makes RetroArch exit without saving".
- It sends SIGKILL after 5 s and never force-kills the frontend.

On Armada, InputPlumber holds `EVIOCGRAB` on the physical gamepad nodes, so an event-stream reader sees nothing there. Polling key state with `EVIOCGKEY` still works through the grab; Armada's own boot-hotkey script does exactly that.

For flatpaks, `flatpak kill` sends SIGKILL. Send SIGTERM to the `child-pid` from `flatpak ps` instead.

### Cited Findings

**ROCKNIX** (source code)
- `input_sense` runs a continuously restarted `evtest` loop per `/dev/input/ev*`. The chord is `BTN_TL` + `BTN_SELECT` + `BTN_START` by default, configurable as `key.hotkey.a/b/c`. — [ROCKNIX input_sense](https://github.com/ROCKNIX/distribution/blob/2d342567194c78e01a37c75b0473b8c86a708619/projects/ROCKNIX/packages/sysutils/system-utils/sources/scripts/input_sense)
- `execute_kill` behavior. — same file
  - It reads the target from `/tmp/.process-kill-data`.
  - It sends a single `killall`/SIGTERM: "Signal only one set, a second SIGTERM makes RetroArch exit without saving."
  - "Never force ES, it saves its gamelists on SIGTERM."
  - After `sleep 5`, it sends `kill -9`: "An app that handles SIGTERM saves and exits well within 5 seconds."
- Emulator start scripts register targets, for example `set_kill set "-9 duckstation-qt"` and `set_kill set "-9 ppsspp"`. `set_kill` writes the target to `/tmp/.process-kill-data`. ROCKNIX launches DuckStation as `duckstation-sa -fullscreen -bigpicture -nogui -- "${1}"`. — [start_duckstation.sh](https://github.com/ROCKNIX/distribution/blob/2d342567194c78e01a37c75b0473b8c86a708619/projects/ROCKNIX/packages/emulators/standalone/duckstation-sa/scripts/start_duckstation.sh), [001-functions](https://github.com/ROCKNIX/distribution/blob/2d342567194c78e01a37c75b0473b8c86a708619/projects/ROCKNIX/packages/rocknix/profile.d/001-functions)
- ROCKNIX device pages list SELECT+START (x2) as RetroArch's quit, and per-emulator combos such as Guide+Start for DuckStation on some devices. (docs) — [rocknix.org RGB10 Max 3 Pro](https://rocknix.org/devices/powkiddy/rgb10-max-3-pro/)

**gptokeyb (PortsMaster)** (docs)
- `-1` or `-k <name>` "provides the name of the application that will be closed by pressing **start** and **select** together".
- It uses `killall` by default, or `sudo kill -9` with `-sudokill`. `PCKILLMODE=Y` sends Alt+F4 first.
- It reads input through SDL2 GameController (`SDL_GAMECONTROLLERCONFIG_FILE`). The hotkey defaults to BACK and can be overridden with `HOTKEY`.
- Source: [PortsMaster/gptokeyb README](https://github.com/PortsMaster/gptokeyb)

**Batocera** (docs)
- evmapy maps controller input to a virtual keyboard. The documented exit mapping is `"trigger": ["hotkey","start"]`, sending `KEY_LEFTCTRL` + `KEY_Q` ("Exit emulator"). Dolphin does not use evmapy. — [Batocera wiki: evmapy](https://wiki.batocera.org/evmapy), [Batocera hotkeys](https://wiki.batocera.org/basic_commands)

**RetroDECK** (docs)
- Hotkeys are implemented in Steam Input templates. "Quit Component" is HKB + Start, which sends `CTRL + Q`. The HotKey Button is Select on most templates (L4, R4 or Select on the Deck).
- Ctrl+Q quit is listed as supported for Azahar, Dolphin, PrimeHack, DuckStation (Legacy), PCSX2 and RetroArch.
- Source: [RetroDECK hotkeys](https://retrodeck.readthedocs.io/en/latest/wiki_rd_controls/hotkeys-retrodeck/)

**EmuDeck** (docs)
- Its Windows hotkey page lists Select+Start as exit. I found no EmuDeck page documenting the Steam Deck template internals. — [EmuDeck hotkeys](https://emudeck.github.io/controls-and-hotkeys/windows/hotkeys/)

**InputPlumber and Armada input** (source code)
- InputPlumber 0.81.0 grabs source devices: `device.grab()` in `GamepadEventDevice::new`, and likewise for keyboard, touchscreen and blocked devices. — [InputPlumber gamepad.rs](https://github.com/ShadowBlip/InputPlumber/blob/ea60d873cca17edd1cb655ede26f557108135252/src/input/source/evdev/gamepad.rs)
- Armada's boot hotkey reader says "EVIOCGKEY state, not an event stream: reads through InputPlumber's grab." It finds nodes whose `/sys/class/input/eventN/device/capabilities/key` bitmap has the key, then polls `evtest --query <dev> EV_KEY BTN_SELECT` every 500 ms (exit code 10 means pressed). It notes Select is used "because no capability map translates it, so it reaches the raw node unchanged". — [A/.../armada-boot-hotkeys](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/armada-boot-hotkeys), [A/.../input-lib](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/armada/input-lib)
- Armada's default InputPlumber target list is `ARMADA_IP_TARGETS=deck-uhid,xbox-series,xb360,ds5`, with the first entry the default. The deck-uhid hidraw node `0003:28DE:12F0` is group `input`, mode 0660. The `armada` user is in groups `input`, `video`, `render`, `seat` and `gamemode`. — [A/.../devices/defaults.conf](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/armada/devices/defaults.conf), [A/.../70-armada-inputplumber.rules](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/udev/rules.d/70-armada-inputplumber.rules), [A/.../armada-user.conf](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/sysusers.d/armada-user.conf)
- InputPlumber intercept modes are `None`, `Pass` ("all inputs ... except the guide button"), `Always` and gamepad-only to DBus. There is a DBus `SetInterceptActivation(activation_events, target_event)` for chords, gated by polkit action `org.shadowblip.Input.CompositeDevice.SetInterceptActivation`. — [InputPlumber composite_device/mod.rs](https://github.com/ShadowBlip/InputPlumber/blob/ea60d873cca17edd1cb655ede26f557108135252/src/input/composite_device/mod.rs), [dbus composite_device.rs](https://github.com/ShadowBlip/InputPlumber/blob/ea60d873cca17edd1cb655ede26f557108135252/src/dbus/interface/composite_device.rs)
- Armada only grants root `SetTargetDevices`. It uses intercept modes through `/usr/libexec/armada/inputplumber-intercept` (`overlay`=2, `gamepad`=3). — [A/.../50-armada-inputplumber.rules](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/share/polkit-1/rules.d/50-armada-inputplumber.rules), [A/.../inputplumber-intercept](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/inputplumber-intercept)

**Flatpak termination** (source code)
- `flatpak kill` sends `kill(pid, SIGKILL)` to the instance's child PID. — [flatpak app/flatpak-builtins-kill.c](https://github.com/flatpak/flatpak/blob/f2df7b090b69487f812f4ea389edffca0f5a4610/app/flatpak-builtins-kill.c)
- `flatpak ps --columns=instance,pid,child-pid,application` exposes `pid` ("PID of the wrapper process") and `child-pid` ("PID of the sandbox process"). — [flatpak-builtins-ps.c](https://github.com/flatpak/flatpak/blob/f2df7b090b69487f812f4ea389edffca0f5a4610/app/flatpak-builtins-ps.c)
- Fix for CVE-2026-97029, in flatpak before 1.18.4: "places each bubblewrap child process in its own process group". (advisory, via search summary) — [Wiz CVE-2026-97029](https://www.wiz.io/vulnerability-database/cve/cve-2026-97029)

### Inferences
- **Recommended design for Armada.** Run a hotkey thread inside the launcher, active only while an emulator child is running. This needs no root, since `armada` is in the `input` group.
  1. **Primary input: poll EVIOCGKEY.** Use the `EVIOCGKEY` ioctl directly, for example via python-evdev `device.active_keys()` or a C/Rust ioctl, not `evtest`. Poll every 50 to 100 ms on every `/dev/input/event*` whose capability bitmap contains `BTN_SELECT` (314) and `BTN_START` (315). This works through InputPlumber's grab and doesn't depend on which virtual target the user picked.
  2. **Fire on hold.** Trigger only when the chord is held for about 1 to 1.5 s. Hold-to-quit avoids collisions with in-game Select+Start, such as RetroArch's own double-press quit or PS1 game resets.
  3. **Terminate.** For an AppImage or native emulator, send SIGTERM once to the emulator PID (or its own process group, if you `setsid` it), wait 5 s, then SIGKILL. For a flatpak, launch it, find its instance with `flatpak ps --columns=pid,child-pid,application` (the instance whose `pid` is your `flatpak run` child), send SIGTERM to `child-pid` once, and after 5 s use `flatpak kill <instance>` (SIGKILL). Don't rely on process-group kills for flatpaks, because the CVE-2026-97029 fix moves the sandboxed app into its own process group.
  4. **Never signal the launcher's own Steam scope** (`app-steam-app<id>-*.scope`). That would kill the launcher.
- **Graceful-exit alternatives.**
  - RetroArch: send its network command `QUIT`, which needs `network_cmd_enable`.
  - Keyboard route: a Steam Input chord bound to a keystroke (RetroDECK-style Ctrl+Q), which works because all emulators share the launcher's appID and layout (Q3). It needs each emulator's quit binding configured.
  - PPSSPP: launch with `--escape-exit` so Esc quits.
- **Avoid InputPlumber `SetInterceptActivation`.** It is polkit-gated, and changing intercept state could collide with Armada's own overlay and QAM use of intercept modes.
- **Reading Steam Input's virtual pads is a fallback, not the primary path.** Their visibility to non-focused apps is untested.

### Gaps
- I found no reliable source for ArkOS's implementation. ArkOS likely uses gptokeyb's predecessor, `oga_controls`, but that is unverified.
- I did not confirm on device whether the `deck-uhid` target exposes an evdev node, nor whether Steam grabs InputPlumber's virtual evdev targets.
- I did not verify, per emulator, that SIGTERM flushes memory cards and SRAM for DuckStation, ARMSX2, Dolphin, PPSSPP, Flycast and melonDS. ROCKNIX's comment implies RetroArch saves on one SIGTERM.

---

## Q6. How should emulators be launched (ES-DE data reuse, CLI flags), and where are the save files for each emulator?

### Takeaway
Use ES-DE's `linuxarm` `es_systems.xml` and `es_find_rules.xml` as the base launch data. Overlay Armada's `~/ES-DE/custom_systems/` files on top, since entries there replace bundled systems and rules with the same name. Then append fullscreen and exit-on-close flags per emulator. All flags below were checked against current emulator source.

### Cited Findings

**ES-DE data** (source code)
- ES-DE has a dedicated `resources/systems/linuxarm/` directory containing `es_systems.xml` (195 systems at `a8cf738d`), `es_find_rules.xml` and `es_import_rules.xml`. — [ES-DE linuxarm es_systems.xml](https://gitlab.com/es-de/emulationstation-de/-/blob/a8cf738d6805180e07abb82403511254c5433826/resources/systems/linuxarm/es_systems.xml)
- ES-DE 3.5.0 (2026-09-30) "(Linux ARM) Added ARMSX2 standalone as an alternative emulator for the ps2 system", plus Vita3K and Cemu systems, the pkgforge Dolphin AppImage, and a new `~/AppImages/` search path. (docs) — [ES-DE CHANGELOG](https://gitlab.com/es-de/emulationstation-de/-/blob/a8cf738d6805180e07abb82403511254c5433826/CHANGELOG.md)
- Example linuxarm commands:
  - psx: `%EMULATOR_DUCKSTATION% -batch %ROM%`
  - ps2: `%EMULATOR_ARMSX2% %ROM%`
  - gc/wii: `%INJECT%=%BASENAME%.esprefix %EMULATOR_DOLPHIN% -b -e %ROM%`
  - psp: `%EMULATOR_PPSSPP% %ROM%`
  - dreamcast: `%EMULATOR_FLYCAST% %ROM%`
  - nds: `%EMULATOR_MELONDS% -f %ROM%`
  - RetroArch cores: `%EMULATOR_RETROARCH% -L %CORE_RETROARCH%/<core>_libretro.so %ROM%`
  - Source: ES-DE linuxarm es_systems.xml (above)
- Example find rules: — [ES-DE linuxarm es_find_rules.xml](https://gitlab.com/es-de/emulationstation-de/-/blob/a8cf738d6805180e07abb82403511254c5433826/resources/systems/linuxarm/es_find_rules.xml)
  - RETROARCH: systempath `retroarch`, `org.libretro.RetroArch`; staticpath `/var/lib/flatpak/exports/bin/org.libretro.RetroArch`. The core path for the flatpak is `~/.var/app/org.libretro.RetroArch/config/retroarch/cores`.
  - DUCKSTATION: `~/Applications/DuckStation*.AppImage`.
  - ARMSX2: `armsx2-qt`, `armsx2`, `~/Applications/ARMSX2*.AppImage`.
  - DOLPHIN: `/var/lib/flatpak/exports/bin/org.DolphinEmu.dolphin-emu`, among others.
  - PPSSPP and FLYCAST: flatpak exports.
  - MELONDS: `~/Applications/melonDS*.AppImage` and the flatpak export.
- Armada's ES-DE templates are seeded into `~/ES-DE/custom_systems/` on install by the `es-de-custom-systems` handler, without overwriting user edits.
  - The comments say "A system here REPLACES the bundled one" and "An entry here REPLACES the bundled rule of the same name".
  - They add pico8, ps2 (ARMSX2 first, then LRPS2), psvita, scummvm, wiiu and xbox360 systems, plus rules for ARMSX2, BIGPEMU, CEMU, PICO-8_64, VITA3K and XENIAEDGE.
  - The code comment "ES-DE has no ARMSX2 entry at all" predates ES-DE 3.5.0's addition.
  - Sources: [A/decky/armada-store/templates/es-de/es_systems.xml](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/templates/es-de/es_systems.xml), [es_find_rules.xml](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/templates/es-de/es_find_rules.xml), [postinstall.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/postinstall.py)
- Armada docs give the ES-DE config folder as `/var/home/armada/ES-DE` and custom files as `/var/home/armada/ES-DE/custom_systems/`. They state "Armada does not provide any pre-configuration of emulators outside of some basic fixes." (docs) — [armadaos.dev ES-DE](https://armadaos.dev/emulation/es-de/)
- Every catalog flatpak gets `flatpak override --system <ref> --filesystem=/var/home/armada --filesystem=/home/armada --filesystem=/run/media --filesystem=/media`, with the comment "Persistent rather than a `flatpak run` argument: ES-DE launches the flatpak export directly". ROMs on the SD card at `/run/media/armada/...` are therefore readable by flatpak emulators. (source code) — [A/.../installers.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/installers.py)
- For RetroArch, Armada seeds `core_updater_buildbot_cores_url = "https://buildbot.libretro.com/nightly/linux/aarch64/latest/"`, because the Flathub build's aarch64 default is empty. (source code) — [A/.../postinstall.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/postinstall.py)

**CLI flags, verified in source**

| Emulator | Package on this device | Flags (verified) | Source |
|---|---|---|---|
| DuckStation | AppImage `~/Applications/DuckStation.AppImage` (catalog asset `DuckStation-arm64.AppImage`) | `-batch` "exits after powering off"; `-fullscreen`; `-nogui` "Disables main window from being shown, exits on shutdown"; `-bigpicture`; `-resume`; `-state <i>`; `-statefile <f>`; `--` before the filename | [duckstation qthost.cpp](https://github.com/stenzek/duckstation/blob/df8059758b11e1b6b320dbd84dad38afba307e40/src/duckstation-qt/qthost.cpp) |
| PCSX2 / ARMSX2 | ARMSX2 AppImage (catalog asset `*Linux-arm64-4K-pages.AppImage`) | `-batch` "exits after shutting down"; `-nogui` "Hides main window while running (implies batch mode)"; `-fullscreen`; `-bigpicture`; `-statefile`; `-elf`; `-disc`; `--` | [pcsx2 QtHost.cpp](https://github.com/PCSX2/pcsx2/blob/a9bd239ff971debe318c29e5a6895e6eb7d799e4/pcsx2-qt/QtHost.cpp), [ARMSX2 QtHost.cpp](https://github.com/ARMSX2/ARMSX2/blob/b1f3196b9ea6aa4e89907b02dffd63b784d13ed2/pcsx2-qt/QtHost.cpp) |
| Dolphin | flatpak `org.DolphinEmu.dolphin-emu` | `-e/--exec <file>`; `-b/--batch` "Run Dolphin without the user interface (Requires --exec or --nand-title)"; `-C/--config` sets a config option; `-s/--save_state`; `-u/--user` | [Dolphin CommandLineParse.cpp](https://github.com/dolphin-emu/dolphin/blob/e6f3ae17627e4344da95b13424af5baf4c892b08/Source/Core/UICommon/CommandLineParse.cpp) |
| PPSSPP | flatpak `org.ppsspp.PPSSPP` | `--fullscreen`; `--windowed`; `--escape-exit` "Escape key exits the application"; `--pause-menu-exit` "Change 'Exit to menu' in pause menu to 'Exit'"; `--state=<file>` | [PPSSPP Core/CmdLine.cpp](https://github.com/hrydgard/ppsspp/blob/13c1773bc24e97a2ca7bd4362b12b8859a6f71a3/Core/CmdLine.cpp) |
| Flycast | flatpak `org.flycast.Flycast` | Positional content path; `-config section:key=value,...` (transient). When started from the command line, the menu button reads "Exit" and `gui_stop_game` calls `dc_exit()`, so it exits on close. | [flycast cfg/cl.cpp](https://github.com/flyinghead/flycast/blob/0d9853df9a917eba2f7a84158bd1c3bccb8933e8/core/cfg/cl.cpp), [flycast ui/gui.cpp](https://github.com/flyinghead/flycast/blob/0d9853df9a917eba2f7a84158bd1c3bccb8933e8/core/ui/gui.cpp) |
| RetroArch | flatpak `org.libretro.RetroArch` | `-L <core>`; `-f/--fullscreen`; `--appendconfig=FILE`. Setting `quit_on_close_content` = DISABLED (default) / ENABLED / CLI; CLI quits on Close Content only when launched from the CLI (`should_quit_on_close`). | [RetroArch retroarch.c](https://github.com/libretro/RetroArch/blob/e49b6298550105a9c6c0000227808199b8ab9e77/retroarch.c), [config.def.h](https://github.com/libretro/RetroArch/blob/e49b6298550105a9c6c0000227808199b8ab9e77/config.def.h), [menu_defines.h](https://github.com/libretro/RetroArch/blob/e49b6298550105a9c6c0000227808199b8ab9e77/menu/menu_defines.h) |
| melonDS | AppImage `~/Applications/melonDS.AppImage` (catalog: `virtudude/melonDS` `drm-leasing` build; conflicts with the flatpak) | ES-DE uses `-f %ROM%` | ES-DE linuxarm es_systems.xml (above) |

**Save and state locations**

These are all under `/var/home/armada`.

- DuckStation AppImage: BIOS in `~/.local/share/duckstation/bios`, memory cards in `~/.local/share/duckstation/memcards`. (Verified by the user this session from armadaos.dev.)
- ARMSX2 AppImage: `~/.config/ARMSX2/{bios,memcards,sstates}`, config in `inis/PCSX2.ini`. (Verified by the user this session.)
- Dolphin flatpak (docs) — [armadaos.dev Dolphin](https://armadaos.dev/emulation/emulators/dolphin-gc/)
  - GC saves: `~/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu/GC`
  - Wii saves: `.../data/dolphin-emu/Wii/title`
  - States: `.../data/dolphin-emu/StateSaves`
  - Config: `~/.var/app/org.DolphinEmu.dolphin-emu/config/dolphin-emu/Dolphin.ini`
- PPSSPP flatpak (docs) — [armadaos.dev PPSSPP](https://armadaos.dev/emulation/emulators/ppsspp/)
  - Saves: `~/.var/app/org.ppsspp.PPSSPP/config/ppsspp/PSP/SAVEDATA`
  - States: `.../PSP/PPSSPP_STATE`
  - Config: `.../PSP/SYSTEM/ppsspp.ini`
- RetroArch flatpak (docs) — [armadaos.dev RetroArch](https://armadaos.dev/emulation/emulators/retroarch/)
  - Saves: `~/.var/app/org.libretro.RetroArch/config/retroarch/saves`
  - States: `.../states`
  - BIOS: `.../system`
  - Config: `.../retroarch.cfg`
- Flycast flatpak: `~/.var/app/org.flycast.Flycast/data/flycast`. (Verified by the user this session.)
- melonDS: armadaos.dev lists flatpak paths, with saves, states and config all in `~/.var/app/net.kuribo64.melonDS/config/melonDS` — [armadaos.dev melonDS](https://armadaos.dev/emulation/emulators/melonds/). That contradicts the Armada catalog and this device, which use the AppImage with config seeded to `~/.config/melonDS/melonDS.toml` — [A/decky/armada-store/catalog.json](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/catalog.json). Armada's template sets `SaveFilePath = ""` and `SavestatePath = ""` — [A/.../templates/melonds/melonDS.toml](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/templates/melonds/melonDS.toml).

### Inferences
- **Suggested launch commands** (exe resolution comes from find rules):
  - DuckStation: `DuckStation.AppImage -batch -fullscreen -nogui -- <rom>` (consider `-bigpicture` for controller-friendly menus).
  - ARMSX2: `ARMSX2.AppImage -batch -fullscreen -nogui -- <iso>`.
  - Dolphin: `flatpak run org.DolphinEmu.dolphin-emu -b -C Dolphin.Display.Fullscreen=True -e <rom>`. The exact `-C` key is unverified.
  - PPSSPP: `flatpak run org.ppsspp.PPSSPP --fullscreen --pause-menu-exit <rom>`.
  - Flycast: `flatpak run org.flycast.Flycast <rom>`.
  - RetroArch: `flatpak run org.libretro.RetroArch -f -L ~/.var/app/org.libretro.RetroArch/config/retroarch/cores/<core>_libretro.so <rom>`, with `quit_on_close_content = "2"` (CLI) set through `--appendconfig`.
  - melonDS: `melonDS.AppImage -f <rom>`.
- **Prefer find rules at runtime.** Implement an ES-DE `es_find_rules` resolver: systempath (PATH lookup), staticpath (`~` and glob expansion), corepath. Resolve against the live filesystem instead of hardcoding paths, because emulators can be either an AppImage or a flatpak (catalog `conflicts` entries show Armada expects either).
- **Where to read the bundled XML.** Either extract it from the installed ES-DE AppImage (`ES-DE.AppImage --appimage-extract 'usr/share/es-de/resources/systems/linuxarm/*'`, path unverified) or vendor a pinned copy from ES-DE's GitLab. Custom systems override by `<name>`.
- **ROM location.** ES-DE's ROM directory setting lives in `~/ES-DE/settings/es_settings.xml` (`ROMDirectory`; file name unverified). The user's ROMs may be on `/run/media/armada/NovaSD/...`.
- **melonDS saves.** With an empty `SaveFilePath`, melonDS writes `.sav` next to the ROM. Save sync must handle ROM-adjacent saves on the SD card. This is inferred from melonDS behavior and not verified.
- **Clean up the child environment.** Before spawning emulators, sanitize what the Steam shortcut passes down: reset PATH (as `armada-game-launch` does for AppImages) and consider dropping Steam runtime `LD_LIBRARY_PATH` entries. `launch-steam` puts `steamrtarm64` on `LD_LIBRARY_PATH`. ES-DE works as-is, so this is defensive, not mandatory.

### Gaps
- Not verified:
  - DuckStation's savestate path.
  - Flycast's VMU file names.
  - Whether `-nogui` interacts badly with gamescope focus. ROCKNIX uses it successfully under sway.
  - Dolphin's exact fullscreen config key for `-C`.
  - The internal path of the linuxarm XML inside `ES-DE_aarch64.AppImage`.

---

## Q7. How should the app be packaged and distributed on armadaOS (AppImage vs Flatpak, bootc, Armada Store catalog, self-update)?

### Takeaway
Ship an aarch64 AppImage installed to `~/Applications`.
- It survives bootc OS updates, has the host access a launcher needs, and matches how Armada installs ES-DE and most emulators.
- Flatpak is a poor fit. A launcher needs `flatpak-spawn --host` (`org.freedesktop.Flatpak`), broad filesystem access and `/dev/input`. Flathub rejects "thin wrapper or launcher around other tools" apps and has a generative-AI policy that conflicts with autonomous AI development.
- The Armada Store catalog is a static JSON bundled in the OS image, so adding the app means a PR to armada-os/armada.

### Cited Findings

**bootc filesystem rules** (docs) — [bootc-filesystem(7)](https://bootc.dev/bootc/bootc-filesystem.7.html)
- With composefs, `/usr` and `/` are an immutable read-only image.
- "The `/etc` directory contains mutable persistent state by default", with an OSTree 3-way merge on upgrade.
- "Content in `/var` persists by default", but image content in `/var` is "unpacked _only from the initial image_".
- `/opt` is read-only under the suggested composefs config.
- On Armada the user home is `/var/home/armada`. — [A/.../armada-user.conf](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/sysusers.d/armada-user.conf)

**How the Armada Store catalog works** (source code)
- `catalog.all_apps()` returns only `bundled_apps()`, read from the plugin's own `catalog.json`. There is no remote or community catalog. — [A/.../catalog.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/catalog.py)
- The catalog JSON is copied into the image at `/usr/share/decky-plugins/armada-store` during the build, and `armada-decky-sync` copies it to `~/homebrew/plugins` on boot. — [A/build_files/45-install-decky-plugins.sh](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/build_files/45-install-decky-plugins.sh)
- Entry schema: — [A/decky/armada-store/catalog.json](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/catalog.json), [A/tests/armada-store-test.sh](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/tests/armada-store-test.sh)
  - Fields: `id`, `name`, `summary`, `category` (`emulators`, `applications` or `plugins`), `icon`, optional `note`, `desktopOnly`, `controllerTemplate`, `postInstall` and `config` (`templates` plus `dest`), and `conflicts`.
  - `install.type` is one of `flatpak` (`ref`), `appimage` (`releases` API URL, `asset` regex, `filename`), `deckyplugin` (`releases` plus `asset` regex) or `system` (`exec`, `launchOptions`).
  - The tests assert these kinds.
  - ES-DE's entry is `{"type":"appimage","releases":"https://gitlab.com/api/v4/projects/es-de%2Femulationstation-de/releases?per_page=10","asset":"^ES-DE_aarch64\\.AppImage$","filename":"ES-DE.AppImage"}` with `"postInstall":"es-de-custom-systems"`.
- AppImage install and release resolution: — [A/.../installers.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/installers.py)
  - Resolves the newest matching asset across GitHub, GitLab or Forgejo release JSON, skipping prereleases unless nothing else exists.
  - Downloads over HTTPS only ("Refusing non-HTTPS download URL") to a staging file with mode 0755, then renames it into `~/Applications/<filename>`.
  - Writes `~/.local/share/applications/armada-<id>.desktop` and an icon.
- Updates: an hourly check (TTL 3600 s) compares the recorded release tag, or the asset `updated_at` stamp ("A mutable tag like 'nightly' never changes, so the release date is the only signal"), and shows "Update Available". — [A/.../updates.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/updates.py)
- Contribution route: the repo has only bug-report and feature-request issue templates (`.github/ISSUE_TEMPLATE`); the README says "Issues and pull requests are welcome." (source code) — [A/README.md](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/README.md)

**Flatpak and Flathub constraints**
- Flathub requirements (docs, live page) — [Flathub requirements](https://docs.flathub.org/docs/for-app-authors/requirements)
  - An app that "exists as a thin wrapper or launcher around other tools will not be accepted".
  - "Static permissions must be kept to an absolute minimum."
  - "Flathub builds on both `x86_64` and `aarch64` by default."
  - Generative AI: "Flathub manifests must not contain AI-generated or AI-assisted content"; "AI tools or agents must not open or automate Flathub submission pull requests".
- GamingOnLinux reported on 2026-05-29 a broader rule, "Applications containing AI-generated or AI-assisted code ... are not allowed", with exceptions possible "for mature, well-maintained projects". The live page I fetched today words the rule around manifests and PRs, so it may have been narrowed or the article summarizes an earlier draft. (news) — [GamingOnLinux](https://www.gamingonlinux.com/2026/05/flathub-moves-to-ban-nearly-all-apps-and-submissions-made-with-generative-ai/)
- `flatpak-spawn --host` "requires access to the org.freedesktop.Flatpak D-Bus interface", which lets an app run arbitrary commands on the host. (docs) — [flatpak-spawn(1)](https://man7.org/linux/man-pages/man1/flatpak-spawn.1.html)

**Self-update** (docs) — [AppImage docs: updates](https://docs.appimage.org/packaging-guide/optional/updates.html)
- Embed update information with `appimagetool -u "<update info>"`, which also generates a `.zsync` file to upload.
- Users can update with AppImageUpdate or `appimageupdatetool`.
- Apps can link `libappimageupdate` (`appimage::update::Updater`). In overwrite mode it keeps a `.zs-old` backup.
- The documented example format is `zsync|URL`; other formats such as `gh-releases-zsync|...` are in the AppImage spec.

### Inferences
- **Packaging.**
  - Ship `RommLauncher-aarch64.AppImage`, using a stable filename and an install path of `~/Applications/`.
  - Publish GitHub Releases with a regex-friendly asset name so it can be added to the Armada catalog as `{"type":"appimage","releases":"https://api.github.com/repos/<you>/<repo>/releases?per_page=10","asset":"^RommLauncher-aarch64\\.AppImage$","filename":"RommLauncher.AppImage"}` with category `applications`.
  - Armada Store would then handle install, the update badge and one-tap "Add to Steam" with the `armada-game-launch` wrapper.
- **Self-update without fighting Armada Store.** If the app gets into the catalog, prefer to let Armada Store own updates. Otherwise, implement a GitHub Releases check that mirrors Armada's `resolve_release_asset` (tag plus asset `updated_at`), download to a temp file, verify a checksum, swap in place atomically, and restart. Embedding `gh-releases-zsync` update info as well allows delta updates via AppImageUpdate. Self-updating an AppImage that Armada Store also tracks will desync Armada's recorded tag, which only causes a stale "Update Available" badge.
- **Never touch `/usr` or `/etc`.** Nothing should be needed there. The `input` group membership already covers `/dev/input`.
- **AppImage runtime.** Avoid relying on FUSE behavior differences. Armada already sets `FUSERMOUNT_PROG=/run/host/usr/bin/fusermount3` for Steam, and ES-DE runs fine as an AppImage from Game Mode. Static-runtime (type-2, no libfuse2) AppImages are the safest choice.
- **AI-developed code and distribution.** Because development is autonomous and AI-driven, plan on GitHub Releases plus the Armada catalog, not Flathub.

### Gaps
- I found no documented Armada policy on accepting community or third-party apps into the catalog. Ask in the Armada Discord or open a feature request before a PR.
- No `CONTRIBUTING` file exists in the repo.

---

## Q8. Would a small companion Decky plugin add value, and how are Decky plugins packaged?

### Takeaway
Yes. A small, non-root Decky plugin is the only sanctioned way to call Steam client APIs from inside Game Mode. It could:
- Add the launcher as a Steam shortcut with the right controller template.
- Optionally auto-launch it at boot.
- Show download and sync status, plus quick actions, in the Quick Access Menu.

Package it as a standard Decky zip. It can be distributed through the Decky store, as a manual zip, or as an Armada catalog `deckyplugin` entry. The plugin must degrade gracefully, because Decky is known to break after Steam client updates on Armada.

### Cited Findings

**Decky on Armada**
- Decky Loader comes from the latest `SteamDeckHomebrew/decky-loader` release at image build time, seeded from `/usr/share/decky-loader/PluginLoader`, and run by `plugin_loader.service` with `HOMEBREW_FOLDER=/var/home/armada/homebrew`. New installs default to the prerelease branch: `{"branch": 1}` in `~/homebrew/settings/loader.json`, "for current Steam-on-ARM fixes". (source code) — [A/build_files/45-install-decky-plugins.sh](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/build_files/45-install-decky-plugins.sh), [A/.../armada-decky-sync](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/decky-loader/armada-decky-sync)
- `armada-decky-sync` runs `rm -rf` and re-copies only the plugins shipped in `/usr/share/decky-plugins/*` (Armada Control and Armada Store) on each boot. Third-party plugins in `~/homebrew/plugins` are left alone. (source code) — same file
- Armada Store's `plugin.json` is `{"name":"Armada Store","author":"Armada","flags":["root"],"api_version":1}`, built with `@decky/api` 1.1.3, `@decky/ui` 4.11.6 and `@decky/rollup` 1.0.2. (source code) — [A/decky/armada-store/plugin.json](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/plugin.json), [package.json](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/package.json)
- The Armada catalog already installs third-party Decky plugins from GitHub release zips: `decky-lsfg-vk` and `optiscaler`, with `install.type: "deckyplugin"`. They are extracted into `~/homebrew/plugins/<dir>`, and Decky is restarted. (source code) — [A/.../catalog.json](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/catalog.json), [installers.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/installers.py)
- Known issue: "Decky plugins break after Steam Client updates". The workaround is to reload Decky or switch Steam to the Stable client channel. (docs) — [armadaos.dev Known issues](https://armadaos.dev/troubleshooting/known-issues/)

**Decky plugin runtime** (source code) — [decky-loader sandboxed_plugin.py](https://github.com/SteamDeckHomebrew/decky-loader/blob/75563316f9119ee7e36be7f43885be65e877fad0/backend/decky_loader/plugin/sandboxed_plugin.py)
- The backend runs as root only if `"root"` is in `flags`. Otherwise it drops to the host user.
- The environment gets `HOME`, `USER`, `DECKY_USER`, `DECKY_HOME` (the homebrew dir), `DECKY_PLUGIN_SETTINGS_DIR`, `DECKY_PLUGIN_RUNTIME_DIR` and `DECKY_PLUGIN_LOG_DIR`.

**Packaging** (docs) — [decky-plugin-template README](https://github.com/SteamDeckHomebrew/decky-plugin-template)
- Distribution zip layout: `pluginname/` containing `dist/index.js` (required), `package.json` (required), `plugin.json` (required), `main.py` (required if using the Python backend), optional `bin/` and `README.md`, and a LICENSE (required for the store).
- Build with `pnpm i` and `pnpm run build`.
- Store submission goes through the decky-plugin-database repo.

### Inferences
- **Suggested plugin scope.** Non-root, `flags: []`, frontend mostly. Use cases:
  1. "Add RomM Launcher to Steam" via `SteamClient.Apps.AddShortcut`, with name, exe `~/Applications/RommLauncher.AppImage` and options `armada-game-launch %command%`, plus a gamepad controller template. Reuse Armada's `selectControllerTemplate` logic.
  2. An optional "Launch on boot" that calls `SteamClient.Apps.RunGame(gameid, "", -1, 100)` once per boot.
  3. A QAM panel showing download queue, progress and sync status. It would read from the launcher through a localhost HTTP or UNIX socket served by the launcher, or a status JSON in `$XDG_RUNTIME_DIR`.
  4. A "Quit emulator" button that asks the launcher to run its graceful-terminate path. This is a useful backup to the chord hotkey.
- **The launcher must not depend on the plugin.** Everything should still work if Decky is broken after a Steam update.
- **Distribution.** Ship the plugin zip in the same GitHub release, and either submit it to decky-plugin-database or request an Armada catalog `deckyplugin` entry.

### Gaps
- I did not retrieve full deckbrew.xyz docs for `api_version` semantics or the current store review policy; the wiki page fetched empty.
- The `SteamClient.Apps.*` APIs are undocumented internals.

---

## Q9. Do downloads survive suspend, and how does Armada's sleep behave (s2idle)?

### Takeaway
Downloads do not run during sleep in either of Armada's modes.
- In s2idle (the default) and in fake suspend alike, the launcher's processes are frozen.
- In s2idle, NetworkManager also tears down Wi-Fi, so open HTTP connections will usually be dead on resume.
- In fake suspend, Wi-Fi stays associated, but the process is still frozen.

So the downloader must be resumable (HTTP Range on `.part` files), must checkpoint on PrepareForSleep, and must wait for connectivity after resume.

### Cited Findings

**Which mode a device uses** (source code)
- `ARMADA_SUSPEND_MODE=s2idle` is the default in `devices/defaults.conf`, with "s2idle or fake" as the options. `device-env` falls back to `fake` if `/sys/power/mem_sleep` lacks s2idle. Users can save `suspend_mode=fake|s2idle` in `/etc/armada/sleep.conf` through Armada Control. — [A/.../devices/defaults.conf](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/armada/devices/defaults.conf), [A/.../device-env](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/device-env), [A/.../device-quirks](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/device-quirks)

**s2idle path** (source code and docs)
- `suspend-dispatch` writes `s2idle` to `/sys/power/mem_sleep` and execs `systemd-sleep suspend`, "so its sleep hooks and process freeze run". (source code) — [A/.../suspend-dispatch](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/suspend-dispatch)
- systemd's suspend services "freeze user.slice while they run", preventing "execution of any process in any of the user sessions while the system is entering into and resuming from sleep". Apps that need to react should use inhibitor locks. (docs) — [systemd-sleep(8)](https://www.man7.org/linux/man-pages/man8/systemd-sleep.8.html)
- When the mode is not `fake`, `device-quirks` removes `/etc/NetworkManager/ignore-sleep` ("real suspend needs NM to drop and reconnect"). Armada's patched NetworkManager keeps devices active across suspend only when that flag exists. (source code) — [A/.../device-quirks](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/device-quirks), [A/packages/networkmanager/patches/0001-armada-keep-devices-active-on-suspend.patch](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/packages/networkmanager/patches/0001-armada-keep-devices-active-on-suspend.patch)

**Fake-suspend path** (source code) — [A/.../fake-suspend](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/fake-suspend)
- The script's header says "Real suspend hangs this SoC."
- It mutes audio, blocks input, and turns the display off via `gamescopectl drm_sleep_internal_screen 1`.
- It freezes the user manager's `app.slice` through `cgroup.freeze`, falling back to SIGSTOP of session processes.
- Radio suspend is commented out: "Radio suspend disabled until we can improve resume speed (currently takes 30+ seconds)".
- It blocks until the power key, lid-open or a wake flag.

**Docs and known issues** (docs)
- S2idle sleep "has been implemented in ArmadaOS but is currently a work-in-progress". Power draw is "higher-than-ideal, though lower than 'fake sleep'". — [armadaos.dev Sleep, Shutdown and Battery](https://armadaos.dev/using-armada/sleep-shutdown-and-battery/)
- A "Resuming" window can freeze controls after wake; it "usually clears by itself shortly after the device reconnects to the internet". On the Retroid Pocket Nova there is a white flash on sleep and boot, on s2idle only. — [armadaos.dev Known issues](https://armadaos.dev/troubleshooting/known-issues/)

**Power key handling** (source code)
- Armada's `armada-powerbuttond` user service holds a `systemd-inhibit --what=handle-power-key:handle-suspend-key:handle-lid-switch --mode=block` lock ("Steam Game Mode handles power events"). — [A/.../armada-powerbuttond.service](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/systemd/user/armada-powerbuttond.service)

### Inferences
- **The launcher is frozen in both modes.** Steam-launched shortcuts run in `app-steam-app<id>-<pid>.scope` under the user manager's `app.slice`, which is inferred from the scope naming that gamescope parses. That makes the launcher subject to both the systemd-sleep `user.slice` freeze and fake-suspend's `app.slice` freeze.
- **Downloader recipe.**
  - Stream to `<file>.part` and persist the byte offset and ETag.
  - On resume, re-request with `Range: bytes=<offset>-` and `If-Range`, then verify size and hash before renaming.
  - Subscribe to logind `PrepareForSleep(true)` with a delay inhibitor only (`--mode=delay`, never `block`, so Steam's suspend isn't held up), so the launcher can flush state and close sockets cleanly.
  - On `PrepareForSleep(false)`, wait for NetworkManager `Connectivity == FULL` over D-Bus before retrying with backoff.
  - Under fake suspend the old TCP socket may occasionally survive a short sleep, but don't rely on it.
- **Defer save-sync uploads until connectivity returns.** This also avoids the "Resuming" control-freeze window.

### Gaps
- I did not determine which suspend mode the user's specific device runs. Check `/usr/libexec/armada/device-env` output or Armada Control. The SD label "NovaSD" hints at a Retroid Pocket Nova, whose device file uses the default s2idle, but that is unconfirmed.
- Whether the RomM server supports HTTP Range for ROM downloads is outside this scope.
