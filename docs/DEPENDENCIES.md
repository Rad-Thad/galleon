# Dependencies

Every dependency added to the fork, pinned exactly, with its licence and the reason it is worth having (CLAUDE.md, rail 8). RomMix's own dependencies at the fork point are in `package-lock.json` and are not repeated here. The licence and dependency guard (M0-20) holds runtime additions to this file.

## CI only

Third-party actions, pinned by commit; none of them ships inside the AppImage.

| Name                                | Version                                             | Licence | Why                                                                                                                |
| ----------------------------------- | --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `crazy-max/ghaction-github-labeler` | v6.0.0 (`548a7c3603594ec17c819e1239f281a3b801ab4d`) | MIT     | Syncs `.github/labels.yml` to the repository's labels without deleting any (`.github/workflows/labels.yml`, M0-16) |
