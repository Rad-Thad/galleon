import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { jankyThresholdMs, percentile } from '@shared/frames'
import type { PowerState, RommPlatform } from '@shared/types'
import { log } from './log.ts'
import { UNKNOWN } from './powerstate.ts'
import type { CheckResult, Scenario } from './selftest.ts'

/**
 * `grid.scroll@<profile>`: how the library grid feels to scroll on the device,
 * once per power profile the request names.
 *
 * The scroll is driven inside the page, through the same keyboard path the
 * focus engine already answers, so neither OS input nor the Gamepad API is
 * involved: `watchInput` reads the latter, and a driver on it would stop its
 * own run. Frame times are the intervals between animation frames, the
 * arithmetic the performance overlay uses (`@shared/frames`).
 */

export const GRID_CHECK = 'grid.scroll'

/** How long one profile's scroll is measured for. */
export const SCROLL_MS = 30_000

/**
 * How long the page is timed at rest, before the first key. A page that
 * already misses refreshes while idle is held back by how its frames are
 * paced, not by what a move costs.
 */
export const IDLE_MS = 2_000

/** The smallest platform worth measuring: the size of a real library's largest. */
export const MIN_GAMES = 1000

/**
 * The catalogue's thresholds per profile (docs/TESTING.md). A run that names
 * no profile is held to the strictest.
 */
export const THRESHOLDS: Readonly<Record<string, { p95Ms: number; droppedPct: number }>> = {
  performance: { p95Ms: 16.7, droppedPct: 3 },
  balanced: { p95Ms: 16.7, droppedPct: 5 }
}
const STRICTEST = THRESHOLDS.performance

/**
 * How often a held direction repeats: the pad's own rate, so the grid moves
 * as fast as a person holding Down would move it. See `useGamepad`.
 */
export const REPEAT_MS = 90

/** How long the highlight may stand still at an end before the scroll turns back. */
export const TURN_MS = 1_500

/**
 * What the library draws below its last row once the server has no more
 * pages: without it, a highlight standing still at the bottom is waiting for
 * a page, not at the end. See `Library`.
 */
export const GRID_END = '[data-grid-end]'

/** How often the clocks are read during a scroll. */
export const SAMPLE_MS = 5_000

/** How long the library and its grid are waited for before the check gives up. */
export const GRID_TIMEOUT_MS = 30_000

/** How long run.sh is given to switch the profile and answer. */
export const PROFILE_WAIT_MS = 30_000
const PROFILE_POLL_MS = 200

/** Handshake files in the request's `handshakeDir` (docs/TESTING.md). */
export const WANT_PROFILE = 'want-profile'
export const PROFILE_SET = 'profile-set'

/** What one scroll in the page reports. */
export interface ScrollRun {
  /** Milliseconds between consecutive animation frames while scrolling. */
  intervals: number[]
  /** The same, with the highlight standing still before the first key. */
  idle: number[]
  /** How many different games held the highlight: proof the grid moved. */
  visited: number
  /** How many keys moved the highlight, out of all those sent. */
  moves: number
  /** How many times the scroll turned back at an end it could not pass. */
  turns: number
  /**
   * Milliseconds the highlight stood at the bottom of what was drawn while
   * the next page was still to come: what a player holding Down waits.
   */
  waitedMs: number
  /** How many covers the grid held when the scroll ended: how far it paged. */
  cards: number
  /** Why the scroll could not start, or null. */
  failed: string | null
}

/** The platform with the most games, or null when none reaches `min`. */
export function largestPlatform(
  platforms: readonly RommPlatform[],
  min = MIN_GAMES
): RommPlatform | null {
  let best: RommPlatform | null = null
  for (const platform of platforms) {
    if (platform.rom_count >= min && (!best || platform.rom_count > best.rom_count)) {
      best = platform
    }
  }
  return best
}

/**
 * Run in the page: open the library on one platform, put the highlight on its
 * first game and hold a direction for `scrollMs`, turning back at either end so
 * the whole time is spent moving rather than resting against the last row.
 * The bottom is an end only once the grid says so (`GRID_END`); short of it
 * the scroll holds Down for as long as the grid is given to draw at all, so a
 * slow page is measured as the wait it is rather than taken for the end.
 *
 * Clicks reach the menu and the chip the way their own `onSelect` does; a
 * pointer move is what puts the highlight on a game without opening it (see
 * `useFocusable`). Then only keys, which is the path a person's presses take.
 */
export function scrollProbe(
  platformId: number,
  scrollMs: number,
  repeatMs = REPEAT_MS,
  timeoutMs = GRID_TIMEOUT_MS,
  turnMs = TURN_MS,
  idleMs = IDLE_MS
): string {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const until = Date.now() + ${Math.round(timeoutMs)}
    const waitFor = async (look) => {
      while (Date.now() < until) {
        const found = look()
        if (found) return found
        await sleep(50)
      }
      return null
    }
    const failed = (why) => ({ intervals: [], idle: [], visited: 0, moves: 0, turns: 0, waitedMs: 0, cards: 0, failed: why })
    const gaps = (stamps) => stamps.slice(1).map((at, i) => at - stamps[i])
    const menu = await waitFor(() => document.querySelector('.topbar__nav [data-route="library"]'))
    if (!menu) return failed('no-library-menu')
    menu.click()
    const chipAt = '[data-screen="library"] [data-platform="${platformId}"]'
    const chip = await waitFor(() => document.querySelector(chipAt))
    if (!chip) return failed('no-platform-chip')
    if (chip.dataset.active !== 'true') chip.click()
    // The grid is settled when the platform is chosen, nothing is loading and
    // the same first game has been drawn on two looks in a row.
    let previous = null
    const first = await waitFor(() => {
      const screen = document.querySelector('[data-screen="library"]')
      const active = document.querySelector(chipAt)?.dataset.active === 'true'
      const card = screen && !screen.querySelector('.spinner') ? screen.querySelector('[data-rom]') : null
      const id = active && card ? card.dataset.rom : null
      const settled = id !== null && id === previous
      previous = id
      return settled ? card : null
    })
    if (!first) return failed('grid-not-drawn')
    const box = first.getBoundingClientRect()
    first.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: Math.round(box.left + box.width / 2),
      clientY: Math.round(box.top + box.height / 2)
    }))
    const focused = () => document.querySelector('[data-rom][data-focused="true"]')?.dataset.rom ?? null
    if (!(await waitFor(focused))) return failed('no-highlight')

    // Ended by the clock too, so a page that stops drawing does not start its
    // keys long after the main process has given up on it.
    const resting = []
    await new Promise((resolve) => {
      let timing = true
      const stop = () => {
        timing = false
        resolve()
      }
      const rest = (at) => {
        if (!timing) return
        resting.push(at)
        if (at - resting[0] < ${Math.round(idleMs)}) requestAnimationFrame(rest)
        else stop()
      }
      requestAnimationFrame(rest)
      setTimeout(stop, ${Math.round(idleMs)})
    })

    const stamps = []
    let drawing = true
    const frame = (at) => {
      stamps.push(at)
      if (drawing) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    const visited = new Set([focused()])
    let key = 'ArrowDown'
    let moves = 0
    let turns = 0
    let waitedMs = 0
    let movedAt = Date.now()
    const end = Date.now() + ${Math.round(scrollMs)}
    while (Date.now() < end) {
      const before = focused()
      const sentAt = Date.now()
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      await sleep(${Math.round(repeatMs)})
      const after = focused()
      if (after !== null) visited.add(after)
      if (after !== before) {
        moves += 1
        movedAt = Date.now()
        continue
      }
      const atEnd = key === 'ArrowUp' || document.querySelector('[data-screen="library"] ${GRID_END}') !== null
      if (!atEnd) waitedMs += Date.now() - sentAt
      const patience = atEnd ? ${Math.round(turnMs)} : ${Math.round(timeoutMs)}
      if (Date.now() - movedAt >= patience) {
        key = key === 'ArrowDown' ? 'ArrowUp' : 'ArrowDown'
        turns += 1
        movedAt = Date.now()
      }
    }
    drawing = false
    const cards = document.querySelectorAll('[data-screen="library"] [data-rom]').length
    return {
      intervals: gaps(stamps),
      idle: gaps(resting),
      visited: visited.size,
      moves,
      turns,
      waitedMs,
      cards,
      failed: null
    }
  })()`
}

/**
 * Drive one scroll in the page. A page that stops drawing, or a run stopped
 * by the player, ends the wait from here, since the probe's own clock is only
 * read between the page's frames.
 */
export function runScroll(
  contents: Pick<WebContents, 'executeJavaScript'>,
  platformId: number,
  signal: AbortSignal,
  scrollMs = SCROLL_MS
): Promise<ScrollRun | null> {
  const probed = contents.executeJavaScript(scrollProbe(platformId, scrollMs), true).then(
    (run: unknown) => (isScrollRun(run) ? run : null),
    (cause: unknown) => {
      log.warn('selftest', 'the grid scroll failed', { cause })
      return null
    }
  )
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), IDLE_MS + scrollMs + 2 * GRID_TIMEOUT_MS)
    timer.unref()
    onAbort = () => resolve(null)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([probed, gaveUp]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  })
}

function isScrollRun(value: unknown): value is ScrollRun {
  const run = value as ScrollRun | null
  const times = (list: unknown): boolean =>
    Array.isArray(list) && list.every((ms) => typeof ms === 'number')
  return (
    typeof run === 'object' &&
    run !== null &&
    times(run.intervals) &&
    times(run.idle) &&
    [run.visited, run.moves, run.turns, run.waitedMs, run.cards].every(
      (n) => typeof n === 'number'
    ) &&
    (run.failed === null || typeof run.failed === 'string')
  )
}

/** How the profile switch went. */
export type ProfileAnswer = 'set' | 'unchanged' | 'no-handshake' | 'no-answer'

/**
 * Ask run.sh to switch Armada's power profile, through the request's
 * handshake folder: the app may not switch it itself, since restoring the
 * owner's profile afterwards is the harness's job and it has to know.
 *
 * Both files are written whole (a rename), and both are removed once
 * answered, so a stale answer is never read as the next one's.
 */
export async function askForProfile(
  handshakeDir: string | null,
  profile: string,
  signal: AbortSignal,
  waitMs = PROFILE_WAIT_MS,
  pollMs = PROFILE_POLL_MS
): Promise<ProfileAnswer> {
  if (!handshakeDir) return 'no-handshake'
  const want = join(handshakeDir, WANT_PROFILE)
  const answer = join(handshakeDir, PROFILE_SET)
  await rm(answer, { force: true })
  await writeFile(`${want}.tmp`, `${profile}\n`)
  await rename(`${want}.tmp`, want)
  const until = Date.now() + waitMs
  try {
    while (Date.now() < until && !signal.aborted) {
      const said = await readFile(answer, 'utf8').catch(() => null)
      if (said !== null) return said.trim() === profile ? 'set' : 'unchanged'
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    return 'no-answer'
  } finally {
    await rm(want, { force: true })
    await rm(answer, { force: true })
  }
}

export interface ScrollScenarioDeps {
  client: { platforms(): Promise<RommPlatform[]> }
  /**
   * Have the library offer the synthetic platform, and name it, for a library
   * with no platform of `MIN_GAMES`. See `selftestlibrary.ts`.
   */
  synthetic?: () => RommPlatform
  /** The page to scroll in. */
  scroll: (platformId: number, signal: AbortSignal) => Promise<ScrollRun | null>
  power: () => Promise<PowerState>
  /**
   * The clocks read while the grid scrolls; `power` when left out. Lighter
   * than `power` where that starts a process, which would cost frames in the
   * very measurement it labels.
   */
  sample?: () => Promise<PowerState>
  askForProfile: (profile: string, signal: AbortSignal) => Promise<ProfileAnswer>
  displayHz: () => number
  sampleMs?: number
}

/** The power state read during a scroll, summed up for the summary. */
export function powerMetrics(samples: readonly PowerState[]): CheckResult['metrics'] {
  // A sample that could not tell is not a different profile.
  const profiles = new Set(
    samples.map((s) => s.profile.toLowerCase()).filter((profile) => profile !== UNKNOWN)
  )
  const governors = new Set(samples.map((s) => s.cpuGovernor))
  const most = (values: (number | null)[]): number | null => {
    const known = values.filter((v): v is number => v !== null)
    return known.length === 0 ? null : Math.max(...known)
  }
  const gpuHz = most(samples.map((s) => s.gpuCurHz))
  return {
    profileObserved: profiles.size === 1 ? [...profiles][0] : profiles.size ? 'mixed' : 'unknown',
    governor: governors.size === 1 ? [...governors][0] : governors.size ? 'mixed' : 'unknown',
    policy7MaxKHz: most(samples.map((s) => s.cpuMaxKHz)),
    gpuMHz: gpuHz === null ? null : Math.round(gpuHz / 1e6),
    samples: samples.length
  }
}

export function scrollScenario(deps: ScrollScenarioDeps): Scenario {
  return async ({ request, signal }) => {
    const wanted = request.profiles.map((p) => p.toLowerCase())
    const ids = wanted.length ? wanted.map((p) => `${GRID_CHECK}@${p}`) : [GRID_CHECK]
    const listed = await deps.client.platforms().catch((cause: unknown) => {
      // Without the synthetic platform there is nothing else to scroll, and
      // the failure is the scenario's to report.
      if (!deps.synthetic) throw cause
      return []
    })
    const real = largestPlatform(listed)
    const platform = real ?? deps.synthetic?.() ?? null
    if (!platform) return ids.map((id) => outcome(id, 'skip', 'no-large-platform', {}))

    const results: CheckResult[] = []
    for (const [i, id] of ids.entries()) {
      const profile = wanted[i] ?? null
      if (signal.aborted) {
        results.push(outcome(id, 'skip', 'aborted-by-user', {}))
        continue
      }
      const metrics: CheckResult['metrics'] = { platform: platform.slug, games: platform.rom_count }
      if (profile !== null) {
        const now = (await deps.power().catch(() => null))?.profile.toLowerCase()
        const answer = now === profile ? 'set' : await deps.askForProfile(profile, signal)
        const after = (await deps.power().catch(() => null))?.profile.toLowerCase() ?? 'unknown'
        // Measured only on the profile it is named for: numbers taken on
        // another would be filed under the wrong threshold.
        if (after !== profile) {
          metrics.profileObserved = after
          metrics.profileAnswer = answer
          results.push(outcome(id, 'skip', 'profile-not-set', metrics, profile))
          continue
        }
      }
      results.push(await measure(id, profile, platform.id, metrics, deps, signal))
    }
    return results
  }
}

async function measure(
  id: string,
  profile: string | null,
  platformId: number,
  metrics: CheckResult['metrics'],
  deps: ScrollScenarioDeps,
  signal: AbortSignal
): Promise<CheckResult> {
  const samples: PowerState[] = []
  const sample = (read = deps.sample ?? deps.power): void => {
    void read().then(
      (state) => samples.push(state),
      () => undefined
    )
  }
  // The first with `power`, before anything is timed, so the profile is
  // named by the best source there is.
  sample(deps.power)
  const sampler = setInterval(() => sample(), deps.sampleMs ?? SAMPLE_MS)
  let run: ScrollRun | null
  try {
    run = await deps.scroll(platformId, signal)
  } finally {
    clearInterval(sampler)
  }
  Object.assign(metrics, powerMetrics(samples))
  if (signal.aborted) return outcome(id, 'skip', 'aborted-by-user', metrics, profile)
  if (!run) return outcome(id, 'error', 'scroll-did-not-finish', metrics, profile)
  if (run.failed) return outcome(id, 'error', run.failed, metrics, profile)
  Object.assign(metrics, {
    visited: run.visited,
    moves: run.moves,
    turns: run.turns,
    waitedMs: Math.round(run.waitedMs),
    cards: run.cards
  })
  const hz = deps.displayHz()
  const moving = frameStats(run.intervals, hz)
  if (run.visited < 2 || !moving) {
    return outcome(id, 'error', 'grid-did-not-scroll', metrics, profile)
  }
  const idle = frameStats(run.idle, hz)
  Object.assign(metrics, {
    frames: moving.frames,
    p50Ms: moving.p50Ms,
    p95Ms: moving.p95Ms,
    p99Ms: moving.p99Ms,
    droppedPct: moving.droppedPct,
    displayHz: hz,
    idleFrames: idle?.frames ?? 0,
    idleP50Ms: idle?.p50Ms ?? null,
    idleP95Ms: idle?.p95Ms ?? null,
    idleDroppedPct: idle?.droppedPct ?? null
  })
  const limit = thresholdsFor(profile)
  const ok =
    (metrics.p95Ms as number) <= limit.p95Ms && (metrics.droppedPct as number) <= limit.droppedPct
  return outcome(id, ok ? 'pass' : 'fail', ok ? null : 'over-threshold', metrics, profile)
}

interface FrameStats {
  frames: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  droppedPct: number
}

/** Percentiles and the dropped share of some frame intervals; null for none. */
export function frameStats(intervals: readonly number[], hz: number): FrameStats | null {
  const sorted = intervals.filter((ms) => Number.isFinite(ms) && ms > 0).toSorted((a, b) => a - b)
  if (sorted.length === 0) return null
  const dropped = sorted.filter((ms) => ms > jankyThresholdMs(hz)).length
  const round = (ms: number): number => Math.round(ms * 10) / 10
  return {
    frames: sorted.length,
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    p99Ms: round(percentile(sorted, 99)),
    droppedPct: round((dropped / sorted.length) * 100)
  }
}

function thresholdsFor(profile: string | null): { p95Ms: number; droppedPct: number } {
  return (profile !== null ? THRESHOLDS[profile] : undefined) ?? STRICTEST
}

function outcome(
  id: string,
  result: CheckResult['result'],
  reason: string | null,
  metrics: CheckResult['metrics'],
  profile: string | null = null
): CheckResult {
  return { id, result, metrics, thresholds: { ...thresholdsFor(profile) }, reason, evidence: [] }
}
