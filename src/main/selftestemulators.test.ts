import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import type { EmulatorState } from '@config/emulators'
import type { CheckResult } from './selftest.ts'
import {
  LAUNCH_SKIP,
  deviceCycle,
  devicePlan,
  emulatorOf,
  emulatorScenarios,
  groupAlive,
  payloadFor,
  signalGroup,
  startPlan,
  type EmulatorScenarioDeps
} from './selftestemulators.ts'
import type { SandboxPlan } from './selftestsandbox.ts'
import type { X11 } from './x11.ts'

/**
 * Which emulator and payload each launch and exit id gets, that both ids share
 * one cycle, and the device's process parts against real child processes.
 */

const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-emulators-'))
  scratches.push(dir)
  return dir
}

function state(id: string, overrides: Partial<EmulatorState> = {}): EmulatorState {
  return {
    id,
    name: id,
    available: true,
    install: { kind: 'appimage', ref: `/apps/${id}.AppImage` },
    configDir: null,
    dataDir: null,
    unavailableReason: null,
    paths: { home: null, roms: null, saves: null, states: null, bios: null },
    ...overrides
  } as EmulatorState
}

type RunPlan = Extract<SandboxPlan, { kind: 'run' }>

function runPlan(dir: string, argv: string[], env: Record<string, string> = {}): RunPlan {
  return {
    kind: 'run',
    argv,
    env,
    unset: [],
    strays: [],
    cwd: dir,
    bios: join(dir, 'bios'),
    folders: {
      root: dir,
      config: join(dir, 'config'),
      data: join(dir, 'data'),
      saves: join(dir, 'saves'),
      states: join(dir, 'states'),
      bios: join(dir, 'bios')
    },
    files: []
  }
}

const SKIP_PLAN: SandboxPlan = { kind: 'skip', reason: 'cannot-sandbox', detail: 'no-recipe' }

function pass(id: string): CheckResult {
  return { id, result: 'pass', metrics: {}, thresholds: {}, reason: null, evidence: [] }
}

interface Harness {
  deps: EmulatorScenarioDeps
  cycles: { emulator: string; plan: SandboxPlan }[]
  planned: { system: string; romPath: string }[]
}

function harness(
  payloads: Record<string, string>,
  emulators: EmulatorState[],
  plan: SandboxPlan = runPlan('/home/test/sandbox/emu', ['/apps/emu'])
): Harness {
  const cycles: Harness['cycles'] = []
  const planned: Harness['planned'] = []
  return {
    cycles,
    planned,
    deps: {
      home: '/home/test',
      payloads,
      emulators: async () => emulators,
      plan: (_state, system, romPath) => {
        planned.push({ system, romPath })
        return plan
      },
      cycle: async (emulator, given) => {
        cycles.push({ emulator, plan: given })
        return [pass(`launch.${emulator}`), pass(`exit.${emulator}`)]
      },
      exists: (path) => path.startsWith('/home/test/payloads/')
    }
  }
}

const context = { request: {} as never, safety: {} as never, signal: new AbortController().signal }

describe('which emulator an id names', () => {
  test('launch and exit ids name their emulator; any other id names none', () => {
    assert.equal(emulatorOf('launch.retroarch'), 'retroarch')
    assert.equal(emulatorOf('exit.duckstation'), 'duckstation')
    assert.equal(emulatorOf('launch.'), null)
    assert.equal(emulatorOf('grid.scroll'), null)
  })
})

describe('the payload', () => {
  const there = (): boolean => true

  test('a relative payload is found below the home, and its folder is its system', () => {
    assert.deepEqual(payloadFor('/home/test', 'payloads/snes/hello.sfc', there), {
      path: '/home/test/payloads/snes/hello.sfc',
      system: 'snes'
    })
  })

  test('an absolute payload inside the home is taken as it is', () => {
    assert.deepEqual(payloadFor('/home/test', '/home/test/p/gc/hello.dol', there), {
      path: '/home/test/p/gc/hello.dol',
      system: 'gc'
    })
  })

  test('none given, or an empty one, is no payload', () => {
    assert.deepEqual(payloadFor('/home/test', undefined, there), { skip: LAUNCH_SKIP.noPayload })
    assert.deepEqual(payloadFor('/home/test', '', there), { skip: LAUNCH_SKIP.noPayload })
  })

  test('a payload outside the home is never handed to an emulator', () => {
    for (const given of ['../owner/roms/snes/game.sfc', '/home/owner/roms/snes/game.sfc', '.']) {
      assert.deepEqual(payloadFor('/home/test', given, there), {
        skip: LAUNCH_SKIP.payloadOutside
      })
    }
  })

  test('a payload not on disk is missing', () => {
    assert.deepEqual(
      payloadFor('/home/test', 'payloads/snes/hello.sfc', () => false),
      { skip: LAUNCH_SKIP.payloadMissing }
    )
  })
})

describe('the scenarios', () => {
  test('one per launch or exit id, and none for the others', () => {
    const { deps } = harness({}, [])
    const scenarios = emulatorScenarios(
      ['grid.scroll', 'launch.retroarch', 'exit.retroarch', 'exit.dolphin'],
      deps
    )
    assert.deepEqual([...scenarios.keys()], ['launch.retroarch', 'exit.retroarch', 'exit.dolphin'])
  })

  test('launch and exit share one cycle, each answering for its own id', async () => {
    const h = harness({ retroarch: 'payloads/snes/hello.sfc' }, [state('retroarch')])
    const scenarios = emulatorScenarios(['launch.retroarch', 'exit.retroarch'], h.deps)

    const launch = await scenarios.get('launch.retroarch')!(context)
    const exit = await scenarios.get('exit.retroarch')!(context)

    assert.equal((launch as CheckResult).id, 'launch.retroarch')
    assert.equal((exit as CheckResult).id, 'exit.retroarch')
    assert.equal(h.cycles.length, 1)
    assert.deepEqual(h.planned, [{ system: 'snes', romPath: '/home/test/payloads/snes/hello.sfc' }])
  })

  test('an exit asked alone still runs the cycle', async () => {
    const h = harness({ dolphin: 'payloads/gc/hello.dol' }, [state('dolphin')])
    const scenarios = emulatorScenarios(['exit.dolphin'], h.deps)

    const exit = (await scenarios.get('exit.dolphin')!(context)) as CheckResult

    assert.equal(exit.id, 'exit.dolphin')
    assert.equal(exit.result, 'pass')
    assert.equal(h.cycles.length, 1)
  })

  test('without a payload both are skipped and nothing is started', async () => {
    const h = harness({}, [state('retroarch')])
    const scenarios = emulatorScenarios(['launch.retroarch', 'exit.retroarch'], h.deps)

    const launch = (await scenarios.get('launch.retroarch')!(context)) as CheckResult
    const exit = (await scenarios.get('exit.retroarch')!(context)) as CheckResult

    assert.deepEqual([launch.result, launch.reason], ['skip', LAUNCH_SKIP.noPayload])
    assert.deepEqual([exit.result, exit.reason], ['skip', LAUNCH_SKIP.noPayload])
    assert.equal(h.cycles.length, 0)
  })

  test('an emulator not installed, unavailable or without an install is skipped', async () => {
    for (const emulators of [
      [],
      [state('retroarch', { available: false })],
      [state('retroarch', { install: null })]
    ]) {
      const h = harness({ retroarch: 'payloads/snes/hello.sfc' }, emulators)
      const launch = (await emulatorScenarios(['launch.retroarch'], h.deps).get(
        'launch.retroarch'
      )!(context)) as CheckResult
      assert.deepEqual([launch.result, launch.reason], ['skip', LAUNCH_SKIP.notInstalled])
      assert.equal(h.cycles.length, 0)
    }
  })

  test('a plan that cannot sandbox goes to the cycle, which skips it', async () => {
    const h = harness({ retroarch: 'payloads/snes/hello.sfc' }, [state('retroarch')], SKIP_PLAN)
    await emulatorScenarios(['launch.retroarch'], h.deps).get('launch.retroarch')!(context)
    assert.deepEqual(h.cycles, [{ emulator: 'retroarch', plan: SKIP_PLAN }])
  })
})

describe('the device plan', () => {
  test('an emulator with no descriptor cannot be sandboxed', () => {
    const plan = devicePlan('/home/test')(state('no-such-emulator'), 'snes', '/home/test/p/x')
    assert.deepEqual(plan, { kind: 'skip', reason: 'cannot-sandbox', detail: 'no-descriptor' })
  })

  test('a known emulator goes through planSandbox', () => {
    const flatpak = state('duckstation', {
      install: { kind: 'flatpak', ref: 'org.duckstation.DuckStation' }
    })
    const plan = devicePlan('/home/test')(flatpak, 'psx', '/home/test/p/psx/hello.cue')
    assert.deepEqual(plan, { kind: 'skip', reason: 'cannot-sandbox', detail: 'flatpak-install' })
  })
})

describe('the device process', () => {
  test('a plan starts in its folder with its environment, as its own group', async () => {
    const dir = scratch()
    const started = startPlan(
      runPlan(dir, ['/bin/sh', '-c', 'echo "$GALLEON_PROBE $(ps -o pgid= $$)" > out'], {
        GALLEON_PROBE: 'sandboxed'
      }),
      { PATH: process.env.PATH }
    )
    assert.deepEqual(await started.exited, { code: 0, signal: null })
    const [probe, group] = readFileSync(join(dir, 'out'), 'utf8').trim().split(/\s+/)
    assert.equal(probe, 'sandboxed')
    assert.equal(Number(group), started.pid)
  })

  test('a program that is not there throws rather than start', () => {
    assert.throws(() => startPlan(runPlan(scratch(), ['/no/such/program'])))
  })

  test('the group is alive while any of it runs, and a SIGTERM empties it', async () => {
    const started = startPlan(runPlan(scratch(), ['/bin/sh', '-c', 'sleep 30 & wait']))
    assert.equal(groupAlive(started.pid), true)

    signalGroup(started.pid, 'SIGTERM')
    const exited = await started.exited

    assert.equal(exited.signal, 'SIGTERM')
    for (let i = 0; i < 50 && groupAlive(started.pid); i++) {
      await new Promise((r) => setTimeout(r, 20))
    }
    assert.equal(groupAlive(started.pid), false)
    assert.doesNotThrow(() => signalGroup(started.pid, 'SIGTERM'))
  })
})

describe('the device cycle', () => {
  function fakeDisplay(): { x11: X11; closed: number } {
    const fake = {
      closed: 0,
      x11: {
        root: 1,
        internAtom: async () => null,
        getProperty: async () => null,
        queryTree: async () => null,
        inputFocus: async () => null,
        close: () => {
          fake.closed += 1
        }
      }
    }
    return fake
  }

  test('a plan that cannot sandbox opens no display and starts nothing', async () => {
    let opened = 0
    const cycle = deviceCycle({}, async () => {
      opened += 1
      return null
    })
    const [launch, exit] = await cycle(
      'retroarch',
      SKIP_PLAN,
      state('retroarch'),
      new AbortController().signal
    )
    assert.deepEqual([launch.result, exit.result], ['skip', 'skip'])
    assert.equal(opened, 0)
  })

  test('the display is opened once for the cycle and closed after it', async () => {
    const dir = scratch()
    const display = fakeDisplay()
    let opened = 0
    const cycle = deviceCycle({ PATH: process.env.PATH }, async () => {
      opened += 1
      return display.x11
    })
    const bios = join(dir, 'owner-bios')
    mkdirSync(bios)
    writeFileSync(join(bios, 'scph5501.bin'), 'x')

    const [launch, exit] = await cycle(
      'emu',
      runPlan(join(dir, 'sandbox'), ['/bin/sh', '-c', 'sleep 0.6']),
      state('emu', { paths: { home: null, roms: null, saves: null, states: null, bios } }),
      new AbortController().signal
    )

    assert.deepEqual([launch.reason, exit.reason], ['exited-early', 'exited-early'])
    assert.equal(launch.metrics.biosFiles, 1)
    assert.equal(opened, 1)
    assert.equal(display.closed, 1)
  })
})
