import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import type { DownloadItem, PendingDownload, RommRom } from '@shared/types'
import {
  CAP_BYTES,
  MIN_GAME_BYTES,
  PROGRESS_CHECK,
  PROGRESS_FAILED,
  STOP_BYTES,
  lineHasSpeed,
  offByPct,
  partPaths,
  progressScenario,
  smallestLargeGame,
  type ProgressDeps
} from './selftestprogress.ts'
import type { CheckResult, Safety } from './selftest.ts'

/**
 * `download.progress` on the device: a large game through the real queue,
 * its shown speed and time left held to the rate the bytes arrive at, then X
 * on its row and the `.part` file gone. The fakes stand in for the queue, the
 * store, the page and the clock, so the scenario's seconds run at once; what
 * is under test is the choosing, the judging, the cap and that nothing is left
 * behind whatever happens.
 */

const MB = 1024 * 1024

function rom(id: number, size: number): RommRom {
  return { id, fs_name: `game-${id}.iso`, fs_size_bytes: size, platform_slug: 'ps2' } as RommRom
}

const PLATFORMS = [
  { id: 1, slug: 'ps2', fs_slug: 'ps2' },
  { id: 2, slug: 'gc', fs_slug: 'gc' }
]

function fakeClient(byPlatform: Record<number, RommRom[]>) {
  let listed = 0
  return {
    get listed() {
      return listed
    },
    platforms: async () => PLATFORMS as never,
    roms: async ({ platform_ids = [] as number[], limit = 60, offset = 0 }) => {
      listed += 1
      const items = (byPlatform[platform_ids[0]] ?? []).slice(offset, offset + limit)
      return { items, total: null, limit, offset }
    }
  }
}

interface World {
  /** Bytes per second the fake network delivers. */
  rate: number
  /** What the row's speed is shown as, against the real rate. */
  shownFactor: number
  /** Whether X on the row reaches the queue. */
  xAnswered: boolean
  /** Whether cancelling takes the `.part` file away. */
  removesPart: boolean
  /** The line the row shows. */
  line: string | null
}

const BASE: World = {
  rate: 20 * MB,
  shownFactor: 1,
  xAnswered: true,
  removesPart: true,
  line: '1% - 60.0 MB / 3.8 GB - 20.0 MB/s - 3m 10s left'
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galleon-progress-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function harness(game: RommRom | null, world: Partial<World> = {}) {
  const w = { ...BASE, ...world }
  let now = 0
  const items: DownloadItem[] = []
  const pending: PendingDownload[] = []
  const cancels: number[] = []
  const xPresses: number[] = []
  const target = join(dir, 'game.iso')
  const tick = (ms: number): void => {
    now += ms
    for (const item of items) {
      if (item.state !== 'downloading') continue
      item.receivedBytes = Math.min(item.totalBytes, item.receivedBytes + (w.rate * ms) / 1000)
      const speed = w.rate * w.shownFactor
      item.rate = {
        speed,
        secondsLeft: Math.round((item.totalBytes - item.receivedBytes) / speed),
        stalled: false
      } as DownloadItem['rate']
    }
  }
  const cancel = async (romId: number): Promise<void> => {
    cancels.push(romId)
    const item = items.find((one) => one.romId === romId)
    if (!item || item.state !== 'downloading') return
    item.state = 'cancelled'
    delete item.rate
    if (w.removesPart) rmSync(`${target}.part`, { force: true })
  }
  const deps: ProgressDeps = {
    client: fakeClient(
      game ? { 1: [rom(9, 100 * MB)], 2: [game, rom(8, game.fs_size_bytes + 1)] } : {}
    ),
    downloads: {
      enqueue: async (one) => {
        const item = {
          romId: one.id,
          state: 'downloading',
          receivedBytes: 0,
          totalBytes: one.fs_size_bytes
        } as DownloadItem
        items.push(item)
        pending.push({ romId: one.id, targetPath: target, files: [] } as unknown as PendingDownload)
        writeFileSync(`${target}.part`, 'some bytes')
        return item
      },
      cancel,
      whenIdle: async () => undefined,
      get items() {
        return items
      }
    },
    library: { uninstall: async () => undefined },
    store: { getInstalled: () => undefined, pending },
    page: {
      focusRow: async () => null,
      line: async () => w.line,
      pressX: async (romId) => {
        xPresses.push(romId)
        if (w.xAnswered) await cancel(romId)
        return null
      }
    },
    clock: {
      now: () => now,
      sleep: async (ms) => tick(ms)
    }
  }
  return {
    deps,
    items,
    cancels,
    xPresses,
    target,
    client: deps.client as ReturnType<typeof fakeClient>
  }
}

const safety = (): Safety => ({
  serverWritesAttempted: 0,
  deviceIdOnSaveRequests: 0,
  ownerStateChanged: [],
  romsDownloadedBytes: 0,
  romsLeft: 0
})

async function run(
  h: ReturnType<typeof harness>,
  signal = new AbortController().signal
): Promise<{ check: CheckResult; safety: Safety }> {
  const counted = safety()
  const answered = await progressScenario(h.deps)({ request: {} as never, safety: counted, signal })
  const check = Array.isArray(answered) ? answered[0] : answered
  assert.equal(check.id, PROGRESS_CHECK)
  return { check, safety: counted }
}

describe('download.progress', () => {
  test('a steady transfer shows its speed and time left, and X takes it and its .part away', async () => {
    const h = harness(rom(7, 3800 * MB))
    const { check, safety: counted } = await run(h)
    assert.equal(check.result, 'pass', JSON.stringify(check))
    assert.deepEqual(h.xPresses, [7])
    assert.equal(h.items[0].state, 'cancelled')
    assert.ok(!existsSync(`${h.target}.part`))
    assert.equal(check.metrics.speedOffPct, 0)
    assert.ok(Number(check.metrics.timeLeftOffPct) <= 1, JSON.stringify(check.metrics))
    assert.ok(
      Number(check.metrics.receivedBytes) > 0 && Number(check.metrics.receivedBytes) < CAP_BYTES
    )
    assert.equal(counted.romsDownloadedBytes, check.metrics.receivedBytes)
    assert.equal(counted.romsLeft, 0)
  })

  test('the smallest game of at least 500 MB is the one fetched', async () => {
    const h = harness(rom(7, MIN_GAME_BYTES))
    await run(h)
    assert.deepEqual(h.xPresses, [7])
  })

  test('a speed shown too far from the measured rate fails, and the transfer is still called off', async () => {
    const h = harness(rom(7, 3800 * MB), { shownFactor: 1.3 })
    const { check } = await run(h)
    assert.equal(check.result, 'fail')
    assert.equal(check.reason, PROGRESS_FAILED.speed)
    assert.equal(check.metrics.speedOffPct, 30)
    assert.deepEqual(h.xPresses, [])
    assert.deepEqual(h.cancels, [7])
    assert.ok(!existsSync(`${h.target}.part`))
  })

  test('within the tolerance passes', async () => {
    const h = harness(rom(7, 3800 * MB), { shownFactor: 0.85 })
    const { check } = await run(h)
    assert.equal(check.result, 'pass', JSON.stringify(check))
  })

  test('a row whose line has no speed fails', async () => {
    const h = harness(rom(7, 3800 * MB), { line: '1% - 60.0 MB / 3.8 GB - stalled' })
    const { check } = await run(h)
    assert.equal(check.reason, PROGRESS_FAILED.line)
  })

  test('a network fast enough to reach the cap before the readings fails, under the cap', async () => {
    const h = harness(rom(7, 3800 * MB), { rate: 200 * MB })
    const { check, safety: counted } = await run(h)
    assert.equal(check.result, 'fail')
    assert.equal(check.reason, PROGRESS_FAILED.cap)
    assert.ok(Number(check.metrics.receivedBytes) >= STOP_BYTES)
    assert.ok(Number(check.metrics.receivedBytes) <= CAP_BYTES, String(check.metrics.receivedBytes))
    assert.ok(counted.romsDownloadedBytes <= CAP_BYTES)
    assert.equal(h.items[0].state, 'cancelled')
  })

  test('X that is not answered fails, and the transfer is called off anyway', async () => {
    const h = harness(rom(7, 3800 * MB), { xAnswered: false })
    const { check } = await run(h)
    assert.equal(check.reason, PROGRESS_FAILED.notCancelled)
    assert.equal(h.items[0].state, 'cancelled')
  })

  test('a .part file left after the cancel fails and is counted as left behind', async () => {
    const h = harness(rom(7, 3800 * MB), { removesPart: false })
    const { check, safety: counted } = await run(h)
    assert.equal(check.reason, PROGRESS_FAILED.partLeft)
    assert.equal(counted.romsLeft, 1)
  })

  test('no game of 500 MB or more is a skip and nothing is fetched', async () => {
    const h = harness(null)
    const { check } = await run(h)
    assert.equal(check.result, 'skip')
    assert.equal(check.reason, PROGRESS_FAILED.noGame)
    assert.equal(h.items.length, 0)
  })

  test('a game already installed is a skip and nothing is fetched', async () => {
    const h = harness(rom(7, 3800 * MB))
    h.deps.store.getInstalled = () => ({})
    const { check } = await run(h)
    assert.equal(check.reason, PROGRESS_FAILED.installed)
    assert.equal(h.items.length, 0)
  })

  test('a run stopped on input skips and calls the transfer off', async () => {
    const h = harness(rom(7, 3800 * MB))
    const stop = new AbortController()
    const sleep = h.deps.clock!.sleep
    h.deps.clock!.sleep = async (ms) => {
      await sleep(ms)
      if (h.deps.clock!.now() > 1000) stop.abort()
    }
    const { check } = await run(h, stop.signal)
    assert.equal(check.result, 'skip')
    assert.equal(check.reason, PROGRESS_FAILED.aborted)
    assert.equal(h.items[0].state, 'cancelled')
    assert.ok(!existsSync(`${h.target}.part`))
  })

  test('a row the highlight cannot reach fails before X', async () => {
    const h = harness(rom(7, 3800 * MB))
    h.deps.page.focusRow = async () => 'no-row'
    const { check } = await run(h)
    assert.equal(check.reason, `${PROGRESS_FAILED.notFocused}:no-row`)
    assert.deepEqual(h.xPresses, [])
    assert.equal(h.items[0].state, 'cancelled')
  })
})

describe('the pieces', () => {
  test('smallestLargeGame looks at every platform and ignores what is under 500 MB', async () => {
    const client = fakeClient({
      1: [rom(1, MIN_GAME_BYTES - 1), rom(2, 900 * MB)],
      2: [rom(3, 700 * MB)]
    })
    assert.equal((await smallestLargeGame(client))?.id, 3)
    assert.equal(await smallestLargeGame(fakeClient({ 1: [rom(1, 10 * MB)] })), null)
  })

  test('lineHasSpeed wants a rate and a time left after the figures', () => {
    assert.ok(lineHasSpeed('15% - 613.6 MB / 3.8 GB - 41.4 MB/s - 1m 20s left'))
    assert.ok(!lineHasSpeed('15% - 613.6 MB / 3.8 GB - stalled'))
    assert.ok(!lineHasSpeed('0% - 0 B / 3.8 GB - waiting for server'))
    assert.ok(!lineHasSpeed(null))
  })

  test('partPaths names the .part of a whole file or of each file of a set', () => {
    assert.deepEqual(partPaths({ targetPath: '/a/game.iso', files: [] }), ['/a/game.iso.part'])
    assert.deepEqual(partPaths({ targetPath: '/a/Game', files: ['d1/t.bin', 'g.cue'] }), [
      '/a/Game/d1/t.bin.part',
      '/a/Game/g.cue.part'
    ])
  })

  test('offByPct is relative to the measured value', () => {
    assert.equal(offByPct(120, 100), 20)
    assert.equal(offByPct(80, 100), 20)
  })
})
