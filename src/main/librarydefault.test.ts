/**
 * The library a fresh installation starts with: the card `chooseLibraryVolume`
 * picks, with a folder of Galleon's own made on it, or the root's own folder
 * and the reason.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CARD_MIN_FREE_BYTES } from '@shared/librarycard'
import type { Volume } from '@shared/librarycard'
import {
  CARD_LIBRARY_PATH,
  chooseDefaultLibrary,
  libraryFolderChoices,
  prepareFolder
} from './librarydefault.ts'

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

const onCardFolder = join(card.mountPoint, ...CARD_LIBRARY_PATH)

test("the folders offered are the root's own and each writable card's, the one in use marked", async () => {
  const internal = scratch()
  const other: Volume = { ...card, mountPoint: '/run/media/armada/OTHER', label: 'OTHER' }
  const stuck: Volume = { ...card, mountPoint: '/run/media/armada/STUCK', readOnly: true }
  const system: Volume = { ...card, mountPoint: '/home', label: null }
  const sources = { volumes: async () => [card, other, stuck, system], user: 'armada' }

  const choices = await libraryFolderChoices(onCardFolder, internal, sources)
  assert.deepEqual(
    choices.map((choice) => [choice.libraryRoot, choice.label, choice.current]),
    [
      ['', null, false],
      [onCardFolder, 'NovaSD', true],
      [join(other.mountPoint, ...CARD_LIBRARY_PATH), 'OTHER', false]
    ]
  )
  assert.equal(choices[0].path, internal)
  assert.equal(typeof choices[0].freeBytes, 'number', "the root's room is measured")
  assert.equal(choices[1].freeBytes, card.freeBytes)

  const atHome = await libraryFolderChoices('', internal, sources)
  assert.deepEqual(
    atHome.map((choice) => choice.current),
    [true, false, false]
  )
})

test('a folder in use that is none of those is offered as it is, marked', async () => {
  const internal = scratch()
  const own = join(scratch(), 'games')
  const choices = await libraryFolderChoices(own, internal, {
    volumes: async () => [],
    user: 'armada'
  })
  assert.deepEqual(
    choices.map((choice) => [choice.libraryRoot, choice.path, choice.current]),
    [
      ['', internal, false],
      [own, own, true]
    ]
  )
})

test('a folder in use reached through a link is the folder it leads to', async () => {
  const home = scratch()
  const internal = join(home, 'roms')
  mkdirSync(internal)
  symlinkSync(internal, join(home, 'link'))
  const choices = await libraryFolderChoices(join(home, 'link'), internal, {
    volumes: async () => [],
    user: 'armada'
  })
  assert.deepEqual(
    choices.map((choice) => [choice.libraryRoot, choice.current]),
    [['', true]]
  )
})
