/**
 * The local decision (`savedecide.ts`) against RomM's own negotiate.
 *
 *   npm run test:saves
 *   node test/romm/run.mjs --suite saves --profile v531
 *
 * One game is given a slot per rule of `compare_save_state` and of
 * negotiate's pairing, all at once; the same local saves then go to the real
 * endpoint and to the local decision, which must answer every slot with the
 * same action, save and reason. The expected actions are written out too, so
 * a scenario that stopped reaching its rule would fail rather than agree.
 *
 * Only ever against the disposable servers in test/romm/compose.yml.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { decideForGame, type Decision } from '../../src/main/savedecide.ts'
import {
  finishSession,
  negotiateForGame,
  type NegotiateClient
} from '../../src/main/savenegotiate.ts'
import type { RommSave, RommSyncSave } from '../../src/shared/types/romm.ts'
import { assertFitsSchema, client, romNamed, state, watch } from '../romm/server.ts'

const auth = { Authorization: `Bearer ${state.clientToken}` }

async function register(): Promise<string> {
  const res = await fetch(`${state.baseUrl}/api/devices`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `galleon-test-decide-${randomBytes(6).toString('hex')}`,
      platform: 'linux',
      client: 'galleon-test'
    })
  })
  assert.ok(res.ok, `register: ${res.status} ${await res.clone().text()}`)
  return ((await res.json()) as { device_id: string }).device_id
}

/**
 * A new save in `slot`, under a name of its own: RomM tags a name with the
 * second it arrived, and a second upload that comes out with the same tagged
 * name takes over the first one's row, whatever its slot.
 */
async function upload(romId: number, slot: string, deviceId?: string): Promise<RommSave> {
  const form = new FormData()
  form.append('saveFile', new Blob([randomBytes(1024)]), `${slot}.srm`)
  const params = new URLSearchParams({ rom_id: String(romId), slot, overwrite: 'false' })
  if (deviceId) params.set('device_id', deviceId)
  const res = await fetch(`${state.baseUrl}/api/saves?${params.toString()}`, {
    method: 'POST',
    headers: auth,
    body: form
  })
  assert.ok(res.ok, `upload ${slot}: ${res.status} ${await res.clone().text()}`)
  return (await res.json()) as RommSave
}

/** New content in place, from no device: the save moves on past any record. */
async function replace(save: RommSave): Promise<RommSave> {
  const form = new FormData()
  form.append('saveFile', new Blob([randomBytes(1024)]), save.file_name)
  const res = await fetch(`${state.baseUrl}/api/saves/${save.id}`, {
    method: 'PUT',
    headers: auth,
    body: form
  })
  assert.ok(res.ok, `replace ${save.slot}: ${res.status} ${await res.clone().text()}`)
  const replaced = (await res.json()) as RommSave
  assert.ok(replaced.updated_at > save.updated_at, `${save.slot} did not move on`)
  return replaced
}

async function untrack(save: RommSave, deviceId: string): Promise<void> {
  const res = await fetch(`${state.baseUrl}/api/saves/${save.id}/untrack`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId })
  })
  assert.ok(res.ok, `untrack ${save.slot}: ${res.status} ${await res.clone().text()}`)
}

const shift = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString()

const key = (d: Decision): string => `${d.slot ?? '(none)'} ${d.action} ${d.save_id} ${d.reason}`

test('the local decision answers every rule of negotiate the way the server does', async (t) => {
  // A game no other suite in this folder saves for, so nothing else pairs here.
  const rom = await romNamed('Galleon Test Dream Burn (USA).cdi')
  const device = await register()
  const run = randomBytes(3).toString('hex')
  const slot = (name: string): string => `eq-${run}-${name}`

  const local: RommSyncSave[] = []
  const expected = new Map<string, Decision['action'] | null>()
  const have = (name: string, hash: string | null, updatedAt: string, slotName: string | null) => {
    local.push({
      rom_id: rom.id,
      file_name: `${name}.srm`,
      slot: slotName,
      emulator: null,
      content_hash: hash,
      updated_at: updatedAt,
      file_size_bytes: 1024
    })
  }
  const other = randomBytes(16).toString('hex')
  const created: RommSave[] = []
  const up = async (name: string, deviceId?: string): Promise<RommSave> => {
    const save = await upload(rom.id, slot(name), deviceId)
    created.push(save)
    return save
  }
  t.after(() => client().deleteSaves(created.map((s) => s.id)))

  // No server save in the slot, and a save with no slot: both uploads.
  have('missing', other, new Date().toISOString(), slot('missing'))
  expected.set(slot('missing'), 'upload')
  have('noslot', other, new Date().toISOString(), null)
  expected.set('(none)', 'upload')

  // No record of the save on this device.
  const same = await up('same')
  have('same', same.content_hash, shift(same.updated_at, 3600), slot('same'))
  expected.set(slot('same'), 'no_op')
  const clientNewer = await up('client-newer')
  have('client-newer', other, shift(clientNewer.updated_at, 3600), slot('client-newer'))
  expected.set(slot('client-newer'), 'upload')
  const serverNewer = await up('server-newer')
  have('server-newer', other, shift(serverNewer.updated_at, -3600), slot('server-newer'))
  expected.set(slot('server-newer'), 'download')
  const tie = await up('tie')
  expected.set(slot('tie'), 'conflict')
  const tieNoHash = await up('tie-nohash')
  expected.set(slot('tie-nohash'), 'conflict')
  expected.set(slot('server-only'), 'download')
  await up('server-only')

  // Uploaded from this device, so it holds a record at the save's time.
  const recClient = await up('rec-client', device)
  have('rec-client', other, shift(recClient.updated_at, 3600), slot('rec-client'))
  expected.set(slot('rec-client'), 'upload')
  const recQuiet = await up('rec-quiet', device)
  expected.set(slot('rec-quiet'), 'no_op')
  const untracked = await up('untracked', device)
  await untrack(untracked, device)
  have('untracked', other, shift(untracked.updated_at, 3600), slot('untracked'))
  expected.set(slot('untracked'), 'no_op')
  await untrack(await up('untracked-gone', device), device)
  expected.set(slot('untracked-gone'), null)
  await up('deleted', device)
  expected.set(slot('deleted'), null)
  const recServer = await up('rec-server', device)
  const recBoth = await up('rec-both', device)
  const movedGone = await up('moved-gone', device)
  const history = await up('history')

  // RomM keeps times to the second; what moves on must do so a second later.
  await sleep(1100)
  await replace(recServer)
  have('rec-server', other, shift(recServer.updated_at, -3600), slot('rec-server'))
  expected.set(slot('rec-server'), 'download')
  const recBothNow = await replace(recBoth)
  have('rec-both', other, shift(recBothNow.updated_at, 3600), slot('rec-both'))
  expected.set(slot('rec-both'), 'conflict')
  await replace(movedGone)
  expected.set(slot('moved-gone'), 'download')
  // An older row of the slot that matches the client's content is history.
  const newest = await up('history')
  have('history', history.content_hash, shift(newest.updated_at, -3600), slot('history'))
  expected.set(slot('history'), 'download')

  const app = client()

  // An upload's reply carries a finer time than the one RomM stores and
  // compares, so a tie is made against the listed time.
  const stored = await app.savesForDevice(rom.id, device)
  const storedAt = (save: RommSave): string => {
    const row = stored.find((candidate) => candidate.id === save.id)
    assert.ok(row, `${save.slot} is not listed`)
    return row.updated_at
  }
  have('tie', other, storedAt(tie), slot('tie'))
  have('tie-nohash', null, storedAt(tieNoHash), slot('tie-nohash'))
  have('rec-quiet', other, storedAt(recQuiet), slot('rec-quiet'))

  const fork: NegotiateClient = {
    deviceId: async () => device,
    negotiate: (payload) => app.negotiate(payload),
    completeSyncSession: (id, payload) => app.completeSyncSession(id, payload)
  }
  const sent = watch()
  const listed = await app.savesForDevice(rom.id, device)
  const decided = decideForGame(rom.id, local, listed, device)

  const plan = await negotiateForGame(fork, rom.id, local, state.version)
  assert.ok(plan)
  const fromServer: Decision[] = plan.operations.map((op) => ({
    action: op.action,
    save_id: op.save_id,
    slot: op.slot,
    reason: op.reason
  }))
  // Only this run's slots: another run's leftovers on a reused server pair too.
  const ours = (d: Decision): boolean => d.slot === null || d.slot.startsWith(`eq-${run}-`)
  assert.deepEqual(
    decided.filter(ours).map(key).sort(),
    fromServer.filter(ours).map(key).sort(),
    `RomM ${state.version}`
  )

  const bySlot = new Map(fromServer.filter(ours).map((d) => [d.slot ?? '(none)', d.action]))
  for (const [name, action] of expected) {
    assert.equal(bySlot.get(name) ?? null, action, `${name} on RomM ${state.version}`)
  }
  assert.equal(bySlot.size, [...expected.values()].filter(Boolean).length)

  await finishSession(fork, plan.sessionId, { completed: 0, failed: 0 })
  assertFitsSchema(sent)
})
