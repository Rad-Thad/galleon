import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  SYNTHETIC_GAMES,
  SYNTHETIC_PLATFORM_ID,
  isSyntheticRom,
  syntheticPage,
  syntheticPlatform,
  syntheticRom
} from './selftestlibrary.ts'

/** The synthetic platform `grid.scroll` falls back to. */

const only = { platform_ids: [SYNTHETIC_PLATFORM_ID] }

describe('syntheticPlatform', () => {
  test('a platform of 1,000+ games with an id RomM never gives', () => {
    const platform = syntheticPlatform()
    assert.equal(platform.id, SYNTHETIC_PLATFORM_ID)
    assert.ok(platform.id < 0)
    assert.equal(platform.rom_count, SYNTHETIC_GAMES)
    assert.ok(SYNTHETIC_GAMES >= 1000)
  })
})

describe('syntheticPage', () => {
  test('pages through every game once, in name order', () => {
    const seen: number[] = []
    for (let offset = 0; ; offset += 100) {
      const page = syntheticPage({ ...only, limit: 100, offset })
      assert.ok(page)
      assert.equal(page.total, SYNTHETIC_GAMES)
      seen.push(...page.items.map((rom) => rom.id))
      if (page.items.length < 100) break
    }
    assert.equal(seen.length, SYNTHETIC_GAMES)
    assert.equal(new Set(seen).size, SYNTHETIC_GAMES)
    const first = syntheticPage({ ...only, limit: 3 })?.items.map((rom) => rom.name)
    assert.deepEqual(first, ['Self-test 0001', 'Self-test 0002', 'Self-test 0003'])
  })

  test('every game is on the synthetic platform, with a negative id and no artwork', () => {
    const page = syntheticPage({ ...only, limit: SYNTHETIC_GAMES })
    assert.ok(page)
    for (const rom of page.items) {
      assert.ok(rom.id < 0)
      assert.ok(isSyntheticRom(rom.id))
      assert.equal(rom.platform_id, SYNTHETIC_PLATFORM_ID)
      assert.equal(rom.path_cover_small, null)
      assert.equal(rom.url_cover, null)
    }
  })

  test('descending order and a search narrow it as the server would', () => {
    assert.equal(
      syntheticPage({ ...only, order_dir: 'desc', limit: 1 })?.items[0].name,
      `Self-test ${SYNTHETIC_GAMES}`
    )
    const found = syntheticPage({ ...only, search_term: ' 0042 ' })
    assert.equal(found?.total, 1)
    assert.equal(found?.items[0].name, 'Self-test 0042')
  })

  test('a shelf or favourites hold none of its games', () => {
    assert.equal(syntheticPage({ ...only, collection_id: 3 })?.total, 0)
    assert.equal(syntheticPage({ ...only, favorite: true })?.total, 0)
    assert.equal(syntheticPage({ ...only, last_played: true })?.total, 0)
    assert.equal(syntheticPage({ ...only, virtual_collection_id: 'x' })?.total, 0)
  })

  test("any other query is the server's", () => {
    assert.equal(syntheticPage({}), null)
    assert.equal(syntheticPage({ platform_ids: [4] }), null)
    assert.equal(syntheticPage({ platform_ids: [SYNTHETIC_PLATFORM_ID, 4] }), null)
  })
})

describe('syntheticRom', () => {
  test('the same game a page lists, and null for any other id', () => {
    const listed = syntheticPage({ ...only, limit: 1, offset: 7 })?.items[0]
    assert.ok(listed)
    assert.deepEqual(syntheticRom(listed.id), listed)
    assert.equal(syntheticRom(7), null)
    assert.equal(syntheticRom(SYNTHETIC_PLATFORM_ID), null)
    const last = syntheticPage({ ...only, order_dir: 'desc', limit: 1 })?.items[0]
    assert.ok(last && syntheticRom(last.id))
    assert.equal(syntheticRom(last.id - 1), null)
  })
})
