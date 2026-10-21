# 0006: The core socket learns its peer's user through the system Python

- Status: **Accepted** (2026-10-21).
- Deciders: the agent, within M1-17's acceptance (no owner question: nothing is bundled, bought or changed on a server).
- Settles: how M1-17's "SO_PEERCRED check" is made from an Electron main process.

## Context

M1-17 asks the core socket to refuse connections from other users by its file mode **and** an SO_PEERCRED check. The modes are in place (socket 0600, folder 0700). SO_PEERCRED is read with `getsockopt` on the accepted socket, and Node exposes no `getsockopt`, nor any other way to learn a Unix socket peer's credentials.

The ways to reach it:

1. **A native addon** (a C++ module or a prebuilt `.node` per architecture). It is a new runtime dependency, needs a toolchain or two prebuilt binaries in the arm64 and x64 builds, and has to follow every Electron ABI change.
2. **A helper binary** built from a few lines of C. The same build problem, for a file Galleon would carry for this one call.
3. **`ss -xp` or netlink sock_diag.** `ss` is not guaranteed on the device and reports peers by process, not by the connection in hand; Node cannot open a netlink socket.
4. **Lend the accepted socket to the system Python**, which has `socket.getsockopt(SOL_SOCKET, SO_PEERCRED)` in its standard library. Node's `spawn` can pass a socket as one of the child's descriptors. The Nova runs Python 3 ([DEVICE-FACTS.md](../DEVICE-FACTS.md)) and the device bridge already depends on it ([ADR 0003](0003-autonomous-verification.md)); every CI runner and the cloud VM have it.

## Decision

Option 4 (`src/main/core-socket/peercred.ts`).

- Each accepted connection is paused, and the socket is passed to `python3 -I -S` as a descriptor. The script reads SO_PEERCRED, prints the user id, and detaches from the descriptor without closing the connection.
- The connection is served only if that id is the user Galleon runs as. Any other id (root included), no answer, a failing or hanging helper (`PEER_CHECK_TIMEOUT_MS`), or no Python at all closes it unanswered, before any of its bytes are read. The check fails closed.
- The helper gets the same cleaned environment as an emulator (`childEnvironment`), so the AppImage's library path never reaches it, and `-I -S` keeps user site packages, `PYTHON*` variables and the current folder off its import path.
- Python is a system program Galleon calls, not something it ships. Nothing is added to the AppImage or `package.json`, so `docs/DEPENDENCIES.md` is unchanged.

## Consequences

- A connection costs one short process start before its first answer. The socket's clients (the Decky panel, the device tests) connect rarely and keep the connection for several requests, so this is not on any path the player waits on.
- On a system without `python3` the socket refuses everyone. Galleon itself carries on; only the socket's clients lose it. The Nova, CI and the VM all have Python, and the unit tests run the real helper over a real socket.
- If a later Node or Electron offers peer credentials directly, `peerUid` is the one place to change, and this ADR is superseded.
