/**
 * What changing the library folder would move: the shared library's games
 * with their sizes off the disk, the room where they would go, and the moves
 * that cannot be made at all.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statfsSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHARED_LIBRARY, type InstalledRom } from '@shared/types'
import { moveLibrary, planLibraryMove, type MoveIndex } from './librarymove.ts'

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-librarymove-test-'))
  scratches.push(dir)
  return dir
}

function rom(romId: number, path: string, extra: Partial<InstalledRom> = {}): InstalledRom {
  return {
    romId,
    path,
    launchPath: path,
    name: `Game ${romId}`,
    coverPath: null,
    files: [path],
    system: 'gc',
    platformName: 'GameCube',
    sizeBytes: 1,
    installedAt: '2026-10-27T00:00:00Z',
    isDirectory: false,
    emulatorId: SHARED_LIBRARY,
    ...extra
  }
}

function library(): { home: string; from: string; to: string } {
  const home = scratch()
  const from = join(home, 'roms')
  mkdirSync(join(from, 'gc'), { recursive: true })
  mkdirSync(join(from, 'psx', 'Disc Game'), { recursive: true })
  writeFileSync(join(from, 'gc', 'one.rvz'), Buffer.alloc(1000))
  writeFileSync(join(from, 'psx', 'Disc Game', 'game.cue'), Buffer.alloc(100))
  writeFileSync(join(from, 'psx', 'Disc Game', 'game.bin'), Buffer.alloc(5000))
  return { home, from, to: join(home, 'card', 'galleon', 'roms') }
}

test('the shared library is listed with each game measured off the disk and its new place', async () => {
  const { from, to } = library()
  const plan = await planLibraryMove(
    [
      rom(1, join(from, 'gc', 'one.rvz'), { sizeBytes: 7 }),
      rom(2, join(from, 'psx', 'Disc Game'), { isDirectory: true, system: 'psx' })
    ],
    from,
    to
  )
  assert.equal(plan.refused, null)
  assert.deepEqual(
    plan.games.map((game) => [game.romId, game.sizeBytes, game.to]),
    [
      [1, 1000, join(to, 'gc', 'one.rvz')],
      [2, 5100, join(to, 'psx', 'Disc Game')]
    ]
  )
  assert.equal(plan.totalBytes, 6100)
  assert.equal(plan.sameDrive, true)
  assert.equal(plan.fits, true)
  assert.ok(plan.freeBytes !== null && plan.freeBytes > 0)
})

test("a game in an emulator's own folder, or outside the library, is not carried", async () => {
  const { home, from, to } = library()
  writeFileSync(join(home, 'elsewhere.rvz'), 'x')
  const plan = await planLibraryMove(
    [
      rom(1, join(from, 'gc', 'one.rvz'), { emulatorId: 'dolphin' }),
      rom(2, join(home, 'elsewhere.rvz')),
      rom(3, join(home, 'roms-old', 'gc', 'x.rvz'))
    ],
    from,
    to
  )
  assert.deepEqual(plan.games, [])
  assert.deepEqual(plan.missing, [])
  assert.equal(plan.totalBytes, 0)
})

test('a game whose files are gone is named as missing, and one already in the new folder as taken', async () => {
  const { from, to } = library()
  mkdirSync(join(to, 'gc'), { recursive: true })
  writeFileSync(join(to, 'gc', 'one.rvz'), 'already here')
  const plan = await planLibraryMove(
    [rom(1, join(from, 'gc', 'one.rvz')), rom(2, join(from, 'gc', 'gone.rvz'))],
    from,
    to
  )
  assert.deepEqual(plan.missing, [2])
  assert.deepEqual(plan.taken, [1])
  assert.deepEqual(
    plan.games.map((game) => game.romId),
    [1]
  )
})

test('the same folder, or one inside the library, is refused with nothing listed', async () => {
  const { home, from } = library()
  const games = [rom(1, join(from, 'gc', 'one.rvz'))]
  symlinkSync(from, join(home, 'link'))

  const same = await planLibraryMove(games, from, join(home, 'link'))
  assert.equal(same.refused, 'same-folder')
  assert.deepEqual(same.games, [])

  const inside = await planLibraryMove(games, from, join(from, 'gc', 'new'))
  assert.equal(inside.refused, 'inside-library')
  assert.deepEqual(inside.games, [])

  // Only below the library counts: a sibling whose name starts the same way is
  // a folder of its own.
  const sibling = await planLibraryMove(games, from, `${from}-sd`)
  assert.equal(sibling.refused, null)
  assert.equal(sibling.games.length, 1)

  // A folder whose name only starts with dots is inside the library's parent,
  // not above it, and the parent itself is a place the library can go.
  const dotted = await planLibraryMove(games, from, join(home, '..roms'))
  assert.equal(dotted.refused, null)
  const parent = await planLibraryMove(games, from, home)
  assert.equal(parent.refused, null)
  assert.deepEqual(
    parent.games.map((game) => game.to),
    [join(home, 'gc', 'one.rvz')]
  )
})

test('on one drive the games fit however big they are, since they are renamed', async () => {
  const { from, to } = library()
  // Sparse: bigger than the room left to `stat`, nothing on the disk.
  const room = statfsSync(from)
  truncateSync(join(from, 'gc', 'one.rvz'), room.bavail * room.bsize + 2 ** 30)
  const plan = await planLibraryMove([rom(1, join(from, 'gc', 'one.rvz'))], from, to)
  assert.equal(plan.sameDrive, true)
  assert.ok(plan.freeBytes !== null && plan.totalBytes > plan.freeBytes)
  assert.equal(plan.fits, true)
})

test('a library reached through a link is planned from the folder it leads to', async () => {
  const { home, from, to } = library()
  symlinkSync(from, join(home, 'NovaSD'))
  const plan = await planLibraryMove(
    [rom(1, join(home, 'NovaSD', 'gc', 'one.rvz'))],
    join(home, 'NovaSD'),
    to
  )
  assert.equal(plan.from, from)
  assert.deepEqual(
    plan.games.map((game) => [game.from, game.to]),
    [[join(from, 'gc', 'one.rvz'), join(to, 'gc', 'one.rvz')]]
  )
})

test('on another drive the games have to fit in the room there', async () => {
  const { from } = library()
  // /proc is a filesystem of its own with no room to give.
  const plan = await planLibraryMove([rom(1, join(from, 'gc', 'one.rvz'))], from, '/proc/galleon')
  assert.equal(plan.sameDrive, false)
  assert.equal(plan.freeBytes, 0)
  assert.equal(plan.fits, false)
})

function memoryIndex(entries: InstalledRom[]): MoveIndex & { entries: Map<number, InstalledRom> } {
  const map = new Map(entries.map((entry) => [entry.romId, entry]))
  return {
    entries: map,
    getInstalled: (romId) => map.get(romId),
    addInstalled: (entry) => void map.set(entry.romId, entry)
  }
}

function looseLibrary(): { from: string; to: string; games: InstalledRom[] } {
  const { from, to } = library()
  writeFileSync(join(from, 'psx', 'loose.cue'), 'cue')
  writeFileSync(join(from, 'psx', 'loose.bin'), Buffer.alloc(300))
  const games = [
    rom(1, join(from, 'gc', 'one.rvz'), { files: ['one.rvz'] }),
    rom(2, join(from, 'psx', 'Disc Game'), {
      isDirectory: true,
      system: 'psx',
      launchPath: join(from, 'psx', 'Disc Game', 'game.cue'),
      files: ['game.bin', 'game.cue']
    }),
    rom(3, join(from, 'psx', 'loose.cue'), { system: 'psx', files: ['loose.bin', 'loose.cue'] })
  ]
  return { from, to, games }
}

test("a loose game's files beside it are carried and counted with it", async () => {
  const { from, to, games } = looseLibrary()
  const plan = await planLibraryMove(games, from, to)
  const loose = plan.games.find((game) => game.romId === 3)
  assert.deepEqual(
    loose?.parts.map((part) => part.to),
    [join(to, 'psx', 'loose.cue'), join(to, 'psx', 'loose.bin')]
  )
  assert.equal(loose?.sizeBytes, 303)
})

for (const sameDrive of [true, false]) {
  test(`${sameDrive ? 'renamed on one drive' : 'copied to another drive'}, every game ends up in the new folder and the index says so`, async () => {
    const { from, to, games } = looseLibrary()
    const index = memoryIndex(games)
    const plan = { ...(await planLibraryMove(games, from, to)), sameDrive }
    const result = await moveLibrary(plan, index)

    assert.deepEqual(result, { moved: [1, 2, 3], skipped: [], failed: null, leftovers: [] })
    assert.equal(readFileSync(join(to, 'psx', 'Disc Game', 'game.bin')).length, 5000)
    assert.equal(readFileSync(join(to, 'psx', 'loose.bin')).length, 300)
    for (const gone of ['gc/one.rvz', 'psx/Disc Game', 'psx/loose.cue', 'psx/loose.bin'])
      assert.equal(existsSync(join(from, gone)), false, gone)
    assert.deepEqual(readdirSync(join(to, 'psx')).sort(), ['Disc Game', 'loose.bin', 'loose.cue'])
    assert.deepEqual(
      [...index.entries.values()].map((entry) => [entry.path, entry.launchPath, entry.files]),
      [
        [join(to, 'gc', 'one.rvz'), join(to, 'gc', 'one.rvz'), ['one.rvz']],
        [
          join(to, 'psx', 'Disc Game'),
          join(to, 'psx', 'Disc Game', 'game.cue'),
          ['game.bin', 'game.cue']
        ],
        [join(to, 'psx', 'loose.cue'), join(to, 'psx', 'loose.cue'), ['loose.bin', 'loose.cue']]
      ]
    )
  })
}

test('a game whose new place is taken stays where it is, and nothing there is replaced', async () => {
  const { from, to, games } = looseLibrary()
  const index = memoryIndex(games)
  const plan = await planLibraryMove(games, from, to)
  // Appears after the plan was made, so only the move itself can see it.
  mkdirSync(join(to, 'psx'), { recursive: true })
  writeFileSync(join(to, 'psx', 'loose.bin'), 'someone else')

  const result = await moveLibrary(plan, index)
  assert.deepEqual(result, { moved: [1, 2], skipped: [3], failed: null, leftovers: [] })
  assert.equal(readFileSync(join(to, 'psx', 'loose.bin'), 'utf8'), 'someone else')
  assert.equal(existsSync(join(from, 'psx', 'loose.cue')), true)
  assert.equal(index.entries.get(3)?.path, join(from, 'psx', 'loose.cue'))
})

test('a copy that fails takes its copies away, keeps the original, and stops the move', async () => {
  const { from, to, games } = looseLibrary()
  const index = memoryIndex(games)
  const planned = await planLibraryMove(games, from, to)
  // The loose game first, with a part that has gone since the plan.
  const loose = planned.games[2]
  const broken = {
    ...loose,
    parts: [
      ...loose.parts,
      { from: join(from, 'psx', 'loose.sub'), to: join(to, 'psx', 'loose.sub') }
    ]
  }
  const plan = { ...planned, sameDrive: false, games: [broken, ...planned.games.slice(0, 2)] }

  const result = await moveLibrary(plan, index)
  assert.deepEqual(result.moved, [])
  assert.equal(result.failed?.romId, 3)
  assert.equal(existsSync(join(from, 'psx', 'loose.cue')), true)
  assert.equal(existsSync(join(from, 'psx', 'loose.bin')), true)
  assert.deepEqual(readdirSync(join(to, 'psx')), [])
  assert.equal(existsSync(join(to, 'gc')), false)
  assert.equal(index.entries.get(3)?.path, join(from, 'psx', 'loose.cue'))
})

test('a refused plan moves nothing', async () => {
  const { from, games } = looseLibrary()
  const index = memoryIndex(games)
  const plan = await planLibraryMove(games, from, from)
  assert.deepEqual(await moveLibrary(plan, index), {
    moved: [],
    skipped: [],
    failed: null,
    leftovers: []
  })
  assert.equal(existsSync(join(from, 'gc', 'one.rvz')), true)
})

test('a copy that comes out short is never named, and the original is kept', async () => {
  const { from, to, games } = looseLibrary()
  const index = memoryIndex(games)
  const plan = { ...(await planLibraryMove(games, from, to)), sameDrive: false }
  // A copy that stops early without saying so, as a card pulled mid-write can.
  const short = async (source: string, target: string): Promise<void> => {
    if (source.endsWith('loose.bin')) writeFileSync(target, Buffer.alloc(10))
    else await cp(source, target, { recursive: true })
  }

  const result = await moveLibrary(plan, index, short)
  assert.deepEqual(result.moved, [1, 2])
  assert.equal(result.failed?.romId, 3)
  assert.match(result.failed?.reason ?? '', /Game 3/)
  assert.equal(readFileSync(join(from, 'psx', 'loose.bin')).length, 300)
  assert.equal(existsSync(join(from, 'psx', 'loose.cue')), true)
  assert.deepEqual(readdirSync(join(to, 'psx')), ['Disc Game'])
  assert.equal(index.entries.get(3)?.path, join(from, 'psx', 'loose.cue'))
})

test('on one drive a game that fails part-way is renamed back, whole, where it was', async () => {
  const { from, to, games } = looseLibrary()
  const index = memoryIndex(games)
  const plan = await planLibraryMove([games[2]], from, to)
  // Gone after the plan, so the second rename fails after the first is done.
  rmSync(join(from, 'psx', 'loose.bin'))

  const result = await moveLibrary(plan, index)
  assert.equal(result.failed?.romId, 3)
  assert.equal(existsSync(join(from, 'psx', 'loose.cue')), true)
  assert.equal(existsSync(join(to, 'psx', 'loose.cue')), false)
  assert.equal(index.entries.get(3)?.path, join(from, 'psx', 'loose.cue'))
})

test('a game the index has somewhere else since the plan is not moved', async () => {
  const { from, to, games } = looseLibrary()
  const index = memoryIndex(games)
  const plan = await planLibraryMove(games, from, to)
  index.addInstalled({ ...games[0], path: join(from, 'gc', 'reinstalled.rvz') })

  const result = await moveLibrary(plan, index)
  assert.deepEqual(result.moved, [2, 3])
  assert.equal(existsSync(join(from, 'gc', 'one.rvz')), true)
  assert.equal(index.entries.get(1)?.path, join(from, 'gc', 'reinstalled.rvz'))
})

test('a link inside a game folder still leads to its file after a copy to another drive', async () => {
  const { from, to, games } = looseLibrary()
  symlinkSync('game.bin', join(from, 'psx', 'Disc Game', 'alias.bin'))
  const index = memoryIndex(games)
  const plan = { ...(await planLibraryMove([games[1]], from, to)), sameDrive: false }

  assert.deepEqual((await moveLibrary(plan, index)).moved, [2])
  assert.equal(readFileSync(join(to, 'psx', 'Disc Game', 'alias.bin')).length, 5000)
})

test('a game copied to another drive is in the index before its original goes', async () => {
  const { from, to, games } = looseLibrary()
  const index = memoryIndex(games)
  const originalsWhenIndexed: boolean[] = []
  const add = index.addInstalled
  index.addInstalled = (entry) => {
    originalsWhenIndexed.push(existsSync(join(from, 'psx', 'Disc Game')))
    add(entry)
  }
  const plan = { ...(await planLibraryMove([games[1]], from, to)), sameDrive: false }

  assert.deepEqual((await moveLibrary(plan, index)).moved, [2])
  assert.deepEqual(originalsWhenIndexed, [true])
  assert.equal(existsSync(join(from, 'psx', 'Disc Game')), false)
})

test('an index that cannot be written leaves the original in place', async () => {
  const { from, to, games } = looseLibrary()
  const index = memoryIndex(games)
  index.addInstalled = () => {
    throw new Error('disk full')
  }
  const plan = { ...(await planLibraryMove([games[1]], from, to)), sameDrive: false }

  await assert.rejects(moveLibrary(plan, index), /disk full/)
  assert.equal(readFileSync(join(from, 'psx', 'Disc Game', 'game.bin')).length, 5000)
})
