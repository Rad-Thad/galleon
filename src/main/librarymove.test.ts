/**
 * What changing the library folder would move: the shared library's games
 * with their sizes off the disk, the room where they would go, and the moves
 * that cannot be made at all.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHARED_LIBRARY, type InstalledRom } from '@shared/types'
import { planLibraryMove } from './librarymove.ts'

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
