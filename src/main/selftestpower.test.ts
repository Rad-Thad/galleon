import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import type { PowerState } from '@shared/types'
import type { CheckResult, Safety, SelfTestRequest } from './selftest.ts'
import type { ProfileAnswer } from './selftestscroll.ts'
import { readPowerState } from './powerstate.ts'
import {
  POWER_READ_CHECK,
  powerReadScenario,
  readSysfsPower,
  statusCap,
  type PowerReadDeps,
  type SysfsPower
} from './selftestpower.ts'

/**
 * `power.read`: Galleon's reading held against `armada-power status` and
 * sysfs on each profile, with the profile switched through the handshake.
 */

const dirs: string[] = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** What the Nova showed on each profile (docs/DEVICE-FACTS.md). */
const MACHINE: Record<string, { label: string; governor: string; maxKHz: number }> = {
  performance: { label: 'Performance', governor: 'performance', maxKHz: 2_956_800 },
  balanced: { label: 'Balanced', governor: 'conservative', maxKHz: 2_092_800 }
}

function galleon(profile: string, extra: Partial<PowerState> = {}): PowerState {
  const m = MACHINE[profile]
  return {
    cpuGovernor: m.governor,
    cpuCurKHz: 1_200_000,
    cpuMaxKHz: m.maxKHz,
    gpuGovernor: 'simple_ondemand',
    gpuCurHz: 220_000_000,
    gpuMaxHz: 680_000_000,
    profile: m.label,
    defaultProfile: 'balanced',
    perf: 'unknown',
    ...extra
  }
}

function sysfs(profile: string): SysfsPower {
  const m = MACHINE[profile]
  return {
    cpuGovernor: m.governor,
    cpuMaxKHz: m.maxKHz,
    gpuGovernor: 'simple_ondemand',
    gpuMaxHz: 680_000_000
  }
}

function status(profile: string): string {
  return `profile=${profile}\ndefault_profile=balanced\ncpu_caps={0: 2016000, 3: 2803200, 7: ${MACHINE[profile].maxKHz}}\n`
}

interface Fake {
  deps: PowerReadDeps
  asked: string[]
}

function fake(
  options: {
    profile?: string
    switches?: boolean
    reading?: (profile: string) => PowerState
    status?: (profile: string) => string | null
  } = {}
): Fake {
  let profile = options.profile ?? 'balanced'
  const asked: string[] = []
  const deps: PowerReadDeps = {
    power: async () => (options.reading ?? galleon)(profile),
    status: async () => (options.status ?? status)(profile),
    sysfs: async () => sysfs(profile),
    askForProfile: async (wanted): Promise<ProfileAnswer> => {
      asked.push(wanted)
      if (options.switches === false) return 'unchanged'
      profile = wanted
      return 'set'
    }
  }
  return { deps, asked }
}

async function run(f: Fake, profiles: string[], signal?: AbortSignal): Promise<CheckResult> {
  const out = await powerReadScenario(f.deps)({
    request: { profiles } as SelfTestRequest,
    safety: {} as Safety,
    signal: signal ?? new AbortController().signal
  })
  assert.ok(!Array.isArray(out))
  assert.equal(out.id, POWER_READ_CHECK)
  return out
}

describe('power.read', () => {
  test('passes on both profiles, switching only to the one not in force', async () => {
    const f = fake({ profile: 'performance' })
    const out = await run(f, ['performance', 'balanced'])
    assert.equal(out.result, 'pass', String(out.reason))
    assert.deepEqual(f.asked, ['balanced'])
    assert.equal(out.metrics['performance.profile'], 'performance')
    assert.equal(out.metrics['balanced.cpuGovernor'], 'conservative')
    assert.equal(out.metrics['balanced.sysfsCpuMaxKHz'], 2_092_800)
    assert.equal(out.metrics['balanced.statusCapKHz'], 2_092_800)
    assert.equal(out.metrics['balanced.gpuMaxMHz'], 680)
  })

  test('fails when the inferred profile is not the one armada-power names', async () => {
    const f = fake({
      reading: (p) => galleon(p, { profile: p === 'balanced' ? 'unknown' : MACHINE[p].label })
    })
    const out = await run(f, ['performance', 'balanced'])
    assert.equal(out.result, 'fail')
    assert.equal(out.reason, 'mismatch:balanced:profile')
  })

  test('fails on a governor, cap or clock that sysfs does not show', async () => {
    const f = fake({
      reading: (p) => galleon(p, { cpuGovernor: 'schedutil', gpuMaxHz: null, cpuCurKHz: 3e6 })
    })
    const out = await run(f, ['balanced'])
    assert.equal(out.result, 'fail')
    assert.equal(out.reason, 'mismatch:balanced:cpu-governor,balanced:cpu-cur,balanced:gpu-max')
  })

  test("fails when status's cap is not the prime cluster's maximum", async () => {
    const f = fake({ status: (p) => status(p).replace(/7: \d+/, '7: 1') })
    const out = await run(f, ['balanced'])
    assert.equal(out.reason, 'mismatch:balanced:cpu-cap')
  })

  test('fails when armada-power stops answering after the start', async () => {
    let calls = 0
    const f = fake({ status: (p) => (calls++ === 0 ? status(p) : null) })
    const out = await run(f, [])
    assert.equal(out.result, 'fail')
    assert.equal(out.reason, 'mismatch:no-status')
  })

  test('a profile run.sh does not set is a skip, never numbers filed under it', async () => {
    const f = fake({ profile: 'performance', switches: false })
    const out = await run(f, ['performance', 'balanced'])
    assert.equal(out.result, 'skip')
    assert.equal(out.reason, 'profile-not-set')
    assert.equal(out.metrics['balanced.profileObserved'], 'performance')
    assert.equal(out.metrics['balanced.profileAnswer'], 'unchanged')
    assert.equal(out.metrics['balanced.cpuGovernor'], undefined)
    assert.equal(out.metrics['performance.cpuGovernor'], 'performance')
  })

  test('with no profile named, the one in force is checked and nothing is asked', async () => {
    const f = fake()
    const out = await run(f, [])
    assert.equal(out.result, 'pass')
    assert.deepEqual(f.asked, [])
    assert.equal(out.metrics.profile, 'balanced')
  })

  test('off Armada it is a skip', async () => {
    const f = fake({
      status: () => null,
      reading: (p) => galleon(p, { defaultProfile: 'unknown' })
    })
    const out = await run(f, ['performance'])
    assert.deepEqual([out.result, out.reason], ['skip', 'not-armada'])
    assert.deepEqual(f.asked, [])
  })

  test('a stopped run is a skip', async () => {
    const stop = new AbortController()
    stop.abort()
    const out = await run(fake(), ['performance'], stop.signal)
    assert.deepEqual([out.result, out.reason], ['skip', 'aborted-by-user'])
  })
})

describe('statusCap', () => {
  test("reads the prime cluster's cap from cpu_caps, keyed by number or policy", () => {
    assert.equal(statusCap('cpu_caps={0: 2016000, 3: 2803200, 7: 2092800}'), 2_092_800)
    assert.equal(statusCap("cpu_caps={'policy0': 1, 'policy7': 2956800}"), 2_956_800)
    assert.equal(statusCap('cpu_caps={17: 5, 0: 1}'), null)
    assert.equal(statusCap('cpu_caps={}'), null)
    assert.equal(statusCap('cpu_caps=None'), null)
    assert.equal(statusCap(null), null)
  })
})

describe('readSysfsPower', () => {
  function root(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'galleon-sysfs-'))
    dirs.push(dir)
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    return dir
  }

  const cpu = 'sys/devices/system/cpu/cpufreq'
  const nova = {
    [`${cpu}/policy0/scaling_governor`]: 'conservative\n',
    [`${cpu}/policy0/scaling_max_freq`]: '2016000\n',
    [`${cpu}/policy7/scaling_governor`]: 'conservative\n',
    [`${cpu}/policy7/scaling_max_freq`]: '2092800\n',
    [`${cpu}/policy7/scaling_cur_freq`]: '1209600\n',
    'sys/class/devfreq/1d84000.ufshc/governor': 'simple_ondemand\n',
    'sys/class/devfreq/1d84000.ufshc/max_freq': '300000000\n',
    'sys/class/devfreq/3d00000.gpu/governor': 'msm-adreno-tz\n',
    'sys/class/devfreq/3d00000.gpu/max_freq': '680000000\n',
    'sys/class/devfreq/3d00000.gpu/cur_freq': '220000000\n'
  }

  test("finds the highest policy and the GPU, agreeing with Galleon's reading", async () => {
    const dir = root(nova)
    const found = await readSysfsPower(dir)
    assert.deepEqual(found, {
      cpuGovernor: 'conservative',
      cpuMaxKHz: 2_092_800,
      gpuGovernor: 'msm-adreno-tz',
      gpuMaxHz: 680_000_000
    })
    const read = await readPowerState(dir)
    assert.equal(read.cpuMaxKHz, found.cpuMaxKHz)
    assert.equal(read.gpuGovernor, found.gpuGovernor)
  })

  test('a machine without the files reads as unknown', async () => {
    assert.deepEqual(await readSysfsPower(root({})), {
      cpuGovernor: 'unknown',
      cpuMaxKHz: null,
      gpuGovernor: 'unknown',
      gpuMaxHz: null
    })
  })
})
