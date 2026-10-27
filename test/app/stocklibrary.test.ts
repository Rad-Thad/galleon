import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { SHARED_LIBRARY, type InstalledRom } from '@shared/types'
import { startScenario, type Scenario } from './harness.ts'

/**
 * Stock RomMix's games from before Galleon, offered in Settings and adopted or
 * moved with the pad.
 *
 * Galleon never offers them under `GALLEON_HOME` (see `readStockLibrary`), so
 * this scenario alone runs without it: the whole user home is a scratch
 * folder, with Galleon's root named by its pointer there and stock RomMix in
 * `~/rommix` beside it, the layout Phase 0 left on the device.
 */

const scratch = mkdtempSync(join(tmpdir(), 'galleon-app-stock-'))
const USER = join(scratch, 'user')
const HOME = join(scratch, 'galleon')
const STOCK = join(USER, 'rommix')
const LIBRARY = join(HOME, 'roms')

function stockGame(romId: number, system: string, file: string, size: number): InstalledRom {
  const path = join(STOCK, 'roms', system, file)
  mkdirSync(join(STOCK, 'roms', system), { recursive: true })
  writeFileSync(path, Buffer.alloc(size, romId))
  return {
    romId,
    path,
    launchPath: path,
    name: `Stock game ${romId}`,
    coverPath: null,
    files: [file],
    system,
    platformName: system,
    sizeBytes: size,
    installedAt: '2026-09-01T00:00:00.000Z',
    isDirectory: false,
    emulatorId: SHARED_LIBRARY
  }
}

const games = [stockGame(1, 'genesis', 'cavestory.md', 4096), stockGame(2, 'gba', 'tiny.gba', 2048)]
const stockIndex = JSON.stringify({ roms: games })

let scenario: Scenario
let app: Scenario['app']

before(async () => {
  mkdirSync(join(USER, '.config', 'galleon'), { recursive: true })
  writeFileSync(join(USER, '.config', 'galleon', 'root'), HOME)
  scenario = await startScenario({
    home: HOME,
    env: { GALLEON_HOME: '', HOME: USER, XDG_CONFIG_HOME: join(USER, '.config') }
  })
  ;({ app } = scenario)
  // Signed in to the same server as Galleon, which is only known once it runs.
  mkdirSync(join(STOCK, 'config'), { recursive: true })
  writeFileSync(
    join(STOCK, 'config', 'settings.json'),
    JSON.stringify({ server: { baseUrl: scenario.server.baseUrl } })
  )
  writeFileSync(join(STOCK, 'config', 'downloaded_roms.json'), stockIndex)

  await app.goTo('settings')
  await app.waitFor(`document.querySelector('[data-tab="games"]')`, 'the settings tabs')
  await app.choose('[data-tab="games"]')
  await app.waitFor(`document.querySelector('[data-stock]')`, "stock RomMix's games")
})

after(async () => {
  await scenario?.stop()
  rmSync(scratch, { recursive: true, force: true })
})

const installed = (): Promise<InstalledRom[]> =>
  app.read<InstalledRom[]>(`await window.rommix.library.installed()`)

describe("stock RomMix's games in Settings", () => {
  test('both games are offered, to use where they are or to move', async () => {
    const row = await app.read<string>(`document.querySelector('[data-stock]').textContent`)
    assert.match(row, /2 games RomMix downloaded before Galleon/)
    assert.match(row, /6(\.0)?\s?KB to move/)
    assert.equal(
      await app.read<boolean>(`!!document.querySelector('[data-action="stock-adopt"]')`),
      true
    )
    assert.equal(
      await app.read<boolean>(`!!document.querySelector('[data-action="stock-move"]')`),
      true
    )
  })

  test('using them where they are records them, and leaves stock RomMix alone', async () => {
    await app.choose('[data-action="stock-adopt"]')
    await app.waitFor(
      `!document.querySelector('[data-action="stock-adopt"]')`,
      'the offer to stop asking to adopt'
    )
    assert.deepEqual(
      (await installed()).map((one) => one.path).sort(),
      games.map((one) => one.path).sort()
    )
    assert.equal(readFileSync(join(STOCK, 'config', 'downloaded_roms.json'), 'utf8'), stockIndex)
    const row = await app.read<string>(`document.querySelector('[data-stock]').textContent`)
    assert.match(row, /2 games are still in RomMix’s folder/)
  })

  test('moving shows each game and its size first, then carries them into the library', async () => {
    await app.choose('[data-action="stock-move"]')
    await app.waitFor(
      `document.querySelector('[data-games] [data-rom="2"]')`,
      'the plan to list the games'
    )
    const listed = await app.read<string>(`document.querySelector('[data-games]').textContent`)
    assert.match(listed, /Stock game 1.*4(\.0)?\s?KB/)
    assert.match(listed, /Stock game 2.*2(\.0)?\s?KB/)
    assert.equal(existsSync(join(LIBRARY, 'genesis', 'cavestory.md')), false, 'nothing moved yet')

    await app.choose('[data-action="library-move-confirm"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the move to finish')
    assert.equal(readFileSync(join(LIBRARY, 'genesis', 'cavestory.md')).length, 4096)
    assert.equal(readFileSync(join(LIBRARY, 'gba', 'tiny.gba')).length, 2048)
    assert.equal(existsSync(games[0].path), false)
    assert.deepEqual((await installed()).map((one) => one.path).sort(), [
      join(LIBRARY, 'gba', 'tiny.gba'),
      join(LIBRARY, 'genesis', 'cavestory.md')
    ])
    await app.waitFor(`!document.querySelector('[data-stock]')`, 'the offer to go')
  })
})
