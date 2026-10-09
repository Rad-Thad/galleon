# Docker RomM

Disposable RomM servers for the real-server suites: 5.2.0 and 5.3.1, the
versions the owner's server has run. Nothing persists between runs.

```sh
npm run test:romm                       # all of the below, on 5.2.0 then 5.3.1
npm run test:romm -- --profile v531     # one version
```

`run.mjs` is that command. By hand:

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
  database. `client.real.ts` drives RomMix's own client (heartbeat, platforms,
  paged listing, downloads broken mid-body and resumed by range, the per-file
  endpoint); `pairing.real.ts` walks device pairing end to end;
  `library.real.ts` checks the scanned platforms and the multi-file flags;
  `icons.real.ts` walks every platform's icon candidates twice and holds each
  404 to one request;
  `sync.real.ts` holds the calls that write (device registration, save and
  state round trips, play sessions) beside firmware and the whole-game
  archive. `server.ts` is what they share: the provisioned state, the client
  signed in to it, and a record of every request it sends.
- `schema.mjs`: holds a recorded request to the version's OpenAPI document in
  `schema/` (operation, query names, body shape). The real suites assert
  every request they record fits; `schema.test.ts` tests the checker.
- `lib.mjs` holds the provisioner's server-free half; `lib.test.ts` tests it
  and runs in `npm test`.
