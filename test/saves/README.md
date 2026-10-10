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
