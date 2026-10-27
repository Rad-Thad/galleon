/**
 * The library a fresh installation starts with: the card `chooseLibraryVolume`
 * picks, with a folder of Galleon's own made on it, or the root's own folder
 * and the reason.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CARD_MIN_FREE_BYTES } from '@shared/librarycard'
import type { Volume } from '@shared/librarycard'
import { CARD_LIBRARY_PATH, chooseDefaultLibrary, prepareFolder } from './librarydefault.ts'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-librarydefault-test-'))
  scratches.push(dir)
  return dir
}

const card: Volume = {
  mountPoint: '/run/media/armada/NovaSD',
  fsType: 'ext4',
  label: 'NovaSD',
  readOnly: false,
  freeBytes: CARD_MIN_FREE_BYTES * 10,
  totalBytes: CARD_MIN_FREE_BYTES * 20
}

test('a card that qualifies takes the library, in a folder of its own made on it', async () => {
  const prepared: string[] = []
  const chosen = await chooseDefaultLibrary({
    volumes: async () => [card],
    user: 'armada',
    prepare: async (dir) => (prepared.push(dir), true)
  })
  const dir = join(card.mountPoint, ...CARD_LIBRARY_PATH)
  assert.deepEqual(chosen, { libraryRoot: dir, volume: card, reason: null })
  assert.equal(dir, '/run/media/armada/NovaSD/galleon/roms')
  assert.deepEqual(prepared, [dir])
})

test('with no card the library stays in the root, and nothing is made anywhere', async () => {
  const prepared: string[] = []
  const chosen = await chooseDefaultLibrary({
    volumes: async () => [],
    user: 'armada',
    prepare: async (dir) => (prepared.push(dir), true)
  })
  assert.deepEqual(chosen, { libraryRoot: '', volume: null, reason: 'no-card' })
  assert.deepEqual(prepared, [])
})

test('a card passed over leaves the library in the root with the reason', async () => {
  const chosen = await chooseDefaultLibrary({
    volumes: async () => [{ ...card, readOnly: true }],
    user: 'armada',
    prepare: async () => assert.fail('a card passed over is not written to')
  })
  assert.deepEqual(chosen, { libraryRoot: '', volume: null, reason: 'read-only' })
})

test('a card that will not take the folder leaves the library in the root', async () => {
  const chosen = await chooseDefaultLibrary({
    volumes: async () => [card],
    user: 'armada',
    prepare: async () => false
  })
  assert.deepEqual(chosen, { libraryRoot: '', volume: null, reason: 'not-writable' })
})

test("another user's card is not this user's to take", async () => {
  const chosen = await chooseDefaultLibrary({
    volumes: async () => [card],
    user: 'someone-else'
  })
  assert.deepEqual(chosen, { libraryRoot: '', volume: null, reason: 'no-card' })
})

test('the folder is made, and one that cannot be made is reported, not thrown', async () => {
  const dir = scratch()
  const made = join(dir, ...CARD_LIBRARY_PATH)
  assert.equal(await prepareFolder(made), true)
  assert.equal(existsSync(made), true)

  // A file where the folder's parent should be refuses for root as for
  // anyone, unlike a permission bit.
  const blocked = join(dir, 'blocked')
  writeFileSync(blocked, '')
  assert.equal(await prepareFolder(join(blocked, ...CARD_LIBRARY_PATH)), false)
})
