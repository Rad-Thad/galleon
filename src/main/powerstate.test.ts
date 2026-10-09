import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import {
  gpuDevice,
  parseDefaultProfile,
  parseNumber,
  parseWord,
  powerState,
  readPowerState,
  UNKNOWN
} from './powerstate.ts'

/**
 * The power state the overlay labels every frame-time figure with. The
 * fixtures are the Nova's two profiles as docs/DEVICE-FACTS.md records them,
 * and a desktop that has none of these files: there every value must say it is
 * unknown rather than invent one.
 */

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'galleon-power-'))
  roots.push(root)
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

const POLICY = 'sys/devices/system/cpu/cpufreq/policy7'
const GPU = 'sys/class/devfreq/3d00000.gpu'
const CONF = [
  '# Armada power profiles',
  'default_profile=balanced',
  '',
  '[balanced]',
  'cpu_governor=conservative',
  'cpu_max=1.0',
  ''
].join('\n')

function nova(profile: 'balanced' | 'performance'): Record<string, string> {
  const balanced = profile === 'balanced'
  return {
    [`${POLICY}/scaling_governor`]: balanced ? 'conservative\n' : 'performance\n',
    [`${POLICY}/scaling_cur_freq`]: balanced ? '595200\n' : '2956800\n',
    [`${POLICY}/scaling_max_freq`]: balanced ? '2092800\n' : '2956800\n',
    'sys/class/devfreq/soc:qcom,cpu-llcc-ddr-bw/governor': 'performance\n',
    [`${GPU}/governor`]: 'simple_ondemand\n',
    [`${GPU}/cur_freq`]: balanced ? '220000000\n' : '680000000\n',
    [`${GPU}/max_freq`]: '680000000\n',
    'usr/share/armada/power-profiles.conf': CONF
  }
}

describe('the power state', () => {
  test('the Nova on Balanced', async () => {
    assert.deepEqual(await readPowerState(tree(nova('balanced'))), {
      cpuGovernor: 'conservative',
      cpuCurKHz: 595200,
      cpuMaxKHz: 2092800,
      gpuGovernor: 'simple_ondemand',
      gpuCurHz: 220000000,
      gpuMaxHz: 680000000,
      defaultProfile: 'balanced'
    })
  })

  test('the Nova on Performance', async () => {
    const state = await readPowerState(tree(nova('performance')))
    assert.equal(state.cpuGovernor, 'performance')
    assert.equal(state.cpuMaxKHz, 2956800)
    assert.equal(state.gpuCurHz, 680000000)
  })

  test('an edited profile file in /etc wins over the factory one', async () => {
    const root = tree({
      ...nova('balanced'),
      'etc/armada/power-profiles.conf': 'default_profile=performance\n'
    })
    assert.equal((await readPowerState(root)).defaultProfile, 'performance')
  })

  test('a desktop with none of these files: every value unknown', async () => {
    assert.deepEqual(await readPowerState(tree({})), {
      cpuGovernor: UNKNOWN,
      cpuCurKHz: null,
      cpuMaxKHz: null,
      gpuGovernor: UNKNOWN,
      gpuCurHz: null,
      gpuMaxHz: null,
      defaultProfile: UNKNOWN
    })
  })

  test('a CPU without the prime cluster still reports the GPU', async () => {
    const files = nova('balanced')
    for (const key of Object.keys(files)) if (key.startsWith(POLICY)) delete files[key]
    const state = await readPowerState(tree(files))
    assert.equal(state.cpuGovernor, UNKNOWN)
    assert.equal(state.gpuGovernor, 'simple_ondemand')
  })
})

describe('the parsers', () => {
  test('sysfs words and numbers', () => {
    assert.equal(parseWord('schedutil\n'), 'schedutil')
    assert.equal(parseWord('  \n'), UNKNOWN)
    assert.equal(parseWord(null), UNKNOWN)
    assert.equal(parseNumber('2092800\n'), 2092800)
    assert.equal(parseNumber('<unsupported>'), null)
    assert.equal(parseNumber('-1'), null)
    assert.equal(parseNumber(null), null)
  })

  test('the default profile, however it is spaced or quoted', () => {
    assert.equal(parseDefaultProfile(CONF), 'balanced')
    assert.equal(parseDefaultProfile('  default_profile = "eco"\n'), 'eco')
    assert.equal(parseDefaultProfile('#default_profile=eco\n'), UNKNOWN)
    assert.equal(parseDefaultProfile('cpu_max=1.0\n'), UNKNOWN)
    assert.equal(parseDefaultProfile(null), UNKNOWN)
  })

  test('the GPU is the devfreq device named for it, not the memory bus', () => {
    assert.equal(gpuDevice(['soc:qcom,cpu-llcc-ddr-bw', '3d00000.gpu']), '3d00000.gpu')
    assert.equal(gpuDevice(['kgsl-3d0-gpu']), 'kgsl-3d0-gpu')
    assert.equal(gpuDevice(['soc:qcom,gpubw']), null)
    assert.equal(gpuDevice([]), null)
  })

  test('powerState composes the parsers', () => {
    const state = powerState({
      cpuGovernor: 'performance',
      cpuCur: '1',
      cpuMax: '2',
      gpuGovernor: null,
      gpuCur: null,
      gpuMax: null,
      profileConf: null
    })
    assert.equal(state.cpuGovernor, 'performance')
    assert.equal(state.cpuMaxKHz, 2)
    assert.equal(state.gpuGovernor, UNKNOWN)
  })
})
