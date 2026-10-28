import type { WebContents } from 'electron'
import type { PowerState } from '@shared/types'
import { log } from './log.ts'
import type { CheckResult, Scenario } from './selftest.ts'

/**
 * `startup.cold`: how long the app takes to become usable, measured by the app
 * itself on the device.
 *
 * The end is the first frame on which Home is interactive, seen from inside
 * the page, so neither polling from here nor the self-test's own work is
 * counted. The start is the wrapper's, when run.sh hands it over in
 * `STARTED_AT_ENV`: that includes mounting the AppImage, which a person
 * waits through too. Without it the start is this process's.
 */

export const STARTUP_CHECK = 'startup.cold'

/** The catalogue's threshold for `startup.cold` (docs/TESTING.md). */
export const STARTUP_MS = 4_000

/** How long Home is waited for before the check fails rather than hangs. */
export const HOME_TIMEOUT_MS = 60_000

/** The wrapper's start, in milliseconds since the epoch. Set by run.sh. */
export const STARTED_AT_ENV = 'GALLEON_STARTED_AT_MS'

/** The profile the catalogue's threshold is stated for. */
const MEASURED_ON = 'performance'

export interface StartupStart {
  at: number
  from: 'wrapper' | 'process'
}

/**
 * Where the measurement starts. A wrapper time later than this process's own
 * start, or not a time at all, is not the wrapper's start of this run, so the
 * process's is used rather than a number that would read as too fast.
 */
export function startupStart(
  env: Record<string, string | undefined>,
  processStart: number
): StartupStart {
  const raw = env[STARTED_AT_ENV]
  const at = raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  if (Number.isSafeInteger(at) && at > 0 && at <= processStart) return { at, from: 'wrapper' }
  return { at: processStart, from: 'process' }
}

/**
 * Run in the page: resolves with the wall-clock time of the first animation
 * frame on which Home is up, has stopped loading, and holds the highlight, or
 * null once the timeout passes. These are the same marks a person goes by,
 * and the ones test:app waits on before it presses anything (see `atHome` in
 * test/app/driver.ts).
 */
export function homeProbe(timeoutMs: number): string {
  return `new Promise((resolve) => {
    const until = Date.now() + ${Math.round(timeoutMs)}
    const look = () => {
      const screen = document.querySelector('[data-screen="home"]')
      const hero = screen ? screen.querySelector('.hero') : null
      if (screen && !screen.querySelector('.spinner') && (!hero || hero.dataset.focused === 'true')) {
        resolve(Date.now())
        return
      }
      if (Date.now() > until) {
        resolve(null)
        return
      }
      requestAnimationFrame(look)
    }
    look()
  })`
}

/**
 * Start watching for Home as soon as the window exists, so the time is that
 * of its first arrival whatever order the request lists its checks in.
 * Electron holds the script until the page has loaded. Null when Home never
 * came, or the page went away first.
 */
export function watchHome(
  contents: Pick<WebContents, 'executeJavaScript'>,
  timeoutMs = HOME_TIMEOUT_MS
): Promise<number | null> {
  const probed = contents.executeJavaScript(homeProbe(timeoutMs), true).then(
    (at: unknown) => (typeof at === 'number' && Number.isFinite(at) ? at : null),
    (cause: unknown) => {
      log.warn('selftest', 'watching for home failed', { cause })
      return null
    }
  )
  // The probe's own timeout runs only while the page draws frames; a window
  // that never shows, or a renderer that stopped, would leave it waiting, and
  // the runner checks its budget only between scenarios.
  let timer: NodeJS.Timeout | undefined
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
    timer.unref()
  })
  return Promise.race([probed, gaveUp]).finally(() => clearTimeout(timer))
}

export interface StartupOptions {
  /** When Home was first interactive, from `watchHome`. */
  reached: Promise<number | null>
  start: StartupStart
  power: () => Promise<PowerState>
}

export function startupScenario(options: StartupOptions): Scenario {
  return async ({ signal }) => {
    const result = (
      outcome: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics']
    ): CheckResult => ({
      id: STARTUP_CHECK,
      result: outcome,
      metrics,
      thresholds: { startupMs: STARTUP_MS },
      reason,
      evidence: []
    })
    const reached = await untilAborted(options.reached, signal)
    if (signal.aborted) return result('skip', 'aborted-by-user', {})
    const power = await options.power().catch(() => null)
    const metrics: CheckResult['metrics'] = {
      measuredFrom: options.start.from,
      profileObserved: power?.profile ?? 'unknown',
      cpuGovernor: power?.cpuGovernor ?? 'unknown'
    }
    if (reached === null || reached === undefined) {
      return result('fail', 'home-not-reached', metrics)
    }
    const startupMs = Math.max(0, Math.round(reached - options.start.at))
    metrics.startupMs = startupMs
    if (startupMs < STARTUP_MS) return result('pass', null, metrics)
    // The threshold is stated for Performance. A slow start on a profile known
    // to be another one says nothing about it either way.
    const profile = power?.profileId.toLowerCase() ?? 'unknown'
    if (profile !== 'unknown' && profile !== MEASURED_ON) {
      return result('skip', 'not-on-performance', metrics)
    }
    return result('fail', 'over-threshold', metrics)
  }
}

/** The value, or undefined as soon as the run is aborted. */
function untilAborted<T>(value: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined)
    signal.addEventListener('abort', abort, { once: true })
    value.then(
      (settled) => {
        signal.removeEventListener('abort', abort)
        resolve(settled)
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(cause)
      }
    )
  })
}
