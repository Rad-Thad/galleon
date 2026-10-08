# Research index

Research done on 2026-10-08 before handoff. These files explain *why* the plan is shaped the way it is; [docs/PLAN.md](../PLAN.md) and [docs/features.json](../features.json) say *what* to build. When a note and the plan disagree, the plan wins, because it also carries the Phase 0 results and the decisions that came afterwards (ADR 0003: no human tester during development). The notes still say "tester" for the owner; they are kept as written.

Absolute local paths were replaced with `~` or relative links. Links to `~/Documents/argosy-fork/...` point at the owner's private Android fork of Argosy, which is not in this repository; the parts that matter are in `argosy-fork-design-spec.md`. No addresses, tokens or account details are included.

| File | What it answers | Read it when |
|---|---|---|
| [REPORT-romm-launcher-plan.md](REPORT-romm-launcher-plan.md) | The route decision: hard-fork RomMix, the decision gates, the Godot 4.7 fallback, the save-sync risk on RomM 5.2.0, milestones | First, once |
| [argosy-fork-design-spec.md](argosy-fork-design-spec.md) | The owner's Argosy fork design: palette, type, file-state dot, screens, motion, device rules, prior shader work | Any M4 (UI) or M7 (shader) work |
| [argosy_fork_inventory.md](argosy_fork_inventory.md) | What the owner's Argosy fork does; **Q9 holds the 48-item parity checklist and the 18-item Beyond list** that `source` tags in features.json refer to (PARITY-n, BEYOND-n) | Picking up any PARITY/BEYOND feature |
| [argosy_teardown.md](argosy_teardown.md) | Upstream Argosy's full feature set, architecture, save-sync model, UX patterns | M2 spec work, M4 UX questions |
| [romm_api.md](romm_api.md) | RomM 5.x device sync protocol (negotiate, slots, 409, `optimistic`, hashes), downloads and Range, incremental sync, tokens, Docker test stack and provisioning | M0 Docker work, M2, any client change |
| [armada_integration.md](armada_integration.md) | Steam Game Mode on armadaOS: shortcuts, autostart, gamescope focus, exit and termination, emulator flags and save paths, packaging, Decky, sleep | M1 and M3 |
| [cloud_workflow.md](cloud_workflow.md) | What the cloud session can and cannot do, Routines and Projects, CI on arm64, harness practice; its tester loop is superseded by [ADR 0003](../decisions/0003-autonomous-verification.md) | Changing the harness, CI or automation |
| [fork_candidates.md](fork_candidates.md) | Why RomMix and not ES-DE, OpenGamepadUI, Tender, Pegasus, Grout, Ludo | Only if the base is questioned |
| [ui_stack.md](ui_stack.md) | Stack comparison behind the Godot 4.7 fallback | Only if Gate 1 still fails after the optimisation rounds |

Related reference material elsewhere in the repository:

- [docs/DEVICE-FACTS.md](../DEVICE-FACTS.md): verified facts about the owner's Nova, armadaOS and RomM server, plus what the device bridge relies on.
- [docs/REQUIREMENTS-FROM-TESTER.md](../REQUIREMENTS-FROM-TESTER.md): the owner's 15 requirements (REQ-n in features.json).
- [reference/romm-api/openapi-5.2.0.json](../../reference/romm-api/openapi-5.2.0.json): the OpenAPI spec captured from the owner's RomM 5.2.0 server; use it to answer 5.2.0 API questions.
- [reference/romm-es-prototype/](../../reference/romm-es-prototype/): the superseded ES-DE prototype. Lessons only; do not extend it.

Pinned upstream revisions the notes cite: RomMix studied at `990e55e3855db5ef0c92324283664b71f14fd37d` (fork base v0.20.0 = `ea787b98c32ce6efcd0c0448c0dac5aed074f3af`); Argosy at `2714d5453b6bbef790987071ab0e82068009532b`; armadaOS at `816091ecff7bebf78d4005175a4e5c3e237e91ab`; RomM tags 5.2.0 and 5.3.1.
