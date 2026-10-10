import type {
  RommSyncNegotiatePayload,
  RommSyncOperation,
  RommSyncSave,
  RommSyncScopedNegotiatePayload
} from '@shared/types'
import { log } from './log.ts'
import { negotiatesByGame, RommError, type RommClient } from './romm/index.ts'

/**
 * RomM's own decision for one game, asked the way docs/save-sync/SPEC.md
 * (section 5) and ADR 0002 say to ask it.
 *
 * The server decides, not this file: a save Argosy and this launcher both
 * carry must come out the same way on both, and the only way to be sure of
 * that is to put the same question to the same code. What is decided here is
 * what to tell the server and which of its answers to act on.
 */

/** The three calls the engine makes, so tests can stand in for the server. */
export type NegotiateClient = Pick<RommClient, 'negotiate' | 'completeSyncSession' | 'deviceId'>

export interface GamePlan {
  /** The server's session for this negotiate; see `finishSession`. */
  sessionId: number
  /** Only the game in hand's operations, in the server's order. */
  operations: RommSyncOperation[]
  /** How many operations the server returned for other games and were dropped. */
  dropped: number
}

/**
 * Negotiate before a launch, acting on `romId` alone.
 *
 * A server that scopes by game (`negotiatesByGame`) is sent this game's saves
 * and its id. Any other is sent the whole local inventory, as ADR 0002 asks,
 * and answers for the whole library: a save on the server that this device
 * has never seen comes back as a download whatever the game. Either way every
 * operation for another game is dropped here, because a pre-launch check that
 * moved another game's save would be acting on a question nobody asked.
 *
 * Null when this machine has no RomM device id: negotiate has nothing to
 * pair against without one, and the caller keeps its own comparison.
 */
export async function negotiateForGame(
  client: NegotiateClient,
  romId: number,
  inventory: readonly RommSyncSave[],
  version: string | null | undefined
): Promise<GamePlan | null> {
  const deviceId = await client.deviceId()
  if (!deviceId) {
    log.info('saves', 'no device id, so no negotiate', { romId })
    return null
  }
  const scoped = negotiatesByGame(version)
  const payload: RommSyncNegotiatePayload | RommSyncScopedNegotiatePayload = scoped
    ? { device_id: deviceId, saves: inventory.filter((s) => s.rom_id === romId), rom_ids: [romId] }
    : { device_id: deviceId, saves: [...inventory] }
  const answer = await client.negotiate(payload)
  const operations = answer.operations.filter((op) => op.rom_id === romId)
  const dropped = answer.operations.length - operations.length
  log.info('saves', 'negotiated', {
    romId,
    scoped,
    sent: payload.saves.length,
    sessionId: answer.session_id,
    actions: operations.map((op) => op.action),
    dropped
  })
  return { sessionId: answer.session_id, operations, dropped }
}

export interface SessionCounts {
  completed: number
  failed: number
}

/**
 * Close a negotiate's session with what became of its operations.
 *
 * `superseded` when the server no longer holds the session open: every
 * negotiate cancels the device's open sessions, so a later one (another game's
 * launch, or the device's own reconcile) has already ended it, and RomM
 * refuses to complete it (a 400, or a 404 once it is gone). That session's
 * work is done either way, so it is not an error. Any other failure is thrown:
 * an outage or a refusal may succeed later, and the caller decides when.
 */
export async function finishSession(
  client: NegotiateClient,
  sessionId: number,
  counts: SessionCounts
): Promise<'completed' | 'superseded'> {
  try {
    await client.completeSyncSession(sessionId, {
      operations_completed: counts.completed,
      operations_failed: counts.failed
    })
  } catch (cause) {
    if (cause instanceof RommError && (cause.status === 400 || cause.status === 404)) {
      log.info('saves', 'sync session already ended by a later negotiate', {
        sessionId,
        status: cause.status
      })
      return 'superseded'
    }
    throw cause
  }
  log.info('saves', 'sync session completed', { sessionId, ...counts })
  return 'completed'
}
