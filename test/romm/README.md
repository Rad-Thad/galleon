# Docker RomM

Disposable RomM servers for the real-server suites: 5.2.0 and 5.3.1, the
versions the owner's server has run. Nothing persists between runs.

```sh
node test/romm/make-library.mjs
docker compose -f test/romm/compose.yml --profile v520 up -d   # or v531, or both
node test/romm/provision.mjs --profile v520
ROMM_PROFILE=v520 npm run test:romm-real
docker compose -f test/romm/compose.yml --profile v520 down
```

- `compose.yml`: MariaDB on tmpfs and RomM pinned by digest, published on
  loopback only (ports in `provision.mjs`'s `PROFILES`). Every metadata
  provider is unconfigured and the scan asks for none.
- `provision.mjs`: first admin while the setup wizard is on, a quick scan of
  `library/`, a client token and a device, written to `.state/<profile>.json`
  (git-ignored). Running it again reuses what it finds. Ported from Grout
  (MIT, see THIRD_PARTY.md).
- `make-library.mjs`: writes `library/` (git-ignored) from scratch, the same
  bytes every run: the owner's library shapes (multi-disc folders, a cue/bin
  pair, a PSP folder with extras, an entry with no extension, Dreamcast `.chd`
  and `.cdi`) as files of a few hundred bytes, and zero-filled firmware stubs.
  No real game or BIOS bytes. `make-library.test.ts` holds it to that.
- `scripts/agent/fetch-fixtures.mjs`: adds the homebrew ROMs pinned in
  `test/fixtures/roms/manifest.json` (URL, SHA-256, size, licence, author) to
  `library/`, refusing any file whose bytes differ. Run it after
  `make-library.mjs`, which clears the tree. Optional: the suites here need
  only the synthetic files.
- `*.real.ts` (`npm run test:romm-real`): need a server provisioned on a fresh
  database. `pairing.real.ts` walks device pairing end to end;
  `library.real.ts` checks the scanned platforms and the multi-file flags.
- `lib.mjs` holds the provisioner's server-free half; `lib.test.ts` tests it
  and runs in `npm test`.
