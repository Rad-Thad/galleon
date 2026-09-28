# Still to do

What a full-codebase review on 2026-09-20 turned up and left standing. Everything
else it found was fixed in the commit that added this file; what is here is only
the work that remains, with the reason each was not done at the time.

## Left open

- [ ] **`src/main/safepath.ts:26` — containment is lexical only.** A directory
      symlink already inside a system folder, routine on EmuDeck, plus a RomM
      `file_name` of `disc/.bashrc` passes `safeJoin` and is written through. The gap
      that mattered is closed — the save pull now goes through `safeJoin` like every
      other reader of a server-supplied name — but hardening the function itself
      means a `realpath` comparison, which makes it async across twelve call sites
      and rewrites a test file that is pure string cases throughout. Worth its own
      commit and its own review.

- [ ] **`src/config/emulators/types.ts` — `SaveLocation`, `LayoutSource` and the
      `dirs`/`layout` pair are not discriminated unions**, so the types admit
      descriptors that are nonsense: `{ match: 'shared', archive: true }` syncs a
      shared memory card as a per-game archive, `section` is silently ignored for
      `format: 'shell'`, and `LaunchVariant.requires` is honoured only for a
      `scripts` install, so a `requires` on a flatpak is always-offered. The
      `shared`/`directory`/`perRom` helpers are the only thing enforcing any of it
      today, and `registry.test.ts` iterates `EMULATORS`, so `example/index.ts` is
      unchecked. A real improvement to the central interface, and a refactor of it
      rather than a defect in it.

- [ ] **`src/shared/types/romm.ts:17,20,74,75` and `Credentials.expiresAt`.**
      `token_type`, `refresh_expires`, `oauth_scopes` and `avatar_path` have no
      reader, and being non-optional they force `test/app/server.ts` and
      `dev/bridge.ts` to invent values; `expiresAt` is written three ways and never
      read, the client refreshing reactively on a 401, so `Date.parse` there can only
      ever persist `NaN`. `oauth_scopes` is the one worth keeping rather than
      deleting — it is what would let sign-in check the token it was handed against
      `REQUIRED_SCOPES` and say so, instead of meeting the first 403 at the call site.
