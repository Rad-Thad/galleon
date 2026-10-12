import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RomMixApp, isAssetPath } from './app.ts'
import { ReadOnlyGuard } from './romm/guard.ts'

/**
 * What the image protocol will serve.
 *
 * The scheme is registered `supportFetchAPI` and `bypassCSP`, and every request
 * through it carries the bearer token — so the path decides whether the page
 * can read one of RomM's pictures or any endpoint the token reaches. The rule
 * is checked here rather than through a window because it is a string question,
 * and because a path it wrongly turns down is a picture that silently never
 * draws.
 */

test('every picture RomM serves is under its assets root', () => {
  assert.equal(isAssetPath('/assets/romm/resources/roms/1/cover/small.png'), true)
  assert.equal(isAssetPath('/assets/romm/assets/users/1/avatar.png'), true)
  // The face RomM serves for an account that uploaded none — see `Avatar`.
  assert.equal(isAssetPath('assets/default/user.svg'), true)
  // Handed out by RomM without the leading slash as often as with it.
  assert.equal(isAssetPath('assets/romm/resources/roms/1/cover/big.png'), true)
})

test('anything else the token would answer for is refused', () => {
  assert.equal(isAssetPath('/api/users/me'), false)
  assert.equal(isAssetPath('/api/roms'), false)
  assert.equal(isAssetPath(''), false)
})

test('a path that climbs out of the assets root is not an asset path', () => {
  assert.equal(isAssetPath('/assets/../api/users/me'), false)
  assert.equal(isAssetPath('assets/romm/../../api/token'), false)
})

test('under the read-only guard the catch-up sends nothing', async () => {
  // A catch-up that ran would touch the store, the client and the offline
  // cache; a held one touches none of them, so a bare receiver proves it.
  const held = Object.create(RomMixApp.prototype) as RomMixApp
  const guard = new ReadOnlyGuard()
  let guarded: ReadOnlyGuard | null = null
  Object.assign(held, { client: { readOnly: (g: ReadOnlyGuard) => (guarded = g) } })
  held.readOnly(guard)
  assert.equal(guarded, guard)
  await held.catchUp()
  assert.equal(guard.serverWritesAttempted, 0)
})
