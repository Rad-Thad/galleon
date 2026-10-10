/**
 * The decision engine (M2-05) against a real negotiate.
 *
 *   npm run test:saves
 *   ROMM_PROFILE=v520 npm run test:saves-real
 *
 * Three facts the unit tests can only take on trust: that the server under
 * test answers a pre-launch negotiate with another game's save, which the
 * engine must drop; that a session a later negotiate ended (every negotiate
 * did, before RomM 5.4) is one the engine counts as finished; and that play
 * sent with a session's completion lands in the history under this device,
 * once however often it is sent (M2-06).
 *
 * Only ever against the disposable servers in test/romm/compose.yml.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { atLeast, negotiatesByGame } from '../../src/main/romm/version.ts'
import { instant } from '../../src/main/savedecide.ts'
import {
  finishSession,
  negotiateForGame,
  type NegotiateClient
} from '../../src/main/savenegotiate.ts'
import type { RommSyncSave } from '../../src/shared/types/romm.ts'
import { assertFitsSchema, client, romNamed, state, watch } from '../romm/server.ts'

/**
 * Before RomM 5.4 every negotiate cancelled the device's open sessions, and
 * each play row named the sync session that carried it. 5.4 leaves earlier
 * sessions open, so each can still be completed, and drops that field.
 */
const negotiateEndsOpenSessions = (version: string): boolean => !atLeast(version, '5.4.0')

const fresh = (who: string): string =>
  `galleon-test-negotiate-${who}-${randomBytes(6).toString('hex')}`

/**
 * The app's client under a RomM device of this test's own.
 *
 * Every `client()` registers as one device, and the round trips beside this
 * file negotiate as it: each of their negotiates would cancel this file's
 * session, and their saves would be this device's own.
 */
async function ownDevice(): Promise<NegotiateClient & { id: string }> {
  const res = await fetch(`${state.baseUrl}/api/devices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.clientToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fresh('fork'), platform: 'linux', client: 'galleon-test' })
  })
  assert.ok(res.ok, `register: ${res.status} ${await res.clone().text()}`)
  const { device_id: deviceId } = (await res.json()) as { device_id: string }
  const app = client()
  return {
    id: deviceId,
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
    negotiateEndsOpenSessions(state.version) ? 'superseded' : 'completed'
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

interface PlayRow {
  id: number
  device_id: string | null
  rom_id: number | null
  /** Absent from RomM 5.4 on (`negotiateEndsOpenSessions`). */
  sync_session_id?: number | null
  start_time: string
  duration_ms: number
}

async function playOf(romId: number, deviceId: string): Promise<PlayRow[]> {
  const params = new URLSearchParams({ rom_id: String(romId), device_id: deviceId })
  const res = await fetch(`${state.baseUrl}/api/play-sessions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${state.clientToken}` }
  })
  assert.ok(res.ok, `play sessions: ${res.status} ${await res.clone().text()}`)
  return (await res.json()) as PlayRow[]
}

test("play recorded during a session is sent with the session's completion", async (t) => {
  const inHand = await romNamed('Galleon Test Handheld (Europe).gba')
  const fork = await ownDevice()
  t.after(async () => {
    for (const row of await playOf(inHand.id, fork.id)) {
      await fetch(`${state.baseUrl}/api/play-sessions/${row.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${state.clientToken}` }
      })
    }
  })
  // Whole seconds and in the past: RomM drops the fraction, and refuses an
  // end too far ahead of its own clock.
  const endedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
  const startedAt = new Date(endedAt.getTime() - 754_000)
  const played = [{ romId: inHand.id, startedAt, endedAt }]

  const sent = watch()
  const plan = await negotiateForGame(fork, inHand.id, [], state.version)
  assert.ok(plan)
  assert.equal(
    await finishSession(fork, plan.sessionId, { completed: 0, failed: 0 }, played),
    'completed'
  )
  assertFitsSchema(sent.filter((request) => request.url.includes('/api/sync/')))

  const rows = await playOf(inHand.id, fork.id)
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.equal(rows[0].device_id, fork.id)
  if (negotiateEndsOpenSessions(state.version)) {
    assert.equal(rows[0].sync_session_id, plan.sessionId)
  } else {
    assert.equal(rows[0].sync_session_id, undefined)
  }
  assert.equal(rows[0].duration_ms, 754_000)
  // `instant` counts microseconds, as RomM compares times.
  assert.equal(instant(rows[0].start_time), startedAt.getTime() * 1000)

  // Sent again with the next session, as a completion retried after a lost
  // reply would be: still one span in the history.
  const again = await negotiateForGame(fork, inHand.id, [], state.version)
  assert.ok(again)
  assert.equal(
    await finishSession(fork, again.sessionId, { completed: 0, failed: 0 }, played),
    'completed'
  )
  assert.equal((await playOf(inHand.id, fork.id)).length, 1)
})
