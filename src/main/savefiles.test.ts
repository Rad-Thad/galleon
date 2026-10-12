import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { sameContent, sizeOf, stampMtime, walk } from './savefiles.ts'
import { localContentHash } from './savehash.ts'
import { hashCases } from '../../test/saves/hashcases.mjs'

/**
 * The disk half of save sync: what is under a save folder and how big it is.
 * The copies taken before anything is overwritten are `savewriter.test.ts`.
 *
 * The matching rules these sit beside — which save belongs to which ROM, which
 * emulator may load it, which end is ahead — are `saves.test.ts`. What is here
 * is everything that touches a real tree, tested against one, because the cases
 * that matter are the ones a filesystem produces: a folder that is not there, a
 * save that is a directory of memory cards rather than a file, a copy that has
 * to reach the bottom of a nested tree.
 */

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rommix-savefiles-test-'))
  scratches.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return root
}

describe('walking a save folder', () => {
  test('every file comes back, however deeply it is filed', async () => {
    const root = tree({
      'game.srm': 'x',
      'states/game.state1': 'x',
      'memcards/slot1/card.mcd': 'x'
    })

    const found = await walk(root)

    assert.deepEqual(found.map((path) => path.slice(root.length + 1)).sort(), [
      'game.srm',
      'memcards/slot1/card.mcd',
      'states/game.state1'
    ])
  })

  test('a folder that is not there is nothing, not a failure', async () => {
    assert.deepEqual(await walk(join(tree({}), 'never-created')), [])
  })

  test('a tree deeper than the walk goes is cut off rather than followed forever', async () => {
    const deep = 'a/b/c/d/e/f/g/h/save.srm'
    const root = tree({ 'shallow.srm': 'x', [deep]: 'x' })

    const found = await walk(root)

    assert.ok(found.some((path) => path.endsWith('shallow.srm')))
    assert.equal(
      found.some((path) => path.endsWith('save.srm')),
      false
    )
  })
})

describe('measuring what is about to be uploaded', () => {
  test('a file is its own size', async () => {
    const root = tree({ 'game.srm': '01234' })

    assert.equal(await sizeOf(join(root, 'game.srm'), false), 5)
  })

  test('a directory save is everything inside it, because that is what is sent', async () => {
    const root = tree({ 'cards/slot1.mcd': '01234', 'cards/slot2.mcd': '567' })

    assert.equal(await sizeOf(join(root, 'cards'), true), 8)
  })

  test('a path that cannot be read is zero rather than a failed dialog', async () => {
    assert.equal(await sizeOf(join(tree({}), 'gone.srm'), false), 0)
  })
})

describe('dating a file that was just pulled', () => {
  test('it takes the time the server copy was written, not the time it arrived', async () => {
    const root = tree({ 'game.srm': 'x' })
    const path = join(root, 'game.srm')
    const when = Date.parse('2026-01-02T03:04:05.000Z')

    await stampMtime(path, when)

    assert.equal(Math.round(statSync(path).mtimeMs), when)
  })

  test('a file that has gone is not worth failing a pull over', async () => {
    await stampMtime(join(tree({}), 'gone.srm'), Date.now())
  })
})

describe('whether both ends hold the same save', () => {
  test("a zip save is the same as RomM's when what is inside it is, in any order", async () => {
    const root = tree({})
    const cases = hashCases()
    writeFileSync(join(root, 'ordered.zip'), cases.ordered)
    writeFileSync(join(root, 'reordered.zip'), cases.reordered)
    // The md5 of the zip's bytes is not what RomM stores for it.
    const bytesMd5 = createHash('md5').update(cases.ordered).digest('hex')
    assert.equal(await sameContent(join(root, 'ordered.zip'), bytesMd5), false)
    const hashOfOrdered = await localContentHash(join(root, 'ordered.zip'))
    assert.ok(hashOfOrdered)
    assert.equal(await sameContent(join(root, 'reordered.zip'), hashOfOrdered.toUpperCase()), true)
  })

  test('nothing to compare against, or nothing to read, is not the same', async () => {
    const root = tree({ 'a.srm': 'bytes' })
    assert.equal(await sameContent(join(root, 'a.srm'), null), false)
    assert.equal(await sameContent(join(root, 'missing.srm'), 'abc'), false)
  })
})
