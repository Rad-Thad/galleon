import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { binaryVdf, shortcut } from './fixtures/steam/binaryvdf.ts'
import type { CheckResult, ScenarioContext } from './selftest.ts'
import {
  ROUNDTRIP_DIR,
  SHORTCUT_ROUNDTRIP_CHECK,
  shortcutRoundtripScenario
} from './selftestshortcut.ts'
import { upsertShortcut } from './steam/addshortcut.ts'
import { type BinaryVdfField, findField, writeBinaryVdf } from './steam/binaryvdf.ts'

let owner: string
let work: string

beforeEach(() => {
  owner = mkdtempSync(join(tmpdir(), 'galleon-roundtrip-owner-'))
  work = mkdtempSync(join(tmpdir(), 'galleon-roundtrip-work-'))
})
afterEach(() => {
  rmSync(owner, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
})

function listPath(user: string): string {
  return join(owner, '.local', 'share', 'Steam', 'userdata', user, 'config', 'shortcuts.vdf')
}

function putList(user: string, bytes: Uint8Array): void {
  mkdirSync(join(listPath(user), '..'), { recursive: true })
  writeFileSync(listPath(user), bytes)
}

/** Lists as Steam writes them, with a colour and a uint64 beside the common types. */
const FIRST = () =>
  binaryVdf({
    shortcuts: {
      '0': shortcut(3000000000, 'RetroArch'),
      '1': {
        ...shortcut(5, 'Odd', 'appname'),
        colour: Uint8Array.from([0x10, 0x20, 0x30, 0xff]),
        big: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
      },
      '2': shortcut(77, 'Galleon Device Test')
    }
  })
const SECOND = () => binaryVdf({ shortcuts: { '0': shortcut(9, 'Émulateurs ★') } })

async function run(
  options: Partial<Parameters<typeof shortcutRoundtripScenario>[0]> = {},
  signal = new AbortController().signal
): Promise<CheckResult> {
  const result = await shortcutRoundtripScenario({ home: owner, work, ...options })({
    signal
  } as ScenarioContext)
  assert.ok(!Array.isArray(result))
  assert.equal(result.id, SHORTCUT_ROUNDTRIP_CHECK)
  return result
}

describe('steam.shortcut-roundtrip', () => {
  test("every user's list round-trips, takes an entry and its update; the originals are only read", async () => {
    putList('1001', FIRST())
    putList('2002', SECOND())
    mkdirSync(join(listPath('3003'), '..'), { recursive: true })
    const before = [listPath('1001'), listPath('2002')].map((path) => ({
      bytes: readFileSync(path),
      mtime: statSync(path).mtimeMs
    }))

    const result = await run()
    assert.equal(result.result, 'pass', JSON.stringify(result))
    assert.equal(result.reason, null)
    assert.equal(result.metrics.lists, 2)
    assert.equal(result.metrics.entries, 4)
    for (const [i, path] of [listPath('1001'), listPath('2002')].entries()) {
      assert.deepEqual(readFileSync(path), before[i].bytes)
      assert.equal(statSync(path).mtimeMs, before[i].mtime)
    }
    assert.ok(!existsSync(join(listPath('3003'))), 'a user without a list is given none')
    assert.ok(!existsSync(join(work, ROUNDTRIP_DIR)), 'the copies are removed')
    const published = JSON.stringify(result)
    for (const secret of ['1001', '2002', 'RetroArch', owner]) {
      assert.ok(!published.includes(secret), `${secret} was published`)
    }
  })

  test('with no shortcut list at all it is a skip', async () => {
    const result = await run()
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'no-shortcut-list')
  })

  test('a list that could not be written back exactly fails, and is left as it was', async () => {
    const cut = FIRST().slice(0, 40)
    putList('1001', cut)
    putList('2002', SECOND())
    const result = await run()
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'not-exact')
    assert.equal(result.metrics.notExact, 1)
    assert.equal(result.metrics.lists, 2)
    assert.deepEqual(new Uint8Array(readFileSync(listPath('1001'))), cut)
  })

  test('a writer that changes a byte fails not-byte-for-byte', async () => {
    putList('1001', FIRST())
    const result = await run({
      write: (fields) => {
        const bytes = writeBinaryVdf(fields)
        bytes[bytes.length - 2] ^= 1
        return bytes
      }
    })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'not-byte-for-byte')
  })

  test('a list without a shortcuts map fails add-failed', async () => {
    putList('1001', binaryVdf({ other: { a: 'b' } }))
    const result = await run()
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'add-failed')
  })

  test("an add that touches the owner's entries fails others-changed", async () => {
    putList('1001', FIRST())
    const result = await run({
      upsert: (fields, entry) => {
        const list = findField(fields, 'shortcuts') as { fields: { fields: BinaryVdfField[] }[] }
        const name = findField(list.fields[0].fields, 'AppName') as { value: string }
        name.value = 'Renamed'
        return upsertShortcut(fields, entry)
      }
    })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'others-changed')
    assert.equal(result.metrics.othersChanged, 1)
  })

  test('an add that drops an entry fails others-changed', async () => {
    putList('1001', FIRST())
    const result = await run({
      upsert: (fields, entry) => {
        const list = findField(fields, 'shortcuts') as { fields: BinaryVdfField[] }
        list.fields.shift()
        return upsertShortcut(fields, entry)
      }
    })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'others-changed')
  })

  test('an update that adds a second entry fails duplicated', async () => {
    putList('1001', FIRST())
    const result = await run({
      upsert: (fields, entry) =>
        upsertShortcut(fields, { ...entry, exe: `${entry.exe}${Math.random()}` })
    })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'duplicated')
  })

  test('an update that leaves the entry as it was fails not-updated', async () => {
    putList('1001', FIRST())
    let calls = 0
    const result = await run({
      upsert: (fields, entry) => {
        calls++
        return upsertShortcut(fields, calls === 1 ? entry : { ...entry, launchOptions: '' })
      }
    })
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'not-updated')
  })

  test('a stopped run is a skip and still removes the copies', async () => {
    putList('1001', FIRST())
    const stop = new AbortController()
    stop.abort()
    const result = await run({}, stop.signal)
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'aborted-by-user')
    assert.ok(!existsSync(join(work, ROUNDTRIP_DIR)))
  })
})
