import type { RommPlaySessionEntry } from '@shared/types'
import { log } from './log.ts'
import { MIN_PLAY_SECONDS, type RommClient } from './romm/index.ts'
import type { Store, UnsentPlay } from './store.ts'

/**
 * The most spans one `POST /api/play-sessions` carries.
 *
 * RomM refuses a longer list outright (`MAX_BATCH_SIZE` in its
 * `endpoints/play_sessions.py`), so a device that was away for weeks
 * sends its backlog in turns instead.
 */
export const PLAY_BATCH = 100

/**
 * Play time, reported to RomM so PLAYED is one total across every device.
 *
 * Every span is written down before it is sent and forgotten only once RomM
 * has answered for it, so a session played away from the network, or ended
 * while the server was down, goes up at the next catch-up rather than being
 * lost. Sending a span again is harmless: RomM keeps one per device, game and
 * start, and answers the rest as duplicates.
 */
export class PlayReporter {
  /** The send in progress, so a second trigger joins it. */
  private sending: Promise<void> | null = null

  constructor(
    private readonly store: Store,
    private readonly client: Pick<RommClient, 'sendPlaySessions'>
  ) {}

  /**
   * One launch's session: kept, then sent with whatever else is waiting.
   *
   * Never throws; a session that ended cannot be un-ended because the server
   * did not pick up.
   */
  async record(romId: number, startedAt: Date, endedAt: Date): Promise<void> {
    const seconds = (endedAt.getTime() - startedAt.getTime()) / 1000
    if (!(seconds >= MIN_PLAY_SECONDS)) {
      log.debug('play', 'session too short to report', { romId, seconds })
      return
    }
    try {
      this.store.notePlay({
        romId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString()
      })
    } catch (cause) {
      log.warn('play', 'could not keep the session to report', {
        romId,
        reason: (cause as Error).message
      })
      return
    }
    await this.send()
  }

  /**
   * Send everything waiting, a batch at a time, oldest first.
   *
   * Stops at the first batch RomM does not take and keeps it and everything
   * after it: an outage now says nothing about whether the next try will work,
   * and the order the history is filled in is the order it was played.
   */
  send(): Promise<void> {
    this.sending ??= this.drain().finally(() => {
      this.sending = null
    })
    return this.sending
  }

  private async drain(): Promise<void> {
    for (;;) {
      const batch = this.store.unsentPlay.slice(0, PLAY_BATCH)
      if (batch.length === 0) return
      try {
        await this.client.sendPlaySessions(batch.map(entryOf))
      } catch (cause) {
        log.info('play', 'play sessions are waiting for the server', {
          waiting: this.store.unsentPlay.length,
          reason: (cause as Error).message
        })
        return
      }
      this.store.forgetPlay(batch)
      log.info('play', 'play sessions reported', { sent: batch.length })
    }
  }
}

function entryOf(play: UnsentPlay): RommPlaySessionEntry {
  return {
    rom_id: play.romId,
    start_time: play.startedAt,
    end_time: play.endedAt,
    duration_ms: Date.parse(play.endedAt) - Date.parse(play.startedAt)
  }
}
