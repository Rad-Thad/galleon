# 0008: Homebrew we build ourselves is kept in the repository

- Status: **Accepted** (2026-10-25).
- Deciders: the agent.
- Settles: where a test payload comes from when no redistributable homebrew exists for a system.

## Context

Device checks start each emulator with a homebrew payload (M0-07). Until now every payload was someone else's program, fetched from a pinned URL and never committed. For PS2 (M1-03's `launch.armsx2`) no prebuilt homebrew under a licence we may redistribute turned up.

## Decision

Where no such homebrew exists, we write the smallest program that shows a frame, under the repository's MIT licence, in `test/fixtures/homebrew/<name>/` with a script that builds it in a toolchain image pinned by digest, with the dates on the file fixed. The built file is committed beside its source, and `test/fixtures/roms/manifest.json` pins it by its `raw.githubusercontent.com` URL at the `main` commit that added it, with its SHA-256, licence and attribution, like any other payload. `scripts/agent/fetch-fixtures.mjs` and the device bundle need no second way to find a payload.

- The libraries linked into it are named in THIRD_PARTY.md's "Test payloads" part with their licences. None of it goes in the AppImage.
- A rebuild that gives other bytes is a change to the payload: commit it, and pin the new commit and hash.

## Consequences

- A payload lands in two pull requests: the source and its build, then the manifest entry naming the merged commit.
- The repository carries a small binary per such payload.
