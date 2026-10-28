import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { SETTLE_TIMEOUT_MS } from './driver.ts'
import { startScenario, type Scenario } from './harness.ts'

/**
 * What the application costs while nobody touches it (M1-27).
 *
 * On the Nova an idle launcher sits on Home for hours between games, on a
 * battery and under a governor that ramps with load, so every wake it does for
 * nothing is paid for twice. This adds up the CPU time of every process the
 * application started, from `/proc` as the device check `idle.cpu` does, over
 * `IDLE_MS` on Home with no input at all. Then, since what idles cheaply may
 * wake slowly, it times the first press after a quiet spell.
 *
 * Nightly rather than on every pull request: the window is long by design, and
 * a pull request's leg has no room for it (PLAN.md section 4).
 */

/** How long the application is left alone on Home while it is measured. */
const IDLE_MS = 60_000
/**
 * How long Home is given after it settles before the window opens, so the
 * start's own work (the first pages, the covers, the first poll of the server)
 * is not counted as idle.
 */
const SETTLE_MS = 10_000
/**
 * What the whole application spent over the window, in seconds of CPU, under
 * Xvfb on the development VM, measured as the starting point M1-27 cuts from.
 * M1-27 requires the budget below to come down to half of it.
 */
const BASELINE_S = 3.3
/**
 * The most CPU the whole application may spend over the window, in seconds:
 * the baseline with room for a slower runner, until idle cost is cut.
 */
const IDLE_CPU_BUDGET_S = BASELINE_S * 1.5

/**
 * How long the application is left alone before the press whose answer is
 * timed: long enough for anything that winds down when nobody is there to
 * have done so.
 */
const LATENCY_IDLE_MS = 30_000
/** What a press after idle may take to move the highlight, beyond one frame. */
const LATENCY_SLACK_MS = 50
/** How many frames are timed to tell how long one is. */
const FRAMES_TIMED = 30

/** Clock ticks per second, as `/proc/<pid>/stat` counts CPU time. */
const TICKS = Number(execFileSync('getconf', ['CLK_TCK']).toString().trim())

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** A process's parent and its CPU time so far (user and system), from its stat line. */
function stat(pid: number): { parent: number; ticks: number } | null {
  let line: string
  try {
    line = readFileSync(`/proc/${pid}/stat`, 'utf8')
  } catch {
    return null
  }
  // The name is in parentheses and may hold anything, spaces and parentheses
  // included, so the fields are counted from the last closing one.
  const fields = line.slice(line.lastIndexOf(')') + 2).split(' ')
  return { parent: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]) }
}

/** What a process is: Chromium's `--type` (renderer, gpu-process, …), or the main process. */
function kind(pid: number): string {
  try {
    // Matched across the whole line, because Chromium rewrites its children's
    // titles with spaces where the separators were.
    const line = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    return /--type=([\w-]+)/.exec(line)?.[1] ?? 'main'
  } catch {
    return 'gone'
  }
}

/** CPU ticks so far of `root` and every process below it, by pid. */
function treeTicks(root: number): Map<number, number> {
  const all = new Map<number, { parent: number; ticks: number }>()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const one = stat(Number(name))
    if (one) all.set(Number(name), one)
  }
  const inTree = (pid: number): boolean => {
    for (let at = pid; at > 1; at = all.get(at)?.parent ?? 0) if (at === root) return true
    return false
  }
  return new Map([...all].filter(([pid]) => inTree(pid)).map(([pid, one]) => [pid, one.ticks]))
}

let scenario: Scenario

describe('idle', () => {
  before(async () => {
    scenario = await startScenario()
  })

  after(async () => {
    await scenario?.stop()
  })

  test('a minute on Home with nothing pressed stays under the CPU budget', async () => {
    await sleep(SETTLE_MS)
    const start = treeTicks(scenario.app.pid)
    await sleep(IDLE_MS)
    const end = treeTicks(scenario.app.pid)

    // A process started inside the window counts from nothing; one that ended
    // inside it is not counted, which the budget's room covers.
    let ticks = 0
    for (const [pid, now] of end) ticks += now - (start.get(pid) ?? 0)
    const seconds = ticks / TICKS
    // Each process's share too, so a run over budget says where to look.
    const shares = [...end]
      .map(([pid, now]) => `${kind(pid)} ${((now - (start.get(pid) ?? 0)) / TICKS).toFixed(2)} s`)
      .join(', ')
    console.log(`idle CPU over ${IDLE_MS / 1000} s: ${seconds.toFixed(2)} s (${shares})`)
    // The renderer is most of the cost, so a tree that lost it (reparented
    // under a sandbox helper, say) would pass while measuring little.
    assert.ok(
      [...end.keys()].some((pid) => kind(pid) === 'renderer'),
      'the renderer should be among the processes counted'
    )
    assert.ok(
      seconds <= IDLE_CPU_BUDGET_S,
      `the application spent ${seconds.toFixed(2)} s of CPU idle on Home, over the ` +
        `${IDLE_CPU_BUDGET_S} s budget`
    )
  })
  test('a press after idle moves the highlight within a frame and a little', async () => {
    const { app } = scenario
    await sleep(LATENCY_IDLE_MS)
    // Set up in the page before the press, so the press's own time and the
    // first frame after the highlight moved are both read on the page's clock.
    await app.read(`(() => {
      const before = document.querySelector('[data-focused="true"]')
      let pressedAt = null
      addEventListener('keydown', (event) => { pressedAt ??= event.timeStamp }, { capture: true })
      window.__afterIdle = new Promise((resolve) => {
        // A highlight that never moves answers rather than holding the test
        // to its own deadline.
        setTimeout(() => resolve(-1), ${SETTLE_TIMEOUT_MS})
        new MutationObserver((_, observer) => {
          const now = document.querySelector('[data-focused="true"]')
          if (!now || now === before || pressedAt === null) return
          observer.disconnect()
          requestAnimationFrame(() => resolve(performance.now() - pressedAt))
        }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-focused'] })
      })
      return true
    })()`)
    await app.press('Down')
    const latencyMs = await app.read<number>('window.__afterIdle')
    // Timed after the press rather than before, so nothing wakes the page
    // during the idle the press is meant to follow.
    const frameMs = await app.read<number>(`new Promise((resolve) => {
      const times = []
      const tick = (time) => {
        times.push(time)
        if (times.length <= ${FRAMES_TIMED}) return requestAnimationFrame(tick)
        const gaps = times.slice(1).map((one, i) => one - times[i]).sort((a, b) => a - b)
        resolve(gaps[Math.floor(gaps.length / 2)])
      }
      requestAnimationFrame(tick)
    })`)
    assert.ok(latencyMs >= 0, 'the highlight never moved after the press')
    console.log(
      `after ${LATENCY_IDLE_MS / 1000} s idle the highlight moved in ` +
        `${latencyMs.toFixed(1)} ms (a frame is ${frameMs.toFixed(1)} ms)`
    )
    assert.ok(
      latencyMs <= frameMs + LATENCY_SLACK_MS,
      `the highlight took ${latencyMs.toFixed(1)} ms to move after idle, over one frame ` +
        `(${frameMs.toFixed(1)} ms) plus ${LATENCY_SLACK_MS} ms`
    )
  })
})
