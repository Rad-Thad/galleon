import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { type ScenarioContext, summaryErrors } from './selftest.ts'
import {
  STEAM_LAUNCH_CHECK,
  STEAM_LAUNCHED,
  STEAM_LIST_CHECK,
  STEAM_PROMPT,
  TARGET_ENDED,
  TARGET_STARTED,
  steamLaunchScenario,
  steamListScenario
} from './selfteststeam.ts'
import { binaryVdf, shortcut } from './fixtures/steam/binaryvdf.ts'

const HOME = '/home/deck'
const STEAM = '/home/deck/.local/share/Steam'

function manifest(appid: string, name: string, flags = '4'): string {
  return `"AppState" { "appid" "${appid}" "name" "${name}" "StateFlags" "${flags}" "installdir" "x" "SizeOnDisk" "1" }`
}

/** A Nova with two games, a tool, one partial install and three shortcuts. */
function nova(shortcutList: Uint8Array | null, extra: Record<string, string> = {}) {
  const text: Record<string, string> = {
    ...extra,
    [`${STEAM}/steamapps/appmanifest_1145360.acf`]: manifest('1145360', 'Hades'),
    [`${STEAM}/steamapps/appmanifest_413150.acf`]: manifest('413150', 'Stardew Valley'),
    [`${STEAM}/steamapps/appmanifest_1493710.acf`]: manifest('1493710', 'Proton Experimental'),
    [`${STEAM}/steamapps/appmanifest_105600.acf`]: manifest('105600', 'Terraria', '1026')
  }
  const folders: Record<string, string[]> = {
    [`${STEAM}/steamapps`]: Object.keys(text).map((p) => p.slice(p.lastIndexOf('/') + 1)),
    [`${STEAM}/userdata`]: ['1001'],
    [`${STEAM}/userdata/1001/config/grid`]: ['3000000001p.png', '3000000000p.png'],
    [`${STEAM}/appcache/librarycache`]: ['1145360'],
    [`${STEAM}/appcache/librarycache/1145360`]: ['library_600x900.jpg']
  }
  const enoent = (): never => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }
  return {
    home: HOME,
    readText: async (path: string) => text[path] ?? enoent(),
    readBytes: async (path: string) =>
      path === `${STEAM}/userdata/1001/config/shortcuts.vdf` && shortcutList
        ? shortcutList
        : enoent(),
    listDir: async (path: string) => folders[path] ?? enoent()
  }
}

const LIST = binaryVdf({
  shortcuts: {
    '0': shortcut(3000000000, 'Galleon Device Test'),
    '1': shortcut(3000000001, 'Owner Emulator'),
    '2': shortcut(3000000002, 'Owner Tool'),
    '3': shortcut(3000000003, 'Galleon Device Test Target')
  }
})

const context = {} as ScenarioContext

async function run(list: Uint8Array | null, extra: Record<string, string> = {}) {
  const answered = await steamListScenario(nova(list, extra))(context)
  assert.ok(!Array.isArray(answered))
  return answered
}

describe('steam.list', () => {
  test("passes with the harness's shortcut found, and publishes counts only", async () => {
    const check = await run(LIST)
    assert.equal(check.id, STEAM_LIST_CHECK)
    assert.equal(check.result, 'pass')
    assert.equal(check.reason, null)
    const { listMs, ...counts } = check.metrics
    assert.equal(typeof listMs, 'number')
    assert.deepEqual(counts, {
      steamGames: 2,
      steamGamesWithCover: 1,
      shortcuts: 2,
      shortcutsWithCover: 1,
      testShortcuts: 2,
      steamFilesUnreadable: 0,
      shortcutListsUnreadable: 0
    })
    const published = JSON.stringify(check)
    for (const secret of ['Hades', 'Stardew', 'Owner', '1145360', '3000000001', HOME]) {
      assert.ok(!published.includes(secret), `${secret} was published`)
    }
    assert.deepEqual(
      summaryErrors({
        schema: 1,
        sha: 'a'.repeat(40),
        version: '1.0.0',
        status: 'complete',
        reason: null,
        startedAt: '2026-10-27T00:00:00Z',
        finishedAt: '2026-10-27T00:00:00Z',
        device: {},
        power: {},
        safety: {
          serverWritesAttempted: 0,
          deviceIdOnSaveRequests: 0,
          ownerStateChanged: [],
          romsDownloadedBytes: 0,
          romsLeft: 0
        },
        checks: [check],
        notes: []
      }),
      []
    )
  })

  test("fails when the harness's shortcut is not among those read", async () => {
    const check = await run(binaryVdf({ shortcuts: { '0': shortcut(1, 'Owner Emulator') } }))
    assert.equal(check.result, 'fail')
    assert.equal(check.reason, 'test-shortcut-not-found')
    assert.equal(check.metrics.shortcuts, 1)
    assert.equal(check.metrics.testShortcuts, 0)
  })

  test('only the target shortcut is not the harness shortcut', async () => {
    const check = await run(
      binaryVdf({ shortcuts: { '0': shortcut(1, 'Galleon Device Test Target') } })
    )
    assert.equal(check.reason, 'test-shortcut-not-found')
    assert.equal(check.metrics.testShortcuts, 1)
  })

  test('fails when a shortcut list cannot be read, even with no shortcuts lost', async () => {
    const check = await run(LIST.subarray(0, LIST.length - 1))
    assert.equal(check.result, 'fail')
    assert.equal(check.reason, 'shortcuts-unreadable')
    assert.equal(check.metrics.shortcutListsUnreadable, 1)
  })

  test("fails when a game's manifest cannot be read, though the rest are listed", async () => {
    const check = await run(LIST, {
      [`${STEAM}/steamapps/appmanifest_620.acf`]: '"AppState" { "appid" "620"'
    })
    assert.equal(check.result, 'fail')
    assert.equal(check.reason, 'steam-files-unreadable')
    assert.equal(check.metrics.steamFilesUnreadable, 1)
    assert.equal(check.metrics.steamGames, 2)
  })

  test('fails when a library list cannot be read', async () => {
    const check = await run(LIST, {
      [`${STEAM}/steamapps/libraryfolders.vdf`]: '"libraryfolders" { "0" {'
    })
    assert.equal(check.reason, 'steam-files-unreadable')
  })

  test('no shortcut list at all fails on the missing harness shortcut', async () => {
    const check = await run(null)
    assert.equal(check.reason, 'test-shortcut-not-found')
    assert.equal(check.metrics.steamGames, 2)
  })
})

const GAMEID = '13835058055282163712'

interface Harness {
  /** Files already in the handshake folder before the check starts. */
  before?: Record<string, string>
  /** What Steam does when asked: the files the target and run.sh write. */
  onLaunch?: (dir: string) => void
  /** Files run.sh writes once it has read `steam-launched`. */
  answer?: Record<string, string>
  launch?: (gameid: string) => string[] | null
  steamTarget?: string | null
  handshake?: boolean
  signal?: AbortSignal
}

async function launchRun(harness: Harness = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'galleon-steam-launch-'))
  for (const [name, text] of Object.entries(harness.before ?? {})) {
    writeFileSync(join(dir, name), text)
  }
  const asked: string[] = []
  let launchedSaid: string | null = null
  const timer = setInterval(() => {
    try {
      launchedSaid ??= readFileSync(join(dir, STEAM_LAUNCHED), 'utf8')
    } catch {
      return
    }
    for (const [name, text] of Object.entries(harness.answer ?? {})) {
      writeFileSync(join(dir, name), text)
    }
  }, 5)
  try {
    const answered = await steamLaunchScenario({
      launch:
        harness.launch ??
        ((gameid) => {
          asked.push(gameid)
          harness.onLaunch?.(dir)
          return ['/usr/bin/steam', `steam://rungameid/${gameid}`]
        }),
      promptWaitMs: 300,
      targetEndMs: 300,
      pollMs: 5
    })({
      ...context,
      request: {
        steamTarget: harness.steamTarget === undefined ? GAMEID : harness.steamTarget,
        handshakeDir: harness.handshake === false ? null : dir
      } as ScenarioContext['request'],
      signal: harness.signal ?? new AbortController().signal
    })
    assert.ok(!Array.isArray(answered))
    assert.equal(answered.id, STEAM_LAUNCH_CHECK)
    return { check: answered, asked, launchedSaid, left: readdirSync(dir) }
  } finally {
    clearInterval(timer)
  }
}

const started = (dir: string): void => writeFileSync(join(dir, TARGET_STARTED), '')
const startedAndEnded = (dir: string): void => {
  started(dir)
  writeFileSync(join(dir, TARGET_ENDED), '')
}

describe('steam.launch', () => {
  test('passes when the target starts and no prompt shows, and survives its end', async () => {
    const outcome = await launchRun({
      onLaunch: startedAndEnded,
      answer: { [STEAM_PROMPT]: 'none\n' }
    })
    assert.deepEqual(outcome.asked, [GAMEID])
    assert.equal(outcome.launchedSaid, `${GAMEID}\n`)
    assert.equal(outcome.check.result, 'pass')
    assert.equal(outcome.check.reason, null)
    const { startMs, ...rest } = outcome.check.metrics
    assert.equal(typeof startMs, 'number')
    assert.deepEqual(rest, { started: 1, prompt: 'none', targetEnded: 1, galleonSurvived: 1 })
    assert.deepEqual(outcome.left, [], 'the handshake folder is left empty')
  })

  test('records a target that has not ended in time', async () => {
    const outcome = await launchRun({ onLaunch: started, answer: { [STEAM_PROMPT]: 'none' } })
    assert.equal(outcome.check.result, 'pass')
    assert.equal(outcome.check.metrics.targetEnded, 0)
  })

  test('a prompt shown and answered is an outcome, started or not', async () => {
    const outcome = await launchRun({ answer: { [STEAM_PROMPT]: 'shown' } })
    assert.equal(outcome.check.result, 'pass')
    assert.equal(outcome.check.metrics.prompt, 'shown')
    assert.equal(outcome.check.metrics.started, 0)
    assert.equal(outcome.check.metrics.startMs, null)
  })

  test('a target that starts after the answer still counts as started', async () => {
    const outcome = await launchRun({ answer: { [STEAM_PROMPT]: 'shown', [TARGET_STARTED]: '' } })
    assert.equal(outcome.check.metrics.started, 1)
  })

  test('a prompt left on screen is needs-attended', async () => {
    const outcome = await launchRun({ answer: { [STEAM_PROMPT]: 'left' } })
    assert.equal(outcome.check.result, 'skip')
    assert.equal(outcome.check.reason, 'needs-attended')
    assert.equal(outcome.check.metrics.prompt, 'left')
  })

  test('fails when nothing started and no prompt showed', async () => {
    const outcome = await launchRun({ answer: { [STEAM_PROMPT]: 'none' } })
    assert.equal(outcome.check.result, 'fail')
    assert.equal(outcome.check.reason, 'not-started')
  })

  test('fails without an answer from run.sh, or with one it cannot read', async () => {
    for (const answer of [{}, { [STEAM_PROMPT]: 'maybe' }] as Record<string, string>[]) {
      const outcome = await launchRun({ onLaunch: startedAndEnded, answer })
      assert.equal(outcome.check.result, 'fail')
      assert.equal(outcome.check.reason, 'no-prompt-answer')
      assert.equal(outcome.check.metrics.prompt, 'no-answer')
      assert.equal(outcome.check.metrics.started, 1)
      assert.deepEqual(outcome.left, [])
    }
  })

  test("an earlier run's marks are not read as this one's", async () => {
    const outcome = await launchRun({
      before: { [TARGET_STARTED]: '', [TARGET_ENDED]: '', [STEAM_PROMPT]: 'shown' },
      answer: { [STEAM_PROMPT]: 'none' }
    })
    assert.equal(outcome.check.result, 'fail')
    assert.equal(outcome.check.reason, 'not-started')
  })

  test('fails when Steam was never asked', async () => {
    const outcome = await launchRun({ launch: () => null, answer: { [STEAM_PROMPT]: 'none' } })
    assert.equal(outcome.check.reason, 'launch-refused')
    assert.equal(outcome.launchedSaid, null, 'run.sh is not told of a launch that did not happen')
  })

  test('skips without a target or a handshake folder, and asks Steam nothing', async () => {
    const none = await launchRun({ steamTarget: null })
    assert.equal(none.check.result, 'skip')
    assert.equal(none.check.reason, 'no-steam-target')
    assert.deepEqual(none.asked, [])
    const noHandshake = await launchRun({ handshake: false })
    assert.equal(noHandshake.check.reason, 'no-handshake')
    assert.deepEqual(noHandshake.asked, [])
  })

  test('a stopped run is skipped as aborted', async () => {
    const stop = new AbortController()
    const outcome = await launchRun({ onLaunch: () => stop.abort(), signal: stop.signal })
    assert.equal(outcome.check.result, 'skip')
    assert.equal(outcome.check.reason, 'aborted-by-user')
    assert.deepEqual(outcome.left, [])
  })
})
