import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { SteamGameEntry } from '@shared/types'
import { en } from '@shared/i18n/en.ts'
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
/** The chip's words, without the badge drawn while its icon has not loaded. */
const STEAM_CHIP_LABEL = `document.querySelector('[data-platform="steam"]')?.lastChild?.textContent`
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
  test('the library offers Steam as a platform, and Play hands the game to Steam', async () => {
    const { app } = scenario
    await app.goTo('library')
    await app.waitFor(`document.querySelector('[data-platform="steam"]')`, 'the Steam chip')
    assert.equal(await app.read<string>(STEAM_CHIP_LABEL), 'Steam (1)')
    await app.choose('[data-platform="steam"]')
    await app.waitFor(`document.querySelector('[data-steam="1145360"]')`, 'the Steam card')
    assert.equal(
      await app.read<number>(`document.querySelectorAll('.grid [data-rom]').length`),
      0,
      "the server's games are not on Steam's grid"
    )
    await app.choose('[data-steam="1145360"]')
    await app.waitFor(
      `document.body.innerText.includes('Hades is running in Steam')`,
      'the overlay for the game Play started'
    )
    await app.click('[data-action="back-from-steam"]')
    await app.waitFor(
      `!document.body.innerText.includes('Playing on Steam')`,
      'the overlay gone after Back'
    )
  })
  test("leaving Steam's chip, either way, brings the server's grid back", async () => {
    const { app } = scenario
    const steamActive = `document.querySelector('[data-platform="steam"]').dataset.active === 'true'`
    await app.goTo('library')
    for (const way of [
      '[data-platform="all"]',
      '[data-platform]:not([data-platform="all"]):not([data-platform="steam"])'
    ]) {
      await app.choose('[data-platform="steam"]')
      await app.waitFor(`!document.querySelector('.grid [data-rom]')`, 'the server grid stood down')
      await app.choose(way)
      await app.waitFor(
        `document.querySelector('.grid [data-rom]')`,
        `the server grid back after ${way}`
      )
      assert.equal(await app.read<boolean>(steamActive), false)
      assert.equal(await app.read<number>(`document.querySelectorAll('[data-steam]').length`), 0)
    }
  })

  test("the search box narrows Steam's games, and the chip stays to leave by", async () => {
    const { app } = scenario
    await app.goTo('library')
    await app.choose('[data-platform="steam"]')
    await app.press('Search')
    await app.waitFor(`document.activeElement?.tagName === 'INPUT'`, 'the caret in the box')
    await app.type('hAd')
    await app.waitFor(`${STEAM_CHIP_LABEL} === 'Steam (1)'`, 'the chip counting the match')
    assert.ok(await app.read<boolean>(`!!document.querySelector('[data-steam="1145360"]')`))
    await app.type('zz')
    await app.waitFor(`!document.querySelector('[data-steam]')`, 'the Steam card gone')
    await app.waitFor(
      `[...document.querySelectorAll('.empty')].some((one) => one.textContent === ${JSON.stringify(en['library.noMatches'])})`,
      'the screen saying nothing matched'
    )
    assert.equal(await app.read<string>(STEAM_CHIP_LABEL), 'Steam (0)')
    await app.press('Escape')
    await app.waitFor(`document.activeElement?.tagName !== 'INPUT'`, 'the caret to come back')
    await app.goTo('home')
  })
})
