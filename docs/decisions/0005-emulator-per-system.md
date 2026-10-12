# 0005: Which emulator runs each system, so saves continue from Argosy

- Status: **Accepted** (2026-10-12).
- Deciders: the owner ([issue #110](https://github.com/Rad-Thad/galleon/issues/110), answered 2026-10-12, before the safe default's date).
- Settles: [ADR 0002](0002-save-sync-compat.md) decision 6 (M2-08).

## Context

A save made in Argosy on Android only continues on Galleon if the Linux emulator reads it. [SPEC.md](../save-sync/SPEC.md) section 10 sorts each system as **same bytes**, **convertible** or **not interoperable**. Issue #110 offered, per system, (A) the same libretro core as Argosy in RetroArch, or (B) the standalone emulator Armada installs, and recommended one per system.

The owner answered "all as recommended", with two notes:

1. Argosy on the phone runs **SwanStation** for PS1, so Galleon's PS1 core is `swanstation`. It is already installed in the Nova's RetroArch, with hand-tuned core options and a CRT shader preset under RetroArch's `config/SwanStation/`.
2. The PS2, GameCube and Dreamcast choices each need one emulator setting changed. The emulators' existing settings on the Nova were tuned by hand (pad bindings, renderer, shaders, texture packs, first-run prompts answered). A fresh or partial settings file brings back dialogs and setup wizards that cannot be operated with the pad in Game Mode.

## Decision

1. **Per system:**

   | System    | Emulator                         | How the save travels                                   |
   | --------- | -------------------------------- | ------------------------------------------------------ |
   | SNES      | (A) RetroArch `snes9x`           | same bytes                                             |
   | GBA       | (A) RetroArch `mgba`             | same bytes; a Pizza Boy `.sav` is renamed to `.srm`    |
   | PS1       | (A) RetroArch `swanstation`      | same bytes                                             |
   | PSP       | (B) PPSSPP                       | same bytes                                             |
   | PS2       | (B) ARMSX2, folder memory card   | same bytes                                             |
   | GameCube  | (B) Dolphin, slot A a GCI folder | same bytes                                             |
   | Wii       | (B) Dolphin                      | same bytes                                             |
   | Dreamcast | (B) Flycast, one VMU per game    | convertible from Argosy's built-in Flycast; else stays |

2. **Change one setting, in the files the Nova already has.** Where a choice needs a setting (ARMSX2's folder card, Dolphin's GCI folder for slot A, Flycast's per-game VMU), Galleon changes only that key in the emulator's existing settings file, after backing the file up. It never writes a fresh, partial or Galleon-only settings file for these emulators, and never starts one from such a file in normal play.
3. **Existing cards stay.** The single-file memory cards already on the Nova are left where they are, untouched, so nothing on them is lost.
4. **Hand-made files are kept.** RetroArch's `config/SwanStation/` options and shader preset, and the emulators' other settings, are read and never replaced. This is the same rule as #36 (the hand-made PSP 4:3 files) and #78 (the hand-installed texture packs).

## Consequences

- `docs/save-sync/SYSTEM-CHOICES.md` records the answer. The per-system default emulators in settings follow it (M2-08 part 2b), and each stays changeable in Settings. The acceptance session (M8-07) re-confirms every row.
- A save that a system's choice does not carry (Argosy's standalone Flycast and Redream, and the Android emulators SPEC.md lists as not synced) stays on each side, and the app says so.
- The settings writes in decision 2 follow the one writer's rules (M2-07): backup first, atomic write, fsync. Their unit tests use copies of complete settings files and check that every key other than the one changed is byte-identical afterwards.
- Device tests still run emulators in sandboxes (rail 3). For ARMSX2, Dolphin and Flycast a sandbox starts from a copy of the owner's settings, never from an empty one, so no first-run dialog appears; the owner's own files are only read.
- Verdicts SPEC.md marks _(M2-02)_ are still provisional. If the shape report changes one, a new ADR restates the affected row.
