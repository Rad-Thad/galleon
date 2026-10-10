import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import type { RommPlaySessionEntry } from '@shared/types'
import { PLAY_BATCH, PlayReporter } from './playtime.ts'
import { RommError, UnreachableError } from './romm/index.ts'
import { Store } from './store.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-playtime-'))
  dirs.push(dir)
  return dir
}

const store = (): Store => new Store(home())

/** A RomM that takes play sessions while `up`, and refuses them otherwise. */
function server(up = true): {
  up: boolean
  batches: RommPlaySessionEntry[][]
  sendPlaySessions: (sessions: readonly RommPlaySessionEntry[]) => Promise<void>
} {
  const fake = {
    up,
    batches: [] as RommPlaySessionEntry[][],
    sendPlaySessions: async (sessions: readonly RommPlaySessionEntry[]) => {
      if (!fake.up) throw new UnreachableError('no network')
      fake.batches.push([...sessions])
    }
  }
  return fake
}

const at = (seconds: number): Date => new Date(Date.UTC(2026, 9, 10, 6, 0, seconds))

describe('reporting play time', () => {
  test('a session is sent with its window and its length', async () => {
    const romm = server()
    await new PlayReporter(store(), romm).record(3, at(0), at(600))
    assert.deepEqual(romm.batches, [
      [
        {
          rom_id: 3,
          start_time: '2026-10-10T06:00:00.000Z',
          end_time: '2026-10-10T06:10:00.000Z',
          duration_ms: 600_000
        }
      ]
    ])
  })

  test('a session too short to mean anything is dropped, not kept', async () => {
    const romm = server()
    const kept = store()
    const play = new PlayReporter(kept, romm)
    await play.record(3, at(0), at(4))
    await play.record(3, at(10), at(10))
    await play.record(3, at(20), at(19))
    assert.deepEqual(romm.batches, [])
    assert.deepEqual(kept.unsentPlay, [])
    await play.record(3, at(30), at(35))
    assert.equal(romm.batches.length, 1)
  })

  test('a session played offline is kept and sent once the server is back', async () => {
    const romm = server(false)
    const kept = store()
    const play = new PlayReporter(kept, romm)
    await play.record(3, at(0), at(600))
    await play.record(4, at(700), at(900))
    assert.equal(kept.unsentPlay.length, 2)

    romm.up = true
    await play.send()
    assert.deepEqual(
      romm.batches.map((batch) => batch.map((one) => one.rom_id)),
      [[3, 4]]
    )
    assert.deepEqual(kept.unsentPlay, [])
  })

  test('and survives a restart, being on disk', async () => {
    const dir = home()
    await new PlayReporter(new Store(dir), server(false)).record(3, at(0), at(600))
    const reopened = new Store(dir)
    const romm = server()
    await new PlayReporter(reopened, romm).send()
    assert.equal(romm.batches[0][0].rom_id, 3)
    assert.deepEqual(reopened.unsentPlay, [])
  })

  test('a refusal keeps them too, since it may not be one next time', async () => {
    const kept = store()
    const play = new PlayReporter(kept, {
      sendPlaySessions: () => Promise.reject(new RommError('boom', 500))
    })
    await play.record(3, at(0), at(600))
    assert.equal(kept.unsentPlay.length, 1)
  })

  test('a backlog goes up in batches the server takes, oldest first', async () => {
    const romm = server(false)
    const kept = store()
    const play = new PlayReporter(kept, romm)
    const count = PLAY_BATCH * 2 + 1
    for (let i = 0; i < count; i += 1) await play.record(1, at(i * 10), at(i * 10 + 5))
    romm.up = true
    await play.send()
    assert.deepEqual(
      romm.batches.map((batch) => batch.length),
      [PLAY_BATCH, PLAY_BATCH, 1]
    )
    assert.equal(romm.batches[0][0].start_time, at(0).toISOString())
    assert.deepEqual(kept.unsentPlay, [])
  })

  test('a batch that fails keeps itself and everything after it', async () => {
    const kept = store()
    const play = new PlayReporter(kept, server(false))
    for (let i = 0; i < PLAY_BATCH + 1; i += 1) await play.record(1, at(i * 10), at(i * 10 + 5))
    let calls = 0
    const flaky = new PlayReporter(kept, {
      sendPlaySessions: async () => {
        calls += 1
        if (calls === 2) throw new UnreachableError('gone again')
      }
    })
    await flaky.send()
    assert.equal(kept.unsentPlay.length, 1)
    assert.equal(kept.unsentPlay[0].startedAt, at(PLAY_BATCH * 10).toISOString())
  })

  test('the same span kept twice is sent once', async () => {
    const kept = store()
    const play = new PlayReporter(kept, server(false))
    await play.record(3, at(0), at(600))
    await play.record(3, at(0), at(600))
    assert.equal(kept.unsentPlay.length, 1)
  })

  test('two sends at once are one pass', async () => {
    const kept = store()
    await new PlayReporter(kept, server(false)).record(3, at(0), at(600))
    const romm = server()
    const play = new PlayReporter(kept, romm)
    await Promise.all([play.send(), play.send()])
    assert.equal(romm.batches.length, 1)
  })
})
