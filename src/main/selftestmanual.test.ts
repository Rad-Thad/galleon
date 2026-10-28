import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import type { RommPlatform, RommRom, RommRomPage, RomQuery } from '@shared/types'
import type { CheckResult, Safety, SelfTestRequest } from './selftest.ts'
import {
  MANUAL_CHECK,
  MANUAL_SHOT,
  MAX_DOMINANT,
  MIN_TONES,
  type FrameCapture,
  gameWithManual,
  judgeFrame,
  manualScenario,
  openProbe
} from './selftestmanual.ts'

/**
 * `manual.open` against a fake library and a fake page. The page half (the
 * Library, the tab, the viewer's frame) is driven by test:app against a real
 * PDF; here the frame is a bitmap made to look drawn or empty.
 */

const dirs: string[] = []
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const MOSAIC = Buffer.from('mosaic')

/** A frame of one flat colour, as a viewer that drew nothing leaves it. */
function flat(width = 40, height = 30): FrameCapture {
  return { bitmap: Buffer.alloc(width * height * 4, 0x52), width, height, mosaic: MOSAIC }
}

/** A frame with a page in it: a background, a white sheet and graded print. */
function page(width = 40, height = 30): FrameCapture {
  const bitmap = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const sheet = x >= 10 && x < 30
      const tone = sheet ? (y === 15 ? (x * 12) & 0xff : 0xff) : 0x52
      bitmap.fill(tone, at, at + 3)
      bitmap[at + 3] = 0xff
    }
  }
  return { bitmap, width, height, mosaic: MOSAIC }
}

function rom(id: number, platformId: number, manual: boolean): RommRom {
  return {
    id,
    platform_id: platformId,
    platform_slug: `p${platformId}`,
    name: `Game ${id}`,
    fs_name: `game-${id}.zip`,
    has_manual: manual,
    path_manual: manual ? `roms/${platformId}/${id}/manual/${id}.pdf` : null
  } as unknown as RommRom
}

function library(byPlatform: Record<number, RommRom[]>, fail = false) {
  const asked: RomQuery[] = []
  return {
    asked,
    client: {
      platforms: async (): Promise<RommPlatform[]> => {
        if (fail) throw new Error('unreachable')
        return Object.keys(byPlatform).map((id) => ({ id: Number(id) }) as RommPlatform)
      },
      roms: async (query: RomQuery): Promise<RommRomPage> => {
        asked.push(query)
        const all = byPlatform[query.platform_ids![0]] ?? []
        const offset = query.offset ?? 0
        const items = all.slice(offset, offset + (query.limit ?? all.length))
        return { items, total: all.length, limit: query.limit ?? 0, offset } as RommRomPage
      }
    }
  }
}

interface Fake {
  results: string
  opened: RommRom[]
  closed: number
  captures: number
  looks: number
}

async function run(
  options: {
    games?: Record<number, RommRom[]>
    listingFails?: boolean
    opens?: string | null
    frames?: (FrameCapture | null)[]
    /** What the viewer says on each look; the last one stands. */
    states?: (string | null)[]
    signal?: AbortSignal
  } = {}
): Promise<{ out: CheckResult; f: Fake }> {
  const results = mkdtempSync(join(tmpdir(), 'galleon-manual-'))
  dirs.push(results)
  const f: Fake = { results, opened: [], closed: 0, captures: 0, looks: 0 }
  const states = options.states ?? ['success']
  const frames = options.frames ?? [page()]
  let clock = 0
  const { client } = library(options.games ?? { 1: [rom(7, 1, true)] }, options.listingFails)
  const out = await manualScenario({
    client,
    page: {
      open: async (game) => {
        f.opened.push(game)
        return options.opens ?? null
      },
      state: async () => states[Math.min(f.looks++, states.length - 1)],
      capture: async () => frames[Math.min(f.captures++, frames.length - 1)],
      close: async () => {
        f.closed++
      }
    },
    resultsDir: results,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    drawWaitMs: 2_000
  })({
    request: {} as SelfTestRequest,
    safety: {} as Safety,
    signal: options.signal ?? new AbortController().signal
  })
  assert.ok(!Array.isArray(out))
  assert.equal(out.id, MANUAL_CHECK)
  return { out, f }
}

describe('judgeFrame', () => {
  test('a flat frame is one tone filling it', () => {
    assert.deepEqual(judgeFrame(flat()), { tones: 1, dominant: 1 })
  })

  test('a page has many tones and no one colour filling the frame', () => {
    const look = judgeFrame(page())
    assert.ok(look.tones >= MIN_TONES, `${look.tones} tones`)
    assert.ok(look.dominant <= MAX_DOMINANT, `${look.dominant} dominant`)
  })

  test('a bitmap shorter than its size says nothing was drawn', () => {
    assert.deepEqual(judgeFrame({ bitmap: Buffer.alloc(4), width: 2, height: 2 }), {
      tones: 0,
      dominant: 1
    })
  })
})

describe('gameWithManual', () => {
  test('the first game holding a manual, listed one row per game as the Library does', async () => {
    const lib = library({ 1: [rom(1, 1, false)], 2: [rom(2, 2, false), rom(3, 2, true)] })
    assert.equal((await gameWithManual(lib.client))?.id, 3)
    assert.ok(lib.asked.every((q) => q.group_by_meta_id === true))
  })

  test('pages through a platform and stops at the first one found', async () => {
    const many = Array.from({ length: 300 }, (_, i) => rom(i + 1, 1, i === 260))
    const lib = library({ 1: many, 2: [rom(999, 2, true)] })
    assert.equal((await gameWithManual(lib.client))?.id, 261)
    assert.deepEqual(
      lib.asked.map((q) => [q.platform_ids, q.offset]),
      [
        [[1], 0],
        [[1], 250]
      ]
    )
  })

  test('a library without a manual is null', async () => {
    assert.equal(await gameWithManual(library({ 1: [rom(1, 1, false)] }).client), null)
  })
})

describe('manual.open', () => {
  test('the first page drawn passes, with only the mosaic kept', async () => {
    const { out, f } = await run({ frames: [flat(), flat(), page()] })
    assert.equal(out.result, 'pass', String(out.reason))
    assert.equal(f.opened[0].id, 7)
    assert.equal(out.metrics.platform, 'p1')
    assert.equal(out.metrics.drawnMs, 1_000)
    assert.deepEqual(out.evidence, [MANUAL_SHOT])
    assert.deepEqual(readFileSync(join(f.results, MANUAL_SHOT)), MOSAIC)
    assert.equal(f.closed, 1)
  })

  test('a frame that stays empty fails not-drawn, its mosaic kept to look at', async () => {
    const { out, f } = await run({ frames: [flat()] })
    assert.equal(out.result, 'fail')
    assert.equal(out.reason, 'not-drawn')
    assert.equal(out.metrics.tones, 1)
    assert.equal(out.metrics.dominant, 1)
    assert.deepEqual(out.evidence, [MANUAL_SHOT])
    assert.equal(f.closed, 1)
  })

  test('nothing is captured until the viewer has the document', async () => {
    const { out, f } = await run({ states: [null, 'loading', 'success'], frames: [page()] })
    assert.equal(out.result, 'pass', String(out.reason))
    assert.equal(f.captures, 1)
    assert.equal(out.metrics.viewer, 'success')
    assert.equal(out.metrics.drawnMs, 1_000)
  })

  test('a viewer that never has the document fails not-loaded, with nothing captured', async () => {
    const { out, f } = await run({ states: ['loading'] })
    assert.equal(out.result, 'fail')
    assert.equal(out.reason, 'not-loaded')
    assert.equal(out.metrics.viewer, 'loading')
    assert.equal(f.captures, 0)
    assert.ok(!existsSync(join(f.results, MANUAL_SHOT)))
    assert.equal(f.closed, 1)
  })

  test('no viewer to read fails not-loaded too', async () => {
    const { out } = await run({ states: [null] })
    assert.equal(out.reason, 'not-loaded')
    assert.equal(out.metrics.viewer, 'unread')
  })

  test('a viewer that could not open the document fails at once', async () => {
    const { out, f } = await run({ states: ['loading', 'failed'] })
    assert.equal(out.reason, 'viewer-failed')
    assert.equal(f.looks, 2)
  })

  test('a frame never captured fails not-captured', async () => {
    const { out, f } = await run({ frames: [null] })
    assert.equal(out.reason, 'not-captured')
    assert.ok(!existsSync(join(f.results, MANUAL_SHOT)))
  })

  test('a manual the page could not reach fails where it stopped', async () => {
    const { out, f } = await run({ opens: 'no-tile' })
    assert.equal(out.result, 'fail')
    assert.equal(out.reason, 'not-opened:no-tile')
    assert.equal(f.captures, 0)
    assert.equal(f.closed, 1)
  })

  test('no manual in the library is a skip, and the page is not touched', async () => {
    const { out, f } = await run({ games: { 1: [rom(1, 1, false)] } })
    assert.equal(out.result, 'skip')
    assert.equal(out.reason, 'no-manual')
    assert.equal(f.opened.length, 0)
    assert.equal(f.closed, 0)
  })

  test('a listing that fails is an error', async () => {
    const { out } = await run({ listingFails: true })
    assert.equal(out.result, 'error')
    assert.equal(out.reason, 'listing-failed')
  })

  test('a run already stopped opens nothing', async () => {
    const stop = new AbortController()
    stop.abort()
    const { out, f } = await run({ signal: stop.signal })
    assert.equal(out.result, 'skip')
    assert.equal(f.opened.length, 0)
  })

  test('nothing names the game: no title, no file name, no id', async () => {
    const { out } = await run()
    const published = JSON.stringify(out)
    for (const leak of ['Game 7', 'game-7', 'manual/7', '"7"']) {
      assert.ok(!published.includes(leak), `${leak} in ${published}`)
    }
  })
})

describe('openProbe', () => {
  test('the search term goes in as a string literal, whatever it holds', () => {
    const probe = openProbe({ id: 7, platform_id: 1 }, `"); alert(1); ("`, 1_000)
    assert.ok(probe.includes(JSON.stringify(`"); alert(1); ("`)))
    assert.ok(probe.includes('[data-rom="7"]'))
    assert.ok(probe.includes('[data-platform="1"]'))
  })
})
