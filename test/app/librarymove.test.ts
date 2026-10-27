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
