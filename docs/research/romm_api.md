> Research note copied into the repository at handoff (2026-10-08). Links to `~/Documents/argosy-fork/...` point at the tester's private local Argosy fork, which is not in this repository; see [argosy-fork-design-spec.md](argosy-fork-design-spec.md) for the extracted design.

# RomM 5.x server API and ecosystem conventions for a Linux launcher client

Method note. Most findings come from reading the source directly. On 2026-10-08 I cloned four repos and read them at specific refs:
- `rommapp/romm`, at tag **5.3.1** (latest stable). I diffed it against **5.2.0** (the user's server) and against `master` (5.4.0-alpha.1).
- `rommapp/grout` (main, v5.3.1.3).
- `rommapp/argosy-launcher` (main, v2.19.4).

Each finding is tagged by provenance:
- **[code]**: read in source.
- **[docs]**: docs.romm.app.
- **[release notes]**: GitHub releases.
- **[client code]**: Grout or Argosy source.

The docs page was read through a summarizing fetcher. Where it disagrees with the code, the code wins, and each disagreement is flagged.

RomM release timeline from git tag dates [code]:
- 4.7.0: 2026-02-28
- 4.8.0: 2026-04-01
- 4.9.0: 2026-06-10
- 5.0.0: 2026-07-15
- 5.1.0: 2026-07-29
- 5.2.0: 2026-08-19
- 5.3.0: 2026-09-21
- 5.3.1: 2026-09-22
- 5.4.0-alpha.1 is on master.

Source: [romm tags](https://github.com/rommapp/romm/tags).

---

## 1. Device Sync Protocol: full save/state flow, devices, sessions, slots, conflicts, `optimistic`, track/untrack, emulator mapping, and how Argosy and Grout implement it

### Takeaway
RomM 4.9+ has a server-orchestrated save sync:
1. The client registers or pairs a **device**.
2. It POSTs its local save inventory to `POST /api/sync/negotiate`. Saves pair on `(rom_id, slot)`.
3. It executes the returned `upload`/`download`/`conflict`/`no_op` plan through the ordinary `/api/saves` endpoints. Passing `device_id` and `session_id` makes the server keep per-device sync bookkeeping.
4. It closes the session with `POST /api/sync/sessions/{id}/complete`, optionally batching play sessions.

Conflicts are detected by comparing each device's `last_synced_at` with the save's `updated_at`. They surface as `conflict` operations at negotiate time, or as **HTTP 409** at upload time. **Save states are not part of negotiate.** They are plain per-ROM uploads with no device or conflict semantics. RomM treats save files as opaque blobs. It does not parse any emulator's save format.

### Cited Findings

**Endpoints and scopes (5.3.1)**
- `POST /api/sync/negotiate` requires scopes `assets.read` + `devices.read`. The body is `{device_id?, saves: [ClientSaveState], rom_ids?}`. `device_id` is optional when the bearer token is a device-bound client token, because the server reads `request.state.device_id` from the token. If neither is present it returns 400 "device_id is required". It returns 404 if the device is unknown and 400 "Sync is disabled for this device" if `sync_enabled=false`. [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)
- `ClientSaveState` fields: `rom_id` (int), `file_name` (str), `slot` (str|null), `emulator` (str|null), `content_hash` (str|null), `updated_at` (datetime, client mtime), `file_size_bytes` (int). [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)
- The negotiate response is `{session_id, operations[], total_upload, total_download, total_conflict, total_no_op}`. Each operation has these fields:
  - `action`: `upload` | `download` | `conflict` | `no_op`
  - `rom_id`
  - `save_id`: null for uploads
  - `file_name`
  - `slot`
  - `emulator`
  - `reason`: human-readable text
  - `server_updated_at`
  - `server_content_hash`

  Note the action value is `no_op` with an underscore. [code] — [responses/sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/responses/sync.py)
- Negotiate first **cancels any active sync sessions for that device**, then creates a new session. It sets the status to IN_PROGRESS with `operations_planned = uploads + downloads + conflicts`. [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)
- `POST /api/sync/sessions/{session_id}/complete` (scope `devices.write`) takes `{operations_completed, operations_failed, play_sessions?: [{rom_id?, save_slot?, start_time, end_time, duration_ms}]}`.
  - It returns `{session: SyncSessionSchema, play_session_ingest?}`.
  - Completing a session that is not PENDING or IN_PROGRESS returns 400 "Session is already {status}". A session cancelled by a newer negotiate cannot be completed.
  - `end_time` must be later than `start_time`. Microseconds are truncated. [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)
- Other session endpoints:
  - `GET /api/sync/sessions?device_id&limit=50` and `GET /api/sync/sessions/{id}`, both scope `devices.read`.
  - `POST /api/sync/devices/{device_id}/push-pull` enqueues a server-side push-pull job. It only works for `sync_mode=push_pull` devices, which are SSH-type, server-initiated.
  - SyncSessionSchema fields: `id, device_id, user_id, status, initiated_at, completed_at, operations_planned, operations_completed, operations_failed, error_message, created_at, updated_at`.

  [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)

**Pairing semantics and slots**
- Pairing in negotiate uses `(rom_id, slot)` and keeps only the newest server row per slot. The server code comments explain why: "slot uploads are datetime-tagged... so tagged filenames never equal the client's untagged name, and a slot accrues many rows over time". **`file_name` is not used for pairing.** [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)
- **Null-slot saves are "archival, manual-upload" saves.** They are never paired, so a null-slot client save always negotiates as `upload`, even if identical content exists on the server under a slot. The server docstring tells clients to "send a stable, non-null slot name (e.g. 'autosave')". [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)
- Server saves that the client did not mention are handled as follows:
  - Untracked: skipped.
  - Never synced by this device: `download`.
  - Synced before and unchanged since (`save.updated_at <= last_synced_at`): treated as **"the client intentionally deleted it"** and omitted from the plan.
  - Changed since the last sync: `download`.

  [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)
- `compare_save_state` decides the action for each paired save:
  1. If both hashes are present and equal: `no_op`.
  2. Otherwise, if the device has a `last_synced_at`: client changed and server changed gives `conflict`. Only the client changed gives `upload`. Only the server changed gives `download`. Neither changed gives `no_op`. A side counts as "changed" when its `updated_at` is later than `last_synced_at`.
  3. With no sync history, the newer timestamp wins. Equal timestamps with different or missing hashes give `conflict`.

  [code] — [handler/sync/comparison.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/handler/sync/comparison.py)
- Slot uploads are renamed with a UTC timestamp tag, `"<name> [YYYY-MM-DD_HH-MM-SS].<ext>"`. Any existing tag is stripped first. A screenshot uploaded with a slotted save is renamed to the save's tagged stem. [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)

**Upload: `POST /api/saves` (scope `assets.write`)**
- Query parameters:
  - `rom_id` (required)
  - `emulator`
  - `slot` (max length `SAVE_SLOT_MAX_LENGTH` in 5.3)
  - `device_id`: requires `devices.write` when supplied, otherwise 403
  - `session_id`
  - `overwrite=false`
  - `autocleanup=false`
  - `autocleanup_limit=10`, clamped to 1..`MAX_AUTOCLEANUP_LIMIT`

  The body is multipart with `saveFile` (required) and `screenshotFile` (optional). [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)
- **409 conflict rules on upload:**
  - With `device_id`, a `slot`, and `overwrite=false`: if this device has **no sync row** for the slot's newest save, or its `last_synced_at` is older than that save's `updated_at`, the server returns **409 "Slot has a newer save since your last sync"**. A device's first upload into an existing slot therefore 409s unless it passes `overwrite=true` or first downloads/confirms.
  - With no slot but a same-filename save: it returns 409 "Save has been updated since your last sync" only when a sync row exists and is stale.

  [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)
- Idempotent retries: for a slotted, non-overwrite upload, if a save with the same `content_hash` already exists in that slot, the new file is deleted and the existing save is returned. Slot pruning still runs. [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)
- Side effects of a successful upload:
  - If `device_id` was given: the device sync row is upserted with `synced_at = save.updated_at`, and the device's `last_seen` is updated.
  - If `session_id` was given: the session's `operations_completed` is incremented.
  - The slot is pruned to its retention limit.
  - `rom_user.last_played` is set to now.
  - Smart collections are refreshed.
  - The response is `SaveSchema` with `device_syncs[]`.

  [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)
- Retention: the server keeps the lower of the client's `autocleanup_limit` (when `autocleanup=true`) and the server cap `MAX_SAVES_PER_SLOT`. That cap is new in 5.3, defaults to 50, and `0` disables it. [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py); [release notes] — [5.3.0](https://github.com/rommapp/romm/releases/tag/5.3.0)
- `PUT /api/saves/{id}?device_id` overwrites a save's content in place, using multipart `saveFile` and/or `screenshotFile`. **It has no conflict check.** It upserts the device sync row and sets `last_played`. [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)

**Download, the `optimistic` flag, and confirm**
- `GET /api/saves/{id}/content?device_id&session_id&optimistic=true` (scope `assets.read`; `device_id` also requires `devices.read`) returns a FileResponse.
  - With **`optimistic=true` (the default)**, the server records the device as synced (`last_synced_at = save.updated_at`) **when the download is served**. It does this only for the owner's own saves.
  - With **`optimistic=false`**, the client must call **`POST /api/saves/{id}/downloaded`** with body `{"device_id": "..."}` (scope `devices.write`) after the file is safely written.
  - Public saves of other users can be downloaded, but no sync bookkeeping is recorded for them.

  [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)

**Track and untrack**
- `POST /api/saves/{id}/untrack` and `/track`, body `{"device_id": "..."}`, scope `devices.write`. These set `is_untracked` on the device-save sync row. Negotiate then returns `no_op` ("Save is untracked on this device") for client-reported saves, and skips server-only saves. [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py), [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)

**Listing saves**
- `GET /api/saves?rom_id&rom_ids(5.3+)&platform_id&slot&device_id`. When `device_id` is passed, each save carries `device_syncs[]` entries `{device_id, device_name, last_synced_at, is_untracked, is_current}`.
  - `is_current` means that device's `last_synced_at >= save.updated_at`.
  - The caller's device entry comes first. A placeholder entry is synthesized with `is_current=false` if the caller has never synced that save.

  [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)
- `SaveSchema` fields:
  - `id, rom_id, user_id`
  - `file_name, file_name_no_tags, file_name_no_ext, file_extension, file_path, file_size_bytes, full_path, download_path`
  - `missing_from_fs`
  - `created_at, updated_at`
  - `emulator, slot, content_hash, is_public, screenshot, origin_device_id, device_syncs`

  [code] — [responses/assets.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/responses/assets.py)
- Other save endpoints:
  - `GET /api/saves/summary?rom_id` returns `{total_count, slots: [{slot, count, latest}]}`.
  - `GET /api/saves/identifiers` returns a list of IDs.
  - `POST /api/saves/delete` takes `{"saves": [ids]}`.
  - `PUT /api/saves/{id}/visibility` takes `{"is_public": bool}`.

  [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)

**content_hash algorithm (clients must match it to get `no_op`)**
- For a normal file, `content_hash` is the **MD5 hex** of the bytes.
- For a ZIP file, it is a composite: for each non-directory entry in sorted order, compute `"{name}:{md5(entry)}"`, join the lines with `\n`, and take the MD5 of the result.

[code] — [handler/filesystem/assets_handler.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/handler/filesystem/assets_handler.py). Grout re-implements exactly this composite (`ComputeMD5`, composite zip hash test). [client code] — [grout hashing](https://github.com/rommapp/grout/tree/main/hashing)

**States**
- `POST /api/states?rom_id&emulator` (multipart `stateFile`, `screenshotFile`) and `GET /api/states?rom_id|rom_ids|platform_id`. They have **no `device_id`, slot, session, or 409 logic**. Uploading a state also sets `last_played`. [code] — [states.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/states.py)

**Devices**
- `POST /api/devices` (scope `devices.write`). Payload fields:
  - `name, platform, client, client_version, ip_address, mac_address, hostname`
  - `sync_mode`: `api` | `file_transfer` | `push_pull`
  - `sync_config` (dict)
  - `allow_existing=true, allow_duplicate=false, reset_syncs=false`

  Behavior:
  - It deduplicates by fingerprint `(mac_address, hostname, platform)`. A match returns **200** with the existing device, or **409** `{"error":"device_exists","device_id":...}` when `allow_existing=false`.
  - `reset_syncs=true` deletes that device's sync rows.
  - A new device returns **201** `{device_id, name, created_at}`.
  - Also available: `GET/PUT/DELETE /api/devices/{id}`. PUT can toggle `sync_enabled` and `sync_mode`.

  [code] — [device.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/device.py)
- The `DeviceSchema` that API consumers see has these fields:
  - `id` (UUID string), `user_id`, `name, platform, client, client_version`
  - `ip_address, mac_address, hostname`
  - `client_device_identifier`
  - `sync_mode, sync_enabled, sync_config`: the `ssh_password` and `ssh_key_path` keys are masked as `********`
  - `last_seen, created_at, updated_at`

  `KNOWN_DEVICES` presets: `web`, `grout` (platform "muOS"), and `argosy-launcher` (platform "Android"), all `sync_mode=api`. [code] — [models/device.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/models/device.py), [responses/device.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/responses/device.py)

**How Grout implements it [client code]**
- Grout has a hand-written Go client. It calls negotiate with `{device_id, saves}`, without `rom_ids`. It calls complete with only `{operations_completed, operations_failed}`; its comment reads "grout does not track playtime, so play_sessions is omitted". It also uses `/api/saves/{id}/downloaded` and `/api/saves/summary`. [grout romm/sync.go](https://github.com/rommapp/grout/blob/main/romm/sync.go), [grout romm/endpoints.go](https://github.com/rommapp/grout/blob/main/romm/endpoints.go)
- Grout treats a nil or empty server `slot` as its configured `DefaultSaveSlot`. When the server holds several slots for a game, it asks the user to pick one and remembers the choice per ROM. When an upload gets a 409 ("the server rejects an upload with a 409 when its own save has moved on"), Grout turns that item into a conflict with the server save attached and sends it to a conflict screen. [grout saves/slots.go](https://github.com/rommapp/grout/blob/main/saves/slots.go), [grout saves/conflicts.go](https://github.com/rommapp/grout/blob/main/saves/conflicts.go)
- Emulator mapping: Grout keeps per-CFW tables of emulator save folders (`cfw.EmulatorFolderMap`, `cfw.SaveFolders`). When a platform's saves can live in more than one emulator folder, the user picks the folder. That choice is stored in `SaveDirectoryMappings[fsSlug]`, and the CFW's first folder is the default. Grout also has directory-save handling, PSP `PARAM.SFO` parsing, and zip-save packaging. [grout saves/emulators.go](https://github.com/rommapp/grout/blob/main/saves/emulators.go), [grout saves/](https://github.com/rommapp/grout/tree/main/saves)

**How Argosy implements it [client code]**
- Argosy's Retrofit interface uses `POST api/saves` with `device_id`, `overwrite`, `slot`, `autocleanup`, and `autocleanup_limit`. It also uses `PUT api/saves/{id}?device_id&slot`, `GET api/saves/{id}/content?device_id&optimistic`, `POST api/saves/{id}/downloaded`, `POST api/sync/negotiate`, `POST api/sync/sessions/{id}/complete`, `GET api/sync/sessions`, and `POST api/play-sessions`. [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt)
- Argosy downloads with **`optimistic = false`** and then calls `confirmSaveDownloaded(saveId, {device_id})` once the save is applied. It handles 409 on upload as `Decision=CONFLICT` ("device out of sync"). It treats a content 404 as an orphan and drops its tracking row. [SaveDownloader.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/repository/SaveDownloader.kt), [SaveUploader.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/repository/SaveUploader.kt)
- Argosy's negotiate strategy treats 404/410/409 on session operations as "session no longer exists or already finalized" and drops the local rows. [SaveSyncStrategy.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/sync/strategy/SaveSyncStrategy.kt)

**Emulator save formats**
- RomM stores saves under a path built from user, platform `fs_slug`, `rom_id`, and the free-form `emulator` string. The 5.3 memory-cards endpoint states that "the emulator name is a folder... held to what a folder may be called rather than to any list of emulators". **No emulator allow-list or save-format parser exists on the save path.** [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py), [memory_cards.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/memory_cards.py)
- 5.3 added `/api/memory-cards`, which handles versioned memory-card archives and includes `/versions`. 5.3 also added Title ID extraction, which "tells the system where a game writes its saves, so device sync knows what to look for". [code] — [memory_cards.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/memory_cards.py); [release notes] — [5.3.0](https://github.com/rommapp/romm/releases/tag/5.3.0)

**Docs vs. code discrepancies**
- The docs page as fetched lists `sync_mode` values `pull_only`/`push_only`/`push_pull` and conflict resolutions `keep_both`/`server_wins`/`device_wins`. It also gives play-session duration in seconds and says the play-session scopes are `me.read`/`me.write`. **The 5.3.1 code contradicts all four.** The enum is `api`/`file_transfer`/`push_pull`. No resolution parameter exists. The field is `duration_ms`. The scopes are `roms.user.write`/`roms.user.read`. [docs] — [device-sync-protocol](https://docs.romm.app/latest/developers/device-sync-protocol/); contradicted by [code] — [sync.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py), [models/device.py](https://github.com/rommapp/romm/blob/5.3.1/backend/models/device.py), [play_sessions.py](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/play_sessions.py)
- The docs page does agree with the code on the overall shape. Its stated principles are "sync once per session rather than once per save", "don't poll negotiate tightly", and "no push channel yet". [docs] — [device-sync-protocol](https://docs.romm.app/latest/developers/device-sync-protocol/)

**Version differences: 5.2.0 vs 5.3.1**
- `rom_ids` on negotiate is new in 5.3. So are `rom_ids` on GET `/saves` and `/states` and `MAX_SAVES_PER_SLOT` pruning.
- In 5.2.0, `autocleanup` deleted old slot rows itself, without removing their screenshots.
- Negotiate in 5.2.0 looked up sync rows for every slotted save, rather than only the newest per slot.
- `compare_save_state`, `device.py`, and `device_auth.py` are unchanged from 5.2.0 to 5.3.1.

[code] — `git diff 5.2.0 5.3.1` on [saves.py](https://github.com/rommapp/romm/compare/5.2.0...5.3.1) and sync.py

### Inferences
- Resolving conflicts in a client: on `conflict`, the client chooses one of three paths.
  - **Keep local:** re-upload with `overwrite=true`.
  - **Keep server:** download, then confirm.
  - **Keep both:** upload under a new slot, or with a null slot for an archival copy.

  The server offers no resolution verb, which is why Grout and Argosy both build conflict UIs.
- A Linux client should do the following:
  - Use a stable non-null slot (e.g. `autosave`).
  - Send MD5 or the composite zip hash as `content_hash`.
  - Prefer `optimistic=false` plus `/downloaded`, so a failed write never marks the device as current. This is the pattern Argosy uses.
  - Pass `session_id` on uploads and downloads so the server-side counters line up.
- Because unchanged-but-absent server saves are read as "client deleted", a client that loses its local save directory would not re-download those saves. Recovering from that likely needs `reset_syncs=true` on device re-registration.
- Sending `rom_ids` to a 5.2.0 server may be silently ignored or rejected, depending on pydantic's extra-field policy. Gate it on version ≥5.3.

### Gaps
- I did not read RomM's full docs page verbatim, because the fetch tool summarizes. Some docs claims (`sync_mode` names, resolution modes) may be the summarizer's error rather than the docs' error.
- I did not verify whether RomM's request `BaseModel` forbids extra fields, so the behavior of `rom_ids` on 5.2.0 is untested.
- I did not trace Argosy's full `NegotiatorSaveSyncStrategy`, its "channels"/"snapshots" (5.4-era) save model, or its emulator-to-save-path tables.
- I did not identify server-side event names in `backend/endpoints/sockets/sync.py`.

---

## 2. Download robustness: Range/resume, checksums, multi-file ROMs, zip streaming, nested single files

### Takeaway
Single-file ROM downloads are handed to nginx via an internal redirect, so standard byte-range resume should work. Multi-file ROMs stream as an on-the-fly mod_zip archive, which cannot be resumed. **From 5.1.0 on**, however, sending a `Range` header makes the server build and serve a **cached ZIP** that can be resumed. Per-file CRC32, MD5 and SHA1 hashes are exposed on every `files[]` entry and at ROM level, so downloads can be verified.

### Cited Findings
- `GET /api/roms/{id}/content/{file_name}?file_ids=1,2&hidden_folder=bool` works in five modes:
  - **One file**: returns `FileRedirectResponse` to `/library/{full_path}`, which is an nginx X-Accel internal redirect.
  - **Multiple files without Range**: returns a `ZipResponse` (nginx **mod_zip**) with `crc32=None` per member. A `.m3u` is auto-generated and added unless the ROM already has one.
  - **Multiple files with a `Range` header**: calls `resolve_cached_zip(...)`, which builds a ZIP once, caches it, and redirects nginx to it. The code comment reads "serve cached ZIP for Range requests (resumable)".
  - **`file_ids`**: narrows the download to the listed file IDs. If only one remains, it is served as a single file.
  - **`hidden_folder=true`**: uses muOS-style multi-disc layout.

  [code] — [roms/__init__.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py)
- `HEAD /api/roms/{id}/content/{file_name}` exists to fetch download headers before downloading. Both HEAD and GET drop auth if `DISABLE_DOWNLOAD_ENDPOINT_AUTH` is set. [code] — [roms/__init__.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py)
- `GET /api/roms/download` bulk-downloads as a zip, selected by `rom_ids`, `platform_id`, `collection_id`, `virtual_collection_id`, or `smart_collection_id`. A Range request is served from the zip cache only when the set is ≤ `BULK_CACHE_MAX_ROMS`. That branch's response sets `Accept-Ranges: bytes`. [code] — [roms/__init__.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py)
- Range-cached zips appear in 5.1.0 and 5.2.0 but are **absent in 5.0.0**. The related commit is "refactor: simplify ZIP cache range-request support" (2026-07-16). 5.3.0 fixed cached zips so nginx can read them and serialized their builds (#4329). [code] — git tag inspection of [roms/__init__.py](https://github.com/rommapp/romm/blob/5.2.0/backend/endpoints/roms/__init__.py); [release notes] — [5.3.0](https://github.com/rommapp/romm/releases/tag/5.3.0)
- `RomFileSchema` fields:
  - `id, rom_id, file_name, file_path, file_size_bytes, full_path, is_top_level`
  - `created_at, updated_at, last_modified`
  - **`crc_hash, md5_hash, sha1_hash, ra_hash, chd_sha1_hash`**
  - `archive_members, category`: a null `category` on a top-level file is defaulted to `GAME`
  - `track_meta, doc_meta`

  `RomSchema` also carries `crc_hash, md5_hash, sha1_hash, ra_hash`. [code] — [responses/rom.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/responses/rom.py)
- Argosy's testbed measured, against the same library, that "per-file hashes are available" on 4.9.2, 5.0.0 and 5.1.0. It also measured two shape changes:
  - `files[].category` for root game files was `null` on 4.9 but `"game"` on 5.0+. Argosy's guidance: "Accept `null || "game"`".
  - `files[].is_top_level` is absent on 4.9 and present on 5.0+.

  The layout is derivable as `files[].file_path` minus the ROM's `fs_path`. [client code] — [argosy testbed/romm/README.md](https://github.com/rommapp/argosy-launcher/blob/main/testbed/romm/README.md)
- Argosy sends a `Range` header on three download routes:
  - `GET api/roms/{id}/content/{fileName}`
  - `GET api/roms/{fileId}/files/content/{fileName}`, a per-file endpoint
  - `GET api/firmware/{id}/content/{fileName}`

  [client code] — [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt)
- 5.3.0 made firmware content endpoints return 404 "when the file is gone" (#4405). It also strips control characters from mod_zip manifest names (#4402). [release notes] — [5.3.0](https://github.com/rommapp/romm/releases/tag/5.3.0)
- `GET /api/roms/by-hash` exists; Grout uses it. [client code] — [grout romm/endpoints.go](https://github.com/rommapp/grout/blob/main/romm/endpoints.go)

### Inferences
- A robust client should:
  - Always send `Range: bytes=0-` on multi-file ROMs, even for a fresh download. That forces the resumable cached-zip path on ≥5.1, at the cost of the server building the zip first, so the first byte arrives late.
  - Download multi-file ROMs per file with `file_ids=N` or the per-file endpoint, then verify each file against `files[].md5_hash` or `sha1_hash`. That avoids zip packaging entirely and allows per-file resume.
- mod_zip streams with `crc32=None`, so non-Range multi-file zips are built on the fly. The total size and the bytes themselves are probably not stable enough across requests to resume safely.
- `has_nested_single_file` ROMs (one file inside a game folder) have exactly one file, so they should take the single-file redirect path. This was not separately verified.

### Gaps
- I did not inspect the nginx config, so I have not confirmed that the X-Accel single-file path returns `Accept-Ranges` and supports `If-Range`/ETag. nginx static serving normally does.
- Hashes can be null when a scan skipped hashing. I did not confirm under which scan or config conditions that happens.
- I did not verify whether the download `Content-Length` matches `fs_size_bytes` for the cached zip.

---

## 3. Change detection for incremental sync

### Takeaway
RomM has no general push channel for library changes in 5.2–5.3. A client should combine three things:
- `GET /api/roms?updated_after=<ISO8601 with tz>` to pick up added or updated ROMs.
- `GET /api/*/identifiers` endpoints, which return the full ID lists, to detect deletions by set difference.
- Periodic save negotiation.

Socket.io (`/ws/socket.io`) carries scan progress events. A device-only `/devices` namespace with `install:queued` nudges exists only on master (5.4 alpha).

### Cited Findings
- `GET /api/roms` takes `updated_after` ("Filter roms updated after this datetime (ISO 8601 format with timezone information)"). It also takes:
  - `order_by`, `order_dir`
  - `with_files=false`
  - `with_char_index`, `with_filter_values`, `with_rom_id_index`, `with_total`: all default `true`. Clients can set them `false` to make the request cheaper.
  - `released_days`, `released_before_year`
  - the filter params

  It returns `CustomLimitOffsetPage[SimpleRomSchema]`. [code] — [roms/__init__.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py)
- `GET /api/roms/identifiers` returns `list[int]` of the ROM IDs visible to the user, with hidden platforms and ROMs excluded. [code] — [roms/__init__.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py)
- Identifier endpoints used by first-party clients: `/api/platforms/identifiers`, `/api/roms/identifiers`, `/api/collections/identifiers`, `/api/firmware/identifiers`. `/api/saves/identifiers` also exists. [client code] — [grout romm/endpoints.go](https://github.com/rommapp/grout/blob/main/romm/endpoints.go); [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py)
- Socket.io is mounted at `/ws` with `socketio_path=/ws/socket.io`. A separate netplay server lives at `/netplay/socket.io`. Scan events are `scan:scanning_platform`, `scan:update_stats`, `scan:done`, and `scan:done_ko`. [code] — [handler/socket_handler.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/handler/socket_handler.py), [sockets/scan.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sockets/scan.py); [client code] — [argosy testbed README](https://github.com/rommapp/argosy-launcher/blob/main/testbed/romm/README.md)
- Master adds `backend/endpoints/sockets/devices.py`: "The `/devices` socket namespace, open only to device-bound client tokens". It emits `install:queued`. Argosy connects with `auth: {token}` over the WebSocket transport, and its code comment reads "It carries nudges only; every install is read through the claim endpoint". Argosy gates device installs at `5.4.0`. [code] — [master sockets/devices.py](https://github.com/rommapp/romm/blob/master/backend/endpoints/sockets/devices.py); [client code] — [RomMDeviceSocket.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMDeviceSocket.kt), [RomMCapabilities.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMCapabilities.kt)
- The docs say "There is no push channel yet, so polling is the only option." [docs] — [device-sync-protocol](https://docs.romm.app/latest/developers/device-sync-protocol/)
- I found no SSE endpoints in the 5.3.1 endpoint tree. [code] — [backend/endpoints@5.3.1](https://github.com/rommapp/romm/tree/5.3.1/backend/endpoints)

### Inferences
- An incremental sync loop that works on 5.2–5.3:
  1. Store the server-time watermark.
  2. Fetch `updated_after=<watermark>` pages, with `with_char_index=false&with_filter_values=false&with_rom_id_index=false`.
  3. Fetch the identifiers lists and delete local rows whose IDs are missing.
  4. Optionally listen for `scan:done` on socket.io as a trigger to refresh early. Scan events may need a session cookie rather than a bearer token; that is unverified.
- `updated_after` probably does not catch per-user changes (rom_user props) or changes to collection membership. Collections need their own refresh.

### Gaps
- I did not verify which columns `updated_after` compares, or whether metadata-only rescans bump `updated_at`.
- I did not verify whether the `/ws` namespace accepts `rmm_` bearer tokens for scan events in 5.3.
- I did not read the emits in `sockets/sync.py`, so their event names are unknown.

---

## 4. Client token lifecycle and device registration

### Takeaway
Client tokens look like `rmm_<64 hex>`. The server stores them SHA-256-hashed. Each token's scopes are intersected with the owner's current scopes on every request. Tokens are either standalone, created in the UI or API, or **device-bound** through RFC 8628-style device pairing (5.0+).

Lifecycle operations are delete (revoke), regenerate (rotate the secret while keeping the ID), and a 60-second pair-code exchange. Expiry options are `30d`, `90d`, `1y`, and `never`. **Deleting a device does not revoke its token**: the foreign key is `ON DELETE SET NULL`.

### Cited Findings
- Token generation is `"rmm_" + secrets.token_hex(32)`, and only `sha256(raw)` is stored. Bearer auth on an `rmm_` token goes through these steps:
  1. Look up the token by hash.
  2. Reject it if `expires_at` is in the past or the user is disabled.
  3. Compute effective scopes as `token_scopes ∩ user.oauth_scopes`.
  4. Update `last_used_at` and set `request.state.device_id = token.device_id`.
  5. Debounce an update to the device's `last_seen`.

  [code] — [handler/auth/base_handler.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/handler/auth/base_handler.py), [hybrid_auth.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/handler/auth/hybrid_auth.py)
- `/api/client-tokens` endpoints:
  - `POST ""` (scope `me.write`) with `{name, scopes[≥1], expires_in?}` returns 201 with the raw token, field `raw_token`. Requested scopes must be a subset of the user's own. The limit is **25 tokens per user**.
  - `GET ""` (scope `me.read`) lists the user's tokens.
  - `DELETE /{id}` (scope `me.write`) revokes a token.
  - `PUT /{id}/regenerate` (scope `me.write`) rotates the raw secret.
  - `POST /{id}/pair` (scope `me.write`) creates an 8-character code from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` with a 60-second TTL.
  - `GET /pair/{code}/status` returns 404 when the code is gone.
  - `POST /exchange {code}` is unauthenticated and returns the token.
  - Admin endpoints: `GET /all` (scope `users.read`) and `DELETE /{id}/admin` (scope `users.write`).

  The pair-code length constant is referenced but its value was not printed; the code is a short code. [code] — [client_tokens.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/client_tokens.py), [utils/client_tokens.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/utils/client_tokens.py)
- `expires_in` accepts `30d`, `90d`, `1y`, or `never`/null. Anything else returns 422. [code] — [utils/client_tokens.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/utils/client_tokens.py)
- The `ClientToken` model has `device_id` as a foreign key to `devices.id` with **`ondelete="SET NULL"`**, plus `last_used_at`, `expires_at`, and `scopes`, a space-separated string. [code] — [models/client_token.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/models/client_token.py)
- Device authorization flow (`/api/auth/device/*`, 5.0+). The pending state lives only in Redis with a 10-minute TTL ceiling.
  - `POST /init` is open and rate-limited. It returns 201 with `device_code`, `user_code`, `verification_path(_complete)`, `expires_in`, and `interval`.
  - `POST /token {device_code}` is open and rate-limited per IP and per code. Its errors come back as **HTTP 400 with `detail`** set to `authorization_pending`, `slow_down` (when polled faster than `interval`), `access_denied`, or `expired_token`.
  - On approval, `/token` returns `{access_token, device_id, scopes, expires_at}`. **This is single-use**: `consume_approved` deletes the pending state.
  - UI-side endpoints: `GET /pending/{user_code}` (scope `me.read`) shows requested vs. allowed scopes. `POST /approve {user_code, approved_scopes, device_name?, expires_in?}` (scope `me.write`) returns 403 if the scopes exceed what is allowed. `POST /deny`.

  [code] — [device_auth.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/device_auth.py)
- On approval, the server either upserts the Device by `(user_id, client_device_identifier)` or creates a new one. That pair has a unique index, "used to dedupe re-registrations of the same device across token resets". A new device gets `sync_mode=api`. Each approval creates a **new** ClientToken bound to the device, so re-pairing the same device creates an extra token rather than replacing the old one. [code] — [device_auth.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/device_auth.py), [models/device.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/models/device.py)
- Grout probes `GET /api/heartbeat` and enables device auth only when the major version is ≥5. Unparseable versions are treated as unsupported. Argosy gates device auth at `5.0.0`. [client code] — [grout romm/heartbeat.go](https://github.com/rommapp/grout/blob/main/romm/heartbeat.go), [RomMCapabilities.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMCapabilities.kt)
- Scope catalog:
  - Read set: `me.read, roms.read, platforms.read, assets.read, devices.read, firmware.read, roms.user.read, collections.read, playlists.read`.
  - Write set adds: `me.write, assets.write, devices.write, roms.user.write, collections.write, playlists.write`.
  - Edit set adds: `roms.write, platforms.write, firmware.write`.
  - Full set adds: `users.read/write, tasks.run, logs.read`.

  [code] — [handler/auth/constants.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/handler/auth/constants.py)
- The 5.0.0 release notes list "QR code pairing... currently available on Argosy Launcher and Playnite". [release notes] — [5.0.0](https://github.com/rommapp/romm/releases/tag/5.0.0)

### Inferences
- A client should detect revocation as 401 or 403 on any call, then restart pairing.
- Because a device deleted in the UI leaves its token alive but unbound, a client should check that `GET /api/devices/{cached_id}` still exists. If it is gone, re-pair or re-register.
- `/devices` socket auth on master refuses with message `unauthorized` or `disabled`, which is how Argosy detects a revoked token in real time.
- Request `roms.user.read/write` as well if the client will report play sessions or props. Grout's scope list omits them because it does not track playtime.

### Gaps
- I did not inspect what the RomM web UI renders for paired devices, such as columns or a per-device "revoke" action. The API exposes the DeviceSchema fields listed above.
- I did not confirm the exact HTTP status for a revoked or expired token. The auth backend returns `None`, which is presumably 401 on protected routes.

---

## 5. Play sessions, rom_user fields, RetroAchievements, and collections

### Takeaway
Playtime is reported through `POST /api/play-sessions` (4.9+, scope `roms.user.write`, batches ≤100) or batched in the sync-complete call. Per-user ROM state lives in `rom_user` and is updated with `PUT /api/roms/{id}/props`. Uploading a save or state implicitly bumps `last_played`. RetroAchievements data comes through `ra_id`, `ra_hash`, and `merged_ra_metadata` on ROMs, plus a per-user progression refresh. Collections come in three kinds: regular, smart, and virtual.

### Cited Findings
- `POST /api/play-sessions` (201, scope `roms.user.write`) takes `{device_id?, sessions: [{rom_id?, save_slot?, start_time, end_time, duration_ms ≥0}]}`.
  - It returns 400 on an empty batch or one with more than 100 sessions.
  - `device_id` falls back to the token's bound device.
  - The response is `{results: [{index, status, id?, detail?}], created_count, skipped_count}`.

  `GET /api/play-sessions?rom_id&device_id&start_after&end_before&limit=50&offset` uses scope `roms.user.read`. `DELETE /api/play-sessions/{id}` is also available. [code] — [play_sessions.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/play_sessions.py)
- `PUT /api/roms/{id}/props?update_last_played=bool&remove_last_played=bool` (scope `roms.user.write`; the two flags are mutually exclusive, 400 if both are set). Body `RomUserData` fields:
  - `is_main_sibling`, `backlogged`, `now_playing`, `hidden`
  - `rating` (0–10), `difficulty` (0–10), `completion`
  - `status`: `incomplete` | `finished` | `completed_100` | `retired` | `never_playing`

  It returns `RomUserSchema` with `last_played`. [code] — [roms/__init__.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/roms/__init__.py), [models/rom.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/models/rom.py), [responses/rom.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/responses/rom.py)
- `POST /api/saves`, `PUT /api/saves/{id}`, and `POST /api/states` each set `rom_user.last_played = now`. [code] — [saves.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/saves.py), [states.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/states.py)
- Argosy also uses three more endpoints:
  - `POST api/activity/heartbeat` and `DELETE api/activity/heartbeat?device_id`, for live "now playing" presence.
  - `POST api/users/{id}/ra/refresh`, for RetroAchievements progression.
  - `PUT api/roms/{id}/props`.

  [client code] — [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt)
- `RomSchema` includes `ra_id`, `ra_hash`, and `merged_ra_metadata` (`RomRAMetadata`), and `RomFileSchema` includes `ra_hash`. The server needs `RETROACHIEVEMENTS_API_KEY` to fetch RA data. [code] — [responses/rom.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/responses/rom.py), [env.template](https://github.com/rommapp/romm/blob/5.3.1/env.template)
- Collection endpoints:
  - `GET /api/collections?is_favorite`
  - `GET /api/collections/smart`
  - `GET /api/collections/virtual?type=<type|all>&limit` (scope `collections.read`)
  - `GET /api/collections/identifiers`
  - `GET /api/collections/{id}`

  Argosy also creates and updates regular collections via multipart `name`, `description`, and `rom_ids`. [code] — [collections.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/collections.py); [client code] — [grout romm/endpoints.go](https://github.com/rommapp/grout/blob/main/romm/endpoints.go), [RomMApi.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMApi.kt)

### Inferences
- A Linux launcher should do the following:
  - Record session start and end locally.
  - Send the sessions at sync completion, or through `/api/play-sessions` when no sync runs. The first is Argosy's pattern; Grout skips playtime entirely.
  - Set `now_playing` and `status` through `/props`.
  - Use `update_last_played=true` on launch if it does not upload a save.

### Gaps
- I did not enumerate the valid virtual collection `type` values; the handler accepts a string or `all`.
- I did not read the payload schemas for `/api/activity/heartbeat` and `/ra/refresh`.
- I did not verify the ingest dedupe rule behind "skipped".

---

## 6. API versioning and compatibility policy, and breaking changes from 4.x to 5.x

### Takeaway
RomM has **no URL or API versioning**: it uses `/api/...` for everything and has no deprecation policy. Clients read the server version from `GET /api/heartbeat` → `SYSTEM.VERSION`, which reports `"development"` for source builds, and gate features on it.
- **Grout** pins its version to RomM's: "The required RomM version matches the first three components of Grout's version number. The fourth component is for Grout-specific patches."
- **Argosy** supports "the latest three RomM minor releases". It gates each feature by a minimum version and keeps a multi-version Docker testbed to record response-shape changes.

The sync and device surface arrived incrementally across 4.7 → 5.0.

### Cited Findings
- Grout's README: "Grout aggressively adopts new RomM features. The required RomM version matches the first three components of Grout's version number. The fourth component is for Grout-specific patches. Grout may still function on older RomM versions, but support will not be provided." Its current stable is v5.3.1.3. [client code] — [grout README](https://github.com/rommapp/grout/blob/main/README.md), [grout docs/versions.json](https://github.com/rommapp/grout/blob/main/docs/versions.json)
- Argosy's capability gates:
  - `MIN_SUPPORTED_VERSION = 4.9.0`
  - Sync engine, device sync, and hash trust: 4.9.0
  - Device auth, screenshot upload, and music API: 5.0.0
  - Music playlists: 5.1.0
  - Music games: 5.3.0
  - Device install: 5.4.0

  Argosy maps `"development"` to `9999.0.0` only in debug builds. Its policy note reads: "Argosy supports the latest three RomM minor releases. Below this the server is not refused, but no version-specific behaviour is kept for it." [client code] — [RomMCapabilities.kt](https://github.com/rommapp/argosy-launcher/blob/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm/RomMCapabilities.kt)
- Feature arrival, from the presence of files and parameters at each tag:
  - **4.7.0**: `device.py`, plus `optimistic` and `track`/`untrack` on saves.
  - **4.8.0**: `client_tokens.py`.
  - **4.9.0**: `sync.py` (negotiate) and `play_sessions.py`.
  - **5.0.0**: `device_auth.py` (QR/device-code pairing).
  - **5.1.0**: Range-resumable cached zips.
  - **5.3.0**: `rom_ids` scoping, `MAX_SAVES_PER_SLOT`, and memory cards.
  - **4.6.0** has none of the sync, device, token, or play-session endpoints.

  [code] — git tag inspection of [romm](https://github.com/rommapp/romm/tree/4.9.0/backend/endpoints)
- Response-shape break at 5.0: root game files' `files[].category` changed from `null` to `"game"`, and `is_top_level` was added. [client code] — [argosy testbed README](https://github.com/rommapp/argosy-launcher/blob/main/testbed/romm/README.md)
- The 5.0.0 release notes have no explicit "breaking changes" section. Client-affecting items include:
  - scan/scan:stop sockets now require `tasks.run`
  - "enforce parent ROM visibility on direct file endpoints"
  - a new permission system with per-user and per-group grants
  - "Squash legacy migrations"
  - collection downloads as a single zip
  - QR pairing

  [release notes] — [5.0.0](https://github.com/rommapp/romm/releases/tag/5.0.0)
- The 5.3.0 breaking changes:
  - "We no longer detect the filesystem layout by default". The structure must be declared in `config.yml` (`filesystem.structure`), and `filesystem.roms_folder`/`firmware_folder` were removed.
  - Streaming config was reworked.
  - CSRF is kept "in force when a session cookie is present" (#4648).
  - `rom_ids` became "the only ROM scope on saves and states" (#4305).

  [release notes] — [5.3.0](https://github.com/rommapp/romm/releases/tag/5.3.0)
- RomM migrations are one-way; Argosy notes that "a database a newer RomM has already migrated is not a supported input to an older one". [client code] — [argosy testbed README](https://github.com/rommapp/argosy-launcher/blob/main/testbed/romm/README.md)
- `GET /api/heartbeat` returns `SYSTEM.VERSION`, `SYSTEM.SHOW_SETUP_WIZARD`, and, in development, `GIT_BRANCH`. `GET /api/heartbeat/metadata/{source}` probes metadata providers and is rate-limited in 5.3. [code] — [heartbeat.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/heartbeat.py); [client code] — [grout romm/heartbeat.go](https://github.com/rommapp/grout/blob/main/romm/heartbeat.go)

### Inferences
- A new Linux client should follow Argosy's model:
  - Support the latest three minors, currently 5.1, 5.2 and 5.3.
  - Build a capability object from the heartbeat version.
  - Tolerate both old and new response shapes rather than branching on version.
  - Run a pinned-version Docker matrix in CI.
- Practical floor: 5.0, for device-code pairing. 5.1 adds resumable multi-file downloads. 5.3 adds `rom_ids` negotiate scoping, which matters for partial-library devices.

### Gaps
- I did not fetch the 5.1.0 and 5.2.0 release notes, and I did not check whether a CHANGELOG file exists in the repo.
- 4.x to 5.0 rename and removal details beyond the release-note items above were not exhaustively diffed.

---

## 7. Official client SDKs and how first-party clients structure their API layer

### Takeaway
I found **no official, published RomM client SDK** for TypeScript, Python, Go, or Kotlin. The RomM web frontend generates TypeScript types and models from `/openapi.json` with **openapi-typescript-codegen**. Grout and Argosy both **hand-write** their API layers. Grout uses a Go package with endpoint constants and structs. Argosy uses a Retrofit interface with Kotlin data classes and a capabilities gate.

### Cited Findings
- The RomM frontend `package.json` script is `"generate": "openapi --input http://127.0.0.1:3000/openapi.json --output ./src/__generated__ --client axios --useOptions --useUnionTypes --exportServices false --exportSchemas false --exportCore false"`, using the dependency `openapi-typescript-codegen ^0.29.0`. It generates only models; services and core are disabled. [code] — [frontend/package.json@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/frontend/package.json), [frontend/src/__generated__](https://github.com/rommapp/romm/tree/5.3.1/frontend/src/__generated__)
- Grout's `romm/` package splits the API into one file per area, each with a `_test.go`:
  - `endpoints.go` holds the path constants.
  - Domain files: `client.go`, `httpclient.go`, `auth.go`, `device_auth.go`, `devices.go`, `saves.go`, `sync.go`, `roms.go`, `platforms.go`, `collections.go`, `firmware.go`, `heartbeat.go`, `errors.go`.

  [client code] — [grout romm/](https://github.com/rommapp/grout/tree/main/romm)
- Argosy's `data/remote/romm/` contains:
  - `RomMApi.kt`: a Retrofit interface that uses `@Streaming` plus a `Range` header for downloads.
  - `RomMApiClient.kt` and `RomMApiFactory.kt`.
  - `RomMCapabilities.kt`.
  - `DeviceAuthPoller.kt`.
  - `RomMDeviceSocket.kt`: socket.io.
  - Model files: `RomMModels.kt`, `RomMSaveModels.kt`, `RomMSyncModels.kt`, `RomMDeviceModels.kt`, `RomMPlaySessionModels.kt`.
  - Services for library, collection, and user-property sync.

  [client code] — [argosy data/remote/romm](https://github.com/rommapp/argosy-launcher/tree/main/app/src/main/kotlin/com/nendo/argosy/data/remote/romm)
- The server's OpenAPI spec is served at `/openapi.json`; this was verified earlier in the session against the user's 5.2.0 server. Each endpoint carries a docstring and pydantic `Field` descriptions; sync.py is one example. [code] — [sync.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/sync.py)

### Inferences
- For a Linux client, there are two workable options:
  - **Hand-write a thin typed client** for the roughly 30 endpoints it needs, as Grout and Argosy do. This keeps the client resilient to OpenAPI churn.
  - **Generate types from a pinned `/openapi.json` per supported minor**, with a schema-diff check in CI.

### Gaps
- I did not search PyPI, npm, or crates.io for community SDKs, so third-party SDK availability is unverified.

---

## 8. Running RomM in Docker for automated integration tests

### Takeaway
The minimum test stack is **MariaDB plus the `rommapp/romm` image**. The image runs its own internal Redis, so the example compose only mounts `/redis-data`. Seed it as follows:
1. Bind-mount a tiny fake library laid out as `roms/<platform_fs_slug>/<file>`.
2. Create the first admin with `POST /api/users` while the setup wizard is active. This needs the CSRF cookie echoed back.
3. Trigger a scan over **socket.io**, because the REST scan task is not manually runnable. Send `apis: []` so no metadata provider is contacted.
4. Mint a token with `POST /api/client-tokens` using HTTP Basic auth.

Metadata providers are off by default: leave the API keys empty and `*_API_ENABLED=false`. Grout's e2e harness and Argosy's testbed both work this way.

### Cited Findings
- Grout e2e compose uses `mariadb:11` on **tmpfs** with a healthcheck, plus `rommapp/romm:latest`. The RomM service sets these environment variables:
  - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWD`
  - `ROMM_AUTH_SECRET_KEY`
  - `ENABLE_RESCAN_ON_FILESYSTEM_CHANGE=false`
  - `ENABLE_SCHEDULED_RESCAN=false`

  It mounts `./library:/romm/library`, and its healthcheck is `curl -fsS http://localhost:8080/api/heartbeat`. There is no separate Redis service. [client code] — [grout test/e2e/compose.yml](https://github.com/rommapp/grout/blob/main/test/e2e/compose.yml)
- Grout's test library is two 14-byte fake ROMs: `roms/gba/Another Game (Europe).gba` and `roms/snes/Test Game (USA).sfc`. The README says "They are a few bytes of nothing." [client code] — [grout test/e2e/library](https://github.com/rommapp/grout/tree/main/test/e2e/library), [grout test/e2e/README.md](https://github.com/rommapp/grout/blob/main/test/e2e/README.md)
- Grout's `provision.py` runs these steps:
  1. `GET /api/heartbeat` to obtain the `romm_csrftoken` cookie, and read `SYSTEM.SHOW_SETUP_WIZARD`.
  2. If the wizard is active, `POST /api/users {username, password, email, role:"admin"}` with header `X-CSRFToken`.
  3. `POST /api/login` with Basic auth.
  4. Connect socket.io at `socketio_path="/ws/socket.io"` with the session cookie, emit `"scan", {"platforms": [], "type": "quick", "apis": []}`, and wait for `scan:done` or `scan:done_ko`.
  5. `POST /api/client-tokens {name, scopes}` with Basic auth to get `raw_token`.
  6. `POST /api/devices {name, platform, client:"grout", sync_mode:"api", allow_existing:true}` to get `device_id`.

  Its comment on 5.3 explains why the writes go without cookies: "RomM 5.3 binds the [CSRF] token to [a user]. Basic auth with no session skips the check by design, so the writes go without cookies." [client code] — [grout test/e2e/romm/provision.py](https://github.com/rommapp/grout/blob/main/test/e2e/romm/provision.py)
- Server side: `POST /api/users` has an empty scope list and enforces `users.write` **only if admin users already exist**. This is what makes non-interactive first-admin creation possible. [code] — [user.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/endpoints/user.py)
- Argosy's testbed adds several notes:
  - The CSRF cookie is `romm_csrftoken`, echoed as `x-csrftoken`.
  - "`email` is required even though the UI implies otherwise."
  - "`POST /api/tasks/run/scan_library` answers 400 'cannot be run' because that task is `manual_run: false`."
  - Scan types are `new_platforms`, `quick`, `update`, `unmatched`, `complete`, `hashes`.
  - A quick scan of the mock library takes under 90 seconds.
  - It uses one database per RomM version (`mariadb:11.3.2` with an initdb SQL) and pinned images `ghcr.io/rommapp/romm:5.1.0` etc.

  [client code] — [argosy testbed/romm/README.md](https://github.com/rommapp/argosy-launcher/blob/main/testbed/romm/README.md), [romm-5.1.yml](https://github.com/rommapp/argosy-launcher/blob/main/testbed/romm/romm-5.1.yml)
- Metadata providers come from env keys, all empty or `false` by default:
  - Credentials: `IGDB_CLIENT_ID/SECRET`, `MOBYGAMES_API_KEY`, `STEAMGRIDDB_API_KEY`, `RETROACHIEVEMENTS_API_KEY`.
  - Toggles: `PLAYMATCH_API_ENABLED`, `LAUNCHBOX_API_ENABLED`, `HASHEOUS_API_ENABLED`, `FLASHPOINT_API_ENABLED`, `HLTB_API_ENABLED`, `TGDB_API_ENABLED`, `STEAM_API_ENABLED`, and others.

  [code] — [env.template@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/env.template)
- 5.3 library structure: the default ROM template is `roms/{platform}/{game}` and the firmware template is `bios/{platform}`. Overrides go in `config.yml` under `filesystem.structure`, per `fs_slug`. [code] — [config/config_manager.py@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/backend/config/config_manager.py), [examples/config.example.yml@5.3.1](https://github.com/rommapp/romm/blob/5.3.1/examples/config.example.yml)

### Inferences
- A minimal CI recipe:
  - Run `mariadb:11` on tmpfs plus `ghcr.io/rommapp/romm:<pinned>`, one service per supported minor.
  - Mount a fixture library at `/romm/library/roms/<slug>/…`. Use tiny fake files, or free homebrew ROMs if the tests need real hashes or metadata.
  - Run a provision script like Grout's.
  - Test device-code pairing end to end by calling `/api/auth/device/init`, then `/approve` with an admin Basic-auth session, then `/token`.
- Since Grout's e2e runs `latest` (5.3.x) with no `config.yml` against a `roms/{platform}` layout, the default `roms/{platform}/{game}` structure appears to work without explicit config. The 5.3 "refuses to start" warning likely applies only to libraries that don't match the default layout.

### Gaps
- Free or homebrew ROM sources were not researched; only Grout's fake-file approach was confirmed.
- I did not verify the exact 5.3 start-up refusal condition for undeclared structures.
- I did not confirm whether `/api/auth/device/approve` accepts Basic auth without CSRF, which would allow fully headless pairing tests.
