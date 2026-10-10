/**
 * The decision engine (M2-05) against a real negotiate.
 *
 *   npm run test:saves
 *   ROMM_PROFILE=v520 npm run test:saves-real
 *
 * Two facts the unit tests can only take on trust: that the server under test
 * answers a pre-launch negotiate with another game's save, which the engine
 * must drop, and that every negotiate ends the device's open session, which
 * the engine must then count as finished.
 *
 * Only ever against the disposable servers in test/romm/compose.yml.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { negotiatesByGame } from '../../src/main/romm/version.ts'
import {
  finishSession,
  negotiateForGame,
  type NegotiateClient
} from '../../src/main/savenegotiate.ts'
import type { RommSyncSave } from '../../src/shared/types/romm.ts'
import { assertFitsSchema, client, romNamed, state, watch } from '../romm/server.ts'

const fresh = (who: string): string =>
  `galleon-test-negotiate-${who}-${randomBytes(6).toString('hex')}`

/**
 * The app's client under a RomM device of this test's own.
 *
 * Every `client()` registers as one device, and the round trips beside this
 * file negotiate as it: each of their negotiates would cancel this file's
 * session, and their saves would be this device's own.
 */
async function ownDevice(): Promise<NegotiateClient> {
  const res = await fetch(`${state.baseUrl}/api/devices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.clientToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fresh('fork'), platform: 'linux', client: 'galleon-test' })
  })
  assert.ok(res.ok, `register: ${res.status} ${await res.clone().text()}`)
  const { device_id: deviceId } = (await res.json()) as { device_id: string }
  const app = client()
  return {
    deviceId: async () => deviceId,
    negotiate: (payload) => app.negotiate(payload),
    completeSyncSession: (id, payload) => app.completeSyncSession(id, payload)
  }
}

test("a pre-launch negotiate never acts on another game's save", async (t) => {
  const inHand = await romNamed('Galleon Test Handheld (Europe).gba')
  const other = await romNamed('Galleon Test Plain (USA).iso')

  // A save for the other game that this device has never synced, so the
  // whole-library answer offers it as a download. Uploaded with no device, so
  // no device holds a record of it; and for a game no golden fixture uses,
  // since the round trips run beside this file against the same server.
  const form = new FormData()
  form.append('saveFile', new Blob([randomBytes(2048)]), 'other.srm')
  const params = new URLSearchParams({
    rom_id: String(other.id),
    slot: `galleon-negotiate-${randomBytes(4).toString('hex')}`,
    overwrite: 'false'
  })
  const res = await fetch(`${state.baseUrl}/api/saves?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.clientToken}` },
    body: form
  })
  assert.ok(res.ok, `upload: ${res.status} ${await res.clone().text()}`)
  const uploaded = (await res.json()) as { id: number }
  t.after(() => client().deleteSaves([uploaded.id]))

  const sent = watch()
  const fork = await ownDevice()
  const local: RommSyncSave = {
    rom_id: inHand.id,
    file_name: 'inhand.srm',
    slot: 'autosave',
    emulator: null,
    content_hash: randomBytes(16).toString('hex'),
    updated_at: new Date().toISOString(),
    file_size_bytes: 2048
  }
  const plan = await negotiateForGame(fork, inHand.id, [local], state.version)
  assert.ok(plan)
  assert.ok(plan.operations.length > 0, 'no operation for the game in hand')
  assert.ok(
    plan.operations.every((op) => op.rom_id === inHand.id),
    JSON.stringify(plan)
  )
  if (!negotiatesByGame(state.version)) {
    // The whole library came back, the other game's download among it.
    assert.ok(plan.dropped > 0, `RomM ${state.version} answered for this game alone`)
  }
  assertFitsSchema(sent.filter((request) => request.url.includes('/api/sync/')))
})

test('a session a newer negotiate superseded is finished, not an error', async () => {
  const inHand = await romNamed('Galleon Test Handheld (Europe).gba')
  const fork = await ownDevice()

  const first = await negotiateForGame(fork, inHand.id, [], state.version)
  const second = await negotiateForGame(fork, inHand.id, [], state.version)
  assert.ok(first && second)
  assert.notEqual(first.sessionId, second.sessionId)

  assert.equal(
    await finishSession(fork, first.sessionId, { completed: 0, failed: 0 }),
    'superseded'
  )
  assert.equal(
    await finishSession(fork, second.sessionId, { completed: 1, failed: 0 }),
    'completed'
  )
  // Completing it again is a session that has already ended, too.
  assert.equal(
    await finishSession(fork, second.sessionId, { completed: 1, failed: 0 }),
    'superseded'
  )
})
