import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAssetPath } from './app.ts'

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
