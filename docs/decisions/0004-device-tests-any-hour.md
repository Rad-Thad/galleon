# 0004: Device tests at any hour, on a build published after every merge

- Status: **Accepted** (2026-10-08).
- Deciders: the owner ([issue #5](https://github.com/Rad-Thad/galleon/issues/5)).
- Amends: [ADR 0003](0003-autonomous-verification.md) (decision 1, the night window).

## Context

ADR 0003 let the bridge test only inside a night window, on a build published once a night. A device feature then waited up to a day for its first result, and longer whenever the Nova was off its charger that night. The owner keeps the Nova plugged in most of the day and asked for feedback within about an hour of a merge.

## Decision

1. **Any hour.** The bridge on the Nova runs with `WINDOW=00:00-00:00`, which the bridge reads as the whole day (a unit test pins it). Every other precondition is unchanged: Game Mode, on the charger above the battery floor, nothing playing, enough space, a commit not yet tested.
2. **A device-testable build after every merge.** Each push to `main` refreshes the rolling `nightly` pre-release with the same tag and asset names, so the bridge needs no configuration change. The publish is a step of the existing `release.yml` pipeline under the `nightly` concurrency group, not a new required check. The scheduled `nightly.yml` still runs the heavy suites. Both land with M0-24.
3. **The safety rules do not change.** Any button press aborts a run, nothing writes to the owner's server, sound is muted, and the owner-state manifest is checked before and after every run.

## Consequences

- A merged device feature usually has results within about an hour while the Nova is idle on its charger.
- The Nova may show a test run during the day. It starts only when nobody is playing, and any button hands the device back.
- The bridge's built-in default window stays as it was; only the Nova's own config changes, so no bridge release is needed.
- A per-merge build has passed the pull-request checks but not yet the heavy nightly suites. A red nightly is still treated like a red required check.
