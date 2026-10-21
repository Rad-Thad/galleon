/**
 * The core socket's language, and the idle state file beside it. See
 * `parseCoreRequest` and `idleState` in `src/main/core-socket/`.
 *
 * Shared rather than kept in the main process because the socket's other ends
 * are not RomMix's renderer: the Decky panel and the device tests speak it from
 * outside, and a fallback UI would too, so the shapes are the contract and live
 * where the contracts do.
 */

import type { DownloadState } from './downloads.ts'

/**
 * Every command the socket accepts, one per JSON line.
 *
 * A closed list: a line naming anything else is answered `unknown-command`
 * rather than ignored, so a client built against a newer Galleon learns that
 * this one cannot do it instead of waiting for an answer that never comes.
 */
export const CORE_COMMANDS = [
  /** What is running, downloading and waiting to upload. */
  'status',
  /** Stop the running emulator the way holding Start does. */
  'quit-emulator',
  'pause-downloads',
  'resume-downloads',
  /** Quit Galleon, only while it is idle. See `QuitRefusal`. */
  'quit-app'
] as const
export type CoreCommand = (typeof CORE_COMMANDS)[number]

/**
 * A client's correlation id, echoed on the answer.
 *
 * Optional, because a client that sends one line and reads one line back does
 * not need it; a panel that polls `status` while it asks for a quit does.
 */
export type CoreRequestId = string | number

export interface CoreRequest {
  id?: CoreRequestId
  cmd: CoreCommand
}

/** Why a line was not a request Galleon could answer. */
export type CoreRequestError =
  /** Not JSON, or JSON that is not an object with a string `cmd`. */
  | 'malformed'
  /** Longer than `MAX_LINE_BYTES`. */
  | 'too-long'
  /** A `cmd` this Galleon does not know. */
  | 'unknown-command'
  /** A request it understood and could not carry out. */
  | 'failed'

/**
 * Why Galleon will not quit when asked.
 *
 * In priority order, the first that holds is the answer: a game being played
 * is the reason a person would give, and the one a client most needs to hear.
 */
export type QuitRefusal = 'game-running' | 'downloading' | 'upload-pending'

export type CoreResponse<T = unknown> =
  | { id?: CoreRequestId; ok: true; result: T }
  | { id?: CoreRequestId; ok: false; error: CoreRequestError | QuitRefusal }

/**
 * `$XDG_RUNTIME_DIR/galleon/state.json`, schema 1.
 *
 * Read by the device bridge to tell an idle Galleon from someone playing, so
 * its fields are a promise to a program on the device that updates on its own
 * schedule: add fields freely, never change what these three mean without a
 * new `schema`.
 */
export interface IdleStateFile {
  schema: 1
  /** True only while no game runs, no download is active and no upload waits. */
  idle: boolean
  /** The Steam app id Galleon was started under, or null outside Steam. */
  steamAppId: string | null
  /**
   * ISO 8601, for people and clients reading the file. The bridge judges
   * freshness by the file's mtime, not by this.
   */
  updatedAt: string
}

/** One row of the download queue, as `status` reports it. */
export interface CoreDownload {
  romId: number
  name: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
}

/**
 * The answer to `status`: what a panel needs to say what Galleon is doing.
 *
 * Its own shape rather than the renderer's, so the panel can be written against
 * a contract that does not move every time a screen wants one more field.
 */
export interface CoreStatus {
  /** Whether RomM answered the last time Galleon asked. */
  connected: boolean
  /** The game being played, or null. */
  playing: { romId: number } | null
  /** Rows still in the queue, stopped ones included. Finished rows are not. */
  downloads: CoreDownload[]
  /** Games whose saves are on this disk and not yet on RomM. */
  pendingUploads: number[]
  /** The same rule as the state file and `quit-app`. */
  idle: boolean
  /** Why it is not idle, or null when it is. */
  busy: QuitRefusal | null
}

/** The answer to `quit-emulator`: whether there was anything to ask to quit. */
export interface CoreQuitEmulatorResult {
  stopping: boolean
}

/** The answer to `pause-downloads`: how many transfers were paused. */
export interface CorePauseResult {
  paused: number
}

/** The answer to `resume-downloads`: how many paused transfers were started again. */
export interface CoreResumeResult {
  resumed: number
}
