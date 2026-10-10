import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type {
  RommSyncCompletePayload,
  RommSyncNegotiatePayload,
  RommSyncScopedNegotiatePayload,
  RommSyncNegotiateResponse,
  RommSyncOperation,
  RommSyncSave
} from '@shared/types'
import { RommError, UnreachableError } from './romm/index.ts'
import { finishSession, negotiateForGame, type NegotiateClient } from './savenegotiate.ts'

/**
 * The engine against a server written here.
 *
 * What it sends and what it keeps are the whole of its job, so each test
 * records the payload and hands back operations the way RomM 5.2.0 does: for
 * every game it knows of, whatever it was asked about.
 */

function save(romId: number, fileName = `game${romId}.srm`): RommSyncSave {
  return {
    rom_id: romId,
    file_name: fileName,
    slot: 'autosave',
    emulator: null,
    content_hash: `hash${romId}`,
    updated_at: '2026-10-10T04:00:00Z',
    file_size_bytes: 8192
  }
}

function op(
  romId: number,
  action: RommSyncOperation['action'],
  saveId: number | null = romId * 10
): RommSyncOperation {
  return {
    action,
    rom_id: romId,
    save_id: saveId,
    file_name: `game${romId}.srm`,
    slot: 'autosave',
    emulator: null,
    reason: 'test'
  }
}

interface Fake extends NegotiateClient {
  negotiated: (RommSyncNegotiatePayload | RommSyncScopedNegotiatePayload)[]
  completed: { id: number; payload: RommSyncCompletePayload }[]
}

function fake(
  operations: RommSyncOperation[],
  opts: { deviceId?: string | null; complete?: () => Promise<void> } = {}
): Fake {
  const negotiated: (RommSyncNegotiatePayload | RommSyncScopedNegotiatePayload)[] = []
  const completed: { id: number; payload: RommSyncCompletePayload }[] = []
  return {
    negotiated,
    completed,
    deviceId: async () => (opts.deviceId === undefined ? 'device-1' : opts.deviceId),
    negotiate: async (payload) => {
      negotiated.push(payload)
      return {
        session_id: 7,
        operations,
        total_upload: 0,
        total_download: 0,
        total_conflict: 0,
        total_no_op: 0
      } satisfies RommSyncNegotiateResponse
    },
    completeSyncSession: async (id, payload) => {
      completed.push({ id, payload })
      await opts.complete?.()
    }
  }
}

describe('negotiateForGame', () => {
  const inventory = [save(1), save(2), save(3)]

  test('on 5.2.0 it sends the whole inventory and no rom_ids', async () => {
    const client = fake([op(2, 'no_op')])
    await negotiateForGame(client, 2, inventory, '5.2.0')
    assert.deepEqual(client.negotiated, [{ device_id: 'device-1', saves: inventory }])
  })

  test('on 5.3+ it sends only this game and names it in rom_ids', async () => {
    for (const version of ['5.3.0', '5.3.1']) {
      const client = fake([op(2, 'no_op')])
      await negotiateForGame(client, 2, inventory, version)
      assert.deepEqual(client.negotiated, [
        { device_id: 'device-1', saves: [save(2)], rom_ids: [2] }
      ])
    }
  })

  test('a version with no number is asked the unscoped way', async () => {
    const client = fake([])
    await negotiateForGame(client, 2, inventory, 'development')
    assert.equal('rom_ids' in client.negotiated[0], false)
    assert.equal(client.negotiated[0].saves.length, 3)
  })

  test("a pre-launch check never acts on another game's save, though 5.2.0 answers for the library", async () => {
    // What 5.2.0 returns for a device that has never seen the rest of the
    // library: a download for every other game's save, an upload for every
    // other local one.
    const client = fake([
      op(1, 'upload', null),
      op(2, 'download'),
      op(3, 'conflict'),
      op(4, 'download'),
      op(5, 'download')
    ])
    const plan = await negotiateForGame(client, 2, inventory, '5.2.0')
    assert.deepEqual(plan, { sessionId: 7, operations: [op(2, 'download')], dropped: 4 })
  })

  test('so does a scoped one, whatever a server sends back', async () => {
    const client = fake([op(2, 'upload', null), op(9, 'download')])
    const plan = await negotiateForGame(client, 2, inventory, '5.3.1')
    assert.deepEqual(plan?.operations, [op(2, 'upload', null)])
    assert.equal(plan?.dropped, 1)
  })

  test('without a device id there is nothing to negotiate, and nothing is sent', async () => {
    const client = fake([op(2, 'download')], { deviceId: null })
    assert.equal(await negotiateForGame(client, 2, inventory, '5.2.0'), null)
    assert.deepEqual(client.negotiated, [])
  })
})

describe('finishSession', () => {
  test('a session is completed with its operation counts', async () => {
    const client = fake([])
    assert.equal(await finishSession(client, 7, { completed: 2, failed: 1 }), 'completed')
    assert.deepEqual(client.completed, [
      { id: 7, payload: { operations_completed: 2, operations_failed: 1 } }
    ])
  })

  test('a session a newer negotiate cancelled is finished, not an error', async () => {
    // RomM 5.2.0's words for it: "Session is already cancelled", a 400.
    const client = fake([], {
      complete: () => Promise.reject(new RommError('Session is already cancelled', 400))
    })
    assert.equal(await finishSession(client, 7, { completed: 1, failed: 0 }), 'superseded')
  })

  test('so is one the server no longer has', async () => {
    const client = fake([], { complete: () => Promise.reject(new RommError('not found', 404)) })
    assert.equal(await finishSession(client, 7, { completed: 0, failed: 0 }), 'superseded')
  })

  test('an outage or a refusal is still an error, for the caller to retry', async () => {
    for (const cause of [
      new UnreachableError('down'),
      new RommError('boom', 500),
      new RommError('forbidden', 403)
    ]) {
      const client = fake([], { complete: () => Promise.reject(cause) })
      await assert.rejects(finishSession(client, 7, { completed: 1, failed: 0 }), cause)
    }
  })
})
