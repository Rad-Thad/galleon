# 0001: Hard-fork RomMix v0.20.0 as the base

- Status: **Accepted** (2026-10-08). Gate 0 (Phase 0) passed the same day. Amended by [ADR 0003](0003-autonomous-verification.md): the owner no longer tests during development.
- Deciders: the owner, on the research report's recommendation.
- Supersedes: the ES-DE placeholder prototype in `reference/romm-es-prototype/`.

## Context

The goal is "Argosy, but for Linux and armadaOS" on a Retroid Pocket Nova (aarch64, Adreno 740, 4:3 1280x960 at 120 Hz) running Steam Game Mode, built by an autonomous cloud agent that cannot reach the device or the RomM server (hardware testing comes back through the device bridge of ADR 0003) ([REQUIREMENTS-FROM-TESTER.md](../REQUIREMENTS-FROM-TESTER.md)).

The research ([REPORT-romm-launcher-plan.md](../research/REPORT-romm-launcher-plan.md), [fork_candidates.md](../research/fork_candidates.md)) found one existing project close to the goal: **RomMix** (github.com/leclercb/rommix), an MIT Electron 44 / React 19 / TypeScript RomM frontend. It ships arm64 AppImages built on `ubuntu-24.04-arm`, runs as a non-Steam game under gamescope, pairs by device code, downloads on demand with a queue, syncs saves and states, handles BIOS, multi-disc and offline mode, and leaves an emulator when Start is held. Its emulators are data under `src/config/emulators/`, its UI runs in a browser preview, and its built app is tested against a fake RomM. Every other candidate had a hard blocker (ES-DE: no UI API and no C++ collaboration; OpenGamepadUI: wants to own the session and has no RomM plugin; Tender: x86_64-only RetroDECK and RomM 5.3+; Pegasus: Qt5; Grout: does not launch games; Argosy: Android-only and GPL).

Phase 0 ran stock RomMix v0.20.0 on the Nova on 2026-10-08 and passed every check, in Desktop Mode and in Game Mode ([PLAN.md, PHASE 0 RESULTS](../PLAN.md#phase-0-results)). Game Mode felt laggy only on Armada's Balanced power profile; on Performance it matched Desktop Mode, and Chromium was hardware-accelerated. Holding Start quit RetroArch gracefully and returned focus.

## Decision

1. **Base.** Hard-fork RomMix at the **v0.20.0** tag, commit `ea787b98c32ce6efcd0c0448c0dac5aed074f3af`. It is green in upstream CI and it is exactly the build the owner validated. The plan was written against upstream's tip at the time, `990e55e3855db5ef0c92324283664b71f14fd37d`. That tip's CI is red: `test:app` fails on both architectures after two controller-listing commits (68697e0, 990e55e). Those commits are ported later, once fixed (features.json M3-08).
2. **Hard fork, standalone repository.** The fork is a public repository holding RomMix's full history, not a GitHub "fork" (forks start with Issues and Actions disabled, and pull requests default to the upstream base). Upstream stays a remote called `upstream`, and useful upstream commits are ported deliberately (M0-19). Generic improvements are offered back as patch series that the owner may submit (M6-14).
3. **Name.** The fork needs its own identity so it can sit beside stock RomMix on the same device without sharing `~/rommix`, `~/.config/rommix`, the single-instance lock or the updater. **Galleon** (a ship, after Argosy and Armada) is the final name, chosen by the owner on 2026-10-08. The repository is `github.com/Rad-Thad/galleon`. The rename touches only what users and the OS see: product name, appId `io.github.<owner>.Galleon`, executable `galleon`, `Galleon-<arch>.AppImage`, `galleon-steam.sh`, home `~/galleon`, the XDG pointer, the updater endpoints and the strings. Internal identifiers (`RomMixApp`, `ROMMIX_*` variables, file names) stay, to keep upstream ports cheap; the one exception is the home override, `GALLEON_HOME`, so that stock RomMix's `ROMMIX_HOME` can never point Galleon at RomMix's folder.
4. **Licence.** The fork stays **MIT**. GPL projects (Argosy, Tender, OpenGamepadUI, Ludo, ROCKNIX scripts) are specifications only: no code and no verbatim text is copied. MIT sources (Grout, ES-DE data files) may be ported with attribution in THIRD_PARTY.md. MPL-2.0 argosy-sigil may be used as a separately licensed, pinned component, and only after an ADR. GPL shaders are never bundled; they come from the emulator's own install or are fetched at run time.
5. **Upstream agent material removed.** `.claude/skills/` (including an `update` skill that commits straight to `main` and a terse-output style), `.agents/`, `skills-lock.json`, `.github/FUNDING.yml`, `.github/workflows/pages.yml` and `.github/ISSUE_TEMPLATE/emulator.yml` are removed in the overlay commit. RomMix's root CLAUDE.md is folded into this repository's CLAUDE.md, and its CONTRIBUTING.md stays authoritative for house style.
6. **Process boundary.** The RomM client, download queue, save engine and process launcher stay in Electron's main process and are reachable through a local JSON socket (M1-17). The Decky panel needs that socket, and it keeps a renderer replacement (the Godot fallback in PLAN.md) to a UI rewrite.

## Consequences

- Most of the "expensive middle" (pairing, downloads, offline, BIOS, saves plumbing, a pad-driven UI) exists from day one. The work is the Armada layer, an Argosy-compatible save engine, the 4:3 design and Steam integration.
- The fork inherits RomMix's conventions: no emulator named outside `src/config/`, every string in `src/shared/i18n/` in four languages, a coverage floor, comments that explain why. Following them keeps upstream ports possible.
- Chromium smoothness depends on the power profile. The fork tells the player (M1-16), cuts idle cost (M1-27) and aims to be smooth on Balanced (M4-34).
- A single upstream maintainer means drift risk. It is mitigated by the weekly upstream watch and by keeping internal names.
- The Godot 4.7 fallback stays documented in PLAN.md, but it is not expected: Gate 0 passed. Gate 1 (the first fork build on the Nova) is the remaining stack checkpoint.
