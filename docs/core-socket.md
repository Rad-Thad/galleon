# The core socket

Galleon's main process listens on a local socket that other programs on the device use to ask what it is doing and to ask it to do a few things. The Decky panel, the device tests and any fallback UI talk to it. It is feature M1-17.

The types are in `src/shared/types/coresocket.ts`. The code is in `src/main/core-socket/`.

## Where it is

- Socket: `$XDG_RUNTIME_DIR/galleon/core.sock`, mode 0600.
- State file: `$XDG_RUNTIME_DIR/galleon/state.json`, mode 0600.
- The `galleon` folder is mode 0700.

Without an absolute `XDG_RUNTIME_DIR`, Galleon starts neither. It never falls back to a shared folder such as `/tmp`.

Both files are removed when Galleon quits, after its shutdown has finished. A socket file left by a Galleon that crashed is replaced at the next start only if nothing is listening on it. If another Galleon is listening (a second instance with a different home), the new one starts no socket and writes no state file.

A self-test run never starts either one, so a test instance can never answer for the owner's Galleon.

## Protocol

One JSON object per line, in both directions, UTF-8, ended by `\n` (a `\r` before it is ignored, and blank lines are skipped). A client may send several requests on one connection. Answers come back in the order the requests were sent.

Request:

```json
{ "id": 1, "cmd": "status" }
```

- `cmd` (string, required): one of the commands below.
- `id` (string or finite number, optional): echoed on the answer.

Answer:

```json
{ "id": 1, "ok": true, "result": { } }
{ "id": 2, "ok": false, "error": "game-running" }
```

### Errors

| `error`           | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `malformed`       | Not JSON, not an object, no string `cmd`, or an `id` of the wrong type. |
| `too-long`        | The line is longer than `MAX_LINE_BYTES` (see `protocol.ts`).           |
| `unknown-command` | A `cmd` this Galleon does not know.                                     |
| `failed`          | Understood, but it could not be carried out.                            |
| `game-running`    | `quit-app` refused: a game is being played.                             |
| `downloading`     | `quit-app` refused: a download is in progress.                          |
| `upload-pending`  | `quit-app` refused: saves on this device are not yet on the server.     |

A complete line that is too long is answered `too-long` and the connection stays open. Bytes with no newline that pass the limit are answered `too-long` and the connection is closed.

### Commands

`status`: what Galleon is doing.

```json
{
  "connected": true,
  "playing": { "romId": 12 },
  "downloads": [
    { "romId": 7, "name": "Game", "state": "downloading", "receivedBytes": 10, "totalBytes": 100 }
  ],
  "pendingUploads": [3],
  "idle": false,
  "busy": "game-running"
}
```

- `downloads` lists rows still in the queue, including paused and stalled ones. Finished, failed and cancelled rows are left out.
- `pendingUploads` lists the games whose saves have not reached the server. It is empty when sending saves up is switched off.
- `idle` and `busy` follow the rule below.

`quit-app`: quit Galleon, only when it is idle. The answer is `{ "quitting": true }`, and Galleon then quits normally. Otherwise it is refused with the `busy` reason.

`quit-emulator`: ask the running game's emulator (or an emulator opened on its own) to quit, through the same path as holding Start or the close button on the running screen (`Launcher.stop`). It is never forced, because an emulator writes its save as it closes. The answer is `{ "stopping": true }`, or `{ "stopping": false }` when nothing was running. The session then ends as it does after any other stop: saves are sent up and RomM is told the game stopped. Poll `status` to see `playing` turn `null`.

`pause-downloads`: pause every transfer that is queued or downloading, as the pause button on the Downloads screen does, keeping what has arrived. The answer is `{ "paused": n }`.

`resume-downloads`: start every paused transfer again, in the order they were in, behind anything already queued. Stalled transfers (stopped by the network) are left to Galleon, which resumes them when the server answers again. The answer is `{ "resumed": n }`; a game the server no longer answers for stays paused and is not counted.

## Idle

Galleon is idle only when no game is running, no download is in progress (queued, downloading, checking, extracting or installing) and no save upload is pending. When more than one is true, the reason given is the first in that order. `status`, `quit-app` and the state file all use the same rule (`busyReason` in `idlestate.ts`).

## State file

```json
{ "schema": 1, "idle": true, "steamAppId": "3456789012", "updatedAt": "2026-10-16T07:00:00.000Z" }
```

- `idle`: the rule above.
- `steamAppId`: the id Steam started Galleon under (`STEAM_COMPAT_APP_ID`, then `SteamAppId`, then `SteamGameId`), or `null` outside Steam.
- `updatedAt`: when it was written.

The file is written whole (through a rename) when Galleon starts, again whenever a download change flips `idle`, and again on a timer (`STATE_REFRESH_MS` in `service.ts`) so its age shows that Galleon is still running. The device bridge (`galleon_idle_state` in `tools/device-bridge/`) reads it to tell an idle Galleon from someone playing, and judges freshness by the file's modification time. New fields may be added; the meaning of these three changes only with a new `schema`.
