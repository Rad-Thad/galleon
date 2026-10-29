/**
 * What the fake RomM's save store does beyond the shared contract
 * (`contract.ts`): the optimistic read, which the engine never makes, and what
 * the server refuses.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { SaveStore, type Upload } from '../device/fake-romm/saves.ts'
import { startFakeRomm } from '../device/fake-romm/server.ts'

const upload = (patch: Partial<Upload>): Upload => ({
  romId: 1,
  fileName: 'game.srm',
  bytes: Buffer.from('first'),
  hash: null,
  emulator: 'snes9x',
  slot: null,
  deviceId: null,
  overwrite: false,
  ...patch
})

/** A clock that moves on a second at each reading. */
function ticking(): () => Date {
  let at = Date.parse('2026-10-29T10:00:00Z')
  return () => new Date((at += 1000))
}

test('an optimistic read records the device; a read that says otherwise does not', () => {
  const store = new SaveStore(1, ticking())
  const saved = store.upload(upload({ slot: 'autosave', deviceId: 'a' }))
  assert.equal(saved.status, 200)
  if (saved.status !== 200) return
  const current = (device: string): boolean | undefined =>
    store.list(1, device)[0].device_syncs?.[0].is_current
  store.content(saved.save.id, 'b', false)
  assert.equal(current('b'), false)
  store.content(saved.save.id, 'b', true)
  assert.equal(current('b'), true)
  assert.equal(store.content(999, 'b', true), null)
  assert.equal(store.downloaded(999, 'b'), null)
  assert.deepEqual(store.delete([saved.save.id, 999]), [saved.save.id])
})

test('the server wants its token, knows only its own games and answers nothing else', async (t) => {
  const server = await startFakeRomm({ token: 'secret', romIds: [1], scratch: tmpdir() })
  t.after(() => server.close())
  const ask = (path: string, init: RequestInit = {}, token = 'secret'): Promise<Response> =>
    fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers }
    })

  assert.ok(server.baseUrl.startsWith('http://127.0.0.1:'))
  assert.equal((await ask('/api/heartbeat', {}, 'wrong')).status, 200)
  assert.equal((await ask('/api/saves?rom_id=1', {}, 'wrong')).status, 401)
  const form = new FormData()
  form.append('saveFile', new Blob([Buffer.from('save')]), 'game.srm')
  assert.equal((await ask('/api/saves?rom_id=2', { method: 'POST', body: form })).status, 404)
  assert.equal((await ask('/api/saves?rom_id=1', { method: 'POST', body: 'x' })).status, 400)
  assert.equal((await ask('/api/saves?rom_id=1&device_id=nobody')).status, 404)
  assert.equal((await ask('/api/saves/1/content')).status, 404)
  const downloaded = { method: 'POST', body: JSON.stringify({ device_id: 'nobody' }) }
  assert.equal((await ask('/api/saves/1/downloaded', downloaded)).status, 404)
  assert.equal((await ask('/api/users/me')).status, 404)
})
