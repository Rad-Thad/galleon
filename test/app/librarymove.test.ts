import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  SHARED_LIBRARY,
  type InstalledRom,
  type LibraryFolderChange,
  type LibraryFolderChoice,
  type LibraryMovePlan,
  type Settings
} from '@shared/types'
import { startScenario, type Scenario } from './harness.ts'

/**
 * Moving the library to another folder through the channels Settings uses:
 * where it can go, what would move, and the move.
 *
 * The library starts in a folder outside the home, holding one game, so the
 * move is between two folders the test made and can look into.
 */

const scratch = mkdtempSync(join(tmpdir(), 'galleon-app-librarymove-'))
const FROM = join(scratch, 'old')
const TO = join(scratch, 'new')
const GAME = join(FROM, 'genesis', 'cavestory.md')

const game: InstalledRom = {
  romId: 1,
  path: GAME,
  launchPath: GAME,
  name: 'Cave Story MD',
  coverPath: null,
  files: ['cavestory.md'],
  system: 'genesis',
  platformName: 'Sega Mega Drive',
  sizeBytes: 4096,
  installedAt: '2026-10-01T00:00:00.000Z',
  isDirectory: false,
  emulatorId: SHARED_LIBRARY
}

let scenario: Scenario
let app: Scenario['app']

before(async () => {
  mkdirSync(join(FROM, 'genesis'), { recursive: true })
  writeFileSync(GAME, Buffer.alloc(4096, 1))
  scenario = await startScenario({
    files: { 'config/downloaded_roms.json': JSON.stringify({ roms: [game] }) },
    settings: { libraryRoot: FROM }
  })
  ;({ app } = scenario)
})

after(async () => {
  await scenario?.stop()
  rmSync(scratch, { recursive: true, force: true })
})

describe('moving the library to another folder', () => {
  test('the folders offered include the one in use, marked', async () => {
    const choices = await app.read<LibraryFolderChoice[]>(`await window.rommix.library.folders()`)
    assert.equal(choices[0].libraryRoot, '', "the root's own folder is always offered")
    assert.deepEqual(
      choices.filter((choice) => choice.current).map((choice) => choice.path),
      [FROM]
    )
  })

  test('the plan lists the game with its size, and nothing moves', async () => {
    const plan = await app.read<LibraryMovePlan>(
      `await window.rommix.library.planMove(${JSON.stringify(TO)})`
    )
    assert.equal(plan.refused, null)
    assert.deepEqual(
      plan.games.map((one) => [one.romId, one.sizeBytes, one.to]),
      [[1, 4096, join(TO, 'genesis', 'cavestory.md')]]
    )
    assert.equal(existsSync(GAME), true)
    assert.equal(existsSync(TO), false)
  })

  test('the move carries the game, indexes it there and makes the folder the library', async () => {
    const change = await app.read<LibraryFolderChange>(
      `await window.rommix.library.move(${JSON.stringify(TO)})`
    )
    assert.deepEqual(change, {
      moved: [1],
      skipped: [],
      failed: null,
      leftovers: [],
      libraryRoot: TO
    })
    assert.equal(existsSync(GAME), false)
    assert.equal(readFileSync(join(TO, 'genesis', 'cavestory.md')).length, 4096)

    const installed = await app.read<InstalledRom[]>(`await window.rommix.library.installed()`)
    assert.deepEqual(
      installed.map((one) => one.path),
      [join(TO, 'genesis', 'cavestory.md')]
    )
    const settings = await app.read<Settings>(`await window.rommix.system.settings()`)
    assert.equal(settings.libraryRoot, TO)
  })
})

/**
 * The same move from Settings, the way it is reached with a pad: the folder
 * list on the Games tab, the confirmation with the plan, then the move. Runs
 * after the move above, so the library starts in `TO` and goes back to the
 * root's own folder.
 */
describe('moving the library from Settings', () => {
  const home = `[data-folder=""] [data-action="library-move-here"]`
  let target: string

  before(async () => {
    const choices = await app.read<LibraryFolderChoice[]>(`await window.rommix.library.folders()`)
    target = choices.find((choice) => choice.libraryRoot === '')!.path
    await app.goTo('settings')
    await app.waitFor(`document.querySelector('[data-tab="games"]')`, 'the settings tabs')
    await app.choose('[data-tab="games"]')
    await app.waitFor(`document.querySelector(${JSON.stringify(home)})`, 'the folder list')
  })

  test('the folder in use is marked rather than offered', async () => {
    const offered = await app.read<string[]>(
      `[...document.querySelectorAll('[data-folder]')]
         .filter((row) => row.querySelector('[data-action="library-move-here"]'))
         .map((row) => row.dataset.folder)`
    )
    assert.equal(offered.includes(TO), false)
    assert.equal(offered.includes(''), true)
  })

  test('choosing a folder shows the game and its size, and keeping it moves nothing', async () => {
    await app.choose(home)
    await app.waitFor(
      `document.querySelector('[data-games] [data-rom="1"]')`,
      'the plan to list the game'
    )
    const row = await app.read<string>(
      `document.querySelector('[data-games] [data-rom="1"]').textContent`
    )
    assert.match(row, /Cave Story MD/)
    assert.match(row, /4(\.0)?\s?KB/)
    await app.choose('[data-action="library-move-keep"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the confirmation to close')
    assert.equal(existsSync(join(TO, 'genesis', 'cavestory.md')), true)
    const settings = await app.read<Settings>(`await window.rommix.system.settings()`)
    assert.equal(settings.libraryRoot, TO)
  })

  test('moving carries the game and the folder list follows', async () => {
    await app.choose(home)
    await app.waitFor(
      `document.querySelector('[data-action="library-move-confirm"]')`,
      'the Move button'
    )
    await app.choose('[data-action="library-move-confirm"]')
    await app.waitFor(`!document.querySelector('.overlay')`, 'the move to finish')
    assert.equal(existsSync(join(TO, 'genesis', 'cavestory.md')), false)
    assert.equal(readFileSync(join(target, 'genesis', 'cavestory.md')).length, 4096)
    const settings = await app.read<Settings>(`await window.rommix.system.settings()`)
    assert.equal(settings.libraryRoot, '')
    // The root's own folder is in use now, so it is marked rather than offered.
    await app.waitFor(
      `!document.querySelector(${JSON.stringify(home)}) && document.querySelector('[data-folder=""]')`,
      'the list to mark the new folder'
    )
  })
})
