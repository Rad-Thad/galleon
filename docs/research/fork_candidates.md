> Research note copied into the repository at handoff (2026-10-08). Links to `~/Documents/argosy-fork/...` point at the tester's private local Argosy fork, which is not in this repository; see [argosy-fork-design-spec.md](argosy-fork-design-spec.md) for the extracted design.

# Fork/extend candidates for an Argosy-like RomM launcher on armadaOS (Retroid Pocket Nova, aarch64, gamescope)

Research date: 2026-10-08. All GitHub stats come from the GitHub REST API on 2026-10-08 (`https://api.github.com/repos/<owner>/<repo>`, `/releases`, `/contributors`, `/commits?since=`) unless a page URL is given. "Commits since 2026-07-08" counts are capped at 100 per query, so "100" means 100 or more. RomM server context: the latest stable is 5.3.1 (2026-09-23) and 5.4.0-alpha.1 came out on 2026-10-06 ([RomM releases](https://github.com/rommapp/romm/releases)). The user runs 5.2.0.

**Big discovery:** three Linux RomM frontends that were not on the original candidate list matter a lot: **RomMix** (leclercb/rommix), **Ludo** (rommapp/ludo) and **Gameflow Deck**. Freegosy is also relevant. All four are listed in the RomM README "Community" section or the rommapp org ([RomM README](https://github.com/rommapp/romm/blob/master/README.md)). RomMix is the closest existing match to the goal.

## Q1. RomMix (leclercb/rommix): a newly found candidate and the closest existing match

### Takeaway
RomMix is an MIT-licensed, Electron/React/TypeScript "Big Picture-style" RomM frontend for Linux. It ships **arm64 AppImages**, runs under gamescope or as a Steam non-Steam game, and already does gamepad-first browsing, on-demand downloads with an in-app queue and progress, two-way save/state sync, BIOS, multi-disc, offline mode and themes. It is very young (created 2026-08-17) and has a single maintainer, but its architecture, test harness and contribution rules make it the most AI-agent-friendly base found.

### Cited Findings
- **License and activity.** It is MIT and written in TypeScript, with 22 stars. The repo was created on 2026-08-17 and last pushed on 2026-10-04, with 4 open issues. leclercb is the only contributor (448 commits). — [GitHub API repo](https://api.github.com/repos/leclercb/rommix), [contributors](https://api.github.com/repos/leclercb/rommix/contributors)
- **Releases.** v0.20.0 (2026-09-30) and v0.19.0 (2026-09-25), plus a rolling `canary` pre-release. Assets are `RomMix-arm64.AppImage`, `RomMix-x86_64.AppImage` and `rommix-steam.sh`. — [Releases](https://github.com/leclercb/rommix/releases)
- **arm64 builds.** CI builds arm64 natively on GitHub's `ubuntu-24.04-arm` runners, with the comment "`arm64` is what a Linux handheld that is not x86 actually runs." — [release.yml](https://github.com/leclercb/rommix/blob/main/.github/workflows/release.yml)
- **Stack.** Electron ^44.4.5, React 19, Vite 7, TypeScript 7, electron-builder and electron-vite, on Node >= 24. — [package.json](https://github.com/leclercb/rommix/blob/main/package.json)
- **Feature list.** It covers:
  - library browse and search by platform, with Home shelves (last played, on this device, favourites) and RomM collections
  - downloads into the emulator's own ROM folder or one shared folder, with pause/resume and a check against RomM's hash
  - multi-disc sets unpacked and launched as one game
  - "Saves and states synced both ways", plus a per-game manual sync tab
  - favourites, progress and play time saved to RomM, and offline mode
  - BIOS from your own server, emulators installed and assigned by RomMix, and QR sign-in
  - "Controller-driven and fullscreen", a pre-flight check, and self-update

  — [README](https://github.com/leclercb/rommix)
- **Requirements.** "Linux, x86_64 or arm64", plus `flatpak` for flatpak emulators, and a RomM server "version 5.x or newer". The code sets `MINIMUM_SERVER_VERSION = '5.0.0'`. — [README](https://github.com/leclercb/rommix), [src/main/romm/version.ts](https://github.com/leclercb/rommix/blob/main/src/main/romm/version.ts)
- **Supported emulators today.** RetroDECK, EmuDeck (via its `Emulation/tools/launchers/`), RetroArch (Flatpak), Eden (AppImage) and shadPS4. — [README](https://github.com/leclercb/rommix)
- **gamescope and Steam.**
  - Launch with `gamescope -f -- ./RomMix-x86_64.AppImage`.
  - From Steam, add `rommix-steam.sh` as the non-Steam game, because "Steam launches games in a way that stops an AppImage mounting itself".
  - Under gamescope it detects the Wayland-claims-but-no-socket case and "falls back to X11 there by itself".
  - It warns that an emulator launched "outside the tree Steam started" keeps RomMix focused.
  - The quit dialog offers Sleep/Restart/Turn off for sessions "where RomMix is the whole of what is on screen".

  — [README](https://github.com/leclercb/rommix)
- **Controller exit.** The README controls table lists "Back from a game | Start, held". In code, `SUSPENDED_HOLD_MS = 1500` is documented as "How long Start must be held to reach RomMix while an emulator has the screen", and focus.tsx says the Gamepad API "reports button state to whoever polls, focused or not", so "Holding Start still reaches RomMix, as the way out of an emulator that has hung." Pads are read only through Chromium's Gamepad API, "the most dependable controller input available under both gamescope and a plain desktop session". — [gamepad.ts](https://github.com/leclercb/rommix/blob/main/src/renderer/src/input/gamepad.ts), [focus.tsx](https://github.com/leclercb/rommix/blob/main/src/renderer/src/input/focus.tsx)
- **Extension points.**
  - Rule: "No code outside `src/config/` names an emulator."
  - Add an emulator by creating a folder under `src/config/emulators/`. Add a system or map a RomM slug in `src/config/systems.ts`. Add a theme as a file under `src/renderer/src/styles/themes/`.
  - The `example` emulator descriptor is "documentation that the compiler checks". Install kinds are `flatpak` (appId), `appimage` (filename patterns plus a release API URL), `binary` (looked up on PATH) and `scripts` (a launcher directory).
  - Emulators declare `dispatch: 'rommix'` (RomMix picks the core or emulator) or `'self'`.

  — [CONTRIBUTING.md](https://github.com/leclercb/rommix/blob/main/CONTRIBUTING.md), [example descriptor](https://github.com/leclercb/rommix/blob/main/src/config/emulators/example/index.ts)
- **Hidden settings.** `settings.json` supports `systemOverrides` (RomM slug to ES-DE system folder) and `emulatorPaths` (for example, pointing at an AppImage kept anywhere). — [README](https://github.com/leclercb/rommix)
- **Testing without hardware.**
  - `npm run preview:app` "runs the interface in a browser against a stub library".
  - `npm run test:app` drives "the built application, driven from outside against a fake RomM".
  - CI runs typecheck, lint, format and test on every PR, and the coverage floor is 96% of lines.

  — [CONTRIBUTING.md](https://github.com/leclercb/rommix/blob/main/CONTRIBUTING.md), [package.json](https://github.com/leclercb/rommix/blob/main/package.json)
- **Code size (measured from the main tarball, 2026-10-08).** About 48.4k lines of non-test TS/TSX under `src/` and about 18.9k lines of unit tests. `test/app/` holds a fake RomM `server.ts` (52 KB) and a `driver.ts` (50 KB). — [codeload tarball](https://codeload.github.com/leclercb/rommix/tar.gz/refs/heads/main)
- **Listing.** The RomM README lists it under "Handhelds and Steam Deck" as "Big Picture-style frontend for Linux and Steam Deck". — [RomM README](https://github.com/rommapp/romm/blob/master/README.md)

### Inferences
- RomMix already covers most of the stated goal: gamepad-first UI, on-demand RomM downloads with in-app progress, save sync, gamescope and Steam compatibility, and aarch64 packaging. Steam library integration is missing. Neither the README nor the source lists Steam games, and every "Steam" mention concerns launching RomMix from Steam.
- Adding Armada Store emulators (standalone DuckStation, ARMSX2, PPSSPP, Dolphin, Flycast) should be a contained change: one descriptor folder per emulator, using the `appimage`/`binary`/`flatpak` kinds and save-path maps. RetroArch already works through Flatpak, and Flathub publishes aarch64 RetroArch (see Q8).
- The Start-hold mechanism is the nearest existing answer to "no unified controller exit hotkey". Whether it works under gamescope with Steam Input on the Nova is unverified: it depends on Chromium polling the pad while gamescope focuses the emulator, and on RomMix then raising its window.
- RomMix's minimum is 5.0.0, so the user's RomM 5.2.0 should work without a server upgrade.
- The risk is bus factor: one maintainer, and a project only about 7 weeks old. MIT allows a hard fork. Upstreaming generic changes (new emulator descriptors, a Steam library) would reduce fork drift, since CONTRIBUTING.md welcomes PRs.
- The preview mode, fake-RomM app tests, native arm64 CI and the "only edit src/config" rule suit an autonomous agent with no LAN or device access. GitHub provides arm64 runners for public repos, matching the user's public-repo plan.

### Gaps
- I couldn't confirm that RomMix renders well on Mesa Turnip/Adreno 740 at 1280x960 (4:3). The UI is "laid out for a 1080p television" with a Scale setting.
- I found no statement on whether the maintainer accepts large features such as a Steam library, or on whether AI-written PRs are welcome.
- I found no confirmation that Start-hold works under Steam Game Mode's gamescope.

## Q2. ES-DE: should we fork it to add native RomM support?

### Takeaway
ES-DE is MIT-licensed (desktop), very actively developed, ships an aarch64 AppImage and has the most polished gamepad UI. Upstream explicitly does not accept C++ collaboration and has no plugin API, so RomM support would mean a permanent hard fork of a large C++ codebase. That fork would also be chasing an in-progress 4.0 line.

### Cited Findings
- **License.** ES-DE is "released under the MIT open source license"; the Android version is paid and "partially closed source". LICENSE copyright: "2024-2026 Northwestern Software AB; 2020-2024 Leon Styhre; 2014 Alec Lofquist". — [FAQ.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/FAQ.md), [LICENSE](https://gitlab.com/es-de/emulationstation-de/-/blob/master/LICENSE)
- **Releases.** v3.5.0 (2026-09-30) and v3.4.1 (2026-04-10) both include `ES-DE_aarch64.AppImage`. v3.4.0 (2025-11-07) did not. — [GitLab releases API](https://gitlab.com/api/v4/projects/es-de%2Femulationstation-de/releases)
- **aarch64 support.** The changelog says ES-DE "adds official (although experimental) support for Linux on AArch64, which is aiming for operating systems such as the upcoming SteamOS release for ARM". — [CHANGELOG.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/CHANGELOG.md)
- **Activity.** There were 100+ commits between 2026-07-08 and 2026-10-08, by Leon Styhre. On 2026-10-05: "Bumped the version to 4.0.0-alpha". — [GitLab commits API](https://gitlab.com/es-de/emulationstation-de/-/commits/master)
- **Upstream stance.** CONTRIBUTING: "Note that we are however not looking for collaborating on the C++ development at this moment in time." Suggested contributions instead include "Creating third party applications and scripts to be used with ES-DE". — [CONTRIBUTING.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/CONTRIBUTING.md)
- **Same stance reported elsewhere.** A 2025-12-09 comment in RomM discussion #1665 says ES-DE does not accept third-party contributions and that the Android code is partly closed. — [rommapp/romm discussion #1665](https://github.com/rommapp/romm/discussions/1665)
- **RomM request.** Issue #2046, "Feature Request: Romm as a metadata provider", was opened on 2026-01-11 with labels Feature and Idea. It is still open, and no maintainer reply was visible to unauthenticated API access. — [ES-DE issue #2046](https://gitlab.com/es-de/emulationstation-de/-/issues/2046)
- **Roadmap.** It lists RetroAchievements, a bulk metadata editor, background music, a bgfx renderer, a new texture/cache manager and more. It has no RomM, plugin or remote-library item. — [ROADMAP.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/ROADMAP.md)
- **3.5.0 events.** 3.5.0 added "a 'Run browsing events as non-blocking' menu option" and "mediaviewer-start and mediaviewer-end custom events". These are still script hooks, not a UI extension API. — [CHANGELOG.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/CHANGELOG.md)
- **Existing download code.**
  - The theme downloader uses Git (libgit2), and its downloads cannot be aborted.
  - A built-in application updater downloads and upgrades Linux AppImages.

  These are code paths with download/progress UI that a fork could reuse. — [USERGUIDE.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/USERGUIDE.md)
- **Steam games.** On desktop, "the import rules for most systems rely on shortcut files, so to for example import your Steam games into ES-DE you first need to create such shortcut files from within Steam". — [USERGUIDE.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/USERGUIDE.md)
- **Exit hotkeys.** The FAQ says ES-DE "does not perform any emulator configuration", so users must configure an exit combination per emulator or use a third-party tool. — [FAQ.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/FAQ.md)

### Inferences
- **Fork effort.** A RomM-native ES-DE fork would need a C++ RomM API client, a "remote/not-downloaded" game state in the gamelist model, a non-blocking download manager with a progress component, save-sync hooks around launch, and Steam import. Each touches core C++ (es-app/es-core) rather than a plugin layer. The fork would also have to keep rebasing on the 4.0 changes with no upstream cooperation.
- **Agent feasibility.** An agent could write this code, but verifying UI and rendering changes without a device is harder than in RomMix (no browser preview or fake-server harness was found). C++ build breakage on aarch64 is also likely to cost CI iterations.
- **ES-DE stays useful.** Its `es_find_rules.xml` and `es_systems.xml` are a de facto emulator catalogue. Gameflow Deck, RomMix's `systemOverrides` and Tender all lean on ES-DE system and find-rule data (see Q6/Q7).

### Gaps
- I couldn't read issue #2046's comments (authentication needed), so there may be a maintainer response I didn't see.
- I didn't measure ES-DE's LOC.

## Q3. Pegasus Frontend: is it still maintained in 2026, and is it a viable base?

### Takeaway
Pegasus is alive but in low-intensity maintenance. It is a single-maintainer Qt5/QML project with no tagged release since October 2024 and no generic aarch64 Linux desktop build. Its QML theming is excellent, but providers are compiled C++ and a Qt6 port is still unresolved. It is a poor base for an AI-driven project.

### Cited Findings
- **Repo stats.** GPLv3 (the README says GPLv3; GitHub shows NOASSERTION), C++, 1,905 stars, last pushed 2026-10-04, 149 open issues. — [GitHub API repo](https://api.github.com/repos/mmatyas/pegasus-frontend), [README](https://github.com/mmatyas/pegasus-frontend)
- **Contributors.** mmatyas has 1,940 commits; the next contributor has 5. — [contributors API](https://api.github.com/repos/mmatyas/pegasus-frontend/contributors)
- **Activity.** 7 commits in H1 2026 and 8 between 2026-07-08 and 2026-10-08. Recent commits:
  - "fixes to support gcc 16" (2026-10-02)
  - "add game slugs and playtime support" (2026-09-15)
  - metadata caching by a community contributor (2026-07-18)
  - "Updated to SDL 2.32.10" (2026-04-12)

  — [commits feed](https://github.com/mmatyas/pegasus-frontend/commits/master)
- **Releases.** The last tagged weekly is `weekly_2024w38` (2024-10-05). A `continuous` pre-release was updated on 2026-09-15 (alpha16-106). Its assets are Android APKs, `x11-static.zip`, Odroid and Raspberry Pi static builds, Windows, and an amd64 .deb. There is no generic aarch64 Linux desktop build. — [releases](https://github.com/mmatyas/pegasus-frontend/releases), [continuous](https://github.com/mmatyas/pegasus-frontend/releases/tag/continuous)
- **Build dependencies.** "Qt 5.15.0 or later" (QML/QtQuick2, Multimedia, SVG, SQL) and SDL2 or Qt Gamepad. — [README](https://github.com/mmatyas/pegasus-frontend)
- **Qt 6.** Issue #1167 "Qt 6 port" (opened 2025-09-16) is still open. Issue #1188, an offer of a Qt6 port, was closed on 2026-09-04. — [#1167](https://github.com/mmatyas/pegasus-frontend/issues/1167), [#1188](https://github.com/mmatyas/pegasus-frontend/issues/1188)
- **Theming.** "themes can completely change everything that is on the screen", and Pegasus offers "ES2 backward compatibility". — [README](https://github.com/mmatyas/pegasus-frontend)
- **Steam.** Built-in support for importing games from installed Steam libraries. — [Pegasus docs: Getting started](https://pegasus-frontend.org/docs/user-guide/getting-started/)
- **RomM.** RomM discussion #1665 rates Pegasus 🟠 (concerns), with the idea being only to "generate a metadata.pegasus.txt file". — [discussion #1665](https://github.com/rommapp/romm/discussions/1665)

### Inferences
- Adding RomM on-demand downloads would need a new C++ provider plus QML API for download state and progress, inside a Qt5 codebase that may need a Qt6 port soon. Fedora's Qt5 lifetime is a looming risk for this.
- There's no generic aarch64 release, so the agent would also own aarch64 Qt builds.
- A metadata-export-only route (RomM to metadata.pegasus.txt) would just recreate the user's current ES-DE placeholder hack in a different frontend.

### Gaps
- I didn't confirm whether the rpi4 static build is aarch64, or whether it would run under gamescope.

## Q4. OpenGamepadUI (ShadowBlip): plugin system, aarch64, gamescope, and a RomM plugin?

### Takeaway
OpenGamepadUI (OGUI) is GPL-3.0 and built on Godot 4 (GDScript plus Rust extensions). It now ships aarch64 RPMs, sysext images and tarballs (since v0.45.1, July 2026), and it has a real plugin/library-provider API with install-progress signals and an official Steam library plugin. There is **no RomM plugin**. OGUI also expects to own the gamescope session, or to run Steam beneath it in overlay mode, rather than run as an app inside Steam Game Mode. It still calls itself "very early stages".

### Cited Findings
- **Repo stats.** GPL-3.0, GDScript, 979 stars, last pushed 2026-10-06, 101 open issues. — [GitHub API repo](https://api.github.com/repos/ShadowBlip/OpenGamepadUI)
- **Contributors.** ShadowApex 834, semantic-release-bot 184, pastaq 164, then single digits. — [contributors API](https://api.github.com/repos/ShadowBlip/OpenGamepadUI/contributors)
- **Activity.** 25 commits in H1 2026 and 25 commits between 2026-07-08 and 2026-10-08. The last commit was 2026-10-06 ("rpm: package the AYANEO 3 udev rule"). — [commits](https://github.com/ShadowBlip/OpenGamepadUI/commits/main)
- **Releases.** v0.46.1 (2026-09-03), v0.46.0 (2026-07-25: "update to Godot v4.7.1 and Rust 1.97.1"), v0.45.1 (2026-07-15) and v0.45.0 (2026-03-28, x86_64 only). From v0.45.1 the assets include `opengamepadui-*.aarch64.rpm`, `opengamepadui-aarch64.raw` (systemd-sysext) and `opengamepadui-aarch64.tar.gz`. — [releases](https://github.com/ShadowBlip/OpenGamepadUI/releases)
- **First aarch64 build.** v0.45.1 notes: "add aarch64 build (4d7a65c)". — [v0.45.1](https://github.com/ShadowBlip/OpenGamepadUI/releases/tag/v0.45.1)
- **README.**
  - "Open Gamepad UI is a free and open source game launcher and overlay written using the Godot Game Engine 4."
  - "NOTE: This project is currently in the very early stages of development."
  - Features: overlay menus, PowerStation TDP, InputPlumber remapping, per-game profiles, "Launch games from multiple sources", artwork download, "Plugin architecture".

  — [README](https://github.com/ShadowBlip/OpenGamepadUI)
- **Plugin system.** Plugins are zip resource packs loaded through `ProjectSettings.load_resource_pack()` and "can be written to modify nearly all aspects of OpenGamepadUI". They can be installed from the in-app store or dropped into `~/.local/share/opengamepadui/plugins`. — [Plugin docs](https://opengamepadui.readthedocs.io/en/latest/documentation/plugins/introduction/)
- **Plugin store registry (2026-10-08).** steam 2.0.0, flathub 2.0.0, steamgriddb 2.0.0, recapture 1.0.0, lutris 2.0.0, sunshine 2.0.0 and ayaneo-modules 1.0.2. There is no RomM or emulator plugin. — [plugins.json](https://raw.githubusercontent.com/ShadowBlip/OpenGamepadUI-plugins/main/plugins.json)
- **Library API.** The `Library` base class defines `install_progressed(item, percent_completed)`, `install_completed`, `uninstall_completed`, `launch_item_added` and `get_library_launch_items()`, and registers automatically with LibraryManager. — [library.gd](https://github.com/ShadowBlip/OpenGamepadUI/blob/main/core/systems/library/library.gd)
- **gamescope.** "Open Gamepad UI works in conjunction with gamescope to manage launching games", and `make run` launches it through gamescope. The Makefile's `debug-overlay` target runs `--overlay-mode -- steam -gamepadui -steamos3 -steampal -steamdeck`. — [Building from source](https://opengamepadui.readthedocs.io/en/latest/documentation/contributing/building_from_source/), [Makefile](https://github.com/ShadowBlip/OpenGamepadUI/blob/main/Makefile)
- **Install methods.** AUR, a SteamOS desktop installer ("will give you the option to switch back to Steam's gaming interface"), NixOS (including `gamescopeSession.enable`), systemd-sysext `.raw`, and tarball. "OpenGamepadUI only works on Linux-based operating systems." — [Installation](https://opengamepadui.readthedocs.io/en/latest/documentation/getting-started/installation/)
- **RomM.** No OGUI–RomM integration turned up in web search, and OGUI is absent from RomM discussion #1665. — [discussion #1665](https://github.com/rommapp/romm/discussions/1665)

### Inferences
- **Steam integration is strongest here.** The official Steam plugin exists, and Steam would run under OGUI in overlay mode.
- **A RomM plugin is a greenfield build.** It would be a Library plugin in GDScript: list RomM ROMs, implement install with `install_progressed`, launch emulators with `LibraryLaunchItem.command`, and add save sync hooks. Emulator mapping and save-path logic would also need writing (RomMix and Grout already have these).
- **Session conflict on armadaOS.** OGUI is designed as the session's focus manager (its own gamescope session, or Steam started underneath it). That conflicts with armadaOS booting into Steam Game Mode, and changing the default session on a bootc image is device/OS work the agent cannot test.
- **Handheld input.** Retroid Pocket Nova support in InputPlumber/PowerStation is unknown. ROCKNIX-derived input drivers may not match InputPlumber's device database.
- **Agent feasibility is medium.** GDScript is learnable and `make test` runs unit tests, but there's no browser preview, and verifying the gamescope and overlay behaviour needs the device.

### Gaps
- I couldn't confirm whether OGUI runs acceptably as a non-Steam app inside Steam's gamescope session, or what InputPlumber does with the RP Nova controls.
- I didn't verify the Godot renderer (Vulkan vs. compatibility) on Turnip/Adreno 740.

## Q5. Grout (rommapp/grout): the official RomM client for Linux handhelds

### Takeaway
Grout is MIT-licensed Go with an SDL2 UI (the gabagool library), very actively maintained by the RomM org, and it ships ROCKNIX, Batocera-arm64, Knulli and muOS packages. It is a **download and save-sync manager, not a launcher**: it puts ROMs in the CFW's folders and leaves launching to the CFW's own frontend. It is a good reference for the RomM API client and save-sync logic, not a frontend base. It also pins RomM versions tightly; v5.3.1.x expects RomM 5.3.1.

### Cited Findings
- **Repo stats.** MIT, Go, 237 stars, last pushed 2026-10-06. Contributors: BrandonKowalski 742, pawndev 117, malkavi 13. There were 100+ commits in both H1 2026 and the last three months. — [GitHub API repo](https://api.github.com/repos/rommapp/grout), [contributors](https://api.github.com/repos/rommapp/grout/contributors)
- **Releases.** v5.3.1.3 (2026-10-06), v5.3.1.2 (2026-10-01) and v5.3.1.1/.0 (2026-09-28). Assets include `Grout-ROCKNIX.zip`, `Grout-Batocera-arm64.zip`, `Grout-Knulli.zip`, `Grout.muxapp`, `Grout.pak.zip` and a bare `grout` binary. — [releases](https://github.com/rommapp/grout/releases)
- **Version pinning.** "The required RomM version matches the first three components of Grout's version number … Grout may still function on older RomM versions, but support will not be provided." — [README](https://github.com/rommapp/grout)
- **Stack.** `github.com/BrandonKowalski/gabagool/v2`, `veandco/go-sdl2`, `holoplot/go-evdev` and `modernc.org/sqlite`, on Go 1.25.6. — [go.mod](https://github.com/rommapp/grout/blob/main/go.mod)
- **Project layout.**
  - `app` holds a finite state machine for screens, and `cfw` holds "all the logic for adapting Grout to the various CFWs".
  - `gamelist` "writes the metadata each frontend reads".
  - `romm` is a handwritten RomM API client ("codegen tools for OpenAPI … weren't compatible").
  - `pspdb` is "Slated for removal in favour of Argosy Sigil".
  - Builds target "ARM64, ARM32, x86 (32-bit), and AMD64 Linux and use Docker for cross-compilation".
  - The CFW env enum includes ROCKNIX and BATOCERA.

  — [Development guide](https://grout.romm.app/contributing/development/)
- **Usage flow.** Connect, then pair (QR "Pair with Another Device" on RomM 5.0+), map platforms to directories, then "Press A to select and download". — [Quick start](https://grout.romm.app/getting-started/), [User guide](https://grout.romm.app/usage/guide/)
- **Save sync.** It is manual ("Press Y … Sync Now"). Decisions are made by the RomM server's sync orchestrator (RomM 4.9+), and conflicts default to Skip. The FAQ says save states "are not currently synced by Grout". — [Save Sync guide](https://grout.romm.app/usage/save-sync/), [FAQ](https://grout.romm.app/usage/faq/)
- **Conflicting description.** RomM's own docs describe Grout as for "muOS and NextUI", syncing "ROMs, saves, and states", and as able to schedule "sync runs: on idle, on session end, or on a cron". This contradicts Grout's docs (manual sync, no states); Grout's own docs are the primary source. — [RomM docs: First-Party Apps](https://docs.romm.app/latest/ecosystem/first-party-apps/) vs. [Grout FAQ](https://grout.romm.app/usage/faq/)
- **ROCKNIX mappings.** The RomM slug to ROCKNIX folder table includes, for example, psx→psx, ps2→ps2, dc→dreamcast and ngc→gamecube. — [Grout ROCKNIX mappings](https://grout.romm.app/platforms/rocknix/)

### Inferences
- **Could it run on armadaOS?** Probably, as an SDL2 app added to Steam as a non-Steam game, using the ROCKNIX CFW mode or a new "armada" CFW adapter. It would still only download and sync, and the UI is styled for small 4:3/16:9 retro-handheld screens.
- **It cannot launch emulators.** No launch feature appears in its docs, so it can't meet the "launcher" goal without bolting on a frontend.
- **Reusable as reference material** under MIT: its RomM client, save-sync orchestration and CFW folder maps, for a TypeScript base.

### Gaps
- I didn't test whether Grout's ROCKNIX package runs on a Fedora/gamescope system.

## Q6. Other RomM desktop/handheld clients: Ludo, Freegosy, Gameflow Deck, romm-sync, romm-client, RomMate

### Takeaway
Several young RomM clients exist, but none matches RomMix on aarch64 packaging and gamepad-first design together.
- **Ludo** (rommapp org, GPL) has both a Decky and a desktop shell, but supports only RetroArch and Eden and is x86_64-only.
- **Freegosy** (Flutter, MIT, popular) is desktop-first and x86_64-only.
- **Gameflow Deck** (AGPL, Bun/React/NW.js) has plugins and reads ES-DE emulator configs, but has no arm64 build.
- **romm-sync** has an aarch64 AppImage, but it is touch-oriented and doesn't launch games.
- **romm-client** is a self-described proof of concept.

### Cited Findings
- **Ludo, from rommapp/ludo.**
  - GitHub search lists it as "Ludo — RomM client for Steam Deck (Decky plugin) and desktop" (Python, 19 stars, pushed 2026-10-06). — [GitHub search API](https://api.github.com/search/repositories?q=romm+decky), [repo](https://github.com/rommapp/ludo)
  - README: GPL-3.0. It browses, downloads, syncs saves and states "on a watchdog rather than a button", and launches "in RetroArch, or in Eden for Switch titles". It is "Gamepad-first".
  - It installs as a Decky zip or an `x86_64.AppImage`. It is built from a shared Python engine, an Electron `desktop` shell and a `decky_plugin` shell, and its desktop tests render "every route … in headless Chromium against a fake backend".
  - It bundles `libsigil.so` (MPL-2.0). The README's install links still point to `Covin90/ludo`.

  — [README](https://github.com/rommapp/ludo)
- **Ludo releases.** v1.0.0-beta.6 through beta.11 shipped between 2026-09-24 and 2026-10-06. The beta.11 assets are `Ludo-v1.0.0-beta.11-decky.zip` and `-x86_64.AppImage`. — [releases](https://github.com/rommapp/ludo/releases)
- **Freegosy.**
  - Repo: MIT, Dart/Flutter, 233 stars, created 2026-03-23, pushed 2026-10-06, 20 open issues. Contributors: abduznik 499, GargIT 48, "claude" 32. — [GitHub API repo](https://api.github.com/repos/abduznik/freegosy), [contributors](https://api.github.com/repos/abduznik/freegosy/contributors)
  - v0.6.1 (2026-09-30) has Linux `x64.tar.gz` and `x86_64.AppImage`, plus macOS and Windows builds. There is no Linux arm64 build. — [releases](https://github.com/abduznik/freegosy/releases)
  - README: inspired by Argosy. Features include RomM browse and download "with real-time progress tracking", RomM 4.9 per-device save sync and play sessions, an emulator download manager, management of 197 RetroArch cores, BIOS, and an SDL GameControllerDB-based controller mapping wizard. A headless `list`/`download`/`launch` mode is "useful for … driving it from an agent/CI". The author says it was built "with AI tools I pay for".

  — [README](https://github.com/abduznik/freegosy)
- **Gameflow Deck.**
  - Repo: AGPL-3.0, TypeScript, 74 stars, created 2026-02-08, pushed 2026-09-30, single contributor (simeonradivoev, 169 commits). — [GitHub API repo](https://api.github.com/repos/simeonradivoev/gameflow-deck)
  - v1.12.1 (2026-09-30) ships only `Gameflow-x86_64.AppImage` and a Windows zip. — [releases](https://github.com/simeonradivoev/gameflow-deck/releases)
  - README:
    - RomM "download, sync and update roms", with "Experimental save syncing".
    - "Automatic Emulator Discovery - Using the configs of the excellent ES-DE".
    - Plugins via the npm package `@simeonradivoev/gameflow-sdk`.
    - Stack: Bun, React, Tailwind/daisyUI, Elysia and webview. "On linux it does ship with NW.js".
    - "Extensively tested with the steam deck". Part of the project was built with AI tools (an OpenAI trial).

  — [README](https://github.com/simeonradivoev/gameflow-deck)
- **romm-sync (davidadrianrg).**
  - Repo: MIT, Kotlin, 2 stars. Contributors: davidadrianrg 110. v0.8.4 (2026-10-05) ships `RomM-Sync-v0.8.4-linux-aarch64.AppImage`, an x86_64 AppImage and an Android APK. — [GitHub API repo](https://api.github.com/repos/davidadrianrg/romm-sync), [releases](https://github.com/davidadrianrg/romm-sync/releases)
  - README (Spanish): the Android UI is built for touch, with "botones grandes y navegación pensada para dedos". The Linux build is a Compose Desktop AppImage with a bundled Java runtime (~70 MB). It has a download queue with resume and hash check, save sync via RomM's Device Sync Protocol (4.9+), and ES-DE `gamelist.xml` and media export. No game launching is described.

  — [README](https://github.com/davidadrianrg/romm-sync)
- **romm-client (chaun14).**
  - Repo: MIT, TypeScript/Electron, 50 stars, single contributor (88 commits). v1.2.0 (2026-09-04) is the first release with a Linux `x86_64.AppImage`. — [GitHub API repo](https://api.github.com/repos/chaun14/romm-client), [releases](https://github.com/chaun14/romm-client/releases)
  - README: "IT IS REALLY EARLY STAGE, PLEASE CONSIDER IT AS A PROOF OF CONCEPT". Supported emulators are PPSSPP, PCSX2, Dolphin and Azahar (the last three beta), plus EmulatorJS. — [README](https://github.com/chaun14/romm-client)
- **RomMate (brenoprata10).** TypeScript, 87 stars, last pushed 2026-08-17. app-v0.2.1 (2026-07-23) ships x86_64 rpm, deb and AppImage, plus an aarch64 build for macOS only. It is a "Desktop app for browsing your collection". — [GitHub API repo](https://api.github.com/repos/brenoprata10/rommate), [RomM README](https://github.com/rommapp/romm/blob/master/README.md)

### Inferences
- **Ludo** is the most interesting secondary option. It sits in the RomM org (so it may become first-party), offers a dual Decky and desktop shell, and is gamepad-first. Its emulator scope (RetroArch and Eden) and x86_64-only packaging would need work, and the Python-engine-plus-Electron architecture is heavier to extend than RomMix's single TS codebase.
- **Freegosy** would need a Linux arm64 Flutter build, which Flutter supports on an arm64 host. Its desktop/mouse-first UI would need a gamepad-first redesign; its headless mode is attractive for agent testing.
- **Gameflow Deck**'s AGPL license and NW.js dependency make an aarch64 port harder. NW.js publishes no official linux-arm64 build, so it would have to drop to system WebKitGTK or Chromium. This is an inference I didn't verify.
- **romm-sync** could replace the user's Python placeholder generator for the ES-DE gamelist and media, but it is not a launcher.

### Gaps
- I couldn't confirm Ludo's creation date, contributor list or whether it is officially "first-party". The GitHub API rate limit was exhausted, and RomM's first-party page (dated 2026-09-12) doesn't list it.

## Q7. "Use Steam's UI as the frontend": Decky plugins (Tender, Ludo-Decky, others; RomM-Dock)

### Takeaway
Tender (formerly decky-romm-sync) is the mature Decky route: library to non-Steam shortcuts, downloads with a queue, save sync, BIOS and a custom game page. As shipped, though, downloads **require RetroDECK**, which is x86_64-only on Flathub, and it needs RomM >= 5.3.0. On the aarch64 Nova it would need a fork that supports standalone or Flatpak aarch64 emulators. "RomM-Dock" could not be found.

### Cited Findings
- **Repo history.** `danielcopper/decky-romm-sync` now redirects to `danielcopper/romm-tender` (GPL-3.0, Python, 187 stars, last pushed 2026-10-08). Contributors: danielcopper 947, renovate[bot] 104, cupajoe24 3. — [GitHub API](https://api.github.com/repos/danielcopper/decky-romm-sync), [contributors](https://api.github.com/repos/danielcopper/romm-tender/contributors)
- **`cupajoe24/romm-tender`** is a 0-star copy with the same description. Its owner has 3 commits upstream. — [GitHub API](https://api.github.com/repos/cupajoe24/romm-tender)
- **Releases.** tender-v0.33.0 (2026-09-14), v0.32.0 (2026-09-08), v0.31.0 (2026-08-16) and decky-romm-sync-v0.30.1 (2026-08-10). The README calls v0.33.0 "the last one published with a plugin zip". 100+ commits landed in the last three months. — [releases](https://github.com/danielcopper/romm-tender/releases), [README](https://github.com/danielcopper/romm-tender)
- **README.**
  - It syncs RomM "into Steam as non-steam shortcuts" that "launch through RetroDECK".
  - It offers save sync "before launch and after you quit", "ROM downloads — Download on demand with progress, pause/resume/cancel, and a managed queue", BIOS management, and a game detail page that "Replaces Steam's page".
  - Requirements: "RomM … version 5.3.0 or newer (the plugin stays inert against older servers)" and "RetroDECK for launching games".
  - It is "Not on the Decky store" because "The store doesn't accept plugins whose code is written with AI assistance".
  - "The code is written by an AI coding agent working under my direction."

  — [README](https://github.com/danielcopper/romm-tender)
- **Docs.**
  - "A download needs RetroDECK. Download is refused … while RetroDECK is not installed".
  - Emulator sources detected are "RetroDECK, EmuDeck, a RetroArch of its own".
  - "Steam's TerminateApp cannot reach a portal-started flatpak, so the kill is backend-side".

  — [Managing games](https://danielcopper.github.io/romm-tender/user-guide/managing-games/), [Configuration](https://danielcopper.github.io/romm-tender/user-guide/configuration/), [Backend architecture](https://danielcopper.github.io/romm-tender/architecture/backend-architecture/)
- **RetroDECK architecture.** Flathub lists `net.retrodeck.retrodeck` as `["x86_64"]` only. — [Flathub API](https://flathub.org/api/v2/summary/net.retrodeck.retrodeck)
- **Other Decky RomM plugins (all 0 stars).**
  - AshleyWragg/decky-romm (pushed 2026-09-11; "download ROMs into EmuDeck folders")
  - codetakki/decky-romm-client (2026-03-04)
  - T3rtiary03/DeckRomMSync-Decky-Plugin (2026-01-23)

  — [GitHub search API](https://api.github.com/search/repositories?q=romm+decky), [DeckRommSync search](https://api.github.com/search/repositories?q=DeckRommSync)
- **Ludo** also ships a Decky zip (see Q6). — [Ludo releases](https://github.com/rommapp/ludo/releases)
- **"RomM-Dock".** Neither GitHub repo search nor web search found anything by this name. — [GitHub search API](https://api.github.com/search/repositories?q=romm+dock+decky)

### Inferences
- **This is the "baseline" route.** It gets Steam games for free, along with the Steam overlay, QAM and Decky, but the user dislikes the SteamOS UI.
- **Making Tender work on the Nova** means:
  - upgrading RomM to 5.3.x
  - forking Tender to download without RetroDECK and launch Armada Store AppImages/flatpaks
  - accepting Steam's library UI with 4,206 ROMs as shortcuts

  Tender's AI-agent-written, test-heavy codebase (SonarCloud and coverage badges) suits further AI development.
- **A hybrid is possible.** A RomMix-based frontend could *also* export shortcuts to Steam, copying Tender's shortcut-writing approach, so games remain launchable from Steam's UI.

### Gaps
- I didn't verify that Decky plugin backends (Python) run unmodified on armadaOS's aarch64 Decky.

## Q8. RetroDECK / EmuDeck tooling, and aarch64 emulator availability

### Takeaway
RetroDECK and EmuDeck have no shipped RomM integration. RetroDECK is x86_64-only on Flathub, so anything built on RetroDECK (Tender downloads, Ludo's and RomMix's RetroDECK paths) won't work on the Nova. The standalone aarch64 Flatpaks the user already uses are available.

### Cited Findings
- **RetroDECK repo.** GPL-3.0, Shell, 1,277 stars. 0.10.10b was released on 2026-10-03, and `XargonWan/RetroDECK` redirects to `RetroDECK/RetroDECK`. — [GitHub API](https://api.github.com/repos/RetroDECK/RetroDECK), [releases](https://github.com/RetroDECK/RetroDECK/releases)
- **RetroDECK architecture.** Flathub lists it as x86_64 only. — [Flathub API](https://flathub.org/api/v2/summary/net.retrodeck.retrodeck)
- **aarch64 emulator Flatpaks.** Flathub publishes x86_64 **and aarch64** builds for:
  - `org.libretro.RetroArch` — [Flathub](https://flathub.org/api/v2/summary/org.libretro.RetroArch)
  - `org.duckstation.DuckStation` — [Flathub](https://flathub.org/api/v2/summary/org.duckstation.DuckStation)
  - `org.ppsspp.PPSSPP` — [Flathub](https://flathub.org/api/v2/summary/org.ppsspp.PPSSPP)
  - `org.DolphinEmu.dolphin-emu` — [Flathub](https://flathub.org/api/v2/summary/org.DolphinEmu.dolphin-emu)
  - `org.flycast.Flycast` — [Flathub](https://flathub.org/api/v2/summary/org.flycast.Flycast)
- **RetroDECK and RomM.** A community thread says users are still waiting for the "fabled" RomM integration. This is a low-quality forum source with an unclear date. — [Lemmy post via scribe.disroot.org](https://scribe.disroot.org/post/8922190)
- **SteamOS in discussion #1665.** RomM's integration tracker rates SteamOS 🔴 with the note "Simpler to integrate via RetroDECK". — [discussion #1665](https://github.com/rommapp/romm/discussions/1665)
- **EmuDeck.** GPL-3.0, Shell, 3,502 stars. Its latest tag is "2.7EA" (2026-09-14); the prior tag was 2.3.8 (2025-01-22). Search found no RomM integration. — [GitHub API](https://api.github.com/repos/dragoonDorise/EmuDeck), [releases](https://github.com/dragoonDorise/EmuDeck/releases)

### Inferences
- Any base chosen must launch the Armada Store AppImages/flatpaks directly rather than through RetroDECK or EmuDeck.

### Gaps
- I didn't check whether ARMSX2 is on Flathub; the Armada Store may package it separately.

## Q9. Reference projects: Lutris, Heroic, Cartridges, Playnite RomM plugin, Argosy

### Takeaway
None of Lutris, Heroic or Cartridges has a RomM integration or a gamepad-first UI suitable as a base. Playnite's RomM plugin (Windows) and Argosy (Android) are the UX references for "install on demand" and "Argosy-like".

### Cited Findings
- **Lutris.** GPL-3.0, Python, 10,299 stars, last pushed 2026-10-06. — [GitHub API](https://api.github.com/repos/lutris/lutris)
- **Lutris and RomM.** Discussion #1665 lists Lutris as a 🟢 plugin target, and reportedly a maintainer said in May 2025 that a proof of concept exists. This comes from a summarised read of the discussion and is unverified. — [discussion #1665](https://github.com/rommapp/romm/discussions/1665)
- **OGUI's Lutris plugin.** OGUI has a Lutris library plugin (v2.0.0). — [OGUI plugins.json](https://raw.githubusercontent.com/ShadowBlip/OpenGamepadUI-plugins/main/plugins.json)
- **Heroic.** GPL-3.0, TypeScript, 12,367 stars, last pushed 2026-10-08. It describes itself as "A games launcher for GOG, Amazon and Epic Games". — [GitHub API](https://api.github.com/repos/Heroic-Games-Launcher/HeroicGamesLauncher)
- **Cartridges.** The GitHub repo is archived and "Mirrored from https://codeberg.org/kramo/cartridges" (GPL-3.0, Python). — [GitHub API](https://api.github.com/repos/kra-mo/cartridges)
- **Playnite plugin.** GPL-3.0, C#. 0.9.0 was released on 2026-09-16. It "Downloads a ROM on demand when you click Install in Playnite" and "Launches via your configured emulator". — [GitHub API](https://api.github.com/repos/rommapp/playnite-plugin), [RomM docs: First-Party Apps](https://docs.romm.app/latest/ecosystem/first-party-apps/)
- **Argosy repo.** GPL-3.0, Kotlin, 628 stars. v2.19.4 was released on 2026-10-04 with arm64, arm32 and universal APKs. — [GitHub API](https://api.github.com/repos/rommapp/argosy-launcher), [releases](https://github.com/rommapp/argosy-launcher/releases)
- **Argosy README.**
  - "A gamepad-first Android launcher … with native RomM integration".
  - It offers a download queue, bidirectional save sync, collections and an L3 Quick Menu / R3 Quick Settings.
  - Its "Steam Games" feature indexes and launches "Steam games installed via GameHub or GameNative".
  - Its requirement is Android 8.0+.

  — [README](https://github.com/rommapp/argosy-launcher)

### Inferences
- **Argosy itself can't run on armadaOS.** It is Android-only Kotlin/Jetpack Compose. Porting it to Compose Desktop would be a rewrite of Android-specific layers, and RomMix already offers the Linux equivalent.
- **Argosy as a design spec.** Its feature list (Quick Menu, Quick Settings, smart collections) is a good spec for UI work on top of RomMix.

### Gaps
- I didn't check Heroic's arm64 Linux packaging or Cartridges' Codeberg activity. Both are only reference projects.

## Q10. ROCKNIX, Batocera, Knulli and muOS RomM integrations

### Takeaway
Grout packages are the only shipped RomM integration for these distros: ROCKNIX, Batocera arm64/x86/amd64, Knulli and muOS. The distros themselves have no built-in RomM client; RomM's tracker lists them as "targeted".

### Cited Findings
- **Grout packages.** Grout releases ship `Grout-ROCKNIX.zip`, `Grout-Batocera-arm64.zip`, `Grout-Knulli.zip` and `Grout.muxapp` (muOS). — [Grout releases](https://github.com/rommapp/grout/releases)
- **Discussion #1665 statuses.** ROCKNIX, Batocera and Knulli are 🟢 targeted ("on-device sync and push-pull"/"sync service"). A Nov 2025 comment mentions a "RomManager" project by Markomas for ROCKNIX in development. muOS shows a client under development, with Mortar having a beta. — [discussion #1665](https://github.com/rommapp/romm/discussions/1665)
- **Batocera.** Web search found no Batocera-native RomM integration. — [WebSearch result: Batocera wiki](https://wiki.batocera.org/add_games_bios)
- **ROCKNIX distribution repo.** Pushed 2026-10-08. — [GitHub API](https://api.github.com/repos/ROCKNIX/distribution)

### Inferences
- These distro integrations don't transfer directly to armadaOS. Although armadaOS uses ROCKNIX device support, its userland (Fedora bootc, Steam/gamescope) differs from ROCKNIX's ES-based frontend.

### Gaps
- I couldn't find a public repo for "RomManager" by Markomas.

## Q11. Ranked shortlist and recommended base

### Takeaway
**Recommended base: fork (or contribute to) RomMix.** Treat it as the frontend, keep running it inside Steam Game Mode as a non-Steam game, and add three pieces:
1. emulator descriptors for the Armada Store's aarch64 emulators
2. a Steam library provider (read local appmanifests, launch via `steam://rungameid/`)
3. optionally, Tender-style Steam shortcut export

It already provides most of the Argosy-like feature set on aarch64, with the best test and preview harness for an agent with no device or LAN access, under MIT.

### Cited Findings
- **RomMix** has arm64 AppImages, gamescope and Steam launch support, downloads with pause/resume/hash, two-way save/state sync, offline mode, a pluggable emulator registry, themes, browser preview, a fake-RomM app test suite, and minimum RomM 5.0.0. — [RomMix README](https://github.com/leclercb/rommix), [CONTRIBUTING.md](https://github.com/leclercb/rommix/blob/main/CONTRIBUTING.md), [version.ts](https://github.com/leclercb/rommix/blob/main/src/main/romm/version.ts)
- **OGUI** has aarch64 RPM/sysext builds since v0.45.1, a Library API with `install_progressed`, an official Steam plugin and no RomM plugin. — [OGUI releases](https://github.com/ShadowBlip/OpenGamepadUI/releases), [library.gd](https://github.com/ShadowBlip/OpenGamepadUI/blob/main/core/systems/library/library.gd), [plugins.json](https://raw.githubusercontent.com/ShadowBlip/OpenGamepadUI-plugins/main/plugins.json)
- **ES-DE** is MIT with an aarch64 AppImage, but "not looking for collaborating on the C++ development". — [CONTRIBUTING.md](https://gitlab.com/es-de/emulationstation-de/-/blob/master/CONTRIBUTING.md)
- **Tender** requires RetroDECK (x86_64-only) and RomM >= 5.3.0. — [Tender README](https://github.com/danielcopper/romm-tender), [Flathub RetroDECK](https://flathub.org/api/v2/summary/net.retrodeck.retrodeck)

### Inferences
**Ranked shortlist (best first):**

1. **RomMix fork. Fit: high; agent-doability: high.**
   - License and stack: MIT, TS/Electron/React.
   - Platform: aarch64 AppImage built natively in CI, gamescope-aware, non-Steam-game wrapper included.
   - Already done: gamepad-first UI, download queue and progress, save and state sync.
   - Remaining work, mostly in `src/config/` and agent-testable with preview, unit tests and the fake RomM:
     - add descriptors for DuckStation, ARMSX2, PPSSPP, Dolphin and Flycast (AppImage/Flatpak kinds plus save-path maps)
     - add a Steam library provider
     - tune the layout for 1280x960 at 4:3
     - optional Argosy-style Quick Menu
   - Device-only checks: Turnip rendering, Start-hold exit under gamescope, controller mapping via Steam Input, emulator save paths.
   - Risks: single maintainer, about 7 weeks old, so prefer upstreaming generic changes.
2. **OpenGamepadUI plus a new RomM Library plugin. Fit: medium-high; agent-doability: medium.**
   - Strengths: best "console OS shell" design, a Steam library plugin already exists, aarch64 packages, and plugin progress signals.
   - Weaknesses: RomM support, emulator mapping and save sync must be written from scratch in GDScript. It wants to own the gamescope session, which changes how armadaOS boots (bootc/session work the agent can't test). It is "very early stages", and RP Nova support in InputPlumber is unknown.
3. **Ludo (rommapp/ludo). Fit: medium; agent-doability: medium.**
   - Strengths: GPL-3.0, gamepad-first, Decky plus desktop dual shell, RomM-org backed.
   - Work needed: an aarch64 AppImage build, and emulators beyond RetroArch and Eden. Its Python engine plus Electron shell is heavier to extend than RomMix.
   - It is worth watching because it may become first-party.
4. **Tender fork (Steam UI baseline). Fit: medium; agent-doability: high.**
   - Strengths: most mature RomM-in-Steam feature set, AI-built with tests.
   - Work needed: remove the RetroDECK dependency for aarch64 and upgrade RomM to at least 5.3.0.
   - Weakness: the user dislikes Steam's UI. It is better used as a complement, its shortcut-export logic, than as the main base.
5. **ES-DE hard fork. Fit: medium for UI; agent-doability: low-medium.**
   - Strengths: best-polished UI, and the user already uses it.
   - Weaknesses: no plugin API, no upstream cooperation, a C++ core rewrite for remote, download and progress states, and chasing 4.0-alpha.
   - Keeping ES-DE as a secondary frontend fed by RomMix-downloaded files or romm-sync's gamelist export is cheaper than forking it.
6. **Freegosy / Gameflow Deck. Fit: low-medium.**
   - Freegosy: active and MIT but desktop-first and x86_64-only. It would need a gamepad-first redesign and an arm64 Flutter build.
   - Gameflow Deck: AGPL, x86_64-only, uses NW.js. Useful idea: it reads ES-DE emulator configs.
7. **Pegasus. Fit: low.** It is Qt5, single-maintainer and low-activity, with no tagged release since 2024-10, no generic aarch64 desktop build and compiled providers.
8. **Grout. Fit: low as a base.** It doesn't launch games. Use it as a reference for its MIT RomM client, save-sync orchestration and folder maps, or as a side-by-side download manager.

**Remaining-work split for the RomMix route** (agent = cloud session, no device or LAN):
- **Agent can do fully:**
  - emulator descriptors and launch arguments (from emulator CLI docs)
  - Steam appmanifest/libraryfolders.vdf parsing and `steam://rungameid/` launch
  - Steam shortcut export (port Tender's logic)
  - layout and theme for 4:3, an Argosy-like Quick Menu
  - CI arm64 AppImage releases
  - tests against the fake RomM, which can be extended to mimic RomM 5.2.0 responses
- **Needs user testing on device:**
  - gamescope focus handoff and Start-hold exit
  - Turnip/Electron GPU acceleration
  - controller mapping (Steam Input virtual pad vs. raw pad)
  - real emulator save locations for Armada Store AppImages
  - download throughput from the LAN RomM (2.1 TB library, 4,206 ROMs)

### Gaps
- I haven't checked RomMix against RomM 5.2.0 specifically. Its minimum is 5.0.0, but the Device Sync endpoints it uses may have changed between 5.2 and 5.3.
- I don't know whether the RomMix maintainer would accept large upstream PRs; I found no statement either way.
- No candidate solves the "no unified emulator exit hotkey" problem with certainty. RomMix's Start-hold is the only built-in attempt found and is unverified under Steam Game Mode.
