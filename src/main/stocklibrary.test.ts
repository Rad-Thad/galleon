/**
 * Stock RomMix's games from before Galleon: found for the same server only,
 * adopted where they are, or moved into the library, with stock RomMix's own
 * files left as they were.
 */

import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHARED_LIBRARY, type InstalledRom } from '@shared/types'
import { moveLibrary, type CopyPart } from './librarymove.ts'
import {
  adoptStockLibrary,
  moveStockLibrary,
  planStockMove,
  readStockLibrary,
  stockRomMixRoot,
  type StockSources
} from './stocklibrary.ts'

const SERVER = 'http://romm.test:8080'
const scratches: string[] = []
const saved = {
  home: process.env.GALLEON_HOME,
  HOME: process.env.HOME,
  xdg: process.env.XDG_CONFIG_HOME
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  delete process.env.GALLEON_HOME
})
afterEach(() => {
  restore('GALLEON_HOME', saved.home)
  restore('HOME', saved.HOME)
  restore('XDG_CONFIG_HOME', saved.xdg)
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-stocklibrary-test-'))
  scratches.push(dir)
  return dir
}

function entry(romId: number, path: string, extra: Record<string, unknown> = {}): object {
  return {
    romId,
    path,
    launchPath: path,
    name: `Game ${romId}`,
    coverPath: null,
    files: [path.split('/').pop()],
    system: 'gc',
    platformName: 'GameCube',
    sizeBytes: 1,
    installedAt: '2026-10-08T00:00:00Z',
    isDirectory: false,
    emulatorId: SHARED_LIBRARY,
    ...extra
  }
}

/** Stock RomMix's home as Phase 0 left it, with what its index says. */
function stockHome(roms: (folder: string) => unknown[], server = `${SERVER}/`): string {
  const root = join(scratch(), 'rommix')
  const folder = join(root, 'roms')
  mkdirSync(join(root, 'config'), { recursive: true })
  mkdirSync(join(folder, 'gc'), { recursive: true })
  mkdirSync(join(folder, 'psx', 'Disc Game'), { recursive: true })
  writeFileSync(join(folder, 'gc', 'one.rvz'), Buffer.alloc(1000))
  writeFileSync(join(folder, 'gc', 'two.rvz'), Buffer.alloc(2000))
  writeFileSync(join(folder, 'psx', 'Disc Game', 'game.cue'), 'cue')
  writeFileSync(
    join(root, 'config', 'settings.json'),
    JSON.stringify({ settings: {}, server: { baseUrl: server, authMode: 'token' } })
  )
  writeFileSync(
    join(root, 'config', 'downloaded_roms.json'),
    JSON.stringify({ roms: roms(folder) })
  )
  return root
}

function phase0(root?: string): string {
  return (
    root ??
    stockHome((folder) => [
      entry(1, join(folder, 'gc', 'one.rvz')),
      entry(2, join(folder, 'psx', 'Disc Game'), {
        isDirectory: true,
        system: 'psx',
        launchPath: join(folder, 'psx', 'Disc Game', 'game.cue'),
        files: ['game.cue']
      })
    ])
  )
}

const none = (): boolean => false

/** Galleon's side: an index in memory and the library folder in a scratch. */
function galleon(
  extra: Partial<StockSources> = {},
  start: InstalledRom[] = []
): StockSources & { entries: Map<number, InstalledRom>; library: string } {
  const entries = new Map(start.map((rom) => [rom.romId, rom]))
  const library = join(scratch(), 'card', 'galleon', 'roms')
  return {
    entries,
    library,
    installed: () => [...entries.values()],
    index: {
      getInstalled: (romId) => entries.get(romId),
      addInstalled: (rom) => void entries.set(rom.romId, rom),
      addInstalledMany: (roms) => {
        for (const rom of roms) entries.set(rom.romId, rom)
      }
    },
    libraryRoot: () => '',
    folderOf: () => library,
    downloading: () => false,
    prepare: async (dir) => {
      mkdirSync(dir, { recursive: true })
      return true
    },
    setLibraryRoot: async () => {
      throw new Error('a stock move never changes the library folder')
    },
    ...extra
  }
}

test("stock RomMix's home is its pointer's folder, or ~/rommix without one", () => {
  const home = scratch()
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = join(home, '.config')
  assert.equal(stockRomMixRoot(), join(home, 'rommix'))

  mkdirSync(join(home, '.config', 'rommix'), { recursive: true })
  writeFileSync(join(home, '.config', 'rommix', 'root'), '/media/elsewhere/rommix\n')
  assert.equal(stockRomMixRoot(), '/media/elsewhere/rommix')
})

test('the shared-library games of the same server are found, by their index', () => {
  const root = phase0()
  const stock = readStockLibrary(root, 'HTTP://romm.test:8080', none)
  assert.equal(stock?.folder, join(root, 'roms'))
  assert.deepEqual(
    stock?.games.map((game) => [game.romId, game.path, game.launchPath, game.isDirectory]),
    [
      [1, join(root, 'roms', 'gc', 'one.rvz'), join(root, 'roms', 'gc', 'one.rvz'), false],
      [
        2,
        join(root, 'roms', 'psx', 'Disc Game'),
        join(root, 'roms', 'psx', 'Disc Game', 'game.cue'),
        true
      ]
    ]
  )
  assert.equal(stock?.games[0].emulatorId, SHARED_LIBRARY)
})

test('nothing is offered for another server, before sign-in, or under GALLEON_HOME', () => {
  const root = phase0()
  assert.equal(readStockLibrary(root, 'http://other.test:8080', none), null)
  assert.equal(readStockLibrary(root, null, none), null)
  assert.equal(readStockLibrary(join(scratch(), 'absent'), SERVER, none), null)
  process.env.GALLEON_HOME = scratch()
  assert.equal(readStockLibrary(root, SERVER, none), null, "a test home never touches stock's")
})

test('only entries for games in its folder, still on the disk and not yet known, are taken', () => {
  const outside = join(scratch(), 'outside.rvz')
  writeFileSync(outside, 'x')
  const root = stockHome((folder) => [
    entry(1, join(folder, 'gc', 'one.rvz')),
    entry(1, join(folder, 'gc', 'two.rvz')),
    entry(3, join(folder, 'gc', 'two.rvz')),
    entry(4, join(folder, 'gc', 'gone.rvz')),
    entry(5, outside),
    entry(6, join(folder, '..', 'config', 'settings.json')),
    entry(7, join(folder, 'gc', 'two.rvz'), { emulatorId: 'dolphin' }),
    entry(8, join(folder, 'gc', 'two.rvz'), { launchPath: outside }),
    entry(9, 'gc/two.rvz'),
    entry(10, folder),
    { ...entry(11, join(folder, 'gc', 'two.rvz')), romId: '11' },
    'not an entry',
    entry(12, join(folder, 'gc', 'two.rvz'), { name: undefined, files: 'two.rvz' })
  ])
  const stock = readStockLibrary(root, SERVER, (romId) => romId === 3)
  assert.deepEqual(
    stock?.games.map((game) => game.romId),
    [1, 12]
  )
  assert.equal(stock?.games[1].name, 'two.rvz', 'a game with no name is called by its file')
  assert.deepEqual(stock?.games[1].files, [])
})

test('adopting records the games where they are and leaves stock RomMix alone', () => {
  const root = phase0()
  const index = readFileSync(join(root, 'config', 'downloaded_roms.json'), 'utf8')
  const sources = galleon()
  const stock = readStockLibrary(root, SERVER, none)
  assert.ok(stock)
  assert.equal(adoptStockLibrary(sources, stock), 2)
  assert.equal(sources.entries.get(1)?.path, join(root, 'roms', 'gc', 'one.rvz'))
  assert.equal(existsSync(join(root, 'roms', 'gc', 'one.rvz')), true)
  assert.equal(readFileSync(join(root, 'config', 'downloaded_roms.json'), 'utf8'), index)
  assert.equal(
    readStockLibrary(root, SERVER, (romId) => sources.entries.has(romId))?.games.length,
    0,
    'adopted games are not offered again'
  )
})

test('the move plan has the games with their sizes, adopted earlier or not', async () => {
  const root = phase0()
  const sources = galleon()
  const all = readStockLibrary(root, SERVER, none)
  assert.ok(all)
  sources.index.addInstalledMany(all.games.slice(0, 1))
  const rest = readStockLibrary(root, SERVER, (romId) => sources.entries.has(romId))
  assert.ok(rest)
  const plan = await planStockMove(sources, rest)
  assert.deepEqual(
    plan.games.map((game) => [game.romId, game.sizeBytes, game.to]),
    [
      [1, 1000, join(sources.library, 'gc', 'one.rvz')],
      [2, 3, join(sources.library, 'psx', 'Disc Game')]
    ]
  )
  assert.equal(plan.totalBytes, 1003)
})

test('moving adopts the games and carries them into the library', async () => {
  const root = phase0()
  const index = readFileSync(join(root, 'config', 'downloaded_roms.json'), 'utf8')
  const sources = galleon()
  const stock = readStockLibrary(root, SERVER, none)
  assert.ok(stock)
  const result = await moveStockLibrary(sources, stock)
  assert.deepEqual(result, { moved: [1, 2], skipped: [], failed: null, leftovers: [] })
  assert.equal(sources.entries.get(1)?.path, join(sources.library, 'gc', 'one.rvz'))
  assert.equal(
    sources.entries.get(2)?.launchPath,
    join(sources.library, 'psx', 'Disc Game', 'game.cue')
  )
  assert.equal(existsSync(join(sources.library, 'gc', 'one.rvz')), true)
  assert.equal(existsSync(join(root, 'roms', 'gc', 'one.rvz')), false)
  assert.equal(readFileSync(join(root, 'config', 'downloaded_roms.json'), 'utf8'), index)
})

for (const [why, extra, key] of [
  ['a download is under way', { downloading: () => true }, 'downloading'],
  ['the library has no room', { folderOf: () => '/proc/galleon' }, 'not enough room'],
  ['the library cannot be written to', { prepare: async () => false }, 'cannot write']
] as const) {
  test(`nothing is adopted or moved when ${why}`, async () => {
    const root = phase0()
    const sources = galleon(extra)
    const stock = readStockLibrary(root, SERVER, none)
    assert.ok(stock)
    await assert.rejects(moveStockLibrary(sources, stock), new RegExp(key))
    assert.equal(sources.entries.size, 0)
    assert.equal(existsSync(join(root, 'roms', 'gc', 'one.rvz')), true)
  })
}

test('a move that stops part-way leaves the rest adopted where they are, and asking again finishes it', async () => {
  const root = phase0()
  const sources = galleon()
  let copies = 0
  const failsSecond: CopyPart = async (source, target) => {
    if (++copies === 2) throw new Error('the card was pulled')
    await cp(source, target, { recursive: true })
  }
  const first = readStockLibrary(root, SERVER, none)
  assert.ok(first)
  const stopped = await moveStockLibrary(sources, first, (plan, index) =>
    moveLibrary({ ...plan, sameDrive: false }, index, failsSecond)
  )
  assert.deepEqual(stopped.moved, [1])
  assert.equal(stopped.failed?.romId, 2)
  assert.equal(sources.entries.get(2)?.path, join(root, 'roms', 'psx', 'Disc Game'))

  const again = readStockLibrary(root, SERVER, (romId) => sources.entries.has(romId))
  assert.ok(again)
  assert.equal(again.games.length, 0)
  const finished = await moveStockLibrary(sources, again)
  assert.deepEqual(finished.moved, [2])
  assert.equal(sources.entries.get(2)?.path, join(sources.library, 'psx', 'Disc Game'))
})
