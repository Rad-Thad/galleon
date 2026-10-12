import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LIBRARY_SCREENS,
  SCREENS,
  SHOTS_DIR,
  SHOT_MISSING,
  screenProbe,
  takeScreenshots,
  type ShotsOptions
} from './selftestshots.ts'

/**
 * The self-test's screenshots, against a page that answers as scripted: which
 * screens are captured, which are never, and that a screen that will not draw
 * costs only its own shot.
 */

const scratches: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-selftest-shots-'))
  scratches.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A page where every screen draws, unless `answers` says otherwise. */
function page(
  answers: Record<string, unknown> = {},
  png = PNG
): ShotsOptions['contents'] & { opened: string[] } {
  const opened: string[] = []
  return {
    opened,
    executeJavaScript: async (script: string) => {
      const screen = /data-screen=\\"([^"\\]+)\\"/.exec(script)?.[1] ?? ''
      opened.push(screen)
      return screen in answers ? answers[screen] : null
    },
    capturePage: (async () => ({
      toPNG: () => png
    })) as unknown as ShotsOptions['contents']['capturePage']
  }
}

const live = new AbortController().signal

describe('screenProbe', () => {
  test('is a script the page can parse, naming the screen and the time', () => {
    const script = screenProbe('settings', 4321)
    assert.doesNotThrow(() => new Function(`return ${script}`))
    assert.match(script, /\[data-route=\\"settings\\"\]/)
    assert.match(script, /\[data-screen=\\"settings\\"\]/)
    assert.match(script, /4321/)
  })
})

describe('takeScreenshots', () => {
  test('each screen is opened and captured once, in the order asked for', async () => {
    const results = scratch()
    const contents = page()
    const outcome = await takeScreenshots({
      contents,
      resultsDir: results,
      screens: ['settings', 'bios', 'settings'],
      signal: live
    })
    assert.deepEqual(outcome, {
      evidence: [`${SHOTS_DIR}/settings.png`, `${SHOTS_DIR}/bios.png`],
      missing: [],
      withheld: []
    })
    assert.deepEqual(contents.opened, ['settings', 'bios'])
    assert.deepEqual(readFileSync(join(results, SHOTS_DIR, 'bios.png')), PNG)
    // Written whole: nothing half-written is left for the bridge to publish.
    assert.deepEqual(readdirSync(join(results, SHOTS_DIR)).sort(), ['bios.png', 'settings.png'])
  })

  test('screens that draw the library are never opened or captured', async () => {
    const results = scratch()
    const contents = page()
    const outcome = await takeScreenshots({
      contents,
      resultsDir: results,
      screens: [...LIBRARY_SCREENS],
      signal: live
    })
    assert.deepEqual(outcome.withheld, [...LIBRARY_SCREENS])
    assert.deepEqual(outcome.evidence, [])
    assert.deepEqual(outcome.missing, [])
    assert.deepEqual(contents.opened, [])
    assert.ok(!existsSync(join(results, SHOTS_DIR)))
  })

  test('no screen is both captured and withheld', () => {
    for (const screen of SCREENS) assert.ok(!LIBRARY_SCREENS.has(screen), screen)
  })

  test('a screen this build does not know is missing, and never reaches the page or a file name', async () => {
    const results = scratch()
    const contents = page()
    const outcome = await takeScreenshots({
      contents,
      resultsDir: results,
      screens: ['../../escape', 'settings"]'],
      signal: live
    })
    assert.deepEqual(outcome.missing, [
      `../../escape:${SHOT_MISSING.unknown}`,
      `settings"]:${SHOT_MISSING.unknown}`
    ])
    assert.deepEqual(contents.opened, [])
  })

  test('a screen that does not draw, or a capture that fails, costs only its own shot', async () => {
    const results = scratch()
    const outcome = await takeScreenshots({
      contents: page({ bios: 'not-drawn' }),
      resultsDir: results,
      screens: ['bios', 'settings'],
      signal: live
    })
    assert.deepEqual(outcome.missing, [`bios:${SHOT_MISSING.notReached}`])
    assert.deepEqual(outcome.evidence, [`${SHOTS_DIR}/settings.png`])

    const broken = page()
    broken.executeJavaScript = async () => Promise.reject(new Error('gone'))
    const threw = await takeScreenshots({
      contents: broken,
      resultsDir: results,
      screens: ['emulators'],
      signal: live
    })
    assert.deepEqual(threw.missing, [`emulators:${SHOT_MISSING.notReached}`])

    const empty = await takeScreenshots({
      contents: page({}, Buffer.alloc(0)),
      resultsDir: results,
      screens: ['emulators'],
      signal: live
    })
    assert.deepEqual(empty.missing, [`emulators:${SHOT_MISSING.captureFailed}`])

    const refused = page()
    refused.capturePage = (async () =>
      Promise.reject(new Error('no frame'))) as unknown as ShotsOptions['contents']['capturePage']
    const failed = await takeScreenshots({
      contents: refused,
      resultsDir: results,
      screens: ['emulators'],
      signal: live
    })
    assert.deepEqual(failed.missing, [`emulators:${SHOT_MISSING.captureFailed}`])
    assert.ok(!existsSync(join(results, SHOTS_DIR, 'emulators.png')))
  })

  test('a page that never answers is given up on', async () => {
    const stalled = page()
    stalled.executeJavaScript = () => new Promise(() => {})
    const outcome = await takeScreenshots({
      contents: stalled,
      resultsDir: scratch(),
      screens: ['settings'],
      signal: live,
      timeoutMs: 5
    })
    assert.deepEqual(outcome.missing, [`settings:${SHOT_MISSING.notReached}`])
  })

  test('an abort ends the wait for a screen, and nothing after it is opened', async () => {
    const stop = new AbortController()
    const stalled = page()
    let calls = 0
    stalled.executeJavaScript = () => {
      calls += 1
      return new Promise(() => {})
    }
    const pending = takeScreenshots({
      contents: stalled,
      resultsDir: scratch(),
      screens: ['settings', 'bios'],
      signal: stop.signal
    })
    stop.abort()
    const outcome = await pending
    assert.deepEqual(outcome.missing, [
      `settings:${SHOT_MISSING.aborted}`,
      `bios:${SHOT_MISSING.aborted}`
    ])
    assert.equal(calls, 1)
  })
})
