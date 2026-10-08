> Copied from the research report that chose the route. Links to `~/Documents/argosy-fork/...` point at the tester's private local Argosy fork, which is not in this repository; the parts that matter are extracted in [argosy-fork-design-spec.md](argosy-fork-design-spec.md).

# Fork RomMix, then let the Nova decide

The fastest, easiest and most flexible route is to **hard-fork RomMix**, an MIT-licensed Electron/React/TypeScript RomM frontend. It already ships arm64 AppImages, runs as a non-Steam game under gamescope, and handles device pairing, on-demand downloads with an in-app queue and progress, two-way save and state sync, BIOS, multi-disc games, offline mode and a hold-Start exit. Run it as a single Steam shortcut inside armadaOS's Game Mode instead of replacing Steam. What RomMix lacks is the Armada-specific layer: descriptors for the Armada Store's standalone emulators, a Steam-library provider, a Select+Start exit that reads key state through InputPlumber's grab, and the Argosy fork's 4:3 design language. The riskiest gap by far is a save engine proven to round-trip with Argosy on Android through the tester's RomM 5.2.0 server, which cannot scope negotiation to one game and does not advertise the Sigil save path Argosy uses on newer servers. Commit only after a two-step decision gate. First, the tester spends about an hour running unmodified RomMix on the Nova, with no agent code at all. Second, the tester judges a week-one fork build. If Chromium on Turnip can't feel smoother than Steam's own Chromium-based UI, or focus and input break under gamescope, switch to a greenfield Godot 4.7 app that uses RomMix, Grout and Argosy as specifications. Every other candidate has a hard blocker: ES-DE has no UI API and refuses C++ collaboration, OpenGamepadUI has no RomM plugin and expects to own the gamescope session, Tender requires x86_64-only RetroDECK, Ludo ships only for x86_64, Pegasus is stuck on Qt5, and Grout doesn't launch games. The cloud agent can build nearly all of this without the device, since RomM runs in Docker inside its x86_64 VM and free `ubuntu-24.04-arm` runners build the AppImage. It cannot push tags, use GitHub GraphQL, reach the LAN server or see the screen, so the repo must carry its own proof and the tester's job comes down to scripted checks on hardware.

## RomMix already runs most of the loop, and every rival hits a hard blocker

RomMix (leclercb/rommix) was not on the original candidate list, yet it is the closest existing match to "Argosy for Linux." It is **MIT-licensed TypeScript on Electron 44, React 19 and Vite 7**, created on 2026-08-17. v0.20.0 shipped on 2026-09-30 with `RomMix-arm64.AppImage`, `RomMix-x86_64.AppImage` and `rommix-steam.sh` as assets ([releases](https://github.com/leclercb/rommix/releases); [package.json](https://github.com/leclercb/rommix/blob/main/package.json)). CI builds arm64 natively on GitHub's `ubuntu-24.04-arm` runners ([release.yml](https://github.com/leclercb/rommix/blob/main/.github/workflows/release.yml)). It requires only RomM 5.0.0 (`MINIMUM_SERVER_VERSION = '5.0.0'`), so the tester's 5.2.0 server needs no upgrade ([version.ts](https://github.com/leclercb/rommix/blob/main/src/main/romm/version.ts)).

It is unusually friendly to an autonomous agent:

- **Emulators are data, not code.** Each one is a compiler-checked descriptor under `src/config/emulators/` with an install kind of `flatpak`, `appimage`, `binary` or `scripts`, and the project rule is "No code outside `src/config/` names an emulator."
- **The UI runs without a device.** `npm run preview:app` runs the interface in a browser against a stub library.
- **The whole app is tested without a server.** `npm run test:app` drives the built app against a fake RomM, and CI enforces a **96% line-coverage floor** ([CONTRIBUTING.md](https://github.com/leclercb/rommix/blob/main/CONTRIBUTING.md)).
- **It is already large.** The codebase holds about **48.4k lines of source and 18.9k lines of unit tests** ([source tarball](https://codeload.github.com/leclercb/rommix/tar.gz/refs/heads/main)).

Against the tester's own requirement list, RomMix already covers the expensive middle of the product:

| Tester requirement | RomMix today | Fork work needed |
|---|---|---|
| Browse the whole 2.1 TB, 4,206-game library and download on demand | Browse and search by platform. Downloads go into emulator folders, with pause/resume and a RomM hash check ([README](https://github.com/leclercb/rommix)) | Incremental sync. A full listing with files took about 140 s on the first run and 75 s after ([DEVICE-FACTS](../DEVICE-FACTS.md)) |
| In-app progress with percent, speed, time left and cancel | In-app queue with progress ([README](https://github.com/leclercb/rommix)) | Smoothed speed and ETA rows like the Argosy fork's "15% - 613.6 MB / 3.8 GB - 41.4 MB/S - 1M 20S LEFT" ([FORK-NOTES.md](~/Documents/argosy-fork/FORK-NOTES.md)) |
| Save sync with RomM that works with Argosy | "Saves and states synced both ways," plus a per-game sync tab ([README](https://github.com/leclercb/rommix)) | Audit the engine, and probably replace it (see the save-sync section) |
| Universal exit back to the launcher | "Back from a game: Start, held," with `SUSPENDED_HOLD_MS = 1500`, read through Chromium's Gamepad API ([gamepad.ts](https://github.com/leclercb/rommix/blob/main/src/renderer/src/input/gamepad.ts)) | Select+Start held about 1 s, via an evdev key-state watcher plus a graceful kill |
| Favorite means pre-download, and an "On device" view | Favourites saved to RomM, and an "on this device" Home shelf ([README](https://github.com/leclercb/rommix)) | Pre-download in the background when a game is favorited, and actions to free space |
| Steam games in the same UI | None. Every Steam mention concerns launching RomMix itself ([README](https://github.com/leclercb/rommix)) | A Steam library provider |
| Armada Store emulators | RetroDECK, EmuDeck, RetroArch flatpak, Eden and shadPS4 ([README](https://github.com/leclercb/rommix)) | One descriptor each for DuckStation, ARMSX2, Dolphin, PPSSPP, Flycast and melonDS |
| Smoother and more customizable than Steam's UI | Fullscreen, controller-driven, themes as files, "laid out for a 1080p television" with a Scale setting ([README](https://github.com/leclercb/rommix)) | 4:3 1280×960 layouts in the Argosy fork's visual language |

The open questions are real:

- **Maturity.** RomMix has **one contributor with 448 commits and is seven weeks old** ([contributors API](https://api.github.com/repos/leclercb/rommix/contributors)). That argues for a hard fork, which MIT permits, with generic pieces such as emulator descriptors offered back upstream.
- **Unconfirmed on this hardware.** Nobody has confirmed that RomMix renders well on Mesa Turnip at 1280×960, that its hold-Start exit works under Steam Game Mode, or how its save sync is built.

The rendering question cuts both ways. Steam's Game Mode UI is itself Chromium: Decky debugs it as a CEF tab ([Decky wiki](https://wiki.deckbrew.xyz/plugin-dev/cef-debugging)), and Armada's `launch-steam` enables that CEF debug port on this very device ([launch-steam](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/launch-steam)). So Chromium demonstrably renders under gamescope on the Nova's Adreno 740. But the tester's complaint that Steam's UI is not smooth enough warns that a web UI only wins if it stays lean ([requirements](../REQUIREMENTS-FROM-TESTER.md)). The Argosy fork learned this on the same panel. Its rule is to animate only colour, opacity and width, and never tile size or position, because reflowing a grid "will stutter on the handheld" ([CLAUDE.md L231-232](~/Documents/argosy-fork/CLAUDE.md)).

| Candidate | Stack and license | aarch64 Linux today | What it gives | Hard blocker on the Nova | Role |
|---|---|---|---|---|---|
| **RomMix** | Electron/React/TS, MIT | arm64 AppImage, built natively in CI | Most of the RomM loop, gamescope X11 fallback, fake-RomM tests | Chromium smoothness on Turnip unproven; save engine not yet audited | **Base** |
| Ludo (rommapp) | Python engine + Electron + Decky, GPL-3.0 | x86_64 AppImage only ([releases](https://github.com/rommapp/ludo/releases)) | Gamepad-first, save/state sync "on a watchdog" | RetroArch and Eden only; same Chromium risk; two-language core ([README](https://github.com/rommapp/ludo)) | Watch it; reference |
| OpenGamepadUI + a new RomM plugin | Godot 4 + Rust, GPL-3.0 | RPM, sysext and tarball since v0.45.1, July 2026 ([releases](https://github.com/ShadowBlip/OpenGamepadUI/releases)) | Official Steam plugin, `install_progressed` library API, gamescope focus code | No RomM plugin in the registry ([plugins.json](https://raw.githubusercontent.com/ShadowBlip/OpenGamepadUI-plugins/main/plugins.json)); built to own the session; "very early stages" ([README](https://github.com/ShadowBlip/OpenGamepadUI)) | Reference for gamescope code |
| Tender fork | Python Decky plugin, GPL-3.0 | Runs inside Decky | RomM as Steam shortcuts, queue with progress, pre- and post-launch save sync | Downloads need RetroDECK, which is x86_64-only; needs RomM ≥ 5.3.0; the UI is Steam's ([README](https://github.com/danielcopper/romm-tender); [Flathub](https://flathub.org/api/v2/summary/net.retrodeck.retrodeck)) | Source of shortcut-export ideas |
| ES-DE hard fork | C++/SDL/GL, MIT | Experimental aarch64 AppImage | Best polish; already on the device | "Not looking for collaborating on the C++ development" ([CONTRIBUTING](https://gitlab.com/es-de/emulationstation-de/-/blob/master/CONTRIBUTING.md)); no plugin or UI API ([DEVICE-FACTS](../DEVICE-FACTS.md)) | Data source (system and find-rule files) |
| Pegasus | Qt5/QML, GPLv3 | No generic aarch64 desktop build | QML theming, Steam import | Last tagged release 2024-10; Qt 6 port still open ([releases](https://github.com/mmatyas/pegasus-frontend/releases); [#1167](https://github.com/mmatyas/pegasus-frontend/issues/1167)) | Reject |
| Grout | Go/SDL2, MIT | ROCKNIX and Batocera arm64 packages | Hand-written RomM client, save sync, folder maps | Not a launcher; sync is manual; states are not synced ([FAQ](https://grout.romm.app/usage/faq/)) | Copyable reference code |
| Argosy ported to Compose Desktop | Kotlin, GPL-3.0 | Skiko has arm64 builds | The full feature spec | 968 of 1,571 files import Android APIs ([source tree](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy)) | Spec only |
| New app on a fresh stack | Godot 4.7 or Flutter 3.47 | Official arm64 targets | Clean architecture | Rebuilds everything RomMix already has | **Fallback** |

The strongest alternatives deserve a fair hearing:

- **ES-DE** is the most polished gamepad UI and is already installed, but its only hook is a blocking `game-start` script that receives shell-escaped paths. That is exactly why the prototype's progress UI could not live inside it ([DEVICE-FACTS](../DEVICE-FACTS.md)).
- **OpenGamepadUI** has the best Steam integration and real gamescope focus code. But Armada's own image build avoids the OGUI-plus-Steam session because "Terra's aarch64 deps are broken" ([30-install-steam-session.sh](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/build_files/30-install-steam-session.sh)). Replacing Steam as the session client would also cost QAM, Steam Input, the on-screen keyboard and Steam game launching.
- **Tender** gets Steam's library for free, but the tester wants something smoother than Steam's UI, and a fork would have to rip out RetroDECK and force a server upgrade.
- **Argosy itself** is not coming to Linux. The maintainer closed the request as "way out of scope" ([issue #183](https://github.com/rommapp/argosy-launcher/issues/183)).
- **Building new** on any stack throws away RomMix's roughly 48k lines and test harness. That is the opposite of the tester's "don't reinvent the wheel."

Licensing shapes how the fork borrows. Keeping it MIT preserves the option of upstreaming to RomMix, so the GPL projects (Argosy, Tender, OpenGamepadUI and Ludo) serve as specifications rather than code to paste. Two sources can be used directly:

- **Grout:** its MIT Go client and folder maps can be ported freely.
- **argosy-sigil:** an MPL-2.0 C library with Python and Go bindings that "reads the game-native title id out of a ROM, finds the save files an emulator keeps for that game" and archives saves "the way RomM does." It can be linked from MIT code, but it is pre-1.0, so pin a commit ([argosy-sigil](https://github.com/rommapp/argosy-sigil)).

## One device test with no new code decides the base

The cheapest decision in this project is also the most informative. RomMix already supports RetroArch as a flatpak, and the tester's RetroArch flatpak already has snes9x and mgba installed ([DEVICE-FACTS](../DEVICE-FACTS.md)). The stock release can therefore exercise the full loop of download, launch, exit and save on SNES and GBA, so Gate 0 costs no agent time. Gate 1 then tests the riskiest fork-specific pieces on hardware before the agent invests in design parity. Gate 2 is not a stack decision; it controls promotion to stable.

| Gate | When and cost | Pass if… | If it fails |
|---|---|---|---|
| **Gate 0: stock RomMix v0.20.0** | Day 1; tester only, about an hour | It runs fullscreen at 1280×960 from Game Mode with no black screen (try a plain AppImage shortcut and `rommix-steam.sh`). Pairing and listing work against 5.2.0. Scrolling the 1,003-game SNES and 1,292-game PSP grids feels at least as smooth as Steam's library. A SNES download shows progress in the app. RetroArch opens in front, holding Start returns to RomMix, and the save appears in RomM's web UI | For rendering, input or focus problems: give the agent one week of Chromium flags and UI simplification, then re-test. Pairing or API failures are fork bugs, not stack failures |
| **Gate 1: first fork build** | End of week 1–2; tester about an hour | Holding Select+Start about 1 s quits DuckStation (AppImage), Dolphin (flatpak) and RetroArch with saves intact. Focus returns every time. A Steam game launches and the launcher survives Steam's "Launch Multiple Games" prompt. An on-screen frame-time overlay shows the grid holding its frame rate | After two failed device rounds on smoothness or focus, switch to the fallback |
| **Gate 2: save interoperability** | After the save milestone | Saves made in Argosy on Android load on Linux, and the reverse, per system, with no spurious conflicts | Stay on RomMix and fix the save engine; this never triggers a stack change |

Two details matter for Gate 0:

- **How to launch it.** RomMix's README says Steam "launches games in a way that stops an AppImage mounting itself," which is why it ships `rommix-steam.sh` ([README](https://github.com/leclercb/rommix)). On Armada, though, the ES-DE AppImage already launches from Game Mode through `armada-game-launch`, which puts `/usr/bin` first on PATH for AppImages ([armada-game-launch](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/armada-game-launch)). The tester should try both forms and report which works.
- **X11 fallback.** RomMix detects gamescope's "claims Wayland but has no socket" case and falls back to X11 by itself ([README](https://github.com/leclercb/rommix)). X11 is also what Armada's focus rules favor.

If Chromium itself is the failure, the fallback must favor evidence from devices over test ergonomics, because the trigger was a device failure. That points to **Godot 4.7 on the GL Compatibility renderer, in a single fullscreen X11 window**:

- OpenGamepadUI proves a Godot launcher can ship aarch64 builds for gamescope ([releases](https://github.com/ShadowBlip/OpenGamepadUI/releases)).
- Godot 4.5+ reads desktop controllers through SDL3 ([Godot 4.5 beta 2](https://godotengine.org/article/dev-snapshot-godot-4-5-beta-2/)).
- Focus navigation is built into every Control ([Godot GUI navigation](https://docs.godotengine.org/en/stable/tutorials/ui/gui_navigation.html)).

The costs are known:

- **Training-data drift.** LLMs slip into Godot 3 syntax ([Summer Engine](https://www.summerengine.com/blog/best-ai-for-gdscript)).
- **Slow UI tests.** Godot UI tests need Xvfb and software GL and can be "VERY (i.e. unusably) slow" on CPU-only runners ([gdUnit4Net #350](https://github.com/godot-gdunit-labs/gdUnit4Net/discussions/350)).
- **License.** Copying OpenGamepadUI's gamescope modules makes the fallback GPLv3.
- **Video playback (unverified).** The Argosy fork's preview videos are ScreenScraper MP4s. Godot's built-in video player has historically handled only Ogg Theora, while Chromium plays MP4 natively, so the fallback spike must check this.

**Flutter 3.47** is the tie-breaker only if Godot also fails on the device. It has the best headless golden testing, but its Impeller/Vulkan Linux renderer only became the default on 2026-08-12, Fedora is not a listed target, and no handheld or gamescope deployment was found ([Flutter 3.47](https://flutter.dev/blog/whats-new-in-flutter-3-47); [supported platforms](https://docs.flutter.dev/reference/supported-platforms)).

The fork should keep the fallback cheap. RomMix keeps its RomM client under `src/main/`, outside the React renderer ([version.ts](https://github.com/leclercb/rommix/blob/main/src/main/romm/version.ts)). Put the RomM client, download queue, save engine and process launcher behind a small JSON socket in `$XDG_RUNTIME_DIR`. The Decky companion needs that socket anyway, for a Quick Access Menu status panel and a "quit emulator" button. With that boundary, a failed renderer would cost a UI rewrite, not a rewrite of the tested core.

## Steam Game Mode sets the rules for living, launching and leaving

### Registering and autostarting the launcher

The launcher should be one non-Steam shortcut that owns everything it launches. Armada boots into `gamescope-session-plus@steam`, with Steam as the session client and QAM, Steam Input, the on-screen keyboard and Decky on top ([DEVICE-FACTS](../DEVICE-FACTS.md)).

- **Adding the shortcut.** The sanctioned way to add a shortcut while Game Mode runs is Steam's internal `SteamClient.Apps.AddShortcut`, called from a Decky plugin. That is what Armada Store does, and it wraps launch options in `/usr/libexec/armada/armada-game-launch %command%` to get Armada's PATH fix and per-game hooks ([shortcuts.ts](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/src/lib/shortcuts.ts); [catalog.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/catalog.py)).
- **Never edit shortcuts.vdf live.** Editing it is only safe in Desktop Mode with Steam closed, because "Steam rewrites shortcuts.vdf on exit" ([session.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/session.py)).
- **Booting into the launcher.** Append to the session rather than replacing it. A user file at `~/.config/gamescope-session-plus/sessions.d/steam` is sourced after Armada's own, so `CLIENTCMD+=" steam://rungameid/<gameid>"` keeps Armada's flags ([gamescope-session-plus](https://github.com/OpenGamingCollective/gamescope-session/blob/08e65a62ed3d7acc6ae17db637091d402a55ae2a/usr/share/gamescope-session-plus/gamescope-session-plus)). This append is untested on Armada, so ship it as an opt-in toggle.
- **Safety nets already exist.** After five client crashes within 60 s, Armada falls back to Desktop Mode, and holding Select during the boot splash also escapes to Desktop Mode ([armada-boot-hotkeys](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/armada-boot-hotkeys)).

### Focus and windows

gamescope gives every X11 window an appID. It uses the `STEAM_GAME` property if set; otherwise it reads the process's `app-steam-app<appid>-<pid>.scope` cgroup, or walks up to a `reaper … SteamLaunch AppId=` ancestor. Among game windows with the same appID, the most recently mapped one gets focus ([steamcompmgr.cpp L6027-6045](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/steamcompmgr.cpp#L6027-L6045); [Process.cpp](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/Utils/Process.cpp#L666-L804); [focus priority](https://github.com/ValveSoftware/gamescope/blob/36848c2f30e4afef02f4500665710d8006bd6619/src/steamcompmgr.cpp#L4134-L4186)). The device already showed a zenity window from a child of ES-DE appearing on screen ([DEVICE-FACTS](../DEVICE-FACTS.md)).

The plan follows from this:

- Spawn emulators as direct descendants. Never double-fork them or `systemd-run` them as services.
- Never map a toast or dialog window while an emulator runs, because the newer window would steal focus.
- Keep the launcher's own window on X11/XWayland.
- Never set `STEAM_GAME` by hand.
- Pick one plain gamepad template for the shortcut. Steam Input is per appID, and every emulator inherits the launcher's.

RomMix's README independently warns that an emulator launched "outside the tree Steam started" leaves RomMix focused ([README](https://github.com/leclercb/rommix)).

### Steam games

Read Steam games by parsing `libraryfolders.vdf` and `appmanifest_*.acf`, the way Armada Control does, and launch them with `steam steam://rungameid/<appid>`, which Armada routes through its `launch-steam --desktop` wrapper ([steam.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-control/py_modules/armada_control/steam.py); [/usr/bin/steam](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/bin/steam)).

Two device-only risks belong in the first test:

- **The multiple-games prompt.** Steam's "Launch Multiple Games" dialog now offers "Close previous game" ([GamingOnLinux](https://www.gamingonlinux.com/2025/03/steam-update-adds-game-notes-to-the-web-demo-installs-on-profile-game-list-8bitdo-micro-support/)). Because the launcher is itself a running shortcut, choosing that option would kill it.
- **Focus after exit.** Where focus goes when the Steam game exits is untested.

While a Steam game has focus, the launcher should stop rendering and polling. It can detect this by comparing `GAMESCOPE_FOCUSED_APP` with its own `SteamAppId`.

### A universal exit that does not depend on the renderer

The universal exit should not depend on Chromium. InputPlumber, which Armada runs, calls `grab()` on the physical gamepad nodes, so ordinary event-stream readers see nothing ([gamepad.rs](https://github.com/ShadowBlip/InputPlumber/blob/ea60d873cca17edd1cb655ede26f557108135252/src/input/source/evdev/gamepad.rs)). Armada's boot-hotkey script instead reads key *state* with `EVIOCGKEY` "through InputPlumber's grab" ([armada-boot-hotkeys](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/armada-boot-hotkeys)), and the `armada` user is in the `input` group ([armada-user.conf](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/lib/sysusers.d/armada-user.conf)).

The exit should work like this:

1. **Watch.** While an emulator runs, a small watcher in Electron's main process (or a static helper binary in the AppImage) polls, every 50–100 ms, each node that has `BTN_SELECT` (314) and `BTN_START` (315).
2. **Fire on hold.** It triggers after about 1 s of holding both.
3. **Terminate gently.** Follow ROCKNIX's discipline: exactly one SIGTERM, because "a second SIGTERM makes RetroArch exit without saving," then five seconds, then SIGKILL ([ROCKNIX input_sense](https://github.com/ROCKNIX/distribution/blob/2d342567194c78e01a37c75b0473b8c86a708619/projects/ROCKNIX/packages/sysutils/system-utils/sources/scripts/input_sense)).
4. **Handle flatpaks separately.** `flatpak kill` sends SIGKILL ([flatpak-builtins-kill.c](https://github.com/flatpak/flatpak/blob/f2df7b090b69487f812f4ea389edffca0f5a4610/app/flatpak-builtins-kill.c)), so send SIGTERM to the `child-pid` from `flatpak ps` first.
5. **Signal only tracked PIDs.** The prototype killed its own SSH session with `pgrep -f` ([DEVICE-FACTS](../DEVICE-FACTS.md)).

Whether each emulator flushes memory cards and SRAM on SIGTERM is unverified, so it belongs on Gate 1's checklist. RetroArch on the device has no gamepad hotkeys configured, so today the launcher's chord is the only way out.

### Launch flags and save locations

| Emulator as installed | Launch arguments (flags verified in source) | Save location |
|---|---|---|
| DuckStation AppImage | `-batch -fullscreen -nogui -- <rom>` ([qthost.cpp](https://github.com/stenzek/duckstation/blob/df8059758b11e1b6b320dbd84dad38afba307e40/src/duckstation-qt/qthost.cpp)) | `~/.local/share/duckstation/memcards` |
| ARMSX2 AppImage | `-batch -fullscreen -nogui -- <iso>` ([QtHost.cpp](https://github.com/ARMSX2/ARMSX2/blob/b1f3196b9ea6aa4e89907b02dffd63b784d13ed2/pcsx2-qt/QtHost.cpp)) | `~/.config/ARMSX2/memcards` |
| Dolphin flatpak | `-b -e <rom>` ([CommandLineParse.cpp](https://github.com/dolphin-emu/dolphin/blob/e6f3ae17627e4344da95b13424af5baf4c892b08/Source/Core/UICommon/CommandLineParse.cpp)) | `~/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu/GC` and `…/Wii/title` ([armadaos.dev](https://armadaos.dev/emulation/emulators/dolphin-gc/)) |
| PPSSPP flatpak | `--fullscreen --pause-menu-exit <rom>` ([CmdLine.cpp](https://github.com/hrydgard/ppsspp/blob/13c1773bc24e97a2ca7bd4362b12b8859a6f71a3/Core/CmdLine.cpp)) | `~/.var/app/org.ppsspp.PPSSPP/config/ppsspp/PSP/SAVEDATA` ([armadaos.dev](https://armadaos.dev/emulation/emulators/ppsspp/)) |
| Flycast flatpak | `<rom>`; exits on close when started from the CLI ([gui.cpp](https://github.com/flyinghead/flycast/blob/0d9853df9a917eba2f7a84158bd1c3bccb8933e8/core/ui/gui.cpp)) | `~/.var/app/org.flycast.Flycast/data/flycast` |
| RetroArch flatpak | `-f -L <core> <rom>`, with `quit_on_close_content` set to CLI via `--appendconfig` ([retroarch.c](https://github.com/libretro/RetroArch/blob/e49b6298550105a9c6c0000227808199b8ab9e77/retroarch.c)) | `~/.var/app/org.libretro.RetroArch/config/retroarch/saves` ([armadaos.dev](https://armadaos.dev/emulation/emulators/retroarch/)) |
| melonDS AppImage | `-f <rom>` (as ES-DE launches it) | Inferred to sit next to the ROM, because Armada's template leaves `SaveFilePath` empty ([melonDS.toml](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/templates/melonds/melonDS.toml)) |

Rather than hardcoding executables, resolve them at runtime from ES-DE's `linuxarm` `es_systems.xml` and `es_find_rules.xml`, with Armada's `~/ES-DE/custom_systems/` overrides layered on top. Armada expects each emulator to be either an AppImage or a flatpak ([ES-DE linuxarm](https://gitlab.com/es-de/emulationstation-de/-/blob/a8cf738d6805180e07abb82403511254c5433826/resources/systems/linuxarm/es_systems.xml); [Armada templates](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/templates/es-de/es_systems.xml)). Armada's ps2 override does not accept `.cue` ([DEVICE-FACTS](../DEVICE-FACTS.md)). Armada gives every catalog flatpak persistent access to `/run/media`, so flatpak emulators can read ROMs on the `NovaSD` card ([installers.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/installers.py)).

### Packaging and distribution

Ship a single aarch64 AppImage to `~/Applications`, and never touch `/usr` or `/etc` on this bootc image ([bootc-filesystem](https://bootc.dev/bootc/bootc-filesystem.7.html)). Distribute through GitHub Releases plus a pull request to Armada's catalog, which is a static JSON file baked into the OS image ([catalog.py](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/decky/armada-store/py_modules/armada_store/catalog.py)).

Flathub is ruled out on two counts: it rejects apps that are "a thin wrapper or launcher around other tools," and it forbids AI-generated manifests and AI-opened submission pull requests ([Flathub requirements](https://docs.flathub.org/docs/for-app-authors/requirements)). The Decky store is similar: it refused Tender because it does not accept AI-assisted plugins ([Tender README](https://github.com/danielcopper/romm-tender)). So the Decky companion ships as a release zip or as an Armada `deckyplugin` catalog entry. The launcher must keep working when Decky breaks after a Steam update, which is a known Armada issue ([known issues](https://armadaos.dev/troubleshooting/known-issues/)).

### Sleep and downloads

Downloads do not survive sleep:

- **s2idle** freezes `user.slice`, and NetworkManager drops Wi-Fi ([systemd-sleep](https://www.man7.org/linux/man-pages/man8/systemd-sleep.8.html); [device-quirks](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/device-quirks)).
- **Fake suspend** freezes `app.slice` ([fake-suspend](https://github.com/armada-os/armada/blob/816091ecff7bebf78d4005175a4e5c3e237e91ab/system_files/usr/libexec/armada/fake-suspend)).

The downloader therefore needs three things:

- `.part` files that resume with `Range` and `If-Range` requests;
- a logind `PrepareForSleep` delay inhibitor (never `block`);
- a wait for NetworkManager to report `Connectivity == FULL` before retrying.

## Save sync must speak Argosy's dialect to a 5.2.0 server

### How the protocol pairs saves

Save sync is the requirement most likely to fail silently, and the one the Argosy fork's own rules treat as sacred: "Breaking it silently loses game saves" ([CLAUDE.md L471-473](~/Documents/argosy-fork/CLAUDE.md)). RomM's protocol has a simple shape ([sync.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)):

1. The client POSTs its local save inventory to `/api/sync/negotiate`.
2. It receives a list of `upload`, `download`, `conflict` and `no_op` operations.
3. It carries them out through `/api/saves`.
4. It closes the session.

Interoperability with Argosy depends on the details:

- **Same slot name.** Saves pair on **`(rom_id, slot)`, not file name**. A null slot means an "archival, manual-upload save" that never pairs; the 5.2.0 spec captured from the tester's server says so in its own schema text ([openapi-5.2.0.json](../../reference/romm-api/openapi-5.2.0.json)). The Linux client must use the slot Argosy uses for the latest save, `"autosave"` ([save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)).
- **Same hash.** `content_hash` must be the MD5 for plain files, and RomM's composite hash for zips (the MD5 of the sorted `name:md5` lines). Otherwise identical saves show up as conflicts instead of `no_op` ([assets_handler.py](https://github.com/rommapp/romm/blob/5.3.1/backend/handler/filesystem/assets_handler.py)).
- **Confirm downloads explicitly.** Download with `optimistic=false`, then call `POST /api/saves/{id}/downloaded`, as Argosy does, so a failed disk write never marks the device as current ([SaveDownloader.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/repository/SaveDownloader.kt)).
- **Expect a 409 on first upload.** A device's first upload into an existing slot returns **409** unless it downloads first or overwrites. Argosy and Grout both turn that response into a conflict screen ([saves.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py); [Grout conflicts.go](https://github.com/rommapp/grout/blob/main/saves/conflicts.go)).

### What the tester's 5.2.0 server changes

Two facts about the 5.2.0 server change the design, and both come from checking the captured spec.

**Negotiation can't be scoped to one game.** The 5.2.0 negotiate payload accepts only `device_id` and `saves`; there is no `rom_ids` field ([openapi-5.2.0.json](../../reference/romm-api/openapi-5.2.0.json)). Argosy's own documentation warns that without `rom_ids`, "every unpaired head comes back as download" ([save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)). A pre-launch check for one game must therefore send the full local inventory and act only on that game's operations. Otherwise the session plans downloads for the whole library. Enable `rom_ids` only when the heartbeat reports version 5.3 or later.

**Argosy uses its older save handlers on this server.** The 5.2.0 heartbeat schema has no `SAVE_SYNC` section, and the spec has no snapshot or memory-card endpoints ([openapi-5.2.0.json](../../reference/romm-api/openapi-5.2.0.json)). Argosy sends standalone Dolphin and other memory-card or profile emulators through Sigil only when the heartbeat reports `SAVE_SYNC.SNAPSHOTS` ([save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)). So on this server Argosy uses its legacy per-platform handlers. The Linux client must reproduce those handlers' archive shapes, which are documented in `save-id-to-path.md` with the warning that "a changed archive shape invalidates every save already on a server" ([save-id-to-path.md](~/Documents/argosy-fork/src/docs/save-id-to-path.md)). The protocol itself does work on 5.2.0: an Argosy 2.9.0 log shows `supportsSyncNegotiate` as true on `version=5.2.0` ([issue #388](https://github.com/rommapp/argosy-launcher/issues/388)).

### Android and Linux run different emulators

The hardest part is that the two operating systems use different emulators:

- **On Android,** the tester plays SNES, GBA, PS1, PSP, GameCube/Wii and Dreamcast in Argosy's built-in libretro cores (snes9x, mgba, pcsx_rearmed or Beetle PSX, ppsspp, dolphin and flycast), and PS2 in ARMSX2 ([CLAUDE.md L146-147](~/Documents/argosy-fork/CLAUDE.md); [Nova inventory](~/Documents/argosy-fork/server-notes/2026-09-14-nova-argosy-inventory.md)).
- **On Linux,** the device runs standalone DuckStation, Dolphin, PPSSPP, Flycast and ARMSX2, plus RetroArch with snes9x and mgba ([DEVICE-FACTS](../DEVICE-FACTS.md)).

How each system fares:

- **SNES and GBA are easy.** Both sides run the same libretro cores writing `.srm` files, and Argosy reads RetroArch save paths from `retroarch.cfg` ([Save-Sync wiki](https://github.com/rommapp/argosy-launcher/wiki/Save-Sync)).
- **The other systems need adapters.** Each needs a per-platform adapter that converts between the libretro core's save and the standalone emulator's layout, under the same `(rom_id, "autosave")` pair.
- **PS2 needs folder memory cards.** Argosy's PS2 sync covers "folder memory cards only" ([Save-Sync wiki](https://github.com/rommapp/argosy-launcher/wiki/Save-Sync)), so both ARMSX2 installs must use folder cards or PS2 saves won't travel at all.
- **Save states mostly won't cross.** States are plain per-ROM uploads with no device, slot or conflict logic ([states.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/states.py)), and they only load in the same core. State sync between Android and Linux is realistic only where both sides run the same libretro core.

That leaves a choice per system. Running the Android core in Linux RetroArch gives frictionless interoperability. Running the standalone emulator gives better performance and features, at the cost of an adapter. The tester should make this call system by system; the agent should not default it.

### Match what Argosy actually uploads, not what its docs say

On 2026-10-02, Argosy's maintainers documented that its save path has "no shared decision," more than ten "active save" choosers, and hashes computed four different ways ([save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)). The Linux client should match what Argosy actually uploads, not what the docs describe.

The agent can't see the server, so the plan needs one capture run by the tester on the LAN. A script exports `GET /api/saves` metadata and the content of a few Argosy-made saves per system, with tokens redacted, as an issue attachment. Those files become golden fixtures for round-trip tests against a Dockerized 5.2.0.

Dual booting raises the stakes. Android and Linux on the same Nova are two separate RomM devices that are never online at the same time. The end-of-session upload must therefore finish before the tester reboots through the ABL menu ([DEVICE-FACTS](../DEVICE-FACTS.md)). The UI should show a persistent "all saves uploaded" state and hold queued uploads across suspend.

The fork's own bug history doubles as a regression-test list ([FORK-NOTES.md L492-499](~/Documents/argosy-fork/FORK-NOTES.md)):

- a "Preparing" download that deadlocked the shared download slot;
- progress ticks that reverted rows to QUEUED;
- two writers streaming into one temp file;
- no retry when the server reconnected;
- startup jobs that vanished when the home screen was replaced;
- a file write that recursively deleted Dolphin's memory-card directory.

### Downloads and library sync on 5.2.0

Downloads follow their own 5.2.0 rules:

- **Single-file ROMs** are served through an nginx internal redirect, so byte-range resume works.
- **Multi-file ROMs** stream as an on-the-fly zip, unless the request carries `Range`. Since 5.1.0 that makes the server build a cached zip that can be resumed ([roms/__init__.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py)).
- **Per-file download is the better path for this library.** `GET /api/roms/{id}/content/{name}?file_ids=<id>` was verified on the tester's server ([DEVICE-FACTS](../DEVICE-FACTS.md)). The per-file `/files/content/` route is GET-only in the 5.2.0 spec, which explains the 405 on HEAD ([openapi-5.2.0.json](../../reference/romm-api/openapi-5.2.0.json)). Every `files[]` entry carries an MD5 and SHA1 for verification ([responses/rom.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/responses/rom.py)).

The library's shape dictates edge cases the client must handle ([DEVICE-FACTS](../DEVICE-FACTS.md)):

- 16 multi-disc PS1 folders and 6 GameCube folders need a playlist written by the client, in a folder whose name does not contain ".m3u", because PCSX ReARMed treats such paths as playlists ([Nova settings sheet V1](~/Documents/argosy-fork/server-notes/2026-09-14-nova-settings-sheet.md)).
- 14 PS2 cue/bin pairs are listed as separate ROMs.
- 117 PSP folders carry `.EDAT` DLC that should be installed into PPSSPP's memory-stick folder.

Library sync needs to be incremental, since a full listing took about 140 s on the first run. Use the pattern Argosy documents: request `updated_after`, use the `/identifiers` lists to detect deletions, and turn off `with_char_index`, `with_filter_values` and `with_rom_id_index` ([roms/__init__.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py)).

Pairing should use the device flow already verified on 5.2.0 ([DEVICE-FACTS](../DEVICE-FACTS.md)). Each approval mints a new token, and users are capped at 25 tokens ([device_auth.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/device_auth.py); [client_tokens.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/client_tokens.py)). Persist the token and re-pair only after a 401 or 403.

### Versions and a possible server upgrade

Follow Argosy's policy of supporting the latest three RomM minor versions (5.1–5.3 today) and gating features on the heartbeat version ([RomMCapabilities.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMCapabilities.kt)). CI should test against pinned 5.2.0 and 5.3.1 images.

Upgrading the tester's server to 5.3.1 would unlock `rom_ids` and memory-card versioning, but it has costs. 5.3.0 stopped auto-detecting the filesystem layout and requires `filesystem.structure` in `config.yml`, and RomM migrations are one-way ([5.3.0 release](https://github.com/rommapp/romm/releases/tag/5.3.0); [Argosy testbed](https://github.com/rommapp/argosy-launcher/blob/main/testbed/romm/README.md)). That makes it a server change the owner approves, in line with the Argosy fork's rule to never change the RomM server "without saying so plainly first" ([CLAUDE.md L465-476](~/Documents/argosy-fork/CLAUDE.md)). It is not something the agent schedules.

## The cloud agent builds blind, so the repo must carry its own proof

### What the cloud session can and cannot do

A Claude Code cloud session is a fresh Ubuntu 24.04 **x86_64** VM with about 4 vCPU, 16 GB of RAM and 30 GB of disk. Docker and docker compose are pre-installed, and the "Trusted" network allowlist covers GitHub, Docker Hub, GHCR, npm and Ubuntu mirrors ([cloud environments](https://code.claude.com/docs/en/cloud-environments)).

- **It can run a real RomM.** A pinned `rommapp/romm` plus MariaDB stack fits inside the session. It can be provisioned the way Grout's end-to-end harness does it: create the first admin while the setup wizard is active, trigger a scan over socket.io with `apis: []` so no metadata provider is contacted, then mint a token ([provision.py](https://github.com/rommapp/grout/blob/main/test/e2e/romm/provision.py)).
- **It cannot run the AppImage.** The VM can't execute aarch64 binaries, and QEMU/binfmt inside it is undocumented. arm64 builds and smoke tests belong on GitHub's free `ubuntu-24.04-arm` runners for public repos (4 vCPU, generally available since August 2025). RomMix's release workflow already uses them ([GitHub changelog](https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/); [release.yml](https://github.com/leclercb/rommix/blob/main/.github/workflows/release.yml)).
- **It ships the wrong Node.** The VM has Node 20, 21 and 22, while RomMix requires Node ≥ 24 ([package.json](https://github.com/leclercb/rommix/blob/main/package.json)). The first milestone's setup script must fetch Node 24 from an allowed host, for example the `node:24` image on Docker Hub, or the environment needs a Custom network entry.

### The GitHub proxy shapes releases

Every GitHub operation goes through a proxy with three limits that matter here ([cloud environments](https://code.claude.com/docs/en/cloud-environments)):

- It rejects tag pushes and branch deletions.
- It rejects GraphQL, so `gh pr` and `gh issue` fail; use `gh api` REST calls instead.
- It does not restrict which branches can be pushed.

Releases therefore come from GitHub Actions: a nightly prerelease rebuilt from a green `main`, and stable tags created by the tester or a release workflow. That conveniently makes promotion to stable a human act. `main` needs a ruleset that requires pull requests and green x86_64 and arm64 checks with **no bypass**, because routine pushes act as the owner and "a rule that access can bypass doesn't block a run's push" ([Routines](https://code.claude.com/docs/en/routines)).

### Harness discipline

Anthropic's guidance on long-running agents translates directly ([effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents); [harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps); [best practices](https://code.claude.com/docs/en/best-practices); [costs](https://code.claude.com/docs/en/costs)):

- **A JSON feature list** with acceptance criteria, where the agent may only flip a `passes` flag.
- **An append-only `PROGRESS.md`.**
- **An `init.sh`** that starts the Dockerized RomM and runs a smoke test before any new work.
- **One feature per session,** verified end to end "as a human user would."
- **A separate, skeptical evaluator,** because agents grading themselves "confidently praise the work."
- **A Stop hook** that runs `scripts/check.sh` and blocks a turn from ending while lint, unit tests or the build fail.
- **A CLAUDE.md under 200 lines.**

Everything the agent cannot see gets a `needs-device-test` label and a line in a per-release checklist: gamescope focus, the exit chord, controller mapping, suspend, Turnip rendering and real save paths. Nothing reaches stable without a `tester-verified` label.

### Automation and the tester's loop

Routines provide the "set and forget" engine, with limits ([Routines](https://code.claude.com/docs/en/routines)):

- The minimum schedule interval is one hour.
- Triggers exist for schedules, API calls, pull requests and releases, but not for issues.
- A green run status "does not mean the task in your prompt succeeded."

Tester reports therefore reach the agent through an Actions workflow on `issues.labeled` that POSTs to the routine's `/fire` endpoint. It should be gated on a label only the tester or owner can apply, since anyone can file an issue on a public repo ([GitHub Actions docs](https://code.claude.com/docs/en/github-actions)). Threads in Claude Projects ride out usage-limit resets on their own, while routine-started threads stop at the limit ([Projects](https://code.claude.com/docs/en/claude-projects)). Scheduled workflows in public repos switch off after 60 days without activity, so the roadmap routine should be what keeps the repo active.

On the tester's side, an in-app "Report a problem" should write a redacted diagnostics bundle and show a QR code to a prefilled issue form. That keeps the tester's loop to three steps: update, test, scan.

### Milestones: parity first, beyond second, shaders last

| Milestone | Scope | Proof in the cloud | Proof on the Nova |
|---|---|---|---|
| M0: fork and Gate 0 | Fork; CI on both architectures; nightly AppImage built by Actions; Dockerized RomM 5.2.0 and 5.3.1; feature list, `PROGRESS.md` and `init.sh`; diagnostics bundle and frame-time overlay | Green CI; integration tests against the Docker RomM | Gate 0 |
| M1: Armada launch layer and Gate 1 | Descriptors for DuckStation, ARMSX2, Dolphin, PPSSPP, Flycast and melonDS; find-rule resolver; Select+Start watcher with graceful kill; 1280×960 4:3 layout | Unit tests for command lines and the kill sequence; 1280×960 screenshots under Xvfb | Gate 1 |
| M2: Argosy-compatible saves | Full-inventory negotiation; `autosave` slot; legacy archive shapes; `optimistic=false`; conflict screen; upload on exit; "all saves uploaded" state; play sessions | Round-trip tests on tester-captured fixtures | Gate 2: Android to Linux to Android, per system |
| M3: Steam and Decky | Steam library provider, `rungameid` launch, pausing in the background; Decky companion for Add to Steam, autostart, QAM status and a quit button | VDF and ACF parser tests | Multiple-games prompt; autostart |
| M4: library and download parity | Favorite means pre-download; On-device view and freeing space; percent, speed, ETA and cancel; incremental sync; playlists; BIOS distribution; resume after suspend | Resume and storage-wait tests | Suspend in the middle of a download |
| M5: Argosy-fork design parity | Four-state file dot; Now playing; Browse with preview video and audio; title-aware cover crop; Series and Collections; L3 and R3 menus; screensaver | Golden screenshots | Feel and legibility |
| M6: beyond Argosy | Hide or flag rows marked `missing_from_fs`; stop folding different games together by IGDB id; install PSP DLC; per-game PS2 settings; per-game 60 Hz pacing | Unit tests | A/B comparisons |
| M7: emulator tuning and CRT shaders | Per-system profiles; the best CRT shader per system and emulator, including PS2, GameCube, Wii and PSP | Config snapshot tests | A/B on the OLED |

The shader milestone inherits prior work and one reversal. The Argosy fork's `device-shaders/` folder holds:

- a patched `gba-color.glsl`, needed only because Argosy's Android GLSL parser misplaced a precision statement;
- stock `crt-geom`, `zfast_crt` and `zfast_lcd`.

Its device configuration deliberately ran no shader on upscaled 3D systems ([device-shaders README](~/Documents/argosy-fork/device-shaders/README.txt); [FORK-NOTES.md L125-135](~/Documents/argosy-fork/FORK-NOTES.md)). The tester now wants CRT shaders "even for more modern systems" ([requirements](../REQUIREMENTS-FROM-TESTER.md)), which overrides that choice.

On Linux the launcher can apply per-system settings at launch without touching the user's own configuration. RetroArch takes `--appendconfig`, Dolphin takes `-C`, and Flycast takes a transient `-config` ([retroarch.c](https://github.com/libretro/RetroArch/blob/e49b6298550105a9c6c0000227808199b8ab9e77/retroarch.c); [CommandLineParse.cpp](https://github.com/dolphin-emu/dolphin/blob/e6f3ae17627e4344da95b13424af5baf4c892b08/Source/Core/UICommon/CommandLineParse.cpp); [cl.cpp](https://github.com/flyinghead/flycast/blob/0d9853df9a917eba2f7a84158bd1c3bccb8933e8/core/cfg/cl.cpp)). The rest means editing DuckStation's `settings.ini` and ARMSX2's `PCSX2.ini`. That same mechanism delivers the per-game PS2 tuning the Android launcher could never pass to ARMSX2. Measure shader cost with power profiles in mind, because Armada's default profile caps the prime core near 2.09 GHz until "Performance" is selected ([DEVICE-FACTS](../DEVICE-FACTS.md)).

## Conclusion

Choosing the base looks like a framework debate but is really a hardware question that costs about an hour to answer, because the closest match already exists and already runs the full loop for SNES and GBA. The real risk sits elsewhere. One part is save interoperability on a dual-boot device whose two clients never coexist, talking to a server too old to scope negotiation to one game and too old for Argosy's Sigil path. The other part is behaviour only the panel can reveal: focus handoff, Steam's multiple-games prompt, and whether each emulator saves on SIGTERM. That inverts the usual order of a launcher project. Device plumbing and captured save fixtures come before UI polish, and the UI becomes the most replaceable layer as long as the core sits behind a local socket.

The tester's role is smaller than "testing everything" but more consequential than it sounds:

- run two scripted gate checks;
- capture save fixtures once on the LAN;
- optionally approve a RomM 5.3.1 upgrade;
- for each system, choose between Android-matching libretro cores and standalone emulators.

The agent should not make that last choice, because it decides whether saves follow the tester between Android and Linux.
