# Upstream

Galleon is a hard fork of RomMix ([ADR 0001](decisions/0001-fork-rommix.md)). This file records what the fork is based on and how changes from upstream are brought in. The upstream watch (M0-19) reads the base commit from the table below.

## Repository and base

| What                  | Value                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| Upstream repository   | [leclercb/rommix](https://github.com/leclercb/rommix) (MIT, by Benjamin Leclerc) |
| Base                  | `v0.20.0`, commit `ea787b98c32ce6efcd0c0448c0dac5aed074f3af`                     |
| Studied for the plan  | `990e55e3855db5ef0c92324283664b71f14fd37d` (upstream `main` on 2026-10-08)       |
| Ported since the base | none yet                                                                         |

**Why v0.20.0 and not the studied commit.** v0.20.0 is what the tester ran in Phase 0, and its CI was green. Upstream's `main` at `990e55e` fails `npm run test:app` on both architectures after 68697e0 and 990e55e, which change how controllers are listed. Those two commits are worth having (M3-08) once their `test:app` failure is fixed, upstream or by the fork (rule 3 below).

## Pulling upstream changes

Upstream changes are ported one at a time, never merged wholesale:

1. **Ported deliberately, by pull request.** Each upstream change Galleon wants is brought over on a `claude/*` branch and goes through the definition of done like any other change: green CI, the evaluator, a PROGRESS.md entry. Upstream's `main` is never merged or rebased onto, because the fork's history and layout diverge on purpose (the rebrand, the device harness, the save engine).
2. **Credited in the commit.** A ported change keeps upstream's author and adds an `Upstream: leclercb/rommix@<sha>` trailer, so the origin of each line stays traceable. It is added to the "Ported since the base" row above.
3. **Only what is needed, and only when green upstream.** A change is ported for a reason a feature or a bug names. An upstream commit whose own CI is red is not ported until upstream has fixed it, or until the fork's own fix exists and is tested.
4. **Cheap to port.** Internal names stay as upstream has them (`RomMixApp`, the `ROMMIX_*` variables apart from the home override, M0-04), so upstream patches still apply.
5. **Nothing goes back without asking.** Sending patches to upstream is a `needs-human` decision (M6-14); the safe default is not to.

The weekly upstream watch (M0-19, `.github/workflows/upstream.yml` running `scripts/agent/upstream.mjs`) opens or updates one issue, `upstream: N new commits` (label `upstream`), listing upstream commits since the base. Reading that list is how ports are found; the list itself changes nothing.
