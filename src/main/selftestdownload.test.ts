import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import type { DownloadItem, InstalledRom, RommRom } from '@shared/types'
import {
  DOWNLOAD_CHECK,
  downloadScenario,
  SMALL_GAME_MAX_BYTES,
  smallestGame
} from './selftestdownload.ts'
import type { CheckResult, Safety } from './selftest.ts'

/**
 * `download.small` on the device: one game from the owner's server, through
 * the real queue, into the test home, verified and removed. The fakes stand in
 * for the queue and the store; what is under test is the choosing, the
 * verdict and that nothing is left behind whatever happens.
 */

const BYTES = Buffer.from('a very small homebrew rom')
const MD5 = createHash('md5').update(BYTES).digest('hex')

function rom(id: number, size: number, extra: Partial<RommRom> = {}): RommRom {
  return {
    id,
    fs_name: `game-${id}.sfc`,
    fs_size_bytes: size,
    platform_slug: 'snes',
    md5_hash: MD5,
    sha1_hash: null,
    has_multiple_files: false,
    files: [],
    ...extra
  } as unknown as RommRom
}

const PLATFORMS = [
  { id: 1, slug: 'snes', fs_slug: 'snes' },
  { id: 2, slug: 'gba', fs_slug: 'gba' },
  { id: 3, slug: 'ps2', fs_slug: 'ps2' }
]

function fakeClient(byPlatform: Record<number, RommRom[]>) {
  const asked: number[] = []
  return {
    asked,
    platforms: async () => PLATFORMS as never,
    roms: async ({ platform_ids = [], limit = 60, offset = 0 }) => {
      asked.push(platform_ids[0])
      const items = (byPlatform[platform_ids[0]] ?? []).slice(offset, offset + limit)
      return { items, total: null, limit, offset }
    }
  }
}

type Behaviour = 'ok' | 'corrupt' | 'error' | 'silent' | 'outside' | 'undeletable' | 'hang'

class FakeQueue extends EventEmitter {
  items: DownloadItem[] = []
  cancelled: number[] = []
  private stop: (() => void) | null = null
  constructor(
    private readonly store: Map<number, InstalledRom>,
    private readonly dir: string,
    private readonly behaviour: Behaviour
  ) {
    super()
  }
  async enqueue(game: RommRom): Promise<DownloadItem> {
    const item = { romId: game.id, state: 'downloading', receivedBytes: 0 } as DownloadItem
    this.items = [item]
    // As the real queue does: the transfer is announced before a byte arrives.
    this.emit('update', this.items)
    if (this.behaviour === 'hang') return item
    if (this.behaviour === 'error') {
      item.state = 'error'
      return item
    }
    if (this.behaviour !== 'silent') {
      item.receivedBytes = BYTES.length
      this.emit('update', this.items)
    }
    const path = join(this.dir, game.fs_name)
    writeFileSync(path, this.behaviour === 'corrupt' ? Buffer.from('other bytes') : BYTES)
    this.store.set(game.id, { romId: game.id, path, isDirectory: false } as InstalledRom)
    item.state = 'done'
    this.emit('update', this.items)
    return item
  }
  async whenIdle(): Promise<void> {
    if (this.behaviour === 'hang') await new Promise<void>((resolve) => (this.stop = resolve))
  }
  async cancel(romId: number): Promise<void> {
    this.cancelled.push(romId)
    const [item] = this.items
    if (item && item.state === 'downloading') item.state = 'cancelled'
    this.stop?.()
  }
}

let home: string
let outside: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'galleon-selftest-home-'))
  outside = mkdtempSync(join(tmpdir(), 'galleon-selftest-elsewhere-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

function safety(): Safety {
  return {
    serverWritesAttempted: 0,
    deviceIdOnSaveRequests: 0,
    ownerStateChanged: [],
    romsDownloadedBytes: 0,
    romsLeft: 0
  }
}

async function run(
  behaviour: Behaviour,
  games: Record<number, RommRom[]> = { 1: [rom(10, 4096), rom(11, 512)], 2: [rom(20, 2048)] },
  options: { installed?: number[]; signal?: AbortSignal } = {}
) {
  const store = new Map<number, InstalledRom>()
  for (const id of options.installed ?? []) {
    store.set(id, { romId: id, path: join(home, 'kept'), isDirectory: false } as InstalledRom)
  }
  const queue = new FakeQueue(store, behaviour === 'outside' ? outside : home, behaviour)
  const uninstalled: number[] = []
  const library = {
    uninstall: async (romId: number) => {
      uninstalled.push(romId)
      if (behaviour === 'undeletable') return
      const entry = store.get(romId)
      if (entry) rmSync(entry.path, { force: true })
      store.delete(romId)
    }
  }
  const sums = safety()
  const answered = await downloadScenario({
    client: fakeClient(games),
    downloads: queue,
    library,
    store: { getInstalled: (id) => store.get(id) },
    home
  })({ request: {} as never, safety: sums, signal: options.signal ?? new AbortController().signal })
  assert.ok(!Array.isArray(answered))
  return { result: answered as CheckResult, queue, store, uninstalled, sums }
}

describe('download.small', () => {
  test('the smallest hashed SNES or GBA game is fetched, verified and removed', async () => {
    const { result, store, uninstalled, sums } = await run('ok')
    assert.equal(result.id, DOWNLOAD_CHECK)
    assert.equal(result.result, 'pass', String(result.reason))
    assert.deepEqual(uninstalled, [11])
    assert.equal(store.size, 0)
    assert.equal(existsSync(join(home, 'game-11.sfc')), false)
    assert.equal(result.metrics.bytes, 512)
    assert.equal(result.metrics.hashAlgorithm, 'md5')
    assert.equal(result.metrics.progressEvents, 1)
    assert.equal(sums.romsDownloadedBytes, BYTES.length)
    assert.equal(sums.romsLeft, 0)
  })

  test('a game without a digest is never the one chosen', async () => {
    const client = fakeClient({ 1: [rom(10, 100, { md5_hash: null }), rom(11, 900)] })
    assert.equal((await smallestGame(client))?.id, 11)
  })

  test('every page of a platform is read, and other platforms are not', async () => {
    const many = Array.from({ length: 600 }, (_, i) => rom(100 + i, 10_000 - i))
    const client = fakeClient({ 1: many })
    assert.equal((await smallestGame(client))?.id, 699)
    assert.deepEqual([...new Set(client.asked)], [1, 2])
  })

  test('nothing to fetch is a skip, not a pass', async () => {
    const { result, queue } = await run('ok', { 1: [rom(10, 100, { md5_hash: null })] })
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'no-hashed-snes-or-gba-title')
    assert.equal(queue.items.length, 0)
  })

  test('a smallest title over the cap is a skip, and nothing is fetched', async () => {
    const { result, queue, sums } = await run('ok', {
      1: [rom(10, SMALL_GAME_MAX_BYTES + 1)],
      2: [rom(20, SMALL_GAME_MAX_BYTES * 4)]
    })
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'smallest-title-too-large')
    assert.equal(result.metrics.bytes, SMALL_GAME_MAX_BYTES + 1)
    assert.equal(result.thresholds.maxBytes, SMALL_GAME_MAX_BYTES)
    assert.equal(queue.items.length, 0)
    assert.equal(sums.romsDownloadedBytes, 0)
  })

  test('a title of exactly the cap is fetched', async () => {
    const { result, uninstalled } = await run('ok', { 1: [rom(10, SMALL_GAME_MAX_BYTES)] })
    assert.equal(result.result, 'pass', String(result.reason))
    assert.deepEqual(uninstalled, [10])
  })

  test('a game already installed is left alone', async () => {
    const { result, uninstalled, store } = await run('ok', undefined, { installed: [11] })
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'already-installed')
    assert.deepEqual(uninstalled, [])
    assert.ok(store.has(11))
  })

  test('a file that is not the published one fails, and is still removed', async () => {
    const { result, store } = await run('corrupt')
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'hash-mismatch')
    assert.equal(store.size, 0)
  })

  test('a failed transfer fails the check and is cancelled, so no part is left', async () => {
    const { result, queue } = await run('error')
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'download-error')
    assert.deepEqual(queue.cancelled, [11])
  })

  test('a download that only announces itself, with no bytes reported, fails', async () => {
    const { result } = await run('silent')
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'no-progress-events')
  })

  test('a game that lands outside the test home fails, and is removed', async () => {
    const { result, store } = await run('outside')
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'outside-test-home')
    assert.equal(store.size, 0)
  })

  test('a game that cannot be removed fails and is counted in safety', async () => {
    const { result, sums } = await run('undeletable')
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'not-deleted')
    assert.equal(sums.romsLeft, 1)
  })

  test('a run already aborted fetches nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    const { result, queue } = await run('ok', undefined, { signal: controller.signal })
    assert.equal(result.result, 'skip')
    assert.equal(result.reason, 'aborted')
    assert.equal(queue.items.length, 0)
  })

  test('an abort stops the transfer rather than waiting it out', async () => {
    const controller = new AbortController()
    setImmediate(() => controller.abort())
    const { result, queue } = await run('hang', undefined, { signal: controller.signal })
    assert.equal(queue.cancelled[0], 11)
    assert.equal(result.result, 'fail')
    assert.equal(result.reason, 'download-cancelled')
  })
})
