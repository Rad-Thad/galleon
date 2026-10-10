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
session a later negotiate cancelled is finished, not an error.

`decide.real.ts` is the equivalence test for the read-only decision
(`src/main/savedecide.ts`), which takes negotiate's decision for one game from
`GET /api/saves?rom_id&device_id` without opening a session. One game gets a
slot per rule of `compare_save_state` and of negotiate's pairing (no server
save, no slot, equal hashes, either side newer, a tie with and without a
hash, a record the client or the server or both moved past, untracked saves,
a save the device deleted, a superseded row), and the local decision must
answer every slot with the server's action, save and reason. CI runs it on
5.2.0 with the rest of the suite; on 5.3.1, run the file alone with
`ROMM_PROFILE=v531` once that profile is provisioned, since `hash.real.ts`
does not pass there yet (one raw save holding a zip end record).

## Transfers

`transfer.real.ts` holds a retried upload to what it leaves in the slot (M2-06):
the same bytes sent again by the same device, in a later second, must come
back as the copy the server already holds, with no new row. RomM recognises
identical bytes itself only for an upload with `overwrite=false`; the player's
"keep this device's save" (`overwrite=true`) is filed as a new copy however
alike it is, so `RommClient.uploadSave` checks the slot's newest copy first
and the test covers both. A changed save after a retry is the slot's second
row. It passes on 5.2.0 and 5.3.1 (run it alone there, as above).
