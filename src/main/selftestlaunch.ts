import { log } from './log.ts'
import type { CheckResult } from './selftest.ts'
import { SKIP } from './selftest.ts'
import type { PreparedSandbox, SandboxPlan } from './selftestsandbox.ts'

/**
 * `launch.<emulator>` and `exit.<emulator>`: one emulator started in its
 * sandbox with a homebrew payload, seen to put up a focused window, then asked
 * to stop and seen to exit cleanly within the grace.
 *
 * The process, the window list and the clock are all given, so the cycle is
 * tested here in full against fakes; the device supplies the real ones.
 */

export const LAUNCH_PREFIX = 'launch.'
export const EXIT_PREFIX = 'exit.'

/** How long an emulator has to put up a focused window. */
export const WINDOW_TIMEOUT_MS = 30_000
/**
 * How long the window is left up once seen, so the emulator is past its own
 * start-up when it is asked to stop: a stop during start-up is not the stop
 * a player makes.
 */
export const SETTLE_MS = 3000
/** How long after SIGTERM an emulator has to exit before it is killed. */
export const EXIT_GRACE_MS = 10_000
export const POLL_MS = 250

/** What the window list says about the emulator's window. */
export interface WindowSighting {
  focused: boolean
  /** Null when the window list cannot tell. */
  fullscreen: boolean | null
}

export interface Exited {
  code: number | null
  signal: NodeJS.Signals | null
}

/** A started emulator: the group it leads, and how it ended. */
export interface Started {
  pid: number
  exited: Promise<Exited>
}

export interface LaunchDeps {
  prepare: (plan: Extract<SandboxPlan, { kind: 'run' }>) => PreparedSandbox
  /** Starts the plan as the leader of a new process group, or throws. */
  start: (plan: Extract<SandboxPlan, { kind: 'run' }>) => Started
  /**
   * The window of any process in the group, or null while there is none.
   * Only the group the cycle started is ever named.
   */
  findWindow: (group: number) => Promise<WindowSighting | null>
  /** Signals the group the cycle started, and nothing else. */
  signalGroup: (group: number, signal: NodeJS.Signals) => void
  /**
   * Whether any process of the group is still there. Asked only once the
   * leader has exited, while the group's id cannot yet belong to anything
   * else.
   */
  groupAlive: (group: number) => boolean
  /** See `straysToClear` and `clearStrays`. */
  straysToClear: (plan: Extract<SandboxPlan, { kind: 'run' }>) => string[]
  clearStrays: (paths: readonly string[]) => string[]
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Both checks for one emulator. Never throws, and never leaves the emulator
 * running: whatever happens after the start, anything left of the group is
 * asked to stop and, past the grace, killed, so the next check starts on an
 * empty screen.
 */
export async function launchCycle(
  emulator: string,
  plan: SandboxPlan,
  deps: LaunchDeps,
  signal: AbortSignal
): Promise<[CheckResult, CheckResult]> {
  const launchId = `${LAUNCH_PREFIX}${emulator}`
  const exitId = `${EXIT_PREFIX}${emulator}`
  const both = (result: CheckResult['result'], reason: string): [CheckResult, CheckResult] => [
    check(launchId, result, reason),
    check(exitId, result, reason)
  ]
  if (signal.aborted) return both('skip', SKIP.aborted)
  if (plan.kind === 'skip') return both('skip', plan.reason)
  let prepared: PreparedSandbox
  try {
    prepared = deps.prepare(plan)
  } catch (cause) {
    log.warn('selftest', 'a sandbox could not be prepared', { emulator, cause })
    return both('error', 'prepare-failed')
  }
  if (prepared.kind === 'skip') return both('skip', prepared.reason)

  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const strays = deps.straysToClear(plan)
  let started: Started
  try {
    started = deps.start(plan)
  } catch (cause) {
    log.warn('selftest', 'an emulator did not start', { emulator, cause })
    deps.clearStrays(strays)
    return both('error', 'spawn-failed')
  }

  const ended: { exit: Exited | null } = { exit: null }
  void started.exited.then((e) => (ended.exit = e))
  const exit = (): Exited | null => ended.exit
  const startedAt = now()
  const launch = await watchForWindow(started.pid, deps, signal, now, sleep, exit)
  const launchMs = now() - startedAt
  if (launch.sighting && !launch.early) {
    // In steps, so the player's abort is still answered within a second.
    const settleUntil = now() + SETTLE_MS
    while (!signal.aborted && exit() === null && now() < settleUntil) await sleep(POLL_MS)
  }
  const stop = await stopGroup(started, deps, now, sleep, exit)
  const removed = deps.clearStrays(strays)

  const launchMetrics = {
    windowMs: launch.sighting ? launchMs : null,
    focused: launch.sighting ? Number(launch.sighting.focused) : null,
    fullscreen: launch.sighting?.fullscreen == null ? null : Number(launch.sighting.fullscreen),
    biosFiles: prepared.biosFiles
  }
  const exitMetrics = {
    exitMs: stop.exitMs,
    code: stop.exited?.code ?? null,
    signal: stop.exited?.signal ?? null,
    killed: Number(stop.killed),
    straysRemoved: removed.length
  }
  if (signal.aborted) return both('skip', SKIP.aborted)

  const launchResult: CheckResult = {
    ...check(launchId, 'pass', null),
    metrics: launchMetrics,
    thresholds: { windowMs: WINDOW_TIMEOUT_MS }
  }
  if (launch.early) Object.assign(launchResult, { result: 'fail', reason: 'exited-early' })
  else if (!launch.sighting) Object.assign(launchResult, { result: 'fail', reason: 'no-window' })
  else if (!launch.sighting.focused) {
    Object.assign(launchResult, { result: 'fail', reason: 'not-focused' })
  } else if (launch.sighting.fullscreen === false) {
    Object.assign(launchResult, { result: 'fail', reason: 'not-fullscreen' })
  }

  const exitResult: CheckResult = {
    ...check(exitId, 'pass', null),
    metrics: exitMetrics,
    thresholds: { exitMs: EXIT_GRACE_MS, code: 0, killed: 0 }
  }
  // An emulator gone before it was asked was never stopped, so the stop it
  // makes for a player is untested.
  if (launch.early) Object.assign(exitResult, { result: 'fail', reason: 'exited-early' })
  else if (stop.killed) Object.assign(exitResult, { result: 'fail', reason: 'killed' })
  else if (stop.exited?.code !== 0) {
    Object.assign(exitResult, { result: 'fail', reason: 'exit-code' })
  }
  return [launchResult, exitResult]
}

interface Watched {
  sighting: WindowSighting | null
  /** The emulator exited on its own before a focused window was seen. */
  early: boolean
}

/**
 * Polls until a focused window, the timeout, the emulator's own exit or the
 * player's abort. An unfocused window is kept as the answer only if nothing
 * better turns up, since a window maps a moment before it takes focus.
 */
async function watchForWindow(
  group: number,
  deps: LaunchDeps,
  signal: AbortSignal,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  exit: () => Exited | null
): Promise<Watched> {
  const deadline = now() + WINDOW_TIMEOUT_MS
  let seen: WindowSighting | null = null
  while (!signal.aborted) {
    if (exit()) return { sighting: seen, early: true }
    try {
      seen = (await deps.findWindow(group)) ?? seen
    } catch (cause) {
      log.info('selftest', 'the window list could not be read', { cause })
    }
    if (seen?.focused) return { sighting: seen, early: false }
    if (now() >= deadline) break
    await sleep(POLL_MS)
  }
  return { sighting: seen, early: false }
}

interface Stopped {
  exited: Exited | null
  exitMs: number | null
  killed: boolean
}

/**
 * SIGTERM to the group, the grace, then SIGKILL. A kill is what a player
 * would never want, so the exit check fails on it, but leaving the emulator
 * holding the screen for the rest of the run is worse.
 *
 * The group is done only when it is empty, not when its leader has exited: an
 * AppImage's runtime or a launcher script can exit while the emulator it
 * started lives on in the group. A leader that went by itself is not
 * signalled unless something of its group is still there.
 */
async function stopGroup(
  started: Started,
  deps: LaunchDeps,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  exit: () => Exited | null
): Promise<Stopped> {
  const group = started.pid
  const early = exit()
  const askedAt = now()
  if (!early || deps.groupAlive(group)) deps.signalGroup(group, 'SIGTERM')
  while (now() - askedAt < EXIT_GRACE_MS) {
    const leader = exit()
    if (leader && !deps.groupAlive(group)) {
      return { exited: leader, exitMs: early ? null : now() - askedAt, killed: false }
    }
    await sleep(POLL_MS)
  }
  const leader = exit()
  if (leader && !deps.groupAlive(group)) {
    return { exited: leader, exitMs: early ? null : now() - askedAt, killed: false }
  }
  log.warn('selftest', 'an emulator ignored SIGTERM; killing its group', { pid: group })
  deps.signalGroup(group, 'SIGKILL')
  const killed =
    leader ?? (await Promise.race([started.exited, sleep(EXIT_GRACE_MS).then(() => null)]))
  return { exited: killed, exitMs: null, killed: true }
}

function check(id: string, result: CheckResult['result'], reason: string | null): CheckResult {
  return { id, result, metrics: {}, thresholds: {}, reason, evidence: [] }
}
