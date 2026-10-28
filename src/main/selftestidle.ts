import type { WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import type { PowerState } from '@shared/types'
import thresholds from '../../test/device/thresholds.json' with { type: 'json' }
import { log } from './log.ts'
import type { CheckResult, Scenario } from './selftest.ts'
import type { ProfileAnswer } from './selftestscroll.ts'
import { homeProbe } from './selfteststartup.ts'

/**
 * `idle.cpu`: what Galleon costs on the Nova while nobody touches it, and how
 * quickly it answers once somebody does (M1-27).
 *
 * The launcher sits on Home for hours between games, on Balanced's
 * conservative governor, where every wake for nothing keeps a core from
 * settling. The CPU time of every process the app runs is read from `/proc`
 * over a minute on Home with no input; then a pad press that only this page
 * can see is timed to the highlight's move, since what idles cheaply may wake
 * slowly. test/app/idle.nightly.ts measures the same under Xvfb in CI.
 */

export const IDLE_CHECK = 'idle.cpu'

/**
 * The budget, from test/device/thresholds.json so the bundle on the device and
 * the build that judges against it read the same numbers.
 */
export const IDLE_CPU_BUDGET_S = thresholds[IDLE_CHECK].cpuSeconds
/** What the press after idle may take to move the highlight, beyond one frame. */
export const LATENCY_SLACK_MS = thresholds[IDLE_CHECK].latencySlackMs

/** The profile the budget is stated for: Armada's default, the one the owner lives on. */
export const MEASURED_ON = 'balanced'

/** How long the app is left alone on Home while it is measured. */
export const IDLE_MS = 60_000
/**
 * How long Home is given before the window opens, so the work of arriving (a
 * page of covers, the earlier checks' leftovers) is not counted as idle.
 */
export const SETTLE_MS = 10_000
/** How long Home, and then the highlight's move, are waited for. */
export const PAGE_TIMEOUT_MS = 15_000
/** How many frames are timed to tell how long one is. */
export const FRAMES_TIMED = 30

/**
 * The kernel's clock ticks per second in `/proc/<pid>/stat`: USER_HZ, which
 * the ABI fixes on every architecture Galleon is built for, so it is not read
 * at run time and nothing is started inside the window.
 */
export const USER_HZ = 100

/** Down on the D-pad, as the standard mapping numbers it. See `BUTTON` in `input/gamepad.ts`. */
const DPAD_DOWN = 13

/**
 * Marks the page's own pad, which the abort watch passes over (see
 * `inputProbe`): a real controller ends the run, this one is the run.
 */
export const SELF_TEST_PAD = '__galleonSelfTestPad'

/** One of the app's processes, as Electron lists them. */
export interface AppProcess {
  pid: number
  /** Electron's name for it: `Browser`, `Tab`, `GPU`, `Utility`, … */
  type: string
}

export interface PressTiming {
  /** From the press to the first frame after the highlight moved, or -1 if it never did. */
  latencyMs: number
  /** One frame, the median of those timed after the press. */
  frameMs: number
}

export interface IdlePage {
  /** Back to Home and settled there; false when it never came. */
  home: (timeoutMs: number) => Promise<boolean>
  /** Press Down on the page's own pad and time the highlight's move. */
  press: (timeoutMs: number) => Promise<PressTiming | null>
}

export interface IdleScenarioDeps {
  /** Every process the app runs. Electron's list, so no command line is matched. */
  processes: () => AppProcess[]
  /** A process's CPU time so far, user and system, in clock ticks; null once it is gone. */
  ticks: (pid: number) => Promise<number | null>
  page: IdlePage
  power: () => Promise<PowerState>
  askForProfile: (profile: string, signal: AbortSignal) => Promise<ProfileAnswer>
  /** Waits, ending early on abort. Replaced in tests. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
}

/** A process's user and system time from its stat line, in clock ticks. */
export function statTicks(line: string): number | null {
  // The name is in parentheses and may hold anything, spaces and parentheses
  // included, so the fields are counted from the last closing one.
  const close = line.lastIndexOf(')')
  if (close < 0) return null
  const fields = line.slice(close + 2).split(' ')
  const ticks = Number(fields[11]) + Number(fields[12])
  return Number.isFinite(ticks) ? ticks : null
}

export async function readTicks(pid: number): Promise<number | null> {
  const line = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null)
  return line === null ? null : statTicks(line)
}

interface Snapshot {
  type: string
  ticks: number
}

async function snapshot(deps: IdleScenarioDeps): Promise<Map<number, Snapshot>> {
  const out = new Map<number, Snapshot>()
  for (const { pid, type } of deps.processes()) {
    const ticks = await deps.ticks(pid)
    if (ticks !== null) out.set(pid, { type, ticks })
  }
  return out
}

/**
 * Seconds of CPU over the window, in all and by kind of process. A process
 * started inside the window counts from nothing; one that ended inside it is
 * lost, which leaves the number low, never high.
 */
export function spent(
  start: ReadonlyMap<number, Snapshot>,
  end: ReadonlyMap<number, Snapshot>
): { seconds: number; byType: Record<string, number> } {
  let ticks = 0
  const byType: Record<string, number> = {}
  for (const [pid, now] of end) {
    const used = Math.max(0, now.ticks - (start.get(pid)?.ticks ?? 0))
    ticks += used
    byType[now.type] = (byType[now.type] ?? 0) + used
  }
  const seconds = (t: number): number => Math.round((t / USER_HZ) * 100) / 100
  return {
    seconds: seconds(ticks),
    byType: Object.fromEntries(Object.entries(byType).map(([type, t]) => [type, seconds(t)]))
  }
}

const abortableWait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })

export function idleScenario(deps: IdleScenarioDeps): Scenario {
  const wait = deps.wait ?? abortableWait
  return async ({ signal }) => {
    const metrics: CheckResult['metrics'] = {}
    const result = (outcome: CheckResult['result'], reason: string | null): CheckResult => ({
      id: IDLE_CHECK,
      result: outcome,
      metrics,
      thresholds: { cpuSeconds: IDLE_CPU_BUDGET_S, latencySlackMs: LATENCY_SLACK_MS },
      reason,
      evidence: []
    })
    if (signal.aborted) return result('skip', 'aborted-by-user')

    // Measured only on the profile the budget is for: a minute on Performance
    // costs a different amount and would be filed under the wrong number.
    const now = (await deps.power().catch(() => null))?.profileId.toLowerCase()
    const answer = now === MEASURED_ON ? 'set' : await deps.askForProfile(MEASURED_ON, signal)
    const before = await deps.power().catch(() => null)
    metrics.profileObserved = before?.profileId.toLowerCase() ?? 'unknown'
    metrics.governor = before?.cpuGovernor ?? 'unknown'
    if (signal.aborted) return result('skip', 'aborted-by-user')
    if (metrics.profileObserved !== MEASURED_ON) {
      metrics.profileAnswer = answer
      return result('skip', 'profile-not-set')
    }

    if (!(await deps.page.home(PAGE_TIMEOUT_MS))) return result('error', 'home-not-reached')
    await wait(SETTLE_MS, signal)
    if (signal.aborted) return result('skip', 'aborted-by-user')

    const start = await snapshot(deps)
    await wait(IDLE_MS, signal)
    if (signal.aborted) return result('skip', 'aborted-by-user')
    const end = await snapshot(deps)
    const { seconds, byType } = spent(start, end)
    metrics.cpuSeconds = seconds
    metrics.processes = end.size
    for (const [type, s] of Object.entries(byType)) metrics[`cpu${type.replace(/\W/g, '')}S`] = s
    // The renderer is most of an idle page's cost, so a count without it
    // would pass while measuring little.
    if (![...end.values()].some((p) => p.type === 'Tab'))
      return result('error', 'renderer-not-counted')

    // Straight after the window, so the press follows the full minute of idle.
    const timing = await deps.page.press(PAGE_TIMEOUT_MS)
    if (signal.aborted) return result('skip', 'aborted-by-user')
    if (!timing) return result('error', 'press-not-timed')
    metrics.frameMs = Math.round(timing.frameMs * 10) / 10
    if (timing.latencyMs < 0) return result('fail', 'highlight-did-not-move')
    metrics.latencyMs = Math.round(timing.latencyMs * 10) / 10

    if (seconds >= IDLE_CPU_BUDGET_S) return result('fail', 'over-cpu-budget')
    if (timing.latencyMs > timing.frameMs + LATENCY_SLACK_MS)
      return result('fail', 'slow-after-idle')
    return result('pass', null)
  }
}

/**
 * Run in the page: put the self-test's own pad in front of any real one, with
 * Down held, and resolve with how long the highlight took to move, timed on
 * the page's clock from the press to the first frame after it moved. The pad
 * comes out again before this resolves, so the interface is left reading the
 * real controllers alone.
 */
export function pressProbe(timeoutMs: number): string {
  return `new Promise((resolve) => {
    const real = navigator.getGamepads
    const pad = {
      ${SELF_TEST_PAD}: true,
      id: 'Galleon self-test pad',
      index: 0,
      mapping: 'standard',
      connected: true,
      timestamp: performance.now(),
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0]
    }
    const unplug = () => {
      navigator.getGamepads = real
    }
    const frames = (latencyMs) => {
      const times = []
      const tick = (time) => {
        times.push(time)
        if (times.length <= ${FRAMES_TIMED}) return requestAnimationFrame(tick)
        const gaps = times.slice(1).map((one, i) => one - times[i]).sort((a, b) => a - b)
        resolve({ latencyMs, frameMs: gaps[Math.floor(gaps.length / 2)] })
      }
      requestAnimationFrame(tick)
    }
    const before = document.querySelector('[data-focused="true"]')
    const observer = new MutationObserver(() => {
      const now = document.querySelector('[data-focused="true"]')
      if (!now || now === before) return
      observer.disconnect()
      clearTimeout(timer)
      requestAnimationFrame(() => {
        const latencyMs = performance.now() - pressedAt
        pad.buttons[${DPAD_DOWN}] = { pressed: false, touched: false, value: 0 }
        unplug()
        frames(latencyMs)
      })
    })
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-focused'] })
    // A highlight that never moves answers rather than holding the run.
    const timer = setTimeout(() => {
      observer.disconnect()
      unplug()
      frames(-1)
    }, ${Math.round(timeoutMs)})
    navigator.getGamepads = () => [pad, ...Array.from(real.call(navigator)).filter(Boolean)]
    const pressedAt = performance.now()
    pad.buttons[${DPAD_DOWN}] = { pressed: true, touched: true, value: 1 }
    pad.timestamp = pressedAt
  })`
}

export function idlePage(contents: Pick<WebContents, 'executeJavaScript'>): IdlePage {
  return {
    home: async (timeoutMs) => {
      try {
        await contents.executeJavaScript(
          `document.querySelector('.topbar__nav [data-route="home"]')?.click()`,
          true
        )
        const at: unknown = await contents.executeJavaScript(homeProbe(timeoutMs), true)
        return typeof at === 'number'
      } catch (cause) {
        log.warn('selftest', 'going home for the idle check failed', { cause })
        return false
      }
    },
    press: async (timeoutMs) => {
      try {
        const timing: unknown = await contents.executeJavaScript(pressProbe(timeoutMs), true)
        if (typeof timing !== 'object' || timing === null) return null
        const { latencyMs, frameMs } = timing as Record<string, unknown>
        return typeof latencyMs === 'number' && typeof frameMs === 'number'
          ? { latencyMs, frameMs }
          : null
      } catch (cause) {
        log.warn('selftest', 'timing the press after idle failed', { cause })
        return null
      }
    }
  }
}
