import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { SteamGameEntry } from '@shared/types'
import { startScenario, type Scenario } from './harness.ts'

/**
 * M1-14: Steam's installed games over IPC, and the overlay a Steam game gets.
 *
 * A home of its own holding Steam's files, so the scan is the real one. No
 * Steam client is on a test machine, so the `steam` command fails to start:
 * that is logged and the overlay stays up, as it would while a real Steam
 * brings the game up.
 */
let scenario: Scenario
const home = mkdtempSync(join(tmpdir(), 'galleon-steam-home-'))

function manifest(appid: string, name: string, flags: string): string {
  return `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"installdir"\t\t"${name}"\n\t"SizeOnDisk"\t\t"2048"\n}\n`
}

before(async () => {
  const steamapps = join(home, '.local', 'share', 'Steam', 'steamapps')
  mkdirSync(steamapps, { recursive: true })
  writeFileSync(join(steamapps, 'appmanifest_1145360.acf'), manifest('1145360', 'Hades', '4'))
  writeFileSync(
    join(steamapps, 'appmanifest_1493710.acf'),
    manifest('1493710', 'Proton Experimental', '4')
  )
  writeFileSync(join(steamapps, 'appmanifest_413150.acf'), manifest('413150', 'Stardew', '1026'))
  scenario = await startScenario({ env: { HOME: home } })
})

after(async () => {
  await scenario?.stop()
  rmSync(home, { recursive: true, force: true })
})

describe('Steam games', () => {
  test('lists the installed games, without partial installs or tools', async () => {
    const games = await scenario.app.read<SteamGameEntry[]>(`await window.rommix.steam.games()`)
    assert.deepEqual(games, [{ appid: '1145360', name: 'Hades', sizeOnDisk: 2048 }])
  })

  test('an appid the list does not offer is refused', async () => {
    const refused = await scenario.app.read<string>(
      `await window.rommix.steam.launch('413150').then(() => 'launched', (e) => e.message)`
    )
    assert.match(refused, /no longer installed/)
  })

  test("the overlay says 'Playing on Steam', and Back lowers it", async () => {
    const { app } = scenario
    await app.read(`window.rommix.steam.launch('1145360'), true`)
    await app.waitFor(
      `document.body.innerText.includes('Playing on Steam')`,
      "the overlay saying 'Playing on Steam'"
    )
    assert.ok(
      await app.read<boolean>(`document.body.innerText.includes('Hades is running in Steam')`)
    )
    await app.click('[data-action="back-from-steam"]')
    await app.waitFor(
      `!document.body.innerText.includes('Playing on Steam')`,
      'the overlay gone after Back'
    )
  })
})
