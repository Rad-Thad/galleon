import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import {
  gpuDevice,
  parseDefaultProfile,
  parseIni,
  parseNumber,
  parsePerfState,
  parseArmadaStatus,
  parseWord,
  profileInForce,
  powerState,
  readArmadaStatus,
  readPowerState,
  UNKNOWN
} from './powerstate.ts'

/**
 * The power state the overlay labels every frame-time figure with. The
 * fixtures are the Nova's two profiles as docs/DEVICE-FACTS.md records them,
 * with the content of Armada's files as the device published it, and a desktop
 * that has none of these files: there every value must say it is unknown
 * rather than invent one.
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
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures/armada', name), 'utf8')
const CONF = fixture('power-profiles.conf')
const PERF = fixture('perf-state.json')

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
    'usr/share/armada/power-profiles.conf': CONF,
    'run/armada/perf-state.json': PERF
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
      profile: 'Balanced',
      defaultProfile: 'balanced',
      perf: 'global.gamescopeNice=-20'
    })
  })

  test('the Nova on Performance', async () => {
    const state = await readPowerState(tree(nova('performance')))
    assert.equal(state.cpuGovernor, 'performance')
    assert.equal(state.cpuMaxKHz, 2956800)
    assert.equal(state.gpuCurHz, 680000000)
    assert.equal(state.profile, 'Performance')
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
      profile: UNKNOWN,
      defaultProfile: UNKNOWN,
      perf: UNKNOWN
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
      profileConf: null,
      perfState: null
    })
    assert.equal(state.cpuGovernor, 'performance')
    assert.equal(state.cpuMaxKHz, 2)
    assert.equal(state.gpuGovernor, UNKNOWN)
  })

  test("power-profiles.conf's sections and their keys", () => {
    const sections = parseIni(CONF)
    assert.equal(sections.get('general')?.get('default_profile'), 'balanced')
    assert.equal(sections.get('profile.eco')?.get('cpu_underclock'), 'large')
    assert.equal(sections.get('underclock.SM8550.medium')?.get('cpu_max_policy7'), '2092800')
    assert.equal(parseIni('# a=b\n; c=d\n[x]\nnot a pair\n').get('x')?.size, 0)
  })

  test('the profile in force is the only one the governor and the prime cap fit', () => {
    assert.equal(profileInForce(CONF, 'performance', 2956800), 'Performance')
    assert.equal(profileInForce(CONF, 'conservative', 2092800), 'Balanced')
    assert.equal(profileInForce(CONF, 'conservative', 1843200), 'Eco')
    // Another SoC's cap for the same level names the same profile.
    assert.equal(profileInForce(CONF, 'conservative', 2457600), 'Balanced')
  })

  test('and stays unknown when none fits, two fit, or something is missing', () => {
    assert.equal(profileInForce(CONF, 'conservative', 2956800), UNKNOWN, 'a cap by hand')
    assert.equal(profileInForce(CONF, 'performance', 2092800), UNKNOWN, 'capped, yet no underclock')
    assert.equal(profileInForce(CONF, 'schedutil', 2956800), UNKNOWN, 'no such governor')
    const twins = `${CONF}\n[profile.turbo]\ncpu_governor=performance\ncpu_underclock=none\n`
    assert.equal(profileInForce(twins, 'performance', 2956800), UNKNOWN)
    assert.equal(profileInForce(null, 'performance', 2956800), UNKNOWN)
    assert.equal(profileInForce(CONF, UNKNOWN, 2956800), UNKNOWN)
    assert.equal(profileInForce(CONF, 'performance', null), UNKNOWN)
  })

  test('a profile without a label is named by its section', () => {
    const conf = '[profile.quiet]\ncpu_governor=powersave\n'
    assert.equal(profileInForce(conf, 'powersave', 1000), 'quiet')
  })

  test('the perf contract, every entry under the layer that holds it', () => {
    assert.equal(parsePerfState(PERF), 'global.gamescopeNice=-20')
    assert.equal(
      parsePerfState('{"global": {"nice": 0}, "override": {"620": {"cores": "4-7"}}}'),
      'global.nice=0 override.620.cores=4-7'
    )
    const many = JSON.stringify({ global: Object.fromEntries([...'abcdefgh'].map((k) => [k, 1])) })
    assert.match(parsePerfState(many), /^global\.a=1 .* global\.f=1 …$/)
  })

  test('and unknown where it is missing, unreadable or empty', () => {
    assert.equal(parsePerfState(null), UNKNOWN)
    assert.equal(parsePerfState('{not json'), UNKNOWN)
    assert.equal(parsePerfState('{}'), UNKNOWN)
    assert.equal(parsePerfState('42'), UNKNOWN)
  })
})

describe("Armada's own report", () => {
  test('names the profile from its profile= line', () => {
    const status = [
      'profile=performance',
      'default_profile=balanced',
      "cpu_caps={'policy0': 1785600}",
      'gpu_level=0'
    ].join('\n')
    assert.equal(parseArmadaStatus(status), 'performance')
    assert.equal(parseArmadaStatus(' profile = Balanced \n'), 'Balanced')
  })

  test('anything but a plain word is unknown, as is no answer', () => {
    assert.equal(parseArmadaStatus(null), UNKNOWN)
    assert.equal(parseArmadaStatus('default_profile=balanced'), UNKNOWN)
    assert.equal(parseArmadaStatus('profile=http://host/x'), UNKNOWN)
    assert.equal(parseArmadaStatus('profile='), UNKNOWN)
  })

  test("wins over the clocks' inference when asked for, and the clocks stand when it fails", async () => {
    const root = tree(nova('balanced'))
    const told = await readPowerState(root, { status: async () => 'profile=eco\n' })
    assert.equal(told.profile, 'eco')
    assert.equal(told.cpuGovernor, 'conservative')
    const silent = await readPowerState(root, { status: async () => null })
    assert.equal(silent.profile, 'Balanced')
    const broken = await readPowerState(root, { status: () => Promise.reject(new Error('dbus')) })
    assert.equal(broken.profile, 'Balanced')
  })

  test('a machine without armada-power answers null', async () => {
    const path = process.env.PATH
    process.env.PATH = tree({})
    try {
      assert.equal(await readArmadaStatus(), null)
    } finally {
      process.env.PATH = path
    }
  })
})
