import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
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
  FOCUS_RETURN_CHECK,
  focusReturn,
  groupAlive,
  ownFocused,
  payloadFor,
  placeSaveBeside,
  PLACED_SAVE,
  runningInGroup,
  saveFingerprint,
  signalGroup,
  startPlan,
  type EmulatorScenarioDeps
} from './selftestemulators.ts'
import { NO_NEW_WINDOW_CHECK } from './selftestnowindow.ts'
import type { SandboxPlan } from './selftestsandbox.ts'
import { processGroup } from './selftestwindows.ts'
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
    needsBios: false,
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
  cycles: { emulator: string; plan: SandboxPlan; expectSave: boolean }[]
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
      cycle: async (emulator, given, _state, _signal, expectSave) => {
        cycles.push({ emulator, plan: given, expectSave })
        return [pass(`launch.${emulator}`), pass(`exit.${emulator}`)]
      },
      realPath: (path) => (path.startsWith('/home/test') ? path : null)
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
  const there = (path: string): string => path

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

  test('a payload that links out of the home is outside it', () => {
    const links = (path: string): string =>
      path === '/home/test/payloads/snes/hello.sfc' ? '/home/owner/roms/snes/game.sfc' : path
    assert.deepEqual(payloadFor('/home/test', 'payloads/snes/hello.sfc', links), {
      skip: LAUNCH_SKIP.payloadOutside
    })
  })

  test('the path handed on is the one its links lead to, inside the home', () => {
    const links = (path: string): string =>
      path === '/home/test/payloads/snes/hello.sfc' ? '/home/test/bundle/hello.sfc' : path
    assert.deepEqual(payloadFor('/home/test', 'payloads/snes/hello.sfc', links), {
      path: '/home/test/bundle/hello.sfc',
      system: 'snes'
    })
  })

  test('a payload not on disk is missing', () => {
    assert.deepEqual(
      payloadFor('/home/test', 'payloads/snes/hello.sfc', () => null),
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

  test('only an emulator the request says saves is held to its save folder', async () => {
    const h = harness({ retroarch: 'payloads/snes/hello.sfc', dolphin: 'payloads/gc/hello.dol' }, [
      state('retroarch'),
      state('dolphin')
    ])
    h.deps.savingPayloads = ['retroarch']
    const scenarios = emulatorScenarios(['exit.retroarch', 'exit.dolphin'], h.deps)
    await scenarios.get('exit.retroarch')!(context)
    await scenarios.get('exit.dolphin')!(context)
    assert.deepEqual(
      h.cycles.map((c) => [c.emulator, c.expectSave]),
      [
        ['retroarch', true],
        ['dolphin', false]
      ]
    )
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
    assert.deepEqual(h.cycles, [{ emulator: 'retroarch', plan: SKIP_PLAN, expectSave: false }])
  })
})

function exitWith(
  emulator: string,
  refocused: number | null,
  refocusMs: number | null
): CheckResult {
  return {
    ...pass(`exit.${emulator}`),
    result: refocused === 0 ? 'fail' : 'pass',
    metrics: { refocused, refocusMs }
  }
}

describe('focus.return', () => {
  test('passes when the focus came back after every exit, with the slowest return', () => {
    const result = focusReturn([exitWith('retroarch', 1, 400), exitWith('dolphin', 1, 1200)])
    assert.equal(result.id, FOCUS_RETURN_CHECK)
    assert.equal(result.result, 'pass', result.reason ?? '')
    assert.deepEqual(result.metrics, { exits: 2, refocused: 2, worstRefocusMs: 1200, missed: null })
  })

  test('fails when any exit left Galleon without the focus, naming it', () => {
    const result = focusReturn([exitWith('retroarch', 1, 400), exitWith('dolphin', 0, null)])
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'not-refocused')
    assert.equal(result.metrics.refocused, 1)
    assert.equal(result.metrics.missed, 'dolphin')
  })

  test('an exit that could not ask counts neither way', () => {
    const result = focusReturn([exitWith('retroarch', 1, 400), exitWith('dolphin', null, null)])
    assert.equal(result.result, 'pass')
    assert.equal(result.metrics.exits, 1)
  })

  test('with no exit measured it is a skip, never a pass', () => {
    for (const exits of [[], [exitWith('retroarch', null, null)], [skipped('exit.dolphin')]]) {
      const result = focusReturn(exits)
      assert.equal(result.result, 'skip')
      assert.equal(result.reason, 'no-exit-measured')
    }
  })

  test('asked first, it runs every named cycle once, which the exits then share', async () => {
    const h = harness({ retroarch: 'payloads/snes/hello.sfc', dolphin: 'payloads/gc/hello.dol' }, [
      state('retroarch'),
      state('dolphin')
    ])
    h.deps.cycle = async (emulator) => {
      h.cycles.push({ emulator, plan: SKIP_PLAN, expectSave: false })
      return [pass(`launch.${emulator}`), exitWith(emulator, emulator === 'dolphin' ? 0 : 1, 10)]
    }
    const scenarios = emulatorScenarios(
      [FOCUS_RETURN_CHECK, 'launch.retroarch', 'exit.retroarch', 'exit.dolphin'],
      h.deps
    )
    const result = (await scenarios.get(FOCUS_RETURN_CHECK)!(context)) as CheckResult
    await scenarios.get('exit.retroarch')!(context)
    await scenarios.get('exit.dolphin')!(context)
    assert.equal(result.result, 'fail')
    assert.equal(result.metrics.missed, 'dolphin')
    assert.deepEqual(
      h.cycles.map((c) => c.emulator),
      ['retroarch', 'dolphin']
    )
  })

  test('not asked, there is no scenario for it', () => {
    const { deps } = harness({}, [])
    assert.equal(emulatorScenarios(['exit.retroarch'], deps).has(FOCUS_RETURN_CHECK), false)
  })

  test('asked with no emulator, it skips', async () => {
    const { deps } = harness({}, [])
    const result = (await emulatorScenarios([FOCUS_RETURN_CHECK], deps).get(FOCUS_RETURN_CHECK)!(
      context
    )) as CheckResult
    assert.equal(result.result, 'skip')
  })
})

describe('focus.no-new-window among the emulator scenarios', () => {
  test('offered only with its deps, on a cycle of its own that carries the work', async () => {
    const h = harness({ retroarch: 'payloads/snes/hello.sfc' }, [state('retroarch')])
    const shown: boolean[] = []
    h.deps.cycle = async (emulator, _plan, _state, _signal, _expectSave, whileShown) => {
      shown.push(whileShown !== undefined)
      await whileShown?.(new AbortController().signal)
      return [pass(`launch.${emulator}`), pass(`exit.${emulator}`)]
    }
    const checks = ['launch.retroarch', NO_NEW_WINDOW_CHECK]
    assert.equal(emulatorScenarios(checks, h.deps).has(NO_NEW_WINDOW_CHECK), false)
    const covers: (string | null)[] = []
    h.deps.noNewWindow = {
      windows: () => ({ read: async () => [1], close: () => {} }),
      browserWindows: () => 1,
      cover: (emulator) => covers.push(emulator),
      download: async () => ({ ...pass('download.small'), result: 'skip', reason: 'none' }),
      noticeShown: async () => false
    }
    const scenarios = emulatorScenarios(checks, h.deps)
    await scenarios.get('launch.retroarch')!(context)
    const result = (await scenarios.get(NO_NEW_WINDOW_CHECK)!(context)) as CheckResult
    assert.equal(result.reason, 'download-none')
    assert.deepEqual(shown, [false, true])
    assert.deepEqual(covers, ['retroarch', null])
  })
})

function skipped(id: string): CheckResult {
  return { ...pass(id), result: 'skip', reason: 'no-payload' }
}

describe('a save placed beside the payload', () => {
  function placing(found: boolean): { h: Harness; log: string[] } {
    const log: string[] = []
    const h = harness({ melonds: 'payloads/nds/hello.nds' }, [state('melonds')])
    h.deps.placeSave = (_state, system, romPath) => {
      log.push(`place ${system} ${romPath}`)
      return {
        placed: true,
        found: async () => {
          log.push('found?')
          return found
        },
        remove: () => log.push('remove')
      }
    }
    return { h, log }
  }

  test('found by save discovery after the cycle, the launch passes and says so', async () => {
    const { h, log } = placing(true)
    const launch = (await emulatorScenarios(['launch.melonds'], h.deps).get('launch.melonds')!(
      context
    )) as CheckResult
    assert.equal(launch.result, 'pass')
    assert.equal(launch.metrics.saveFound, 1)
    assert.equal(launch.thresholds.saveFound, 1)
    assert.deepEqual(log, ['place nds /home/test/payloads/nds/hello.nds', 'found?', 'remove'])
  })

  test('not found, the launch fails, and the save is still taken away', async () => {
    const { h, log } = placing(false)
    const scenarios = emulatorScenarios(['launch.melonds', 'exit.melonds'], h.deps)
    const launch = (await scenarios.get('launch.melonds')!(context)) as CheckResult
    const exit = (await scenarios.get('exit.melonds')!(context)) as CheckResult
    assert.deepEqual([launch.result, launch.reason], ['fail', 'save-not-found'])
    assert.equal(launch.metrics.saveFound, 0)
    assert.equal(exit.result, 'pass')
    assert.deepEqual(log.slice(-1), ['remove'])
  })

  test('a launch that failed keeps its own reason, with the save recorded', async () => {
    const { h } = placing(false)
    h.deps.cycle = async () => [
      { ...pass('launch.melonds'), result: 'fail', reason: 'no-window' },
      pass('exit.melonds')
    ]
    const launch = (await emulatorScenarios(['launch.melonds'], h.deps).get('launch.melonds')!(
      context
    )) as CheckResult
    assert.deepEqual(
      [launch.result, launch.reason, launch.metrics.saveFound],
      ['fail', 'no-window', 0]
    )
  })

  test('a save that could not be placed fails the launch rather than leave it unasked', async () => {
    const h = harness({ melonds: 'payloads/nds/hello.nds' }, [state('melonds')])
    h.deps.placeSave = () => ({ placed: false, found: async () => true, remove: () => {} })
    const launch = (await emulatorScenarios(['launch.melonds'], h.deps).get('launch.melonds')!(
      context
    )) as CheckResult
    assert.deepEqual(
      [launch.result, launch.reason, launch.metrics.saveFound],
      ['fail', 'save-not-placed', 0]
    )
  })

  test('a skipped or erred launch is left as it was, and the save taken away', async () => {
    for (const result of ['skip', 'error'] as const) {
      const { h, log } = placing(false)
      const given = { ...pass('launch.melonds'), result, reason: 'aborted-by-user' }
      h.deps.cycle = async () => [given, pass('exit.melonds')]
      const launch = await emulatorScenarios(['launch.melonds'], h.deps).get('launch.melonds')!(
        context
      )
      assert.deepEqual(launch, given)
      assert.deepEqual(log.slice(-1), ['remove'])
      assert.ok(!log.includes('found?'))
    }
  })

  test('a cycle that throws still takes the save away', async () => {
    const { h, log } = placing(true)
    h.deps.cycle = async () => {
      throw new Error('boom')
    }
    await assert.rejects(async () =>
      emulatorScenarios(['launch.melonds'], h.deps).get('launch.melonds')!(context)
    )
    assert.deepEqual(log.slice(-1), ['remove'])
  })

  test('nothing is placed for a plan that cannot sandbox', async () => {
    const { h, log } = placing(true)
    const skipping = harness({ melonds: 'payloads/nds/hello.nds' }, [state('melonds')], SKIP_PLAN)
    skipping.deps.placeSave = h.deps.placeSave
    await emulatorScenarios(['launch.melonds'], skipping.deps).get('launch.melonds')!(context)
    assert.deepEqual(log, [])
  })
})

describe('placeSaveBeside', () => {
  function payload(home: string, system: string, name: string): string {
    mkdirSync(join(home, 'payloads', system), { recursive: true })
    const path = join(home, 'payloads', system, name)
    writeFileSync(path, 'rom')
    return path
  }

  test("melonDS's save goes beside the ROM, named after it, is found there and is taken away", async () => {
    const home = scratch()
    const rom = payload(home, 'nds', 'galleon-nds-hello.nds')
    const placed = placeSaveBeside(home)(
      state('melonds'),
      'nds',
      rom,
      runPlan(join(home, 'sandbox', 'melonds'), ['/apps/melonds'])
    )
    assert.ok(placed)
    const save = join(home, 'payloads', 'nds', 'galleon-nds-hello.sav')
    assert.equal(readFileSync(save, 'utf8'), PLACED_SAVE)
    assert.equal(await placed.found(), true)
    placed.remove()
    assert.equal(existsSync(save), false)
    assert.equal(existsSync(rom), true)
  })

  test('a placed save that went away is not found', async () => {
    const home = scratch()
    const rom = payload(home, 'nds', 'hello.nds')
    const placed = placeSaveBeside(home)(
      state('melonds'),
      'nds',
      rom,
      runPlan(join(home, 's'), ['/x'])
    )
    assert.ok(placed)
    rmSync(join(home, 'payloads', 'nds', 'hello.sav'))
    assert.equal(await placed.found(), false)
  })

  test('a file already there is neither written over nor taken away; no save is placed', () => {
    const home = scratch()
    const rom = payload(home, 'nds', 'hello.nds')
    const existing = join(home, 'payloads', 'nds', 'hello.sav')
    writeFileSync(existing, 'mine')
    const placed = placeSaveBeside(home)(
      state('melonds'),
      'nds',
      rom,
      runPlan(join(home, 's'), ['/x'])
    )
    assert.ok(placed)
    assert.equal(placed.placed, false)
    placed.remove()
    assert.equal(readFileSync(existing, 'utf8'), 'mine')
  })

  test('an emulator whose saves are in a save folder of its own gets none', () => {
    const home = scratch()
    const rom = payload(home, 'psx', 'hello.cue')
    const placed = placeSaveBeside(home)(
      state('duckstation'),
      'psx',
      rom,
      runPlan(join(home, 's'), ['/x'])
    )
    assert.equal(placed, null)
    assert.deepEqual(readdirSync(join(home, 'payloads', 'psx')), ['hello.cue'])
  })

  test('an emulator with no descriptor gets none', () => {
    const home = scratch()
    const rom = payload(home, 'nds', 'hello.nds')
    const placed = placeSaveBeside(home)(
      state('no-such'),
      'nds',
      rom,
      runPlan(join(home, 's'), ['/x'])
    )
    assert.equal(placed, null)
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
    // The leader has exited; its child goes on the signal, but under load a
    // moment later, so this waits for the group rather than assuming it gone.
    for (let i = 0; i < 250 && groupAlive(started.pid); i++) {
      await new Promise((r) => setTimeout(r, 20))
    }
    assert.equal(groupAlive(started.pid), false)
    assert.doesNotThrow(() => signalGroup(started.pid, 'SIGTERM'))
  })
})

describe('which of a group is still running', () => {
  function proc(entries: Record<string, string>): string {
    const dir = scratch()
    for (const [pid, stat] of Object.entries(entries)) {
      mkdirSync(join(dir, pid))
      writeFileSync(join(dir, pid, 'stat'), stat)
    }
    mkdirSync(join(dir, 'self'))
    return dir
  }

  test('a running member counts, even with a bracket in its name', () => {
    const dir = proc({ '41': '41 (emu) S 40 40 40 0', '42': '42 (a) b) R 41 40 40 0' })
    assert.equal(runningInGroup(40, dir), true)
  })

  test('a zombie does not, nor a process of another group', () => {
    const dir = proc({ '41': '41 (emu) Z 1 40 40 0', '50': '50 (other) S 1 50 50 0' })
    assert.equal(runningInGroup(40, dir), false)
  })

  test('a list that cannot be read is taken as running', () => {
    assert.equal(runningInGroup(40, join(scratch(), 'missing')), true)
  })

  test('a group the kernel no longer has is not alive, whatever the list says', () => {
    const dir = proc({ '41': '41 (emu) S 1 999999 999999 0' })
    assert.equal(groupAlive(999_999, dir), false)
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
      new AbortController().signal,
      false
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
      new AbortController().signal,
      false
    )

    assert.deepEqual([launch.reason, exit.reason], ['exited-early', 'exited-early'])
    assert.equal(launch.metrics.biosFiles, 1)
    assert.equal(opened, 1)
    assert.equal(display.closed, 1)
  })
})

describe('the save folder', () => {
  test('a folder made, or a folder in it, is no save; a new file is', () => {
    const dir = join(scratch(), 'saves')
    const missing = saveFingerprint(dir)
    assert.equal(saveFingerprint(dir), missing)
    mkdirSync(dir)
    assert.equal(saveFingerprint(dir), missing, 'a folder made empty is no save')
    const empty = saveFingerprint(dir)
    mkdirSync(join(dir, 'snes'))
    assert.equal(saveFingerprint(dir), empty, 'a folder alone is no save')
    writeFileSync(join(dir, 'snes', 'hello.srm'), 'x')
    assert.notEqual(saveFingerprint(dir), empty)
  })

  test('the same files give the same answer; a rewrite or a removal changes it', () => {
    const dir = scratch()
    const file = join(dir, 'hello.srm')
    writeFileSync(file, 'x')
    utimesSync(file, 1000, 1000)
    const before = saveFingerprint(dir)
    assert.equal(saveFingerprint(dir), before)
    writeFileSync(file, 'y')
    utimesSync(file, 2000, 2000)
    const rewritten = saveFingerprint(dir)
    assert.notEqual(rewritten, before)
    rmSync(file)
    assert.notEqual(saveFingerprint(dir), rewritten)
  })

  test('a link, to a file or a folder, is listed and not followed', () => {
    const dir = scratch()
    const owner = scratch()
    writeFileSync(join(owner, 'owner.srm'), 'x')
    symlinkSync(join(owner, 'owner.srm'), join(dir, 'link.srm'))
    symlinkSync(owner, join(dir, 'linked-folder'))
    const before = saveFingerprint(dir)
    writeFileSync(join(owner, 'owner.srm'), 'a longer save')
    writeFileSync(join(owner, 'another.srm'), 'x')
    assert.equal(saveFingerprint(dir), before)
  })
})

describe('ownFocused', () => {
  test("asks the window finder about Galleon's own group", async () => {
    const asked: number[] = []
    const focused = ownFocused(
      async (group) => {
        asked.push(group)
        return { focused: group === 70, fullscreen: null }
      },
      7,
      (pid) => pid * 10
    )
    assert.equal(await focused(), true)
    assert.deepEqual(asked, [70])
  })

  test('no window of the group, or no group, cannot tell', async () => {
    assert.equal(
      await ownFocused(
        async () => null,
        7,
        () => 70
      )(),
      null
    )
    let asked = 0
    const gone = ownFocused(
      async () => {
        asked += 1
        return { focused: true, fullscreen: null }
      },
      7,
      () => null
    )
    assert.equal(await gone(), null)
    assert.equal(asked, 0)
  })

  test("by default, this process's own group", async () => {
    let asked: number | null = null
    await ownFocused(async (group) => {
      asked = group
      return null
    })()
    assert.equal(asked, processGroup(process.pid))
  })
})
