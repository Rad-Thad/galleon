# 0009: The RomM token is kept in an owner-only file, never in the keyring

- Status: **Accepted** (2026-10-28).
- Deciders: the agent.
- Settles: M1-24's choice between one credential backend and a keyring with a fallback copy.

## Context

RomMix encrypts `credentials.bin` with Electron's `safeStorage` when a keyring is reachable, and writes it as plain text (`RAW1`) when not. On armadaOS the same user runs Galleon in two sessions: Desktop Mode, where KWallet may answer, and Game Mode, where no keyring is reachable (DEVICE-FACTS.md). A token written encrypted in Desktop Mode cannot be opened in Game Mode, so the player is signed out there and has to pair again.

M1-24 allows either one backend used consistently or a keyring with a `0600` fallback copy. A fallback copy has to be plain text to be readable in Game Mode, so it holds the same secret with the same protection as the file alone. The keyring would add a second copy and nothing else.

## Decision

Galleon writes the token only to `config/credentials.bin` as `RAW1`, mode `0600`, in a folder of mode `0700`. Both modes are put back at every start when something loosened them (`holdMode` in `src/main/store.ts`).

- A file an earlier build wrote encrypted (`ENC1`) is still opened when this session has the keyring, and is rewritten as `RAW1` at once, so the next Game Mode start can read it.
- An `ENC1` file opened in a session without the keyring cannot be read. That is logged, and the player pairs again; nothing can recover it.

## Consequences

- The token is protected by file permissions only. Anyone who can act as the player's user, or as root, can read it. Settings and the README say so, and say how to revoke it in RomM.
- Settings names one place for the token: "in a file only your user can read".
- Revisit if armadaOS's Game Mode gains a keyring that Desktop Mode shares.
