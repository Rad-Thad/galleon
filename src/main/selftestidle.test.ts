import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { runInNewContext } from 'node:vm'
import type { PowerState } from '@shared/types'
import thresholds from '../../test/device/thresholds.json' with { type: 'json' }
import type { CheckResult, Safety, SelfTestRequest } from './selftest.ts'
import {
  IDLE_CHECK,
  IDLE_CPU_BUDGET_S,
  IDLE_MS,
  LATENCY_SLACK_MS,
  SELF_TEST_PAD,
  USER_HZ,
  idleScenario,
  pressProbe,
  spent,
  statTicks,
  type AppProcess,
  type IdleScenarioDeps,
  type PressTiming
} from './selftestidle.ts'
import type { ProfileAnswer } from './selftestscroll.ts'

/**
 * `idle.cpu` on the device: a minute on Home on Balanced, the CPU of every
 * process the app runs from `/proc`, then a press on the page's own pad timed
 * to the highlight's move. The processes, clocks and page are scripted here;
 * test/app/idle.nightly.ts measures the real app under Xvfb.
 */

function power(profile: string): PowerState {
  return {
    cpuGovernor: profile === 'balanced' ? 'conservative' : 'performance',
    cpuCurKHz: null,
    cpuMaxKHz: null,
    gpuGovernor: 'unknown',
    gpuCurHz: null,
    gpuMaxHz: null,
    profile,
    profileId: profile,
    defaultProfile: 'balanced',
    perf: 'unknown'
  }
}

const PROCESSES: AppProcess[] = [
  { pid: 10, type: 'Browser' },
  { pid: 11, type: 'GPU' },
  { pid: 12, type: 'Tab' }
]

interface Script {
  profile?: string
  /** The profile after the switch is asked for. */
  switchesTo?: string
  processes?: AppProcess[]
  /** Ticks each process spends over the window. */
  used?: Record<number, number>
  home?: boolean
  timing?: PressTiming | null
  abortAt?: 'settle' | 'window'
}

async function run(
  script: Script = {}
): Promise<{ result: CheckResult; asked: string[]; waits: number[] }> {
  let profile = script.profile ?? 'balanced'
  const asked: string[] = []
  const waits: number[] = []
  const controller = new AbortController()
  let windowOpen = false
  const deps: IdleScenarioDeps = {
    processes: () => script.processes ?? PROCESSES,
    ticks: async (pid) => 1_000 + (windowOpen ? (script.used?.[pid] ?? 0) : 0),
    page: {
      home: async () => script.home ?? true,
      press: async () =>
        script.timing === undefined ? { latencyMs: 20, frameMs: 8.3 } : script.timing
    },
    power: async () => power(profile),
    askForProfile: async (wanted): Promise<ProfileAnswer> => {
      asked.push(wanted)
      profile = script.switchesTo ?? wanted
      return profile === wanted ? 'set' : 'unchanged'
    },
    wait: async (ms) => {
      waits.push(ms)
      if (script.abortAt === (ms === IDLE_MS ? 'window' : 'settle')) controller.abort()
      if (ms === IDLE_MS) windowOpen = true
    }
  }
  const result = (await idleScenario(deps)({
    request: {} as SelfTestRequest,
    safety: {} as Safety,
    signal: controller.signal
  })) as CheckResult
  return { result, asked, waits }
}

describe('thresholds', () => {
  test('the budget is the one test/device/thresholds.json gives the device', () => {
    assert.equal(IDLE_CPU_BUDGET_S, thresholds['idle.cpu'].cpuSeconds)
    assert.equal(LATENCY_SLACK_MS, 50)
  })
})

describe('statTicks', () => {
  test('user plus system time, counted after a name holding spaces and parentheses', () => {
    const fields = ['S', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '120', '30', '0', '0']
    assert.equal(statTicks(`42 (Galleon (x) y) ${fields.join(' ')}`), 150)
  })

  test('a line that is not a stat line is null', () => {
    assert.equal(statTicks('nonsense'), null)
    assert.equal(statTicks('42 (a) S 1'), null)
  })
})

describe('spent', () => {
  test('sums by process and by kind; a process born in the window counts from nothing', () => {
    const start = new Map([
      [1, { type: 'Browser', ticks: 100 }],
      [2, { type: 'Tab', ticks: 50 }]
    ])
    const end = new Map([
      [1, { type: 'Browser', ticks: 130 }],
      [2, { type: 'Tab', ticks: 60 }],
      [3, { type: 'Tab', ticks: 20 }]
    ])
    assert.deepEqual(spent(start, end), {
      seconds: 60 / USER_HZ,
      byType: { Browser: 0.3, Tab: 0.3 }
    })
  })
})

describe('idleScenario', () => {
  test('passes on Balanced under the budget with a quick press, and says what each kind spent', async () => {
    const { result, asked, waits } = await run({ used: { 10: 50, 11: 40, 12: 60 } })
    assert.equal(result.id, IDLE_CHECK)
    assert.equal(result.result, 'pass', String(result.reason))
    assert.deepEqual(asked, [])
    assert.ok(waits.includes(IDLE_MS))
    assert.equal(result.metrics.cpuSeconds, 1.5)
    assert.equal(result.metrics.cpuBrowserS, 0.5)
    assert.equal(result.metrics.cpuGPUS, 0.4)
    assert.equal(result.metrics.cpuTabS, 0.6)
    assert.equal(result.metrics.processes, 3)
    assert.equal(result.metrics.latencyMs, 20)
    assert.equal(result.metrics.profileObserved, 'balanced')
    assert.equal(result.metrics.governor, 'conservative')
    assert.deepEqual(result.thresholds, {
      cpuSeconds: IDLE_CPU_BUDGET_S,
      latencySlackMs: LATENCY_SLACK_MS
    })
  })

  test('fails at the budget, not only over it', async () => {
    const ticks = Math.round(IDLE_CPU_BUDGET_S * USER_HZ)
    const { result } = await run({ used: { 12: ticks } })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'over-cpu-budget')
  })

  test('fails a press slower than one frame plus the slack', async () => {
    const slow = await run({ timing: { latencyMs: 8.3 + LATENCY_SLACK_MS + 1, frameMs: 8.3 } })
    assert.equal(slow.result.result, 'fail')
    assert.equal(slow.result.reason, 'slow-after-idle')
    const edge = await run({ timing: { latencyMs: 8.3 + LATENCY_SLACK_MS, frameMs: 8.3 } })
    assert.equal(edge.result.result, 'pass')
  })

  test('fails a highlight that never moved', async () => {
    const { result } = await run({ timing: { latencyMs: -1, frameMs: 8.3 } })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'highlight-did-not-move')
  })

  test('asks for Balanced and measures once it is in force', async () => {
    const { result, asked } = await run({ profile: 'performance' })
    assert.deepEqual(asked, ['balanced'])
    assert.equal(result.result, 'pass')
  })

  test('skips without measuring when Balanced could not be set', async () => {
    const { result, waits } = await run({ profile: 'performance', switchesTo: 'performance' })
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'profile-not-set')
    assert.equal(result.metrics.profileAnswer, 'unchanged')
    assert.deepEqual(waits, [])
  })

  test('a count without the renderer is an error, not a pass', async () => {
    const { result } = await run({ processes: PROCESSES.filter((p) => p.type !== 'Tab') })
    assert.equal(result.result, 'error')
    assert.equal(result.reason, 'renderer-not-counted')
  })

  test('Home never reached, or a press never timed, is an error', async () => {
    assert.equal((await run({ home: false })).result.reason, 'home-not-reached')
    assert.equal((await run({ timing: null })).result.reason, 'press-not-timed')
  })

  test('an abort while settling or in the window is a skip', async () => {
    for (const abortAt of ['settle', 'window'] as const) {
      const { result } = await run({ abortAt })
      assert.equal(result.result, 'skip')
      assert.equal(result.reason, 'aborted-by-user')
    }
  })
})

describe('pressProbe', () => {
  /**
   * The probe against a scripted page: `poll` stands in for the interface's
   * pad read, and moves the highlight when it sees Down held.
   */
  function page(moves: boolean) {
    const real = { id: 'real pad', buttons: [] }
    const navigator = { getGamepads: (): unknown[] => [real, null] }
    const original = navigator.getGamepads
    let focused = { name: 'first' }
    let observed: (() => void) | null = null
    let clock = 0
    const frames: ((time: number) => void)[] = []
    const timers: (() => void)[] = []
    const context = {
      navigator,
      document: {
        body: {},
        querySelector: () => focused
      },
      MutationObserver: class {
        constructor(callback: () => void) {
          observed = callback
        }
        observe(): void {}
        disconnect(): void {
          observed = null
        }
      },
      requestAnimationFrame: (callback: (time: number) => void) => frames.push(callback),
      setTimeout: (callback: () => void) => timers.push(callback),
      clearTimeout: () => timers.splice(0),
      performance: { now: () => clock },
      Promise,
      Array
    }
    const probe = runInNewContext(pressProbe(1_000), context) as Promise<PressTiming>
    const poll = (): unknown[] => {
      const pads = navigator.getGamepads() as { buttons: { pressed: boolean }[] }[]
      if (moves && pads[0]?.buttons[13]?.pressed) {
        focused = { name: 'second' }
        clock += 12
        observed?.()
      }
      return pads
    }
    const runFrames = (): void => {
      for (let i = 0; i < 40 && frames.length; i += 1) {
        clock += 8
        frames.shift()?.(clock)
      }
    }
    return { probe, poll, runFrames, navigator, original, timers }
  }

  test('puts its own pad first with Down held, then unplugs it once the highlight moved', async () => {
    const p = page(true)
    const pads = p.poll() as Record<string, unknown>[]
    assert.equal(pads.length, 2)
    assert.equal(pads[0]?.[SELF_TEST_PAD], true)
    assert.equal(pads[1]?.id, 'real pad')
    p.runFrames()
    const timing = await p.probe
    assert.equal(timing.latencyMs, 20)
    assert.equal(timing.frameMs, 8)
    assert.equal(p.navigator.getGamepads, p.original)
  })

  test('a highlight that never moves answers -1 at the timeout, the real pads restored', async () => {
    const p = page(false)
    p.poll()
    p.timers.shift()?.()
    p.runFrames()
    assert.equal((await p.probe).latencyMs, -1)
    assert.equal(p.navigator.getGamepads, p.original)
  })
})
