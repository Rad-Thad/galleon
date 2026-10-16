/**
 * Whether Galleon is idle, and the file that says so to the device bridge.
 *
 * The bridge tests nightlies on the owner's Nova and must never take the screen
 * from someone playing. Process lists cannot tell an idle Galleon from one with
 * a game paused behind it, so Galleon says so itself, in a file the bridge can
 * read without connecting to anything (`galleon_idle_state` in
 * `tools/device-bridge/`). The same rule decides whether `quit-app` is obeyed,
 * so the bridge and the socket can never disagree about what idle means.
 */

import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IdleStateFile, QuitRefusal } from '@shared/types'

/** What the idle rule reads, gathered by the main process. */
export interface ActivitySnapshot {
  gameRunning: boolean
  /** Downloads transferring or finishing (checking, extracting, installing). */
  activeDownloads: number
  /** Saves written locally and not yet on the server. */
  pendingUploads: number
}

/**
 * Why Galleon is not idle, or null when it is. See `QuitRefusal` for the order.
 *
 * A pending upload counts even though nothing is happening on screen: quitting
 * then strands a save on the device, and a player who picks up the same game
 * elsewhere meets the older one.
 */
export function busyReason(activity: ActivitySnapshot): QuitRefusal | null {
  if (activity.gameRunning) return 'game-running'
  if (activity.activeDownloads > 0) return 'downloading'
  if (activity.pendingUploads > 0) return 'upload-pending'
  return null
}

export function idleState(
  activity: ActivitySnapshot,
  steamAppId: string | null,
  now: Date
): IdleStateFile {
  return {
    schema: 1,
    idle: busyReason(activity) === null,
    steamAppId,
    updatedAt: now.toISOString()
  }
}

// The folder under $XDG_RUNTIME_DIR that holds the socket and the state file.
// Fixed, because the bridge and the Decky panel find them by this name.
const RUNTIME_DIR_NAME = 'galleon'

/**
 * Galleon's folder under the session's runtime directory, or null without one.
 *
 * No fallback to /tmp: the runtime directory is the user's own, mode 0700 and
 * emptied at logout, and a shared folder would let another user plant a state
 * file that says the owner's Galleon is idle.
 */
export function runtimeDir(env: NodeJS.ProcessEnv): string | null {
  const base = env.XDG_RUNTIME_DIR
  if (!base || !base.startsWith('/')) return null
  return join(base, RUNTIME_DIR_NAME)
}

/**
 * Write the state file whole, readable only by its owner.
 *
 * Through a rename so the bridge never reads half a file, which it would take
 * as "not idle" at best and as a parse error at worst. The modes are set
 * again on every write because `mode` only applies to what is created, and a
 * folder or temporary file left by anyone else keeps whatever it had.
 */
export function writeIdleState(dir: string, state: IdleStateFile): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = join(dir, 'state.json')
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}
