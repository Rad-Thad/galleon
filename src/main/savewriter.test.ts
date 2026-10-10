import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootPaths } from './root.ts'
import { stampMtime, walk } from './savefiles.ts'
import {
  BACKUP_COPIES,
  cpDirectory,
  discardStaged,
  exclusive,
  keepBackup,
  removeSave,
  replaceSave,
  SaveFolderInTheWay,
  SaveNotBackedUp,
  stageBeside,
  unpackSave
} from './savewriter.ts'
import { zipDirectory } from './zip.ts'
import { log } from './log.ts'

/**
 * The one writer into an emulator's save tree, against a real tree: the
 * Argosy fork's Dolphin memory-card bug (a file written over a card folder),
 * the backups taken before anything is replaced, and two writes to one save.
 */

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'galleon-savewriter-test-'))
  scratches.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return root
}

/** Stage `contents` beside `destination` the way a pull does. */
async function staged(destination: string, contents: string): Promise<string> {
  const path = await stageBeside(destination)
  writeFileSync(path, contents)
  return path
}

/** Every error line the log is given while `work` runs. */
async function errorsDuring(work: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []
  const original = log.error
  log.error = ((_scope: string, message: string) => {
    seen.push(message)
  }) as typeof log.error
  try {
    await work().catch(() => undefined)
  } finally {
    log.error = original
  }
  return seen
}

describe('replacing a save file', () => {
  test('a folder at the destination is refused, logged, and left as it was', async () => {
    // Dolphin's GCI folder: a memory card that is a directory of saves.
    const root = tree({ 'GC/USA/Card A/01-GALE-zelda.gci': 'card' })
    const card = join(root, 'GC/USA/Card A')
    const partial = await staged(card, 'a file')

    const errors = await errorsDuring(() =>
      assert.rejects(replaceSave(card, partial, join(root, 'kept')), SaveFolderInTheWay)
    )

    assert.deepEqual(errors, ['refused to write a file over a save folder'])
    assert.equal(readFileSync(join(card, '01-GALE-zelda.gci'), 'utf8'), 'card')
    assert.equal(existsSync(join(root, 'kept')), false)
  })

  test('a normal overwrite still works, and keeps a copy of what it replaced', async () => {
    const root = tree({ 'saves/game.srm': 'played here' })
    const path = join(root, 'saves/game.srm')
    const into = join(root, 'kept')

    await replaceSave(path, await staged(path, 'from the server'), into)

    assert.equal(readFileSync(path, 'utf8'), 'from the server')
    assert.equal(readFileSync(join(into, 'game.srm.1'), 'utf8'), 'played here')
    assert.deepEqual(await walk(join(root, 'saves')), [path])
  })

  test('a create still works, into a folder that did not exist yet', async () => {
    const root = tree({})
    const path = join(root, 'saves/snes/game.srm')
    const into = join(root, 'kept')

    await replaceSave(path, await staged(path, 'first save'), into)

    assert.equal(readFileSync(path, 'utf8'), 'first save')
    assert.equal(existsSync(into), false)
  })

  test('the file is dated as the server copy when a time is given', async () => {
    const root = tree({})
    const path = join(root, 'game.srm')
    const when = Date.parse('2026-01-02T03:04:05.000Z')

    await replaceSave(path, await staged(path, 'x'), join(root, 'kept'), when)

    assert.equal(Math.round(statSync(path).mtimeMs), when)
  })

  test('two writers to one save are serialised, each backing up the one before', async () => {
    const root = tree({ 'game.srm': 'original' })
    const path = join(root, 'game.srm')
    const into = join(root, 'kept')
    const one = join(root, 'one.part')
    const two = join(root, 'two.part')
    writeFileSync(one, 'first')
    writeFileSync(two, 'second')

    await Promise.all([replaceSave(path, one, into), replaceSave(path, two, into)])

    assert.equal(readFileSync(path, 'utf8'), 'second')
    assert.equal(readFileSync(join(into, 'game.srm.1'), 'utf8'), 'first')
    assert.equal(readFileSync(join(into, 'game.srm.2'), 'utf8'), 'original')
  })

  test('work on one path waits for the work before it, even work that failed', async () => {
    const order: string[] = []
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))

    const first = exclusive('/saves/a.srm', async () => {
      await gate
      order.push('first')
      throw new Error('a failed write')
    })
    const second = exclusive('/saves/../saves/a.srm', async () => {
      order.push('second')
    })
    const other = exclusive('/saves/b.srm', async () => {
      order.push('other')
    })

    await other
    release()
    await assert.rejects(first)
    await second
    assert.deepEqual(order, ['other', 'first', 'second'])
  })
})

describe('unpacking a folder save', () => {
  test('the archive lands over the folder, files it did not carry are kept', async () => {
    const root = tree({
      'from/save.dat': 'from the server',
      'title/save.dat': 'played here',
      'title/profile2.dat': 'only here'
    })
    const archive = join(root, 'save.zip')
    await zipDirectory(join(root, 'from'), archive)
    const dir = join(root, 'title')
    const into = join(root, 'kept')

    const written = await unpackSave(dir, archive, into)

    assert.deepEqual(written, [join(dir, 'save.dat')])
    assert.equal(readFileSync(join(dir, 'save.dat'), 'utf8'), 'from the server')
    assert.equal(readFileSync(join(dir, 'profile2.dat'), 'utf8'), 'only here')
    assert.equal(readFileSync(join(into, 'title.1/save.dat'), 'utf8'), 'played here')
    assert.equal(existsSync(`${dir}.part`), false)
  })

  test('an entry that would land on a folder refuses the whole archive first', async () => {
    const root = tree({
      'from/a.dat': 'new a',
      'from/card': 'a file named like the card folder',
      'title/a.dat': 'old a',
      'title/card/slot.gci': 'card'
    })
    const archive = join(root, 'save.zip')
    await zipDirectory(join(root, 'from'), archive)
    const dir = join(root, 'title')

    const errors = await errorsDuring(() =>
      assert.rejects(unpackSave(dir, archive, join(root, 'kept')), SaveFolderInTheWay)
    )

    assert.deepEqual(errors, ['refused to write a file over a save folder'])
    assert.equal(readFileSync(join(dir, 'a.dat'), 'utf8'), 'old a')
    assert.equal(readFileSync(join(dir, 'card/slot.gci'), 'utf8'), 'card')
    assert.equal(existsSync(`${dir}.part`), false)
  })
})

describe('deleting a save here', () => {
  test('a copy is kept before the file goes', async () => {
    const root = tree({ 'game.srm': 'played' })
    const into = join(root, 'kept')

    await removeSave(join(root, 'game.srm'), into)

    assert.equal(existsSync(join(root, 'game.srm')), false)
    assert.equal(readFileSync(join(into, 'game.srm.1'), 'utf8'), 'played')
  })

  test('a folder save is kept whole before it goes', async () => {
    const root = tree({ 'title/save.dat': 'played' })
    const into = join(root, 'kept')

    await removeSave(join(root, 'title'), into)

    assert.equal(existsSync(join(root, 'title')), false)
    assert.equal(readFileSync(join(into, 'title.1/save.dat'), 'utf8'), 'played')
  })

  test('a save that is not there is nothing to do', async () => {
    const root = tree({})
    await removeSave(join(root, 'gone.srm'), join(root, 'kept'))
    assert.equal(existsSync(join(root, 'kept')), false)
  })
})

describe('discarding what was staged', () => {
  test('a staged file beside a save goes', async () => {
    const root = tree({ 'game.srm.part': 'half' })
    await discardStaged(join(root, 'game.srm.part'))
    assert.equal(existsSync(join(root, 'game.srm.part')), false)
  })

  test('a save is refused: only staging can be discarded this way', async () => {
    // Outside the temporary folder, as an emulator's save tree is.
    const save = join(process.cwd(), 'artifacts', 'savewriter-test.srm')
    mkdirSync(join(save, '..'), { recursive: true })
    writeFileSync(save, 'played')
    try {
      const errors = await errorsDuring(() => discardStaged(save))
      assert.deepEqual(errors, ['refused to discard a file that is not staging'])
      assert.equal(readFileSync(save, 'utf8'), 'played')
    } finally {
      rmSync(save, { force: true })
    }
  })
})

describe('where displaced saves are kept', () => {
  test('per game, under the saves folder of the app root, the last five by default', () => {
    assert.equal(rootPaths('/home/deck/Galleon').saves, '/home/deck/Galleon/saves')
    assert.equal(BACKUP_COPIES, 5)
  })
})

describe('backing up a directory save', () => {
  test('the whole tree is copied, contents and all', async () => {
    const root = tree({ 'cards/slot1.mcd': 'one', 'cards/nested/slot2.mcd': 'two' })

    await cpDirectory(join(root, 'cards'), join(root, 'backup'))

    assert.equal(readFileSync(join(root, 'backup/slot1.mcd'), 'utf8'), 'one')
    assert.equal(readFileSync(join(root, 'backup/nested/slot2.mcd'), 'utf8'), 'two')
  })

  test('nothing to copy leaves nothing behind, and does not throw', async () => {
    const root = tree({})

    await cpDirectory(join(root, 'missing'), join(root, 'backup'))

    assert.deepEqual(await walk(join(root, 'backup')), [])
  })
})

describe('keeping copies of a save a pull is about to overwrite', () => {
  test('the copy taken now is the first slot, and the older ones move down', async () => {
    const root = tree({ 'game.srm': 'first' })
    const path = join(root, 'game.srm')
    const into = join(root, 'kept')

    for (const contents of ['second', 'third', 'fourth']) {
      await keepBackup(path, into)
      writeFileSync(path, contents)
    }

    assert.equal(readFileSync(join(into, 'game.srm.1'), 'utf8'), 'third')
    assert.equal(readFileSync(join(into, 'game.srm.2'), 'utf8'), 'second')
    assert.equal(readFileSync(join(into, 'game.srm.3'), 'utf8'), 'first')
  })

  test('the copies are kept away from the folder the emulator reads', async () => {
    const root = tree({ 'saves/game.srm': 'played' })
    const into = join(root, 'kept')

    await keepBackup(join(root, 'saves/game.srm'), into)

    assert.deepEqual(await walk(join(root, 'saves')), [join(root, 'saves/game.srm')])
  })

  test('the oldest falls off the end rather than the folder filling up', async () => {
    const root = tree({ 'game.srm': '0' })
    const path = join(root, 'game.srm')
    const into = join(root, 'kept')

    for (let pull = 1; pull <= BACKUP_COPIES + 3; pull += 1) {
      await keepBackup(path, into)
      writeFileSync(path, String(pull))
    }

    assert.equal((await walk(into)).length, BACKUP_COPIES)
    assert.equal(existsSync(join(into, `game.srm.${BACKUP_COPIES + 1}`)), false)
  })

  test('a directory save is copied whole, tree and all', async () => {
    const root = tree({ 'cards/slot1.mcd': 'one', 'cards/nested/slot2.mcd': 'two' })
    const into = join(root, 'kept')

    await keepBackup(join(root, 'cards'), into, true)

    assert.equal(readFileSync(join(into, 'cards.1/slot1.mcd'), 'utf8'), 'one')
    assert.equal(readFileSync(join(into, 'cards.1/nested/slot2.mcd'), 'utf8'), 'two')
  })

  test('the single copy an older RomMix left beside the save joins the chain', async () => {
    const root = tree({ 'game.srm': 'now', 'game.srm.rommix-bak': 'from before' })
    const path = join(root, 'game.srm')
    const into = join(root, 'kept')

    await keepBackup(path, into)

    assert.equal(existsSync(`${path}.rommix-bak`), false)
    assert.equal(readFileSync(join(into, 'game.srm.1'), 'utf8'), 'now')
    assert.equal(readFileSync(join(into, 'game.srm.2'), 'utf8'), 'from before')
  })

  test('a copy is dated as the save it was taken from, not as the pull', async () => {
    const root = tree({ 'game.srm': 'played', 'cards/slot1.mcd': 'played' })
    const into = join(root, 'kept')
    const played = Date.parse('2026-03-04T05:06:07.000Z')
    await stampMtime(join(root, 'game.srm'), played)
    await stampMtime(join(root, 'cards/slot1.mcd'), played)

    await keepBackup(join(root, 'game.srm'), into)
    await keepBackup(join(root, 'cards'), into, true)

    assert.equal(Math.round(statSync(join(into, 'game.srm.1')).mtimeMs), played)
    assert.equal(Math.round(statSync(join(into, 'cards.1/slot1.mcd')).mtimeMs), played)
  })

  test('a save that is not there is not worth failing a pull over', async () => {
    const root = tree({})

    await keepBackup(join(root, 'gone.srm'), join(root, 'kept'))
  })
})

describe('a save that cannot be copied aside is left as it was', () => {
  /** A backups folder that cannot be made, because a file holds its name. */
  function blocked(root: string): string {
    const into = join(root, 'kept')
    writeFileSync(into, 'not a folder')
    return into
  }

  test('a pull writes nothing over it', async () => {
    const root = tree({ 'game.srm': 'only here' })
    const path = join(root, 'game.srm')
    const partial = await staged(path, 'from the server')

    await errorsDuring(() =>
      assert.rejects(replaceSave(path, partial, blocked(root)), SaveNotBackedUp)
    )

    assert.equal(readFileSync(path, 'utf8'), 'only here')
  })

  test('a folder save is not unpacked over', async () => {
    const root = tree({ 'from/save.dat': 'from the server', 'title/save.dat': 'only here' })
    const archive = join(root, 'save.zip')
    await zipDirectory(join(root, 'from'), archive)
    const dir = join(root, 'title')

    await errorsDuring(() =>
      assert.rejects(unpackSave(dir, archive, blocked(root)), SaveNotBackedUp)
    )

    assert.equal(readFileSync(join(dir, 'save.dat'), 'utf8'), 'only here')
    assert.equal(existsSync(`${dir}.part`), false)
  })

  test('a delete removes nothing', async () => {
    const root = tree({ 'game.srm': 'only here' })
    const path = join(root, 'game.srm')

    await errorsDuring(() => assert.rejects(removeSave(path, blocked(root)), SaveNotBackedUp))

    assert.equal(readFileSync(path, 'utf8'), 'only here')
  })
})
