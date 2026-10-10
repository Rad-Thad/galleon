# How saves travel, per system

Which emulator Galleon runs per system so that saves continue from Argosy (M2-08, ADR 0002 decision 6). The options and the verdicts come from [SPEC.md](SPEC.md), section 10.

- **(A)** the same libretro core as Argosy, in RetroArch: saves move unchanged.
- **(B)** the standalone emulator Armada installs, with an adapter where the spec says the save is convertible.

**Status: asked in issue #110 on 2026-10-10. The safe default applies on 2026-10-13 01:00 UTC if there is no answer.** Until then nothing below is in force, and the settings keep their current defaults.

| System    | Spec verdict                                                                                                   | Recommended and safe default                                                  | Answer  |
| --------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| SNES      | same bytes (RetroArch `snes9x`)                                                                                | (A) RetroArch, Argosy's core                                                  | pending |
| GBA       | same bytes (RetroArch `mgba`); Pizza Boy convertible                                                           | (A) RetroArch `mgba`                                                          | pending |
| PS1       | same bytes with Argosy's RetroArch core; DuckStation convertible                                               | (A) RetroArch, Argosy's PS1 core (which one comes from M2-02)                 | pending |
| PSP       | same bytes (PPSSPP)                                                                                            | (B) PPSSPP                                                                    | pending |
| PS2       | same bytes with an ARMSX2 folder card; a file card is not interoperable                                        | (B) ARMSX2 with a folder card in Galleon's own settings                       | pending |
| GameCube  | same bytes with Dolphin's GCI folder; a card file is convertible                                               | (B) Dolphin, GCI folder                                                       | pending |
| Wii       | same bytes (Dolphin)                                                                                           | (B) Dolphin                                                                   | pending |
| Dreamcast | convertible for Argosy's built-in core with a per-game VMU; Argosy does not sync standalone Flycast or Redream | (B) Flycast, per-game VMU; otherwise saves stay on each side, said in the app | pending |

The acceptance session (M8-07) re-confirms every row. Each one can be changed later in Settings.

Several verdicts above are provisional in SPEC.md, marked _(M2-02)_ there, until the shape report confirms them. When this decision is adopted, its ADR restates any verdict M2-02 changed. Android emulators Argosy does not sync at all (SUPER ZSNES, Linkboy, RetroArch for Wii, standalone Flycast and Redream) cannot carry saves whatever is chosen here. The app says so for those games.
