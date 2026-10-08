# 0003: Autonomous verification: a device bridge on the Nova and one acceptance session

- Status: **Accepted** (2026-10-08).
- Deciders: the owner.
- Amends: [ADR 0001](0001-fork-rommix.md) (the owner as tester) and [ADR 0002](0002-save-sync-compat.md) (decisions 6 and 9).

## Context

The earlier plan made the owner the tester: GitHub checklists a few times a week, result forms, bug reports, gate rounds, and a RomM test account until Gate 2. The owner then said ([REQUIREMENTS-FROM-TESTER.md](../REQUIREMENTS-FROM-TESTER.md), item 15):

> "I don't think I'll be reporting bugs on GitHub, I just want a full dev cycle and an up and running app with as much of it fleshed out and tested as possible without my intervention."

Asked how the agent would know when the Nova is reachable, and what happens when the Mac is asleep, the owner also ruled out a bridge that lives on the Mac.

What makes autonomy possible:

- Phase 0 proved the base works in Game Mode. What remains to prove on hardware is measurable: launches and exits, focus, frame times, power profiles, downloads, Steam behaviour, save files.
- The Nova runs Python 3, git, ssh and systemd user units, and the desktop user may switch Armada's power profile over D-Bus (`armada-power`, group `wheel`) and add Steam shortcuts through Steam's CEF debugger, as Armada Store does ([DEVICE-FACTS.md](../DEVICE-FACTS.md)).
- Stock RomMix on the Nova is already signed in to RomM, with its token stored in a plain-text file (no keyring in Game Mode), so tests can read the library without asking anyone.

## Decision

1. **The device bridge runs on the Nova.** A systemd user timer runs `tools/device-bridge/` every hour. It tests only when it is inside a night window, the Nova is in Game Mode, on its charger with at least 40% battery, and nobody is playing. Nothing reaches into the device from outside, and no other computer has to be awake. The owner's Mac is used once, by the local Claude session, to install it.
2. **Results travel through git.** The bridge pushes sanitised results to an orphan `device-results` branch with a repository deploy key that has write access. The `main` ruleset keeps an empty bypass list, so the key cannot change `main`. The agent reads the branch at the start of every session and never writes it.
3. **The app tests itself, safely.** Galleon gains a self-test mode (M0-21) and each nightly ships a test bundle (M0-22). Tests run in a separate home, read RomM through a guard that allows only GET and HEAD, start emulators in sandboxes with their own config and save folders, mute the sound, stop at the first button press, and compare a manifest of the owner's files before and after. A failed safety check blocks every pass from that run.
4. **Two new verification types.** `device`: a feature passes when one device result, for a build that contains it, shows all its named checks passing with both safety checks. `acceptance`: only what genuinely needs a person (look and feel, the Argosy round trip on Android, button feel, shader picks, the Decky panel, an attended reboot, a real Steam install, the owner's Jellyfin). Every former `tester` feature became one of these or `ci`.
5. **One acceptance session, near the end.** The agent collects every acceptance item into one script (`docs/ACCEPTANCE.md`, at most two hours) and sends one invitation. The owner runs it with the local Claude session, which does every terminal and GitHub step and records the results on `device-results`.
6. **Gates are automated.** Gate 1 is decided by device metrics against fixed thresholds over two consecutive nightlies (PLAN.md section 9). A pivot to the Godot fallback needs documented optimisation rounds first and then a `needs-human` decision whose safe default is to stay with Electron. Gate 2 is golden fixtures from Argosy's code (as a specification), Docker round trips and device filesystem checks; the real Android round trip moves into the acceptance session.
7. **No writes to the owner's server before the acceptance session.** The test-account rule is withdrawn because the owner is not testing saves during development. Instead: the agent cannot reach the server; device tests are read-only; save checks run against a fake RomM on the device; a save download never carries a `device_id`. The first real save writes happen in the acceptance session, after a read-only backup.
8. **Decisions never block.** A question only the owner can answer is a `needs-human` issue that states a safe default; after 72 hours without an answer the agent adopts the default and records it in an ADR. The owner can still change it later.
9. **Cadence.** A Claude Project is the main engine (its threads wait out usage limits and continue); an hourly Routine is the heartbeat that resumes work and reads device results. Both follow the same CLAUDE.md and the same concurrency lock.

## Consequences

- Development never waits on the owner. If the Nova is away for days, device features wait while everything else continues.
- The agent's code (the test bundle) runs on the owner's device as the desktop user. That is the trust the owner granted for hardware testing, bounded by the sandboxes, the read-only guard and the owner-state check; the bridge may update itself only from a bundle whose run passed those checks.
- Subjective problems surface late, in the acceptance session. Screenshots at 1280x960, frame-time thresholds and the Argosy design spec reduce the risk; failed items get a short follow-up session.
- Some behaviours are measured indirectly: the hold-Start path is exercised through Galleon's own gamepad layer rather than physical buttons, emulators run homebrew rather than commercial games, and saves are round-tripped through a fake server. The acceptance session covers the physical and real-data versions once.
- `REQUIREMENTS-FROM-TESTER.md` items 13 and 14 are read in this light: the owner neither tests nor verifies during development.
