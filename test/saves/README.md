# Save fixtures

Golden saves for the Argosy-compatible engine (M2), in `test/fixtures/saves/<system>/`.

- `fixtures.mjs` builds them from `docs/save-sync/SPEC.md`: synthetic bytes in
  exactly the shapes Argosy uploads to RomM 5.2.0 (raw `.srm`, `.mcd`, `.gci`
  and `.bin` saves; zips of PSP save folders, PS2 folder-card game folders,
  GameCube GCIs and a Wii title folder). Nothing comes from Argosy's code or
  from real saves. `node test/saves/fixtures.mjs` checks the committed files
  against the builder; `--write` rewrites them.
- `test/fixtures/saves/manifest.json` lists each fixture with the SPEC.md
  sections it follows, its library ROM (`test/romm/make-library.mjs`), the
  `emulator` tag and slot Argosy sends, the upload name, and the expected
  `content_hash` (SPEC.md section 4).
- `fixtures.test.ts` (in `npm test`) holds the files to the builder and the
  manifest to SPEC.md, unpacks every zip with the app's own reader, and scans
  every fixture for personal data: addresses, accounts, tokens and the device
  bridge sanitiser's placeholders.

Where a shape rests on something only the owner's server can confirm, the
fixture's `note` says so and names SPEC.md section 12's question; the shape
report (M2-02) cross-checks them.

## Round trips

`npm run test:saves` brings up Docker RomM 5.2.0 (`test/romm/compose.yml`),
provisions it, and runs `roundtrip.real.ts` against it. For every fixture:

- An Argosy device, a stand-in written from SPEC.md sections 3, 5 and 6 (never
  Argosy's code), uploads it to `autosave`. RomM must store it under its
  stamped name with the manifest's tag, size and `content_hash`; Argosy and
  then the fork's client, a second device holding the same bytes, each
  negotiate to `no_op` twice in a row, and the fork downloads it byte for byte.
- The fork's client uploads a changed save into that slot with
  `overwrite=false`: RomM refuses it with a 409 and stores nothing. Only the
  player's "keep this device's save" (`overwrite=true`) puts it there, beside
  Argosy's, and Argosy's next negotiate answers `download` for it.
- The reverse: the fork uploads first, a new Argosy device is told to download
  it, gets the same bytes, and then negotiates to `no_op` twice.

Each scenario empties its game's slot first, which is why the suite runs only
against the disposable servers in `test/romm/compose.yml`. CI runs it on both
architectures when save, client or fixture code changes (the `changes` step).

## content_hash

`hashcases.mjs` builds the saves where a hash computed differently from RomM's
would disagree with the server (SPEC.md section 4): zips in another entry
order, with directory entries, with bytes before or after them or a comment, a
repeated name, a code page 437 name, names whose order differs by code point
and by UTF-16, an empty zip, a damaged entry, a raw save that holds an end
record by chance, and one that only starts like a zip. `src/main/savehash.test.ts`
holds the app's `localContentHash` to what each means; `hash.real.ts` uploads
each, and every fixture, to Docker RomM 5.2.0 and requires the hash the server
stores to be the app's.

## Negotiate

`negotiate.real.ts` holds the pre-launch engine (`src/main/savenegotiate.ts`)
to what a real negotiate answers: another game's operations are dropped, and a
session a later negotiate cancelled is finished, not an error. RomM 5.4 no
longer cancels a device's open sessions at its next negotiate, so there the
earlier session completes, and its play history no longer names the session
that carried a span; the file holds each version to its own answer
(`negotiateEndsOpenSessions`).

`decide.real.ts` is the equivalence test for the read-only decision
(`src/main/savedecide.ts`), which takes negotiate's decision for one game from
`GET /api/saves?rom_id&device_id` without opening a session. One game gets a
slot per rule of `compare_save_state` and of negotiate's pairing (no server
save, no slot, equal hashes, either side newer, a tie with and without a
hash, a record the client or the server or both moved past, untracked saves,
a save the device deleted, a superseded row), and the local decision must
answer every slot with the server's action, save and reason. CI runs it on
5.2.0 with the rest of the suite; on 5.3.1 and 5.4.0, run the file alone with
`ROMM_PROFILE=v531` or `v540` once that profile is provisioned, since `hash.real.ts`
does not pass there yet (one raw save holding a zip end record).

## Transfers

`transfer.real.ts` holds a retried upload to what it leaves in the slot (M2-06):
the same bytes sent again by the same device, in a later second, must come
back as the copy the server already holds, with no new row. RomM recognises
identical bytes itself only for an upload with `overwrite=false`; the player's
"keep this device's save" (`overwrite=true`) is filed as a new copy however
alike it is, so `RommClient.uploadSave` checks the slot's newest copy first
and the test covers both. A changed save after a retry is the slot's second
row. It passes on 5.2.0, 5.3.1 and 5.4.0 (run it alone there, as above).

## Argosy's save shapes

`argosy-shapes.real.ts` runs the device check's reader,
`test/device/argosy-shapes.py` (M2-02), against Docker RomM 5.2.0 seeded as an
Argosy device: a user made for the test registers an Argosy client and
another one, uploads every fixture as Argosy to `autosave` (and one to a
channel named after its game), and gives the script a test home signed in with
its token. The report must cover exactly the seeded systems, with each save
read, its `content_hash` following RomM's rule and its archive entries the
fixture's; the other client's save is left out; the devices and save rows are
the same before and after; and no title, channel name, account, address or
token appears in it. Saves and devices are listed per user, so the other files
here, which change saves of the same games at the same time, do not reach it.
It also holds what the script relies on: an uploaded save's `origin_device_id`
is the id registration returned.

## The save contract

`contract.ts` is one set of scenarios for the save calls the engine makes:
a slotted upload stored under its stamped name with RomM's hash and read back
byte for byte, a zip's hash over its entries, another device's upload refused
with a 409 until it holds the slot's newest save (a download with
`optimistic=false` is not holding it; `/downloaded` is), the player's "keep
this device's save" going in regardless, identical bytes adding no copy, a
listing that names a device reading its records, and deletion.

It runs against two servers: Docker RomM 5.2.0 as `contract.real.ts` (in
`npm run test:saves`), and the fake RomM the device bundle carries
(`test/device/fake-romm/`, M2-20) as `contract-fake.test.ts` (in `npm test`).
The fake is what the engine meets on the Nova while the owner's server may
only be read, so a behaviour of RomM's that the fake lacks, or one it invents,
fails here first. Each scenario registers devices of its own (the app's own
registration would make every client on one host the same device) and empties
its own slot afterwards.
