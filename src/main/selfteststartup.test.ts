import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { PowerState } from '@shared/types'
import type { CheckResult, Safety, SelfTestRequest } from './selftest.ts'
import {
  HOME_TIMEOUT_MS,
  STARTED_AT_ENV,
  STARTUP_CHECK,
  STARTUP_MS,
  homeProbe,
  startupScenario,
  startupStart,
  watchHome
} from './selfteststartup.ts'

/**
 * `startup.cold` on the device: the time from the wrapper's start to the
 * first frame of an interactive Home. The page side is driven by test:app;
 * here are the start it is measured from and the verdict.
 */

function power(profile: string): PowerState {
  return {
    cpuGovernor: 'schedutil',
    cpuCurKHz: null,
    cpuMaxKHz: null,
    gpuGovernor: 'unknown',
    gpuCurHz: null,
    gpuMaxHz: null,
    profile,
    profileId: profile.toLowerCase(),
    defaultProfile: 'unknown',
    perf: 'unknown'
  }
}

function context(signal = new AbortController().signal) {
  return {
    request: {} as SelfTestRequest,
    safety: {} as Safety,
    signal
  }
}

async function run(
  reached: number | null,
  profile = 'Performance',
  signal?: AbortSignal
): Promise<CheckResult> {
  const scenario = startupScenario({
    reached: Promise.resolve(reached),
    start: { at: 1_000, from: 'wrapper' },
    power: async () => power(profile)
  })
  return (await scenario(context(signal))) as CheckResult
}

describe('startupStart', () => {
  test("the wrapper's time when it is a time before this process started", () => {
    assert.deepEqual(startupStart({ [STARTED_AT_ENV]: '900' }, 1_000), {
      at: 900,
      from: 'wrapper'
    })
  })

  test("this process's start without one, or with one that cannot be the wrapper's", () => {
    for (const raw of [undefined, '', 'soon', '-5', '0', '1.5e3', '1001', '9'.repeat(30)]) {
      assert.deepEqual(startupStart({ [STARTED_AT_ENV]: raw }, 1_000), {
        at: 1_000,
        from: 'process'
      })
    }
  })
})

describe('startupScenario', () => {
  test('passes under the threshold, with the time and what it was measured under', async () => {
    const check = await run(1_000 + STARTUP_MS - 1)
    assert.equal(check.id, STARTUP_CHECK)
    assert.equal(check.result, 'pass')
    assert.equal(check.reason, null)
    assert.deepEqual(check.metrics, {
      startupMs: STARTUP_MS - 1,
      measuredFrom: 'wrapper',
      profileObserved: 'Performance',
      cpuGovernor: 'schedutil'
    })
    assert.deepEqual(check.thresholds, { startupMs: STARTUP_MS })
  })

  test('fails at or over the threshold on Performance, or when the profile is unknown', async () => {
    for (const profile of ['Performance', 'unknown']) {
      const check = await run(1_000 + STARTUP_MS, profile)
      assert.equal(check.result, 'fail')
      assert.equal(check.reason, 'over-threshold')
    }
  })

  test('a slow start on another known profile is not judged against it', async () => {
    const check = await run(1_000 + STARTUP_MS + 1, 'Balanced')
    assert.equal(check.result, 'skip')
    assert.equal(check.reason, 'not-on-performance')
    assert.equal(check.metrics.startupMs, STARTUP_MS + 1)
  })

  test('a fast start passes whatever the profile', async () => {
    assert.equal((await run(2_000, 'Balanced')).result, 'pass')
  })

  test('fails when Home never became interactive', async () => {
    const check = await run(null)
    assert.equal(check.result, 'fail')
    assert.equal(check.reason, 'home-not-reached')
    assert.equal(check.metrics.startupMs, undefined)
  })

  test('an unreadable power state does not stop the measurement', async () => {
    const scenario = startupScenario({
      reached: Promise.resolve(1_500),
      start: { at: 1_000, from: 'process' },
      power: () => Promise.reject(new Error('no sysfs'))
    })
    const check = (await scenario(context())) as CheckResult
    assert.equal(check.result, 'pass')
    assert.equal(check.metrics.profileObserved, 'unknown')
    assert.equal(check.metrics.measuredFrom, 'process')
  })

  test('an abort stops the wait for Home', async () => {
    const controller = new AbortController()
    const scenario = startupScenario({
      reached: new Promise<number | null>(() => {}),
      start: { at: 1_000, from: 'process' },
      power: async () => power('Performance')
    })
    const pending = scenario(context(controller.signal))
    controller.abort()
    const check = (await pending) as CheckResult
    assert.equal(check.result, 'skip')
    assert.equal(check.reason, 'aborted-by-user')
  })
})

describe('watchHome', () => {
  test('asks the page with the probe and keeps only a time', async () => {
    const scripts: string[] = []
    const contents = (answer: unknown) => ({
      executeJavaScript: async (script: string) => {
        scripts.push(script)
        return answer
      }
    })
    assert.equal(await watchHome(contents(1234) as never), 1234)
    assert.equal(await watchHome(contents(null) as never), null)
    assert.equal(await watchHome(contents('soon') as never), null)
    assert.equal(scripts[0], homeProbe(HOME_TIMEOUT_MS))
  })

  test('a page that never draws a frame is Home not reached once the time is up', async () => {
    const contents = { executeJavaScript: () => new Promise<never>(() => {}) }
    assert.equal(await watchHome(contents as never, 10), null)
  })

  test('a page that went away is Home not reached, not a crash', async () => {
    const contents = { executeJavaScript: () => Promise.reject(new Error('destroyed')) }
    assert.equal(await watchHome(contents as never), null)
  })
})
