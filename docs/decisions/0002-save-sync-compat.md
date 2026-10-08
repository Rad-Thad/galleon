# 0002: Save sync must speak Argosy's dialect to a RomM 5.2.0 server

- Status: **Accepted** as direction (2026-10-08); decisions 1, 6 and 9 amended by [ADR 0003](0003-autonomous-verification.md) the same day. The per-system details are settled by M2-01 (spec), M2-02 (a read-only shape report from the owner's server) and M2-08 (the owner's per-system choice, or its safe default), each recorded in `docs/save-sync/`.
- Scope: battery saves, memory cards and save-data folders. Save states are covered only where noted.

## Context

The owner dual-boots the Nova: Android runs Argosy, Linux runs this launcher. Both are separate RomM devices, never online at once, talking to the owner's **RomM 5.2.0** server. A save made on one side must continue on the other with no spurious conflicts. Losing a save silently is the worst failure this project can have. The Argosy fork's own rule: "Breaking it silently loses game saves."

What the RomM 5.2.0 schema says ([openapi-5.2.0.json](../../reference/romm-api/openapi-5.2.0.json), [romm_api.md](../research/romm_api.md)):

- Saves pair on **`(rom_id, slot)`**, never on file name. A null slot is an archival upload that never pairs. Argosy files the latest save under the slot **`autosave`**.
- `POST /api/sync/negotiate` accepts only `device_id` and `saves`. **5.2.0 has no `rom_ids`**, so without scoping, every unpaired server save comes back as `download`.
- The heartbeat has **no `SAVE_SYNC` section**. Argosy therefore uses its legacy per-platform handlers on this server, not the Sigil snapshot path, and their archive shapes are what is already on the server.
- `content_hash` is MD5 for a file. For a zip it is the MD5 of the sorted `name:md5` lines. A mismatched hash turns identical saves into conflicts.
- A device's first upload into an existing slot returns **409** unless it overwrites or has synced first. `optimistic=false` plus `POST /api/saves/{id}/downloaded` records "this device is current" only after the file is safely written.

What RomMix v0.20.0 does today (`src/main/saves.ts`, `src/main/romm/client.ts`, `src/main/savepairing.ts`):

- It already uses the `autosave` slot (`AUTOSAVE_SLOT` in `src/shared/saveassets.ts`), keeps backups before overwriting (`keepBackup`) and serialises syncs per game.
- It **decides client-side** by timestamps and hashes and never calls negotiate. That is a documented choice in the file's header.
- It uploads with **`overwrite=true`**, so it never sees a 409.
- It downloads **without `device_id` or `optimistic=false`**, so RomM never records this device as having synced what it downloaded.
- It archives directory saves as **`.rommix-save.zip`** in its own shape, which Argosy cannot read.
- It **skips shared memory cards** (PS2, GameCube, Dreamcast), which Argosy does sync for PS2 folder cards and GameCube GCI.

## Decision

1. **Specify before building.** Before any engine change, write `docs/save-sync/SPEC.md` from Argosy's code at `2714d5453b6bbef790987071ab0e82068009532b`, as specification only (GPL-3.0, never copied), and from RomM at tag 5.2.0 (M2-01). Check it against a read-only shape report of the Argosy saves on the owner's server, made by the device bridge without keeping any save bytes (M2-02), and turn it into golden fixtures built from the specification, with round-trip tests against Dockerized 5.2.0 and 5.3.1 (M2-03).
2. **RomM decides, the way it decides for Argosy.** The Argosy-compatible engine (M2-05) follows RomM's `compare_save_state` rules (unchanged from 5.2.0 to 5.3.1):
   - On 5.2.0, negotiate with the **full local inventory** and act only on the game in hand for a pre-launch check.
   - On 5.3 and later (heartbeat version), scope with `rom_ids`.
   - A cheaper per-game path (`GET /api/saves?rom_id&device_id` plus a local copy of `compare_save_state`) is allowed only if a test shows it decides identically to the real negotiate for every golden scenario.
3. **Transfers like Argosy's** (M2-06):
   - Uploads send `slot=autosave`, `device_id`, `session_id` and `overwrite=false`. A 409 becomes a conflict.
   - `overwrite=true` is sent only after the player explicitly chooses "keep this device's save".
   - Downloads use `optimistic=false`, a temporary file, fsync and rename, then `/downloaded`.
   - Sessions are completed with play sessions.
4. **Archive shapes are Argosy's, per system** (M2-09 to M2-14). There are no `.rommix-save.zip` archives on the Argosy-compatible path. RomMix's existing engine stays for systems the spec marks "not interoperable" and for non-Armada emulators, behind the same interface.
5. **One writer** (M2-07): every write into an emulator's save tree goes through one function. It refuses to replace a directory with a file, backs up first, writes atomically and fsyncs.
6. **The owner chooses per system** (M2-08), through a `needs-human` decision issue:
   - either run Argosy's libretro core in RetroArch, so saves travel unchanged,
   - or run the standalone emulator with an adapter where the spec says one is possible.
     The safe default after 72 hours without an answer (ADR 0003) is the first where the spec says "same bytes", the second where it says "convertible", and otherwise "saves do not travel", said plainly in the app. The owner can change it at any time, and re-confirms it in the acceptance session.
7. **Save states** sync only where both sides run the same core (M2-15). Elsewhere they stay local, and the UI says so.
8. **Visible safety** (M2-17): a durable upload queue that survives suspend and reboots, and an "All saves uploaded" mark so the owner knows when it is safe to boot into Android.
9. **No writes to the owner's server before the acceptance session** (replaces "test account first", ADR 0003). The agent cannot reach the server; device tests only read it (GET and HEAD, never a `device_id` on a save request); save checks on the device use a fake RomM on 127.0.0.1. The first real save writes happen in the acceptance session's Gate 2 round trip, after a read-only backup of the saves involved.

## RomM server upgrade (recommendation, not a requirement)

- **Do not upgrade before Gate 2 passes on 5.2.0.** Everything in this project works on 5.2.0, and RomM's database migrations are one-way.
- After Gate 2, upgrading to the latest 5.3.x (or 5.4 once stable) gives `rom_ids` per-game negotiation and memory-card versioning. The engine already gates on the heartbeat version, and CI already tests 5.3.1. Costs:
  - 5.3.0 requires `filesystem.structure` in `config.yml` for non-default layouts.
  - Migrations cannot be undone, so take a database backup first.
  - A server that reports `SAVE_SYNC.SNAPSHOTS` switches Argosy to its Sigil save path, which changes Argosy's archive shapes for Dolphin and other memory-card emulators. **Do not upgrade to a RomM that reports `SAVE_SYNC.SNAPSHOTS` until this launcher supports that path** (a new ADR and feature).
- The upgrade is the owner's decision, made through a `needs-human` issue with a rollback plan (database backup plus the previous image tag). The agent never schedules it.

## Consequences

- M2 is the riskiest milestone and comes before UI polish. A Gate 2 failure keeps the stack and reopens the failing system's feature.
- The engine sends more requests on 5.2.0, because a full inventory is sent per check. That is acceptable at the owner's scale (one device, a few hundred saves) and goes away after a server upgrade.
- RomMix's upstream engine and this fork's engine diverge. The divergence is isolated behind `SaveSync`'s interface, so upstream fixes elsewhere still port.
