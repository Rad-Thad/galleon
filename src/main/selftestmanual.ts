import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { RommPlatform, RommRom, RommRomPage, RomQuery } from '@shared/types'
import { hasMorePages } from '@shared/types'
import { PDF_VIEWER_ORIGIN } from './app.ts'
import { log } from './log.ts'
import { SKIP, type CheckResult, type Scenario } from './selftest.ts'
import { writeWhole } from './selftestshots.ts'

/**
 * `manual.open`: a game whose manual RomM holds is opened from the Library the
 * way a player opens it, its Manual tab is pressed, and the first page has to
 * be drawn.
 *
 * The page is drawn by Chromium's PDF viewer inside a frame of its own origin,
 * so nothing in the interface's document can say whether it rendered. The
 * viewer's own page is asked whether it has the document (`ManualPage.state`),
 * and then the frame is captured and judged by its pixels: a page that never
 * drew is a flat rectangle.
 *
 * The manual belongs to a game in the owner's library, and its first page is
 * usually the box art and the title, which nothing published may carry
 * (docs/TESTING.md, `summary.json`). So the capture is judged here, whole, and
 * only a mosaic too coarse to read is kept as evidence.
 */

export const MANUAL_CHECK = 'manual.open'

/** Under the results folder, as the run's other screenshots. */
export const MANUAL_SHOT = 'shots/manual-page.png'

/** How long the page is given to reach the open manual. */
export const OPEN_TIMEOUT_MS = 20_000

/** How long the first page is given to draw once its frame is there. */
export const DRAW_WAIT_MS = 15_000

/** How often the frame is looked at while it draws. */
export const DRAW_POLL_MS = 500

/** The width the published capture is shrunk to. See the note on this module. */
export const MOSAIC_WIDTH = 24

/**
 * A drawn page against an empty frame. A page of print brings many tones with
 * its anti-aliasing, and the viewer draws the page on a background of its own,
 * so not even a sheet with one line on it fills the frame with one colour.
 */
export const MIN_TONES = 8
export const MAX_DOMINANT = 0.99

/** The viewer's own word on its document. See `ManualPage.state`. */
const VIEWER_LOADED = 'success'
const VIEWER_FAILED = 'failed'

/**
 * Read in the viewer's own page: its load state, which is the one thing that
 * says the document arrived and was opened. A private field of Chromium's
 * viewer, so an Electron that renames it reads as null, and the app test
 * against the fake's manual fails before such an Electron ships.
 */
const VIEWER_STATE = `document.querySelector('pdf-viewer')?.loadState_ ?? null`

/** How many listings a page asks for while looking for a manual. */
const PAGE = 250

/** One look at the frame: its pixels in BGRA, and the mosaic kept if it is the one. */
export interface FrameCapture {
  bitmap: Buffer
  width: number
  height: number
  mosaic: Buffer
}

export interface ManualPage {
  /** Open the game's Manual and press Read; null once the frame is up, else where it stopped. */
  open: (rom: RommRom, timeoutMs: number) => Promise<string | null>
  /**
   * What the viewer says of its document: `loading`, `success` or `failed`,
   * or null when no viewer could be read.
   */
  state: () => Promise<string | null>
  /** The frame as it stands, or null when it could not be captured. */
  capture: () => Promise<FrameCapture | null>
  /** Put the manual down and go back to Home, so later checks start where they expect. */
  close: () => Promise<void>
}

export interface ManualScenarioDeps {
  client: {
    platforms(): Promise<RommPlatform[]>
    roms(query: RomQuery): Promise<RommRomPage>
  }
  page: ManualPage
  resultsDir: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  drawWaitMs?: number
}

/**
 * The first game, platform by platform, whose manual RomM holds.
 *
 * Listed as the Library lists it, one row per game, so the game found is a tile
 * the grid draws and the one that tile opens.
 */
export async function gameWithManual(
  client: ManualScenarioDeps['client']
): Promise<RommRom | null> {
  for (const platform of await client.platforms()) {
    for (let offset = 0; ; offset += PAGE) {
      const page = await client.roms({
        platform_ids: [platform.id],
        group_by_meta_id: true,
        limit: PAGE,
        offset
      })
      const found = page.items.find((rom) => rom.has_manual && rom.path_manual)
      if (found) return found
      if (!hasMorePages(page)) break
    }
  }
  return null
}

/** How many tones the frame holds, and the share of it the commonest one covers. */
export function judgeFrame(frame: Pick<FrameCapture, 'bitmap' | 'width' | 'height'>): {
  tones: number
  dominant: number
} {
  const pixels = frame.width * frame.height
  if (pixels <= 0 || frame.bitmap.length < pixels * 4) return { tones: 0, dominant: 1 }
  // Four bits a channel, so the noise of scaling is not counted as print.
  const counts = new Map<number, number>()
  for (let at = 0; at < pixels * 4; at += 4) {
    const key =
      ((frame.bitmap[at] >> 4) << 8) |
      ((frame.bitmap[at + 1] >> 4) << 4) |
      (frame.bitmap[at + 2] >> 4)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return { tones: counts.size, dominant: Math.max(...counts.values()) / pixels }
}

const drawn = (look: { tones: number; dominant: number }): boolean =>
  look.tones >= MIN_TONES && look.dominant <= MAX_DOMINANT

/**
 * Passes when the viewer has the document and the first page drew, within
 * `DRAW_WAIT_MS` of its frame. A library without a manual is `skip` /
 * `no-manual`.
 */
export function manualScenario(deps: ManualScenarioDeps): Scenario {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  return async ({ signal }) => {
    const result = (
      verdict: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics'] = {},
      evidence: string[] = []
    ): CheckResult => ({
      id: MANUAL_CHECK,
      result: verdict,
      metrics,
      thresholds: { minTones: MIN_TONES, maxDominant: MAX_DOMINANT },
      reason,
      evidence
    })

    let rom: RommRom | null
    try {
      rom = await gameWithManual(deps.client)
    } catch (cause) {
      log.info('selftest', 'listing the library for a manual failed', { cause })
      return result('error', 'listing-failed')
    }
    if (rom === null) return result('skip', 'no-manual')
    if (signal.aborted) return result('skip', SKIP.aborted)

    const metrics: CheckResult['metrics'] = { platform: rom.platform_slug }
    try {
      const stopped = await deps.page.open(rom, OPEN_TIMEOUT_MS)
      if (stopped !== null) return result('fail', `not-opened:${stopped}`, metrics)

      const opened = now()
      const until = opened + (deps.drawWaitMs ?? DRAW_WAIT_MS)
      let last: FrameCapture | null = null
      for (;;) {
        if (signal.aborted) return result('skip', SKIP.aborted, metrics)
        const state = await deps.page.state()
        metrics.viewer = state ?? 'unread'
        if (state === VIEWER_FAILED) return result('fail', 'viewer-failed', metrics)
        // Only once the viewer has the document: a capture taken earlier can
        // be the compositor's last frame, the screen behind, and that is busy
        // enough to pass for print.
        const frame = state === VIEWER_LOADED ? await deps.page.capture() : null
        if (frame) {
          last = frame
          const look = judgeFrame(frame)
          metrics.tones = look.tones
          metrics.dominant = Number(look.dominant.toFixed(3))
          if (drawn(look)) {
            metrics.drawnMs = now() - opened
            writeWhole(join(deps.resultsDir, MANUAL_SHOT), frame.mosaic)
            return result('pass', null, metrics, [MANUAL_SHOT])
          }
        }
        if (now() >= until) break
        await sleep(DRAW_POLL_MS)
      }
      if (metrics.viewer !== VIEWER_LOADED) return result('fail', 'not-loaded', metrics)
      if (!last) return result('fail', 'not-captured', metrics)
      writeWhole(join(deps.resultsDir, MANUAL_SHOT), last.mosaic)
      return result('fail', 'not-drawn', metrics, [MANUAL_SHOT])
    } finally {
      await deps.page.close()
    }
  }
}

/**
 * Run in the page: from the menu bar to the Library, the game's platform, its
 * name in the search box and its tile; then the Manual tab and Read. Resolves
 * with null once the frame is asking for page one, or with where it stopped.
 * Every press is a click, which reaches the item the way its own `onSelect`
 * does (see `screenProbe`).
 */
export function openProbe(
  rom: Pick<RommRom, 'id' | 'platform_id'>,
  term: string,
  timeoutMs: number
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
    const press = async (selector, code) => {
      const found = await waitFor(() => document.querySelector(selector))
      if (!found) return code
      found.click()
      return null
    }
    let stopped = await press('.topbar__nav [data-route="library"]', 'no-library-menu')
    if (stopped) return stopped
    const chip = await waitFor(() => document.querySelector('[data-screen="library"] [data-platform="${Number(rom.platform_id)}"]'))
    if (!chip) return 'no-platform-chip'
    // A second press on the chosen chip would let the platform go again.
    if (chip.dataset.active !== 'true') chip.click()
    const search = await waitFor(() => document.querySelector('[data-screen="library"] input[type="text"]'))
    if (!search) return 'no-search'
    // The way React hears a typed value: through the input's own setter.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, ${JSON.stringify(term)})
    search.dispatchEvent(new Event('input', { bubbles: true }))
    stopped = await press('[data-screen="library"] [data-rom="${Number(rom.id)}"]', 'no-tile')
    if (stopped) return stopped
    if (!(await waitFor(() => document.querySelector('[data-screen="game"]')))) return 'no-game-screen'
    stopped = await press('[data-tab="manual"]', 'no-manual-tab')
    if (stopped) return stopped
    stopped = await press('[data-action="read-manual"]', 'no-read-button')
    if (stopped) return stopped
    const frame = await waitFor(() => {
      const here = document.querySelector('.viewer__page')
      return here && here.src.endsWith('page=1') ? here : null
    })
    return frame ? null : 'no-frame'
  })()`
}

/** The manual's frame, in the page's own pixels. */
const FRAME_RECT = `(() => {
  const r = document.querySelector('.viewer__page')?.getBoundingClientRect()
  return r ? { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } : null
})()`

/** `open`, `capture` and `close` against the app's page. */
export function manualPage(
  contents: Pick<WebContents, 'executeJavaScript' | 'capturePage' | 'mainFrame'>
): ManualPage {
  return {
    state: async () => {
      const viewer = contents.mainFrame.framesInSubtree.find((frame) =>
        frame.url.startsWith(`${PDF_VIEWER_ORIGIN}/index.html`)
      )
      if (!viewer) return null
      try {
        const state: unknown = await viewer.executeJavaScript(VIEWER_STATE)
        return typeof state === 'string' ? state : null
      } catch (cause) {
        log.warn('selftest', "the manual viewer's state could not be read", { cause })
        return null
      }
    },
    open: (rom, timeoutMs) =>
      contents.executeJavaScript(openProbe(rom, rom.name ?? rom.fs_name, timeoutMs), true).then(
        (stopped: unknown) => (typeof stopped === 'string' ? stopped : null),
        (cause: unknown) => {
          log.warn('selftest', 'opening the manual failed', { cause })
          return 'probe-failed'
        }
      ),
    capture: async () => {
      try {
        const rect = (await contents.executeJavaScript(FRAME_RECT, true)) as {
          x: number
          y: number
          width: number
          height: number
        } | null
        if (!rect || rect.width <= 0 || rect.height <= 0) return null
        const image = await contents.capturePage(rect)
        const { width, height } = image.getSize()
        const bitmap = image.toBitmap()
        if (width <= 0 || height <= 0 || bitmap.length === 0) return null
        return { bitmap, width, height, mosaic: image.resize({ width: MOSAIC_WIDTH }).toPNG() }
      } catch (cause) {
        log.warn('selftest', 'the manual could not be captured', { cause })
        return null
      }
    },
    close: async () => {
      await contents
        .executeJavaScript(
          `(async () => {
            document.querySelector('[data-action="close-manual"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 100))
            document.querySelector('.topbar__nav [data-route="home"]')?.click()
          })()`,
          true
        )
        .catch(() => undefined)
    }
  }
}
