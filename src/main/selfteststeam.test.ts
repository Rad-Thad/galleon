import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { type ScenarioContext, summaryErrors } from './selftest.ts'
import { STEAM_LIST_CHECK, steamListScenario } from './selfteststeam.ts'
import { binaryVdf, shortcut } from './fixtures/steam/binaryvdf.ts'

const HOME = '/home/deck'
const STEAM = '/home/deck/.local/share/Steam'

function manifest(appid: string, name: string, flags = '4'): string {
  return `"AppState" { "appid" "${appid}" "name" "${name}" "StateFlags" "${flags}" "installdir" "x" "SizeOnDisk" "1" }`
}

/** A Nova with two games, a tool, one partial install and three shortcuts. */
function nova(shortcutList: Uint8Array | null) {
  const text: Record<string, string> = {
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

async function run(list: Uint8Array | null) {
  const answered = await steamListScenario(nova(list))(context)
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

  test('no shortcut list at all fails on the missing harness shortcut', async () => {
    const check = await run(null)
    assert.equal(check.reason, 'test-shortcut-not-found')
    assert.equal(check.metrics.steamGames, 2)
  })
})
