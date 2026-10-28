import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { DownloadItem, PendingDownload, RommRom } from '@shared/types'
import { hasMorePages } from '@shared/types'
import { log } from './log.ts'
import { partialPathOf } from './romm/transfer.ts'
import type { CheckResult, Scenario } from './selftest.ts'
import type { DownloadScenarioDeps } from './selftestdownload.ts'

/**
 * `download.progress`: a large game's transfer through the real queue shows a
 * speed and a time left that agree with the rate the bytes actually arrive
 * at, and X on the pad, with the highlight on its row, cancels it and takes
 * its `.part` file away.
 *
 * The game is never fetched whole. The scenario calls the transfer off itself
 * well before `CAP_BYTES`, so a nightly costs the owner's server no more than
 * that, whatever the game's size or the network's speed.
 *
 * X is pressed inside the page, through the keyboard path the focus engine
 * answers (see `GRID_CHECK`'s driver): the abort watches the Gamepad API, and
 * a press there would stop the run it belongs to.
 */

export const PROGRESS_CHECK = 'download.progress'

/** The smallest game worth measuring: a transfer long enough to settle. */
export const MIN_GAME_BYTES = 500 * 1024 * 1024

/** The most one run may fetch of it. */
export const CAP_BYTES = 400 * 1024 * 1024

/**
 * Where the scenario calls the transfer off on its own. Below the cap by what
 * a fast network delivers between two looks, so the bytes fetched stay under
 * it even after the abort has unwound.
 */
export const STOP_BYTES = 360 * 1024 * 1024

/** How long the bytes may take to start: RomM may build a zip first. */
export const FIRST_BYTE_MS = 60_000

/** From the first byte to the first reading: the smoothing's time to settle. */
export const SETTLE_MS = 3_000

/** How many readings are judged, and how far apart. */
export const READINGS = 2
export const READING_MS = 500

/** The span the measured rate is taken over, ending at each reading. */
export const WINDOW_MS = 2_000

/** How far the speed or the time left shown may be from the measured ones. */
export const TOLERANCE_PCT = 20

/** How often the queue is looked at for bytes and for the cap. */
export const LOOK_MS = 100

/** How long X is given to cancel, and the `.part` files to go after it. */
export const CANCEL_MS = 5_000
export const PARTS_GONE_MS = 10_000

/**
 * How long a call into the page is waited for. Past the probes' own waits, so
 * a probe that answers is never cut short, and a page that never answers
 * cannot hold the scenario, and the transfer, for ever.
 */
export const PAGE_MS = CANCEL_MS + 2_000

/** Why the check failed or skipped. Codes, not prose: they are read by the agent. */
export const PROGRESS_FAILED = {
  listing: 'listing-failed',
  noGame: 'no-title-over-500mb',
  installed: 'already-installed',
  aborted: 'aborted-by-user',
  noFirstByte: 'no-first-byte',
  cap: 'cap-reached',
  noSpeed: 'no-speed',
  noTimeLeft: 'no-time-left',
  speed: 'speed-off',
  timeLeft: 'time-left-off',
  line: 'line-without-speed',
  notFocused: 'row-not-highlighted',
  notCancelled: 'x-not-answered',
  pageSilent: 'page-not-answering',
  partLeft: 'part-left'
} as const

/** What `meanwhile` answers for a page call that never came back. */
const SILENT = Symbol('silent')

/** Listings asked for per page while looking for the game. */
const PAGE = 250

export interface ProgressPage {
  /** Open Downloads and put the highlight on the transfer's row; null once it is there, else why not. */
  focusRow(romId: number): Promise<string | null>
  /** The progress line the row shows, or null when there is none. */
  line(romId: number): Promise<string | null>
  /** Press X with the highlight on the row; null once pressed, else why not. */
  pressX(romId: number): Promise<string | null>
}

export interface ProgressDeps {
  client: DownloadScenarioDeps['client']
  downloads: {
    enqueue(rom: RommRom): Promise<DownloadItem>
    cancel(romId: number): Promise<void>
    whenIdle(): Promise<void>
    readonly items: DownloadItem[]
  }
  library: { uninstall(romId: number): Promise<void> }
  store: {
    getInstalled(romId: number): unknown
    readonly pending: PendingDownload[]
  }
  page: ProgressPage
  /** The clock and the wait, given so a test can run the scenario's seconds at once. */
  clock?: { now(): number; sleep(ms: number): Promise<void> }
}

/** The smallest game in the library of at least `MIN_GAME_BYTES`, on any platform. */
export async function smallestLargeGame(client: ProgressDeps['client']): Promise<RommRom | null> {
  let best: RommRom | null = null
  for (const platform of await client.platforms()) {
    for (let offset = 0; ; offset += PAGE) {
      const page = await client.roms({ platform_ids: [platform.id], limit: PAGE, offset })
      for (const rom of page.items) {
        if (rom.fs_size_bytes < MIN_GAME_BYTES) continue
        if (best === null || rom.fs_size_bytes < best.fs_size_bytes) best = rom
      }
      if (!hasMorePages(page)) break
    }
  }
  return best
}

/** The `.part` files a transfer writes, from its record. */
export function partPaths(record: Pick<PendingDownload, 'targetPath' | 'files'>): string[] {
  return record.files.length > 0
    ? record.files.map((file) => partialPathOf(join(record.targetPath, file)))
    : [partialPathOf(record.targetPath)]
}

/** How far `shown` is from `measured`, in percent of the latter. */
export function offByPct(shown: number, measured: number): number {
  return Math.round((Math.abs(shown - measured) / measured) * 1000) / 10
}

/**
 * A line that carries a speed and a time left after the figures: four parts,
 * the third a rate. See `transferLine`.
 */
export function lineHasSpeed(line: string | null): boolean {
  const parts = line?.split(' - ') ?? []
  return parts.length === 4 && parts[2].endsWith('/s')
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  )

const realClock = {
  now: () => performance.now(),
  sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
}

export function progressScenario(deps: ProgressDeps): Scenario {
  const clock = deps.clock ?? realClock
  return async ({ safety, signal }) => {
    const metrics: CheckResult['metrics'] = {}
    const result = (outcome: CheckResult['result'], reason: string | null): CheckResult => ({
      id: PROGRESS_CHECK,
      result: outcome,
      metrics,
      thresholds: {
        minBytes: MIN_GAME_BYTES,
        maxBytes: CAP_BYTES,
        settleMs: SETTLE_MS,
        tolerancePct: TOLERANCE_PCT
      },
      reason,
      evidence: []
    })

    let rom: RommRom | null
    try {
      rom = await smallestLargeGame(deps.client)
    } catch (cause) {
      log.info('selftest', 'listing the library for a large game failed', { cause })
      return result('error', PROGRESS_FAILED.listing)
    }
    if (rom === null) return result('skip', PROGRESS_FAILED.noGame)
    metrics.platform = rom.platform_slug
    metrics.bytes = rom.fs_size_bytes
    // A game already here is not one this run may take away afterwards.
    if (deps.store.getInstalled(rom.id)) return result('skip', PROGRESS_FAILED.installed)
    if (signal.aborted) return result('skip', PROGRESS_FAILED.aborted)

    const id = rom.id
    const item = (): DownloadItem | undefined =>
      deps.downloads.items.find((one) => one.romId === id)
    const onWire = (): boolean => item()?.state === 'downloading'
    // Every look at the bytes, for the measured rate, and the record of where
    // they are going, for the `.part` files to look for once it is cancelled.
    const looks: { at: number; bytes: number }[] = []
    let record: PendingDownload | undefined
    let capped = false
    let fetched = 0
    const look = (): DownloadItem | undefined => {
      const now = item()
      record ??= deps.store.pending.find((entry) => entry.romId === id)
      if (now?.state !== 'downloading') return now
      fetched = Math.max(fetched, now.receivedBytes)
      if (now.receivedBytes > 0) looks.push({ at: clock.now(), bytes: now.receivedBytes })
      if (now.receivedBytes >= STOP_BYTES && !capped) {
        capped = true
        deps.downloads.cancel(id).catch((cause: unknown) => {
          log.info('selftest', 'calling the large download off at the cap failed', { cause })
        })
      }
      return now
    }
    /** Look every `LOOK_MS` for `ms`, or until the transfer is off the wire or stopped. */
    const watch = async (ms: number): Promise<void> => {
      const until = clock.now() + ms
      while (clock.now() < until && !signal.aborted) {
        await clock.sleep(LOOK_MS)
        look()
        if (capped || !onWire()) return
      }
    }

    /**
     * A call into the page, with the bytes looked at all the while. The cap is
     * only as good as the looks, and the transfer runs on while the page
     * answers; one that has not answered within `PAGE_MS` is given up on.
     */
    const meanwhile = async <T>(call: Promise<T>): Promise<T | typeof SILENT> => {
      const answer: { value?: T; settled: boolean } = { settled: false }
      void call.then(
        (value) => Object.assign(answer, { value, settled: true }),
        () => Object.assign(answer, { value: null, settled: true })
      )
      const until = clock.now() + PAGE_MS
      for (;;) {
        if (answer.settled) return answer.value as T
        if (signal.aborted) return null as T
        if (clock.now() >= until) return SILENT
        await clock.sleep(LOOK_MS)
        look()
      }
    }

    const verdict = await (async (): Promise<[CheckResult['result'], string | null]> => {
      try {
        await deps.downloads.enqueue(rom)
      } catch (cause) {
        log.info('selftest', 'the large download would not start', { cause })
        return ['fail', `download-${item()?.state ?? 'missing'}`]
      }
      const started = clock.now()
      // The highlight goes to the row while the server gets going, so the
      // press later costs no time against the cap.
      const unfocused = await meanwhile(deps.page.focusRow(id))
      if (unfocused === SILENT) return ['fail', PROGRESS_FAILED.pageSilent]
      if (capped) return ['fail', PROGRESS_FAILED.cap]

      while (looks.length === 0 && clock.now() - started < FIRST_BYTE_MS) {
        if (signal.aborted) return ['skip', PROGRESS_FAILED.aborted]
        await clock.sleep(LOOK_MS)
        const now = look()
        if (now && now.state !== 'downloading' && now.state !== 'queued') {
          return ['fail', `download-${now.state}`]
        }
      }
      if (looks.length === 0) return ['fail', PROGRESS_FAILED.noFirstByte]
      metrics.firstByteMs = Math.round(looks[0].at - started)
      if (unfocused !== null) return ['fail', `${PROGRESS_FAILED.notFocused}:${unfocused}`]

      let speedOff = 0
      let timeOff = 0
      for (let reading = 0; reading < READINGS; reading += 1) {
        await watch(looks[0].at + SETTLE_MS + reading * READING_MS - clock.now())
        if (signal.aborted) return ['skip', PROGRESS_FAILED.aborted]
        if (capped) return ['fail', PROGRESS_FAILED.cap]
        const now = look()
        if (!now || now.state !== 'downloading')
          return ['fail', `download-${now?.state ?? 'missing'}`]
        const last = looks[looks.length - 1]
        const first = looks.find((one) => one.at >= last.at - WINDOW_MS) ?? last
        const measured =
          last.at > first.at ? ((last.bytes - first.bytes) * 1000) / (last.at - first.at) : 0
        metrics.measuredBps = Math.round(measured)
        metrics.shownBps = now.rate?.speed == null ? null : Math.round(now.rate.speed)
        metrics.shownSecondsLeft = now.rate?.secondsLeft ?? null
        if (!now.rate?.speed || now.rate.stalled || measured <= 0)
          return ['fail', PROGRESS_FAILED.noSpeed]
        if (now.rate.secondsLeft === null) return ['fail', PROGRESS_FAILED.noTimeLeft]
        const measuredLeft = (now.totalBytes - now.receivedBytes) / measured
        speedOff = Math.max(speedOff, offByPct(now.rate.speed, measured))
        timeOff = Math.max(timeOff, offByPct(now.rate.secondsLeft, measuredLeft))
        metrics.speedOffPct = speedOff
        metrics.timeLeftOffPct = timeOff
        if (reading === 0) {
          const line = await meanwhile(deps.page.line(id))
          if (line === SILENT) return ['fail', PROGRESS_FAILED.pageSilent]
          if (capped) return ['fail', PROGRESS_FAILED.cap]
          if (!lineHasSpeed(line)) return ['fail', PROGRESS_FAILED.line]
        }
      }
      if (speedOff > TOLERANCE_PCT) return ['fail', PROGRESS_FAILED.speed]
      if (timeOff > TOLERANCE_PCT) return ['fail', PROGRESS_FAILED.timeLeft]

      const pressed = clock.now()
      const unpressed = await meanwhile(deps.page.pressX(id))
      if (unpressed === SILENT) return ['fail', PROGRESS_FAILED.pageSilent]
      if (unpressed !== null) return ['fail', `${PROGRESS_FAILED.notFocused}:${unpressed}`]
      while (item()?.state !== 'cancelled' && clock.now() - pressed < CANCEL_MS) {
        look()
        if (capped) return ['fail', PROGRESS_FAILED.cap]
        await clock.sleep(LOOK_MS)
      }
      if (item()?.state !== 'cancelled') return ['fail', PROGRESS_FAILED.notCancelled]
      metrics.cancelMs = Math.round(clock.now() - pressed)
      // The row says cancelled as the press lands; the file goes once the
      // aborted transfer has unwound. See `DownloadManager.cancel`.
      const parts = record ? partPaths(record) : []
      while (clock.now() - pressed < PARTS_GONE_MS) {
        if (!(await anyExists(parts))) return ['pass', null]
        await clock.sleep(LOOK_MS)
      }
      return ['fail', PROGRESS_FAILED.partLeft]
    })()

    // Whatever the outcome: a run leaves no game behind it, and no part of one.
    try {
      const state = item()?.state
      if (state === 'queued' || state === 'downloading') await deps.downloads.cancel(id)
      await deps.downloads.whenIdle()
      if (deps.store.getInstalled(id)) await deps.library.uninstall(id)
    } catch (cause) {
      log.info('selftest', 'removing the large download failed', { cause })
    }
    fetched = Math.max(fetched, item()?.receivedBytes ?? 0)
    metrics.receivedBytes = fetched
    safety.romsDownloadedBytes += fetched
    if ((record && (await anyExists(partPaths(record)))) || deps.store.getInstalled(id)) {
      safety.romsLeft += 1
    }
    return result(verdict[0], verdict[1])
  }
}

async function anyExists(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) if (await exists(path)) return true
  return false
}

/**
 * Run in the page: open Downloads from the menu bar and hover the row until
 * the highlight is on it or on one of its buttons. The hover is repeated a
 * pixel apart, as `reportProbe` does it, since the focus engine ignores a move
 * to where the pointer already is.
 */
export function focusRowProbe(romId: number, timeoutMs = CANCEL_MS): string {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const until = Date.now() + ${Math.round(timeoutMs)}
    const row = () => document.querySelector('section [data-download="${romId}"]')
    const within = (element) =>
      element.dataset.focused === 'true' || Boolean(element.querySelector('[data-focused="true"]'))
    const menu = document.querySelector('.topbar__nav [data-route="downloads"]')
    if (!menu) return 'no-menu-item'
    menu.click()
    let nudge = 0
    while (Date.now() < until) {
      const element = row()
      // The screen opens on what is on the device unless a transfer was
      // already known as it opened, and this one may not have been yet.
      const activity = document.querySelector('[data-screen="downloads"] [data-tab="activity"]')
      if (!element && activity && activity.dataset.active !== 'true') activity.click()
      if (element) {
        if (within(element)) return null
        const box = element.getBoundingClientRect()
        element.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: Math.round(box.left + box.width / 2) + nudge,
          clientY: Math.round(box.top + box.height / 2)
        }))
        nudge = 1 - nudge
      }
      await sleep(50)
    }
    return row() ? 'not-highlighted' : 'no-row'
  })()`
}

/** Run in the page: the row's progress line, or null. */
export function lineProbe(romId: number): string {
  return `document.querySelector('section [data-download="${romId}"] .download__size')?.textContent ?? null`
}

/** Run in the page: X, as the keyboard path sends it, while the highlight is on the row. */
export function pressXProbe(romId: number): string {
  return `(() => {
    const element = document.querySelector('section [data-download="${romId}"]')
    if (!element) return 'no-row'
    if (element.dataset.focused !== 'true' && !element.querySelector('[data-focused="true"]')) {
      return 'not-highlighted'
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    return null
  })()`
}

/** The page half, through `executeJavaScript`; a probe that throws is reported, not raised. */
export function progressPage(contents: Pick<WebContents, 'executeJavaScript'>): ProgressPage {
  const run = <T>(code: string, failed: T): Promise<T> =>
    contents.executeJavaScript(code, true).then(
      (answer: unknown) => answer as T,
      (cause: unknown) => {
        log.warn('selftest', 'the download progress probe failed', { cause })
        return failed
      }
    )
  return {
    focusRow: (romId) => run<string | null>(focusRowProbe(romId), 'probe-failed'),
    line: (romId) => run<string | null>(lineProbe(romId), null),
    pressX: (romId) => run<string | null>(pressXProbe(romId), 'probe-failed')
  }
}
