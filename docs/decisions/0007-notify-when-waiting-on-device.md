# 0007: The owner hears when the work waits on the device

- Status: **Accepted** (2026-10-25).
- Deciders: the owner, in a session on 2026-10-25.
- Amends: [ADR 0003](0003-autonomous-verification.md), whose only contact with the owner was the acceptance invitation.
- Settles: whether the agent tells the owner when nothing can move without the Nova.

## Context

The agent runs unattended and stops with "nothing eligible" whenever everything left waits on device results: a feature needing a passing nightly, features depending on it, Gate 1. Until now the owner heard nothing until the acceptance invitation (M8-07), so a bridge that stopped running on the Nova went unnoticed for days.

## Decision

When a run stops because no progress can be made without the device, it sends the owner one push notification (the routine's notification tool) saying what waits on the device, what the bridge last reported and when it was last seen.

- It is sent once per reason: what waits and the bridge's skip reason, not the last-seen time. A heartbeat that stops for the same reason as the last notification sends nothing; a new reason (another feature waiting, a new bridge skip reason, the bridge going silent) sends one again.
- It is a status report, not a request: it never asks the owner to test, run a command or file anything, and it carries no server address, token or account detail.
- The `PROGRESS.md` stop line records that it was sent (`Notified: ...`), so the next run can tell whether the reason changed.
