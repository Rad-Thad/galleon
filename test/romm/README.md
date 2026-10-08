# Docker RomM

Disposable RomM servers for the real-server suites: 5.2.0 and 5.3.1, the
versions the owner's server has run. Nothing persists between runs.

```sh
docker compose -f test/romm/compose.yml --profile v520 up -d   # or v531, or both
node test/romm/provision.mjs --profile v520
ROMM_PROFILE=v520 npm run test:romm-pairing
docker compose -f test/romm/compose.yml --profile v520 down
```

- `compose.yml`: MariaDB on tmpfs and RomM pinned by digest, published on
  loopback only (ports in `provision.mjs`'s `PROFILES`). Every metadata
  provider is unconfigured and the scan asks for none.
- `provision.mjs`: first admin while the setup wizard is on, a quick scan of
  `library/`, a client token and a device, written to `.state/<profile>.json`
  (git-ignored). Running it again reuses what it finds. Ported from Grout
  (MIT, see THIRD_PARTY.md).
- `pairing.real.ts`: the device pairing flow end to end against a provisioned
  server. `lib.mjs` holds the provisioner's server-free half; `lib.test.ts` tests it and
  runs in `npm test`.
- `library/`: placeholder files of a few bytes, not ROMs. M0-07 replaces it
  with the generated fixture library.
