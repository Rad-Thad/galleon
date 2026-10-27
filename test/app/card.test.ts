import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { en } from '@shared/i18n/en.ts'
import { SHARED_LIBRARY, type InstalledRom } from '@shared/types'
import { startScenario, type Scenario } from './harness.ts'

/**
 * A game downloaded to an SD card that has since been taken out.
 *
 * Seeded rather than downloaded: no runner has a card to take out, and a path
 * under `/run/media` that nothing is mounted on is exactly what the app sees
 * on the Nova once the card is gone (see `isOnMissingCard`).
 */

const CARD_GAME = '/run/media/galleon-app-test/NovaSD/galleon/roms/genesis/cavestory.md'

const onCard: InstalledRom = {
  romId: 1,
  path: CARD_GAME,
  launchPath: CARD_GAME,
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
  scenario = await startScenario({
    files: { 'config/downloaded_roms.json': JSON.stringify({ roms: [onCard] }) }
  })
  ;({ app } = scenario)
})

after(async () => {
  await scenario?.stop()
})

describe('a game on a card that is not inserted', () => {
  test('is still in the index after start-up, marked as on a missing card', async () => {
    const held = await app.read<InstalledRom[]>(`await window.rommix.library.installed()`)
    assert.deepEqual(
      held.map((one) => [one.romId, one.cardMissing]),
      [[1, true]]
    )
  })

  test('its game screen says the card is not inserted, and offers neither play nor download', async () => {
    await app.goTo('library')
    await app.choose('[data-rom="1"]')
    await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game screen')
    await app.waitFor(
      `document.querySelector('[data-action="card-not-inserted"]')`,
      'the card-not-inserted button'
    )

    const button = await app.read<{ text: string; disabled: boolean }>(
      `(() => {
        const one = document.querySelector('[data-action="card-not-inserted"]')
        return { text: one.textContent.trim(), disabled: one.dataset.disabled === 'true' }
      })()`
    )
    assert.equal(button.text, en['game.cardNotInserted'])
    assert.equal(button.disabled, true)

    const offered = await app.read<string[]>(
      `[...document.querySelectorAll('[data-action]')].map((one) => one.dataset.action)`
    )
    const lit = await app.read<string[]>(
      `[...document.querySelectorAll('.chip--on')].map((one) => one.textContent.trim())`
    )
    assert.ok(!lit.includes(en['library.downloadedMark']), `lit chips: ${lit}`)

    // Opening the page asks nothing that is refused for want of the card: a
    // refusal would surface as an error toast nobody pressed anything for.
    // Every request the page makes on opening has answered well within this.
    await new Promise((done) => setTimeout(done, 1500))
    const toasts = await app.read<string[]>(
      `[...document.querySelectorAll('.toast')].map((one) => one.textContent)`
    )
    assert.deepEqual(toasts, [])

    for (const action of ['play', 'download', 'uninstall', 'pull-saves', 'push-saves']) {
      assert.ok(!offered.includes(action), `${action} should not be offered, got ${offered}`)
    }
  })

  test('a launch asked for anyway is refused with the reason', async () => {
    const reason = await app.read<string>(
      `window.rommix.game.launch(1).then(() => 'launched', (cause) => String(cause.message))`
    )
    assert.ok(reason.includes(en['error.cardNotInserted']), reason)
  })

  test('a download asked for anyway is answered as already done, and nothing is fetched', async () => {
    const item = await app.read<{ state: string }>(`await window.rommix.downloads.start(1)`)
    assert.equal(item.state, 'done')
    const queued = await app.read<number>(`(await window.rommix.downloads.list()).length`)
    assert.equal(queued, 0)
  })

  test('the downloads screen lists it as on a card that is not inserted, with nothing to remove', async () => {
    await app.goTo('downloads')
    await app.waitFor(`document.querySelector('[data-system="genesis"]')`, 'its system')
    await app.choose('[data-system="genesis"]')
    await app.waitFor(`document.querySelector('.installed[data-rom="1"]')`, 'its row')

    const row = await app.read<{ meta: string; remove: boolean }>(
      `(() => {
        const one = document.querySelector('.installed[data-rom="1"]')
        return {
          meta: one.querySelector('.installed__meta').textContent,
          remove: Boolean(one.querySelector('[data-action="uninstall-game"]'))
        }
      })()`
    )
    assert.ok(row.meta.includes(en['game.cardNotInserted']), row.meta)
    assert.equal(row.remove, false)
  })
})
