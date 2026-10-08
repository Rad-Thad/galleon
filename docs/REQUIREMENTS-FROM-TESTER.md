# Requirements stated by the owner (originally the tester)

These were collected verbatim or near-verbatim during the 2026-10-08 setup session. The development plan must cover every item, either as a milestone or as an explicitly scheduled later phase. Items are never edited; a later decision is recorded as a revision note or a new item. `REQ-n` in features.json refers to item n.

## Product direction

1. **"Argosy, but for Linux and armadaOS."** A RomM managing app and launcher. The target is **parity and beyond** with the tester's own Argosy fork (`~/Documents/argosy-fork`; inventory in the research notes).
2. **Don't reinvent the wheel.** Forking or customizing existing open-source work is fine, even preferred. Choose whatever is the fastest, easiest and most flexible route, based on research.
3. **A frontend that is smoother and more customizable than Steam's Game Mode UI, while still giving access to Steam games.**
4. **On-demand downloads.** The whole RomM library (2.1 TB, about 4,200 games) is browsable on the device, and games download when needed. The SD card holds 234 GB.
5. **Download progress shown inside the app UI.** The external-window approach was rejected: "is there no way to build this more into ES-DE's UI?"
6. **Save sync** with RomM.

## UX details requested

7. **A universal way to exit a game back to the launcher** with the controller. Proposed: hold Select + Start for about 1 s, in every emulator. Emulators currently have no exit or menu hotkeys configured.
8. **Favorite means pre-download.** Marking a game as a favorite downloads it in the background so it's ready to play.
9. **An "On device" view or collection** listing what's already downloaded, plus a way to free space.
10. **Accurate progress** showing percentage, speed and time left, with a controller button to cancel.

## Emulator experience (later phase, but must be in the plan)

11. **Every emulator customized for the best experience on the Nova**: its 4:3 1280×960 120 Hz OLED and its controls.
12. **High-quality CRT shaders for each system, including more modern ones** such as PS2, GameCube, Wii and PSP, set up out of the box. The tester's words: "I love shaders even for more modern systems." Research the best CRT shader per system and per emulator, for example RetroArch slang shaders like crt-royale, crt-guest-advanced and CRT-Geom, Dolphin's post-processing shaders, PPSSPP's post-shaders and DuckStation's post-processing chains. Take into account how each looks on a 4:3 1280×960 OLED and what it costs on an Adreno 740. The tester said this "is likely a task for another time," so schedule it as a later milestone rather than for v1. Check the Argosy fork's `device-shaders/` folder for prior work.

## Process constraints

13. **The tester only tests.** Development runs autonomously in a Claude Code cloud session from a **public GitHub repo**, set-and-forget style.
    - _Revised 2026-10-08 by item 15 and [ADR 0003](decisions/0003-autonomous-verification.md):_ the owner does not test during development either. Device testing is done by the device bridge on the Nova; the owner takes part once, in a final acceptance session.
14. The cloud agent has **no access** to the device or to the tester's RomM server. Everything must be buildable and testable in the cloud, with the tester verifying on hardware.
    - _Revised 2026-10-08 by item 15 and ADR 0003:_ still true for the cloud agent. Hardware verification comes from the device bridge, which runs on the Nova, reads the RomM server only (GET), and pushes sanitised results to the `device-results` branch. The owner verifies only what needs a person, once, at the end.

## Process decision (2026-10-08, after Phase 0)

15. **A full development cycle without the owner's intervention.** In the owner's words, on 2026-10-08:

    > "I don't think I'll be reporting bugs on GitHub, I just want a full dev cycle and an up and running app with as much of it fleshed out and tested as possible without my intervention."

    Follow-up remarks the same day, and what they decided:
    - "How will the agent know when the Nova is available via ssh? What if this computer is asleep?" The device bridge runs on the Nova itself, from a systemd timer, and needs no other computer (ADR 0003).
    - Keep compile and CI times from getting "too crazy": the CI time budget in docs/PLAN.md section 4.
    - The name **Galleon** is final.
