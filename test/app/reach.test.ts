import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startApp, type App } from './driver.ts'
import { startScenario, type Scenario } from './harness.ts'
import { startFakeRomm } from './server.ts'

/**
 * M1-15: every control on every screen can be reached with the d-pad at the
 * Nova's 1280x960, and is in full view when it is.
 *
 * Each screen is reached as a player reaches it, then every enabled control
 * on it (every focusable, which includes every `data-action`) is walked onto
 * with direction presses alone (`reach`, the same homing walk `choose` uses,
 * which never presses select). The navigation bar is left out: it is a zone
 * entered with Back rather than by direction, and `goTo` walks it on every
 * screen here. In view means inside the window and clear of the hint bar,
 * which is drawn over the bottom of the page: a control the engine leaves
 * under it cannot be read.
 *
 * The running overlay is not walked: the pad is handed to the game while one
 * runs (see `useSuspendGamepad`), and `running.test.ts` reaches its way out.
 */

const NOVA = { width: 1280, height: 960 }

let scenario: Scenario

before(async () => {
  scenario = await startScenario({ viewport: NOVA })
})

after(async () => {
  await scenario?.stop()
})

/**
 * Tag every enabled control on the screen, or in the topmost overlay when one
 * is open, so the walk can tell each one apart even where several share an
 * action, and return each with its handle.
 *
 * A tag rather than an index into a query, because a list that re-renders
 * while the walk is under way would shift every index after the change.
 */
async function tagControls(app: App): Promise<{ tag: string; handle: string }[]> {
  return app.read<{ tag: string; handle: string }[]>(`(() => {
    const STATE = ['focused', 'active', 'disabled', 'open', 'walkTarget']
    for (const old of document.querySelectorAll('[data-walk-target]')) delete old.dataset.walkTarget
    const overlays = document.querySelectorAll('.overlay')
    const root = overlays.length > 0 ? overlays[overlays.length - 1] : document.body
    return [...root.querySelectorAll('[data-focused]')]
      .filter(
        (one) =>
          !one.closest('.topbar') &&
          one.dataset.disabled !== 'true' &&
          one.checkVisibility({ visibilityProperty: true })
      )
      .map((one, index) => {
        one.dataset.walkTarget = String(index)
        const named = Object.entries(one.dataset).find(([key]) => !STATE.includes(key))
        return { tag: String(index), handle: named ? named[0] + '=' + named[1] : one.tagName.toLowerCase() }
      })
  })()`)
}

/** Walk onto every tagged control, and wait for each to settle in full view. */
async function walkEvery(app: App, screen: string): Promise<string[]> {
  const controls = await tagControls(app)
  assert.ok(controls.length > 0, `${screen} has no control to walk to`)
  for (const { tag, handle } of controls) {
    const selector = `[data-walk-target="${tag}"]`
    await app.reach(selector)
    await app.waitFor(
      `(() => {
        const one = document.querySelector('${selector}')?.getBoundingClientRect()
        const hints = document.querySelector('.hints')?.getBoundingClientRect()
        const floor = hints && hints.height > 0 ? hints.top : window.innerHeight
        return !!one && one.top >= 0 && one.left >= 0 &&
          one.right <= window.innerWidth + 1 && one.bottom <= floor + 1
      })()`,
      `${screen}'s ${handle} control to sit in full view`
    )
  }
  return controls.map(({ handle }) => handle)
}

/** Every tab of a screen, in order, by the shoulder buttons. */
async function eachTab(app: App, screen: string, visit: (tab: string) => Promise<void>) {
  const tabs = await app.read<string[]>(
    `[...document.querySelectorAll('[data-screen="${screen}"] [data-tab]')].map((tab) => tab.dataset.tab)`
  )
  assert.ok(tabs.length > 0, `${screen} has no tabs`)
  for (let index = 0; index < tabs.length; index += 1) {
    if (index > 0) await scenario.app.press('TabNext')
    await app.waitFor(
      `document.querySelector('[data-screen="${screen}"] [data-tab="${tabs[index]}"]')?.dataset.active === 'true'`,
      `the ${tabs[index]} tab of ${screen}`
    )
    await visit(tabs[index])
  }
}

test('home: every control is reachable with the d-pad', async () => {
  const { app } = scenario
  await app.goTo('home')
  await app.waitFor(`document.querySelector('[data-screen="home"] [data-rom]')`, 'home to fill')
  await walkEvery(app, 'home')
})

for (const screen of ['library', 'collections', 'downloads', 'bios', 'emulators'])
  test(`${screen}: every control is reachable with the d-pad`, async () => {
    const { app } = scenario
    await app.goTo(screen)
    await app.waitFor(`document.querySelector('[data-screen="${screen}"]')`, screen)
    // A list that fills after its screen is drawn, walked before it filled,
    // would pass having visited only what surrounds it.
    if (screen === 'library')
      await app.waitFor(`document.querySelector('[data-rom]')`, 'the library to fill')
    if (screen === 'collections')
      await app.waitFor(`document.querySelector('[data-collection]')`, 'the collections to fill')
    await walkEvery(app, screen)
  })

test('the game page: every control on every tab is reachable with the d-pad', async () => {
  const { app } = scenario
  await app.goTo('library')
  await app.choose('[data-rom="3"]')
  await app.waitFor(`document.querySelector('[data-screen="game"]')`, 'the game page')
  await eachTab(app, 'game', async (tab) => {
    await walkEvery(app, `game (${tab})`)
  })
})

test('settings: every control on every tab is reachable with the d-pad', async () => {
  const { app } = scenario
  await app.goTo('settings')
  await app.waitFor(`document.querySelector('[data-screen="settings"]')`, 'settings')
  await eachTab(app, 'settings', async (tab) => {
    await walkEvery(app, `settings (${tab})`)
  })
})

test('the quit dialog: every control is reachable with the d-pad', async () => {
  const { app } = scenario
  await app.goTo('library')
  for (let presses = 0; presses < 4; presses += 1) {
    if (await app.read<boolean>(`!!document.querySelector('.overlay')`)) break
    await app.press('Escape')
  }
  await app.waitFor(
    `document.querySelector('.overlay [data-action="report-problem"]')`,
    'the quit dialog'
  )
  const walked = await walkEvery(app, 'the quit dialog')
  assert.ok(walked.includes('action=report-problem'), `walked ${walked.join(', ')}`)
  await app.press('Escape')
  await app.waitFor(`!document.querySelector('.overlay')`, 'the dialog to close')
})

test('a control the pad cannot reach fails the walk, naming it', async () => {
  const { app } = scenario
  await app.goTo('downloads')
  await app.waitFor(`document.querySelector('[data-screen="downloads"]')`, 'downloads')
  // Drawn like a control but never registered with the focus engine.
  await app.read(`(() => {
    document.querySelector('[data-screen="downloads"]').insertAdjacentHTML(
      'beforeend',
      '<button data-focused="false" data-action="planted-unreachable">x</button>'
    )
    return true
  })()`)
  await assert.rejects(walkEvery(app, 'downloads'), /the highlight never reached/)
  await app.read(`document.querySelector('[data-action="planted-unreachable"]').remove()`)
})

test('setup: every control on its first page is reachable with the d-pad', async () => {
  const server = await startFakeRomm()
  const app = await startApp({
    baseUrl: server.baseUrl,
    token: server.token,
    signedOut: true,
    settings: { setupComplete: false },
    viewport: NOVA
  })
  try {
    await app.waitFor(
      `document.querySelector('[data-screen="setup"] [data-focused="true"]')`,
      'the setup wizard'
    )
    await walkEvery(app, 'setup')
  } finally {
    await app.stop()
    await server.close().catch(() => undefined)
  }
})
