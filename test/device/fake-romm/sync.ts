/**
 * RomM 5.2.0's sync sessions, as the fake server on the device keeps them
 * (M2-20): the session a negotiate opens, its completion, and the play that
 * rides that completion (docs/save-sync/SPEC.md section 5).
 *
 * The engine counts a session a later negotiate ended as finished
 * (`finishSession`), so the fake has to end it the same way, and refuse its
 * completion the same way, for a device check to see what the Nova will see
 * against a real server. `test/saves/contract.ts` holds both to that.
 */

type Status = 'in_progress' | 'completed' | 'cancelled'

interface Session {
  id: number
  device_id: string
  user_id: number
  status: Status
  initiated_at: string
  completed_at: string | null
  operations_planned: number
  operations_completed: number
  operations_failed: number
  error_message: null
  created_at: string
  updated_at: string
}

/** One span of play inside a completion (`SyncPlaySessionEntry`). */
export interface PlayEntry {
  rom_id?: number | null
  save_slot?: string | null
  start_time: string
  end_time: string
  duration_ms: number
}

export interface Completion {
  operations_completed?: number
  operations_failed?: number
  play_sessions?: PlayEntry[] | null
}

interface IngestResult {
  index: number
  status: 'created' | 'duplicate' | 'error'
  id?: number
  detail?: string
}

export type CompleteResult =
  | {
      status: 200
      body: {
        session: Session
        play_session_ingest: {
          results: IngestResult[]
          created_count: number
          skipped_count: number
        } | null
      }
    }
  | { status: 400 | 404 | 422; detail: string }

/** RomM drops the fraction of a second from a span's times before it keeps them. */
function toSecond(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000) * 1000
}

/** How far ahead of the server's clock a span may end before RomM refuses it. */
const FUTURE_MS = 5 * 60_000

export class SyncSessions {
  private readonly sessions = new Map<number, Session>()
  /** Device, game and start of every span taken, which RomM keeps once. */
  private readonly played = new Set<string>()
  private nextSession = 1
  private nextPlay = 1
  private readonly userId: number
  private readonly romIds: ReadonlySet<number>
  private readonly now: () => Date

  constructor(userId: number, romIds: ReadonlySet<number>, now: () => Date = () => new Date()) {
    this.userId = userId
    this.romIds = romIds
    this.now = now
  }

  /** A negotiate's session: every one the device still had open ends here. */
  open(deviceId: string, planned: number): number {
    const at = this.now().toISOString()
    for (const session of this.sessions.values()) {
      if (session.device_id === deviceId && session.status === 'in_progress') {
        Object.assign(session, { status: 'cancelled', updated_at: at })
      }
    }
    const id = this.nextSession++
    this.sessions.set(id, {
      id,
      device_id: deviceId,
      user_id: this.userId,
      status: 'in_progress',
      initiated_at: at,
      completed_at: null,
      operations_planned: planned,
      operations_completed: 0,
      operations_failed: 0,
      error_message: null,
      created_at: at,
      updated_at: at
    })
    return id
  }

  /**
   * `POST /api/sync/sessions/{id}/complete`. A session that has ended, by
   * completion or by a later negotiate, is a 400; one that never was, a 404.
   * A span ending before it starts fails the whole request, as RomM's
   * validation does, but one ending too far ahead fails only itself.
   */
  complete(id: number, completion: Completion): CompleteResult {
    const session = this.sessions.get(id)
    if (!session) return { status: 404, detail: `Sync session ${id} not found` }
    if (session.status !== 'in_progress') {
      return { status: 400, detail: `Session is already ${session.status}` }
    }
    const entries = completion.play_sessions ?? []
    for (const entry of entries) {
      if (entry.duration_ms < 0 || toSecond(entry.end_time) <= toSecond(entry.start_time)) {
        return { status: 422, detail: 'end_time must be after start_time' }
      }
    }

    const at = this.now()
    Object.assign(session, {
      status: 'completed',
      completed_at: at.toISOString(),
      updated_at: at.toISOString(),
      operations_completed: completion.operations_completed ?? 0,
      operations_failed: completion.operations_failed ?? 0
    })
    if (entries.length === 0) {
      return { status: 200, body: { session, play_session_ingest: null } }
    }

    const results: IngestResult[] = []
    const created: IngestResult[] = []
    entries.forEach((entry, index) => {
      if (Date.parse(entry.end_time) > at.getTime() + FUTURE_MS) {
        results.push({ index, status: 'error', detail: 'end_time is too far in the future' })
        return
      }
      const romId = entry.rom_id != null && this.romIds.has(entry.rom_id) ? entry.rom_id : null
      const key = `${session.device_id}\u0000${romId}\u0000${toSecond(entry.start_time)}`
      if (this.played.has(key)) {
        results.push({ index, status: 'duplicate' })
        return
      }
      this.played.add(key)
      created.push({ index, status: 'created', id: this.nextPlay++ })
    })
    // RomM lists the spans it refused before the ones it took.
    results.push(...created)
    return {
      status: 200,
      body: {
        session,
        play_session_ingest: {
          results,
          created_count: created.length,
          skipped_count: entries.length - created.length
        }
      }
    }
  }
}
