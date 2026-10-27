import type { WebContents } from 'electron'
import type { RommRom } from '@shared/types'
import { log } from './log.ts'
import type { CheckResult, Scenario, ScenarioContext } from './selftest.ts'
import { SKIP } from './selftest.ts'
import { POLL_MS } from './selftestlaunch.ts'
import { processGroup, windowFinder } from './selftestwindows.ts'
import { openDisplay, type X11 } from './x11.ts'

/**
 * `focus.no-new-window`: a download that finishes while a sandboxed emulator
 * has the screen maps no window of Galleon's, and its notice waits until the
 * emulator is gone.
 *
 * The download is `download.small`'s, run through the real queue, so the
 * notice that is held is the one a player would get. Galleon's windows are
 * read from the display before the cycle, throughout the download, and after
 * the exit; any reading that differs is a window mapped or taken away while
 * the game had the screen. A reading the display cannot give counts neither
 * way, and without the first one there is nothing to compare: the check is
 * a skip.
 */

export const NO_NEW_WINDOW_CHECK = 'focus.no-new-window'

/** How long the held notice has to be on the page once the emulator is gone. */
export const NOTICE_MS = 5000

/** Galleon's own windows on the display, read as often as asked. */
export interface OwnWindows {
  /** By id in ascending order; null when the display cannot tell. */
  read: () => Promise<number[] | null>
  close: () => void
}

export interface NoNewWindowDeps {
  /** Opened once per run of the check, and closed after it. */
  windows: () => OwnWindows
  /** How many BrowserWindows the app has, hidden ones included. */
  browserWindows: () => number
  /**
   * Tells the page whether a game has the screen, as a launch does (see
   * `running:state`): the emulator's id while it does, null once it is gone.
   */
  cover: (emulator: string | null) => void
  /** `download.small`'s scenario, told which game it picked. */
  download: (context: ScenarioContext, picked: (rom: RommRom) => void) => Promise<CheckResult>
  /** Whether the page shows the notice that the game titled `title` finished. */
  noticeShown: (title: string) => Promise<boolean>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * One emulator's launch cycle with work done while it is shown (see
 * `LaunchDeps.whileShown`). The work is never started when no focused window
 * was seen.
 */
export type ShownCycle = (
  emulator: string,
  signal: AbortSignal,
  whileShown: (signal: AbortSignal) => Promise<unknown>
) => Promise<[CheckResult, CheckResult]>

interface Behind {
  download: CheckResult
  title: string | null
  /** A reading of Galleon's windows differed from the one before the cycle. */
  changed: boolean
  most: number
  browserMost: number
  noticeDuring: boolean
}

/**
 * Tries the emulators in order until one is shown. Each is a cycle of its
 * own, not the one `launch.<emulator>` reads, so the work kept behind it
 * cannot change what that check measures.
 */
export function noNewWindowScenario(
  emulators: readonly string[],
  cycle: ShownCycle,
  deps: NoNewWindowDeps
): Scenario {
  return async (context) => {
    const now = deps.now ?? Date.now
    const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    const windows = deps.windows()
    try {
      const before = await readSafely(windows)
      if (before === null) return result('skip', 'windows-unknown')
      const browserBefore = deps.browserWindows()
      const base = { windowsBefore: before.length, browserWindowsBefore: browserBefore }

      for (const emulator of emulators) {
        if (context.signal.aborted) return result('skip', SKIP.aborted)
        const held: { task: Promise<Behind> | null } = { task: null }
        try {
          await cycle(emulator, context.signal, (shown) => {
            deps.cover(emulator)
            held.task = downloadBehind(
              { ...context, signal: shown },
              before,
              browserBefore,
              windows,
              deps,
              sleep
            )
            return held.task
          })
        } finally {
          if (held.task) deps.cover(null)
        }
        // The cycle stops waiting on the work past its limit, and the work is
        // then told to stop: what comes after is read only once it has.
        const behind = held.task ? await held.task : null
        if (behind === null) continue

        const after = await readSafely(windows)
        const changed = behind.changed || (after !== null && !same(after, before))
        const browserMost = Math.max(behind.browserMost, deps.browserWindows())
        const metrics = {
          ...base,
          emulator,
          windowsMost: Math.max(behind.most, after?.length ?? 0),
          windowsAfter: after?.length ?? null,
          browserWindowsMost: browserMost,
          noticeDuring: Number(behind.noticeDuring),
          noticeMs: null as number | null
        }
        if (context.signal.aborted) return result('skip', SKIP.aborted, metrics)
        if (changed || browserMost > browserBefore) return result('fail', 'new-window', metrics)
        if (behind.download.result !== 'pass' || behind.title === null) {
          return result(
            'skip',
            `download-${behind.download.reason ?? behind.download.result}`,
            metrics
          )
        }
        if (behind.noticeDuring) return result('fail', 'notice-not-held', metrics)
        metrics.noticeMs = await watchForNotice(behind.title, deps, context.signal, now, sleep)
        if (context.signal.aborted) return result('skip', SKIP.aborted, metrics)
        if (metrics.noticeMs === null) return result('fail', 'notice-not-shown', metrics)
        return result('pass', null, metrics)
      }
      return result('skip', 'no-game-shown', base)
    } finally {
      windows.close()
    }
  }
}

/**
 * The download, with Galleon's windows read at every step while it runs and
 * once after, and whether its notice is on the page while the game still has
 * the screen.
 */
async function downloadBehind(
  context: ScenarioContext,
  before: readonly number[],
  browserBefore: number,
  windows: OwnWindows,
  deps: NoNewWindowDeps,
  sleep: (ms: number) => Promise<void>
): Promise<Behind> {
  const seen = { title: null as string | null, changed: false, most: before.length }
  let browserMost = browserBefore
  const sample = async (): Promise<void> => {
    const reading = await readSafely(windows)
    // A reading the display could not give says nothing either way.
    if (reading !== null && !same(reading, before)) seen.changed = true
    seen.most = Math.max(seen.most, reading?.length ?? 0)
    browserMost = Math.max(browserMost, deps.browserWindows())
  }
  const run = { settled: false }
  const download = deps
    .download(context, (rom) => (seen.title = rom.name))
    .finally(() => (run.settled = true))
  // Read while it runs as well as after: a window mapped and taken away
  // again before the end would not be in a last reading.
  while (!run.settled) {
    await sample()
    await sleep(POLL_MS)
  }
  const answered = await download
  await sample()
  const noticeDuring = seen.title !== null && (await deps.noticeShown(seen.title))
  return { download: answered, ...seen, browserMost, noticeDuring }
}

/** How long the notice took to be shown, or null past `NOTICE_MS`. */
async function watchForNotice(
  title: string,
  deps: NoNewWindowDeps,
  signal: AbortSignal,
  now: () => number,
  sleep: (ms: number) => Promise<void>
): Promise<number | null> {
  const askedAt = now()
  while (!signal.aborted) {
    if (await deps.noticeShown(title)) return now() - askedAt
    if (now() - askedAt >= NOTICE_MS) break
    await sleep(POLL_MS)
  }
  return null
}

async function readSafely(windows: OwnWindows): Promise<number[] | null> {
  try {
    return await windows.read()
  } catch (cause) {
    log.info('selftest', 'the window list could not be read', { cause })
    return null
  }
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((window, i) => window === b[i])
}

function result(
  outcome: CheckResult['result'],
  reason: string | null,
  metrics: CheckResult['metrics'] = {}
): CheckResult {
  return {
    id: NO_NEW_WINDOW_CHECK,
    result: outcome,
    metrics,
    thresholds: { windowsChanged: 0, noticeMs: NOTICE_MS },
    reason,
    evidence: []
  }
}

/**
 * `NoNewWindowDeps.windows` on the device: the windows of Galleon's own
 * process group, which an emulator never shares (see `startPlan`). The
 * display is opened on the first reading.
 */
export function ownWindowsOnDisplay(
  env: NodeJS.ProcessEnv = process.env,
  open: (env: NodeJS.ProcessEnv) => Promise<X11 | null> = openDisplay,
  self: number = process.pid,
  groupOf: (pid: number) => number | null = processGroup
): () => OwnWindows {
  return () => {
    let display: Promise<X11 | null> | null = null
    let finder: ReturnType<typeof windowFinder> | null = null
    return {
      read: async () => {
        display ??= open(env)
        const x11 = await display
        const group = groupOf(self)
        if (!x11 || group === null) return null
        finder ??= windowFinder(x11, groupOf)
        return finder.windowsOf(group)
      },
      close: () => void display?.then((x11) => x11?.close())
    }
  }
}

/**
 * `NoNewWindowDeps.noticeShown` in the page: a finished download's toast is
 * the one that names the game and is marked as good news. Only a yes or no
 * comes back, so the title never leaves the page.
 */
export function noticeProbe(
  contents: Pick<WebContents, 'executeJavaScript'>
): NoNewWindowDeps['noticeShown'] {
  return (title) =>
    contents
      .executeJavaScript(
        `[...document.querySelectorAll('.toast.notice--ok')].some(
          (one) => one.querySelector('.toast__title')?.textContent === ${JSON.stringify(title)})`,
        true
      )
      .then(
        (shown: unknown) => shown === true,
        (cause: unknown) => {
          log.warn('selftest', 'the page could not be asked for a notice', { cause })
          return false
        }
      )
}
