/**
 * The core socket as the main process runs it: what each command does, and the
 * state file kept beside it.
 *
 * Everything is read through one `observe`, so `status`, `quit-app` and the
 * state file answer from the same picture and cannot disagree about whether
 * Galleon is idle. See `busyReason` for the rule itself.
 */

import { isInProgress, type CoreDownload, type CoreStatus, type QuitRefusal } from '@shared/types'
import { log } from '../log.ts'
import {
  busyReason,
  idleState,
  removeIdleState,
  runtimeDir,
  writeIdleState,
  type ActivitySnapshot
} from './idlestate.ts'
import { startCoreSocket, type CoreHandler } from './server.ts'

/** What the main process can see, gathered fresh for every answer. */
export interface CoreObservation {
  connected: boolean
  /** The game being played, by RomM id, or null. */
  playing: number | null
  downloads: CoreDownload[]
  /** Games whose saves are waiting to go up. */
  pendingUploads: number[]
}

export function activityOf(observed: CoreObservation): ActivitySnapshot {
  return {
    gameRunning: observed.playing !== null,
    activeDownloads: observed.downloads.filter((row) => isInProgress(row.state)).length,
    pendingUploads: observed.pendingUploads.length
  }
}

export function coreStatus(observed: CoreObservation): CoreStatus {
  const busy = busyReason(activityOf(observed))
  return {
    connected: observed.connected,
    playing: observed.playing === null ? null : { romId: observed.playing },
    downloads: observed.downloads,
    pendingUploads: observed.pendingUploads,
    idle: busy === null,
    busy
  }
}

export interface CoreHandlerDeps {
  observe: () => CoreObservation
  /** Start quitting Galleon. Called only once the answer has been given. */
  quitApp: () => void
}

/**
 * Answer every command the socket knows.
 *
 * `quit-app` is refused with the reason whenever Galleon is not idle: the
 * device tests ask it to hand the screen over, and a game, a transfer or a save
 * still on its way up is never theirs to end. The quit itself waits a turn so
 * the client hears yes before the socket closes under it.
 *
 * The emulator and the queue are not reachable from here yet, so their
 * commands are answered `failed` rather than pretended.
 */
export function coreHandler(deps: CoreHandlerDeps): CoreHandler {
  return (request) => {
    switch (request.cmd) {
      case 'status':
        return { ok: true, result: coreStatus(deps.observe()) }
      case 'quit-app': {
        const busy: QuitRefusal | null = busyReason(activityOf(deps.observe()))
        if (busy) return { ok: false, error: busy }
        setImmediate(deps.quitApp)
        return { ok: true, result: { quitting: true } }
      }
      case 'quit-emulator':
      case 'pause-downloads':
      case 'resume-downloads':
        return { ok: false, error: 'failed' }
    }
  }
}

/**
 * How often the state file is written again while nothing changes.
 *
 * The bridge judges the file by its age, so a quiet Galleon has to keep
 * touching it; well inside the bridge's limit so a slow tick is not read as a
 * Galleon that has gone.
 */
export const STATE_REFRESH_MS = 10_000

/** The id Steam started Galleon under, in the order armada's launcher reads them. */
export function steamAppIdOf(env: NodeJS.ProcessEnv): string | null {
  return env.STEAM_COMPAT_APP_ID || env.SteamAppId || env.SteamGameId || null
}

export interface CoreService {
  /** Write the state file now if whether Galleon is idle has changed. */
  refresh: () => void
  /** Stop the socket and the refresh, and remove both files. */
  close: () => Promise<void>
}

export interface CoreServiceOptions extends CoreHandlerDeps {
  env: NodeJS.ProcessEnv
  now?: () => Date
}

/**
 * Start the socket and the state file, or return null without a runtime
 * directory to put them in.
 *
 * The socket first: a second Galleon in the same session (another home, so the
 * single-instance lock does not catch it) finds the socket taken and gives up
 * before it can overwrite the first one's state file. That case throws
 * `CoreSocketInUseError`.
 */
export async function startCoreService(options: CoreServiceOptions): Promise<CoreService | null> {
  const dir = runtimeDir(options.env)
  if (!dir) return null
  const now = options.now ?? (() => new Date())
  const steamAppId = steamAppIdOf(options.env)
  const socket = await startCoreSocket(dir, coreHandler(options))

  let lastIdle: boolean | null = null
  // A download can finish after the close, and a file written then would say
  // idle about a Galleon that is no longer there to be asked to quit.
  let closed = false
  const write = (): void => {
    if (closed) return
    try {
      const state = idleState(activityOf(options.observe()), steamAppId, now())
      writeIdleState(dir, state)
      lastIdle = state.idle
    } catch (cause) {
      // The next tick tries again; until then the file ages, and an old file
      // is one the bridge already reads as not idle.
      log.warn('core', 'could not write the idle state file', {
        reason: (cause as Error).message
      })
    }
  }
  write()
  const timer = setInterval(write, STATE_REFRESH_MS)
  timer.unref()

  return {
    refresh: () => {
      const idle = busyReason(activityOf(options.observe())) === null
      if (idle !== lastIdle) write()
    },
    close: async () => {
      closed = true
      clearInterval(timer)
      await socket.close()
      removeIdleState(dir)
    }
  }
}
