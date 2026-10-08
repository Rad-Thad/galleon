> Research note copied into the repository at handoff (2026-10-08). Links to `~/Documents/argosy-fork/...` point at the tester's private local Argosy fork, which is not in this repository; see [argosy-fork-design-spec.md](argosy-fork-design-spec.md) for the extracted design.

# UI technology stack for a gamepad-first RomM launcher on aarch64 Linux handhelds under gamescope

Research date: 2026-10-08. Target: Retroid Pocket Nova (QCS8550, Adreno 740, 8 GB RAM, 1280x960 4:3 at 120 Hz), armadaOS (Fedora 44 bootc), Mesa 26.2.3 (Turnip Vulkan and Freedreno GL), X11 via XWayland inside gamescope.

How to read these notes:
- **Evidence** means a primary source (official docs, a repo, release notes, a bug tracker) or a clearly attributed secondary source, cited inline.
- **Opinion/anecdote** is labelled as such (forum posts, vendor blogs, community comments).
- Anything I know from background knowledge but could not verify in this session is kept in **Inferences** (marked "unverified") or **Gaps**, never in Cited Findings.

---

## How do the candidate stacks compare on the stated criteria (packaging, GPU, memory, gamepad, focus, OSK, theming, gamescope, testing, AI codegen, ecosystem, license)?

### Takeaway
No stack wins on every criterion. **Godot 4** has the strongest evidence for gamescope, aarch64 packaging and gamepad input: OpenGamepadUI ships aarch64 RPM, sysext and tarball builds as of July 2026, and Godot 4.5+ uses SDL3 for desktop gamepads. **Flutter** has the strongest headless-testing story and very large training data. Its Linux arm64 deployment is officially supported, but its new Impeller/Vulkan Linux renderer (default since 3.47, August 2026) is unproven on handhelds. **Qt/QML** and **SDL-custom** (ES-DE/Grout lineage) have the deepest ARM-device history. Compose Desktop, Tauri/Electron and the Rust toolkits each have a disqualifying-or-costly gap for this use case.

### Cited Findings

#### Godot 4 (GDScript/C#), the stack OpenGamepadUI uses
- **aarch64 build/packaging**
  - Godot 4.7 docs describe arm64 Linux exports, e.g. for Raspberry Pi 3 and later. They state that official export templates are *not* provided only for rv64, ppc64 and loongarch64, which implies x86_64/arm64/arm32 are provided. — [Godot docs: Exporting for Linux (4.7)](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_linux.html)
  - OpenGamepadUI added an "aarch64 build" in v0.45.1 (2026-07-15). — [OGUI v0.45.1 release](https://github.com/ShadowBlip/OpenGamepadUI/releases/tag/v0.45.1)
  - OGUI v0.46.1 (2026-09-03) ships `opengamepadui-0.46.1-1.aarch64.rpm`, `opengamepadui-aarch64.raw` and `opengamepadui-aarch64.tar.gz` (plus x86_64 equivalents). No Flatpak asset is visible. — [OGUI releases](https://github.com/ShadowBlip/OpenGamepadUI/releases)
  - OGUI v0.46.0 (2026-07-25) moved to Godot 4.7.1 and Rust 1.97.1. — [OGUI releases](https://github.com/ShadowBlip/OpenGamepadUI/releases)
- **Gamepad**
  - Since Godot 4.5, desktop controller support (Windows/macOS/Linux) uses SDL 3 for input only. Controller behaviour "should closely resemble" other SDL3 games. Android/iOS/Web still use the old code. — [Godot 4.5 docs: Controllers, gamepads and joysticks](https://docs.godotengine.org/zh-cn/4.5/tutorials/inputs/controllers_gamepads_joysticks.html); [Godot 4.5 beta 2 blog](https://godotengine.org/article/dev-snapshot-godot-4-5-beta-2/)
  - The SDL3 driver initially lacked some `Input.get_joy_info()` fields (`vendor_id`, `product_id`, etc.). A later fix landed, per a third-party mirror of the Godot repo. — [Godot 4.5 beta 2 blog](https://godotengine.org/article/dev-snapshot-godot-4-5-beta-2/) (fix attribution: mirror only, low confidence)
  - OGUI routes gamepad input through InputPlumber, a ShadowBlip daemon that does remapping and per-game profiles. — [OGUI README](https://github.com/ShadowBlip/OpenGamepadUI)
- **Focus navigation (built in)**
  - Every Control can hold focus. Built-in `ui_up`/`ui_down`/`ui_focus_next` actions move it. Directional focus neighbours can be set per node, and the engine guesses a neighbour when none is set (this "can produce unexpected navigation" in complex layouts). Initial focus must be grabbed in code. — [Godot 4.7 docs: Keyboard/controller navigation and focus](https://docs.godotengine.org/en/stable/tutorials/ui/gui_navigation.html)
- **Testing CLI**
  - `--headless` equals `--display-driver headless --audio-driver Dummy`.
  - `--rendering-method` accepts `forward_plus`, `mobile` or `gl_compatibility`.
  - `--write-movie` writes a movie (.avi or .png).
  - `--fixed-fps` disables real-time sync. `--quit-after N` quits after N iterations.
  - Source: [Godot 4.7 command-line docs](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)
- **Gamescope**: OGUI is designed to run "hand-in-hand with Gamescope" and lists gamescope as a required dependency. — [OGUI installation docs](https://opengamepadui.readthedocs.io/en/latest/getting_started/installation/index.html)
- **License**: the Godot engine is MIT (background, unverified here). OpenGamepadUI is GPLv3+. — [OGUI README](https://github.com/ShadowBlip/OpenGamepadUI)
- **AI codegen (anecdote and vendor claims)**
  - Several sources report that LLMs emit Godot 3 syntax when asked for Godot 4, e.g. `yield` instead of `await`, `export var` instead of `@export`, `KinematicBody`, and `move_and_slide(velocity, UP)` with arguments. They attribute this to the public web holding more Godot 3 material. — [Summer Engine blog (vendor)](https://www.summerengine.com/blog/best-ai-for-gdscript); [Viblo article](https://viblo.asia/p/tai-sao-chatgpt-viet-code-game-sai-4-loi-pho-bien-voi-gdscript-ZoJje17z4Y7); [Ziva blog (vendor)](https://ziva.sh/blogs/generate-gdscript-with-ai)
  - A self-reported fine-tune ("Godoter") claims its Qwen3.6-27B base scored 80% on easy Godot 4 migration-trap tasks, versus 100% for the fine-tune (small test set). — [Godoter model card](https://friendli.ai/models/Ruler97/Godoter)
  - Summer Engine (vendor opinion) says Claude Opus "drifts into Godot 3 patterns the least" but "no model drifts never". — [Summer Engine](https://www.summerengine.com/blog/best-ai-for-gdscript)

#### Qt 6 / QML, the stack Pegasus uses
- **Pegasus status**
  - Pegasus requires **Qt 5.15+** (the repo is tagged qt5) and is GPLv3.
  - Gamepad input uses SDL2 (2.0.4+) or Qt Gamepad.
  - It claims to run on "Windows, Linux, Mac, Android, all Raspberries, Odroids".
  - CI badges are CircleCI and AppVeyor. Tests run via `make check`.
  - Source: [pegasus-frontend repo](https://github.com/mmatyas/pegasus-frontend)
  - A fork would therefore start with a Qt5-to-Qt6 port.
- **Gamepad in Qt 6**: Qt Gamepad was never shipped for Qt 6. In May 2025 Qt maintainers said it lacks CI coverage outside Qt 6 and suggested building it out of tree. A KDAB developer said most people use "qtgamepadlegacy". — [Qt development list, May 2025](https://lists.qt-project.org/pipermail/development/2025-May/046342.html); [KDE Kirogi issue](https://invent.kde.org/utilities/kirogi/-/issues/25)
  - Practical consequence: use SDL for gamepad input, as Pegasus already can.
- **OSK**: Qt Virtual Keyboard is available under a commercial license or GPLv3 (SPDX: `LicenseRef-Qt-Commercial OR GPL-3.0-only WITH Qt-GPL-exception-1.0`). — [Qt Virtual Keyboard docs (6.2)](https://doc.qt.io/qt-6.2/qtvirtualkeyboard-index.html); [qtvirtualkeyboard conanfile](https://code.qt.io/cgit/qt/qtvirtualkeyboard.git/tree/conanfile.py?h=6.4.3)
- **ARM handheld packaging precedent**: PortMaster ships Qt6 as a separate aarch64 runtime because the libraries are "+150mb big", and documents compiling Qt6 for aarch64. — [PortMaster porting docs](https://portmaster.games/porting.html)
- **Steam Deck**: EmuDeck 2.2 (March 2024) added Pegasus as a frontend option on SteamOS. — [GamingOnLinux](https://www.gamingonlinux.com/2024/03/emudeck-2-2-adds-a-new-pegasus-frontend-better-linux-support-new-emulators/)

#### Flutter (Linux desktop)
- **arm64 deployment**: Flutter 3.47 (docs updated 2026-09-22) lists Linux deployment for **x64 and Arm64**. Supported targets are Debian 10–13 and Ubuntu 20.04–24.04 LTS. CI tests Debian 12 and Ubuntu 22.04. **Fedora is not listed.** — [Flutter supported platforms](https://docs.flutter.dev/reference/supported-platforms)
- **Renderer**: Flutter 3.47 (stable 2026-08-12) makes **Impeller the default renderer on Linux, using Vulkan**, with shaders compiled ahead of time. You can opt out via `fl_dart_project_set_enable_impeller(project, FALSE)` in `my_application.cc`. — [What's new in Flutter 3.47 (official blog)](https://flutter.dev/blog/whats-new-in-flutter-3-47); [startdebugging.net summary](https://startdebugging.net/2026/08/flutter-3-47-impeller-default-renderer-on-desktop/)
  - Secondary sources say the opt-out will be removed in a future release (not confirmed in the official excerpt). — [startdebugging.net](https://startdebugging.net/2026/08/flutter-3-47-impeller-default-renderer-on-desktop/)
  - In February 2026, Windows and Linux Impeller were "still in progress", so Linux Impeller is about 2 months old in stable as of this writing. — [Ditto blog, Feb 2026](https://www.ditto.com/blog/the-future-is-bright-for-flutter-in-2026)
- **Gamepad**: the `gamepads` plugin (flame-engine) lists Linux as supported.
  - It normalizes input using a bundled copy of SDL's GameController DB (1,500+ entries), matched by vendor/product ID, and falls back to an Xbox layout for unknown pads.
  - Extra mappings can be loaded at runtime. The Linux implementation package `gamepads_linux` is at 0.1.2.
  - Sources: [gamepads docs](https://pub.dev/documentation/gamepads/latest/); [gamepads_linux](https://pub.dev/packages/gamepads_linux)
- **Golden tests**: `matchesGoldenFile` compares against stored PNGs, and `flutter test --update-goldens` regenerates them.
  - The default test font is Ahem, which renders boxes.
  - Custom fonts "may render differently across different platforms, or between different versions of Flutter".
  - Source: [matchesGoldenFile API docs](https://api.flutter.dev/flutter/flutter_test/matchesGoldenFile.html)

#### Compose Multiplatform Desktop (Kotlin/JVM, Skia via Skiko)
- **Platform status**: Kotlin's supported-platforms page lists "Desktop (JVM): Stable" with no per-architecture breakdown (page dated 2025-09-10). — [Kotlin Multiplatform supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html)
- **Skiko**: Skiko 0.154.0 (2026-10-05) publishes `skiko-awt-runtime-linux-arm64-0.154.0.jar`. Recent releases add a Skia **Vulkan** backend (#1201) and "Graphite Vulkan" (#1261), without naming platforms. — [Skiko releases](https://github.com/JetBrains/skiko/releases)
- **linux-arm64 trouble reports (community)**
  - Segfaults on Debian ARM under Parallels and on a Raspberry Pi. Works on the Librem 5. Works in UTM/QEMU only with `virtio-gpu-gl-pci`. — [Kotlin Slack thread](https://slack-chats.kotlinlang.org/t/8519917/is-anyone-running-compose-desktop-apps-successfully-on-arm64)
  - With Compose 1.11.0-beta01: `UnsatisfiedLinkError` for `libskiko-linux-arm64.so` caused by a missing `libEGL.so.1`, plus an init error on a linux-arm64 CI build. — [Kotlin Slack thread](https://slack-chats.kotlinlang.org/t/33220275/hi-i-just-bumped-from-compose-1-11-0-alpha02-to-1-11-0-beta0)
- **Gamepad**: I found nothing built in on desktop. The JVM options are JNI wrappers, e.g. Jamepad (bundles SDL via JNI and allocates a new state object per `getState` call) or JInput. — [Jamepad](https://jitpack.io/p/loriopatrick/Jamepad)
- **Screenshot tests**: Roborazzi lists Compose Multiplatform Desktop/JVM as supported. Tests run as plain JVM unit tests with no device. — [Roborazzi docs (search index)](https://docsearch.algolia.com/mcp/docs/repo/takahirom/roborazzi) (not fetched in full)
- **Relation to Argosy**: Argosy Launcher (the RomM team's Android client) is Kotlin, GPL-3.0, with v2.16.x current. I did **not** confirm that it uses Jetpack Compose. — [Argosy releases](https://github.com/rommapp/argosy-launcher/releases); [gittrend summary](https://gittrend.io/repo/rommapp/argosy-launcher)

#### Tauri 2 / Electron (web UI with the Gamepad API)
- **Tauri on Linux renders through WebKitGTK**. Tauri's own docs warn about driver conflicts ("blank window to subtle rendering problems", mostly on NVIDIA).
  - WebGL/canvas can fall onto a slow path silently, showing up as high input latency or low frame rates. WebKitGTK reports a generic WebGL renderer string, so this is hard to detect.
  - The workarounds (disabling the DMABUF renderer, disabling compositing) cost performance.
  - Source: [Tauri: Linux graphics issues](https://v2.tauri.app/develop/debug/linux-graphics/)
- **WebKitGTK on ARM (old reports)**
  - 2018: hardware-accelerated CSS animations did not run on an ARM board (WebKitGTK 2.20.3) and were choppy with compositing disabled. — [webkit-gtk list, Aug 2018](https://lists.webkit.org/pipermail/webkit-gtk/2018-August/003348.html)
  - 2018: opacity animations were slow on ARM because of cairo group calls. — [WebKit bug 192969](https://bugs.webkit.org/show_bug.cgi?id=192969)
  - 2023 (not ARM-specific): slow CSS animations with dropped frames, still NEW. — [WebKit bug 265048](https://bugs.webkit.org/show_bug.cgi?id=265048)
- **Gamepad API in WebKitGTK**: implemented via libmanette, with `ENABLE_GAMEPAD` on by default since October 2020 (r268725). libmanette maps devices to the W3C standard gamepad layout. — [WebKit r268725](https://trac.webkit.org/r268725); [webkit-gtk list, Oct 2020](https://lists.webkit.org/pipermail/webkit-gtk/2020-October/003641.html); [libmanette docs](https://aplazas.pages.gitlab.gnome.org/libmanette)
- **Tauri AppImage**: build on the oldest base you intend to support that ships WebKitGTK 4.1 (examples: Ubuntu 22.04, Debian 12), because building on a newer base raises the minimum glibc. — [Tauri AppImage docs](https://v2.tauri.app/distribute/appimage/) (read via the localized mirror [de](https://v2.tauri.app/de/distribute/appimage/))
- **Memory (Linux, dated)**: the Tauri issue #5889 thread re-measured default apps on Ubuntu 22.04.1.
  - Idle: Electron 118 MB USS / 207 MB PSS; Tauri 125 MB USS / 185 MB PSS.
  - With heavy pages loaded, Tauri/WebKit used more (e.g. 581 MB vs 240 MB). The thread disputes Tauri's own "Electron ~500 MB, 2x Tauri" claim.
  - Source: [tauri-apps/tauri#5889](https://github.com/tauri-apps/tauri/issues/5889)
  - Blog figures of "Tauri 20–80 MB vs Electron 100–300 MB" are unsourced or Windows-based (opinion). — [tech-insider 2026](https://tech-insider.org/tauri-vs-electron-2026/)
- **Precedent for Chromium UIs under gamescope**: the Steam Deck/Big Picture UI runs in Chromium Embedded Framework. Decky and CSS Loader document CEF remote debugging of the "Steam Big Picture Mode" tab. — [Decky wiki: CEF debugging](https://wiki.deckbrew.xyz/plugin-dev/cef-debugging); [CSS Loader CEF debugger docs](https://docs.deckthemes.com/CSSLoader/Cef_Debugger/)
  - That it is a "React UI" is a secondhand remark quoted by Windows Central, not a Valve statement. — [Windows Central](https://www.windowscentral.com/steam-big-picture-will-look-steam-deck)

#### Rust native UIs (Slint, iced, egui)
- **Slint**
  - Focus is handled through `FocusScope` (key events, `focus()`, tab traversal). I found no Slint gamepad documentation, so controller input would need to be translated into key events. — [Slint FocusScope docs](https://docs.slint.dev/latest/docs/slint/reference/keyboard-input/focusscope/)
  - License options are GPLv3, Royalty-free (desktop/mobile/web apps; requires an AboutSlint widget or a public badge), or paid. The royalty-free text defines "desktop" as a "general-purpose computer (PC or notebook)". Older v1.0.1 text explicitly excluded embedded systems. — [Slint terms](https://slint.dev/terms-and-conditions); [Royalty-free license PDF](https://slint.dev/agreements/slint-royalty-free-license.pdf); [Royalty-free v1.0.1 text](https://open.windriver.com/info/uni-license-list/licenses/slint-royalty-free-1.0.html)
  - The Slint repo has a `tests/screenshots` harness used with the software renderer. — [Slint repo mirror, tests/screenshots/testing.rs history](https://git.joshthomas.dev/language-servers/slint/commits/branch/olivier/cpp2/tests/screenshots/testing.rs)
- **egui**: `egui_kittest` supports image snapshot tests with the `snapshot` + `wgpu` features.
  - Thresholds live in `kittest.toml`, with per-OS sections; the default threshold is 0.6.
  - `UPDATE_SNAPSHOTS=true` regenerates snapshots.
  - Its docs call image comparisons "slower and fragile".
  - Source: [egui_kittest docs](https://docs.rs/egui_kittest)
- **iced**: no relevant sources found (see Gaps).

#### SDL2/SDL3 with a custom UI (Grout, ES-DE, many CFW apps)
- **Grout** (the RomM team's handheld client) is Go, MIT.
  - Direct dependencies include `BrandonKowalski/gabagool/v2` v2.26.4, `holoplot/go-evdev`, `modernc.org/sqlite` v1.54.0 and `bodgit/sevenzip`. `veandco/go-sdl2` v0.4.40 is indirect. Go is 1.25.6.
  - Sources: [grout go.mod](https://raw.githubusercontent.com/rommapp/grout/main/go.mod); [RomM first-party apps](https://docs.romm.app/4.9.0/ecosystem/first-party-apps/)
  - The repo has a `test/e2e` directory. — [rommapp/grout](https://github.com/rommapp/grout)
- **gabagool** is "A Go-based UI library for building graphical interfaces on retro gaming handhelds that support SDL2" (SDL2, SDL2_image, SDL2_ttf, SDL2_gfx), MIT.
  - Components: lists, on-screen keyboards (QWERTY/URL/numeric/symbols), option lists, dialogs, progress bars, a download manager, a status bar, router-based navigation, and JSON button mapping with chords.
  - Source: [gabagool repo](https://github.com/BrandonKowalski/gabagool)
- **ES-DE**: 3.4.1 (2026-04-10) added "official (although experimental)" Linux AArch64 support and ships separate x86, AArch64 and Steam Deck AppImages, built with appimagetool-uruntime. — [es-de.org](https://www.es-de.org/); [retrohandhelds.gg](https://retrohandhelds.gg/es-de-gets-massive-update-including-xbox-integration-and-much-more/)
- **SDL input on Linux**: SDL2/SDL3 use hidapi for popular controllers and evdev otherwise. SDL2's GameController API needs a `gamecontrollerdb.txt` mapping; SDL3 replaces it with SDL_Gamepad. — [Arch Wiki: Gamepad (mirror, 2026-04)](https://wikipedia.jakami.de/content/archlinux_en_all_maxi_2026-04/Gamepad)

### Inferences
- **Packaging fit for armadaOS (bootc)**: OGUI's `opengamepadui-aarch64.raw` asset alongside an RPM strongly suggests a systemd-sysext image (unverified). That would suit an immutable Fedora bootc system better than AppImage. Flutter's official targets are Debian/Ubuntu only, so a Fedora 44 aarch64 build would be "works, but untested by upstream".
- **Steam Input virtual pads**: in Game Mode, Steam presents a virtual XInput-style pad. Stacks that use SDL's mapping DB should see it as a standard gamepad. That covers Godot 4.5+ (SDL3), SDL-custom, Qt+SDL (Pegasus) and Flutter `gamepads` (SDL DB copy). Web stacks rely on libmanette (WebKitGTK) or Chromium's own mapping. (Inference; not tested.)
- **Focus navigation, built in**: Godot (documented) > Qt Quick (KeyNavigation; background, unverified) ≈ Flutter (directional focus intents; background, unverified) ≈ Compose (FocusDirection; background, unverified) > web (needs a spatial-nav library) > Slint/iced/egui/SDL (mostly DIY; gabagool gives list/menu navigation for SDL in Go).
- **On-screen keyboard**: only Qt ships an official OSK module (GPLv3/commercial), and gabagool ships one for Go/SDL. Godot, Flutter, Compose, Slint and the web stacks would need a custom gamepad-driven OSK widget. For a launcher this is a moderate, well-bounded task an agent can build and golden-test.
- **Memory on 8 GB**: none of the stacks is a memory risk at 8 GB except possibly Electron/JVM with large decoded box-art caches. The real constraint is texture/GPU memory for about 4,000 covers, which every stack must handle with virtualization and thumbnail caching. (Inference.)
- **AI codegen ranking (opinion, popularity-based)**: web (React/TS) > Flutter/Dart ≈ Kotlin/Compose > Qt/QML (C++ plus QML) > Rust (egui/iced/Slint) ≈ GDScript (Godot 3/4 confusion documented) > bespoke SDL C/C++/Go UI code (plenty of training data for SDL calls, but the agent must invent the UI framework).

### Gaps
- No primary source for Godot's engine license (MIT), Qt's LGPL/GPL split, Flutter's BSD license, Electron's MIT/Chromium licensing, Compose/Skiko's Apache-2.0, or ES-DE's license was fetched in this session. These are well known but unverified here.
- No measured memory footprints for Godot, Qt, Flutter or Compose apps on aarch64 were found. The only Linux numbers found are Tauri vs Electron (2022-era, Ubuntu x86).
- Stack Overflow 2025 framework-usage numbers for Flutter, Electron, Qt and Godot could not be extracted ([survey page](https://survey.stackoverflow.co/2025/technology/)), so AI-codegen quality is argued from anecdote and popularity, not measurement.
- iced: no sources gathered on gamepad support, focus navigation or testing.
- Whether OGUI has a reusable on-screen-keyboard component was not verified.
- HTTP/SQLite/image-caching libraries per stack were not researched in depth. Background, unverified: Godot has built-in HTTPRequest but SQLite needs a GDExtension addon. Flutter has http/dio, sqflite_common_ffi/drift and cached_network_image. Qt has QtNetwork and QtSql (SQLite driver). Compose has Ktor, SQLDelight and Coil 3. Rust has reqwest and rusqlite. Go/SDL (Grout) uses `modernc.org/sqlite` (cited above).

---

## Which stacks have proven deployments on ARM Linux handhelds or under gamescope? (named projects)

### Takeaway
On **ARM Linux handhelds**, the proven stack is overwhelmingly **C/C++ or Go with SDL/OpenGL ES**. Examples: ROCKNIX's EmulationStation (Batocera ES fork) on Sway with Freedreno/Turnip on Snapdragon devices, Knulli/Batocera ES, Grout via gabagool/SDL2 across ~15 CFWs, and now ES-DE's aarch64 AppImage. **Under gamescope**, the proven stacks are **Godot 4 (OpenGamepadUI)** and **Chromium/CEF (Steam's own Game Mode UI)**; Pegasus and ES-DE have run on Steam Deck. OpenGamepadUI is the only gamescope-native launcher found that now ships aarch64 builds (since July 2026). I found no proven deployment of Flutter, Compose Desktop, Tauri or Slint/iced/egui launchers on ARM handhelds or under gamescope.

### Cited Findings
- **ROCKNIX on Qualcomm/Adreno with Mesa Turnip/Freedreno**
  - The Retroid Pocket 5 page lists Snapdragon 865 (SM8250), mainline Linux, "Freedreno Turnip", and "Sway + Emulation Station". — [ROCKNIX RP5 device page](https://rocknix.org/devices/retroid/retroid-pocket-5/)
  - ROCKNIX 20260701 ships an **SM8550** image (Snapdragon 8 Gen 2 class, the same family as the Nova's QCS8550) covering the Retroid Pocket 6 and several AYN/AYANEO models, and an SM8250 image for RP5/Flip2/Mini/Thor Lite. — [ROCKNIX 20260701 release](https://newreleases.io/project/github/ROCKNIX/distribution/release/20260701)
  - ROCKNIX uses "Sway compositor and EmulationStation as the front-end". — [Heldgames guide](https://heldgames.com/guides/rocknix-steam-android-handhelds)
  - In January 2025, ROCKNIX re-forked Batocera's EmulationStation. — [ROCKNIX 20250115 notes (androidpctv)](https://androidpctv.com/rocknix-20250115/)
- **Grout (RomM's handheld client, Go + gabagool/SDL2)**: the project header lists Allium, ArkOS, Batocera, dArkOS, Knulli, Koriki, MinUI, muOS, NextUI, Onion, ROCKNIX, spruce, sprigUI, twigUI and TrimUI. — [rommapp/grout](https://github.com/rommapp/grout); [RomM docs](https://docs.romm.app/4.9.0/ecosystem/first-party-apps/)
  - The older RomM muOS app was archived on 2026-01-09 in favour of Grout. — [RomM docs](https://docs.romm.app/4.9.0/ecosystem/first-party-apps/)
- **ES-DE (C++/SDL/OpenGL)**: Linux AArch64 AppImage since 3.4.1 (2026-04-10), labelled experimental. A dedicated Steam Deck AppImage also exists. — [es-de.org](https://www.es-de.org/); [retrohandhelds.gg](https://retrohandhelds.gg/es-de-gets-massive-update-including-xbox-integration-and-much-more/)
- **OpenGamepadUI (Godot 4 + Rust GDExtension) under gamescope**
  - Built to work "hand-in-hand with Gamescope". — [OGUI docs](https://opengamepadui.readthedocs.io/en/latest/getting_started/installation/index.html)
  - Rust GDExtensions handle performance-sensitive code and talk to gamescope and DBus. — [OGUI architecture docs](https://opengamepadui.readthedocs.io/en/latest/documentation/contributing/core_systems_and_architecture/)
  - Ships aarch64 builds since v0.45.1 (2026-07-15). — [OGUI v0.45.1](https://github.com/ShadowBlip/OpenGamepadUI/releases/tag/v0.45.1)
  - Installation docs cover SteamOS, ChimeraOS and Arch. — [OGUI installation](https://opengamepadui.readthedocs.io/en/latest/getting_started/installation/index.html)
- **Pegasus (Qt5/QML)**
  - Claims Raspberry Pi/Odroid/Android support. — [pegasus-frontend](https://github.com/mmatyas/pegasus-frontend)
  - Shipped on Steam Deck via EmuDeck 2.2 (March 2024). — [GamingOnLinux](https://www.gamingonlinux.com/2024/03/emudeck-2-2-adds-a-new-pegasus-frontend-better-linux-support-new-emulators/)
- **Steam's Game Mode UI (Chromium Embedded Framework)**: Decky documents the "Steam Big Picture Mode" and "QuickAccess" CEF tabs on the Deck. — [Decky wiki](https://wiki.deckbrew.xyz/plugin-dev/cef-debugging); [CSS Loader docs](https://docs.deckthemes.com/CSSLoader/Cef_Debugger/)
- **PortMaster (ARM handheld port manager)**
  - Ships Qt6 as a separate aarch64 runtime. — [PortMaster porting](https://portmaster.games/porting.html)
  - PortMaster developers (opinion) say "games that use GLES2 and SDL generally run very smoothly" on these devices, which "have some limitations with OpenGL". — [PortMaster FAQ](https://portmaster.games/faq.html)
- **Godot on ARM Linux generally (Raspberry Pi)**
  - Official arm64 Linux binaries crashed on Raspberry Pi OS (blamed on the cross-compile toolchain) but ran on Ubuntu 23.10 on a Pi 5.
  - Vulkan on the Pi 5 had texture issues (over 1024 px) while the Compatibility renderer worked.
  - Different GPU/driver than Adreno. Forum anecdote.
  - Source: [Godot forum: Godot 4.x on the Raspberry Pi](https://forum.godotengine.org/t/godot-4-x-on-the-raspberry-pi/34417)
- **Argosy Launcher** (Kotlin, Android) targets Anbernic/Retroid/Odin handhelds, but on **Android**, not Linux. — [gittrend summary](https://gittrend.io/repo/rommapp/argosy-launcher)

### Inferences
- The closest proven analogue to the Nova (Adreno 7xx + mainline Mesa) is ROCKNIX's SM8550 image running a C++/SDL/GLES EmulationStation on Sway. That is strong evidence that **SDL + GL ES on Freedreno** works on this SoC family. It is not evidence about gamescope.
- OGUI's aarch64 builds are about 3 months old. I found no public report of OGUI running on an Adreno/Turnip device specifically, so "Godot under gamescope" is proven on x86 AMD handhelds, and "Godot on aarch64 under gamescope" is only newly packaged.
- Steam's CEF UI proves Chromium-based UIs can run well under gamescope, but on AMD x86 with Valve's tuning. Electron on aarch64 Turnip under gamescope remains unproven.

### Gaps
- Could not confirm that ROCKNIX's SM8550 image specifically supports the Retroid Pocket Nova (QCS8550), or whether any Nova Linux image exists outside armadaOS.
- Knulli, muOS and ArkOS frontends were not individually verified in this session. Background, unverified: Knulli uses Batocera's EmulationStation; muOS uses its own C frontend with LVGL/SDL.
- PortMaster's Godot 4 support: itch.io comments by PortMaster members describe running Godot 4 games via "FRT" builds, but I could not pin the exact post, so this is unverified.
- No reports found of Flutter, Compose Desktop, Tauri, Electron or Slint/iced/egui launchers in production on ARM Linux handhelds or under gamescope.

---

## What are the known issues with each stack on Adreno + Mesa Turnip/Freedreno, or under gamescope?

### Takeaway
Device-specific bug evidence is thin for every stack. Few apps of any stack run on mainline-Mesa Adreno 7xx, so absence of reports does not mean absence of bugs. The concrete risks found are:
- **Gamescope**: only shows windows tagged `STEAM_GAME`, is hostile to secondary/popup windows, and needs explicit focus management when launching child emulators. OpenGamepadUI's LaunchManager/GamescopeXWayland code solves this.
- **WebKitGTK (Tauri)**: documented GPU-path fragility.
- **Compose/Skiko**: linux-arm64 native-lib/EGL crashes.
- **Godot**: Vulkan renderer crashes on some Linux GPUs, with Compatibility (GL) as the standard fallback; Mesa CI once flagged Godot traces for GPU hangs on Adreno 630.
- **Flutter**: Linux Impeller/Vulkan is about 2 months old.

### Cited Findings
- **Gamescope (applies to all stacks)**
  - Gamescope only shows windows that carry the `STEAM_GAME` X property. A multi-window launcher should set `STEAM_GAME=769` (Steam's own value) on its main window; other windows are drawn on top and the main window returns when they close. Launching a custom `CLIENTCMD` can yield a black screen without this property. — [ChimeraOS gamescope-session README](https://github.com/ChimeraOS/gamescope-session)
  - OGUI's `LaunchManager` "uses gamescope to manage which games start, whether their processes are still running, and window switching between games". `RunningApp` tracks window IDs/focus and has `grab_focus()`/`switch_window()`. `GamescopeXWayland` exposes `focusable_apps`, `focusable_windows`, `focused_app` and `focused_window`. — [OGUI LaunchManager](https://opengamepadui.readthedocs.io/en/latest/class-reference/LaunchManager/); [OGUI RunningApp](https://opengamepadui.readthedocs.io/en/latest/class-reference/RunningApp/); [OGUI GamescopeXWayland](https://opengamepadui.readthedocs.io/en/latest/class-reference/GamescopeXWayland/)
  - OGUI's NixOS gamescope-session defaults include `--steam --xwayland-count 2`. — [nixpkgs OGUI commit](https://code.fizz.buzz/talexander/nixpkgs/commit/931f637cfa1b64e7a6f6f97b5dc6ca6232377567)
  - Toggling fullscreen with gamescope's Meta+F hurts performance; launch with `-f` instead. A missing `CAP_SYS_NICE` causes stutter. — [Arch Wiki: Gamescope](https://wiki.archlinux.org/title/Gamescope)
  - Opinion: "having more than one window is impossible under Gamescope", e.g. GTK context menus implemented as hidden windows. — [Lemmy comment](https://lemmy.kde.social/comment/3828873)
  - Steam on-screen keyboard: Steam+X sometimes fails to show the keyboard over non-Steam games after extended play. — [steam-for-linux #12195](https://github.com/ValveSoftware/steam-for-linux/issues/12195)
  - Community guides say the Steam OSK only auto-opens for games calling Steam's GamepadTextInput API; otherwise Steam+X is manual. — [Steam Deck forum request](https://steamcommunity.com/app/1675200/discussions/1/3273566073554789807/) (community, low confidence)
  - Together these argue for an in-app OSK.
- **Godot**
  - Mesa CI issue: flaky GPU hangs on the Adreno **630** CI runner "triggered (most likely) by godot/godot-trive" traces. — [Mesa issue #7732](https://gitlab.freedesktop.org/mesa/mesa/-/issues/7732)
  - Godot workloads are part of Mesa's Freedreno CI trace testing, which cuts both ways: bugs get caught upstream.
  - Godot 4 doesn't auto-fall back to GLES3 when Vulkan fails; users switch to the Compatibility renderer or `--rendering-driver opengl3`. — [itch.io comment](https://itch.io/post/6702983) (anecdote; post attribution via search index, low confidence)
  - On Linux "some systems may have an issue with Godot's default Vulkan driver"; `gl_compatibility` is the suggested fix. — [itch.io comment](https://itch.io/post/14050628) (anecdote; post attribution via search index, low confidence)
  - Godot 4.7 Movie Maker on Linux/Wayland reportedly ran "significantly faster than it should" when recorded. — [Godot forum, 4.7](https://forum.godotengine.org/t/4-7-linux-wayland-we-tried-movie-maker-mode-in-ide-but-the-game-framerate-set-in-gdscript-is-not-enforced-game-is-running-too-fast-when-recorded/140821)
- **Turnip general (Android context, older Mesa)**
  - Mesa 22.2.1 regression broke Turnip on an Adreno 640; bisected and reverted. — [Mesa #7472](https://gitlab.freedesktop.org/mesa/mesa/-/issues/7472)
  - Freedreno crash on an Adreno 735 with an outdated bundled Turnip in ZalithLauncher (Android). — [ZalithLauncher2 #1339](https://github.com/ZalithLauncher/ZalithLauncher2/issues/1339)
  - Community Adreno 830 Turnip builds report gmem GPU hangs (sysmem recommended). Pre-release, Android, different GPU generation. — [AdrenoToolsDrivers tu_v21](https://newreleases.io/project/github/whitebelyash/AdrenoToolsDrivers/release/tu_v21)
- **Tauri / WebKitGTK**
  - Driver-dependent blank windows and rendering bugs. WebGL/canvas can silently take a slow path. Workarounds disable fast paths. — [Tauri Linux graphics](https://v2.tauri.app/develop/debug/linux-graphics/)
  - ARM-specific WebKitGTK CSS-animation failures and slowness (2018). — [webkit-gtk list](https://lists.webkit.org/pipermail/webkit-gtk/2018-August/003348.html); [WebKit #192969](https://bugs.webkit.org/show_bug.cgi?id=192969)
- **Compose / Skiko**: linux-arm64 segfaults on some GPUs/VMs, and a missing `libEGL.so.1` causing `UnsatisfiedLinkError`. — [Kotlin Slack (ARM segfaults)](https://slack-chats.kotlinlang.org/t/8519917/is-anyone-running-compose-desktop-apps-successfully-on-arm64); [Kotlin Slack (libEGL)](https://slack-chats.kotlinlang.org/t/33220275/hi-i-just-bumped-from-compose-1-11-0-alpha02-to-1-11-0-beta0)
- **Flutter**: Impeller on Linux uses Vulkan and became the default only in 3.47 (2026-08-12). An opt-out exists "if you need to temporarily opt out". — [Flutter 3.47 blog](https://flutter.dev/blog/whats-new-in-flutter-3-47)
- **Qt**: Qt Gamepad is absent from Qt 6, so you need SDL for input. — [Qt dev list, May 2025](https://lists.qt-project.org/pipermail/development/2025-May/046342.html)

### Inferences
- Any launcher must manage gamescope focus when spawning emulators (set `STEAM_GAME`, avoid secondary windows, re-raise itself on exit). This is easiest if you **fork or port OGUI's gamescope modules** (Rust GDExtension; GPLv3), or reimplement the same X11 atom handling in any stack.
- Avoid stacks or widgets that open separate OS windows for menus, popups or dialogs, such as GTK popovers (relevant to Flutter's GTK runner popups and to Tauri). Prefer a single fullscreen surface with in-scene overlays. Godot, Qt Quick, SDL and Compose-in-one-window all do this naturally.
- Turnip is a conformant Vulkan driver and Freedreno a mature GL ES driver on Adreno 7xx. A **GL ES path is the lower-risk default** (Godot Compatibility, Qt Quick's OpenGL RHI, SDL/GLES, Skia GL), with Vulkan as an optimisation. Flutter 3.47 makes Vulkan the default, so the GL fallback is the opt-out. (Inference.)

### Gaps
- No Godot, Qt, Flutter or Compose bug reports specific to **Adreno 740 + Turnip/Freedreno on mainline Linux** were found. The Godot issue tracker was not searched directly by keyword ("turnip", "freedreno").
- No Qt- or Flutter-specific gamescope bug reports were found. Behaviour of a GTK-based Flutter runner, or a Qt xcb app, inside gamescope XWayland was not verified.
- Whether `steam://open/keyboard` works from a non-Steam app in armadaOS Game Mode is unverified.

---

## Which stacks support pixel-accurate screenshot or golden testing headlessly on GitHub Actions (including ubuntu-24.04-arm)?

### Takeaway
**Flutter** (`flutter test` goldens, no display needed) and **Compose Desktop** (JVM tests plus Roborazzi) have first-class headless golden testing. **egui** (kittest snapshots via wgpu) and **Slint** (screenshot harness with the software renderer) have it too. **Web stacks** can test the UI layer with browser screenshot tooling (background, unverified). **Godot** and **Qt** can do it but need xvfb plus Mesa software rendering (llvmpipe/lavapipe/SwiftShader); Godot's `--headless` disables the display driver, and Qt's offscreen platform has known grab/focus pitfalls. **SDL** can render to a software surface deterministically (background, unverified). Free `ubuntu-24.04-arm` runners have been GA for public repos since 2025-08-07, and in private repos (smaller spec) since early 2026.

### Cited Findings
- **GitHub arm64 runners**
  - Linux arm64 standard hosted runners became GA for **public** repos on 2025-08-07, after a public preview from 2025-01-16. The labels are `ubuntu-22.04-arm` and `ubuntu-24.04-arm`. — [GitHub changelog 2025-08-07](https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/); [GitHub changelog 2025-01-16](https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/)
  - Public-repo runners use Cobalt 100 (Neoverse N2) with 4 vCPU. — [GitHub changelog 2025-01-16](https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/)
  - Reported available in **private** repos since early 2026 (2 vCPU, 8 GB RAM, 14 GB SSD). — [Classmethod blog (JP)](https://dev.classmethod.jp/articles/github-actions-arm64-private-repos/)
  - A third-party blog says GitHub was taking over ARM image maintenance from Arm Ltd. around May–June 2026 (unconfirmed). — [Tenki blog](https://www.tenki.cloud/blog/github-actions-runner-image-selection-2026)
- **Flutter**
  - Golden testing uses `matchesGoldenFile` with `flutter test --update-goldens`. The default Ahem font yields stable glyph boxes; real fonts can differ across OS and Flutter versions. — [matchesGoldenFile docs](https://api.flutter.dev/flutter/flutter_test/matchesGoldenFile.html)
  - Flutter officially deploys to Linux Arm64 (3.47). — [Flutter supported platforms](https://docs.flutter.dev/reference/supported-platforms)
- **Compose Desktop**
  - Roborazzi supports Compose Multiplatform Desktop/JVM with no device needed. — [Roborazzi docs (index)](https://docsearch.algolia.com/mcp/docs/repo/takahirom/roborazzi)
  - Community note: `runComposeUiTest` is still experimental, and you should `waitForIdle` before capturing to avoid half-finished animation frames. — [Atomic Object blog](https://spin.atomicobject.com/snapshot-testing-roborazzi/) (attribution via search summary; not fetched)
  - Caveat: a linux-arm64 CI init error with Skiko was reported (Compose 1.11.0-beta01). — [Kotlin Slack](https://slack-chats.kotlinlang.org/t/33220275/hi-i-just-bumped-from-compose-1-11-0-alpha02-to-1-11-0-beta0)
- **Godot**
  - `--headless` = `--display-driver headless --audio-driver Dummy`. Use `--rendering-method gl_compatibility` to pick the GL renderer. Use `--write-movie` (with `.png`), `--fixed-fps` and `--quit-after` for deterministic frame output. — [Godot 4.7 CLI docs](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)
  - Movie Maker forces an identical delta every frame, "regardless of your hardware's capabilities". Godot pitches it for "comparing the visual output of graphics settings, shaders, or rendering techniques". — [Godot blog: Movie Maker mode](https://godotengine.org/article/movie-maker-mode-arrives-in-godot-4)
  - gdUnit4's scene runner simulates mouse, keyboard, touch and custom actions, and there is a `gdunit4-action` for CI. — [GdUnit4 asset page](https://www.godotengine.org/asset-library/asset/1522)
  - The gdUnit4 action runs Godot under **xvfb** to work around headless input-handling problems (Godot issue #73557). One user found this "VERY (i.e. unusably) slow" on CPU-only runners. — [gdUnit4Net discussion #350](https://github.com/godot-gdunit-labs/gdUnit4Net/discussions/350)
  - A Godot-source repo mirror shows a commit "Test Godot with Vulkan in CI" that runs under `xvfb-run` with a **SwiftShader** Vulkan ICD and dummy audio, skipping a tessellation check. — [mirror commit](https://git.objectionable.solutions/Sara/behaviour-tree-test/commit/599d96163c39887c6f879582121eefd9416ee47e)
  - OGUI ships a `.gutconfig.json`, i.e. it uses the GUT unit-test framework. — [OGUI repo](https://github.com/ShadowBlip/OpenGamepadUI)
- **Qt/QML**
  - QML test runner crashed under the `offscreen` QPA without `$DISPLAY` (resolved). — [QTBUG-66423](https://bugreports-test.qt.io/browse/QTBUG-66423)
  - Qt Quick Controls' own tests skip `grabToImage()` tests on offscreen platforms. — [qtquickcontrols2 commit log](https://code.qt.io/cgit/qt/qtquickcontrols2.git/log/tests/auto/qquickiconimage/tst_qquickiconimage.cpp?h=5.10)
  - `grabImage()` grabs the wrong region for items that aren't direct window children. — [QTBUG-76024](https://bugreports-test.qt.io/browse/QTBUG-76024)
  - Focus assertions can fail under `QT_QPA_PLATFORM=offscreen`. — [Qt forum](https://forum.qt.io/post/567318)
  - Counter-example: Ayon runs Qt UI screenshot comparisons headlessly with the offscreen platform (Python/widgets). — [Ayon UI testing](https://docs.ayon.dev/ayon-core/latest/ui_testing.html)
- **egui**: kittest snapshot tests need the `wgpu` feature, with per-OS tolerance in `kittest.toml`. Rerun shares one wgpu device across test harnesses. — [egui_kittest docs](https://docs.rs/egui_kittest); [Rerun test_context.rs](https://ref.rerun.io/docs/rust/head/src/re_viewer_context/test_context.rs.html)
- **Slint**: an in-repo screenshot test harness (`tests/screenshots/testing.rs`); renderer refactors note "the testing can now be more strict". — [Slint repo mirror](https://git.joshthomas.dev/language-servers/slint/commits/branch/olivier/cpp2/tests/screenshots/testing.rs)
- **Grout (SDL/Go)**: the repo has `test/e2e` tests. Their method was not inspected. — [rommapp/grout](https://github.com/rommapp/grout)

### Inferences
- **Determinism ranking for an agent working without the device (inference)**:
  1. Flutter widget/golden tests: pure CPU, no X server, and run in the same `flutter test` command as unit tests.
  2. Compose (ImageComposeScene/Roborazzi on the JVM, CPU raster).
  3. egui kittest / Slint software renderer.
  4. Web UI in headless Chromium (unverified).
  5. SDL software renderer, offscreen video driver plus `SDL_RenderReadPixels` (unverified).
  6. Godot: xvfb + llvmpipe + `gl_compatibility` + `--fixed-fps` + viewport capture or `--write-movie` PNGs. Slower and more DIY.
  7. Qt Quick: xvfb + llvmpipe, or the `QT_QUICK_BACKEND=software` adaptation (unverified), with known grab/focus pitfalls.
- **Golden-file environment**: generate goldens in the same container on CI, not on a developer's machine. Flutter's docs and egui's per-OS thresholds both warn about cross-platform pixel drift. Running goldens on `ubuntu-24.04-arm` gives an aarch64 build of the same binary as the device, but rendering still goes through llvmpipe, not Turnip. On-device smoke tests remain necessary.
- **Mesa software drivers**: llvmpipe (GL) and lavapipe (Vulkan) are packaged on Ubuntu 24.04 for arm64 (background, unverified). Godot's GL Compatibility renderer and Qt's GL RHI should run on llvmpipe; Flutter 3.47 Impeller/Vulkan would need lavapipe or the Skia-GL opt-out for *integration* tests. Widget-level goldens don't need either.

### Gaps
- No primary source fetched for Playwright/WebdriverIO screenshot testing of Electron/Tauri, `tauri-driver` on Linux, or the SDL offscreen/dummy video drivers.
- No first-hand confirmation found of any of these stacks' screenshot tests running on `ubuntu-24.04-arm` specifically. The runner exists and is free for public repos, but per-stack aarch64 CI examples were not located.
- Godot issue #73557 (headless input handling) status was not checked.
- Whether Flutter's `flutter test` golden rendering uses Impeller or Skia in 3.47 was not verified. This matters for how faithfully goldens reflect device rendering.

---

## How should the candidates be ranked for this use case, including forking OpenGamepadUI (Godot), Pegasus (Qt) or ES-DE (C++/SDL/GL ES)?

### Takeaway
The ranking below is opinion and inference built on the evidence above.
1. **Godot 4** (new app reusing or porting OpenGamepadUI's gamescope/launch modules, or a slimmed OGUI fork if GPLv3 is acceptable).
2. **Flutter** (best agent ergonomics and testing; must pass an on-device Impeller/Turnip-under-gamescope spike first).
3. **Qt 6/QML** (strong, but Pegasus is still Qt5 and the testing story is weaker).
4. **SDL custom / ES-DE fork** (most proven on Adreno, but the agent must hand-build the whole UI toolkit).
5. **Compose Desktop** (Kotlin sharing with Argosy is attractive, but no gamepad layer and linux-arm64 Skiko crash reports).
6. **Electron** (> Tauri on Linux).
7. **Rust native** (Slint > egui > iced).

If the headless-testing weight dominates over device evidence, Flutter and Godot swap places.

### Cited Findings
Evidence that drives the ranking (details and sources in the sections above):
- **Godot/OGUI**
  - Only gamescope-native launcher with aarch64 RPM, sysext and tarball builds (v0.45.1, 2026-07-15; v0.46.1, 2026-09-03; Godot 4.7.1). — [OGUI releases](https://github.com/ShadowBlip/OpenGamepadUI/releases)
  - Gamescope launch/focus management already implemented. — [OGUI LaunchManager](https://opengamepadui.readthedocs.io/en/latest/class-reference/LaunchManager/)
  - SDL3 gamepad input since Godot 4.5. — [Godot 4.5 beta 2](https://godotengine.org/article/dev-snapshot-godot-4-5-beta-2/)
  - Built-in focus navigation. — [Godot GUI navigation](https://docs.godotengine.org/en/stable/tutorials/ui/gui_navigation.html)
  - Risks:
    - GPLv3 if forked. — [OGUI README](https://github.com/ShadowBlip/OpenGamepadUI)
    - Depends on ShadowBlip daemons (InputPlumber, and per the README, PowerStation for TDP). — [OGUI README](https://github.com/ShadowBlip/OpenGamepadUI)
    - xvfb-bound testing. — [gdUnit4Net #350](https://github.com/godot-gdunit-labs/gdUnit4Net/discussions/350)
    - Godot 3/4 LLM confusion. — [Summer Engine](https://www.summerengine.com/blog/best-ai-for-gdscript)
- **Flutter**
  - Official Linux Arm64 deployment. — [Flutter platforms](https://docs.flutter.dev/reference/supported-platforms)
  - Headless goldens. — [matchesGoldenFile](https://api.flutter.dev/flutter/flutter_test/matchesGoldenFile.html)
  - SDL-DB-based gamepads plugin. — [gamepads](https://pub.dev/documentation/gamepads/latest/)
  - Risks:
    - Impeller/Vulkan Linux default only since 2026-08-12. — [Flutter 3.47 blog](https://flutter.dev/blog/whats-new-in-flutter-3-47)
    - Fedora not a listed target.
    - No handheld or gamescope deployments found.
- **Qt**
  - Pegasus is a proven ARM/Steam Deck frontend but Qt5-only. — [pegasus-frontend](https://github.com/mmatyas/pegasus-frontend)
  - Qt Virtual Keyboard is an off-the-shelf OSK (GPLv3/commercial). — [Qt VKB docs](https://doc.qt.io/qt-6.2/qtvirtualkeyboard-index.html)
  - No Qt 6 gamepad module. — [Qt dev list](https://lists.qt-project.org/pipermail/development/2025-May/046342.html)
  - Offscreen grab and focus pitfalls in tests. — [QTBUG-76024](https://bugreports-test.qt.io/browse/QTBUG-76024)
- **SDL/ES-DE**
  - Proven on Snapdragon/Turnip via ROCKNIX ES (SM8250/SM8550). — [ROCKNIX RP5](https://rocknix.org/devices/retroid/retroid-pocket-5/); [ROCKNIX 20260701](https://newreleases.io/project/github/ROCKNIX/distribution/release/20260701)
  - ES-DE aarch64 AppImage (experimental) since 2026-04-10. — [es-de.org](https://www.es-de.org/)
  - Grout/gabagool proves the Go+SDL2 path for RomM specifically. — [grout go.mod](https://raw.githubusercontent.com/rommapp/grout/main/go.mod); [gabagool](https://github.com/BrandonKowalski/gabagool)
- **Compose**
  - linux-arm64 Skiko artifacts exist (0.154.0, 2026-10-05). — [Skiko releases](https://github.com/JetBrains/skiko/releases)
  - Crash/EGL reports. — [Kotlin Slack](https://slack-chats.kotlinlang.org/t/33220275/hi-i-just-bumped-from-compose-1-11-0-alpha02-to-1-11-0-beta0)
  - Gamepad needs JNI (Jamepad). — [Jamepad](https://jitpack.io/p/loriopatrick/Jamepad)
- **Tauri/Electron**
  - WebKitGTK GPU fragility. — [Tauri docs](https://v2.tauri.app/develop/debug/linux-graphics/)
  - Linux memory near parity at idle; WebKit is heavier under load. — [tauri#5889](https://github.com/tauri-apps/tauri/issues/5889)
  - Chromium-in-gamescope precedent from Steam's CEF UI. — [Decky wiki](https://wiki.deckbrew.xyz/plugin-dev/cef-debugging)
- **Rust native**
  - No gamepad docs for Slint. — [Slint FocusScope](https://docs.slint.dev/latest/docs/slint/reference/keyboard-input/focusscope/)
  - Royalty-free license ties "desktop" to "PC or notebook". — [Slint license PDF](https://slint.dev/agreements/slint-royalty-free-license.pdf)
  - egui snapshot testing exists. — [egui_kittest](https://docs.rs/egui_kittest)

### Inferences
- **Scored view (my judgement; 5 = best)**:

| Criterion | Godot 4 | Flutter | Qt 6/QML | SDL custom / ES-DE | Compose Desktop | Electron | Tauri | Slint/egui/iced |
|---|---|---|---|---|---|---|---|---|
| aarch64 packaging maturity | 4 (OGUI rpm/sysext/tar) | 4 (official arm64; no Fedora) | 4 (distro Qt, KDE runtime*) | 4 (ES-DE AppImage; trivial C) | 3 (jpackage native build) | 4* | 3 (AppImage built natively) | 4 (cargo) |
| GPU perf on Turnip/Freedreno (risk-adjusted) | 4 (GL Compat or Vulkan) | 3 (Impeller/Vk new) | 4 (Qt Quick GL ES*) | 5 (proven ES on Adreno) | 3 (Skiko arm64 reports) | 3* | 2 (WebKitGTK) | 3 |
| Gamepad (SDL mappings, Steam virtual pad) | 5 (SDL3 built in) | 4 (gamepads plugin, SDL DB) | 3 (bring SDL) | 5 | 2 (JNI) | 4* (Chromium Gamepad API) | 3 (libmanette) | 2 (gilrs*) |
| Built-in focus navigation | 5 | 4* | 4* | 1–3 (DIY; gabagool lists) | 4* | 2 (spatial-nav lib) | 2 | 2 |
| OSK | 2 (DIY) | 2 (DIY) | 5 (Qt VKB) | 4 via gabagool (Go) / 2 | 2 | 2 | 2 | 2 |
| Theming/animation | 5 | 5 | 5 | 3 | 4 | 5 | 4 | 3 |
| Gamescope fit / precedent | 5 (OGUI) | 2 (unknown) | 3 (Pegasus on Deck) | 4 (ES-DE on Deck) | 2 | 3 (CEF precedent) | 2 | 2 |
| Headless/golden testing on CI | 2–3 (xvfb+llvmpipe) | 5 | 2–3 | 3* | 4 | 4* | 3* | 4 |
| AI codegen quality | 3 (Godot 3/4 drift) | 4 | 3 | 3 | 4 | 5 | 4 | 2 |
| Ecosystem (HTTP/SQLite/image cache) | 3 | 5* | 4* | 3 | 5* | 5* | 4* | 3 |
| Memory footprint | 4* | 4* | 4* | 5 | 2* | 2 | 3 | 5 |
| License friendliness | 5 (MIT engine; OGUI GPLv3) | 5* | 3 (LGPL/GPL; VKB GPL) | 5* | 5* | 5* | 5* | 3 (Slint GPL/royalty-free terms) |

  (* = background knowledge or inference not verified with a source in this session.)
- **Fork vs greenfield**
  - **OGUI fork**: you inherit gamescope focus handling, a gamepad-native UI, aarch64 packaging, GUT tests and a plugin system. It is GPLv3, depends on the ShadowBlip daemon stack, and is a general Steam-like launcher/overlay, so RomM library, download and sync flows are new work.
    - A middle path is a new Godot project that copies OGUI's gamescope GDExtension/launch logic, which is GPLv3-compatible if the new app is also GPLv3. Argosy and Grout licensing (GPL-3.0 and MIT) don't constrain this.
  - **Pegasus fork**: needs a Qt5-to-Qt6 port first, and Pegasus's data model is built around metadata files and launching, not network downloads.
  - **ES-DE fork**: a large C++ codebase with its own theme engine and SDL/GL renderer that is proven on Adreno. The agent would add a RomM client, a download queue and an OSK in C++. This is the lowest device risk but the highest agent-effort-per-feature.
- **Suggested decision procedure (inference)**: before committing, have the agent build two throwaway spikes, (a) Godot 4.7 Compatibility renderer and (b) Flutter 3.47 Impeller, and test each on the Nova under gamescope Game Mode. Each spike should have:
  - a 4,000-tile virtualized cover grid at 1280x960
  - controller focus movement
  - one child-process launch and return
  - a frame-time overlay at 120 Hz

  Pick whichever holds 120 fps and survives the emulator round-trip. Default to Godot if both pass and device-proven gamescope integration matters most; default to Flutter if both pass and agent test-loop speed matters most.

### Gaps
- No public benchmark compares these stacks' frame times on Adreno 7xx with mainline Mesa. The ranking's GPU column is risk-weighted judgement, not measurement.
- I did not verify that OGUI can run without InputPlumber/PowerStation, or how large the effort is to strip its overlay/power features for a RomM-focused fork.
- ES-DE's and Pegasus's licenses, their theme-engine extensibility for download queues, and their CI/test setups were not examined in this session.
- Flutter Linux GTK runner behaviour under gamescope XWayland (single surface vs popup windows, fullscreen on 4:3 1280x960) is unverified.
