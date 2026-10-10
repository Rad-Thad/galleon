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
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { negotiatesByGame } from '../../src/main/romm/version.ts'
import { finishSession, negotiateForGame } from '../../src/main/savenegotiate.ts'
import type { RommSyncSave } from '../../src/shared/types/romm.ts'
import { assertFitsSchema, client, romNamed, scratch, state, watch } from '../romm/server.ts'

const fresh = (who: string): string =>
  `galleon-test-negotiate-${who}-${randomBytes(6).toString('hex')}`

test("a pre-launch negotiate never acts on another game's save", async (t) => {
  const inHand = await romNamed('Galleon Test Handheld (Europe).gba')
  const other = await romNamed('Galleon Test Cartridge (USA).sfc')

  // Another device's save for the other game, which this device has never
  // seen: the whole-library answer offers it as a download.
  const file = join(scratch(t), 'other.srm')
  writeFileSync(file, randomBytes(2048))
  await client(fresh('elsewhere')).uploadSave(other.id, file, 'other.srm', null, 'autosave', {
    overwrite: false,
    autocleanup: false
  })

  const sent = watch()
  const fork = client(fresh('fork'))
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
  const fork = client(fresh('fork'))

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
