import type {
  RommSyncCompletePayload,
  RommSyncCompleteResponse,
  RommSyncNegotiatePayload,
  RommSyncOperation,
  RommSyncSave,
  RommSyncScopedNegotiatePayload
} from '@shared/types'
import { log } from './log.ts'
import { MIN_PLAY_SECONDS, negotiatesByGame, RommError, type RommClient } from './romm/index.ts'

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

/** A span somebody played one game for, while the session was open. */
export interface PlayedSpan {
  romId: number
  startedAt: Date
  endedAt: Date
}

/**
 * Close a negotiate's session with what became of its operations, and the
 * play recorded while it was open.
 *
 * The play rides the completion, as Argosy sends it, so RomM files it under
 * the session's own device. Spans shorter than `MIN_PLAY_SECONDS` are left
 * out rather than sent: RomM refuses the whole completion over one span it
 * rounds to nothing, and the session would then never close.
 *
 * `superseded` when the server no longer holds the session open: before RomM
 * 5.4 every negotiate cancels the device's open sessions, so a later one
 * (another game's launch, or the device's own reconcile) has already ended it,
 * and RomM refuses to complete it (a 400, or a 404 once it is gone). From 5.4
 * an earlier session stays open and completes like any other. That session's
 * work is done either way, so it is not an error; but none of its play was
 * taken, and the caller sends that through `POST /api/play-sessions` instead.
 * Sending a span twice is harmless: RomM keeps one per device, game and start.
 * Any other failure is thrown: an outage or a refusal may succeed later, and
 * the caller decides when.
 */
export async function finishSession(
  client: NegotiateClient,
  sessionId: number,
  counts: SessionCounts,
  played: readonly PlayedSpan[] = []
): Promise<'completed' | 'superseded'> {
  const spans = played.filter(
    (span) => span.endedAt.getTime() - span.startedAt.getTime() >= MIN_PLAY_SECONDS * 1000
  )
  const payload: RommSyncCompletePayload = {
    operations_completed: counts.completed,
    operations_failed: counts.failed
  }
  if (spans.length > 0) {
    payload.play_sessions = spans.map((span) => ({
      rom_id: span.romId,
      start_time: span.startedAt.toISOString(),
      end_time: span.endedAt.toISOString(),
      duration_ms: span.endedAt.getTime() - span.startedAt.getTime()
    }))
  }
  let answer: RommSyncCompleteResponse
  try {
    answer = await client.completeSyncSession(sessionId, payload)
  } catch (cause) {
    if (cause instanceof RommError && (cause.status === 400 || cause.status === 404)) {
      log.info('saves', 'sync session already ended by a later negotiate', {
        sessionId,
        status: cause.status,
        playNotTaken: spans.length
      })
      return 'superseded'
    }
    throw cause
  }
  const ingest = answer.play_session_ingest
  log.info('saves', 'sync session completed', {
    sessionId,
    ...counts,
    played: spans.length,
    dropped: played.length - spans.length,
    created: ingest?.created_count ?? 0,
    skipped: ingest?.skipped_count ?? 0
  })
  // A span RomM would not take is lost to the history, not to the session,
  // so it is said rather than thrown.
  for (const result of ingest?.results ?? []) {
    if (result.status !== 'error') continue
    log.warn('saves', 'RomM did not take a play session', {
      sessionId,
      romId: spans[result.index]?.romId,
      detail: result.detail
    })
  }
  return 'completed'
}
