> Research note copied into the repository at handoff (2026-10-08). Links to `~/Documents/argosy-fork/...` point at the tester's private local Argosy fork, which is not in this repository; see [argosy-fork-design-spec.md](argosy-fork-design-spec.md) for the extracted design.

# Argosy Launcher teardown: reference product for a Linux/armadaOS RomM frontend

Research date: 2026-10-08. Primary evidence is a clone of `rommapp/argosy-launcher` at commit `2714d5453b6b` (2026-10-07, after tag v2.19.4), its GitHub wiki (last wiki commit 2026-10-04), GitHub release notes v2.0.0 to v2.19.4, and a clone of `davidadrianrg/romm-sync` at commit `1a31cd44603c` (v0.8.4, 2026-10-05).

**How to read the labels.** "(code)" means read in source. "(docs)" means read in the in-repo docs or the wiki. "(release notes)" means read in a GitHub release body. Anything under "Inferences" is my reasoning, not something a source states.

**Link conventions.** Code links are pinned to commit `2714d5453b6bbef790987071ab0e82068009532b`. `APP/` is shorthand for `app/src/main/kotlin/com/nendo/argosy/` inside that tree.

---

## 1. What is Argosy's full feature set as of October 2026?

### Takeaway
As of v2.19.4 (released 2026-10-04), Argosy is far more than a RomM browser. It is a full Android home-screen launcher.
- **RomM integration:** library sync, on-demand downloads, BIOS sync, hash-based save and state sync through RomM's negotiate endpoint, play-session sync, collections, and multiple accounts.
- **Emulation:** its own built-in libretro emulator, with RetroAchievements, netplay, speedrun mode, shaders and bezels, plus auto-detection of about 70 external Android emulators.
- **Other content:** Steam games via JavaSteam and GameNative, and a Jellyfin media client.
- **Social and hardware:** social features, multi-screen support, LED control, and deep theming.

A Linux equivalent should target the RomM core loop (sync, download, launch, save sync, BIOS) and the controller UX, not the whole surface.

### Cited Findings

**Release cadence and version**
- v2.19.4 was published 2026-10-04. Each release ships `argosy-vX.Y.Z-arm64.apk`, `-arm32.apk` and a universal APK — [GitHub releases](https://github.com/rommapp/argosy-launcher/releases/tag/v2.19.4). `versionName = "2.19.4"` and `versionCode = 348` — [app/build.gradle.kts (code)](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/build.gradle.kts)
- v2.0.0 ("UI 2.0 overhaul is stable") was published 2026-07-10 — [release v2.0.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.0.0)
- Between v2.0.0 (2026-07-10) and v2.19.4 (2026-10-04) there were 22 stable 2.x releases plus 11 betas. Examples: v2.8.0 on 2026-08-23, v2.17.0 on 2026-09-26, v2.19.0 on 2026-10-02 — [releases list](https://github.com/rommapp/argosy-launcher/releases)

**Library browsing and filtering**
- The Library opens on a grid of platforms, not every game at once. Filter tabs are source, platform, genre, region, players and series. Several values within one category match with OR; different categories combine with AND. Inside a platform, the triggers switch to the previous or next platform and an A-Z rail jumps to a letter (docs) — [wiki Navigation](https://github.com/rommapp/argosy-launcher/wiki/Navigation)
- v2.18.0 (2026-09-28) added (release notes) — [release v2.18.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.18.0):
  - a list layout showing play time against HowLongToBeat, achievements, friends playing, save and download state, and ratings
  - Default Region and Default Players filters
- One search covers games and media. The Quick Menu (L3) offers fuzzy search, Random, Most Played, Top Unplayed, Recent and Favorites (docs) — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md); [wiki Navigation](https://github.com/rommapp/argosy-launcher/wiki/Navigation)
- **Regional copies.** Each RomM rom syncs as its own game row. The Library collapses regional copies ("sibling groups") into one entry using RomM's gallery key. The key is the first non-null provider id in igdb, ss, moby, ra, hasheous, launchbox, tgdb, flashpoint, steam order, combined with the platform id. Hacks and translations are classified from RomM filename tags (docs) — [docs/romm-sync-rules.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/romm-sync-rules.md)
- **Sync filters:** region include/exclude, Exclude Unlicensed (v2.11.0), Beta/Prototype/Demo, and per-platform enable — [release v2.11.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.11.0); [wiki RomM-Integration](https://github.com/rommapp/argosy-launcher/wiki/RomM-Integration)
- **Library sync mechanics.** It pages `GET /api/roms?platform_ids=<id>&order_by=id&limit=100&offset=n&with_files=true`, strictly sequentially. Deletions are reconciled against `GET /api/roms/identifiers`. The doc includes performance measurements on a 23,873-rom library (docs) — [docs/romm-sync-optimization.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/romm-sync-optimization.md)
- **Automatic sync schedule.** It syncs weekly, fetching only games that changed, with a full sync when the last one is more than two weeks old. A manual sync is always full (docs, v2.18.0) — [wiki RomM-Integration](https://github.com/rommapp/argosy-launcher/wiki/RomM-Integration)

**Collections**
- Collection types (docs) — [wiki Collections](https://github.com/rommapp/argosy-launcher/wiki/Collections):
  - Favorites, which syncs both ways with RomM
  - local user collections
  - RomM-synced collections, where edits push back to RomM and RomM is the source of truth after the first merge, re-synced every 30 s
  - "Browse By" virtual categories (Genres, Game Modes)
- Collections can be pinned. "Download All (N)" batch-downloads a collection. The wiki says Argosy "deliberately does not offer" bulk-downloading a whole platform (docs) — same page
- API endpoints used: `GET /api/collections`, `/api/collections/virtual`, `/api/collections/smart`, plus POST/PUT/DELETE `/api/collections` (code) — [APP/data/remote/romm/RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt)
- Smart collections such as "Top Unplayed", "Recently Added" and "Most Played" — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md)

**Download queue**

*Parallelism and queue states*
- Parallelism is a user preference, `maxConcurrentDownloads`, with **default 1** (code) — [APP/data/preferences/StoragePreferencesRepository.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/preferences/StoragePreferencesRepository.kt)
- Queue states are `QUEUED, WAITING_FOR_STORAGE, DOWNLOADING, EXTRACTING, MOVING, PAUSED, COMPLETED, FAILED, CANCELLED`. On restart, interrupted DOWNLOADING and EXTRACTING rows reset to QUEUED (code) — [APP/data/download/DownloadManager.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/download/DownloadManager.kt)

*Resume and staging*
- Resume uses an HTTP `Range: bytes=<existing>-` header (code) — same file
- Files are staged as `.partial` siblings and promoted only when the transfer completes. A `.partial` shorter than its source resumes from its own length (code) — [APP/data/download/RomStagingManager.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/download/RomStagingManager.kt)
- "Downloads stage on internal storage and reserve room for the unpack" (v2.8.0) — [release v2.8.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.8.0)
- "Waiting for Storage" means the destination volume is low on space; a 50 MB buffer is reserved (docs) — [wiki Storage-and-Paths](https://github.com/rommapp/argosy-launcher/wiki/Storage-and-Paths)

*Background, server waits, thermals and archives*
- Downloads run in a foreground service, `DownloadForegroundService`. There is also a `DownloadThermalManager` (code: file list) — [APP/data/download/](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/download)
- "Downloads and save syncs keep running when Argosy is in the background" (v2.14.0) — [release v2.14.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.14.0)
- Large downloads show "Waiting for server" while RomM prepares them, and wait up to 15 minutes before giving up (v2.13.0) — [release v2.13.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.13.0)
- Archive handling: zip extraction, NSZ/XCZ decompression for Switch, and single-wrapper-folder archives. Game & Watch zips are kept zipped (release notes v2.4.1, v2.11.0, v2.11.1, v2.18.0) — [releases](https://github.com/rommapp/argosy-launcher/releases)

*Storage location*
- There is a global ROM path plus per-platform overrides. Single-file games download flat into the platform folder. Multi-file games get a folder mirroring the RomM server layout, with an option to name the folder after the ROM file (docs) — [wiki Storage-and-Paths](https://github.com/rommapp/argosy-launcher/wiki/Storage-and-Paths)

*Download endpoints*
- `GET api/roms/{id}/content/{fileName}` (streaming), `GET api/roms/{fileId}/files/content/{fileName}`, and `GET api/firmware/{id}/content/{fileName}` (code) — [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt)

**On-demand install vs pre-install**
- "Games appear in your Library but aren't downloaded until you choose to play them." Games download on demand when launched, or in batches from Collections (docs) — [wiki RomM-Integration](https://github.com/rommapp/argosy-launcher/wiki/RomM-Integration)
- "If the game isn't downloaded, Argosy downloads it first automatically." When a save exists locally or on RomM, launching offers Continue or New Game (docs) — [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games)
- **Remote install.** From RomM's web UI, a user can push a game to the device. This requires RomM ≥ 5.4 and the "Allow Remote Installs" setting (v2.18.0). In code it is `POST api/devices/{id}/installs/claim`, gated by `DEVICE_INSTALL_MIN_VERSION = "5.4.0"` — [release v2.18.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.18.0); [RomMCapabilities.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMCapabilities.kt)
- "Scan for Files" matches files already on disk to RomM filenames, including ES-DE-style layouts, so an existing library isn't re-downloaded. A weekly integrity check is on by default (docs) — [wiki Storage-and-Paths](https://github.com/rommapp/argosy-launcher/wiki/Storage-and-Paths)

**Emulator detection and launch**

*Detection and registry*
- Detection enumerates installed Android packages through `PackageManager.getInstalledPackages`, matched against `EmulatorRegistry`, a single 86 KB registry file with about 74 `EmulatorDef(` entries. RetroArch has `com.retroarch`, `com.retroarch.aarch64` and `ra32` variants (code) — [APP/data/emulator/EmulatorDetector.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/emulator/EmulatorDetector.kt); [EmulatorRegistry.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/emulator/EmulatorRegistry.kt)

*Launch mechanism*
- Launch builds an Android `Intent` with `LaunchMethod { INTENT, SHELL }`. The ROM path can be passed as `ABSOLUTE_PATH`, `FILE_PROVIDER` (content:// with a URI grant) or `DOCUMENT_URI` (code) — [APP/data/emulator/LaunchCommand.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/emulator/LaunchCommand.kt)
- `AGENTS.md` names two resolvers that must agree: `EmulatorResolver.getEmulatorPackageForGame` and `GameLauncher.resolveEmulator` (docs) — [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md)
- The built-in libretro emulator (`:libretrodroid`, C++/JNI with an rcheevos submodule) is the default for most platforms (docs) — [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games); [.gitmodules](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/.gitmodules)

*Launch flow (v2.19.2)*
- A progress overlay shows each step: syncing the save, downloading the core, preparing system files, launching. B or Cancel stops it. Pre-launch save prompts live inside the overlay — [release v2.19.2](https://github.com/rommapp/argosy-launcher/releases/tag/v2.19.2); [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games)

*Session tracking and return*
- Usage Access is used for play time and for detecting when a game closes (docs) — [wiki Installation](https://github.com/rommapp/argosy-launcher/wiki/Installation)
- `PlaySessionTracker` and `GameSessionService` cover all emulators (docs) — [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md)
- "Close Emulator When Returning to Argosy" is off by default (docs) — [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games)

*Multi-disc and deep links*
- Multi-disc games are registered under one entry, start on disc 1, and swap discs in-game (docs) — [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games)
- An `argosy://launch` deep link lets other front-ends launch games and get control back afterwards (v2.16.0) — [release v2.16.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.16.0)

*Emulator and driver management*
- Managed emulator installers with add, variant and remove (v2.17.0) — [release v2.17.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.17.0)
- Update badges for outdated cores and emulators (v2.19.3) — [release v2.19.3](https://github.com/rommapp/argosy-launcher/releases/tag/v2.19.3)
- Supporting classes exist: `GpuDriverManager`, `DriverFetcherRepository` and `EmulatorUpdateManager` (code: file list) — [APP/data/emulator/](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/emulator)

**Per-platform emulator choice**
- Emulators can be assigned per platform in Settings, with RetroArch core selection per platform — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md)
- Per-Game Settings can override Emulator, Core, Save Path, Display Target and File Extension. Each row shows the inherited default live. Changing a game's emulator resets its core and save path (docs) — [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games)

**Save and state sync**

*RomM protocol*
- Endpoints (code) — [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt):
  - `POST api/sync/negotiate`, `POST api/sync/sessions/{id}/complete`, `GET api/sync/sessions`
  - `POST/PUT/GET api/saves`, `GET api/saves/{id}/content`, `POST api/saves/{id}/downloaded`
  - `api/states`, `api/channels`, `api/snapshots`
  - `POST/GET/PUT api/devices`
  - `POST/GET api/play-sessions`, `POST/DELETE api/activity/heartbeat`
  - `POST api/screenshots`
- Version gates: negotiate, play-session ingest and device sync from RomM ≥ 4.9.0; device auth from ≥ 5.0.0. Snapshots are enabled only when the server heartbeat reports `SAVE_SYNC.SNAPSHOTS` (code) — [RomMCapabilities.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMCapabilities.kt); [docs/save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)

*The model (maintainer decisions, documented 2026-10-02)*
- The local save cache is the local authority.
- The active save is a cached version identified by content hash. "Timestamps never decide correctness."
- The `"autosave"` slot is the standard latest slot.
- RomM's negotiate endpoint "is the one place sync state is determined."
- Source (docs): [docs/save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)

*Negotiate request and response, per Argosy's doc*
- Request: `device_id` and `saves[]` (`rom_id`, `file_name`, `slot`, `emulator`, `content_hash`, `updated_at`, `file_size_bytes`), with optional `rom_ids`.
- Response: `session_id` and `operations[]`, where actions include upload, download, conflict, no_op and delete. Argosy maps `delete` to no-op.
- Without `rom_ids`, every unpaired head comes back as `download`. A per-game negotiate must therefore be scoped with `rom_ids`.
- Source (docs): same file
- **Conflict:** the docs.romm.app Device Sync Protocol page describes an older or simpler shape: `roms[]` with `file`/`mtime`/`sha1`, ops `upload/download/conflict/noop`, and conflict resolutions `keep_both`/`server_wins`/`device_wins` — [docs.romm.app Device Sync Protocol](https://docs.romm.app/latest/developers/device-sync-protocol/). I did not verify which shape RomM 5.2.0 accepts.

*Secure Saves*
- On (the default): Argosy enforces its own cache, and on launch puts the active version back over any change made outside Argosy.
- Off: saves made in place are adopted as new versions. This mode is for people who launch from a different frontend.
- Either way, Argosy backs up the on-disk save before overwriting it and cancels the write if the backup fails.
- Source (docs): [wiki Save-Sync](https://github.com/rommapp/argosy-launcher/wiki/Save-Sync)

*When sync runs*
- On game exit, on launch (pre-launch check), from a 6-hour background worker with a 1 h flex window, manually, on ROM download, and on emulator switch. A user-pinned restore point is respected until the next upload (docs) — same page

*Conflict handling*
- On RomM ≥ 4.9, Argosy relies on the server's per-device sync state and prompts only when the two sides clearly disagree. The user picks the winner from a list of candidates.
- There is a separate Keep Hardcore / Downgrade to Casual / Keep Local modal for RetroAchievements hardcore conflicts.
- A "Save couldn't be restored" prompt offers Use Synced Save or Launch Without Syncing.
- Source (docs): same page

*Coverage*
- What syncs: battery saves, quick and numbered save states, and platform-specific "live" saves (Switch, 3DS, Vita, PSP, PS3, Wii, Wii U, PS2 folder memory cards only, Xbox 360, GameCube, Dreamcast via the built-in core).
- Original Xbox does not sync.
- External emulators sync only if Argosy can read their save path (docs) — same page
- RetroArch save paths are read from `retroarch.cfg` (docs) — same page

*Maintainer caveats*
- `AGENTS.md` calls save sync "incredibly complex" and requires live-data proof for any change (docs) — [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md)
- The 2026-10-02 audit lists many current defects: "There is no shared decision," more than ten "active save" choosers, and hashes computed four ways. It also gives a six-phase consolidation plan (docs) — [docs/save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)

**BIOS and firmware**
- RomM returns firmware metadata (filename, size, hash) per platform. Settings > BIOS Files has "Download Missing" globally or per platform, with MD5 verification and a retry when it mismatches (docs) — [wiki BIOS](https://github.com/rommapp/argosy-launcher/wiki/BIOS)
- Placement (docs) — same page:
  - The built-in emulator gets BIOS copied in automatically on every launch.
  - "Distribute" writes BIOS into each external emulator's known folder. Filenames are mapped by hash, as RetroArch expects specific names.
  - Emulators that import BIOS through their own UI (NetherSX2, hakuX, aPS3e) cannot be reached and need a manual import.
  - The BIOS directory is configurable.
- BIOS downloads resume, and distribution covers RetroArch for every platform (v2.11.0) — [release v2.11.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.11.0)

**Achievements (RetroAchievements)**
- RA works only for the built-in emulator. The user signs in with an RA username and password in Settings > RetroAchievements. Casual and hardcore modes are chosen per launch, with a Play Mode Preference of Ask, Default to Casual or Default to Hardcore. Unlocks queue while offline (docs) — [wiki RetroAchievements](https://github.com/rommapp/argosy-launcher/wiki/RetroAchievements)
- In code, Argosy talks to RA directly (`APP/data/remote/ra/RAApi.kt`, `RetroAchievementsSessionManager`) and also calls RomM's `POST api/users/{id}/ra/refresh` (code) — [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt)
- The README says Argosy "displays achievement data synced from your RomM server" — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md)

**Steam and Android-app integration**
- **Steam login and library.** Argosy signs into Steam by QR code through the Steam mobile app; it never sees the password. It pulls the owned library with metadata, with a 24 h sync cooldown. Downloads come from Steam's CDN into `<ROM dir>/steam/<game>`, with background, pause, resume and reboot-safe behaviour. One Steam download runs at a time, sharing the overall concurrency budget (docs) — [wiki Steam-Integration](https://github.com/rommapp/argosy-launcher/wiki/Steam-Integration)
- **Steam launch.** Games launch through GameNative, a Windows-on-Android runtime. The user must add each install in GameNative once (docs) — same page
- Implementation uses JavaSteam (`io.github.joshuatam:javasteam` 1.8.1) with `SteamAuthManager` (QR), `SteamContentManager` and `SteamDepotManager` (code) — [gradle/libs.versions.toml](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/gradle/libs.versions.toml); [APP/data/steam/](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/steam)
- GOG, Epic and Amazon games installed in GameNative appear as shelves, via GameNative's "Export to Frontend" marker files. GameHub launchers are also supported (docs/code) — [wiki Steam-Integration](https://github.com/rommapp/argosy-launcher/wiki/Steam-Integration); [APP/data/launcher/](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/launcher)
- Steam saves are not covered by Argosy's save sync (docs) — [wiki Steam-Integration](https://github.com/rommapp/argosy-launcher/wiki/Steam-Integration)
- The Android platform is always present. "Scan for Games" adds installed Android games using Play Store metadata. There is also an Apps section for launching apps (docs) — [wiki Storage-and-Paths](https://github.com/rommapp/argosy-launcher/wiki/Storage-and-Paths); [wiki Navigation](https://github.com/rommapp/argosy-launcher/wiki/Navigation)

**Theming and customization**
- **Theme controls:** Light, Dark or System mode; accent and secondary hue sliders; custom font files with display and body scale; surface tint; backdrop patterns; UI scale from 50 to 150%; compact footer; controller-grip reserve (docs) — [wiki Customization](https://github.com/rommapp/argosy-launcher/wiki/Customization)
- **Home and library:** three home layouts (Carousel, Auto Grid, Custom Grid with pages and per-page backdrop and music); library grid or list with density setting; 3D box art; video wallpaper; game-art background with blur, saturation and opacity (docs) — [wiki Home-Screen-Layouts](https://github.com/rommapp/argosy-launcher/wiki/Home-Screen-Layouts); [wiki Customization](https://github.com/rommapp/argosy-launcher/wiki/Customization)
- **Audio, haptics, hardware and language:** per-event UI sounds (Default, RomM Music clip, custom file or silent); background music playlists; game title themes; haptics; RGB LED control; lock screen art; 8 languages (machine-translated) (docs) — [wiki Customization](https://github.com/rommapp/argosy-launcher/wiki/Customization)
- **Design position (2026-07-03):** "No ES-DE-style layout engine". Themes mean color, surface, sound and presentation, not element positioning. Planned theme "packs" are shareable JSON bundles (docs) — [design-handoff/THEMING.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/design-handoff/THEMING.md)

**Controller and navigation model**
- **Button map:** D-pad or left stick moves; A confirms; B goes back; X and Y are contextual; Start opens options. LB/RB switch pages through a floating nav bar; LT/RT switch tabs within a screen. L3 opens the Quick Menu; R3 or holding Back opens the Quick Panel. Pressing Left at the leftmost edge opens the sidebar. A/B, X/Y and Start/Select can be swapped (docs, v2.19.0+) — [wiki Navigation](https://github.com/rommapp/argosy-launcher/wiki/Navigation); [wiki Customization](https://github.com/rommapp/argosy-launcher/wiki/Customization)
- **Implementation:** "InputDispatcher + per-screen InputHandler; index wrap via .mod(). No Compose focus for navigation or selection." Focus is a ViewModel-owned index. Every feature needs touch and gamepad paths, sound feedback, footer hints that follow "control-is-the-guide", and empty, error and loading states (docs) — [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md)

**Offline mode**
- Downloaded games work without RomM. Local changes (saves, ratings, favorites) queue and sync on reconnect (docs) — [wiki RomM-Integration](https://github.com/rommapp/argosy-launcher/wiki/RomM-Integration)
- Cover art can be cached locally for offline browsing — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md)
- Each account can store a LAN and a WAN address, connected LAN-first on every network change (v2.16.0) — [release v2.16.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.16.0)
- The connection retries on backoff and reconnects when the network returns (docs) — [wiki RomM-Integration](https://github.com/rommapp/argosy-launcher/wiki/RomM-Integration)
- **Conflict:** the README says you can "skip for local-only use" — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md). The wiki says "there's no local-only mode on a fresh install" — [wiki First-Launch](https://github.com/rommapp/argosy-launcher/wiki/First-Launch). The wiki is newer (2026-07-31).

**Auto-update**
- An in-app self-updater picks the matching ABI APK from GitHub releases on later updates (docs) — [wiki Installation](https://github.com/rommapp/argosy-launcher/wiki/Installation)
- It is implemented by `UpdateCheckWorker` (WorkManager) and `ApkInstallManager` (code: file list) — [APP/data/update/](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/update)
- A beta channel is available by subscription — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md)
- A changelog browser lives in Settings > About (v2.0.0) — [release v2.0.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.0.0)

**Pairing and authentication**
- **RomM ≥ 5.0:** device-managed registration. The device shows a QR code and short code, and the user approves it in the RomM web UI. Older servers use an 8-character, single-use pairing code from RomM's web UI (Settings > Auth > Pair Device). "Password-based login is no longer supported anywhere in Argosy" (docs) — [wiki First-Launch](https://github.com/rommapp/argosy-launcher/wiki/First-Launch)
- **Device flow code:** the poll loop implements RFC 8628. Only `access_denied` and `expired_token` end it. `slow_down` adds 5 s, capped at 30 s, and five consecutive transient failures give up (code) — [APP/data/remote/romm/DeviceAuthPoller.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/DeviceAuthPoller.kt)
- **Endpoints:** `POST api/auth/device/init` and `POST api/auth/device/token`; pairing-code exchange via `POST api/client-tokens/exchange`. All requests carry `Authorization: Bearer <token>`. A `connectWithToken(url, token)` path also exists (code) — [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt); [RomMApiFactory.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApiFactory.kt); [RomMConnectionManager.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMConnectionManager.kt)
- **Multiple accounts (v2.5.0):** each account has its own saves, achievements and settings. Switching archives the outgoing account's saves off disk. A second account always pairs via the device flow (docs) — [wiki Accounts](https://github.com/rommapp/argosy-launcher/wiki/Accounts)
- Custom certificate import for the RomM server (v2.11.0) — [release v2.11.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.11.0)
- **Evidence it works against RomM 5.2.0 (the user's version).** An Argosy 2.9.0 log in issue #388 shows `version=5.2.0` with these capabilities true: `supportsSyncNegotiate`, `supportsDeviceAuth`, `supportsPlaySessionIngest`, `supportsScreenshotUpload`, `supportsMusicApi` — [issue #388](https://github.com/rommapp/argosy-launcher/issues/388)

**Other features (out of scope for a first Linux MVP, listed for completeness)**
- Jellyfin media client (v2.8.0) — [release v2.8.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.8.0)
- Play-time stats hub, with play sessions synced to RomM (v2.16.0) — [release v2.16.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.16.0)
- Multi-screen roles, manuals and walkthrough reader, friends (v2.17.0) — [release v2.17.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.17.0)
- Reviews (v2.12.0) — [release v2.12.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.12.0)
- QuayPass Bluetooth social (v2.4.0) — [release v2.4.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.4.0)
- Netplay, speedrun mode, cheats, shaders and bezels — [wiki Home](https://github.com/rommapp/argosy-launcher/wiki)
- Screenshot upload to RomM (v2.0.0) — [release v2.0.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.0.0)

### Inferences
- **Feature mapping to the device.**
  - Steam: armadaOS boots into Steam Game Mode, so the Argosy features built around Steam (JavaSteam depot downloads, GameNative and GameHub) map to almost nothing on Linux. There, Steam is native and only needs indexing, for example by reading local `appmanifest_*.acf` and launching with `steam://rungameid/<id>`.
  - Built-in emulator: Argosy's largest single feature has no counterpart need, because the user already has standalone emulators and RetroArch.
- **What the MVP should copy.**
  - Feature list: device-flow pairing, a capability-gated RomM client, metadata-only library sync with incremental refresh, on-demand download on launch with a progress overlay, BIOS "download missing + distribute", hash-based save sync via negotiate with Secure-Saves-style backup-before-overwrite, collections with "Download All", and the controller model.
- **Risks to plan around.**
  - Concurrency: Argosy defaults to one concurrent download, likely for handheld storage and thermal reasons. A Linux client on the user's LAN could expose 1–3.
  - Save sync: Argosy's own maintainers have repeatedly found defects in it, documented on 2026-10-02. A Linux clone should start from the "target flow" (one decide function, one writer, hash-keyed ledger), not the historical code paths.

### Gaps
- I could not verify which negotiate request shape RomM 5.2.0 accepts. Argosy's doc cites RomM master and 5.3.1; the public docs page shows a different schema. Check `backend/endpoints/sync` in RomM's 5.2.0 tag.
- I did not find whether RomM 5.2.0's heartbeat reports `SAVE_SYNC.SNAPSHOTS`. That decides whether Argosy-style Sigil snapshot sync is available on the user's server.
- I did not read the in-app updater code to confirm it uses the GitHub releases API rather than another feed. The wiki only says "in-app self-updater".

---

## 2. Architecture, tech stack, RomM API access, and reusable SDKs

### Takeaway
Argosy is a single large Android app module, about 1,571 Kotlin files and 370k lines. It is built with Jetpack Compose, Hilt, Room (schema v206), DataStore, Retrofit, OkHttp, Moshi and WorkManager, plus two native modules: `:libretrodroid` and `:sigil`. Its RomM client is a hand-written Retrofit interface with version-based capability gating. Neither rommapp nor Argosy publishes a Kotlin SDK or generated client. The only shared, reusable library is **argosy-sigil**, an MPL-2.0 C library with C, Kotlin/JNI, Go and Python bindings that implements save identification and RomM-compatible save units.

### Cited Findings

**Toolchain and modules**
- Toolchain: Kotlin 2.1.21, AGP 8.7.3, Compose BOM 2024.12.01, Hilt 2.54, Room 2.7.1, DataStore 1.1.1, Retrofit 2.9.0, OkHttp 4.12.0, Moshi 1.15.0, Coil 2.7.0, Media3 1.5.1, WorkManager 2.10.0, Socket.IO client 2.1.1, JavaSteam 1.8.1, androidx.tv (code) — [gradle/libs.versions.toml](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/gradle/libs.versions.toml)
- SDK levels: minSdk 26, compileSdk and targetSdk 35 — [app/build.gradle.kts](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/build.gradle.kts)
- Other dependencies: CameraX and zxing (QR), commons-compress, xz and zstd-jni (archives), BouncyCastle, lazysodium, weupnp — same file
- Gradle modules: `:app`, `:sigil` (from `sigil/bindings/android`, a submodule of `rommapp/argosy-sigil`) and `:libretrodroid` (C++/JNI with the rcheevos submodule) (code) — [settings.gradle.kts](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/settings.gradle.kts); [.gitmodules](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/.gitmodules)

**Layering and package layout**
- Layering is `ui/ -> domain/ -> data/`. `domain/` must be Compose-free. Being Android-free is "aspirational with known debt across 13 files". A Compose stability contract applies (docs) — [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md)
- Top-level packages under `com.nendo.argosy`: `core/`, `data/`, `di/`, `domain/`, `hardware/`, `libretro/`, `ui/`, `util/` (code).
  - `data/` subpackages: cache, cheats, download, emulator, install, installer, launcher, local, media, music, netplay, platform, preferences, quaypass, remote, repository, scanner, social, speedrun, steam, storage, sync, titledb, update, wallpaper.
  - Source: [APP/](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy)

**Size** (counted locally at commit 2714d54; code)
- 1,571 `.kt` files and about 369,848 lines under `app/src/main/kotlin`.
- `ui/` has 658 files; `domain/` 108; `data/sync` 68; `data/local` 147; `data/remote/romm` 33.
- The Room database is `ALauncherDatabase` at `version = 206`, with 72 `@Entity` and 67 DAO interfaces.

**RomM client**
- A hand-written Retrofit interface, `RomMApi.kt` (about 14 KB), with no OpenAPI codegen. Supporting classes:
  - `RomMApiClient` (20 KB)
  - `RomMLibrarySyncService` (75 KB)
  - `RomMConnectionManager` (44 KB)
  - `RomMCollectionSyncService`, `RomMUserPropertyService`, `RomMDeviceSocket` (Socket.IO)
  - `RomMCapabilities` (version gates)
  - Source (code): [APP/data/remote/romm/](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm)
- Capability gates: `MIN_SUPPORTED_VERSION = "4.9.0"`, `DEVICE_AUTH_MIN_VERSION = "5.0.0"`, `SCREENSHOT_UPLOAD_MIN_VERSION = "5.0.0"`, `MUSIC_PLAYLISTS_MIN_VERSION = "5.1.0"`, `MUSIC_GAMES_MIN_VERSION = "5.3.0"`, `DEVICE_INSTALL_MIN_VERSION = "5.4.0"`. Argosy "supports the latest three RomM minor releases" (code) — [RomMCapabilities.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMCapabilities.kt)
- The RomM version testbed (docs dated 2026-08-03) pins 4.9.2, 5.0.0 and 5.1.0 in Docker so response shapes can be compared. The repo also has `testbed/romm/romm-5.x.yml` files (docs) — [testbed/romm/README.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/testbed/romm/README.md)

**rommapp org repos** (snapshot 2026-10-08) — [api.github.com/orgs/rommapp/repos](https://api.github.com/orgs/rommapp/repos)
- `romm` (Python, 13,275★)
- `argosy-launcher` (Kotlin, 628★)
- `grout` (Go, 237★, "A RomM Client for your Linux retro handheld")
- `playnite-plugin` (C#, 109★)
- `ludo` (Python, 19★, "RomM client for Steam Deck (Decky plugin) and desktop")
- `desktop` (TypeScript, 1★)
- `argosy-sigil` (C, 4★)
- `rom-mp` (Kotlin, an Android music player)
- `ROMCruncher` (TypeScript)
- `ROMMPL` (C)
- archived `muos-app` and `miyoo-mini-app`
- No repo is an SDK or a generated API client.

**Third-party and generated clients**
- RomM publishes an OpenAPI spec usable with generators — [docs.romm.app OpenAPI (4.9.0)](https://docs.romm.app/4.9.0/developers/openapi/)
- One third-party typed client exists: the Rust crate `romm-api` 1.3.0 — [docs.rs romm-api](https://docs.rs/crate/romm-api/1.3.0)
- I found no official Kotlin, Python or TypeScript SDK (web search).

**argosy-sigil**
- It "reads the game-native title id out of a ROM, finds the save files an emulator keeps for that game, and moves them between the emulator and a RomM server"
- It archives and hashes saves "the way RomM does"
- Bindings: C (`include/sigil.h`), Kotlin/Java (Android JNI), Go (cgo), Python (cffi)
- License MPL-2.0; status "Pre-1.0"
- Source: [rommapp/argosy-sigil README](https://github.com/rommapp/argosy-sigil)
- **Emulator ids relevant to the user's installed set:** `duckstation` (standalone), `pcsx2_standalone` ("PCSX2, AetherSX2, NetherSX2, ARMSX2"), `dolphin_standalone`, `flycast_standalone`, and libretro cores (`pcsx_rearmed`, `swanstation`, `flycast`, `dolphin`, …). "The client always tells sigil which emulator runs the game and where that emulator keeps its saves; sigil never searches the drive" — [argosy-sigil docs/platforms/README.md](https://github.com/rommapp/argosy-sigil/blob/main/docs/platforms/README.md); [README](https://github.com/rommapp/argosy-sigil)
- **How Argosy uses Sigil:** on servers whose heartbeat reports `SAVE_SYNC.SNAPSHOTS`, standalone Dolphin and other card or profile emulators go through `SigilSaveHandler`. Older servers keep the legacy handlers (docs) — [docs/save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)

**Other RomM desktop clients**
- `rommapp/desktop` is an Electron shell. It loads the server's own web UI and injects `window.rommNative` to launch local emulators, and "has no interface of its own".
- Its README lists Argosy, Grout and the Playnite plugin as "first party", and names community desktop clients romm-client (chaun14) and RomMix (leclercb).
- Source: [rommapp/desktop README](https://github.com/rommapp/desktop)
- `rommapp/ludo` (GPL-3.0, Python):
  - Features: gamepad-first; downloads with resume and extraction; two-way save and state sync on a watchdog; launches RetroArch or Eden; handles BIOS, cores and firmware.
  - Shipped as `Ludo-v<version>-decky.zip` for Decky Loader and as an x86_64 AppImage.
  - Pairs with RomM by QR code or by typing the address, and self-updates from GitHub releases.
  - Source: [rommapp/ludo README](https://github.com/rommapp/ludo)

### Inferences
- **Reusable pieces, best first.**
  1. **argosy-sigil.** It works through its C or Python binding, and the MPL-2.0 license allows use from any-license code. It is pre-1.0, so pin a commit.
  2. **The documented RomM semantics.** These are `docs/save-sync-flow.md`, `docs/romm-sync-rules.md` and `docs/romm-sync-optimization.md`. They are effectively a spec of RomM client behaviour, including server pitfalls such as "with_rom_id_index=false is 2–4× slower".
  3. **The endpoint list and capability gates** from `RomMApi.kt` and `RomMCapabilities.kt`.
  4. **UX patterns.**
- **Code copying is constrained.** Argosy is GPL-3.0, so copying its code requires the Linux project to be GPL-3.0-compatible. That is fine for a public GitHub repo if the user chooses GPL-3.0.
- **Ludo may make a separate frontend unnecessary.** It is a first-party rommapp project that already targets Decky Loader and gamepad use, and armadaOS ships Decky. It ships only an x86_64 AppImage, but its Decky zip may be architecture-independent (Python + JS). Whether it runs on aarch64 needs checking.
- **Language choice.** Generating a client from the RomM 5.2.0 OpenAPI spec (`/openapi.json` on the user's server) is likely more robust than hand-porting Argosy's Retrofit interface, whatever language is chosen.

### Gaps
- I did not inspect Grout's or Ludo's code (Grout's README was rate-limited). Other research tracks may cover them.
- I did not confirm whether Ludo's Decky plugin runs on aarch64.
- I did not confirm the exact OpenAPI path on RomM 5.2.0. Docs for different versions disagree between `/openapi.json` and `/api/openapi.json`.

---

## 3. License, governance, activity, roadmap, and Linux/desktop plans

### Takeaway
Argosy is GPL-3.0 and is an official, first-party rommapp project. It was originally developed under the "nendotools" name and later moved into the rommapp org. It is extremely active, with multiple releases per week and 3,179 commits. Releases are maintainer-only. There is no public roadmap or GitHub Discussions. Linux support has been explicitly declined twice as "way out of scope", with the maintainer pointing to PC alternatives in the RomM community. I found no plans for Compose Multiplatform or desktop.

### Cited Findings
- **License:** GPL-3.0 (LICENSE header "GNU GENERAL PUBLIC LICENSE Version 3") — [LICENSE](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/LICENSE); [GitHub API repo metadata](https://api.github.com/repos/rommapp/argosy-launcher)
- **First-party status.** docs.romm.app's First-Party Apps page lists Argosy Launcher as "our first-party Android app", platform "Android (AYN Thor, Retroid, etc.)". It lists Grout as the first-party app for Linux handhelds (muOS, MinUI, NextUI) and the Playnite plugin for Windows. Ludo is not listed — [docs.romm.app First-Party Apps](https://docs.romm.app/latest/ecosystem/first-party-apps/)
- **Origins.**
  - README badges and links still point to `nendotools/argosy-launcher`, and the Android namespace is `com.nendo.argosy` — [README](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/README.md); [app/build.gradle.kts](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/build.gradle.kts)
  - The repo's `created_at` is 2025-12-06 — [GitHub API](https://api.github.com/repos/rommapp/argosy-launcher)
- **Activity** (snapshot 2026-10-08) — [GitHub API](https://api.github.com/repos/rommapp/argosy-launcher):
  - 628 stars, 46 forks, 157 open issues
  - `has_discussions: false`
  - last push 2026-10-07
  - 3,179 commits in the clone
  - about 40 tagged releases between 2026-06-25 (v1.14.1) and 2026-10-05 (v2.19.4)
  - Source for tags: [tags](https://github.com/rommapp/argosy-launcher/tags)
- **Governance (AGENTS.md):**
  - "Releases are maintainer-only, and so are release builds, signing config, applicationId and the version fields."
  - Social, netplay and music/BGM are maintainer domains, and `libretrodroid/` is "maintainer-locked".
  - Contributions go through a "Takt" review gate (`scripts/review.sh`, `takt-summary.yml` workflow).
  - The repo has a `.claude/` directory and an "Agent Constitution" for "ANY coding agent".
  - Source (docs): [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md); [.github/workflows](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/.github/workflows)
- **Linux requests declined.**
  - Issue #183 "Add Linux support" (2026-04-25) was closed as not_planned. Maintainer `tmgast`: "This is way out of scope. There are several PC alternatives in the works within the RomM community which might be able to satisfy this request." — [issue #183](https://github.com/rommapp/argosy-launcher/issues/183)
  - Issue #164 "Linux based Argosy-Launcher" (2026-03-27) was closed as not_planned. Maintainer: "Google isn't removing side-loading…" — [issue #164](https://github.com/rommapp/argosy-launcher/issues/164)
- Issue #388 "Immediate crashing on Desktop Mode" (open, 2026-08-26) is about **Android 17 desktop mode** on a Pixel 10 Pro, not Linux — [issue #388](https://github.com/rommapp/argosy-launcher/issues/388)
- **Visible near-term direction.** There is no public roadmap. In-repo design docs describe the theme-pack plan and the save-sync consolidation phases (1–6). They also propose optional RomM server changes S1–S5: head-only upload dedupe, compare-and-swap uploads, an opt-in conflict-on-no-pairing flag, a `content_hash` backfill, and a hardcore pairing qualifier (docs) — [design-handoff/THEMING.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/design-handoff/THEMING.md); [docs/save-sync-flow.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/save-sync-flow.md)

### Inferences
- **No upstream Linux port is coming.** The maintainer has closed Linux twice, Argosy's architecture is deeply Android-specific, and RomM already has other desktop efforts: `desktop`, `ludo` and Grout. Any Argosy-like Linux client will be a separate project.
- **Track Argosy's release notes.** At this pace (several releases a week), Argosy's feature set is a moving target. Its release notes and docs are the best living spec of "what a good RomM client does".
- **The process is worth emulating.** The repo is clearly built with heavy coding-agent assistance (AGENTS.md, `.claude/`, Takt gate). That makes its conventions directly relevant to the user's plan of autonomous Claude Code development: the "completeness matrix" and the live-data proof for save sync.

### Gaps
- I could not determine when or how the repo moved from nendotools to rommapp. The GitHub API `created_at` may reflect the transfer, and the API rate limit blocked further queries.
- I could not read CODEOWNERS or the full maintainer list. The RomM Discord announcements are not public, so they were not checked.
- newreleases.io, alternativeto.net and deepwiki were not consulted. GitHub releases and the source were used as the primary sources instead.

---

## 4. UX specifics worth copying

### Takeaway
Argosy's UX centers on a few strong patterns.
- **Home launches, Library browses.** A on Home launches directly. The Library opens as a platform grid with combinable filter tabs and an A-Z rail.
- **One Play button for everything.** A game that isn't downloaded still shows a single A-to-play action. It downloads automatically, then runs a step-by-step launch overlay that can be cancelled (save sync → core → system files → launch).
- **Granular download status.** There are ten states, multi-file downloads aggregate into one row, and waiting states are explicit ("Waiting for server", "Waiting for Storage").
- **Persistent controller hints.** A footer guide bar, an L3 quick menu and an R3 quick panel.

### Cited Findings

**Home screen**
- Home surfaces recently played, favorites, "Picks" (from play and download history) and pinned collections. Pressing A on Home acts on the focused item, launching a game rather than opening its details (docs) — [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games)
- **Layouts (v2.6.0+)** (docs) — [wiki Home-Screen-Layouts](https://github.com/rommapp/argosy-launcher/wiki/Home-Screen-Layouts):
  - Carousel: one rail per section with the focused cover enlarged; Row Position, Focus Anchor, Resting Size 50–100%, Push Neighbours, Platform Badge, 3D Box Art.
  - Auto Grid: 2–8 lanes, vertical or horizontal; shoulders switch sections.
  - Custom Grid: pages of cells holding games, collections, apps or media; tiles can be resized; "Add New Downloads" can append finished downloads automatically; the picker offers installed games only.
- Home rows keep installed and favourite games first (v2.16.0). Continue, Random and RetroAchievements tiles exist (v2.13.0) — [release v2.16.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.16.0); [release v2.13.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.13.0)
- An "Installed Games Only" home option exists (docs) — [wiki Customization](https://github.com/rommapp/argosy-launcher/wiki/Customization)

**Game detail page**
- **Launching.** A launches. Start opens a context menu (manage saves, select variant, file management, netplay). A left-hand menu holds Per-Game Settings.
- **Content.** Related Games (series, franchise, genre and era); a rotating 3D box when ScreenScraper box sides exist; the title theme can play; a manual or walkthrough reader is available.
- **Sync status.** Each game shows synced, pending, failed or not configured, plus where its saves live.
- Sources (docs/release notes): [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games); [wiki Save-Sync](https://github.com/rommapp/argosy-launcher/wiki/Save-Sync); [release v2.0.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.0.0); [release v2.3.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.3.0)
- **Download status model.** The game detail model has `GameDownloadStatus { NO_FILE, NOT_DOWNLOADED, QUEUED, WAITING_FOR_STORAGE, DOWNLOADING, EXTRACTING, PAUSED, FAILED, DOWNLOADED, NEEDS_INSTALL }` (code) — [APP/ui/screens/gamedetail/GameDetailModels.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/ui/screens/gamedetail/GameDetailModels.kt)

**A game that isn't downloaded**
- Launching it downloads first, automatically.
- If a save exists locally or on RomM, the user is offered Continue or New Game, "so a freshly synced device picks up your cloud progress instead of starting over".
- If the game has several regional copies, downloading opens a variant picker showing region, revision and tags, with Hack, Translation or Pre-release labels. The choice is stored as a device-local pick. Launching never prompts.
- Missing discs of a multi-disc game prompt a fetch.
- Sources (docs): [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games); [docs/romm-sync-rules.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/docs/romm-sync-rules.md)

**Download progress presentation**
- The Downloads section is a nav-bar page (docs) — [wiki Navigation](https://github.com/rommapp/argosy-launcher/wiki/Navigation):
  - active and completed downloads, with retry for failures and queue management
  - "multi-file games collapse into one entry with aggregate progress and a per-file breakdown"
- Touch: tapping a row shows its controls beside a full-height cover, with options to view the game or clear finished downloads (v2.16.0) — [release v2.16.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.16.0)
- Explicit waiting states: "Waiting for server" while RomM prepares a large download (v2.13.0) and "Waiting for Storage" when low on space (docs) — [release v2.13.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.13.0); [wiki Storage-and-Paths](https://github.com/rommapp/argosy-launcher/wiki/Storage-and-Paths)
- Home and library redraw less during downloads (v2.15.0), and no longer flicker while art downloads (v2.19.4) — [release v2.15.0](https://github.com/rommapp/argosy-launcher/releases/tag/v2.15.0); [release v2.19.4](https://github.com/rommapp/argosy-launcher/releases/tag/v2.19.4)

**Launch overlay** (v2.19.2)
- It shows each step: checking and syncing the save, downloading the core, preparing system files, launching.
- B or Cancel stops it. Work in progress (a save or core download) finishes in the background, so nothing is left half-written. A relaunch waits for the cancelled launch.
- Source (docs): [wiki Playing-Games](https://github.com/rommapp/argosy-launcher/wiki/Playing-Games)

**Navigation chrome**
- A footer guide bar shows available actions and "tucks away when there's nothing useful to say".
- A floating nav bar appears on LB/RB and then hides. Its pages are configurable.
- A sidebar shows the user's profile.
- The Quick Menu (L3) offers search, random and recents. The Quick Panel (R3) offers brightness, volume, theme, device toggles, Screens, Performance and Music.
- Settings rows cycle with Left/Right, and A opens the full picker.
- Source (docs): [wiki Navigation](https://github.com/rommapp/argosy-launcher/wiki/Navigation)

**Visual language** (design record)
- "Modern, clean, real game console. Not Material." Home and Game Detail are the "two locked anchors".
- Dark mode uses a near-black elevation ramp: `#050507` base → `#13141a` → `#1c1e26` → `#262834`.
- Default accent is cyan `#00ACC1` in dark mode and `#007C91` in light mode.
- "Color lives in accents and per-game art, never in chrome." "No outline-only buttons."
- Source (docs): [design-handoff/CONTROL-FOUNDATIONS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/design-handoff/CONTROL-FOUNDATIONS.md)
- Design tokens are generated from `design-system-docs/tokens.json` by `scripts/gen-tokens.mjs` (docs) — [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md)

### Inferences
- **Patterns to copy on the 1280x960 (4:3) Retroid Pocket Nova:**
  - the carousel home with "installed first" ordering
  - one Play affordance that transparently becomes download → overlay → launch
  - a downloads page with aggregate multi-file progress and named waiting states
  - a variant picker at download time, never at launch
  - Continue/New Game when a cloud save exists
  - a footer hint bar
  - the near-black token palette
- **Input model for Linux.** "No framework focus; ViewModel-owned focus index; per-screen input handler" is framework-agnostic and is the right model on Linux too. Gamepad input there would come from SDL or evdev rather than Android `KeyEvent`.
- **Lower priority:** multi-screen, media tiles and page music. The 4:3 single-screen device doesn't need them for an MVP.

### Gaps
- I did not view the README screenshots (images), so exact visual layouts (spacing, typography) come from text only.
- The 2.x UI was redesigned again in v2.19.0 (new navigation). The wiki pages are partly updated as of 2026-10-04, but some may lag.

---

## 5. Could Argosy's Kotlin/Compose code be ported to Compose Multiplatform Desktop on Linux aarch64? And what does romm-sync prove?

### Takeaway
Porting the app is not realistic.
- **Coupling.** About 968 of 1,571 files import android or androidx APIs. Hilt is in 176 files and Android `Context` in 243.
- **Core subsystems are Android-only.** Launching is Intent-based, detection uses PackageManager, storage goes through SAF and DocumentsContract, background work runs in foreground services, input is `KeyEvent`, playback uses Media3, and the built-in emulator is a JNI/GL module.
- **Smaller ports are possible.** The RomM client package (5 of 33 files touch Android) and parts of `domain/` could be lifted into a pure-JVM module. Room is migratable to KMP with work.

romm-sync shows a realistic shape: a shared pure-JVM `core` for the RomM API and sync, plus a separately written Compose Desktop UI. It also shows that a jlinked Compose Desktop AppImage runs on Linux aarch64. It does **not** prove that an Android Compose UI ports to desktop, that gamepad input works, or that it behaves well under gamescope.

### Cited Findings

**Android coupling in Argosy** (counted with grep on `import` lines at commit 2714d54; code)
- Files importing android/androidx out of 1,571 `.kt` files:
  - any `android.*` or `androidx.*`: 968
  - `android.*` framework: 427
- By API:

  | Import | Files |
  |---|---|
  | `androidx.compose` | 416 |
  | `android.content.Context` | 243 |
  | `dagger.hilt` | 176 |
  | `androidx.room` | 151 |
  | `androidx.lifecycle` | 94 |
  | `coil` | 74 |
  | `android.content.Intent` | 69 |
  | `com.squareup.moshi` | 46 |
  | `okhttp3` | 38 |
  | `android.view.KeyEvent` / `InputDevice` / `MotionEvent` | 36 |
  | `retrofit2` | 25 |
  | `android.content.pm` | 24 |
  | `androidx.datastore` | 17 |
  | `androidx.work` | 8 |
  | `androidx.media3` | 7 |
  | `SupportSQLiteDatabase` | 1 |

- By package (files with any android/androidx import):

  | Package | Coupled / total |
  |---|---|
  | `data/remote/romm` | 5 / 33 |
  | `domain` | 12 / 108 |
  | `data/sync` | 24 / 68 |
  | `data/download` | 9 / 17 |
  | `data/local` | 144 / 147 |
  | `ui` | 513 / 658 |

- WorkManager is used only in `ALauncherApp`, `SaveSyncWorker`, `UpdateCheckWorker`, `CoreUpdateCheckWorker`, `CheatsSyncWorker`, `AchievementSubmissionWorker`, `SocialSyncWorker` and `QuayPassCredentialRefreshWorker` (code).
- Sources: [repo tree](https://github.com/rommapp/argosy-launcher/tree/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy); [libs.versions.toml](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/gradle/libs.versions.toml)

**Coupling rules stated in AGENTS.md**
- File access goes through `FileAccessLayer` plus the Manage Storage permission, with a DocumentsContract fallback.
- Input goes through `InputDispatcher` plus per-screen `InputHandler`, with root key sinks per Android activity.
- Dual-screen state lives in `DualScreenManager` StateFlows, with activities as consumers.
- "Every user-facing string is a resource id" (Android `R`, `@StringRes`).
- Source (docs): [AGENTS.md](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/AGENTS.md)
- Launch is built on Android `Intent`, `ComponentName`, FileProvider URI grants and `clipData` (code) — [LaunchCommand.kt](https://github.com/rommapp/argosy-launcher/blob/2714d5453b6bbef790987071ab0e82068009532b/app/src/main/kotlin/com/nendo/argosy/data/emulator/LaunchCommand.kt)

**Room on KMP**
- Room supports KMP on Android, iOS and JVM desktop.
- Non-Android DAOs must be `suspend` or return `Flow`.
- `androidx.sqlite.db` / `SupportSQLite*` APIs are Android-only; migrations take `SQLiteConnection`.
- `BundledSQLiteDriver` is recommended.
- The current docs page targets `androidx.room3` 3.1.0-alpha01, and Linux as a named target is not mentioned.
- Source: [developer.android.com Room KMP](https://developer.android.com/kotlin/multiplatform/room)

**romm-sync facts**
- **Identity:** MIT license; v0.8.4 (versionCode 69) at commit `1a31cd4`, 2026-10-05; first commit 2026-06-17; 115 commits — [romm-sync README](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/README.md)
- **Modules:**
  - `:core` is pure JVM: Retrofit, OkHttp, Moshi, coroutines; 25 files, about 3.4k lines; RomM API, Device Sync Protocol and per-emulator save handlers.
  - `:app` is Android: Jetpack Compose Material3, Room, WorkManager, DataStore, Coil; 54 files, about 12.7k lines.
  - `:desktop` is Compose Desktop 1.7.3 with Material3; 17 files, about 5.5k lines. It includes a `DesktopSyncCoordinator` that runs the sync cycle "without Room/WorkManager", a `DownloadEngine` and a `java.util.prefs` config.
  - Sources (code/docs): [README Arquitectura](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/README.md); [core/build.gradle.kts](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/core/build.gradle.kts); [desktop/build.gradle.kts](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/desktop/build.gradle.kts)
- **Packaging:** self-contained AppImages for x86_64 and aarch64 with a jlinked Java runtime (about 70 MB), plus Deb and Rpm targets. The README names "Raspberry Pi 5, ARM handhelds" for aarch64 — [README](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/README.md); [desktop/build.gradle.kts](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/desktop/build.gradle.kts)
- **aarch64 build method:** a single `ubuntu-latest` (x86_64) runner builds an architecture-independent fat jar. It downloads the Temurin aarch64 JDK and cross-jlinks a runtime from that JDK's jmods, then packages with `appimagetool` (code) — [.github/workflows/build-appimage.yml](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/.github/workflows/build-appimage.yml)
- **Known aarch64 pitfall, fixed in v0.5.7 (2026-09-27):** the aarch64 AppImage "crashed with LibraryLoadException" because `compose.desktop.currentOs` bundles only the host's skiko native library. The fix is an explicit `implementation("org.jetbrains.skiko:skiko-awt-runtime-linux-arm64:0.8.18")` (code) — [desktop/build.gradle.kts](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/desktop/build.gradle.kts); commit "fix: bundle skiko arm64 natives in desktop jar" in [romm-sync history](https://github.com/davidadrianrg/romm-sync/commits/master)
- **The desktop module was split out late.** It was introduced 2026-09-25 in "feat: extract :core module (JVM), add :desktop Compose app + AppImage CI (x86_64/aarch64)" (git log) — [romm-sync history](https://github.com/davidadrianrg/romm-sync/commits/master)
- **Input:** the desktop UI has keyboard shortcuts only, via AWT `KeyEventDispatcher` (Ctrl+1..5 tabs, F5). I found no gamepad, SDL or evdev code in `desktop/src`. The Android UI is described as "navegación pensada para dedos" (touch-oriented) (code) — [desktop Main.kt](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/desktop/src/main/kotlin/es/davidrg/rommsync/desktop/Main.kt); [README](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/README.md)
- **Auth and features:**
  - Auth uses a RomM API key (`rmm_…` token) entered manually, not a device flow.
  - Sync uses RomM's Device Sync Protocol (RomM 4.9+).
  - Downloads run 1–5 in parallel with resume and hash verification.
  - It exports ES-DE `gamelist.xml` and media.
  - The desktop app self-updates from GitHub releases.
  - Source (docs): [README](https://github.com/davidadrianrg/romm-sync/blob/1a31cd44603c3355b305f84e9e9d79a76a18bc65/README.md)

### Inferences
- **What romm-sync proves.**
  1. A Kotlin JVM Compose Desktop app can be packaged as an aarch64 AppImage built in GitHub Actions without ARM runners. This fits "autonomous cloud development, user only tests".
  2. The skiko arm64 native must be added explicitly when cross-building.
  3. The RomM API and save-sync logic can live in a pure-JVM module shared with Android.
- **What romm-sync does not prove.**
  1. It does not show that Android Compose UI code (Argosy's or its own) ports. It wrote a second UI.
  2. It does not show controller-first navigation on Linux. Compose Desktop has no gamepad API, so one would need SDL2 via JNA/JNI or evdev.
  3. It does not show smooth behaviour under gamescope. Compose Desktop uses AWT, so it would likely run through XWayland inside gamescope.
  4. It says nothing about 120 Hz frame pacing or performance on Adreno 740 / Turnip with Skia's GL or software backends.
  5. It does not show first-boot startup time for a 70 MB JVM app on a handheld.

  None of these are documented by romm-sync; all need on-device testing.
- **Blockers to a Compose Multiplatform port of Argosy, in rough order of cost:**
  1. Hilt DI (176 files) → Koin or manual DI.
  2. Android `Context` in 243 files.
  3. Android string resources everywhere → compose-resources.
  4. The input layer built on `KeyEvent` and activity key sinks → a new SDL/evdev gamepad layer.
  5. Emulator detection and launch via PackageManager and Intents → Flatpak (`flatpak run`) and AppImage exec with command-line arguments. This is a full rewrite of the 86 KB registry and the 96 KB `GameLauncher`.
  6. Storage via SAF, DocumentsContract and Manage Storage → plain POSIX paths, which is a simplification.
  7. Foreground services and WorkManager (8 files) → coroutines plus a systemd user timer or in-process scheduler.
  8. Coil 2 → Coil 3 (KMP) or Compose image loading.
  9. Media3 → drop.
  10. androidx.tv → drop.
  11. `:libretrodroid` → drop.
  12. Room 2.7.1 → Room KMP. This is mainly mechanical, since only one file uses SupportSQLite, but it touches 151 files and 206 schema migrations.
- **Effort and recommendation.** This adds up to a rewrite with Argosy as a spec. A pragmatic plan for the user's goal:
  - Treat Argosy's docs, wiki and release notes as the product spec, and its `RomMApi.kt`, `RomMCapabilities.kt` and sync docs as the protocol reference.
  - Reuse argosy-sigil through its native C or Python bindings for save units.
  - Choose a stack based on gamescope and gamepad fit rather than Kotlin continuity. Options other researchers may evaluate include a Decky-integrated approach like Ludo, a native SDL/Qt app, or Compose Desktop plus an SDL gamepad bridge.
- **Licensing for any copied code.** If Argosy code is copied (GPL-3.0), the Linux project must be GPL-3.0. romm-sync's MIT `core` module could be used more freely. It is far less mature (v0.8.x, about 3.4k lines) and its save handlers are separate from Sigil.

### Gaps
- I did not test romm-sync's aarch64 AppImage, and found no user reports of it running on Snapdragon devices or under gamescope. The GitHub API rate limit blocked reading its issues and release download counts.
- I did not confirm whether Compose Multiplatform 1.8+/1.9+ now targets Linux desktop with any gamepad support. I found no source in this session.
- Room KMP's support for Linux-specific JVM desktop is implied by "JVM desktop" but not stated explicitly for Linux aarch64. `BundledSQLiteDriver` ships native SQLite per platform, and linux-arm64 availability was not verified.
