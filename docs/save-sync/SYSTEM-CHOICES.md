# How saves travel, per system

Which emulator Galleon runs per system so that saves continue from Argosy (M2-08, ADR 0002 decision 6). The options and the verdicts come from [SPEC.md](SPEC.md), section 10.

- **(A)** the same libretro core as Argosy, in RetroArch: saves move unchanged.
- **(B)** the standalone emulator Armada installs, with an adapter where the spec says the save is convertible.

**Status: answered by the owner on 2026-10-12 in issue #110: all as recommended, with PS1 on `swanstation`. Recorded in [ADR 0005](../decisions/0005-emulator-per-system.md).** Where a choice needs an emulator setting (the PS2 folder card, Dolphin's GCI folder, Flycast's per-game VMU), Galleon changes only that setting in the emulator's existing settings file, after backing it up, and leaves existing memory cards where they are.

| System    | Spec verdict                                                                                                   | Recommended and safe default                                                  | Answer                             |
| --------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| SNES      | same bytes (RetroArch `snes9x`)                                                                                | (A) RetroArch, Argosy's core                                                  | owner: as recommended (2026-10-12) |
| GBA       | same bytes (RetroArch `mgba`); Pizza Boy convertible                                                           | (A) RetroArch `mgba`                                                          | owner: as recommended (2026-10-12) |
| PS1       | same bytes with Argosy's RetroArch core; DuckStation convertible                                               | (A) RetroArch `swanstation`, Argosy's PS1 core                                | owner: as recommended (2026-10-12) |
| PSP       | same bytes (PPSSPP)                                                                                            | (B) PPSSPP                                                                    | owner: as recommended (2026-10-12) |
| PS2       | same bytes with an ARMSX2 folder card; a file card is not interoperable                                        | (B) ARMSX2 with a folder card, set in its existing settings                   | owner: as recommended (2026-10-12) |
| GameCube  | same bytes with Dolphin's GCI folder; a card file is convertible                                               | (B) Dolphin, GCI folder                                                       | owner: as recommended (2026-10-12) |
| Wii       | same bytes (Dolphin)                                                                                           | (B) Dolphin                                                                   | owner: as recommended (2026-10-12) |
| Dreamcast | convertible for Argosy's built-in core with a per-game VMU; Argosy does not sync standalone Flycast or Redream | (B) Flycast, per-game VMU; otherwise saves stay on each side, said in the app | owner: as recommended (2026-10-12) |

The per-system default emulators in settings follow this table, and each can be changed in Settings. Before a launch Galleon sets the one key each choice needs: ARMSX2's `[MemoryCards] Slot1_Filename` names the folder card `Shared.ps2` (the folder is made first, as ARMSX2 makes one; `Mcd001.ps2` stays where it is), Dolphin's `[Core] SlotA` is a GCI folder for GameCube games, and Flycast's `[config] PerGameVmu` stays on. The acceptance session (M8-07) re-confirms every row.

Several verdicts above are provisional in SPEC.md, marked _(M2-02)_ there, until the shape report confirms them. If M2-02 changes one, a new ADR restates the affected row. Android emulators Argosy does not sync at all (SUPER ZSNES, Linkboy, RetroArch for Wii, standalone Flycast and Redream) cannot carry saves whatever is chosen here. The app says so for those games.
