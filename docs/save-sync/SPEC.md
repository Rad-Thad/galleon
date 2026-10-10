# Save sync: what Argosy does on RomM 5.2.0, and what Galleon must do to match

This is the specification ADR 0002 asks for before any engine change (M2-01). It describes how Argosy, the Android launcher on the owner's Nova, syncs saves with a **RomM 5.2.0** server, and how RomM 5.2.0 answers. It is the input to the shape report (M2-02), the golden fixtures (M2-03), the hash (M2-04), the engine (M2-05), the transfers (M2-06) and the per-system work (M2-09 to M2-14).

## Sources and how to read the citations

- **Argosy** is `rommapp/argosy-launcher` at `2714d5453b6bbef790987071ab0e82068009532b` (GPL-3.0). It was read as a specification only. Nothing here is copied from it; every sentence about it is a description in our own words.
- **RomM** is `rommapp/romm` at tag `5.2.0` (AGPL-3.0), read the same way, plus this repo's [`reference/romm-api/openapi-5.2.0.json`](../../reference/romm-api/openapi-5.2.0.json).
- Citation prefixes:
  - `A:` is Argosy's `app/src/main/kotlin/com/nendo/argosy/`. `Adoc:` is Argosy's `docs/`.
  - `R:` is RomM's `backend/` at 5.2.0. `S:` is a JSON pointer into the 5.2.0 OpenAPI schema.
  - Paths with no prefix are in this repo.
- Line numbers are at those exact revisions. Argosy's own `docs/save-sync-flow.md` says its line numbers drift and describes planned behaviour, so where its docs and code disagree, this spec follows the code and says so.
- Argosy's save-id formats for some systems come from its native `sigil` submodule (MPL-2.0). This spec does not rely on that code; where an answer depends on it, it is an open question for M2-02 (section 12).

## 1. Which path Argosy takes on a 5.2.0 server

- **The legacy per-platform handlers, not Sigil.** Argosy routes a save through `SigilSaveHandler` only when the server's heartbeat reports `SAVE_SYNC.SNAPSHOTS` (`A:data/remote/romm/RomMModels.kt:419-428`; `A:data/remote/romm/RomMConnectionManager.kt:179-182`; `A:data/sync/platform/SigilSaveHandler.kt:265-271`). Otherwise the registry picks, in order: GameCube GCI, a folder handler, the unit handler for RetroArch and the built-in core, Switch, Dreamcast, a per-platform folder handler, the built-in core, then the default file handler (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:70-91`).
- **RomM 5.2.0 has no `SAVE_SYNC` in its heartbeat.** `GET /api/heartbeat` returns SYSTEM, METADATA_SOURCES, FILESYSTEM, EMULATION, FRONTEND, OIDC and TASKS only (`R:endpoints/heartbeat.py:61-132`; `R:endpoints/responses/heartbeat.py:59-66`; `S:components.schemas.HeartbeatResponse.properties`).
- **But Argosy does use negotiate on 5.2.0.** It picks its negotiate strategy whenever the server is at least 4.9.0 and does not report snapshots (`A:data/sync/strategy/SaveSyncStrategySelector.kt:14-17`; `A:data/remote/romm/RomMCapabilities.kt:29,61,66`). It also trusts the server's `content_hash` from 4.9.0 (`A:data/remote/romm/RomMCapabilities.kt:31,70`). So on the owner's server, Argosy writes the legacy archive shapes **and** decides through `POST /api/sync/negotiate`.
- One caveat: the unit handler asks the native `Sigil.locateSaves` which files make up a RetroArch save unit, and that call is not gated on the heartbeat (`A:data/sync/SaveUnitResolver.kt:83-106`). For a plain `.srm` it falls back to the single file (`A:data/sync/platform/UnitSaveHandler.kt:24-25,35-40`).

## 2. When Argosy syncs

| Trigger                                       | What runs                                                                                                               | Where                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Before a launch                               | A negotiate for the game in hand; a server-newer result downloads before the game starts; a local change shows a choice | `A:domain/usecase/game/LaunchWithSyncUseCase.kt:93,104-127`; `A:data/repository/SaveSyncRepository.kt:361-466` |
| Session end                                   | The save is finalised and uploaded at once, without overwrite; offline or on error it is queued                         | `A:data/emulator/PlaySessionTracker.kt:674-797`; `A:domain/usecase/save/SyncSaveOnSessionEndUseCase.kt:66-185` |
| Every 6 hours (WorkManager, network required) | `reconcileAll`: drain the queue, negotiate the full inventory, apply                                                    | `A:data/sync/SaveSyncWorker.kt:36-55,90-100`; `A:data/sync/SyncCoordinator.kt:125-182`                         |
| Reconnect, including app start once online    | `reconcileAll`, with a cooldown                                                                                         | `A:ui/ArgosyViewModel.kt:275-285`; `A:data/sync/SyncCoordinator.kt:78,111-123`                                 |
| Manual sync screen                            | `reconcileAll` bypassing the cooldown, then the queue                                                                   | `A:ui/screens/savesync/SaveSyncViewModel.kt:400-402`                                                           |

Pre-launch sync is skipped entirely when the device has no `device_id` (`A:data/repository/SaveSyncRepository.kt:369-372`).

## 3. Upload

**Argosy sends** `POST /api/saves`, multipart field `saveFile` as `application/octet-stream` (`A:data/remote/romm/RomMApi.kt:338-351`; `A:data/repository/SaveUploader.kt:332-343`), with:

- `rom_id`; `emulator` (section 3.1); `device_id`; `overwrite=false` unless the player chose to keep this device's save (section 7) (`A:data/repository/SaveUploader.kt:60,340`).
- `slot=autosave` for the ordinary save, or the name of a save channel the player made (`A:data/repository/SaveUploader.kt:335`; `A:data/repository/SaveSyncApiClient.kt:578`).
- `autocleanup=true` with `autocleanup_limit=10` for the autosave slot on the live path (`A:data/repository/SaveUploader.kt:336-338`; `A:data/repository/SaveSyncApiClient.kt:580,586-587`), and on every queued cache upload, named slots included (`A:data/repository/SaveUploader.kt:493-512`).
- **No `session_id`** and no `screenshotFile` (`A:data/sync/ReconcileEffectApplier.kt:163` keeps the session id on local rows only).
- Saves of 100 bytes or less are never uploaded (`A:data/repository/SaveUploader.kt:193-197`; `A:data/repository/SaveSyncApiClient.kt:579`).
- Before uploading, Argosy lists `GET /api/saves?rom_id&device_id` and skips the upload when the server head already has the same hash (`A:data/repository/SaveUploader.kt:279-299`).

**RomM 5.2.0 does** (`R:endpoints/saves.py:160-397`; `S:paths./api/saves.post`):

- Accepts `rom_id` (required), `emulator`, `slot`, `device_id`, `session_id`, `overwrite` (default false), `autocleanup` (default false) and `autocleanup_limit` (default 10) (`R:endpoints/saves.py:163-170`).
- Sanitises the file name (`R:endpoints/saves.py:196`; `R:utils/filesystem.py:94-127`). **With a slot, it inserts a UTC timestamp tag `[YYYY-MM-DD_HH-MM-SS]` before the extension** (`R:endpoints/saves.py:102-112,204-205`), so a slotted upload is stored under a new name every time. Without a slot the name is kept, and an upload with the same name and a null slot replaces that row's content in place (`R:endpoints/saves.py:214-216,290-315`).
- Stores the file under `<user>/saves/<platform fs_slug>/<rom_id>[/<emulator>]` (`R:handler/filesystem/assets_handler.py:97-123`).
- With a slot, no `overwrite`, and a save in that slot that already has the same hash, discards the upload and returns the existing save (`R:endpoints/saves.py:263-277`).
- With a device, records "this device is current" for the new save (`R:endpoints/saves.py:324-328`).
- With `slot` and `autocleanup`, **deletes the oldest saves in the slot beyond the limit, from the database and from disk** (`R:endpoints/saves.py:333-346`).

### 3.1 The `emulator` tag

- For the built-in core and for RetroArch, the tag is the libretro core id: `snes9x`, `mgba`, `pcsx_rearmed`, `swanstation`, `mednafen_psx`, `ppsspp`, `dolphin`, `flycast` (`A:data/emulator/EmulatorRegistry.kt:1722-1737`). With no core known it falls back to the RetroArch id (`retroarch`, `retroarch_64`, `retroarch_32`).
- Every other emulator sends Argosy's own emulator id, for example `duckstation`, `ppsspp`, `nethersx2`, `aethersx2`, `armsx2`, `dolphin` (`A:data/emulator/EmulatorRegistry.kt:1722-1737`).
- The core comes from the built-in core resolver, then the game's chosen core, then the platform default (`A:data/repository/SaveSyncApiClient.kt:109-118`). A blank or `default` emulator id is resolved from the launch package, then the platform's preferred emulator (`A:data/repository/SaveUploader.kt:84-91`).
- **Inconsistency:** negotiate's inventory reports the row's local emulator id, not this tag (`A:data/sync/NegotiateInventory.kt:89,112`). RomM's decision ignores `emulator` (section 5), so this does not change outcomes.

### 3.2 The uploaded file name

- On the live path: the ROM file name without its extension for the autosave slot (`argosy-latest` if there is no ROM path), or the channel name for a named slot; then the local save's extension, or `zip` for a folder or a bundle (`A:data/repository/SaveSyncApiClient.kt:604-617`; `A:data/repository/SaveUploader.kt:262-277`).
- On a queued cache upload: `<channel>.<ext>`, for example `autosave.srm` (`A:data/repository/SaveUploader.kt:487-488`). The two paths name the same save differently.
- RomM pairs on `(rom_id, slot)`, never on the name (section 5), and adds its own timestamp tag, so Galleon must not rely on the name to find Argosy's save.

## 4. `content_hash`

**Argosy** (`A:data/sync/SaveArchiver.kt:954-1063,1091-1102`):

- A file that starts with a ZIP signature (`PK` followed by 03 04, 05 06 or 07 08) is hashed as a zip; anything else is the lowercase hex MD5 of its bytes.
- Zip hash: for every entry that is not a directory, the MD5 hex of its decompressed bytes; lines `name:md5` with the entry name as stored; sorted by name; joined with `\n` and no trailing newline; the MD5 hex of that UTF-8 text.
- Folder variants compute the same value without building the zip (`A:data/sync/SaveArchiver.kt:1004-1058`).
- The hash is taken over the exact bytes uploaded, including a hardcore trailer when one is appended (`A:data/repository/SaveUploader.kt:202-218`; `A:data/sync/SaveArchiver.kt:1106-1130`).
- A server hash that differs after upload is only logged as drift, and the server's value is adopted (`A:data/repository/SaveUploader.kt:379,390-392`).

**RomM 5.2.0** (`R:handler/filesystem/assets_handler.py:145-170`; `R:handler/scan_handler.py:1198-1225`):

- `zipfile.is_zipfile` decides; the zip hash is the same algorithm (sorted non-directory entries, `name:md5` lines joined by `\n`, MD5 of the UTF-8 text); otherwise the file's MD5. Any error gives no hash. The column is 32 characters (`R:models/assets.py:92`). The schema documents none of this.
- The two can disagree only at the edges: RomM looks for the end-of-central-directory record, Argosy for the leading signature. A zip with a prefix, or a raw save that happens to contain an end-of-central-directory record, would be hashed differently. M2-04 tests both edges.
- **States are not hashed** by RomM (`R:handler/scan_handler.py:1228-1239`).

## 5. Negotiate and RomM's decision

**Argosy sends** `POST /api/sync/negotiate` with `device_id`, `saves[]` and `rom_ids` (`A:data/remote/romm/RomMApi.kt:450-453`; `A:data/remote/romm/RomMSyncModels.kt:6-22`).

- The full reconcile sends no `rom_ids`; pre-launch sends `rom_ids=[rom]` and then drops any returned operation for another game (`A:data/sync/strategy/NegotiatorSaveSyncStrategy.kt:40-51`).
- The inventory covers saves with a local path and an installed ROM, skipping `state_` slots (`A:data/sync/NegotiateInventory.kt:29-40,121`). Each item carries `rom_id`, `file_name` (the live-path rule), `slot` (a null or `argosy-latest` channel becomes `autosave`), `emulator`, `content_hash`, `updated_at` and `file_size_bytes` (`A:data/sync/NegotiateInventory.kt:41-46`; `A:data/repository/SaveSyncApiClient.kt:589-594`).
- For a cached version unchanged since the last transfer, it reports the server's stored hash and `updated_at`; for a changed one, its own hash and cache time. For the slot in play with no cache row, it reports the last uploaded hash and the file's mtime, not a fresh hash of the disk (`A:data/sync/NegotiateInventory.kt:51-117`).

**RomM 5.2.0 does** (`R:endpoints/sync.py:42-306`; `S:components.schemas.SyncNegotiatePayload`):

- The payload has only `device_id` and `saves`. **There is no `rom_ids`** (`S:components.schemas.SyncNegotiatePayload.properties`); the Pydantic model ignores the extra field, so Argosy's pre-launch scoping happens only on the client.
- It cancels the device's open sync sessions and starts a new one, a write (`R:endpoints/sync.py:149-159,300-309`).
- It loads every save of the user **with a non-null slot, across all ROMs**, keeps the newest per `(rom_id, slot)`, and this device's sync records for them (`R:endpoints/sync.py:163-179`).
- For each client save (`R:endpoints/sync.py:185-242`): no server save under that key, or a null slot, means `upload`; a save this device untracked means `no_op`; otherwise `compare_save_state`.
- `compare_save_state` (`R:handler/sync/comparison.py:16-72`), all comparisons strict:
  1. Both hashes present and equal: `no_op`.
  2. With a sync record at time S: both sides newer than S is `conflict`; only the client newer is `upload`; only the server newer is `download`; neither is `no_op`.
  3. With no record: the newer side wins; equal times with different or missing hashes is `conflict`.
  4. `file_name` and `file_size_bytes` play no part.
- Server saves the client did not mention: a download, unless this device untracked it or already synced its current version (`R:endpoints/sync.py:244-292`). With no `rom_ids`, a new device is told to download every slotted save the user has. Nothing is ever deleted.
- The response carries `session_id`, the operations (`action`, `rom_id`, `save_id`, `file_name`, `slot`, `emulator`, `reason`, `server_updated_at`, `server_content_hash`) and totals (`R:endpoints/responses/sync.py:9-54`). The session is finished with `POST /api/sync/sessions/{id}/complete` (`R:endpoints/sync.py:327-398`).

**Argosy applies it** (`A:data/sync/SyncCoordinator.kt:184-207`; `A:data/sync/ReconcileEffectApplier.kt:50-214`):

- Operations with a null slot or a `state_` slot are skipped. `upload` queues an upload without overwrite; `download` marks the save server-newer and downloads it on the next queue drain, unless the local save changed since its last upload, which becomes a conflict (`A:data/repository/SaveSyncOrchestrator.kt:467-492`). `conflict` is first tried by an automatic classifier (keep local when a restore or upload is pending; keep the side that moved when the other is unchanged against its anchor hash) and otherwise stored for the player (`A:data/sync/strategy/ConflictAutoResolver.kt:33-61`; `A:data/sync/ReconcileEffectApplier.kt:65-128`).
- Pre-launch ranks conflict over download over upload (`A:data/repository/SaveSyncRepository.kt:129-134,482-507`).
- Sessions are completed once their queued rows are drained; a 4xx counts as finished, a 5xx is retried (`A:data/sync/strategy/NegotiatorSaveSyncStrategy.kt:113-150`; `A:data/sync/SyncCoordinator.kt:353-379`).

## 6. Download

**Argosy** (`A:data/repository/SaveDownloader.kt`):

- Reads `GET /api/saves/{id}?device_id` first; a 404 forgets the local tracking row (`:205-220`).
- If a cached copy has the server's hash in the same slot, restores from cache after a backup, with no network (`:337-376`).
- Otherwise `GET /api/saves/{id}/content?device_id&optimistic=false` (`:382-427`; `A:data/remote/romm/RomMApi.kt:363-369`), streamed into a temporary file in the app cache (`:452-462,678-684`).
- Backs up the current save before overwriting it, and aborts if the backup fails (`:343-346,500-503,645-649,705-708`; `A:data/repository/SaveCacheManager.kt:532-540`).
- **Does not write atomically:** a file save is written or copied straight onto the target (`:731-741`; `A:data/sync/platform/DefaultSaveHandler.kt:34-51`). Folder saves are unzipped with a single shared root stripped (`A:data/sync/SaveArchiver.kt:575-600`).
- Sets the file's mtime to the server's `updated_at` (`:749-754`), then `POST /api/saves/{id}/downloaded` with `{"device_id"}`; a failed confirmation is kept and retried before the next sync (`:1029-1070`; `A:data/remote/romm/RomMApi.kt:383-387`).

**RomM 5.2.0** (`R:endpoints/saves.py:477-557`; `S:paths./api/saves/{id}/content.get`):

- `GET /api/saves/{id}/content` takes `device_id`, `session_id` and `optimistic`, **default true**. With a device and `optimistic=true`, the GET itself records the device as current, a write (`R:endpoints/saves.py:521-527`). With `optimistic=false` nothing is recorded until `POST /api/saves/{id}/downloaded` (`R:endpoints/saves.py:535-557`).
- `GET /api/saves` and `GET /api/saves/{id}` with `device_id` only read; `device_syncs` is filled only when a `device_id` is given, and `is_current` means the device's record is at least the save's `updated_at` (`R:endpoints/saves.py:40-86,400-474`).

## 7. 409 and conflicts

**RomM 5.2.0** returns 409 before writing anything (`R:endpoints/saves.py:218-245`):

- With `device_id`, a slot and no `overwrite`: when this device has no sync record for the slot's newest save, or its record is older than that save. **A device's first upload into an occupied slot is always a 409** unless it downloaded that save first (which records it) or overwrites.
- With `device_id`, no slot, a same-named save and no `overwrite`: only when a record exists and is older.
- Without `device_id`, never. `overwrite=true` skips both checks and the same-hash shortcut; it deletes nothing by itself (`R:endpoints/saves.py:218,237,263`).

**Argosy:**

- A 409 becomes a conflict carrying the server's newest save id and hash (`A:data/repository/SaveUploader.kt:345-358,515-533`). With a device id it relies on the 409 alone; its client-side timestamp check runs only without one (`A:data/repository/ConflictDetector.kt:68-100`).
- The player resolves it (`A:data/sync/ConflictResolutionService.kt:32-142`): skip; keep the server's (a download with backup); or keep this device's, which uploads with `overwrite=true`. On a named slot it first downloads the server's save into history and only the first of its uploads overwrites.
- Player-chosen `overwrite=true` sites: `A:data/sync/ConflictResolutionService.kt:74,114`; `A:ui/ArgosyViewModel.kt:681`; `A:ui/screens/common/GameLaunchDelegate.kt:361`; `A:data/repository/SaveSyncConflictResolver.kt:66`; `A:data/repository/SaveSyncRepository.kt:583`; `A:data/sync/SyncCoordinator.kt:990-991`.

## 8. What Galleon does not copy

Argosy behaviour that crosses Galleon's rails (CLAUDE.md rail 2, ADR 0002). Galleon matches Argosy's **shapes and decisions**, not these:

1. **Automatic overwrite.** When a downloaded zip fails to extract as corrupt, Argosy uploads the local save with `overwrite=true` with no prompt (`A:data/repository/SaveDownloader.kt:533-567`). Its game-page sync forces an upload whenever its own analysis says the local copy is newer (`A:data/repository/SaveSyncRepository.kt:543`; `A:ui/screens/gamedetail/delegates/SaveManagementDelegate.kt:271`). Galleon sends `overwrite=true` only from the player's explicit "keep this device's save".
2. **`autocleanup`.** It makes RomM delete older saves in the slot (section 3). That is the server deleting saves because of an automatic upload, so Galleon never sends it. History in the slot then grows by one save per changed upload; the same-hash shortcut keeps an unchanged save from adding one.
3. **Non-atomic writes** (section 6). Galleon writes through one writer: backup, temporary file, fsync, rename (ADR 0002, M2-07).

Galleon can match everything else, including the slot (`autosave`), the tags, the archive shapes, the hash, negotiate, `optimistic=false` and `/downloaded`.

## 9. States and slots

- Argosy's states are a separate subsystem: `POST /api/states` with `rom_id`, `emulator` and `stateFile`, no `device_id`, skipped when the MD5 is unchanged (`A:data/remote/romm/RomMApi.kt:210-226`; `A:data/repository/StateCacheManager.kt:995-1030`).
- RomM 5.2.0's states take only `rom_id` and `emulator`, have no slot, no device records and no 409, and replace a same-named state in place (`R:endpoints/states.py:39-120`; `S:paths./api/states.post`).
- Save-sync ignores server saves whose slot starts with `state_` or whose name ends `.stateN` (`A:data/repository/SaveSyncApiClient.kt:701-709`).
- Argosy's ordinary save is always slot `autosave`; null-slot server saves are skipped by negotiate and matched only by name on its older path (`A:data/sync/SyncCoordinator.kt:190-201`; `A:data/repository/ConflictDetector.kt:46-56`).
- Hardcore saves land in the same `autosave` slot with a trailer appended (`A:data/sync/snapshot/SnapshotSyncRouter.kt:29-30`; `A:data/repository/SaveUploader.kt:202-216`). If this device has a hardcore save and the download has no trailer, Argosy asks the player (`A:data/repository/SaveDownloader.kt:482-498`).

## 10. Per system

Columns:

- **Android emulator / core:** what Argosy supports for the system (`A:data/emulator/EmulatorRegistry.kt:1161-1190` for emulators, `:1291-1312` for RetroArch cores).
- **Handler:** which Argosy handler serves it on 5.2.0 (section 1).
- **Archive shape:** what is uploaded, under which name.
- **Tag:** the `emulator` value (section 3.1).
- **Linux:** the Armada emulators on the Nova ([DEVICE-FACTS](../DEVICE-FACTS.md)).
- **Verdict:**
  - **same bytes:** the Linux emulator reads the file or files as they are, once placed.
  - **convertible:** the data is the same but needs renaming or re-wrapping, which an adapter can do losslessly both ways.
  - **not interoperable:** nothing on Linux reads it, or Argosy does not sync it.

Verdicts marked _(M2-02)_ rest on a fact the shape report must confirm.

### SNES

| Android emulator / core                                                                                  | Handler                                                                                                                         | Archive shape                                                                              | Tag         | Linux                           | Verdict                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| RetroArch or built-in: `snes9x`, `bsnes`, `mesen` (`A:data/emulator/EmulatorRegistry.kt:1183,1291-1312`) | `UnitSaveHandler`, falling back to `RetroArchSaveHandler` for a single `.srm` (`A:data/sync/platform/UnitSaveHandler.kt:24-40`) | Raw `.srm`, uploaded as `<rom>.srm` (`A:data/sync/platform/RetroArchSaveHandler.kt:11-23`) | the core id | RetroArch flatpak with `snes9x` | **same bytes** with the same core; `.srm` is the raw cartridge RAM for every SNES core, so other cores are expected to read it _(M2-02)_ |
| SUPER ZSNES                                                                                              | none: no save config, no sync (`A:data/emulator/EmulatorRegistry.kt:747-753`)                                                   |                                                                                            |             |                                 | not interoperable (Argosy does not sync it)                                                                                              |

RetroArch's folder: `savefile_directory`, else `RetroArch/saves`; plus the content folder name when "sort by content" is on, and the core's save folder name when "sort by core" is on (`A:data/emulator/RetroArchConfigParser.kt:198-211,277-347`). Core folder names: `Snes9x 2010` for `snes9x2010`, otherwise the core id (`A:data/emulator/EmulatorRegistry.kt:1670-1693,1719-1720`).

### GBA

| Android emulator / core                                                                              | Handler                                                                   | Archive shape                                                                                                 | Tag                                   | Linux                         | Verdict                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| RetroArch or built-in: `mgba`, `vbam`, `gpsp` (`A:data/emulator/EmulatorRegistry.kt:1179,1291-1312`) | as SNES                                                                   | Raw `.srm`, `<rom>.srm`                                                                                       | the core id                           | RetroArch flatpak with `mgba` | **same bytes** with `mgba`                                                                                         |
| Pizza Boy GBA, Pizza Boy GBA Pro (`A:data/emulator/SavePathRegistry.kt:388-411`)                     | `DefaultSaveHandler` (`A:data/sync/platform/DefaultSaveHandler.kt:24-31`) | Raw `.sav`, `<rom>.sav`, found as `<rom>.sav` in its saves folder (`A:data/sync/SavePathResolver.kt:697-742`) | `pizza_boy_gba` / `pizza_boy_gba_pro` | RetroArch `mgba`              | **convertible**: rename `.sav` to `.srm`; whether Pizza Boy's file is plain cartridge RAM is unconfirmed _(M2-02)_ |
| Linkboy                                                                                              | none: no save config                                                      |                                                                                                               |                                       |                               | not interoperable                                                                                                  |

### PS1

| Android emulator / core                                                                                                     | Handler              | Archive shape                                                                                                                                          | Tag           | Linux                                                                 | Verdict                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RetroArch or built-in: `pcsx_rearmed`, `swanstation`, `mednafen_psx` (`A:data/emulator/EmulatorRegistry.kt:1161,1291-1312`) | as SNES              | Raw `.srm` (one memory card), `<rom>.srm`; folder `PCSX-ReARMed` or `Beetle PSX` when sorted by core (`A:data/emulator/EmulatorRegistry.kt:1670-1693`) | the core id   | DuckStation AppImage; RetroArch flatpak (no PS1 core installed today) | **same bytes** with the same core in RetroArch; **convertible** to DuckStation's per-game card `<title>_1.mcd` (rename), if both are the raw 128 KiB card image _(M2-02)_                |
| DuckStation (`com.github.stenzek.duckstation`) (`A:data/emulator/SavePathRegistry.kt:421-429`)                              | `DefaultSaveHandler` | Raw `<rom>_1.mcd` per-game card, uploaded as `<rom>.mcd`; shared cards never looked for (`A:data/sync/SavePathResolver.kt:334-341,548-568`)            | `duckstation` | DuckStation AppImage                                                  | **same bytes**, but Argosy marks this config as needing root, so on an unrooted device it does not sync at all (`A:data/emulator/SavePathRegistry.kt:421-429,794-797,858-864`) _(M2-02)_ |

### PSP

| Android emulator / core                                                                                                     | Handler                                                                                                                                                  | Archive shape                                                                                                                                                                                                                                                                                                                                                                           | Tag                                                     | Linux          | Verdict                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| PPSSPP, PPSSPP Gold (`A:data/emulator/SavePathRegistry.kt:485-502`); RetroArch `ppsspp` (`:147-173`); built-in (`:683-690`) | `PspFolderHandler`, a prefix-bundle folder handler, because these configs are folder-based (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:78-81`) | Zip, uploaded as `<rom>.zip`. Each `SAVEDATA` folder whose name starts with the game's disc id is one root: `<ID>DATA00/…`, `<ID>SETTINGS/…`. No `PSP/` or `SAVEDATA/` prefix. Folders whose `PARAM.SFO` says they are game data, not saves, are left out (`A:data/sync/platform/PrefixBundleFolderHandler.kt:16,39-81`; `A:data/sync/platform/PlatformSaveHandlerRegistry.kt:242-262`) | `ppsspp` (the emulator id and the core id are the same) | PPSSPP flatpak | **same bytes**: the folders unzip into PPSSPP's `PSP/SAVEDATA` as they are |

Restore deletes every existing folder with that prefix, then unzips keeping the roots (`A:data/sync/platform/PrefixBundleFolderHandler.kt:91-119`).

### PS2

| Android emulator / core                                                             | Handler                              | Archive shape                                                                                                                                                                                                                                                                                                                   | Tag                                                           | Linux                                            | Verdict                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NetherSX2, AetherSX2, ARMSX2, PCSX2 (`A:data/emulator/SavePathRegistry.kt:432-477`) | `Ps2FolderHandler`, a folder handler | Zip `<rom>.zip`. **Folder memory cards only:** a card is a directory named `*.ps2` or holding `_pcsx2_superblock` (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:1023-1056`). Only the game's own folders on the card are zipped, each a root (`BASLUS-20152AC04/…`), with no card folder and no superblock (`:944-969`) | `nethersx2`, `aethersx2`, `armsx2`, `armsx2_refresh`, `pcsx2` | ARMSX2 (memcards in `~/.config/ARMSX2/memcards`) | **same bytes** if ARMSX2 on Linux uses a folder card; **not interoperable** with an 8 MB file card unless an adapter reads and writes the card's file system _(M2-02, and the card type on the Nova)_ |

- Matching a game folder: both names lose `-` and `_` and are upper-cased, then compared by prefix, with a region prefix derived from the serial when missing (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:1081-1110`). More than one card holding the game is refused (`:914-923`).
- **Code and docs disagree:** Argosy's comments and `Adoc:save-id-to-path.md:156-163` say uploads are rooted at the card's name; the code roots them at the game folders (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:792-796` vs `:944-969`). Restore accepts both: game-rooted archives unzip into the card keeping their roots; a card-rooted one has its root stripped and only the game's folders copied in (`:797-853`; `A:data/sync/SaveArchiver.kt:381-436`). Which shape is on the owner's server is a question for M2-02.
- Restore target: the base if it is a card, else `Shared.ps2` when there is none, else the only card, else the most recently written (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:983-1004`). A card without a valid superblock gets a fresh one (`A:data/sync/platform/Ps2FolderCardSuperblock.kt:33-58`; `A:data/sync/platform/PlatformSaveHandlerRegistry.kt:855-878`).
- The NetherSX2 package is shared with AetherSX2, and the package-to-id map keeps the last entry, so a NetherSX2 save may carry the tag `aethersx2` (`A:data/emulator/EmulatorRegistry.kt:786-810,1121`) _(M2-02)_.

### GameCube

| Android emulator / core                                                                                                      | Handler                                                 | Archive shape                                                                                                                                     | Tag                       | Linux           | Verdict                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dolphin (three packages), Dolphin MMJR, RetroArch `dolphin`, built-in (`A:data/emulator/SavePathRegistry.kt:96-145,705-712`) | `GciSaveHandler` (GCI folder mode only; no `.raw` card) | One GCI: raw, `<rom>.gci`. Several: a flat zip of GCI files with no folders, `<rom>.zip` (`A:data/sync/platform/GciSaveHandler.kt:29-72,215-234`) | `dolphin`, `dolphin_mmjr` | Dolphin flatpak | **same bytes** when Dolphin's slot A is a GCI folder; **convertible** with a `.raw` card (GCI import and export are lossless) _(M2-02, and the slot type on the Nova)_ |

- The unit is every `.gci` in the card folder whose header names the game, de-duplicated and sorted by name (`A:data/sync/platform/GciSaveHandler.kt:56-72`). The game id is read from the disc header (offset 0x00, or 0x58 for RVZ) (`A:data/emulator/GameCubeHeaderParser.kt:37-78`).
- Restore writes into `<base>/<USA|EUR|JAP>/Card A/` under Dolphin's own name, `<maker>-<id>-<internal name>.gci`, after deleting the game's existing GCIs; a single GCI whose header names another game is refused (`A:data/sync/platform/GciSaveHandler.kt:242-370`; `A:data/emulator/GameCubeHeaderParser.kt:139-153`).
- RetroArch Dolphin reaches its GCI config only through the slug `ngc`; under `gc` it falls back to plain `.srm` handling (`Adoc:save-id-to-path.md:476-481`).

### Wii

| Android emulator / core                                                                     | Handler                                                                               | Archive shape                                                                                                                                                       | Tag                       | Linux                                                   | Verdict                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| Dolphin, Dolphin MMJR: `Wii/title/00010000` (`A:data/emulator/SavePathRegistry.kt:204-226`) | `FolderSaveHandler("wii")` (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:52`) | Zip `<rom>.zip` of the title folder, entries `<id>/data/…`, no root entry (`A:data/sync/platform/FolderSaveHandler.kt:30-47`; `A:data/sync/SaveArchiver.kt:79-113`) | `dolphin`, `dolphin_mmjr` | Dolphin flatpak (`Wii/title/00010000/<id>` in its NAND) | **same bytes**                                          |
| RetroArch                                                                                   | no Wii config; plain `.srm` handling                                                  |                                                                                                                                                                     | core id                   |                                                         | not interoperable (Dolphin keeps Wii saves in its NAND) |

Restore strips the single root into `<base>/<id>`, deleting any other folder that matches the id in another case (`A:data/sync/platform/FolderSaveHandler.kt:49-103,199-210,276-285`). The id's format comes from sigil _(M2-02)_.

### Dreamcast

| Android emulator / core                                               | Handler                                                                                 | Archive shape                                                                                                       | Tag       | Linux           | Verdict                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Flycast, Redream standalone                                           | none: shared VMU, `supported = false` (`A:data/emulator/SavePathRegistry.kt:600-619`)   |                                                                                                                     |           | Flycast flatpak | **not interoperable** (Argosy does not sync it)                                                                                    |
| Built-in flycast core (`A:data/emulator/SavePathRegistry.kt:727-739`) | `DreamcastSaveHandler` (`A:data/sync/platform/PlatformSaveHandlerRegistry.kt:84`)       | Raw per-game VMU `<product>.A1.bin`, uploaded as `<rom>.bin` (`A:data/sync/platform/DreamcastSaveHandler.kt:16-34`) | `flycast` | Flycast flatpak | **convertible** if Flycast on Linux keeps a per-game VMU A1 (rename to its name); with its shared VMU, not interoperable _(M2-02)_ |
| RetroArch flycast                                                     | `UnitSaveHandler`; Flycast writes no `.srm`, so whether a VMU is found depends on sigil |                                                                                                                     | `flycast` |                 | unknown _(M2-02)_                                                                                                                  |

The built-in core copies the shared VMU to a per-game one on first launch, never moving it (`A:data/emulator/DreamcastVmuMigrator.kt:31-69`).

## 11. Differences from RomMix's current engine

What `src/main/saves.ts` and `src/main/romm/client.ts` do today, against what this spec needs:

| RomMix today                                                                           | Where                                                                      | Argosy-compatible engine                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Decides client-side by timestamps and hashes; **never calls negotiate**                | `src/main/saves.ts:93-101`                                                 | Negotiate with the full inventory on 5.2.0 and act on the game in hand (ADR 0002, decision 2)        |
| Uploads with **`overwrite=true`** always, so never sees a 409                          | `src/main/romm/client.ts:1156`                                             | `overwrite=false`; a 409 is a conflict; `overwrite=true` only from "keep this device's save"         |
| Sends **`autocleanup=true`** with every slotted upload                                 | `src/main/romm/client.ts:1158-1161`                                        | Never (section 8)                                                                                    |
| Sends no `session_id`                                                                  | `src/main/romm/client.ts:1156-1163`                                        | Argosy sends none either; ADR 0002 asks for one, which RomM accepts (`R:endpoints/saves.py:330-331`) |
| Downloads **without `device_id` or `optimistic=false`**, and never calls `/downloaded` | `src/main/romm/client.ts:1115-1121`                                        | `device_id`, `optimistic=false`, temporary file, fsync, rename, then `/downloaded`                   |
| Carries a directory save as one **`.rommix-save.zip`** in its own shape                | `src/main/saves.ts:123`                                                    | Argosy's shape per system (section 10)                                                               |
| **Skips shared memory cards** (`match: 'shared'`)                                      | `src/main/saves.ts:79-81,288`; `src/config/emulators/savepaths.ts:230-232` | Per-game slices where Argosy has them: PS2 folder-card game folders, GameCube GCIs                   |
| Puts only the primary save in `autosave`; other files go up with no slot               | `src/main/savepairing.ts:91-93`; `src/main/saves.ts:660`                   | One `autosave` save per game, as Argosy (section 9)                                                  |
| Tags uploads with the descriptor's tag or id (`localTag`)                              | `src/main/savefiles.ts:221-223`                                            | Argosy's tags (section 3.1), so RomM and the other side agree on whose save it is                    |
| Keeps a backup before overwriting (`keepBackup`) and serialises per game               | `src/main/saves.ts:1501,1527`                                              | Kept                                                                                                 |

## 12. Open questions for M2-02

The shape report reads the owner's server (GET only, no bytes kept) and should answer:

1. Which `emulator` tags, slots and file names Argosy's saves actually carry per system; whether any are in a null slot or a named channel; whether the same save appears as both `<rom>.srm` and `autosave.srm` (section 3.2).
2. Whether each save's stored `content_hash` equals the hash this spec computes from its shape (M2-04 needs this; section 4).
3. PS2: game-rooted or card-rooted archives (section 10, PS2); the tag `nethersx2` or `aethersx2`.
4. PS1: which core or emulator the owner's saves came from, and their size (a raw card is 131072 bytes).
5. GBA: if any came from Pizza Boy, whether their size matches mGBA's for the same game.
6. GameCube: single `.gci` or zip, and the GCI header ids inside; whether the platform slug is `ngc`.
7. Wii and PSP: the root folder names inside the zips (the id formats come from sigil).
8. Dreamcast: whether any saves exist at all, and from which core.
9. Whether any save carries Argosy's hardcore trailer (magic `ARGOSY` followed by 0x01 0x00 at the end).
10. How many saves per slot exist, since Argosy's `autocleanup` keeps ten.

On the Nova (device facts, not the server): whether ARMSX2 uses folder or file memory cards, Dolphin's GameCube slot A type, and Flycast's VMU setting.
