import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { log } from './log.ts'

/**
 * The self-test's screenshots: each screen the request names, drawn on the
 * device and captured by the app itself, so the agent can read the Nova's own
 * rendering of a layout it has only seen under Xvfb.
 *
 * Captured with `capturePage`, which reads the page's own frame: no other
 * window, and nothing of the owner's desktop, can end up in one.
 */

/** Under the results folder, so the paths are the summary's evidence as they stand. */
export const SHOTS_DIR = 'shots'

/** How long a screen is waited for before it counts as not reached. */
export const SCREEN_TIMEOUT_MS = 10_000

/** Screens reached from the menu bar, by the route that names them. */
export const SCREENS: ReadonlySet<string> = new Set(['bios', 'emulators', 'settings'])

/**
 * Screens never captured: they draw the library, its titles and covers, and
 * on the Nova that library is the owner's, which nothing published may carry
 * (docs/TESTING.md, `summary.json`). Privacy masks the server and the account,
 * not what is on it.
 */
export const LIBRARY_SCREENS: ReadonlySet<string> = new Set([
  'home',
  'library',
  'collections',
  'downloads',
  'game'
])

/** Why a screen has no shot. Codes, not prose: they are read by the agent. */
export const SHOT_MISSING = {
  unknown: 'unknown-screen',
  notReached: 'screen-not-reached',
  captureFailed: 'capture-failed',
  aborted: 'aborted-by-user'
} as const

export const SHOT_WITHHELD = 'draws-library'

export interface ShotsOutcome {
  /** Paths of the shots taken, relative to the results folder. */
  evidence: string[]
  /** `<screen>:<code>` for each requested screen without a shot. */
  missing: string[]
  /** Requested screens deliberately not captured. See `LIBRARY_SCREENS`. */
  withheld: string[]
}

/**
 * Run in the page: open one screen from the menu bar and resolve with null
 * once it has drawn without a spinner, or with a code saying why it did not.
 * The click reaches the item the way its own `onSelect` does, as the grid
 * scroll's does (see `scrollProbe`). The shot waits for the screen to settle,
 * then two frames, so the compositor holds what the screen drew rather than
 * what it was drawing.
 */
export function screenProbe(screen: string, timeoutMs = SCREEN_TIMEOUT_MS): string {
  const item = JSON.stringify(`.topbar__nav [data-route="${screen}"]`)
  const drawn = JSON.stringify(`[data-screen="${screen}"]`)
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const until = Date.now() + ${Math.round(timeoutMs)}
    const waitFor = async (look) => {
      while (Date.now() < until) {
        const found = look()
        if (found) return found
        await sleep(50)
      }
      return null
    }
    const menu = await waitFor(() => document.querySelector(${item}))
    if (!menu) return 'no-menu-item'
    menu.click()
    const screen = await waitFor(() => {
      const here = document.querySelector(${drawn})
      return here && !here.querySelector('.spinner') ? here : null
    })
    if (!screen) return 'not-drawn'
    // Transitions too, such as the menu's mark sliding to the new item, or the
    // shot catches it halfway. Endless ones, a spinner's, never finish.
    const settling = document.getAnimations()
      .filter((one) => one.effect && one.effect.getComputedTiming().endTime !== Infinity)
      .map((one) => one.finished.catch(() => {}))
    await Promise.race([Promise.all(settling), sleep(Math.max(0, until - Date.now()))])
    await frame()
    await frame()
    return null
  })()`
}

export interface ShotsOptions {
  contents: Pick<WebContents, 'executeJavaScript' | 'capturePage'>
  resultsDir: string
  screens: readonly string[]
  signal: AbortSignal
  timeoutMs?: number
}

/**
 * Capture each requested screen into `SHOTS_DIR`, in the order asked for.
 * Never throws: a screen that will not open or capture is missing, and the
 * others are still taken.
 */
export async function takeScreenshots(options: ShotsOptions): Promise<ShotsOutcome> {
  const { contents, resultsDir, signal } = options
  const timeoutMs = options.timeoutMs ?? SCREEN_TIMEOUT_MS
  const outcome: ShotsOutcome = { evidence: [], missing: [], withheld: [] }
  for (const screen of new Set(options.screens)) {
    if (LIBRARY_SCREENS.has(screen)) {
      outcome.withheld.push(screen)
      continue
    }
    // The name becomes a file name and is put into the page's script, so
    // only the screens known here are either.
    if (!SCREENS.has(screen)) {
      outcome.missing.push(`${screen}:${SHOT_MISSING.unknown}`)
      continue
    }
    if (signal.aborted) {
      outcome.missing.push(`${screen}:${SHOT_MISSING.aborted}`)
      continue
    }
    const reached = await openScreen(contents, screen, timeoutMs, signal)
    if (signal.aborted) {
      outcome.missing.push(`${screen}:${SHOT_MISSING.aborted}`)
      continue
    }
    if (!reached) {
      outcome.missing.push(`${screen}:${SHOT_MISSING.notReached}`)
      continue
    }
    const path = `${SHOTS_DIR}/${screen}.png`
    if (await capture(contents, join(resultsDir, path), screen)) outcome.evidence.push(path)
    else outcome.missing.push(`${screen}:${SHOT_MISSING.captureFailed}`)
  }
  return outcome
}

/**
 * True once the screen has drawn. The probe's own timeout runs only while the
 * page draws frames, so a stopped renderer is given up on from here as well,
 * as is an abort.
 */
async function openScreen(
  contents: Pick<WebContents, 'executeJavaScript'>,
  screen: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<boolean> {
  const probed = contents.executeJavaScript(screenProbe(screen, timeoutMs), true).then(
    (failed: unknown) => {
      if (failed !== null) log.warn('selftest', 'a screen was not reached', { screen, failed })
      return failed === null
    },
    (cause: unknown) => {
      log.warn('selftest', 'opening a screen failed', { screen, cause })
      return false
    }
  )
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const gaveUp = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), 2 * timeoutMs)
    timer.unref()
    onAbort = () => resolve(false)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([probed, gaveUp]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  })
}

/** True once the page's frame is on disk as a PNG. An empty capture is a failed one. */
async function capture(
  contents: Pick<WebContents, 'capturePage'>,
  path: string,
  screen: string
): Promise<boolean> {
  try {
    const png = (await contents.capturePage()).toPNG()
    if (png.length === 0) {
      log.warn('selftest', 'a screenshot came back empty', { screen })
      return false
    }
    writeWhole(path, png)
    return true
  } catch (cause) {
    log.warn('selftest', 'a screenshot failed', { screen, cause })
    return false
  }
}

/** Whole or not at all: the bridge publishes whatever it finds in the folder. */
function writeWhole(path: string, data: Buffer): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const part = `${path}.part`
  writeFileSync(part, data)
  renameSync(part, path)
}
