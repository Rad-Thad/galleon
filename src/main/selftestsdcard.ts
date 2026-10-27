import { constants, existsSync } from 'node:fs'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Volume } from '@shared/librarycard'
import { SHARED_LIBRARY, type InstalledRom, type Settings } from '@shared/types'
import { CARD_LIBRARY_PATH, chooseDefaultLibrary } from './librarydefault.ts'
import { log } from './log.ts'
import type { CheckResult, Scenario } from './selftest.ts'

/**
 * `storage.sdcard`: the library goes on the SD card, and a card that is out
 * loses no game.
 *
 * Three parts, each judged alone and joined at the end:
 *
 * - The default a fresh installation would take, chosen from the volumes the
 *   machine reports, is the mounted ext4 card. `RomMixApp.chooseDefaultLibrary`
 *   never runs under `GALLEON_HOME`, so the scenario asks the same function.
 * - `download.small` lands on that card and is taken away again. It lands in a
 *   folder of the run's own on the card rather than the card's library folder,
 *   which may be the owner's own library with their games in it.
 * - With the library pointed at a card that is not mounted, a game on it is
 *   marked `cardMissing` (what the screens show as "card not inserted") and the
 *   index's prune keeps it. The game is a made-up index entry, never a file:
 *   nothing is written where the card would be.
 *
 * Whatever happens, the setting is put back, the entry and the run's folder go.
 */

export const SDCARD_CHECK = 'storage.sdcard'

/**
 * Below zero, where RomM's own ids never are, and clear of the synthetic
 * games' (see `SYNTHETIC_PLATFORM_ID`), so the made-up entry is no one's game.
 */
export const ABSENT_GAME_ID = -2_000_000

/** The run's own folder on the card, named so it is plainly the self-test's. */
const SCRATCH_PREFIX = '.galleon-selftest-'

export interface SdCardScenarioDeps {
  volumes: () => Promise<Volume[]>
  user: string
  /** `missingCardTest` as it is now. Replaceable so tests need no card. */
  missingCards: () => (path: string) => boolean
  store: {
    readonly settings: Pick<Settings, 'libraryRoot'>
    updateSettings(patch: Pick<Settings, 'libraryRoot'>): unknown
    getInstalled(romId: number): InstalledRom | undefined
    addInstalledMany(entries: readonly InstalledRom[]): void
    removeInstalled(romId: number): void
    pruneInstalled(onMissingCard: (path: string) => boolean): number
  }
  library: { installedNow(romId: number): InstalledRom | undefined }
  /** `download.small` with its game held to land inside `home`. */
  download: (home: string) => Scenario
  /** Take away earlier runs' folders on the card. See `sweepScratch`. */
  sweep?: (mountPoint: string) => Promise<void>
  /** A new empty folder inside `dir`. */
  makeScratch?: (dir: string) => Promise<string>
  /** Is this folder one the user may write in? */
  writable?: (dir: string) => Promise<boolean>
}

type Outcome = [CheckResult['result'], string | null]

async function canWrite(dir: string): Promise<boolean> {
  return access(dir, constants.W_OK).then(
    () => true,
    () => false
  )
}

/** The most telling of the parts: a failure, then an error, then a skip. */
function joined(parts: Outcome[]): Outcome {
  for (const kind of ['fail', 'error', 'skip'] as const) {
    const found = parts.find(([result]) => result === kind)
    if (found) return found
  }
  return ['pass', null]
}

/** The made-up game, on the card that is not there. */
function absentGame(libraryRoot: string): InstalledRom {
  const path = join(libraryRoot, 'snes', 'galleon-selftest.sfc')
  return {
    romId: ABSENT_GAME_ID,
    path,
    launchPath: path,
    name: 'Galleon self-test',
    coverPath: null,
    files: ['galleon-selftest.sfc'],
    system: 'snes',
    platformName: 'Self-test',
    sizeBytes: 0,
    installedAt: new Date(0).toISOString(),
    isDirectory: false,
    emulatorId: SHARED_LIBRARY
  }
}

/**
 * Take away the folders earlier runs left on the card.
 *
 * A run killed before its own clean-up, by the harness's deadline or a crash,
 * leaves its folder behind, and nothing else on the device looks at the card.
 * Only folders with the run's own prefix are touched.
 */
export async function sweepScratch(mountPoint: string): Promise<void> {
  const names = await readdir(mountPoint).catch(() => [] as string[])
  for (const name of names) {
    if (!name.startsWith(SCRATCH_PREFIX)) continue
    await rm(join(mountPoint, name), { recursive: true, force: true }).catch((cause: unknown) =>
      log.info('selftest', 'removing an earlier run folder on the card failed', { cause })
    )
  }
}

export function sdCardScenario(deps: SdCardScenarioDeps): Scenario {
  const writable = deps.writable ?? canWrite
  const makeScratch = deps.makeScratch ?? ((dir: string) => mkdtemp(join(dir, SCRATCH_PREFIX)))

  return async (context) => {
    const metrics: CheckResult['metrics'] = {}
    const result = ([outcome, reason]: Outcome): CheckResult => ({
      id: SDCARD_CHECK,
      result: outcome,
      metrics,
      thresholds: {},
      reason,
      evidence: []
    })
    const before = deps.store.settings.libraryRoot

    // Part one: the default.
    let volumes: Volume[]
    try {
      volumes = await deps.volumes()
    } catch (cause) {
      log.info('selftest', 'reading the volumes failed', { cause })
      return result(['error', 'volumes-unreadable'])
    }
    const chosen = await chooseDefaultLibrary({
      volumes: async () => volumes,
      user: deps.user,
      // Only asked whether the card would take the folder: making it would
      // leave a folder on the owner's card that the run did not need.
      prepare: (dir) => writable(resolve(dir, ...CARD_LIBRARY_PATH.map(() => '..')))
    })
    metrics.defaultRoot = chosen.libraryRoot || null
    metrics.mountPoint = chosen.volume?.mountPoint ?? null
    metrics.label = chosen.volume?.label ?? null
    metrics.fsType = chosen.volume?.fsType ?? null
    const card = chosen.volume
    const onCard: Outcome =
      card === null
        ? // The card being out, full or read-only is the device's state, not a
          // fault of the choice, which unit tests hold to each of those cases.
          ['skip', `card-${chosen.reason}`]
        : card.fsType !== 'ext4'
          ? ['fail', 'card-not-ext4']
          : dirname(card.mountPoint) !== join('/run/media', deps.user)
            ? ['fail', 'card-outside-user-media']
            : ['pass', null]

    // Part two: a game lands on the card.
    // Without a card that passed, there is nowhere for it to land: part one
    // already says why.
    let landed: Outcome = onCard[0] === 'pass' ? ['skip', 'aborted'] : onCard
    if (card !== null && onCard[0] === 'pass' && !context.signal.aborted) {
      let scratch: string | null = null
      try {
        await (deps.sweep ?? sweepScratch)(card.mountPoint)
        scratch = await makeScratch(card.mountPoint)
        deps.store.updateSettings({ libraryRoot: scratch })
        const answers = await deps.download(scratch)(context)
        const answer = Array.isArray(answers) ? answers[0] : answers
        metrics.downloadBytes = answer?.metrics.bytes ?? null
        landed = answer
          ? answer.result === 'pass'
            ? ['pass', null]
            : [answer.result, `download-${answer.reason ?? answer.result}`]
          : ['error', 'download-unanswered']
      } catch (cause) {
        log.info('selftest', 'the download onto the card threw', { cause })
        landed = ['error', 'download-threw']
      } finally {
        deps.store.updateSettings({ libraryRoot: before })
        if (scratch !== null) {
          await rm(scratch, { recursive: true, force: true }).catch((cause: unknown) =>
            log.info('selftest', 'removing the folder on the card failed', { cause })
          )
          if (existsSync(scratch)) {
            context.safety.romsLeft += 1
            landed = ['fail', 'card-folder-left']
          }
        }
      }
    }

    // Part three: a card that is out.
    let kept: Outcome = ['skip', 'aborted']
    if (!context.signal.aborted) kept = await absentCard(deps, metrics, before)

    return result(joined([onCard, landed, kept]))
  }
}

/** Part three of `sdCardScenario`. Never throws; puts back what it changed. */
async function absentCard(
  deps: SdCardScenarioDeps,
  metrics: CheckResult['metrics'],
  before: string
): Promise<Outcome> {
  // A card name no one has, so its mount point is nowhere in the table.
  const mount = join('/run/media', deps.user, `GalleonSelfTestAbsent-${process.pid}`)
  const libraryRoot = join(mount, ...CARD_LIBRARY_PATH)
  const entry = absentGame(libraryRoot)
  if (!deps.missingCards()(entry.path)) return ['skip', 'absent-card-mounted']
  // A game of the test home's under that id would be put at risk below.
  if (deps.store.getInstalled(ABSENT_GAME_ID)) return ['skip', 'absent-id-taken']

  let outcome: Outcome
  try {
    deps.store.updateSettings({ libraryRoot })
    deps.store.addInstalledMany([entry])
    const pruned = deps.store.pruneInstalled(deps.missingCards())
    metrics.pruned = pruned
    const shown = deps.library.installedNow(ABSENT_GAME_ID)
    metrics.cardMissing = shown?.cardMissing === true ? 1 : 0
    outcome = !deps.store.getInstalled(ABSENT_GAME_ID)
      ? ['fail', 'absent-game-pruned']
      : shown?.cardMissing !== true
        ? ['fail', 'absent-game-not-marked']
        : ['pass', null]
  } catch (cause) {
    log.info('selftest', 'the card-not-inserted part threw', { cause })
    outcome = ['error', 'absent-card-threw']
  }
  try {
    if (deps.store.getInstalled(ABSENT_GAME_ID)) deps.store.removeInstalled(ABSENT_GAME_ID)
  } catch (cause) {
    log.info('selftest', 'removing the made-up entry failed', { cause })
  }
  try {
    deps.store.updateSettings({ libraryRoot: before })
  } catch (cause) {
    log.info('selftest', 'putting the library folder back failed', { cause })
  }
  if (deps.store.getInstalled(ABSENT_GAME_ID)) return ['fail', 'absent-entry-left']
  if (deps.store.settings.libraryRoot !== before) return ['fail', 'library-root-not-restored']
  // Nothing may be made where the card would be mounted.
  if (existsSync(mount)) return ['fail', 'absent-mount-created']
  return outcome
}
