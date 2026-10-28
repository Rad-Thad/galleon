import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { POWER_HINT_NOTICE, THEMES_NOTICE, type PowerState, type Settings } from '@shared/types'
import { decidePowerHint } from './powerhint.ts'
import type { CheckResult, Safety, SelfTestRequest } from './selftest.ts'
import type { ProfileAnswer } from './selftestscroll.ts'
import {
  POWER_HINT_CHECK,
  hintShot,
  powerHintScenario,
  type PowerHintDeps
} from './selftesthint.ts'

/**
 * `power.hint`: the hint asked for on each profile, with the test home's
 * dismissal lifted only for the check. The page half (the overlay, OK) is
 * driven by test:app; here the page answers with `decidePowerHint` itself.
 */

const dirs: string[] = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const PNG = Buffer.from('png')

function state(profile: string, defaultProfile = 'balanced'): PowerState {
  return {
    cpuGovernor: 'conservative',
    cpuCurKHz: null,
    cpuMaxKHz: null,
    gpuGovernor: 'unknown',
    gpuCurHz: null,
    gpuMaxHz: null,
    profile,
    defaultProfile,
    perf: 'unknown'
  }
}

interface Fake {
  deps: PowerHintDeps
  asked: string[]
  closed: number
  settings: () => Settings
  results: string
}

function fake(
  options: {
    profile?: string
    switches?: boolean
    onArmada?: boolean
    capture?: Buffer | null
    /** The page shows the hint whatever is decided. */
    alwaysShown?: boolean
  } = {}
): Fake {
  let profile = options.profile ?? 'performance'
  let settings = {
    dismissedNotices: [THEMES_NOTICE, POWER_HINT_NOTICE],
    powerProfileSeen: 'Performance'
  } as Settings
  const asked: string[] = []
  const results = mkdtempSync(join(tmpdir(), 'galleon-hint-'))
  dirs.push(results)
  const f: Fake = {
    asked,
    closed: 0,
    settings: () => settings,
    results,
    deps: {
      power: async () => state(profile, options.onArmada === false ? 'unknown' : 'balanced'),
      askForProfile: async (wanted): Promise<ProfileAnswer> => {
        asked.push(wanted)
        if (options.switches === false) return 'unchanged'
        profile = wanted
        return 'set'
      },
      store: {
        get settings() {
          return settings
        },
        updateSettings(patch) {
          settings = { ...settings, ...patch }
          return settings
        }
      },
      ask: async () => {
        const decided = decidePowerHint(
          state(profile),
          settings.powerProfileSeen,
          settings.dismissedNotices.includes(POWER_HINT_NOTICE)
        )
        settings = { ...settings, powerProfileSeen: decided.seen }
        return options.alwaysShown || decided.show
      },
      capture: async () => (options.capture === undefined ? PNG : options.capture),
      close: async () => {
        f.closed++
      },
      resultsDir: results,
      waitMs: 1
    }
  }
  return f
}

async function run(f: Fake, profiles: string[], signal?: AbortSignal): Promise<CheckResult> {
  const out = await powerHintScenario(f.deps)({
    request: { profiles } as SelfTestRequest,
    safety: {} as Safety,
    signal: signal ?? new AbortController().signal
  })
  assert.ok(!Array.isArray(out))
  assert.equal(out.id, POWER_HINT_CHECK)
  return out
}

describe('power.hint', () => {
  test('shows on Balanced with its panel captured, not on Performance', async () => {
    const f = fake()
    const out = await run(f, ['performance', 'balanced'])
    assert.equal(out.result, 'pass', String(out.reason))
    assert.deepEqual(f.asked, ['balanced'])
    assert.deepEqual(out.metrics, { 'performance.shown': 0, 'balanced.shown': 1 })
    assert.deepEqual(out.evidence, [hintShot('balanced')])
    assert.deepEqual(readFileSync(join(f.results, hintShot('balanced'))), PNG)
    assert.equal(f.closed, 1)
  })

  test("the test home's dismissal and profile last seen are put back", async () => {
    const f = fake()
    await run(f, ['performance', 'balanced'])
    assert.deepEqual(f.settings().dismissedNotices, [THEMES_NOTICE, POWER_HINT_NOTICE])
    assert.equal(f.settings().powerProfileSeen, 'Performance')
  })

  test('a hint on Performance fails, and is still captured as evidence', async () => {
    const f = fake({ alwaysShown: true })
    const out = await run(f, ['performance', 'balanced'])
    assert.deepEqual([out.result, out.reason], ['fail', 'performance:shown'])
    assert.deepEqual(out.evidence, [hintShot('performance'), hintShot('balanced')])
  })

  test('no hint on Balanced fails', async () => {
    const f = fake({ profile: 'balanced' })
    f.deps.ask = async () => false
    const out = await run(f, ['balanced'])
    assert.deepEqual([out.result, out.reason], ['fail', 'balanced:not-shown'])
    assert.ok(!existsSync(join(f.results, hintShot('balanced'))))
  })

  test('a hint that cannot be captured fails', async () => {
    const out = await run(fake({ capture: null }), ['balanced'])
    assert.deepEqual([out.result, out.reason], ['fail', 'balanced:not-captured'])
  })

  test('a profile run.sh does not set is a skip, and nothing is asked of the page on it', async () => {
    const f = fake({ switches: false })
    const out = await run(f, ['performance', 'balanced'])
    assert.deepEqual([out.result, out.reason], ['skip', 'profile-not-set'])
    assert.equal(out.metrics['balanced.profileObserved'], 'performance')
    assert.equal(out.metrics['balanced.shown'], undefined)
  })

  test('with no profile named, or off Armada, there is nothing to judge', async () => {
    const none = await run(fake(), [])
    assert.deepEqual([none.result, none.reason], ['skip', 'no-profiles'])
    const off = await run(fake({ onArmada: false }), ['balanced'])
    assert.deepEqual([off.result, off.reason], ['skip', 'not-armada'])
  })

  test('a stopped run is a skip, with the settings put back', async () => {
    const stop = new AbortController()
    stop.abort()
    const f = fake()
    const out = await run(f, ['balanced'], stop.signal)
    assert.deepEqual([out.result, out.reason], ['skip', 'aborted-by-user'])
    assert.ok(f.settings().dismissedNotices.includes(POWER_HINT_NOTICE))
  })
})
