import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type {
  DownloadItem,
  InstalledRom,
  RommPlatform,
  RommRom,
  RommRomPage,
  RomQuery
} from '@shared/types'
import { hasMorePages } from '@shared/types'
import { hashOf } from './integrity.ts'
import { log } from './log.ts'
import { checksumOf, type Checksum, unpackedChecksumOf } from './romm/checksums.ts'
import type { CheckResult, Scenario } from './selftest.ts'

/**
 * `download.small`: the cheapest proof that a game comes down from the
 * owner's server, lands in the test home and is the game RomM published.
 *
 * The real download queue does the work, so what is measured is what the
 * player gets; the scenario only picks the game, watches the queue's own
 * events, hashes the result itself and takes it away again.
 */

export const DOWNLOAD_CHECK = 'download.small'

/** The platforms whose games are small enough to fetch on every run. */
const SMALL_PLATFORMS = new Set(['snes', 'sfam', 'gba'])

/** How many listings a page asks for while looking for the smallest game. */
const PAGE = 250

export interface DownloadScenarioDeps {
  client: {
    platforms(): Promise<RommPlatform[]>
    roms(query: RomQuery): Promise<RommRomPage>
  }
  downloads: {
    enqueue(rom: RommRom): Promise<DownloadItem>
    whenIdle(): Promise<void>
    cancel(romId: number): Promise<void>
    readonly items: DownloadItem[]
    on(event: 'update', listener: (items: DownloadItem[]) => void): unknown
    off(event: 'update', listener: (items: DownloadItem[]) => void): unknown
  }
  library: { uninstall(romId: number): Promise<void> }
  store: { getInstalled(romId: number): InstalledRom | undefined }
  /** The test home. A game that lands anywhere else fails the check. */
  home: string
}

/**
 * The digest the file kept on disk is held to: the served file's own, or the
 * one RomM took of the game inside a zip, which is what is kept once unpacked.
 */
function keptDigest(rom: RommRom): Checksum | null {
  return checksumOf(rom) ?? unpackedChecksumOf(rom)
}

/**
 * The smallest game of those platforms that RomM published a digest for.
 *
 * Without a digest there is nothing to verify, and a check that passes on an
 * unverified file says less than one that is skipped.
 */
export async function smallestGame(
  client: DownloadScenarioDeps['client']
): Promise<RommRom | null> {
  const platforms = (await client.platforms()).filter(
    (platform) => SMALL_PLATFORMS.has(platform.slug) || SMALL_PLATFORMS.has(platform.fs_slug)
  )
  let best: RommRom | null = null
  for (const platform of platforms) {
    for (let offset = 0; ; offset += PAGE) {
      const page = await client.roms({ platform_ids: [platform.id], limit: PAGE, offset })
      for (const rom of page.items) {
        if (rom.fs_size_bytes <= 0 || keptDigest(rom) === null) continue
        if (best === null || rom.fs_size_bytes < best.fs_size_bytes) best = rom
      }
      if (!hasMorePages(page)) break
    }
  }
  return best
}

function inside(home: string, path: string): boolean {
  const rel = relative(resolve(home), resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function downloadScenario(deps: DownloadScenarioDeps): Scenario {
  return async ({ safety, signal }) => {
    const result = (
      outcome: CheckResult['result'],
      reason: string | null,
      metrics: CheckResult['metrics'] = {}
    ): CheckResult => ({
      id: DOWNLOAD_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })

    let rom: RommRom | null
    try {
      rom = await smallestGame(deps.client)
    } catch (cause) {
      log.info('selftest', 'listing the small platforms failed', { cause })
      return result('error', 'listing-failed')
    }
    if (rom === null) return result('skip', 'no-hashed-snes-or-gba-title')
    // A game already here is not one this run may take away afterwards.
    if (deps.store.getInstalled(rom.id)) return result('skip', 'already-installed')

    const digest = keptDigest(rom)!
    let progressEvents = 0
    const onUpdate = (items: DownloadItem[]): void => {
      const item = items.find((candidate) => candidate.romId === rom.id)
      if (item?.state === 'downloading') progressEvents += 1
    }
    // An aborted run stops the transfer rather than waiting it out.
    const onAbort = (): void => void deps.downloads.cancel(rom.id)
    deps.downloads.on('update', onUpdate)
    signal.addEventListener('abort', onAbort)
    const started = performance.now()
    try {
      await deps.downloads.enqueue(rom)
      await deps.downloads.whenIdle()
    } catch (cause) {
      log.info('selftest', 'the small download threw', { cause })
    } finally {
      deps.downloads.off('update', onUpdate)
      signal.removeEventListener('abort', onAbort)
    }
    const downloadMs = Math.round(performance.now() - started)
    const item = deps.downloads.items.find((candidate) => candidate.romId === rom.id)
    const entry = deps.store.getInstalled(rom.id)
    const sizeBytes = entry ? ((await stat(entry.path).catch(() => null))?.size ?? 0) : 0
    safety.romsDownloadedBytes += sizeBytes
    const metrics: CheckResult['metrics'] = {
      platform: rom.platform_slug,
      bytes: rom.fs_size_bytes,
      downloadMs,
      progressEvents,
      hashAlgorithm: digest.algorithm
    }

    const outcome = await (async (): Promise<[CheckResult['result'], string | null]> => {
      if (item?.state !== 'done' || !entry) return ['fail', `download-${item?.state ?? 'missing'}`]
      if (!inside(deps.home, entry.path)) return ['fail', 'outside-test-home']
      if (entry.isDirectory) return ['fail', 'installed-as-folder']
      if (progressEvents === 0) return ['fail', 'no-progress-events']
      const actual = await hashOf(entry.path, digest.algorithm).catch(() => null)
      if (actual?.toLowerCase() !== digest.expected.toLowerCase()) return ['fail', 'hash-mismatch']
      return ['pass', null]
    })()

    // Whatever the outcome: a run leaves no game behind it, and no part of one.
    try {
      if (item && item.state !== 'done') await deps.downloads.cancel(rom.id)
      if (deps.store.getInstalled(rom.id)) await deps.library.uninstall(rom.id)
    } catch (cause) {
      log.info('selftest', 'removing the small download failed', { cause })
    }
    const left = entry
      ? await stat(entry.path).then(
          () => true,
          () => false
        )
      : false
    if (left || deps.store.getInstalled(rom.id)) {
      safety.romsLeft += 1
      return result('fail', 'not-deleted', metrics)
    }
    return result(outcome[0], outcome[1], metrics)
  }
}
