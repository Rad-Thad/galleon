import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import type { Volume } from '@shared/librarycard'
import type { InstalledRom } from '@shared/types'
import type { CheckResult, Safety, Scenario } from './selftest.ts'
import {
  ABSENT_GAME_ID,
  SDCARD_CHECK,
  sdCardScenario,
  sweepScratch,
  type SdCardScenarioDeps
} from './selftestsdcard.ts'

/**
 * `storage.sdcard` against fakes: the volumes, the store and the download are
 * stand-ins, so what is under test is the verdict of each part, how they are
 * joined, and that the setting, the made-up entry and the folder on the card
 * are put back whatever happens.
 */

const USER = 'deck'
const GiB = 1024 ** 3
const NOVA: Volume = {
  mountPoint: `/run/media/${USER}/NovaSD`,
  fsType: 'ext4',
  label: 'NovaSD',
  readOnly: false,
  freeBytes: 100 * GiB,
  totalBytes: 128 * GiB
}

function safety(): Safety {
  return {
    serverWritesAttempted: 0,
    deviceIdOnSaveRequests: 0,
    ownerStateChanged: [],
    romsDownloadedBytes: 0,
    romsLeft: 0
  }
}

let cardDir: string
beforeEach(() => {
  cardDir = mkdtempSync(join(tmpdir(), 'galleon-sdcard-'))
})
afterEach(() => rmSync(cardDir, { recursive: true, force: true }))

type DownloadAnswer = CheckResult['result'] | 'throws'

interface Options {
  volumes?: Volume[] | 'throws'
  writable?: boolean
  download?: DownloadAnswer
  /** Whether the made-up card counts as missing. */
  absentMissing?: boolean
  /** The prune ignores the card test, as a regression would. */
  pruneIgnoresCard?: boolean
  /** The library never marks a game `cardMissing`. */
  noMark?: boolean
  removeThrows?: boolean
  restoreIgnored?: boolean
  installed?: InstalledRom[]
  signal?: AbortSignal
}

async function run(options: Options = {}) {
  const installed = new Map<number, InstalledRom>(
    (options.installed ?? []).map((entry) => [entry.romId, entry])
  )
  const settings = { libraryRoot: '/home/deck/galleon/roms' }
  const rootsSeen: string[] = []
  const downloadHomes: string[] = []
  const missing = (path: string): boolean =>
    path.startsWith(`/run/media/${USER}/GalleonSelfTestAbsent`)
      ? (options.absentMissing ?? true)
      : false
  const store: SdCardScenarioDeps['store'] = {
    settings,
    updateSettings(patch) {
      if (options.restoreIgnored && patch.libraryRoot === '/home/deck/galleon/roms') return
      settings.libraryRoot = patch.libraryRoot
      rootsSeen.push(patch.libraryRoot)
    },
    getInstalled: (romId) => installed.get(romId),
    addInstalledMany(entries) {
      for (const entry of entries) installed.set(entry.romId, entry)
    },
    removeInstalled(romId) {
      if (options.removeThrows) throw new Error('read-only index')
      installed.delete(romId)
    },
    pruneInstalled(onMissingCard) {
      let removed = 0
      for (const [romId, entry] of installed) {
        if (!options.pruneIgnoresCard && onMissingCard(entry.path)) continue
        if (existsSync(entry.path)) continue
        installed.delete(romId)
        removed += 1
      }
      return removed
    }
  }
  const library = {
    installedNow(romId: number) {
      const entry = installed.get(romId)
      if (!entry) return undefined
      return !options.noMark && missing(entry.path)
        ? { ...entry, cardMissing: true as const }
        : entry
    }
  }
  const download = (home: string): Scenario => {
    downloadHomes.push(home)
    return async () => {
      const answer = options.download ?? 'pass'
      if (answer === 'throws') throw new Error('queue broke')
      writeFileSync(join(home, 'game.sfc'), 'rom')
      return {
        id: 'download.small',
        result: answer,
        metrics: { bytes: 3 },
        thresholds: {},
        reason: answer === 'pass' ? null : 'hash-mismatch',
        evidence: []
      }
    }
  }
  const scratches: string[] = []
  const swept: string[] = []
  const deps: SdCardScenarioDeps = {
    volumes: async () => {
      if (options.volumes === 'throws') throw new Error('no mount table')
      return options.volumes ?? [NOVA]
    },
    user: USER,
    missingCards: () => missing,
    store,
    library,
    download,
    writable: async (dir) => {
      const cards = Array.isArray(options.volumes) ? options.volumes : [NOVA]
      assert.ok(
        cards.some((card) => card.mountPoint === dir),
        'only the card itself is asked about'
      )
      return options.writable ?? true
    },
    sweep: async (mountPoint) => {
      swept.push(mountPoint)
    },
    makeScratch: async () => {
      const dir = mkdtempSync(join(cardDir, '.galleon-selftest-'))
      scratches.push(dir)
      return dir
    }
  }
  const s = safety()
  const answered = await sdCardScenario(deps)({
    request: {} as never,
    safety: s,
    signal: options.signal ?? new AbortController().signal
  })
  const check = answered as CheckResult
  return { check, settings, installed, rootsSeen, downloadHomes, scratches, swept, safety: s }
}

describe('storage.sdcard', () => {
  test('passes with the card mounted: picked, landed on, and a card that is out keeps its game', async () => {
    const { check, settings, installed, rootsSeen, downloadHomes, scratches, swept } = await run()
    assert.deepEqual(swept, [NOVA.mountPoint])
    assert.equal(check.id, SDCARD_CHECK)
    assert.equal(check.result, 'pass', String(check.reason))
    assert.equal(check.metrics.defaultRoot, `${NOVA.mountPoint}/galleon/roms`)
    assert.equal(check.metrics.mountPoint, NOVA.mountPoint)
    assert.equal(check.metrics.label, 'NovaSD')
    assert.equal(check.metrics.fsType, 'ext4')
    assert.equal(check.metrics.downloadBytes, 3)
    assert.equal(check.metrics.pruned, 0)
    assert.equal(check.metrics.cardMissing, 1)
    // The download went to the run's own folder on the card, with the library there.
    assert.deepEqual(downloadHomes, scratches)
    assert.equal(rootsSeen[0], scratches[0])
    assert.match(rootsSeen[2], /^\/run\/media\/deck\/GalleonSelfTestAbsent-\d+\/galleon\/roms$/)
    // And everything is as it was.
    assert.equal(settings.libraryRoot, '/home/deck/galleon/roms')
    assert.equal(existsSync(scratches[0]), false)
    assert.equal(installed.size, 0)
  })

  test('skips the card parts without a card, and still proves the card that is out', async () => {
    const { check, downloadHomes } = await run({ volumes: [] })
    assert.equal(check.result, 'skip')
    assert.equal(check.reason, 'card-no-card')
    assert.deepEqual(downloadHomes, [])
    assert.equal(check.metrics.defaultRoot, null)
    assert.equal(check.metrics.cardMissing, 1)
  })

  test('a card that is out still fails the check when its game is pruned, card or none', async () => {
    const { check } = await run({ volumes: [], pruneIgnoresCard: true })
    assert.equal(check.result, 'fail')
    assert.equal(check.reason, 'absent-game-pruned')
    assert.equal(check.metrics.pruned, 1)
  })

  test('skips a card passed over for being full or not ext4: the device, not the choice', async () => {
    const full = await run({ volumes: [{ ...NOVA, freeBytes: GiB }] })
    assert.deepEqual([full.check.result, full.check.reason], ['skip', 'card-nearly-full'])
    const fat = await run({ volumes: [{ ...NOVA, fsType: 'vfat' }] })
    assert.deepEqual([fat.check.result, fat.check.reason], ['skip', 'card-not-ext4'])
  })

  test('skips a card that will not be written to, without making anything on it', async () => {
    const { check, scratches } = await run({ writable: false })
    assert.deepEqual([check.result, check.reason], ['skip', 'card-not-writable'])
    assert.deepEqual(scratches, [])
  })

  test('fails a card mounted outside the user’s media folder', async () => {
    const { check, downloadHomes } = await run({
      volumes: [{ ...NOVA, mountPoint: '/run/media/NovaSD' }]
    })
    assert.deepEqual([check.result, check.reason], ['fail', 'card-outside-user-media'])
    assert.deepEqual(downloadHomes, [])
  })

  test('a download that fails on the card fails the check and still puts everything back', async () => {
    const { check, settings, scratches } = await run({ download: 'fail' })
    assert.deepEqual([check.result, check.reason], ['fail', 'download-hash-mismatch'])
    assert.equal(settings.libraryRoot, '/home/deck/galleon/roms')
    assert.equal(existsSync(scratches[0]), false)
  })

  test('a download that throws is an error, and the folder still goes', async () => {
    const { check, settings, scratches } = await run({ download: 'throws' })
    assert.deepEqual([check.result, check.reason], ['error', 'download-threw'])
    assert.equal(settings.libraryRoot, '/home/deck/galleon/roms')
    assert.equal(existsSync(scratches[0]), false)
  })

  test('a download that is skipped skips the check, named after why', async () => {
    const { check } = await run({ download: 'skip' })
    assert.deepEqual([check.result, check.reason], ['skip', 'download-hash-mismatch'])
  })

  test('a failure outranks an error, and an error outranks a skip', async () => {
    const both = await run({ download: 'throws', pruneIgnoresCard: true })
    assert.deepEqual([both.check.result, both.check.reason], ['fail', 'absent-game-pruned'])
    const errorOverSkip = await run({ download: 'throws', absentMissing: false })
    assert.deepEqual(
      [errorOverSkip.check.result, errorOverSkip.check.reason],
      ['error', 'download-threw']
    )
  })

  test('fails when the game on the card that is out is not marked', async () => {
    const { check } = await run({ noMark: true })
    assert.deepEqual([check.result, check.reason], ['fail', 'absent-game-not-marked'])
    assert.equal(check.metrics.cardMissing, 0)
  })

  test('skips the card-out part when the made-up card counts as mounted', async () => {
    const { check, installed } = await run({ absentMissing: false })
    assert.deepEqual([check.result, check.reason], ['skip', 'absent-card-mounted'])
    assert.equal(installed.size, 0)
  })

  test('leaves a game already under the made-up id alone', async () => {
    const own = { romId: ABSENT_GAME_ID, path: '/home/deck/x.sfc' } as InstalledRom
    const { check, installed } = await run({ installed: [own] })
    assert.deepEqual([check.result, check.reason], ['skip', 'absent-id-taken'])
    assert.equal(installed.get(ABSENT_GAME_ID), own)
  })

  test('fails when the made-up entry cannot be taken out again', async () => {
    const { check } = await run({ removeThrows: true })
    assert.deepEqual([check.result, check.reason], ['fail', 'absent-entry-left'])
  })

  test('fails when the library folder is not put back', async () => {
    const { check } = await run({ restoreIgnored: true, volumes: [] })
    assert.deepEqual([check.result, check.reason], ['fail', 'library-root-not-restored'])
  })

  test('an aborted run downloads nothing and adds nothing to the index', async () => {
    const stop = new AbortController()
    stop.abort()
    const { check, downloadHomes, rootsSeen } = await run({ signal: stop.signal })
    assert.deepEqual([check.result, check.reason], ['skip', 'aborted'])
    assert.deepEqual(downloadHomes, [])
    assert.deepEqual(rootsSeen, [])
  })

  test('volumes that cannot be read are an error, and nothing is changed', async () => {
    const { check, rootsSeen } = await run({ volumes: 'throws' })
    assert.deepEqual([check.result, check.reason], ['error', 'volumes-unreadable'])
    assert.deepEqual(rootsSeen, [])
  })
})

describe('earlier runs on the card', () => {
  test('a killed run’s folder is taken away, and nothing else on the card', async () => {
    mkdirSync(join(cardDir, '.galleon-selftest-abc123', 'snes'), { recursive: true })
    writeFileSync(join(cardDir, '.galleon-selftest-abc123', 'snes', 'game.sfc'), 'rom')
    mkdirSync(join(cardDir, 'galleon', 'roms'), { recursive: true })
    writeFileSync(join(cardDir, 'galleon-selftest-notes.txt'), 'the owner’s')
    await sweepScratch(cardDir)
    assert.deepEqual(readdirSync(cardDir).sort(), ['galleon', 'galleon-selftest-notes.txt'])
  })

  test('a card that cannot be listed is left alone', async () => {
    await sweepScratch(join(cardDir, 'not-there'))
  })
})
