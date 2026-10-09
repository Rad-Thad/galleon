import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import type { App, Pad } from './driver.ts'
import { startScenario, type Scenario } from './harness.ts'
import { BULK_PLATFORM, type FakeRomm } from './server.ts'

/**
 * The performance overlay measured against a library the size of a real one.
 *
 * Its own file because it is its own server: a platform of `GAMES` games beside
 * the handful every other scenario names, and an application that has done
 * nothing else, so what is measured is the overlay and the grid rather than
 * whatever an earlier scenario left running. The arithmetic is
 * `frames.test.ts`'s; the switch and the log line are `interface.test.ts`'s.
 */

/** How many games the platform holds: the size of the owner's largest. */
const GAMES = 1300
/** What the overlay may add to a frame's main-thread work, at most. */
const COST_BUDGET_MS = 0.3
/**
 * How long each side of the cost comparison is measured for. Long enough that
 * one garbage collection spread over it is well under the budget.
 */
const COST_WINDOW_MS = 5000
/** How long the scripted scroll runs. */
const SCROLL_MS = 30_000
/**
 * The fewest frames per second of scroll its summary may cover: well short of
 * any display's rate, so a slow runner passes, and far above what the moment
 * after the scroll alone would give.
 */
const MIN_SCROLL_FPS = 30

/** Buttons as the standard mapping numbers them. See `BUTTON` in `input/gamepad.ts`. */
const L3 = 10
const R3 = 11
const DPAD_DOWN = 13
/** How long the chord is held: past `PERF_CHORD_MS`, with room for a slow poll. */
const CHORD_HOLD_MS = 2600

let scenario: Scenario
let server: FakeRomm
let app: App
let pad: Pad
let logPath: string

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** The library, narrowed to the big platform, with its first games drawn. */
async function bigPlatform(): Promise<void> {
  await app.goTo('library')
  await app.waitFor(`document.querySelector('[data-platform="${BULK_PLATFORM}"]')`, 'the chips')
  await app.choose(`[data-platform="${BULK_PLATFORM}"]`)
  await app.waitFor(`document.querySelector('[data-rom="10001"]')`, 'the big platform')
  await app.waitFor(`!document.querySelector('[data-rom="1"]')`, 'the other platforms to go')
}

/**
 * The renderer's main-thread time per frame drawn, over a window.
 *
 * `TaskDuration` from outside the page rather than timers inside it, because
 * the overlay's cost is mostly React redrawing it and the style and layout
 * that follows, none of which a timer in its own loop would see. Frames are
 * counted by a loop the page runs whether the overlay is on or not, so both
 * sides divide by the same thing.
 */
async function msPerFrame(): Promise<number> {
  const frames = (): Promise<number> => app.read<number>('window.__frames')
  const [start, firstFrame] = [await app.metrics(), await frames()]
  await sleep(COST_WINDOW_MS)
  const [end, lastFrame] = [await app.metrics(), await frames()]
  const drawn = lastFrame - firstFrame
  assert.ok(drawn > 0, 'frames should be drawn while measuring')
  return ((end.TaskDuration - start.TaskDuration) * 1000) / drawn
}

/** Every `perf summary` app.log holds for a screen, oldest first. */
function summaries(screen: string): Record<string, unknown>[] {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .map((line) => /perf\s+summary\s+(\{.*\})$/.exec(line)?.[1])
    .filter((json): json is string => json !== undefined)
    .map((json) => JSON.parse(json) as Record<string, unknown>)
    .filter((one) => one.screen === screen)
}

before(async () => {
  scenario = await startScenario({ server: { bulk: GAMES } })
  ;({ server, app } = scenario)
  pad = await app.plugInPad()
  logPath = await app.read<string>(`(await window.rommix.system.diagnostics()).logPath`)
})

after(async () => {
  await pad?.unplug()
  await scenario?.stop()
})

describe(`the performance overlay on a ${GAMES}-game platform`, () => {
  test(`costs under ${COST_BUDGET_MS} ms of main-thread work per frame`, async () => {
    await bigPlatform()
    // Counted from here on, on and off alike.
    await app.read(
      `(() => { window.__frames = 0; const count = () => { window.__frames += 1; requestAnimationFrame(count) }; requestAnimationFrame(count); return true })()`
    )
    assert.equal(await app.read<boolean>(`!!document.querySelector('.perf-overlay')`), false)
    const off = await msPerFrame()

    await pad.hold(L3)
    await pad.hold(R3)
    await sleep(CHORD_HOLD_MS)
    await pad.release(L3)
    await pad.release(R3)
    await app.waitFor(
      `document.querySelector('[data-perf-overlay]')?.textContent.includes('p99')`,
      'the overlay to measure'
    )
    const on = await msPerFrame()

    console.log(`overlay cost: off ${off.toFixed(3)} ms/frame, on ${on.toFixed(3)} ms/frame`)
    assert.ok(
      on - off < COST_BUDGET_MS,
      `the overlay added ${(on - off).toFixed(3)} ms per frame (off ${off.toFixed(3)}, on ${on.toFixed(3)})`
    )
  })

  test(`a ${SCROLL_MS / 1000} s scroll down the grid logs its summary`, async () => {
    // Away and back, so the summary read below covers this scroll and nothing
    // the scenario before it measured.
    await app.goTo('home')
    await bigPlatform()
    const pagesBefore = server.asked.filter((one) => one.path.includes('offset=')).length

    await pad.hold(DPAD_DOWN)
    await sleep(SCROLL_MS)
    await pad.release(DPAD_DOWN)

    const pagedTo = server.asked
      .slice(pagesBefore)
      .filter((one) => one.path.includes(`platform_ids=${BULK_PLATFORM}`))
      .map((one) => Number(/offset=(\d+)/.exec(one.path)?.[1] ?? 0))
    assert.ok(
      Math.max(0, ...pagedTo) > 0,
      'the scroll should have walked past the first page and fetched more'
    )

    const seen = summaries('library').length
    await app.goTo('settings')
    let found: Record<string, unknown> | undefined
    for (let tries = 0; tries < 50 && !found; tries += 1) {
      found = summaries('library')[seen]
      if (!found) await sleep(100)
    }
    assert.ok(found, 'a perf summary for the library should be in app.log')
    console.log(`scroll summary: ${JSON.stringify(found)}`)
    for (const key of ['frames', 'p50', 'p90', 'p99', 'jankyPct'])
      assert.equal(typeof found[key], 'number', `${key} should be a number`)
    assert.ok(
      (found.frames as number) > (SCROLL_MS / 1000) * MIN_SCROLL_FPS,
      `${found.frames} frames is too few for the scroll`
    )
  })
})
