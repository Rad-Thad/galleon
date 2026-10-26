import { spawn } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { emulatorById, type EmulatorState, type SaveLocation } from '@config/emulators'
import { t } from './i18n.ts'
import { log } from './log.ts'
import { fileSystemEnvironment } from './saveenv.ts'
import { findLocalAssets } from './saves.ts'
import type { CheckResult, Scenario } from './selftest.ts'
import {
  EXIT_PREFIX,
  LAUNCH_PREFIX,
  launchCycle,
  type Exited,
  type LaunchDeps,
  type Started
} from './selftestlaunch.ts'
import {
  CANNOT_SANDBOX,
  clearStrays,
  planSandbox,
  prepareSandbox,
  resolveLinks,
  sandboxEnvironment,
  straysToClear,
  type SandboxPlan
} from './selftestsandbox.ts'
import { processGroup, windowFinder, type WindowFinder } from './selftestwindows.ts'
import { openDisplay, type X11 } from './x11.ts'
import { realHome } from './xdg.ts'

/**
 * The scenarios behind every `launch.<emulator>` and `exit.<emulator>` a
 * request names: which installed emulator, which payload, which system.
 *
 * Both ids of one emulator are answered by the same cycle, run once on the
 * first of them asked, because an exit can only be measured on an emulator
 * that was started.
 */

/** Why a launch was not tried. Codes, not prose: they are read by the agent. */
export const LAUNCH_SKIP = {
  noPayload: 'no-payload',
  payloadOutside: 'payload-outside-home',
  payloadMissing: 'payload-missing',
  notInstalled: 'not-installed'
} as const

export interface EmulatorScenarioDeps {
  /** The test home; a relative payload is found below it. */
  home: string
  /** The request's `payloads`, by emulator id. */
  payloads: Readonly<Record<string, string>>
  /** The request's `savingPayloads`: emulators whose payload writes a save. */
  savingPayloads?: readonly string[]
  /** The probe's view of the installed emulators. */
  emulators: () => Promise<EmulatorState[]>
  /** `planSandbox` for this emulator, system and payload. */
  plan: (state: EmulatorState, system: string, romPath: string) => SandboxPlan
  /** `launchCycle` with the device's process, window list and owner's BIOS. */
  cycle: (
    emulator: string,
    plan: SandboxPlan,
    state: EmulatorState,
    signal: AbortSignal,
    expectSave: boolean
  ) => Promise<[CheckResult, CheckResult]>
  /** See `PlacedSave`; absent, no save is ever placed. */
  placeSave?: (
    state: EmulatorState,
    system: string,
    romPath: string,
    plan: Extract<SandboxPlan, { kind: 'run' }>
  ) => PlacedSave | null
  /** See `resolveLinks`. */
  realPath?: (path: string) => string | null
}

/**
 * A save put beside the payload before the cycle, for an emulator that keeps
 * its saves beside the ROM.
 *
 * A homebrew payload has no save memory to write, so the save the player's
 * would be is placed instead, and what is asked of the cycle is that save
 * discovery still finds it once the emulator has run and stopped: the half of
 * a save beside the ROM that is the emulator's and the device's, not the
 * descriptor's alone.
 */
export interface PlacedSave {
  /**
   * False when the emulator keeps its saves beside the ROM but none could be
   * put there: the check then fails rather than pass with its save half
   * unasked.
   */
  placed: boolean
  /** Whether save discovery finds the placed save now. Never throws. */
  found: () => Promise<boolean>
  /** Takes the placed save away again. Never throws. */
  remove: () => void
}

/** The emulator a launch or exit id names, or null for any other id. */
export function emulatorOf(id: string): string | null {
  for (const prefix of [LAUNCH_PREFIX, EXIT_PREFIX]) {
    if (id.startsWith(prefix) && id.length > prefix.length) return id.slice(prefix.length)
  }
  return null
}

/**
 * The payload's path, links followed, and its system, the name of the folder
 * the request puts it in (`payloads/snes/hello.sfc` is `snes`), or the reason
 * it cannot be used. A payload is kept inside the test home, as named and as
 * its links lead: the self-test never hands an emulator a file of the owner's.
 */
export function payloadFor(
  home: string,
  given: string | undefined,
  realPath: (path: string) => string | null = resolveLinks
): { path: string; system: string } | { skip: string } {
  if (given === undefined || given === '') return { skip: LAUNCH_SKIP.noPayload }
  const path = resolve(home, given)
  if (!inside(home, path) || given.includes('\0')) return { skip: LAUNCH_SKIP.payloadOutside }
  const real = realPath(path)
  if (real === null) return { skip: LAUNCH_SKIP.payloadMissing }
  if (!inside(realPath(home) ?? home, real)) return { skip: LAUNCH_SKIP.payloadOutside }
  return { path: real, system: basename(dirname(path)) }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** One scenario per launch or exit id in `checks`. */
export function emulatorScenarios(
  checks: readonly string[],
  deps: EmulatorScenarioDeps
): Map<string, Scenario> {
  const cycles = new Map<string, Promise<[CheckResult, CheckResult]>>()
  const pair = (emulator: string, signal: AbortSignal): Promise<[CheckResult, CheckResult]> => {
    let cycle = cycles.get(emulator)
    if (!cycle) {
      cycle = runOne(emulator, deps, signal)
      cycles.set(emulator, cycle)
    }
    return cycle
  }
  const scenarios = new Map<string, Scenario>()
  for (const id of checks) {
    const emulator = emulatorOf(id)
    if (emulator === null) continue
    const which = id.startsWith(LAUNCH_PREFIX) ? 0 : 1
    scenarios.set(id, async ({ signal }) => (await pair(emulator, signal))[which])
  }
  return scenarios
}

async function runOne(
  emulator: string,
  deps: EmulatorScenarioDeps,
  signal: AbortSignal
): Promise<[CheckResult, CheckResult]> {
  const both = (reason: string): [CheckResult, CheckResult] => [
    skipped(`${LAUNCH_PREFIX}${emulator}`, reason),
    skipped(`${EXIT_PREFIX}${emulator}`, reason)
  ]
  const payload = payloadFor(deps.home, deps.payloads[emulator], deps.realPath)
  if ('skip' in payload) return both(payload.skip)
  const state = (await deps.emulators()).find((e) => e.id === emulator)
  if (!state?.available || !state.install) return both(LAUNCH_SKIP.notInstalled)
  const plan = deps.plan(state, payload.system, payload.path)
  if (plan.kind === 'skip') {
    log.info('selftest', 'an emulator cannot be sandboxed', { emulator, detail: plan.detail })
  }
  const placed =
    plan.kind === 'run'
      ? (deps.placeSave?.(state, payload.system, payload.path, plan) ?? null)
      : null
  try {
    const [launch, exit] = await deps.cycle(
      emulator,
      plan,
      state,
      signal,
      deps.savingPayloads?.includes(emulator) ?? false
    )
    return [placed ? await withSaveFound(launch, placed) : launch, exit]
  } finally {
    placed?.remove()
  }
}

/**
 * The launch result held also to the placed save being found. A launch that
 * was skipped or erred is left as it was: a save found or not says nothing
 * about an emulator that never ran.
 */
async function withSaveFound(launch: CheckResult, placed: PlacedSave): Promise<CheckResult> {
  if (launch.result === 'skip' || launch.result === 'error') return launch
  const found = placed.placed && (await placed.found())
  const result: CheckResult = {
    ...launch,
    metrics: { ...launch.metrics, saveFound: Number(found) },
    thresholds: { ...launch.thresholds, saveFound: 1 }
  }
  if (launch.result === 'pass' && !found) {
    const reason = placed.placed ? 'save-not-found' : 'save-not-placed'
    Object.assign(result, { result: 'fail', reason })
  }
  return result
}

function skipped(id: string, reason: string): CheckResult {
  return { id, result: 'skip', metrics: {}, thresholds: {}, reason, evidence: [] }
}

/**
 * The plan started as the leader of a new process group, with no terminal
 * and nothing read from it, so the group's id is the pid this run recorded.
 */
export function startPlan(
  plan: Extract<SandboxPlan, { kind: 'run' }>,
  parentEnv: Readonly<Record<string, string | undefined>> = process.env
): Started {
  const [cmd, ...args] = plan.argv
  const child = spawn(cmd, args, {
    cwd: plan.cwd,
    env: sandboxEnvironment(plan, parentEnv),
    detached: true,
    stdio: 'ignore'
  })
  const exited = new Promise<Exited>((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
    // Listened for whatever happens: an unheard 'error' would end the app.
    child.once('error', (cause) => log.warn('selftest', 'an emulator process erred', { cause }))
  })
  if (child.pid === undefined)
    throw new Error(t('error.emulatorNotInstalled', { name: basename(cmd) }))
  return { pid: child.pid, exited }
}

/** Signals the group `group` leads; a group that is already gone is not an error. */
export function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause
  }
}

/**
 * Whether anything of the group is left. See `LaunchDeps.groupAlive`.
 *
 * A zombie is not counted: a member killed with its leader stays in the group
 * until whatever adopted it reaps it, and that is no emulator still running.
 */
export function groupAlive(group: number, procDir = '/proc'): boolean {
  try {
    process.kill(-group, 0)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EPERM') return false
  }
  return runningInGroup(group, procDir)
}

/**
 * Whether `procDir` lists a process of the group that is not a zombie. When
 * the list cannot be read the group is taken as running, so it is still
 * stopped rather than left.
 */
export function runningInGroup(group: number, procDir = '/proc'): boolean {
  let entries: string[]
  try {
    entries = readdirSync(procDir)
  } catch {
    return true
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue
    let stat: string
    try {
      stat = readFileSync(join(procDir, name, 'stat'), 'utf8')
    } catch {
      continue
    }
    // Counted from the last closing bracket, as the command name may hold one.
    const [state, , pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    if (Number(pgrp) === group && state !== 'Z') return true
  }
  return false
}

/**
 * `LaunchDeps.saveFingerprint` on a disk: every file below `folder` with its
 * size and modification time, links not followed. A folder that is not there
 * holds no save, like an empty one; a file that cannot be read is part of the
 * answer rather than an error, so the cycle never throws over it.
 */
export function saveFingerprint(folder: string): string {
  const lines: string[] = []
  // Walked by hand: a recursive readdir goes through links to folders.
  const walk = (dir: string, prefix: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of names) {
      const rel = prefix + name
      try {
        const st = lstatSync(join(dir, name))
        // Only files: an emulator can make a folder per core or game on
        // loading it, and a folder alone is no save.
        if (st.isDirectory()) walk(join(dir, name), `${rel}/`)
        else lines.push(`${rel} ${st.size} ${st.mtimeMs}`)
      } catch {
        lines.push(`${rel} ?`)
      }
    }
  }
  walk(folder, '')
  return lines.join('\n')
}

/** What a placed save holds: no emulator reads it, it only has to be found. */
export const PLACED_SAVE = 'galleon self-test save\n'

/**
 * `EmulatorScenarioDeps.placeSave` on a disk. Only for an emulator whose
 * descriptor, asked about the payload in its sandbox, keeps the saves of a
 * ROM beside it, named after it; any other is left to its own save folder
 * (see `savingPayloads`). The save is named as the descriptor's own emulator
 * names one, `<rom stem>.sav`, and is never written over a file already there,
 * nor taken away unless it was placed; one that cannot be placed is said so
 * (see `PlacedSave.placed`).
 */
export function placeSaveBeside(
  home: string,
  env = fileSystemEnvironment()
): NonNullable<EmulatorScenarioDeps['placeSave']> {
  return (state, system, romPath, plan) => {
    const location = besideRom(state, system, romPath, plan, home, env)
    if (location === 'unknown') return NOT_PLACED
    if (!location) return null
    const stem = basename(romPath).replace(/\.[^.]+$/, '')
    const path = join(location.dir, `${stem}.sav`)
    try {
      writeFileSync(path, PLACED_SAVE, { flag: 'wx' })
    } catch (cause) {
      log.warn('selftest', 'a save could not be placed beside the payload', { cause })
      return NOT_PLACED
    }
    return {
      placed: true,
      found: async () => {
        try {
          const assets = await findLocalAssets(env, location, stem, 'save')
          return assets.some((asset) => asset.path === path)
        } catch (cause) {
          log.info('selftest', 'save discovery failed in the sandbox', { cause })
          return false
        }
      },
      remove: () => {
        try {
          rmSync(path, { force: true })
        } catch (cause) {
          log.warn('selftest', 'a placed save could not be removed', { cause })
        }
      }
    }
  }
}

const NOT_PLACED: PlacedSave = { placed: false, found: async () => false, remove: () => {} }

/**
 * The descriptor's save location for the payload, when it is the payload's own
 * folder; `unknown` when the descriptor could not say, which is a fault in it
 * rather than an emulator that keeps its saves elsewhere.
 */
function besideRom(
  state: EmulatorState,
  system: string,
  romPath: string,
  plan: Extract<SandboxPlan, { kind: 'run' }>,
  home: string,
  env: ReturnType<typeof fileSystemEnvironment>
): SaveLocation | 'unknown' | null {
  const descriptor = emulatorById(state.id)
  if (!descriptor) return null
  const { folders } = plan
  try {
    const { saves } = descriptor.saves({
      paths: {
        home: folders.root,
        roms: dirname(romPath),
        saves: folders.saves,
        states: folders.states,
        bios: plan.bios
      },
      system,
      romPath,
      romDir: dirname(romPath),
      romStem: basename(romPath).replace(/\.[^.]+$/, ''),
      home,
      configDir: folders.config,
      dataDir: folders.data,
      installDir: null,
      env
    })
    if (saves?.match !== 'rom-stem' || resolve(saves.dir) !== dirname(romPath)) return null
    return saves
  } catch (cause) {
    log.info('selftest', 'a descriptor could not say where saves live', {
      emulator: state.id,
      cause
    })
    return 'unknown'
  }
}

/** `EmulatorScenarioDeps.plan` on the device: the owner's install, read and never written. */
export function devicePlan(home: string): EmulatorScenarioDeps['plan'] {
  return (state, system, romPath) => {
    const descriptor = emulatorById(state.id)
    if (!descriptor || !state.install) {
      return { kind: 'skip', reason: CANNOT_SANDBOX, detail: 'no-descriptor' }
    }
    return planSandbox({
      descriptor,
      install: state.install,
      system,
      romPath,
      home,
      owner: {
        home: realHome(),
        configDir: state.configDir,
        dataDir: state.dataDir,
        env: fileSystemEnvironment()
      },
      realPath: resolveLinks
    })
  }
}

/**
 * `LaunchDeps.ownFocused` over a window finder: Galleon's window is the one
 * whose process is in Galleon's own group, which the emulator never shares
 * since it is started as the leader of a new one (see `startPlan`).
 */
export function ownFocused(
  findWindow: LaunchDeps['findWindow'],
  self: number = process.pid,
  groupOf: (pid: number) => number | null = processGroup
): LaunchDeps['ownFocused'] {
  return async () => {
    const group = groupOf(self)
    if (group === null) return null
    return (await findWindow(group))?.focused ?? null
  }
}

/**
 * `EmulatorScenarioDeps.cycle` on the device. The display is opened on the
 * first look for a window and closed after the cycle, and each cycle has its
 * own finder, since a finder keeps the atoms it found missing.
 */
export function deviceCycle(
  env: NodeJS.ProcessEnv = process.env,
  open: (env: NodeJS.ProcessEnv) => Promise<X11 | null> = openDisplay
): EmulatorScenarioDeps['cycle'] {
  return async (emulator, plan, state, signal, expectSave) => {
    const opened: { display: Promise<X11 | null> | null; finder: WindowFinder | null } = {
      display: null,
      finder: null
    }
    const findWindow: LaunchDeps['findWindow'] = async (group) => {
      opened.display ??= open(env)
      const x11 = await opened.display
      if (!x11) return null
      opened.finder ??= windowFinder(x11)
      return opened.finder.findWindow(group)
    }
    try {
      return await launchCycle(
        emulator,
        plan,
        {
          start: (p) => startPlan(p, env),
          signalGroup,
          groupAlive: (group) => groupAlive(group),
          prepare: (p) => prepareSandbox(p, state.paths.bios),
          findWindow,
          ownFocused: ownFocused(findWindow),
          straysToClear: (p) => straysToClear(p),
          clearStrays,
          saveFingerprint
        },
        signal,
        expectSave
      )
    } finally {
      ;(await opened.display)?.close()
    }
  }
}
